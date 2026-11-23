// Server-side website inspector.
// Fetches a public URL safely (SSRF-guarded, size/time limited) and extracts
// raw, verifiable signals: HTTPS, redirects, security headers and on-page
// HTML signals (SEO tags, headings, CTAs, contact methods, content length).
// It never invents a score; scoring happens in public/js/audit-core.js.

import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const UA = 'Mozilla/5.0 (compatible; CrestaAuditBot/1.0; +https://example.com/audit)';

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s || s.length > 2048) throw new Error('invalid_url');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('invalid_url');
  if (u.username || u.password) throw new Error('invalid_url');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('blocked_port');
  if (!u.hostname.includes('.') || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) throw new Error('invalid_url');
  u.hash = '';
  return u;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('blocked_host');
    return;
  }
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => { throw new Error('dns_failed'); });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('blocked_host');
}

async function readLimited(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

// Follows redirects manually so every hop is re-checked against the SSRF guard.
async function safeFetch(startUrl, { method = 'GET', readBody = true } = {}) {
  let url = startUrl; const hops = [];
  const t0 = Date.now();
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicHost(url.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { method, redirect: 'manual', signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? 'timeout' : 'fetch_failed');
    }
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res.body?.cancel().catch(() => {});
      hops.push({ from: url.href, status: res.status });
      url = new URL(res.headers.get('location'), url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_redirect');
      continue;
    }
    const firstByteMs = Date.now() - t0;
    if (!readBody) res.body?.cancel().catch(() => {});
    const body = readBody ? await readLimited(res) : '';
    return { res, url, hops, body, firstByteMs, totalMs: Date.now() - t0 };
  }
  throw new Error('too_many_redirects');
}

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};
const metaContent = (html, key, val) => {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of tags) if ((attr(t, key) || '').toLowerCase() === val) return attr(t, 'content');
  return null;
};

// Action words in the five site languages, used to recognise calls to action.
const CTA_RE = /\b(contact|call|book|get (a|your|started|in touch|quote)|start|buy|shop|order|request|schedule|sign ?up|subscribe|join|free (quote|trial|consultation)|reserve|enquire|inquire|apply|download|talk to|let'?s talk|hire|contáct|contacta|llama|reserva|comprar|compra|solicita|agenda|empieza|pide|presupuesto|contacte[rz]?|appele[rz]|réserve[rz]?|commande[rz]?|acheter|demande[rz]?|devis|essai|fale|ligue|agende|peça|orçamento|comece|compre|kontakt|anrufen|buchen|bestellen|kaufen|anfragen|angebot|termin|jetzt)\b/i;
const TRUST_RE = /\b(testimonial|review|reviews|rating|rated|stars?|trusted by|clients?|guarantee|certified|award|accredited|reseñas|opiniones|garantía|clientes|avis|témoignages|garantie|clients|depoimentos|avaliações|garantia|bewertungen|kundenstimmen|garantie|zertifiziert)\b/i;

export function analyzeHtml(html, pageUrl) {
  const out = {};
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [''])[0];
  const noScript = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const bodyHtml = (noScript.match(/<body\b[\s\S]*<\/body>/i) || [noScript])[0];

  const title = (head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  out.title = title ? strip(title).slice(0, 300) : null;
  out.metaDescription = metaContent(html, 'name', 'description');
  out.viewport = metaContent(html, 'name', 'viewport');
  out.robots = metaContent(html, 'name', 'robots');
  out.noindex = /noindex/i.test(out.robots || '');
  out.ogTitle = metaContent(html, 'property', 'og:title');
  out.ogImage = metaContent(html, 'property', 'og:image');
  const htmlTag = (html.match(/<html\b[^>]*>/i) || [''])[0];
  out.lang = attr(htmlTag, 'lang');
  const links = html.match(/<link\b[^>]*>/gi) || [];
  out.canonical = (links.find(l => /rel\s*=\s*["']?canonical/i.test(l)) && attr(links.find(l => /rel\s*=\s*["']?canonical/i.test(l)), 'href')) || null;
  out.favicon = links.some(l => /rel\s*=\s*["'][^"']*icon/i.test(l));
  out.structuredData = /<script\b[^>]*type\s*=\s*["']application\/ld\+json/i.test(html) || /itemscope/i.test(html);

  out.h1Count = (bodyHtml.match(/<h1\b/gi) || []).length;
  out.h2Count = (bodyHtml.match(/<h2\b/gi) || []).length;
  out.navPresent = /<nav\b/i.test(bodyHtml) || /role\s*=\s*["']navigation/i.test(bodyHtml);

  const imgs = bodyHtml.match(/<img\b[^>]*>/gi) || [];
  out.imgCount = imgs.length;
  out.imgNoAlt = imgs.filter(t => attr(t, 'alt') === null).length;

  const text = strip(bodyHtml);
  out.wordCount = text ? text.split(' ').filter(w => /\p{L}/u.test(w)).length : 0;
  out.trustSignals = TRUST_RE.test(text);

  const host = pageUrl.hostname.replace(/^www\./, '');
  const anchors = bodyHtml.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  let internal = 0, external = 0, tel = 0, mailto = 0, wa = 0;
  const ctas = new Set();
  for (const a of anchors) {
    const href = attr(a, 'href') || '';
    const label = strip(a).slice(0, 80);
    if (/^tel:/i.test(href)) tel++;
    else if (/^mailto:/i.test(href)) mailto++;
    else if (/wa\.me|whatsapp\.com|api\.whatsapp/i.test(href)) wa++;
    else if (/^https?:/i.test(href)) {
      try { (new URL(href).hostname.replace(/^www\./, '') === host) ? internal++ : external++; } catch { /* ignore */ }
    } else if (href && !href.startsWith('#') && !/^javascript:/i.test(href)) internal++;
    if (label && label.length <= 60 && CTA_RE.test(label)) ctas.add(label);
  }
  for (const b of bodyHtml.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || []) {
    const label = strip(b).slice(0, 80);
    if (label && label.length <= 60 && CTA_RE.test(label)) ctas.add(label);
  }
  for (const i of bodyHtml.match(/<input\b[^>]*type\s*=\s*["']?submit[^>]*>/gi) || []) {
    const v = attr(i, 'value'); if (v) ctas.add(v.slice(0, 60));
  }
  out.internalLinks = internal; out.externalLinks = external;
  out.telLinks = tel; out.mailtoLinks = mailto; out.whatsappLinks = wa;
  out.forms = (bodyHtml.match(/<form\b/gi) || []).length;
  out.ctaCount = ctas.size;
  out.ctaSamples = [...ctas].slice(0, 6);

  if (pageUrl.protocol === 'https:') {
    const mixed = html.match(/<(img|script|iframe|link|source|video|audio)\b[^>]*(src|href)\s*=\s*["']http:\/\/[^"']+/gi) || [];
    out.mixedContent = mixed.filter(t => !/<link\b/i.test(t) || /stylesheet/i.test(t)).length;
  } else out.mixedContent = null;
  return out;
}

export async function inspect(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const result = { requestedUrl: url.href, checkedAt: new Date().toISOString() };

  const main = await safeFetch(url);
  const ct = main.res.headers.get('content-type') || '';
  result.finalUrl = main.url.href;
  result.status = main.res.status;
  result.redirects = main.hops;
  result.https = main.url.protocol === 'https:';
  result.firstByteMs = main.firstByteMs;
  result.bytes = Buffer.byteLength(main.body);
  const h = main.res.headers;
  result.headers = {
    hsts: h.get('strict-transport-security'),
    csp: h.get('content-security-policy'),
    xcto: h.get('x-content-type-options'),
    xfo: h.get('x-frame-options'),
    referrer: h.get('referrer-policy'),
    permissions: h.get('permissions-policy'),
    server: h.get('server')
  };
  result.frameProtected = !!result.headers.xfo || /frame-ancestors/i.test(result.headers.csp || '');

  // Does the plain-HTTP version redirect to HTTPS?
  result.httpRedirectsToHttps = null;
  try {
    const httpUrl = new URL(main.url.href); httpUrl.protocol = 'http:';
    const r = await safeFetch(httpUrl, { readBody: false });
    result.httpRedirectsToHttps = r.url.protocol === 'https:';
  } catch { /* could not test; leave null so the report says so */ }

  result.html = /html|xml/i.test(ct) || /<html/i.test(main.body) ? analyzeHtml(main.body, main.url) : null;
  return result;
}

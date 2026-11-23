// Audit engine (runs in the browser).
// Data sources, all real:
//   1. Google PageSpeed Insights API v5 (Lighthouse), mobile + desktop runs.
//   2. /api/inspect – our backend: HTTPS, redirects, security headers, HTML signals.
// Every score is computed from those measurements. A category with no data
// is marked unavailable and left out of the overall score; "Design" is never
// auto-scored because no tool can honestly judge visual quality.

export const CATS = ['design', 'mobile', 'performance', 'seo', 'ux', 'accessibility', 'security', 'conversion', 'cta', 'content'];
const WEIGHTS = { performance: 15, seo: 15, mobile: 12, security: 12, accessibility: 10, conversion: 10, ux: 9, cta: 9, content: 8 };
const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const LOCALES = { en: 'en', es: 'es', fr: 'fr', pt: 'pt-BR', de: 'de' };

export async function runPsi(url, strategy, { key, lang = 'en', signal } = {}) {
  const q = new URLSearchParams({ url, strategy, locale: LOCALES[lang] || 'en' });
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) q.append('category', c);
  if (key) q.set('key', key);
  const res = await fetch(`${PSI}?${q}`, { signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.lighthouseResult) {
    const msg = json?.error?.message || '';
    throw new Error(res.status === 429 || /quota/i.test(msg) ? 'psi_quota' : /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS|NO_FCP/i.test(msg) ? 'psi_unreachable' : 'psi_failed');
  }
  return json.lighthouseResult;
}

export async function runInspect(url, { endpoint = '/api/inspect', signal } = {}) {
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }), signal });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('backend_missing');
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'inspect_failed');
  return json.data;
}

const pct = s => (s == null ? null : Math.round(s * 100));
const avg = arr => { const v = arr.filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
// Weighted pass ratio over checks [{ok:true|false|null, w}]; null checks are skipped.
const ratio = checks => { const c = checks.filter(x => x.ok != null); if (!c.length) return null; const t = c.reduce((a, x) => a + x.w, 0); return Math.round(100 * c.reduce((a, x) => a + (x.ok ? x.w : 0), 0) / t); };

function lhFailures(lh, catId, limit = 4) {
  const cat = lh?.categories?.[catId]; if (!cat) return [];
  return cat.auditRefs
    .filter(r => r.weight > 0)
    .map(r => ({ r, a: lh.audits[r.id] }))
    .filter(({ a }) => a && a.score != null && a.score < 0.9 && ['binary', 'numeric', 'metricSavings'].includes(a.scoreDisplayMode))
    .sort((x, y) => y.r.weight - x.r.weight)
    .slice(0, limit)
    .map(({ a, r }) => ({ id: r.id, title: a.title, weight: r.weight }));
}

function opportunities(lh, limit = 4) {
  const cat = lh?.categories?.performance; if (!cat) return [];
  return cat.auditRefs.filter(r => r.group !== 'metrics')
    .map(r => lh.audits[r.id]).filter(a => a && a.score != null && a.score < 0.9)
    .map(a => ({ title: a.title, ms: a.details?.overallSavingsMs ?? Math.max(a.metricSavings?.LCP || 0, a.metricSavings?.FCP || 0) }))
    .filter(o => o.ms >= 150).sort((a, b) => b.ms - a.ms).slice(0, limit);
}

export function buildReport({ url, mobile, desktop, page, errors = {} }) {
  const issues = []; const strengths = [];
  const add = (id, cat, pr, p = {}) => issues.push({ id, cat, pr, p });
  const good = (id, p = {}) => strengths.push({ id, p });
  const A = id => mobile?.audits?.[id];
  const H = page?.html || null;
  const cats = {};

  // ---- Performance (Lighthouse mobile) ----
  const metrics = mobile ? {
    lcp: A('largest-contentful-paint')?.numericValue, fcp: A('first-contentful-paint')?.numericValue,
    tbt: A('total-blocking-time')?.numericValue, cls: A('cumulative-layout-shift')?.numericValue, si: A('speed-index')?.numericValue
  } : null;
  if (mobile) {
    const s = pct(mobile.categories.performance?.score);
    cats.performance = { score: s, basis: 'lh', extra: { desktop: pct(desktop?.categories?.performance?.score) } };
    if (s < 50) add('perf_poor', 'performance', 'critical', { s }); else if (s < 90) add('perf_avg', 'performance', s < 70 ? 'high' : 'medium', { s });
    else good('s_perf', { s });
    if (metrics.lcp > 4000) add('lcp_slow', 'performance', 'critical', { v: (metrics.lcp / 1000).toFixed(1) });
    else if (metrics.lcp > 2500) add('lcp_slow', 'performance', 'high', { v: (metrics.lcp / 1000).toFixed(1) });
    else if (metrics.lcp) good('s_lcp', { v: (metrics.lcp / 1000).toFixed(1) });
    if (metrics.cls > 0.25) add('cls_high', 'performance', 'high', { v: metrics.cls.toFixed(2) });
    else if (metrics.cls > 0.1) add('cls_high', 'performance', 'medium', { v: metrics.cls.toFixed(2) });
    if (metrics.tbt > 600) add('tbt_high', 'performance', 'high', { v: Math.round(metrics.tbt) });
    else if (metrics.tbt > 200) add('tbt_high', 'performance', 'medium', { v: Math.round(metrics.tbt) });
    for (const o of opportunities(mobile, 3)) add('opp', 'performance', o.ms > 1500 ? 'high' : 'medium', { title: o.title, v: (o.ms / 1000).toFixed(1) });
  } else cats.performance = { score: null, reason: errors.psi || 'psi_failed' };

  // ---- Accessibility (Lighthouse) ----
  if (mobile) {
    const s = pct(mobile.categories.accessibility?.score);
    cats.accessibility = { score: s, basis: 'lh' };
    for (const f of lhFailures(mobile, 'accessibility', 4)) add('lh', 'accessibility', s < 70 ? 'high' : 'medium', { title: f.title });
    if (s >= 90) good('s_a11y', { s });
  } else cats.accessibility = { score: null, reason: errors.psi || 'psi_failed' };

  // ---- SEO (Lighthouse + on-page checks) ----
  {
    const lhS = mobile ? pct(mobile.categories.seo?.score) : null;
    let own = null;
    if (H) {
      const tl = H.title?.length || 0, dl = H.metaDescription?.length || 0;
      own = ratio([
        { ok: !!H.title, w: 3 }, { ok: tl >= 15 && tl <= 65, w: 1 }, { ok: !!H.metaDescription, w: 3 }, { ok: dl >= 70 && dl <= 170, w: 1 },
        { ok: H.h1Count === 1, w: 2 }, { ok: !!H.canonical, w: 1 }, { ok: !!(H.ogTitle && H.ogImage), w: 1 },
        { ok: H.structuredData, w: 2 }, { ok: !H.noindex, w: 4 }, { ok: !!H.lang, w: 1 }]);
      if (H.noindex) add('noindex', 'seo', 'critical');
      if (!H.title) add('no_title', 'seo', 'critical'); else if (tl < 15 || tl > 65) add('title_len', 'seo', 'low', { n: tl });
      if (!H.metaDescription) add('no_meta_desc', 'seo', 'high'); else if (dl < 70 || dl > 170) add('meta_len', 'seo', 'low', { n: dl });
      else good('s_meta');
      if (H.h1Count === 0) add('no_h1', 'seo', 'high'); else if (H.h1Count > 1) add('multi_h1', 'seo', 'low', { n: H.h1Count });
      if (!H.structuredData) add('no_schema', 'seo', 'medium'); else good('s_schema');
      if (!H.canonical) add('no_canonical', 'seo', 'low');
      if (!(H.ogTitle && H.ogImage)) add('no_og', 'seo', 'low');
      if (!H.lang) add('no_lang', 'seo', 'medium');
    }
    if (mobile) for (const f of lhFailures(mobile, 'seo', 3)) {
      if (['document-title', 'meta-description', 'is-crawlable'].includes(f.id) && H) continue; // already covered above
      add('lh', 'seo', 'medium', { title: f.title });
    }
    const s = lhS != null && own != null ? Math.round(lhS * 0.5 + own * 0.5) : (lhS ?? own);
    cats.seo = s == null ? { score: null, reason: errors.psi || 'psi_failed' } : { score: s, basis: lhS != null && own != null ? 'mixed' : lhS != null ? 'lh' : 'signals', partial: lhS == null || own == null };
    if (s >= 90) good('s_seo', { s });
  }

  // ---- Mobile responsiveness ----
  {
    const vpOwn = H ? /width\s*=\s*device-width/i.test(H.viewport || '') : null;
    const lhChecks = ['viewport', 'font-size', 'tap-targets', 'content-width'].map(id => A(id)).filter(a => a && a.score != null);
    const checks = [{ ok: vpOwn, w: 3 }, ...lhChecks.map(a => ({ ok: a.score >= 0.9, w: 2 }))];
    if (mobile) checks.push({ ok: pct(mobile.categories.performance?.score) >= 50, w: 2 }, { ok: (metrics.cls ?? 0) <= 0.1, w: 1 });
    const s = ratio(checks);
    cats.mobile = s == null ? { score: null, reason: errors.psi || 'psi_failed' } : { score: s, basis: 'mixed', partial: !mobile };
    if (vpOwn === false || A('viewport')?.score === 0) add('no_viewport', 'mobile', 'critical');
    else if (vpOwn || A('viewport')?.score === 1) good('s_viewport');
    for (const a of lhChecks.filter(a => a.score < 0.9 && a.id !== 'viewport')) add('lh', 'mobile', 'high', { title: a.title });
  }

  // ---- Security & HTTPS ----
  if (page) {
    const h = page.headers;
    const s = ratio([
      { ok: page.https, w: 30 }, { ok: page.httpRedirectsToHttps, w: 20 }, { ok: !!h.hsts, w: 15 },
      { ok: H?.mixedContent == null ? null : H.mixedContent === 0, w: 15 }, { ok: !!h.csp, w: 8 },
      { ok: /nosniff/i.test(h.xcto || ''), w: 4 }, { ok: page.frameProtected, w: 4 }, { ok: !!h.referrer, w: 4 }]);
    cats.security = { score: s, basis: 'signals' };
    if (!page.https) add('no_https', 'security', 'critical');
    else { good('s_https'); if (page.httpRedirectsToHttps === false) add('no_redirect', 'security', 'high'); }
    if (H?.mixedContent > 0) add('mixed_content', 'security', 'high', { n: H.mixedContent });
    if (page.https && !h.hsts) add('no_hsts', 'security', 'medium'); else if (h.hsts) good('s_hsts');
    if (!h.csp) add('no_csp', 'security', 'low');
    if (!/nosniff/i.test(h.xcto || '')) add('no_xcto', 'security', 'low');
    if (!page.frameProtected) add('no_xfo', 'security', 'low');
    if (page.firstByteMs > 1800) add('slow_server', 'performance', 'medium', { v: (page.firstByteMs / 1000).toFixed(1) });
  } else if (mobile && A('is-on-https')) {
    const ok = A('is-on-https').score === 1;
    cats.security = { score: ok ? 60 : 0, basis: 'lh', partial: true };
    if (!ok) add('no_https', 'security', 'critical'); else good('s_https');
  } else cats.security = { score: null, reason: errors.inspect || 'backend_missing' };

  // ---- UX & navigation (automated signals; always partial) ----
  {
    const bp = mobile ? pct(mobile.categories['best-practices']?.score) : null;
    const checks = [
      { ok: H ? H.navPresent : null, w: 3 }, { ok: H ? H.internalLinks >= 5 : null, w: 2 }, { ok: H ? H.h1Count >= 1 : null, w: 1 },
      { ok: H ? H.favicon : null, w: 1 }, { ok: metrics ? (metrics.cls ?? 0) <= 0.1 : null, w: 2 },
      { ok: metrics ? (metrics.fcp ?? 99999) <= 1800 : null, w: 2 }, { ok: bp == null ? null : bp >= 90, w: 2 }];
    const s = ratio(checks);
    cats.ux = s == null ? { score: null, reason: 'no_data' } : { score: s, basis: 'signals', partial: true };
    if (H && !H.navPresent) add('no_nav', 'ux', 'high');
    if (H && H.internalLinks < 5) add('few_links', 'ux', 'medium', { n: H.internalLinks });
    if (H && !H.favicon) add('no_favicon', 'ux', 'low');
  }

  // ---- Calls to action ----
  if (H) {
    const n = H.ctaCount; const contact = H.telLinks + H.mailtoLinks + H.whatsappLinks > 0;
    const s = Math.min(100, (n === 0 ? 0 : n === 1 ? 45 : n <= 3 ? 70 : 85) + (contact ? 15 : 0));
    cats.cta = { score: s, basis: 'signals', partial: true, extra: { samples: H.ctaSamples } };
    if (n === 0) add('no_cta', 'cta', 'critical'); else if (n < 2) add('few_cta', 'cta', 'high', { n }); else good('s_cta', { n });
  } else cats.cta = { score: null, reason: errors.inspect || 'backend_missing' };

  // ---- Conversion optimisation ----
  if (H) {
    const s = ratio([
      { ok: H.ctaCount >= 2, w: 3 }, { ok: H.forms > 0, w: 3 }, { ok: H.telLinks > 0, w: 2 },
      { ok: H.mailtoLinks + H.whatsappLinks > 0, w: 1 }, { ok: H.trustSignals, w: 2 },
      { ok: metrics ? (metrics.lcp ?? 99999) <= 2500 : null, w: 2 }]);
    cats.conversion = { score: s, basis: 'signals', partial: true };
    if (!H.forms) add('no_form', 'conversion', 'high');
    if (!H.telLinks) add('no_phone', 'conversion', 'medium');
    if (!H.trustSignals) add('no_trust', 'conversion', 'medium');
    if (H.forms && H.telLinks) good('s_contact');
  } else cats.conversion = { score: null, reason: errors.inspect || 'backend_missing' };

  // ---- Content quality ----
  if (H) {
    const altRatio = H.imgCount ? 1 - H.imgNoAlt / H.imgCount : 1;
    const s = ratio([
      { ok: H.wordCount >= 300, w: 3 }, { ok: H.wordCount >= 600, w: 1 }, { ok: H.h2Count >= 2, w: 2 },
      { ok: altRatio >= 0.9, w: 2 }, { ok: !!H.title && !!H.metaDescription, w: 1 }, { ok: !!H.lang, w: 1 }]);
    cats.content = { score: s, basis: 'signals', partial: true };
    if (H.wordCount < 300) add('thin_content', 'content', 'high', { n: H.wordCount });
    else good('s_content', { n: H.wordCount });
    if (H.h2Count < 2) add('few_headings', 'content', 'medium', { n: H.h2Count });
    if (H.imgNoAlt > 0) add('img_alt', 'content', H.imgNoAlt > 5 ? 'medium' : 'low', { n: H.imgNoAlt });
  } else cats.content = { score: null, reason: errors.inspect || 'backend_missing' };

  // ---- Design: never auto-scored ----
  cats.design = { score: null, reason: 'manual' };

  // Overall: weighted mean of categories that have real data.
  let wsum = 0, ssum = 0;
  for (const [id, c] of Object.entries(cats)) if (c.score != null && WEIGHTS[id]) { wsum += WEIGHTS[id]; ssum += WEIGHTS[id] * c.score; }
  const overall = wsum ? Math.round(ssum / wsum) : null;

  // De-duplicate Lighthouse titles that repeat across categories.
  const seen = new Set();
  const uniq = issues.filter(i => { const k = i.id + '|' + (i.p.title || i.cat); if (seen.has(k)) return false; seen.add(k); return true; });
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  uniq.sort((a, b) => order[a.pr] - order[b.pr]);

  return {
    url: page?.finalUrl || url, checkedAt: new Date().toISOString(), overall,
    scoredCount: Object.values(cats).filter(c => c.score != null).length,
    categories: CATS.map(id => ({ id, ...cats[id] })),
    metrics, desktopPerf: pct(desktop?.categories?.performance?.score),
    screenshot: A('final-screenshot')?.details?.data || null,
    lighthouseVersion: mobile?.lighthouseVersion || null,
    sources: { psi: !!mobile, psiDesktop: !!desktop, inspect: !!page },
    issues: uniq, strengths: strengths.slice(0, 8), errors
  };
}

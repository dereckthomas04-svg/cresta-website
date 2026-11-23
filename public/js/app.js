import { CONFIG } from './config.js';
import EN from './i18n-en.js';
import { runPsi, runInspect, buildReport } from './audit-core.js';

{
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

// ───────── i18n ─────────
const LANGS = ['en', 'es', 'fr', 'pt', 'de'];
const dicts = { en: EN };
const loadDict = l => dicts[l] ? Promise.resolve(dicts[l]) : import(`./i18n-${l}.js`).then(m => (dicts[l] = m.default));
let lang = 'en';
const t = (k, p = {}) => String((dicts[lang] && dicts[lang][k]) ?? EN[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => p[n] ?? '');

async function setLang(l, animate) {
  if (!LANGS.includes(l)) l = 'en';
  await loadDict(l).catch(() => (l = 'en'));
  lang = l; store.set('cr_lang', l);
  document.documentElement.lang = l;
  $('#lang').value = l;
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  document.title = `Cresta Agency — ${t('hero.title').replace(/\.$/, '')}`;
  renderWork(); renderTestimonials();
  if (lastReport) renderReport(lastReport);
  if (animate) { document.body.classList.remove('lang-swap'); void document.body.offsetWidth; document.body.classList.add('lang-swap'); }
  track('language', { lang: l });
}

// ───────── analytics (only if configured) ─────────
function track(name, params = {}) {
  try {
    if (window.gtag) window.gtag('event', name, params);
    if (window.plausible) window.plausible(name, { props: params });
  } catch { /* never break the page for analytics */ }
}
function initAnalytics() {
  if (CONFIG.ga4Id) {
    const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(CONFIG.ga4Id)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', CONFIG.ga4Id, { anonymize_ip: true });
  }
  if (CONFIG.plausibleDomain) {
    const s = document.createElement('script'); s.defer = true; s.dataset.domain = CONFIG.plausibleDomain; s.src = 'https://plausible.io/js/script.tagged-events.js';
    document.head.appendChild(s);
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  }
}

// ───────── static content ─────────
const WORK = [
  { k: 'w1', name: 'Saffron & Salt', bg: '#1f140f', ink: '#f3e6d4', acc: '#d9822b', img: 'linear-gradient(150deg,#e3a857,#8a3b12)', title: 'Dinner, the slow way.', btn: 'Reserve' },
  { k: 'w2', name: 'Hale Mercer LLP', bg: '#f2f0ec', ink: '#1b2430', acc: '#1b2430', img: 'linear-gradient(160deg,#c8ccd2,#6b7684)', title: 'Counsel that stays calm.', btn: 'Consultation' },
  { k: 'w3', name: 'Brightline Dental', bg: '#eef6f6', ink: '#0f3b3e', acc: '#16858a', img: 'linear-gradient(160deg,#bfe5e3,#5fb3b0)', title: 'Gentle care, clear prices.', btn: 'Book visit' },
  { k: 'w4', name: 'Northgate Homes', bg: '#ffffff', ink: '#13201a', acc: '#2e5b45', img: 'linear-gradient(160deg,#a9c3b4,#3d6b55)', title: 'Find the one.', btn: 'Valuation' },
  { k: 'w5', name: 'Forge Athletics', bg: '#111111', ink: '#ffffff', acc: '#e4ff3a', img: 'linear-gradient(160deg,#444,#111)', title: 'TRAIN HARDER.', btn: 'Free trial' },
  { k: 'w6', name: 'Lumen Botanics', bg: '#f6efe9', ink: '#3a2a24', acc: '#b26e5a', img: 'linear-gradient(160deg,#f1d7c8,#c89683)', title: 'Skin, simply.', btn: 'Shop now' }
];
function renderWork() {
  $('#workGrid').innerHTML = WORK.map(w => `
    <article class="wcard reveal in">
      <div class="wthumb" style="background:linear-gradient(160deg,${w.acc}1f,#eef0f4)" aria-hidden="true">
        <div class="mini" style="background:${w.bg};color:${w.ink}">
          <div class="mn">${esc(w.name.toUpperCase())}<i></i><i></i><i></i></div>
          <div class="mh"><div><div class="mt">${esc(w.title)}</div><span class="mb" style="background:${w.acc};color:${w.bg}">${esc(w.btn)}</span></div><div class="mi" style="background:${w.img}"></div></div>
        </div>
      </div>
      <div class="wmeta"><span>${esc(t('work.' + w.k + 'i'))}</span><h3>${esc(w.name)}</h3><p>${esc(t('work.' + w.k))}</p></div>
    </article>`).join('');
}

function renderTestimonials() {
  const list = CONFIG.testimonials || [];
  const box = $('#testiList');
  if (!list.length) {
    box.innerHTML = `<div class="testi-empty"><div><h3>${esc(t('testi.emptyT'))}</h3><p>${esc(t('testi.emptyP'))}</p></div><button class="btn btn-ghost" data-open="consult">${esc(t('testi.emptyCta'))}</button></div>`;
    return;
  }
  box.innerHTML = list.map(q => `<figure class="quote"><p>“${esc(q.quote[lang] || q.quote.en)}”</p><footer>${esc(q.name)} · ${q.url ? `<a href="${esc(q.url)}" rel="noopener" target="_blank">${esc(q.role)}</a>` : esc(q.role)}</footer></figure>`).join('');
}

function initContact() {
  const wa = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent('Hi Cresta, I would like to talk about a website.')}`;
  $('#cEmail').href = `mailto:${CONFIG.email}`; $('#cEmail').textContent = CONFIG.email;
  $('#cPhone').href = `tel:${CONFIG.phoneIntl}`; $('#cPhone').textContent = CONFIG.phone;
  $('#cWa').href = wa; $('#waFloat').href = wa;
  $('#waFloat').addEventListener('click', () => track('whatsapp_click'));
  $('#cWa').addEventListener('click', () => track('whatsapp_click'));
  $('#year').textContent = new Date().getFullYear();
  $('#fEmail').href = `mailto:${CONFIG.email}`; $('#fEmail').textContent = CONFIG.email;
  $('#fPhone').href = `tel:${CONFIG.phoneIntl}`; $('#fPhone').textContent = CONFIG.phone;
  if (CONFIG.hours) $('#fHours').textContent = CONFIG.hours; else $('#fHoursRow').remove();
  if (CONFIG.location) $('#fLoc').textContent = CONFIG.location; else $('#fLocRow').remove();
}

// ───────── motion ─────────
function initMotion() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 6) * 60}ms`; io.observe(el); });
  const countIo = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; countIo.unobserve(e.target);
    const el = e.target, end = Number(el.dataset.count);
    if (reduce || end === 0) { el.textContent = end; return; }
    const t0 = performance.now(), dur = 1400;
    const step = now => { const p = Math.min(1, (now - t0) / dur); el.textContent = Math.round(end * (1 - (1 - p) ** 3)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach(el => countIo.observe(el));
  const nav = $('.nav');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true });
  const links = $$('#navlinks a');
  const secIo = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  ['services', 'why', 'work', 'contact'].forEach(id => { const s = document.getElementById(id); if (s) secIo.observe(s); });
}

function initNav() {
  const b = $('#burger'), menu = $('#navlinks');
  b.addEventListener('click', () => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', open); menu.classList.toggle('open', open); });
  menu.addEventListener('click', e => { if (e.target.closest('a')) { b.setAttribute('aria-expanded', 'false'); menu.classList.remove('open'); } });
  $('#lang').addEventListener('change', e => setLang(e.target.value, true));
}

// ───────── modals ─────────
function openModal(name, service) {
  if (name === 'consult' && CONFIG.bookingUrl) { track('book_consult_external'); window.open(CONFIG.bookingUrl, '_blank', 'noopener'); return; }
  const d = document.getElementById('m-' + name); if (!d) return;
  if (service) { const sel = d.querySelector('select[name=service]'); if (sel) sel.value = service; }
  d.querySelector('form').dataset.t = Date.now();
  d.showModal(); track('open_' + name);
  setTimeout(() => d.querySelector('input:not([type=hidden]):not(.hp)')?.focus(), 50);
}
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); openModal(o.dataset.open, o.dataset.service); return; }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  if (e.target.tagName === 'DIALOG') e.target.close(); // click on backdrop
  const tr = e.target.closest('[data-track]'); if (tr) track(tr.dataset.track);
});

// ───────── forms ─────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
function validate(form) {
  let ok = true;
  for (const el of form.querySelectorAll('input,select,textarea')) {
    el.classList.remove('invalid');
    if (el.classList.contains('hp') || el.type === 'hidden') continue;
    let bad = el.required && (el.type === 'checkbox' ? !el.checked : !el.value.trim());
    if (!bad && el.type === 'email' && el.value && !EMAIL_RE.test(el.value.trim())) bad = true;
    if (!bad && el.name === 'website' && el.value.trim() && !normUrl(el.value)) bad = true;
    if (bad) { ok = false; (el.type === 'checkbox' ? el.closest('label') : el).classList.add('invalid'); }
  }
  return ok;
}
function normUrl(v) {
  try { const s = v.trim(); const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); return u.hostname.includes('.') ? u.href : null; } catch { return null; }
}
function payload(form, type) {
  const fd = new FormData(form); const o = { type, lang, t: Number(form.dataset.t) || 0 };
  for (const [k, v] of fd) o[k] = typeof v === 'string' ? v.trim() : v;
  for (const c of form.querySelectorAll('input[type=checkbox]')) o[c.name] = c.checked;
  if (o.consent === '1') o.consent = true;
  if (o.website) o.website = normUrl(o.website) || o.website;
  return o;
}
function setMsg(form, kind, text, fallback) {
  const m = form.querySelector('.form-msg'); m.className = 'form-msg ' + kind; m.textContent = text;
  if (fallback) {
    const [before, after = ''] = String(dicts[lang]?.['m.fallback'] ?? EN['m.fallback']).split('{email}');
    const a = document.createElement('a'); a.href = `mailto:${CONFIG.email}`; a.textContent = CONFIG.email;
    m.append(' ' + before, a, after);
  }
}
async function postLead(data) {
  const res = await fetch('/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const json = (res.headers.get('content-type') || '').includes('json') ? await res.json() : { ok: false, error: 'not_configured' };
  return { status: res.status, ...json };
}
function initForms() {
  for (const form of $$('form[data-lead]')) {
    form.dataset.t = Date.now();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const type = form.dataset.lead;
      if (!validate(form)) return setMsg(form, 'err', t('m.invalid'));
      const btn = form.querySelector('[type=submit]'); btn.disabled = true; setMsg(form, '', t('m.sending'));
      try {
        const r = await postLead(payload(form, type));
        if (r.ok) { setMsg(form, 'ok', t(type === 'newsletter' ? 'm.okNews' : 'm.ok')); form.reset(); track('lead_' + type); }
        else if (r.error === 'rate_limited') setMsg(form, 'err', t('m.rate'));
        else if (r.error === 'not_configured' || r.status >= 500) setMsg(form, 'err', t('m.notConfigured'), true);
        else setMsg(form, 'err', t('m.invalid'));
      } catch { setMsg(form, 'err', t('m.err'), true); }
      btn.disabled = false;
    });
  }
}

// ───────── audit ─────────
let lastReport = null; let lastLead = null; let emailState = null;
const scoreClass = s => s == null ? '' : s >= 90 ? 'g' : s >= 50 ? 'm' : 'b';
const scoreColor = s => s == null ? '#b9b1a9' : s >= 90 ? '#2f9e62' : s >= 50 ? '#d08a17' : '#c4243f';
const PRIO_COLORS = { critical: '#8b0f2a', high: '#d0452b', medium: '#d39a2b', low: '#8a9aa6' };
const SVC_FOR = { performance: 'svc.s7t', mobile: 'svc.s2t', seo: 'svc.s5t', content: 'svc.s5t', security: 'svc.s6t', accessibility: 'svc.s2t', ux: 'svc.s2t', conversion: 'svc.s4t', cta: 'svc.s4t' };

function setStep(step, state) { const li = $(`#auditSteps [data-step="${step}"]`); if (li) li.className = state; }

function initAudit() {
  const form = $('#auditForm'); form.dataset.t = Date.now();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate(form)) return setMsg(form, 'err', t('m.invalid'));
    const lead = payload(form, 'audit');
    const url = normUrl(lead.website); if (!url) return setMsg(form, 'err', t('m.badUrl'));
    lead.website = url; lastLead = lead; emailState = null;
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; setMsg(form, '', '');
    track('audit_start');
    const shell = $('#reportShell'); shell.hidden = false; $('#report').innerHTML = ''; $('#auditProgress').hidden = false;
    $$('#auditSteps li').forEach(li => (li.className = ''));
    shell.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const errors = {};
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 120000);
    setStep('inspect', 'run'); setStep('mobile', 'run'); setStep('desktop', 'run');
    const psiErr = e => (e.name === 'AbortError' ? 'timeout' : e instanceof TypeError ? 'network' : e.message);
    const [page, mobile, desktop] = await Promise.all([
      runInspect(url, { signal: ctrl.signal }).then(r => (setStep('inspect', 'ok'), r)).catch(e => { errors.inspect = e instanceof TypeError ? 'backend_missing' : e.message; setStep('inspect', 'fail'); return null; }),
      runPsi(url, 'mobile', { key: CONFIG.psiKey, lang, signal: ctrl.signal }).then(r => (setStep('mobile', 'ok'), r)).catch(e => { errors.psi = psiErr(e); setStep('mobile', 'fail'); return null; }),
      runPsi(url, 'desktop', { key: CONFIG.psiKey, lang, signal: ctrl.signal }).then(r => (setStep('desktop', 'ok'), r)).catch(e => { errors.psiDesktop = psiErr(e); setStep('desktop', 'fail'); return null; })
    ]);
    clearTimeout(timer);
    setStep('report', 'run');
    const report = (page || mobile) ? buildReport({ url, mobile, desktop, page, errors }) : { fatal: true, url, errors };
    report.business = lead.business || lead.name;
    lastReport = report;
    $('#auditProgress').hidden = true; setStep('report', 'ok');
    renderReport(report);
    btn.disabled = false;
    track(report.fatal ? 'audit_failed' : 'audit_complete', { score: report.overall ?? -1 });

    // Capture the lead (and email the report if asked). Never claim success we didn't get.
    try {
      const r = await postLead({ ...lead, report: report.fatal ? undefined : summary(report) });
      emailState = lead.sendCopy ? (r.ok && r.emailedCopy ? 'sent' : 'failed') : null;
    } catch { emailState = lead.sendCopy ? 'failed' : null; }
    if (lastReport === report) renderReport(report);
  });
}

function issueText(i) { return { title: t(`i.${i.id}.t`, i.p), fix: t(`i.${i.id}.f`, i.p) }; }
function summary(r) {
  return {
    url: r.url, overall: r.overall,
    categories: r.categories.map(c => ({ name: t('cat.' + c.id), score: c.score, note: c.score == null ? (c.reason === 'manual' ? t('r.manual') : t('r.unavailable')) : '' })),
    issues: r.issues.slice(0, 20).map(i => ({ priority: t('p.' + i.pr), ...issueText(i) })),
    labels: { title: t('r.title'), categories: t('r.cats'), issues: t('r.issues'), cta: t('r.helpP'), subject: t('r.subject') }
  };
}

function gauge(score) {
  const C = 2 * Math.PI * 80, off = score == null ? C : C * (1 - score / 100);
  return `<div class="gauge" role="img" aria-label="${esc(t('r.overall'))}: ${score ?? '—'}/100"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="12"/><circle class="arc" cx="90" cy="90" r="80" fill="none" stroke="${scoreColor(score)}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${off}" style="transition:stroke-dashoffset 1.4s cubic-bezier(.2,.7,.2,1)"/></svg><div class="val"><div>${score ?? '—'}<small>${esc(t('r.overall'))}</small></div></div></div>`;
}

function renderReport(r) {
  const box = $('#report');
  if (r.fatal) {
    const why = [r.errors.inspect, r.errors.psi].filter(Boolean).map(k => t('why.' + k)).filter((v, i, a) => a.indexOf(v) === i).join(' ');
    box.innerHTML = `<div class="rep"><div class="rep-sec"><h4>${esc(t('r.fatal'))}</h4><p class="rep-err">${esc(why)}</p>
      <div class="rep-actions"><button class="btn btn-red" data-open="consult">${esc(t('r.helpBook'))}</button><button class="btn btn-ghost" data-again>${esc(t('r.again'))}</button></div></div></div>`;
    bindAgain(); return;
  }
  const date = new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : lang, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(r.checkedAt));
  const rows = r.categories.map(c => {
    const tag = c.score != null && c.partial !== false && (c.basis === 'signals' || c.partial) ? `<span class="tagp">${esc(t('r.partial'))}</span>` : '';
    const right = c.score == null ? `<span class="na">${esc(c.reason === 'manual' ? t('r.manual') : t('r.unavailable'))}</span>` : `<span class="sc">${c.score}/100</span>`;
    const note = c.score == null && c.reason !== 'manual' && c.reason ? ` title="${esc(t('why.' + c.reason))}"` : '';
    return `<div class="row"${note}><span>${esc(t('cat.' + c.id))}${tag}</span><div class="trk"><i class="${scoreClass(c.score)}" data-w="${c.score ?? 0}"></i></div>${right}</div>`;
  }).join('');
  const unavailable = r.categories.filter(c => c.score == null && c.reason !== 'manual');
  const unavailNote = unavailable.length ? `<p class="rep-err">${unavailable.map(c => `${esc(t('cat.' + c.id))}: ${esc(t('why.' + c.reason))}`).join('<br>')}</p>` : '';

  const m = r.metrics;
  const vit = m ? [
    ['lcp', m.lcp, v => (v / 1000).toFixed(1) + ' s', v => v <= 2500 ? 'g' : v <= 4000 ? 'm' : 'b'],
    ['fcp', m.fcp, v => (v / 1000).toFixed(1) + ' s', v => v <= 1800 ? 'g' : v <= 3000 ? 'm' : 'b'],
    ['tbt', m.tbt, v => Math.round(v) + ' ms', v => v <= 200 ? 'g' : v <= 600 ? 'm' : 'b'],
    ['cls', m.cls, v => v.toFixed(2), v => v <= 0.1 ? 'g' : v <= 0.25 ? 'm' : 'b'],
    ['si', m.si, v => (v / 1000).toFixed(1) + ' s', v => v <= 3400 ? 'g' : v <= 5800 ? 'm' : 'b']
  ].filter(x => x[1] != null) : [];
  const vitalsHtml = vit.length ? `<div class="rep-sec"><h4>${esc(t('r.vitals'))}</h4><div class="vitals">${vit.map(([k, v, f, c]) => `<div class="vital"><b>${f(v)}</b><span>${esc(t('r.' + k))}</span><i class="${c(v)}"></i></div>`).join('')}</div>${r.desktopPerf != null ? `<p class="rep-note">${esc(t('r.desktop', { s: r.desktopPerf }))}</p>` : ''}</div>` : '';

  const counts = { critical: 0, high: 0, medium: 0, low: 0 }; r.issues.forEach(i => counts[i.pr]++);
  const total = r.issues.length || 1;
  const prioBar = `<div class="prio-bar">${Object.entries(counts).map(([k, n]) => n ? `<span style="width:${(n / total) * 100}%;background:${PRIO_COLORS[k]}"></span>` : '').join('')}</div>
    <div class="legend">${Object.entries(counts).map(([k, n]) => `<span><i class="p-${k}"></i>${esc(t('p.' + k))}: ${n}</span>`).join('')}</div>`;
  const issuesHtml = r.issues.length ? r.issues.map(i => { const x = issueText(i); return `<div class="issue"><span class="badge p-${i.pr}">${esc(t('p.' + i.pr))}</span><div><b>${esc(x.title)}</b><p>${esc(x.fix)}</p><div class="cat">${esc(t('cat.' + i.cat))}</div></div></div>`; }).join('') : `<p>${esc(t('r.noIssues'))}</p>`;

  const strengths = r.strengths.map(s => `<li>${esc(t('s.' + s.id, s.p))}</li>`).join('');
  const weak = r.issues.filter(i => i.pr === 'critical' || i.pr === 'high').slice(0, 6).map(i => `<li>${esc(issueText(i).title)}</li>`).join('');

  const weakCats = r.categories.filter(c => c.score != null && c.score < 75).map(c => SVC_FOR[c.id]).filter(Boolean);
  const svcs = [...new Set(weakCats)];
  const emailLine = emailState === 'sent' ? `<p class="rep-note" style="color:#2f9e62">${esc(t('r.emailed', { e: lastLead?.email }))}</p>` : emailState === 'failed' ? `<p class="rep-note">${esc(t('r.notEmailed'))}</p>` : '';

  box.innerHTML = `<article class="rep" aria-label="${esc(t('r.title'))}">
    <header class="rep-top"><div><h3>${esc(t('r.title'))}</h3><p class="meta">${esc(r.url)}</p>
      <p class="meta">${r.business ? esc(t('r.for', { b: r.business })) + ' · ' : ''}${esc(t('r.checked', { d: date }))}</p>
      <p class="meta">${esc(t('r.basedOn', { n: r.categories.filter(c => c.score != null).length }))}</p></div>${gauge(r.overall)}</header>
    <section class="rep-sec"><h4>${esc(t('r.cats'))}</h4><div class="rows">${rows}</div>${unavailNote}<p class="rep-note">${esc(t('r.method'))}</p></section>
    ${vitalsHtml}
    <section class="rep-sec two"><div><h4>${esc(t('r.strengths'))}</h4>${strengths ? `<ul class="pill-list">${strengths}</ul>` : `<p>${esc(t('r.noStrengths'))}</p>`}</div>
      <div><h4>${esc(t('r.weak'))}</h4>${weak ? `<ul class="pill-list bad">${weak}</ul>` : `<p>${esc(t('r.noWeak'))}</p>`}</div></section>
    <section class="rep-sec"><h4>${esc(t('r.issues'))}</h4>${r.issues.length ? prioBar : ''}${issuesHtml}</section>
    <section class="rep-sec"><h4>${esc(t('cat.design'))}</h4>${r.screenshot && /^data:image\/(jpeg|png|webp);base64,/.test(r.screenshot) ? `<img class="shot" src="${r.screenshot}" alt="${esc(t('r.shot'))}"><p class="rep-note" style="text-align:center">${esc(t('r.shot'))}</p>` : ''}<p class="rep-note">${esc(t('r.designNote'))}</p></section>
    <section class="rep-sec help"><h4>${esc(t('r.helpT'))}</h4><p>${esc(t('r.helpP'))}</p>
      ${svcs.length ? `<p style="margin-top:14px">${esc(t('r.helpSvc'))} <b>${svcs.map(k => esc(t(k))).join(' · ')}</b></p>` : ''}
      <div class="cta-row"><button class="btn btn-red" data-open="consult" data-track="report_consult">${esc(t('r.helpBook'))}</button><button class="btn btn-ghost" data-open="quote" data-service="redesign" data-track="report_quote">${esc(t('r.helpQuote'))}</button></div></section>
    <section class="rep-sec">${emailLine}<div class="rep-actions"><button class="btn btn-ghost" data-print>${esc(t('r.print'))}</button><button class="btn btn-ghost" data-again>${esc(t('r.again'))}</button></div>
      <p class="rep-src" style="margin-top:16px">${esc(t('r.sources', { v: r.lighthouseVersion || '—' }))}</p></section>
  </article>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    box.querySelectorAll('.trk i').forEach(i => (i.style.width = i.dataset.w + '%'));
    const arc = box.querySelector('.arc'); if (arc) arc.style.strokeDashoffset = arc.dataset.off;
  }));
  box.querySelector('[data-print]')?.addEventListener('click', () => { try { window.print(); } catch { /* print blocked */ } });
  bindAgain();
}
function bindAgain() {
  $('#report [data-again]')?.addEventListener('click', () => { lastReport = null; $('#reportShell').hidden = true; $('#auditForm input[name=website]').value = ''; $('#audit').scrollIntoView({ behavior: 'smooth' }); });
}

// ───────── boot ─────────
initContact(); initNav(); initForms(); initAudit(); initAnalytics();
const saved = store.get('cr_lang');
const browser = (navigator.language || 'en').slice(0, 2);
setLang(saved || (LANGS.includes(browser) ? browser : 'en')).then(initMotion);
const hide = () => $('#loader')?.classList.add('done');
if (document.readyState === 'complete') setTimeout(hide, 500); else addEventListener('load', () => setTimeout(hide, 350));
setTimeout(hide, 2500); // never block content
// Warm the other languages so switching is instant.
(window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => LANGS.forEach(l => loadDict(l).catch(() => {})));
}

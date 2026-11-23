// Offline tests: HTML analysis, report scoring, lead validation, SSRF guard.
import assert from 'node:assert/strict';
import { analyzeHtml, normalizeUrl, inspect } from '../lib/inspect.js';
import { validateLead } from '../lib/lead.js';
import { buildReport } from '../public/js/audit-core.js';

let pass = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('✓', name); }).catch(e => { console.error('✗', name, '\n ', e.message); process.exitCode = 1; });

const goodHtml = `<!doctype html><html lang="en"><head><title>Smith Dental — Family Dentist in Austin</title>
<meta name="description" content="Friendly family dentistry in Austin. Transparent prices, same-week appointments and gentle care for every age.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://smith.example/"><link rel="icon" href="/f.ico">
<meta property="og:title" content="Smith Dental"><meta property="og:image" content="https://smith.example/og.jpg">
<script type="application/ld+json">{"@type":"Dentist"}</script></head><body><nav><a href="/">Home</a><a href="/services">Services</a><a href="/about">About</a><a href="/prices">Prices</a><a href="/contact">Contact</a></nav>
<h1>Gentle dentistry</h1><h2>Services</h2><h2>Reviews</h2><p>${'word '.repeat(400)} Read our patient reviews and 5 star ratings.</p>
<a href="/book">Book an appointment</a><a href="tel:+15551234">Call us</a><button>Get a quote</button><form><input type="submit" value="Request appointment"></form>
<img src="a.jpg" alt="Clinic"><img src="b.jpg"></body></html>`;
const badHtml = `<html><head></head><body><div>Welcome</div><img src="http://x.example/a.jpg"><script src="http://x.example/a.js"></script></body></html>`;

const psi = (perf, a11y, seo, bp, extra = {}) => ({
  lighthouseVersion: '12.2.1',
  categories: {
    performance: { score: perf, auditRefs: [{ id: 'largest-contentful-paint', weight: 25, group: 'metrics' }, { id: 'render-blocking-resources', weight: 0 }] },
    accessibility: { score: a11y, auditRefs: [{ id: 'color-contrast', weight: 7 }, { id: 'image-alt', weight: 10 }] },
    seo: { score: seo, auditRefs: [{ id: 'link-text', weight: 1 }] },
    'best-practices': { score: bp, auditRefs: [] }
  },
  audits: {
    'largest-contentful-paint': { numericValue: extra.lcp ?? 1900, score: 0.9, scoreDisplayMode: 'numeric' },
    'first-contentful-paint': { numericValue: 1200 }, 'total-blocking-time': { numericValue: extra.tbt ?? 90 },
    'cumulative-layout-shift': { numericValue: extra.cls ?? 0.02 }, 'speed-index': { numericValue: 2500 },
    'render-blocking-resources': { title: 'Eliminate render-blocking resources', score: 0.3, details: { overallSavingsMs: 1800 } },
    'color-contrast': { id: 'color-contrast', title: 'Background and foreground colors do not have a sufficient contrast ratio.', score: 0, scoreDisplayMode: 'binary' },
    'image-alt': { id: 'image-alt', title: 'Image elements have [alt] attributes', score: 1, scoreDisplayMode: 'binary' },
    'link-text': { id: 'link-text', title: 'Links do not have descriptive text', score: 0, scoreDisplayMode: 'binary' },
    viewport: { id: 'viewport', title: 'Has a viewport meta tag', score: extra.vp ?? 1 },
    'is-on-https': { score: 1 },
    'final-screenshot': { details: { data: 'data:image/jpeg;base64,AAAA' } }
  }
});

await ok('analyzeHtml extracts real signals', () => {
  const h = analyzeHtml(goodHtml, new URL('https://smith.example/'));
  assert.equal(h.title, 'Smith Dental — Family Dentist in Austin');
  assert.equal(h.h1Count, 1); assert.equal(h.h2Count, 2);
  assert.ok(h.structuredData); assert.ok(h.navPresent); assert.ok(h.favicon);
  assert.equal(h.telLinks, 1); assert.equal(h.forms, 1); assert.equal(h.imgNoAlt, 1);
  assert.ok(h.ctaCount >= 3, 'ctas ' + h.ctaSamples); assert.ok(h.trustSignals); assert.ok(h.wordCount > 400);
  assert.equal(h.internalLinks >= 5, true); assert.equal(h.mixedContent, 0);
});

await ok('analyzeHtml flags a weak page', () => {
  const h = analyzeHtml(badHtml, new URL('https://x.example/'));
  assert.equal(h.title, null); assert.equal(h.viewport, null); assert.equal(h.h1Count, 0);
  assert.equal(h.ctaCount, 0); assert.equal(h.mixedContent, 2); assert.equal(h.lang, null);
});

const page = (html, extra = {}) => ({ finalUrl: 'https://smith.example/', https: true, httpRedirectsToHttps: true, firstByteMs: 300, frameProtected: true,
  headers: { hsts: 'max-age=1', csp: "default-src 'self'", xcto: 'nosniff', referrer: 'same-origin' }, html: analyzeHtml(html, new URL('https://smith.example/')), ...extra });

await ok('strong site scores high with real data from both sources', () => {
  const r = buildReport({ url: 'https://smith.example/', mobile: psi(0.95, 0.92, 0.95, 0.96), desktop: psi(0.99, 0.92, 0.95, 0.96), page: page(goodHtml) });
  assert.ok(r.overall >= 80, 'overall ' + r.overall);
  assert.equal(r.categories.find(c => c.id === 'design').score, null);
  assert.equal(r.categories.find(c => c.id === 'performance').score, 95);
  assert.equal(r.categories.find(c => c.id === 'security').score, 100);
  assert.equal(r.scoredCount, 9); assert.equal(r.desktopPerf, 99);
  assert.ok(r.strengths.some(s => s.id === 's_https'));
  assert.ok(!r.issues.some(i => i.pr === 'critical'));
});

await ok('weak site gets critical issues, sorted by priority', () => {
  const r = buildReport({ url: 'http://x.example/', mobile: psi(0.32, 0.6, 0.5, 0.7, { lcp: 6200, cls: 0.31, tbt: 900, vp: 0 }), page: page(badHtml, { https: false, httpRedirectsToHttps: false, headers: {}, frameProtected: false }) });
  const ids = r.issues.map(i => i.id);
  for (const id of ['perf_poor', 'lcp_slow', 'no_https', 'no_title', 'no_cta', 'no_viewport', 'no_h1', 'thin_content']) assert.ok(ids.includes(id), 'missing ' + id);
  assert.equal(r.issues[0].pr, 'critical');
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  for (let i = 1; i < r.issues.length; i++) assert.ok(order[r.issues[i - 1].pr] <= order[r.issues[i].pr]);
  assert.ok(r.overall < 50, 'overall ' + r.overall);
  assert.ok(r.issues.some(i => i.id === 'opp'));
});

await ok('no fabricated scores when sources fail', () => {
  const r = buildReport({ url: 'https://smith.example/', mobile: null, page: page(goodHtml), errors: { psi: 'psi_quota' } });
  for (const id of ['performance', 'accessibility']) { const c = r.categories.find(c => c.id === id); assert.equal(c.score, null); assert.equal(c.reason, 'psi_quota'); }
  assert.equal(r.metrics, null); assert.equal(r.screenshot, null);
  assert.equal(r.categories.find(c => c.id === 'seo').partial, true);
  const r2 = buildReport({ url: 'https://smith.example/', mobile: psi(0.8, 0.8, 0.8, 0.8), page: null, errors: { inspect: 'backend_missing' } });
  for (const id of ['cta', 'conversion', 'content']) assert.equal(r2.categories.find(c => c.id === id).score, null);
  assert.equal(r2.categories.find(c => c.id === 'security').partial, true);
});

await ok('lead validation: honeypot, timing, email, lengths', () => {
  assert.ok(validateLead({ type: 'contact', email: 'a@b.co', name: 'A', hp_field: 'x' }).spam);
  assert.ok(validateLead({ type: 'contact', email: 'a@b.co', name: 'A', t: Date.now() }).spam);
  assert.equal(validateLead({ type: 'contact', email: 'nope', name: 'A' }).error, 'invalid_email');
  assert.equal(validateLead({ type: 'hack', email: 'a@b.co' }).error, 'invalid_type');
  assert.equal(validateLead({ type: 'audit', email: 'a@b.co', name: 'A' }).error, 'missing_website');
  const v = validateLead({ type: 'quote', email: 'a@b.co', name: 'x'.repeat(500), t: Date.now() - 10000 });
  assert.equal(v.lead.name.length, 120);
});

await ok('SSRF guard blocks private targets', async () => {
  assert.throws(() => normalizeUrl('ftp://x.com'), /invalid_url/);
  assert.throws(() => normalizeUrl('http://localhost'), /invalid_url/);
  assert.throws(() => normalizeUrl('https://x.com:8080'), /blocked_port/);
  for (const u of ['http://127.0.0.1', 'http://10.1.2.3', 'http://169.254.169.254/latest', 'http://192.168.0.1']) await assert.rejects(inspect(u), /blocked_host/);
});

console.log(`\n${pass} passed`);

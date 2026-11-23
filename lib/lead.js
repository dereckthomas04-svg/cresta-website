// Lead intake: validates, filters spam, and delivers submissions through
// whichever channels are configured (Resend email, webhook, local file).
// It reports exactly which channels succeeded, so the UI never claims a
// message was sent when it wasn't.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const TYPES = ['contact', 'audit', 'quote', 'consult', 'newsletter'];
const LIMITS = { name: 120, email: 200, business: 160, website: 300, phone: 40, message: 4000, service: 80, budget: 60, timeline: 60, date: 40, lang: 5 };
const EMAIL_RE = /^[^\s@<>()[\]\\,;:]+@[^\s@<>()[\]\\,;:]+\.[a-z]{2,}$/i;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function validateLead(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid' };
  if (body.hp_field) return { spam: true };                         // honeypot filled
  if (typeof body.t === 'number' && Date.now() - body.t < 2500) return { spam: true }; // submitted too fast
  const type = TYPES.includes(body.type) ? body.type : null;
  if (!type) return { error: 'invalid_type' };
  const lead = { type };
  for (const [k, max] of Object.entries(LIMITS)) {
    if (body[k] == null || body[k] === '') continue;
    lead[k] = String(body[k]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  }
  if (!lead.email || !EMAIL_RE.test(lead.email)) return { error: 'invalid_email' };
  if (type !== 'newsletter' && !lead.name) return { error: 'missing_name' };
  if (type === 'audit' && !lead.website) return { error: 'missing_website' };
  lead.consent = !!body.consent;
  lead.sendCopy = !!body.sendCopy;
  // Optional audit summary (structured data only; escaped when rendered).
  if (type === 'audit' && body.report && typeof body.report === 'object') {
    const r = body.report;
    lead.report = {
      url: String(r.url || '').slice(0, 300),
      overall: Number.isFinite(r.overall) ? Math.round(r.overall) : null,
      categories: (Array.isArray(r.categories) ? r.categories : []).slice(0, 12).map(c => ({
        name: String(c.name || '').slice(0, 60), score: Number.isFinite(c.score) ? Math.round(c.score) : null, note: String(c.note || '').slice(0, 80) })),
      issues: (Array.isArray(r.issues) ? r.issues : []).slice(0, 25).map(i => ({
        priority: String(i.priority || '').slice(0, 20), title: String(i.title || '').slice(0, 200), fix: String(i.fix || '').slice(0, 400) })),
      labels: r.labels && typeof r.labels === 'object' ? Object.fromEntries(Object.entries(r.labels).slice(0, 10).map(([k, v]) => [k, String(v).slice(0, 200)])) : {}
    };
  }
  lead.receivedAt = new Date().toISOString();
  return { lead };
}

function leadHtml(lead) {
  const rows = Object.entries(lead).filter(([k]) => !['report'].includes(k))
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('');
  return `<h2 style="font-family:sans-serif">New ${esc(lead.type)} lead</h2><table style="font-family:sans-serif;font-size:14px">${rows}</table>${lead.report ? reportHtml(lead.report) : ''}`;
}

export function reportHtml(r) {
  const L = r.labels || {};
  const cats = r.categories.map(c => `<tr><td style="padding:6px 16px 6px 0">${esc(c.name)}</td><td style="padding:6px 0;font-weight:700">${c.score == null ? esc(c.note || '—') : esc(c.score) + '/100'}</td></tr>`).join('');
  const issues = r.issues.map(i => `<li style="margin:0 0 10px"><b style="color:#1c1d20">${esc(i.priority)}</b> — ${esc(i.title)}<br><span style="color:#444">${esc(i.fix)}</span></li>`).join('');
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111">
<div style="background:#222326;color:#fff;padding:28px 28px 22px"><div style="letter-spacing:.08em;font-size:12px;color:#b4b6bb">CRESTA AGENCY</div>
<h1 style="margin:8px 0 4px;font-size:24px">${esc(L.title || 'Website audit')}</h1><div style="color:#bbb;font-size:14px">${esc(r.url)}</div>
<div style="font-size:56px;font-weight:800;margin-top:14px">${r.overall ?? '—'}<span style="font-size:20px;color:#999">/100</span></div></div>
<div style="padding:24px 28px;border:1px solid #eee"><h2 style="font-size:16px">${esc(L.categories || 'Category scores')}</h2><table style="font-size:14px">${cats}</table>
<h2 style="font-size:16px;margin-top:24px">${esc(L.issues || 'Issues and fixes')}</h2><ul style="padding-left:18px;font-size:14px">${issues}</ul>
<p style="font-size:14px;color:#444">${esc(L.cta || '')}</p></div></div>`;
}

// Sender: FROM_EMAIL may be a bare address ("hello@site.com") or "Name <hello@site.com>".
// If it's missing, Resend's shared test sender is used (delivers only to your own Resend account email).
function sender() {
  const raw = (process.env.FROM_EMAIL || 'onboarding@resend.dev').trim();
  return raw.includes('<') ? raw : `Cresta Agency <${raw}>`;
}

async function sendResend({ to, subject, html, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: sender(), to: [to], subject, html, reply_to: replyTo })
  });
  if (!res.ok) throw new Error('email_failed_' + res.status);
}

export async function deliverLead(lead, { allowFile = false } = {}) {
  const delivered = []; const failed = [];
  const env = process.env;
  if (env.RESEND_API_KEY && env.LEADS_TO_EMAIL) {
    try {
      await sendResend({ to: env.LEADS_TO_EMAIL, subject: `New ${lead.type} lead: ${lead.business || lead.name || lead.email}`, html: leadHtml(lead), replyTo: lead.email });
      delivered.push('email');
    } catch { failed.push('email'); }
  }
  if (env.LEADS_WEBHOOK_URL) {
    try {
      const r = await fetch(env.LEADS_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lead) });
      r.ok ? delivered.push('webhook') : failed.push('webhook');
    } catch { failed.push('webhook'); }
  }
  if (allowFile) {
    try {
      const dir = path.resolve(env.LEADS_DIR || 'data');
      await mkdir(dir, { recursive: true });
      await appendFile(path.join(dir, 'leads.jsonl'), JSON.stringify(lead) + '\n');
      delivered.push('file');
    } catch { failed.push('file'); }
  }
  // Copy of the audit report to the customer, only when they asked for it.
  let emailedCopy = false;
  if (lead.type === 'audit' && lead.sendCopy && lead.report && env.RESEND_API_KEY) {
    try {
      await sendResend({ to: lead.email, subject: lead.report.labels?.subject || 'Your website audit', html: reportHtml(lead.report), replyTo: env.LEADS_TO_EMAIL });
      emailedCopy = true;
    } catch { /* reported as not emailed */ }
  }
  return { delivered, failed, emailedCopy, emailCapable: !!env.RESEND_API_KEY };
}

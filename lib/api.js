// Platform-neutral API handlers used by server.js and the Netlify functions.
import { inspect } from './inspect.js';
import { validateLead, deliverLead } from './lead.js';

const buckets = new Map(); // best-effort in-memory rate limiting per instance
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  list.push(now); buckets.set(key, list);
  if (buckets.size > 5000) buckets.clear();
  return list.length > max;
}

const ERR_STATUS = { invalid_url: 400, blocked_port: 400, blocked_host: 400, dns_failed: 422, timeout: 504, fetch_failed: 502, invalid_redirect: 502, too_many_redirects: 502 };

export async function handleInspect(body, ip) {
  if (limited('i:' + ip, 20, 10 * 60_000)) return { status: 429, json: { ok: false, error: 'rate_limited' } };
  try {
    const data = await inspect(body?.url);
    return { status: 200, json: { ok: true, data } };
  } catch (e) {
    const code = e.message in ERR_STATUS ? e.message : 'fetch_failed';
    return { status: ERR_STATUS[code], json: { ok: false, error: code } };
  }
}

export async function handleLead(body, ip, opts = {}) {
  if (limited('l:' + ip, 8, 10 * 60_000)) return { status: 429, json: { ok: false, error: 'rate_limited' } };
  const v = validateLead(body);
  if (v.spam) return { status: 200, json: { ok: true, delivered: [] } }; // silently drop bots
  if (v.error) return { status: 400, json: { ok: false, error: v.error } };
  const r = await deliverLead(v.lead, opts);
  if (!r.delivered.length) return { status: 503, json: { ok: false, error: r.failed.length ? 'delivery_failed' : 'not_configured', emailCapable: r.emailCapable } };
  return { status: 200, json: { ok: true, ...r } };
}

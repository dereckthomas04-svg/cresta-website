import { handleInspect } from '../../lib/api.js';

export default async (req, context) => {
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'method' }, { status: 405 });
  let body; try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'bad_json' }, { status: 400 }); }
  const out = await handleInspect(body, context.ip || 'unknown');
  return Response.json(out.json, { status: out.status, headers: { 'cache-control': 'no-store' } });
};

export const config = { path: '/api/inspect' };

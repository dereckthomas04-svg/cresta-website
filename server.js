// Zero-dependency Node server: serves /public and the API.
//   node server.js            → http://localhost:8080
// Environment variables: see .env.example (loaded automatically if present).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleInspect, handleLead } from './lib/api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, 'public');

if (existsSync(path.join(root, '.env'))) {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self' https://www.googletagmanager.com https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://www.googleapis.com https://www.google-analytics.com https://*.google-analytics.com https://plausible.io; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 200_000) throw new Error('too_large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'POST') return send(res, 405, JSON.stringify({ ok: false, error: 'method' }), { 'content-type': 'application/json' });
    let body; try { body = await readJson(req); } catch { return send(res, 400, '{"ok":false,"error":"bad_json"}', { 'content-type': 'application/json' }); }
    const handler = url.pathname === '/api/inspect' ? handleInspect : url.pathname === '/api/lead' ? (b, i) => handleLead(b, i, { allowFile: true }) : null;
    if (!handler) return send(res, 404, '{"ok":false}', { 'content-type': 'application/json' });
    const out = await handler(body, ip);
    return send(res, out.status, JSON.stringify(out.json), { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(pub, p));
  if (!file.startsWith(pub)) return send(res, 403, 'Forbidden');
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    const ext = path.extname(file);
    send(res, 200, await readFile(file), { 'content-type': TYPES[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
  } catch {
    send(res, 404, await readFile(path.join(pub, '404.html')).catch(() => 'Not found'), { 'content-type': 'text/html; charset=utf-8' });
  }
});

const port = Number(process.env.PORT) || 8080;
server.listen(port, () => console.log(`Cresta site running at http://localhost:${port}`));

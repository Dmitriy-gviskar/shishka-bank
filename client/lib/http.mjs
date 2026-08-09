// Шишка Банк — разделяемый HTTP-слой: security-заголовки, статика, обработка API-ошибок.
// Используется обоими серверами (SQLite dev и PG prod) — устраняет дублирование.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const MIME = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.webm':'audio/webm' };

export const SEC = [
  ['Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'"],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Access-Control-Allow-Origin', 'https://elka-kvest-2026.ru'],
  ['Access-Control-Allow-Headers', 'Content-Type, x-child-code, x-parent-pin, x-device-token'],
];

export const MAX_BODY = 10 * 1024 * 1024;

// ── Статика: возвращает [status, body, headers?] ──
export async function serveStatic(pathname, dir) {
  let p = pathname === '/' ? '/landing.html' : pathname;  // корень — витрина; приложение: index.html / link.html
  if (p.includes('..')) return [403, 'forbidden'];
  const ext = extname(p);
  if (!MIME[ext] || /server|\.env|\.sql|package/.test(p)) return [404, 'not found'];
  try {
    const data = await readFile(join(dir, p));
    const h = { 'Content-Type': MIME[ext] };
    if (p.startsWith('/assets/')) h['Cache-Control'] = 'public, max-age=2592000, immutable';
    return [200, data, h];
  } catch { return [404, 'not found']; }
}

// ── Чтение тела POST с лимитом ──
export async function readBody(req, res) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) { res.writeHead(413); res.end('{"error":"фото слишком большое"}'); return null; }
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

// ── Отправка JSON-ответа ──
export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ── Structured error log ──
export function logError(route, ip, e) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), route, ip, error: e.message || e.msg || String(e) }));
}

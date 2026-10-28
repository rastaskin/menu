/* Ядро релея «Меню». Без Cloudflare: его гоняют node-тесты (tests/relay.test.mjs) и подделка релея в e2e.
   Релей знает только адрес семьи fid, непрозрачные имена записей k и шифр ct. Расшифровать ничего не может. */
export const LIMITS = { body: 512 * 1024, item: 64 * 1024, items: 100000, bytes: 50 * 1024 * 1024, page: 500 };
const HEX64 = /^[0-9a-f]{64}$/;
const CT = /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/;

export function allowedOrigin(origin, env) {
  const list = String((env && env.ALLOWED_ORIGINS) || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : '';
}
export function cors(origin, env) {
  const o = allowedOrigin(origin, env);
  return o ? {
    'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin'
  } : { Vary: 'Origin' };
}
export function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {})
  });
}
/* /v1/<fid>/<op> → {fid, op} или null */
export function route(url) {
  const m = new URL(url).pathname.match(/^\/v1\/([0-9a-f]{32})\/(push|pull|close)$/);
  return m ? { fid: m[1], op: m[2] } : null;
}
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* Запрос к одной семье. store: {getAuth, setAuth, put(k, ct) → seq, drop(k), since(seq, n) → [{k, ct, seq}], count, size, last,
   closed() → закрыта ли, close() — стереть все записи и закрыть, claim?(fid) → можно ли завести новую семью}.
   Пропуск семьи закрепляется первой записью: релей хранит только SHA-256 от него.
   close — смена ключа семьи: записи под старым ключом стираются, дальше на любой запрос с этим пропуском — 410 gone. */
export async function handleFamily(req, store, op, fid) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (token.length < 32 || token.length > 128) return json({ error: 'auth' }, 401);
  const h = await sha256hex(token), have = await store.getAuth();
  if (have && !same(have, h)) return json({ error: 'auth' }, 403);
  if (have && await store.closed()) return json({ error: 'gone' }, 410);
  if (op === 'close') {
    if (!have) return json({ error: 'none' }, 404);
    await store.close();
    return json({ closed: true });
  }

  if (op === 'pull') {
    if (!have) return json({ items: [], seq: 0, more: false, last: 0 });
    const q = new URL(req.url).searchParams;
    const since = Math.max(0, parseInt(q.get('since') || '0', 10) || 0);
    const limit = Math.min(LIMITS.page, Math.max(1, parseInt(q.get('limit') || String(LIMITS.page), 10) || LIMITS.page));
    const items = await store.since(since, limit + 1), more = items.length > limit;
    if (more) items.length = limit;
    return json({ items, seq: items.length ? items[items.length - 1].seq : since, more, last: await store.last() });
  }

  if (+(req.headers.get('Content-Length') || 0) > LIMITS.body) return json({ error: 'too_large' }, 413);
  const text = await req.text();
  if (text.length > LIMITS.body) return json({ error: 'too_large' }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'json' }, 400); }
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length || items.length > LIMITS.page) return json({ error: 'items' }, 400);
  /* элемент — запись {k, ct} или просьба стереть старую пометку об удалении {k, drop: true} */
  for (const it of items) {
    if (!it || !HEX64.test(it.k)) return json({ error: 'item' }, 400);
    if (it.drop === true) continue;
    if (typeof it.ct !== 'string' || it.ct.length > LIMITS.item || !CT.test(it.ct)) return json({ error: 'item' }, 400);
  }
  const bytes = items.reduce((n, it) => n + (it.drop ? 0 : it.k.length + it.ct.length), 0);
  if ((await store.count()) + items.length > LIMITS.items || (await store.size()) + bytes > LIMITS.bytes) return json({ error: 'full' }, 507);
  if (!have) {
    if (store.claim && !(await store.claim(fid))) return json({ error: 'closed' }, 503);   // новых семей сейчас не принимаем
    await store.setAuth(h);
  }
  let seq = 0;
  for (const it of items) { if (it.drop) await store.drop(it.k); else seq = await store.put(it.k, it.ct); }
  return json({ seq });
}

/* Хранилище в памяти — для тестов и подделки релея в e2e. */
export function memoryStore(claim) {
  let auth = '', seq = 0, shut = false; const rows = new Map();
  return {
    getAuth: async () => auth, setAuth: async (h) => { auth = h; },
    closed: async () => shut, close: async () => { rows.clear(); shut = true; },
    put: async (k, ct) => { seq++; rows.set(k, { k, ct, seq }); return seq; },
    drop: async (k) => { rows.delete(k); },
    since: async (s, n) => [...rows.values()].filter((r) => r.seq > s).sort((a, b) => a.seq - b.seq).slice(0, n),
    count: async () => rows.size, last: async () => seq,
    size: async () => [...rows.values()].reduce((n, r) => n + r.k.length + r.ct.length, 0),
    claim
  };
}

/* Реестр новых семей: не больше max всего и perDay за сутки (UTC). Семьи, заведённые до реестра, в нём не числятся.
   db: {has(fid), total(), onDay(day), add(fid, day)}. Повторная заявка той же семьи проходит. */
export async function claimFamily(db, fid, day, max, perDay) {
  if (await db.has(fid)) return true;
  if ((await db.total()) >= max || (await db.onDay(day)) >= perDay) return false;
  await db.add(fid, day);
  return true;
}
export function memoryRegistry() {
  const m = new Map();
  return {
    has: async (fid) => m.has(fid), total: async () => m.size,
    onDay: async (day) => [...m.values()].filter((d) => d === day).length, add: async (fid, day) => { m.set(fid, day); }
  };
}

/* Маршрутизатор: CORS, адрес, метод, частота запросов с одного адреса (env.LIMITER — Rate Limiting Cloudflare);
   запрос семьи — в её хранилище. family(fid, req, op) → Response */
export async function handle(req, env, family) {
  const origin = req.headers.get('Origin') || '', ch = cors(origin, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: allowedOrigin(origin, env) ? 204 : 403, headers: ch });
  const r = route(req.url);
  if (!r) return json({ error: 'not_found' }, 404, ch);
  if (env && env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: req.headers.get('CF-Connecting-IP') || 'anon' });
    if (!success) return json({ error: 'rate' }, 429, Object.assign({ 'Retry-After': '60' }, ch));
  }
  if ((r.op !== 'pull' && req.method !== 'POST') || (r.op === 'pull' && req.method !== 'GET')) return json({ error: 'method' }, 405, ch);
  if (origin && !allowedOrigin(origin, env)) return json({ error: 'origin' }, 403, ch);
  const res = await family(r.fid, req, r.op);
  const out = new Response(res.body, res);
  Object.entries(ch).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

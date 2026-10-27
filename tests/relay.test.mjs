import test from 'node:test';
import assert from 'node:assert';
import { handle, handleFamily, memoryStore, memoryRegistry, claimFamily, LIMITS } from '../relay/src/core.js';

const ENV = { ALLOWED_ORIGINS: 'https://app.example' };
const FID = 'a'.repeat(32), TOKEN = 'b'.repeat(43), K = (n) => n.toString(16).padStart(64, '0');
const CT = 'v1.AAAA.BBBB';

function relay() {
  const stores = new Map();
  const family = (fid, req, op) => { if (!stores.has(fid)) stores.set(fid, memoryStore()); return handleFamily(req, stores.get(fid), op); };
  return (path, init = {}) => handle(new Request('https://relay.example' + path, init), ENV, family);
}
const auth = (t = TOKEN) => ({ Authorization: 'Bearer ' + t, Origin: 'https://app.example' });
const push = (r, items, t) => r(`/v1/${FID}/push`, { method: 'POST', headers: { ...auth(t), 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });

test('релей: запись и выдача по seq, постранично', async () => {
  const r = relay();
  assert.equal((await push(r, [{ k: K(1), ct: CT }, { k: K(2), ct: CT }])).status, 200);
  assert.equal((await push(r, [{ k: K(1), ct: 'v1.CCCC.DDDD' }])).status, 200);
  const all = await (await r(`/v1/${FID}/pull?since=0`, { headers: auth() })).json();
  assert.deepEqual(all.items.map((i) => [i.k, i.seq]), [[K(2), 2], [K(1), 3]]);
  assert.equal(all.items[1].ct, 'v1.CCCC.DDDD');
  const page = await (await r(`/v1/${FID}/pull?since=0&limit=1`, { headers: auth() })).json();
  assert.equal(page.items.length, 1); assert.equal(page.more, true); assert.equal(page.last, 3);
  const after = await (await r(`/v1/${FID}/pull?since=3`, { headers: auth() })).json();
  assert.deepEqual(after.items, []);
});

test('релей: чужой пропуск не читает и не пишет', async () => {
  const r = relay();
  await push(r, [{ k: K(1), ct: CT }]);
  assert.equal((await r(`/v1/${FID}/pull?since=0`, { headers: auth('c'.repeat(43)) })).status, 403);
  assert.equal((await push(r, [{ k: K(2), ct: CT }], 'c'.repeat(43))).status, 403);
  assert.equal((await r(`/v1/${FID}/pull`, { headers: { Origin: 'https://app.example' } })).status, 401);
});

test('релей: проверка входа и CORS', async () => {
  const r = relay();
  assert.equal((await push(r, [{ k: 'xyz', ct: CT }])).status, 400);
  assert.equal((await push(r, [{ k: K(1), ct: '<script>' }])).status, 400);
  assert.equal((await push(r, [{ k: K(1), ct: 'v1.' + 'A'.repeat(LIMITS.item) + '.B' }])).status, 400);
  assert.equal((await r('/v1/zz/pull', { headers: auth() })).status, 404);
  assert.equal((await r(`/v1/${FID}/pull`, { headers: { ...auth(), Origin: 'https://evil.example' } })).status, 403);
  const pre = await r(`/v1/${FID}/push`, { method: 'OPTIONS', headers: { Origin: 'https://app.example' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  assert.equal((await r(`/v1/${FID}/push`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('релей: частота запросов, предел новых семей и размера', async () => {
  // частота: LIMITER Cloudflare отказал — 429 с CORS
  const store = memoryStore(), fam = (fid, req, op) => handleFamily(req, store, op, fid);
  const limited = { ...ENV, LIMITER: { limit: async () => ({ success: false }) } };
  const r429 = await handle(new Request(`https://relay.example/v1/${FID}/pull`, { headers: auth() }), limited, fam);
  assert.equal(r429.status, 429); assert.equal(r429.headers.get('Access-Control-Allow-Origin'), 'https://app.example');

  // новые семьи: реестр на 1 семью — вторая получает 503, уже заведённая пишет дальше
  const reg = memoryRegistry(), claim = (fid) => claimFamily(reg, fid, '2026-10-27', 1, 5);
  const stores = new Map(), family = (fid, req, op) => { if (!stores.has(fid)) stores.set(fid, memoryStore(claim)); return handleFamily(req, stores.get(fid), op, fid); };
  const send = (fid) => handle(new Request(`https://relay.example/v1/${fid}/push`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ k: K(1), ct: CT }] }) }), ENV, family);
  assert.equal((await send(FID)).status, 200);
  assert.equal((await send('c'.repeat(32))).status, 503);
  assert.equal((await send(FID)).status, 200, 'своя семья не упирается в предел новых');
  assert.equal(await claimFamily(memoryRegistry(), FID, 'd', 50, 0), false, 'предел за сутки');

  // размер: семья не может занять больше LIMITS.bytes
  const big = memoryStore(); big.size = async () => LIMITS.bytes;
  const full = await handleFamily(new Request(`https://relay.example/v1/${FID}/push`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ k: K(1), ct: CT }] }) }), big, 'push', FID);
  assert.equal(full.status, 507);
});

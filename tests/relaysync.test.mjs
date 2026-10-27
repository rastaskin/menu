import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { handle, handleFamily, memoryStore } from '../relay/src/core.js';
const require = createRequire(import.meta.url);
const M = require('../web/model.js'), F = require('../web/family.js'), R = require('../web/relay.js');
const seed = require('../tools/seed.json');

/* релей в памяти; fetch как у устройства; snoop — что видел сервер */
function fakeRelay() {
  const stores = new Map(), seen = [];
  const env = { ALLOWED_ORIGINS: '' };
  const fetch = async (url, init = {}) => {
    if (init.body) seen.push(init.body);
    return handle(new Request(url, init), env, (fid, req, op) => { if (!stores.has(fid)) stores.set(fid, memoryStore()); return handleFamily(req, stores.get(fid), op); });
  };
  return { fetch, seen };
}
function device(relay, keys, S0) {
  const d = { S: M.normalize(S0 || {}), sent: {}, seq: 0 };
  d.sync = async () => {
    const r = await R.run({ fetch: relay.fetch, url: 'https://relay.example', keys, get: () => d.S, persist: async (S) => { d.S = S; }, sent: d.sent, seq: d.seq });
    d.sent = r.sent; d.seq = r.seq; r.dropped.forEach((k) => { delete d.S.tomb[k]; }); return r;
  };
  return d;
}

test('релей: два устройства сходятся, сервер видит только шифр', async () => {
  const relay = fakeRelay(), keys = await F.derive(F.newRoot());
  const A = device(relay, keys, seed), B = device(relay, keys);
  const first = await A.sync();
  assert.ok(first.pushed > 50);
  await B.sync();
  assert.ok(M.equal(A.S, B.S), 'второе устройство получило всё');
  assert.equal((await A.sync()).pushed, 0, 'повторно ничего не отправляется');
  assert.equal((await B.sync()).pushed, 0, 'полученное не отправляется обратно');

  const traffic = relay.seen.join('');
  assert.doesNotMatch(traffic, /Овсянка|"meals"|Покупки|2026-10-27/);   // в кавычках: буквы meals изредка складываются в base64 сами

  // правка на B, удаление на A — обе доходят
  M.put(B.S, 'meals', '2026-10-27/ужин', { text: 'Плов' }, Date.now() + 10);
  M.del(A.S, 'pantry', Object.keys(A.S.pantry)[0] || 'none', Date.now() + 20);
  M.put(A.S, 'family', 'f1', { name: 'Член семьи', color: 'mint' }, Date.now() + 30);
  await B.sync(); await A.sync(); await B.sync();
  assert.equal(A.S.meals['2026-10-27/ужин'].text, 'Плов');
  assert.equal(B.S.family.f1.name, 'Член семьи');
  assert.ok(M.equal(A.S, B.S));
});

test('релей: чужая семья ничего не получает', async () => {
  const relay = fakeRelay(), k1 = await F.derive(F.newRoot()), k2 = await F.derive(F.newRoot());
  const A = device(relay, k1, seed), X = device(relay, k2);
  await A.sync(); await X.sync();
  assert.equal(M.list(X.S, 'meals').length, 0);
});

test('релей: запись под чужим разделом (__proto__) отбрасывается', async () => {
  const relay = fakeRelay(), keys = await F.derive(F.newRoot());
  const bad = [await F.seal(keys, { c: '__proto__', id: 'polluted', r: { x: 1 } }), await F.seal(keys, { c: 'pantry', id: 'p1', r: { id: 'p1', name: 'Рис', _u: 5 } })];
  await relay.fetch(`https://relay.example/v1/${keys.fid}/push`, { method: 'POST', headers: { Authorization: 'Bearer ' + keys.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: bad }) });
  const A = device(relay, keys);
  await A.sync();
  assert.equal(({}).polluted, undefined);
  assert.equal(A.S.pantry.p1.name, 'Рис');
});

test('релей: пометка об удалении старше 180 дней стирается с релея и с устройства', async () => {
  const relay = fakeRelay(), keys = await F.derive(F.newRoot()), day = 86400000, T0 = Date.now() - 300 * day;
  const A = device(relay, keys);
  M.put(A.S, 'pantry', 'old', { name: 'Старое' }, T0); M.put(A.S, 'pantry', 'new', { name: 'Свежее' }, Date.now());
  await A.sync();
  M.del(A.S, 'pantry', 'old', T0 + day); M.del(A.S, 'pantry', 'new', Date.now() + 1);
  await A.sync();                                   // пометки ушли на релей
  const r = await A.sync();                         // старая уже на релее — просим стереть
  assert.deepEqual(r.dropped, ['pantry:old']);
  assert.ok(!('pantry:old' in A.S.tomb) && 'pantry:new' in A.S.tomb, 'у себя убрана только старая пометка');
  assert.equal((await A.sync()).pushed, 0, 'повторно ничего не отправляется');
  const B = device(relay, keys); await B.sync();
  assert.deepEqual(Object.keys(B.S.tomb), ['pantry:new'], 'новое устройство старую пометку не получает');
  assert.equal(Object.keys(B.S.pantry).length, 0);
});

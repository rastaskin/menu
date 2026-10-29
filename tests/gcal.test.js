const test = require('node:test');
const assert = require('node:assert');
const GC = require('../web/gcal.js');

/* поддельный Calendar API: календари и события в памяти, журнал запросов */
function fakeCal(primary) {
  const cals = {}, log = []; let n = 0;
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
  async function fx(url, init) {
    const u = new URL(url), m = init.method, p = decodeURIComponent(u.pathname.replace('/calendar/v3', ''));
    log.push(m + ' ' + p);
    if (init.headers.Authorization !== 'Bearer tok') return res(401, {});
    const body = init.body ? JSON.parse(init.body) : null;
    let r;
    if (m === 'POST' && p === '/calendars') { const id = 'cal' + (++n); cals[id] = {}; return res(200, { id, summary: body.summary }); }
    if ((r = p.match(/^\/calendars\/([^/]+)$/))) return cals[r[1]] ? res(200, { id: r[1] }) : res(404, {});
    if (p === '/calendars/primary/events') return res(200, { items: primary });
    if ((r = p.match(/^\/calendars\/([^/]+)\/events(?:\/(.+))?$/))) {
      const c = cals[r[1]]; if (!c) return res(404, {});
      if (m === 'PUT') return c[r[2]] ? (c[r[2]] = body, res(200, body)) : res(404, {});
      if (m === 'POST') { c[body.id] = body; return res(200, body); }
      if (m === 'DELETE') { if (!c[r[2]]) return res(410, {}); delete c[r[2]]; return { ok: true, status: 204, json: async () => null }; }
    }
    return res(400, {});
  }
  return { fx, cals, log };
}
const token = async () => 'tok';
const W = [
  { key: 'm:1', date: '2026-11-02', start: '08:00', summary: 'Завтрак: Омлет' },
  { key: 'm:2', date: '2026-11-02', start: '23:50', mins: 30, summary: 'Ужин поздний' },
  { key: 'c:2026-11-02', date: '2026-11-02', summary: 'Готовка: суп' }
];

test('календарь: свой календарь «Меню», события по одному id, повтор ничего не шлёт, правка — обновление, убранное — удаление', async () => {
  const f = fakeCal([]), base = { fetch: f.fx, token, from: '2026-11-01', to: '2026-11-30', tz: 'Europe/Moscow', title: 'Меню' };
  let cal = await GC.push(Object.assign({ cal: null, wanted: W }, base));
  assert.equal(cal.id, 'cal1');
  const ev = f.cals.cal1, ids = Object.keys(ev);
  assert.equal(ids.length, 3);
  assert.ok(ids.every((id) => /^[a-v0-9]{5,1024}$/.test(id)), 'id из символов base32hex');
  const om = ev[await GC.eventId('m:1')];
  assert.deepEqual(om.start, { dateTime: '2026-11-02T08:00:00', timeZone: 'Europe/Moscow' });
  assert.equal(om.end.dateTime, '2026-11-02T08:30:00');
  assert.equal(ev[await GC.eventId('m:2')].end.dateTime, '2026-11-02T23:59:00', 'не переваливает за полночь');
  assert.deepEqual(ev[await GC.eventId('c:2026-11-02')].start, { date: '2026-11-02' });
  assert.deepEqual(ev[await GC.eventId('c:2026-11-02')].end, { date: '2026-11-03' });

  f.log.length = 0;
  cal = await GC.push(Object.assign({ cal, wanted: W }, base));
  assert.deepEqual(f.log, ['GET /calendars/cal1'], 'ничего не изменилось — событий не шлём');

  const W2 = [Object.assign({}, W[0], { summary: 'Завтрак: Сырники' }), W[2], { key: 'm:9', date: '2026-10-01', start: '13:00', summary: 'Старое' }];
  cal = await GC.push(Object.assign({ cal, wanted: [...W2, W[1]] }, base, { from: '2026-09-01' }));   // старое тоже выгрузили
  f.log.length = 0;
  cal = await GC.push(Object.assign({ cal, wanted: W2.slice(0, 2) }, base));
  assert.ok(f.log.includes('DELETE /calendars/cal1/events/' + await GC.eventId('m:2')), 'убранное из меню в пределах дат — удалено');
  const old = await GC.eventId('m:9');
  assert.ok(!f.log.some((l) => l.endsWith(old)), 'прошлое за пределами выгрузки не трогаем');
  assert.ok(f.cals.cal1[old]);
  assert.equal(f.cals.cal1[await GC.eventId('m:1')].summary, 'Завтрак: Сырники');

  delete f.cals.cal1;   // календарь удалили в Google — заводится новый
  cal = await GC.push(Object.assign({ cal, wanted: W }, base));
  assert.equal(cal.id, 'cal2'); assert.equal(Object.keys(f.cals.cal2).length, 3);
});

test('календарь: события основного по дням, весь день и многодневные, без отменённых', async () => {
  const f = fakeCal([
    { status: 'confirmed', summary: 'Учёба', start: { dateTime: new Date(2026, 10, 3, 9, 0).toISOString() } },
    { status: 'confirmed', summary: 'Отпуск', start: { date: '2026-11-05' }, end: { date: '2026-11-08' } },
    { status: 'confirmed', summary: 'День рождения', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } },
    { status: 'cancelled', summary: 'Отменено', start: { date: '2026-11-04' } }
  ]);
  const out = await GC.pull({ fetch: f.fx, token, from: '2026-11-01', to: '2026-11-06' });
  assert.deepEqual(out, { '2026-11-03': ['09:00 Учёба'], '2026-11-05': ['Отпуск'], '2026-11-06': ['Отпуск'], '2026-11-04': ['День рождения'] });
});

test('календарь: нет доступа — ошибка с причиной', async () => {
  const fx = async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'insufficientPermissions' }] } }) });
  await assert.rejects(GC.push({ fetch: fx, token, cal: null, wanted: W, from: '2026-11-01', to: '2026-11-30', tz: 'UTC' }), (e) => e.status === 403 && e.reason === 'insufficientPermissions');
});

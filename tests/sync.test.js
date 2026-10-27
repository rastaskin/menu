const test = require('node:test'), assert = require('node:assert');
const M = require('../web/model.js'), SH = require('../web/sheets.js'), { fakeSheets } = require('./fake-sheets.js');
const seed = require('../tools/seed.json');

function device(fake, S0) {
  const d = { S: M.normalize(S0 || M.blank()) };
  d.sync = (now) => SH.run({ api: SH.sheetsApi(fake.fx, async () => 'tok', 'ID'), now: () => now, get: () => d.S, persist: async (x) => { d.S = M.merge(d.S, x); } });
  return d;
}

test('кодек: запись и чтение листов без потерь', () => {
  const S = M.normalize(seed);
  const data = SH.encodeAll(S, {}, 5);
  const vr = data.map((d) => ({ values: d.values }));
  const R = SH.decodeAll(vr, 999);
  assert.equal(R.rev, 5); assert.equal(R.stamped, false);
  assert.ok(M.equal(R.S, S));
});

test('даты из таблицы в формате числа и дд.мм.гггг', () => {
  assert.equal(SH.normDate(46322), '2026-10-27');
  assert.equal(SH.normDate('27.10.2026'), '2026-10-27');
});

test('первое устройство заливает меню в пустую таблицу, второе получает', async () => {
  const f = fakeSheets(); const A = device(f, seed), B = device(f);
  let r = await A.sync(2e12); assert.equal(r.uploaded, true);
  assert.ok(f.book.sheets['Меню'].length > 60);
  r = await B.sync(2e12 + 1); assert.ok(r.changed); assert.ok(M.equal(B.S, A.S));
});

test('правки с двух устройств и удаление сходятся', async () => {
  const f = fakeSheets(); const A = device(f, seed), B = device(f);
  await A.sync(1); await B.sync(2);
  M.put(A.S, 'pantry', 'p1', { name: 'Рис', qty: '2 кг', place: 'shelf' }, 3e12);
  M.put(B.S, 'shop', 'w1-01', { bought: true }, 3e12 + 5);
  M.del(B.S, 'recipes', 'r01', 3e12 + 6);
  await A.sync(3e12 + 10); await B.sync(3e12 + 11); await A.sync(3e12 + 12);
  assert.ok(M.equal(A.S, B.S));
  assert.equal(A.S.pantry.p1.qty, '2 кг'); assert.equal(A.S.shop['w1-01'].bought, true); assert.equal(A.S.recipes.r01, undefined);
});

test('правка Claude в ячейке (пустой _u) побеждает и закрепляется', async () => {
  const f = fakeSheets(); const A = device(f, seed);
  await A.sync(1);
  const rows = f.book.sheets['Меню']; const hdr = rows[0], iT = hdr.indexOf('блюдо'), iU = hdr.indexOf('_u'), iId = hdr.indexOf('id');
  const r = rows.find((x) => x[iId] === '2026-10-27/ужин'); r[iT] = 'Плов с курицей'; r[iU] = '';
  // новая строка от Claude без _u
  f.book.sheets['Дома'].push(['p-claude', 'Гречка', '1 кг', 'шкаф', '', '', '']);
  // удаление через лист «Удалено»
  f.book.sheets['Удалено'].push(['recipes:r02', '']);
  const res = await A.sync(4e12);
  assert.equal(A.S.meals['2026-10-27/ужин'].text, 'Плов с курицей');
  assert.equal(A.S.meals['2026-10-27/ужин']._u, 4e12);
  assert.equal(A.S.pantry['p-claude'].name, 'Гречка');
  assert.equal(A.S.recipes.r02, undefined);
  assert.equal(res.uploaded, true);
  const again = await A.sync(4e12 + 100); assert.ok(!again.uploaded && !again.changed);
});

test('ручная правка без смены _u тоже применяется', async () => {
  const f = fakeSheets(); const A = device(f, seed); await A.sync(1);
  const rows = f.book.sheets['Покупки'], h = rows[0];
  rows.find((x) => x[0] === 'w1-02')[h.indexOf('цена')] = 999;
  await A.sync(2); assert.equal(A.S.shop['w1-02'].price, 999);
});

test('конкурентная запись: ревизия сменилась — проход повторяется', async () => {
  const f = fakeSheets(); const A = device(f, seed), B = device(f); await A.sync(1); await B.sync(2);
  M.put(A.S, 'pantry', 'a', { name: 'Молоко' }, 5e12);
  const orig = f.fx; let once = true;
  f.book; // вмешаемся между чтением и проверкой ревизии
  const api = SH.sheetsApi(async (u, i) => {
    if (once && /values:batchGet/.test(u) && /%D0%9D%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8/.test(u) && !/%D0%9C%D0%B5%D0%BD%D1%8E/.test(u)) {
      once = false; M.put(B.S, 'pantry', 'b', { name: 'Кефир' }, 5e12 + 1); await B.sync(5e12 + 2);
    }
    return orig(u, i);
  }, async () => 't', 'ID');
  const r = await SH.run({ api, now: () => 5e12 + 3, get: () => A.S, persist: async (x) => { A.S = M.merge(A.S, x); } });
  assert.equal(r.uploaded, true); assert.ok(A.S.pantry.b && A.S.pantry.a);
  await B.sync(5e12 + 4); assert.ok(B.S.pantry.a);
});

test('ссылка на таблицу → id', () => {
  assert.equal(SH.parseSheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(SH.parseSheetId('https://rastaskin.github.io/menu/#sheet=1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(SH.parseSheetId('мусор'), '');
});

test('таблица: пометки об удалении старше 180 дней не возвращаются', () => {
  const now = Date.now(), day = 86400000, tomb = SH.SHEETS.find((s) => s.col === 'tomb');
  const vr = SH.SHEETS.map((s) => s === tomb ? { values: [['запись', '_u'], ['shop:old', now - 200 * day], ['shop:new', now - day]] } : {});
  assert.deepEqual(Object.keys(SH.decodeAll(vr, now).S.tomb), ['shop:new']);
});

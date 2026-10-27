import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), { fakeSheets } = require('../fake-sheets.js');
const M = require('../../web/model.js'), SH = require('../../web/sheets.js'), seed = require('../../tools/seed.json');
const SID = '1FakeSheetIdForTests_abcdefghijk';

async function route(ctx, fake, state) {
  await ctx.route('https://sheets.googleapis.com/**', async (rt) => {
    if (state.offline) return rt.abort('internetdisconnected');
    const q = rt.request(); const r = await fake.fx(q.url(), { method: q.method(), body: q.postData() });
    await rt.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(await r.json()) });
  });
  await ctx.route('https://accounts.google.com/**', (rt) => rt.fulfill({ status: 200, body: 'google' }));
  await ctx.addInitScript(() => { localStorage.setItem('menu.token', JSON.stringify({ v: 'tok', exp: Date.now() + 3600e3 })); });
}

test('приложение: загрузка из таблицы, правки, сохранение, второе устройство', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const fake = fakeSheets('Меню — пример');
  SH.encodeAll(M.normalize(seed), {}, 1).forEach((d) => { fake.book.sheets[d.range.match(/'(.*)'/)[1]] = d.values; });
  const browser = await chromium.launch();
  const errors = [];
  try {
    const st = { offline: false };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await route(ctx, fake, st);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '#sheet=' + SID);
    await p.click('.tabs [data-tab="menu"]');
    await p.waitForSelector('#d2026-10-27');
    await p.waitForFunction(() => /Синхр/.test(document.querySelector('[data-sync]').textContent));
    assert.equal(await p.locator('.day').count(), 7);

    // заменить ужин
    await p.click('#d2026-10-27 [data-slot="ужин"].mtxt');
    await p.fill('#modal textarea', 'Плов с курицей');
    await p.click('#modal button.btn:has-text("Сохранить")');
    assert.match(await p.textContent('#d2026-10-27'), /Плов с курицей/);
    // отметить съеденный завтрак
    await p.click('#d2026-10-27 .chk[data-slot="завтрак"]');

    // дома: добавить рис → в покупках появляется «дома»
    await p.click('.tabs [data-tab="home"]');
    await p.fill('form[data-form="pantry-add"] [name="name"]', 'Рис басмати');
    await p.fill('form[data-form="pantry-add"] [name="qty"]', '1 кг');
    await p.click('form[data-form="pantry-add"] button');
    assert.match(await p.textContent('main'), /Рис басмати/);
    await p.click('.tabs [data-tab="shop"]');
    assert.match(await p.textContent('main'), /дома: Рис басмати 1 кг/);
    await p.screenshot({ path: 'tests/e2e/shot-shop-mobile.png', fullPage: false });
    await p.click('li:has-text("Рис круглозёрный") [data-act="skip"]');
    await p.click('li:has-text("Яйца С1") [data-act="buy"]');
    await p.click('[data-act="move-home"]');

    // синхронизация в таблицу
    await p.click('[data-sync]');
    await p.waitForFunction(() => !window.__menu.SY.dirty && /Синхр/.test(document.querySelector('[data-sync]').textContent));
    const sheet = fake.book.sheets['Меню'], h = sheet[0];
    assert.equal(sheet.find((r) => r[0] === '2026-10-27/ужин')[h.indexOf('блюдо')], 'Плов с курицей');
    assert.ok(fake.book.sheets['Дома'].some((r) => r[1] === 'Рис басмати'));
    assert.ok(fake.book.sheets['Дома'].some((r) => r[1] === 'Яйца С1'));

    // сохранение при выходе: правка офлайн, перезагрузка без сети
    st.offline = true;
    await p.click('.tabs [data-tab="home"]');
    await p.fill('form[data-form="pantry-add"] [name="name"]', 'Кефир');
    await p.click('form[data-form="pantry-add"] button');
    await p.reload();
    await p.waitForSelector('.tabs');
    await p.click('.tabs [data-tab="home"]');
    assert.match(await p.textContent('main'), /Кефир/);
    st.offline = false;
    await p.evaluate(() => window.__menu.syncNow());
    await p.waitForFunction(() => !window.__menu.SY.dirty);
    assert.ok(fake.book.sheets['Дома'].some((r) => r[1] === 'Кефир'));

    // правка «Claude» прямо в таблице
    const mh = fake.book.sheets['Меню'][0];
    const row = fake.book.sheets['Меню'].find((r) => r[0] === '2026-10-28/обед'); row[mh.indexOf('блюдо')] = 'Суп от Claude'; row[mh.indexOf('_u')] = '';

    // второе устройство (ПК)
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await route(ctx2, fake, { offline: false });
    const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(base + '#sheet=' + SID);
    await p2.click('.tabs [data-tab="menu"]');
    await p2.waitForSelector('#d2026-10-27');
    await p2.waitForFunction(() => /Синхр/.test(document.querySelector('[data-sync]').textContent));
    const t2 = await p2.textContent('#d2026-10-27');
    assert.match(t2, /Плов с курицей/);
    assert.match(await p2.textContent('#d2026-10-28'), /Суп от Claude/);
    await p2.screenshot({ path: 'tests/e2e/shot-menu-desktop.png' });
    await p2.click('.tabs [data-tab="home"]');
    assert.match(await p2.textContent('main'), /Кефир/);
    await p2.screenshot({ path: 'tests/e2e/shot-home-desktop.png' });
    await p2.click('.tabs [data-tab="more"]');
    await p2.screenshot({ path: 'tests/e2e/shot-more-desktop.png' });

    // первое устройство подтягивает правку Claude
    await p.evaluate(() => window.__menu.syncNow());
    await p.waitForFunction(() => window.__menu.S.meals['2026-10-28/обед'].text === 'Суп от Claude');
    await p.click('.tabs [data-tab="menu"]');
    await p.screenshot({ path: 'tests/e2e/shot-menu-mobile.png' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

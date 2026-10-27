import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fakeRelay } from '../fake-relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), { fakeSheets } = require('../fake-sheets.js');
const M = require('../../web/model.js'), SH = require('../../web/sheets.js'), seed = require('../../tools/seed.json');
const SID = '1FakeSheetIdForTests_abcdefghijk';

async function route(ctx, fake, relay, state) {
  await relay.attach(ctx);
  await ctx.route('https://sheets.googleapis.com/**', async (rt) => {
    if (state.offline) return rt.abort('internetdisconnected');
    const q = rt.request(); const r = await fake.fx(q.url(), { method: q.method(), body: q.postData() });
    await rt.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(await r.json()) });
  });
  await ctx.route('https://accounts.google.com/**', (rt) => rt.fulfill({ status: 200, body: 'google' }));
}
const synced = (p) => p.waitForFunction(() => !window.__menu.SY.dirty && /Синхр/.test(document.querySelector('[data-sync]').textContent));

test('приложение: таблица по кнопке, семья через релей, правки, офлайн, второе устройство', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const fake = fakeSheets('Меню — пример'), relay = fakeRelay(base.replace(/\/$/, ''));
  SH.encodeAll(M.normalize(seed), {}, 1).forEach((d) => { fake.book.sheets[d.range.match(/'(.*)'/)[1]] = d.values; });
  const browser = await chromium.launch();
  const errors = [];
  try {
    const st = { offline: false };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await route(ctx, fake, relay, st);
    await ctx.addInitScript(() => { localStorage.setItem('menu.token', JSON.stringify({ v: 'tok', exp: Date.now() + 3600e3 })); });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base);
    assert.match(await p.textContent('[data-sync]'), /Семья не настроена/);

    // разовый обмен с таблицей: данные приходят на устройство
    await p.click('.tabs [data-tab="more"]');
    await p.fill('form[data-form="connect"] [name="link"]', 'https://docs.google.com/spreadsheets/d/' + SID + '/edit');
    await p.click('form[data-form="connect"] button');
    await p.waitForSelector('text=Последний обмен');
    assert.ok(await p.evaluate(() => !!window.__menu.S.meals['2026-10-27/ужин']));

    // семья: ключ создаётся на устройстве, ссылка и QR-код для второго устройства
    await p.click('[data-act="family-new"]');
    await p.waitForSelector('#modal svg.qr');
    const link = await p.inputValue('#modal .copy input');
    assert.match(link, /^https:\/\/rastaskin\.github\.io\/menu\/#join=[A-Za-z0-9_-]{22}$/);
    await p.click('#modal [data-act="show-words"]');
    assert.equal((await p.textContent('#modal .words')).trim().split(/\s+/).length, 12);
    await p.click('#modal button[data-act="close"]');
    await synced(p);

    // заменить ужин
    await p.click('.tabs [data-tab="menu"]');
    await p.click('#d2026-10-27 [data-slot="ужин"].mtxt');
    await p.fill('#modal textarea', 'Плов с курицей');
    await p.click('#modal button.btn:has-text("Сохранить")');
    assert.match(await p.textContent('#d2026-10-27'), /Плов с курицей/);
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
    await p.click('[data-sync]'); await synced(p);

    // релей видит только шифр
    const traffic = relay.seen.join('');
    assert.ok(traffic.length > 1000);
    assert.doesNotMatch(traffic, /Плов|Рис|Яйца|meals|pantry|2026-10-27/);
    // в таблицу правки уходят только по кнопке
    const cell = () => { const s = fake.book.sheets['Меню'], h = s[0]; return s.find((r) => r[0] === '2026-10-27/ужин')[h.indexOf('блюдо')]; };
    assert.notEqual(cell(), 'Плов с курицей');

    // сохранение при выходе: правка офлайн, перезагрузка без сети
    st.offline = true; relay.state.offline = true;
    await p.click('.tabs [data-tab="home"]');
    await p.fill('form[data-form="pantry-add"] [name="name"]', 'Кефир');
    await p.click('form[data-form="pantry-add"] button');
    await p.reload();
    await p.waitForSelector('.tabs');
    await p.click('.tabs [data-tab="home"]');
    assert.match(await p.textContent('main'), /Кефир/);
    st.offline = false; relay.state.offline = false;
    await p.evaluate(() => window.__menu.syncNow());
    await synced(p);

    // второе устройство (ПК, без входа в Google) — по ссылке-приглашению
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await route(ctx2, fake, relay, { offline: false });
    const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errors.push(String(e)));
    const asked = [];
    p2.on('dialog', (d) => { asked.push(d.message()); d.accept(); });
    await p2.goto(base + link.slice(link.indexOf('#')));
    await synced(p2);
    assert.match(asked.join(' '), /только ссылки от своих/);
    await p2.click('.tabs [data-tab="menu"]');
    await p2.waitForSelector('#d2026-10-27');
    assert.match(await p2.textContent('#d2026-10-27'), /Плов с курицей/);
    await p2.screenshot({ path: 'tests/e2e/shot-menu-desktop.png' });
    await p2.click('.tabs [data-tab="home"]');
    assert.match(await p2.textContent('main'), /Кефир/);
    await p2.screenshot({ path: 'tests/e2e/shot-home-desktop.png' });
    await p2.click('.tabs [data-tab="more"]');
    await p2.screenshot({ path: 'tests/e2e/shot-more-desktop.png' });

    // правка «Claude» прямо в таблице → обмен на первом устройстве → релей → второе устройство
    const mh = fake.book.sheets['Меню'][0];
    const row = fake.book.sheets['Меню'].find((r) => r[0] === '2026-10-28/обед'); row[mh.indexOf('блюдо')] = 'Суп от Claude'; row[mh.indexOf('_u')] = '';
    await p.click('.tabs [data-tab="more"]');
    await p.click('[data-act="sheet-now"]');
    await p.waitForFunction(() => window.__menu.S.meals['2026-10-28/обед'].text === 'Суп от Claude');
    assert.equal(cell(), 'Плов с курицей', 'обмен отправил правки устройства в таблицу');
    await synced(p);
    await p2.evaluate(() => window.__menu.syncNow());
    await p2.waitForFunction(() => window.__menu.S.meals['2026-10-28/обед'].text === 'Суп от Claude');
    await p.click('.tabs [data-tab="menu"]');
    await p.screenshot({ path: 'tests/e2e/shot-menu-mobile.png' });

    // чужая ссылка без согласия ничего не меняет
    const ctx3 = await browser.newContext(); await route(ctx3, fake, relay, { offline: false });
    const p3 = await ctx3.newPage(); p3.on('pageerror', (e) => errors.push(String(e)));
    p3.on('dialog', (d) => d.dismiss());
    await p3.goto(base + link.slice(link.indexOf('#')));
    await p3.waitForSelector('[data-sync]');
    assert.match(await p3.textContent('[data-sync]'), /Семья не настроена/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

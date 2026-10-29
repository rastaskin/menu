import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fakeRelay } from '../fake-relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js');

async function device(browser, base, relay, hash) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await relay.attach(ctx);
  await ctx.addInitScript(() => { localStorage.setItem('menu.tab', '"more"'); });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(base + (hash || ''));
  return p;
}
const synced = (p) => p.waitForFunction(() => !window.__menu.SY.dirty && /Синхр/.test((document.querySelector('[data-sync]') || {}).textContent));
const fidOf = (link) => link.slice(link.indexOf('#join=') + 6);

/* смена ключа: данные — под новым ключом, старая семья на релее стёрта и закрыта (410),
   старое устройство видит «ключ сменили» и подключается новой ссылкой, старая ссылка больше ничего не открывает */
test('смена ключа семьи: старые ссылка и устройства отрезаны, новые подключаются', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const relay = fakeRelay(base.replace(/\/$/, '')), browser = await chromium.launch(), errors = [];
  try {
    const A = await device(browser, base, relay); A.on('pageerror', (e) => errors.push(String(e)));
    await A.click('[data-act="family-new"]');
    const oldLink = await A.inputValue('#modal .copy input');
    await A.click('#modal button[data-act="close"]');
    await A.click('.tabs [data-tab="home"]');
    await A.fill('form[data-form="pantry-add"] [name="name"]', 'Рис');
    await A.click('form[data-form="pantry-add"] button');
    await A.click('[data-sync]'); await synced(A);

    const B = await device(browser, base, relay, oldLink.slice(oldLink.indexOf('#'))); B.on('pageerror', (e) => errors.push(String(e)));
    await B.waitForFunction(() => Object.values(window.__menu.S.pantry).some((p) => p.name === 'Рис'));   // «Синхр» ловит и «Синхронизация…» — ждём сами данные
    await synced(B);
    const stores = () => [...relay.stores.values()];
    assert.equal(stores().length, 1);

    // A меняет ключ
    await A.click('.tabs [data-tab="more"]');
    await A.click('[data-act="rotate"]');
    assert.match(await A.textContent('#modal'), /старые ссылка, QR-код и 12 слов больше ничего не открывают/);
    await A.click('#modal [data-act="rotate-ok"]');
    await A.waitForSelector('#modal h3:text("Новый ключ семьи")');
    const newLink = await A.inputValue('#modal .copy input');
    assert.notEqual(fidOf(newLink), fidOf(oldLink));
    assert.equal(stores().length, 2);
    const [oldStore, newStore] = stores();
    assert.equal(await oldStore.closed(), true, 'старая семья на релее закрыта');
    assert.equal(await oldStore.count(), 0, 'и записи под старым ключом стёрты');
    assert.ok(await newStore.count() > 0, 'данные — под новым ключом');
    await A.click('#modal button[data-act="close"]');
    await synced(A);

    // старое устройство: «ключ сменили», ничего не отправляет; данные на месте
    await B.evaluate(() => window.__menu.syncNow());
    await B.waitForSelector('[data-sync]:has-text("Ключ семьи сменили")');
    await B.click('.tabs [data-tab="more"]');
    assert.match(await B.textContent('#devices'), /Ключ семьи сменили на другом устройстве/);
    assert.ok(await B.evaluate(() => Object.values(window.__menu.S.pantry).some((p) => p.name === 'Рис')));
    assert.equal(await oldStore.count(), 0, 'старое устройство не залило данные обратно');

    // новая ссылка возвращает старое устройство в семью
    await B.fill('#devices form[data-form="join"] [name="code"]', newLink);
    await B.click('#devices form[data-form="join"] button');
    await synced(B);
    await A.click('.tabs [data-tab="home"]');
    await A.fill('form[data-form="pantry-add"] [name="name"]', 'Гречка');
    await A.click('form[data-form="pantry-add"] button');
    await A.click('[data-sync]'); await synced(A);
    await B.evaluate(() => window.__menu.syncNow());
    await B.waitForFunction(() => Object.values(window.__menu.S.pantry).some((p) => p.name === 'Гречка'));

    // старая ссылка на новом устройстве больше ничего не открывает
    const C = await device(browser, base, relay, oldLink.slice(oldLink.indexOf('#'))); C.on('pageerror', (e) => errors.push(String(e)));
    await C.waitForSelector('[data-sync]:has-text("Ключ семьи сменили")');
    assert.equal(await C.evaluate(() => Object.keys(window.__menu.S.pantry).length), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

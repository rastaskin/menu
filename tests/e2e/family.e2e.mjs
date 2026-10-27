import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fakeRelay } from '../fake-relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), { fakeSheets } = require('../fake-sheets.js');
const SID = '1FakeSheetIdForTests_abcdefghijk';

async function device(browser, base, fake, relay, hash) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await relay.attach(ctx);
  await ctx.route('https://sheets.googleapis.com/**', async (rt) => {
    const q = rt.request(); const r = await fake.fx(q.url(), { method: q.method(), body: q.postData() });
    await rt.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(await r.json()) });
  });
  await ctx.addInitScript(() => { localStorage.setItem('menu.token', JSON.stringify({ v: 'tok', exp: Date.now() + 3600e3 })); localStorage.setItem('menu.tab', '"more"'); });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(base + (hash || ''));
  return p;
}
const synced = (p) => p.waitForFunction(() => !window.__menu.SY.dirty && /Синхр/.test(document.querySelector('[data-sync]').textContent));

test('семья: аллергии шифруются, в таблице только имя; второе устройство открывает паролем', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const fake = fakeSheets('Меню'), relay = fakeRelay(base.replace(/\/$/, '')), browser = await chromium.launch(), errors = [];
  try {
    const p = await device(browser, base, fake, relay); p.on('pageerror', (e) => errors.push(String(e)));
    await p.click('[data-act="family-new"]');
    const link = await p.inputValue('#modal .copy input');
    await p.click('#modal button[data-act="close"]');
    await p.click('.tabs [data-tab="more"]');
    await p.waitForSelector('#family');
    await p.fill('form[data-form="fam-pass"] [name="p1"]', 'семейный пароль 1');
    await p.fill('form[data-form="fam-pass"] [name="p2"]', 'семейный пароль 1');
    await p.click('form[data-form="fam-pass"] button');
    await p.waitForSelector('[data-act="fam-forget"]', { timeout: 30000 });
    await p.click('#family [data-act="member-edit"][data-id=""]');
    await p.fill('#modal [name="name"]', 'Член семьи');
    await p.fill('#modal [name="allergies"]', 'арахис, киви');
    await p.fill('#modal [name="weight"]', '64,5');
    await p.click('#modal button.btn:has-text("Сохранить")');
    await p.waitForSelector('#family .member:has-text("аллергии: арахис, киви")');
    await p.click('[data-sync]'); await synced(p);
    assert.doesNotMatch(relay.seen.join(''), /Член семьи|арахис/);

    // выгрузка в таблицу: медданные только в шифре
    await p.fill('form[data-form="connect"] [name="link"]', 'https://docs.google.com/spreadsheets/d/' + SID + '/edit');
    await p.click('form[data-form="connect"] button');
    await p.waitForSelector('text=Последний обмен');
    const sheet = JSON.stringify(fake.book.sheets['Семья']);
    assert.match(sheet, /Член семьи/);
    assert.doesNotMatch(sheet, /арахис|киви|64[.,]5/);
    assert.match(sheet, /v1\./);

    // второе устройство — по ссылке; карточки открываются семейным паролем
    const p2 = await device(browser, base, fake, relay, link.slice(link.indexOf('#'))); p2.on('pageerror', (e) => errors.push(String(e)));
    await synced(p2);
    await p2.click('.tabs [data-tab="more"]');
    await p2.waitForSelector('#family:has-text("данные под семейным паролем")');
    await p2.fill('form[data-form="fam-unlock"] [name="p"]', 'не тот пароль');
    await p2.click('form[data-form="fam-unlock"] button');
    await p2.waitForSelector('form[data-form="fam-unlock"] button:not([disabled])', { timeout: 30000 });
    assert.doesNotMatch(await p2.textContent('#family'), /арахис/);
    await p2.fill('form[data-form="fam-unlock"] [name="p"]', 'семейный пароль 1');
    await p2.click('form[data-form="fam-unlock"] button');
    await p2.waitForSelector('#family .member:has-text("вес 64.5 кг")', { timeout: 30000 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

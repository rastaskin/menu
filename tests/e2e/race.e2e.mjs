import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fakeRelay } from '../fake-relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), seed = require('../../tools/seed.json');

async function until(fn, ms = 8000) { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; }

/* Синхронизация старой семьи не должна дописывать своё состояние в новую:
   устройство A уходит из семьи X и присоединяется к Y, пока его синхронизация с X ещё не закончилась. */
test('смена семьи во время синхронизации: новая семья приходит целиком, без старых данных', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const relay = fakeRelay(base.replace(/\/$/, ''));
  const browser = await chromium.launch(), errors = [];
  let release = () => {};
  try {
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await relay.attach(ctx);
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('dialog', (d) => d.accept());
      await p.goto(base); await p.click('.tabs [data-tab="more"]'); return p;
    };
    const synced = (p) => p.waitForFunction(() => !window.__menu.SY.dirty && /Синхр/.test(document.querySelector('[data-sync]').textContent));

    // B: маленькая семья Y с одной записью-маркером
    const B = await open();
    await B.click('[data-act="family-new"]'); await B.waitForSelector('#modal .copy input');
    const linkY = await B.inputValue('#modal .copy input'); await B.click('#modal button[data-act="close"]');
    await B.click('.tabs [data-tab="home"]');
    await B.fill('form[data-form="pantry-add"] [name="name"]', 'Маркер семьи Y');
    await B.click('form[data-form="pantry-add"] button'); await synced(B);
    await B.context().close();   // дальше релей слышит только A

    // A: большая семья X (пример данных), на релее у неё seq намного больше, чем у Y
    const A = await open();
    await A.setInputFiles('[data-input="import"]', { name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seed)) });
    await A.click('[data-act="family-new"]'); await A.waitForSelector('#modal .copy input'); await A.click('#modal button[data-act="close"]');
    await synced(A);

    // синхронизация A с X зависает на приёме; в это время A уходит из X и присоединяется к Y
    relay.state.gate = new Promise((r) => { release = r; }); relay.state.held = 0;
    await A.evaluate(() => { window.__menu.syncNow(); });   // не ждём: приём задержан
    assert.ok(await until(() => relay.state.held > 0), 'синхронизация с X ждёт ответа релея');
    assert.match(await A.textContent('[data-sync]'), /Синхронизация/);
    await A.click('[data-act="family-leave"]');
    await A.waitForSelector('form[data-form="join"]');
    await A.fill('form[data-form="join"] [name="code"]', linkY);
    await A.click('form[data-form="join"] button');
    await A.waitForSelector('.tabs [data-tab="today"][aria-current="page"]');   // присоединение закончено: ключ Y и сброс состояния релея записаны
    relay.state.gate = null; release();

    const has = () => A.evaluate(() => Object.values(window.__menu.S.pantry).some((p) => p.name === 'Маркер семьи Y'));
    assert.ok(await until(has), 'данные семьи Y пришли на A');
    await synced(A);
    assert.equal(await A.evaluate(() => Object.keys(window.__menu.S.meals).length), 0, 'данных семьи X на A нет');
    await A.click('.tabs [data-tab="more"]');
    assert.ok(await A.isVisible('[data-act="export-backup"]'), 'прежние данные A можно скачать');
    assert.deepEqual(errors, []);
  } finally { relay.state.gate = null; release(); await browser.close(); srv.close(); }
});

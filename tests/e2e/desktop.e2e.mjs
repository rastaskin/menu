import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js');

/* Приложение на ПК без Tauri: подменяем window.__TAURI__ — invoke отвечает как Rust. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

test('ПК: своя картинка продукта, без распознавания', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch(), errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      const calls = window.__calls = [];
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => { calls.push([cmd, args]); if (cmd === 'google_signed_in') return false; throw new Error('unexpected ' + cmd); } },
        http: { fetch: async () => new Response('{}', { status: 200 }) },
        event: { listen: async () => () => {} }, opener: { openUrl: async () => {} }
      };
    });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base);
    await p.click('.tabs [data-tab="home"]');
    assert.equal(await p.locator('[data-input^="scan"], [data-form="barcode"]').count(), 0);

    await p.fill('form[data-form="pantry-add"] [name="name"]', 'Кефир');
    await p.click('form[data-form="pantry-add"] button');
    await p.click('.tile:has-text("Кефир") .tbtn');
    await p.setInputFiles('#modal [data-input="pic"]', { name: 'kefir.png', mimeType: 'image/png', buffer: PNG });
    await p.waitForSelector('#modal .picrow img.fi-img');
    await p.click('#modal [data-act="close"].btn');
    await p.waitForSelector('.tile:has-text("Кефир") img.fi-img');
    await p.reload(); await p.click('.tabs [data-tab="home"]');
    await p.waitForSelector('.tile:has-text("Кефир") img.fi-img');

    await p.click('.tabs [data-tab="more"]');
    assert.doesNotMatch(await p.textContent('main'), /Claude API/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

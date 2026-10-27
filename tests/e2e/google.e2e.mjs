import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fakeRelay } from '../fake-relay.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), { fakeDrive } = require('../fake-drive.js');
const PNG = fs.readFileSync(new URL('../../web/icons/icon-192.png', import.meta.url));
const VERSION = fs.readFileSync(new URL('../../web/config.js', import.meta.url), 'utf8').match(/version:\s*'([^']+)'/)[1];

test('Google: ключ семьи в Диске — второе устройство входит без ссылки; фото члена семьи на всех устройствах; версия в «Ещё»', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const relay = fakeRelay(base.replace(/\/$/, '')), drive = fakeDrive(), browser = await chromium.launch(), errors = [];
  const device = async (token = true) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await relay.attach(ctx); await drive.attach(ctx);
    await ctx.route('https://accounts.google.com/**', (rt) => rt.fulfill({ status: 200, contentType: 'text/html', body: 'google' }));
    if (token) await ctx.addInitScript(() => { localStorage.setItem('menu.token', JSON.stringify({ v: 'tok', exp: Date.now() + 3600e3 })); });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('dialog', (d) => d.accept());
    await p.goto(base); await p.click('.tabs [data-tab="more"]'); return p;
  };
  const synced = (p) => p.waitForFunction(() => !window.__menu.SY.dirty && /Синхр/.test((document.querySelector('[data-sync]') || {}).textContent));
  try {
    const A = await device();
    assert.match(await A.textContent('main'), new RegExp('Меню, версия ' + VERSION.replace(/\./g, '\.')));

    // A: семья, ключ — в Google
    await A.click('[data-act="family-new"]'); await A.click('#modal button[data-act="close"]');
    await A.click('[data-act="gkey-save"]');
    await A.waitForSelector('text=Ключ семьи сохранён в Google.');
    assert.equal(drive.files.size, 1);
    assert.match([...drive.files.values()][0].body, /"code":"[A-Za-z0-9_-]{22}"/);

    // A: член семьи с фото
    await A.click('#family [data-act="member-edit"][data-id=""]');
    await A.fill('#modal [name="name"]', 'Член семьи');
    await A.setInputFiles('#modal [data-input="member-photo"]', { name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await A.waitForSelector('#modal .mphoto img.ava-img');
    await A.click('#modal button.btn:has-text("Сохранить")');
    await A.waitForSelector('#family .member img.ava-img');
    const img = await A.getAttribute('#family .member img.ava-img', 'src');
    assert.match(img, /^data:image\/jpeg;base64,/); assert.ok(img.length < 40000, 'фото сжато');
    await A.click('[data-sync]'); await synced(A);
    assert.doesNotMatch(relay.seen.join(''), /data:image|Член семьи/, 'релей видит только шифр');

    // B: «Войти через Google» — семья подключается без ссылки, фото приходит
    const B = await device();
    await B.click('[data-act="gkey-load"]');
    await synced(B);
    await B.click('.tabs [data-tab="more"]');
    await B.waitForSelector('#family .member img.ava-img');
    assert.equal(await B.getAttribute('#family .member img.ava-img', 'src'), img);
    assert.match(await B.textContent('#devices'), /Ключ семьи сохранён в Google/);
    await B.locator('#family').screenshot({ path: 'tests/e2e/shot-family-photo.png' });
    await B.locator('#devices').screenshot({ path: 'tests/e2e/shot-google-key.png' });

    // C: аккаунт без ключа — понятная подсказка
    drive.files.clear();
    const C = await device();
    await C.click('[data-act="gkey-load"]');
    await C.waitForSelector('text=В этом Google-аккаунте ключа семьи нет');

    // D: старый вход без доступа к Диску — приложение просит войти заново с drive.appdata
    drive.state.scopeOk = false;
    const D = await device();
    await Promise.all([D.waitForURL(/accounts\.google\.com/), D.click('[data-act="gkey-load"]')]);
    const u = new URL(D.url());
    assert.match(u.searchParams.get('scope'), /drive\.appdata/); assert.equal(u.searchParams.get('prompt'), 'consent');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

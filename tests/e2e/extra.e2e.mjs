import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), seed = require('../../tools/seed.json');

const center = async (p, sel) => { const b = await p.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

/* новые иконки, перетаскивание в «Дома», период на «Неделе», Google Календарь (поддельный API) */
test('иконки, «Дома» перетаскиванием, период дат, Google Календарь', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch(), errors = [];
  const data = JSON.parse(JSON.stringify(seed));
  data.meals['2026-10-28/обед'].text = 'Борщ с говядиной';
  data.pantry = { pm: { id: 'pm', name: 'Минтай', qty: '1 кг', place: 'fridge', _u: 1 } };
  const cal = { events: {}, made: 0, primary: [{ status: 'confirmed', summary: 'Учёба', start: { dateTime: '2026-10-28T09:00:00+03:00' } }] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Moscow' });
    await ctx.clock.setFixedTime(new Date('2026-10-28T09:00:00+03:00'));
    await ctx.addInitScript(() => { localStorage.setItem('menu.token', JSON.stringify({ v: 'tok', exp: Date.now() + 3600e3 })); });
    await ctx.route('https://www.googleapis.com/calendar/**', async (rt) => {
      const q = rt.request(), u = new URL(q.url()), p = decodeURIComponent(u.pathname.replace('/calendar/v3', '')), m = q.method();
      const ok = (b) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (m === 'POST' && p === '/calendars') { cal.made++; return ok({ id: 'menu-cal' }); }
      if (p === '/calendars/menu-cal' && m === 'GET') return ok({ id: 'menu-cal' });
      if (p === '/calendars/primary/events') return ok({ items: cal.primary });
      const ev = p.match(/^\/calendars\/menu-cal\/events(?:\/(.+))?$/);
      if (ev && m === 'PUT') return cal.events[ev[1]] ? ok(cal.events[ev[1]] = JSON.parse(q.postData())) : rt.fulfill({ status: 404, body: '{}' });
      if (ev && m === 'POST') { const b = JSON.parse(q.postData()); cal.events[b.id] = b; return ok(b); }
      return rt.fulfill({ status: 400, body: '{}' });
    });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base);
    await p.click('.tabs [data-tab="more"]');
    await p.setInputFiles('[data-input="import"]', { name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await p.waitForFunction(() => Object.keys(window.__menu.S.meals).length > 0);

    // иконки: «Борщ» — своя картинка из web/icons/food
    await p.click('.tabs [data-tab="today"]');
    const bg = await p.$eval('.plate .meal:has-text("Борщ") .fi', (e) => e.style.backgroundImage);
    assert.match(bg, /icons\/food\/borsch\.webp/);
    assert.equal(await p.evaluate(async () => (await fetch('icons/food/borsch.webp')).status), 200);

    // «Дома»: минтай перетаскиванием из холодильника в морозилку, «Отменить» возвращает
    await p.click('.tabs [data-tab="home"]');
    await p.screenshot({ path: 'tests/e2e/shot-home-drag.png' });
    const from = await center(p, '[data-drop-place="fridge"] .tile[data-id="pm"]'), to = await center(p, '[data-drop-place="freezer"]');
    await p.mouse.move(from.x, from.y); await p.mouse.down();
    await p.mouse.move(from.x + 15, from.y + 10, { steps: 3 }); await p.mouse.move(to.x, to.y, { steps: 10 });
    assert.equal(await p.locator('[data-drop-place="freezer"].over').count(), 1);
    await p.mouse.up();
    await p.waitForFunction(() => window.__menu.S.pantry.pm.place === 'freezer');
    assert.equal(await p.locator('#modal .sheet').count(), 0, 'отпускание не открыло карточку');
    assert.match(await p.textContent('#toast'), /Минтай → Морозилка/);
    await p.click('#toast [data-act="toast"]:text("Отменить")');
    await p.waitForFunction(() => window.__menu.S.pantry.pm.place === 'fridge');

    // «Неделя» → «Период…»: история и любой отрезок до 31 дня
    await p.click('.tabs [data-tab="menu"]');
    await p.click('[data-act="week-menu"]'); await p.click('#modal [data-act="range-open"]');
    assert.equal(await p.locator('[data-board] .col').count(), 14, 'по умолчанию — 2 недели до сегодня');
    assert.equal(await p.locator('[data-board] .col.past').count(), 13);
    await p.click('[data-act="range-preset"][data-v="month"]');
    assert.equal(await p.locator('[data-board] .col').count(), 30);
    await p.screenshot({ path: 'tests/e2e/shot-range.png' });
    await p.fill('form[data-form="range"] [name="from"]', '2026-09-01');
    await p.fill('form[data-form="range"] [name="to"]', '2026-10-28');
    await p.click('form[data-form="range"] button');
    await p.waitForSelector('form[data-form="range"] .err:has-text("Не больше 31")');
    await p.fill('form[data-form="range"] [name="from"]', '2026-10-27');
    await p.fill('form[data-form="range"] [name="to"]', '2026-10-29');
    await p.click('form[data-form="range"] button');
    assert.equal(await p.locator('[data-board] .col').count(), 3);
    assert.match(await p.textContent('#d2026-10-28'), /Борщ с говядиной/);
    await p.click('[data-act="range-close"]');
    assert.ok(+(await p.getAttribute('.weekbar', 'data-weeks')) >= 2);

    // Google Календарь: свой календарь «Меню» с блюдами, события основного — в днях меню
    await p.click('.tabs [data-tab="more"]');
    await p.click('[data-act="cal-on"]');
    await p.waitForSelector('#gcal:has-text("Последний обмен")');
    await p.locator('#gcal').screenshot({ path: 'tests/e2e/shot-gcal.png' });
    assert.equal(cal.made, 1);
    const evs = Object.values(cal.events);
    assert.ok(evs.some((e) => e.summary === 'Обед: Борщ с говядиной' && e.start.dateTime === '2026-10-28T13:00:00' && e.start.timeZone === 'Europe/Moscow'));
    assert.ok(evs.some((e) => /^Готовка: /.test(e.summary) && e.start.date));
    assert.ok(evs.every((e) => !/2026-10-1[0-9]|2026-10-0/.test(JSON.stringify(e.start))), 'не раньше недели назад');
    await p.click('.tabs [data-tab="menu"]');
    assert.match(await p.textContent('#d2026-10-28 .tags'), /09:00 Учёба/);
    assert.equal(await p.evaluate(() => JSON.stringify(window.__menu.S).includes('Учёба: 09:00') || JSON.stringify(window.__menu.S).includes('09:00 Учёба')), false, 'события календаря не попадают в данные семьи');
    await ctx.close();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

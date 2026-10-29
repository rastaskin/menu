import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), seed = require('../../tools/seed.json');

/* средний приоритет: неделя списком, подсказка до первого переноса, единицы и прошлая цена, бюджет, поиск,
   события дня строками, итог периода, автокопия, «Что нового» */
test('неделя списком, единицы и прошлая цена, бюджет, поиск, события дня, итог периода, автокопия, «Что нового»', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch(), errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.clock.setFixedTime(new Date('2026-10-29T09:00:00'));
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base);
    await p.click('.tabs [data-tab="more"]');
    await p.setInputFiles('[data-input="import"]', { name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seed)) });
    await p.waitForFunction(() => Object.keys(window.__menu.S.meals).length > 0);

    // неделя: доской с подсказкой → списком (выбор запоминается)
    await p.click('.tabs [data-tab="menu"]');
    assert.equal(await p.locator('main .hint').count(), 1);
    await p.click('[data-act="wview"][data-v="list"]');
    assert.equal(await p.locator('.daylist .dl').count(), 7);
    await p.screenshot({ path: 'tests/e2e/shot-week-list.png' });
    assert.equal(await p.locator('[data-board]').count(), 0);
    assert.match(await p.textContent('#d2026-10-29'), /четверг, 29 октябрясегодня/i);
    await p.reload(); await p.click('.tabs [data-tab="menu"]');
    assert.equal(await p.locator('.daylist').count(), 1, 'вид запомнился');
    await p.click('[data-act="wview"][data-v="board"]');

    // окно дня: события строками, без кодов «a:»
    await p.click('#d2026-10-29 [data-act="cook-edit"]');
    assert.equal(await p.locator('#modal .tagrow').count(), 1);
    assert.equal(await p.inputValue('#modal .tagrow [name="tt"]'), 'Учёба: 12:00–14:50');
    await p.click('#modal [data-act="tag-add"]');
    await p.selectOption('#modal .tagrow:last-child [name="tk"]', 'h');
    await p.waitForTimeout(400); await p.screenshot({ path: 'tests/e2e/shot-day-editor.png' });
    await p.fill('#modal .tagrow:last-child [name="tt"]', 'Праздник; у бабушки');
    await p.click('#modal button.btn:has-text("Сохранить")');
    assert.equal(await p.evaluate(() => window.__menu.S.days['d2026-10-29'].tags), 'a:Учёба: 12:00–14:50; h:Праздник, у бабушки');

    // покупки: число + единица, прошлая цена, бюджет, поиск
    await p.click('.tabs [data-tab="shop"]');
    assert.match(await p.textContent('.sum'), /Бюджет: 12–16 тыс\. ₽ на 2 недели/);
    await p.fill('form[data-form="shop-add"] [name="name"]', 'Творог 9%');
    await p.fill('form[data-form="shop-add"] [name="qty"]', '400');
    await p.selectOption('form[data-form="shop-add"] [name="unit"]', 'г');
    await p.click('form[data-form="shop-add"] button');
    const it = await p.evaluate(() => Object.values(window.__menu.S.shop).find((i) => i.name === 'Творог 9%'));
    assert.equal(it.qty, '400 г');
    assert.ok(it.price > 0, 'цена — из прошлой покупки творога');
    await p.fill('[data-input="sq"]', 'твор');
    assert.ok(await p.locator('.tile').count() >= 2);
    assert.equal(await p.locator('.tile:has-text("Бананы")').count(), 0);
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('data-input')), 'sq', 'фокус остаётся в поиске');

    // рецепты: поиск по названию и продуктам
    await p.click('.tabs [data-tab="recipes"]');
    await p.fill('[data-input="rq"]', 'бёдра');
    const names = await p.$$eval('.rc b', (bs) => bs.map((b) => b.textContent));
    assert.deepEqual(names, ['Джимдак неострый']);

    // период: итог
    await p.click('.tabs [data-tab="menu"]');
    await p.click('[data-act="range-open"]');
    const sum = await p.textContent('.period');
    assert.match(sum, /съели по плану: \d+ из \d+ блюд/);
    assert.match(sum, /из заготовки/);

    // автокопия и «Что нового» после обновления
    await p.click('[data-act="range-close"]');
    await p.click('.tabs [data-tab="more"]');
    await p.evaluate(() => { localStorage.setItem('menu.seenVer', JSON.stringify('0.5.0')); });
    await p.reload();
    const ver = await p.evaluate(() => window.MCONFIG.version);
    if (ver === '0.6.0') { await p.waitForSelector('#modal h3:text("Что нового в версии 0.6.0")'); await p.click('#modal button[data-act="close"]'); }
    await p.waitForSelector('[data-act="autobk"]');
    await p.reload();
    assert.equal(await p.locator('#modal .sheet').count(), 0, '«Что нового» — один раз');
    assert.equal(await p.locator('[data-act="autobk"]').count(), 1, 'копия раз в неделю — не при каждом запуске');
    await ctx.close();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

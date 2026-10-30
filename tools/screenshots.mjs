/* Снимки экранов для README: обезличенный пример tools/seed.json, дата закреплена на 29.10.2026.
   node tools/screenshots.mjs → docs/screenshots/*.png */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../tests/serve.js'), seed = require('./seed.json');

const OUT = 'docs/screenshots/';
const NOW = new Date('2026-10-29T12:00:00');
/* «Дома» в примере пусто — несколько продуктов для снимка */
const pantry = [
  ['Яйца', '6 шт', 'fridge', '2026-11-05'], ['Творог 5%', '400 г', 'fridge', '2026-10-30'], ['Кефир', '1 л', 'fridge', '2026-10-31'],
  ['Огурцы', '4 шт', 'fridge', ''], ['Шпинат', '400 г', 'freezer', ''], ['Минтай', '600 г', 'freezer', ''],
  ['Рис', '900 г', 'shelf', ''], ['Гречка', '800 г', 'shelf', ''], ['Овсяные хлопья', '500 г', 'shelf', '']
].reduce((o, [name, qty, place, until], i) => { o['p' + i] = { id: 'p' + i, name, qty, place, until, _u: 1 }; return o; }, {});
const data = Object.assign({}, seed, { pantry });

const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
try {
  for (const [dev, vp] of [['phone', { width: 390, height: 844 }], ['pc', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dev === 'phone' ? 2 : 1, colorScheme: 'light' });
    await ctx.clock.setFixedTime(NOW);
    const p = await ctx.newPage();
    const shot = (name) => p.screenshot({ path: OUT + dev + '-' + name + '.png' });
    const tab = async (t) => { await p.click(`.tabs [data-tab="${t}"]`); await p.waitForTimeout(150); await p.evaluate(() => window.scrollTo(0, 0)); };
    await p.goto(base);
    await tab('more');
    await p.setInputFiles('[data-input="import"]', { name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await p.waitForTimeout(300);

    await tab('today');
    await p.click('.plate .chk:not([disabled]) >> nth=0');   // завтрак съели
    await p.waitForSelector('.plate .meal.done');
    await p.waitForSelector('#toast', { state: 'hidden' }).catch(() => {});
    if (dev === 'phone') await shot('today');

    await tab('menu');
    await p.waitForSelector('[data-board] .col');
    await shot('week');

    await tab('shop');
    for (let i = 0; i < 3; i++) await p.click('[data-act="buy-quick"][aria-pressed="false"] >> nth=0');
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForSelector('#toast', { state: 'hidden' }).catch(() => {});
    await shot('shop');

    if (dev === 'phone') {
      await tab('home');
      await shot('home');
      await tab('recipes');
      await p.click('[data-act="recipe-open"] >> nth=0');
      await p.waitForSelector('#modal .recipe');
      await p.waitForTimeout(800);   // окно выезжает с анимацией
      await shot('recipe');
    }
    await ctx.close();
  }
} finally {
  await browser.close(); srv.close();
}

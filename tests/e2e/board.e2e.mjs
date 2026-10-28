import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), seed = require('../../tools/seed.json');

const D1 = '2026-10-27', D2 = '2026-10-28';
const meal = (p, d, s) => p.evaluate(([d, s]) => { const m = Object.values(window.__menu.S.meals).find((x) => x.date === d && x.slot === s); return m ? m.text : null; }, [d, s]);
const center = async (p, sel) => { const b = await p.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const place = (d, s) => `#d${d} .place[data-slot="${s}"]`;

test('неделя — доска: перенос мышью и пальцем с обменом, «Добавить» со своим приёмом, «Дома» — форма сверху, памятка для ИИ', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch(), errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base);
    await p.click('.tabs [data-tab="more"]');
    await p.setInputFiles('[data-input="import"]', { name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seed)) });
    await p.click('.tabs [data-tab="menu"]');
    await p.click('.seg button >> nth=0');
    await p.waitForSelector('[data-board] .col');
    await p.evaluate(() => { document.querySelector('[data-board]').scrollLeft = 0; });   // доска открывается на сегодняшнем дне — начинаем с первого

    // нажатие на блюдо — та же карточка, что в «Рецептах»: просмотр, «Редактировать», текст в Markdown
    await p.click(place(D2, 'завтрак') + ' .mtxt');
    assert.equal(await p.textContent('#modal .recipe h3'), 'Кейран-ччим');
    assert.match(await p.textContent('#modal .from'), /Завтрак, ср 28\.10/);
    await p.click('#modal [data-act="recipe-edit"]');
    assert.equal(await p.inputValue('#modal [name="name"]'), 'Кейран-ччим');
    await p.click('#modal [data-act="recipe-cancel"]');
    await p.waitForSelector('#modal .recipe', { timeout: 3000 });   // «Отмена» — обратно к просмотру
    await p.click('#modal [data-act="recipe-edit"]');
    assert.equal(await p.inputValue('#modal [name="portions"]'), '2', 'порции из первой строки рецепта');
    await p.fill('#modal [name="products"]', '**Яйца** — 3 шт');
    await p.fill('#modal [name="text"]', '1. Взбить с водой\n2. На пару *4 мин*\n\n<script>alert(1)</script>');
    await p.click('#modal button.btn:has-text("Сохранить")');
    await p.waitForSelector('#modal .recipe .md');
    assert.equal(await p.locator('#modal .md ol li').count(), 2);
    assert.equal(await p.textContent('#modal .md i'), '4 мин');
    assert.equal(await p.locator('#modal .md script').count(), 0, 'чужой код показан текстом');
    assert.match(await p.textContent('#modal .stock h4'), /Продукты: дома \d+ из 1/, 'продукты из Markdown считаются');
    assert.match(await p.textContent('#modal .stock'), /Яйца — 3 шт/);
    assert.match(await p.evaluate(() => Object.values(window.__menu.S.recipes).find((r) => r.name === 'Кейран-ччим').text), /^2 порции · 15 минут\n\n## Продукты\n- \*\*Яйца\*\* — 3 шт\n\n## Как готовить\n1\./);
    await p.click('#modal [data-act="rport"][data-d="1"]');   // 3 порции вместо 2 — количества ×1,5
    assert.match(await p.textContent('#modal .stock'), /Яйца — 4 ½ шт/);
    await p.waitForTimeout(600); await p.screenshot({ path: 'tests/e2e/shot-week-recipe.png' });
    await p.click('#modal [data-act="close"].btn');

    // рецепта нет — новая карточка с названием блюда; текст можно загрузить из .md
    await p.click(place(D1, 'перекус') + ' .mtxt');
    assert.equal(await p.textContent('#modal h3'), 'Новый рецепт');
    assert.equal(await p.inputValue('#modal [name="name"]'), 'Кефир + яблоко');
    await p.setInputFiles('#modal [data-input="recipe-md"]', { name: 'kefir.md', mimeType: 'text/markdown', buffer: Buffer.from('\uFEFF# Кефир с яблоком\r\n\r\n- кефир\r\n- яблоко\r\n') });
    await p.waitForFunction(() => document.querySelector('#modal [name="text"]').value.startsWith('# Кефир с яблоком'));
    await p.click('#modal button.btn:has-text("Сохранить")');
    await p.waitForSelector('#modal .recipe');
    assert.equal(await p.textContent('#modal .recipe h3'), 'Кефир + яблоко');
    assert.equal(await p.textContent('#modal .md h4'), 'Кефир с яблоком');
    await p.click('#modal [data-act="meal-edit"]');
    assert.equal(await p.inputValue('#modal textarea[name="text"]'), 'Кефир + яблоко', 'окно блюда открылось из карточки рецепта');
    await p.click('#modal [data-act="close"].btn');

    // мышь: ужин понедельника на обед вторника — занятое место меняется местами, окно блюда не открывается
    const a = await meal(p, D1, 'ужин'), b = await meal(p, D2, 'обед');
    let from = await center(p, place(D1, 'ужин') + ' .card'), to = await center(p, place(D2, 'обед'));
    await p.mouse.move(from.x, from.y); await p.mouse.down();
    await p.mouse.move(from.x + 20, from.y + 5, { steps: 3 });
    await p.mouse.move(to.x, to.y, { steps: 12 });
    assert.equal(await p.locator(place(D2, 'обед') + '.over').count(), 1, 'место под курсором подсвечено');
    await p.mouse.up();
    await p.waitForFunction(([d, t]) => Object.values(window.__menu.S.meals).some((x) => x.date === d && x.slot === 'обед' && x.text === t), [D2, a]);
    assert.equal(await meal(p, D1, 'ужин'), b, 'обед вторника встал на ужин понедельника');
    assert.equal(await p.locator('#modal .sheet').count(), 0, 'отпускание не открыло окно блюда');
    assert.match(await p.textContent(place(D2, 'обед')), new RegExp(a.slice(0, 12)));

    // палец: удержание и перенос завтрака вторника на пустое место «с собой» понедельника нет — на перекус понедельника
    const c = await meal(p, D2, 'завтрак'), dd = await meal(p, D1, 'перекус');
    const cdp = await ctx.newCDPSession(p);
    from = await center(p, place(D2, 'завтрак') + ' .card'); to = await center(p, place(D1, 'перекус'));
    const touch = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: pt.x, y: pt.y }] : [] });
    await touch('touchStart', from); await p.waitForTimeout(500);
    for (let i = 1; i <= 10; i++) await touch('touchMove', { x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 });
    await touch('touchEnd');
    await p.waitForFunction(([d, t]) => Object.values(window.__menu.S.meals).some((x) => x.date === d && x.slot === 'перекус' && x.text === t), [D1, c]);
    assert.equal(await meal(p, D2, 'завтрак'), dd);
    // короткое касание со сдвигом — это прокрутка, а не перенос
    from = await center(p, place(D1, 'завтрак') + ' .card');
    const before = await meal(p, D1, 'завтрак');
    await touch('touchStart', from); for (let i = 1; i <= 5; i++) await touch('touchMove', { x: from.x - i * 30, y: from.y }); await touch('touchEnd');
    assert.equal(await meal(p, D1, 'завтрак'), before);

    // «+ Добавить»: занятый приём — подсказка, свой приём — новая карточка
    await p.click(`#d${D1} [data-act="meal-add"]`);
    await p.fill('#modal [name="slot"]', 'Обед'); await p.fill('#modal [name="text"]', 'Творог с ягодами');
    await p.click('#modal button.btn:has-text("Добавить")');
    assert.match(await p.textContent('#modal .err'), /уже есть/);
    await p.click('#modal [data-act="pick-slot"][data-v="полдник"]');
    assert.equal(await p.isHidden('#modal .err'), true, 'подсказка ушла после правки');
    await p.click('#modal button.btn:has-text("Добавить")');
    await p.waitForSelector(place(D1, 'полдник') + ' .card');
    assert.equal(await meal(p, D1, 'полдник'), 'Творог с ягодами');
    assert.match(await p.textContent(place(D1, 'полдник')), /Полдник/);

    // без мыши: перенос из окна блюда (день и приём), занятое место меняется
    const e = await meal(p, D2, 'перекус');
    await p.click(place(D1, 'полдник') + ' .mtxt');
    await p.click('#modal [data-act="meal-edit"]');
    await p.selectOption('#modal [name="to_date"]', D2); await p.selectOption('#modal [name="to_slot"]', 'перекус');
    await p.click('#modal button.btn:has-text("Сохранить")');
    await p.waitForFunction(([d]) => Object.values(window.__menu.S.meals).some((x) => x.date === d && x.slot === 'перекус' && x.text === 'Творог с ягодами'), [D2]);
    assert.equal(await meal(p, D1, 'полдник'), e);
    await p.screenshot({ path: 'tests/e2e/shot-board-desktop.png' });

    // «Рецепты»: превью без значков разметки, нажатие — просмотр
    await p.click('.tabs [data-tab="recipes"]');
    const prev = await p.textContent('.rc:has-text("Кейран-ччим") p');
    assert.doesNotMatch(prev, /##|\*\*/); assert.match(prev, /Взбить с водой/);
    await p.click('.rc:has-text("Кейран-ччим")');
    await p.waitForSelector('#modal .recipe [data-act="recipe-edit"]');
    await p.click('#modal [data-act="close"].btn');

    // «Дома»: форма добавления — первой, над поиском
    await p.click('.tabs [data-tab="home"]');
    assert.equal(await p.evaluate(() => { const f = document.querySelector('main form[data-form="pantry-add"]'), s = document.querySelector('main .search'); return !!(f.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); }), true);

    // «Ещё» → «Google Таблица»: памятка для ИИ-агента
    await p.click('.tabs [data-tab="more"]');
    await p.click('.guide summary');
    assert.match(await p.textContent('.guide pre'), /очисти _u[\s\S]*«Удалено»/);

    // телефон: доска листается вбок, колонки на 84 % ширины
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } }); m.on('pageerror', (er) => errors.push(String(er)));
    await m.goto(base); await m.click('.tabs [data-tab="more"]');
    await m.setInputFiles('[data-input="import"]', { name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seed)) });
    await m.click('.tabs [data-tab="menu"]'); await m.click('.seg button >> nth=0');
    assert.ok(await m.evaluate(() => { const b = document.querySelector('[data-board]'); return b.scrollWidth > b.clientWidth; }), 'доска шире экрана');
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'страница не уезжает вбок');
    await m.screenshot({ path: 'tests/e2e/shot-board-mobile.png' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

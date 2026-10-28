import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js'), seed = require('../../tools/seed.json');

/* план → покупки → дома: покупки из меню, отмена, «поделиться», рецепт и время блюда, «съели» → что закончилось,
   «повторить неделю», «закончилось» → в покупки, аллергии на карточках, «Не забыть», без плашки «семья не настроена» */
test('план → покупки → дома: сбор покупок из меню, отмена, блюдо с рецептом, закончилось, повтор недели, аллергии', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch(), errors = [];
  const data = JSON.parse(JSON.stringify(seed));
  data.recipes.rm = { id: 'rm', name: 'Минтай под морковью', text: '2 порции · 40 минут\n\n## Продукты\n- минтай — 600 г\n- морковь — 2 шт\n\n## Как готовить\nЗапечь.', _u: 1 };
  data.pantry = {
    pf: { id: 'pf', name: 'Минтай', qty: '1 кг', place: 'freezer', _u: 1 },
    pt: { id: 'pt', name: 'Творог 5%', qty: '400 г', place: 'fridge', until: '2026-10-29', _u: 1 },
    pe: { id: 'pe', name: 'Яйца', qty: '10 шт', place: 'fridge', _u: 1 },
    pk: { id: 'pk', name: 'Картофель', qty: '3 шт', place: 'shelf', _u: 1 }
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.clock.setFixedTime(new Date('2026-10-28T09:00:00'));
    await ctx.addInitScript(() => { navigator.share = (d) => { window.__shared = d.text; return Promise.resolve(); }; });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    const S = (f) => p.evaluate(f);
    await p.goto(base);
    assert.equal(await p.getAttribute('[data-sync]', 'hidden'), '', 'без семьи плашки «Семья не настроена» нет');
    await p.click('.tabs [data-tab="more"]');
    await p.setInputFiles('[data-input="import"]', { name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await p.waitForFunction(() => Object.keys(window.__menu.S.shop).length > 0);

    // «Сегодня» → «Не забыть»: творог испортится, минтай разморозить к завтрашнему ужину
    await p.click('.tabs [data-tab="today"]');
    const rem = await p.textContent('.today-side .panel:has(h3:text("Не забыть"))');
    assert.match(rem, /Творог 5%.*годен до 29\.10/);
    assert.match(rem, /Минтай.*разморозить к завтра: ужин/);
    assert.match(rem, /Купить: \d+ продукт/);

    // покупки по датам недель меню; «Собрать из меню» — продукты рецептов; «Отменить» возвращает как было
    await p.click('.tabs [data-tab="shop"]');
    assert.deepEqual(await p.$$eval('main .seg [data-act="shopweek"]', (bs) => bs.map((b) => b.textContent + (b.classList.contains('on') ? '*' : ''))), ['27.10–02.11*', '03.11–09.11']);
    const n0 = await S(() => Object.keys(window.__menu.S.shop).length);
    await p.click('[data-act="shop-gen"]');
    const gen = await p.textContent('#modal .sheet');
    assert.match(gen, /Покупки из меню, 27\.10–02\.11/);
    assert.match(gen, /Без рецепта со списком продуктов/);
    assert.match(gen, /Купить — \d+[\s\S]*Говядина — 600 г · Миёккук/);
    assert.match(gen, /Уже в списке[\s\S]*Минтай — 600 г/, 'минтай уже есть в списке недели — не дублируется');
    await p.click('[data-act="shop-gen-ok"]');
    const n1 = await S(() => Object.keys(window.__menu.S.shop).length);
    assert.ok(n1 > n0, 'добавлены продукты из меню');
    assert.ok(await S(() => Object.values(window.__menu.S.shop).some((i) => i.id.startsWith('auto-20261027-') && i.name === 'Говядина' && i.qty === '600 г' && i.cat === 'Мясо, рыба, яйца')));
    assert.match(await p.textContent('#toast'), /В покупки добавлено/);
    await p.click('#toast [data-act="toast"]:text("Отменить")');
    assert.equal(await S(() => Object.keys(window.__menu.S.shop).length), n0, 'отмена убрала добавленное');
    await p.click('[data-act="shop-gen"]'); await p.click('[data-act="shop-gen-ok"]');

    // «Поделиться списком» — текст по разделам без купленного
    await p.click('[data-act="shop-share"]');
    const shared = await S(() => window.__shared);
    assert.match(shared, /^Покупки на 27\.10–02\.11\n\n.+:\n— /);

    // окно блюда: время из старого текста, рецепт выбирается явно, на карточке — время
    await p.click('.tabs [data-tab="menu"]');
    await p.click('#d2026-10-28 .place[data-slot="ужин"] .mtxt');
    await p.click('#modal [data-act="meal-edit"]');   // рецепта у блюда нет — карточка нового рецепта, оттуда окно блюда
    assert.equal(await p.inputValue('#modal [name="time"]'), '17:00');
    assert.doesNotMatch(await p.inputValue('#modal [name="text"]'), /17:00/);
    await p.click('#modal [data-act="rtoggle"]:text("Джимдак неострый")');
    await p.click('#modal button.btn:has-text("Сохранить")');
    const din = await S(() => window.__menu.S.meals['2026-10-28/ужин']);
    assert.equal(din.time, '17:00');
    assert.equal(din.recipe, Object.values(data.recipes).find((r) => r.name === 'Джимдак неострый').id);
    assert.match(await p.textContent('#d2026-10-28 .place[data-slot="ужин"] .lbl'), /17:00/);
    await p.click('#d2026-10-28 .place[data-slot="ужин"] .mtxt');
    assert.equal(await p.textContent('#modal .recipe h3'), 'Джимдак неострый', 'нажатие на блюдо — выбранный рецепт');
    await p.click('#modal [data-act="close"].btn');

    // «повторить эту»: та же неделя на следующие 7 дней, «Отменить» убирает
    await p.click('main .seg [data-act="week"] >> nth=0');
    await p.click('[data-act="week-repeat"]');
    assert.equal(await p.locator('main .seg [data-act="week"]').count(), 3);
    assert.equal(await S(() => window.__menu.S.meals['2026-11-10/завтрак'].text), await S(() => window.__menu.S.meals['2026-10-27/завтрак'].text));
    await p.click('#toast [data-act="toast"]:text("Отменить")');
    assert.equal(await p.locator('main .seg [data-act="week"]').count(), 2);

    // «Дома» → «Закончилось» → «В покупки»
    await p.click('.tabs [data-tab="home"]');
    await p.click('.tbtn:has-text("Яйца")');
    await p.click('#modal [data-act="pantry-gone"]');
    assert.equal(await S(() => !!window.__menu.S.pantry.pe), false);
    await p.click('#toast [data-act="toast"]:text("В покупки")');
    assert.ok(await S(() => Object.values(window.__menu.S.shop).some((i) => i.name === 'Яйца' && i.week === 20261027 && !i.id.startsWith('auto-'))));

    // «съели» блюдо с рецептом — что закончилось уходит из «Дома» и в покупки
    await p.click('.tabs [data-tab="menu"]');
    await p.click('#d2026-10-28 .place[data-slot="ужин"] .chk');
    await p.waitForSelector('#toast.acts');
    assert.match(await p.textContent('#toast'), /Что-то из продуктов закончилось/);
    await p.click('#toast [data-act="toast"]:text("Отметить")');
    await p.check('#modal [name="p"][value="pk"]');
    await p.click('#modal button.btn:has-text("Готово")');
    assert.equal(await S(() => !!window.__menu.S.pantry.pk), false, 'картофель ушёл из «Дома»');
    assert.ok(await S(() => Object.values(window.__menu.S.shop).some((i) => i.name === 'Картофель' && i.week === 20261027 && i.cat === 'Овощи')), 'и попал в покупки');

    // аллергии: семейный пароль (с отметкой «записан»), член семьи с аллергией на киви — отметка на блюде
    await p.click('.tabs [data-tab="more"]');
    await p.fill('form[data-form="fam-pass"] [name="p1"]', 'семейный пароль 1');
    await p.fill('form[data-form="fam-pass"] [name="p2"]', 'семейный пароль 1');
    await p.check('form[data-form="fam-pass"] [name="saved"]');
    await p.click('form[data-form="fam-pass"] button');
    await p.waitForSelector('[data-act="fam-forget"]', { timeout: 30000 });
    assert.match(await p.textContent('#family .guide summary'), /Ключ семьи и семейный пароль/);
    await p.click('#family [data-act="member-edit"][data-id=""]');
    await p.fill('#modal [name="name"]', 'Член семьи');
    await p.fill('#modal [name="allergies"]', 'арахис, киви');
    await p.click('#modal button.btn:has-text("Сохранить")');
    await p.waitForSelector('#family .member:has-text("киви")');
    await p.click('.tabs [data-tab="today"]');
    assert.match(await p.textContent('.plate .meal:has-text("Йогурт + киви") .alg'), /киви/);
    assert.equal(await p.locator('.plate .meal:has-text("Кейран") .alg').count(), 0);
    await p.screenshot({ path: 'tests/e2e/shot-plan-today.png' });
    await ctx.close();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

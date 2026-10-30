import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const serve = require('../serve.js');

/* сквозной сценарий с пустого устройства без семьи: начать неделю → блюдо → покупка → «Дома» → «съели»; на телефоне и ПК */
test('первый запуск без семьи: неделя, блюдо, покупки, «Дома», «съели»; окна с клавиатуры; ошибки ввода без системных окон', async () => {
  const srv = await serve(0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch(), errors = [], dialogs = [];
  try {
    for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['pc', { width: 1440, height: 900 }]]) {
      const ctx = await browser.newContext({ viewport: vp });
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
      await p.goto(base);

      // первый экран: все пути начала на месте, «без семьи» — не ошибка
      await p.waitForSelector('main .empty');
      for (const act of ['week-new', 'family-new', 'go-join', 'gkey-load']) assert.equal(await p.locator(`main .empty [data-act="${act}"]`).count(), 1, act);
      assert.equal(await p.locator('[data-sync].warn').count(), 0);
      await p.screenshot({ path: `tests/e2e/shot-ux-first-${name}.png` });

      // «Есть приглашение» ведёт к полю; неверный ввод — подсказка под формой
      await p.click('main [data-act="go-join"]');
      assert.equal(await p.evaluate(() => document.activeElement.name), 'code');
      await p.fill('[data-form="join"] [name="code"]', 'что-то не то');
      await p.click('[data-form="join"] button');
      await p.waitForSelector('[data-form="join"] .err:not([hidden])');

      // начать неделю: 7 дней с сегодняшнего
      await p.click('.tabs [data-tab="today"]');
      await p.click('main [data-act="week-new"]');
      await p.waitForSelector('[data-board] .col');
      assert.equal(await p.locator('[data-board] .col').count(), 7);
      assert.match(await p.textContent('#toast'), /Добавлены дни/);
      const t = await p.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });

      // блюдо на завтрак сегодня, затем нажатие на карточку — окно блюда, из него «Написать рецепт» с названием блюда
      await p.click(`#d${t} .place[data-slot="завтрак"] .slot-empty`);
      await p.fill('#modal textarea[name="text"]', 'Сырники');
      await p.click('#modal button.btn:has-text("Сохранить")');
      await p.waitForSelector(`#d${t} .card .dish:has-text("Сырники")`);
      await p.click(`#d${t} .card .ctop .lbl`);   // вся карточка открывает блюдо
      await p.waitForSelector('#modal form[data-form="meal"]');
      await p.click('#modal [data-act="meal-recipe-new"]');
      assert.equal(await p.textContent('#modal h3'), 'Новый рецепт');
      assert.equal(await p.getAttribute('#modal .sheet', 'aria-modal'), 'true');
      assert.equal(await p.inputValue('#modal [name="name"]'), 'Сырники');
      await p.keyboard.press('Escape');
      assert.equal(await p.locator('#modal .sheet').count(), 0, 'Esc закрывает окно');

      // «+ Неделя» — следующие 7 дней
      await p.click('[data-act="week-menu"]'); await p.click('#modal [data-act="week-new"]');
      assert.equal(await p.getAttribute('.weekbar', 'data-weeks'), '2');
      await p.click('.weekbar [data-act="week"] >> nth=0');   // ‹ — к первой неделе
      await p.screenshot({ path: `tests/e2e/shot-ux-week-${name}.png` });

      // покупки: форма сверху, отметка «куплено» прямо на плитке, перенос домой с сообщением
      await p.click('.tabs [data-tab="shop"]');
      await p.fill('form[data-form="shop-add"] [name="name"]', 'Творог 400 г');   // одно поле: количество отделится само
      await p.click('form[data-form="shop-add"] button');
      await p.waitForSelector('main li:has-text("Творог")');
      assert.ok(await p.evaluate(() => Object.values(window.__menu.S.shop).some((i) => i.name === 'Творог' && i.qty === '400 г' && i.cat === 'Молочное')));
      assert.equal(await p.locator(name === 'phone' ? '.srow' : '.tile').count(), 1, 'на телефоне — списком, на ПК — плитками');
      await p.click('main li:has-text("Творог") [data-act="buy-quick"]');
      await p.waitForFunction(() => Object.values(window.__menu.S.shop).some((i) => i.name === 'Творог' && i.bought));
      assert.match(await p.textContent('.done-sec summary'), /Куплено и есть дома · 1/, 'купленное — свёрнуто внизу');
      await p.click('[data-act="move-home"]');
      assert.match(await p.textContent('#toast'), /Перенесено в «Дома»: 1 продукт/);
      await p.screenshot({ path: `tests/e2e/shot-ux-shop-${name}.png` });
      await p.click('.tabs [data-tab="home"]');
      await p.waitForSelector('.tile:has-text("Творог")');

      // «Сегодня»: съели, и фокус клавиатуры остаётся на кнопке после перерисовки
      await p.click('.tabs [data-tab="today"]');
      await p.focus('.plate .chk:not([disabled])');
      await p.keyboard.press('Enter');
      await p.waitForSelector('.plate .meal.done');
      assert.match(await p.textContent('.day-head h2'), /Съели 1 из 4/);
      assert.equal(await p.evaluate(() => document.activeElement.classList.contains('chk')), true);
      await p.screenshot({ path: `tests/e2e/shot-ux-today-${name}.png` });
      await ctx.close();
    }
    assert.deepEqual(dialogs, [], 'ошибки ввода — без системных окон');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

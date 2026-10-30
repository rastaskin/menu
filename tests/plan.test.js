const test = require('node:test');
const assert = require('node:assert');
const M = require('../web/model.js');
const P = require('../web/plan.js');

test('количества: единицы, диапазоны, умножение, ложки', () => {
  assert.deepEqual(P.qty('1,5 кг'), { n: 1500, unit: 'г' });
  assert.deepEqual(P.qty('500–700 г'), { n: 700, unit: 'г' });
  assert.deepEqual(P.qty('4 × 200 г'), { n: 800, unit: 'г' });
  assert.deepEqual(P.qty('2 л'), { n: 2000, unit: 'мл' });
  assert.deepEqual(P.qty('30 шт'), { n: 30, unit: 'шт' });
  assert.deepEqual(P.qty('1,5 стакана (≈300 г)'), { n: 1.5, unit: 'стакана' });
  assert.equal(P.qty('½ ч. л.').n, 0);
  assert.equal(P.qty('по вкусу').n, 0);
  assert.equal(P.qty('немного'), null);
  assert.equal(P.sumQty(['4 шт', '2 шт', '500 г', '0,7 кг', '2 ст. л.', 'немного']), '6 шт + 1,2 кг + немного');
});

test('порции: количества пересчитываются, штуки и ложки — до половинок', () => {
  assert.equal(P.scale('500–700 г', 2), '1000–1400 г');
  assert.equal(P.scale('4 зубчика', 7 / 6), '4 ½ зубчика');
  assert.equal(P.scale('2 ст. л.', 1.5), '3 ст. л.');
  assert.equal(P.scale('по вкусу', 2), 'по вкусу');
});

test('рецепт по частям: порции, время, продукты, шаги — и обратно', () => {
  const text = '2 порции · 15 минут\n\nПродукты:\n— яйца — 4 шт\n— соль — ¼ ч. л.\nГарнир: рис.\n\nКак готовить:\n1. Взбить.\n2. На пару.';
  const o = P.split(text);
  assert.deepEqual(o, { portions: 2, minutes: 15, products: '— яйца — 4 шт\n— соль — ¼ ч. л.\nГарнир: рис.', steps: '1. Взбить.\n2. На пару.' });
  const back = P.compose(o);
  assert.match(back, /^2 порции · 15 минут\n\n## Продукты\n- яйца — 4 шт/);
  assert.deepEqual(P.split(back), Object.assign({}, o, { products: '- яйца — 4 шт\n- соль — ¼ ч. л.\nГарнир: рис.' }), 'разбор собранного даёт то же, маркер — «-»');
  assert.equal(P.compose({ products: 'яйца 4 шт\nмолоко - 200 мл\nзелёный лук\nГарнир: рис или перловка', steps: '' }), '## Продукты\n- яйца — 4 шт\n- молоко — 200 мл\n- зелёный лук\nГарнир: рис или перловка', 'без длинного тире');
  assert.deepEqual(P.splitQty('Творог 9% 400 г'), { name: 'Творог 9%', qty: '400 г' });
  assert.deepEqual(P.splitQty('соль по вкусу'), { name: 'соль', qty: 'по вкусу' });
  assert.deepEqual(P.splitQty('фунчоза'), { name: 'фунчоза', qty: '' });
  assert.equal(P.compose({ portions: 4, products: 'фарш — 500 г', steps: 'Жарить' }), '4 порции\n\n## Продукты\n- фарш — 500 г\n\n## Как готовить\nЖарить');
  assert.equal(P.compose(P.split('Просто текст')), 'Просто текст', 'рецепт без разделов не меняется');
  assert.deepEqual(P.meta('6 порций · 1 ч 20 минут'), { portions: 6, minutes: 80 });
  assert.equal(P.stepsOnly(text), '1. Взбить.\n2. На пару.');
  assert.deepEqual(M.ingredients(back).map((g) => [g.name, g.qty]), [['яйца', '4 шт']], 'соль — не покупка');
});

test('блюдо: время и «из заготовки» из старого текста, рецепты по частям названия', () => {
  assert.deepEqual(P.mealParts('Обед ~15:30. Котлеты + гречка (вчерашние)'), { time: '15:30', text: 'Котлеты + гречка (вчерашние)', prep: true });
  assert.deepEqual(P.mealParts('Ранний ужин 17:00. Куриные котлеты'), { time: '17:00', text: 'Куриные котлеты', prep: false });
  assert.equal(P.mealParts('Сырники').time, '');
  const S = M.blank();
  M.put(S, 'recipes', 'r1', { name: 'Котлеты', text: '' }, 1);
  M.put(S, 'recipes', 'r2', { name: 'Гречка', text: '' }, 1);
  M.put(S, 'recipes', 'r3', { name: 'Плов', text: '' }, 1);
  assert.deepEqual(P.mealRecipes(S, { text: 'Котлеты + гречка' }).map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(P.mealRecipes(S, { text: 'Котлеты', recipe: 'r3' }).map((r) => r.id), ['r3'], 'выбранный рецепт важнее названия');
  assert.ok(P.isPrep({ text: 'Суп (вчерашний)' }) && P.isPrep({ text: 'Суп', prep: true }) && !P.isPrep({ text: 'Суп' }));
});

test('покупки из меню: продукты рецептов, рецепт — раз в неделю, заготовка не считается, что дома — «есть дома»', () => {
  const S = M.blank();
  M.put(S, 'recipes', 'r1', { name: 'Омлет', text: '1 порция\n\n## Продукты\n- яйца — 3 шт\n- молоко — 100 мл\n- соль — щепоть' }, 1);
  M.put(S, 'recipes', 'r2', { name: 'Сырники', text: '## Продукты\n- творог — 400 г\n- яйца — 1 шт\n- мука — 3 ст. л.' }, 1);
  M.put(S, 'meals', 'a', { date: '2026-11-02', slot: 'завтрак', text: 'Омлет' }, 1);
  M.put(S, 'meals', 'b', { date: '2026-11-03', slot: 'завтрак', text: 'Сырники' }, 1);
  M.put(S, 'meals', 'c', { date: '2026-11-04', slot: 'завтрак', text: 'Омлет' }, 1);
  M.put(S, 'meals', 'd', { date: '2026-11-04', slot: 'обед', text: 'Суп (вчерашний)' }, 1);
  M.put(S, 'meals', 'e', { date: '2026-11-04', slot: 'ужин', text: 'Паста' }, 1);
  M.put(S, 'meals', 'f', { date: '2026-11-20', slot: 'ужин', text: 'Сырники' }, 1);
  M.put(S, 'pantry', 'p', { name: 'Мука пшеничная', qty: '1 кг' }, 1);
  M.put(S, 'shop', 's', { name: 'Яйца С1', cat: 'Мясо, рыба, яйца', week: 1 }, 1);
  const r = P.fromMenu(S, ['2026-11-02', '2026-11-03', '2026-11-04'], '2026-11-02');
  assert.equal(r.meals, 5); assert.equal(r.prep, 1); assert.deepEqual(r.noRecipe, ['Паста']);
  const by = Object.fromEntries(r.items.map((i) => [i.name, i]));
  assert.deepEqual(Object.keys(by), ['Яйца', 'Молоко', 'Творог', 'Мука']);
  assert.equal(by['Яйца'].qty, '4 шт', 'омлет дважды за неделю — яйца один раз: 3 + 1 из сырников');
  assert.equal(by['Яйца'].cat, 'Мясо, рыба, яйца', 'раздел — из уже заведённых');
  assert.equal(by['Молоко'].cat, 'Молочное');
  assert.equal(by['Мука'].skip, true); assert.equal(by['Мука'].home[0].id, 'p');
  assert.equal(by['Мука'].qty, '', 'ложки в покупки не идут количеством');
});

test('аллергии: слово и его формы в блюде и продуктах', () => {
  assert.deepEqual(P.allergyHits('арахис, киви', 'Йогурт + киви'), ['киви']);
  assert.deepEqual(P.allergyHits('орехи', 'Салат с грецким орехом'), ['орехи']);
  assert.deepEqual(P.allergyHits('молоко', 'Овсянка на молоке'), ['молоко']);
  assert.deepEqual(P.allergyHits('арахис', 'Овсянка на молоке'), []);
});

test('список покупок текстом: по разделам', () => {
  assert.equal(P.shareText('Покупки', [{ name: 'Яйца', qty: '10 шт', cat: 'Мясо, рыба, яйца' }, { name: 'Кефир', cat: 'Молочное' }, { name: 'Творог', qty: '400 г', cat: 'Молочное' }]),
    'Покупки\n\nМясо, рыба, яйца:\n— Яйца — 10 шт\n\nМолочное:\n— Кефир\n— Творог — 400 г');
});

test('таблица: у блюда столбцы «рецепт», «время», «из заготовки»; старый лист без них читается', () => {
  const SH = require('../web/sheets.js');
  const S = M.blank();
  M.put(S, 'meals', '2026-11-02/обед', { date: '2026-11-02', slot: 'обед', text: 'Суп', recipe: 'r1,r2', time: '15:30', prep: true }, 5);
  const enc = SH.encodeAll(S, {}, 1), menu = enc.find((d) => d.range.startsWith("'Меню'"));
  assert.deepEqual(menu.values[0], ['id', 'дата', 'приём', 'блюдо', 'съели', 'рецепт', 'время', 'из заготовки', '_u']);
  const back = SH.decodeAll(enc.map((d) => ({ values: d.values })), 9).S.meals['2026-11-02/обед'];
  assert.deepEqual(back, S.meals['2026-11-02/обед']);
  const old = SH.decodeSheet(SH.SHEETS[0], [['id', 'дата', 'приём', 'блюдо', 'съели', '_u'], ['x', '2026-11-02', 'ужин', 'Плов', '', 3]], 9).recs[0];
  assert.equal(M.clean('meals', old).text, 'Плов');
});

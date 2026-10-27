const test = require('node:test'), assert = require('node:assert');
const M = require('../web/model.js');

test('put ставит _u и не меняет запись без изменений', () => {
  const S = M.blank();
  assert.ok(M.put(S, 'pantry', 'p1', { name: 'Рис', qty: '1 кг' }, 1000));
  assert.equal(S.pantry.p1._u, 1000);
  assert.equal(M.put(S, 'pantry', 'p1', { name: 'Рис' }, 2000), false);
  assert.ok(M.put(S, 'pantry', 'p1', { qty: '2 кг' }, 1500));
  assert.equal(S.pantry.p1._u, 1500);
});

test('снятая отметка побеждает старую', () => {
  const a = M.blank(), b = M.blank();
  M.put(a, 'shop', 's1', { name: 'Яйца', bought: true }, 100);
  b.shop.s1 = M.clone(a.shop.s1);
  M.put(b, 'shop', 's1', { bought: false }, 200);
  assert.equal(M.merge(a, b).shop.s1.bought, undefined);
  assert.equal(M.merge(b, a).shop.s1.bought, undefined);
});

test('удаление распространяется, более поздняя правка воскрешает', () => {
  const a = M.blank(); M.put(a, 'pantry', 'p1', { name: 'Кефир' }, 100);
  const b = M.clone(a); M.del(b, 'pantry', 'p1', 200);
  let m = M.merge(a, b); assert.equal(m.pantry.p1, undefined); assert.ok(m.tomb['pantry:p1']);
  const c = M.clone(a); M.put(c, 'pantry', 'p1', { qty: '1 л' }, 300);
  m = M.merge(m, c); assert.equal(m.pantry.p1.qty, '1 л'); assert.equal(m.tomb['pantry:p1'], undefined);
});

test('при равном _u и разном содержимом побеждает таблица (remote)', () => {
  const a = M.blank(); M.put(a, 'meals', 'x', { date: '2026-10-27', slot: 'ужин', text: 'Курица' }, 100);
  const b = M.clone(a); b.meals.x.text = 'Рыба';
  assert.equal(M.merge(a, b).meals.x.text, 'Рыба');
});

test('слияние идемпотентно и коммутативно по содержимому', () => {
  const a = M.blank(), b = M.blank();
  M.put(a, 'pantry', 'p1', { name: 'Рис' }, 10); M.put(b, 'pantry', 'p2', { name: 'Гречка' }, 20); M.del(b, 'pantry', 'p2', 30);
  M.put(b, 'recipes', 'r', { name: 'Суп' }, 40);
  const m1 = M.merge(a, b), m2 = M.merge(b, a);
  assert.ok(M.equal(m1, m2)); assert.ok(M.equal(M.merge(m1, m1), m1)); assert.ok(M.equal(M.merge(m1, b), m1));
});

test('типы: булевы и числа из таблицы', () => {
  const r = M.clean('shop', { id: 's', price: '1 234,5', bought: 'TRUE', skip: 'нет', week: '2' });
  assert.deepEqual(r, { id: 's', price: 1234.5, bought: true, week: 2 });
});

test('совпадение с домом по ключу продукта', () => {
  const S = M.blank(); M.put(S, 'pantry', 'p', { name: 'Рис басмати', place: 'shelf' }, 1);
  assert.equal(M.pantryMatches(S, { name: 'Рис круглозёрный' }).length, 1);
  assert.equal(M.pantryMatches(S, { name: 'Гречка' }).length, 0);
  M.put(S, 'pantry', 'q', { name: 'Яйца С0' }, 1);
  assert.equal(M.pantryMatches(S, { name: 'Яйца С1' }).length, 1);
});

test('цена: разряды и дробная часть в любом написании', () => {
  for (const [v, n] of [['1 234,50', 1234.5], ['1.234,50', 1234.5], ['1,234.50', 1234.5], ['319,99', 319.99], ['1 860', 1860], ['', null], ['абв', null]]) assert.equal(M.cast('price', v), n, v);
});

test('продукты рецепта: разбор строк и наличие дома', () => {
  const text = 'На 2 порции\n\nПродукты:\n— куриные бёдра — 1 кг (или филе)\n— морковь — 2 шт, лук — 1 шт, чеснок — 1 зубчик\n— соль — щепоть, сахар — 1 ч. л.\n— соевый соус — 1,5 ст. л., кунжутное масло — 1 ч. л.\n— кефир 1% или йогурт натуральный — 300 мл\n— творог 5% — 200 г\n— фольга\nСоус:\n— сметана 15% — 200 г\n\nКак готовить:\n— не продукт — 1 шт';
  assert.deepEqual(M.ingredients(text).map(g => g.name), ['куриные бёдра', 'морковь', 'лук', 'чеснок', 'сахар', 'соевый соус', 'кунжутное масло', 'кефир 1% или йогурт натуральный', 'творог 5%', 'сметана 15%']);
  assert.deepEqual(M.ingredients('Короткий рецепт без списка'), []);
  const S = M.blank();
  M.put(S, 'pantry', 'a', { name: 'Куриные бёдра', qty: '1 кг' }, 1);
  M.put(S, 'pantry', 'b', { name: 'Печень куриная' }, 1);
  M.put(S, 'pantry', 'c', { name: 'Лук репчатый' }, 1);
  M.put(S, 'pantry', 'd', { name: 'Кефир 1%' }, 1);
  M.put(S, 'pantry', 'e', { name: 'Сыр творожный «Альметте»' }, 1);
  M.put(S, 'pantry', 'f', { name: 'Сметана', until: '2026-10-01' }, 1);
  const st = Object.fromEntries(M.recipeStock(S, text, '2026-10-27').map(g => [g.name, g.home.map(p => p.id)]));
  assert.deepEqual(st['куриные бёдра'], ['a']);
  assert.deepEqual(st['лук'], ['c']);
  assert.deepEqual(st['кефир 1% или йогурт натуральный'], ['d']);
  assert.deepEqual(st['творог 5%'], [], 'творог ≠ сыр творожный');
  assert.deepEqual(st['сметана 15%'], [], 'просроченное не считается');
  assert.deepEqual(st['морковь'], []);
});

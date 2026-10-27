const test = require('node:test');
const assert = require('node:assert');
const F = require('../web/foodicons.js');

test('иконки: 64 ключа без повторов', () => {
  assert.equal(F.KEYS.length, 64);
  assert.equal(new Set(F.KEYS).size, 64);
});

test('иконки: продукты и блюда получают свою картинку', () => {
  const cases = {
    'Яйца С1': 'egg', 'Куриные бёдра (плов)': 'chicken', 'Фарш куриный (тефтели)': 'mince', 'Печень куриная': 'liver',
    'Форель радужная, набор для ухи': 'trout', 'Уха (вчерашняя)': 'trout', 'Мидии варёно-мороженые': 'mussels', 'Шейка свиная': 'pork',
    'Пельмени с говядиной': 'pelmeni', 'Сыр творожный «Альметте» лёгкий': 'creamcheese', 'Сыр сливочный Viola': 'creamcheese',
    'Масло сливочное': 'butter', 'Масло подсолнечное (если нет дома)': 'oil', 'Кунжутное масло': 'sesameoil',
    'Лапша удон': 'udon', 'Лапша рамен': 'ramen', 'Капуста квашеная': 'sauerkraut', 'Капуста белокочанная': 'cabbage',
    'Салат из морской капусты': 'seaweedsalad', 'Зелень (укроп, зелёный лук)': 'dill', 'Лук репчатый': 'onion',
    'Рисовые шарики с рубленым яйцом и кунжутом': 'rice', 'Кейран-ччим + рис': 'egg', 'Хобак-джук — тыквенная рисовая каша': 'pumpkin',
    'Ленивые голубцы': 'cabbage', 'Семена льна': 'flax', 'Крупа гречневая': 'buckwheat', 'Крупа Metro Chef': 'jar',
    'Сливки 10% (удон с мидиями)': 'cream', 'Ранний ужин 17:00. Шейка с капустой (вчерашняя) + гречка': 'pork',
    'Обед ~15:30. Пельмени с говядиной + сметана': 'pelmeni', 'Что-то новое': 'basket'
  };
  for (const [name, key] of Object.entries(cases)) assert.equal(F.keyFor(name), key, name);
});

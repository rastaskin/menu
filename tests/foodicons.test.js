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
    'Салат из морской капусты': 'seaweedsalad', 'Зелень (укроп, зелёный лук)': 'dill', 'Зелёный лук': 'f:zelenyy-luk', 'Лук репчатый': 'onion',
    'Рисовые шарики с рубленым яйцом и кунжутом': 'rice', 'Кейран-ччим + рис': 'egg', 'Хобак-джук — тыквенная рисовая каша': 'pumpkin',
    'Ленивые голубцы': 'f:golubtsy', 'Капуста тушёная': 'cabbage', 'Семена льна': 'flax', 'Крупа гречневая': 'buckwheat', 'Крупа Metro Chef': 'jar',
    'Сливки 10% (удон с мидиями)': 'cream', 'Ранний ужин 17:00. Шейка с капустой (вчерашняя) + гречка': 'pork',
    'Пельмени с говядиной': 'pelmeni', 'Что-то новое': 'basket'
  };
  for (const [name, key] of Object.entries(cases)) assert.equal(F.keyFor(name), key, name);
});

test('отдельные иконки: точнее спрайта, короткие слова не цепляют длинные', () => {
  const L = require('../web/foodlist.js'), fs = require('fs'), path = require('path');
  assert.ok(L.length >= 280);
  assert.equal(new Set(L.map((x) => x[0])).size, L.length, 'ключи без повторов');
  for (const [k] of L) assert.ok(fs.existsSync(path.join(__dirname, '..', 'web', 'icons', 'food', k + '.webp')), k);
  const cases = {
    'Борщ с говядиной': 'f:borsch', 'Обед ~15:30. Пельмени с говядиной + сметана': 'f:pelmeni-so-smetanoy',
    'Солянка': 'f:solyanka', 'Соль йодированная': 'f:sol', 'Салат из свежих овощей': 'f:salat-iz-svezhih-ovoschey', 'Сало с чесноком': 'f:salo',
    'Хлеб цельнозерновой': 'bread', 'Хлебцы ржаные': 'f:hlebtsy', 'Медовик': 'f:medovik', 'Мёд цветочный': 'f:med',
    'Куриные крылья': 'f:kurinye-krylya', 'Лапша быстрая: Чан рамен': 'ramen', 'Чай чёрный': 'f:chay', 'Капуста белокочанная (к курице и стейкам)': 'cabbage', 'Корнишоны Metro Chef': 'f:solenye-ogurtsy', 'Куриные бёдра': 'chicken', 'Кимчи-чиге с тофу': 'f:kimchi-chige', 'Пшённая каша': 'f:pshennaya-kasha'
  };
  for (const [name, key] of Object.entries(cases)) assert.equal(F.keyFor(name), key, name);
  assert.match(F.html('Борщ'), /background-image:url\(icons\/food\/borsch\.webp\)/);
});


/* Иконки продуктов: спрайт icons/food.webp (8 колонок по 128 px, собирается tools/make_food_sprite.py).
   KEYS — порядок иконок в спрайте. RULES — по названию продукта или блюда выбирается иконка:
   побеждает совпадение, которое стоит в тексте раньше; слабые правила — только если сильных нет. */
(function (root) {
  'use strict';
  var KEYS = [
    'egg', 'chicken', 'mince', 'fish', 'trout', 'mussels', 'pork', 'beef', 'liver', 'tuna', 'crab', 'tofu', 'milk', 'kefir', 'cottage', 'sourcream',
    'yogurt', 'butter', 'creamcheese', 'icecream', 'pelmeni', 'rice', 'buckwheat', 'oats', 'flour', 'peas', 'lentils', 'pasta', 'udon', 'ramen', 'funchoza', 'bread',
    'potato', 'carrot', 'onion', 'garlic', 'cabbage', 'sauerkraut', 'zucchini', 'beet', 'pumpkin', 'spinach', 'cucumber', 'dill', 'banana', 'apple', 'kiwi', 'zefir',
    'soy', 'sesameoil', 'oil', 'flax', 'seaweed', 'seaweedsalad', 'gochujang', 'urbech', 'horseradish', 'chili', 'mayo', 'cream', 'nori', 'barley', 'jar', 'basket'
  ];
  var COLS = 8;
  var RULES = [
    [/фарш|тефтел|котлет/, 'mince'], [/печень/, 'liver'], [/пельмен/, 'pelmeni'],
    [/(^|[^а-я])уха|форел/, 'trout'], [/миди/, 'mussels'], [/шейк|свин|бигос/, 'pork'], [/говяд|суповой набор|голяшк/, 'beef'],
    [/скумбри|минтай|рыб/, 'fish'], [/тунец/, 'tuna'], [/краб/, 'crab'], [/тофу|дубу/, 'tofu'],
    [/курин|куриц|бедр|голен|джимдак/, 'chicken'],
    [/яйц|омлет|кейран/, 'egg'], [/кимпаб|нори/, 'nori'],
    [/сырник|творог(?![а-я]*\s+сыр)/, 'cottage'], [/творожн[а-я]* сыр|сыр творожн|альметт|viola/, 'creamcheese'],
    [/кефир/, 'kefir'], [/йогурт/, 'yogurt'], [/молок/, 'milk'], [/сметан/, 'sourcream'], [/сливк/, 'cream'],
    [/масло слив|сливочн[а-я]* масл/, 'butter'], [/пломбир|морожен/, 'icecream'],
    [/хобак|тыкв/, 'pumpkin'], [/овсян|хлопь/, 'oats'], [/гречк|гречн/, 'buckwheat'], [/перлов/, 'barley'],
    [/плов|пибимпап|джук|рис/, 'rice'], [/горох/, 'peas'], [/чечевиц/, 'lentils'],
    [/удон/, 'udon'], [/рамэн|рамен/, 'ramen'], [/фунчоз/, 'funchoza'], [/макарон|паст[аы]|спагет/, 'pasta'],
    [/мука/, 'flour'], [/хлеб|батон|тост/, 'bread'],
    [/картоф|картош/, 'potato'], [/морков/, 'carrot'], [/зелень|укроп|петрушк|зелен[а-я]* лук/, 'dill'], [/лук/, 'onion'], [/чеснок/, 'garlic'],
    [/морск[а-я]* капуст|миек|миёк|водоросл/, 'seaweedsalad'], [/квашен/, 'sauerkraut'], [/голубц/, 'cabbage'],
    [/кабач/, 'zucchini'], [/свекл/, 'beet'], [/шпинат|намуль/, 'spinach'], [/огур/, 'cucumber'],
    [/банан/, 'banana'], [/яблок/, 'apple'], [/киви/, 'kiwi'], [/зефир|пастил|мармелад/, 'zefir'],
    [/соев/, 'soy'], [/кунжут/, 'sesameoil'], [/подсолн|растит[а-я]* масл/, 'oil'], [/льн/, 'flax'],
    [/кочхуджан/, 'gochujang'], [/урбеч|тахин/, 'urbech'], [/хрен/, 'horseradish'], [/чили|остр[а-я]* соус/, 'chili'], [/майонез/, 'mayo']
  ];
  var WEAK = [[/лапш/, 'ramen'], [/капуст/, 'cabbage'], [/сыр/, 'creamcheese'], [/масл/, 'oil'], [/круп/, 'jar'], [/соус|банк/, 'jar']];

  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
  function pick(t, rules) {
    var best = null, at = Infinity;
    rules.forEach(function (r) { var m = r[0].exec(t); if (m && m.index < at) { at = m.index; best = r[1]; } });
    return best;
  }
  /* Отдельные иконки (foodlist.js, web/icons/food/<ключ>.webp): правило — по названию. Все значимые слова по порядку, между ними
     до двух слов; длинное слово — по основе («креветки» → «кревет»), до 6 букв — целиком, меняется только окончание («соль» не ловит «солянку», «чай» — «чан», «кунжут» — «кунжутное масло»).
     Они точнее спрайта, поэтому идут первыми, длинные названия — раньше коротких. Ключ — «f:<имя файла>». */
  var LIST = root.MFoodList || (typeof require === 'function' ? require('./foodlist.js') : []);
  var STOP = { 'с': 1, 'со': 1, 'и': 1, 'в': 1, 'на': 1, 'по': 1, 'из': 1 };
  var V = '[аеиоуыэюяьй]';
  function part(w) {
    if (w.length >= 7) return w.slice(0, -2);
    /* короткое слово — целиком, меняется только окончание из гласных: «чай/чаю», но не «чан»; «соль/соли», но не «солянка» */
    return new RegExp(V + '$').test(w) && w.length > 2 ? w.slice(0, -1) + V + '{0,2}(?![а-я])' : w + V + '{0,2}(?![а-я])';
  }
  var OWN = LIST.map(function (x) {
    var ws = norm(x[1]).split(/[^а-яa-z0-9]+/).filter(function (w) { return w && !STOP[w]; });
    return [new RegExp('(^|[^а-я])' + ws.map(part).join('[а-я]*[^а-я]+(?:[а-я]+[^а-я]+){0,2}?')), 'f:' + x[0], x[1].length];
  }).sort(function (a, b) { return b[2] - a[2]; });
  /* другие названия того же: только на иконки, которые уже есть */
  var have = {}; LIST.forEach(function (x) { have['f:' + x[0]] = 1; });
  var ALIAS = [[/корнишон/, 'f:solenye-ogurtsy'], [/(^|[^а-я])джем/, 'f:varene'], [/томатн[а-я]* заготовк/, 'f:tomatnaya-pasta'],
    [/гриб[а-я]* сушен|сушен[а-я]* гриб/, 'f:belye-griby'], [/(^|[^а-я])овсянк/, 'f:ovsyanka-na-moloke'], [/(^|[^а-я])лайм/, 'f:laym']].filter(function (r) { return have[r[1]]; });
  var STRONG = OWN.concat(ALIAS, RULES);
  /* сначала — без пояснений в скобках: «Капуста (к курице)» — капуста, а не курица */
  function keyFor(text) {
    var t = norm(text), bare = norm(String(text || '').replace(/\([^)]*\)?/g, ' '));
    return pick(bare, STRONG) || pick(bare, WEAK) || pick(t, STRONG) || pick(t, WEAK) || 'basket';
  }
  /* <span> с иконкой; размер задаёт CSS (.fi, .fi-l). */
  function html(text, cls) {
    var k = keyFor(text);
    if (k.indexOf('f:') === 0) return '<span class="fi fi-own' + (cls ? ' ' + cls : '') + '" aria-hidden="true" style="background-image:url(icons/food/' + k.slice(2) + '.webp)"></span>';
    var i = KEYS.indexOf(k), x = i % COLS, y = Math.floor(i / COLS), rows = Math.ceil(KEYS.length / COLS);
    return '<span class="fi' + (cls ? ' ' + cls : '') + '" aria-hidden="true" style="background-position:' +
      (x * 100 / (COLS - 1)) + '% ' + (y * 100 / (rows - 1)) + '%"></span>';
  }
  var api = { KEYS: KEYS, OWN: OWN.map(function (r) { return r[1]; }), keyFor: keyFor, html: html };
  if (typeof module !== 'undefined') module.exports = api; else root.MFood = api;
})(this);

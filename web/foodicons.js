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
  function keyFor(text) { var t = norm(text); return pick(t, RULES) || pick(t, WEAK) || 'basket'; }
  /* <span> с иконкой; размер задаёт CSS (.fi, .fi-l). */
  function html(text, cls) {
    var i = KEYS.indexOf(keyFor(text)), x = i % COLS, y = Math.floor(i / COLS), rows = Math.ceil(KEYS.length / COLS);
    return '<span class="fi' + (cls ? ' ' + cls : '') + '" aria-hidden="true" style="background-position:' +
      (x * 100 / (COLS - 1)) + '% ' + (y * 100 / (rows - 1)) + '%"></span>';
  }
  var api = { KEYS: KEYS, keyFor: keyFor, html: html };
  if (typeof module !== 'undefined') module.exports = api; else root.MFood = api;
})(this);

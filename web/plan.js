/* Планирование поверх модели: количества продуктов, рецепт по частям, рецепты блюда, покупки из меню,
   аллергии, текст списка покупок. Чистые функции без DOM — их гоняют node-тесты (tests/plan.test.js). */
(function (root) {
  'use strict';
  var M = root.MModel || (typeof require === 'function' ? require('./model.js') : null);

  /* ---------- количества: «1,5 кг», «500–700 г», «4 × 200 г», «½ ч. л.» ---------- */
  var FR = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
  var NUMRE = '(\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔])';
  var UNITS = [
    [/^кг$|^килограмм/, 'г', 1000], [/^г$|^гр$|^грамм/, 'г', 1],
    [/^л$|^литр/, 'мл', 1000], [/^мл$|^миллилитр/, 'мл', 1],
    [/^шт$|^штук/, 'шт', 1], [/^зубч/, 'зубч.', 1], [/^банк/, 'банк.', 1], [/^уп$|^упак/, 'уп.', 1],
    [/^пуч/, 'пуч.', 1], [/^голов/, 'гол.', 1], [/^лист/, 'лист.', 1], [/^кочан/, 'коч.', 1]
  ];
  var SPOON = /^(ст|ч|щеп\S*|по)$/;   // ложки, щепоть, «по вкусу» — для покупок количество не нужно
  function num(s) { return FR[s] != null ? FR[s] : parseFloat(String(s).replace(',', '.')); }
  /* «1,5 кг» → {n: 1500, unit: 'г'}; ложки и «по вкусу» — {n: 0}; непонятное — null */
  function qty(text) {
    var s = String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (/^по вкусу|^щепот/.test(s)) return { n: 0, unit: '' };
    var m = new RegExp('^' + NUMRE + '(?:\\s*[–—-]\\s*' + NUMRE + ')?(?:\\s*[×x]\\s*' + NUMRE + ')?\\s*([а-яё]+)?').exec(s);
    if (!m) return null;
    var n = num(m[2] || m[1]);
    if (m[3]) n *= num(m[3]);
    var w = m[4] || '';
    if (!w) return { n: n, unit: 'шт' };
    if (SPOON.test(w)) return { n: 0, unit: '' };
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i][0].test(w)) return { n: n * UNITS[i][2], unit: UNITS[i][1] };
    return { n: n, unit: w };
  }
  function round(n) { return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10; }
  function ru(n) { return String(round(n)).replace('.', ','); }
  function fmt(q) {
    if (!q || !q.n) return '';
    if (q.unit === 'г' && q.n >= 1000) return ru(q.n / 1000) + ' кг';
    if (q.unit === 'мл' && q.n >= 1000) return ru(q.n / 1000) + ' л';
    if (q.unit === 'шт') return Math.ceil(q.n) + ' шт';
    return ru(q.n) + ' ' + q.unit;
  }
  /* сложить количества одного продукта: одинаковые единицы суммируются, прочее перечисляется */
  function sumQty(list) {
    var by = {}, order = [], raw = [];
    list.forEach(function (t) {
      var q = qty(t);
      if (!q) { if (t && raw.indexOf(t) < 0) raw.push(t); return; }
      if (!q.n) return;
      if (!(q.unit in by)) { by[q.unit] = 0; order.push(q.unit); }
      by[q.unit] += q.n;
    });
    return order.map(function (u) { return fmt({ n: by[u], unit: u }); }).concat(raw).join(' + ');
  }
  /* количество в тексте ×k: «4 шт» ×1,5 → «6 шт», «500–700 г» ×2 → «1000–1400 г» */
  function nice(n) {
    var w = Math.floor(n), f = n - w, ch = Math.abs(f - 0.5) < 0.01 ? '½' : Math.abs(f - 0.25) < 0.01 ? '¼' : Math.abs(f - 0.75) < 0.01 ? '¾' : '';
    if (ch && n < 10) return (w ? w + ' ' : '') + ch;
    return ru(n);
  }
  function scale(text, k) {
    if (k === 1) return text;
    var re = new RegExp('^\\s*' + NUMRE + '(\\s*[–—-]\\s*' + NUMRE + ')?'), s = String(text || ''), m = re.exec(s);
    if (!m) return s;
    /* штуки, зубчики, ложки — до половинок: «4,7 зубчика» → «4 ½ зубчика»; граммы — до целых */
    var half = /^\s*(шт|зуб|пер|голов|банк|уп|пуч|кочан|лист|ст|ч\.|стакан|небольш|средн|крупн|$)/i.test(s.slice(m[0].length));
    var r = function (x) { x *= k; return half ? Math.max(0.5, Math.round(x * 2) / 2) : x; };
    return nice(r(num(m[1]))) + (m[3] ? '–' + nice(r(num(m[3]))) : '') + s.slice(m[0].length);
  }

  /* ---------- рецепт: первая строка «2 порции · 15 минут», блок «Продукты», «Как готовить» ---------- */
  function plural(n, one, few, many) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; }
  function head(ln) { return ln.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*|__/g, '').trim(); }
  function isMeta(ln) { var t = head(ln); return t.length < 80 && /\d+\s*(порци|мин|ч(?![а-яё])|час)/i.test(t) && !/^[—–-]\s/.test(t); }
  function meta(text) {
    var first = String(text || '').split('\n').filter(function (l) { return l.trim(); })[0] || '', o = { portions: 0, minutes: 0 };
    if (!isMeta(first)) return o;
    var p = /(\d+)\s*порци/i.exec(first), h = /(\d+)\s*(?:ч(?![а-яё])|час)/i.exec(first), mm = /(\d+)\s*мин/i.exec(first);
    o.portions = p ? +p[1] : 0;
    o.minutes = (h ? +h[1] * 60 : 0) + (mm ? +mm[1] : 0);
    return o;
  }
  function metaLine(portions, minutes) {
    var a = [];
    if (portions > 0) a.push(portions + ' ' + plural(portions, 'порция', 'порции', 'порций'));
    if (minutes > 0) a.push(minutes >= 60 && minutes % 60 === 0 ? minutes / 60 + ' ч' : minutes + ' минут');
    return a.join(' · ');
  }
  /* текст → {portions, minutes, products (строки как есть), steps} для формы правки */
  function split(text) {
    var ls = String(text || '').split('\n'), o = meta(text), i0 = 0;
    while (i0 < ls.length && !ls[i0].trim()) i0++;
    if (o.portions || o.minutes) i0++;
    var pi = -1, ci = -1;
    for (var i = i0; i < ls.length; i++) {
      var t = head(ls[i]);
      if (pi < 0 && /^продукты(?![а-яё])/i.test(t)) pi = i;
      else if (pi >= 0 && /^как готовить(?![а-яё])/i.test(t)) { ci = i; break; }
    }
    var trim = function (a) { return a.join('\n').replace(/^\s+|\s+$/g, ''); };
    if (pi < 0) return { portions: o.portions, minutes: o.minutes, products: '', steps: trim(ls.slice(i0)) };
    var intro = trim(ls.slice(i0, pi)), rest = ci < 0 ? '' : trim(ls.slice(ci + 1));
    return { portions: o.portions, minutes: o.minutes, products: trim(ls.slice(pi + 1, ci < 0 ? ls.length : ci)), steps: [intro, rest].filter(Boolean).join('\n\n') };
  }
  /* «творог 5% 400 г», «яйца - 4 шт», «молоко: 200 мл», «соль по вкусу» → {name, qty}; количества нет — qty пусто */
  var QTY = '((?:\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔])(?:\\s*[–-]\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*[×x]\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:[а-яё]{1,8}\\.?(?:\\s[а-яё]\\.)?)?|по вкусу|щепотк?[аиу]?)';
  function splitQty(text) {
    var s = String(text || '').trim(), m;
    if ((m = /^(.+?)\s+—\s+(.+)$/.exec(s)) || (m = /^(.+?)\s+[-–:]\s+(.+)$/.exec(s)) || (m = /^(.+?):\s*(.+)$/.exec(s)) && new RegExp('^' + QTY + '$', 'i').test(m[2])) return { name: m[1].trim(), qty: m[2].trim() };
    if ((m = new RegExp('^(.+?)[\\s,]+' + QTY + '$', 'i').exec(s)) && /[а-яёa-z]/i.test(m[1])) return { name: m[1].trim(), qty: m[2].trim() };
    return { name: s, qty: '' };
  }
  /* строка поля «Продукты» → «- продукт — сколько»: длинное тире не нужно; заметки вроде «Гарнир: рис или…» остаются как есть */
  function productLine(l) {
    var t = l.trim(); if (!t || /^#|^\*\*[^*]+\*\*:?$/.test(t)) return l.replace(/\s+$/, '');
    var mark = /^([—–*+-]|\d{1,3}[.)])\s+/.test(t), body = t.replace(/^([—–*+-]|\d{1,3}[.)])\s+/, '');
    if (/ — /.test(body)) return '- ' + body;
    var q = splitQty(body);
    if (q.qty) return '- ' + q.name + ' — ' + q.qty;
    return mark || (!/:/.test(body) && body.split(/\s+/).length <= 4) ? '- ' + body : t;
  }
  /* обратно в текст; продукты — строками «- продукт — сколько» */
  function compose(o) {
    var pr = String(o.products || '').split('\n').map(productLine).join('\n').replace(/^\s+|\s+$/g, '');
    var st = String(o.steps || '').replace(/^\s+|\s+$/g, ''), out = [], ml = metaLine(+o.portions || 0, +o.minutes || 0);
    if (ml) out.push(ml);
    if (pr) out.push('## Продукты\n' + pr);
    if (st) out.push(pr ? '## Как готовить\n' + st : st);
    return out.join('\n\n');
  }
  /* текст для показа без блока продуктов (его показывает список с отметкой «дома») */
  function stepsOnly(text) {
    var o = split(text);
    return o.products ? o.steps : String(text || '').split('\n').filter(function (l, i, a) { return !(isMeta(l) && a.slice(0, i).every(function (x) { return !x.trim(); })); }).join('\n').trim();
  }

  /* ---------- блюдо ---------- */
  var PREP = /вчерашн|из заготовк|заготовк[аиу](?![а-яё])|разогре|остатк/i;
  function isPrep(m) { return !!(m && (m.prep || PREP.test(m.text || ''))); }
  /* «Обед ~15:30. Котлеты (вчерашние)» → {time: '15:30', text: 'Котлеты (вчерашние)', prep: true} */
  function mealParts(text) {
    var s = String(text || ''), m = /^\s*(?:(?:ранний|поздний|второй)?\s*(?:завтрак|обед|ужин|перекус|полдник)\s*)?~?\s*(\d{1,2})[:.](\d{2})\s*[.,:—–-]?\s*/i.exec(s);
    var o = { time: '', text: s.trim(), prep: PREP.test(s) };
    if (m && +m[1] < 24 && s.slice(m[0].length).trim()) { o.time = ('0' + m[1]).slice(-2) + ':' + m[2]; o.text = s.slice(m[0].length).trim(); }
    return o;
  }
  /* рецепты блюда: выбранные явно (recipe — id через запятую), иначе по названию — целиком или по частям «А + Б» */
  function mealRecipes(S, m) {
    if (!m) return [];
    var out = String(m.recipe || '').split(',').map(function (id) { return S.recipes[id.trim()]; }).filter(Boolean);
    if (out.length) return out;
    var whole = M.recipeFor(S, m.text);
    var parts = String(m.text || '').split(/\s\+\s|,\s|;\s/).map(function (p) { return M.recipeFor(S, p); });
    [whole].concat(parts).forEach(function (r) { if (r && out.indexOf(r) < 0) out.push(r); });
    return out;
  }

  /* ---------- покупки ---------- */
  var CATS = [
    ['Бакалея', /^(соус|соев|масл[оа]? подсол|кунжут|нори|миек|морск|сахар|уксус|мед|кочхуджан|паст|специ|перец черн|крахмал|разрыхл|какао|чай|кофе|орех|семен|льн)/],
    ['Молочное', /^(молок|кефир|творог|сметан|йогурт|сыр|сливк|ряженк|простокваш|масло сливоч|сливоч)/],
    ['Мясо, рыба, яйца', /^(кур|говя|свин|фарш|бедр|голен|печен|минта|скумбр|рыб|тунец|кревет|крабов|яйц|тофу|индей|мяс|филе|лосос|сельд|треск|котлет)/],
    ['Овощи', /^(картоф|морков|лук|капуст|кабач|свекл|огур|помид|томат|чеснок|зелен|укроп|петруш|шпинат|перец|баклаж|редис|тыкв|сельдер|брокк|цветн|горош|кукуруз|грибы|шампин)/],
    ['Фрукты и сладкое', /^(банан|яблок|киви|груш|апельс|мандар|ягод|лимон|виноград|изюм|курага|зефир|пастил|мармелад|хурм|персик|слив)/],
    ['Крупы', /^(рис|гречк|перлов|овсян|хлопь|булгур|пшен|макарон|лапш|фунчоз|чечевиц|нут|фасол|мук|манк|кус)/],
    ['Хлеб', /^(хлеб|лаваш|батон|булк|хлебц)/]
  ];
  /* раздел для продукта: из уже заведённых, если похож по началу, иначе стандартный */
  function catFor(name, have) {
    var ws = M.norm(name).split(' '), hit = null;
    /* ищем с каждого слова: «готовый рис» → «рис», «кунжутное масло» → «кунжут» */
    for (var j = 0; j < ws.length && !hit; j++) for (var i = 0; i < CATS.length && !hit; i++) if (CATS[i][1].test(ws.slice(j).join(' '))) hit = CATS[i][0];
    if (!hit) return (have || []).filter(function (c) { return /^прочее/i.test(c); })[0] || 'Прочее';
    var key = M.norm(hit).split(' ')[0].slice(0, 5);
    var own = (have || []).filter(function (c) { return M.norm(c).indexOf(key) === 0; }).sort(function (a, b) { return a.length - b.length; })[0];
    return own || hit;
  }
  /* Покупки из меню дней ds: продукты рецептов блюд (блюда из заготовки не считаются, каждый рецепт — один раз), сложенные по продукту;
     что есть дома — skip. → {items:[{key,name,qty,cat,skip,home,from}], noRecipe:[текст блюда], prep, meals} */
  function fromMenu(S, ds, day) {
    var acc = {}, order = [], noRecipe = [], prep = 0, meals = 0, cats = [], used = {};
    M.list(S, 'shop').forEach(function (i) { if (i.cat && cats.indexOf(i.cat) < 0) cats.push(i.cat); });
    M.list(S, 'meals').filter(function (m) { return ds.indexOf(m.date) >= 0 && m.text; })
      .sort(function (a, b) { return (a.date + a.slot) < (b.date + b.slot) ? -1 : 1; })
      .forEach(function (m) {
        meals++;
        if (isPrep(m)) { prep++; return; }
        var rs = mealRecipes(S, m);
        if (!rs.length) { if (noRecipe.indexOf(m.text) < 0) noRecipe.push(m.text); return; }
        rs.forEach(function (r) {
          if (used[r.id]) return;   // рецепт за неделю считается один раз: повтор в меню обычно — та же кастрюля
          used[r.id] = 1;
          M.ingredients(r.text).forEach(function (g) {
            var nm = g.alts[0] || g.name, k = M.norm(nm);
            if (!acc[k]) { acc[k] = { key: k, name: nm.charAt(0).toUpperCase() + nm.slice(1), alts: g.alts, q: [], from: [] }; order.push(k); }
            if (g.qty) acc[k].q.push(g.qty);
            if (acc[k].from.indexOf(r.name) < 0) acc[k].from.push(r.name);
          });
        });
      });
    var items = order.map(function (k) {
      var a = acc[k], home = [];
      a.alts.forEach(function (x) { M.pantryFor(S, x, day).forEach(function (p) { if (home.indexOf(p) < 0) home.push(p); }); });
      return { key: k, name: a.name, qty: sumQty(a.q), cat: catFor(a.name, cats), skip: home.length > 0, home: home, from: a.from };
    });
    return { items: items, noRecipe: noRecipe, prep: prep, meals: meals };
  }
  /* список покупок текстом — для мессенджера */
  function shareText(title, items) {
    var cats = [], out = [title];
    items.forEach(function (i) { var c = i.cat || 'Прочее'; if (cats.indexOf(c) < 0) cats.push(c); });
    cats.forEach(function (c) {
      out.push('', c + ':');
      items.filter(function (i) { return (i.cat || 'Прочее') === c; }).forEach(function (i) { out.push('— ' + i.name + (i.qty ? ' — ' + i.qty : '')); });
    });
    return out.join('\n');
  }

  /* ---------- аллергии: «арахис, киви» против текста блюда и продуктов его рецептов ---------- */
  function allergens(s) { return String(s || '').split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(function (x) { return M.words(x).length; }); }
  function allergyHits(allergyText, text) {
    var tw = M.words(text);
    return allergens(allergyText).filter(function (a) {
      return M.words(a).every(function (w) { var st = M.stem(w); return tw.some(function (x) { return x.indexOf(st) === 0; }); });
    });
  }

  var api = {
    qty: qty, fmt: fmt, sumQty: sumQty, scale: scale, splitQty: splitQty, meta: meta, metaLine: metaLine, split: split, compose: compose, stepsOnly: stepsOnly,
    isPrep: isPrep, mealParts: mealParts, mealRecipes: mealRecipes, catFor: catFor, fromMenu: fromMenu, shareText: shareText,
    allergens: allergens, allergyHits: allergyHits
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MPlan = api;
})(typeof self !== 'undefined' ? self : this);

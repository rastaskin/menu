/* Модель данных «Меню» и слияние. Чистые функции без DOM — их гоняют node-тесты.
   Состояние: S = {schema, meta:{}, days:{}, meals:{}, shop:{}, pantry:{}, recipes:{}, rules:{}, family:{}, tomb:{}}.
   Каждая коллекция — словарь id → запись {id, ...поля, _u}. _u — время изменения, мс.
   Удаление — надгробие tomb['<коллекция>:<id>'] = _u. Надгробие убивает запись, если оно не старше её.
   При равных _u и разном содержимом побеждает удалённая копия (таблица): так правка ячейки руками
   без смены _u всё равно применяется. */
(function (root) {
  'use strict';

  var COLS = {
    meta: ['value'],
    days: ['date', 'wd', 'tags', 'cook'],
    meals: ['date', 'slot', 'text', 'done'],
    shop: ['week', 'cat', 'name', 'qty', 'price', 'bought', 'skip', 'moved', 'key'],
    pantry: ['name', 'qty', 'place', 'until', 'note'],
    recipes: ['name', 'text'],
    rules: ['title', 'text'],
    family: ['name', 'color', 'enc'],   // enc — аллергии, вес, заметка в шифре AES-GCM (vault.js)
    photos: ['img']                     // фото члена семьи (id = id карточки), JPEG data URL; ходит через релей, в таблицу не попадает
  };
  var NAMES = Object.keys(COLS);
  var BOOL = { done: 1, bought: 1, skip: 1, moved: 1 };
  var TOMB_TTL = 180 * 86400000;   // пометка об удалении старше этого стирается (relay.js, sheets.js)
  var NUM = { price: 1, week: 1 };

  function blank() {
    var S = { schema: 1, tomb: {} };
    NAMES.forEach(function (n) { S[n] = {}; });
    return S;
  }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function u(r) { return (r && +r._u) || 0; }

  /* «1 234,50», «1.234,50», «1,234.50» → «1234.50»: последний из знаков , и . отделяет дробную часть, остальные — разряды */
  function numText(s) {
    s = s.replace(/\s| | /g, '');
    var c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) return c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    return s.replace(',', '.');
  }
  /* Привести значение поля к типу. */
  function cast(f, v) {
    if (BOOL[f]) {
      if (typeof v === 'boolean') return v;
      var s = String(v == null ? '' : v).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'да' || s === 'истина' || s === 'x' || s === '✓';
    }
    if (NUM[f]) {
      if (v === '' || v == null) return null;
      var n = typeof v === 'number' ? v : parseFloat(numText(String(v)));
      return isFinite(n) ? n : null;
    }
    return v == null ? '' : String(v);
  }

  /* Каноническая запись: только известные поля, типы приведены. */
  function clean(col, r) {
    var o = { id: String(r.id) };
    COLS[col].forEach(function (f) {
      var v = cast(f, r[f]);
      if (BOOL[f]) { if (v) o[f] = true; }
      else if (v !== '' && v != null) o[f] = v;
    });
    if (u(r)) o._u = u(r);
    return o;
  }

  /* id из таблицы или файла не должен совпадать со служебными именами объектов */
  function okId(id) { id = String(id); return id !== '' && id !== '__proto__' && id !== 'constructor' && id !== 'prototype'; }

  function normalize(x) {
    var S = blank();
    if (!isObj(x)) return S;
    NAMES.forEach(function (n) {
      var c = x[n];
      if (Array.isArray(c)) c.forEach(function (r) { if (isObj(r) && r.id != null && okId(r.id)) S[n][String(r.id)] = clean(n, r); });
      else if (isObj(c)) Object.keys(c).forEach(function (id) { var r = c[id]; if (isObj(r) && okId(id)) S[n][id] = clean(n, Object.assign({}, r, { id: id })); });
    });
    if (isObj(x.tomb)) Object.keys(x.tomb).forEach(function (k) { var t = +x.tomb[k]; if (t > 0 && okId(k)) S.tomb[k] = t; });
    return S;
  }

  function sig(r) { var o = Object.assign({}, r); delete o._u; return stable(o); }
  function stable(o) {
    if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
    if (isObj(o)) return '{' + Object.keys(o).sort().filter(function (k) { return o[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
    return JSON.stringify(o);
  }

  /* Изменить или создать запись. Возвращает true, если что-то поменялось. */
  function put(S, col, id, patch, now) {
    id = String(id); if (!okId(id)) return false;
    var old = S[col][id], tk = col + ':' + id;
    var rec = clean(col, Object.assign({}, old || {}, patch, { id: id }));
    if (old && sig(old) === sig(rec)) return false;
    rec._u = Math.max(now, u(old) + 1, (S.tomb[tk] || 0) + 1);
    delete S.tomb[tk];
    S[col][id] = rec;
    return true;
  }

  function del(S, col, id, now) {
    id = String(id);
    var old = S[col][id];
    if (!old) return false;
    S.tomb[col + ':' + id] = Math.max(now, u(old) + 1);
    delete S[col][id];
    return true;
  }

  /* local — состояние устройства, remote — таблицы. Результат не зависит от порядка ключей. */
  function merge(local, remote) {
    var A = normalize(local), B = normalize(remote), R = blank();
    var tomb = Object.assign({}, A.tomb);
    Object.keys(B.tomb).forEach(function (k) { tomb[k] = Math.max(tomb[k] || 0, B.tomb[k]); });
    NAMES.forEach(function (n) {
      var ids = {};
      Object.keys(A[n]).concat(Object.keys(B[n])).forEach(function (id) { ids[id] = 1; });
      Object.keys(ids).forEach(function (id) {
        var a = A[n][id], b = B[n][id], w;
        if (!a) w = b; else if (!b) w = a;
        else if (u(a) !== u(b)) w = u(a) > u(b) ? a : b;
        else w = sig(a) === sig(b) ? a : b;
        var tk = n + ':' + id;
        if (tk in tomb && tomb[tk] >= u(w)) return;
        R[n][id] = w;
      });
    });
    /* Надгробие, которое проиграло более поздней правке, больше не нужно. */
    Object.keys(tomb).forEach(function (k) {
      var i = k.indexOf(':'), n = k.slice(0, i), id = k.slice(i + 1);
      if (R[n] && R[n][id]) delete tomb[k];
    });
    R.tomb = tomb;
    return R;
  }

  function equal(a, b) { return stable(normalize(a)) === stable(normalize(b)); }

  /* Удобные выборки для интерфейса. */
  function list(S, col) { return Object.keys(S[col]).map(function (id) { return S[col][id]; }); }

  var SLOTS = ['завтрак', 'обед', 'перекус', 'ужин', 'с собой'];

  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /* Ключ продукта: явный key или первое значимое слово названия. */
  function productKey(item) {
    if (item.key) return norm(item.key);
    var w = norm(item.name).split(' ').filter(function (x) { return x.length > 2; });
    return w[0] || norm(item.name);
  }
  /* Что из дома подходит к позиции списка покупок. */
  function pantryMatches(S, item) {
    var k = productKey(item);
    if (!k) return [];
    var stem = k.length > 5 ? k.slice(0, k.length - 2) : k;
    return list(S, 'pantry').filter(function (p) { return norm(p.name).split(' ').some(function (w) { return w.indexOf(stem) === 0; }); });
  }

  /* Продукты рецепта: строки «— название — сколько» между «Продукты» и «Как готовить».
     В строке может быть несколько продуктов через запятую, варианты — через «или».
     Понимает и Markdown: «## Продукты», «**Продукты:**», пункты «* + 1.», выделение **, __, `. */
  function mdLine(ln) {
    return ln.trim().replace(/^#{1,6}\s+/, '').replace(/^(?:[*+]|\d{1,3}[.)])\s+/, '- ').replace(/\*\*|__|`/g, '').trim();
  }
  var STAPLE = /^(вода|кипят|соль|лавров|лед)/, NOFOOD = /(фольг|пергамент|рукав|коврик|противен|пленк|полотенц)/, STOP = { 'для': 1, 'или': 1, 'без': 1, 'под': 1 };
  function ingredients(text) {
    var out = [], on = false;
    String(text || '').split('\n').forEach(function (ln) {
      var t = mdLine(ln);
      if (/^продукты/i.test(t)) { on = true; return; }
      if (/^как готовить/i.test(t)) { on = false; return; }
      if (!on || !/^[—–-]\s/.test(t)) return;
      t.replace(/^[—–-]\s+/, '').split(/,\s*(?=[^,—]+\s—\s)/).forEach(function (seg) {
        var name = seg.split(' — ')[0].replace(/\([^)]*\)?/g, ' ').trim(), n = norm(name);
        if (!n || STAPLE.test(n) || NOFOOD.test(n)) return;
        out.push({ name: name, alts: name.split(/\s+или\s+/).map(function (a) { return a.trim(); }).filter(Boolean) });
      });
    });
    return out;
  }
  function words(s) { return norm(s).split(' ').filter(function (w) { return w.length > 2 && !STOP[w] && !/^\d/.test(w); }); }
  function stem(w) { return w.length > 5 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w; }
  /* Что из дома подходит к продукту рецепта: все значимые слова (до двух) есть в названии;
     одно слово — должно быть первым словом продукта дома; просроченное не считается. */
  function pantryFor(S, name, day) {
    var iw = words(name).slice(0, 2);
    if (!iw.length) return [];
    return list(S, 'pantry').filter(function (p) {
      if (day && p.until && p.until < day) return false;
      var pw = words(p.name), hit = function (w) { return pw.some(function (x) { return x.indexOf(stem(w)) === 0; }); };
      if (!pw.length) return false;
      if (iw.length === 1) return pw[0].indexOf(stem(iw[0])) === 0;
      return iw.every(hit) || (pw.length === 1 && iw.some(hit));
    });
  }
  /* Наличие продуктов рецепта: [{ name, home: [записи «Дома»] }]. */
  /* Рецепт к блюду из меню. Название рецепта без пояснения в скобках целиком (по словам) входит в текст блюда —
     берём самое длинное совпадение («Кейран-ччим (омлет на пару) + рис» → «Кейран-ччим»); иначе текст блюда
     входит в название рецепта («Плов» → «Плов с курицей»). Нет совпадений — null. */
  function recipeFor(S, text) {
    var t = norm(text), best = null, bl = 0, part = null;
    if (!t) return null;
    list(S, 'recipes').sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (r) {
      var k = norm(String(r.name || '').split('(')[0]);
      if (k.length < 3) return;
      if ((' ' + t + ' ').indexOf(' ' + k + ' ') >= 0) { if (k.length > bl) { best = r; bl = k.length; } }
      else if (!part && t.length >= 4 && (' ' + k + ' ').indexOf(' ' + t + ' ') >= 0) part = r;
    });
    return best || part;
  }
  function recipeStock(S, text, day) {
    return ingredients(text).map(function (g) {
      var home = [];
      g.alts.forEach(function (a) { pantryFor(S, a, day).forEach(function (p) { if (home.indexOf(p) < 0) home.push(p); }); });
      return { name: g.name, home: home };
    });
  }

  var api = {
    COLS: COLS, NAMES: NAMES, SLOTS: SLOTS, TOMB_TTL: TOMB_TTL, blank: blank, normalize: normalize, clean: clean, cast: cast,
    put: put, del: del, merge: merge, equal: equal, clone: clone, list: list, stable: stable,
    norm: norm, productKey: productKey, pantryMatches: pantryMatches, ingredients: ingredients, recipeStock: recipeStock, recipeFor: recipeFor, okId: okId
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MModel = api;
})(typeof self !== 'undefined' ? self : this);

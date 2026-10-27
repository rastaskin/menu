/* Синхронизация «Меню» с Google Таблицей. Без DOM — ядро гоняют node-тесты (tests/sync.test.js).
   Каждая коллекция — отдельный лист. Первая строка — заголовки (по-русски), дальше записи.
   Пустой _u в строке означает «правили руками или Claude»: такой записи ставится время синхронизации, и она побеждает.
   Номер ревизии таблицы лежит на листе «Настройки» в строке «_rev»: перед записью он перечитывается,
   и если кто-то успел записать раньше — проход повторяется (до 3 раз). */
(function (root) {
  'use strict';
  var M = (typeof module === 'object' && module.exports) ? require('./model.js') : root.MModel;

  var SHEETS = [
    { col: 'meals', title: 'Меню', head: [['id', 'id'], ['date', 'дата'], ['slot', 'приём'], ['text', 'блюдо'], ['done', 'съели'], ['_u', '_u']] },
    { col: 'days', title: 'Дни', head: [['id', 'id'], ['date', 'дата'], ['wd', 'день'], ['tags', 'события'], ['cook', 'готовка'], ['_u', '_u']] },
    { col: 'shop', title: 'Покупки', head: [['id', 'id'], ['week', 'неделя'], ['cat', 'раздел'], ['name', 'продукт'], ['qty', 'количество'], ['price', 'цена'], ['bought', 'куплено'], ['skip', 'есть дома'], ['moved', 'перенесено домой'], ['key', 'ключ'], ['_u', '_u']] },
    { col: 'pantry', title: 'Дома', head: [['id', 'id'], ['name', 'продукт'], ['qty', 'количество'], ['place', 'где'], ['until', 'годен до'], ['note', 'заметка'], ['_u', '_u']] },
    { col: 'recipes', title: 'Рецепты', head: [['id', 'id'], ['name', 'название'], ['text', 'как готовить'], ['_u', '_u']] },
    { col: 'rules', title: 'Правила', head: [['id', 'id'], ['title', 'правило'], ['text', 'текст'], ['_u', '_u']] },
    { col: 'meta', title: 'Настройки', head: [['id', 'ключ'], ['value', 'значение'], ['_u', '_u']] },
    { col: 'tomb', title: 'Удалено', head: [['id', 'запись'], ['_u', '_u']] },
    { col: 'family', title: 'Семья', head: [['id', 'id'], ['name', 'имя'], ['color', 'цвет'], ['enc', 'данные (зашифровано)'], ['_u', '_u']] }
  ];
  var DATE_FIELDS = { date: 1, until: 1 };
  var SLOT_ORDER = {}; M.SLOTS.forEach(function (s, i) { SLOT_ORDER[s] = i; });

  function serialToDate(n) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  /* «27.10.2026» → «2026-10-27» */
  function normDate(v) {
    if (typeof v === 'number') return serialToDate(v);
    var s = String(v == null ? '' : v).trim(), m;
    if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return s;
  }

  /* Лист → записи коллекции. stamp — время для строк с пустым _u. */
  function decodeSheet(sh, values, stamp) {
    var out = { recs: [], rows: (values || []).length, rev: 0, stamped: false };
    if (!values || !values.length) return out;
    var hdr = values[0].map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
    var idx = {};
    sh.head.forEach(function (p) {
      var i = hdr.indexOf(p[1].toLowerCase()); if (i < 0) i = hdr.indexOf(p[0].toLowerCase());
      if (i >= 0) idx[p[0]] = i;
    });
    if (!('id' in idx)) return out;
    for (var r = 1; r < values.length; r++) {
      var row = values[r] || [], o = {};
      Object.keys(idx).forEach(function (f) { var v = row[idx[f]]; if (v !== undefined && v !== '') o[f] = v; });
      if (o.id == null || String(o.id).trim() === '') continue;
      o.id = String(o.id).trim();
      if (!M.okId(o.id)) continue;
      if (sh.col === 'meta' && o.id === '_rev') { out.rev = +o.value || 0; continue; }
      Object.keys(DATE_FIELDS).forEach(function (f) { if (o[f] != null) o[f] = normDate(o[f]); });
      var uu = +o._u;
      if (!uu) { o._u = stamp; out.stamped = true; } else o._u = uu;
      out.recs.push(o);
    }
    return out;
  }

  /* Все листы → {S, counts, rev, stamped}. valueRanges — ответ values:batchGet в порядке SHEETS. */
  function decodeAll(valueRanges, stamp) {
    var S = M.blank(), counts = {}, rev = 0, stamped = false;
    SHEETS.forEach(function (sh, i) {
      var vr = valueRanges[i] || {}, d = decodeSheet(sh, vr.values, stamp);
      counts[sh.title] = d.rows; stamped = stamped || d.stamped;
      if (sh.col === 'meta') rev = d.rev;
      if (sh.col === 'tomb') d.recs.forEach(function (r) { S.tomb[r.id] = r._u; });
      else d.recs.forEach(function (r) { S[sh.col][r.id] = M.clean(sh.col, r); });
    });
    return { S: S, counts: counts, rev: rev, stamped: stamped };
  }

  function sortRecs(col, recs) {
    function k(r) {
      if (col === 'meals') return (r.date || '') + '|' + ('0' + (SLOT_ORDER[r.slot] != null ? SLOT_ORDER[r.slot] : 9)).slice(-2) + '|' + r.id;
      if (col === 'days') return (r.date || r.id);
      if (col === 'shop') return ('00' + (r.week || 0)).slice(-3) + '|' + r.id;
      if (col === 'pantry') return (r.place || '') + '|' + (r.name || '');
      return r.id;
    }
    return recs.sort(function (a, b) { var x = k(a), y = k(b); return x < y ? -1 : x > y ? 1 : 0; });
  }

  /* Состояние → данные для values:batchUpdate. counts — сколько строк было, лишние затираются пустыми. */
  function encodeAll(S, counts, rev) {
    return SHEETS.map(function (sh) {
      var rows = [sh.head.map(function (p) { return p[1]; })], recs;
      if (sh.col === 'tomb') recs = Object.keys(S.tomb).sort().map(function (k) { return { id: k, _u: S.tomb[k] }; });
      else recs = sortRecs(sh.col, M.list(S, sh.col).slice());
      recs.forEach(function (r) {
        rows.push(sh.head.map(function (p) {
          var v = r[p[0]];
          if (typeof v === 'boolean') return v;
          return v == null ? '' : v;
        }));
      });
      if (sh.col === 'meta') rows.push(['_rev', rev, '']);
      var old = (counts && counts[sh.title]) || 0;
      while (rows.length < old) rows.push(sh.head.map(function () { return ''; }));
      return { range: "'" + sh.title + "'!A1", values: rows };
    });
  }

  /* Google Sheets REST. fx — fetch, token() — access token или исключение со status 401. */
  function sheetsApi(fx, token, id) {
    var base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id);
    async function call(url, init) {
      init = init || {};
      var t = await token();
      var r = await fx(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + t }, init.headers || {}) }));
      if (!r.ok) { var e = new Error('sheets ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }
    function ranges(list) { return list.map(function (t) { return 'ranges=' + encodeURIComponent("'" + t + "'"); }).join('&'); }
    return {
      info: function () { return call(base + '?fields=properties.title,sheets.properties.title'); },
      addSheets: function (titles) {
        return call(base + ':batchUpdate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: titles.map(function (t) { return { addSheet: { properties: { title: t } } }; }) }) });
      },
      read: async function () {
        var j = await call(base + '/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&' + ranges(SHEETS.map(function (s) { return s.title; })));
        return j.valueRanges || [];
      },
      readRev: async function () {
        var j = await call(base + '/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&' + ranges(['Настройки']));
        return decodeSheet(SHEETS[6], (j.valueRanges && j.valueRanges[0] && j.valueRanges[0].values) || [], 0).rev;
      },
      write: function (data) {
        return call(base + '/values:batchUpdate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ valueInputOption: 'RAW', data: data }) });
      }
    };
  }

  /* Один проход синхронизации.
     c.api — sheetsApi; c.get() — текущее локальное состояние; c.persist(S) — сохранить слитое локально;
     c.now() — время. Возвращает {status:'ok'|'busy', changed, uploaded, rev, title}. */
  async function run(c) {
    var info = await c.api.info();
    var have = ((info && info.sheets) || []).map(function (s) { return s.properties.title; });
    var missing = SHEETS.map(function (s) { return s.title; }).filter(function (t) { return have.indexOf(t) < 0; });
    if (missing.length) await c.api.addSheets(missing);
    var changed = false;
    for (var i = 0; i < 3; i++) {
      var R = decodeAll(await c.api.read(), c.now());
      var L = c.get();
      var Mg = M.merge(L, R.S);
      if (!M.equal(Mg, L)) { changed = true; await c.persist(Mg); }
      if (M.equal(Mg, R.S) && !R.stamped) return { status: 'ok', changed: changed, rev: R.rev, title: info.properties && info.properties.title };
      var rev2 = await c.api.readRev();
      if (rev2 !== R.rev) continue;
      await c.api.write(encodeAll(Mg, R.counts, R.rev + 1));
      return { status: 'ok', changed: changed, uploaded: true, rev: R.rev + 1, title: info.properties && info.properties.title };
    }
    return { status: 'busy', changed: changed };
  }

  /* Ссылка или id таблицы → id. */
  function parseSheetId(s) {
    s = String(s || '').trim();
    var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[#&?]sheet=([a-zA-Z0-9_-]{20,})/) || s.match(/^([a-zA-Z0-9_-]{20,})$/);
    return m ? m[1] : '';
  }

  var api = { SHEETS: SHEETS, decodeSheet: decodeSheet, decodeAll: decodeAll, encodeAll: encodeAll, sheetsApi: sheetsApi, run: run, parseSheetId: parseSheetId, normDate: normDate };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MSheets = api;
})(typeof self !== 'undefined' ? self : this);

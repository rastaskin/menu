/* Поддельный Google Sheets API в памяти: info, addSheet, values:batchGet, values:batchUpdate.
   Хранит значения как массивы строк, как настоящий API (UNFORMATTED_VALUE, RAW). */
function fakeSheets(title) {
  var book = { title: title || 'Меню — тест', sheets: {} }, log = [];
  function rangeTitle(r) { var m = /^'?(.*?)'?(!.*)?$/.exec(r); return m ? m[1] : r; }
  async function fx(url, init) {
    init = init || {}; var u = new URL(url), p = decodeURIComponent(u.pathname), method = init.method || 'GET';
    log.push(method + ' ' + p);
    function ok(j) { return { ok: true, status: 200, json: async function () { return j; } }; }
    if (book.fail) { var s = book.fail; book.fail = 0; return { ok: false, status: s, json: async function () { return {}; } }; }
    if (/:batchUpdate$/.test(p) && !/values:/.test(p)) {
      JSON.parse(init.body).requests.forEach(function (r) { if (r.addSheet) book.sheets[r.addSheet.properties.title] = book.sheets[r.addSheet.properties.title] || []; });
      return ok({});
    }
    if (/values:batchGet$/.test(p)) {
      var rs = u.searchParams.getAll('ranges');
      return ok({ valueRanges: rs.map(function (r) { var v = book.sheets[rangeTitle(r)]; var vv = (v || []).slice(); while (vv.length && vv[vv.length - 1].every(function (c) { return c === ''; })) vv.pop(); return vv.length ? { range: r, values: JSON.parse(JSON.stringify(vv)) } : { range: r }; }) });
    }
    if (/values:batchUpdate$/.test(p)) {
      JSON.parse(init.body).data.forEach(function (d) {
        var t = rangeTitle(d.range), cur = book.sheets[t] || [];
        d.values.forEach(function (row, i) { cur[i] = row.map(function (c) { return c; }); });
        book.sheets[t] = cur;
      });
      return ok({});
    }
    if (method === 'GET') return ok({ properties: { title: book.title }, sheets: Object.keys(book.sheets).map(function (t) { return { properties: { title: t } }; }) });
    return { ok: false, status: 400, json: async function () { return {}; } };
  }
  return { fx: fx, book: book, log: log };
}
module.exports = { fakeSheets: fakeSheets };

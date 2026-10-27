/* QR-код для ссылки «Добавить устройство»: байтовый режим, уровень коррекции M, версии 1–10.
   Свой код без библиотек (алгоритм по ISO/IEC 18004; проверяется декодером в tests/qr.test.js).
   MQR.svg(text) → строка <svg>; MQR.matrix(text) → массив строк из true/false. */
(function (root) {
  'use strict';
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // уровень M, версии 1–10
  var BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(v) { return Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v]; }

  function gmul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var rt = 1;
    for (var k = 0; k < deg; k++) {
      for (var j = 0; j < r.length; j++) { r[j] = gmul(r[j], rt); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      rt = gmul(rt, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gmul(c, f); });
    });
    return r;
  }

  function encode(text) {
    var bytes = Array.from(new TextEncoder().encode(text)), v = 1;
    for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break;
    if (v > 10) throw new Error('too long');
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(v) * 8;
    put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = []; for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    // блоки с коррекцией и чередование
    var nb = BLOCKS[v], ecl = ECC_PER_BLOCK[v], raw = Math.floor(rawModules(v) / 8), shortN = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(ecl), blocks = [], k = 0;
    for (var bi = 0; bi < nb; bi++) {
      var dat = data.slice(k, k + shortLen - ecl + (bi < shortN ? 0 : 1)); k += dat.length;
      var ecc = rsRemainder(dat, div); if (bi < shortN) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var code = [];
    for (var ci = 0; ci < blocks[0].length; ci++) blocks.forEach(function (bl, bj) { if (ci !== shortLen - ecl || bj >= shortN) code.push(bl[ci]); });
    return { v: v, code: code };
  }

  function matrix(text) {
    var e = encode(text), v = e.v, size = v * 4 + 17, m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, d) { m[y][x] = d; fn[y][x] = true; }
    for (var t = 0; t < size; t++) { setF(6, t, t % 2 === 0); setF(t, 6, t % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = c[0] + dx, yy = c[1] + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    });
    if (v > 1) {
      var n = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
      for (var p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      pos.forEach(function (ay, i) {
        pos.forEach(function (ax, j) {
          if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
          for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        });
      });
    }
    function format(mask) {
      var d = (0 << 3) | mask, r = d;                     // уровень M = 00
      for (var i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var bits = ((d << 10) | r) ^ 0x5412, bit = function (i) { return ((bits >>> i) & 1) !== 0; };
      for (var a = 0; a <= 5; a++) setF(8, a, bit(a));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (var b = 9; b < 15; b++) setF(14 - b, 8, bit(b));
      for (var c = 0; c < 8; c++) setF(size - 1 - c, 8, bit(c));
      for (var g = 8; g < 15; g++) setF(8, size - 15 + g, bit(g));
      setF(8, size - 8, true);
    }
    format(0);
    if (v >= 7) {
      var r = v; for (var i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vb = (v << 12) | r;
      for (var q = 0; q < 18; q++) { var on = ((vb >>> q) & 1) !== 0, aa = size - 11 + q % 3, bb = Math.floor(q / 3); setF(aa, bb, on); setF(bb, aa, on); }
    }
    // данные змейкой
    var idx = 0, total = e.code.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var x = right - jj, up = ((right + 1) & 2) === 0, yy2 = up ? size - 1 - vert : vert;
        if (!fn[yy2][x] && idx < total) { m[yy2][x] = ((e.code[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0; idx++; }
      }
    }
    // маска: из восьми берём ту, что даёт меньший штраф (правила 1, 2 и 4 стандарта)
    var MASKS = [
      function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; }, function (x) { return x % 3 === 0; },
      function (x, y) { return (x + y) % 3 === 0; }, function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return x * y % 2 + x * y % 3 === 0; }, function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
    ];
    function apply(mk) { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && MASKS[mk](x, y)) m[y][x] = !m[y][x]; }
    function penalty() {
      var s = 0, dark = 0;
      for (var y = 0; y < size; y++) for (var dir = 0; dir < 2; dir++) {
        var run = 1;
        for (var x = 1; x <= size; x++) {
          var same = x < size && (dir ? m[x][y] === m[x - 1][y] : m[y][x] === m[y][x - 1]);
          if (same) run++; else { if (run >= 5) s += run - 2; run = 1; }
        }
      }
      for (var y2 = 0; y2 < size - 1; y2++) for (var x2 = 0; x2 < size - 1; x2++) {
        var c = m[y2][x2]; if (c === m[y2][x2 + 1] && c === m[y2 + 1][x2] && c === m[y2 + 1][x2 + 1]) s += 3;
      }
      m.forEach(function (row) { row.forEach(function (c) { if (c) dark++; }); });
      return s + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    }
    var best = 0, bestP = Infinity;
    for (var mk = 0; mk < 8; mk++) { apply(mk); format(mk); var pp = penalty(); if (pp < bestP) { bestP = pp; best = mk; } apply(mk); }
    apply(best); format(best);
    return m;
  }

  function svg(text) {
    var m = matrix(text), n = m.length, q = 4, d = '';
    m.forEach(function (row, y) { row.forEach(function (c, x) { if (c) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z'; }); });
    return '<svg class="qr" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" role="img" aria-label="QR-код ссылки для нового устройства" shape-rendering="crispEdges">' +
      '<rect width="100%" height="100%" class="qr-bg"/><path d="' + d + '" class="qr-fg"/></svg>';
  }

  var api = { matrix: matrix, svg: svg };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MQR = api;
})(typeof self !== 'undefined' ? self : this);

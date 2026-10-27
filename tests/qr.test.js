const test = require('node:test');
const assert = require('node:assert');
const Q = require('../web/qr.js');
const jsQR = require('jsqr');

/* матрица → картинка RGBA с полем и масштабом → декодер должен прочитать исходный текст */
function decode(m, scale = 6, quiet = 4) {
  const n = m.length, w = (n + 2 * quiet) * scale, px = new Uint8ClampedArray(w * w * 4).fill(255);
  m.forEach((row, y) => row.forEach((c, x) => {
    if (!c) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }));
  const r = jsQR(px, w, w); return r && r.data;
}

test('QR: ссылки разной длины читаются декодером', () => {
  for (const t of ['A', 'https://example.org/menu/#join=AbCdEfGhIjKlMnOpQrStUv', 'x'.repeat(100), 'https://rastaskin.github.io/menu/#join=' + 'Z'.repeat(22) + '&more=' + 'y'.repeat(120)]) {
    const m = Q.matrix(t);
    assert.equal(decode(m), t, 'версия ' + ((m.length - 17) / 4));
  }
  assert.match(Q.svg('hi'), /^<svg class="qr"/);
  assert.throws(() => Q.matrix('x'.repeat(300)));
});

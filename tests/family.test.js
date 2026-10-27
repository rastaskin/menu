const test = require('node:test');
const assert = require('node:assert');
const F = require('../web/family.js');

test('ключ семьи: код и 12 слов возвращают тот же ключ', async () => {
  const r = F.newRoot();
  assert.deepEqual(F.fromCode('https://example.org/menu/#join=' + F.toCode(r)), r);
  const words = await F.toWords(r);
  assert.equal(words.split(' ').length, 12);
  assert.deepEqual(await F.fromWords(words.toUpperCase()), r);
  assert.equal(await F.fromWords(words.split(' ').slice(0, 11).join(' ')), null);
  assert.equal(await F.fromWords('abandon '.repeat(12)), null, 'контрольная сумма ловит опечатку');
  assert.equal(await F.fromWords('abandon '.repeat(11) + 'nosuchword'), null);
  assert.equal(F.fromCode('#join=short'), null);
});

test('ключ семьи: известный вектор BIP39', async () => {
  const zero = new Uint8Array(16);
  assert.equal(await F.toWords(zero), 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
});

test('ключ семьи: запись шифруется, имя скрыто, подмена ловится', async () => {
  const keys = await F.derive(F.newRoot()), other = await F.derive(F.newRoot());
  assert.match(keys.fid, /^[0-9a-f]{32}$/); assert.ok(keys.auth.length >= 43);
  const it = await F.seal(keys, { c: 'family', id: 'f-1', r: { id: 'f-1', name: 'Член семьи', _u: 5 } });
  assert.match(it.k, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(it.ct + it.k, /family|f-1|Член/);
  assert.deepEqual((await F.open(keys, it)).r.name, 'Член семьи');
  await assert.rejects(F.open(other, it), 'чужой ключ не открывает');
  const it2 = await F.seal(keys, { c: 'meals', id: 'm1', r: { id: 'm1', _u: 1 } });
  await assert.rejects(F.open(keys, { k: it2.k, ct: it.ct }), 'шифр под чужим именем не принимается');
});

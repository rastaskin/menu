const test = require('node:test');
const assert = require('node:assert');
const V = require('../web/vault.js');
const M = require('../web/model.js');

test('семья: шифр карточки расшифровывается тем же паролем и только им', async () => {
  const salt = V.newSalt();
  const key = await V.deriveKey('пароль семьи', salt);
  const card = { allergies: 'арахис, киви', weight: '64,5', note: 'без острого' };
  const enc = await V.seal(key, card, 'f1');
  assert.match(enc, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.doesNotMatch(enc, /арахис|64,5/);
  assert.deepEqual(await V.open(key, enc, 'f1'), card);

  const wrong = await V.deriveKey('другой пароль', salt);
  await assert.rejects(V.open(wrong, enc, 'f1'));
  await assert.rejects(V.open(key, enc, 'f2'), 'шифр одной карточки не подходит к другой');

  const check = await V.makeCheck(key);
  assert.equal(await V.verify(key, check), true);
  assert.equal(await V.verify(wrong, check), false);
});

test('семья: служебные id из таблицы отбрасываются', () => {
  const S = M.normalize({ family: [{ id: '__proto__', name: 'x' }, { id: 'f1', name: 'Член семьи' }], tomb: { '__proto__': 5 } });
  assert.deepEqual(Object.keys(S.family), ['f1']);
  assert.equal(Object.getPrototypeOf(S.family), Object.prototype);
  assert.equal(M.put(S, 'family', 'constructor', { name: 'x' }, 1), false);
});

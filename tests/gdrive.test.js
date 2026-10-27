const test = require('node:test'), assert = require('node:assert');
const G = require('../web/gdrive.js'), { fakeDrive } = require('./fake-drive.js');
const tok = async () => 'tok';

test('Google Диск: ключ семьи сохраняется, перезаписывается, читается и удаляется', async () => {
  const d = fakeDrive();
  assert.equal(await G.load(d.fx, tok), '', 'пока пусто');
  await G.save(d.fx, tok, 'A'.repeat(22));
  await G.save(d.fx, tok, 'B'.repeat(22));
  assert.equal(d.files.size, 1, 'второй раз файл обновляется, а не плодится');
  assert.equal(await G.load(d.fx, tok), 'B'.repeat(22));
  await G.forget(d.fx, tok);
  assert.equal(await G.load(d.fx, tok), '');
});

test('Google Диск: токен без drive.appdata — ошибка с причиной', async () => {
  const d = fakeDrive(); d.state.scopeOk = false;
  await assert.rejects(G.load(d.fx, tok), (e) => e.status === 403 && e.reason === 'insufficientPermissions');
});

/* Ключ семьи в Google Диске: файл menu-family.json в скрытой папке приложения (appDataFolder, доступ drive.appdata).
   Так свои устройства одного Google-аккаунта входят в семью без ссылки. Папку видит только это приложение,
   но ключ лежит у Google открытым кодом — это слабее ссылки и 12 слов; пользователь выбрал это сознательно.
   Без DOM: гоняют node-тесты (tests/gdrive.test.js). fx — fetch, token() — access token или исключение со status 401. */
(function (root) {
  'use strict';
  var API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files', NAME = 'menu-family.json';

  async function call(fx, token, url, init) {
    init = init || {};
    var t = await token();
    var r = await fx(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + t }, init.headers || {}) }));
    if (!r.ok) {
      var e = new Error('drive ' + r.status); e.status = r.status;
      try { var j = await r.json(); e.reason = j && j.error && ((j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || j.error.status) || ''; } catch (x) { e.reason = ''; }
      throw e;
    }
    return r;
  }
  async function find(fx, token) {
    var q = encodeURIComponent("name='" + NAME + "'");
    var j = await (await call(fx, token, API + '?spaces=appDataFolder&fields=files(id)&q=' + q)).json();
    return (j.files && j.files[0] && j.files[0].id) || '';
  }
  /* код семьи из Google или '' */
  async function load(fx, token) {
    var id = await find(fx, token);
    if (!id) return '';
    var o = await (await call(fx, token, API + '/' + encodeURIComponent(id) + '?alt=media')).json();
    return o && typeof o.code === 'string' ? o.code : '';
  }
  async function save(fx, token, code) {
    var body = JSON.stringify({ v: 1, code: code, at: new Date().toISOString() }), id = await find(fx, token);
    if (id) return call(fx, token, UP + '/' + encodeURIComponent(id) + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body });
    var b = 'menu' + Math.random().toString(36).slice(2);
    var multi = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: NAME, parents: ['appDataFolder'] }) +
      '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
    return call(fx, token, UP + '?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multi });
  }
  async function forget(fx, token) {
    var id = await find(fx, token);
    if (id) await call(fx, token, API + '/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  var api = { NAME: NAME, load: load, save: save, forget: forget };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MGDrive = api;
})(typeof self !== 'undefined' ? self : this);

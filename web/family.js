/* Ключ семьи и шифрование записей для релея (docs/LOCAL-FIRST.md).
   root — 16 случайных байт. Из него HKDF-SHA-256 выводит: ключ AES-GCM-256 для записей, ключ HMAC для их имён,
   адрес семьи на релее (fid) и пропуск (auth). Сам root — в ссылке #join=… (фрагмент не уходит на сервер)
   и в 12 словах BIP39. Без DOM: работает в браузере, в Tauri и в node-тестах. */
(function (root) {
  'use strict';
  var C = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
  var WORDS = root.MBip39 || (typeof require === 'function' ? require('./bip39-en.js') : null);
  var te = new TextEncoder(), td = new TextDecoder();

  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64url(u8) { return b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return unb64(s); }
  function hex(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += ('0' + u8[i].toString(16)).slice(-2); return s; }

  function newRoot() { return C.getRandomValues(new Uint8Array(16)); }

  /* ссылка-приглашение и обратно; принимает целую ссылку, «#join=…» или сам код */
  function toCode(r) { return b64url(r); }
  function fromCode(s) {
    var m = String(s || '').trim().match(/(?:#join=)?([A-Za-z0-9_-]{22})$/);
    if (!m) return null;
    try { var r = unb64url(m[1]); return r.length === 16 ? r : null; } catch (e) { return null; }
  }

  /* 12 слов BIP39: 128 бит + 4 бита контрольной суммы */
  async function toWords(r) {
    var cs = new Uint8Array(await C.subtle.digest('SHA-256', r))[0] >> 4, bits = '';
    for (var i = 0; i < r.length; i++) bits += ('00000000' + r[i].toString(2)).slice(-8);
    bits += ('0000' + cs.toString(2)).slice(-4);
    var out = []; for (var j = 0; j < 12; j++) out.push(WORDS[parseInt(bits.slice(j * 11, j * 11 + 11), 2)]);
    return out.join(' ');
  }
  async function fromWords(s) {
    var w = String(s || '').toLowerCase().trim().split(/\s+/);
    if (w.length !== 12) return null;
    var bits = '';
    for (var i = 0; i < 12; i++) { var n = WORDS.indexOf(w[i]); if (n < 0) return null; bits += ('00000000000' + n.toString(2)).slice(-11); }
    var r = new Uint8Array(16); for (var j = 0; j < 16; j++) r[j] = parseInt(bits.slice(j * 8, j * 8 + 8), 2);
    var cs = new Uint8Array(await C.subtle.digest('SHA-256', r))[0] >> 4;
    return cs === parseInt(bits.slice(128), 2) ? r : null;
  }

  /* HKDF: ключи и идентификаторы семьи */
  async function derive(r) {
    var base = await C.subtle.importKey('raw', r, 'HKDF', false, ['deriveKey', 'deriveBits']);
    function info(label) { return { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('menu ' + label + ' v1') }; }
    var enc = await C.subtle.deriveKey(info('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    var name = await C.subtle.deriveKey(info('name'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    var fid = hex(new Uint8Array(await C.subtle.deriveBits(info('fid'), base, 128)));
    var auth = b64url(new Uint8Array(await C.subtle.deriveBits(info('auth'), base, 256)));
    return { enc: enc, name: name, fid: fid, auth: auth };
  }

  /* имя записи на релее: HMAC от «коллекция:id» — релей не видит ни коллекций, ни id */
  async function recKey(keys, col, id) { return hex(new Uint8Array(await C.subtle.sign('HMAC', keys.name, te.encode(col + ':' + id)))); }

  /* запись → {k, ct}; payload — {c, id, r} или надгробие {c, id, t}; AAD = k */
  async function seal(keys, payload) {
    var k = await recKey(keys, payload.c, payload.id), iv = C.getRandomValues(new Uint8Array(12));
    var ct = await C.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode(k) }, keys.enc, te.encode(JSON.stringify(payload)));
    return { k: k, ct: 'v1.' + b64(iv) + '.' + b64(new Uint8Array(ct)) };
  }
  async function open(keys, item) {
    var p = String(item.ct || '').split('.');
    if (p.length !== 3 || p[0] !== 'v1') throw new Error('format');
    var pt = await C.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p[1]), additionalData: te.encode(item.k) }, keys.enc, unb64(p[2]));
    var o = JSON.parse(td.decode(pt));
    if ((await recKey(keys, o.c, o.id)) !== item.k) throw new Error('name');   // запись под чужим именем
    return o;
  }

  var api = { newRoot: newRoot, toCode: toCode, fromCode: fromCode, toWords: toWords, fromWords: fromWords, derive: derive, recKey: recKey, seal: seal, open: open, b64url: b64url };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MFamily = api;
})(typeof self !== 'undefined' ? self : this);

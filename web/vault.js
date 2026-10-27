/* Шифрование данных о здоровье в карточках семьи (аллергии, вес, заметка).
   Семейный пароль → PBKDF2-SHA-256, 600 000 итераций, соль из листа «Настройки» (fam_salt) → ключ AES-GCM-256.
   Ключ не извлекается из браузера; в таблице лежит только шифротекст «v1.<iv>.<данные>».
   Проверочная строка fam_check позволяет сказать «пароль неверный», не расшифровывая карточки.
   Без DOM: работает в браузере, в Tauri и в node-тестах (globalThis.crypto). */
(function (root) {
  'use strict';
  var ITER = 600000, CHECK = 'menu-family-v1';
  var C = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);

  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  function newSalt() { return b64(C.getRandomValues(new Uint8Array(16))); }

  async function deriveKey(pass, saltB64) {
    var base = await C.subtle.importKey('raw', new TextEncoder().encode(String(pass).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return C.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* id записи — дополнительные данные AES-GCM: шифр одной карточки нельзя подложить в другую */
  async function seal(key, obj, id) {
    var iv = C.getRandomValues(new Uint8Array(12));
    var ct = await C.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: new TextEncoder().encode(String(id || '')) },
      key, new TextEncoder().encode(JSON.stringify(obj)));
    return 'v1.' + b64(iv) + '.' + b64(new Uint8Array(ct));
  }
  async function open(key, str, id) {
    var p = String(str || '').split('.');
    if (p.length !== 3 || p[0] !== 'v1') throw new Error('format');
    var pt = await C.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p[1]), additionalData: new TextEncoder().encode(String(id || '')) },
      key, unb64(p[2]));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function makeCheck(key) { return seal(key, CHECK, 'fam_check'); }
  async function verify(key, check) { try { return (await open(key, check, 'fam_check')) === CHECK; } catch (e) { return false; } }

  var api = { ITER: ITER, newSalt: newSalt, deriveKey: deriveKey, seal: seal, open: open, makeCheck: makeCheck, verify: verify };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MVault = api;
})(typeof self !== 'undefined' ? self : this);

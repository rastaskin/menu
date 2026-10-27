/* «Меню» — интерфейс. Без фреймворков. Данные: IndexedDB (локально, сохраняется при каждом изменении)
   + Google Таблица (синхронизация между устройствами семьи; таблицу можно править и руками). */
(function () {
  'use strict';
  var M = window.MModel, SH = window.MSheets, CFG = window.MCONFIG || {};
  var SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  var AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  var $app = document.getElementById('app');

  var S = M.blank();                 // состояние
  var SY = {};                       // {sheetId, title, rev, at, authed}
  var UI = { tab: 'menu', week: null, shopWeek: null, q: '', status: 'none', err: '' };
  var editSeq = 0, syncing = false, again = false, syncTimer = null;

  /* ---------- хранилище: IndexedDB, запасной вариант — localStorage ---------- */
  var store = (function () {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        try {
          var r = indexedDB.open('menu-app', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        } catch (e) { rej(e); }
      });
      return dbp;
    }
    function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('menu.' + k) || 'null'); localStorage.setItem('menu.' + k, JSON.stringify(v)); } catch (e) { return null; } }
    return {
      get: async function (k) {
        try { var d = await db(); return await new Promise(function (res, rej) { var q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result == null ? null : q.result); }; q.onerror = function () { rej(q.error); }; }); }
        catch (e) { return ls(k); }
      },
      set: async function (k, v) {
        try { var d = await db(); await new Promise(function (res, rej) { var t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = function () { rej(t.error); }; }); }
        catch (e) { ls(k, v); }
      }
    };
  })();
  function lsGet(k) { try { return JSON.parse(localStorage.getItem('menu.' + k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem('menu.' + k); else localStorage.setItem('menu.' + k, JSON.stringify(v)); } catch (e) { } }

  /* Двойная запись: localStorage — синхронно (переживёт мгновенное закрытие), IndexedDB — основная копия. */
  async function saveState() { lsSet('state', S); await store.set('state', S); }
  async function saveSync() { await store.set('sync', SY); }

  /* ---------- утилиты ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  function parseD(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function dm(s) { var d = parseD(s); return d ? ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) : esc(s); }
  function wd(s) { var d = parseD(s); return d ? WD[d.getDay()] : ''; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function rub(n) { return (Math.round(n || 0)).toLocaleString('ru-RU') + ' ₽'; }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function ago(t) {
    if (!t) return 'никогда'; var s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'только что'; if (s < 3600) return Math.round(s / 60) + ' мин назад';
    if (s < 86400) return Math.round(s / 3600) + ' ч назад'; return new Date(t).toLocaleDateString('ru-RU');
  }
  var TAGK = { 'а': 'a', 'a': 'a', 'г': 'g', 'g': 'g', 'з': 'z', 'z': 'z', 'п': 'h', 'h': 'h' };
  /* «a:Учёба 9:00–15:30; z:ужин из заготовки» → [{k,t}] */
  function tags(s) {
    return String(s || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
      var m = /^([a-zа-я]):\s*(.+)$/i.exec(x); return m ? { k: TAGK[m[1].toLowerCase()] || 'o', t: m[2] } : { k: 'o', t: x };
    });
  }
  /* Иконки интерфейса — свои, линейные; иконки продуктов — спрайт (foodicons.js). */
  var F = window.MFood;
  function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }
  var DOT = 'fill="currentColor" stroke="none"';
  var ICO = {
    menu: svg('<path d="M5 3v7a3 3 0 0 0 6 0V3M8 3v18M18 21V3c-2.5 0-4.5 3-4.5 7s1.5 4.5 4.5 4.5"/>'),
    shop: svg('<path d="M3 4h2.2l2 10.4a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.5L20.5 8H6"/><circle cx="10" cy="20" r="1.3" ' + DOT + '/><circle cx="17" cy="20" r="1.3" ' + DOT + '/>'),
    home: svg('<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M5 9.5h14M8.5 5.5v1.5M8.5 12.5v3"/>'),
    recipes: svg('<path d="M5 19.5V5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12M9 7.5h6M9 11h4"/>'),
    more: svg('<circle cx="5" cy="12" r="1.6" ' + DOT + '/><circle cx="12" cy="12" r="1.6" ' + DOT + '/><circle cx="19" cy="12" r="1.6" ' + DOT + '/>'),
    freezer: svg('<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8M9.5 4 12 6.5 14.5 4M9.5 20 12 17.5 14.5 20"/>'),
    shelf: svg('<path d="M3.5 4h17M3.5 12h17M3.5 20h17M6 12V8.5h4V12M14 20v-4.5h4V20"/>'),
    pot: svg('<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h2M20 10h2M9.5 6.5c0-1.2 1-1.2 1-2.5M13.5 6.5c0-1.2 1-1.2 1-2.5"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    dots: svg('<circle cx="6" cy="12" r="1.5" ' + DOT + '/><circle cx="12" cy="12" r="1.5" ' + DOT + '/><circle cx="18" cy="12" r="1.5" ' + DOT + '/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>')
  };

  /* ---------- свои картинки: хранятся только на этом устройстве (IndexedDB), в таблицу не уходят ---------- */
  var IMG = {};
  function imgKey(kind, k) { return kind + ':' + M.norm(k); }
  function pic(kind, k, text, cls) {
    var u = IMG[imgKey(kind, k)];
    return u ? '<img class="fi fi-img' + (cls ? ' ' + cls : '') + '" src="' + u + '" alt="">' : F.html(text, cls);
  }
  /* блюдо в меню получает картинку рецепта, если название рецепта есть в тексте */
  function mealPic(text) {
    var t = M.norm(text), r = M.list(S, 'recipes').filter(function (x) { return x.name && IMG[imgKey('r', x.name)] && t.indexOf(M.norm(x.name).split(' (')[0]) >= 0; })[0];
    return r ? pic('r', r.name, text) : F.html(text);
  }
  /* файл → JPEG data URL; square — центральный квадрат (для картинок), иначе всё фото (для распознавания) */
  async function toJpeg(file, max, square) {
    var bmp; try { bmp = await createImageBitmap(file); } catch (e) { var er = new Error('format'); er.file = file.name; throw er; }
    var sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (square) { var s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
    var k = Math.min(1, max / Math.max(sw, sh)), c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  function picEditor(kind, k) {
    var has = IMG[imgKey(kind, k)];
    return '<div class="picrow">' + pic(kind, k, k, 'fi-l') +
      '<label class="btn ghost">' + (has ? 'Заменить картинку' : 'Своя картинка') + '<input type="file" accept="image/*" hidden data-input="pic" data-kind="' + kind + '" data-k="' + esc(k) + '"></label>' +
      (has ? '<button type="button" class="link danger" data-act="pic-del" data-kind="' + kind + '" data-k="' + esc(k) + '">Убрать</button>' : '') + '</div>';
  }
  function refreshPicRow(kind, k) {
    var el = document.querySelector('#modal .picrow'); if (el) el.outerHTML = picEditor(kind, k);
    pendingRender = true; store.set('imgs', IMG);
  }
  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WDL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var PLACES = [['fridge', 'Холодильник', ICO.home], ['freezer', 'Морозилка', ICO.freezer], ['shelf', 'Шкаф и полки', ICO.shelf]];
  var PLACE_RU = { 'холодильник': 'fridge', 'морозилка': 'freezer', 'шкаф': 'shelf', 'полка': 'shelf' };
  function placeKey(p) { p = String(p || '').toLowerCase(); if (PLACES.some(function (x) { return x[0] === p; })) return p; for (var k in PLACE_RU) if (p.indexOf(k) === 0) return PLACE_RU[k]; return 'shelf'; }
  function placeFor(i) {
    var n = String(i.name || '').toLowerCase(), cat = String(i.cat || '').toLowerCase();
    if (/яйц|тофу|крабов|тунец/.test(n)) return /тунец/.test(n) ? 'shelf' : 'fridge';
    if (/с\/м|заморож|фарш|бёдр|бедр|голен|печень|говядин|минтай|скумбри|рыб/.test(n) || /мяс|рыб/.test(cat)) return 'freezer';
    if (/молоч|овощ/.test(cat) || /зелень|огурц|кабач|шпинат/.test(n)) return /шпинат/.test(n) ? 'freezer' : 'fridge';
    return 'shelf';
  }

  /* ---------- изменения ---------- */
  function commit(fn) {
    var now = Date.now(), ch = false;
    fn({
      put: function (col, id, patch) { ch = M.put(S, col, id, patch, now) || ch; },
      del: function (col, id) { ch = M.del(S, col, id, now) || ch; }
    });
    if (!ch) { render(); return; }
    editSeq++; SY.dirty = true;
    saveState(); saveSync();
    render();
    scheduleSync(2500);
  }

  /* ---------- Google: вход (на сайте — implicit redirect) ---------- */
  /* Приложение на ПК (Tauri): authorization code + PKCE, ответ ловит одноразовый сервер на 127.0.0.1
     (oauth_listen в lib.rs), refresh token хранит Rust. Сеть — через плагин http. */
  var TAURI = window.__TAURI__ || null, DESK = { signed: false };
  function hfetch(u, i) { return TAURI ? TAURI.http.fetch(u, i) : fetch(u, i); }
  function invoke(cmd, args) { return TAURI.core.invoke(cmd, args || {}); }
  function qs(o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function b64url(u) { var s = ''; u.forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function keepToken(t) { lsSet('token', { v: t.access_token, exp: Date.now() + ((+t.expires_in || 3600) - 120) * 1000 }); }
  function desktopClient() { return { clientId: CFG.desktopClientId, clientSecret: CFG.desktopClientSecret || '' }; }
  async function desktopLogin() {
    var port = await invoke('oauth_listen', { port: CFG.desktopPort || null });
    var redirect = 'http://127.0.0.1:' + port, ver = b64url(rnd(32)), st = b64url(rnd(16));
    var ch = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver))));
    var un = null, got = new Promise(function (res, rej) {
      TAURI.event.listen('oauth-redirect', function (e) { res(String(e.payload)); }).then(function (f) { un = f; });
      setTimeout(function () { rej(new Error('timeout')); }, 300000);
    });
    try {
      await TAURI.opener.openUrl(AUTH_URL + '?' + qs({ client_id: CFG.desktopClientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
        code_challenge: ch, code_challenge_method: 'S256', state: st, access_type: 'offline', prompt: 'consent' }));
      var q = new URLSearchParams((await got).split('?')[1] || '');
      if (q.get('state') !== st || !q.get('code')) throw new Error(q.get('error') || 'state');
      /* обмен кода и хранение refresh token — в Rust (диспетчер учётных данных Windows); сюда приходит только access token */
      var t = await invoke('google_exchange', Object.assign(desktopClient(), { code: q.get('code'), verifier: ver, redirect: redirect }));
      keepToken(t); DESK.signed = true;
    } finally { if (un) un(); }
  }
  async function desktopRefresh() {
    if (!DESK.signed) return false;
    try { keepToken(await invoke('google_refresh', desktopClient())); return true; }
    catch (e) { if (/invalid_grant|no_refresh/.test(String(e))) DESK.signed = false; return false; }
  }

  function tokenValid() { var t = lsGet('token'); return !!(t && t.v && t.exp > Date.now()) || DESK.signed; }
  async function getToken() {
    var t = lsGet('token'); if (t && t.v && t.exp > Date.now()) return t.v;
    if (TAURI && await desktopRefresh()) return lsGet('token').v;
    var e = new Error('token'); e.status = 401; throw e;
  }
  function login(prompt) {
    if (TAURI) {
      if (!CFG.desktopClientSecret) { UI.sheet = 'В этой сборке нет секрета Desktop-клиента Google'; render(); return; }
      UI.sheet = 'busy'; render();
      desktopLogin().then(function () { SY.authed = true; saveSync(); render(); sheetNow(); })
        .catch(function (e) { UI.sheet = 'Вход не завершён: ' + (e.message || e); render(); });
      return;
    }
    if (!CFG.webClientId) { alert('В config.js не задан Client ID Google'); return; }
    var st = Math.random().toString(36).slice(2) + Date.now().toString(36);
    lsSet('oauth', { st: st, ts: Date.now() }); lsSet('exchange', 1);
    var q = { client_id: CFG.webClientId, redirect_uri: location.origin + location.pathname.replace(/index\.html$/, ''), response_type: 'token', scope: SCOPE, state: st, include_granted_scopes: 'true' };
    if (prompt) q.prompt = prompt;
    if (SY.hint) q.login_hint = SY.hint;
    location.assign(AUTH_URL + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&'));
  }
  /* Разбор хэша: #join=… (приглашение в семью) или ответ Google. Старые ссылки #sheet=… больше ничего не подключают. */
  function readHash() {
    var h = location.hash.replace(/^#/, ''); if (!h) return null;
    var p = new URLSearchParams(h), out = {};
    if (p.get('join')) out.join = FK.fromCode(p.get('join'));
    if (p.get('access_token') || p.get('error')) {
      var o = lsGet('oauth'); lsSet('oauth', null);
      if (o && o.st === p.get('state')) {
        if (p.get('access_token')) { lsSet('token', { v: p.get('access_token'), exp: Date.now() + ((+p.get('expires_in') || 3600) - 120) * 1000 }); out.login = 'ok'; }
        else out.login = p.get('error');
      }
    }
    history.replaceState(null, '', location.pathname + location.search);
    return out;
  }

  /* ---------- синхронизация: семья через релей (сквозное шифрование), таблица — разовым обменом ---------- */
  var FK = window.MFamily, RL = window.MRelay, FAMILY = { code: '', keys: null }, RS = { seq: 0, sent: {}, at: 0 };
  async function familyUse(code) {
    FAMILY.code = code || ''; FAMILY.keys = code ? await FK.derive(FK.fromCode(code)) : null;
    await store.set('famcode', code || null);
  }
  async function relayReset() { RS = { seq: 0, sent: {}, at: 0 }; await store.set('relay', RS); }
  function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms == null ? 1500 : ms); }
  function setStatus(s, err) { UI.status = s; UI.err = err || ''; var el = document.querySelector('[data-sync]'); if (el) el.outerHTML = syncChip(); }
  async function syncNow() {
    if (syncing) { again = true; return; }
    if (!FAMILY.keys) return setStatus('none');
    if (!CFG.relayUrl) return setStatus('error', 'В этой сборке не указан адрес релея');
    if (!navigator.onLine) return setStatus('offline');
    syncing = true; setStatus('sync');
    var seq = editSeq;
    try {
      var res = await RL.run({
        fetch: hfetch, url: CFG.relayUrl, keys: FAMILY.keys, sent: RS.sent, seq: RS.seq,
        get: function () { return S; },
        persist: async function (Mg) { S = M.merge(S, Mg); await saveState(); }
      });
      RS = { seq: res.seq, sent: res.sent, at: Date.now() }; await store.set('relay', RS);
      if (editSeq === seq) SY.dirty = false;
      await saveSync(); setStatus('ok');
      if (res.changed) { render(); famDecrypt(); }
    } catch (e) {
      if (e.status === 401 || e.status === 403) setStatus('denied');
      else if (!navigator.onLine || e instanceof TypeError) setStatus('offline');
      else setStatus('error', String(e.message || e));
    } finally {
      syncing = false;
      if (again || (SY.dirty && editSeq !== seq)) { again = false; scheduleSync(800); }
    }
  }
  /* разовый обмен с Google Таблицей: прежний проход sheets.js, слияние в обе стороны */
  async function sheetNow() {
    if (!SY.sheetId) return;
    if (!tokenValid()) { login('select_account'); return; }
    UI.sheet = 'busy'; render();
    try {
      var res = await SH.run({
        api: SH.sheetsApi(hfetch, getToken, SY.sheetId), now: Date.now,
        get: function () { return S; },
        persist: async function (Mg) { S = M.merge(S, Mg); await saveState(); }
      });
      if (res.status !== 'ok') throw new Error('Таблицу сейчас правят — попробуйте ещё раз');
      SY.at = Date.now(); if (res.title) SY.title = res.title; SY.authed = true;
      UI.sheet = 'ok'; editSeq++; SY.dirty = true; await saveSync();
      scheduleSync(300); famDecrypt();
    } catch (e) {
      if (e.status === 401) lsSet('token', null);
      UI.sheet = e.status === 403 ? 'Нет доступа к таблице' : e.status === 404 ? 'Таблица не найдена' : e.status === 401 ? 'Войдите в Google ещё раз'
        : !navigator.onLine ? 'Нет сети' : String(e.message || e);
    }
    render();
  }
  var ST = {
    none: 'Семья не настроена', offline: 'Нет сети — сохранено на устройстве', sync: 'Синхронизация…',
    denied: 'Релей не принял ключ семьи', error: 'Ошибка синхронизации'
  };
  function syncLabel() {
    if (UI.status === 'ok') return (window.innerWidth < 480 ? 'Синхр. ' : 'Синхронизировано ') + ago(RS.at);
    return ST[UI.status] || '';
  }
  function syncChip() {
    var warn = /none|denied|error|offline/.test(UI.status);
    return '<button class="sync' + (warn ? ' warn' : '') + (UI.status === 'sync' ? ' busy' : '') + '" data-sync data-act="sync-tap"><span>' + esc(syncLabel()) + '</span></button>';
  }

  /* ссылка-приглашение: ключ семьи во фрагменте #join=… (на сервер фрагмент не уходит) */
  function joinLink() { return 'https://rastaskin.github.io/menu/#join=' + FAMILY.code; }
  function deviceModal() {
    var link = joinLink();
    modal('<div class="device"><h3>Новое устройство</h3>' +
      '<p>Наведите камеру телефона на код или откройте ссылку на новом устройстве. В приложении на ПК и с экрана «Домой» iPhone: «Ещё» → вставьте ссылку в поле «Присоединиться».</p>' +
      '<div class="qrbox">' + MQR.svg(link) + '</div>' +
      '<div class="copy"><input readonly value="' + esc(link) + '" aria-label="Ссылка для нового устройства"><button type="button" class="btn" data-act="copy" data-v="' + esc(link) + '">Копировать</button></div>' +
      '<p class="muted">Ссылка — ключ ко всем данным семьи. Отправляйте только своим и не публикуйте.</p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="show-words">Показать 12 слов</button><button type="button" class="btn ghost" data-act="close">Готово</button></div></div>');
  }
  function viewDevices() {
    var h = '<section class="box" id="devices"><h3>Синхронизация</h3>';
    if (!FAMILY.keys) {
      h += '<p>Устройства семьи обмениваются данными через релей. Всё шифруется на устройстве — сервер видит только шифр. Регистрации нет: устройства объединяет ключ семьи.</p>' +
        '<div class="row"><button type="button" class="btn" data-act="family-new">Создать семью</button></div>' +
        '<form class="add" data-form="join"><input name="code" autocomplete="off" placeholder="Ссылка-приглашение или 12 слов" aria-label="Ссылка-приглашение или 12 слов" required><button class="btn ghost">Присоединиться</button></form>';
    } else {
      h += '<p>Последняя синхронизация: ' + ago(RS.at) + '.</p>' +
        '<div class="row"><button type="button" class="btn" data-act="add-device">Добавить устройство</button><button type="button" class="btn ghost" data-act="sync-now">Синхронизировать</button></div>' +
        '<button type="button" class="link danger" data-act="family-leave">Отключить устройство от семьи</button>';
    }
    if (UI.err) h += '<p class="muted">' + esc(UI.err) + '</p>';
    return h + '</section>';
  }
  function viewSheet() {
    var h = '<section class="box"><h3>Google Таблица</h3><p>По желанию: обмен с таблицей по кнопке — чтобы править меню в таблице или поручить это Claude.</p>';
    if (!SY.sheetId) return h + '<form class="add" data-form="connect"><input name="link" placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Ссылка на таблицу" required><button class="btn ghost">Подключить</button></form></section>';
    var busy = UI.sheet === 'busy', link = 'https://docs.google.com/spreadsheets/d/' + SY.sheetId + '/edit';
    h += '<p><b>' + esc(SY.title || 'Таблица') + '</b><br><span class="muted">' + (busy ? 'Обмен…' : UI.sheet && UI.sheet !== 'ok' ? esc(UI.sheet) : 'Последний обмен: ' + ago(SY.at)) + '</span></p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="sheet-now"' + (busy ? ' disabled' : '') + '>Обменяться сейчас</button>' +
      '<a class="btn ghost" href="' + esc(link) + '" target="_blank" rel="noopener">Открыть таблицу</a></div>' +
      (tokenValid() ? '<button type="button" class="link" data-act="logout">Выйти из Google</button>' : '') +
      '<button type="button" class="link danger" data-act="disconnect">Отключить таблицу</button>';
    return h + '</section>';
  }

  /* ---------- данные для экранов ---------- */
  function dates() {
    var set = {};
    M.list(S, 'days').forEach(function (d) { if (d.date || d.id) set[d.date || d.id] = 1; });
    M.list(S, 'meals').forEach(function (m) { if (m.date) set[m.date] = 1; });
    return Object.keys(set).filter(function (x) { return parseD(x); }).sort();
  }
  function weeks() {
    var ds = dates(), out = [];
    for (var i = 0; i < ds.length; i += 7) out.push(ds.slice(i, i + 7));
    return out;
  }
  function dayRec(date) { return S.days['d' + date] || S.days[date] || M.list(S, 'days').filter(function (d) { return d.date === date; })[0] || null; }
  function mealsOf(date) { return M.list(S, 'meals').filter(function (m) { return m.date === date; }); }
  function mealAt(date, slot) { return mealsOf(date).filter(function (m) { return m.slot === slot; })[0] || null; }
  function shopWeeks() { var w = {}; M.list(S, 'shop').forEach(function (i) { w[i.week || 0] = 1; }); return Object.keys(w).map(Number).sort(function (a, b) { return a - b; }); }

  /* ---------- экраны ---------- */
  var SLOT_LABEL = { 'завтрак': 'Завтрак', 'обед': 'Обед', 'перекус': 'Перекус', 'ужин': 'Ужин', 'с собой': 'С собой' };

  /* ---------- семья: имя и цвет открыто, аллергии/вес/заметка — шифр по семейному паролю (vault.js) ---------- */
  var V = window.MVault, FAM = { key: null, cache: {}, busy: false };
  var MCOLORS = ['pear', 'blue', 'coral', 'mint', 'kraft', 'sugar'];
  function famMeta(k) { var r = S.meta[k]; return r && r.value ? String(r.value) : ''; }
  function members() { return M.list(S, 'family').sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; }); }
  function famPlain(m) { return m.enc && FAM.cache[m.id + '|' + m.enc] || null; }
  /* расшифровать то, что ещё не в кэше; после синхронизации карточки приходят шифром */
  async function famDecrypt() {
    if (!FAM.key || FAM.busy) return;
    var todo = M.list(S, 'family').filter(function (m) { return m.enc && !FAM.cache[m.id + '|' + m.enc]; });
    if (!todo.length) return;
    FAM.busy = true;
    for (var i = 0; i < todo.length; i++) {
      var m = todo[i];
      try { FAM.cache[m.id + '|' + m.enc] = await V.open(FAM.key, m.enc, m.id); } catch (e) { FAM.cache[m.id + '|' + m.enc] = { bad: true }; }
    }
    FAM.busy = false; render();
  }
  async function famLoadKey() {
    var k = await store.get('famkey'), check = famMeta('fam_check');
    if (k && check && await V.verify(k, check)) { FAM.key = k; famDecrypt(); } else if (k && check) { FAM.key = null; await store.set('famkey', null); }
  }
  function memberInitial(m) { return esc((String(m.name || '?').trim()[0] || '?').toUpperCase()); }
  function memberCard(m) {
    var p = famPlain(m), c = MCOLORS.indexOf(m.color) >= 0 ? m.color : 'pear';
    var body = !m.enc ? '<span class="sub">аллергии и вес не заполнены</span>'
      : !FAM.key ? '<span class="sub">' + ICO.lock + 'данные под семейным паролем</span>'
      : !p ? '<span class="sub">расшифровываю…</span>'
      : p.bad ? '<span class="sub danger">не расшифровывается этим паролем</span>'
      : '<span class="sub">' + (p.allergies ? 'аллергии: ' + esc(p.allergies) : 'аллергий нет') + '</span>' + (p.weight ? '<span class="sub">вес ' + esc(p.weight) + ' кг</span>' : '');
    return '<li><button class="member" data-act="member-edit" data-id="' + esc(m.id) + '"><span class="ava mc-' + c + '" aria-hidden="true">' + memberInitial(m) + '</span>' +
      '<span class="mtext"><span class="nm">' + esc(m.name || 'Без имени') + '</span>' + body + '</span></button></li>';
  }
  function viewFamily() {
    var salt = famMeta('fam_salt'), h = '<section class="box" id="family"><h3>Семья</h3>';
    if (!salt) {
      h += '<p>Карточка члена семьи: имя видно на всех устройствах семьи и в таблице при обмене, а аллергии, вес и заметка шифруются семейным паролем. ' +
        'Пароль нигде не хранится: если его забыть, эти данные не восстановить. Сообщите его семье устно.</p>' +
        '<form class="add" data-form="fam-pass"><input name="p1" type="password" autocomplete="new-password" minlength="8" placeholder="Семейный пароль, от 8 знаков" aria-label="Семейный пароль" required>' +
        '<input name="p2" type="password" autocomplete="new-password" minlength="8" placeholder="Ещё раз" aria-label="Пароль ещё раз" required><button class="btn">Задать пароль</button></form>';
    } else if (!FAM.key) {
      h += '<form class="add" data-form="fam-unlock"><input name="p" type="password" autocomplete="current-password" placeholder="Семейный пароль" aria-label="Семейный пароль" required><button class="btn">Открыть карточки</button></form>';
    }
    var ms = members();
    h += ms.length ? '<ul class="members">' + ms.map(memberCard).join('') + '</ul>' : '<p class="muted">Карточек пока нет.</p>';
    h += '<div class="row"><button type="button" class="btn ghost" data-act="member-edit" data-id="">' + ICO.plus + 'Член семьи</button>' +
      (FAM.key ? '<button type="button" class="link" data-act="fam-forget">Закрыть карточки на этом устройстве</button>' : '') + '</div></section>';
    return h;
  }
  function memberEditor(id) {
    var m = id ? S.family[id] : null, p = m ? famPlain(m) || {} : {}, locked = !FAM.key;
    modal('<form data-form="member" data-id="' + esc(id || '') + '"><h3>' + (m ? 'Член семьи' : 'Новый член семьи') + '</h3>' +
      '<label>Имя<input name="name" value="' + esc(m ? m.name : '') + '" autocomplete="off" required></label>' +
      '<fieldset class="colors"><legend>Цвет</legend>' + MCOLORS.map(function (c, i) {
        return '<label class="cl"><input type="radio" name="color" value="' + c + '"' + ((m ? m.color : 'pear') === c || (!m && i === 0) ? ' checked' : '') + '><span class="ava mc-' + c + '">' + (i + 1) + '</span></label>';
      }).join('') + '</fieldset>' +
      (locked ? '<p class="muted">' + ICO.lock + (famMeta('fam_salt') ? 'Откройте карточки семейным паролем во вкладке «Ещё», чтобы менять аллергии и вес.' : 'Задайте семейный пароль во вкладке «Ещё», чтобы записать аллергии и вес.') + '</p>'
        : '<label>Аллергии<input name="allergies" value="' + esc(p.allergies || '') + '" placeholder="Через запятую, например: арахис, киви" autocomplete="off"></label>' +
          '<label>Вес, кг<input name="weight" inputmode="decimal" value="' + esc(p.weight || '') + '" autocomplete="off"></label>' +
          '<label>Заметка о питании<textarea name="note" rows="3">' + esc(p.note || '') + '</textarea></label>') +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button>' +
      (m ? '<button type="button" class="link danger" data-act="member-del" data-id="' + esc(id) + '">Удалить</button>' : '') + '</div></form>');
  }
  function allergyPanel() {
    var rows = members().map(function (m) { var p = famPlain(m); return p && p.allergies ? { m: m, a: p.allergies } : null; }).filter(Boolean);
    return rows.length ? '<section class="panel"><h3>Аллергии в семье</h3><ul class="allergy-list">' + rows.map(function (r) {
      return '<li><span class="ava mc-' + (MCOLORS.indexOf(r.m.color) >= 0 ? r.m.color : 'pear') + '" aria-hidden="true">' + memberInitial(r.m) + '</span><span><b>' + esc(r.m.name) + '</b><span class="sub">' + esc(r.a) + '</span></span></li>';
    }).join('') + '</ul></section>' : '';
  }

  /* «Сегодня»: тарелка дня — приёмы пищи крупно, готовка на грушевом поле, что скоро испортится, завтрашний день. */
  function mealRow(date, s, big) {
    var m = mealAt(date, s), has = m && m.text;
    return '<li class="meal' + (big ? ' big' : '') + (m && m.done ? ' done' : '') + (s === 'с собой' ? ' go' : '') + '">' +
      (has ? mealPic(m.text) : '<span class="fi fi-none" aria-hidden="true"></span>') +
      '<button class="mtxt" data-act="meal-edit" data-date="' + date + '" data-slot="' + esc(s) + '"><span class="lbl">' + esc(SLOT_LABEL[s] || s) + '</span>' +
      (has ? '<span class="dish">' + esc(m.text) + '</span>' : '<span class="muted">Добавить блюдо</span>') + '</button>' +
      '<button class="chk" data-act="meal-done" data-date="' + date + '" data-slot="' + esc(s) + '" aria-label="Съели" aria-pressed="' + !!(m && m.done) + '" ' + (m ? '' : 'disabled') + '>' + (m && m.done ? ICO.check : '') + '</button></li>';
  }
  function slotsOf(date) { return M.SLOTS.filter(function (s) { return s !== 'с собой' || mealAt(date, s); }); }
  function viewToday() {
    var ds = dates(), t = today();
    if (!ds.length) return emptyState();
    var date = ds.indexOf(t) >= 0 ? t : (ds.filter(function (x) { return x > t; })[0] || ds[ds.length - 1]);
    var d = dayRec(date) || {}, tg = tags(d.tags), pd = parseD(date), sl = slotsOf(date);
    var eaten = sl.filter(function (s) { var m = mealAt(date, s); return m && m.done; }).length;
    var next = ds[ds.indexOf(date) + 1], nd = next ? dayRec(next) || {} : null;
    var soon = M.list(S, 'pantry').filter(function (p) { return p.until && p.until <= addDays(t, 2); }).sort(function (a, b) { return a.until < b.until ? -1 : 1; });
    var head = '<header class="day-head"><h2>' + (date === t ? 'Съели ' + eaten + ' из ' + sl.length : 'Ближайший день: ' + WDL[pd.getDay()] + ', ' + pd.getDate() + ' ' + MON[pd.getMonth()]) + '</h2>' +
      (tg.length ? '<div class="tags">' + tg.map(function (x) { return '<span class="tag t-' + x.k + '">' + esc(x.t) + '</span>'; }).join('') + '</div>' : '') + '</header>';
    var plate = '<ul class="plate" id="d' + date + '">' + sl.map(function (s) { return mealRow(date, s, true); }).join('') + '</ul>' +
      (mealAt(date, 'с собой') ? '' : '<button class="link" data-act="meal-edit" data-date="' + date + '" data-slot="с собой">+ С собой</button>');
    var cook = '<section class="field">' + ICO.pot + '<div><h3>Готовка</h3><p>' + (d.cook ? esc(d.cook) : 'План готовки не задан') + '</p>' +
      '<button class="btn ghost" data-act="cook-edit" data-date="' + date + '">' + (d.cook ? 'Изменить' : 'Добавить') + '</button></div></section>';
    var home = soon.length ? '<section class="panel"><h3>Скоро испортится</h3><ul class="soon-list">' + soon.map(function (p) {
      return '<li><button class="row-btn" data-act="pantry-edit" data-id="' + esc(p.id) + '">' + pic('p', p.name, p.name) +
        '<span><span class="nm">' + esc(p.name) + '</span><span class="sub">' + (p.until < t ? 'просрочено ' : 'до ') + dm(p.until) + '</span></span></button></li>';
    }).join('') + '</ul></section>' : '';
    var tom = next ? '<section class="panel"><h3>Завтра, ' + WDL[parseD(next).getDay()] + '</h3><ul class="mini-plate">' + slotsOf(next).map(function (s) {
      var m = mealAt(next, s); return '<li>' + (m && m.text ? mealPic(m.text) : '<span class="fi fi-none" aria-hidden="true"></span>') +
        '<span><span class="lbl">' + esc(SLOT_LABEL[s] || s) + '</span>' + (m && m.text ? esc(m.text) : '<span class="muted">не задано</span>') + '</span></li>';
    }).join('') + '</ul>' + (nd && nd.cook ? '<p class="cook-line">' + ICO.pot + '<span>' + esc(nd.cook) + '</span></p>' : '') +
      '<button class="btn ghost" data-act="tab" data-tab="menu">Вся неделя</button></section>' : '';
    return '<div class="today">' + '<div class="today-main">' + head + plate + '</div><div class="today-side">' + cook + allergyPanel() + home + tom + '</div></div>';
  }

  function viewMenu() {
    var ws = weeks();
    if (!ws.length) return emptyState();
    var t = today(), wi = UI.week;
    if (wi == null || wi >= ws.length) { wi = 0; ws.forEach(function (w, i) { if (w.indexOf(t) >= 0) wi = i; }); if (t > ws[ws.length - 1][ws[ws.length - 1].length - 1]) wi = ws.length - 1; }
    UI.week = wi;
    var seg = '<div class="seg">' + ws.map(function (w, i) {
      return '<button class="' + (i === wi ? 'on' : '') + '" data-act="week" data-i="' + i + '">' + dm(w[0]) + '–' + dm(w[w.length - 1]) + '</button>';
    }).join('') + '</div>';
    var cards = ws[wi].map(function (date) {
      var d = dayRec(date) || {}, tg = tags(d.tags), pd = parseD(date);
      var rows = slotsOf(date).map(function (s) { return mealRow(date, s, false); }).join('');
      var addGo = mealAt(date, 'с собой') ? '' : '<button class="link" data-act="meal-edit" data-date="' + date + '" data-slot="с собой">+ С собой</button>';
      return '<article class="day' + (date === t ? ' today' : '') + (date < t ? ' past' : '') + '" id="d' + date + '">' +
        '<header class="dh"><span class="dnum"><b>' + pd.getDate() + '</b><small>' + MON[pd.getMonth()].slice(0, 3) + '</small></span>' +
        '<span class="dname">' + WDL[pd.getDay()] + (date === t ? '<em>сегодня</em>' : '') + '</span></header>' +
        (tg.length ? '<div class="tags">' + tg.map(function (x) { return '<span class="tag t-' + x.k + '">' + esc(x.t) + '</span>'; }).join('') + '</div>' : '') +
        '<ul class="meals">' + rows + '</ul>' + addGo +
        '<button class="cook" data-act="cook-edit" data-date="' + date + '">' + ICO.pot + '<span>' + (d.cook ? esc(d.cook) : '<span class="muted">План готовки не задан</span>') + '</span></button>' +
        '</article>';
    }).join('');
    return seg + '<div class="grid">' + cards + '</div>';
  }

  function viewShop() {
    var ws = shopWeeks();
    if (!ws.length) return '<div class="empty">Список покупок пуст.' + addShopForm(1) + '</div>';
    var w = UI.shopWeek; if (w == null || ws.indexOf(w) < 0) { w = ws[0]; var wk = weeks(); if (wk.length > 1 && wk[1].indexOf(today()) >= 0 && ws.indexOf(2) >= 0) w = 2; }
    UI.shopWeek = w;
    var items = M.list(S, 'shop').filter(function (i) { return (i.week || 0) === w; });
    var plan = 0, got = 0, toMove = 0, n = 0, nGot = 0;
    items.forEach(function (i) {
      if (!i.skip) { plan += i.price || 0; n++; } if (i.bought) { got += i.price || 0; nGot++; } if (i.bought && !i.moved) toMove++;
    });
    var cats = []; items.forEach(function (i) { if (cats.indexOf(i.cat || 'Прочее') < 0) cats.push(i.cat || 'Прочее'); });
    var body = cats.map(function (c) {
      var li = items.filter(function (i) { return (i.cat || 'Прочее') === c; }).sort(function (a, b) { return (a.bought || a.skip ? 1 : 0) - (b.bought || b.skip ? 1 : 0); });
      var left = li.filter(function (i) { return !i.bought && !i.skip; }).length;
      return '<h3>' + esc(c) + ' <span class="muted">' + (left ? left : 'всё') + '</span></h3><ul class="tiles">' + li.map(function (i) {
        var home = M.pantryMatches(S, i), badge = '';
        if (home.length && !i.bought) badge = '<span class="badge">дома: ' + home.map(function (p) { return esc(p.name + (p.qty ? ' ' + p.qty : '')); }).join(', ') + '</span>';
        return '<li class="tile' + (i.bought ? ' bought' : '') + (i.skip ? ' skip' : '') + '">' +
          '<button class="tbtn" data-act="shop-card" data-id="' + esc(i.id) + '" aria-haspopup="dialog" aria-label="' + esc(i.name) + (i.bought ? ', куплено' : i.skip ? ', есть дома' : '') + '">' +
          pic('p', i.name, i.name, 'fi-l') + '<span class="nm">' + esc(i.name) + '</span><span class="sub">' + esc(i.qty || '') + '</span>' + (i.skip ? '<span class="sub">есть дома</span>' : '') +
          (i.bought ? '<span class="tick">' + ICO.check + '</span>' : '') + '</button>' +
          (badge || i.price ? '<div class="tfoot">' + badge + (i.price ? '<span class="pr">' + rub(i.price) + '</span>' : '') + '</div>' : '') + '</li>';
      }).join('') + '</ul>';
    }).join('');
    var pct = plan ? Math.round(got * 100 / plan) : 0;
    return '<div class="seg">' + ws.map(function (x) { return '<button class="' + (x === w ? 'on' : '') + '" data-act="shopweek" data-w="' + x + '">Неделя ' + x + '</button>'; }).join('') + '</div>' +
      '<section class="sum"><div class="sum-top"><b>' + rub(Math.max(0, plan - got)) + '</b><span>осталось из ' + rub(plan) + '</span></div>' +
      '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="transform:scaleX(' + (pct / 100) + ')"></i></div>' +
      '<p>Куплено ' + nGot + ' из ' + n + ' на ' + rub(got) + '</p>' +
      (toMove ? '<button class="btn wide" data-act="move-home">Купленное → Дома (' + toMove + ')</button>' : '') + '</section>' +
      body + addShopForm(w);
  }
  function addShopForm(w) {
    var cats = []; M.list(S, 'shop').forEach(function (i) { if (i.cat && cats.indexOf(i.cat) < 0) cats.push(i.cat); });
    return '<form class="add" data-form="shop-add" data-w="' + w + '"><input name="name" placeholder="Добавить продукт" required>' +
      '<input name="qty" placeholder="Сколько" class="sm"><input name="price" placeholder="₽" inputmode="numeric" class="sm">' +
      '<select name="cat">' + (cats.length ? cats : ['Прочее']).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<button class="btn">Добавить</button></form>';
  }

  function viewHome() {
    var all = M.list(S, 'pantry'), q = M.norm(UI.q), t = today();
    if (q) all = all.filter(function (p) { return M.norm(p.name).indexOf(q) >= 0; });
    var out = '<input class="search" type="search" placeholder="Поиск по дому" aria-label="Поиск по дому" value="' + esc(UI.q) + '" data-input="q">';
    PLACES.forEach(function (pl) {
      var li = all.filter(function (p) { return placeKey(p.place) === pl[0]; }).sort(function (a, b) { return (a.until || '9') < (b.until || '9') ? -1 : 1; });
      out += '<h3 class="place">' + pl[2] + pl[1] + ' <span class="muted">' + li.length + '</span></h3>';
      out += li.length ? '<ul class="tiles">' + li.map(function (p) {
        var soon = p.until && p.until <= addDays(t, 2);
        return '<li class="tile' + (soon ? ' soon' : '') + '"><button class="tbtn" data-act="pantry-edit" data-id="' + esc(p.id) + '">' +
          pic('p', p.name, p.name, 'fi-l') + '<span class="nm">' + esc(p.name) + '</span>' +
          '<span class="sub">' + esc(p.qty || '') + '</span>' + (p.until ? '<span class="sub">до ' + dm(p.until) + '</span>' : '') +
          (p.note ? '<span class="note">' + esc(p.note) + '</span>' : '') + '</button>' +
          (soon ? '<span class="badge warn">' + (p.until < t ? 'просрочено' : 'скоро') + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="muted pad">Пусто</p>';
    });
    out += '<h3>Добавить</h3><form class="add" data-form="pantry-add"><input name="name" placeholder="Что есть дома" aria-label="Продукт" required><input name="qty" placeholder="Сколько" aria-label="Сколько" class="sm">' +
      '<select name="place" aria-label="Где">' + PLACES.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') + '</select>' +
      '<input name="until" type="date" class="sm" title="Годен до" aria-label="Годен до"><button class="btn">Добавить</button></form>';
    return out;
  }
  function addDays(s, n) { var d = parseD(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function viewRecipes() {
    var li = M.list(S, 'recipes').sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; });
    return '<button class="btn wide" data-act="recipe-new">' + ICO.plus + 'Новый рецепт</button><div class="cards">' + li.map(function (r) {
      return '<button class="rc" data-act="recipe-edit" data-id="' + esc(r.id) + '">' + pic('r', r.name, r.name, 'fi-m') + '<span><b>' + esc(r.name) + '</b><p>' + esc(r.text || '') + '</p></span></button>';
    }).join('') + '</div>';
  }

  function viewMore() {
    var h = viewFamily();
    if (UI.update) h += '<section class="box"><h3>Обновление</h3><p>Вышла версия ' + esc(UI.update.version) + '.</p><button class="btn" data-act="update">Обновить и перезапустить</button></section>';
    var mode = lsGet('mode') || 'auto';
    h += '<section class="box"><h3>Оформление</h3><div class="seg" role="group" aria-label="Тема">' +
      [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(function (x) {
        return '<button type="button" class="' + (mode === x[0] ? 'on' : '') + '" data-act="mode" data-v="' + x[0] + '" aria-pressed="' + (mode === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div></section>';
    h += viewDevices() + viewSheet();
    var rules = M.list(S, 'rules').sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    if (rules.length) h += '<section class="box"><h3>Правила на эти недели</h3>' + rules.map(function (r) { return '<p><b>' + esc(r.title) + '.</b> ' + esc(r.text) + '</p>'; }).join('') + '</section>';
    h += '<section class="box"><h3>Копия данных</h3><div class="row"><button class="btn ghost" data-act="export">Скачать JSON</button>' +
      '<label class="btn ghost">Загрузить JSON<input type="file" accept="application/json,.json" data-input="import" hidden></label></div>' +
      '<p class="muted">Всё сохраняется на устройстве сразу после каждого изменения, даже без сети.</p></section>';
    return h;
  }

  function emptyState() {
    return '<div class="empty"><h2>Меню пока пустое</h2><p>Во вкладке «Ещё» создайте семью или присоединитесь к ней по ссылке — меню, покупки и рецепты подтянутся с других устройств. Можно и сразу добавлять блюда.</p>' +
      '<button class="btn" data-act="tab" data-tab="more">Открыть «Ещё»</button></div>';
  }

  var TABS = [['today', 'Сегодня'], ['menu', 'Неделя'], ['shop', 'Покупки'], ['home', 'Дома'], ['recipes', 'Рецепты'], ['more', 'Ещё']];
  var pendingRender = false;
  function render(force) {
    if (!force && document.querySelector('#modal .sheet')) { pendingRender = true; return; }
    pendingRender = false;
    var v = { today: viewToday, menu: viewMenu, shop: viewShop, home: viewHome, recipes: viewRecipes, more: viewMore }[UI.tab]();
    var nav = TABS.map(function (t) {
      var n = t[0] === 'home' ? M.list(S, 'pantry').length : 0;
      return '<button class="' + (UI.tab === t[0] ? 'on' : '') + '" data-act="tab" data-tab="' + t[0] + '"' + (UI.tab === t[0] ? ' aria-current="page"' : '') + '>' +
        ICO[t[0]] + '<span>' + t[1] + '</span>' + (n ? '<i>' + n + '</i>' : '') + '</button>';
    }).join('');
    var y = window.scrollY, same = $app.getAttribute('data-tab') === UI.tab, now = new Date();
    $app.setAttribute('data-tab', UI.tab);
    var title = (S.meta.title && S.meta.title.value) || 'Меню', heads = { today: 'Сегодня', menu: 'Меню на неделю', shop: 'Покупки', home: 'Дома', recipes: 'Рецепты', more: 'Ещё' };
    $app.innerHTML = '<nav class="tabs" aria-label="Разделы"><div class="brand"><b>Меню</b><span>' + esc(title.replace(/^Меню\s*[—-]\s*/, '')) + '</span></div>' + nav + '</nav>' +
      '<div class="body"><header class="top"><div class="ttl"><h1>' + heads[UI.tab] + '</h1>' +
      '<p>' + WDL[now.getDay()] + ', ' + now.getDate() + ' ' + MON[now.getMonth()] + '</p></div>' + syncChip() + '</header>' +
      '<main>' + v + '</main></div><div id="modal"></div>';
    if (same) window.scrollTo(0, y);
  }

  /* ---------- модальные окна ---------- */
  function modal(html) { var m = document.getElementById('modal'); m.innerHTML = '<div class="ov" data-act="close"></div><div class="sheet" role="dialog">' + html + '</div>'; var f = m.querySelector('textarea,input'); if (f) setTimeout(function () { f.focus(); }, 50); }
  function closeModal() { var m = document.getElementById('modal'); if (m) m.innerHTML = ''; if (pendingRender) render(); }

  function mealEditor(date, slot) {
    var m = mealAt(date, slot), others = dates().filter(function (d) { return d !== date; });
    var rec = M.list(S, 'recipes').map(function (r) { return '<button type="button" class="chip" data-act="pick" data-v="' + esc(r.name) + '">' + esc(r.name) + '</button>'; }).join('');
    modal('<form data-form="meal" data-date="' + date + '" data-slot="' + esc(slot) + '"><h3>' + esc(SLOT_LABEL[slot] || slot) + ', ' + wd(date).toLowerCase() + ' ' + dm(date) + '</h3>' +
      '<textarea name="text" rows="4" placeholder="Что едим">' + esc(m ? m.text : '') + '</textarea>' +
      (rec ? '<div class="chips">' + rec + '</div>' : '') +
      '<label class="ck"><input type="checkbox" name="done"' + (m && m.done ? ' checked' : '') + '> Уже съели</label>' +
      '<label>Поменять местами с днём <select name="swap"><option value="">—</option>' + others.map(function (d) { return '<option value="' + d + '">' + dm(d) + ' ' + wd(d) + '</option>'; }).join('') + '</select></label>' +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button>' +
      (m ? '<button type="button" class="link danger" data-act="meal-del" data-date="' + date + '" data-slot="' + esc(slot) + '">Убрать</button>' : '') + '</div></form>');
  }
  /* карточка продукта из «Покупок»: картинка, что известно, и крупные кнопки действий */
  function shopCard(id) {
    var i = S.shop[id]; if (!i) return;
    var home = M.pantryMatches(S, i), facts = [i.qty, i.price ? rub(i.price) : '', i.cat].filter(Boolean), d = ' data-id="' + esc(id) + '"';
    modal('<div class="pcard">' + pic('p', i.name, i.name, 'fi-xl') + '<h3>' + esc(i.name) + '</h3>' +
      (facts.length ? '<p class="muted">' + facts.map(esc).join(' · ') + '</p>' : '') +
      (home.length ? '<p><span class="badge">дома: ' + home.map(function (p) { return esc(p.name + (p.qty ? ' ' + p.qty : '')); }).join(', ') + '</span></p>' : '') +
      (i.bought ? '<p class="state">' + ICO.check + 'Куплено</p>' : i.skip ? '<p class="state">Есть дома — покупать не нужно</p>' : '') +
      '<div class="acts">' +
      '<button type="button" class="btn"' + d + ' data-act="buy">' + (i.bought ? 'Не куплено' : ICO.check + 'Куплено') + '</button>' +
      '<button type="button" class="btn ghost"' + d + ' data-act="skip">' + (i.skip ? 'Нужно купить' : 'Есть дома') + '</button>' +
      '<button type="button" class="btn ghost"' + d + ' data-act="shop-edit">Изменить</button>' +
      '<button type="button" class="btn ghost danger"' + d + ' data-act="shop-del">Удалить</button>' +
      '</div><button type="button" class="link" data-act="close">Закрыть</button></div>');
  }
  function shopEditor(id) {
    var i = S.shop[id]; if (!i) return;
    modal('<form data-form="shop" data-id="' + esc(id) + '"><h3>Покупка</h3>' + picEditor('p', i.name) +
      '<label>Продукт<input name="name" value="' + esc(i.name) + '" required></label>' +
      '<label>Количество<input name="qty" value="' + esc(i.qty || '') + '"></label>' +
      '<label>Цена, ₽<input name="price" inputmode="numeric" value="' + esc(i.price == null ? '' : i.price) + '"></label>' +
      '<label>Раздел<input name="cat" value="' + esc(i.cat || '') + '"></label>' +
      '<label>Неделя<input name="week" inputmode="numeric" value="' + esc(i.week || '') + '"></label>' +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button>' +
      '<button type="button" class="link danger" data-act="shop-del" data-id="' + esc(id) + '">Удалить</button></div></form>');
  }
  function pantryEditor(id) {
    var p = S.pantry[id]; if (!p) return;
    modal('<form data-form="pantry" data-id="' + esc(id) + '"><h3>Дома</h3>' + picEditor('p', p.name) +
      '<label>Продукт<input name="name" value="' + esc(p.name) + '" required></label>' +
      '<label>Количество<input name="qty" value="' + esc(p.qty || '') + '"></label>' +
      '<label>Где<select name="place">' + PLACES.map(function (x) { return '<option value="' + x[0] + '"' + (placeKey(p.place) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Годен до<input type="date" name="until" value="' + esc(p.until || '') + '"></label>' +
      '<label>Заметка<input name="note" value="' + esc(p.note || '') + '"></label>' +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button>' +
      '<button type="button" class="link danger" data-act="pantry-gone" data-id="' + esc(id) + '">Закончилось</button></div></form>');
  }
  function recipeEditor(id) {
    var r = id ? S.recipes[id] : null;
    modal('<form data-form="recipe" data-id="' + esc(id || '') + '"><h3>' + (r ? 'Рецепт' : 'Новый рецепт') + '</h3>' + (r && r.name ? picEditor('r', r.name) : '') +
      '<label>Название<input name="name" value="' + esc(r ? r.name : '') + '" required></label>' +
      '<label>Как готовить<textarea name="text" rows="6">' + esc(r ? r.text || '' : '') + '</textarea></label>' +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button>' +
      (r ? '<button type="button" class="link danger" data-act="recipe-del" data-id="' + esc(id) + '">Удалить</button>' : '') + '</div></form>');
  }
  function cookEditor(date) {
    var d = dayRec(date) || {};
    modal('<form data-form="cook" data-date="' + date + '"><h3>Готовка, ' + wd(date).toLowerCase() + ' ' + dm(date) + '</h3>' +
      '<textarea name="cook" rows="3">' + esc(d.cook || '') + '</textarea>' +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button></div></form>');
  }
  function mealId(date, slot) { var m = mealAt(date, slot); return m ? m.id : date + '/' + slot; }

  function picError(e) {
    var m = e && e.message === 'format' ? 'Этот формат картинки не открывается' + (e.file ? ' (' + e.file + ')' : '') + '. Подойдут JPEG, PNG или WebP.'
      : 'Не получилось: ' + esc(String((e && e.message) || e));
    modal('<h3>Картинка</h3><p>' + m + '</p><div class="row"><button type="button" class="btn ghost" data-act="close">Закрыть</button></div>');
  }

  /* ---------- события ---------- */
  document.addEventListener('click', function (e) {
    /* в приложении на ПК внешние ссылки открываются в системном браузере */
    var ln = TAURI && e.target.closest('a[href^="http"]');
    if (ln) { e.preventDefault(); TAURI.opener.openUrl(ln.href); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.getAttribute('data-act'), id = b.getAttribute('data-id'), date = b.getAttribute('data-date'), slot = b.getAttribute('data-slot');
    switch (a) {
      case 'tab': UI.tab = b.getAttribute('data-tab'); lsSet('tab', UI.tab); render(); window.scrollTo(0, 0); break;
      case 'week': UI.week = +b.getAttribute('data-i'); render(); break;
      case 'shopweek': UI.shopWeek = +b.getAttribute('data-w'); render(); break;
      case 'close': closeModal(); break;
      case 'meal-edit': mealEditor(date, slot); break;
      case 'meal-done': { var m = mealAt(date, slot); if (m) commit(function (c) { c.put('meals', m.id, { done: !m.done }); }); break; }
      case 'meal-del': { var m2 = mealAt(date, slot); closeModal(); if (m2) commit(function (c) { c.del('meals', m2.id); }); break; }
      case 'pick': { var ta = document.querySelector('#modal textarea'); if (ta) ta.value = b.getAttribute('data-v'); break; }
      case 'cook-edit': cookEditor(date); break;
      case 'shop-card': shopCard(id); break;
      case 'buy': { var i = S.shop[id]; closeModal(); if (i) commit(function (c) { c.put('shop', id, { bought: !i.bought, skip: false }); }); break; }
      case 'skip': { var i2 = S.shop[id]; closeModal(); if (i2) commit(function (c) { c.put('shop', id, { skip: !i2.skip, bought: false }); }); break; }
      case 'shop-edit': shopEditor(id); break;
      case 'shop-del': if (confirmSoft(b, 'Удалить')) { closeModal(); commit(function (c) { c.del('shop', id); }); } break;
      case 'move-home': commit(function (c) {
        M.list(S, 'shop').filter(function (i) { return (i.week || 0) === UI.shopWeek && i.bought && !i.moved; }).forEach(function (i) {
          c.put('pantry', 'p-' + i.id, { name: i.name, qty: i.qty || '', place: placeFor(i) });
          c.put('shop', i.id, { moved: true });
        });
      }); break;
      case 'pantry-edit': pantryEditor(id); break;
      case 'pantry-gone': { var p = S.pantry[id]; if (p && confirmSoft(b)) { closeModal(); commit(function (c) { c.del('pantry', id); }); } break; }
      case 'recipe-new': recipeEditor(''); break;
      case 'recipe-edit': recipeEditor(id); break;
      case 'recipe-del': closeModal(); commit(function (c) { c.del('recipes', id); }); break;
      case 'sync-tap': if (!FAMILY.keys) { UI.tab = 'more'; render(); } else syncNow(); break;
      case 'sheet-now': sheetNow(); break;
      case 'add-device': deviceModal(); break;
      case 'show-words': FK.toWords(FK.fromCode(FAMILY.code)).then(function (w) { b.outerHTML = '<p class="words">' + esc(w) + '</p>'; }); break;
      case 'family-new': (async function () { await familyUse(FK.toCode(FK.newRoot())); await relayReset(); render(); syncNow(); deviceModal(); })(); break;
      case 'family-leave': if (confirm('Отключить это устройство от семьи? Данные на устройстве останутся, обмен прекратится.')) (async function () { await familyUse(''); await relayReset(); setStatus('none'); render(); })(); break;
      case 'sync-now': syncNow(); break;
      case 'login': login('select_account'); break;
      case 'logout': lsSet('token', null); SY.authed = false; saveSync();
        if (TAURI) { DESK.signed = false; invoke('google_logout'); } render(); break;
      case 'disconnect': if (confirm('Отключить таблицу? Данные на устройстве и в семье останутся.')) { SY = { dirty: SY.dirty }; saveSync(); render(); } break;
      case 'copy': { var v = b.getAttribute('data-v'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { b.textContent = 'Скопировано'; }, function () { prompt('Скопируйте ссылку', v); }); break; }
      case 'export': exportJson(); break;
      case 'member-edit': memberEditor(id); break;
      case 'member-del': { var md = S.family[id]; if (md && confirmSoft(b, 'Удалить')) { closeModal(); commit(function (c) { c.del('family', id); }); } break; }
      case 'fam-forget': FAM.key = null; FAM.cache = {}; store.set('famkey', null); render(); break;
      case 'mode': { var mv = b.getAttribute('data-v'); lsSet('mode', mv === 'auto' ? null : mv); if (mv === 'auto') delete document.documentElement.dataset.mode; else document.documentElement.dataset.mode = mv; render(); break; }
      case 'pic-del': { var pk = b.getAttribute('data-kind'), pn = b.getAttribute('data-k'); delete IMG[imgKey(pk, pn)]; refreshPicRow(pk, pn); break; }
      case 'update': { var u = UI.update; if (u) { b.disabled = true; b.textContent = 'Загружаю обновление…'; u.downloadAndInstall().catch(function (er) { b.textContent = 'Не вышло: ' + er; }); } break; }
    }
  });
  /* Второе нажатие подтверждает удаление — без системного диалога. */
  function confirmSoft(b, label) { if (b.getAttribute('data-sure')) return true; b.setAttribute('data-sure', '1'); b.textContent = 'Точно?'; setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-sure'); b.textContent = label || 'Закончилось'; } }, 3000); return false; }

  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
    var k = f.getAttribute('data-form'), fd = new FormData(f), g = function (n) { var v = fd.get(n); return v == null ? '' : String(v).trim(); };
    switch (k) {
      case 'meal': {
        var date = f.getAttribute('data-date'), slot = f.getAttribute('data-slot'), swap = g('swap'), text = g('text'), done = !!fd.get('done');
        closeModal();
        commit(function (c) {
          if (swap) {
            var other = mealAt(swap, slot), ot = other ? other.text : '';
            c.put('meals', mealId(swap, slot), { date: swap, slot: slot, text: text, done: false });
            if (ot || mealAt(date, slot)) c.put('meals', mealId(date, slot), { date: date, slot: slot, text: ot, done: false });
          } else if (text || mealAt(date, slot)) c.put('meals', mealId(date, slot), { date: date, slot: slot, text: text, done: done });
          if (!dayRec(date)) c.put('days', 'd' + date, { date: date, wd: wd(date) });
        });
        break;
      }
      case 'cook': { var d = f.getAttribute('data-date'), r = dayRec(d); closeModal(); commit(function (c) { c.put('days', r ? r.id : 'd' + d, { date: d, cook: g('cook') }); }); break; }
      case 'shop': { var id = f.getAttribute('data-id'); closeModal(); commit(function (c) { c.put('shop', id, { name: g('name'), qty: g('qty'), price: g('price'), cat: g('cat'), week: g('week') }); }); break; }
      case 'shop-add': commit(function (c) { c.put('shop', uid('s'), { name: g('name'), qty: g('qty'), price: g('price'), cat: g('cat'), week: +f.getAttribute('data-w') || 1 }); }); break;
      case 'pantry': { var pid = f.getAttribute('data-id'); closeModal(); commit(function (c) { c.put('pantry', pid, { name: g('name'), qty: g('qty'), place: g('place'), until: g('until'), note: g('note') }); }); break; }
      case 'pantry-add': commit(function (c) { c.put('pantry', uid('p'), { name: g('name'), qty: g('qty'), place: g('place'), until: g('until') }); }); break;
      case 'recipe': { var rid = f.getAttribute('data-id') || uid('r'); closeModal(); commit(function (c) { c.put('recipes', rid, { name: g('name'), text: g('text') }); }); break; }
      case 'fam-pass': {
        if (g('p1') !== g('p2')) { alert('Пароли не совпадают'); break; }
        if (g('p1').length < 8) { alert('Пароль — от 8 знаков'); break; }
        if (famMeta('fam_salt')) break;
        (async function () {
          var salt = V.newSalt(), key = await V.deriveKey(g('p1'), salt), check = await V.makeCheck(key);
          FAM.key = key; await store.set('famkey', key);
          commit(function (c) { c.put('meta', 'fam_salt', { value: salt }); c.put('meta', 'fam_check', { value: check }); });
        })();
        break;
      }
      case 'fam-unlock': {
        var btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Проверяю…';
        (async function () {
          var key = await V.deriveKey(g('p'), famMeta('fam_salt'));
          if (!(await V.verify(key, famMeta('fam_check')))) { btn.disabled = false; btn.textContent = 'Открыть карточки'; alert('Пароль не подходит'); return; }
          FAM.key = key; await store.set('famkey', key); render(); famDecrypt();
        })();
        break;
      }
      case 'member': {
        var mid = f.getAttribute('data-id') || uid('f'), patch = { name: g('name'), color: g('color') || 'pear' };
        var data = FAM.key && fd.has('allergies') ? { allergies: g('allergies'), weight: g('weight').replace(',', '.'), note: g('note') } : null;
        closeModal();
        (async function () {
          if (data) { patch.enc = await V.seal(FAM.key, data, mid); FAM.cache[mid + '|' + patch.enc] = data; }
          commit(function (c) { c.put('family', mid, patch); });
        })();
        break;
      }
      case 'join': {
        var raw = g('code'), code0 = FK.fromCode(raw);
        (async function () {
          var r = code0 || await FK.fromWords(raw);
          if (!r) { alert('Не похоже на ссылку-приглашение или 12 слов'); return; }
          await joinFamily(FK.toCode(r));
        })();
        break;
      }
      case 'connect': {
        var sid = SH.parseSheetId(g('link'));
        if (!sid) { alert('Не похоже на ссылку Google Таблицы'); break; }
        SY.sheetId = sid; SY.title = ''; saveSync(); render(); sheetNow();
        break;
      }
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.getAttribute('data-input') === 'q') { UI.q = t.value; var pos = t.selectionStart; render(); var n = document.querySelector('[data-input="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { } } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, di = t.getAttribute('data-input'), fl = t.files ? Array.prototype.slice.call(t.files) : [];
    if (di === 'pic' && fl[0]) {
      var kind = t.getAttribute('data-kind'), k = t.getAttribute('data-k');
      toJpeg(fl[0], 256, true).then(function (u) { IMG[imgKey(kind, k)] = u; refreshPicRow(kind, k); }, picError);
      return;
    }
    if (t.getAttribute('data-input') === 'import' && t.files && t.files[0]) {
      t.files[0].text().then(function (txt) {
        var inc = M.normalize(JSON.parse(txt));
        S = M.merge(S, inc); editSeq++; SY.dirty = true; saveState(); saveSync(); render(); scheduleSync(500);
      }).catch(function () { alert('Файл не похож на копию меню'); });
    }
  });

  function exportJson() {
    var blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'menu-' + today() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- жизненный цикл: сохранение при выходе и синхронизация при возврате ---------- */
  function flush() { saveState(); saveSync(); }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { flush(); if (SY.dirty) syncNow(); }
    else { scheduleSync(300); }
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener('online', function () { scheduleSync(300); });
  window.addEventListener('offline', function () { setStatus('offline'); });
  setInterval(function () { if (document.visibilityState === 'visible' && FAMILY.keys) syncNow(); }, 30000);
  window.addEventListener('focus', function () { if (FAMILY.keys) scheduleSync(300); });

  /* присоединиться к семье: данные устройства заменяются данными семьи — чужая ссылка не уносит ваши данные */
  async function joinFamily(code, fromLink) {
    if (code === FAMILY.code) return;
    var hasData = M.list(S, 'meals').length || M.list(S, 'pantry').length || M.list(S, 'family').length || M.list(S, 'shop').length || M.list(S, 'recipes').length;
    var q = 'Присоединить это устройство к семье по ссылке?' + (fromLink ? ' Открывайте только ссылки от своих.' : '') +
      (hasData || FAMILY.code ? ' Данные на этом устройстве будут заменены данными семьи.' : '');
    if ((fromLink || hasData || FAMILY.code) && !confirm(q)) return;
    S = M.blank(); await saveState();
    await familyUse(code); await relayReset();
    UI.tab = 'today'; lsSet('tab', 'today'); render(); syncNow();
  }

  async function init() {
    var h = readHash();
    var st = await store.get('state'), st2 = lsGet('state');
    if (st) S = M.normalize(st);
    if (st2) S = M.merge(S, M.normalize(st2));
    SY = (await store.get('sync')) || {};
    UI.tab = lsGet('tab') || 'today'; if (!/^(today|menu|shop|home|recipes|more)$/.test(UI.tab)) UI.tab = 'today';
    IMG = (await store.get('imgs')) || {};
    await famLoadKey();
    var code = await store.get('famcode'); if (code && FK.fromCode(code)) await familyUse(code);
    RS = (await store.get('relay')) || RS;
    if (TAURI) {
      try { DESK.signed = await invoke('google_signed_in'); } catch (e) { }
    }
    render();
    if (TAURI && TAURI.updater) TAURI.updater.check().then(function (u) { if (u) { UI.update = u; render(); } }).catch(function () { });
    if (h && h.join) await joinFamily(FK.toCode(h.join), true);
    if (h && h.login) { var ex = lsGet('exchange'); lsSet('exchange', null); if (h.login === 'ok' && ex) { UI.tab = 'more'; render(); sheetNow(); } }
    if (FAMILY.keys) syncNow(); else setStatus('none');
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { });
  window.__menu = { get S() { return S; }, get SY() { return SY; }, syncNow: syncNow };
  init();
})();

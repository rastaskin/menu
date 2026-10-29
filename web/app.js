/* «Меню» — интерфейс. Без фреймворков. Данные: IndexedDB (локально, сохраняется при каждом изменении);
   устройства семьи обмениваются через релей со сквозным шифрованием (relay.js), Google Таблица — разовый обмен по кнопке. */
(function () {
  'use strict';
  var M = window.MModel, P = window.MPlan, SH = window.MSheets, CFG = window.MCONFIG || {};
  /* таблица + скрытая папка приложения на Google Диске (ключ семьи, gdrive.js) */
  var SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.appdata';
  /* Google Календарь — только если включён: свой календарь «Меню» (calendar.app.created) и чтение событий основного */
  var CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.events.readonly';
  function scopes() { return SCOPE + (SY.cal ? ' ' + CAL_SCOPE : ''); }
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
  /* блюдо в меню получает картинку своего рецепта (M.recipeFor), если она есть */
  function mealPic(text, m) {
    var r = m ? P.mealRecipes(S, m)[0] : M.recipeFor(S, text);
    return r && IMG[imgKey('r', r.name)] ? pic('r', r.name, text) : F.html(text);
  }
  /* файл → JPEG data URL; square — центральный квадрат (для картинок продуктов и рецептов), иначе всё фото */
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
      '<label class="btn ghost" tabindex="0" role="button">' + (has ? 'Заменить картинку' : 'Своя картинка') + '<input type="file" accept="image/*" hidden data-input="pic" data-kind="' + kind + '" data-k="' + esc(k) + '"></label>' +
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
  /* отмена: снимок разделов до действия; «Отменить» возвращает записи как были (новыми правками — синхронизация их разнесёт) */
  var UNDO_COLS = ['meals', 'days', 'shop', 'pantry', 'recipes'];
  function snap() { var o = {}; UNDO_COLS.forEach(function (c) { o[c] = M.clone(S[c]); }); return o; }
  function restore(o) {
    commit(function (c) {
      UNDO_COLS.forEach(function (col) {
        Object.keys(o[col]).forEach(function (id) { var r = o[col][id], p = {}; M.COLS[col].forEach(function (f) { p[f] = r[f] == null ? '' : r[f]; }); c.put(col, id, p); });
        Object.keys(S[col]).filter(function (id) { return !o[col][id]; }).forEach(function (id) { c.del(col, id); });
      });
    });
    toast('Отменено.');
  }
  function undoable(msg, fn, more) {
    var o = snap(); commit(fn);
    toast(msg, [{ label: 'Отменить', fn: function () { restore(o); } }].concat(more || []));
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
      await TAURI.opener.openUrl(AUTH_URL + '?' + qs({ client_id: CFG.desktopClientId, redirect_uri: redirect, response_type: 'code', scope: scopes(),
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
  /* after — что сделать после входа: 'sheet' — обмен с таблицей, 'gload' / 'gsave' / 'gforget' — ключ семьи в Google (googleKey) */
  function login(prompt, after) {
    after = after || 'sheet';
    var then = function () { if (after === 'sheet') sheetNow(); else if (after === 'cal') calSync(true); else googleKey(after, true); };
    var say = function (m) { if (after === 'sheet') UI.sheet = m; else if (after === 'cal') UI.cal = m; else UI.gkey = m; render(); };
    if (TAURI) {
      if (!CFG.desktopClientSecret) { say('В этой сборке нет секрета Desktop-клиента Google'); return; }
      say('busy');
      desktopLogin().then(function () { SY.authed = true; saveSync(); render(); then(); })
        .catch(function (e) { say('Вход не завершён: ' + (e.message || e)); });
      return;
    }
    if (!CFG.webClientId) { alert('В config.js не задан Client ID Google'); return; }
    var st = b64url(rnd(16));
    lsSet('oauth', { st: st, ts: Date.now() }); lsSet('after', after);
    var q = { client_id: CFG.webClientId, redirect_uri: location.origin + location.pathname.replace(/index\.html$/, ''), response_type: 'token', scope: scopes(), state: st, include_granted_scopes: 'true' };
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
  /* FAMILY.gen растёт при каждой смене семьи: проход синхронизации, начатый для прежней семьи, свой результат выбрасывает */
  var FK = window.MFamily, RL = window.MRelay, FAMILY = { code: '', keys: null, gen: 0 }, RS = { seq: 0, sent: {}, at: 0 };
  async function familyUse(code) {
    FAMILY.gen++; UI.gone = false;
    FAMILY.code = code || ''; FAMILY.keys = code ? await FK.derive(FK.fromCode(code)) : null;
    await store.set('famcode', code || null);
  }
  async function relayReset() { RS = { seq: 0, sent: {}, at: 0 }; await store.set('relay', RS); }
  function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms == null ? 1500 : ms); }
  function setStatus(s, err) { UI.status = s; UI.err = err || ''; var el = document.querySelector('[data-sync]'); if (el) el.outerHTML = syncChip(); }
  async function syncNow(force) {
    if (syncing) { again = true; return; }
    if (!FAMILY.keys) return setStatus('none');
    if (UI.gone && force !== true) return setStatus('gone');   // ключ сменили: релей этой семьи закрыт, не стучимся зря
    if (!CFG.relayUrl) return setStatus('error', 'В этой сборке не указан адрес релея');
    if (!navigator.onLine) return setStatus('offline');
    syncing = true; setStatus('sync');
    var seq = editSeq, gen = FAMILY.gen;
    function current() { if (gen !== FAMILY.gen) { var e = new Error('family changed'); e.stale = true; throw e; } }
    try {
      var res = await RL.run({
        fetch: hfetch, url: CFG.relayUrl, keys: FAMILY.keys, sent: RS.sent, seq: RS.seq,
        get: function () { current(); return S; },
        persist: async function (Mg) { current(); S = M.merge(S, Mg); await saveState(); }
      });
      current();
      if (res.dropped.length) { res.dropped.forEach(function (k) { delete S.tomb[k]; }); await saveState(); }
      RS = { seq: res.seq, sent: res.sent, at: Date.now() }; await store.set('relay', RS);
      if (editSeq === seq) SY.dirty = false;
      await saveSync(); setStatus('ok');
      if (res.changed) { render(); famDecrypt(); }
      closeOld(); calAuto();
    } catch (e) {
      if (e.stale) again = true;
      else if (e.status === 410) { UI.gone = true; setStatus('gone'); render(); }
      else if (e.status === 401 || e.status === 403) setStatus('denied');
      else if (e.status === 429) setStatus('error', 'Релей просит подождать — повторю позже');
      else if (e.status === 503) setStatus('error', 'Релей сейчас не принимает новые семьи');
      else if (e.status === 507) setStatus('error', 'Место для семьи на релее закончилось');
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
    none: 'Семья не настроена', offline: 'Нет сети — сохранено на устройстве', sync: 'Синхронизация…', gone: 'Ключ семьи сменили',
    denied: 'Релей не принял ключ семьи', error: 'Ошибка синхронизации'
  };
  function syncLabel() {
    if (UI.status === 'ok') return (window.innerWidth < 480 ? 'Синхр. ' : 'Синхронизировано ') + ago(RS.at);
    return ST[UI.status] || '';
  }
  function syncChip() {
    if (UI.status === 'none') return '<span data-sync hidden></span>';   // без семьи плашка не нужна: устройство работает само по себе
    var warn = /denied|error|offline|gone/.test(UI.status);   // «без семьи» — осознанный выбор, не ошибка
    return '<button class="sync' + (warn ? ' warn' : '') + (UI.status === 'sync' ? ' busy' : '') + '" data-sync data-act="sync-tap"><span>' + esc(syncLabel()) + '</span></button>';
  }

  /* ссылка-приглашение: ключ семьи во фрагменте #join=… (на сервер фрагмент не уходит) */
  function joinLink() { return (CFG.appUrl || location.origin + location.pathname) + '#join=' + FAMILY.code; }
  /* ключ семьи в Google Диске (gdrive.js): gload — войти в семью, gsave — сохранить, gforget — убрать.
     again — уже после свежего входа: второй раз не перелогиниваемся */
  var GD = window.MGDrive;
  async function googleKey(op, again) {
    if (!tokenValid()) { login('select_account', op); return; }
    UI.gkey = 'busy'; render();
    try {
      if (op === 'gload') {
        var code = await GD.load(hfetch, getToken);
        if (!code || !FK.fromCode(code)) { UI.gkey = 'В этом Google-аккаунте ключа семьи нет. Подключите устройство по QR-коду или ссылке, а потом нажмите «Сохранить ключ в Google».'; render(); return; }
        UI.gkey = ''; await joinFamily(code);
        if (FAMILY.code === code) { UI.gsaved = true; lsSet('gkey', 1); }
      } else if (op === 'gsave') {
        await GD.save(hfetch, getToken, FAMILY.code); UI.gsaved = true; lsSet('gkey', 1); UI.gkey = 'Ключ семьи сохранён в Google.';
      } else {
        await GD.forget(hfetch, getToken); UI.gsaved = false; lsSet('gkey', null); UI.gkey = 'Ключ семьи убран из Google.';
      }
    } catch (e) {
      if (!again && (e.status === 401 || e.reason === 'insufficientPermissions')) {   // нет входа или старый вход без доступа к Диску
        lsSet('token', null); if (TAURI) DESK.signed = false;
        login('consent', op); return;
      }
      UI.gkey = e.status === 403 ? 'Google не дал доступ к Диску. Проверьте, что в проекте Google Cloud включён Google Drive API.'
        : !navigator.onLine ? 'Нет сети' : 'Не получилось: ' + String(e.message || e);
    }
    render();
  }
  /* ---------- Google Календарь (gcal.js): блюда и готовка — в свой календарь «Меню», события основного — в дни меню ----------
     Состояние — на устройстве: SY.cal = {id, sent, at}, SY.calEv = {дата: [текст]}; в семью и таблицу не уходит. */
  var GC = window.MGCal, SLOT_TIME = { 'завтрак': '08:00', 'обед': '13:00', 'перекус': '16:30', 'ужин': '19:00', 'с собой': '08:30' };
  function calTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'; } catch (e) { return 'Europe/Moscow'; } }
  function calWanted(from, to) {
    var out = [];
    M.list(S, 'meals').forEach(function (m) {
      if (!m.text || !m.date || m.date < from || m.date > to) return;
      var rs = mealRecipes(m).map(function (r) { return r.name; });
      out.push({ key: 'm:' + m.id, date: m.date, start: m.time || SLOT_TIME[m.slot] || '12:00', mins: 30,
        summary: slotLabel(m.slot) + ': ' + m.text + (m.prep ? ' (заготовка)' : ''),
        description: (rs.length ? 'Рецепт: ' + rs.join(', ') + '\n' : '') + 'Из приложения «Меню»' });
    });
    M.list(S, 'days').forEach(function (d) {
      var date = d.date || d.id; if (!d.cook || !date || date < from || date > to) return;
      out.push({ key: 'c:' + date, date: date, summary: 'Готовка: ' + d.cook, description: 'Из приложения «Меню»' });
    });
    return out;
  }
  async function calSync(manual) {
    if (!SY.cal || UI.cal === 'busy') return;
    if (!tokenValid()) { if (manual) login('consent', 'cal'); return; }
    UI.cal = 'busy'; if (manual) render();
    var t = today(), from = addDays(t, -7), to = addDays(t, 28), tz = calTz();
    try {
      var cal = await GC.push({ fetch: hfetch, token: getToken, cal: SY.cal, wanted: calWanted(from, to), from: from, to: to, tz: tz, title: 'Меню' });
      SY.calEv = await GC.pull({ fetch: hfetch, token: getToken, from: addDays(t, -31), to: addDays(t, 60) });
      if (SY.cal) SY.cal = Object.assign(cal, { at: Date.now() });
      UI.cal = ''; await saveSync();
    } catch (e) {
      if (e.status === 401 || e.reason === 'insufficientPermissions') {   // нет входа или вход без доступа к календарю
        UI.cal = manual ? '' : 'Нужен вход в Google с доступом к календарю — нажмите «Обменяться с календарём».';
        if (manual) { UI.cal = ''; lsSet('token', null); if (TAURI) DESK.signed = false; login('consent', 'cal'); return; }
      } else UI.cal = e.status === 403 && /accessNotConfigured|disabled/i.test(e.reason) ? 'Google не дал доступ к календарю: в проекте Google Cloud нужно включить Google Calendar API.'
        : !navigator.onLine ? 'Нет сети' : 'Не получилось: ' + String(e.message || e);
    }
    render();
  }
  /* сам — не чаще раза в 10 минут и только с действующим входом (без окна входа) */
  function calAuto() { if (SY.cal && UI.cal !== 'busy' && tokenValid() && Date.now() - (SY.cal.at || 0) > 600000) calSync(false); }
  function calChips(date) { return ((SY.calEv && SY.calEv[date]) || []).map(function (t) { return '<span class="tag t-cal" title="Google Календарь">' + esc(t) + '</span>'; }).join(''); }
  function viewCal() {
    var h = '<section class="box" id="gcal"><h3>Google Календарь</h3>', busy = UI.cal === 'busy';
    if (!SY.cal) return h + '<p>Блюда и план готовки появятся в отдельном календаре «Меню» в вашем Google Календаре, а события основного календаря (учёба, работа, дни рождения) — в днях меню, чтобы планировать еду под занятость.</p>' +
      '<p class="muted">События основного календаря остаются только на этом устройстве — в семью и таблицу они не попадают.</p>' +
      '<button type="button" class="btn ghost" data-act="cal-on">Подключить календарь</button>' + (UI.cal ? '<p class="muted" role="status">' + esc(UI.cal) + '</p>' : '') + '</section>';
    return h + '<p><b>Календарь «Меню»</b><br><span class="muted">' + (busy ? 'Обмен…' : UI.cal ? esc(UI.cal) : 'Последний обмен: ' + ago(SY.cal.at)) + '</span></p>' +
      '<p class="muted">Выгружаются дни от недели назад до четырёх недель вперёд; время блюда — из окна блюда, иначе обычное для приёма пищи.</p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="cal-now"' + (busy ? ' disabled' : '') + '>Обменяться с календарём</button>' +
      '<button type="button" class="link danger" data-act="cal-off">Отключить</button></div></section>';
  }
  function gkeyNote() { return UI.gkey ? '<p class="muted" role="status">' + (UI.gkey === 'busy' ? 'Связываюсь с Google…' : esc(UI.gkey)) + '</p>' : ''; }
  function deviceModal(note) {
    var link = joinLink();
    modal('<div class="device"><h3>' + (note ? 'Новый ключ семьи' : 'Новое устройство') + '</h3>' + (note ? '<p><b>' + esc(note) + '</b></p>' : '') +
      '<p>Наведите камеру телефона на код или откройте ссылку на новом устройстве. В приложении на ПК и с экрана «Домой» iPhone: «Ещё» → вставьте ссылку в поле «Присоединиться».</p>' +
      '<div class="qrbox">' + MQR.svg(link) + '</div>' +
      '<div class="copy"><input readonly value="' + esc(link) + '" aria-label="Ссылка для нового устройства"><button type="button" class="btn" data-act="copy" data-v="' + esc(link) + '">Копировать</button></div>' +
      '<p class="muted">Ссылка — ключ ко всем данным семьи. Отправляйте только своим и не публикуйте.</p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="show-words">Показать 12 слов</button><button type="button" class="btn ghost" data-act="close">Готово</button></div></div>');
  }
  /* смена ключа семьи: всё — под новым ключом, старая семья на релее стирается и закрывается (relay close → 410).
     Старые ссылка, QR и 12 слов больше ничего не открывают; свои устройства подключаются заново (QR или Google). */
  function rotateModal(msg) {
    var busy = UI.rot === 'busy';
    modal('<div class="rotate"><h3>Сменить ключ семьи</h3>' +
      '<p>Нужно, если ссылка-приглашение, QR-код или 12 слов попали к чужим, потерялось устройство или кто-то больше не должен видеть меню семьи.</p>' +
      '<ol class="gen"><li>Создаётся новый ключ, все данные переходят под него.</li>' +
      '<li>Данные под старым ключом на релее стираются: старые ссылка, QR-код и 12 слов больше ничего не открывают.</li>' +
      '<li>Остальные ваши устройства перестанут получать изменения — подключите их заново новым QR-кодом' + (UI.gsaved ? ' или «Войти через Google»: ключ в Google обновится сам' : '') + '. Их данные останутся.</li></ol>' +
      '<p class="muted">Нужна сеть. Изменения, которые другие устройства ещё не успели отправить, останутся только на них.</p>' +
      (msg ? '<p class="err" role="alert">' + esc(msg) + '</p>' : '') +
      '<div class="row"><button type="button" class="btn" data-act="rotate-ok"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Меняю ключ…' : 'Сменить ключ') + '</button>' +
      '<button type="button" class="btn ghost" data-act="close"' + (busy ? ' disabled' : '') + '>Отмена</button></div></div>');
  }
  async function rotateFamily() {
    if (UI.rot === 'busy' || !FAMILY.keys) return;
    if (!navigator.onLine) return rotateModal('Нет сети — ключ можно сменить только онлайн.');
    UI.rot = 'busy'; rotateModal();
    while (syncing) await new Promise(function (r) { setTimeout(r, 150); });
    syncing = true;
    var oldCode = FAMILY.code, oldKeys = FAMILY.keys, ok = false, msg = '';
    var io = function (keys, sent, seq) {
      return RL.run({ fetch: hfetch, url: CFG.relayUrl, keys: keys, sent: sent, seq: seq, get: function () { return S; }, persist: async function (Mg) { S = M.merge(S, Mg); await saveState(); } });
    };
    try {
      if (!UI.gone) await io(oldKeys, RS.sent, RS.seq);   // сначала забрать то, что успели прислать другие устройства
      var code = FK.toCode(FK.newRoot()), res = await io(await FK.derive(FK.fromCode(code)), {}, 0);   // всё — в новую семью
      await familyUse(code);
      RS = { seq: res.seq, sent: res.sent, at: Date.now() }; await store.set('relay', RS);
      await store.set('closeold', oldCode); ok = true;
    } catch (e) {
      msg = e.status === 503 ? 'Релей сейчас не принимает новые семьи — попробуйте завтра. Ключ не сменён.'
        : !navigator.onLine || e instanceof TypeError ? 'Нет сети. Ключ не сменён.' : 'Не получилось (' + String(e.message || e) + '). Ключ не сменён.';
    } finally { syncing = false; UI.rot = ''; }
    if (!ok) return rotateModal(msg);
    await closeOld();
    setStatus('ok'); render();
    deviceModal('Ключ семьи сменён. Старые ссылка, QR-код и 12 слов больше не работают. Подключите остальные устройства этим кодом' + (UI.gsaved ? ' или через «Войти через Google»' : '') + '.');
    if (UI.gsaved) googleKey('gsave');
  }
  /* старая семья закрывается сразу после смены ключа; не вышло (нет сети) — при следующей синхронизации */
  async function closeOld() {
    var c = await store.get('closeold'); if (!c || !FK.fromCode(c)) return;
    try { await RL.close({ fetch: hfetch, url: CFG.relayUrl, keys: await FK.derive(FK.fromCode(c)) }); await store.set('closeold', null); } catch (e) { }
  }
  function viewDevices() {
    var h = '<section class="box" id="devices"><h3>Синхронизация</h3>';
    if (FAMILY.keys && UI.gone) {
      return h + '<p class="err">Ключ семьи сменили на другом устройстве.</p><p>Это устройство больше не получает и не отправляет изменения. Подключите его заново: отсканируйте новый QR-код, вставьте новую ссылку или 12 слов ниже или нажмите «Войти через Google». Данные на этом устройстве останутся — их копию можно будет скачать.</p>' +
        '<form class="add" data-form="join"><input name="code" autocomplete="off" placeholder="Новая ссылка-приглашение или 12 слов" aria-label="Новая ссылка-приглашение или 12 слов" required><button class="btn">Подключить</button></form>' +
        '<div class="row"><button type="button" class="btn ghost" data-act="gkey-load"' + (UI.gkey === 'busy' ? ' disabled' : '') + '>Войти через Google</button>' +
        '<button type="button" class="link danger" data-act="family-leave">Отключить устройство от семьи</button></div>' + gkeyNote() + '</section>';
    }
    if (!FAMILY.keys) {
      h += '<p>Устройства семьи обмениваются данными через релей. Всё шифруется на устройстве — сервер видит только шифр. Регистрации нет: устройства объединяет ключ семьи.</p>' +
        '<div class="row"><button type="button" class="btn" data-act="family-new">Создать семью</button>' +
        '<button type="button" class="btn ghost" data-act="gkey-load"' + (UI.gkey === 'busy' ? ' disabled' : '') + '>Войти через Google</button></div>' +
        '<p class="muted">«Войти через Google» подключит семью, если её ключ уже сохранён в этом Google-аккаунте с другого вашего устройства.</p>' + gkeyNote() +
        '<form class="add" data-form="join"><input name="code" autocomplete="off" placeholder="Ссылка-приглашение или 12 слов" aria-label="Ссылка-приглашение или 12 слов" required><button class="btn ghost">Присоединиться</button></form>';
    } else {
      h += '<p>Последняя синхронизация: ' + ago(RS.at) + '.</p>' +
        '<div class="row"><button type="button" class="btn" data-act="add-device">Добавить устройство</button><button type="button" class="btn ghost" data-act="sync-now">Синхронизировать</button></div>' +
        '<div class="gkey"><h4>Вход через Google</h4>' + (UI.gsaved
          ? '<p>Ключ семьи сохранён в Google: на других своих устройствах нажмите «Войти через Google» — QR-код не нужен.</p><button type="button" class="link" data-act="gkey-forget">Убрать ключ из Google</button>'
          : '<p>Сохраните ключ семьи в своём Google-аккаунте — тогда на других своих устройствах можно войти в семью без QR-кода. Ключ ляжет в скрытую папку приложения на Google Диске: кто войдёт в ваш Google-аккаунт, сможет открыть данные семьи.</p>' +
            '<button type="button" class="btn ghost" data-act="gkey-save"' + (UI.gkey === 'busy' ? ' disabled' : '') + '>Сохранить ключ в Google</button>') +
        gkeyNote() + '</div>' +
        '<div class="row"><button type="button" class="btn ghost" data-act="rotate">Сменить ключ семьи</button>' +
        '<button type="button" class="link danger" data-act="family-leave">Отключить устройство от семьи</button></div>' +
        '<p class="muted">Ключ стоит сменить, если ссылка, QR-код или 12 слов попали к чужим или потерялось устройство.</p>';
    }
    if (UI.err) h += '<p class="muted">' + esc(UI.err) + '</p>';
    return h + '</section>';
  }
  /* правила для чужого ИИ-агента, которому поручают таблицу; держать в согласии с docs/FORMAT.md и SHEETS в sheets.js */
  var AGENT_GUIDE = [
    'Ты правишь Google Таблицу семейного приложения «Меню». Приложение читает её построчно, поэтому строго соблюдай правила.',
    '',
    'ЛИСТЫ И СТОЛБЦЫ (первая строка — заголовки; не переименовывать, не переставлять, не добавлять и не удалять листы и столбцы):',
    '• Меню: id, дата, приём, блюдо, съели, рецепт, время, из заготовки, _u',
    '• Дни: id, дата, день, события, готовка, _u',
    '• Покупки: id, неделя, раздел, продукт, количество, цена, куплено, есть дома, перенесено домой, ключ, _u',
    '• Дома: id, продукт, количество, где, годен до, заметка, _u',
    '• Рецепты: id, название, как готовить, _u',
    '• Правила: id, правило, текст, _u',
    '• Настройки: ключ, значение, _u',
    '• Удалено: запись, _u',
    '• Семья: id, имя, цвет, данные (зашифровано), _u',
    '',
    'КАК ПРАВИТЬ:',
    '1. Изменил любую ячейку — очисти _u в той же строке. Пустой _u значит «правка из таблицы», и она побеждает копии на устройствах.',
    '2. Новая строка — уникальный id и пустой _u. Блюдо: id «ГГГГ-ММ-ДД/приём» (например 2026-11-03/ужин), день: «dГГГГ-ММ-ДД», покупка или продукт дома: любой новый id, например s-2026-11-03-1.',
    '3. Удаление — строку НЕ стирать. Добавь на лист «Удалено» строку «коллекция:id» с пустым _u. Коллекции: meals (Меню), days (Дни), shop (Покупки), pantry (Дома), recipes (Рецепты), rules (Правила), family (Семья).',
    '4. Даты — ГГГГ-ММ-ДД. Флажки (съели, куплено, есть дома, перенесено домой) — TRUE или пусто. Цена — число без «₽», дробная часть через точку или запятую. Неделя покупки — дата первого дня недели меню числом ГГГГММДД (например 20261103); старые номера 1, 2… тоже понимаются (n-я неделя меню).',
    '5. Приём пищи — строчными: завтрак, обед, перекус, ужин, с собой или свой (например «полдник»). В одном дне на один приём — одно блюдо.',
    '6. Дома → где: fridge (холодильник), freezer (морозилка), shelf (шкаф и полки).',
    '7. Дни → события: через «;», префиксы a: и g: — занятость членов семьи (например «a:Учёба 9:00–15:30»), z: ужин из заготовки, h: праздник, o: прочее.',
    '8. Новый период: добавь строки в «Дни» и «Меню» с новыми датами, покупки — с датой первого дня новой недели. Приложение само сгруппирует дни по 7.',
    '8а. Меню → рецепт: id рецептов через запятую (пусто — подбирается по названию блюда); время — ЧЧ:ММ; из заготовки — TRUE, если блюдо не готовят заново (тогда его продукты не попадают в покупки).',
    '9. Рецепты → как готовить: Markdown (## заголовки, **жирный**, - список, 1. шаги). Первая строка — «2 порции · 15 минут». Продукты — блок «## Продукты» со строками «- продукт — сколько» (например «- яйца — 4 шт», «- мука — 300 г»), дальше «## Как готовить». По продуктам приложение собирает покупки из меню и считает, что есть дома. До 15 000 знаков.',
    '',
    'НЕ ТРОГАТЬ:',
    '• столбец «данные (зашифровано)» на листе «Семья» — это шифр;',
    '• строки _rev, fam_salt и fam_check на листе «Настройки»;',
    '• не записывать в таблицу открытым текстом данные о здоровье (аллергии, вес, диагнозы, лекарства).',
    '',
    'Правки появятся на устройствах после кнопки «Обменяться сейчас» в приложении.'
  ].join('\n');
  function agentGuide() {
    return '<details class="guide"><summary>Инструкция для ИИ-агента</summary>' +
      '<p class="muted">Скопируйте и передайте агенту (ChatGPT, Gemini и др.) вместе со ссылкой на таблицу — так он не сломает формат.</p>' +
      '<pre>' + esc(AGENT_GUIDE) + '</pre><button type="button" class="btn ghost" data-act="copy" data-v="' + esc(AGENT_GUIDE) + '">Скопировать инструкцию</button></details>';
  }
  function viewSheet() {
    var h = '<section class="box"><h3>Google Таблица</h3><p>По желанию: обмен с таблицей по кнопке — чтобы править меню в таблице или поручить это Claude.</p>';
    if (!SY.sheetId) return h + '<form class="add" data-form="connect"><input name="link" placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Ссылка на таблицу" required><button class="btn ghost">Подключить</button></form>' + agentGuide() + '</section>';
    var busy = UI.sheet === 'busy', link = 'https://docs.google.com/spreadsheets/d/' + SY.sheetId + '/edit';
    h += '<p><b>' + esc(SY.title || 'Таблица') + '</b><br><span class="muted">' + (busy ? 'Обмен…' : UI.sheet && UI.sheet !== 'ok' ? esc(UI.sheet) : 'Последний обмен: ' + ago(SY.at)) + '</span></p>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="sheet-now"' + (busy ? ' disabled' : '') + '>Обменяться сейчас</button>' +
      '<a class="btn ghost" href="' + esc(link) + '" target="_blank" rel="noopener">Открыть таблицу</a></div>' +
      (tokenValid() ? '<button type="button" class="link" data-act="logout">Выйти из Google</button>' : '') +
      '<button type="button" class="link danger" data-act="disconnect">Отключить таблицу</button>' + agentGuide();
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
  /* Покупки по неделям меню. Неделя покупки — дата начала недели меню числом (20261027) или старый номер 1, 2… (n-я неделя меню).
     → [{key, label, wk (что писать в «неделя»), dates (дни недели меню или null), items}]: прошлые недели без покупок не показываются. */
  function wkNum(date) { return +String(date).replace(/-/g, ''); }
  function numDate(n) { n = String(n); return n.slice(0, 4) + '-' + n.slice(4, 6) + '-' + n.slice(6, 8); }
  function shopGroups() {
    var ws = weeks(), t = today(), other = {};
    var gs = ws.map(function (w, i) { return { key: 'w' + i, label: dm(w[0]) + '–' + dm(w[w.length - 1]), wk: wkNum(w[0]), dates: w, items: [] }; });
    M.list(S, 'shop').forEach(function (it) {
      var w = it.week || 0, g = null;
      if (w > 0 && w < 1000) g = gs[w - 1] || null;
      else if (w >= 19000101) { var d = numDate(w); g = gs.filter(function (x) { return x.dates[0] <= d && d <= x.dates[x.dates.length - 1]; })[0] || null; }
      if (!g) { var k = 'n' + w; g = other[k] || (other[k] = { key: k, label: w >= 19000101 ? 'с ' + dm(numDate(w)) : 'Неделя ' + (w || '—'), wk: w || wkNum(t), dates: null, items: [] }); }
      g.items.push(it);
    });
    return gs.filter(function (g) { return g.items.length || g.dates[g.dates.length - 1] >= t; })
      .concat(Object.keys(other).map(function (k) { return other[k]; }));
  }
  /* выбранная неделя покупок: по умолчанию — та, где сегодня, иначе ближайшая следующая */
  function shopGroup(gs) {
    gs = gs || shopGroups();
    var t = today(), g = gs.filter(function (x) { return x.key === UI.shopWeek; })[0];
    return g || gs.filter(function (x) { return x.dates && x.dates.indexOf(t) >= 0; })[0] || gs.filter(function (x) { return x.dates && x.dates[0] > t; })[0] || gs[0] || null;
  }
  function shopCats() { var cats = []; M.list(S, 'shop').forEach(function (i) { if (i.cat && cats.indexOf(i.cat) < 0) cats.push(i.cat); }); return cats; }
  /* продукты в покупки текущей недели (закончилось дома) */
  function shopPut(c, list) {
    var g = shopGroup(), wk = g ? g.wk : wkNum(today()), cats = shopCats();
    list.forEach(function (p) { c.put('shop', uid('s'), { name: p.name, qty: p.qty || '', cat: P.catFor(p.name, cats), week: wk }); });
  }
  function toShop(list) {
    commit(function (c) { shopPut(c, list); });
    toast('В покупках: ' + list.map(function (p) { return p.name; }).join(', ') + '.');
  }
  /* рецепты блюда и аллергии семьи (видны, только когда карточки открыты семейным паролем на этом устройстве) */
  function mealRecipes(m) { return P.mealRecipes(S, m); }
  function famAllergies() { return members().map(function (m) { var p = famPlain(m); return p && !p.bad && p.allergies ? { m: m, a: p.allergies } : null; }).filter(Boolean); }
  function allergyOf(text, recipes) {
    var fa = famAllergies(); if (!fa.length) return [];
    var all = text + ' ' + recipes.map(function (r) { return r.name + ' ' + M.ingredients(r.text).map(function (g) { return g.name; }).join(' '); }).join(' ');
    return fa.map(function (x) { return { m: x.m, hits: P.allergyHits(x.a, all) }; }).filter(function (x) { return x.hits.length; });
  }
  function algBadge(hits) {
    if (!hits.length) return '';
    var who = hits.map(function (x) { return x.m.name + ': ' + x.hits.join(', '); }).join('; ');
    return '<span class="alg" title="Аллергия — ' + esc(who) + '">⚠ ' + esc(hits.map(function (x) { return x.hits.join(', '); }).join(', ')) + '<span class="vh"> — аллергия: ' + esc(who) + '</span></span>';
  }
  function mealAlg(m) { return m && m.text ? algBadge(allergyOf(m.text, mealRecipes(m))) : ''; }
  /* время и «из заготовки» у блюда — мелкие пометки рядом с названием приёма */
  function mealMarks(m) { return m ? (m.time ? '<span class="mk">' + esc(m.time) + '</span>' : '') + (m.prep ? '<span class="mk">заготовка</span>' : '') : ''; }

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
  /* фото члена семьи — только JPEG data URL из своего же сжатия (toJpeg); всё прочее с релея не показываем */
  var PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;
  function memberPhoto(id) { var r = id && S.photos[id]; return r && PHOTO_RE.test(r.img || '') ? r.img : ''; }
  function avatar(m, photo) {
    var u = photo === undefined ? memberPhoto(m.id) : photo, c = MCOLORS.indexOf(m.color) >= 0 ? m.color : 'pear';
    return u && PHOTO_RE.test(u) ? '<img class="ava ava-img" src="' + u + '" alt="" aria-hidden="true">' : '<span class="ava mc-' + c + '" aria-hidden="true">' + memberInitial(m) + '</span>';
  }
  /* строка «Фото» в окне члена семьи: FAM.photo — выбранное, но ещё не сохранённое (null — убрать) */
  function photoRow(id) {
    var m = (id && S.family[id]) || { id: '', name: '', color: 'pear' }, cur = FAM.photo !== undefined ? FAM.photo : memberPhoto(id);
    return '<div class="mphoto">' + avatar(m, cur || '') +
      '<label class="btn ghost" tabindex="0" role="button">' + (cur ? 'Заменить фото' : 'Добавить фото') + '<input type="file" accept="image/*" hidden data-input="member-photo"></label>' +
      (cur ? '<button type="button" class="link danger" data-act="member-photo-del">Убрать фото</button>' : '') + '</div>';
  }
  function refreshPhotoRow() { var f = document.querySelector('#modal form[data-form="member"]'), el = f && f.querySelector('.mphoto'); if (el) el.outerHTML = photoRow(f.getAttribute('data-id')); }
  function memberCard(m) {
    var p = famPlain(m);
    var body = !m.enc ? '<span class="sub">аллергии и вес не заполнены</span>'
      : !FAM.key ? '<span class="sub">' + ICO.lock + 'данные под семейным паролем</span>'
      : !p ? '<span class="sub">расшифровываю…</span>'
      : p.bad ? '<span class="sub danger">не расшифровывается этим паролем</span>'
      : '<span class="sub">' + (p.allergies ? 'аллергии: ' + esc(p.allergies) : 'аллергий нет') + '</span>' + (p.weight ? '<span class="sub">вес ' + esc(p.weight) + ' кг</span>' : '');
    return '<li><button class="member" data-act="member-edit" data-id="' + esc(m.id) + '">' + avatar(m) +
      '<span class="mtext"><span class="nm">' + esc(m.name || 'Без имени') + '</span>' + body + '</span></button></li>';
  }
  function viewFamily() {
    var salt = famMeta('fam_salt'), h = '<section class="box" id="family"><h3>Семья</h3>';
    if (!salt) {
      h += '<p>Карточка члена семьи: имя видно на всех устройствах семьи и в таблице при обмене, фото — только на устройствах семьи, а аллергии, вес и заметка шифруются семейным паролем. ' +
        'Пароль нигде не хранится: если его забыть, эти данные не восстановить. Сообщите его семье устно.</p>' +
        '<form class="add" data-form="fam-pass"><input name="p1" type="password" autocomplete="new-password" minlength="8" placeholder="Семейный пароль, от 8 знаков" aria-label="Семейный пароль" required>' +
        '<input name="p2" type="password" autocomplete="new-password" minlength="8" placeholder="Ещё раз" aria-label="Пароль ещё раз" required>' +
        '<label class="ck wide"><input type="checkbox" name="saved"> Пароль записан в надёжном месте — восстановить его нельзя</label><button class="btn">Задать пароль</button></form>';
    } else if (!FAM.key) {
      h += '<form class="add" data-form="fam-unlock"><input name="p" type="password" autocomplete="current-password" placeholder="Семейный пароль" aria-label="Семейный пароль" required><button class="btn">Открыть карточки</button></form>';
    }
    if (passDue()) h += '<form class="add check" data-form="fam-check"><p><b>Помните семейный пароль?</b> Раз в месяц стоит проверить: если он забудется, аллергии и вес не открыть ни на одном новом устройстве.</p>' +
      '<input name="p" type="password" autocomplete="current-password" placeholder="Семейный пароль" aria-label="Семейный пароль для проверки" required><button class="btn">Проверить</button>' +
      '<button type="button" class="link" data-act="pass-later">Через неделю</button></form>';
    var ms = members();
    h += ms.length ? '<ul class="members">' + ms.map(memberCard).join('') + '</ul>' : '<p class="muted">Карточек пока нет.</p>';
    h += '<div class="row"><button type="button" class="btn ghost" data-act="member-edit" data-id="">' + ICO.plus + 'Член семьи</button>' +
      (FAM.key ? '<button type="button" class="link" data-act="fam-forget">Закрыть карточки на этом устройстве</button>' : '') + '</div>' + secretsGuide() + '</section>';
    return h;
  }
  /* два секрета — что есть что */
  function secretsGuide() {
    return '<details class="guide"><summary>Ключ семьи и семейный пароль — что есть что</summary><dl class="secrets">' +
      '<dt>Ключ семьи</dt><dd>Ссылка-приглашение, QR-код или 12 слов. Открывает всё меню семьи и подключает новые устройства. Хранится на устройствах семьи (и в Google, если вы его туда сохранили). Потеряли — подключите устройство по QR-коду с другого.</dd>' +
      '<dt>Семейный пароль</dt><dd>Только для аллергий, веса и заметок в карточках. Нигде не хранится и не восстанавливается: забыли — эти данные не открыть. Сообщите его семье устно и запишите на бумаге.</dd>' +
      '</dl></details>';
  }
  function memberEditor(id) {
    var m = id ? S.family[id] : null, p = m ? famPlain(m) || {} : {}, locked = !FAM.key;
    FAM.photo = undefined;
    modal('<form data-form="member" data-id="' + esc(id || '') + '"><h3>' + (m ? 'Член семьи' : 'Новый член семьи') + '</h3>' + photoRow(id) +
      '<p class="err" role="alert" hidden></p>' +
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
      return '<li>' + avatar(r.m) + '<span><b>' + esc(r.m.name) + '</b><span class="sub">' + esc(r.a) + '</span></span></li>';
    }).join('') + '</ul></section>' : '';
  }

  /* «Сегодня»: тарелка дня — приёмы пищи крупно, готовка на грушевом поле, что скоро испортится, завтрашний день. */
  function mealRow(date, s, big) {
    var m = mealAt(date, s), has = m && m.text;
    return '<li class="meal' + (big ? ' big' : '') + (m && m.done ? ' done' : '') + (s === 'с собой' ? ' go' : '') + '">' +
      (has ? mealPic(m.text, m) : '<span class="fi fi-none" aria-hidden="true"></span>') +
      '<button class="mtxt" data-act="meal-edit" data-date="' + date + '" data-slot="' + esc(s) + '"><span class="lbl">' + esc(slotLabel(s)) + mealMarks(m) + '</span>' +
      (has ? '<span class="dish">' + esc(m.text) + '</span>' + mealAlg(m) : '<span class="muted">Добавить блюдо</span>') + '</button>' +
      '<button class="chk" data-act="meal-done" data-date="' + date + '" data-slot="' + esc(s) + '" aria-label="Съели" aria-pressed="' + !!(m && m.done) + '" ' + (m ? '' : 'disabled') + '>' + (m && m.done ? ICO.check : '') + '</button></li>';
  }
  /* приёмы дня: четыре основных всегда, свои («полдник») — если есть, «с собой» — последним, если есть */
  function slotsOf(date) {
    var own = mealsOf(date).map(function (m) { return m.slot; }).filter(function (s, i, a) { return s && M.SLOTS.indexOf(s) < 0 && a.indexOf(s) === i; }).sort();
    return M.SLOTS.filter(function (s) { return s !== 'с собой'; }).concat(own, mealAt(date, 'с собой') ? ['с собой'] : []);
  }
  function slotLabel(s) { s = String(s || ''); return SLOT_LABEL[s] || s.charAt(0).toUpperCase() + s.slice(1); }
  function normSlot(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 30); }
  /* id нового блюда: «дата/приём», а если такой уже занят перенесённым блюдом — случайный */
  function newMealId(date, slot) { var id = date + '/' + slot; return S.meals[id] ? uid('m') : id; }
  function viewToday() {
    var ds = dates(), t = today();
    if (!ds.length) return emptyState();
    var date = ds.indexOf(t) >= 0 ? t : (ds.filter(function (x) { return x > t; })[0] || ds[ds.length - 1]);
    var d = dayRec(date) || {}, tg = tags(d.tags), pd = parseD(date), sl = slotsOf(date);
    var eaten = sl.filter(function (s) { var m = mealAt(date, s); return m && m.done; }).length;
    var next = ds[ds.indexOf(date) + 1], nd = next ? dayRec(next) || {} : null;
    var head = '<header class="day-head"><h2>' + (date === t ? 'Съели ' + eaten + ' из ' + sl.length : 'Ближайший день: ' + WDL[pd.getDay()] + ', ' + pd.getDate() + ' ' + MON[pd.getMonth()]) + '</h2>' +
      (tg.length || calChips(date) ? '<div class="tags">' + tg.map(function (x) { return '<span class="tag t-' + x.k + '">' + esc(x.t) + '</span>'; }).join('') + calChips(date) + '</div>' : '') + '</header>';
    var plate = '<ul class="plate" id="d' + date + '">' + sl.map(function (s) { return mealRow(date, s, true); }).join('') + '</ul>' +
      (mealAt(date, 'с собой') ? '' : '<button class="link" data-act="meal-edit" data-date="' + date + '" data-slot="с собой">+ С собой</button>');
    var cook = '<section class="field">' + ICO.pot + '<div><h3>Готовка</h3><p>' + (d.cook ? esc(d.cook) : 'План готовки не задан') + '</p>' +
      '<button class="btn ghost" data-act="cook-edit" data-date="' + date + '">' + (d.cook ? 'Изменить' : 'Добавить') + '</button></div></section>';
    var rem = reminders(), home = rem.length ? '<section class="panel"><h3>Не забыть</h3><ul class="soon-list">' + rem.map(function (r) {
      return '<li><button class="row-btn" ' + r.act + '>' + r.pic + '<span><span class="nm">' + esc(r.nm) + '</span><span class="sub' + (r.warn ? '' : ' calm') + '">' + esc(r.sub) + '</span></span></button></li>';
    }).join('') + '</ul></section>' : '';
    var can = cookable().slice(0, 3), cook2 = can.length ? '<section class="panel"><h3>Из того, что дома</h3><ul class="soon-list">' + can.map(function (x) {
      return '<li><button class="row-btn" data-act="recipe-open" data-id="' + esc(x.r.id) + '" aria-haspopup="dialog">' + pic('r', x.r.name, x.r.name) +
        '<span><span class="nm">' + esc(x.r.name) + '</span><span class="sub calm">дома ' + x.n + ' из ' + x.of + ' продуктов</span></span></button></li>';
    }).join('') + '</ul></section>' : '';
    var tom = next ? '<section class="panel"><h3>Завтра, ' + WDL[parseD(next).getDay()] + '</h3><ul class="mini-plate">' + slotsOf(next).map(function (s) {
      var m = mealAt(next, s); return '<li>' + (m && m.text ? mealPic(m.text) : '<span class="fi fi-none" aria-hidden="true"></span>') +
        '<span><span class="lbl">' + esc(slotLabel(s)) + '</span>' + (m && m.text ? esc(m.text) : '<span class="muted">не задано</span>') + '</span></li>';
    }).join('') + '</ul>' + (nd && nd.cook ? '<p class="cook-line">' + ICO.pot + '<span>' + esc(nd.cook) + '</span></p>' : '') +
      '<button class="btn ghost" data-act="tab" data-tab="menu">Вся неделя</button></section>' : '';
    return '<div class="today">' + '<div class="today-main">' + head + plate + '</div><div class="today-side">' + home + cook + allergyPanel() + tom + cook2 + '</div></div>';
  }
  /* «Не забыть»: что скоро испортится, что разморозить к завтрашним блюдам, что купить, проверка семейного пароля.
     → [{nm, sub, pic, act, plain}] — plain идёт в уведомление на ПК */
  function reminders() {
    var t = today(), out = [], ds = dates(), next = ds.filter(function (x) { return x > t; })[0];
    M.list(S, 'pantry').filter(function (p) { return p.until && p.until <= addDays(t, 2); }).sort(function (a, b) { return a.until < b.until ? -1 : 1; }).forEach(function (p) {
      var sub = (p.until < t ? 'просрочено ' : 'годен до ') + dm(p.until);
      out.push({ nm: p.name, sub: sub, warn: true, pic: pic('p', p.name, p.name), act: 'data-act="pantry-edit" data-id="' + esc(p.id) + '"', plain: p.name + ' — ' + sub });
    });
    if (next) {
      var seen = {};
      slotsOf(next).forEach(function (s) {
        var m = mealAt(next, s); if (!m || !m.text || P.isPrep(m)) return;
        mealRecipes(m).forEach(function (r) {
          M.ingredients(r.text).forEach(function (g) {
            g.alts.forEach(function (a) {
              M.pantryFor(S, a, t).filter(function (p) { return placeKey(p.place) === 'freezer' && !seen[p.id]; }).forEach(function (p) {
                seen[p.id] = 1;
                var sub = 'разморозить к завтра: ' + slotLabel(s).toLowerCase();
                out.push({ nm: p.name, sub: sub, pic: pic('p', p.name, p.name), act: 'data-act="pantry-edit" data-id="' + esc(p.id) + '"', plain: 'Разморозить: ' + p.name + ' (' + slotLabel(s).toLowerCase() + ' завтра)' });
              });
            });
          });
        });
      });
    }
    var g = shopGroup(), left = g && g.dates && g.dates.indexOf(t) >= 0 ? g.items.filter(function (i) { return !i.bought && !i.skip; }).length : 0;
    if (left) out.push({ nm: 'Купить: ' + left + ' ' + plural(left, 'продукт', 'продукта', 'продуктов'), sub: 'покупки на ' + g.label, pic: '<span class="fi fi-none ico" aria-hidden="true">' + ICO.shop + '</span>', act: 'data-act="tab" data-tab="shop"', plain: 'Купить: ' + left + ' ' + plural(left, 'продукт', 'продукта', 'продуктов') });
    if (passDue()) out.push({ nm: 'Помните семейный пароль?', sub: 'раз в месяц стоит проверить', pic: '<span class="fi fi-none ico" aria-hidden="true">' + ICO.lock + '</span>', act: 'data-act="go-family"', plain: 'Проверьте, помните ли семейный пароль' });
    return out;
  }
  /* рецепты, для которых почти всё есть дома: от 2 продуктов и не меньше 70 % */
  function cookable() {
    var t = today();
    return M.list(S, 'recipes').map(function (r) {
      var st = M.recipeStock(S, r.text, t), n = st.filter(function (g) { return g.home.length; }).length;
      return { r: r, n: n, of: st.length, k: st.length ? n / st.length : 0 };
    }).filter(function (x) { return x.of >= 2 && x.k >= 0.7; }).sort(function (a, b) { return b.k - a.k || b.n - a.n; });
  }
  var PASS_EVERY = 30 * 86400000;
  function passDue() { return !!(famMeta('fam_salt') && FAM.key && Date.now() - (+lsGet('passcheck') || 0) > PASS_EVERY); }

  /* период «с … по …» вместо недели: история (прошлые дни с отметками «съели») и любой отрезок до RANGE_MAX дней */
  var RANGE_MAX = 31;
  function rangeDates(r) { var out = [], d = r.from; while (d <= r.to && out.length < RANGE_MAX) { out.push(d); d = addDays(d, 1); } return out; }
  function monday(d) { var w = parseD(d).getDay(); return addDays(d, -((w + 6) % 7)); }
  function rangePreset(v) {
    var t = today(), m = monday(t);
    return v === 'thisweek' ? { from: m, to: addDays(m, 6) } : v === 'lastweek' ? { from: addDays(m, -7), to: addDays(m, -1) }
      : v === '2w' ? { from: addDays(t, -13), to: t } : { from: addDays(t, -29), to: t };
  }
  function viewRange() {
    var r = UI.range, ds = rangeDates(r), t = today();
    var bar = '<form class="add range" data-form="range"><label>С<input type="date" name="from" value="' + r.from + '" required></label>' +
      '<label>по<input type="date" name="to" value="' + r.to + '" required></label><button class="btn">Показать</button></form>' +
      '<div class="seg">' + [['thisweek', 'Эта неделя'], ['lastweek', 'Прошлая'], ['2w', '2 недели'], ['month', 'Месяц']].map(function (x) {
        var p = rangePreset(x[0]), on = p.from === r.from && p.to === r.to;
        return '<button type="button" class="' + (on ? 'on' : '') + '" data-act="range-preset" data-v="' + x[0] + '" aria-pressed="' + on + '">' + x[1] + '</button>';
      }).join('') + '<button type="button" class="add-week" data-act="range-close">К неделям</button></div>';
    var n = ds.filter(function (d) { return d < t; }).reduce(function (a, d) { return a + mealsOf(d).filter(function (m) { return m.text; }).length; }, 0);
    var eaten = ds.filter(function (d) { return d < t; }).reduce(function (a, d) { return a + mealsOf(d).filter(function (m) { return m.text && m.done; }).length; }, 0);
    return bar + (n ? '<p class="hint">За прошедшие дни периода съели ' + eaten + ' из ' + n + ' блюд по плану.</p>' : '') + '<div class="board" data-board>' + ds.map(dayCol).join('') + '</div>';
  }
  function viewMenu() {
    if (UI.range) return viewRange();
    var ws = weeks();
    if (!ws.length) return emptyState();
    var t = today(), wi = UI.week;
    if (wi == null || wi >= ws.length) { wi = 0; ws.forEach(function (w, i) { if (w.indexOf(t) >= 0) wi = i; }); if (t > ws[ws.length - 1][ws[ws.length - 1].length - 1]) wi = ws.length - 1; }
    UI.week = wi;
    var seg = '<div class="seg">' + ws.map(function (w, i) {
      return '<button class="' + (i === wi ? 'on' : '') + '" data-act="week" data-i="' + i + '"' + (i === wi ? ' aria-current="true"' : '') + '>' + dm(w[0]) + '–' + dm(w[w.length - 1]) + '</button>';
    }).join('') + '<button class="add-week" data-act="week-new">' + ICO.plus + 'Неделя</button>' +
      '<button class="add-week" data-act="week-repeat" title="Скопировать блюда этой недели на следующие 7 дней">Повторить эту</button>' +
      '<button class="add-week" data-act="range-open" title="История и любой отрезок дат">Период…</button></div>';
    return seg + '<p class="hint">Карточки можно перетаскивать между днями и приёмами пищи, на телефоне — нажав и подержав. Занятое место меняется местами.</p>' +
      '<div class="board" data-board>' + ws[wi].map(dayCol).join('') + '</div>';
  }
  /* колонка дня на доске */
  function dayCol(date) {
    var t = today(), d = dayRec(date) || {}, tg = tags(d.tags), pd = parseD(date);
    var places = slotsOf(date).map(function (s) { return boardPlace(date, s); }).join('');
    return '<section class="col' + (date === t ? ' today' : '') + (date < t ? ' past' : '') + '" id="d' + date + '" aria-label="' + WDL[pd.getDay()] + ', ' + pd.getDate() + ' ' + MON[pd.getMonth()] + '">' +
      '<header class="dh"><span class="dnum"><b>' + pd.getDate() + '</b><small>' + MON[pd.getMonth()].slice(0, 3) + '</small></span>' +
      '<span class="dname">' + WDL[pd.getDay()] + (date === t ? '<em>сегодня</em>' : '') + '</span></header>' +
      (tg.length || calChips(date) ? '<div class="tags">' + tg.map(function (x) { return '<span class="tag t-' + x.k + '">' + esc(x.t) + '</span>'; }).join('') + calChips(date) + '</div>' : '') +
      '<ul class="places">' + places + '</ul>' +
      '<button class="add-meal" data-act="meal-add" data-date="' + date + '">' + ICO.plus + 'Добавить</button>' +
      '<button class="cook" data-act="cook-edit" data-date="' + date + '">' + ICO.pot + '<span>' + (d.cook ? esc(d.cook) : '<span class="muted">План готовки не задан</span>') + '</span></button>' +
      '</section>';
  }
  /* место на доске: карточка блюда или пустое место «+ блюдо»; любое место принимает перетаскивание */
  function boardPlace(date, s) {
    var m = mealAt(date, s), at = ' data-date="' + date + '" data-slot="' + esc(s) + '"';
    if (!m || !m.text) return '<li class="place" data-drop' + at + '><button class="slot-empty" data-act="meal-edit"' + at + '><span class="lbl">' + esc(slotLabel(s)) + '</span><span>+ блюдо</span></button></li>';
    return '<li class="place" data-drop' + at + '><div class="card' + (m.done ? ' done' : '') + (s === 'с собой' ? ' go' : '') + '" data-drag data-id="' + esc(m.id) + '">' +
      '<div class="ctop">' + mealPic(m.text, m) + '<span class="lbl" aria-hidden="true">' + esc(slotLabel(s)) + mealMarks(m) + '</span>' +
      '<button class="chk" data-act="meal-done"' + at + ' aria-label="Съели: ' + esc(slotLabel(s)) + '" aria-pressed="' + !!m.done + '">' + (m.done ? ICO.check : '') + '</button></div>' +
      '<button class="mtxt" data-act="meal-open"' + at + ' aria-haspopup="dialog" aria-label="' + esc(slotLabel(s) + ': ' + m.text) + '"><span class="dish">' + esc(m.text) + '</span>' + mealAlg(m) + '</button></div></li>';
  }

  function viewShop() {
    var gs = shopGroups(), cur = shopGroup(gs);
    if (!cur) return '<div class="empty"><h2>Покупок пока нет</h2><p>Составьте меню на неделю — список соберётся из рецептов блюд кнопкой «Собрать из меню». Или добавьте продукт сами. Купленное потом одним нажатием переносится в «Дома».</p>' + addShopForm(wkNum(today())) + '</div>';
    UI.shopWeek = cur.key;
    var items = cur.items, w = cur.wk;
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
          (i.moved ? '<span class="sub">перенесено домой</span>' : '') + '</button>' +
          /* отметка «куплено» прямо на плитке — в магазине одним нажатием, без окна */
          '<button class="tchk" data-act="buy-quick" data-id="' + esc(i.id) + '" aria-label="Куплено: ' + esc(i.name) + '" aria-pressed="' + !!i.bought + '">' + (i.bought ? ICO.check : '') + '</button>' +
          (badge || i.price ? '<div class="tfoot">' + badge + (i.price ? '<span class="pr">' + rub(i.price) + '</span>' : '') + '</div>' : '') + '</li>';
      }).join('') + '</ul>';
    }).join('');
    /* цен нет — итог и полоса считаются по штукам, а не «0 ₽ из 0 ₽» */
    var pct = plan ? Math.round(got * 100 / plan) : n ? Math.round(Math.min(nGot, n) * 100 / n) : 0;
    var acts = '<div class="row">' + (cur.dates ? '<button class="btn' + (items.length ? ' ghost' : '') + '" data-act="shop-gen">Собрать из меню</button>' : '') +
      (n > nGot ? '<button class="btn ghost" data-act="shop-share">Поделиться списком</button>' : '') + '</div>';
    if (!items.length) return '<div class="seg">' + gs.map(segBtn).join('') + '</div>' +
      '<div class="empty"><h2>На ' + esc(cur.label) + ' покупок пока нет</h2><p>«Собрать из меню» сложит продукты из рецептов блюд этой недели и отметит то, что уже есть дома.</p>' + acts + addShopForm(w) + '</div>';
    function segBtn(x) { return '<button class="' + (x.key === cur.key ? 'on' : '') + '" data-act="shopweek" data-w="' + x.key + '"' + (x.key === cur.key ? ' aria-current="true"' : '') + '>' + esc(x.label) + '</button>'; }
    return '<div class="seg">' + gs.map(segBtn).join('') + '</div>' +
      '<section class="sum"><div class="sum-top">' + (plan ? '<b>' + rub(Math.max(0, plan - got)) + '</b><span>осталось из ' + rub(plan) + '</span>'
        : '<b>' + Math.max(0, n - nGot) + '</b><span>осталось купить из ' + n + '</span>') + '</div>' +
      '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="transform:scaleX(' + (pct / 100) + ')"></i></div>' +
      '<p>Куплено ' + nGot + ' из ' + n + (got ? ' на ' + rub(got) : '') + '</p>' +
      (toMove ? '<button class="btn wide" data-act="move-home">Купленное → Дома (' + toMove + ')</button>' : '') + acts + '</section>' +
      addShopForm(w) + body;
  }
  /* «Собрать из меню»: что добавится, что уже в списке, что есть дома, каким блюдам не хватает рецепта */
  function genPlan(g) {
    var r = P.fromMenu(S, g.dates, today()), pre = 'auto-' + g.wk + '-', ids = {};
    r.items.forEach(function (it) {
      it.id = pre + it.key.replace(/\s+/g, '-');
      ids[it.id] = 1;
      it.manual = g.items.filter(function (h) { return h.id.indexOf('auto-') !== 0 && sameProduct(h.name, it.name); })[0] || null;
      it.done = S.shop[it.id] && S.shop[it.id].bought;
    });
    r.stale = g.items.filter(function (h) { return h.id.indexOf(pre) === 0 && !ids[h.id] && !h.bought; });
    r.add = r.items.filter(function (it) { return !it.manual && !it.done; });
    r.fresh = r.add.filter(function (it) { return !S.shop[it.id]; }).length;   // новых; остальные уже собраны раньше и обновятся
    return r;
  }
  function sameProduct(a, b) { var x = M.words(a)[0], y = M.words(b)[0]; return !!(x && y) && (x.indexOf(M.stem(y)) === 0 || y.indexOf(M.stem(x)) === 0); }
  function genModal() {
    var g = shopGroup(); if (!g || !g.dates) return;
    var r = genPlan(g), buy = r.add.filter(function (i) { return !i.skip; }), home = r.add.filter(function (i) { return i.skip; }), had = r.items.filter(function (i) { return i.manual; });
    var li = function (a, f) { return '<ul class="gen">' + a.map(function (i) { return '<li><b>' + esc(i.name) + '</b>' + (i.qty ? ' — ' + esc(i.qty) : '') + (f ? '<span class="muted"> · ' + esc(f(i)) + '</span>' : '') + '</li>'; }).join('') + '</ul>'; };
    var h = '<h3>Покупки из меню, ' + esc(g.label) + '</h3><p class="muted">Блюд в меню: ' + r.meals + (r.prep ? ', из них из заготовки (не покупаем заново): ' + r.prep : '') + '. Каждый рецепт считается один раз за неделю.</p>';
    if (buy.length) h += '<h4>Купить — ' + buy.length + '</h4>' + li(buy, function (i) { return i.from.join(', '); });
    if (home.length) h += '<h4>Есть дома — добавятся с отметкой «есть дома»</h4>' + li(home, function (i) { return 'дома: ' + i.home.map(function (p) { return p.name; }).join(', '); });
    if (had.length) h += '<h4>Уже в списке</h4>' + li(had);
    if (r.noRecipe.length) h += '<h4>Без рецепта со списком продуктов</h4><p class="muted">Эти блюда не посчитаны: купите для них сами или добавьте рецепт с разделом «Продукты».</p><ul class="gen">' +
      r.noRecipe.slice(0, 8).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + (r.noRecipe.length > 8 ? '<li class="muted">и ещё ' + (r.noRecipe.length - 8) + '</li>' : '') + '</ul>';
    if (!r.items.length) h += '<p>В рецептах блюд этой недели нет списка продуктов. Откройте рецепт → «Редактировать» → поле «Продукты»: строки «продукт — сколько».</p>';
    h += '<div class="row">' + (r.add.length || r.stale.length ? '<button type="button" class="btn" data-act="shop-gen-ok">' + (r.fresh ? 'Добавить ' + r.fresh : 'Обновить список') + '</button>' : '') +
      '<button type="button" class="btn ghost" data-act="close">' + (r.add.length ? 'Отмена' : 'Закрыть') + '</button></div>';
    modal(h);
  }
  function genApply() {
    var g = shopGroup(); if (!g || !g.dates) return;
    var r = genPlan(g);
    closeModal();
    undoable(r.fresh ? 'В покупки добавлено: ' + r.fresh + ' ' + plural(r.fresh, 'продукт', 'продукта', 'продуктов') + '.' : 'Список покупок обновлён.', function (c) {
      r.add.forEach(function (it) { c.put('shop', it.id, { week: g.wk, name: it.name, qty: it.qty, cat: it.cat, skip: it.skip }); });
      r.stale.forEach(function (h) { c.del('shop', h.id); });   // блюдо убрали из меню — его продукты, ещё не купленные, тоже
    });
  }
  /* список на неделю текстом: в мессенджер (на телефоне — меню «Поделиться»), иначе в буфер обмена */
  function shareShop() {
    var g = shopGroup(); if (!g) return;
    var text = P.shareText('Покупки на ' + g.label, g.items.filter(function (i) { return !i.bought && !i.skip; }));
    if (navigator.share) { navigator.share({ title: 'Покупки', text: text }).catch(function () { }); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Список скопирован — вставьте его в мессенджер.'); },
      function () { modal('<h3>Список покупок</h3><textarea readonly rows="12" aria-label="Список покупок">' + esc(text) + '</textarea><div class="row"><button type="button" class="btn ghost" data-act="close">Готово</button></div>'); });
  }
  function addShopForm(w) {
    var cats = shopCats();
    return '<form class="add" data-form="shop-add" data-w="' + w + '"><input name="name" placeholder="Добавить продукт" aria-label="Продукт" required>' +
      '<input name="qty" placeholder="Сколько" aria-label="Сколько" class="sm"><input name="price" placeholder="₽" aria-label="Цена, ₽" inputmode="decimal" class="sm">' +
      '<select name="cat" aria-label="Раздел">' + (cats.length ? cats : ['Прочее']).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<button class="btn">Добавить</button></form>';
  }

  function viewHome() {
    var all = M.list(S, 'pantry'), q = M.norm(UI.q), t = today();
    if (q) all = all.filter(function (p) { return M.norm(p.name).indexOf(q) >= 0; });
    var add = '<form class="add" data-form="pantry-add"><input name="name" placeholder="Что есть дома" aria-label="Продукт" required><input name="qty" placeholder="Сколько" aria-label="Сколько" class="sm">' +
      '<select name="place" aria-label="Где">' + PLACES.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') + '</select>' +
      '<input name="until" type="date" class="sm" title="Годен до" aria-label="Годен до"><button class="btn">Добавить</button></form>';
    var out = add + '<input class="search" type="search" placeholder="Поиск по дому" aria-label="Поиск по дому" value="' + esc(UI.q) + '" data-input="q">' +
      (all.length ? '<p class="hint">Карточки можно перетаскивать между холодильником, морозилкой и полками, на телефоне — нажав и подержав.</p>' : '');
    /* место хранения — цель перетаскивания: карточка продукта бросается в другое место целиком (data-drop-place) */
    PLACES.forEach(function (pl) {
      var li = all.filter(function (p) { return placeKey(p.place) === pl[0]; }).sort(function (a, b) { return (a.until || '9') < (b.until || '9') ? -1 : 1; });
      out += '<section class="store" data-drop-place="' + pl[0] + '"><h3 class="place">' + pl[2] + pl[1] + ' <span class="muted">' + li.length + '</span></h3>';
      out += li.length ? '<ul class="tiles">' + li.map(function (p) {
        var soon = p.until && p.until <= addDays(t, 2);
        return '<li class="tile' + (soon ? ' soon' : '') + '" data-drag data-kind="pantry" data-id="' + esc(p.id) + '"><button class="tbtn" data-act="pantry-edit" data-id="' + esc(p.id) + '">' +
          pic('p', p.name, p.name, 'fi-l') + '<span class="nm">' + esc(p.name) + '</span>' +
          '<span class="sub">' + esc(p.qty || '') + '</span>' + (p.until ? '<span class="sub">до ' + dm(p.until) + '</span>' : '') +
          (p.note ? '<span class="note">' + esc(p.note) + '</span>' : '') + '</button>' +
          (soon ? '<span class="badge warn">' + (p.until < t ? 'просрочено' : 'скоро') + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="muted pad">Пусто</p>';
      out += '</section>';
    });
    return out;
  }
  function addDays(s, n) { var d = parseD(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function viewRecipes() {
    var t = today(), byHome = UI.rsort === 'home';
    var li = M.list(S, 'recipes').map(function (r) {
      var st = M.recipeStock(S, r.text, t), n = st.filter(function (g) { return g.home.length; }).length;
      return { r: r, st: st, n: n, k: st.length ? n / st.length : -1 };
    }).sort(function (a, b) { return (byHome ? b.k - a.k || b.n - a.n : 0) || ((a.r.name || '') < (b.r.name || '') ? -1 : 1); });
    return '<button class="btn wide" data-act="recipe-new">' + ICO.plus + 'Новый рецепт</button>' +
      (li.length ? '<div class="seg" role="group" aria-label="Порядок">' + [['abc', 'По алфавиту'], ['home', 'Из того, что дома']].map(function (x) {
        return '<button type="button" class="' + ((UI.rsort || 'abc') === x[0] ? 'on' : '') + '" data-act="rsort" data-v="' + x[0] + '" aria-pressed="' + ((UI.rsort || 'abc') === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div>' : '<p class="muted pad">Рецептов пока нет. Добавьте свой или нажмите на блюдо в «Неделе» — карточка рецепта откроется с его названием.</p>') +
      '<div class="cards">' + li.map(function (x) {
      var r = x.r, st = x.st, n = x.n, have = '', mt = P.meta(r.text);
      if (st.length) have = '<span class="have' + (n === st.length ? ' all' : '') + '">' + (n === st.length ? ICO.check + 'Всё есть дома' : 'Дома ' + n + ' из ' + st.length) + '</span>';
      return '<button class="rc" data-act="recipe-open" data-id="' + esc(r.id) + '" aria-haspopup="dialog">' + pic('r', r.name, r.name, 'fi-m') + '<span><b>' + esc(r.name) + '</b>' + have +
        (mt.portions || mt.minutes ? '<span class="mk">' + esc(P.metaLine(mt.portions, mt.minutes)) + '</span>' : '') + '<p>' + esc(MD.plain(P.stepsOnly(r.text))) + '</p></span></button>';
    }).join('') + '</div>';
  }
  /* Список продуктов рецепта с отметкой «есть дома» — в карточке рецепта; k — во сколько раз изменены порции. */
  function recipeStockHtml(text, k) {
    var st = M.recipeStock(S, text, today()), q = {};
    if (!st.length) return '';
    M.ingredients(text).forEach(function (g) { q[g.name] = g.qty; });
    var n = st.filter(function (g) { return g.home.length; }).length;
    return '<section class="stock"><h4>Продукты: дома ' + n + ' из ' + st.length + '</h4><ul>' + st.map(function (g) {
      return '<li class="' + (g.home.length ? 'on' : 'off') + '">' + (g.home.length ? ICO.check : '<i aria-hidden="true"></i>') + '<span>' + esc(g.name) + (q[g.name] ? ' — ' + esc(P.scale(q[g.name], k || 1)) : '') +
        (g.home.length ? '<small>' + esc(g.home.map(function (p) { return p.name + (p.qty ? ' ' + p.qty : ''); }).join(', ')) + '</small>' : '<small>нет дома</small>') + '</span></li>';
    }).join('') + '</ul></section>';
  }

  /* порядок: сначала то, с чего начинают (синхронизация устройств), потом семья и настройки */
  function viewMore() {
    var h = '';
    if (UI.update) h += '<section class="box"><h3>Обновление</h3><p>Вышла версия ' + esc(UI.update.version) + '.</p><button class="btn" data-act="update">Обновить и перезапустить</button></section>';
    h += viewDevices() + viewFamily() + viewCal();
    var mode = lsGet('mode') || 'auto';
    h += '<section class="box"><h3>Оформление</h3><div class="seg" role="group" aria-label="Тема">' +
      [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(function (x) {
        return '<button type="button" class="' + (mode === x[0] ? 'on' : '') + '" data-act="mode" data-v="' + x[0] + '" aria-pressed="' + (mode === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div></section>';
    h += viewSheet();
    var rules = M.list(S, 'rules').sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    if (rules.length) h += '<section class="box"><h3>Правила на эти недели</h3>' + rules.map(function (r) { return '<p><b>' + esc(r.title) + '.</b> ' + esc(r.text) + '</p>'; }).join('') + '</section>';
    h += '<section class="box"><h3>Копия данных</h3><div class="row"><button class="btn ghost" data-act="export">Скачать JSON</button>' +
      '<label class="btn ghost" tabindex="0" role="button">Загрузить JSON<input type="file" accept="application/json,.json" data-input="import" hidden></label>' +
      (UI.backup ? '<button class="btn ghost" data-act="export-backup">Данные до присоединения, ' + new Date(UI.backup).toLocaleDateString('ru-RU') + '</button>' : '') + '</div>' +
      '<p class="muted">Всё сохраняется на устройстве сразу после каждого изменения, даже без сети.</p></section>';
    h += '<section class="box"><h3>О программе</h3><p>Меню, версия <b class="ver">' + esc(CFG.version || '—') + '</b></p><p class="muted">' +
      (TAURI ? 'Приложение для Windows — обновляется само, когда выходит новая версия.' : 'Сайт — новая версия подтягивается при открытии.') + '</p></section>';
    return h;
  }

  /* первый запуск: все пути начала — на одном экране */
  function emptyState() {
    var h = '<div class="empty"><h2>Меню пока пустое</h2><p>Начните неделю с сегодняшнего дня и добавляйте блюда по дням. ' +
      (FAMILY.keys ? 'Если меню уже есть на другом устройстве семьи, оно подтянется само.' : 'Чтобы меню было общим, создайте семью или подключитесь к ней — данные подтянутся с других устройств.') + '</p>' +
      '<div class="row"><button class="btn" data-act="week-new">' + ICO.plus + 'Начать неделю</button></div>';
    if (!FAMILY.keys) h += '<h3>Меню на нескольких устройствах</h3><div class="row"><button class="btn ghost" data-act="family-new">Создать семью</button>' +
      '<button class="btn ghost" data-act="go-join">Есть приглашение</button>' +
      '<button class="btn ghost" data-act="gkey-load"' + (UI.gkey === 'busy' ? ' disabled' : '') + '>Войти через Google</button></div>' + gkeyNote() +
      '<p class="muted">Можно и без семьи: всё сохраняется на этом устройстве, семью легко создать потом во вкладке «Ещё».</p>';
    return h + '</div>';
  }
  /* «Начать неделю» / «+ Неделя»: дни после последнего (или с сегодня); неполная неделя сперва дополняется до 7 дней */
  function addWeek() {
    var ds = dates(), t = today(), from = ds.length ? addDays(ds[ds.length - 1], 1) : t, rem = ds.length % 7, n = rem ? 14 - rem : 7;
    if (from < t && !rem) from = t;   // прошлые недели не продолжаем задним числом — новая начинается с сегодня
    var added = [];
    for (var i = 0; i < n; i++) added.push(addDays(from, i));
    commit(function (c) { added.forEach(function (d) { c.put('days', 'd' + d, { date: d, wd: wd(d) }); }); });
    UI.week = weeks().length - 1; UI.tab = 'menu'; lsSet('tab', 'menu'); render(); window.scrollTo(0, 0);
    toast('Добавлены дни ' + dm(added[0]) + '–' + dm(added[added.length - 1]) + '. Нажмите «+ блюдо», чтобы запланировать.');
  }
  /* «Повторить эту»: блюда и готовка открытой недели — на 7 дней после последнего (не раньше сегодня); «съели» сброшено */
  function repeatWeek() {
    var ws = weeks(), src = ws[UI.week]; if (!src) return;
    var ds = dates(), t = today(), last = ds[ds.length - 1], rem = ds.length % 7, pad = [], from = addDays(last, 1);
    if (rem) for (var i = 0; i < 7 - rem; i++) { pad.push(from); from = addDays(from, 1); }   // дополнить последнюю неделю, чтобы новая встала ровно
    if (from < t) { from = t; pad = rem ? pad : []; }
    var to = src.map(function (d, i) { return addDays(from, i); });
    undoable('Неделя повторена: ' + dm(to[0]) + '–' + dm(to[to.length - 1]) + '.', function (c) {
      pad.forEach(function (d) { if (!dayRec(d)) c.put('days', 'd' + d, { date: d, wd: wd(d) }); });
      src.forEach(function (d, i) {
        var nd = to[i], dr = dayRec(d) || {};
        c.put('days', 'd' + nd, { date: nd, wd: wd(nd), cook: dr.cook || '' });
        mealsOf(d).forEach(function (m) {
          if (!m.text) return;
          c.put('meals', newMealId(nd, m.slot), { date: nd, slot: m.slot, text: m.text, recipe: m.recipe || '', time: m.time || '', prep: !!m.prep, done: false });
        });
      });
    });
    var nw = weeks(); nw.forEach(function (w, i) { if (w.indexOf(to[0]) >= 0) UI.week = i; }); render(); window.scrollTo(0, 0);
  }
  /* съели блюдо — что из продуктов его рецептов дома закончилось: отметить и сразу в покупки */
  function goneModal(m) {
    var t = today(), ps = [];
    mealRecipes(m).forEach(function (r) { M.ingredients(r.text).forEach(function (g) { g.alts.forEach(function (a) { M.pantryFor(S, a, t).forEach(function (p) { if (ps.indexOf(p) < 0) ps.push(p); }); }); }); });
    if (!ps.length) return;
    modal('<form data-form="gone"><h3>Что закончилось?</h3><p class="muted">Отмеченное уйдёт из «Дома».</p><div class="checks">' + ps.map(function (p) {
      return '<label class="ck"><input type="checkbox" name="p" value="' + esc(p.id) + '"> ' + esc(p.name) + (p.qty ? ' <span class="muted">' + esc(p.qty) + '</span>' : '') + '</label>';
    }).join('') + '</div><label class="ck"><input type="checkbox" name="shop" checked> Добавить закончившееся в покупки</label>' +
      '<div class="row"><button class="btn">Готово</button><button type="button" class="btn ghost" data-act="close">Ничего не закончилось</button></div></form>');
  }
  function pantryLeft(m) {
    var t = today();
    return mealRecipes(m).some(function (r) { return M.ingredients(r.text).some(function (g) { return g.alts.some(function (a) { return M.pantryFor(S, a, t).length; }); }); });
  }
  /* короткое сообщение внизу экрана: что действие выполнено; acts — кнопки [{label, fn}] («Отменить», «В покупки») */
  var toastTimer = null, TOAST = [];
  function toast(msg, acts) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    TOAST = acts || [];
    el.innerHTML = '<span>' + esc(msg) + '</span>' + TOAST.map(function (a, i) { return '<button type="button" data-act="toast" data-i="' + i + '">' + esc(a.label) + '</button>'; }).join('');
    el.classList.add('on'); el.classList.toggle('acts', !!TOAST.length);
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, TOAST.length ? 8000 : 4000);
  }
  function hideToast() { var el = document.getElementById('toast'); if (el) el.classList.remove('on', 'acts'); TOAST = []; }
  /* ошибка ввода — под формой, а не системным окном */
  function formErr(f, msg) {
    var er = f.querySelector('.err');
    if (!er) { er = document.createElement('p'); er.className = 'err'; er.setAttribute('role', 'alert'); f.appendChild(er); }
    er.textContent = msg; er.hidden = false;
  }

  var TABS = [['today', 'Сегодня'], ['menu', 'Неделя'], ['shop', 'Покупки'], ['home', 'Дома'], ['recipes', 'Рецепты'], ['more', 'Ещё']];
  var pendingRender = false;
  function render(force) {
    if (!force && (document.querySelector('#modal .sheet') || (DRAG && DRAG.on))) { pendingRender = true; return; }
    pendingRender = false;
    var v = { today: viewToday, menu: viewMenu, shop: viewShop, home: viewHome, recipes: viewRecipes, more: viewMore }[UI.tab]();
    var nav = TABS.map(function (t) {
      var n = t[0] === 'home' ? M.list(S, 'pantry').length : 0;
      return '<button class="' + (UI.tab === t[0] ? 'on' : '') + '" data-act="tab" data-tab="' + t[0] + '"' + (UI.tab === t[0] ? ' aria-current="page"' : '') + '>' +
        ICO[t[0]] + '<span>' + t[1] + '</span>' + (n ? '<i>' + n + '</i>' : '') + '</button>';
    }).join('');
    var y = window.scrollY, same = $app.getAttribute('data-tab') === UI.tab, now = new Date(), ob = $app.querySelector('[data-board]'), fk = same && actKey(document.activeElement);
    UI.boardX = ob ? ob.scrollLeft : null;
    $app.setAttribute('data-tab', UI.tab);
    var title = (S.meta.title && S.meta.title.value) || 'Меню', heads = { today: 'Сегодня', menu: window.innerWidth < 480 ? 'Неделя' : 'Меню на неделю', shop: 'Покупки', home: 'Дома', recipes: 'Рецепты', more: 'Ещё' };
    $app.innerHTML = '<nav class="tabs" aria-label="Разделы"><div class="brand"><b>Меню</b>' + (title === 'Меню' ? '' : '<span>' + esc(title.replace(/^Меню\s*[—-]\s*/, '')) + '</span>') + '</div>' + nav + '</nav>' +
      '<div class="body"><header class="top"><div class="ttl"><h1>' + heads[UI.tab] + '</h1>' +
      '<p>' + WDL[now.getDay()] + ', ' + now.getDate() + ' ' + MON[now.getMonth()] + '</p></div>' + syncChip() + '</header>' +
      '<main>' + v + '</main></div><div id="modal"></div>';
    if (same) window.scrollTo(0, y);
    if (fk) focusAct(fk);   // клавиатура: после перерисовки фокус остаётся на той же кнопке
    var bd = UI.tab === 'menu' && $app.querySelector('[data-board]');
    if (bd) { if (same && UI.boardX != null) bd.scrollLeft = UI.boardX; else { var tc = bd.querySelector('.col.today'); bd.scrollLeft = tc ? tc.offsetLeft - bd.offsetLeft - 16 : 0; } }
  }

  /* ---------- модальные окна ---------- */
  /* кнопка → её адрес [data-act, data-id, data-date, data-slot], чтобы найти её снова после перерисовки */
  function actKey(a) { return a && a !== document.body && $app.contains(a) && a.closest('[data-act]') === a ? ['data-act', 'data-id', 'data-date', 'data-slot'].map(function (k) { return a.getAttribute(k); }) : null; }
  function focusAct(o) {
    var sel = '[data-act="' + CSS.escape(o[0]) + '"]' + ['data-id', 'data-date', 'data-slot'].map(function (k, i) { return o[i + 1] == null ? '' : '[' + k + '="' + CSS.escape(o[i + 1]) + '"]'; }).join('');
    var el = $app.querySelector(sel); if (el) el.focus({ preventScroll: true });
  }
  /* окно: имя из заголовка, фокус внутри, Esc закрывает, после закрытия фокус возвращается к кнопке, которая его открыла */
  var opener = null;
  function modal(html) {
    var m = document.getElementById('modal');
    if (!m.querySelector('.sheet')) opener = actKey(document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-act]'));
    m.innerHTML = '<div class="ov" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" tabindex="-1">' + html + '</div>';
    var sh = m.querySelector('.sheet'), h = sh.querySelector('h3'); if (h) { h.id = 'modal-title'; sh.setAttribute('aria-labelledby', 'modal-title'); }
    var f = sh.querySelector('textarea,input:not([hidden]):not([readonly])');
    setTimeout(function () { if (sh.isConnected) (f || sh).focus(); }, 50);
  }
  function closeModal() {
    var m = document.getElementById('modal'); if (m) m.innerHTML = ''; if (pendingRender) render();
    var o = opener; opener = null; if (o) focusAct(o);
  }
  document.addEventListener('keydown', function (e) {
    var sh = document.querySelector('#modal .sheet'); if (!sh) return;
    if (e.key === 'Escape' && !(DRAG && DRAG.on)) { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    var fs = Array.prototype.filter.call(sh.querySelectorAll('button:not([disabled]),input:not([hidden]):not([type="hidden"]),select,textarea,a[href],summary,label.btn'), function (x) { return x.offsetParent !== null; });
    if (!fs.length) return;
    var first = fs[0], last = fs[fs.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sh)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* выбор рецептов блюда: переключатели; ничего не выбрано — рецепт подбирается по названию */
  function recipeChips(sel) {
    var li = M.list(S, 'recipes').sort(function (a, b) { return (a.name || '') < (b.name || '') ? -1 : 1; });
    if (!li.length) return '';
    return '<fieldset class="rpick"><legend>Рецепты к блюду</legend><input type="hidden" name="recipe" value="' + esc(sel.join(',')) + '"><div class="chips">' + li.map(function (r) {
      var on = sel.indexOf(r.id) >= 0;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-act="rtoggle" data-id="' + esc(r.id) + '" data-v="' + esc(r.name) + '" aria-pressed="' + on + '">' + esc(r.name) + '</button>';
    }).join('') + '</div><p class="muted" data-rguess></p></fieldset>';
  }
  function rguess() {
    var f = document.querySelector('#modal form'), el = f && f.querySelector('[data-rguess]'); if (!el) return;
    var sel = f.querySelector('[name="recipe"]').value, rs = sel ? [] : P.mealRecipes(S, { text: f.querySelector('[name="text"]').value });
    el.textContent = sel ? '' : rs.length ? 'Сейчас подбирается по названию: ' + rs.map(function (r) { return r.name; }).join(', ') + '.' : 'Рецепт не выбран и по названию не найден.';
  }
  function mealEditor(date, slot) {
    var m = mealAt(date, slot), all = dates(), slots = M.SLOTS.slice();
    all.forEach(function (d) { slotsOf(d).forEach(function (s) { if (slots.indexOf(s) < 0) slots.push(s); }); });
    /* «Обед ~15:30. Котлеты (вчерашние)» из старых записей: время — в своё поле, «вчерашние» — отметка «из заготовки» */
    var pt = m && !m.time ? P.mealParts(m.text) : { time: m ? m.time : '', text: m ? m.text : '', prep: false };
    var sel = m ? String(m.recipe || '').split(',').filter(function (x) { return S.recipes[x]; }) : [];
    modal('<form data-form="meal" data-date="' + date + '" data-slot="' + esc(slot) + '"><h3>' + esc(slotLabel(slot)) + ', ' + wd(date).toLowerCase() + ' ' + dm(date) + '</h3>' +
      '<textarea name="text" rows="3" placeholder="Что едим" aria-label="Что едим">' + esc(pt.text) + '</textarea>' +
      recipeChips(sel) +
      '<div class="pair"><label>Время<input type="time" name="time" value="' + esc(pt.time) + '"></label>' +
      '<label class="ck"><input type="checkbox" name="prep"' + (m && m.prep || pt.prep ? ' checked' : '') + '> Из заготовки — не готовить и не покупать заново</label></div>' +
      '<label class="ck"><input type="checkbox" name="done"' + (m && m.done ? ' checked' : '') + '> Уже съели</label>' +
      (m ? '<fieldset class="move"><legend>Перенести (занятое место поменяется местами)</legend>' +
        '<select name="to_date" aria-label="День">' + all.map(function (d) { return '<option value="' + d + '"' + (d === date ? ' selected' : '') + '>' + dm(d) + ' ' + wd(d) + '</option>'; }).join('') + '</select>' +
        '<select name="to_slot" aria-label="Приём пищи">' + slots.map(function (s) { return '<option value="' + esc(s) + '"' + (s === slot ? ' selected' : '') + '>' + esc(slotLabel(s)) + '</option>'; }).join('') + '</select></fieldset>' : '') +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button>' +
      (m ? '<button type="button" class="link danger" data-act="meal-del" data-date="' + date + '" data-slot="' + esc(slot) + '">Убрать</button>' : '') + '</div></form>');
    rguess();
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
      '<label>Неделя<select name="week">' + shopGroups().map(function (g) { var on = g.items.indexOf(i) >= 0; return '<option value="' + (on ? i.week : g.wk) + '"' + (on ? ' selected' : '') + '>' + esc(g.label) + '</option>'; }).join('') + '</select></label>' +
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
  /* Карточка рецепта: просмотр (recipeView) и правка (recipeEditor). «Как готовить» — Markdown (md.js).
     UI.rmeal = {date, slot, name} — карточка открыта из «Недели»: подпись дня и ссылка на окно блюда. */
  var MD = window.MMd, RECIPE_MAX = 15000;   // одна запись релея — до 64 КБ шифра; 15 000 знаков с запасом
  function mealFrom(meal, has) { return meal ? '<p class="from">' + esc(slotLabel(meal.slot)) + ', ' + wd(meal.date).toLowerCase() + ' ' + dm(meal.date) + (has ? '' : ' — рецепта для этого блюда пока нет') + '</p>' : ''; }
  function mealLink(meal) { return meal ? '<button type="button" class="link" data-act="meal-edit" data-date="' + meal.date + '" data-slot="' + esc(meal.slot) + '">Изменить блюдо в меню</button>' : ''; }
  function recipeView(id, meal, keep) {
    var r = S.recipes[id];
    if (!keep) UI.rport = 0;   // порции как в рецепте; keep — перерисовка после «−»/«+»
    UI.rmeal = meal || null;
    if (!r) return recipeEditor('', meal);
    var mt = P.meta(r.text), por = UI.rport || mt.portions, k = mt.portions ? por / mt.portions : 1, steps = P.stepsOnly(r.text);
    var hits = allergyOf(r.name, [r]), others = meal && meal.rids ? meal.rids.filter(function (x) { return x !== id && S.recipes[x]; }) : [];
    modal('<article class="recipe"><div class="rhead">' + pic('r', r.name, r.name, 'fi-xl') + '<div><p class="kicker">Рецепт</p><h3>' + esc(r.name) + '</h3>' + mealFrom(meal, true) +
      (mt.portions ? '<div class="portions"><button type="button" class="btn ghost" data-act="rport" data-d="-1" data-id="' + esc(id) + '" aria-label="Меньше порций"' + (por <= 1 ? ' disabled' : '') + '>−</button>' +
        '<span aria-live="polite">' + esc(P.metaLine(por, 0)) + '</span><button type="button" class="btn ghost" data-act="rport" data-d="1" data-id="' + esc(id) + '" aria-label="Больше порций">+</button></div>' : '') +
      (mt.minutes ? '<p class="muted">' + esc(P.metaLine(0, mt.minutes)) + '</p>' : '') + '</div></div>' +
      (hits.length ? '<p class="alg-line">' + algBadge(hits) + '</p>' : '') +
      (others.length ? '<p class="muted">Ещё к этому блюду: ' + others.map(function (x) { return '<button type="button" class="link" data-act="recipe-alt" data-id="' + esc(x) + '">' + esc(S.recipes[x].name) + '</button>'; }).join(', ') + '</p>' : '') +
      recipeStockHtml(r.text, k) +
      (k !== 1 ? '<p class="muted">Количества в списке — на ' + por + ' ' + plural(por, 'порцию', 'порции', 'порций') + '.</p>' : '') +
      (steps ? '<div class="md">' + MD.html(steps) + '</div>' : '<p class="muted">Как готовить — пока не написано.</p>') +
      '<div class="row"><button type="button" class="btn" data-act="recipe-edit" data-id="' + esc(id) + '">Редактировать</button>' +
      '<button type="button" class="btn ghost" data-act="close">Закрыть</button>' + mealLink(meal) + '</div></article>');
  }
  function recipeEditor(id, meal) {
    var r = id ? S.recipes[id] : null;
    if (meal !== undefined) UI.rmeal = meal || null;
    meal = UI.rmeal;
    var sp = P.split(r ? r.text : '');
    modal('<form data-form="recipe" data-id="' + esc(id || '') + '"><h3>' + (r ? 'Рецепт: правка' : 'Новый рецепт') + '</h3>' + mealFrom(meal, !!r) +
      (r && r.name ? picEditor('r', r.name) : '') +
      '<label>Название<input name="name" value="' + esc(r ? r.name : meal ? meal.name : '') + '" required></label>' +
      '<div class="pair"><label>Порций<input name="portions" type="number" min="0" max="99" inputmode="numeric" value="' + (sp.portions || '') + '"></label>' +
      '<label>Время, минут<input name="minutes" type="number" min="0" max="2000" inputmode="numeric" value="' + (sp.minutes || '') + '"></label></div>' +
      '<label>Продукты<textarea name="products" rows="5" placeholder="Каждый с новой строки: продукт — сколько&#10;яйца — 4 шт&#10;молоко — 200 мл">' + esc(sp.products) + '</textarea></label>' +
      '<p class="muted">По этому списку приложение собирает покупки из меню и проверяет, что есть дома.</p>' +
      '<label>Как готовить<textarea name="text" rows="8">' + esc(sp.steps) + '</textarea></label>' +
      '<div class="mdbar"><span class="muted">Markdown: # заголовок, **жирный**, *курсив*, - список, 1. шаги</span>' +
      '<label class="btn ghost" tabindex="0" role="button">Загрузить .md<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden data-input="recipe-md"></label></div>' +
      '<p class="err" role="alert" hidden></p>' +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="recipe-cancel" data-id="' + esc(id || '') + '">Отмена</button>' +
      mealLink(meal) +
      (r ? '<button type="button" class="link danger" data-act="recipe-del" data-id="' + esc(id) + '">Удалить</button>' : '') + '</div></form>');
  }
  /* блюдо из «Недели» открывает ту же карточку, что и в «Рецептах»; рецепта нет — новая карточка с названием блюда */
  function mealOpen(date, slot) {
    var m = mealAt(date, slot);
    if (!m || !m.text) return mealEditor(date, slot);
    var rs = mealRecipes(m), meal = { date: date, slot: slot, name: m.text, rids: rs.map(function (r) { return r.id; }) };
    if (rs.length) recipeView(rs[0].id, meal); else recipeEditor('', meal);
  }
  function cookEditor(date) {
    var d = dayRec(date) || {};
    modal('<form data-form="cook" data-date="' + date + '"><h3>Готовка, ' + wd(date).toLowerCase() + ' ' + dm(date) + '</h3>' +
      '<textarea name="cook" rows="3">' + esc(d.cook || '') + '</textarea>' +
      '<div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="close">Отмена</button></div></form>');
  }
  /* перенести блюдо id на место (date, slot); если место занято — блюдо оттуда встаёт на прежнее место переносимого */
  function moveMeal(c, id, date, slot) {
    var m = S.meals[id]; if (!m || (m.date === date && m.slot === slot)) return false;
    var t = mealAt(date, slot), from = { date: m.date, slot: m.slot };
    c.put('meals', id, { date: date, slot: slot });
    if (t && t.id !== id) c.put('meals', t.id, from);
    if (!dayRec(date)) c.put('days', 'd' + date, { date: date, wd: wd(date) });
    return true;
  }
  /* «+ Добавить» в колонке дня: свой приём пищи или свободный из основных */
  function mealAdd(date) {
    var free = M.SLOTS.filter(function (s) { var m = mealAt(date, s); return !(m && m.text); });
    var rec = M.list(S, 'recipes').map(function (r) { return '<button type="button" class="chip" data-act="pick" data-v="' + esc(r.name) + '">' + esc(r.name) + '</button>'; }).join('');
    modal('<form data-form="meal-add" data-date="' + date + '" novalidate><h3>Новое блюдо, ' + wd(date).toLowerCase() + ' ' + dm(date) + '</h3>' +
      '<label>Приём пищи<input name="slot" value="' + esc(free[0] || '') + '" placeholder="Например, полдник" autocomplete="off"></label>' +
      '<div class="chips">' + free.concat(['полдник', 'второй завтрак']).filter(function (s, i, a) { return a.indexOf(s) === i && !(mealAt(date, s) && mealAt(date, s).text); })
        .map(function (s) { return '<button type="button" class="chip" data-act="pick-slot" data-v="' + esc(s) + '">' + esc(slotLabel(s)) + '</button>'; }).join('') + '</div>' +
      '<label>Что едим<textarea name="text" rows="3" placeholder="Блюдо"></textarea></label>' +
      (rec ? '<div class="chips">' + rec + '</div>' : '') +
      '<p class="err" role="alert" hidden></p>' +
      '<div class="row"><button class="btn">Добавить</button><button type="button" class="btn ghost" data-act="close">Отмена</button></div></form>');
  }

  function picError(e) {
    var m = e && e.message === 'format' ? 'Этот формат картинки не открывается' + (e.file ? ' (' + e.file + ')' : '') + '. Подойдут JPEG, PNG или WebP.'
      : 'Не получилось: ' + esc(String((e && e.message) || e));
    modal('<h3>Картинка</h3><p>' + m + '</p><div class="row"><button type="button" class="btn ghost" data-act="close">Закрыть</button></div>');
  }

  /* ---------- события ---------- */
  document.addEventListener('click', function (e) {
    /* в приложении на ПК внешние ссылки открываются в системном браузере */
    var ln = TAURI && e.target.closest('a[href^="http"]');
    if (ln) { e.preventDefault(); Promise.resolve(TAURI.opener.openUrl(ln.href)).catch(function () { }); return; }   // разрешены только адреса Google (capabilities); прочие ссылки на ПК молча не открываются
    var b = e.target.closest('[data-act]');
    if (!b) { var cd = e.target.closest('.card[data-drag]'); b = cd && cd.querySelector('.mtxt'); }   // вся карточка блюда открывает его, не только текст
    if (!b) return;
    var a = b.getAttribute('data-act'), id = b.getAttribute('data-id'), date = b.getAttribute('data-date'), slot = b.getAttribute('data-slot');
    switch (a) {
      case 'tab': UI.tab = b.getAttribute('data-tab'); lsSet('tab', UI.tab); render(); window.scrollTo(0, 0); break;
      case 'week': UI.week = +b.getAttribute('data-i'); render(); break;
      case 'shopweek': UI.shopWeek = b.getAttribute('data-w'); render(); break;
      case 'week-repeat': repeatWeek(); break;
      case 'range-open': UI.range = rangePreset('2w'); render(); break;
      case 'range-preset': UI.range = rangePreset(b.getAttribute('data-v')); render(); break;
      case 'range-close': UI.range = null; render(); break;
      case 'shop-gen': genModal(); break;
      case 'shop-gen-ok': genApply(); break;
      case 'shop-share': shareShop(); break;
      case 'toast': { var ta2 = TOAST[+b.getAttribute('data-i')]; hideToast(); if (ta2) ta2.fn(); break; }
      case 'rsort': UI.rsort = b.getAttribute('data-v'); render(); break;
      case 'rport': { var rr = S.recipes[id], base = rr ? P.meta(rr.text).portions : 0; if (base) { UI.rport = Math.max(1, (UI.rport || base) + +b.getAttribute('data-d')); recipeView(id, UI.rmeal, true); } break; }
      case 'recipe-alt': recipeView(id, UI.rmeal); break;
      case 'rtoggle': {
        var rf = b.closest('form'), hid = rf.querySelector('[name="recipe"]'), cur = hid.value ? hid.value.split(',') : [], on = cur.indexOf(id) < 0;
        cur = on ? cur.concat(id) : cur.filter(function (x) { return x !== id; });
        hid.value = cur.join(','); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
        var tx = rf.querySelector('[name="text"]'); if (on && !tx.value.trim()) tx.value = b.getAttribute('data-v');
        rguess(); break;
      }
      case 'go-family': UI.tab = 'more'; lsSet('tab', 'more'); render(); var fe = document.getElementById('family'); if (fe) fe.scrollIntoView({ block: 'start' }); var fp = document.querySelector('[data-form="fam-check"] input'); if (fp) fp.focus({ preventScroll: true }); break;
      case 'pass-later': lsSet('passcheck', Date.now() - PASS_EVERY + 7 * 86400000); render(); break;
      case 'close': closeModal(); break;
      case 'meal-edit': mealEditor(date, slot); break;
      case 'meal-add': mealAdd(date); break;
      case 'meal-open': mealOpen(date, slot); break;
      case 'pick-slot': { var si = document.querySelector('#modal [name="slot"]'), se = document.querySelector('#modal .err'); if (si) { si.value = b.getAttribute('data-v'); si.focus(); } if (se) se.hidden = true; break; }
      case 'meal-done': {
        var m = mealAt(date, slot); if (!m) break;
        var eat = !m.done; commit(function (c) { c.put('meals', m.id, { done: eat }); });
        if (eat && !P.isPrep(m) && pantryLeft(m)) toast('Съели. Что-то из продуктов закончилось?', [{ label: 'Отметить', fn: function () { goneModal(m); } }]);
        break;
      }
      case 'meal-del': { var m2 = mealAt(date, slot); closeModal(); if (m2) undoable('Блюдо убрано: ' + m2.text + '.', function (c) { c.del('meals', m2.id); }); break; }
      case 'pick': { var ta = document.querySelector('#modal textarea'); if (ta) ta.value = b.getAttribute('data-v'); break; }
      case 'cook-edit': cookEditor(date); break;
      case 'shop-card': shopCard(id); break;
      case 'buy-quick': { var iq = S.shop[id]; if (iq) commit(function (c) { c.put('shop', id, { bought: !iq.bought, skip: false }); }); break; }
      case 'week-new': addWeek(); break;
      case 'go-join': UI.tab = 'more'; lsSet('tab', 'more'); render(); var jn = document.querySelector('[data-form="join"] [name="code"]'); if (jn) { jn.scrollIntoView({ block: 'center' }); jn.focus(); } break;
      case 'buy': { var i = S.shop[id]; closeModal(); if (i) commit(function (c) { c.put('shop', id, { bought: !i.bought, skip: false }); }); break; }
      case 'skip': { var i2 = S.shop[id]; closeModal(); if (i2) commit(function (c) { c.put('shop', id, { skip: !i2.skip, bought: false }); }); break; }
      case 'shop-edit': shopEditor(id); break;
      case 'shop-del': { var sd = S.shop[id]; closeModal(); if (sd) undoable('Удалено из покупок: ' + sd.name + '.', function (c) { c.del('shop', id); }); break; }
      case 'move-home': { var sg = shopGroup(), mv = sg ? sg.items.filter(function (i) { return i.bought && !i.moved; }) : [];
        if (mv.length) undoable('Перенесено в «Дома»: ' + mv.length + ' ' + plural(mv.length, 'продукт', 'продукта', 'продуктов') + '.', function (c) {
          mv.forEach(function (i) {
            c.put('pantry', 'p-' + i.id, { name: i.name, qty: i.qty || '', place: placeFor(i) });
            c.put('shop', i.id, { moved: true });
          });
        });
        break; }
      case 'pantry-edit': pantryEditor(id); break;
      case 'pantry-gone': { var p = S.pantry[id]; closeModal(); if (p) undoable('Закончилось: ' + p.name + '.', function (c) { c.del('pantry', id); }, [{ label: 'В покупки', fn: function () { toShop([p]); } }]); break; }
      case 'recipe-new': recipeEditor('', null); break;
      case 'recipe-open': recipeView(id, null); break;
      case 'recipe-edit': recipeEditor(id); break;
      case 'recipe-cancel': if (id && S.recipes[id]) recipeView(id, UI.rmeal); else closeModal(); break;
      case 'recipe-del': { var rd = S.recipes[id]; closeModal(); if (rd) undoable('Рецепт удалён: ' + rd.name + '.', function (c) { c.del('recipes', id); }); break; }
      case 'sync-tap': if (!FAMILY.keys || UI.gone) { UI.tab = 'more'; lsSet('tab', 'more'); render(); var dv = document.getElementById('devices'); if (dv) dv.scrollIntoView({ block: 'start' }); } else syncNow(); break;
      case 'rotate': rotateModal(); break;
      case 'rotate-ok': rotateFamily(); break;
      case 'sheet-now': sheetNow(); break;
      case 'add-device': deviceModal(); break;
      case 'show-words': FK.toWords(FK.fromCode(FAMILY.code)).then(function (w) { b.outerHTML = '<p class="words">' + esc(w) + '</p>'; }); break;
      case 'family-new': (async function () { await familyUse(FK.toCode(FK.newRoot())); await relayReset(); UI.gsaved = false; UI.gkey = ''; lsSet('gkey', null); render(); syncNow(); deviceModal(); })(); break;
      case 'family-leave': if (confirm('Отключить это устройство от семьи? Данные на устройстве останутся, обмен прекратится.')) (async function () { await familyUse(''); await relayReset(); UI.gsaved = false; UI.gkey = ''; lsSet('gkey', null); setStatus('none'); render(); })(); break;
      case 'sync-now': syncNow(); break;
      case 'gkey-load': googleKey('gload'); break;
      case 'cal-on': SY.cal = { id: '', sent: {}, at: 0 }; saveSync(); calSync(true); break;
      case 'cal-now': calSync(true); break;
      case 'cal-off': if (confirm('Отключить Google Календарь на этом устройстве? Календарь «Меню» останется в Google — его можно удалить в настройках Google Календаря.')) { SY.cal = null; SY.calEv = null; UI.cal = ''; saveSync(); render(); } break;
      case 'gkey-save': googleKey('gsave'); break;
      case 'gkey-forget': if (confirm('Убрать ключ семьи из Google? Данные семьи останутся, войти через Google станет нельзя.')) googleKey('gforget'); break;
      case 'login': login('select_account'); break;
      case 'logout': lsSet('token', null); SY.authed = false; saveSync();
        if (TAURI) { DESK.signed = false; invoke('google_logout'); } render(); break;
      case 'disconnect': if (confirm('Отключить таблицу? Данные на устройстве и в семье останутся.')) { SY = { dirty: SY.dirty }; saveSync(); render(); } break;
      case 'copy': { var v = b.getAttribute('data-v'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { b.textContent = 'Скопировано'; }, function () { prompt('Скопируйте ссылку', v); }); break; }
      case 'export': exportJson(S, 'menu-' + today()); break;
      case 'export-backup': store.get('backup').then(function (bk) { if (bk) exportJson(bk.S, 'menu-before-join-' + today()); }); break;
      case 'member-edit': memberEditor(id); break;
      case 'member-del': { var md = S.family[id]; if (md && confirmSoft(b, 'Удалить')) { closeModal(); commit(function (c) { c.del('family', id); c.del('photos', id); }); } break; }
      case 'member-photo-del': FAM.photo = null; refreshPhotoRow(); break;
      case 'fam-forget': FAM.key = null; FAM.cache = {}; store.set('famkey', null); render(); break;
      case 'mode': { var mv = b.getAttribute('data-v'); lsSet('mode', mv === 'auto' ? null : mv); if (mv === 'auto') delete document.documentElement.dataset.mode; else document.documentElement.dataset.mode = mv; render(); break; }
      case 'pic-del': { var pk = b.getAttribute('data-kind'), pn = b.getAttribute('data-k'); delete IMG[imgKey(pk, pn)]; refreshPicRow(pk, pn); break; }
      case 'update': { var u = UI.update; if (u) { b.disabled = true; b.textContent = 'Загружаю обновление…'; u.downloadAndInstall().catch(function (er) { b.textContent = 'Не вышло: ' + er; }); } break; }
    }
  });
  /* Второе нажатие подтверждает удаление — без системного диалога. */
  function plural(n, one, few, many) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; }
  /* подписи-кнопки с файлом внутри (<label class="btn"><input type=file hidden>) — с клавиатуры по Enter и пробелу */
  document.addEventListener('keydown', function (e) {
    var l = (e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('label.btn[tabindex]');
    if (l) { e.preventDefault(); var fi = e.target.querySelector('input[type="file"]'); if (fi) fi.click(); }
  });
  function confirmSoft(b, label) { if (b.getAttribute('data-sure')) return true; b.setAttribute('data-sure', '1'); b.textContent = 'Точно?'; setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-sure'); b.textContent = label || 'Закончилось'; } }, 3000); return false; }

  /* ---------- доска недели: перетаскивание карточек блюд ----------
     Мышь — после сдвига на 8 px, палец — после удержания 350 мс (иначе это прокрутка). Под пальцем ищется место [data-drop];
     у краёв доска и страница прокручиваются сами. Перенос — moveMeal с обменом; без мыши то же делает «Перенести» в окне блюда. */
  var DRAG = null, dragged = 0;
  document.addEventListener('pointerdown', function (e) {
    var card = e.target.closest('[data-drag]');
    if (!card || e.button > 0 || e.target.closest('.chk')) return;
    DRAG = { card: card, id: card.getAttribute('data-id'), kind: card.getAttribute('data-kind') || 'meal', x: e.clientX, y: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', on: false };
    if (DRAG.touch) DRAG.timer = setTimeout(function () { if (DRAG && !DRAG.on) dragStart(); }, 350);
  });
  document.addEventListener('pointermove', function (e) {
    if (!DRAG || e.pointerId !== DRAG.pid) return;
    var dx = e.clientX - DRAG.x, dy = e.clientY - DRAG.y;
    if (!DRAG.on) { if (dx * dx + dy * dy < 64) return; if (DRAG.touch) { dragEnd(false); return; } dragStart(); }
    dragMove(e.clientX, e.clientY);
  });
  document.addEventListener('pointerup', function (e) { if (DRAG && e.pointerId === DRAG.pid) dragEnd(true); });
  document.addEventListener('pointercancel', function () { if (DRAG) dragEnd(false); });
  document.addEventListener('touchmove', function (e) { if (DRAG && DRAG.on) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', function (e) { if (DRAG) e.preventDefault(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && DRAG && DRAG.on) { DRAG.over = null; dragEnd(false); } });
  /* после переноса отпускание кнопки не должно открыть окно блюда */
  document.addEventListener('click', function (e) { if (performance.now() - dragged < 60 && !e.target.closest('#toast')) { e.stopPropagation(); e.preventDefault(); } }, true);
  function dragStart() {
    var r = DRAG.card.getBoundingClientRect(), g = DRAG.card.cloneNode(true);
    DRAG.on = true; DRAG.dx = DRAG.x - r.left; DRAG.dy = DRAG.y - r.top;
    g.classList.add('drag-ghost'); g.setAttribute('aria-hidden', 'true'); g.style.width = r.width + 'px';
    document.body.appendChild(g); DRAG.ghost = g;
    DRAG.card.classList.add('lifted'); document.documentElement.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(12);
    DRAG.tick = setInterval(edgeScroll, 16);
    dragMove(DRAG.x, DRAG.y);
  }
  function dragMove(x, y) {
    DRAG.lx = x; DRAG.ly = y;
    DRAG.ghost.style.transform = 'translate(' + (x - DRAG.dx) + 'px,' + (y - DRAG.dy) + 'px) rotate(-2deg)';
    var el = document.elementFromPoint(x, y), t = el && el.closest(DRAG.kind === 'pantry' ? '[data-drop-place]' : '[data-drop]');
    if (t !== DRAG.over) { if (DRAG.over) DRAG.over.classList.remove('over'); DRAG.over = t; if (t) t.classList.add('over'); }
  }
  function edgeScroll() {
    if (!DRAG || !DRAG.on) return;
    var bd = document.querySelector('[data-board]'), x = DRAG.lx, y = DRAG.ly, e = 48, sp = 14, moved = false;
    if (bd) {
      var r = bd.getBoundingClientRect();
      if (x < r.left + e && bd.scrollLeft > 0) { bd.scrollLeft -= sp; moved = true; }
      else if (x > r.right - e && bd.scrollLeft < bd.scrollWidth - bd.clientWidth) { bd.scrollLeft += sp; moved = true; }
    }
    if (y < e) { window.scrollBy(0, -sp); moved = true; } else if (y > window.innerHeight - e) { window.scrollBy(0, sp); moved = true; }
    if (moved) dragMove(x, y);
  }
  function dragEnd(drop) {
    var d = DRAG; DRAG = null; clearTimeout(d.timer);
    if (!d.on) return;
    clearInterval(d.tick); d.ghost.remove(); d.card.classList.remove('lifted'); document.documentElement.classList.remove('dragging');
    if (d.over) d.over.classList.remove('over');
    dragged = performance.now();
    var to = drop && d.over;
    if (d.kind === 'pantry') {
      var pp = S.pantry[d.id], dest = to && to.getAttribute('data-drop-place');
      if (pp && dest && placeKey(pp.place) !== dest) undoable(pp.name + ' → ' + PLACES.filter(function (x) { return x[0] === dest; })[0][1] + '.', function (c) { c.put('pantry', d.id, { place: dest }); });
      else if (pendingRender) render();
      return;
    }
    if (to && S.meals[d.id] && !(S.meals[d.id].date === to.getAttribute('data-date') && S.meals[d.id].slot === to.getAttribute('data-slot')))
      undoable('Блюдо перенесено.', function (c) { moveMeal(c, d.id, to.getAttribute('data-date'), to.getAttribute('data-slot')); });
    else if (pendingRender) render();
  }

  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
    var k = f.getAttribute('data-form'), fd = new FormData(f), g = function (n) { var v = fd.get(n); return v == null ? '' : String(v).trim(); };
    switch (k) {
      case 'meal': {
        var date = f.getAttribute('data-date'), slot = f.getAttribute('data-slot'), text = g('text'), done = !!fd.get('done'), extra = { recipe: g('recipe'), time: g('time'), prep: !!fd.get('prep') };
        var toDate = g('to_date') || date, toSlot = normSlot(g('to_slot')) || slot;
        closeModal();
        commit(function (c) {
          var m = mealAt(date, slot);
          if (!text && !m) return;
          var id = m ? m.id : newMealId(date, slot);
          c.put('meals', id, Object.assign({ date: date, slot: slot, text: text, done: done }, extra));
          if (toDate !== date || toSlot !== slot) moveMeal(c, id, toDate, toSlot);
          if (!dayRec(date)) c.put('days', 'd' + date, { date: date, wd: wd(date) });
        });
        break;
      }
      case 'meal-add': {
        var ad = f.getAttribute('data-date'), as = normSlot(g('slot')), at = g('text'), er = f.querySelector('.err');
        var bad = !as ? 'Назовите приём пищи' : mealAt(ad, as) && mealAt(ad, as).text ? '«' + slotLabel(as) + '» в этот день уже есть — выберите другой приём или назовите по-своему' : !at ? 'Напишите, что едим' : '';
        if (bad) { er.textContent = bad; er.hidden = false; break; }
        closeModal();
        commit(function (c) {
          var ex = mealAt(ad, as);
          c.put('meals', ex ? ex.id : newMealId(ad, as), { date: ad, slot: as, text: at, done: false });
          if (!dayRec(ad)) c.put('days', 'd' + ad, { date: ad, wd: wd(ad) });
        });
        break;
      }
      case 'cook': { var d = f.getAttribute('data-date'), r = dayRec(d); closeModal(); commit(function (c) { c.put('days', r ? r.id : 'd' + d, { date: d, cook: g('cook') }); }); break; }
      case 'shop': { var id = f.getAttribute('data-id'); closeModal(); commit(function (c) { c.put('shop', id, { name: g('name'), qty: g('qty'), price: g('price'), cat: g('cat'), week: +g('week') || (S.shop[id] && S.shop[id].week) || wkNum(today()) }); }); break; }
      case 'shop-add': commit(function (c) { c.put('shop', uid('s'), { name: g('name'), qty: g('qty'), price: g('price'), cat: g('cat'), week: +f.getAttribute('data-w') || wkNum(today()) }); }); break;
      case 'pantry': { var pid = f.getAttribute('data-id'); closeModal(); commit(function (c) { c.put('pantry', pid, { name: g('name'), qty: g('qty'), place: g('place'), until: g('until'), note: g('note') }); }); break; }
      case 'pantry-add': commit(function (c) { c.put('pantry', uid('p'), { name: g('name'), qty: g('qty'), place: g('place'), until: g('until') }); }); break;
      case 'recipe': {
        var rid = f.getAttribute('data-id') || uid('r'), rtext = P.compose({ portions: g('portions'), minutes: g('minutes'), products: String(fd.get('products') || ''), steps: String(fd.get('text') || '') });
        if (rtext.length > RECIPE_MAX) { var rer = f.querySelector('.err'); rer.textContent = 'Слишком длинный рецепт: до ' + RECIPE_MAX.toLocaleString('ru-RU') + ' знаков.'; rer.hidden = false; break; }
        closeModal(); commit(function (c) { c.put('recipes', rid, { name: g('name'), text: rtext }); });
        recipeView(rid, UI.rmeal);   // после сохранения — снова просмотр
        break;
      }
      case 'fam-pass': {
        if (g('p1') !== g('p2')) { formErr(f, 'Пароли не совпадают'); break; }
        if (g('p1').length < 8) { formErr(f, 'Пароль — от 8 знаков'); break; }
        if (!fd.get('saved')) { formErr(f, 'Отметьте, что пароль записан: восстановить его нельзя'); break; }
        lsSet('passcheck', Date.now());
        if (famMeta('fam_salt')) break;
        (async function () {
          var salt = V.newSalt(), key = await V.deriveKey(g('p1'), salt), check = await V.makeCheck(key);
          FAM.key = key; await store.set('famkey', key);
          commit(function (c) { c.put('meta', 'fam_salt', { value: salt }); c.put('meta', 'fam_check', { value: check }); });
        })();
        break;
      }
      case 'range': {
        var rf2 = g('from'), rt2 = g('to');
        if (!parseD(rf2) || !parseD(rt2)) { formErr(f, 'Укажите обе даты'); break; }
        if (rf2 > rt2) { var sw = rf2; rf2 = rt2; rt2 = sw; }
        if (addDays(rf2, RANGE_MAX - 1) < rt2) { formErr(f, 'Не больше ' + RANGE_MAX + ' дней — сократите период'); break; }
        UI.range = { from: rf2, to: rt2 }; render();
        break;
      }
      case 'gone': {
        var gp = fd.getAll('p').map(function (x) { return S.pantry[x]; }).filter(Boolean), add = !!fd.get('shop');
        closeModal(); if (!gp.length) break;
        undoable('Закончилось: ' + gp.map(function (x) { return x.name; }).join(', ') + (add ? ' — добавлено в покупки.' : '.'), function (c) {
          gp.forEach(function (x) { c.del('pantry', x.id); });
          if (add) shopPut(c, gp);
        });
        break;
      }
      case 'fam-check': {
        (async function () {
          var key = await V.deriveKey(g('p'), famMeta('fam_salt'));
          if (!(await V.verify(key, famMeta('fam_check')))) { formErr(f, 'Не подходит. Пока карточки открыты на этом устройстве, перепишите аллергии и вес на бумагу — на случай, если пароль не вспомнится.'); return; }
          lsSet('passcheck', Date.now()); render(); toast('Верно. Следующая проверка — через месяц.');
        })();
        break;
      }
      case 'fam-unlock': {
        var btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Проверяю…';
        (async function () {
          var key = await V.deriveKey(g('p'), famMeta('fam_salt'));
          if (!(await V.verify(key, famMeta('fam_check')))) { btn.disabled = false; btn.textContent = 'Открыть карточки'; formErr(f, 'Пароль не подходит'); return; }
          FAM.key = key; await store.set('famkey', key); render(); famDecrypt();
        })();
        break;
      }
      case 'member': {
        var mid = f.getAttribute('data-id') || uid('f'), patch = { name: g('name'), color: g('color') || 'pear' }, ph = FAM.photo;
        var data = FAM.key && fd.has('allergies') ? { allergies: g('allergies'), weight: g('weight').replace(',', '.'), note: g('note') } : null;
        closeModal();
        (async function () {
          if (data) { patch.enc = await V.seal(FAM.key, data, mid); FAM.cache[mid + '|' + patch.enc] = data; }
          commit(function (c) {
            c.put('family', mid, patch);
            if (ph) c.put('photos', mid, { img: ph }); else if (ph === null) c.del('photos', mid);
          });
        })();
        break;
      }
      case 'join': {
        var raw = g('code'), code0 = FK.fromCode(raw);
        (async function () {
          var r = code0 || await FK.fromWords(raw);
          if (!r) { formErr(f, 'Не похоже на ссылку-приглашение или 12 слов. Скопируйте ссылку целиком или введите слова через пробел.'); return; }
          await joinFamily(FK.toCode(r));
        })();
        break;
      }
      case 'connect': {
        var sid = SH.parseSheetId(g('link'));
        if (!sid) { formErr(f, 'Не похоже на ссылку Google Таблицы: она начинается с https://docs.google.com/spreadsheets/d/'); break; }
        SY.sheetId = sid; SY.title = ''; saveSync(); render(); sheetNow();
        break;
      }
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target, er = t.form && t.form.querySelector('.err');
    if (er) er.hidden = true;
    if (t.name === 'text' && t.form && t.form.getAttribute('data-form') === 'meal') rguess();
    if (t.getAttribute('data-input') === 'q') { UI.q = t.value; var pos = t.selectionStart; render(); var n = document.querySelector('[data-input="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { } } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, di = t.getAttribute('data-input'), fl = t.files ? Array.prototype.slice.call(t.files) : [];
    if (di === 'recipe-md' && fl[0]) {
      /* .md → поле «Как готовить»; первая строка «# Название» заполняет пустое название */
      var rf = t.closest('form'), rer2 = rf.querySelector('.err');
      if (fl[0].size > RECIPE_MAX * 4) { rer2.textContent = 'Файл слишком большой: рецепт — до ' + RECIPE_MAX.toLocaleString('ru-RU') + ' знаков.'; rer2.hidden = false; t.value = ''; return; }
      fl[0].text().then(function (txt) {
        txt = txt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        if (txt.length > RECIPE_MAX) { rer2.textContent = 'В файле больше ' + RECIPE_MAX.toLocaleString('ru-RU') + ' знаков — сократите рецепт.'; rer2.hidden = false; return; }
        var nm = rf.querySelector('[name="name"]'), h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(txt.split('\n').filter(function (l) { return l.trim(); })[0] || '');
        if (h1 && !nm.value.trim()) { nm.value = h1[1]; txt = txt.replace(/^\s*#\s+.+\n?/, ''); }
        var sp = P.split(txt.trim());   // «2 порции · 15 минут», «Продукты», «Как готовить» — по своим полям
        rf.querySelector('[name="portions"]').value = sp.portions || ''; rf.querySelector('[name="minutes"]').value = sp.minutes || '';
        rf.querySelector('[name="products"]').value = sp.products; rf.querySelector('[name="text"]').value = sp.steps; rer2.hidden = true; t.value = '';
      }, function () { rer2.textContent = 'Не удалось прочитать файл'; rer2.hidden = false; });
      return;
    }
    if (di === 'member-photo' && fl[0]) {
      /* квадрат 160 px (≈10 КБ) — с запасом влезает в одну запись релея; если вышло тяжело — 112 px */
      toJpeg(fl[0], 160, true).then(function (u) { return u.length > 40000 ? toJpeg(fl[0], 112, true) : u; })
        .then(function (u) { FAM.photo = u; refreshPhotoRow(); }, function (er) {
          var el = document.querySelector('#modal form[data-form="member"] .err');
          if (el) { el.textContent = er && er.message === 'format' ? 'Этот формат фото не открывается. Подойдут JPEG, PNG или WebP.' : 'Не получилось загрузить фото'; el.hidden = false; }
        });
      return;
    }
    if (di === 'pic' && fl[0]) {
      var kind = t.getAttribute('data-kind'), k = t.getAttribute('data-k');
      toJpeg(fl[0], 256, true).then(function (u) { IMG[imgKey(kind, k)] = u; refreshPicRow(kind, k); }, picError);
      return;
    }
    if (t.getAttribute('data-input') === 'import' && t.files && t.files[0]) {
      t.files[0].text().then(function (txt) {
        var inc = M.normalize(JSON.parse(txt));
        S = M.merge(S, inc); editSeq++; SY.dirty = true; saveState(); saveSync(); render(); scheduleSync(500);
        toast('Копия загружена и объединена с данными устройства.');
      }).catch(function () { toast('Файл не похож на копию меню — ничего не изменилось.'); });
      t.value = '';
    }
  });

  function exportJson(obj, name) {
    var blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.json';
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
    var q = 'Присоединить это устройство к семье?' + (fromLink ? ' Открывайте только ссылки от своих.' : '') +
      (hasData || FAMILY.code ? ' Данные на этом устройстве будут заменены данными семьи; их копию можно будет скачать в «Ещё».' : '');
    if ((fromLink || hasData || FAMILY.code) && !confirm(q)) return;
    if (hasData) { UI.backup = Date.now(); await store.set('backup', { at: UI.backup, S: S }); }   // прежние данные можно скачать в «Ещё»
    S = M.blank(); await saveState();
    await familyUse(code); await relayReset();
    UI.tab = 'today'; lsSet('tab', 'today'); render(); syncNow();
  }

  /* ПК: раз в день с 7 утра — системное уведомление «Не забыть» (на телефоне сайт сам не напоминает — блок на «Сегодня») */
  function notifyDay() {
    var N = TAURI && TAURI.notification, t = today();
    if (!N || new Date().getHours() < 7 || lsGet('notified') === t) return;
    var r = reminders(); if (!r.length) return;
    lsSet('notified', t);
    Promise.resolve(N.isPermissionGranted()).then(function (ok) { return ok || Promise.resolve(N.requestPermission()).then(function (p) { return p === 'granted'; }); })
      .then(function (ok) { if (ok) N.sendNotification({ title: 'Меню: не забыть сегодня', body: r.slice(0, 5).map(function (x) { return x.plain; }).join('\n') }); })
      .catch(function () { });
  }

  async function init() {
    var h = readHash();
    var st = await store.get('state'), st2 = lsGet('state');
    if (st) S = M.normalize(st);
    if (st2) S = M.merge(S, M.normalize(st2));
    SY = (await store.get('sync')) || {};
    UI.tab = lsGet('tab') || 'today'; if (!/^(today|menu|shop|home|recipes|more)$/.test(UI.tab)) UI.tab = 'today';
    IMG = (await store.get('imgs')) || {};
    var bk = await store.get('backup'); UI.backup = bk && bk.at;
    UI.gsaved = !!lsGet('gkey');
    await famLoadKey();
    var code = await store.get('famcode'); if (code && FK.fromCode(code)) await familyUse(code);
    RS = (await store.get('relay')) || RS;
    if (TAURI) {
      try { DESK.signed = await invoke('google_signed_in'); } catch (e) { }
    }
    render();
    if (TAURI && TAURI.updater) TAURI.updater.check().then(function (u) { if (u) { UI.update = u; render(); } }).catch(function () { });
    if (h && h.join) await joinFamily(FK.toCode(h.join), true);
    if (h && h.login) {
      var af = lsGet('after') || (lsGet('exchange') && 'sheet'); lsSet('after', null); lsSet('exchange', null);
      if (h.login === 'ok' && af) { UI.tab = 'more'; render(); if (af === 'sheet') sheetNow(); else if (af === 'cal') calSync(true); else await googleKey(af, true); }
    }
    if (FAMILY.keys) syncNow(); else setStatus('none');
    if (TAURI) { notifyDay(); setInterval(notifyDay, 10 * 60000); }
    calAuto(); setInterval(calAuto, 10 * 60000);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { });
  window.__menu = { get S() { return S; }, get SY() { return SY; }, syncNow: syncNow };
  init();
})();

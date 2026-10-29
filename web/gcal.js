/* Google Календарь (Calendar API v3), без DOM — его гоняют node-тесты (tests/gcal.test.js).
   push — свой календарь «Меню» (доступ calendar.app.created): блюда и готовка событиями. id события — SHA-256 ключа записи,
   поэтому повторная выгрузка обновляет то же событие; что убрали из меню — удаляется (только в пределах выгружаемых дат).
   pull — события основного календаря за период (calendar.events.readonly) → {«ГГГГ-ММ-ДД»: [«09:00 Учёба», …]};
   они остаются на устройстве и в данные семьи не попадают. */
(function (root) {
  'use strict';
  var BASE = 'https://www.googleapis.com/calendar/v3', MAXPAR = 4;

  async function call(fx, token, method, path, body) {
    var t = await token();
    var h = { Authorization: 'Bearer ' + t };
    if (body) h['Content-Type'] = 'application/json';
    var r = await fx(BASE + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return null;
    var j = null; try { j = await r.json(); } catch (e) { }
    if (!r.ok) {
      var e = new Error('calendar ' + r.status); e.status = r.status;
      e.reason = j && j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason || '';
      throw e;
    }
    return j;
  }
  /* id события: только символы base32hex, 5–1024 знака — шестнадцатеричный SHA-256 подходит */
  async function eventId(key) {
    var d = await (root.crypto || require('crypto').webcrypto).subtle.digest('SHA-256', new TextEncoder().encode('menu|' + key));
    return 'm' + Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 40);
  }
  /* w = {key, date, start?: 'ЧЧ:ММ', mins?, summary, description}; без start — событие на весь день */
  function body(w, tz) {
    var o = { summary: w.summary, description: w.description || '', status: 'confirmed', transparency: 'transparent', reminders: { useDefault: false, overrides: [] } };
    if (w.start) {
      var p = w.start.split(':'), m = +p[0] * 60 + +p[1] + (w.mins || 30), endDate = w.date;
      if (m >= 1440) { m = 1439; }
      var end = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2);
      o.start = { dateTime: w.date + 'T' + w.start + ':00', timeZone: tz }; o.end = { dateTime: endDate + 'T' + end + ':00', timeZone: tz };
    } else {
      var d = new Date(w.date + 'T12:00:00'); d.setDate(d.getDate() + 1);
      o.start = { date: w.date }; o.end = { date: d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) };
    }
    return o;
  }
  async function pool(jobs) {
    var i = 0;
    async function worker() { while (i < jobs.length) await jobs[i++](); }
    var ws = []; for (var k = 0; k < Math.min(MAXPAR, jobs.length); k++) ws.push(worker());
    await Promise.all(ws);
  }
  /* c = {fetch, token, cal: {id, sent: {eventId: {s, d}}}, wanted: [w], from, to, tz, title} → новое cal (сохранить на устройстве) */
  async function push(c) {
    var cal = { id: (c.cal && c.cal.id) || '', sent: Object.assign({}, (c.cal && c.cal.sent) || {}) };
    if (cal.id) {
      try { await call(c.fetch, c.token, 'GET', '/calendars/' + encodeURIComponent(cal.id)); }
      catch (e) { if (e.status === 404 || e.status === 410) { cal.id = ''; cal.sent = {}; } else throw e; }   // календарь удалили в Google — заведём заново
    }
    if (!cal.id) { cal.id = (await call(c.fetch, c.token, 'POST', '/calendars', { summary: c.title || 'Меню', timeZone: c.tz })).id; cal.sent = {}; }
    var path = '/calendars/' + encodeURIComponent(cal.id) + '/events/', keep = {}, jobs = [];
    for (var i = 0; i < c.wanted.length; i++) {
      var w = c.wanted[i], id = await eventId(w.key), b = body(w, c.tz), sig = JSON.stringify(b);
      keep[id] = 1;
      if (cal.sent[id] && cal.sent[id].s === sig) continue;
      jobs.push((function (id, b, sig, d) {
        return async function () {
          try { await call(c.fetch, c.token, 'PUT', path + id, b); }
          catch (e) { if (e.status !== 404) throw e; await call(c.fetch, c.token, 'POST', path.slice(0, -1), Object.assign({ id: id }, b)); }
          cal.sent[id] = { s: sig, d: d };
        };
      })(id, b, sig, w.date));
    }
    Object.keys(cal.sent).forEach(function (id) {
      var d = cal.sent[id].d;
      if (keep[id] || d < c.from || d > c.to) return;   // прошлое за пределами выгрузки не трогаем
      jobs.push(async function () {
        try { await call(c.fetch, c.token, 'DELETE', path + id); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
        delete cal.sent[id];
      });
    });
    await pool(jobs);
    return cal;
  }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  /* c = {fetch, token, from, to} → {дата: [текст]} */
  async function pull(c) {
    var out = {}, page = '', n = 0;
    var q = '?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=' + encodeURIComponent(new Date(c.from + 'T00:00:00').toISOString()) +
      '&timeMax=' + encodeURIComponent(new Date(c.to + 'T23:59:59').toISOString());
    do {
      var j = await call(c.fetch, c.token, 'GET', '/calendars/primary/events' + q + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
      (j.items || []).forEach(function (ev) {
        if (ev.status === 'cancelled' || !ev.start) return;
        var title = String(ev.summary || 'Занято').slice(0, 80);
        if (ev.start.dateTime) {
          var s = new Date(ev.start.dateTime), k = ymd(s);
          (out[k] = out[k] || []).push(('0' + s.getHours()).slice(-2) + ':' + ('0' + s.getMinutes()).slice(-2) + ' ' + title);
        } else {
          /* событие на весь день: конец (end.date) не входит; длинные — не дальше 62 дней */
          var d = new Date(ev.start.date + 'T12:00:00'), e = new Date((ev.end && ev.end.date || ev.start.date) + 'T12:00:00');
          if (!(e > d)) e = new Date(d.getTime() + 86400000);
          for (var i = 0; d < e && i < 62; i++, d.setDate(d.getDate() + 1)) {
            var k2 = ymd(d); if (k2 >= c.from && k2 <= c.to) (out[k2] = out[k2] || []).push(title);
          }
        }
      });
      page = j.nextPageToken || '';
    } while (page && ++n < 8);
    return out;
  }

  var api = { push: push, pull: pull, eventId: eventId, body: body };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MGCal = api;
})(typeof self !== 'undefined' ? self : this);

/* Синхронизация через релей (docs/LOCAL-FIRST.md). Без DOM — её гоняют node-тесты (tests/relaysync.test.mjs).
   Проход: забрать с релея всё новее seq → расшифровать → слить прежним M.merge → отправить то,
   что изменилось на устройстве после прошлой отправки (sent[«коллекция:id»] = _u).
   Пометку об удалении старше M.TOMB_TTL, уже лежащую на релее, проход просит стереть и возвращает в dropped —
   устройство убирает её у себя. Устройство, не выходившее на связь дольше M.TOMB_TTL, может сохранить удалённое. */
(function (root) {
  'use strict';
  var M = (typeof module === 'object' && module.exports) ? require('./model.js') : root.MModel;
  var F = (typeof module === 'object' && module.exports) ? require('./family.js') : root.MFamily;
  var BATCH = 200;

  function err(status, msg) { var e = new Error(msg || ('relay ' + status)); e.status = status; return e; }

  /* c = {fetch, url, keys, get() → S, persist(S), sent: {}, seq: n, now?()}; возвращает {seq, sent, changed, pushed, dropped} */
  async function run(c) {
    var base = String(c.url).replace(/\/+$/, '') + '/v1/' + c.keys.fid, hdr = { Authorization: 'Bearer ' + c.keys.auth };
    var sent = Object.assign({}, c.sent || {}), seq = c.seq || 0, changed = false;

    // 1. приём
    var R = M.blank(), got = 0;
    for (var page = 0; page < 1000; page++) {
      var res = await c.fetch(base + '/pull?since=' + seq, { headers: hdr });
      if (!res.ok) throw err(res.status);
      var j = await res.json();
      for (var i = 0; i < j.items.length; i++) {
        var o; try { o = await F.open(c.keys, j.items[i]); } catch (e) { continue; }   // чужое или битое — пропускаем
        if (!o || M.NAMES.indexOf(o.c) < 0 || o.id == null || !M.okId(o.id)) continue;   // только известные разделы: не __proto__ и т. п.
        if (o.t) R.tomb[o.c + ':' + o.id] = Math.max(R.tomb[o.c + ':' + o.id] || 0, +o.t);
        else if (o.r) R[o.c][o.id] = o.r;
        got++;
      }
      seq = j.seq || seq;
      if (!j.more) break;
    }
    if (got) {
      R = M.normalize(R);
      var L = c.get(), Mg = M.merge(L, R);
      // пришедшее уже лежит на релее: обратно его не отправляем
      M.NAMES.forEach(function (n) { Object.keys(R[n]).forEach(function (id) { var k = n + ':' + id; sent[k] = Math.max(sent[k] || 0, R[n][id]._u || 0); }); });
      Object.keys(R.tomb).forEach(function (k) { sent['tomb|' + k] = Math.max(sent['tomb|' + k] || 0, R.tomb[k]); });
      if (!M.equal(Mg, L)) { changed = true; await c.persist(Mg); }
    }

    // 2. отправка
    var S = c.get(), out = [], dropped = [], old = (c.now ? c.now() : Date.now()) - M.TOMB_TTL;
    M.NAMES.forEach(function (n) {
      Object.keys(S[n]).forEach(function (id) { var r = S[n][id], k = n + ':' + id; if ((r._u || 0) > (sent[k] || 0)) out.push({ key: k, u: r._u, p: { c: n, id: id, r: r } }); });
    });
    Object.keys(S.tomb).forEach(function (k) {
      var t = S.tomb[k], at = k.indexOf(':'), was = sent['tomb|' + k] || 0;
      if (at <= 0) return;
      if (t < old && was >= t) out.push({ key: 'tomb|' + k, drop: k, p: { c: k.slice(0, at), id: k.slice(at + 1) } });
      else if (t > was) out.push({ key: 'tomb|' + k, u: t, p: { c: k.slice(0, at), id: k.slice(at + 1), t: t } });
    });
    for (var b = 0; b < out.length; b += BATCH) {
      var part = out.slice(b, b + BATCH), items = [];
      for (var q = 0; q < part.length; q++) {
        var x = part[q];
        items.push(x.drop ? { k: await F.recKey(c.keys, x.p.c, x.p.id), drop: true } : await F.seal(c.keys, x.p));
      }
      var pr = await c.fetch(base + '/push', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr), body: JSON.stringify({ items: items }) });
      if (!pr.ok) throw err(pr.status);
      part.forEach(function (x) { if (x.drop) { delete sent[x.key]; dropped.push(x.drop); } else sent[x.key] = x.u; });
    }
    return { seq: seq, sent: sent, changed: changed, pushed: out.length, dropped: dropped };
  }

  var api = { run: run };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MRelay = api;
})(typeof self !== 'undefined' ? self : this);

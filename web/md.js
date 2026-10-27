/* Markdown рецептов → HTML. Свой маленький разборщик: без библиотек (CSP), без DOM — гоняют node-тесты (tests/md.test.js).
   Безопасность: каждая строка сначала экранируется целиком, разметка добавляется поверх уже экранированного текста;
   ссылки — только http(s). Сырой HTML из рецепта показывается как текст.
   Умеет: # заголовки, абзацы (перенос строки внутри абзаца — <br>), списки «- * + — –», нумерованные «1. 1)»,
   > цитаты, --- линии, ``` блоки кода, **жирный**, *курсив*, ~~зачёркнутый~~, `код`, [текст](https://…). */
(function (root) {
  'use strict';
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* строчная разметка: s — уже экранированный текст */
  function inline(s) {
    var keep = [];
    s = s.replace(/`([^`]+)`/g, function (m, c) { keep.push('<code>' + c + '</code>'); return '\u0000' + (keep.length - 1) + '\u0000'; });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, t, u) { keep.push('<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>'); return '\u0000' + (keep.length - 1) + '\u0000'; });
    s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<b>$2</b>')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/(^|[^_\wа-яё])_(?=\S)([^_]*?\S)_(?![_\wа-яё])/gi, '$1<i>$2</i>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>');
    return s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return keep[+i]; });
  }

  var UL = /^\s*[-*+—–]\s+(.*)$/, OL = /^\s*(\d{1,3})[.)]\s+(.*)$/, H = /^(#{1,6})\s+(.*?)\s*#*\s*$/, HR = /^\s*([-*_])(\s*\1){2,}\s*$/, Q = /^\s*>\s?(.*)$/, FENCE = /^\s*```/;

  function html(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n'), out = [], para = [], list = null, quote = [], code = null;
    function flushPara() { if (para.length) { out.push('<p>' + para.map(function (l) { return inline(esc(l)); }).join('<br>') + '</p>'); para = []; } }
    function flushList() { if (list) { out.push('<' + list.tag + (list.tag === 'ol' && list.start !== 1 ? ' start="' + list.start + '"' : '') + '>' + list.items.map(function (x) { return '<li>' + inline(esc(x)) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    function flushQuote() { if (quote.length) { out.push('<blockquote>' + html(quote.join('\n')) + '</blockquote>'); quote = []; } }
    function flush() { flushPara(); flushList(); flushQuote(); }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], m;
      if (code) { if (FENCE.test(ln)) { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; } else code.push(ln); continue; }
      if (FENCE.test(ln)) { flush(); code = []; continue; }
      if ((m = Q.exec(ln))) { flushPara(); flushList(); quote.push(m[1]); continue; }
      flushQuote();
      if (!ln.trim()) { flushPara(); flushList(); continue; }
      if (HR.test(ln)) { flush(); out.push('<hr>'); continue; }
      if ((m = H.exec(ln))) { flush(); var lv = Math.min(6, m[1].length + 3); out.push('<h' + lv + '>' + inline(esc(m[2])) + '</h' + lv + '>'); continue; }
      if ((m = OL.exec(ln))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', start: +m[1], items: [] }; } list.items.push(m[2]); continue; }
      if ((m = UL.exec(ln))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if (list && /^\s{2,}\S/.test(ln)) { list.items[list.items.length - 1] += ' ' + ln.trim(); continue; }   // продолжение пункта
      flushList(); para.push(ln.trim());
    }
    if (code) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
    flush();
    return out.join('');
  }

  /* короткий текст без разметки — для превью в списке рецептов */
  function plain(text) {
    return String(text == null ? '' : text).replace(/```/g, '').replace(/^\s*(#{1,6}|>|[-*+—–]|\d{1,3}[.)])\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|`)/g, '').replace(/(^|\s)[*_](\S[^*_]*?\S|\S)[*_](?=\s|$|[.,!?;:])/g, '$1$2')
      .replace(/\n{2,}/g, '\n').trim();
  }

  var api = { html: html, plain: plain };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MMd = api;
})(typeof self !== 'undefined' ? self : this);

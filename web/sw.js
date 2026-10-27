/* Офлайн-кэш оболочки. Запросы к Google и к релею не кэшируются. При изменении файлов — поднять VERSION. */
var VERSION = 'menu-v10';
var SHELL = ['./', 'index.html', 'style.css', 'config.js', 'model.js', 'sheets.js', 'app.js', 'manifest.webmanifest', 'foodicons.js', 'vault.js', 'bip39-en.js', 'family.js', 'relay.js', 'qr.js', 'icons/food.webp', 'theme-init.js', 'tokens.css', 'base.css', 'fonts/nunito-cyrillic.woff2', 'fonts/nunito-latin.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
/* Сеть в приоритете (чтобы обновления приходили сразу), кэш — если сети нет. */
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    if (r.ok) { var cp = r.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, cp); }); }
    return r;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
  }));
});

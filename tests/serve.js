/* Статический сервер для web/ (тесты). */
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'web');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
module.exports = function serve(port) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(port || 0, () => res(s));
  });
};

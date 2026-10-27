/* Поддельный Google Drive (только appDataFolder) для тестов web/gdrive.js и e2e. fx(url, init) → Response.
   state.scopeOk = false — как токен без drive.appdata (403 insufficientPermissions). */
function fakeDrive() {
  const files = new Map(), state = { scopeOk: true, calls: [] };
  let n = 0;
  const res = (status, body) => new Response(body == null ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fx(url, init = {}) {
    const u = new URL(url), m = (init.method || 'GET').toUpperCase();
    state.calls.push(m + ' ' + u.pathname);
    if (!/^Bearer \S+/.test((init.headers || {}).Authorization || '')) return res(401, { error: { status: 'UNAUTHENTICATED' } });
    if (!state.scopeOk) return res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } });
    const id = (u.pathname.match(/\/files\/([^/]+)$/) || [])[1];
    if (m === 'GET' && !id) {
      const name = (u.searchParams.get('q') || '').match(/name='([^']+)'/);
      return res(200, { files: [...files.entries()].filter(([, f]) => !name || f.name === name[1]).map(([i]) => ({ id: i })) });
    }
    if (m === 'GET' && id) return files.has(id) ? res(200, files.get(id).body) : res(404, { error: {} });
    if (m === 'POST') {
      const b = String(init.body), parts = b.split(/--menu\w+/).map((p) => p.split('\r\n\r\n')[1]).filter(Boolean).map((p) => p.trim());
      const meta = JSON.parse(parts[0]); if (!(meta.parents || []).includes('appDataFolder')) return res(400, {});
      const i = 'f' + (++n); files.set(i, { name: meta.name, body: parts[1] }); return res(200, { id: i });
    }
    if (m === 'PATCH' && files.has(id)) { files.get(id).body = String(init.body); return res(200, { id }); }
    if (m === 'DELETE' && files.has(id)) { files.delete(id); return res(204); }
    return res(404, { error: {} });
  }
  /* Playwright: перехватить запросы контекста к Google Drive */
  async function attach(ctx) {
    await ctx.route('https://www.googleapis.com/**', async (rt) => {
      const q = rt.request(), r = await fx(q.url(), { method: q.method(), headers: { Authorization: q.headers().authorization }, body: q.postData() });
      await rt.fulfill({ status: r.status, contentType: 'application/json', body: r.status === 204 ? '' : await r.text() });
    });
  }
  return { fx, files, state, attach };
}
module.exports = { fakeDrive };

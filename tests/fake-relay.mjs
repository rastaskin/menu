/* Поддельный релей для e2e: настоящий код relay/src/core.js в памяти, подключается к контексту Playwright.
   Адрес — из web/config.js, чтобы тест шёл через тот же CSP, что и приложение. */
import fs from 'node:fs';
import { handle, handleFamily, memoryStore } from '../relay/src/core.js';

export const RELAY = fs.readFileSync(new URL('../web/config.js', import.meta.url), 'utf8').match(/relayUrl:\s*'([^']+)'/)[1].replace(/\/+$/, '');

export function fakeRelay(origin) {
  const stores = new Map(), seen = [], state = { offline: false }, env = { ALLOWED_ORIGINS: origin };
  const family = (fid, req, op) => { if (!stores.has(fid)) stores.set(fid, memoryStore()); return handleFamily(req, stores.get(fid), op); };
  async function attach(ctx) {
    await ctx.route(RELAY + '/**', async (rt) => {
      if (state.offline) return rt.abort('internetdisconnected');
      const q = rt.request(), h = q.headers(), body = q.postData();
      if (body) seen.push(body);
      const headers = {}; ['origin', 'authorization', 'content-type'].forEach((k) => { if (h[k]) headers[k] = h[k]; });
      const res = await handle(new Request(q.url(), { method: q.method(), headers, body: body || undefined }), env, family);
      await rt.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
  }
  return { attach, seen, state, stores };
}

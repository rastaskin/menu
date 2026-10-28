/* Cloudflare Worker: маршрут, CORS и частота запросов здесь, данные семьи — в своём Durable Object (SQLite),
   счёт новых семей — в одном общем Durable Object Registry. */
import { handle, handleFamily, claimFamily } from './core.js';

export class Family {
  constructor(ctx, env) {
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS rows (k TEXT PRIMARY KEY, ct TEXT NOT NULL, seq INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS rows_seq ON rows(seq)');
    const meta = (k) => { const r = sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]; return r ? r.v : ''; };
    const setMeta = (k, v) => sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, v);
    this.store = {
      getAuth: async () => meta('auth'),
      setAuth: async (h) => { setMeta('auth', h); },
      last: async () => +meta('seq') || 0,
      put: async (k, ct) => {
        const seq = (+meta('seq') || 0) + 1;
        setMeta('seq', String(seq));
        sql.exec('INSERT OR REPLACE INTO rows (k, ct, seq) VALUES (?, ?, ?)', k, ct, seq);
        return seq;
      },
      drop: async (k) => { sql.exec('DELETE FROM rows WHERE k = ?', k); },
      closed: async () => meta('closed') === '1',
      close: async () => { sql.exec('DELETE FROM rows'); setMeta('closed', '1'); },
      since: async (s, n) => sql.exec('SELECT k, ct, seq FROM rows WHERE seq > ? ORDER BY seq LIMIT ?', s, n).toArray(),
      count: async () => sql.exec('SELECT COUNT(*) AS n FROM rows').toArray()[0].n,
      size: async () => sql.exec('SELECT COALESCE(SUM(LENGTH(k) + LENGTH(ct)), 0) AS n FROM rows').toArray()[0].n,
      claim: async (fid) => (await env.REGISTRY.get(env.REGISTRY.idFromName('global')).fetch('https://registry/claim?fid=' + fid)).ok
    };
  }
  fetch(req) {
    const [, , fid, op] = new URL(req.url).pathname.split('/');
    return handleFamily(req, this.store, op, fid);
  }
}

export class Registry {
  constructor(ctx, env) {
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS fam (fid TEXT PRIMARY KEY, day TEXT NOT NULL)');
    this.env = env;
    this.db = {
      has: async (fid) => sql.exec('SELECT 1 FROM fam WHERE fid = ?', fid).toArray().length > 0,
      total: async () => sql.exec('SELECT COUNT(*) AS n FROM fam').toArray()[0].n,
      onDay: async (day) => sql.exec('SELECT COUNT(*) AS n FROM fam WHERE day = ?', day).toArray()[0].n,
      add: async (fid, day) => { sql.exec('INSERT OR IGNORE INTO fam (fid, day) VALUES (?, ?)', fid, day); }
    };
  }
  async fetch(req) {
    const fid = new URL(req.url).searchParams.get('fid') || '';
    if (!/^[0-9a-f]{32}$/.test(fid)) return new Response(null, { status: 400 });
    const ok = await claimFamily(this.db, fid, new Date().toISOString().slice(0, 10),
      +this.env.MAX_FAMILIES || 50, +this.env.NEW_FAMILIES_PER_DAY || 5);
    return new Response(null, { status: ok ? 204 : 503 });
  }
}

export default {
  fetch(req, env) {
    return handle(req, env, (fid, r) => env.FAMILY.get(env.FAMILY.idFromName(fid)).fetch(r));
  }
};

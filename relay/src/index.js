/* Cloudflare Worker: маршрут и CORS здесь, данные семьи — в своём Durable Object (SQLite). */
import { handle, handleFamily } from './core.js';

export class Family {
  constructor(ctx) {
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
      since: async (s, n) => sql.exec('SELECT k, ct, seq FROM rows WHERE seq > ? ORDER BY seq LIMIT ?', s, n).toArray(),
      count: async () => sql.exec('SELECT COUNT(*) AS n FROM rows').toArray()[0].n
    };
  }
  fetch(req) { return handleFamily(req, this.store, new URL(req.url).pathname.split('/').pop()); }
}

export default {
  fetch(req, env) {
    return handle(req, env, (fid, r) => env.FAMILY.get(env.FAMILY.idFromName(fid)).fetch(r));
  }
};

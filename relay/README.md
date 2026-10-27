# Релей синхронизации

Cloudflare Worker + Durable Object (SQLite). Хранит только шифр записей семьи; ключей у него нет. Протокол — [docs/LOCAL-FIRST.md](../docs/LOCAL-FIRST.md).

## Выложить свой

1. Аккаунт Cloudflare (бесплатный тариф).
2. В этой папке:
   ```
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
3. Адрес из вывода (`https://menu-relay.<поддомен>.workers.dev`) впишите:
   - `web/config.js` → `relayUrl`;
   - `web/index.html` → CSP `connect-src`;
   - `desktop/src-tauri/capabilities/default.json` → разрешённые адреса `http:default`.
4. Если сайт не на `rastaskin.github.io` — поправьте `ALLOWED_ORIGINS` в `wrangler.toml`.

Тесты релея — `tests/relay.test.mjs` и `tests/relaysync.test.mjs` (`npm test` в корне).

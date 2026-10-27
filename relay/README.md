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

## Пределы

| Что | Сколько | Где менять |
|---|---|---|
| Запросов с одного IP | 120 в минуту (устройство делает 2–4) | `[[ratelimits]]` в `wrangler.toml` |
| Новых семей | 50 всего, 5 в сутки; уже работающих не касается | `MAX_FAMILIES`, `NEW_FAMILIES_PER_DAY` в `wrangler.toml` |
| Одна семья | 100 000 записей и 50 МБ шифра | `LIMITS` в `src/core.js` |

Пометки об удалении старше 180 дней устройства просят стереть (`{k, drop: true}` в push), так что релей не копит их годами.

Ответы: 429 — подождать, 503 — новых семей сейчас не принимаем, 507 — место семьи закончилось. Приложение показывает их понятным текстом.

Тесты релея — `tests/relay.test.mjs` и `tests/relaysync.test.mjs` (`npm test` в корне).

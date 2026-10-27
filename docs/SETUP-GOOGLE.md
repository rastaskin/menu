# Свой проект Google для «Меню»

Около 10 минут, один раз. Нужен, если вы разворачиваете свою копию (форк): приложение будет входить в Google через ваш проект.

## 1. Проект, Sheets API и Drive API
console.cloud.google.com → создайте проект → **APIs & Services → Library** → **Google Sheets API** → **Enable**, затем там же **Google Drive API** → **Enable** (для «Войти через Google»: ключ семьи в скрытой папке приложения на Диске).

## 2. Экран согласия и доступ к таблицам
**Google Auth Platform → Branding**: название приложения и ваша почта.
**Audience**: тип External, режим Testing; в **Test users** добавьте Google-аккаунты всех, кто будет входить.
**Data access → Add or remove scopes** → вручную: `https://www.googleapis.com/auth/spreadsheets` и `https://www.googleapis.com/auth/drive.appdata` → **Update → Save**.

Что это значит: приложение сможет читать и менять Google Таблицы того, кто вошёл, и хранить ключ семьи в своей скрытой папке на его Google Диске (другие файлы Диска ему не видны). На сайте токен живёт час и хранится только на устройстве; на ПК refresh token лежит в диспетчере учётных данных Windows.

## 3. Клиенты
**Clients → Create client**:

| Клиент | Тип | Что указать |
|---|---|---|
| Сайт и телефоны | Web application | Authorized JavaScript origins: `https://<ваш-логин>.github.io`; Authorized redirect URIs: `https://<ваш-логин>.github.io/<репозиторий>/` |
| Приложение на ПК | Desktop app | ничего; секрет клиента показывается один раз — сохраните |

Изменения применяются за 5–10 минут.

## 4. Репозиторий
1. В `web/config.js` подставьте `webClientId` и `desktopClientId`.
2. Секрет Desktop-клиента — только в секреты репозитория, не в код: `gh secret set GOOGLE_DESKTOP_CLIENT_SECRET`.
3. Ключ подписи обновлений для ПК: `npx tauri signer generate -w ~/.tauri/menu.key` в папке `desktop/`; публичный ключ — в `desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), закрытый и пароль — в секреты `TAURI_SIGNING_PRIVATE_KEY` и `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Адрес обновлений там же — замените на свой репозиторий.
4. Settings → Pages → Source: **GitHub Actions**. Пуш в `main` выкладывает сайт, тег `v*` собирает установщик для Windows.

## Семья
1. **Audience → Test users** → почта члена семьи. Без этого Google не пустит его в приложение (режим Testing).
2. Таблица → **Настройки доступа** → его почта как **Редактор**.
3. Ссылка из приложения: вкладка «Ещё» → «Копировать». Семейный пароль для карточек сообщите устно.

## Установка
| Устройство | Как |
|---|---|
| Windows | `Menu_*_x64-setup.exe` из релизов → «Подробнее» → «Выполнить в любом случае» (установщик без сертификата) |
| iPhone | Ссылка в Safari → «Поделиться» → «На экран Домой» → открыть с экрана Домой → войти |
| Android | Ссылка в Chrome → меню ⋮ → «Добавить на главный экран» → войти |

## Если что-то не так
| Сообщение | Что сделать |
|---|---|
| «Войдите в Google» | Нажать на него. В режиме Testing Google иногда просит войти заново |
| «Нет доступа к таблице» | Таблицей не поделились с этим аккаунтом, или он не добавлен в Test users |
| «Нет сети» | Правки сохранены на устройстве, уйдут при появлении сети |
| `redirect_uri_mismatch` | Не добавлен адрес из шага 3 или прошло меньше 10 минут |

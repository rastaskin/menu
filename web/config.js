/* OAuth Client ID — не секрет. Web-клиент — для сайта, Desktop-клиент — для приложения на ПК.
   Форк: создайте свой проект Google Cloud и подставьте свои ID (docs/SETUP-GOOGLE.md).
   Секрет Desktop-клиента в репозиторий не кладётся: CI дописывает его только в сборку установщика. */
window.MCONFIG = {
  /* версия программы — показывается в «Ещё»; при релизе равна тегу v* (desktop.yml проверяет) */
  version: '0.3.9',
  webClientId: '382327729296-2qfo6v2nt9iq6iaiainuocd0p4p4pkrl.apps.googleusercontent.com',
  desktopClientId: '382327729296-bca1k22f0r787kpsh5qno40jojse4rtc.apps.googleusercontent.com',
  desktopClientSecret: '',
  desktopPort: 0,
  /* релей синхронизации (relay/, Cloudflare Workers): хранит только шифр. Форк: выложите свой и подставьте адрес — и в CSP index.html */
  relayUrl: 'https://menu-relay.menu-relay.workers.dev',
  /* адрес сайта для ссылки-приглашения (у окна на ПК своего адреса нет). Форк: свой адрес GitHub Pages */
  appUrl: 'https://rastaskin.github.io/menu/'
};

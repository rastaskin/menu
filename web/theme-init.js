/* Тема до первой отрисовки: выбранная в «Ещё» светлая или тёмная, иначе — как в системе. */
try { var m = JSON.parse(localStorage.getItem('menu.mode') || 'null'); if (m === 'light' || m === 'dark') document.documentElement.dataset.mode = m; } catch (e) { }

/* Копия кода одним файлом: git bundle со всей историей и всеми ветками и тегами + личный CLAUDE.local.md (его нет в git).
   node tools/backup.mjs [папка] — по умолчанию папка на Яндекс.Диске; хранятся 10 последних копий.
   Восстановить: git clone <файл>.bundle menu */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] || process.env.MENU_BACKUP_DIR || path.join(os.homedir(), 'Yandex.Disk', 'Резервная флешка для ПК', 'Меню (код)');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) console.warn('Есть незакоммиченные правки — в копию попадёт только закоммиченное.');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10) + '-' + git('rev-parse', '--short', 'HEAD');
const file = path.join(dir, 'menu-' + stamp + '.bundle');
git('bundle', 'create', file, '--all');
git('bundle', 'verify', file);
const local = path.join(root, 'CLAUDE.local.md');
if (fs.existsSync(local)) fs.copyFileSync(local, path.join(dir, 'CLAUDE.local-' + stamp + '.md'));

/* старые копии: оставляем 10 последних */
const old = fs.readdirSync(dir).filter((f) => /^menu-.+\.bundle$/.test(f)).sort().reverse().slice(10);
old.forEach((f) => { fs.rmSync(path.join(dir, f)); const md = path.join(dir, f.replace(/^menu-/, 'CLAUDE.local-').replace(/\.bundle$/, '.md')); if (fs.existsSync(md)) fs.rmSync(md); });
console.log('Копия: ' + file + ' (' + Math.round(fs.statSync(file).size / 1024) + ' КБ)' + (old.length ? ', убрано старых: ' + old.length : ''));

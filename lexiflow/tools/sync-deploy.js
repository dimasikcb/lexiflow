/**
 * LexiFlow — синхронизация деплой-папки.
 *
 * Запуск:
 *   node tools/sync-deploy.js            # lexiflow → lexiflow-deploy3
 *   node tools/sync-deploy.js --dry-run  # только показать, что будет скопировано
 *
 * Зачем скрипт, а не «скопируй вручную»: правки в деплой-папку попадали
 * то лишним, то неполным — и публиковалась версия не та, что в проекте.
 * Один источник правды: working-папка проекта. Список исключений держим
 * здесь, чтобы он был виден и проверялся, а не recollected по памяти.
 *
 * Из деплоя исключается всё, что не нужно работающему приложению:
 * инструменты, документация, исследования, кэш. Аудио — НАОБОРОТ,
 * обязательно: без пакета озвучка падает на сетевой сервис.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = ROOT;
const DST = path.join(ROOT, '..', 'lexiflow-deploy3');

const DRY = process.argv.indexOf('--dry-run') >= 0;

/* Что не тащить в публичную папку. */
const SKIP = new Set([
  'tools',                 // тесты и сборка — не для продакшена
  'node_modules',
  '.git',
  '.zwork',                // вложения сессий: EPERM при копировании
  'README.md',
  'PUBLISH.md',
  'redesign-report.md',
  'research',
  'tmp-checks',
  'lexiflow-mobile.html',  // однофайловая сборка — отдельный артефакт для мессенджера
]);

/** Служебные файлы аудио-пакета, которые не нужны на хостинге. */
const SKIP_FILE = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini'
]);

/** Хеш содержимого. Сравнение по размеру не годится: правка версии
   `v1.18.0` → `v1.18.1` размера не меняет, и файл не копировался —
   публиковалась прошлая версия. */
function same(a, b) {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(a)).digest('hex') ===
           crypto.createHash('md5').update(fs.readFileSync(b)).digest('hex');
  } catch (e) { return false; }
}

let copied = 0, kept = 0, errors = [];

function walk(dir, rel) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { errors.push('не читается ' + rel + ': ' + e.message); return; }

  entries.forEach(e => {
    if (SKIP.has(e.name)) return;
    const abs = path.join(dir, e.name);
    const relPath = path.join(rel, e.name);
    if (e.isDirectory()) return walk(abs, relPath);
    if (SKIP_FILE.has(e.name)) return;

    const target = path.join(DST, relPath);
    if (same(abs, target)) { kept++; return; }
    if (DRY) { console.log('  ~ ' + relPath); copied++; return; }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(abs, target);
      copied++;
    } catch (err) { errors.push('не скопирован ' + relPath + ': ' + err.message); }
  });
}

if (!fs.existsSync(DST) && !DRY) fs.mkdirSync(DST, { recursive: true });

console.log((DRY ? 'ПРОБНЫЙ ПРОГОН: ' : 'Синхронизация: ') + 'lexiflow → lexiflow-deploy3');
walk(SRC, '');

/* В деплое не должно оставаться файлов, которых нет в проекте:
   иначе публикуется «мёртвый» код, которого в исходниках уже нет. */
if (!DRY && fs.existsSync(DST)) {
  const walkDst = (dir, rel) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const abs = path.join(dir, e.name);
      const relPath = path.join(rel, e.name);
      const src = path.join(SRC, relPath);
      if (e.isDirectory()) {
        if (!fs.existsSync(src)) { errors.push('лишняя папка в деплое: ' + relPath); return; }
        return walkDst(abs, relPath);
      }
      if (!fs.existsSync(src)) {
        errors.push('лишний файл в деплое (есть на хостинге, нет в проекте): ' + relPath);
      }
    });
  };
  walkDst(DST, '');
}

console.log('Скопировано: ' + copied + ' | без изменений: ' + kept);
if (errors.length) {
  console.log('ПРОБЛЕМЫ (' + errors.length + '):');
  errors.forEach(e => console.log('  ! ' + e));
  process.exit(1);
}
console.log(errors.length ? 'Есть расхождения' : 'Деплой-папка совпадает с проектом.');
if (DRY) console.log('Это был пробный прогон — ничего не записано.');

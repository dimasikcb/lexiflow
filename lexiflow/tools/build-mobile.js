/**
 * LexiFlow — сборка одного файла (lexiflow-mobile.html).
 *
 * Запуск:
 *   node tools/build-mobile.js
 *
 * Зачем: один HTML-файл со встроенными стилями и скриптами открывается
 * с телефона без сервера и без интернета — его можно перекинуть себе
 * в мессенджер и открыть из «Загрузок». Обычная страница так не умеет:
 * браузер грузит десяток файлов по сети.
 *
 * Файл собирается ИЗ ТЕКУЩИХ ИСТОЧНИКОВ, а не правится руками. Ручная
 * правка однажды уже стоила пользователю сломанного приложения: в
 * пересланном файле остался старый интерфейс синхронизации, а код
 * успел уехать вперёд. Дрейфа больше не будет — сборка всегда актуальна,
 * поэтому пересобирать её нужно после каждой правки интерфейса.
 *
 * Служебные подробности сборки:
 *   • порядок скриптов сохраняется как в index.html: util → srs → store → … → app.
 *     Это контракт загрузки, иначе модули не найдут друг друга;
 *   • service worker не регистрируется: app.js сам проверяет протокол и
 *     на file:// не вызывает register. Кэша оболочки в однофайловой
 *     сборке нет и не нужно — весь код уже внутри;
 *   • манифест и иконки остаются ссылками на файлы: при открытии из
 *     мессенджера их не будет, на работу приложения это не влияет;
 *   • вниз добавляется плашка-пояснение, что это копия для одного
 *     устройства: без неё человек ищет, почему не приходят напоминания.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let html = read('index.html');

/* ---------- Стили ---------- */
const css = read('css/style.css');
html = html.replace('<link rel="stylesheet" href="css/style.css">',
  () => '<style>\n' + css + '\n</style>');

/* ---------- Скрипты ---------- */
const scripts = [];
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  scripts.push(src);
  return m;
});

const inline = scripts.map(src => '/* ==== ' + src + ' ==== */\n' + read(src)).join('\n');

// вынимаем каждый <script src> со своего места...
scripts.forEach(src => {
  html = html.replace('<script src="' + src + '"></script>', '');
});
// ...и вставляем один блок в конце body — порядок сохраняется
html = html.replace('</body>', () => '<script>\n' + inline + '\n</script>\n</body>');

/* ---------- Плашка «это копия» ---------- */
const notice = '<div id="mobile-build-note" style="' +
  'position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
  'background:#3b2f57;color:#fff;font:13px/1.45 system-ui,sans-serif;' +
  'padding:9px 12px;text-align:center;border-top:1px solid rgba(255,255,255,.15)">' +
  'Это копия LexiFlow для одного устройства: без напоминаний и установки. ' +
  'Чтобы приложение работало полностью — откройте его по ссылке и добавьте на главный экран.' +
  '</div>';

html = html.replace('</body>', () => notice + '\n</body>');

/* ---------- Запись ---------- */
const out = path.join(ROOT, 'lexiflow-mobile.html');
fs.writeFileSync(out, html, 'utf8');

const kb = Math.round(fs.statSync(out).size / 1024);
console.log('Собрано: lexiflow-mobile.html (' + kb + ' КБ, скриптов: ' + scripts.length + ')');
console.log('Откройте файл на телефоне — данные сохранятся в этом браузере.');
if (kb > 3000) {
  console.log('ВНИМАНИЕ: файл больше 3 МБ — часть мессенджеров его не перешлёт. ' +
    'Проверьте, не попали ли в сборку аудиофайлы.');
}

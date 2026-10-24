/* Проверка контракта модулей: каждый вызванный App.<модуль>.<функция>()
   должен существовать в загруженном модуле. Ловит класс багов, из-за
   которых экран падал посреди отрисовки: «App.streak.remainingToday is
   not a function», «S.logs is not a function». Ошибка такого вида
   выглядит невинно, а выключает целый экран.

   Как работает:
   1. Модули грузятся по порядку из index.html в поддельном окружении
      (как в test-core.js) — экспорты берутся реальные, не угаданные.
   2. Регуляркой по тому же html находится реальный порядок подключения.
   3. Все вызовы App.<модуль>.<функция>( и <псевдоним>.<функция>(
      (var S = App.store) сверяются с реальными ключами модуля.

   Запуск: node tools/check-contract.js                 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const order = [];
html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const p = path.join(ROOT, src);
  if (fs.existsSync(p)) order.push(p);
  return m;
});

/* ---------- Поддельное окружение: всё, чего боятся модули при загрузке ---------- */
function fakeElement() {
  const el = {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', className: '',
    firstChild: null, lastChild: null, parentNode: null, parentElement: null,
    nextSibling: null, previousSibling: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    append() {}, remove() {}, focus() {}, click() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    contains: () => false, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
  };
  return el;
}
const handlers = {};
function makeEventTarget(target) {
  target.addEventListener = function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); };
  target.removeEventListener = function (type, fn) {
    if (handlers[type]) handlers[type] = handlers[type].filter(x => x !== fn);
  };
  target.dispatchEvent = function () { return true; };
  return target;
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.console = console;
sandbox.setTimeout = () => 0;
sandbox.clearTimeout = () => {};
sandbox.setInterval = () => 0;
sandbox.clearInterval = () => {};
sandbox.Promise = Promise;
sandbox.JSON = JSON;
sandbox.Date = Date;
sandbox.Math = Math;
sandbox.Object = Object;
sandbox.Array = Array;
sandbox.String = String;
sandbox.Number = Number;
sandbox.Boolean = Boolean;
sandbox.RegExp = RegExp;
sandbox.Error = Error;
sandbox.TypeError = TypeError;
sandbox.encodeURIComponent = encodeURIComponent;
sandbox.decodeURIComponent = decodeURIComponent;
sandbox.parseInt = parseInt;
sandbox.parseFloat = parseFloat;
sandbox.isNaN = isNaN;
sandbox.navigator = { userAgent: 'node', language: 'ru-RU', onLine: true, serviceWorker: undefined };
sandbox.location = { hash: '', href: 'http://localhost/index.html', origin: 'http://localhost', search: '' };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; }
};
const fakeDoc = makeEventTarget({  createElement: fakeElement,
  createElementNS: fakeElement,
  createTextNode: () => fakeElement(),
  createDocumentFragment: () => fakeElement(),
  /* Элементы в index.html есть, поэтому querySelector возвращает
     подделку, а не null: иначе модули, лезущие к #view при загрузке,
     падают ещё до проверки контракта. */
  querySelector: () => fakeElement(),
  getElementById: () => fakeElement(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  documentElement: fakeElement(),
  body: fakeElement(),
  head: fakeElement(),
  visibilityState: 'visible',
  hidden: false,
  cookie: ''
});
sandbox.document = fakeDoc;
sandbox.fetch = () => Promise.reject(new Error('сеть в проверке контракта не используется'));
sandbox.indexedDB = undefined;
sandbox.Notification = undefined;
sandbox.BarcodeDetector = undefined;
sandbox.Cache = undefined;
sandbox.caches = undefined;
sandbox.CustomEvent = function () {};
sandbox.Node = function () {};
sandbox.Element = function () {};
sandbox.HTMLElement = function () {};
sandbox.requestAnimationFrame = () => 0;
sandbox.scrollTo = () => {};
sandbox.getSelection = () => ({ removeAllRanges() {} });
sandbox.URL = URL;
sandbox.FileReader = function () {};
sandbox.Blob = function () {};
sandbox.Audio = function () { return fakeElement(); };
sandbox.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} };
vm.createContext(sandbox);

/* window и document — приёмники событий: app.js подписывается на
   pagehide/visibilitychange прямо при загрузке. */
makeEventTarget(sandbox);

/* ---------- Загрузка модулей в порядке страницы ---------- */
const loadFailed = [];
order.forEach(p => {
  const code = fs.readFileSync(p, 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: path.basename(p) });
  } catch (e) {
    loadFailed.push(path.basename(p) + ' — ' + String(e && e.message || e).split('\n')[0]);
  }
});

if (!sandbox.App) {
  console.log('НЕ УДАЛОСЬ загрузить модули (App не создан):');
  loadFailed.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}

/* ---------- Реальные экспорты ---------- */
const exportsOf = {};
Object.keys(sandbox.App).forEach(name => {
  const mod = sandbox.App[name];
  exportsOf[name] = (mod && typeof mod === 'object') ? Object.keys(mod) : [];
});

/* ---------- Сверка вызовов ---------- */
const problems = [];
order.forEach(p => {
  const code = fs.readFileSync(p, 'utf8');
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  const lineOf = idx => code.slice(0, idx).split('\n').length;

  // var S = App.store, var SP = App.speech, var T = App.modelTts …
  // Одно имя может указывать на разные модули в разных функциях
  // (в tools.js T — это и ttsnet, и modelTts), поэтому запоминаем
  // строку определения и для вызова берём ближайшее сверху.
  const aliasDefs = {};
  let m;
  const aliasRe = /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*App\.([A-Za-z_$][\w$]*)\s*[;,]/g;
  while ((m = aliasRe.exec(code))) {
    const line = code.slice(0, m.index).split('\n').length;
    (aliasDefs[m[1]] = aliasDefs[m[1]] || []).push({ mod: m[2], line: line });
  }
  /** Модуль для псевдонима на данной строке: ближайшее определение выше. */
  const modFor = (alias, line) => {
    const list = aliasDefs[alias] || [];
    let found = null;
    list.forEach(d => { if (d.line < line) found = d.mod; });
    return found;
  };

  const callRe = /\bApp\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = callRe.exec(code))) {
    const mod = m[1], fn = m[2];
    // util-подобные модули объявляют и переменные, и функции: пропускаем
    // известные константы (они не вызовы, но регулярка не различает).
    if (!Object.prototype.hasOwnProperty.call(exportsOf, mod)) continue;
    if (exportsOf[mod].indexOf(fn) === -1) {
      problems.push(`${rel}:${lineOf(m.index)}  App.${mod}.${fn}() — модуль ${mod} объявляет: ${exportsOf[mod].join(', ')}`);
    }
  }

  Object.keys(aliasDefs).forEach(alias => {
    const useRe = new RegExp('\\b' + alias + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
    while ((m = useRe.exec(code))) {
      const line = code.slice(0, m.index).split('\n').length;
      const mod = modFor(alias, line);
      if (!mod || !Object.prototype.hasOwnProperty.call(exportsOf, mod)) continue;
      const fn = m[1];
      if (exportsOf[mod].indexOf(fn) === -1) {
        problems.push(`${rel}:${line}  ${alias}.${fn}() (это App.${mod}) — модуль объявляет: ${exportsOf[mod].join(', ')}`);
      }
    }
  });
});

/* ---------- Офлайн-оболочка сервис-воркера ----------
   Битый кэш — самый неприятный баг: приложение работает в онлайне и
   молча ломается после перезагрузки без сети, потому что sw.js
   не знает о новом файле. Все скрипты и стили из index.html обязаны
   быть в SHELL. */
{
  const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shellBlock = /var SHELL = \[([\s\S]*?)\];/.exec(swCode);
  if (!shellBlock) {
    problems.push('sw.js: не найден массив SHELL');
  } else {
    const inShell = path => shellBlock[1].indexOf(path) >= 0;
    const assets = [];
    html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => assets.push(src));
    html.replace(/<link[^>]+href="([^"]+\.css)"/g, (m, href) => assets.push(href));
    assets.forEach(rel => {
      const norm = './' + rel.replace(/^\.?\//, '');
      if (!inShell(norm) && !inShell(rel)) {
        problems.push(`index.html → sw.js: ${rel} подключён на странице, но его нет в SHELL — ` +
          'после перезагрузки без сети модуль не загрузится и приложение сломается');
      }
    });
  }
}

/* ---------- Версия сборки: sw.js и приложение обязаны совпадать ----------
   VERSION в sw.js говорит service worker, что кэш устарел. App.version —
   номер, который человек видит в настройках. Разошлись — телефон тянет
   новый код со старым кэшем (или наоборот), а номер на экране врёт. */
{
  const swVersion = /var VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'));
  const appVersion = sandbox.App && sandbox.App.version;
  if (!swVersion) problems.push('sw.js: не найдена переменная VERSION');
  if (!appVersion) problems.push('App.version не объявлена — в настройках не показать сборку');
  if (swVersion && appVersion && swVersion[1] !== appVersion) {
    problems.push(`версии разошлись: sw.js ${swVersion[1]} ≠ App.version ${appVersion}`);
  }
}

/* ---------- Отчёт ---------- */
let bad = false;
if (loadFailed.length) {
  console.log('МОДУЛИ НЕ ЗАГРУЗИЛИСЬ:');
  loadFailed.forEach(f => console.log('  ✗ ' + f));
  bad = true;
}
if (problems.length) {
  console.log('НАРУШЕН КОНТРАКТ МОДУЛЕЙ (' + problems.length + '):');
  problems.forEach(p => console.log('  ✗ ' + p));
  bad = true;
}
if (bad) process.exit(1);

console.log('Контракт модулей в порядке: загружено ' + order.length +
  ' модулей, сверены все вызовы App.<модуль>.<функция>() и псевдонимы.');

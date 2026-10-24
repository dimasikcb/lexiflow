/**
 * LexiFlow — тесты напоминаний (без браузера).
 *
 * Запуск:
 *   node tools/test-notify.js
 *
 * Проверяет чистую логику js/notify.js: решение о показе (shouldNotify),
 * разбор времени, счётчик «к повторению», запись настроек через store,
 * контракт IndexedDB и сборку панели js/views/notify.js.
 *
 * Реальный IndexedDB и настоящие уведомления здесь не проверяются —
 * в Node их нет; вместо этого проверяются экспортированные константы
 * схемы и аккуратная деградация без Notification API.
 *
 * Стиль и загрузка модулей — как в tools/test-core.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- Минимальное окружение браузера ---------- */

function Node() {}

function fakeElement() {
  const el = new Node();
  Object.assign(el, {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', className: '',
    firstChild: null, parentNode: null, disabled: false, checked: false, value: '', nodeType: 1,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) {
      this.children.push(c);
      if (c) c.parentNode = this;
      this.firstChild = this.children[0] || null;
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter(x => x !== c);
      this.firstChild = this.children[0] || null;
      return c;
    },
    append() {}, remove() {}, focus() {}, click() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => []
  });
  return el;
}

function textNode(text) {
  const node = new Node();
  Object.assign(node, { nodeType: 3, textContent: String(text), children: [] });
  return node;
}

global.window = global;
global.Node = Node;

/**
 * Запоминаем подписки на события: модуль напоминаний слушает уход
 * страницы в фон (visibilitychange/pagehide) и там же дописывает
 * сводку в IndexedDB. Без этого такие ветки не проверить.
 */
function makeEventTarget(target) {
  const handlers = {};
  target.addEventListener = function (type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
  };
  target.removeEventListener = function (type, fn) {
    if (handlers[type]) handlers[type] = handlers[type].filter(x => x !== fn);
  };
  target.fire = function (type, event) {
    (handlers[type] || []).slice().forEach(fn => fn(event || {}));
  };
  return target;
}

makeEventTarget(global);

const storage = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: k => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

global.document = {
  createElement: fakeElement,
  createElementNS: fakeElement,
  createTextNode: textNode,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: {
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, contains: () => false
  },
  documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } },
  readyState: 'complete',
  visibilityState: 'visible'
};
makeEventTarget(global.document);
global.requestAnimationFrame = fn => setTimeout(fn, 0);

/* navigator в Node — свойство-аксессор без сеттера: обычное присваивание
   молча ничего не делает, поэтому подменяем через defineProperty. */
Object.defineProperty(global, 'navigator', {
  value: { userAgent: 'node-test', serviceWorker: undefined },
  configurable: true,
  writable: true
});

// URL и Blob в Node уже есть — добавляем только отсутствующие методы
if (typeof global.URL === 'function') {
  if (!global.URL.createObjectURL) global.URL.createObjectURL = () => 'blob:x';
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = () => {};
}
if (typeof global.Blob !== 'function') {
  global.Blob = function BlobStub() { this.size = 0; };
}

const ROOT = path.join(__dirname, '..');
['js/util.js', 'js/srs.js', 'js/store.js', 'js/notify.js', 'js/views/notify.js'].forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInThisContext(code, { filename: f });
});

const U = App.util, S = App.store, SRS = App.srs, N = App.notify, V = App.views.notify;

/* ---------- Мини-фреймворк ---------- */

let pass = 0, fail = 0;

function section(name) { console.log('\n' + name); }
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : ''));
  }
}
function eq(actual, expected, name) { ok(actual === expected, name, { actual, expected }); }

/* ---------- Помощники ---------- */

const MS_DAY = 86400000;

/** Момент сегодня в указанное время — границы суток задаём явно. */
function todayAt(hours, minutes) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

const NOON = todayAt(12, 0);       // раньше 19:00
const EVENING = todayAt(20, 0);    // позже 19:00

/** Ключ дня со сдвигом: считаем от полудня, чтобы перевод часов не мешал. */
function dayKeyOffset(days) {
  const d = new Date(NOON);
  d.setDate(d.getDate() + days);
  return U.dayKey(d.getTime());
}
const TODAY = dayKeyOffset(0);
const YESTERDAY = dayKeyOffset(-1);

function input(over) {
  return Object.assign({
    now: EVENING, time: '19:00', due: 5, enabled: true, onlyIfDue: true, lastShown: ''
  }, over || {});
}

/** Временно подставить Notification API (и убрать его после блока). */
function withNotification(api, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'Notification');
  const prev = global.Notification;
  global.Notification = api;
  try { return fn(); }
  finally {
    if (had) global.Notification = prev;
    else delete global.Notification;
  }
}

function reset() { S.wipe(); S.flush(); }

function collectText(node, out) {
  out = out || [];
  if (!node) return out;
  if (node.textContent) out.push(node.textContent);
  (node.children || []).forEach(c => collectText(c, out));
  return out;
}

/* ============================================================
   1. Решение о показе напоминания
   ============================================================ */

section('shouldNotify: время суток');
{
  eq(N.shouldNotify(input()), true, 'время наступило, долг есть → напоминаем');
  eq(N.shouldNotify(input({ now: NOON })), false, 'время ещё не наступило → молчим');
  eq(N.shouldNotify(input({ now: todayAt(18, 59) })), false, 'за минуту до срока → молчим');
  eq(N.shouldNotify(input({ now: todayAt(19, 0) })), true, 'ровно в назначенную минуту → напоминаем');
  eq(N.shouldNotify(input({ now: todayAt(23, 59) })), true, 'поздно вечером напоминание всё ещё актуально');

  // полночь как время напоминания
  eq(N.shouldNotify(input({ now: todayAt(0, 0), time: '00:00' })), true, 'время «00:00» срабатывает в полночь');
  eq(N.shouldNotify(input({ now: NOON, time: '00:00' })), true, '«00:00» срабатывает и днём');
  eq(N.shouldNotify(input({ now: todayAt(0, 0), time: '00:01' })), false, 'в 00:00 время «00:01» ещё не наступило');

  // переход через полночь: «сегодня» определяется по локальной дате
  eq(N.shouldNotify(input({ now: todayAt(0, 5), time: '23:00', lastShown: YESTERDAY })), false,
    'после полуночи вечернее время ещё не наступило');
  eq(N.shouldNotify(input({ now: todayAt(23, 50), time: '23:00', lastShown: YESTERDAY })), true,
    'вечером напоминание срабатывает');
  eq(N.shouldNotify(input({ now: todayAt(0, 1), time: '00:00', lastShown: YESTERDAY })), true,
    'после полуночи начинается новый день и напоминание приходит снова');
  eq(N.shouldNotify(input({ now: todayAt(0, 1), time: '00:00', lastShown: TODAY })), false,
    'но не чаще одного раза в сутки');
}

section('shouldNotify: один показ в сутки');
{
  eq(N.shouldNotify(input({ lastShown: TODAY })), false, 'сегодня уже показывали → молчим');
  eq(N.shouldNotify(input({ lastShown: YESTERDAY })), true, 'вчерашний показ не мешает');
  eq(N.shouldNotify(input({ lastShown: '' })), true, 'пустая отметка не мешает');
  eq(N.shouldNotify(input({ lastShown: '2020-01-01' })), true, 'давняя отметка не мешает');
  eq(N.shouldNotify(input({ lastShown: TODAY, now: todayAt(23, 59) })), false, 'даже в конце дня повтор не проходит');
}

section('shouldNotify: включение и непонятное время');
{
  eq(N.shouldNotify(input({ enabled: false })), false, 'выключено → молчим');
  eq(N.shouldNotify(), false, 'без аргументов → молчим');
  eq(N.shouldNotify({}), false, 'пустой объект → молчим');
  eq(N.shouldNotify(input({ enabled: true, now: NaN })), false, 'некорректный now → молчим');
  eq(N.shouldNotify(input({ now: 'вечер' })), false, 'now строкой → молчим');

  eq(N.shouldNotify(input({ time: '25:00' })), false, 'часы вне диапазона → молчим');
  eq(N.shouldNotify(input({ time: '19:60' })), false, 'минуты вне диапазона → молчим');
  eq(N.shouldNotify(input({ time: 'вечером' })), false, 'текст вместо времени → молчим');
  eq(N.shouldNotify(input({ time: '' })), false, 'пустое время → молчим');
  eq(N.shouldNotify(input({ time: null })), false, 'null вместо времени → молчим');
  eq(N.shouldNotify(input({ time: 19 })), false, 'число вместо строки → молчим');
  eq(N.shouldNotify(input({ time: '-19:00' })), false, 'отрицательное время → молчим');
}

section('shouldNotify: правило «только если есть что повторять»');
{
  eq(N.shouldNotify(input({ due: 0, onlyIfDue: true })), false, 'долга нет → молчим');
  eq(N.shouldNotify(input({ due: 0, onlyIfDue: false })), true, 'выключенная проверка долга пропускает напоминание');
  eq(N.shouldNotify(input({ due: 0 })), false, 'по умолчанию проверка долга включена');
  eq(N.shouldNotify(input({ due: 3 })), true, 'долг есть → напоминаем');
  eq(N.shouldNotify(input({ due: -5 })), false, 'отрицательный долг считается нулевым');
  eq(N.shouldNotify(input({ due: -5, onlyIfDue: false })), true, 'отрицательный долг не мешает без проверки');
  eq(N.shouldNotify(input({ due: '12' })), true, 'долг строкой приводится к числу');
  eq(N.shouldNotify(input({ due: NaN, onlyIfDue: false })), true, 'нечисловой долг не ломает решение');
  eq(N.shouldNotify(input({ due: undefined, onlyIfDue: false })), true, 'отсутствующий долг не ломает решение');
}

section('shouldNotify: чистота функции');
{
  const frozen = Object.freeze(input());
  let result = null, threw = false;
  try { result = N.shouldNotify(frozen); } catch (e) { threw = true; }
  ok(!threw, 'замороженный вход не приводит к исключению');
  eq(result, true, 'замороженный вход обрабатывается верно');

  const mutable = input();
  N.shouldNotify(mutable);
  eq(mutable.time, '19:00', 'входные данные не изменяются');
  eq(mutable.due, 5, 'счётчик долга не изменяется');
}

/* ============================================================
   2. Разбор времени и ключ даты
   ============================================================ */

section('Разбор и нормализация времени');
{
  eq(N.timeToMinutes('19:00'), 1140, '«19:00» → 1140 минут');
  eq(N.timeToMinutes('00:00'), 0, '«00:00» → 0 минут');
  eq(N.timeToMinutes('23:59'), 1439, '«23:59» → последняя минута суток');
  eq(N.timeToMinutes('9:05'), 545, 'однозначный час читается');
  eq(N.timeToMinutes(' 07:30 '), 450, 'лишние пробелы не мешают');
  eq(N.timeToMinutes('19:00:30'), 1140, 'секунды игнорируются');
  eq(N.timeToMinutes('24:00'), null, '24 часа не существует');
  eq(N.timeToMinutes('19:60'), null, '60 минут не существует');
  eq(N.timeToMinutes('19'), null, 'время без минут не принимается');
  eq(N.timeToMinutes('abc'), null, 'текст не принимается');
  eq(N.timeToMinutes(''), null, 'пустая строка не принимается');
  eq(N.timeToMinutes(null), null, 'null не принимается');
  eq(N.timeToMinutes(1140), null, 'число не принимается');

  eq(N.normalizeTime('8:3'), '08:03', 'нормализация дополняет нулями');
  eq(N.normalizeTime('19:00'), '19:00', 'корректное время не меняется');
  eq(N.normalizeTime('23:59:59'), '23:59', 'секунды отбрасываются');
  eq(N.normalizeTime('ерунда'), null, 'непонятное время → null');
}

section('Ключ локальной даты');
{
  const key = N.dateKey(NOON);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(key), 'ключ дня имеет формат YYYY-MM-DD', key);
  eq(key, U.dayKey(NOON), 'ключ совпадает с util.dayKey (одно «сегодня» на всё приложение)');
  eq(N.dateKey(new Date(2026, 0, 5, 12, 0).getTime()), '2026-01-05', 'месяц и день дополняются нулями');
  eq(N.dateKey(new Date(2026, 11, 31, 23, 59).getTime()), '2026-12-31', 'последний день года читается верно');
  eq(N.dateKey(NOON), N.dateKey(NOON + 3600000), 'в пределах дня ключ один и тот же');
  ok(N.dateKey(NOON) !== N.dateKey(NOON - MS_DAY), 'соседние дни различаются');
  eq(N.dateKey(), U.dayKey(Date.now()), 'без аргумента берётся текущее время');
}

/* ============================================================
   3. Счётчик «к повторению»
   ============================================================ */

/** Колода с разными состояниями карточек. Возвращает колоду. */
function seedDue() {
  reset();
  const deck = S.createDeck({ name: 'Долги', langFrom: 'en', langTo: 'ru' });

  function put(word, patch, suspended) {
    const card = S.createCard({ deckId: deck.id, word: word, translation: word });
    card.srs = Object.assign(SRS.newState(SRS.DEFAULT_SETTINGS, NOON), patch || {});
    if (suspended) card.suspended = true;
    return card;
  }

  put('fresh');                                                            // срок = сейчас
  put('overdue', { state: 'review', interval: 5, due: NOON - MS_DAY });     // просрочена
  put('later-today', { state: 'learning', step: 0, due: NOON + 3600000 });  // ждёт сегодня
  put('far-future', { state: 'review', interval: 30, due: NOON + 2 * MS_DAY });
  put('tomorrow', { state: 'review', interval: 1, due: U.startOfDay(NOON) + MS_DAY });
  put('suspended', { state: 'review', interval: 5, due: NOON - MS_DAY }, true);
  return deck;
}

section('dueToday: сколько карточек ждёт повторения');
{
  const deck = seedDue();

  /* Считаются только выученные карточки, у которых срок наступил: в фикстуре
     это 'overdue'. Новые ('fresh') не входят — иначе напоминание пришло бы
     тем, кто ещё не открывал ни одной карточки; 'later-today' учится и
     попадает в счётчик «обучения», а не в долг. */
  eq(N.dueToday(NOON), 1, 'считаются только карточки, которым пора прямо сейчас');
  eq(N.dueToday(NOON), S.deckStats(deck.id, NOON).due, 'число совпадает со счётчиком экрана колод');

  S.updateDeck(deck.id, { archived: true });
  eq(N.dueToday(NOON), 0, 'архивные колоды не считаются');
  S.updateDeck(deck.id, { archived: false });
  eq(N.dueToday(NOON), 1, 'после возврата из архива счётчик прежний');

  const extra = S.createDeck({ name: 'Вторая', langFrom: 'de', langTo: 'ru' });
  const card = S.createCard({ deckId: extra.id, word: 'wichtig', translation: 'важный' });
  card.srs = SRS.newState(SRS.DEFAULT_SETTINGS, NOON - MS_DAY);
  eq(N.dueToday(NOON), 1, 'новые карточки в долг не идут, даже просроченные');

  reset();
  eq(N.dueToday(NOON), 0, 'пустое хранилище → 0');
}

section('Слова к повторению: список для уведомлений по каждому слову');
{
  reset();
  const deck = seedDue();

  const list = N.dueCards(NOON, 0);
  eq(list.length, N.dueToday(NOON), 'список слов совпадает со счётчиком долга');
  eq(list.length, 1, 'новые и выученные-не-сейчас в список не попадают');
  eq(list[0].word, S.getCard(list[0].id).word, 'в списке настоящая карточка');
  eq(N.dueCards(NOON, 1).length, 1, 'ограничение размера пачки соблюдается');

  const compact = N.showWord && list[0] ? { id: list[0].id, due: list[0].srs.due } : null;
  eq(compact && typeof compact.due, 'number', 'у слова есть срок — по нему отличаем повторения');

  eq(N.DUE_KEY, 'due', 'ключ IndexedDB «due» зафиксирован для sw.js');
  eq(N.WORD_TAG, 'lexiflow-word', 'тег уведомления о слове зафиксирован для sw.js');

  S.updateDeck(deck.id, { archived: true });
  eq(N.dueCards(NOON, 0).length, 0, 'архивную колоду не напоминаем');
  S.updateDeck(deck.id, { archived: false });
  eq(N.dueCards(NOON, 0).length, 1, 'вернули колоду из архива — слово снова в списке');

  reset();
  eq(N.dueCards(NOON, 0).length, 0, 'пустое хранилище → пустой список');
}

section('Будильник на ближайший срок повторения');
{
  reset();
  const deck = S.createDeck({ name: 'Ближайшие', langFrom: 'en', langTo: 'ru' });
  const now = NOON;
  const mk = (id, due) => ({
    id, deckId: deck.id, word: 'w' + id, translation: 't' + id,
    srs: { state: 'review', step: 0, interval: 1, ease: 2.5, due, reps: 1, lapses: 0 }
  });
  const data = S.get();
  data.cards.push(
    mk('far', now + 13 * 3600000),      // дальше горизонта 12 часов
    mk('soon', now + 30 * 60000),       // ближайший будущий
    mk('later', now + 60 * 60000),
    mk('past', now - 1000)              // срок уже наступил — это не «будущий»
  );
  eq(N.nextDueAt(now), now + 30 * 60000, 'будильник — на ближайший будущий срок');
  eq(N.nextDueAt(now + 40 * 60000), now + 60 * 60000, 'после первого срока — на следующий');

  data.cards.forEach(function (c) { if (c.id === 'soon') c.suspended = true; });
  eq(N.nextDueAt(now), now + 60 * 60000, 'приостановленные карточки не будят');

  /* остаётся только карточка через 13 часов — это дальше горизонта 12 часов */
  data.cards = data.cards.filter(function (c) { return c.id === 'far'; });
  eq(N.nextDueAt(now), 0, 'за горизонтом 12 часов будильник не ставим');

  reset();
  eq(N.nextDueAt(now), 0, 'пустое хранилище → будильника нет');
}

/* ============================================================
   4. Настройки напоминаний
   ============================================================ */

section('Настройки: чтение и запись');
{
  reset();
  eq(S.settings().notify.enabled, false, 'по умолчанию напоминания выключены');
  eq(S.settings().notify.time, '19:00', 'время по умолчанию — 19:00');
  eq(N.settings().onlyIfDue, true, 'по умолчанию проверяется наличие долга');
  eq(N.settings().perCard, true, 'по умолчанию шлём уведомление о каждом слове');
  eq(N.settings().lastShown, '', 'отметка о показе пуста');

  const copy = N.settings();
  copy.time = '00:00';
  eq(S.settings().notify.time, '19:00', 'settings() отдаёт копию, а не ссылку на store');

  N.configure({ time: '08:30' });
  eq(S.settings().notify.time, '08:30', 'configure пишет время через store');

  N.configure({ time: '8:3' });
  eq(S.settings().notify.time, '08:03', 'время нормализуется перед записью');

  N.configure({ time: 'ерунда' });
  eq(S.settings().notify.time, '19:00', 'непонятное время заменяется значением по умолчанию');

  N.configure({ onlyIfDue: false });
  eq(S.settings().notify.onlyIfDue, false, 'флаг «только если есть долг» записывается');
  N.configure({ onlyIfDue: true });
  eq(S.settings().notify.onlyIfDue, true, 'флаг возвращается обратно');

  S.settings().notify.lastShown = '2020-01-01';
  N.configure({ time: '07:15' });
  eq(S.settings().notify.lastShown, '2020-01-01', 'правка времени не сбрасывает отметку о показе');
  eq(S.settings().notify.time, '07:15', 'правка применяется к текущим настройкам');

  const result = N.configure({ time: '06:00' });
  eq(typeof result.then, 'function', 'configure возвращает промис');
}

section('Настройки: разрешение браузера');
{
  reset();
  eq(N.supported(), false, 'без Notification API модуль считается неподдерживаемым');
  eq(N.permission(), 'unsupported', 'permission() сообщает unsupported');

  N.configure({ enabled: true });
  eq(S.settings().notify.enabled, true, 'без Notification API настройка всё равно сохраняется');

  withNotification({ permission: 'denied' }, () => {
    eq(N.supported(), true, 'с Notification API модуль считается поддерживаемым');
    eq(N.permission(), 'denied', 'permission() читает запрет из браузера');
    N.configure({ enabled: true });
    eq(S.settings().notify.enabled, false, 'при запрете включить напоминания нельзя');
  });

  withNotification({ permission: 'granted' }, () => {
    eq(N.permission(), 'granted', 'permission() читает выданное разрешение');
    N.configure({ enabled: true });
    eq(S.settings().notify.enabled, true, 'при выданном разрешении напоминания включаются');
  });

  eq(N.supported(), false, 'после удаления Notification API состояние возвращается');
  eq(N.permission(), 'unsupported', 'и снова сообщает unsupported');
}

/* ============================================================
   5. Контракт с service worker
   ============================================================ */

section('Схема IndexedDB (контракт с sw.js)');
{
  eq(N.DB_NAME, 'lexiflow-sw', 'имя базы заморожено');
  eq(N.DB_VERSION, 1, 'версия базы — 1');
  eq(N.STORE, 'reminder', 'имя хранилища заморожено');
  eq(N.SUMMARY_KEY, 'state', 'ключ записи сводки заморожен');

  seedDue();
  const sum = N.summary(NOON);

  eq(sum.key, 'state', 'сводка пишется под ключом state');
  eq(typeof sum.enabled, 'boolean', 'enabled — boolean');
  eq(sum.time, S.settings().notify.time, 'time совпадает с настройками');
  ok(Array.isArray(sum.days), 'days — массив дней недели (его читает sw.js)');
  eq(typeof sum.onlyIfDue, 'boolean', 'onlyIfDue — boolean');
  eq(typeof sum.due, 'number', 'due — число');
  eq(sum.due, N.dueToday(NOON), 'due совпадает со счётчиком к повторению');
  eq(typeof sum.streak, 'number', 'streak — число');
  eq(sum.goal, S.settings().dailyGoal, 'goal совпадает с целью дня');
  eq(typeof sum.reviewsToday, 'number', 'reviewsToday — число');
  ok(sum.updatedAt > 0, 'updatedAt заполнен');
  eq(sum.lastShown, '', 'lastShown — строка с датой');
  eq(Object.keys(sum).length, 11, 'в записи ровно 11 полей, как в схеме');
  eq(JSON.parse(JSON.stringify(sum)).key, 'state', 'запись переживает сериализацию');

  S.settings().notify.lastShown = '2026-01-02';
  eq(N.summary(NOON).lastShown, '2026-01-02', 'lastShown попадает в сводку');
}

section('Сводка: форматирование текста уведомления');
{
  eq(N.reminderText(1), 'К повторению: 1 карточка', 'одна карточка — единственное число');
  eq(N.reminderText(3), 'К повторению: 3 карточки', 'три карточки — множественное число');
  eq(N.reminderText(12), 'К повторению: 12 карточек', 'двенадцать карточек — родительный падеж');
  eq(N.reminderText(0), 'Самое время немного позаниматься.', 'без долга — общая фраза');
  eq(N.reminderText(-4), 'Самое время немного позаниматься.', 'отрицательный долг — общая фраза');
}

/* ============================================================
   6. Панель настроек
   ============================================================ */

section('Панель напоминаний');
{
  ok(!!V && typeof V.panel === 'function', 'панель экспортируется');
  ok(!!V && typeof V.render === 'function', 'полноэкранный вариант экспортируется');

  reset();
  const panel = V.panel();
  ok(!!panel && panel.className === 'panel', 'панель — секция .panel', panel && panel.className);
  const text = collectText(panel).join(' | ');

  ok(text.indexOf('Напоминания') >= 0, 'в панели есть заголовок');
  ok(text.indexOf('Разрешение браузера') >= 0, 'показывается состояние разрешения');
  ok(text.indexOf('Не поддерживается') >= 0, 'в Node разрешение честно помечено как неподдерживаемое');
  ok(text.indexOf('Напоминать о повторении') >= 0, 'есть переключатель включения');
  ok(text.indexOf('Время напоминания') >= 0, 'есть поле времени');
  ok(text.indexOf('Только если есть что повторять') >= 0, 'есть переключатель проверки долга');
  ok(text.indexOf('Проверить уведомление') >= 0, 'есть кнопка пробного уведомления');
  ok(text.indexOf('push-уведомлений') >= 0, 'объясняется отсутствие push-сервера');
  ok(text.indexOf('закрыта, напоминание не придёт') >= 0, 'объясняется ограничение закрытой вкладки');
  ok(text.indexOf('ждать нечего') >= 0 || text.indexOf('ждут повторения') >= 0, 'показывается текущий долг');

  const root = fakeElement();
  let renderThrew = false;
  try { V.render(root); } catch (e) { renderThrew = true; }
  ok(!renderThrew, 'render() собирает экран без исключений');
  ok(root.children.length > 0, 'render() наполняет переданный контейнер');
}

/* ============================================================
   7. Асинхронные ветки
   ============================================================ */

function check(promise, expected, name) {
  return promise.then(value => { eq(value, expected, name); return value; });
}

/* ============================================================
   8. Сводка в IndexedDB: не остаётся «отложенной» при уходе в фон

   Дебаунс записи (1,2 с) нужен, пока страница на экране. Но мобильные
   браузеры замораживают таймеры сразу после ухода в фон, поэтому запись,
   отложенная в этот момент, не случится никогда — service worker прочитает
   устаревшую сводку и пришлёт второе напоминание за день. Здесь проверяем,
   что в фон сводка уходит немедленно, а отложенная запись досылается
   событиями ухода со страницы.
   ============================================================ */

const DEBOUNCE_MS = 1200;   // как MIRROR_DEBOUNCE_MS в js/notify.js
let mirrorOpens = 0;

/** IndexedDB-заглушка: считает открытия базы и доводит транзакцию до конца. */
function fakeIndexedDB() {
  return {
    open() {
      mirrorOpens++;
      const req = {
        result: null, onsuccess: null, onerror: null,
        onupgradeneeded: null, onblocked: null
      };
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = {
              objectStore: () => ({ put() {} }),
              oncomplete: null, onerror: null, onabort: null
            };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
          close() {}
        };
        req.result = db;
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }
  };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function mirrorTiming() {
  section('Сводка в IndexedDB: в фон уходит сразу, на экране — с задержкой');

  global.indexedDB = fakeIndexedDB();
  document.visibilityState = 'visible';
  // гасим отложенную запись, оставшуюся от reset() в прошлой секции
  await N.flushMirror();
  await wait(30);

  eq(N.isHidden(), false, 'на экране страница считается видимой');

  let base = mirrorOpens;
  N.refreshMirror();
  eq(mirrorOpens, base, 'на экране запись откладывается, а не идёт на каждую правку');

  await wait(DEBOUNCE_MS + 200);
  eq(mirrorOpens, base + 1, 'отложенная запись всё-таки случается, пока страница на экране');

  /* --- страница ушла в фон --- */
  document.visibilityState = 'hidden';
  eq(N.isHidden(), true, 'в фоне страница считается скрытой');

  base = mirrorOpens;
  N.refreshMirror();
  await wait(40);
  eq(mirrorOpens, base + 1, 'в фоне сводка пишется сразу, не дожидаясь дебаунса');

  // так выглядит настоящий путь: app.js зовёт store.flush() на уходе
  base = mirrorOpens;
  S.flush();
  await wait(40);
  eq(mirrorOpens, base + 1, 'сохранение при уходе со страницы дописывает сводку немедленно');

  // смена настроек напоминаний в фоне — тот же немедленный путь.
  // Записей тут может оказаться и две (подписка на store плюс сам
  // writeNotify) — сводка одна и та же, важен только срок: не отложить.
  base = mirrorOpens;
  await N.configure({ enabled: false, time: '21:45' });
  await wait(40);
  ok(mirrorOpens > base, 'смена настроек напоминаний в фоне не откладывается');

  /* --- события ухода со страницы досылают отложенную запись --- */
  document.visibilityState = 'visible';
  N.scheduleMirror();                  // как при обычной правке на экране
  base = mirrorOpens;
  global.fire('pagehide');
  await wait(40);
  eq(mirrorOpens, base + 1, 'pagehide досылает отложенную сводку, не дожидаясь таймера');

  document.visibilityState = 'visible';
  N.scheduleMirror();
  document.visibilityState = 'hidden';
  base = mirrorOpens;
  document.fire('visibilitychange');
  await wait(40);
  eq(mirrorOpens, base + 1, 'уход в фон по visibilitychange тоже досылает сводку');

  // и наоборот: возвращение на экран ничего лишнего не пишет
  document.visibilityState = 'visible';
  base = mirrorOpens;
  document.fire('visibilitychange');
  await wait(40);
  eq(mirrorOpens, base, 'возвращение на экран лишней записи не делает');

  delete global.indexedDB;
  await wait(DEBOUNCE_MS + 200);   // не оставляем таймеров после секции
}

section('Запрос разрешения и зеркало (асинхронно)');
{
  reset();

  check(N.request(), 'unsupported', 'request() без Notification API возвращает unsupported')
    .then(() => {
      global.Notification = { permission: 'granted' };
      return check(N.request(), 'granted', 'уже выданное разрешение не переспрашивается');
    })
    .then(() => {
      global.Notification = { permission: 'default', requestPermission: () => Promise.resolve('granted') };
      return check(N.request(), 'granted', 'промис-форма requestPermission поддерживается');
    })
    .then(() => {
      global.Notification = { permission: 'default', requestPermission: (cb) => { cb('denied'); } };
      return check(N.request(), 'denied', 'колбэк-форма requestPermission поддерживается');
    })
    .then(() => {
      global.Notification = { permission: 'default', requestPermission: () => { throw new Error('нет жеста'); } };
      return check(N.request(), 'default', 'исключение внутри requestPermission не роняет модуль');
    })
    .then(() => {
      global.Notification = { permission: 'default', requestPermission: () => Promise.resolve('ерунда') };
      return check(N.request(), 'default', 'непонятный ответ браузера приводится к default');
    })
    .then(() => {
      delete global.Notification;
      return check(N.request(), 'unsupported', 'без API запрос снова возвращает unsupported');
    })
    .then(() => check(N.mirror(), false, 'mirror() без IndexedDB возвращает false, а не падает'))
    .then(() => check(N.test(), false, 'test() без поддержки возвращает false'))
    .then(() => {
      let threw = false;
      try { N.start(); N.stop(); N.stop(); } catch (e) { threw = true; }
      ok(!threw, 'start() и stop() без поддержки ничего не ломают');
      return N.configure({ enabled: true, time: '21:45' });
    })
    .then((cfg) => {
      eq(cfg.time, '21:45', 'configure возвращает итоговые настройки');
      eq(cfg.enabled, true, 'настройка включения применилась');
      ok(!N.supported(), 'Notification так и не появился — деградация корректна');
    })
    .then(mirrorTiming)
    .then(finish)
    .catch((e) => {
      fail++;
      console.log('  ✗ необработанная ошибка в асинхронной части: ' + (e && e.stack || e));
      finish();
    });
}

function finish() {
  console.log('\n' + '─'.repeat(52));
  console.log(fail === 0
    ? `ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${pass}`
    : `ПРОЙДЕНО ${pass}, ПРОВАЛЕНО ${fail}`);
  console.log('─'.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
}

/**
 * LexiFlow — тесты синхронизации (без браузера).
 *
 * Запуск:
 *   node tools/test-sync.js
 *
 * Проверяет ядро модуля синхронизации: чистое слияние данных
 * (js/sync.js) и панель настроек (js/views/sync.js). Сеть подменяется
 * заглушкой, поэтому ни один запрос наружу не уходит.
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
    firstChild: null, parentNode: null, disabled: false, nodeType: 1,
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

/* Запись обработчиков событий. Без неё нельзя проверить реакцию приложения
   на уход в фон и на возвращение — а именно там и ломалось: на телефоне
   таймеры в фоне стоят, поэтому чужие правки не приезжали. */
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

global.document = makeEventTarget({
  createElement: fakeElement,
  createElementNS: fakeElement,
  createTextNode: textNode,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: {
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, contains: () => false
  },
  documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } },
  visibilityState: 'visible',
  readyState: 'complete'
});
global.requestAnimationFrame = fn => setTimeout(fn, 0);
if (typeof global.URL === 'function') {
  if (!global.URL.createObjectURL) global.URL.createObjectURL = () => 'blob:x';
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = () => {};
}
if (typeof global.Blob !== 'function') {
  global.Blob = function BlobStub() { this.size = 0; };
}

const ROOT = path.join(__dirname, '..');
['js/util.js', 'js/srs.js', 'js/store.js', 'js/sync.js', 'js/views/sync.js'].forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInThisContext(code, { filename: f });
});

const U = App.util, S = App.store, SY = App.sync, V = App.views.sync;

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

/* ---------- Помощники для сборки данных ---------- */

function deck(id, updatedAt, extra) {
  return Object.assign({
    id, name: 'Колода ' + id, langFrom: 'en', langTo: 'ru',
    createdAt: updatedAt, updatedAt
  }, extra || {});
}
function card(id, deckId, updatedAt, extra) {
  return Object.assign({
    id, deckId, word: 'w-' + id, translation: 'п-' + id,
    createdAt: updatedAt, updatedAt
  }, extra || {});
}
function log(id, ts, cardId) {
  return { id, ts, cardId: cardId === undefined ? null : cardId, grade: 3 };
}
function tomb(id, kind, at) { return { id, kind, at }; }
function data(over) {
  return Object.assign({
    version: 1, decks: [], cards: [], logs: [], tombstones: [],
    settingsUpdatedAt: 0, settings: { theme: 'auto' }, meta: {}
  }, over || {});
}

function collectText(node, out) {
  out = out || [];
  if (!node) return out;
  if (node.textContent) out.push(node.textContent);
  (node.children || []).forEach(c => collectText(c, out));
  return out;
}

/* Чистое состояние перед проверкой. Гасим и таймеры автосинхронизации:
   wipe() помечает данные как изменённые, а удаление теперь отправляется
   почти сразу — иначе отложенная отправка выстрелила бы посреди следующей
   проверки и сломала бы счётчик запросов. */
function reset() {
  S.wipe();
  S.flush();
  SY.stop();
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ============================================================
   1. Слияние: записи
   ============================================================ */

section('Слияние: записи есть только с одной стороны');
{
  const r = SY.merge(
    data({ decks: [deck('d1', 100)], cards: [card('c1', 'd1', 100)] }),
    data({ decks: [deck('d2', 100)], cards: [card('c2', 'd2', 100)] })
  );
  eq(r.data.decks.length, 2, 'колоды с обеих сторон сохранены');
  eq(r.data.cards.length, 2, 'карточки с обеих сторон сохранены');
  eq(r.stats.decksAdded, 1, 'новая колода из облака посчитана');
  eq(r.stats.decksUpdated, 0, 'обновлённых колод нет');
  eq(r.stats.cardsAdded, 1, 'новая карточка из облака посчитана');
  eq(r.stats.cardsUpdated, 0, 'обновлённых карточек нет');
  eq(r.data.decks.map(d => d.id).join(','), 'd1,d2', 'порядок: сначала свои, затем чужие');
}

section('Слияние: побеждает более свежая правка');
{
  const r = SY.merge(
    data({ cards: [card('c1', null, 200, { word: 'своя' })] }),
    data({ cards: [card('c1', null, 100, { word: 'чужая' })] })
  );
  eq(r.data.cards.length, 1, 'запись с одинаковым id не размножается');
  eq(r.data.cards[0].word, 'своя', 'своя правка новее — остаётся она');
  eq(r.stats.cardsUpdated, 0, 'своя же запись не считается обновлённой');

  const r2 = SY.merge(
    data({ cards: [card('c1', null, 100, { word: 'своя' })] }),
    data({ cards: [card('c1', null, 200, { word: 'чужая' })] })
  );
  eq(r2.data.cards[0].word, 'чужая', 'чужая правка новее — берём её');
  eq(r2.stats.cardsUpdated, 1, 'обновление из облака посчитано');
  eq(r2.stats.cardsAdded, 0, 'обновление не считается добавлением');
}

section('Слияние: ничья по времени достаётся облаку');
{
  const r = SY.merge(
    data({ cards: [card('c1', null, 500, { word: 'своя' })] }),
    data({ cards: [card('c1', null, 500, { word: 'чужая' })] })
  );
  eq(r.data.cards[0].word, 'чужая', 'при равном updatedAt побеждает удалённая сторона');

  const d = SY.merge(
    data({ decks: [deck('d1', 500, { name: 'Своя' })] }),
    data({ decks: [deck('d1', 500, { name: 'Чужая' })] })
  );
  eq(d.data.decks[0].name, 'Чужая', 'правило ничьей работает и для колод');

  const d2 = SY.merge(
    data({ decks: [deck('d1', 700, { name: 'Своя' })] }),
    data({ decks: [deck('d1', 500, { name: 'Чужая' })] })
  );
  eq(d2.data.decks[0].name, 'Своя', 'более свежая своя колода не перетирается');
}

/* ============================================================
   2. Слияние: удаления
   ============================================================ */

section('Слияние: удаления побеждают');
{
  const r = SY.merge(
    data({ cards: [card('c1', null, 100)] }),
    data({ tombstones: [tomb('c1', 'card', 300)] })
  );
  eq(r.data.cards.length, 0, 'карточка, удалённая на другом устройстве, не воскресает');
  eq(r.stats.deleted, 1, 'удаление посчитано');
  ok(JSON.stringify(r.data.tombstones).indexOf('c1') > 0, 'надгробие сохранено в результате');

  const r2 = SY.merge(
    data({ tombstones: [tomb('c1', 'card', 300)] }),
    data({ cards: [card('c1', null, 100)] })
  );
  eq(r2.data.cards.length, 0, 'своё удаление побеждает чужую копию');

  const r3 = SY.merge(
    data({ cards: [card('c1', null, 400)] }),
    data({ tombstones: [tomb('c1', 'card', 300)] })
  );
  eq(r3.data.cards.length, 1, 'карточка, изменённая после удаления, остаётся');
  eq(r3.stats.deleted, 0, 'ложных удалений нет');

  const r4 = SY.merge(
    data({ cards: [card('c1', null, 300)] }),
    data({ tombstones: [tomb('c1', 'card', 300)] })
  );
  eq(r4.data.cards.length, 0, 'при равенстве времени удаление сильнее записи');

  const r5 = SY.merge(
    data({ decks: [deck('x', 100)] }),
    data({ tombstones: [tomb('x', 'card', 500)] })
  );
  eq(r5.data.decks.length, 1, 'надгробие карточки не трогает колоду с тем же id');

  const r6 = SY.merge(
    data({ decks: [deck('x', 100)] }),
    data({ tombstones: [tomb('x', 'deck', 500)] })
  );
  eq(r6.data.decks.length, 0, 'надгробие колоды удаляет колоду');
}

section('Слияние: надгробия объединяются по паре (id, вид)');
{
  const r = SY.merge(
    data({ tombstones: [tomb('c1', 'card', 100), tomb('d1', 'deck', 100)] }),
    data({ tombstones: [tomb('c1', 'card', 500), tomb('c2', 'card', 200)] })
  );
  eq(r.data.tombstones.length, 3, 'надгробия объединены без дубликатов');
  const c1 = r.data.tombstones.filter(t => t.id === 'c1')[0];
  eq(c1.at, 500, 'у повторного удаления остаётся более позднее время');
  eq(c1.kind, 'card', 'вид записи сохранён');
}

/* ============================================================
   3. Слияние: журнал повторений
   ============================================================ */

section('Слияние: журнал повторений');
{
  const r = SY.merge(
    data({ logs: [log('l1', 10, 'c1'), log('l2', 20, 'c1')] }),
    data({ logs: [log('l2', 20, 'c1'), log('l3', 30, 'c1')] })
  );
  eq(r.data.logs.length, 3, 'журнал объединён по id');
  eq(r.stats.logsAdded, 1, 'добавлена ровно одна чужая запись');
  eq(r.data.logs.map(l => l.id).join(','), 'l1,l2,l3', 'записи идут по возрастанию времени');

  const order = SY.merge(
    data({ logs: [log('b', 50, null)] }),
    data({ logs: [log('a', 10, null)] })
  );
  eq(order.data.logs[0].id, 'a', 'более ранняя запись идёт первой');
  eq(order.data.logs[1].id, 'b', 'более поздняя — последней');

  const dead = SY.merge(
    data({ logs: [log('l1', 10, 'c1'), log('l2', 20, 'c2'), log('l3', 30, null)] }),
    data({ tombstones: [tomb('c1', 'card', 999)] })
  );
  eq(dead.data.logs.length, 2, 'записи удалённой карточки выпадают');
  ok(!dead.data.logs.some(l => l.cardId === 'c1'), 'журнал не ссылается на удалённую карточку');
  eq(dead.stats.logsDropped, 1, 'выпавшая запись посчитана');
  ok(dead.data.logs.some(l => l.cardId === null), 'записи без карточки остаются');
}

section('Слияние: журнал ограничен 20 000 записей');
{
  const many = [];
  for (let i = 0; i < 10010; i++) many.push(log('L' + i, i, null));
  const manyRemote = [];
  for (let i = 0; i < 10010; i++) manyRemote.push(log('R' + i, 100000 + i, null));

  const r = SY.merge(data({ logs: many }), data({ logs: manyRemote }));
  eq(r.data.logs.length, 20000, 'журнал обрезан до 20 000 записей');
  eq(r.data.logs[0].id, 'L20', 'обрезаются самые старые записи');
  eq(r.data.logs[r.data.logs.length - 1].id, 'R10009', 'последней остаётся самая свежая');
}

/* ============================================================
   4. Слияние: карточки без колоды
   ============================================================ */

section('Слияние: карточки без колоды');
{
  const r = SY.merge(data({ cards: [card('c1', 'd9', 100)] }), data({ decks: [] }));
  eq(r.data.cards.length, 1, 'карточка не исчезает вместе с колодой');
  eq(r.data.cards[0].deckId, null, 'карточка теряет привязку к несуществующей колоде');
  eq(r.stats.orphans, 1, 'потерянная карточка посчитана');

  const alive = SY.merge(
    data({ decks: [deck('d1', 1)], cards: [card('c1', 'd1', 100)] }),
    data({})
  );
  eq(alive.data.cards[0].deckId, 'd1', 'карточка с существующей колодой не трогается');
  eq(alive.stats.orphans, 0, 'лишних срабатываний нет');

  const free = SY.merge(data({ cards: [card('c1', null, 100)] }), data({}));
  eq(free.data.cards[0].deckId, null, 'карточка вне колоды остаётся вне колоды');
  eq(free.stats.orphans, 0, 'карточка вне колоды не считается потерянной');

  const gone = SY.merge(
    data({ decks: [deck('d1', 100)], cards: [card('c1', 'd1', 100)] }),
    data({ tombstones: [tomb('d1', 'deck', 500)] })
  );
  eq(gone.data.decks.length, 0, 'удалённая колода не возвращается');
  eq(gone.data.cards.length, 1, 'её карточка остаётся в наборе');
  eq(gone.data.cards[0].deckId, null, 'и переезжает в раздел «без колоды»');
  eq(gone.stats.orphans, 1, 'переезд посчитан');
}

/* ============================================================
   5. Слияние: настройки
   ============================================================ */

section('Слияние: настройки по settingsUpdatedAt');
{
  const r = SY.merge(
    data({ settingsUpdatedAt: 100, settings: { theme: 'light', dailyGoal: 30 } }),
    data({ settingsUpdatedAt: 200, settings: { theme: 'dark' } })
  );
  eq(r.data.settings.theme, 'dark', 'побеждают более свежие настройки');
  eq(r.stats.settingsFrom, 'remote', 'источник настроек — облако');
  eq(r.data.settingsUpdatedAt, 200, 'отметка правки настроек взята у победителя');
  eq(r.data.settings.dailyGoal, undefined, 'настройки берутся у победителя целиком, а не по полям');

  const r2 = SY.merge(
    data({ settingsUpdatedAt: 300, settings: { theme: 'light' } }),
    data({ settingsUpdatedAt: 200, settings: { theme: 'dark' } })
  );
  eq(r2.data.settings.theme, 'light', 'свои свежие настройки не перетираются');
  eq(r2.stats.settingsFrom, 'local', 'источник настроек — это устройство');

  const r3 = SY.merge(
    data({ settingsUpdatedAt: 100, settings: { theme: 'light' } }),
    data({ settingsUpdatedAt: 100, settings: { theme: 'dark' } })
  );
  eq(r3.data.settings.theme, 'light', 'при равенстве остаются локальные настройки');
  eq(r3.stats.settingsFrom, 'local', 'источник — локальный');
}

section('Слияние: секреты устройства не переезжают');
{
  const local = data({
    settingsUpdatedAt: 100,
    settings: {
      theme: 'light',
      sync: { provider: 'gist', token: 'ghp_SECRETTOKEN', gistId: 'gist_secret_id', auto: true, lastAt: 42, lastError: '' },
      notify: { enabled: true, time: '19:00', onlyIfDue: true, lastShown: '2026-01-01' },
      ttsNet: { enabled: true, downloaded: 512 * 1024 }
    }
  });
  const remote = data({
    settingsUpdatedAt: 900,
    settings: {
      theme: 'dark',
      sync: { provider: 'gist', token: 'ghp_OTHERTOKEN', gistId: 'other_id', auto: false },
      notify: { enabled: false, time: '07:00' },
      ttsNet: { enabled: false, downloaded: 0 }
    }
  });

  const r = SY.merge(local, remote);
  eq(r.data.settings.theme, 'dark', 'настройки взяты из облака');
  eq(r.data.settings.sync.token, '', 'токен не переносится в результат слияния');
  eq(r.data.settings.sync.gistId, '', 'идентификатор гиста тоже не переносится');
  eq(r.data.settings.sync.auto, true, 'флаг автосинхронизации остаётся своим');
  eq(r.data.settings.sync.lastAt, 42, 'отметка последнего обмена остаётся своей');
  eq(r.data.settings.notify.enabled, true, 'напоминания — настройка устройства');
  eq(r.data.settings.notify.time, '19:00', 'расписание напоминаний не переезжает');
  /* Кэш озвучки лежит в браузере каждого устройства, поэтому и число
     скачанных байт, и само согласие «отдавать текст фраз на чужой сервис»
     остаются своими: иначе телефон показал бы чужие фразы при пустом кэше. */
  eq(r.data.settings.ttsNet.enabled, true, 'согласие на сетевую озвучку остаётся за устройством');
  eq(r.data.settings.ttsNet.downloaded, 512 * 1024, 'размер скачанной озвучки не переезжает');
  ok(JSON.stringify(r.data).indexOf('ghp_') < 0, 'ни один токен не попал в результат слияния');
  ok(JSON.stringify(r.data).indexOf('gist_secret_id') < 0, 'идентификатор гиста не попал в результат');
  ok(JSON.stringify(r.data).indexOf('other_id') < 0, 'чужой идентификатор гиста тоже отброшен');
}

/* ============================================================
   6. Слияние: чистая функция
   ============================================================ */

section('Слияние: функция чистая и детерминированная');
{
  const L = data({
    decks: [deck('d1', 10)], cards: [card('c1', 'd1', 10)],
    logs: [log('l1', 5, 'c1')], settings: { theme: 'light' }
  });
  const R = data({
    decks: [deck('d2', 20)], tombstones: [tomb('c9', 'card', 20)], settings: { theme: 'dark' }
  });

  const before = JSON.stringify(L) + '|' + JSON.stringify(R);
  const a = SY.merge(L, R);
  const b = SY.merge(L, R);

  eq(JSON.stringify(L) + '|' + JSON.stringify(R), before, 'входные данные не изменились');
  eq(JSON.stringify(a.data), JSON.stringify(b.data), 'одинаковые входы дают одинаковый результат');
  ok(a.data !== L && a.data !== R, 'возвращается новый объект данных');
  ok(a.data.decks[0] !== L.decks[0], 'записи копируются, а не переиспользуются');

  const c = SY.merge(R, L);
  eq(
    a.data.decks.map(d => d.id).sort().join(','),
    c.data.decks.map(d => d.id).sort().join(','),
    'состав записей не зависит от порядка сторон'
  );

  ok(SY.merge(null, null).data.decks.length === 0, 'пустые аргументы не ломают слияние');
  ok(SY.merge(undefined, undefined).data.logs.length === 0, 'отсутствующие аргументы не ломают слияние');
  ok(SY.merge(data({}), data({ decks: null, cards: null, logs: null, tombstones: null })).data.decks.length === 0,
    'битые поля вместо массивов не ломают слияние');
  ok(SY.merge(data({ decks: 'мусор' }), data({ decks: 42 })).data.decks.length === 0,
    'не-массивы игнорируются');
}

/* ============================================================
   7. Связка с хранилищем
   ============================================================ */

section('Слияние и хранилище');
{
  reset();
  const d = S.createDeck({ name: 'Своя колода' });
  const c = S.createCard({ deckId: d.id, word: 'alpha', translation: 'альфа' });

  const payload = S.syncPayload();
  ok(!('sync' in payload.settings), 'syncPayload не содержит блок sync');

  const merged = SY.merge(S.syncPayload(), data({}));
  eq(merged.data.decks.length, 1, 'слияние с пустым облаком сохраняет свои колоды');
  eq(merged.data.cards.length, 1, 'слияние с пустым облаком сохраняет свои карточки');

  S.applyMerged(merged.data);
  eq(S.get().decks.length, 1, 'applyMerged устанавливает результат');
  eq(S.get().cards.length, 1, 'карточки на месте');
  eq(S.get().cards[0].deckId, d.id, 'привязка карточки к колоде сохранилась');
  eq(S.get().cards[0].id, c.id, 'идентификаторы не перегенерированы');

  // секреты не уезжают в облако и не теряются при слиянии
  S.settings().sync.token = 'ghp_SECRETTOKEN';
  S.settings().sync.gistId = 'gist_secret_id';
  ok(JSON.stringify(S.syncPayload()).indexOf('ghp_SECRETTOKEN') < 0, 'syncPayload не содержит токен');
  ok(JSON.stringify(S.syncPayload()).indexOf('gist_secret_id') < 0, 'syncPayload не содержит идентификатор гиста');

  const after = SY.merge(S.syncPayload(), data({}));
  eq(after.data.settings.sync.token, '', 'в результате слияния токена нет');
  S.applyMerged(after.data);
  eq(S.settings().sync.token, 'ghp_SECRETTOKEN', 'applyMerged возвращает локальный токен');
  eq(S.settings().sync.gistId, 'gist_secret_id', 'applyMerged возвращает идентификатор гиста');
  eq(SY.isConfigured(), true, 'подключение остаётся рабочим после слияния');
}

/* ============================================================
   7b. Две стороны: удаление доходит до второго устройства
   ============================================================ */

section('Удаление на телефоне доходит до компьютера');
{
  reset();

  /* Компьютер создал колоду — она уехала в облако. */
  const pcDeck = S.createDeck({ name: 'Поездки' });
  S.createCard({ deckId: pcDeck.id, word: 'commute', translation: 'ездить' });
  S.createCard({ deckId: pcDeck.id, word: 'trip', translation: 'поездка' });

  const cloud = JSON.parse(JSON.stringify(S.syncPayload()));
  const pcCopy = JSON.parse(JSON.stringify(S.syncPayload()));
  eq(cloud.decks.length, 1, 'колода компьютера уехала в облако');
  eq(cloud.cards.length, 2, 'обе карточки тоже');

  /* Телефон подключился к тому же хранилищу и получил данные. */
  reset();
  S.applyMerged(JSON.parse(JSON.stringify(cloud)));
  eq(S.get().decks.length, 1, 'телефон получил колоду из облака');
  eq(S.get().cards.length, 2, 'и обе карточки');

  /* На телефоне колоду удаляют. */
  S.deleteDeck(pcDeck.id);
  S.flush();
  eq(S.get().decks.length, 0, 'на телефоне колода удалена');
  eq(S.get().cards.length, 0, 'и её карточки');
  ok(S.tombstones().some(t => t.id === pcDeck.id && t.kind === 'deck'),
    'удаление колоды записано надгробием');

  const fromPhone = S.syncPayload();
  eq(fromPhone.decks.length, 0, 'в облако колода больше не уходит');
  eq(fromPhone.tombstones.length, 3, 'уезжают надгробия колоды и двух карточек');

  /* Компьютер забирает данные из облака. */
  const merged = SY.merge(pcCopy, fromPhone);
  eq(merged.data.decks.length, 0, 'на компьютере колода тоже удалена');
  eq(merged.data.cards.length, 0, 'карточки не воскресли');
  eq(merged.stats.deleted, 3, 'посчитаны все три удаления');

  /* И обратно: компьютер не должен вернуть колоду в облако. */
  const back = SY.merge(fromPhone, merged.data);
  eq(back.data.decks.length, 0, 'повторное слияние не воскрешает колоду');
  ok(SY.merge(pcCopy, data({ tombstones: fromPhone.tombstones })).data.decks.length === 0,
    'удаление достаточно привезти одними надгробиями');
}

section('Удаление переживает только правку, сделанную после него');
{
  /* Колода не менялась после удаления (правка раньше удаления) — удаляем. */
  const deleted = SY.merge(
    data({ decks: [deck('d1', 500)] }),
    data({ tombstones: [tomb('d1', 'deck', 1000)] })
  );
  eq(deleted.data.decks.length, 0, 'колода, не менявшаяся после удаления, исчезает');
  eq(deleted.stats.deleted, 1, 'удаление посчитано');

  const edited = SY.merge(
    data({ decks: [deck('d1', 3000)] }),
    data({ tombstones: [tomb('d1', 'deck', 1000)] })
  );
  eq(edited.data.decks.length, 1, 'колода, изменённая ПОСЛЕ удаления, остаётся');
  eq(edited.stats.deleted, 0, 'и удалением это не считается');
}

section('Очистка данных доходит до облака');
{
  reset();
  S.updateSettings({
    sync: { provider: 'gist', token: 'ghp_KEEP', gistId: 'gKeep', auto: false, lastAt: 0, lastError: '' }
  });

  const deckA = S.createDeck({ name: 'Колода A' });
  S.createCard({ deckId: deckA.id, word: 'alpha', translation: 'альфа' });
  S.createCard({ deckId: deckA.id, word: 'beta', translation: 'бета' });
  const cardIds = S.get().cards.map(c => c.id);

  S.clearData();
  eq(S.get().decks.length, 0, 'колоды удалены');
  eq(S.get().cards.length, 0, 'карточки удалены');
  eq(S.get().logs.length, 0, 'журнал очищен');
  ok(S.tombstones().some(t => t.id === deckA.id && t.kind === 'deck'),
    'на колоду поставлено надгробие');
  ok(cardIds.every(id => S.tombstones().some(t => t.id === id && t.kind === 'card')),
    'на каждую карточку поставлено надгробие');
  eq(S.settings().sync.token, 'ghp_KEEP', 'токен синхронизации уцелел');
  eq(S.settings().sync.gistId, 'gKeep', 'адрес хранилища уцелел');
  eq(S.get().meta.seeded, true, 'демо-колоды повторно не приедут');

  /* Главное: облако тоже теряет данные, а не возвращает их обратно. */
  const cloudBefore = data({
    decks: [deck(deckA.id, 100)],
    cards: cardIds.map(id => card(id, deckA.id, 100))
  });
  const afterClear = SY.merge(cloudBefore, S.syncPayload());
  eq(afterClear.data.decks.length, 0, 'в облаке колода тоже удалена');
  eq(afterClear.data.cards.length, 0, 'и карточки');
}

section('Автосинхронизация: удаление отправляется срочно');
{
  const slow = SY.changeDelay('deck:create');
  ok(slow >= 500, 'создание колоды ждёт обычной задержки', slow);
  eq(SY.changeDelay('card:update'), slow, 'правка карточки — та же задержка');
  eq(SY.changeDelay(''), slow, 'без причины — обычная задержка');
  eq(SY.changeDelay(null), slow, 'пустая причина не ломает расчёт');
  eq(SY.changeDelay(undefined), slow, 'отсутствующая причина тоже');

  ok(SY.changeDelay('deck:delete') < slow, 'удаление колоды уходит быстрее обычной правки');
  ok(SY.changeDelay('card:delete') < slow, 'удаление карточки — тоже');
  ok(SY.changeDelay('cards:delete') < slow, 'массовое удаление — тоже');
  ok(SY.changeDelay('wipe') < slow, 'полная очистка — тоже');
  ok(SY.changeDelay('tombstones:clear') < slow, 'сброс надгробий — тоже');
  ok(SY.changeDelay('deck:delete') < 1000, 'и уж точно быстрее секунды');
}

section('Автосинхронизация: когда забирать чужие правки при возвращении');
{
  const R = SY.shouldSyncOnResume;

  ok(typeof R === 'function', 'решение о синхронизации при возвращении вынесено в функцию');
  eq(R({ dirty: true, awayMs: 0, sinceLastMs: 0 }), true, 'есть неотправленное — сначала отправляем');
  eq(R({ dirty: false, awayMs: 60000, sinceLastMs: 1000 }), true,
    'отсутствовали минуту — забираем чужие правки');
  eq(R({ dirty: false, awayMs: 5000, sinceLastMs: 1000 }), false,
    'отсутствовали пять секунд — сеть не дёргаем');
  eq(R({ dirty: false, awayMs: 5000, sinceLastMs: 10 * 60 * 1000 }), true,
    'давно не обменивались — забираем, даже если вернулись быстро');
  eq(R({ dirty: false, awayMs: Infinity, sinceLastMs: 0 }), true,
    'время отсутствия неизвестно — считаем, что давно');
  eq(R({ dirty: false }), true, 'без данных о времени лучше забрать, чем показать старое');
  eq(R({}), true, 'пустое состояние не ломает решение');
  eq(R(), true, 'отсутствующее состояние тоже');
  eq(R({ dirty: false, awayMs: 0, sinceLastMs: 0 }), false, 'мгновенное переключение вкладки ничего не стоит');
}

section('Реальное время: как часто спрашивать облако');
{
  const I = SY.autoInterval;

  ok(typeof I === 'function', 'интервал опроса вынесен в функцию');
  eq(I({ visible: true }), 2000, 'пока приложение на экране — обмен каждые 2 секунды');
  eq(I({ visible: false }), 60 * 1000, 'в фоне — минутный интервал');
  ok(I({ visible: true }) < 60 * 1000, 'на экране интервал меньше минуты: это и есть «реальное время»');
  ok(I({ visible: false }) > I({ visible: true }), 'в фоне опрашиваем реже, чем на экране');
  eq(I(), I({ visible: true }), 'без явного состояния считаем, что приложение на экране');
}

section('Реальное время: обновлять ли экран после чужих правок');
{
  const U = SY.shouldRefreshOnRemote;

  ok(typeof U === 'function', 'решение о перерисовке вынесено в функцию');
  eq(U({}), true, 'на обычном экране удаление с телефона видно сразу');
  eq(U({ inSession: true }), false, 'идущую тренировку не рвём: карточки уже в руках');
  eq(U({ modalOpen: true }), false, 'открытый диалог не закрываем');
  eq(U({ typing: true }), false, 'незаконченный ввод не выбрасываем');
  eq(U({ modalOpen: true, typing: true }), false, 'оба признака вместе — тоже нет');
  eq(U(), true, 'отсутствующее состояние не ломает решение');
}

section('Отпечаток данных: пришло ли из облака что-то новое');
{
  const sig = SY.dataSignature;
  const base = { decks: [{ id: 'd1', updatedAt: 10 }], cards: [{ id: 'c1', updatedAt: 20 }] };

  ok(typeof sig === 'function', 'отпечаток данных вынесен в функцию');
  eq(sig(base), sig({ decks: [{ id: 'd1', updatedAt: 10 }], cards: [{ id: 'c1', updatedAt: 20 }] }),
    'одинаковые данные дают одинаковый отпечаток');
  ok(sig(base) !== sig({ decks: [], cards: base.cards }), 'удаление колоду меняет отпечаток');
  ok(sig(base) !== sig({ decks: base.decks, cards: [] }), 'удаление карточки меняет отпечаток');
  ok(sig(base) !== sig({ decks: [{ id: 'd1', updatedAt: 11 }], cards: base.cards }),
    'правка записи меняет отпечаток');
  ok(sig(base) !== sig({ decks: base.decks.concat([{ id: 'd2', updatedAt: 30 }]), cards: base.cards }),
    'новая запись меняет отпечаток');
  eq(sig({ decks: [{ id: 'd2', updatedAt: 30 }, { id: 'd1', updatedAt: 10 }], cards: [] }),
    sig({ decks: [{ id: 'd1', updatedAt: 10 }, { id: 'd2', updatedAt: 30 }], cards: [] }),
    'порядок записей не важен');
  eq(sig(), sig({}), 'отсутствующие данные равны пустым');
  eq(sig({ decks: null, cards: null }), '', 'null вместо списков не ломает отпечаток');
}

/* ============================================================
   8. Состояние, подписка, конфигурация
   ============================================================ */

section('Состояние и подписка');
{
  reset();
  eq(SY.isConfigured(), false, 'без токена и гиста синхронизация не настроена');
  eq(SY.status().state, 'off', 'состояние — «не настроено»');
  eq(SY.status().at, 0, 'времени последнего обмена нет');
  eq(typeof SY.status().message, 'string', 'сообщение статуса — строка');

  let seen = 0;
  const off = SY.onChange(function () { seen++; });
  SY.configure({ provider: 'gist', token: 'ghp_x', gistId: 'g1' });
  eq(SY.isConfigured(), true, 'токен и гист сохранены');
  eq(SY.status().state, 'idle', 'настроенная синхронизация ждёт команды');
  eq(S.settings().sync.token, 'ghp_x', 'configure пишет токен в настройки');
  ok(seen > 0, 'подписчик получил смену статуса');

  const before = seen;
  off();
  SY.configure({ gistId: 'g2' });
  eq(seen, before, 'после отписки уведомления не приходят');
  eq(S.settings().sync.gistId, 'g2', 'configure обновляет идентификатор гиста');

  SY.disconnect();
  eq(SY.isConfigured(), false, 'disconnect снимает настройку');
  eq(S.settings().sync.token, '', 'disconnect очищает токен');
  eq(S.settings().sync.gistId, '', 'disconnect очищает идентификатор гиста');
  eq(S.settings().sync.provider, 'off', 'провайдер переключается в «выключено»');
  eq(SY.status().state, 'off', 'после отключения состояние — «не настроено»');

  SY.start();
  eq(S.settings().sync.auto, true, 'start включает автосинхронизацию');
  SY.stop();
  eq(S.settings().sync.auto, false, 'stop выключает автосинхронизацию');
  SY.disconnect();
}

/* ============================================================
   9. Панель настроек
   ============================================================ */

section('Панель синхронизации');
{
  ok(!!V && typeof V.panel === 'function', 'панель экспортируется');
  ok(typeof V.render === 'function', 'полноэкранная отрисовка экспортируется');

  const el = V.panel();
  eq(el.className, 'panel', 'панель собирается как .panel');
  ok(!!el.children.length, 'у панели есть содержимое');

  const texts = collectText(el).join(' | ');
  ok(texts.indexOf('Создать') >= 0, 'есть кнопка создания хранилища');
  ok(texts.indexOf('Подключиться к хранилищу') >= 0, 'есть кнопка подключения к чужому хранилищу');
  ok(texts.indexOf('Синхронизировать сейчас') >= 0, 'есть кнопка ручной синхронизации');
  ok(texts.indexOf('Отключить') >= 0, 'есть кнопка отключения');
  ok(texts.indexOf('Синхронизировать автоматически') >= 0, 'есть переключатель автосинхронизации');
  ok(texts.indexOf('Personal Access Token') >= 0, 'есть пояснение, какой токен нужен');
  ok(texts.indexOf('Код хранилища') >= 0, 'есть блок с кодом хранилища');
  ok(texts.indexOf('Не настроено') >= 0, 'виден текущий статус');
  ok(texts.indexOf('секретн') >= 0, 'сказано, что гист секретный, но открывается по ссылке');
  ok(texts.indexOf('api.github.com') >= 0, 'сказано, куда уходят данные');
  ok(texts.indexOf('Gist: read and write') >= 0, 'указано нужное право токена');
  ok(texts.indexOf('сливается с облачной') >= 0, 'объяснено, как разрешаются конфликты');
  ok(texts.indexOf('втором устройстве') >= 0, 'объяснено, где вводить код хранилища');

  /* Главное действие обязано быть видно сразу. Раньше токен и кнопка
     «Создать» лежали внутри свёрнутого <details>, и человек, открывший
     экран, не находил, с чего начать: ни кода приглашения, ни кнопки.
     Проверяем структурно — по дереву панели, а не по наличию текста,
     потому что текст в свёрнутом блоке тоже есть. */
  const folded = n => {
    let cur = n && n.parentNode;
    while (cur) {
      if (String(cur.className || '').indexOf('sync-manual') >= 0) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  const exact = (node, needle, out) => {
    out = out || [];
    if (!node) return out;
    if (node.textContent === needle) out.push(node);
    (node.children || []).forEach(c => exact(c, needle, out));
    return out;
  };
  const createBtns = exact(el, 'Создать', []);
  ok(createBtns.length > 0, 'нашёлся узел кнопки «Создать»');
  ok(createBtns.length === 0 || createBtns.every(n => !folded(n)),
      'кнопка «Создать» видна без раскрытия «подробностей»');
  const syncBtns = exact(el, 'Синхронизировать сейчас', []);
  ok(syncBtns.length === 0 || syncBtns.every(n => !folded(n)),
      'кнопка «Синхронизировать сейчас» видна без раскрытия «подробностей»');
  const offBtns = exact(el, 'Отключить', []);
  ok(offBtns.length === 0 || offBtns.every(n => !folded(n)),
      'кнопка «Отключить» видна без раскрытия «подробностей»');
  /* Поле токена проверяем через заголовок его секции: placeholder в
     харнессе не сохраняется (setAttribute — заглушка), зато дерево
     показывает, в каком блоке поле реально лежит. */
  const createHeads = exact(el, 'Подключить хранилище', []);
  ok(createHeads.length > 0, 'есть секция подключения хранилища с полем токена');
  ok(createHeads.length === 0 || createHeads.every(n => !folded(n)),
      'поле токена видно без раскрытия «подробностей»');

  const root = document.createElement('div');
  let thrown = null;
  try { V.render(root); } catch (e) { thrown = e; }
  eq(thrown, null, 'полноэкранная отрисовка не падает');
  const pageTexts = collectText(root).join(' | ');
  ok(pageTexts.indexOf('Синхронизация') >= 0, 'на странице есть заголовок');
  ok(pageTexts.indexOf('Синхронизировать сейчас') >= 0, 'на странице есть панель');
}

/* ============================================================
   10. Сеть: заглушка вместо GitHub
   ============================================================ */

section('Сеть: подключение, обмен и ошибки');

const calls = [];
/* id колоды, удалённой в проверке срочной отправки: нужен в следующем шаге цепочки. */
let doomedId = '';

function jsonResponse(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    text: function () { return Promise.resolve(JSON.stringify(obj)); }
  };
}

/** Ответ с ETag — как у настоящего GitHub: при следующем условном запросе можно ответить 304. */
function etagResponse(status, obj, etag) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: { get: function (name) { return /etag/i.test(name) ? etag : null; } },
    text: function () { return Promise.resolve(JSON.stringify(obj)); }
  };
}

/** 304 Not Modified: облако не менялось, тела ответа нет. */
function notModified() {
  return {
    ok: false,
    status: 304,
    headers: { get: function () { return null; } },
    text: function () { return Promise.resolve(''); }
  };
}

function installFetch(routes) {
  const stub = function (url, init) {
    const method = (init && init.method) || 'GET';
    const key = method + ' ' + url.replace('https://api.github.com', '');
    calls.push({ key: key, init: init || {} });
    const route = routes[key];
    if (!route) return Promise.resolve(jsonResponse(404, { message: 'Not Found' }));
    if (typeof route === 'function') return route(url, init);
    return Promise.resolve(route);
  };
  global.fetch = stub;
  // на случай, если встроенный fetch объявлен не записываемым
  if (global.fetch !== stub) {
    Object.defineProperty(global, 'fetch', { value: stub, writable: true, configurable: true });
  }
  return stub;
}

function bodyOf(index) { return JSON.parse(calls[index].init.body); }
/** Содержимое файла гиста из тела запроса. */
function payloadOf(index) { return JSON.parse(bodyOf(index).files['lexiflow.json'].content); }

function finish() {
  console.log('\n' + '─'.repeat(52));
  console.log(fail === 0
    ? `ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${pass}`
    : `ПРОЙДЕНО ${pass}, ПРОВАЛЕНО ${fail}`);
  console.log('─'.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
}

reset();

const stub = installFetch({
  'GET /user': jsonResponse(200, { login: 'octocat' }),
  'POST /gists': jsonResponse(201, { id: 'gist123' })
});
ok(global.fetch === stub, 'заглушка сети установлена (наружу ничего не уходит)');

SY.connect('ghp_TESTTOKEN')
  .then(function (res) {
    eq(res.ok, true, 'рабочий токен принимается');
    eq(res.gistId, 'gist123', 'идентификатор созданного гиста сохранён');
    eq(res.login, 'octocat', 'имя пользователя вернулось');
    eq(SY.isConfigured(), true, 'подключение сохранено');
    eq(S.settings().sync.token, 'ghp_TESTTOKEN', 'токен сохранён на устройстве');
    eq(S.settings().sync.provider, 'gist', 'провайдер переключён на gist');
    eq(SY.status().state, 'idle', 'после подключения статус — «готово»');
    eq(calls.length, 2, 'сделано ровно два запроса');
    eq(calls[0].key, 'GET /user', 'сначала токен проверяется');
    eq(calls[1].key, 'POST /gists', 'затем создаётся хранилище');

    const body = bodyOf(1);
    eq(body.public, false, 'гист создаётся секретным');
    eq(body.description, 'LexiFlow sync', 'у гиста понятное описание');
    ok(!!body.files['lexiflow.json'], 'данные лежат в файле lexiflow.json');
    ok(body.files['lexiflow.json'].content.indexOf('ghp_TESTTOKEN') < 0, 'токен не уезжает в гист');
    ok(JSON.stringify(body).indexOf('ghp_TESTTOKEN') < 0, 'токена нет нигде в теле запроса');
    eq(calls[1].init.headers['Authorization'], 'Bearer ghp_TESTTOKEN', 'токен передаётся только в заголовке');
    eq(calls[1].init.headers['X-GitHub-Api-Version'], '2022-11-28', 'версия API указана');
    eq(calls[1].init.headers['Accept'], 'application/vnd.github+json', 'запрошен формат GitHub');
    eq(calls[1].init.headers['Content-Type'], 'application/json', 'тип тела запроса указан');
  })

  .then(function () {
    // локальная правка, которую нужно слить с облаком
    const localDeck = S.createDeck({ name: 'Локальная' });
    S.createCard({ deckId: localDeck.id, word: 'local', translation: 'своё' });

    const remote = {
      version: 1,
      decks: [deck('remote-deck', 1, { name: 'Из облака' })],
      cards: [card('remote-card', 'remote-deck', 1, { word: 'remote', translation: 'чужое' })],
      logs: [],
      tombstones: [],
      settingsUpdatedAt: 0,
      settings: { theme: 'auto' }
    };

    installFetch({
      'GET /gists/gist123': jsonResponse(200, {
        id: 'gist123',
        files: { 'lexiflow.json': { content: JSON.stringify(remote) } }
      }),
      'PATCH /gists/gist123': jsonResponse(200, { id: 'gist123' })
    });
    calls.length = 0;
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, true, 'обмен с облаком проходит');
    eq(calls[0].key, 'GET /gists/gist123', 'сначала читаем облако');
    eq(calls[1].key, 'PATCH /gists/gist123', 'затем пишем обратно');
    eq(res.stats.decksAdded, 1, 'чужая колода посчитана как добавленная');
    eq(res.stats.cardsAdded, 1, 'чужая карточка посчитана как добавленная');
    eq(res.stats.deleted, 0, 'удалений не было');
    eq(res.stats.settingsFrom, 'local', 'настройки остались локальными');
    ok(S.getDeck('remote-deck') !== null, 'колода из облака появилась локально');
    ok(S.getCard('remote-card') !== null, 'карточка из облака появилась локально');
    eq(S.get().decks.length, 2, 'своя колода не потерялась');
    eq(S.get().cards.length, 2, 'своя карточка не потерялась');

    const sent = payloadOf(1);
    eq(sent.decks.length, 2, 'в облако уходит объединённый набор');
    ok(JSON.stringify(sent).indexOf('ghp_TESTTOKEN') < 0, 'токен не уходит в гист при обмене');
    ok(!sent.settings.sync || !sent.settings.sync.token, 'блок sync не уезжает в облако');
    ok(JSON.stringify(sent).indexOf('gist123') < 0, 'идентификатор гиста не уезжает в файл');

    eq(SY.status().state, 'ok', 'после обмена статус — «синхронизировано»');
    ok(SY.status().at > 0, 'отметка времени обмена заполнена');
    ok(S.settings().sync.lastAt > 0, 'время обмена сохранено в настройках');
    eq(S.settings().sync.lastError, '', 'ошибок нет');
    eq(SY.isConfigured(), true, 'подключение пережило слияние');
  })

  .then(function () {
    installFetch({ 'GET /gists/gist123': jsonResponse(401, { message: 'Bad credentials' }) });
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, false, 'ошибка авторизации не считается успехом');
    ok(res.error.indexOf('401') >= 0, 'в сообщении есть код 401');
    ok(/токен/i.test(res.error), 'сообщение объясняет проблему с токеном');
    ok(res.error.indexOf('ghp_TESTTOKEN') < 0, 'токен не попадает в текст ошибки');
    eq(SY.status().state, 'error', 'статус переходит в «ошибка»');
    eq(S.settings().sync.lastError, res.error, 'ошибка запоминается в настройках');
    eq(SY.isConfigured(), true, 'при ошибке токен не выбрасывается');
  })

  .then(function () {
    installFetch({ 'GET /gists/gist123': jsonResponse(403, { message: 'rate limit' }) });
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, false, 'отказ в доступе не считается успехом');
    ok(res.error.indexOf('403') >= 0, 'код 403 отличается от 401');
    ok(/Gist|лимит/i.test(res.error), 'сказано про право Gist или лимит запросов');
    eq(SY.status().message, res.error, 'сообщение статуса совпадает с ошибкой');
  })

  .then(function () {
    installFetch({
      'GET /gists/gist123': function () { return Promise.reject(new Error('network down')); }
    });
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, false, 'обрыв связи не считается успехом');
    ok(/связаться|соединение/i.test(res.error), 'сообщение про связь отличается от ответа GitHub');
    ok(!/401|403/.test(res.error), 'сообщение про связь не путается с кодами GitHub');
    eq(SY.status().state, 'error', 'статус — ошибка');
  })

  .then(function () {
    // нерабочий токен не должен сохраниться в настройках
    reset();
    installFetch({ 'GET /user': jsonResponse(401, { message: 'Bad credentials' }) });
    calls.length = 0;
    return SY.connect('ghp_BADTOKEN');
  })
  .then(function (res) {
    eq(res.ok, false, 'нерабочий токен не принимается');
    eq(SY.isConfigured(), false, 'нерабочий токен не сохраняется');
    eq(S.settings().sync.token, '', 'токен не попал в настройки');
    eq(S.settings().sync.gistId, '', 'гист не создавался');
    eq(SY.status().state, 'off', 'без сохранённого токена состояние — «не настроено»');
    ok(S.settings().sync.lastError.indexOf('401') >= 0, 'причина отказа записана в настройки');
    eq(calls.length, 1, 'после отказа гист не создаётся');
    ok(res.error.indexOf('ghp_BADTOKEN') < 0, 'токен не попадает в текст ошибки');
    ok(collectText(V.panel()).join(' | ').indexOf('Прошлая попытка не удалась') >= 0,
      'панель показывает причину прошлой неудачи');
    return SY.connect('');
  })
  .then(function (res) {
    eq(res.ok, false, 'пустой токен не принимается');
    ok(typeof res.error === 'string' && res.error.length > 0, 'есть понятное сообщение');
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, false, 'без настройки ручная синхронизация не выполняется');
    eq(res.error, 'Синхронизация не настроена.', 'сообщение объясняет причину');
    eq(SY.status().state, 'off', 'состояние остаётся «не настроено»');
  })

  /* ---------- Подключение к чужому хранилищу по коду ---------- */

  .then(function () {
    section('Сеть: подключение к хранилищу по коду');

    /* Второе устройство обязано попасть в ТОТ ЖЕ гист. Без кода оно
       завело бы своё хранилище: ошибок нет, статус «подключено», а данные
       двух устройств не встретились бы никогда. */
    reset();
    const remote = data({
      decks: [deck('join-deck', 5, { name: 'Из общего хранилища' })],
      cards: [card('join-card', 'join-deck', 5, { word: 'shared', translation: 'общее' })],
      settingsUpdatedAt: 0,
      settings: { theme: 'auto' }
    });

    installFetch({
      'GET /user': jsonResponse(200, { login: 'octocat' }),
      'GET /gists/JOINCODE1': jsonResponse(200, {
        id: 'JOINCODE1',
        files: { 'lexiflow.json': { content: JSON.stringify(remote) } }
      }),
      'PATCH /gists/JOINCODE1': jsonResponse(200, { id: 'JOINCODE1' })
    });
    calls.length = 0;
    return SY.join('ghp_JOINTOKEN', 'JOINCODE1');
  })
  .then(function (res) {
    eq(res.ok, true, 'подключение по коду проходит');
    eq(res.gistId, 'JOINCODE1', 'использован указанный код, а не создан новый гист');
    eq(res.login, 'octocat', 'имя пользователя вернулось');
    eq(SY.isConfigured(), true, 'подключение сохранено');
    eq(S.settings().sync.gistId, 'JOINCODE1', 'в настройках именно чужой код хранилища');
    eq(S.settings().sync.token, 'ghp_JOINTOKEN', 'токен сохранён на этом устройстве');
    eq(S.settings().sync.provider, 'gist', 'провайдер переключён на gist');
    eq(S.settings().sync.lastError, '', 'ошибок не осталось');
    eq(calls[0].key, 'GET /user', 'сначала проверяется токен');
    eq(calls[1].key, 'GET /gists/JOINCODE1', 'затем проверяется код хранилища');
    ok(calls.every(c => c.key !== 'POST /gists'), 'новое хранилище не создаётся');
    ok(S.getDeck('join-deck') !== null, 'колода из общего хранилища появилась локально');
    ok(S.getCard('join-card') !== null, 'карточка из общего хранилища появилась локально');
    eq(SY.status().state, 'ok', 'данные забраны сразу при подключении, а не позже');
    ok(calls.length >= 4, 'после проверки кода данные читаются и отправляются обратно');
    ok(JSON.stringify(calls.map(c => (c.init || {}).body)).indexOf('ghp_JOINTOKEN') < 0,
      'токен не уходит в тело ни одного запроса');
  })

  .then(function () {
    reset();
    installFetch({ 'GET /user': jsonResponse(200, { login: 'octocat' }) });
    calls.length = 0;
    return SY.join('ghp_JOINTOKEN', 'NOSUCHCODE');
  })
  .then(function (res) {
    eq(res.ok, false, 'несуществующий код не принимается');
    ok(/не найдено/i.test(res.error), 'сообщение объясняет, что хранилища нет');
    ok(/код/i.test(res.error), 'сообщение подсказывает проверить код');
    ok(res.error.indexOf('ghp_JOINTOKEN') < 0, 'токен не попадает в текст ошибки');
    eq(SY.isConfigured(), false, 'неудачное подключение ничего не сохраняет');
    eq(S.settings().sync.gistId, '', 'чужой код не записан в настройки');
    eq(S.settings().sync.token, '', 'токен не записан в настройки');
    eq(SY.status().state, 'off', 'состояние — «не настроено»');
    eq(calls.length, 2, 'после отказа данные не читаются и не пишутся');
    ok(calls.every(c => c.key !== 'POST /gists'), 'при отказе новый гист не создаётся');
    return SY.join('', 'JOINCODE1');
  })
  .then(function (res) {
    eq(res.ok, false, 'пустой токен не принимается при подключении по коду');
    ok(/токен/i.test(res.error), 'сообщение просит токен');
    return SY.join('ghp_JOINTOKEN', '');
  })
  .then(function (res) {
    eq(res.ok, false, 'пустой код хранилища не принимается');
    ok(/код/i.test(res.error), 'сообщение просит код хранилища');
    eq(SY.isConfigured(), false, 'неполные данные ничего не настраивают');
  })

  /* ---------- Код приглашения: подключение вторым устройством в один шаг ---------- */

  .then(function () {
    section('Приглашение: код несёт токен и адрес хранилища');

    reset();
    eq(SY.inviteCode(), '', 'без настройки приглашения не выдаётся');

    SY.configure({ provider: 'gist', token: 'ghp_TESTTOKEN123', gistId: 'INVITECODE1', auto: false });
    var code = SY.inviteCode();
    ok(/^LF2-/.test(code), 'код начинается с LF2-');

    var parsed = SY.inviteParse(code);
    ok(parsed !== null, 'код разбирается');
    eq(parsed.token, 'ghp_TESTTOKEN123', 'токен извлечён из кода');
    eq(parsed.gistId, 'INVITECODE1', 'адрес хранилища извлечён из кода');

    var loose = SY.inviteParse(code.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' '));
    ok(loose !== null, 'регистр, дефисы и пробелы не мешают');
    eq(loose && loose.token, 'ghp_TESTTOKEN123', 'в «испорченном» виде тот же токен');

    var broken = code.slice(0, -1) + (code.slice(-1) === 'A' ? 'B' : 'A');
    eq(SY.inviteParse(broken), null, 'опечатка в последнем символе ломает код');

    var brokenMid = code.replace(code[10], code[10] === 'A' ? 'B' : 'A');
    eq(SY.inviteParse(brokenMid), null, 'опечатка в середине ломает код');

    eq(SY.inviteParse(''), null, 'пустая строка — не приглашение');
    eq(SY.inviteParse('ghp_TESTTOKEN123'), null, 'сырой токен — не приглашение');
    eq(SY.inviteParse('LF2-КОРОТКО'), null, 'слишком короткий код — не приглашение');
    eq(SY.inviteParse('LF2-' + 'A'.repeat(200)), null, 'мусорная строка — не приглашение');

    /* Код не должен утекать в облако: он существует только в момент показа. */
    var payload = JSON.stringify(S.syncPayload());
    ok(payload.indexOf(code) < 0, 'код приглашения не попадает в данные для облака');

    reset();
    return null;
  })

  .then(function () {
    section('Приглашение: подключение по коду идёт через обычный путь');
    const remote = data({
      decks: [deck('inv-deck', 5, { name: 'Из приглашения' })],
      settingsUpdatedAt: 0
    });
    installFetch({
      'GET /user': jsonResponse(200, { login: 'octocat' }),
      'GET /gists/INVITECODE1': jsonResponse(200, {
        id: 'INVITECODE1',
        files: { 'lexiflow.json': { content: JSON.stringify(remote) } }
      }),
      'PATCH /gists/INVITECODE1': jsonResponse(200, { id: 'INVITECODE1' })
    });
    SY.configure({ provider: 'gist', token: 'ghp_TESTTOKEN123', gistId: 'INVITECODE1', auto: false });
    calls.length = 0;
    return SY.joinInvite('lf2-привет');
  })
  .then(function (res) {
    eq(res.ok, false, 'неразобранный код не лезет в сеть');
    eq(calls.length, 0, 'ни одного запроса к GitHub');
    return SY.disconnect();
  })

  .then(function () {
    reset();
    SY.configure({ provider: 'gist', token: 'ghp_TESTTOKEN123', gistId: 'INVITECODE1', auto: false });
    var code = SY.inviteCode();
    ok(code.length > 0, 'код приглашения выдаётся');
    const remote = data({
      decks: [deck('inv2-deck', 5, { name: 'Через приглашение' })],
      settingsUpdatedAt: 0
    });
    installFetch({
      'GET /user': jsonResponse(200, { login: 'octocat' }),
      'GET /gists/INVITECODE1': jsonResponse(200, {
        id: 'INVITECODE1',
        files: { 'lexiflow.json': { content: JSON.stringify(remote) } }
      }),
      'PATCH /gists/INVITECODE1': jsonResponse(200, { id: 'INVITECODE1' })
    });
    calls.length = 0;
    return SY.joinInvite(code);
  })
  .then(function (res) {
    eq(res.ok, true, 'по правильному коду подключение проходит');
    eq(res.gistId, 'INVITECODE1', 'использован адрес из кода приглашения');
    eq(S.settings().sync.gistId, 'INVITECODE1', 'настройки сохранили нужное хранилище');
    eq(S.getDeck('inv2-deck') !== null, true, 'данные из хранилища достались сразу');
    eq(calls[0].key, 'GET /user', 'сначала проверяется токен из кода');
    eq(calls[1].key, 'GET /gists/INVITECODE1', 'затем проверяется адрес хранилища');
    ok(JSON.stringify(calls.map(c => (c.init || {}).body)).indexOf('ghp_TESTTOKEN123') < 0,
      'токен не уходит в тело запросов');
  })

  /* ---------- Неотправленные правки и срочное удаление ---------- */

  .then(function () {
    section('Автосинхронизация: неотправленные правки уходят сразу');
    reset();
    installFetch({
      'GET /gists/gistAUTO': jsonResponse(200, {
        id: 'gistAUTO',
        files: { 'lexiflow.json': { content: JSON.stringify(data({})) } }
      }),
      'PATCH /gists/gistAUTO': jsonResponse(200, { id: 'gistAUTO' })
    });
    SY.configure({ provider: 'gist', token: 'ghp_AUTO', gistId: 'gistAUTO', auto: true });

    eq(SY.pending(), false, 'сразу после настройки отправлять нечего');

    S.createDeck({ name: 'Обычная колода' });
    eq(SY.pending(), true, 'правка помечена как неотправленная');

    calls.length = 0;
    eq(SY.flushPending(), true, 'неотправленное отправляется принудительно');
    return wait(150);
  })
  .then(function () {
    ok(calls.some(c => c.key === 'PATCH /gists/gistAUTO'), 'запрос на запись ушёл');
    const patch = calls.filter(c => c.key === 'PATCH /gists/gistAUTO')[0];
    eq(patch.init.keepalive, true, 'запрос помечен keepalive — доживёт до закрытия страницы');
    eq(SY.pending(), false, 'после успешной отправки неотправленного не осталось');
  })

  .then(function () {
    /* Удаление обязано уехать заметно быстрее обычной правки. Именно на этом
       ломалось: таймер на пять секунд замирал вместе с фоновой вкладкой на
       телефоне, надгробие оставалось на устройстве, и колода жила дальше. */
    doomedId = S.createDeck({ name: 'Удаляемая колода' }).id;
    calls.length = 0;
    S.deleteDeck(doomedId);
    return wait(900);
  })
  .then(function () {
    ok(calls.some(c => c.key === 'PATCH /gists/gistAUTO'),
      'удаление уехало в облако меньше чем за секунду (обычная правка ждёт полторы)');
    const patch = calls.filter(c => c.key === 'PATCH /gists/gistAUTO')[0];
    const sent = JSON.parse(patch.init.body).files['lexiflow.json'].content;
    ok(sent.indexOf('"kind":"deck"') >= 0, 'в облако ушло надгробие удалённой колоды');
    ok(sent.indexOf(doomedId) >= 0, 'именно эта колода и помечена удалённой');
    eq(SY.pending(), false, 'после отправки неотправленного не осталось');

    /* Пока связи нет, правка не теряется — она остаётся ждать следующей попытки. */
    installFetch({
      'GET /gists/gistAUTO': function () { return Promise.reject(new Error('network down')); }
    });
    S.createDeck({ name: 'Пока офлайн' });
    SY.flushPending();
    return wait(150);
  })
  .then(function () {
    eq(SY.pending(), true, 'при обрыве связи правка остаётся неотправленной');
    eq(SY.status().state, 'error', 'состояние переходит в «ошибка»');
    eq(SY.isConfigured(), true, 'подключение при этом не теряется');
    SY.stop();
  })

  /* ---------- Уход в фон и возвращение ---------- */

  .then(function () {
    section('Автосинхронизация: уход в фон и возвращение в приложение');
    reset();
    installFetch({
      'GET /gists/gistVIS': jsonResponse(200, {
        id: 'gistVIS',
        files: { 'lexiflow.json': { content: JSON.stringify(data({})) } }
      }),
      'PATCH /gists/gistVIS': jsonResponse(200, { id: 'gistVIS' })
    });
    SY.configure({ provider: 'gist', token: 'ghp_VIS', gistId: 'gistVIS', auto: true });
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, true, 'первый обмен прошёл');
    eq(SY.pending(), false, 'после обмена отправлять нечего');

    /* Короткое отсутствие: возвращаемся сразу, сеть не дёргаем. */
    calls.length = 0;
    global.document.visibilityState = 'hidden';
    global.document.fire('visibilitychange');
    global.document.visibilityState = 'visible';
    global.document.fire('visibilitychange');
    return wait(80);
  })
  .then(function () {
    eq(calls.length, 0, 'после короткого отсутствия запросов нет');

    /* Отсутствие дольше порога: чужие правки надо забрать.
       Время сдвигаем подменой Date.now — ждать минуту в тесте нельзя. */
    calls.length = 0;
    const realNow = Date.now;
    global.document.visibilityState = 'hidden';
    global.document.fire('visibilitychange');
    const leftAt = realNow();
    Date.now = function () { return leftAt + 60000; };
    global.document.visibilityState = 'visible';
    global.document.fire('visibilitychange');
    Date.now = realNow;
    return wait(120);
  })
  .then(function () {
    ok(calls.some(c => c.key === 'GET /gists/gistVIS'),
      'после долгого отсутствия данные из облака забираются');
    ok(calls.some(c => c.key === 'PATCH /gists/gistVIS'),
      'и объединённый результат уходит обратно: в этом сценарии облако отстаёт от устройства');
    SY.stop();
  })

  /* ---------- Обмен без изменений не пишет в гист ---------- */

  .then(function () {
    section('Обмен: пустой тик не переписывает гист');
    reset();
    /* Стаб с памятью: GET отдаёт ровно то, что последний раз записал PATCH.
       Без этого проверка «второй тик не пишет» бессмысленна — облако всегда
       возвращало бы одну и ту же старую копию. */
    let cloud = JSON.stringify(data({}));
    installFetch({
      'GET /gists/gistIDLE': function () {
        return Promise.resolve(jsonResponse(200, {
          id: 'gistIDLE',
          files: { 'lexiflow.json': { content: cloud } }
        }));
      },
      'PATCH /gists/gistIDLE': function (url, init) {
        cloud = JSON.parse(init.body).files['lexiflow.json'].content;
        return Promise.resolve(jsonResponse(200, { id: 'gistIDLE' }));
      }
    });
    SY.configure({ provider: 'gist', token: 'ghp_IDLE', gistId: 'gistIDLE', auto: true });
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, true, 'первый обмен прошёл');
    eq(SY.pending(), false, 'отправлять нечего');
    /* Первый обмен отличается от облака (пустые данные против наших двух колод) —
       поэтому запись здесь обязательна. */
    ok(calls.some(c => c.key === 'PATCH /gists/gistIDLE'), 'первый обмен записал облако');
  })
  .then(function () {
    /* Теперь в гисте лежит ровно наша копия. Опрос раз в пять секунд не должен
       перезаписывать её тем же содержимым: двойной расход лимитов и записи
       в гист, которых никто не просил. */
    calls.length = 0;
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, true, 'обмен без изменений — это успех, а не ошибка');
    ok(calls.some(c => c.key === 'GET /gists/gistIDLE'), 'облако прочитано');
    ok(!calls.some(c => c.key === 'PATCH /gists/gistIDLE'),
      'но в гист не написано: содержимое совпадает байт в байт');
    eq(SY.status().state, 'ok', 'состояние остаётся «синхронизировано»');
  })
  .then(function () {
    /* Правка снова разделяет копии — запись обязана вернуться. */
    calls.length = 0;
    S.createDeck({ name: 'Новая колода после тика' });
    return SY.now();
  })
  .then(function () {
    ok(calls.some(c => c.key === 'PATCH /gists/gistIDLE'),
      'появилась правка — запись в облако снова происходит');
    eq(SY.pending(), false, 'и после записи отправлять нечего');
    SY.stop();
  })

  /* ---------- Условные запросы: 304 ---------- */

  .then(function () {
    section('Обмен: 304 — облако не менялось');
    reset();
    /* Стаб с памятью и «версиями» облака: ETag растёт с каждой записью.
       Условный запрос с актуальным ETag получает 304 — как у GitHub. */
    let cloud = JSON.stringify(data({}));
    let etag = '"gist-v0"';
    installFetch({
      'GET /gists/gist304': function (url, init) {
        const sent = init && init.headers ? init.headers['If-None-Match'] : '';
        if (sent && sent === etag) return Promise.resolve(notModified());
        return Promise.resolve(etagResponse(200, {
          id: 'gist304',
          files: { 'lexiflow.json': { content: cloud } }
        }, etag));
      },
      'PATCH /gists/gist304': function (url, init) {
        cloud = JSON.parse(init.body).files['lexiflow.json'].content;
        etag = '"gist-v' + (parseInt(etag.replace(/\D/g, ''), 10) + 1) + '"';
        return Promise.resolve(etagResponse(200, { id: 'gist304' }, etag));
      }
    });
    SY.configure({ provider: 'gist', token: 'ghp_304', gistId: 'gist304', auto: true });
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, true, 'первый обмен прошёл');
    eq(SY.pending(), false, 'отправлять нечего');
    /* Первый обмен отличается от облака — запись обязательна. */
    ok(calls.some(c => c.key === 'PATCH /gists/gist304'), 'первый обмен записал облако');
  })
  .then(function () {
    /* Второе чтение: своя же запись изменила облако, поэтому 200 —
       и перезапись тем же содержимым не нужна (путь lastWritten). */
    calls.length = 0;
    return SY.now();
  })
  .then(function () {
    ok(calls.some(c => c.key === 'GET /gists/gist304'), 'облако прочитано');
    ok(!calls.some(c => c.key === 'PATCH /gists/gist304'), 'перезаписи тем же содержимым нет');
  })
  .then(function () {
    /* Третье чтение: с прошлого раза облако не менялось — приходит 304.
       Слияние не нужно, писать не нужно: тик состоит из одного чтения. */
    calls.length = 0;
    return SY.now();
  })
  .then(function (res) {
    eq(res.ok, true, '304 — это успешный обмен, а не ошибка');
    eq(SY.status().state, 'ok', 'состояние «синхронизировано»');
    ok(calls.some(c => c.key === 'GET /gists/gist304'), 'чтение было');
    ok(!calls.some(c => c.key === 'PATCH /gists/gist304'), 'записи не было вовсе');
    const lastGet = calls.filter(c => c.key === 'GET /gists/gist304').pop();
    ok(lastGet.init.headers['If-None-Match'], 'запрос ушёл условным — с If-None-Match');
  })
  .then(function () {
    /* Правка при 304: облако не менялось, но наши правки в него не уехали —
       запись обязана состояться. */
    calls.length = 0;
    S.createDeck({ name: 'Колода после 304' });
    return SY.now();
  })
  .then(function () {
    ok(calls.some(c => c.key === 'PATCH /gists/gist304'),
      'есть неотправленные правки — запись происходит даже при 304');
    eq(SY.pending(), false, 'после записи отправлять нечего');
    SY.stop();
  })

  .then(function () {
    finish();
  })
  .catch(function (e) {
    fail++;
    console.log('  ✗ необработанная ошибка в асинхронной части: ' + (e && e.stack || e));
    finish();
  });

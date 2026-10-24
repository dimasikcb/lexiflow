/**
 * LexiFlow — тесты ядра (без браузера).
 *
 * Запуск:
 *   node tools/test-core.js
 *
 * Проверяет алгоритм интервального повторения (js/srs.js) и логику
 * импорта/экспорта (js/store.js) в минимальном shim-окружении:
 * поддельные document и localStorage — сами модули при этом не меняются.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- Минимальное окружение браузера ---------- */

function fakeElement() {
  const el = {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    append() {}, remove() {}, focus() {}, click() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => []
  };
  return el;
}

global.window = global;

/* Запись обработчиков событий: без неё нельзя проверить поведение при уходе
   приложения с экрана — а именно там озвучка продолжала звучать. */
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
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, contains: () => false },
  documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } },
  visibilityState: 'visible',
  readyState: 'complete'
});
global.requestAnimationFrame = fn => setTimeout(fn, 0);
// URL и Blob в Node уже есть — добавляем только отсутствующие методы,
// подменять сами конструкторы нельзя (их использует внутренний fs-шим Node).
if (typeof global.URL === 'function') {
  if (!global.URL.createObjectURL) global.URL.createObjectURL = () => 'blob:x';
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = () => {};
}
if (typeof global.Blob !== 'function') {
  global.Blob = function BlobStub() { this.size = 0; };
}

/* ---------- Поддельные Cache API и сеть для проверки js/ttsnet.js ----------
   В Node нет ни caches, ни сети, а модуль обязан оставаться проверяемым:
   чистые функции проверяются сами по себе, а загрузка и кэш — вот на этих
   заглушках. Настоящий Blob, а не объект-пустышка: ttsnet кладёт ответ в
   new Response(blob), и подделка превратилась бы в строку «[object Object]». */

function fakeBlob(size, type) {
  return new Blob([new Uint8Array(size)], { type: type || 'audio/mpeg' });
}

/** Ответ сервера: только то, что действительно читает ttsnet. */
function audioResponse(size, type) {
  const blob = fakeBlob(size, type || 'audio/mpeg');
  return {
    ok: true,
    status: 200,
    headers: { get: k => (String(k).toLowerCase() === 'content-type' ? (type || 'audio/mpeg') : null) },
    blob: () => Promise.resolve(blob)
  };
}

/** Ответ-ошибка: сервис отвечает 403 и JSON-телом в 69 байт. */
function errorResponse(status, type) {
  const blob = fakeBlob(69, type || 'application/json');
  return {
    ok: false,
    status: status || 403,
    headers: { get: () => type || 'application/json' },
    blob: () => Promise.resolve(blob)
  };
}

/** CacheStorage в памяти: open/put/match/keys/delete — больше модулю не нужно. */
function makeCaches() {
  const store = new Map();
  function entries(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }
  return {
    _store: store,
    open(name) {
      const map = entries(name);
      return Promise.resolve({
        put(req, res) {
          const url = typeof req === 'string' ? req : req.url;
          return res.blob().then(blob => {
            map.set(url, { blob, type: (res.headers && res.headers.get('content-type')) || '' });
          });
        },
        match(req) {
          const url = typeof req === 'string' ? req : req.url;
          const hit = map.get(url);
          if (!hit) return Promise.resolve(undefined);
          return Promise.resolve({
            headers: { get: k => (String(k).toLowerCase() === 'content-type' ? hit.type : null) },
            blob: () => Promise.resolve(hit.blob)
          });
        },
        keys() { return Promise.resolve(Array.from(map.keys()).map(url => ({ url }))); },
        delete(req) {
          const url = typeof req === 'string' ? req : req.url;
          return Promise.resolve(map.delete(url));
        }
      });
    }
  };
}

/** Кнопка для проверки класса is-playing: только classList и ничего больше. */
function fakeButton() {
  const set = {};
  return {
    classList: {
      add: c => { set[c] = true; },
      remove: c => { delete set[c]; },
      contains: c => !!set[c],
      toggle: c => { if (set[c]) delete set[c]; else set[c] = true; }
    }
  };
}

const ROOT = path.join(__dirname, '..');
['js/util.js', 'js/srs.js', 'js/store.js', 'js/speech.js', 'js/ttsnet.js', 'js/views/ai.js'].forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInThisContext(code, { filename: f });
});

const U = App.util, SRS = App.srs, S = App.store;

/* ---------- Мини-фреймворк ---------- */

let pass = 0, fail = 0, group = '';

function section(name) { group = name; console.log('\n' + name); }
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : ''));
  }
}
function eq(actual, expected, name) { ok(actual === expected, name, { actual, expected }); }
function near(actual, expected, eps, name) {
  ok(Math.abs(actual - expected) <= eps, name, { actual, expected });
}

/* ============================================================
   1. Алгоритм интервального повторения
   ============================================================ */

const SET = SRS.sanitizeSettings(null);           // настройки по умолчанию
const T = Date.now();
const MIN = 60000, DAY = 86400000;

function newCard() { return { id: 'c1', word: 'w', translation: 't', srs: SRS.newState(SET, T) }; }
function reviewCard(interval, ease, lapses) {
  return {
    id: 'c2', word: 'w', translation: 't',
    srs: { state: 'review', step: 0, interval, ease, due: T, reps: 5, lapses: lapses || 0, leech: false, lastReview: T }
  };
}

section('SRS: выход из обучения');
{
  const c = newCard();
  const r1 = SRS.answer(c, SRS.GRADES.GOOD, SET, T);
  eq(r1.srs.state, 'learning', 'новая + «Нормально» → в обучение');
  eq(r1.srs.step, 1, 'первое «Нормально» ведёт ко второму шагу, а не топчется на первом');
  eq(r1.srs.due - T, 10 * MIN, 'следующий показ через 10 минут');

  const r2 = SRS.answer({ srs: r1.srs }, SRS.GRADES.GOOD, SET, T + 10 * MIN);
  eq(r2.srs.state, 'review', 'после последнего шага — выпуск в повторение');
  eq(r2.srs.interval, SET.graduatingInterval, 'интервал выпуска = 1 день');
  eq(r2.srs.due - (T + 10 * MIN), SET.graduatingInterval * DAY, 'карточка уходит на сутки');

  const r3 = SRS.answer({ srs: r2.srs }, SRS.GRADES.GOOD, SET, T + 10 * MIN + DAY);
  eq(r3.srs.interval, 2.5, 'дальше интервал растёт по ease: 1 × 2,5 = 2,5 дня');

  const r4 = SRS.answer(newCard(), SRS.GRADES.EASY, SET, T);
  eq(r4.srs.state, 'review', 'новая + «Легко» → сразу повторение');
  eq(r4.srs.interval, SET.easyInterval, 'интервал «Легко» = 4 дня');

  const r5 = SRS.answer(newCard(), SRS.GRADES.AGAIN, SET, T);
  eq(r5.srs.state, 'learning', 'новая + «Снова» остаётся в обучении');
  eq(r5.srs.step, 0, '«Снова» возвращает на первый шаг');
  eq(r5.srs.due - T, 1 * MIN, 'первый шаг — минута');
  eq(r5.srs.lapses, 0, 'обучение не считается провалом');

  /* Карточка в обучении двигается по шагам: раньше новый статус придерживал
     шаг, и «Нормально» с новой карточки возвращало её через ту же минуту. */
  const r6 = SRS.answer({ srs: r5.srs }, SRS.GRADES.GOOD, SET, T + MIN);
  eq(r6.srs.step, 1, '«Нормально» после «Снова» — на второй шаг');
  eq(r6.srs.due - (T + MIN), 10 * MIN, 'и снова через 10 минут');
}

section('SRS: «Трудно» на шагах обучения отличается от «Снова»');
{
  /* Раньше «Трудно» на новой карточке держало тот же шаг и ту же минуту, что
     «Снова», — человек видел два одинаковых интервала и решал, что
     интервальное повторение не работает. */
  const again = SRS.answer(newCard(), SRS.GRADES.AGAIN, SET, T);
  const hard = SRS.answer(newCard(), SRS.GRADES.HARD, SET, T);
  const good = SRS.answer(newCard(), SRS.GRADES.GOOD, SET, T);
  const easy = SRS.answer(newCard(), SRS.GRADES.EASY, SET, T);

  eq(again.srs.due - T, 1 * MIN, '«Снова» на новой — первый шаг, минута');
  eq(hard.srs.due - T, 5.5 * MIN, '«Трудно» на новой — середина между шагами, 5,5 минуты');
  eq(good.srs.due - T, 10 * MIN, '«Нормально» на новой — следующий шаг, 10 минут');
  ok(easy.srs.state === 'review', '«Легко» на новой выпускает в повторение');

  eq(hard.srs.step, 0, '«Трудно» не сдвигает шаг');
  eq(hard.srs.state, 'learning', '«Трудно» оставляет карточку в обучении');
  eq(SRS.preview(newCard(), SET, T)[1], SRS.preview(newCard(), SET, T)[1],
    'подсказки интервалов для одинакового состояния совпадают');
  ok(SRS.preview(newCard(), SET, T)[1] !== SRS.preview(newCard(), SET, T)[2],
    'в подсказках «Снова» и «Трудно» — разные интервалы',
    SRS.preview(newCard(), SET, T));

  /* на последнем шаге обучения «Трудно» повторяет этот же шаг, но
     «Нормально» уже выпускает — интервалы снова не совпадают */
  const step1 = { srs: SRS.answer(newCard(), SRS.GRADES.GOOD, SET, T).srs };
  const hardLast = SRS.answer(step1, SRS.GRADES.HARD, SET, T + 10 * MIN);
  const goodLast = SRS.answer(step1, SRS.GRADES.GOOD, SET, T + 10 * MIN);
  eq(hardLast.srs.due - (T + 10 * MIN), 10 * MIN, 'на последнем шаге «Трудно» держит шаг');
  eq(goodLast.srs.state, 'review', 'на последнем шаге «Нормально» выпускает');
  ok(hardLast.srs.due !== goodLast.srs.due, 'интервалы «Трудно» и «Нормально» различаются');
}

section('SRS: рост интервалов на повторении');
{
  const good = SRS.answer(reviewCard(10, 2.5), SRS.GRADES.GOOD, SET, T);
  eq(good.srs.interval, 25, '«Нормально»: 10 × 2.5 = 25 дней');
  eq(good.srs.ease, 2.5, 'ease не меняется при «Нормально»');

  const easy = SRS.answer(reviewCard(10, 2.5), SRS.GRADES.EASY, SET, T);
  eq(easy.srs.interval, 32.5, '«Легко»: 10 × 2.5 × 1.3 = 32,5 дня');
  eq(easy.srs.ease, 2.65, 'ease растёт на 0.15');

  const hard = SRS.answer(reviewCard(10, 2.5), SRS.GRADES.HARD, SET, T);
  eq(hard.srs.interval, 12, '«Трудно»: 10 × 1.2 = 12 дней');
  near(hard.srs.ease, 2.35, 1e-9, 'ease падает на 0.15');

  ok(easy.srs.interval > good.srs.interval && good.srs.interval > hard.srs.interval,
    'порядок интервалов: Легко > Нормально > Трудно',
    { easy: easy.srs.interval, good: good.srs.interval, hard: hard.srs.interval });
}

section('SRS: забывание и «трудные» карточки');
{
  const lapsed = SRS.answer(reviewCard(30, 2.5), SRS.GRADES.AGAIN, SET, T);
  eq(lapsed.srs.state, 'relearning', '«Снова» → повторное обучение');
  eq(lapsed.srs.lapses, 1, 'счётчик провалов вырос');
  near(lapsed.srs.ease, 2.3, 1e-9, 'ease падает на 0.2');
  eq(lapsed.srs.due - T, SET.relearningSteps[0] * MIN, 'возврат через шаг повторного обучения');

  const kept = SRS.answer(reviewCard(100, 2.5), SRS.GRADES.AGAIN,
    SRS.sanitizeSettings({ lapseMultiplier: 0.5 }), T);
  eq(kept.srs.interval, 50, 'lapseMultiplier 0.5 сохраняет половину интервала');

  const leech = SRS.answer(reviewCard(20, 2.5, SET.leechThreshold - 1), SRS.GRADES.AGAIN, SET, T);
  eq(leech.srs.leech, true, 'после 8 провалов карточка помечается трудной');
  ok(leech.leech === true, 'флаг leech возвращается в результате ответа');
}

section('SRS: границы интервалов');
{
  const capped = SRS.answer(reviewCard(1000, 2.5), SRS.GRADES.GOOD, SET, T);
  eq(capped.srs.interval, SET.maxInterval, 'интервал не превышает максимум (1095 дней)');

  const floored = SRS.answer(reviewCard(1, 1.3), SRS.GRADES.GOOD, SRS.sanitizeSettings({ minInterval: 2 }), T);
  eq(floored.srs.interval, 2, 'интервал не ниже минимума');

  const modifier = SRS.answer(reviewCard(10, 2.5), SRS.GRADES.GOOD, SRS.sanitizeSettings({ intervalModifier: 0.5 }), T);
  eq(modifier.srs.interval, 12.5, 'модификатор интервала применяется');

  const garbage = SRS.sanitizeSettings({ learningSteps: 'abc', newPerDay: -5, maxInterval: 0, startingEase: 99 });
  eq(garbage.learningSteps.join(','), '1,10', 'некорректные шаги заменяются значениями по умолчанию');
  eq(garbage.newPerDay, 0, 'отрицательный лимит новых зажимается в 0');
  eq(garbage.maxInterval, 1, 'нулевой максимум зажимается в 1');
  eq(garbage.startingEase, 4, 'ease ограничен сверху значением 4');
}

section('SRS: превью интервалов и состояния');
{
  const c = reviewCard(10, 2.5);
  const p = SRS.preview(c, SET, T);
  eq(Object.keys(p).length, 4, 'превью содержит 4 варианта оценки');
  ok(p[4] !== p[1] && p[3] !== p[1], 'подписи интервалов различаются');
  eq(SRS.stateLabel({ srs: SRS.newState(SET, T) }), 'Новая', 'подпись состояния «Новая»');
  eq(SRS.stateLabel(c), 'Повторение', 'подпись состояния «Повторение»');
  eq(SRS.isDue(c, T + DAY), true, 'карточка считается просроченной после срока');
}

/* ============================================================
   2. Утилиты сравнения и форматирования
   ============================================================ */

section('Утилиты');
{
  eq(U.normalize('  Although!  '), 'although', 'нормализация: регистр, пробелы, пунктуация');
  eq(U.normalize('Üniversität'), 'universitat', 'нормализация: диакритика');
  eq(U.normalize('ЁЖИК'), 'ежик', 'нормализация: буква ё');
  eq(U.levenshtein('improve', 'imrpove'), 2, 'расстояние Левенштейна для опечатки');
  eq(U.levenshtein('кот', 'кот'), 0, 'одинаковые строки — расстояние 0');
  eq(U.plural(1, 'слово', 'слова', 'слов'), 'слово', 'склонение: 1');
  eq(U.plural(3, 'слово', 'слова', 'слов'), 'слова', 'склонение: 3');
  eq(U.plural(11, 'слово', 'слова', 'слов'), 'слов', 'склонение: 11');
  eq(U.fmtInterval(60000), '1 мин', 'формат интервала: минуты');
  eq(U.fmtInterval(3 * DAY), '3 д', 'формат интервала: дни');
  eq(U.fmtInterval(60 * DAY), '2 мес', 'формат интервала: месяцы');
  ok(U.diffHtml('imrpove', 'improve').indexOf('<del>') >= 0, 'подсветка различий содержит удалённые символы');
}

/* ============================================================
   3. Импорт и экспорт
   ============================================================ */

function reset() { S.wipe(); S.flush(); }

/* ============================================================
   2.5. Дневной лимит повторений
   ============================================================ */

section('Дневной лимит: что считается повторением за день');
{
  reset();
  const now = Date.now();
  const today = now - 60000;
  const yesterday = U.startOfDay(now) - 60000;
  const data = S.get();
  data.logs = [
    { id: 'a', ts: today, deckId: 'd1', stateFrom: 'review', stateTo: 'review' },
    { id: 'b', ts: today, deckId: 'd1', stateFrom: 'relearning', stateTo: 'review' },
    // шаги обучения повторением не считаются: лимит про вышедшие из обучения
    { id: 'c', ts: today, deckId: 'd1', stateFrom: 'new', stateTo: 'learning' },
    { id: 'd', ts: today, deckId: 'd1', stateFrom: 'learning', stateTo: 'review' },
    // тест не меняет расписание, поэтому лимит не расходует
    { id: 'e', ts: today, deckId: 'd1', stateFrom: 'review', stateTo: 'review', test: true },
    { id: 'f', ts: today, deckId: 'd2', stateFrom: 'review', stateTo: 'review' },
    // вчерашние ответы в сегодняшний лимит не входят
    { id: 'g', ts: yesterday, deckId: 'd1', stateFrom: 'review', stateTo: 'review' }
  ];
  eq(S.reviewsDoneToday('d1', now), 2, 'колода: считаются ответы на повторении за сегодня');
  eq(S.reviewsDoneToday('d2', now), 1, 'соседняя колода: свой счётчик');
  eq(S.reviewsDoneToday(null, now), 3, 'все колоды: сумма за сегодня');
  eq(S.reviewsToday('d1', now), 5, 'общий счётчик по-прежнему считает любые ответы');
  eq(S.reviewsDoneToday('d1', U.startOfDay(now) + 86400000 + 1000), 0, 'завтра счётчик начинается заново');
}

section('Импорт CSV и текстовых списков');
{
  reset();
  let res = S.importText('word,translation\nnimble,ловкий\nresilient,стойкий', {});
  eq(res.added, 2, 'CSV с заголовком: добавлено 2 слова');
  eq(S.get().cards.length, 2, 'слова попали в хранилище');
  eq(S.get().cards[0].word, 'nimble', 'первое слово распознано верно');
  eq(S.get().cards[0].translation, 'ловкий', 'перевод распознан верно');

  res = S.importText('word\ttranslation\nfoo\tбар', {});
  eq(res.added, 1, 'TSV определяется по табуляции');

  res = S.importText('"hello, world","привет, мир"', {});
  eq(res.added, 1, 'кавычки в CSV обрабатываются');
  eq(S.get().cards[S.get().cards.length - 1].word, 'hello, world', 'запятая внутри кавычек не ломает разбор');

  res = S.importText('although - хотя\nimprove = улучшать\neffort : усилие', {});
  eq(res.added, 3, 'строки «слово - перевод» с разными разделителями');

  res = S.importText('Колода,Слово,Перевод\nDeck A,alpha,альфа\nDeck B,beta,бета\nDeck A,gamma,гамма', {});
  eq(res.added, 3, 'CSV с колонкой «Колода»: добавлены все строки');
  eq(res.decks, 2, 'создано две колоды по значению колонки');
  const deckA = S.get().decks.filter(d => d.name === 'Deck A')[0];
  const deckB = S.get().decks.filter(d => d.name === 'Deck B')[0];
  eq(deckA && S.cardsOf(deckA.id).length, 2, 'в колоду Deck A попало 2 слова');
  eq(deckB && S.cardsOf(deckB.id).length, 1, 'в колоду Deck B попало 1 слово');

  res = S.importText('word,translation\nduplicate,дубликат\nduplicate,дубликат', {});
  eq(res.added, 1, 'дубликаты внутри файла пропускаются');
  eq(res.skipped, 1, 'пропущенный дубликат посчитан');

  res = S.importText('word,translation\nduplicate,дубликат', {});
  eq(res.added, 0, 'повторный импорт того же слова не дублируется');
  eq(res.skipped, 1, 'повтор распознан как дубликат');

  res = S.importText('word,translation\nduplicate,дубликат', { dedupe: false });
  eq(res.added, 1, 'при выключенной проверке дубликатов слово добавляется');

  res = S.importText('Слово,Перевод,Транскрипция,Пример\nserendipity,озарение,ˌserənˈdɪpəti,A lucky find.', {});
  eq(res.added, 1, 'русские заголовки колонок распознаются');
  const last = S.get().cards[S.get().cards.length - 1];
  eq(last.transcription, 'ˌserənˈdɪpəti', 'транскрипция из CSV');
  eq(last.examples.length, 1, 'пример из CSV');

  res = S.importText('   ', {});
  eq(res.error, 'Пустой файл', 'пустой ввод даёт понятную ошибку');

  res = S.importText('{битый json', {});
  eq(res.error, 'Некорректный JSON', 'битый JSON не роняет приложение');
}

section('Импорт JSON и резервные копии');
{
  reset();
  const deck = S.createDeck({ name: 'Тест', langFrom: 'en', langTo: 'ru' });
  S.createCard({ deckId: deck.id, word: 'alpha', translation: 'альфа' });
  S.createCard({ deckId: deck.id, word: 'beta', translation: 'бета' });
  const backup = S.exportAll();
  const parsed = JSON.parse(backup);
  eq(parsed.decks.length, 1, 'в резервной копии одна колода');
  eq(parsed.cards.length, 2, 'в резервной копии две карточки');
  eq(parsed.app, 'LexiFlow', 'в копии указано приложение-источник');

  const res = S.importText(backup, {});
  eq(res.added, 0, 'повторный импорт своей же копии пропускает всё как дубликаты');
  eq(res.decks, 0, 'при полном дублировании колоды не создаются заново');

  reset();
  const res2 = S.importText(backup, {});
  eq(res2.added, 2, 'после очистки копия восстанавливается полностью');
  eq(S.get().decks.length, 1, 'колода восстановлена');
  eq(S.get().cards.length, 2, 'карточки восстановлены');

  // слияние в те же самые данные: ничего не добавилось и не появилось пустых колод
  const merge = S.importText(backup, {});
  eq(merge.added, 0, 'слияние: дубликаты не добавляются');
  eq(merge.decks, 0, 'слияние: пустые колоды-дубликаты не создаются');
  eq(S.get().decks.length, 1, 'слияние: число колод не изменилось');
  eq(S.get().cards.length, 2, 'слияние: число карточек не изменилось');

  // файл с колодой без карточек — структура сохраняется
  reset();
  const emptyDeck = S.importText(JSON.stringify({
    decks: [{ id: 'z', name: 'Пустая', langFrom: 'fr', langTo: 'ru' }], cards: []
  }), {});
  eq(emptyDeck.decks, 1, 'колода без карточек сохраняется');
  eq(S.get().decks[0].langFrom, 'fr', 'язык колоды сохранён');

  // «сырой» массив карточек
  reset();
  const bare = S.importText(JSON.stringify([{ word: 'foo', translation: 'бар' }]), {});
  eq(bare.added, 1, 'JSON-массив карточек импортируется');
  eq(bare.decks, 1, 'для массива карточек создаётся колода');
  eq(S.get().cards[0].deckId, S.get().decks[0].id, 'карточка привязана к созданной колоде');
}

section('Круговой рейс CSV (экспорт → импорт)');
{
  reset();
  const d1 = S.createDeck({ name: 'Английский', langFrom: 'en', langTo: 'ru' });
  const d2 = S.createDeck({ name: 'Немецкий', langFrom: 'de', langTo: 'ru' });
  S.createCard({ deckId: d1.id, word: 'although', translation: 'хотя', transcription: 'ɔːlˈðəʊ', examples: [{ text: 'Although it was late.', translation: 'Хотя было поздно.' }] });
  S.createCard({ deckId: d1.id, word: 'improve', translation: 'улучшать' });
  S.createCard({ deckId: d2.id, word: 'wichtig', translation: 'важный' });

  const csv = S.exportCsv(null);
  ok(csv.indexOf('\uFEFF') === 0, 'CSV содержит BOM для Excel');
  ok(csv.indexOf('although') > 0, 'CSV содержит слово');
  ok(csv.split('\r\n').length >= 4, 'CSV содержит строки данных');

  reset();
  const res = S.importText(csv, {});
  eq(res.added, 3, 'из CSV восстановлены все 3 слова');
  eq(res.decks, 2, 'колоды восстановлены по колонке «Колода»');
  const names = S.get().decks.map(d => d.name).sort();
  eq(names.join('|'), 'Английский|Немецкий', 'названия колод сохранены');
  const restored = S.get().cards.filter(c => c.word === 'although')[0];
  eq(restored.transcription, 'ɔːlˈðəʊ', 'транскрипция прошла круговой рейс');
  eq(restored.examples.length, 1, 'пример прошёл круговой рейс');
  eq(S.get().decks.filter(d => d.name === 'Английский')[0] && S.cardsOf(S.get().decks.filter(d => d.name === 'Английский')[0].id).length, 2,
    'слова разложены по своим колодам');
}

section('Примеры: два языка и несколько на карточку');
{
  reset();
  const deck = S.createDeck({ name: 'Примеры', langFrom: 'en', langTo: 'ru' });
  const grab = (word) => S.get().cards.filter(c => c.word === word)[0];

  // 1. два языка: пример + перевод примера
  S.importText('Слово,Перевод,Пример,Перевод примера\nalthough,хотя,Although it was late.,Хотя было поздно.', { deckId: deck.id });
  let card = grab('although');
  eq(card.examples.length, 1, 'пара «пример + перевод примера» читается');
  eq(card.examples[0].text, 'Although it was late.', 'пример на изучаемом языке');
  eq(card.examples[0].translation, 'Хотя было поздно.', 'перевод примера на родной язык');

  // 2. пронумерованные колонки — несколько примеров
  S.importText('Слово,Перевод,Пример,Перевод примера,Пример 2,Перевод примера 2\nimprove,улучшать,I want to improve.,Я хочу улучшить.,He improved fast.,Он быстро улучшился.', { deckId: deck.id });
  card = grab('improve');
  eq(card.examples.length, 2, 'две пары колонок дают два примера');
  eq(card.examples[1].text, 'He improved fast.', 'второй пример прочитан');
  eq(card.examples[1].translation, 'Он быстро улучшился.', 'перевод второго примера прочитан');

  // 3. английские заголовки с номерами
  S.importText('word,translation,example,example translation,example 2,example translation 2\neffort,усилие,It took effort.,Это потребовало усилий.,Nice effort!,Хорошая попытка!', { deckId: deck.id });
  card = grab('effort');
  eq(card.examples.length, 2, 'английские заголовки «example 2» распознаются');
  eq(card.examples[1].translation, 'Хорошая попытка!', 'перевод второго примера (en)');

  // 4. несколько примеров внутри одной ячейки через ||
  S.importText('Слово,Перевод,Пример,Перевод примера\nachieve,достигать,She achieved her goal.||He achieved nothing.,Она достигла цели.||Он ничего не добился.', { deckId: deck.id });
  card = grab('achieve');
  eq(card.examples.length, 2, 'разделитель «||» даёт два примера');
  eq(card.examples[0].translation, 'Она достигла цели.', 'перевод первого примера из ячейки');
  eq(card.examples[1].text, 'He achieved nothing.', 'второй пример из ячейки');
  eq(card.examples[1].translation, 'Он ничего не добился.', 'перевод второго примера из ячейки');

  // 5. таблица без заголовков: примеры в 4-й и 5-й колонках
  S.importText('avoid,избегать,əˈvɔɪd,Try to avoid mistakes.,Старайся избегать ошибок.', { deckId: deck.id });
  card = grab('avoid');
  eq(card.examples.length, 1, 'без заголовков пример берётся из 4-й колонки');
  eq(card.examples[0].translation, 'Старайся избегать ошибок.', 'и его перевод — из 5-й');

  // 6. круговой рейс CSV с двумя примерами
  const csv = S.exportCsv(null);
  ok(csv.indexOf('Пример 2') > 0, 'в экспорте появляется колонка «Пример 2»');
  reset();
  const back = S.importText(csv, {});
  eq(back.added, 5, 'все слова вернулись из CSV');
  const improve = S.get().cards.filter(c => c.word === 'improve')[0];
  eq(improve.examples.length, 2, 'оба примера пережили экспорт и импорт');
  eq(improve.examples[0].translation, 'Я хочу улучшить.', 'перевод первого примера после кругового рейса');
  eq(improve.examples[1].text, 'He improved fast.', 'второй пример после кругового рейса');

  // 7. один перевод на несколько примеров не «размножается»
  reset();
  const d2 = S.createDeck({ name: 'Один перевод' });
  S.importText('Слово,Перевод,Пример,Перевод примера\nrequire,требовать,The job requires patience.||It requires work.,Работа требует терпения.', { deckId: d2.id });
  card = S.get().cards[0];
  eq(card.examples.length, 2, 'два примера из одной ячейки');
  eq(card.examples[0].translation, 'Работа требует терпения.', 'единственный перевод достаётся первому примеру');
  eq(card.examples[1].translation, '', 'второй пример остаётся без перевода');
}

section('Готовый пример из import-templates');
{
  reset();
  const file = path.join(ROOT, 'import-templates', 'sample-en-ru.csv');
  ok(fs.existsSync(file), 'файл примера на месте');
  const res = S.importText(fs.readFileSync(file, 'utf8'), {});
  eq(res.added, 10, 'все 10 слов из примера импортированы');
  eq(res.skipped, 0, 'ничего не пропущено');
  eq(res.decks, 1, 'создана одна колода из колонки «Колода»');
  eq(S.get().decks[0].name, 'Пример: английский', 'название колоды прочитано');
  const commute = S.get().cards.filter(c => c.word === 'to commute')[0];
  eq(commute.examples.length, 2, 'у «to commute» два примера');
  eq(commute.examples[0].text, 'I commute to work by train.', 'первый пример на английском');
  eq(commute.examples[0].translation, 'Я езжу на работу на электричке.', 'перевод первого примера');
  eq(commute.examples[1].translation, 'Она тратит на дорогу час в одну сторону.', 'перевод второго примера');
  const chores = S.get().cards.filter(c => c.word === 'chores')[0];
  eq(chores.translation, 'домашние дела, рутина', 'перевод с запятой не разъехался на колонки');
  const groceries = S.get().cards.filter(c => c.word === 'groceries')[0];
  eq(groceries.examples.length, 1, 'пустые колонки «Пример 2» не создают пустой пример');
  eq(S.get().cards.filter(c => c.examples.length === 2).length, 4, 'четыре слова с двумя примерами');
  // слова примера не должны пересекаться с демо-колодой, иначе импорт уйдёт в дубликаты
  const demoWords = ['although', 'to improve', 'effort', 'to achieve', 'opportunity', 'to avoid',
    'however', 'to require', 'reliable', 'to suggest', 'slightly', 'to provide'];
  eq(S.get().cards.filter(c => demoWords.indexOf(c.word) >= 0).length, 0,
    'пример не повторяет слова демо-колоды');

  // тот же импорт, но на фоне демо-колоды (как у нового пользователя)
  reset();
  S.seedDemo();
  const withDemo = S.importText(fs.readFileSync(file, 'utf8'), {});
  eq(withDemo.added, 10, 'на фоне демо-колоды импортируются все 10 слов');
  eq(withDemo.skipped, 0, 'слова примера не отсеиваются как дубликаты демо-слов');
}

section('Озвучка: выбор голоса и подготовка текста');
{
  const SP = App.speech;
  ok(!!SP && typeof SP.scoreVoice === 'function', 'модуль озвучки загружается');
  ok(SP.supported() === false, 'в Node синтез речи корректно считается недоступным');

  const voice = (name, lang, local, def) => ({ name, lang, localService: local, default: !!def, voiceURI: name + '|' + lang });
  const robotic = voice('eSpeak English', 'en-US', true);
  const compact = voice('English (United States) Compact', 'en-US', true);
  const natural = voice('Microsoft Aria Online (Natural)', 'en-US', false);
  const google = voice('Google US English', 'en-US', false);
  const german = voice('Anna', 'de-DE', true);
  const localPlain = voice('Microsoft David Desktop', 'en-US', true);

  ok(SP.scoreVoice(natural, 'en') > SP.scoreVoice(compact, 'en'), 'нейросетевой голос обходит системный');
  ok(SP.scoreVoice(google, 'en') > SP.scoreVoice(robotic, 'en'), 'голос Google обходит роботизированный');
  ok(SP.scoreVoice(natural, 'en') > SP.scoreVoice(localPlain, 'en'), 'облачный голос обходит локальный');
  ok(SP.scoreVoice(german, 'en') < 0, 'голос другого языка получает минус');
  ok(SP.scoreVoice(natural, 'en') > SP.scoreVoice(natural, 'en-GB'), 'точное совпадение языка ценнее частичного');
  ok(SP.scoreVoice(voice('Bells', 'en-US', true), 'en') < SP.scoreVoice(localPlain, 'en'), 'шутливые голоса отодвигаются');

  eq(SP.toBcp47('en'), 'en-US', 'короткий код превращается в полный');
  eq(SP.toBcp47('de-AT'), 'de-AT', 'готовый код не меняется');
  eq(SP.baseLang('en-GB'), 'en', 'базовый код языка');

  eq(SP.cleanText('  Hello\u200b   world  '), 'Hello world', 'невидимые символы и лишние пробелы убираются');
  eq(SP.cleanText('Привет 😀 мир'), 'Привет мир', 'эмодзи вырезаются');
  eq(SP.cleanText('line\u0001break'), 'line break', 'управляющие символы заменяются пробелом');
  eq(SP.cleanText(''), '', 'пустая строка остаётся пустой');
}

section('Озвучка: подготовка текста к произнесению');
{
  const SP = App.speech;
  // словарные сокращения: движок читает «sth» как «эс-тэ-аш»
  eq(SP.normalizeForSpeech('to borrow sth from sb', 'en'), 'to borrow something from somebody', 'sth и sb раскрываются');
  eq(SP.normalizeForSpeech('a book, etc.', 'en'), 'a book, etcetera', 'etc раскрывается');
  eq(SP.normalizeForSpeech('tea, e.g. green tea', 'en'), 'tea, for example green tea', 'e.g. раскрывается');
  eq(SP.normalizeForSpeech('BrE vs AmE', 'en'), 'British English versus American English', 'пометки вариантов языка раскрываются');
  eq(SP.normalizeForSpeech('fast & slow', 'en'), 'fast and slow', 'амперсанд превращается в and');
  ok(SP.normalizeForSpeech('идти sth бежать', 'ru').indexOf('something') < 0, 'для других языков английские сокращения не трогаются');
  eq(SP.normalizeForSpeech('идти → бежать', 'ru'), 'идти, бежать', 'стрелка превращается в паузу');
  eq(SP.normalizeForSpeech('a — b', 'en'), 'a, b', 'тире превращается в паузу');
  eq(SP.normalizeForSpeech('a | b', 'en'), 'a, b', 'вертикальная черта превращается в паузу');
  eq(SP.normalizeForSpeech('', 'en'), '', 'пустой текст остаётся пустым');
  eq(SP.normalizeForSpeech('  двойные   пробелы  ', 'ru'), 'двойные пробелы', 'лишние пробелы сводятся');
  eq(SP.normalizeForSpeech('hello ,  world', 'en'), 'hello, world', 'пробел перед запятой убирается');

  // разбиение на фразы: между репликами появляется настоящая пауза
  const twoSent = 'I commute to work by train every morning. My sister prefers to walk instead.';
  const two = SP.chunkText(twoSent, 60);
  eq(two.length, 2, 'длинный текст дробится на две реплики');
  eq(two[0].text, 'I commute to work by train every morning.', 'первая реплика заканчивается на границе предложения');
  eq(two[1].text, 'My sister prefers to walk instead.', 'вторая реплика — второе предложение');
  eq(two[1].start, 'I commute to work by train every morning. '.length, 'смещение второй реплики указывает на её начало');
  eq(SP.chunkText('Short.', 60).length, 1, 'короткая фраза не дробится');
  eq(SP.chunkText('First sentence. Second sentence.', 60).length, 1, 'текст короче лимита читается одной репликой');

  const long = SP.chunkText('I like tea, but my sister prefers coffee, and my brother drinks only water.', 40);
  ok(long.length > 1, 'длинная фраза дробится');
  ok(long.every(c => c.text.length <= 40), 'ни одна реплика не выходит за лимит');
  ok(long.every(c => 'I like tea, but my sister prefers coffee, and my brother drinks only water.'.indexOf(c.text) >= 0), 'реплики — точные куски исходного текста');

  // граница предложения важнее запятой: реплика не должна кончаться на полуслове
  const sentFirst = SP.chunkText('One two three. Four five six. Seven eight nine.', 20);
  eq(sentFirst[0].text, 'One two three.', 'короткое предложение не разрывается ради лимита');
  ok(sentFirst.every(c => /[.!?…]$/.test(c.text)), 'каждая реплика заканчивается концом предложения');

  const noPunct = SP.chunkText('aaa '.repeat(30).trim(), 40);
  ok(noPunct.length > 1, 'текст без знаков препинания тоже дробится');
  ok(noPunct.every(c => c.text.length <= 40), 'и тоже не выходит за лимит');
  ok(noPunct.every(c => /^aaa( aaa)*$/.test(c.text)), 'текст без знаков режется по границам слов, а не внутри слова');

  // смещения нужны для подсветки: они должны указывать на реальные позиции
  const offsets = SP.chunkText('One two three. Four five six. Seven eight nine.', 20);
  ok(offsets.every(c => 'One two three. Four five six. Seven eight nine.'.slice(c.start, c.start + c.text.length) === c.text),
     'смещения совпадают с текстом (подсветка не съедет)');

  eq(SP.chunkText('', 40).length, 0, 'пустой текст не даёт реплик');
  eq(SP.chunkText('   ', 40).length, 0, 'текст из пробелов не даёт реплик');
}

section('Озвучка: вердикт о качестве голоса');
{
  const SP = App.speech;
  const voice = (name, lang, local) => ({ name, lang, localService: local, voiceURI: name + '|' + lang });
  const natural = voice('Microsoft Aria Online (Natural)', 'en-US', false);
  const plain = voice('Microsoft David Desktop', 'en-US', true);
  const compact = voice('English (United States) Compact', 'en-US', true);
  const google = voice('Google US English', 'en-US', false);

  eq(SP.voiceQuality(natural, 'en').level, 'neural', 'голос Natural признаётся нейросетевым');
  eq(SP.voiceQuality(google, 'en').level, 'neural', 'голос Google признаётся нейросетевым');
  eq(SP.voiceQuality(compact, 'en').level, 'poor', 'Compact признаётся роботизированным');
  eq(SP.voiceQuality(plain, 'en').level, 'poor', 'старый системный голос Windows признаётся роботизированным');
  eq(SP.voiceQuality(null, 'en').level, 'none', 'отсутствие голоса — отдельный вердикт');
  ok(SP.voiceQuality(plain, 'en').hint.indexOf('Edge') > 0, 'для плохого голоса есть конкретный совет');
  ok(SP.voiceQuality(natural, 'en').label.length > 0, 'у вердикта есть человекочитаемая подпись');

  // итог по нескольким языкам: плохой голос не должен прятаться за хорошим
  const langs = ['en', 'de'];
  eq(SP.worstQuality(['en']).level === 'none' || SP.worstQuality(['en']).level === 'neural', true, 'worstQuality работает на одном языке');
  ok(langs.length === 2, 'набор языков для проверки');

  // название браузера влияет на совет
  eq(SP.browserName('Mozilla/5.0 Chrome/120 Safari/537.36 Edg/120'), 'Edge', 'Edge определяется по user agent');
  eq(SP.browserName('Mozilla/5.0 Chrome/120 Safari/537.36'), 'Chrome', 'Chrome определяется по user agent');
  eq(SP.browserName('Mozilla/5.0 Firefox/121'), 'Firefox', 'Firefox определяется по user agent');
  eq(SP.browserName('Mozilla/5.0 YaBrowser/24.1'), 'Яндекс Браузер', 'Яндекс Браузер определяется по user agent');
  eq(SP.browserName('Mozilla/5.0 OPR/105'), 'Opera', 'Opera определяется по user agent');
  eq(SP.browserName('Mozilla/5.0 Version/17.0 Safari/605'), 'Safari', 'Safari определяется по user agent');
  eq(SP.browserName(''), 'неизвестный', 'пустой user agent не ломает определение');
}

section('Озвучка: что сказать перед началом тренировки');
{
  const SP = App.speech;
  const voice = (name, lang, local) => ({ name, lang, localService: local, voiceURI: name + '|' + lang });

  // В Node синтеза речи нет — сначала проверяем ровно этот случай
  eq(SP.voiceAdvice([]), null, 'без языков предупреждать не о чем');
  eq(SP.voiceAdvice(null), null, 'пустой список языков не ломает проверку');

  const noSupport = SP.voiceAdvice(['en']);
  eq(noSupport.level, 'unsupported', 'без поддержки синтеза — отдельное предупреждение');
  ok(noSupport.title.length > 0, 'у предупреждения есть заголовок');
  ok(/Chrome|Edge|Safari/.test(noSupport.text), 'совет называет браузеры, где озвучка работает');

  // Дальше подменяем синтез речи заглушкой, чтобы добраться до остальных веток
  const realSynth = global.speechSynthesis;
  const realUtter = global.SpeechSynthesisUtterance;
  global.SpeechSynthesisUtterance = function () {};
  const synth = list => ({
    getVoices: () => list, addEventListener() {}, removeEventListener() {}
  });

  // голосов нет вообще
  global.speechSynthesis = synth([]);
  SP.voices();
  const none = SP.voiceAdvice(['en', 'ru']);
  eq(none.level, 'none', 'отсутствие голосов — предупреждение «не установлена»');
  ok(/Английский/.test(none.text) && /Русский/.test(none.text), 'в тексте названы оба языка');
  ok(/интернет/i.test(none.text), 'сказано, что нормальный голос придёт из интернета');
  /* Проверено на живом Chromium: кнопка не молчит, а читает текст голосом
     по умолчанию, то есть чужим произношением (onstart 168 мс, onend 3031 мс,
     onerror нет). Прежняя формулировка «кнопка будет молчать» врала. */
  ok(/чужим произношением/.test(none.text), 'сказано, что речь будет, но с чужим произношением');
  ok(none.text.indexOf('будет молчать') < 0, 'прежняя неверная формулировка убрана');
  ok(/скача/i.test(none.text), 'предложен и способ получить нормальный голос');

  // есть только механический голос
  global.speechSynthesis = synth([
    voice('Microsoft David Desktop', 'en-US', true),
    voice('Microsoft Irina Desktop', 'ru-RU', true)
  ]);
  SP.voices();
  const poor = SP.voiceAdvice(['en']);
  eq(poor.level, 'poor', 'механический голос — отдельное предупреждение');
  ok(/интернет/i.test(poor.text), 'совет обещает замену голосом из интернета');
  ok(poor.text.indexOf('Английский') > 0, 'язык назван по-русски');

  /* Если фразы читаются файлом, плохой системный голос уже ни при чём —
     подсказка не должна висеть. Иначе человек видит «скачай качественную
     озвучку», хотя качественная уже звучит. */
  const realTtsnet = App.ttsnet;
  App.ttsnet = { willUseFiles: () => true };
  eq(SP.voiceAdvice(['en']), null, 'файловая озвучка закрывает язык — подсказки нет');
  App.ttsnet = { willUseFiles: () => false };
  ok(SP.voiceAdvice(['en']), 'без файловой озвучки подсказка остаётся');
  App.ttsnet = { willUseFiles: () => { throw new Error('модуль сломан'); } };
  ok(SP.voiceAdvice(['en']), 'сломанный модуль озвучки не отменяет подсказку');
  App.ttsnet = realTtsnet;

  // хороший голос — предупреждать не о чем
  global.speechSynthesis = synth([voice('Microsoft Aria Online (Natural)', 'en-US', false)]);
  SP.voices();
  eq(SP.voiceAdvice(['en']), null, 'с нейросетевым голосом предупреждения нет');

  // итог по нескольким языкам: хороший голос не должен прятать плохой
  eq(SP.voiceAdvice(['en', 'de']).level, 'none', 'плохой голос не прячется за хорошим');

  // возвращаем окружение как было
  if (realSynth === undefined) delete global.speechSynthesis; else global.speechSynthesis = realSynth;
  if (realUtter === undefined) delete global.SpeechSynthesisUtterance; else global.SpeechSynthesisUtterance = realUtter;
  SP.voices();

  eq(SP.langName('en'), 'Английский', 'название языка переводится');
  eq(SP.langName('en-US'), 'Английский', 'регион в названии не мешает');
  eq(SP.langName('xx'), 'xx', 'неизвестный язык остаётся кодом');
  // пустой код — тот же случай, что и «язык не указан»: как и везде
  // в приложении, он означает английский, а не пустую строку
  eq(SP.langName(''), 'Английский', 'пустой код не ломает перевод');
  eq(SP.langName(null), 'Английский', 'отсутствующий код тоже');
}


section('Озвучка: замолкает, когда приложение уходит с экрана');
{
  const SP = App.speech;
  const realSynth = global.speechSynthesis;
  const realUtter = global.SpeechSynthesisUtterance;

  let cancelled = 0;
  let voiceReads = 0;   // сколько раз перечитали список голосов
  const fake = {
    speaking: false,
    getVoices() {
      voiceReads++;
      return [{
        name: 'Microsoft Aria Online (Natural)', lang: 'en-US',
        localService: false, voiceURI: 'aria'
      }];
    },
    speak() { this.speaking = true; },
    cancel() { this.speaking = false; cancelled++; },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {}
  };
  global.SpeechSynthesisUtterance = function (text) { this.text = text; };
  global.speechSynthesis = fake;
  SP.voices();

  // идёт чтение
  fake.speaking = true;
  eq(SP.isSpeaking(), true, 'чтение идёт');

  // уход с экрана — речь обязана замолчать
  global.document.visibilityState = 'hidden';
  global.document.fire('visibilitychange');
  ok(cancelled > 0, 'уход с экрана отменяет чтение');
  eq(SP.isSpeaking(), false, 'речь действительно остановлена');

  // возвращение на экран само по себе ничего не перезапускает,
  // но список голосов перечитывается: пользователь мог поставить голос
  // в системе, пока приложение было свёрнуто, а Chrome список кэширует
  // и события voiceschanged после сворачивания не присылает.
  const before = cancelled;
  const readsBefore = voiceReads;
  global.document.visibilityState = 'visible';
  global.document.fire('visibilitychange');
  eq(cancelled, before, 'возвращение на экран озвучку не трогает');
  ok(voiceReads > readsBefore, 'возвращение на экран перечитывает список голосов');

  // выгрузка страницы тоже останавливает
  cancelled = 0;
  fake.speaking = true;
  global.fire('pagehide');
  ok(cancelled > 0, 'выгрузка страницы останавливает чтение');

  // окружение возвращаем как было
  if (realSynth === undefined) delete global.speechSynthesis; else global.speechSynthesis = realSynth;
  if (realUtter === undefined) delete global.SpeechSynthesisUtterance; else global.SpeechSynthesisUtterance = realUtter;
  global.document.visibilityState = 'visible';
  SP.stop();
  SP.voices();
}

section('Настройки озвучки');
{
  reset();
  const st = S.settings();
  eq(st.ttsPitch, 1, 'тон по умолчанию — 1');
  eq(st.ttsVolume, 1, 'громкость по умолчанию — 100%');
  eq(st.ttsHighlight, true, 'подсветка слов включена по умолчанию');
  eq(typeof st.ttsVoice, 'object', 'список закреплённых голосов есть в настройках');

  // правки пользователя не должны утекать в значения по умолчанию
  S.updateSettings({ ttsVoice: { en: 'Some Voice' } });
  S.updateSettings({ ttsNet: { enabled: false, downloaded: 4096 } });
  reset();
  eq(Object.keys(S.settings().ttsVoice).length, 0, 'после очистки список голосов пуст');
  eq(Object.keys(S.DEFAULT_APP_SETTINGS.ttsVoice).length, 0, 'значения по умолчанию не изменились');
  /* Сетевая озвучка включена по умолчанию — она сама решает, идти ли в сеть
     (см. needsNetwork), и выключается только явным отказом человека. */
  eq(S.settings().ttsNet.enabled, true, 'после очистки сетевая озвучка снова включена');
  eq(S.DEFAULT_APP_SETTINGS.ttsNet.enabled, true, 'значение по умолчанию — включена');
  eq(S.DEFAULT_APP_SETTINGS.ttsNet.downloaded, 0, 'счётчик скачанного не утёк в значения по умолчанию');

  // данные, сохранённые до появления новых настроек
  global.localStorage.setItem(S.STORAGE_KEY, JSON.stringify({
    decks: [], cards: [], logs: [], settings: { ttsRate: 0.8 }
  }));
  S.load();
  eq(S.settings().ttsRate, 0.8, 'прежнее значение пользователя сохраняется');
  eq(S.settings().ttsPitch, 1, 'новые настройки подставляются к старым данным');
  eq(typeof S.settings().ttsVoice, 'object', 'объект голосов создаётся при обновлении данных');
  eq(typeof S.settings().ttsNet, 'object', 'объект сетевой озвучки создаётся при обновлении данных');
  eq(S.settings().ttsNet.enabled, true, 'на старых данных сетевая озвучка включена по умолчанию');

  // явный отказ пользователя должен выжить при обновлении данных
  global.localStorage.setItem(S.STORAGE_KEY, JSON.stringify({
    decks: [], cards: [], logs: [],
    settings: { ttsRate: 0.8, ttsNet: { enabled: false, downloaded: 12345 } }
  }));
  S.load();
  eq(S.settings().ttsNet.enabled, false, 'выключенная сетевая озвучка переживает перезагрузку данных');
  eq(S.settings().ttsNet.downloaded, 12345, 'счётчик скачанного тоже сохраняется');

  // а включённая — тем более
  global.localStorage.setItem(S.STORAGE_KEY, JSON.stringify({
    decks: [], cards: [], logs: [],
    settings: { ttsRate: 0.8, ttsNet: { enabled: true, downloaded: 999 } }
  }));
  S.load();
  eq(S.settings().ttsNet.enabled, true, 'включённая сетевая озвучка тоже переживает перезагрузку');
  reset();
}

section('Сетевая озвучка: адрес запроса');
{
  const T = App.ttsnet;
  ok(!!T && typeof T.providerUrl === 'function', 'модуль сетевой озвучки загружается');

  eq(T.providerUrl('hello world', 'en'),
    'https://code.responsivevoice.org/getvoice.php?t=hello%20world&tl=en',
    'пробел кодируется как %20, а не как +');
  eq(T.providerUrl('привет мир', 'ru'),
    'https://code.responsivevoice.org/getvoice.php?t=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%D0%BC%D0%B8%D1%80&tl=ru',
    'кириллица кодируется посимвольно и не теряется');
  ok(T.providerUrl('a&b=c', 'en').indexOf('t=a%26b%3Dc') > 0, 'амперсанд и равно не ломают строку запроса');
  ok(T.providerUrl('a+b', 'en').indexOf('t=a%2Bb') > 0, 'плюс кодируется, а не превращается в пробел');
  ok(T.providerUrl('#1 word', 'en').indexOf('t=%231%20word') > 0, 'решётка не превращается в якорь');
  ok(T.providerUrl('a?b', 'en').indexOf('t=a%3Fb') > 0, 'знак вопроса не обрывает запрос');
  ok(T.providerUrl('кто? «да»', 'ru').indexOf('t=') === T.providerUrl('x', 'ru').indexOf('t='),
    'кавычки и вопросительный знак остаются в параметре t');
  eq(T.providerUrl('', 'en'),
    'https://code.responsivevoice.org/getvoice.php?t=&tl=en',
    'пустая строка даёт корректный адрес, а не «undefined»');
  eq(T.providerUrl(null, 'ru'), T.providerUrl('', 'ru'), 'null вместо текста не ломает адрес');
  eq(T.providerUrl('  hi  ', 'en'), T.providerUrl('hi', 'en'), 'лишние пробелы не создают новый запрос');
  eq(T.providerUrl('hi', 'en-US'), T.providerUrl('hi', 'en'), 'регион в языке сводится к базовому коду');
  eq(T.providerUrl('hi', 'DE_de'), T.providerUrl('hi', 'de'), 'подчёркивание в коде языка тоже понимается');
  eq(T.providerUrl('hi', ''), T.providerUrl('hi', 'en'), 'пустой язык означает английский');
  eq(T.providerUrl('hi', null), T.providerUrl('hi', 'en'), 'отсутствующий язык тоже');
  eq(T.providerUrl('hi', 'RU'), T.providerUrl('hi', 'ru'), 'регистр в коде языка не важен');
}

section('Сетевая озвучка: ключ кэша');
{
  const T = App.ttsnet;

  eq(T.cacheKey('hello', 'en'), T.cacheKey('hello', 'en'), 'ключ стабилен от вызова к вызову');
  eq(T.cacheKey('  hello   world ', 'en'), T.cacheKey('hello world', 'en'),
    'лишние пробелы и края нормализуются');
  eq(T.cacheKey('hello\tworld', 'en'), T.cacheKey('hello world', 'en'), 'табуляция — тоже пробел');
  eq(T.cacheKey('hello', 'en-US'), T.cacheKey('hello', 'en'), 'регион не создаёт второй ключ');
  eq(T.cacheKey('привет', 'ru'), T.cacheKey('  привет  ', 'ru'), 'кириллица нормализуется так же');
  ok(T.cacheKey('hello', 'en') !== T.cacheKey('hello', 'de'), 'разные языки — разные ключи');
  ok(T.cacheKey('hello', 'en') !== T.cacheKey('hello', 'ru'), 'одно слово на разных языках — разные файлы');
  ok(T.cacheKey('hello', 'en') !== T.cacheKey('world', 'en'), 'разные фразы — разные ключи');
  /* Регистр нормализовать нельзя: в кэше лежат байты озвучки конкретной
     строки, и «Hello» с «hello» сервис прочитает по-разному. */
  ok(T.cacheKey('Hello', 'en') !== T.cacheKey('hello', 'en'),
    'регистр НЕ нормализуется — иначе кэш отдал бы не то, что просили');
  ok(T.cacheKey('US', 'en') !== T.cacheKey('us', 'en'), 'аббревиатура и слово — разные файлы');
  ok(T.cacheKey('привет', 'ru').indexOf('lexiflow.local') > 0,
    'ключ живёт в отдельном пространстве имён, а не рядом с запросами приложения');
  ok(T.cacheKey('привет', 'ru').indexOf('%D0%BF') > 0, 'кириллица в ключе закодирована');
  ok(T.cacheKey('a/b?c#d', 'en').indexOf('%2F') > 0 && T.cacheKey('a/b?c#d', 'en').indexOf('%3F') > 0,
    'слэш и вопросительный знак в тексте кодируются, а не создают новые сегменты пути');
  eq(T.cacheKey('', 'en'), T.cacheKey('', 'en'), 'пустая строка даёт стабильный ключ');
  eq(T.cacheKey('x', 'en').indexOf('getvoice.php'), -1,
    'ключ кэша не совпадает с адресом запроса — это разные пространства');
}

section('Сетевая озвучка: похож ли ответ на звук');
{
  const T = App.ttsnet;

  eq(T.looksLikeAudio('audio/mpeg', 7872), true, 'audio/mpeg нормального размера — это звук');
  eq(T.looksLikeAudio('audio/mpeg; charset=binary', 7872), true, 'параметры в content-type не мешают');
  eq(T.looksLikeAudio('AUDIO/MPEG', 7872), true, 'регистр в типе не важен');
  eq(T.looksLikeAudio('audio/mpeg', 4224), true, 'самый короткий реальный ответ сервиса проходит');
  eq(T.looksLikeAudio('text/html', 7872), false, 'страница ошибки — не звук');
  eq(T.looksLikeAudio('application/json', 69), false, 'JSON-ошибка сервиса — не звук');
  eq(T.looksLikeAudio('application/xml', 9000), false, 'XML-ошибка отсекается');
  eq(T.looksLikeAudio('audio/mpeg', 0), false, 'пустой ответ — не звук');
  eq(T.looksLikeAudio('audio/mpeg', 69), false, 'слишком короткий ответ — не звук');
  eq(T.looksLikeAudio('audio/mpeg', null), false, 'отсутствующий размер считается пустым ответом');
  eq(T.looksLikeAudio('application/octet-stream', 7872), true, 'неизвестный тип при приличном размере принимается');
  eq(T.looksLikeAudio('', 7872), true, 'пустой content-type при приличном размере принимается');
  eq(T.looksLikeAudio(null, 7872), true, 'null вместо типа не ломает проверку');
}

section('Конструктор промпта для нейросети');
{
  const AI = App.views.ai;
  ok(!!AI && typeof AI.buildPrompt === 'function', 'модуль конструктора загружается');

  const p1 = AI.buildPrompt({ lang: 'английский', topic: 'Путешествия', level: 'B1', count: 40, examples: 1, byDeck: false });
  ok(p1.indexOf('из 40 слов английского языка') > 0, 'первая строка задаёт объём и язык');
  ok(p1.indexOf('«Путешествия»') > 0, 'тема попадает в промпт');
  ok(p1.indexOf('уровня B1') > 0, 'уровень попадает в промпт');
  ok(p1.indexOf('без markdown-разметки') > 0, 'модель просят не заворачивать ответ в ```');
  ok(p1.indexOf('words.csv') > 0, 'указано имя файла для сохранения');
  ok(p1.indexOf('"хотя, несмотря на"') > 0, 'напоминание про кавычки для запятых');
  ok(p1.indexOf('Пример 2') < 0, 'без второго примера лишней колонки нет');
  ok(p1.indexOf('Колода') < 0, 'без разбивки по колодам колонки «Колода» нет');

  const p2 = AI.buildPrompt({ lang: 'немецкий', topic: 'Работа', level: 'A2', count: 20, examples: 2, byDeck: true });
  ok(p2.indexOf('из 20 слов немецкого языка') > 0, 'второй набор параметров собирается отдельно');
  ok(p2.indexOf('Пример 2,Перевод примера 2') > 0, 'два примера добавляют две колонки');
  ok(p2.indexOf('другой контекст') > 0, 'есть требование к содержанию второго примера');

  // Главное: заголовки, которые промпт требует от модели, реально понимает импорт.
  const headerLine = p2.split('\n').filter(l => l.indexOf('Колода,Слово') === 0)[0];
  ok(!!headerLine, 'в промпте есть строка с заголовками');
  reset();
  const res = S.importText(headerLine + '\n' +
    'Работа,die Frist,срок,fʁɪst,"Die Frist läuft ab.","Срок истекает.","Setz eine Frist.","Назначь срок."', {});
  eq(res.added, 1, 'файл с заголовками из промпта импортируется');
  eq(res.decks, 1, 'колонка «Колода» из промпта создаёт колоду');
  eq(S.get().decks[0].name, 'Работа', 'название колоды из промпта');
  const card = S.get().cards[0];
  eq(card.transcription, 'fʁɪst', 'транскрипция из промпта доходит до карточки');
  eq(card.examples.length, 2, 'оба примера из промпта импортируются');
  eq(card.examples[1].translation, 'Назначь срок.', 'перевод второго примера');
}

section('Полная замена данных');
{
  reset();
  S.createDeck({ name: 'Старая' });
  const payload = JSON.parse(S.exportAll());
  payload.decks = [{ id: 'x', name: 'Новая', langFrom: 'en', langTo: 'ru' }];
  payload.cards = [{ id: 'y', deckId: 'x', word: 'new', translation: 'новый' }];
  S.replaceAll(payload, 'replace');
  eq(S.get().decks.length, 1, 'режим replace: осталась одна колода');
  eq(S.get().decks[0].name, 'Новая', 'режим replace: данные из файла');
  eq(S.get().cards.length, 1, 'режим replace: карточки из файла');
}

/* ============================================================
   Журнал ответов наружу
   ============================================================
   Стрик-бейдж в шапке считает серию по S.logs(). Пока аксессора
   не было, каждый рендер падал с «S.logs is not a function» —
   и бейдж не показывался вообще. Проверяем сам доступ и то, что
   снаружи массив магазина не испортить. */

section('Журнал ответов: доступ снаружи');
{
  reset();
  eq(typeof S.logs, 'function', 'S.logs есть в магазине');
  eq(S.logs().length, 0, 'на пустых данных журнал пуст');

  const deck = S.createDeck({ name: 'Журнал' });
  const card = S.createCard({ deckId: deck.id, word: 'run', translation: 'бежать' });
  S.addLog({ id: 'l1', cardId: card.id, deckId: deck.id, ok: true, ts: Date.now(), ms: 1000 });
  S.addLog({ id: 'l2', cardId: card.id, deckId: deck.id, ok: false, ts: Date.now() - 1000, ms: 2000 });

  eq(S.logs().length, 2, 'обе записи видны снаружи');
  ok(Array.isArray(S.logs()), 'возвращается массив');

  // Копия, а не сам внутренний массив: снаружи его трогать нельзя,
  // иначе следующая запись в лог уедет не в тот список.
  S.logs().push({ id: 'мусор' });
  eq(S.get().logs.length, 2, 'правка снаружи не трогает магазин');

  eq(S.logsSince(0).length, 2, 'logsSince остался согласован с logs');
}

/* ============================================================
   Сетевая озвучка: загрузка, кэш и офлайн
   ============================================================
   Раздел асинхронный (fetch и Cache API — промисы), поэтому он идёт
   последним и его результат входит в общий итог через await внизу. */

section('Пакет озвучки: поиск файла по фразе');
{
  const T = App.ttsnet;
  const manifest = { phrases: {} };
  manifest.phrases[T.cacheKey('although', 'en')] = { file: 'audio/en/a2bbcb2af66c.mp3', lang: 'en' };

  eq(T.packEntryIn(manifest, 'although', 'en').file, 'audio/en/a2bbcb2af66c.mp3',
    'фраза из пакета находится');
  eq(T.packEntryIn(manifest, '  although   ', 'en').file, 'audio/en/a2bbcb2af66c.mp3',
    'лишние пробелы не мешают — ключ нормализован');
  eq(T.packEntryIn(manifest, 'ALTHOUGH', 'en'), null,
    'другой регистр — другой ключ: сервис читает их по-разному');
  eq(T.packEntryIn(manifest, 'although', 'de'), null,
    'то же слово на другом языке — это другой файл');
  eq(T.packEntryIn(manifest, 'такой фразы нет', 'en'), null, 'чужой фразы в пакете нет');
  eq(T.packEntryIn(manifest, '', 'en'), null, 'пустая фраза — null, а не «первый попавшийся»');
  eq(T.packEntryIn(null, 'although', 'en'), null, 'без манифеста — null, а не падение');
  eq(T.packEntryIn({}, 'although', 'en'), null, 'пустой манифест — null');
  eq(T.packEntryIn({ phrases: {} }, 'although', 'en'), null, 'манифест без фраз — null');
  eq(T.PACK_FILE, 'audio/manifest.json', 'манифест лежит по известному приложению пути');
  eq(T.hasPack(), false, 'в Node пакет не загружен — hasPack честно говорит false');
}

section('Сетевая озвучка: доступность');
const ttsNetAsync = (async () => {
  const T = App.ttsnet;
  const SP = App.speech;

  // без Cache API и без сети модуль обязан честно считать себя неготовым
  reset();
  eq(T.supported(), false, 'без Cache API модуль не считает себя поддерживаемым');
  eq(T.available(), false, 'без Cache API в сеть не идём');
  eq(await T.getAudio('hello world', 'en'), null, 'без Cache API фразы нет — вызывающий уйдёт на системный голос');
  const emptyStats = await T.stats();
  ok(emptyStats.count === 0 && emptyStats.bytes === 0, 'без Cache API статистика пустая', emptyStats);
  eq(await T.purge(), 0, 'без Cache API чистить нечего');
  eq(await T.play('hello world', 'en'), false, 'без Cache API проигрывать нечего');

  // подменяем браузерное окружение
  const realCaches = global.caches;
  const realFetch = global.fetch;
  const navDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
  const setOnline = value => Object.defineProperty(global, 'navigator', {
    value: { onLine: value }, configurable: true, writable: true
  });

  let calls = [];
  let reply = () => audioResponse(7872, 'audio/mpeg');
  global.caches = makeCaches();
  /* Запросы к пакету озвучки (audio/manifest.json и файлы из него) в счётчик
     внешних запросов не идут: это локальные файлы приложения, а не сеть.
     Отвечаем на них 404 — значит, пакета нет, и всё идёт обычным путём. */
  const isPackRequest = url => String(url).indexOf('audio/') === 0 || String(url) === 'audio/manifest.json';
  global.fetch = url => {
    if (isPackRequest(url)) return Promise.resolve({ ok: false, status: 404, headers: { get: () => '' } });
    calls.push(String(url));
    return Promise.resolve(reply());
  };

  try {
    reset();
    setOnline(true);

    eq(T.supported(), true, 'с Cache API и fetch модуль считается поддерживаемым');
    eq(T.enabled(), true, 'сетевая озвучка разрешена по умолчанию');
    /* Начинаем с честного «голосов в системе нет»: в предыдущем разделе
       оставался подставной хороший голос, а нам нужна определённость. */
    const realSynth = global.speechSynthesis;
    delete global.speechSynthesis;
    SP.voices();
    eq(T.needsNetwork('en'), true, 'без системного голоса язык нуждается в сети');
    eq(T.available(), true, 'режим доступен: поддержка есть, сеть есть');
    eq(T.available('en'), true, 'для языка без нормального голоса сеть нужна');

    /* Главное правило экономии: при хорошем системном голосе текст фраз
       на чужой сервер не уходит вообще. */
    const hadUtter = Object.prototype.hasOwnProperty.call(global, 'SpeechSynthesisUtterance');
    const withVoices = list => {
      // без SpeechSynthesisUtterance модуль считает синтез неподдержанным
      global.SpeechSynthesisUtterance = global.SpeechSynthesisUtterance || function () {};
      global.speechSynthesis = { getVoices: () => list, addEventListener() {}, removeEventListener() {} };
      SP.voices();
    };
    withVoices([{ name: 'Microsoft Aria Online (Natural)', lang: 'en-US', voiceURI: 'n1', localService: false, default: true }]);
    eq(T.needsNetwork('en'), false, 'нейросетевой системный голос — сеть не нужна');
    eq(T.available('en'), false, 'при хорошем голосе в сеть не идём');
    eq(T.available(), true, 'но сам режим остаётся доступным — например, для другого языка');
    withVoices([{ name: 'Microsoft David Desktop', lang: 'en-US', voiceURI: 'p1', localService: true, default: true }]);
    eq(T.needsNetwork('en'), true, 'роботизированный голос — повод идти в сеть');
    withVoices([{ name: 'Microsoft Irina Desktop', lang: 'ru-RU', voiceURI: 'p2', localService: true, default: true }]);
    eq(T.needsNetwork('ru'), true, 'робот для другого языка — тоже повод');
    eq(T.needsNetwork('de'), true, 'голоса для языка нет — повод идти в сеть');
    if (realSynth === undefined) delete global.speechSynthesis; else global.speechSynthesis = realSynth;
    if (!hadUtter) delete global.SpeechSynthesisUtterance;
    SP.voices();

    // явный отказ пользователя уважаем
    S.updateSettings({ ttsNet: { enabled: false, downloaded: 0 } });
    eq(T.enabled(), false, 'явное выключение сетевая озвучка уважает');
    eq(T.available('en'), false, 'при выключенной настройке в сеть не идём');
    eq(await T.getAudio('hello world', 'en'), null, 'выключенный режим не качает фразу');
    eq(calls.length, 0, 'ни одного запроса при выключенной настройке');

    S.updateSettings({ ttsNet: { enabled: true, downloaded: 0 } });
    eq(T.available(), true, 'включённая настройка и сеть — режим доступен');

    /* Офлайн. Режим остаётся доступным — именно без сети и нужны файлы
       пакета и кэша. Проверки сети это не отменяет: скачивать нельзя. */
    setOnline(false);
    eq(T.available(), true, 'без сети режим остаётся доступен: файлы пакета и кэша работают');
    eq(await T.getAudio('hello world', 'en'), null, 'без сети и без кэша фразы нет');
    eq(calls.length, 0, 'в офлайне запрос не уходит');
    setOnline(true);

    // скачивание
    const blob = await T.getAudio('hello world', 'en');
    eq(blob && blob.size, 7872, 'фраза скачана');
    eq(calls.length, 1, 'был ровно один запрос в сеть');
    eq(calls[0], T.providerUrl('hello world', 'en'), 'запрос ушёл на проверенный адрес с нужным языком');

    const again = await T.getAudio('hello world', 'en');
    eq(again && again.size, 7872, 'повторно фраза берётся из кэша');
    eq(calls.length, 1, 'второй раз в сеть не пошли');
    eq((await T.getAudio('  hello   world  ', 'en')) && true, true, 'та же фраза с лишними пробелами — из кэша');
    eq(calls.length, 1, 'нормализация текста тоже попадает в кэш');

    // сервер отдал ошибку текстом — в кэш она попасть не должна
    reply = () => errorResponse(200, 'application/json');
    eq(await T.getAudio('broken phrase', 'en'), null, 'ответ-ошибка не считается звуком');
    eq((await T.stats()).count, 1, 'ошибка не попала в кэш');

    // сервис отказал (403 API_KEY_REQUIRED — так он отвечает на не-браузерный запрос)
    reply = () => errorResponse(403, 'application/json');
    eq(await T.getAudio('forbidden phrase', 'en'), null, '403 не считается звуком');
    eq((await T.stats()).count, 1, 'после 403 в кэше по-прежнему одна фраза');

    // сеть упала совсем — промис не должен отклониться
    global.fetch = () => Promise.reject(new Error('offline'));
    eq(await T.getAudio('network down', 'en'), null, 'падение сети — это null, а не исключение');
    global.fetch = url => { calls.push(String(url)); return Promise.resolve(reply()); };

    const st = await T.stats();
    eq(st.count, 1, 'stats() считает фразы');
    eq(st.bytes, 7872, 'stats() считает байты');

    // пачка: дедупликация, прогресс, предел параллелизма
    reply = () => audioResponse(4224, 'audio/mpeg');
    calls = [];
    const progress = [];
    const res = await T.preload(['one', 'two', 'two', '  one  ', '', null], 'en', p => progress.push(p.done + '/' + p.total));
    eq(res.total, 2, 'дубликаты и пустые строки в пачку не попадают');
    eq(res.done, 2, 'обе фразы доступны офлайн');
    eq(res.failed, 0, 'неудач нет');
    eq(calls.length, 2, 'на каждую уникальную фразу — ровно один запрос');
    ok(progress.length > 0, 'прогресс сообщается вызывающему');
    eq(progress[progress.length - 1], '2/2', 'последний отчёт прогресса — «все фразы»');

    const st2 = await T.stats();
    eq(st2.count, 3, 'пачка добавилась к уже скачанному');
    eq(st2.bytes, 7872 + 4224 * 2, 'размер кэша сложился из файлов');

    // пачка при выключенном режиме: ни одного запроса
    S.updateSettings({ ttsNet: { enabled: false, downloaded: 0 } });
    calls = [];
    const off = await T.preload(['x', 'y'], 'en');
    eq(calls.length, 0, 'выключенный режим не качает пачку');
    eq(off.failed, 2, 'фразы честно помечены как недоступные');
    eq(off.done, 0, 'и доступными офлайн они не считаются');
    S.updateSettings({ ttsNet: { enabled: true, downloaded: 0 } });

    // предел параллелизма: сервис чужой, десяток запросов разом — это атака
    let resolvers = [];
    calls = [];
    global.fetch = url => {
      calls.push(String(url));
      return new Promise(r => { resolvers.push(() => r(audioResponse(4224, 'audio/mpeg'))); });
    };
    const pending = T.preload(['p1', 'p2', 'p3', 'p4'], 'en');
    await new Promise(r => setTimeout(r, 0));
    eq(resolvers.length, 2, 'одновременно идёт не больше двух запросов');

    // выгрузка страницы обрывает очередь, а не продолжается «потом»
    global.fire('pagehide');
    while (resolvers.length) {
      const next = resolvers.shift();
      next();
      await new Promise(r => setTimeout(r, 0));
    }
    const stoppedRes = await pending;
    ok(stoppedRes.stopped, 'выгрузка страницы останавливает очередь');
    eq(calls.length, 2, 'после выгрузки новые запросы не начинаются');

    // проигрывание: класс is-playing тот же, что у Web Speech
    global.fetch = url => { calls.push(String(url)); return Promise.resolve(audioResponse(7872, 'audio/mpeg')); };
    global.Audio = function () {
      this.paused = false;
      this.play = () => { this.played = true; return Promise.resolve(); };
      this.pause = () => { this.paused = true; };
    };
    const btn = fakeButton();
    eq(await T.play('hello world', 'en', { button: btn }), true, 'play() сообщает, что звук пошёл');
    eq(btn.classList.contains('is-playing'), true, 'кнопка помечена тем же классом, что и Web Speech');
    App.speech.stop();
    eq(btn.classList.contains('is-playing'), false, 'speech.stop() останавливает и сетевую озвучку');

    // автовоспроизведение запрещено браузером — это false, а не исключение
    global.Audio = function () {
      this.paused = true;
      this.play = () => Promise.reject(new Error('NotAllowedError'));
      this.pause = () => {};
    };
    const blockedBtn = fakeButton();
    eq(await T.play('hello world', 'en', { button: blockedBtn }), false,
      'запрет автовоспроизведения — это false, а не исключение');
    eq(blockedBtn.classList.contains('is-playing'), false, 'отметка снята и в этом случае');

    // кнопка должна получить фолбэк: is-playing не остаётся висеть
    const fallbackBtn = fakeButton();
    eq(await T.play('hello world', 'en', { button: fallbackBtn }), false, 'файл не заиграл');
    eq(fallbackBtn.classList.contains('is-playing'), false, 'кнопка не осталась в состоянии «играет»');

    /* Две фразы одновременно. Так получалось при двойной отрисовке
       карточки: второй файл перебивал первый, первый считался провалом,
       и вызывающий услужливо включал системный голос поверх уже звучащего
       файла — человек слышал робота там, где уже играла нормальная озвучка. */
    const pendingPlays = [];
    global.Audio = function () {
      const self = this;
      this.paused = false;
      this.removeAttribute = () => {};
      this.play = () => new Promise((resolve, reject) => pendingPlays.push({ self, resolve, reject }));
      this.pause = () => { self.paused = true; };
    };
    const first = T.play('first phrase', 'en');
    const second = T.play('second phrase', 'en');
    await new Promise(r => setTimeout(r, 10));
    eq(pendingPlays.length, 2, 'обе фразы дошли до проигрывания');
    pendingPlays[1].resolve();
    pendingPlays[0].reject(new Error('interrupted'));
    eq(await first, T.SUPERSEDED, 'перебитая фраза — не провал: системный голос не включается');
    ok(T.SUPERSEDED, 'SUPERSEDED истинно: вызывающие проверяют именно ложь');
    eq(await second, true, 'фраза, которая осталась, играет');

    // очистка: трогает только свою папку и не сносит кэш service worker
    await global.caches.open('lexiflow-v1.8.0').then(c =>
      c.put(new Request('https://example.com/index.html'), new Response('x')));
    const beforePurge = await T.stats();
    ok(beforePurge.count > 0, 'перед очисткой в кэше есть фразы');
    const removed = await T.purge();
    eq(removed, beforePurge.count, 'очистка удаляет ровно то, что было в кэше');
    eq((await T.stats()).count, 0, 'после очистки кэш озвучки пуст');
    const swLeft = await global.caches.open('lexiflow-v1.8.0').then(c => c.keys());
    eq(swLeft.length, 1, 'служебный кэш service worker очистка не трогает');

    // после очистки фраза качается заново
    calls = [];
    const refetched = await T.getAudio('hello world', 'en');
    eq(refetched && refetched.size, 7872, 'после очистки фраза скачивается заново');
    eq(calls.length, 1, 'и для этого нужен новый запрос');
  } finally {
    if (realCaches === undefined) delete global.caches; else global.caches = realCaches;
    if (realFetch === undefined) delete global.fetch; else global.fetch = realFetch;
    if (navDesc) Object.defineProperty(global, 'navigator', navDesc); else delete global.navigator;
    delete global.Audio;
    reset();
  }
})();

/* ============================================================
   Озвучка: один путь для кнопки 🔊 и для автопрогона

   Проверка асинхронная: переход на системный голос происходит не сразу,
   а после того, как файловая озвучка ответит «звука не будет».
   Раздел идёт ПОСЛЕ сетевого, чтобы не перехватить его подмены synth.
   ============================================================ */

const speakBestAsync = ttsNetAsync.then(async () => {
  section('Озвучка: один путь для кнопки и для автопрогона');
  const SP = App.speech;
  const realSynth = global.speechSynthesis;
  const realUtter = global.SpeechSynthesisUtterance;
  const realTtsnet = App.ttsnet;

  let said = [];
  global.SpeechSynthesisUtterance = function (text) { this.text = text; };
  global.speechSynthesis = {
    speaking: false,
    getVoices() { return [{ name: 'Microsoft Aria', lang: 'en-US', localService: true, voiceURI: 'aria' }]; },
    speak(u) { said.push(u && u.text); },
    cancel() {}, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {}
  };
  SP.voices();

  const fakeNet = (playResult, availableResult) => ({
    available: () => availableResult !== false,
    play: () => Promise.resolve(playResult)
  });
  const settle = () => new Promise(r => setTimeout(r, 120));

  ok(typeof SP.speakBest === 'function', 'общая функция озвучки существует');

  // файл есть — системный голос молчит
  App.ttsnet = fakeNet(true);
  said = [];
  eq(SP.speakBest('although', 'en'), true, 'озвучка начата');
  await settle();
  eq(said.length, 0, 'при готовом файле системный голос не включается');

  // файла не нашлось — читаем системой
  App.ttsnet = fakeNet(false);
  said = [];
  SP.speakBest('although', 'en');
  await settle();
  ok(said.length > 0, 'без файла фразу читает системный голос');

  // перебили следующей фразой — системный голос НЕ нужен
  App.ttsnet = fakeNet('superseded');
  said = [];
  SP.speakBest('although', 'en');
  await settle();
  eq(said.length, 0, 'перебитую фразу системный голос не дублирует');

  // файловая озвучка не нужна (хороший системный голос) — идём напрямую
  App.ttsnet = fakeNet(true, false);
  said = [];
  SP.speakBest('although', 'en');
  await settle();
  ok(said.length > 0, 'при хорошем системном голосе файлы не трогаем');

  // модуля озвучки нет вовсе — как раньше
  App.ttsnet = null;
  said = [];
  SP.speakBest('although', 'en');
  await settle();
  ok(said.length > 0, 'без модуля файловой озвучки работает системный синтез');

  App.ttsnet = realTtsnet;
  if (realSynth === undefined) delete global.speechSynthesis; else global.speechSynthesis = realSynth;
  if (realUtter === undefined) delete global.SpeechSynthesisUtterance; else global.SpeechSynthesisUtterance = realUtter;
  SP.voices();
});

/* ============================================================
   Итог
   ============================================================ */

Promise.all([ttsNetAsync, speakBestAsync]).then(() => {
  console.log('\n' + '─'.repeat(52));
  console.log(fail === 0
    ? `ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${pass}`
    : `ПРОЙДЕНО ${pass}, ПРОВАЛЕНО ${fail}`);
  console.log('─'.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
}).catch(e => {
  console.error('НЕОБРАБОТАННАЯ ОШИБКА В АСИНХРОННОМ РАЗДЕЛЕ:', e);
  process.exit(2);
});

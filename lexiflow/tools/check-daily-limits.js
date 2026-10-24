/* Проверка дневных лимитов в реальном браузере.
   Запуск (нужен локальный сервер на :8777):
     NODE_PATH=<...node_modules> node tools/check-daily-limits.js

   Что проверяем: лимит повторений — ДНЕВНОЙ. Раньше из настройки
   maxReviewsPerDay вычиталось только «сколько взять в эту сессию», поэтому
   «5 в день» означало 5 за каждый запуск. Теперь в сессию попадает остаток
   на день, а на стартовом экране появляется строка с объяснением.

   Сценарии:
   1. часть лимита выбрана — в сессию идёт остаток, строка на месте;
   2. лимит исчерпан — в сессию не идёт ничего, строка говорит «исчерпан»,
      а галочка «Учитывать дневные лимиты» возвращает все карточки;
   3. шаги обучения и ответы в тесте лимит не расходуют;
   4. вчерашние ответы не считаются;
   5. лимит новых карточек живёт своей жизнью (newPerDay).
*/
var path = require('path');
var fs = require('fs');
var { chromium } = require('playwright');

var BASE = process.env.LEXIFLOW_BASE || 'http://127.0.0.1:8777/';
var out = [];
var pass = 0, fail = 0;
function log(s) { out.push(s); console.log(s); }
function check(name, actual, expected) {
  var ok = actual === expected;
  if (ok) pass++; else fail++;
  log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : ' → получено ' + JSON.stringify(actual) + ', ожидалось ' + JSON.stringify(expected)));
}
function section(s) { log('\n' + s); }

var REVIEW_SRS = {
  state: 'review', step: 0, interval: 1, ease: 2.5,
  due: 0, reps: 3, lapses: 0, leech: false, lastReview: 0
};

/* Данные заливаем через API приложения: прямой localStorage сбивает flush на
   pagehide — приложение переживает перезагрузку и возвращает свой набор. */
async function seed(page, cfg) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return page.evaluate(function (cfg) {
    var now = Date.now();
    App.store.wipe();
    var deck = {
      id: 'dt', name: 'Лимиты', createdAt: now, updatedAt: now,
      langFrom: 'en', langTo: 'ru',
      settings: Object.assign({}, App.srs.DEFAULT_SETTINGS, cfg.settings || {})
    };
    var cards = [];
    var i;
    for (i = 0; i < (cfg.dueCards || 0); i++) {
      cards.push({
        id: 'r' + i, deckId: 'dt', word: 'wd' + i, translation: 'сл' + i,
        createdAt: now - 100000, updatedAt: now - 100000,
        // срок наступил час назад: карточка честно «к повторению»
        srs: Object.assign({}, cfg.srs, { due: now - 3600000 - i * 1000, lastReview: now - 86400000 })
      });
    }
    for (i = 0; i < (cfg.newCards || 0); i++) {
      cards.push({
        id: 'n' + i, deckId: 'dt', word: 'nw' + i, translation: 'нв' + i,
        createdAt: now - 100000 + i, updatedAt: now - 100000 + i,
        srs: App.srs.newState(deck.settings, now)
      });
    }
    var logs = cfg.logs.map(function (l, k) {
      return {
        id: 'lg' + k, ts: now - 60000 * (k + 1), grade: 3, mode: 'flip', dir: 'fwd',
        correct: true, ms: 900, deckId: 'dt', cardId: 'seen' + k,
        stateFrom: l.stateFrom || 'review', stateTo: 'review', test: !!l.test
      };
    });
    App.store.replaceAll({
      version: 1, decks: [deck], cards: cards,
      settings: Object.assign({}, App.store.settings(), cfg.appSettings || {}),
      logs: logs, tombstones: [], meta: { seeded: true }
    }, 'replace');
    return { cards: App.store.get().cards.length, logs: App.store.get().logs.length, now: now };
  }, cfg);
}

async function openStart(page) {
  await page.evaluate(function () { App.router.go('#/study/dt'); });
  await page.waitForTimeout(500);
  return page.evaluate(function () {
    var sub = document.querySelector('.page-sub');
    var note = document.querySelector('.nudge--limit');
    return {
      sub: sub ? sub.textContent.replace(/\s+/g, ' ').trim() : '',
      note: note ? note.textContent.replace(/\s+/g, ' ').trim() : null
    };
  });
}

async function plannedCards(page, toggleLimits) {
  if (toggleLimits === false) {
    await page.evaluate(function () {
      var cb = document.querySelector('.switch-row input[type=checkbox]');
      cb.click();
    });
    await page.waitForTimeout(400);
  }
  await page.evaluate(function () {
    var btn = Array.prototype.find.call(document.querySelectorAll('.btn'), function (b) {
      return /Начать тренировку/.test(b.textContent);
    });
    btn.click();
  });
  await page.waitForTimeout(700);
  var res = await page.evaluate(function () {
    var s = App.views.study.activeSession();
    return {
      planned: s ? s.totalPlanned : -1,
      title: document.querySelector('.result__title') ? document.querySelector('.result__title').textContent : null,
      sub: document.querySelector('.result__sub') ? document.querySelector('.result__sub').textContent : null
    };
  });
  return res;
}

(async function () {
  var browser = await chromium.launch({ args: ['--mute-audio'] });
  var errors = [];

  async function freshPage() {
    var ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    var page = await ctx.newPage();
    page.on('pageerror', function (e) { errors.push(String(e && e.message || e)); });
    page.on('console', function (m) {
      if (m.type() === 'error' && !/beacon|analytics|favicon/i.test(m.text())) errors.push(m.text());
    });
    return page;
  }

  /* --- 1. Часть лимита уже выбрана --- */
  section('Лимит 5 в день, сегодня отвечено 3');
  var p1 = await freshPage();
  await seed(p1, {
    dueCards: 12, srs: REVIEW_SRS,
    settings: { maxReviewsPerDay: 5, newPerDay: 0 },
    logs: [{}, {}, {}]
  });
  var st1 = await openStart(p1);
  check('в стартовой строке «12 к повторению»', /^12 к повторению/.test(st1.sub), true);
  check('строка о лимите показана', !!st1.note, true);
  check('в строке числа 3 из 5', /3 из 5/.test(st1.note || ''), true);
  check('в строке сказано, сколько попадёт (2 карточки)', /2 карточки/.test(st1.note || ''), true);
  var q1 = await plannedCards(p1);
  check('в сессии ровно остаток — 2 карточки', q1.planned, 2);

  /* --- 2. Лимит исчерпан --- */
  section('Лимит 5 в день, сегодня отвечено 5');
  var p2 = await freshPage();
  await seed(p2, {
    dueCards: 12, srs: REVIEW_SRS,
    settings: { maxReviewsPerDay: 5, newPerDay: 0 },
    logs: [{}, {}, {}, {}, {}]
  });
  var st2 = await openStart(p2);
  check('строка говорит «исчерпан»', /исчерпан/.test(st2.note || ''), true);
  check('в строке числа 5 из 5', /5 из 5/.test(st2.note || ''), true);
  var q2 = await plannedCards(p2);
  check('в сессию не попадает ничего', q2.planned, 0);
  check('честно сказано, что повторять нечего', /нечего повторять/.test(q2.sub || ''), true);

  var p2b = await freshPage();
  await seed(p2b, {
    dueCards: 12, srs: REVIEW_SRS,
    settings: { maxReviewsPerDay: 5, newPerDay: 0 },
    logs: [{}, {}, {}, {}, {}]
  });
  await openStart(p2b);
  var st2b = await p2b.evaluate(function () {
    var cb = document.querySelector('.switch-row input[type=checkbox]');
    cb.click();
    return true;
  });
  await p2b.waitForTimeout(400);
  var noteGone = await p2b.evaluate(function () { return !document.querySelector('.nudge--limit'); });
  check('галочка «без лимитов» убирает строку', noteGone, true);
  await p2b.evaluate(function () {
    var btn = Array.prototype.find.call(document.querySelectorAll('.btn'), function (b) {
      return /Начать тренировку/.test(b.textContent);
    });
    btn.click();
  });
  await p2b.waitForTimeout(700);
  var q2b = await p2b.evaluate(function () {
    var s = App.views.study.activeSession();
    return s ? s.totalPlanned : -1;
  });
  check('без лимитов в сессию идут все 12', q2b, 12);

  /* --- 3. Обучение и тест лимит не расходуют --- */
  section('Сегодня только шаги обучения и тест');
  var p3 = await freshPage();
  await seed(p3, {
    dueCards: 12, srs: REVIEW_SRS,
    settings: { maxReviewsPerDay: 5, newPerDay: 0 },
    logs: [
      { stateFrom: 'new' }, { stateFrom: 'learning' },
      { stateFrom: 'review', test: true }
    ]
  });
  var st3 = await openStart(p3);
  check('шаги обучения и тест лимит не съели — 0 из 5', /0 из 5/.test(st3.note || ''), true);
  var q3 = await plannedCards(p3);
  check('в сессии все 5 по лимиту', q3.planned, 5);

  /* --- 4. Вчерашние ответы не считаются --- */
  section('Вчера было 5 повторений, сегодня ни одного');
  var p4 = await freshPage();
  var seed4 = await seed(p4, {
    dueCards: 12, srs: REVIEW_SRS,
    settings: { maxReviewsPerDay: 5, newPerDay: 0 },
    logs: [{}, {}, {}, {}, {}]
  });
  await p4.evaluate(function (n) {
    App.store.get().logs.forEach(function (l) { l.ts = n - 86400000; });
    App.store.flush();
    App.router.refresh();
  }, seed4.now);
  await p4.waitForTimeout(400);
  var st4 = await openStart(p4);
  check('вчерашние не в счёте — 0 из 5', /0 из 5/.test(st4.note || ''), true);
  var q4 = await plannedCards(p4);
  check('в сессии снова полный лимит — 5', q4.planned, 5);

  /* --- 5. Лимит новых карточек не сломан --- */
  section('Новые карточки: newPerDay = 2');
  var p5 = await freshPage();
  await seed(p5, {
    newCards: 6, dueCards: 0, srs: REVIEW_SRS,
    settings: { maxReviewsPerDay: 300, newPerDay: 2 },
    logs: []
  });
  var st5 = await openStart(p5);
  check('строки о лимите повторений нет', st5.note, null);
  var q5 = await plannedCards(p5);
  check('в сессии 2 новых карточки', q5.planned, 2);

  section('Ошибки консоли');
  check('ошибок нет', errors.length ? errors.join(' | ') : 0, 0);

  /* --- 6. Как это выглядит на телефоне --- */
  var mctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
  });
  var mp = await mctx.newPage();
  await seed(mp, {
    dueCards: 12, srs: REVIEW_SRS,
    settings: { maxReviewsPerDay: 5, newPerDay: 0 },
    logs: [{}, {}, {}, {}, {}]
  });
  await openStart(mp);
  await mp.screenshot({ path: path.join(__dirname, 'output', 'daily-limit-mobile.png'), fullPage: true });
  log('Снимок экрана: tools/output/daily-limit-mobile.png');

  await browser.close();
  log('\n' + '─'.repeat(52));
  log(fail === 0 ? 'ПРОВЕРКА ПРОЙДЕНА: ' + pass + ' из ' + pass : 'ПРОЙДЕНО ' + pass + ', ПРОВАЛЕНО ' + fail);
  fs.writeFileSync(path.join(__dirname, 'output', 'daily-limits.txt'), out.join('\n'), 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  log('FAIL ' + (e && e.stack || e));
  try { fs.writeFileSync(path.join(__dirname, 'output', 'daily-limits.txt'), out.join('\n'), 'utf8'); } catch (x) {}
  process.exit(1);
});

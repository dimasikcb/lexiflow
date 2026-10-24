/* Проверка в реальном браузере: интервалы на кнопках оценки и уведомления
   по каждому слову, которому наступил срок.

   Запуск (нужен локальный сервер на :8777):
     NODE_PATH=<...node_modules> node tools/check-word-notify.js

   Почему отдельный скрипт, а не unit-тест: и предпросмотр интервалов, и
   показ уведомлений — это путь через DOM, store и Notification API.
*/
var path = require('path');
var fs = require('fs');
var { chromium } = require('playwright');

var BASE = process.env.LEXIFLOW_BASE || 'http://127.0.0.1:8777/index.html';
var out = [];
var pass = 0, fail = 0;
function log(s) { out.push(s); console.log(s); }
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : ' → получено ' + JSON.stringify(actual) + ', ожидалось ' + JSON.stringify(expected)));
}
function ok(cond, name, extra) {
  if (cond) pass++; else fail++;
  log((cond ? '  ✓ ' : '  ✗ ') + name + (cond || extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
function section(s) { log('\n' + s); }

/* Карточка «на повторении», срок которой уже наступил. */
function reviewCard(i, offsetMs) {
  var now = Date.now();
  return {
    state: 'review', step: 0, interval: 1, ease: 2.5,
    due: now - (offsetMs || 60000) - i * 1000,
    reps: 3, lapses: 0, leech: false, lastReview: now - 86400000
  };
}

async function seed(page, cfg) {
  return page.evaluate(function (cfg) {
    var now = Date.now();
    App.store.wipe();
    var deck = {
      id: 'dn', name: 'Долг', createdAt: now, updatedAt: now, langFrom: 'en', langTo: 'ru',
      settings: Object.assign({}, App.srs.DEFAULT_SETTINGS, { newPerDay: 0, maxReviewsPerDay: 300 })
    };
    var cards = (cfg.cards || []).map(function (c, i) {
      return {
        id: 'c' + i, deckId: 'dn', word: c.word, translation: c.translation,
        createdAt: now - 100000, updatedAt: now - 100000, srs: c.srs
      };
    });
    App.store.replaceAll({
      version: 1, decks: [deck], cards: cards,
      settings: Object.assign({}, App.store.settings(), {
        notify: Object.assign({ enabled: true, time: '19:00', days: [0, 1, 2, 3, 4, 5, 6], onlyIfDue: true, perCard: cfg.perCard !== false, lastShown: '' })
      }),
      logs: [], tombstones: [], meta: { seeded: true }
    }, 'replace');
    return { cards: App.store.get().cards.length, enabled: App.notify.settings().enabled };
  }, cfg);
}

(async function () {
  var browser = await chromium.launch({ args: ['--mute-audio'] });

  /* ============================================================
     1. Интервалы на кнопках оценки
     ============================================================ */
  section('Интервалы на новой карточке: «Снова» и «Трудно» не должны совпадать');
  var pv = await browser.newPage();
  var errs = [];
  pv.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
  await pv.goto(BASE, { waitUntil: 'load' });
  await pv.waitForTimeout(500);
  await pv.evaluate(function () {
    App.store.wipe();
    var now = Date.now();
    App.store.replaceAll({
      version: 1,
      decks: [{ id: 'dp', name: 'Новые', createdAt: now, updatedAt: now, langFrom: 'en', langTo: 'ru', settings: App.srs.DEFAULT_SETTINGS }],
      cards: [{ id: 'n1', deckId: 'dp', word: 'alpha', translation: 'альфа', createdAt: now, updatedAt: now, srs: App.srs.newState(App.srs.DEFAULT_SETTINGS, now) }],
      settings: App.store.settings(), logs: [], tombstones: [], meta: { seeded: true }
    }, 'replace');
    App.router.go('#/study/dp');
  });
  await pv.waitForTimeout(400);
  await pv.click('.btn:has-text("Начать тренировку")');
  await pv.waitForTimeout(600);
  await pv.locator('.btn:has-text("Показать ответ")').click().catch(function () {});
  await pv.waitForTimeout(400);

  var rates = await pv.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.rate'), function (b) {
      return {
        label: b.querySelector('.rate__label').textContent,
        interval: b.querySelector('.rate__interval').textContent
      };
    });
  });
  log('  интервалы: ' + rates.map(function (r) { return r.label + ' = ' + r.interval; }).join(' | '));
  check('четыре кнопки оценки', rates.length, 4);
  check('«Снова» — минута', rates[0] && rates[0].interval, '1 мин');
  check('«Трудно» — середина между шагами (5,5 мин округляются до 6)', rates[1] && rates[1].interval, '6 мин');
  check('«Нормально» — следующий шаг', rates[2] && rates[2].interval, '10 мин');
  ok(rates[0] && rates[1] && rates[0].interval !== rates[1].interval,
    'у «Снова» и «Трудно» разные интервалы', rates);

  /* та же проверка на «повторении»: 1 день → 1,2 дня / 2,5 дня / 3,25 дня */
  var rates2 = await pv.evaluate(function () {
    var SRS = App.srs;
    var st = SRS.sanitizeSettings(App.srs.DEFAULT_SETTINGS);
    var card = { srs: { state: 'review', step: 0, interval: 1, ease: 2.5, due: Date.now() - 1000, reps: 2, lapses: 0 } };
    return SRS.preview(card, st, Date.now());
  });
  log('  повторение 1 день: ' + JSON.stringify(rates2));
  ok(rates2[1] !== rates2[2] && rates2[2] !== rates2[3] && rates2[1] !== rates2[3],
    'все четыре оценки на повторении дают разный срок', rates2);

  /* ============================================================
     2. Уведомления по каждому слову
     ============================================================ */
  section('Уведомление на каждое слово, которому наступил срок');

  /* Service worker выключен маршрутом: проверяем логику уведомлений, а не
     фоновую доставку. Иначе headless-браузер уводит showNotification в
     системный канал, и увидеть текст невозможно. */
  var ctx = await browser.newContext();
  await ctx.route('**/sw.js', function (route) { route.abort(); });
  await ctx.addInitScript(function () {
    window.__shown = [];
    var N = function (title, options) {
      window.__shown.push({ title: title, body: options && options.body, tag: options && options.tag, vibrate: options && options.vibrate, silent: options && options.silent });
    };
    N.permission = 'granted';
    N.requestPermission = function () { return Promise.resolve('granted'); };
    Object.defineProperty(window, 'Notification', { configurable: true, value: N });
  });
  var page = await ctx.newPage();
  page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  await seed(page, {
    cards: [
      { word: 'alpha', translation: 'альфа', srs: reviewCard(0) },
      { word: 'beta', translation: 'бета', srs: reviewCard(1) },
      { word: 'gamma', translation: 'гамма', srs: reviewCard(2) }
    ]
  });

  var first = await page.evaluate(function () {
    return App.notify.announceDue(Date.now(), true).then(function (n) {
      return { count: n, shown: window.__shown.slice() };
    });
  });
  check('показано три уведомления — по одному на слово', first.count, 3);
  check('заголовки — сами слова', first.shown.map(function (s) { return s.title; }).sort(), ['alpha', 'beta', 'gamma']);
  ok(first.shown.every(function (s) { return /пора повторить/.test(s.body || ''); }),
    'в каждом уведомлении текст «пора повторить»', first.shown);
  check('у каждого слова свой тег', new Set(first.shown.map(function (s) { return s.tag; })).size, 3);
  check('у уведомления включён звук (silent: false)', first.shown[0] && first.shown[0].silent, false);
  check('у уведомления есть вибрация', first.shown[0] && Array.isArray(first.shown[0].vibrate), true);
  var chimed = await page.evaluate(function () { return App.notify.chime(); });
  check('звук уведомления проигрывается страницей', chimed, true);

  var second = await page.evaluate(function () {
    return App.notify.announceDue(Date.now(), true).then(function (n) { return { count: n, shown: window.__shown.length }; });
  });
  check('повторный запуск ничего не дублирует', second.count, 0);
  check('всего уведомлений всё ещё три', second.shown, 3);

  /* список для service worker-а лежит в IndexedDB */
  var due = await page.evaluate(function () {
    return App.notify.readDue().then(function (rec) {
      return rec ? {
        items: rec.items.length,
        words: rec.items.map(function (i) { return i.word; }).sort(),
        perCard: rec.perCard,
        announced: Object.keys(rec.announced || {}).length
      } : null;
    });
  });
  check('в зеркале для service worker-а лежат все три слова', due && due.items, 3);
  check('слова в зеркале совпадают', due && due.words, ['alpha', 'beta', 'gamma']);
  check('переключатель perCard доехал до зеркала', due && due.perCard, true);
  check('объявленные отмечены', due && due.announced, 3);

  /* ============================================================
     3. Переключатель «Писать о каждом слове»
     ============================================================ */
  section('Переключатель выключен — сводных уведомлений о словах нет');
  var off = await page.evaluate(function () {
    return App.notify.configure({ perCard: false }).then(function () {
      App.store.get().cards.forEach(function (c) { c.srs.due = Date.now() - 5000; });
      window.__shown.length = 0;
      return App.notify.announceDue(Date.now(), true);
    }).then(function (n) {
      return { count: n, shown: window.__shown.length, perCard: App.notify.settings().perCard };
    });
  });
  check('в настройках выключено', off.perCard, false);
  check('уведомлений о словах нет', off.count, 0);
  check('и в браузер ничего не показано', off.shown, 0);

  /* ============================================================
     4. Пачка и пауза
     ============================================================ */
  section('Семь должников за раз — не больше пяти уведомлений');
  var many = [];
  for (var i = 0; i < 7; i++) {
    many.push({ word: 'w' + i, translation: 'п' + i, srs: reviewCard(i) });
  }
  var batch = await page.evaluate(function (cards) {
    App.store.wipe();
    var now = Date.now();
    App.store.replaceAll({
      version: 1,
      decks: [{ id: 'dn', name: 'Долг', createdAt: now, updatedAt: now, langFrom: 'en', langTo: 'ru', settings: App.srs.DEFAULT_SETTINGS }],
      cards: cards.map(function (c, i) {
        return { id: 'c' + i, deckId: 'dn', word: c.word, translation: c.translation, createdAt: now, updatedAt: now, srs: c.srs };
      }),
      settings: Object.assign({}, App.store.settings(), { notify: { enabled: true, time: '19:00', days: [0, 1, 2, 3, 4, 5, 6], onlyIfDue: true, perCard: true, lastShown: '' } }),
      logs: [], tombstones: [], meta: { seeded: true }
    }, 'replace');
    window.__shown.length = 0;
    return App.notify.announceDue(Date.now(), true).then(function (n) {
      var firstCount = n;
      return App.notify.announceDue(Date.now(), false).then(function (n2) {
        return { first: firstCount, second: n2, shown: window.__shown.length };
      });
    });
  }, many);
  check('за один раз не больше пяти', batch.first, 5);
  check('второй запуск с паузой — ничего', batch.second, 0);
  check('всего в браузер ушло пять', batch.shown, 5);

  /* ============================================================
     5. Слово «созревает» само — без нажатий
     ============================================================ */
  section('Слово «созревает» — уведомление приходит само, по сроку');
  var armed = await page.evaluate(function () {
    var now = Date.now();
    App.store.wipe();
    App.store.replaceAll({
      version: 1,
      decks: [{ id: 'dt', name: 'Скоро', createdAt: now, updatedAt: now, langFrom: 'en', langTo: 'ru', settings: App.srs.DEFAULT_SETTINGS }],
      cards: [{
        id: 'timed', deckId: 'dt', word: 'timed', translation: 'своевременный',
        createdAt: now, updatedAt: now,
        srs: { state: 'review', step: 0, interval: 1, ease: 2.5, due: now + 2500, reps: 2, lapses: 0 }
      }],
      settings: Object.assign({}, App.store.settings(), {
        notify: { enabled: true, time: '19:00', days: [0, 1, 2, 3, 4, 5, 6], onlyIfDue: true, perCard: true, lastShown: '' }
      }),
      logs: [], tombstones: [], meta: { seeded: true }
    }, 'replace');
    window.__shown.length = 0;
    return { next: App.notify.nextDueAt(Date.now()) > 0 };
  });
  check('будильник поставлен на будущий срок', armed.next, true);

  await page.waitForTimeout(6000);
  var auto = await page.evaluate(function () {
    return { titles: window.__shown.map(function (s) { return s.title; }) };
  });
  check('уведомление пришло само, без вызовов', auto.titles, ['timed']);

  /* ============================================================
     5.5. Запасной путь: браузер не умеет/запретил — напоминаем внутри
     ============================================================ */
  section('Уведомления запрещены — напоминание всё равно видно в приложении');
  var deniedCtx = await browser.newContext();
  await deniedCtx.route('**/sw.js', function (route) { route.abort(); });
  await deniedCtx.addInitScript(function () {
    var N = function () {};
    N.permission = 'denied';
    N.requestPermission = function () { return Promise.resolve('denied'); };
    Object.defineProperty(window, 'Notification', { configurable: true, value: N });
  });
  var dpage = await deniedCtx.newPage();
  dpage.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
  await dpage.goto(BASE, { waitUntil: 'load' });
  await dpage.waitForTimeout(500);
  await seed(dpage, {
    cards: [
      { word: 'absent', translation: 'отсутствующий', srs: reviewCard(0) },
      { word: 'brisk', translation: 'бодрый', srs: reviewCard(1) }
    ]
  });
  await dpage.evaluate(function () { App.notify.start(); });
  await dpage.waitForTimeout(1500);
  var inApp = await dpage.evaluate(function () {
    var t = document.querySelector('.toast');
    return t ? t.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  ok(!!inApp && /absent|brisk/.test(inApp), 'всплывающая строка называет слово', inApp);
  ok(!!inApp && /ещё 1 слово/.test(inApp), 'и говорит, что ещё есть слова', inApp);

  section('Ошибки консоли');
  check('ошибок нет', errs.length ? errs.join(' | ') : 0, 0);

  await browser.close();
  log('\n' + '─'.repeat(52));
  log(fail === 0 ? 'ПРОВЕРКА ПРОЙДЕНА: ' + pass + ' из ' + pass : 'ПРОЙДЕНО ' + pass + ', ПРОВАЛЕНО ' + fail);
  fs.writeFileSync(path.join(__dirname, 'output', 'word-notify.txt'), out.join('\n'), 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  log('FAIL ' + (e && e.stack || e));
  try { fs.writeFileSync(path.join(__dirname, 'output', 'word-notify.txt'), out.join('\n'), 'utf8'); } catch (x) {}
  process.exit(1);
});

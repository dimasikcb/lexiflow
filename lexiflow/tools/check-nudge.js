/* Одноразовая проверка: подсказка-вход в напоминания на экране колод.
   Сценарии: (1) разрешение запрещено — объясняем; (2) разрешение выдано —
   клик включает напоминания и подсказка уходит. */
var path = require('path');
var fs = require('fs');
var { chromium } = require('playwright');

var BASE = 'http://127.0.0.1:8777/';
var out = [];
function log(s) { out.push(s); }

/* Данные заливаем через API приложения (S.wipe/replaceAll): прямой
   localStorage сбивает flush на pagehide — приложение переживает перезагрузку
   и возвращает свой набор. */
async function seed(page, cards) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  var res = await page.evaluate(function (cards) {
    var now = Date.now();
    var deckId = 'deck-nudge';
    App.store.wipe();
    App.store.replaceAll({
      version: 1,
      decks: [{ id: deckId, name: 'Тест', description: '', createdAt: now, updatedAt: now }],
      cards: cards.map(function (c, i) {
        return {
          id: 'c' + i, deckId: deckId, front: 'word' + i, back: 'слово' + i,
          srs: c.srs, createdAt: now, updatedAt: now
        };
      }),
      settings: { notify: { enabled: false }, dailyGoal: 20 },
      logs: [], tombstones: []
    }, 'replace');
    App.router.go('#/decks');
    return { decks: App.store.get().decks.length, cards: App.store.get().cards.length };
  }, cards);
  log('Сид: колод=' + res.decks + ' карточек=' + res.cards);
}

var NEW_SRS = { state: 'new', due: 0, step: 0, ease: 2.5, lapses: 0, reps: 0 };
var FUTURE_SRS = { state: 'review', due: 9999999999999, step: 0, ease: 2.5, lapses: 0, reps: 3 };

(async function () {
  var browser = await chromium.launch({ args: ['--mute-audio'] });

  /* --- 1. Разрешение запрещено (headless по умолчанию) --- */
  var ctx1 = await browser.newContext();
  var page1 = await ctx1.newPage();
  var err1 = [];
  page1.on('pageerror', function (e) { err1.push(String(e)); });
  await seed(page1, [{ srs: NEW_SRS }, { srs: NEW_SRS }, { srs: NEW_SRS }, { srs: NEW_SRS }]);
  await page1.waitForSelector('.nudge', { timeout: 5000 });
  var t1 = await page1.evaluate(function () {
    return document.querySelector('.nudge').textContent.replace(/\s+/g, ' ').trim();
  });
  log('ЗАПРЕЩЕНО · баннер: ' + t1);
  await page1.click('.nudge .btn--primary');
  await page1.waitForTimeout(1000);
  var a1 = await page1.evaluate(function () {
    var t = document.querySelector('.toast');
    return {
      toast: t ? t.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : null,
      enabled: App.notify.settings().enabled
    };
  });
  log('ЗАПРЕЩЕНО · клик: toast=' + a1.toast + ' enabled=' + a1.enabled);
  log('ЗАПРЕЩЕНО · ошибки: ' + (err1.length ? err1.join(' | ') : 'нет'));

  /* --- 2. Разрешение выдано --- */
  /* Headless Chromium выдаёт 'denied' для уведомлений и grantPermissions
     это не меняет — эмулируем «пользователь разрешил» заглушкой API до
     загрузки скриптов приложения: сценарий «разрешение выдано» проверяем
     логику, а не браузер. */
  var ctx2 = await browser.newContext();
  await ctx2.addInitScript(function () {
    var N = function (title, options) { window.__shown.push({ title: title, options: options }); };
    N.permission = 'granted';
    N.requestPermission = function () { return Promise.resolve('granted'); };
    window.__shown = [];
    Object.defineProperty(window, 'Notification', { configurable: true, value: N });
  });
  var page2 = await ctx2.newPage();
  var err2 = [];
  page2.on('pageerror', function (e) { err2.push(String(e)); });
  await page2.goto(BASE, { waitUntil: 'load' });
  await page2.waitForTimeout(400);
  // разрешение уже эмулировано заглушкой Notification
  await page2.reload({ waitUntil: 'load' });
  await seed(page2, [{ srs: NEW_SRS }, { srs: NEW_SRS }, { srs: NEW_SRS }, { srs: NEW_SRS }]);
  var perm2 = await page2.evaluate(function () { return App.notify.permission(); });
  log('РАЗРЕШЕНО · permission=' + perm2);
  await page2.waitForSelector('.nudge', { timeout: 5000 });
  var t2 = await page2.evaluate(function () {
    return document.querySelector('.nudge').textContent.replace(/\s+/g, ' ').trim();
  });
  log('РАЗРЕШЕНО · баннер: ' + t2);
  await page2.click('.nudge .btn--primary');
  await page2.waitForTimeout(1200);
  var a2 = await page2.evaluate(function () {
    var cfg = App.notify.settings();
    return {
      enabled: cfg.enabled,
      time: cfg.time,
      days: cfg.days,
      nudgeGone: !document.querySelector('.nudge')
    };
  });
  log('РАЗРЕШЕНО · после клика: ' + JSON.stringify(a2));
  log('РАЗРЕШЕНО · ошибки: ' + (err2.length ? err2.join(' | ') : 'нет'));

  /* --- 3. Включено — баннера нет --- */
  await page2.evaluate(function () { App.store.updateSettings({ notify: { enabled: true } }); App.router.go('#/decks'); });
  await page2.waitForTimeout(500);
  var noNudge = await page2.evaluate(function () { return !document.querySelector('.nudge'); });
  log('ВКЛЮЧЕНО · баннера нет: ' + noNudge);

  /* --- 4. Всё повторено позже, новых нет — тоже нет --- */
  await page2.evaluate(function (srs) {
    App.store.wipe();
    App.store.replaceAll({
      version: 1,
      decks: [{ id: 'deck-nudge', name: 'Тест', description: '', createdAt: Date.now(), updatedAt: Date.now() }],
      cards: [0, 1, 2].map(function (i) {
        return { id: 'c' + i, deckId: 'deck-nudge', front: 'w' + i, back: 'с' + i, srs: srs, createdAt: 1, updatedAt: 1 };
      }),
      settings: { notify: { enabled: false }, dailyGoal: 20 },
      logs: [], tombstones: []
    }, 'replace');
    App.router.go('#/decks');
  }, FUTURE_SRS);
  await page2.waitForTimeout(500);
  var noNudge2 = await page2.evaluate(function () { return !document.querySelector('.nudge'); });
  log('ВСЁ ПОВТОРЕНО · баннера нет: ' + noNudge2);

  /* --- 5. Есть к повторению — баннер с должным числом --- */
  await page2.evaluate(function (srs) {
    App.store.wipe();
    App.store.replaceAll({
      version: 1,
      decks: [{ id: 'deck-nudge', name: 'Тест', description: '', createdAt: 1, updatedAt: 1 }],
      cards: [0, 1, 2].map(function (i) {
        return { id: 'c' + i, deckId: 'deck-nudge', front: 'w' + i, back: 'с' + i, srs: srs, createdAt: 1, updatedAt: 1 };
      }),
      settings: { notify: { enabled: false }, dailyGoal: 20 },
      logs: [], tombstones: []
    }, 'replace');
    App.store.get().cards.forEach(function (c, i) { c.srs.due = Date.now() - 1000 - i; });
    App.router.go('#/decks');
  }, FUTURE_SRS);
  await page2.waitForTimeout(500);
  var t5 = await page2.evaluate(function () {
    var n = document.querySelector('.nudge');
    return n ? n.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : 'НЕТ БАННЕРА';
  });
  log('ДОЛГ · баннер: ' + t5);
  log('ДОЛГ · ошибки: ' + (err2.length ? err2.join(' | ') : 'нет'));

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'output', 'nudge-check.txt'), out.join('\n'), 'utf8');
  console.log(out.join('\n'));
})().catch(function (e) {
  fs.writeFileSync(path.join(__dirname, 'output', 'nudge-check.txt'), out.join('\n') + '\nFAIL: ' + e, 'utf8');
  console.log(out.join('\n'));
  console.log('FAIL', e);
  process.exit(1);
});

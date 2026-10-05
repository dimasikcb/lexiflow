/* Временная проверка логики дней и периодического синка (удаляется после прогона). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storage = {};
global.window = global;
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: k => { delete storage[k]; }
};
global.document = {
  addEventListener() {}, removeEventListener() {},
  body: { contains: () => false },
  visibilityState: 'visible'
};
Object.defineProperty(global, 'navigator', {
  value: { userAgent: 'node-check' },
  configurable: true, writable: true
});

const ROOT = __dirname;
['js/util.js', 'js/srs.js', 'js/store.js', 'js/notify.js'].forEach(f => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
});

const S = App.store, N = App.notify;
let failed = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? '  ok ' : '  FAIL ') + label + (ok ? '' : ' → ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected)));
}

/* понедельник 2026-10-05, локальный полдень (getDay() === 1) */
const NOON = new Date(2026, 9, 5, 12, 0, 0).getTime();
eq(new Date(NOON).getDay(), 1, 'контроль дня недели (понедельник)');

const base = { now: NOON, time: '11:00', due: 5, enabled: true, onlyIfDue: true, lastShown: '' };
eq(N.shouldNotify(Object.assign({}, base, { days: [1] })), true, 'понедельник в списке → показать');
eq(N.shouldNotify(Object.assign({}, base, { days: [0] })), false, 'воскресенье вместо понедельника → молчать');
eq(N.shouldNotify(Object.assign({}, base, { days: [] })), true, 'пустой список = все дни → показать');
eq(N.shouldNotify(Object.assign({}, base, { days: 'мусор' })), true, 'битый список = все дни → показать');
eq(N.shouldNotify(Object.assign({}, base, { days: [1, 3] })), true, 'один из нескольких дней совпал → показать');
eq(N.shouldNotify(Object.assign({}, base, { days: [2, 3, 4, 5, 6] })), false, 'будни без понедельника → молчать');

eq(N.normalizeDays([3, 1, 3, '2', 9, -1]), [1, 2, 3], 'normalizeDays: сортировка, уникальность, чистка');
eq(N.normalizeDays('мусор'), null, 'normalizeDays: не массив → null');
eq(N.normalizeDays([]), null, 'normalizeDays: пусто → null');
eq(N.dayAllowed([1], 1), true, 'dayAllowed: понедельник разрешён');
eq(N.dayAllowed([1], 2), false, 'dayAllowed: вторник запрещён');
eq(N.dayAllowed(null, 2), true, 'dayAllowed: null = все дни');
eq(N.DAY_LABELS.length, 7, 'DAY_LABELS: семь подписей');

/* настройки: запись через configure → store */
(async () => {
  await N.configure({ days: [1, 3, 5] });
  eq(S.settings().notify.days, [1, 3, 5], 'configure пишет days в store');
  await N.configure({ days: [] });
  eq(S.settings().notify.days, [0, 1, 2, 3, 4, 5, 6], 'пустой days превращается во все дни');
  await N.configure({ days: 'мусор' });
  eq(S.settings().notify.days, [0, 1, 2, 3, 4, 5, 6], 'битый days превращается во все дни');
  await N.configure({ time: '08:30' });
  eq(S.settings().notify.days, [0, 1, 2, 3, 4, 5, 6], 'правка времени не трогает days');
  eq(N.settings().days, [0, 1, 2, 3, 4, 5, 6], 'settings() отдаёт days по умолчанию');

  /* сводка: days едет в IndexedDB-зеркало для sw.js */
  const sum = N.summary(NOON);
  eq(Array.isArray(sum.days), true, 'summary.days — массив');
  eq(sum.days, [0, 1, 2, 3, 4, 5, 6], 'summary.days нормализован');

  /* периодический синк в Node-стабе (нет serviceWorker): тихая деградация */
  eq(await N.registerPeriodicSync(), 'unavailable', 'registerPeriodicSync без SW → unavailable');
  eq(await N.unregisterPeriodicSync(), false, 'unregisterPeriodicSync без SW → false');
  eq(await N.periodicSyncState(), null, 'periodicSyncState без SW → null');
  eq(N.periodicSyncSupported(), false, 'periodicSyncSupported без SW → false');

  console.log(failed === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nПРОВАЛЕНО: ' + failed);
  process.exit(failed === 0 ? 0 : 1);
})();

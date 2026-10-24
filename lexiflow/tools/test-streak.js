/**
 * LexiFlow — тесты стрика (js/streak.js), без браузера.
 *
 * Запуск:
 *   node tools/test-streak.js
 *
 * Стрик — производная от journals ответов, потому что иначе два устройства
 * после синхронизации показали бы разную серию. Здесь проверяются границы
 * зачёта дня, обрыв серии, рекорд и remainingToday — та самая арифметика,
 * из-за отсутствия которой экран тренировки падал посреди отрисовки.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- Минимальное окружение ---------- */
function fakeElement() {
  return {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    append() {}, remove() {}, focus() {}, click() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => []
  };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.console = console;
sandbox.Promise = Promise;
sandbox.JSON = JSON;
sandbox.Date = Date;
sandbox.Math = Math;
sandbox.Object = Object;
sandbox.Array = Array;
sandbox.String = String;
sandbox.Number = Number;
sandbox.Boolean = Boolean;
sandbox.setTimeout = () => 0;
sandbox.document = {
  createElement: fakeElement, createElementNS: fakeElement,
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  addEventListener() {}, removeEventListener() {},
  body: fakeElement(), documentElement: fakeElement(), head: fakeElement(),
  visibilityState: 'visible', hidden: false
};
const storage = {};
sandbox.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: k => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};
vm.createContext(sandbox);

/* ---------- Загрузка зависимостей streak.js ---------- */
['util.js', 'store.js', 'srs.js', 'streak.js'].forEach(name => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');
  vm.runInContext(code, sandbox, { filename: name });
});

const App = sandbox.App;
const S = App.store;
const ST = App.streak;
const U = App.util;

/* ---------- Проверки ---------- */
let pass = 0, fail = 0, group = '';
function section(name) { group = name; console.log('\n' + name); }
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '   → ' + JSON.stringify(extra) : ''));
  }
}
function eq(actual, expected, name) { ok(actual === expected, name, { actual, expected }); }

/** Журнал: n ответов в указанные смещения от «сейчас» (в днях). */
function logsOnDayOffsets(offsets, perDay) {
  const now = Date.now();
  const out = [];
  offsets.forEach(off => {
    const dayStart = U.startOfDay(now - off * U.MS_DAY);
    for (let i = 0; i < (perDay || 1); i++) {
      out.push({ id: off + '-' + i, cardId: 'c', deckId: 'd', ok: true, ts: dayStart + i * 1000, ms: 800 });
    }
  });
  return out;
}

/* ============================================================
   1. Пустой журнал
   ============================================================ */
section('Стрик: пустой журнал');
{
  const st = ST.computeStreak([], Date.now());
  eq(st.current, 0, 'серии нет');
  eq(st.best, 0, 'рекорда нет');
  eq(st.todayCount, 0, 'сегодня ответов нет');
  ok(!st.doneToday, 'день не закрыт');
  eq(st.goal, ST.DEFAULT_GOAL, 'цель по умолчанию');
}

/* ============================================================
   2. Зачёт дня
   ============================================================ */
section('Стрик: зачёт дня');
{
  const goal = 10;
  S.updateSettings({ streakGoal: goal });

  const below = ST.computeStreak(logsOnDayOffsets([0], goal - 1), Date.now());
  eq(below.todayCount, goal - 1, 'сегодняшние ответы посчитаны');
  ok(!below.doneToday, 'до цели день не закрыт');
  eq(below.current, 0, 'незакрытый день серию не начинает');

  const at = ST.computeStreak(logsOnDayOffsets([0], goal), Date.now());
  eq(at.todayCount, goal, 'ответ ровно по цели'); 
  ok(at.doneToday, 'на цели день закрыт');
  eq(at.current, 1, 'закрытый день — серия 1');
}

/* ============================================================
   3. Серия и её обрыв
   ============================================================ */
section('Стрик: серия и обрыв');
{
  const goal = 10;
  S.updateSettings({ streakGoal: goal });

  // вчера и позавчера закрыты, сегодня ещё нет
  const st = ST.computeStreak(logsOnDayOffsets([0, 1, 2], goal), Date.now());
  eq(st.todayCount, goal, 'сегодня тоже ответили');
  ok(st.doneToday, 'сегодня зачтено');
  eq(st.current, 3, 'три дня подряд — серия 3');

  // сегодня пропущен: серия считается от вчера
  const gapToday = logsOnDayOffsets([1, 2, 3], goal);
  const st2 = ST.computeStreak(gapToday, Date.now());
  ok(!st2.doneToday, 'сегодня молчание');
  eq(st2.current, 3, 'серия от вчера: 3 дня');

  // дырка позавчера: серия рвётся
  const st3 = ST.computeStreak(logsOnDayOffsets([0, 1, 3, 4], goal), Date.now());
  eq(st3.current, 2, 'после дырки считаем только свежие дни');

  // ответов меньше цели в один из дней — день не зачтён
  const partial = logsOnDayOffsets([0, 1], goal);
  partial.pop(); // вчера остаётся goal-1 ответов
  const st4 = ST.computeStreak(partial, Date.now());
  eq(st4.current, 1, 'неполный день серии не даёт');
}

/* ============================================================
   4. Рекорд
   ============================================================ */
section('Стрик: рекорд');
{
  const goal = 10;
  S.updateSettings({ streakGoal: goal });

  // давняя серия из 5 дней, сейчас только 2
  const logs = logsOnDayOffsets([0, 1], goal).concat(logsOnDayOffsets([10, 11, 12, 13, 14], goal));
  const st = ST.computeStreak(logs, Date.now());
  eq(st.current, 2, 'текущая серия — 2');
  eq(st.best, 5, 'рекорд — давние 5 дней');

  // текущая серия длиннее всех прошлых: рекорд растёт
  const st2 = ST.computeStreak(logsOnDayOffsets([0, 1, 2, 3, 4, 5], goal), Date.now());
  eq(st2.best, 6, 'рекорд подтягивается до текущей серии');
}

/* ============================================================
   5. Цель из настроек
   ============================================================ */
section('Стрик: цель из настроек');
{
  S.updateSettings({ streakGoal: 3 });
  const st = ST.computeStreak(logsOnDayOffsets([0], 3), Date.now());
  eq(st.goal, 3, 'цель взята из настроек');
  ok(st.doneToday, 'три ответа при цели 3 — день закрыт');

  // Битое значение не должно ломать счёт
  S.updateSettings({ streakGoal: 'abc' });
  eq(ST.computeStreak([], Date.now()).goal, ST.DEFAULT_GOAL, 'мусор в настройке → цель по умолчанию');
  S.updateSettings({ streakGoal: 0 });
  eq(ST.computeStreak([], Date.now()).goal, ST.DEFAULT_GOAL, 'ноль → цель по умолчанию');
  S.updateSettings({ streakGoal: -5 });
  eq(ST.computeStreak([], Date.now()).goal, ST.DEFAULT_GOAL, 'отрицательная цель → по умолчанию');
}

/* ============================================================
   6. День считается по локальной дате
   ============================================================ */
section('Стрик: границы дня');
{
  S.updateSettings({ streakGoal: 10 });
  // Цель закрыта в 23:xx одного дня и в 00:xx следующего: это два
  // разных дня, а не один. Если сломать dayKey, серия сложится неверно.
  const todayStart = U.startOfDay(Date.now());
  const lateNight = todayStart + 23 * 60 * U.MS_MIN;
  const earlyMorning = todayStart + U.MS_DAY + 1 * U.MS_MIN;

  const lateDay = [], earlyDay = [];
  for (let i = 0; i < 10; i++) lateDay.push({ id: 'l' + i, ts: lateNight + i, ok: true });
  for (let i = 0; i < 10; i++) earlyDay.push({ id: 'e' + i, ts: earlyMorning + i, ok: true });

  // «Сейчас» — глубокая ночь следующего дня: оба дня уже закрыты.
  const now = earlyMorning + 5 * U.MS_MIN;
  const st = ST.computeStreak(lateDay.concat(earlyDay), now);
  eq(st.current, 2, 'два закрытых дня подряд — серия 2');
  eq(st.best, 2, 'и рекорд тот же');
  eq(st.todayCount, 10, 'сегодняшние ответы — из раннего утра');
}

/* ============================================================
   7. remainingToday
   ============================================================ */
section('Стрик: остаток до продления');
{
  const st = { todayCount: 4, goal: 10, doneToday: false, current: 2, best: 2 };
  eq(ST.remainingToday(st, 10), 6, 'осталось 6 из 10');
  eq(ST.remainingToday(st, 4), 0, 'на цели остаток 0');
  eq(ST.remainingToday({ todayCount: 30, goal: 10 }, 10), 0, 'перебор не даёт минус');
  eq(ST.remainingToday({ todayCount: 12, goal: 30 }, 10), 0, 'больше цели по сводке — 0');
  eq(ST.remainingToday({ todayCount: 0, goal: 30 }, 10), 10, 'с нуля — вся цель');

  // цель из аргумента важнее цели из сводки
  eq(ST.remainingToday({ todayCount: 4, goal: 5 }, 30), 26, 'аргумент цели главнее');

  // цель не передана или битая — берём из сводки
  eq(ST.remainingToday({ todayCount: 4, goal: 5 }), 1, 'без аргумента — цель из сводки');
  eq(ST.remainingToday({ todayCount: 4, goal: 5 }, 'abc'), 1, 'битый аргумент — цель из сводки');
  eq(ST.remainingToday({ todayCount: 4, goal: 5 }, 0), 1, 'нулевой аргумент — цель из сводки');
  eq(ST.remainingToday(null, 10), 10, 'пустая сводка — вся цель');
  eq(ST.remainingToday({}, 10), 10, 'сводка без полей — вся цель');
}

/* ============================================================
   8. Сводка из computeStreak совместима с remainingToday
   ============================================================ */
section('Стрик: сводка и остаток согласованы');
{
  S.updateSettings({ streakGoal: 10 });
  const st = ST.computeStreak(logsOnDayOffsets([0], 4), Date.now());
  eq(ST.remainingToday(st), st.goal - st.todayCount, 'остаток = цель − ответы');
  const done = ST.computeStreak(logsOnDayOffsets([0], 10), Date.now());
  eq(ST.remainingToday(done), 0, 'закрытый день — остаток 0');

  // Бейдж в тренировке зовёт именно эту пару: подпись не должна
  // обещать «осталось 0 ответов» на закрытом дне.
  ok(ST.remainingToday(done, S.settings().streakGoal) === 0, 'по настройкам тоже 0');
}

/* ---------- Итог ---------- */
console.log('\n────────────────────────────────────────────────────');
if (fail === 0) {
  console.log('ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ' + pass);
  process.exit(0);
}
console.log('ПРОВАЛЕНО: ' + fail + ' из ' + (pass + fail));
process.exit(1);

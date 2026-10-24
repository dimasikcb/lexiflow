/* Временная проверка sw.js: напоминание с учётом дней (удаляется после прогона). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const handlers = {};
const self = { addEventListener: (t, fn) => { handlers[t] = fn; } };
const sandbox = { self, console, Date, URL, Request, Response };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8'), sandbox, { filename: 'sw.js' });

let failed = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? '  ok ' : '  FAIL ') + label + (ok ? '' : ' → ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected)));
}

const psync = handlers['periodicsync'];
eq(typeof psync, 'function', 'periodicsync handler зарегистрирован');

const MON = new Date(2026, 9, 5, 19, 30, 0); // понедельник 19:30
const state = (days) => ({
  enabled: true, time: '19:00', due: 5, onlyIfDue: true, lastShown: '2026-10-04', days
});

/* reminderDue доступна в контексте sw.js */
const due = (s, d) => vm.runInContext('reminderDue', sandbox)(s, d);
eq(due(state([1]), MON), true, 'понедельник в days, время прошло → показать');
eq(due(state([0]), MON), false, 'воскресенье в days, а сегодня пн → молчать');
eq(due(state([]), MON), true, 'пустой days = все дни → показать');
eq(due(state(undefined), MON), true, 'days нет (старая запись) = все дни → показать');
eq(due(state('мусор'), MON), true, 'битый days = все дни → показать');
eq(due(state([2, 3, 4, 5, 6]), MON), false, 'будни без понедельника → молчать');

/* старое поведение не сломано */
eq(due({ enabled: false, time: '19:00', due: 5, onlyIfDue: true, lastShown: '' }, MON), false, 'выключено → молчать');
eq(due({ enabled: true, time: '19:00', due: 0, onlyIfDue: true, lastShown: '' }, MON), false, 'долга нет и onlyIfDue → молчать');
eq(due({ enabled: true, time: '20:00', due: 5, onlyIfDue: true, lastShown: '' }, MON), false, 'время не наступило → молчать');
eq(due({ enabled: true, time: '19:00', due: 5, onlyIfDue: true, lastShown: '2026-10-05' }, MON), false, 'сегодня уже показывали → молчать');

const allowed = vm.runInContext('reminderDayAllowed', sandbox);
eq(allowed([1], 1), true, 'reminderDayAllowed: пн разрешён');
eq(allowed([1], 2), false, 'reminderDayAllowed: вт запрещён');
eq(allowed([], 2), true, 'reminderDayAllowed: пусто = все');
eq(allowed(null, 2), true, 'reminderDayAllowed: null = все');

/* тег обработчика совпадает с регистрируемым из notify.js */
eq(vm.runInContext('REMINDER_TAG', sandbox), 'lexiflow-reminder', 'тег periodicsync = lexiflow-reminder');

console.log(failed === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nПРОВАЛЕНО: ' + failed);
process.exit(failed === 0 ? 0 : 1);

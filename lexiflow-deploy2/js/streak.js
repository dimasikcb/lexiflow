/* ============================================================
   LexiFlow — streak.js
   Стрик «как в Duolingo», вычисляемый из журнала ответов (logs).
   Никаких новых полей в данных: серия — производное от logs,
   поэтому оба устройства после синхронизации посчитают её
   одинаково и конфликтов синка не будет. Рекорд (best) тоже
   производное — лучший непрерывный прогон по видимой истории
   журнала (журнал ограничен 20000 записями — известное окно).

   День = локальная дата (U.dayKey). День засчитан, если в нём
   не меньше streakGoal ответов (settings.streakGoal, по умолч. 10).
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util;

  var DEFAULT_GOAL = 10;

  /** Порог ответов в день: настройка streakGoal, иначе 10. */
  function goal() {
    var s = App.store.settings();
    var n = Number(s && s.streakGoal);
    return (n >= 1) ? Math.floor(n) : DEFAULT_GOAL;
  }

  /**
   * Серия из синхронизируемых logs.
   * @param {Array} logs журнал ответов (S.logs() / S.get().logs)
   * @param {number|Date} now текущий момент
   * @returns {{current:number, best:number, todayCount:number, doneToday:boolean, goal:number}}
   */
  function computeStreak(logs, now) {
    var goalN = goal();
    var nowTs = (now && typeof now === 'object') ? now.getTime() : (now || Date.now());

    var counts = {};
    var list = logs || [];
    for (var i = 0; i < list.length; i++) {
      var k = U.dayKey(list[i].ts);
      counts[k] = (counts[k] || 0) + 1;
    }

    var todayKey = U.dayKey(nowTs);
    var todayCount = counts[todayKey] || 0;
    var doneToday = todayCount >= goalN;

    // серия идёт от сегодняшнего дня, а если он ещё не закрыт — от вчерашнего
    var cursorTs = U.startOfDay(nowTs);
    if (!doneToday) cursorTs -= U.MS_DAY;

    var current = 0;
    while ((counts[U.dayKey(cursorTs)] || 0) >= goalN) {
      current++;
      cursorTs -= U.MS_DAY;
    }

    // рекорд — самый длинный непрерывный прогон зачётных дней
    // по всей видимой истории журнала
    var days = [];
    for (var key in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, key) && counts[key] >= goalN) days.push(key);
    }
    days.sort(); // YYYY-MM-DD сортируется лексикографически = хронологически

    var best = 0, run = 0, prevTs = null;
    for (var j = 0; j < days.length; j++) {
      var parts = days[j].split('-');
      var ts = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
      run = (prevTs !== null && ts - prevTs === U.MS_DAY) ? run + 1 : 1;
      if (run > best) best = run;
      prevTs = ts;
    }
    if (best < current) best = current;

    return {
      current: current,
      best: best,
      todayCount: todayCount,
      doneToday: doneToday,
      goal: goalN
    };
  }

  App.streak = {
    computeStreak: computeStreak,
    goal: goal,
    DEFAULT_GOAL: DEFAULT_GOAL
  };
})(window);

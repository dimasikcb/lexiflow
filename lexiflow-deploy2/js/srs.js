/* ============================================================
   LexiFlow — srs.js
   Планировщик интервального повторения (модель, близкая к Anki/SM-2):
   шаги обучения, graduating/easy интервалы, ease-фактор, lapses,
   модификатор интервала, максимальный интервал.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util;
  var MS_MIN = 60000, MS_DAY = 86400000;

  var GRADES = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
  var GRADE_LABELS = { 1: 'Снова', 2: 'Трудно', 3: 'Нормально', 4: 'Легко' };
  var GRADE_HOTKEYS = { 1: '1', 2: '2', 3: '3', 4: '4' };

  /** Настройки колоды по умолчанию. */
  var DEFAULT_SETTINGS = {
    newPerDay: 20,             // новых карточек в день
    maxReviewsPerDay: 300,     // максимум повторений в день
    learningSteps: [1, 10],    // шаги обучения, минуты
    relearningSteps: [10],     // шаги после забывания, минуты
    graduatingInterval: 1,     // дней: выход из обучения
    easyInterval: 4,           // дней: «Легко» на обучении
    startingEase: 2.5,         // стартовый ease-фактор
    easyBonus: 1.3,            // множитель для «Легко» на повторении
    hardInterval: 1.2,         // множитель для «Трудно» на повторении
    intervalModifier: 1.0,     // общий модификатор интервала
    lapseMultiplier: 0.0,      // доля интервала, сохраняемая после забывания (0 = сброс)
    minInterval: 1,            // минимальный интервал повторения, дней
    maxInterval: 1095,         // максимальный интервал, дней (3 года)
    leechThreshold: 8,         // после скольких провалов карточка помечается «трудной»
    autoPlayAudio: true,       // озвучивать карточку автоматически
    newOrder: 'random'         // порядок новых карточек: random | added
  };

  function clampNum(v, min, max, def) {
    v = Number(v);
    if (!isFinite(v)) v = def;
    return U.clamp(v, min, max);
  }

  /** Приводим настройки колоды к корректному виду. */
  function sanitizeSettings(raw) {
    var s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    s.newPerDay = Math.round(clampNum(s.newPerDay, 0, 500, 20));
    s.maxReviewsPerDay = Math.round(clampNum(s.maxReviewsPerDay, 0, 2000, 300));
    s.learningSteps = cleanSteps(s.learningSteps, [1, 10]);
    s.relearningSteps = cleanSteps(s.relearningSteps, [10]);
    s.graduatingInterval = clampNum(s.graduatingInterval, 1, 365, 1);
    s.easyInterval = clampNum(s.easyInterval, 1, 365, 4);
    s.startingEase = clampNum(s.startingEase, 1.3, 4, 2.5);
    s.easyBonus = clampNum(s.easyBonus, 1, 3, 1.3);
    s.hardInterval = clampNum(s.hardInterval, 1, 2, 1.2);
    s.intervalModifier = clampNum(s.intervalModifier, 0.1, 3, 1);
    s.lapseMultiplier = clampNum(s.lapseMultiplier, 0, 1, 0);
    s.minInterval = clampNum(s.minInterval, 1, 30, 1);
    s.maxInterval = clampNum(s.maxInterval, 1, 36500, 1095);
    s.leechThreshold = Math.round(clampNum(s.leechThreshold, 1, 50, 8));
    if (s.minInterval > s.maxInterval) s.minInterval = s.maxInterval;
    return s;
  }

  function cleanSteps(steps, fallback) {
    if (!Array.isArray(steps)) return fallback.slice();
    var out = steps
      .map(function (v) { return Math.round(Number(v)); })
      .filter(function (v) { return isFinite(v) && v > 0 && v <= 100000; });
    out.sort(function (a, b) { return a - b; });
    return out.length ? out.slice(0, 6) : fallback.slice();
  }

  /** Новое SRS-состояние для карточки. */
  function newState(settings, now) {
    return {
      state: 'new',      // new | learning | review | relearning
      step: 0,           // индекс шага обучения
      interval: 0,       // дней (для review)
      ease: (settings || DEFAULT_SETTINGS).startingEase,
      due: now || Date.now(),
      reps: 0,
      lapses: 0,
      leech: false,
      lastReview: null
    };
  }

  function isNew(card) { return !card.srs || card.srs.state === 'new'; }
  function isLearning(card) {
    var st = card.srs && card.srs.state;
    return st === 'learning' || st === 'relearning';
  }
  function isReview(card) { return card.srs && card.srs.state === 'review'; }
  function isDue(card, now) { return card.srs ? card.srs.due <= (now || Date.now()) : true; }
  function isSuspended(card) { return !!(card.suspended); }

  /** Интервал (в мс) для шага обучения. */
  function stepMs(stepIndex, steps) {
    var idx = U.clamp(stepIndex, 0, steps.length - 1);
    return steps[idx] * MS_MIN;
  }

  function clampIntervalDays(days, settings) {
    var d = Math.round(days * settings.intervalModifier * 10) / 10;
    d = Math.max(settings.minInterval, Math.min(settings.maxInterval, d));
    return d;
  }

  /**
   * Применить ответ к карточке.
   * @param {object} card — карточка (мутируется? нет, копия возвращается)
   * @param {number} grade — 1..4
   * @param {object} settingsRaw — настройки колоды
   * @param {number} now
   * @returns {{srs: object, intervalMs: number, label: string, stateFrom: string, stateTo: string, leech: boolean}}
   */
  function answer(card, grade, settingsRaw, now) {
    var settings = sanitizeSettings(settingsRaw);
    now = now || Date.now();
    var prev = card.srs ? Object.assign({}, card.srs) : newState(settings, now);
    var srs = Object.assign({}, prev);
    var stateFrom = prev.state;
    var intervalMs;

    srs.reps = (prev.reps || 0) + 1;
    srs.lastReview = now;

    if (prev.state === 'new' || prev.state === 'learning') {
      var steps = settings.learningSteps;
      if (grade === GRADES.AGAIN) {
        srs.state = 'learning';
        srs.step = 0;
        srs.due = now + (steps.length ? stepMs(0, steps) : MS_MIN);
        if (prev.state !== 'new') srs.lapses = prev.lapses; // обучение не считается провалом
      } else if (grade === GRADES.HARD) {
        srs.state = 'learning';
        srs.step = prev.state === 'new' ? 0 : Math.max(0, prev.step);
        srs.due = now + (steps.length ? stepMs(srs.step, steps) : MS_MIN);
      } else if (grade === GRADES.GOOD) {
        var nextStep = prev.state === 'new' ? 0 : (prev.step || 0) + 1;
        if (nextStep >= steps.length) {
          // выпуск из обучения
          srs.state = 'review';
          srs.step = 0;
          srs.interval = clampIntervalDays(settings.graduatingInterval, settings);
          srs.due = now + srs.interval * MS_DAY;
        } else {
          srs.state = 'learning';
          srs.step = nextStep;
          srs.due = now + stepMs(nextStep, steps);
        }
      } else { // EASY
        srs.state = 'review';
        srs.step = 0;
        srs.interval = clampIntervalDays(Math.max(settings.easyInterval, settings.graduatingInterval), settings);
        srs.due = now + srs.interval * MS_DAY;
      }
      if (srs.state === 'review' && prev.state === 'new') {
        srs.ease = settings.startingEase;
      }
    } else if (prev.state === 'review' || prev.state === 'relearning') {
      if (grade === GRADES.AGAIN) {
        // забыл
        srs.lapses = (prev.lapses || 0) + 1;
        srs.state = 'relearning';
        srs.step = 0;
        srs.ease = Math.max(1.3, (prev.ease || settings.startingEase) - 0.2);
        var kept = settings.lapseMultiplier > 0 ? Math.max(settings.minInterval, (prev.interval || 1) * settings.lapseMultiplier) : 0;
        srs.interval = kept;
        var rSteps = settings.relearningSteps;
        srs.due = now + (rSteps.length ? stepMs(0, rSteps) : 10 * MS_MIN);
      } else if (grade === GRADES.HARD) {
        srs.ease = Math.max(1.3, (prev.ease || settings.startingEase) - 0.15);
        var hardBase = prev.state === 'relearning' ? Math.max(prev.interval || 0, settings.minInterval) : (prev.interval || 1);
        srs.interval = clampIntervalDays(Math.max(settings.minInterval, hardBase * settings.hardInterval), settings);
        srs.state = 'review';
        srs.step = 0;
        srs.due = now + srs.interval * MS_DAY;
      } else if (grade === GRADES.GOOD) {
        var base = prev.state === 'relearning' ? Math.max(prev.interval || 0, settings.minInterval) : (prev.interval || 1);
        srs.ease = prev.ease || settings.startingEase;
        srs.interval = clampIntervalDays(base * srs.ease, settings);
        srs.state = 'review';
        srs.step = 0;
        srs.due = now + srs.interval * MS_DAY;
      } else { // EASY
        // как в Anki: интервал считается по текущему ease, и только потом ease растёт
        var base2 = prev.state === 'relearning' ? Math.max(prev.interval || 0, settings.minInterval) : (prev.interval || 1);
        var oldEase = prev.ease || settings.startingEase;
        srs.interval = clampIntervalDays(base2 * oldEase * settings.easyBonus, settings);
        srs.ease = Math.min(4, oldEase + 0.15);
        srs.state = 'review';
        srs.step = 0;
        srs.due = now + srs.interval * MS_DAY;
      }
    } else {
      // неизвестное состояние — начинаем как новую
      srs = newState(settings, now);
      srs.reps = 1;
    }

    if (srs.lapses >= settings.leechThreshold) srs.leech = true;
    intervalMs = srs.due - now;

    return {
      srs: srs,
      intervalMs: intervalMs,
      label: U.fmtInterval(intervalMs),
      stateFrom: stateFrom,
      stateTo: srs.state,
      leech: !!srs.leech
    };
  }

  /** Превью интервалов для четырёх кнопок оценки (без изменения карточки). */
  function preview(card, settings, now) {
    now = now || Date.now();
    var out = {};
    [1, 2, 3, 4].forEach(function (g) {
      out[g] = answer(card, g, settings, now).label;
    });
    return out;
  }

  /** Человекочитаемое состояние карточки. */
  function stateLabel(card) {
    if (!card.srs || card.srs.state === 'new') return 'Новая';
    if (card.srs.state === 'learning') return 'Учится';
    if (card.srs.state === 'relearning') return 'Повторно';
    return 'Повторение';
  }

  App.srs = {
    GRADES: GRADES,
    GRADE_LABELS: GRADE_LABELS,
    GRADE_HOTKEYS: GRADE_HOTKEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    sanitizeSettings: sanitizeSettings,
    newState: newState,
    answer: answer,
    preview: preview,
    isNew: isNew,
    isLearning: isLearning,
    isReview: isReview,
    isDue: isDue,
    isSuspended: isSuspended,
    stateLabel: stateLabel,
    clampIntervalDays: clampIntervalDays,
    MS_MIN: MS_MIN,
    MS_DAY: MS_DAY
  };
})(window);

/* ============================================================
   LexiFlow — notify.js
   Напоминания о повторении: разрешение браузера, планировщик
   (работает, пока вкладка открыта) и зеркало сводки в IndexedDB.

   Зачем зеркало: service worker не видит localStorage. Поэтому
   страница кладёт короткую сводку в IndexedDB, а sw.js читает её
   оттуда — тогда уведомление можно показать даже с закрытой
   вкладкой. Схема заморожена, см. блок ниже.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util || {};

  /* ============================================================
     ЗАМОРОЖЕННАЯ СХЕМА IndexedDB (страница пишет — sw.js читает)

       база:      'lexiflow-sw', версия 1
       хранилище: 'reminder', ключ — свойство 'key'
       запись:    { key: 'state', enabled, time, days, onlyIfDue,
                    due, streak, goal, reviewsToday, updatedAt,
                    lastShown }

     Ключ записи всегда 'state' (SUMMARY_KEY). Другие ключи в этом
     хранилище не используются, чтобы sw.js не перебирал записи.

     Поля:
       enabled      — boolean, включены ли напоминания
       time         — 'HH:MM', локальное время показа
       days         — массив номеров дней недели (0 = воскресенье …
                      6 = суббота, как Date.getDay), в которые
                      напоминание показывается; пустой или битый
                      массив читается как «все дни»
       due          — number, сколько карточек ждёт повторения сейчас
       streak       — number, серия дней подряд
       goal         — number, цель повторений в день
       reviewsToday — number, повторений за сегодня
       updatedAt    — number, когда запись обновлена (мс)
       lastShown    — 'YYYY-MM-DD' локальная дата последнего показа

     Никакие строки в sw.js хардкодить не нужно: константы
     экспортируются как App.notify.DB_NAME, App.notify.DB_VERSION,
     App.notify.STORE, App.notify.SUMMARY_KEY.
     ============================================================ */

  var DB_NAME = 'lexiflow-sw';
  var DB_VERSION = 1;
  var STORE = 'reminder';
  var SUMMARY_KEY = 'state';

  var TAG = 'lexiflow-reminder';       // тег: повтор заменяет прошлое уведомление
  var TARGET_HASH = '#/study/all';     // куда вести по клику
  var DEFAULT_TIME = '19:00';
  var CHECK_MS = 60000;                // период проверки, пока вкладка открыта
  var FIRST_CHECK_MS = 400;            // первая проверка после запуска
  var MIRROR_DEBOUNCE_MS = 1200;       // дебаунс записи в IndexedDB
  var SW_READY_TIMEOUT_MS = 1200;      // сколько ждать navigator.serviceWorker.ready

  /* Минимальный интервал фоновой проверки (Periodic Background Sync).
     12 часов — рекомендация Chrome: браузер всё равно решает сам, когда
     звать событие (зависит от вовлечённости сайта и от того, подключён
     ли интернет), но заявлять интервал чаще смысла нет. */
  var PSYNC_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

  var timer = null;
  var mirrorTimer = null;
  var checking = false;
  var started = false;
  var hooksInstalled = false;
  var lifecycleInstalled = false;

  /** Ссылка на store берётся в момент вызова: модуль не должен падать,
      если его подключили в другом порядке. */
  function store() { return App.store; }

  function toast(message, type, ms) {
    if (U && typeof U.toast === 'function') U.toast(message, type, ms);
  }

  function plural(n, one, few, many) {
    if (U && typeof U.plural === 'function') return U.plural(n, one, few, many);
    return many;
  }

  /* ============================================================
     Чистые помощники — без DOM и без глобального состояния,
     поэтому их можно проверять в Node.
     ============================================================ */

  /**
   * Локальная дата как 'YYYY-MM-DD' — формат, которым пользуется
   * весь проект (util.dayKey), чтобы «сегодня» везде совпадало.
   */
  function dateKey(now) {
    var ts = (now === undefined || now === null) ? Date.now() : now;
    if (U && typeof U.dayKey === 'function') return U.dayKey(ts);
    var d = new Date(ts);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : String(m)) + '-' + (day < 10 ? '0' + day : String(day));
  }

  /**
   * 'HH:MM' (можно 'H:MM' и с секундами) → минуты от начала суток.
   * Непонятная строка → null: вызывающий код решает сам, что делать.
   */
  function timeToMinutes(value) {
    if (typeof value !== 'string') return null;
    var m = value.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return null;
    var hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (!isFinite(hh) || !isFinite(mm)) return null;
    if (hh > 23 || mm > 59) return null;
    return hh * 60 + mm;
  }

  /** Привести время к каноническому 'HH:MM'; непонятное значение → null. */
  function normalizeTime(value) {
    var mins = timeToMinutes(value);
    if (mins === null) return null;
    var hh = Math.floor(mins / 60), mm = mins % 60;
    return (hh < 10 ? '0' + hh : String(hh)) + ':' + (mm < 10 ? '0' + mm : String(mm));
  }

  function minutesOfDay(ts) {
    var d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
  }

  /**
   * Пора ли показать напоминание. Функция чистая: ничего не читает
   * из DOM и глобальных переменных, ничего не меняет — только считает.
   *
   * @param {{now:number, time:string, due:number, enabled:boolean,
   *          onlyIfDue:boolean, lastShown:string}} input
   * @returns {boolean}
   */
  function shouldNotify(input) {
    input = input || {};
    if (!input.enabled) return false;

    var now = (input.now === undefined || input.now === null) ? Date.now() : input.now;
    if (typeof now !== 'number' || !isFinite(now)) return false;

    /* Непонятное время — не повод падать, но и не повод придумывать
       своё: считаем напоминание ненастроенным и молчим. */
    var target = timeToMinutes(input.time);
    if (target === null) return false;

    // время ещё не наступило (полночь переживаем спокойно: сравниваем минуты дня)
    if (minutesOfDay(now) < target) return false;

    /* Один показ в сутки. Сравниваем локальные даты, а не «прошло 24 часа»,
       иначе напоминание уезжало бы на всё более позднее время. */
    if (String(input.lastShown || '') === dateKey(now)) return false;

    var due = Number(input.due);
    if (!isFinite(due) || due < 0) due = 0;
    // Значение по умолчанию — как в настройках приложения (onlyIfDue: true)
    var onlyIfDue = input.onlyIfDue === undefined ? true : !!input.onlyIfDue;
    if (onlyIfDue && due <= 0) return false;

    /* Дни недели: 0 = воскресенье … 6 = суббота (как Date.getDay).
       Пустой или битый список — «все дни», как и раньше. */
    if (!dayAllowed(input.days, new Date(now).getDay())) return false;

    return true;
  }

  /** Все возможные дни недели — подписи для интерфейса, вс → пн … сб. */
  var DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  /** Массив дней к набору чисел 0..6; пустой или битый → null («все дни»). */
  function normalizeDays(value) {
    if (!Array.isArray(value)) return null;
    var out = [];
    for (var i = 0; i < value.length; i++) {
      var d = Math.floor(Number(value[i]));
      if (d >= 0 && d <= 6 && out.indexOf(d) === -1) out.push(d);
    }
    if (!out.length) return null;
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /** Разрешён ли день недели (0..6); days=null/[]/битый — все дни. */
  function dayAllowed(days, weekday) {
    var list = normalizeDays(days);
    if (!list) return true;
    return list.indexOf(weekday) !== -1;
  }

  /* ============================================================
     Данные приложения
     ============================================================ */

  function defaultSettings() {
    return { enabled: false, time: DEFAULT_TIME, days: [0, 1, 2, 3, 4, 5, 6], onlyIfDue: true, lastShown: '' };
  }

  /** Копия настроек напоминаний: правки снаружи не должны течь в store. */
  function settings() {
    var S = store();
    var st = S && typeof S.settings === 'function' ? S.settings() : null;
    return Object.assign(defaultSettings(), (st && st.notify) || {});
  }

  /**
   * Сколько карточек ждёт повторения прямо сейчас. Считаем ровно так же,
   * как экран колод (сумма deckStats().due по неархивным колодам), иначе
   * число в напоминании разошлось бы с тем, что видит пользователь.
   */
  function dueToday(now) {
    var S = store();
    if (!S || typeof S.deckStats !== 'function') return 0;
    now = now || Date.now();
    var total = 0;
    ((S.get() || {}).decks || []).forEach(function (d) {
      if (!d || d.archived) return;
      var st = S.deckStats(d.id, now);
      if (st && st.due) total += st.due;
    });
    return total;
  }

  /** Сводка для service worker — ровно та запись, что лежит в IndexedDB. */
  function summary(now) {
    var S = store();
    var cfg = settings();
    now = now || Date.now();
    var appSettings = (S && typeof S.settings === 'function' ? S.settings() : {}) || {};
    return {
      key: SUMMARY_KEY,
      enabled: !!cfg.enabled,
      time: cfg.time,
      days: normalizeDays(cfg.days) || [],
      onlyIfDue: !!cfg.onlyIfDue,
      due: dueToday(now),
      streak: S && typeof S.streak === 'function' ? S.streak(now) : 0,
      goal: Number(appSettings.dailyGoal) || 30,
      reviewsToday: S && typeof S.reviewsToday === 'function' ? S.reviewsToday(null, now) : 0,
      updatedAt: Date.now(),
      lastShown: String(cfg.lastShown || '')
    };
  }

  function writeNotify(next) {
    var S = store();
    if (!S || typeof S.updateSettings !== 'function') return;
    S.updateSettings({ notify: next });
    // Важнее всего именно здесь: в lastShown лежит «сегодня уже показали».
    // Если запись задержится, service worker пришлёт напоминание второй раз.
    refreshMirror();
    syncScheduler();
  }

  /* ============================================================
     Разрешение браузера
     ============================================================ */

  /* Notification читаем каждый раз заново: в приватном режиме и в тестах
     API может появиться или исчезнуть уже после загрузки страницы. */
  function notificationApi() {
    return typeof global.Notification === 'undefined' ? null : global.Notification;
  }

  /** Есть ли в браузере Notification API. */
  function supported() { return !!notificationApi(); }

  /** 'unsupported' | 'default' | 'granted' | 'denied' */
  function permission() {
    var api = notificationApi();
    if (!api) return 'unsupported';
    var p = api.permission;
    if (p === 'granted' || p === 'denied' || p === 'default') return p;
    return 'default';
  }

  /**
   * Запросить разрешение. Вызывать только из жеста пользователя
   * (клик по кнопке) — браузеры игнорируют запрос при загрузке.
   * Промис разрешается всегда: и при отказе, и при отсутствии API.
   */
  function request() {
    return new Promise(function (resolve) {
      var api = notificationApi();
      if (!api) { resolve('unsupported'); return; }
      if (api.permission === 'granted' || api.permission === 'denied') {
        resolve(api.permission);
        return;
      }

      var settled = false;
      function settle(value) {
        if (settled) return;
        settled = true;
        resolve(value === 'granted' || value === 'denied' ? value : 'default');
      }

      try {
        // старые реализации отдают результат только в колбэк,
        // новые — промисом; поддерживаем оба варианта
        var res = api.requestPermission(function (value) { settle(value); });
        if (res && typeof res.then === 'function') {
          res.then(settle, function () { settle('default'); });
        }
      } catch (e) {
        settle('default');
      }
    });
  }

  /* ============================================================
     Показ уведомления
     ============================================================ */

  /** Текст уведомления: «К повторению: 12 карточек». */
  function reminderText(due) {
    var n = Number(due);
    if (!isFinite(n) || n <= 0) return 'Самое время немного позаниматься.';
    return 'К повторению: ' + n + ' ' + plural(n, 'карточка', 'карточки', 'карточек');
  }

  function notificationOptions(kind, due) {
    return {
      body: reminderText(due),
      tag: TAG,                      // повтор заменяет прошлое, а не копится
      icon: 'icons/icon-192.png',
      badge: 'icons/favicon.svg',
      lang: 'ru',
      /* sw.js по клику ведёт на data.url — держим адрес в записи,
         чтобы обработчик в service worker не хардкодил маршрут. */
      data: { url: TARGET_HASH, kind: kind }
    };
  }

  /** Обычное уведомление из окна — когда service worker недоступен. */
  function directNotification(title, options) {
    var api = notificationApi();
    if (!api) return false;
    try {
      var n = new api(title, options);
      n.onclick = function () {
        try {
          if (typeof global.focus === 'function') global.focus();
          if (global.location) global.location.hash = TARGET_HASH;
          if (typeof n.close === 'function') n.close();
        } catch (e) { /* окно могло уже закрыться */ }
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Промис с ограничением по времени: ready может не разрешиться никогда. */
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = global.setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { global.clearTimeout(t); resolve(v); },
                   function (e) { global.clearTimeout(t); reject(e); });
    });
  }

  /**
   * Показать уведомление. Сначала через service worker (тогда оно живёт
   * независимо от вкладки), при отсутствии регистрации — напрямую.
   * Промис не отклоняется: на любой сбой возвращаем false.
   */
  function show(title, options) {
    var sw = global.navigator && global.navigator.serviceWorker;
    if (sw && sw.ready) {
      return withTimeout(sw.ready, SW_READY_TIMEOUT_MS).then(function (reg) {
        if (reg && typeof reg.showNotification === 'function') {
          try {
            return reg.showNotification(title, options).then(
              function () { return true; },
              function () { return directNotification(title, options); }
            );
          } catch (e) {
            // showNotification без разрешения бросает синхронно
            return directNotification(title, options);
          }
        }
        return directNotification(title, options);
      }, function () {
        return directNotification(title, options);
      });
    }
    return Promise.resolve(directNotification(title, options));
  }

  /**
   * Изменить настройки напоминаний.
   * Включение требует разрешения браузера, а запрашивать его можно только
   * из жеста пользователя — поэтому вызывайте configure({enabled:true})
   * из обработчика клика. Промис разрешается итоговыми настройками.
   */
  function configure(patch) {
    patch = patch || {};
    var next = Object.assign({}, settings(), patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'time')) {
      // непонятное время не пишем в хранилище — возвращаемся к значению по умолчанию
      next.time = normalizeTime(patch.time) || DEFAULT_TIME;
    }
    next.enabled = !!next.enabled;
    next.onlyIfDue = next.onlyIfDue === undefined ? true : !!next.onlyIfDue;
    next.lastShown = String(next.lastShown || '');
    if (Object.prototype.hasOwnProperty.call(patch, 'days')) {
      // пустой или непонятный список дней — «все дни»
      next.days = normalizeDays(patch.days) || [0, 1, 2, 3, 4, 5, 6];
    }

    var wantsEnable = patch.enabled === true;
    var perm = permission();

    /* Запрещено на уровне браузера: включить нельзя, а просить бессмысленно.
       Объясняем, где это меняется, — иначе выглядит как поломка приложения. */
    if (wantsEnable && perm === 'denied') {
      next.enabled = false;
      writeNotify(next);
      unregisterPeriodicSync();
      toast('Уведомления запрещены для этого сайта. Откройте настройки браузера: значок замка рядом с адресом → «Уведомления» → «Разрешить» — и попробуйте снова.', 'err', 7000);
      return Promise.resolve(settings());
    }

    if (wantsEnable && perm === 'default') {
      return request().then(function (result) {
        if (result === 'granted') {
          next.enabled = true;
          writeNotify(next);
          registerPeriodicSync();
        } else {
          next.enabled = false;
          writeNotify(next);
          unregisterPeriodicSync();
          toast('Без разрешения браузера напоминание показать нельзя. Разрешите уведомления для этого сайта в настройках браузера и включите напоминания снова.', 'err', 7000);
        }
        return settings();
      });
    }

    // 'granted' и 'unsupported' пишем сразу: в первом случае разрешение уже
    // есть, во втором напоминания всё равно работать не будут, но настройка
    // сохраняется — панель настроек честно объясняет ограничение.
    writeNotify(next);
    if (next.enabled) registerPeriodicSync(); else unregisterPeriodicSync();
    return Promise.resolve(settings());
  }

  /** Пробное уведомление по кнопке из настроек. */
  function test() {
    if (!supported()) {
      toast('Этот браузер не умеет показывать уведомления — напоминания будут недоступны.', 'warn', 6000);
      return Promise.resolve(false);
    }
    return request().then(function (perm) {
      if (perm !== 'granted') {
        toast('Браузер не разрешил уведомления. Разрешите их в настройках сайта и попробуйте снова.', 'err', 6000);
        return false;
      }
      return show('LexiFlow', {
        body: 'Пробное уведомление — всё работает.',
        tag: TAG,
        icon: 'icons/icon-192.png',
        badge: 'icons/favicon.svg',
        lang: 'ru',
        data: { url: TARGET_HASH, kind: 'test' }
      }).then(function (shown) {
        toast(shown ? 'Пробное уведомление отправлено' : 'Не удалось показать уведомление', shown ? 'ok' : 'err', 3600);
        return !!shown;
      });
    });
  }

  /* ============================================================
     Планировщик (пока вкладка открыта)
     ============================================================ */

  function onVisibility() {
    if (global.document && global.document.visibilityState === 'visible') tick();
  }

  function tick() {
    if (checking) return;
    var cfg = settings();
    var now = Date.now();
    var due = dueToday(now);

    if (!shouldNotify({
      now: now, time: cfg.time, due: due,
      enabled: cfg.enabled, onlyIfDue: cfg.onlyIfDue, lastShown: cfg.lastShown
    })) return;

    checking = true;
    show('LexiFlow', notificationOptions('reminder', due)).then(function (shown) {
      checking = false;
      // Не показали — не отмечаем день: попробуем на следующей проверке.
      if (!shown) return;
      var next = Object.assign({}, settings(), { lastShown: dateKey(Date.now()) });
      writeNotify(next);
    }, function () {
      checking = false;
    });
  }

  function start() {
    if (started || !supported()) return;
    started = true;
    timer = global.setInterval(tick, CHECK_MS);
    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', onVisibility);
    }
    // первая проверка — вскоре после запуска, но не в момент отрисовки
    global.setTimeout(tick, FIRST_CHECK_MS);
  }

  function stop() {
    if (!started) return;
    started = false;
    if (timer) { global.clearInterval(timer); timer = null; }
    if (global.document && global.document.removeEventListener) {
      global.document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  /** Включено и поддерживается — планировщик работает, иначе молчит. */
  function syncScheduler() {
    if (settings().enabled && supported()) start(); else stop();
  }

  /* ============================================================
     Periodic Background Sync — фоновая проверка, когда вкладка закрыта.

     Обработчик periodicsync уже живёт в sw.js и ждёт тег TAG. Регистрацию
     делает страница. Работает: установленная PWA в Chromium (Android
     Chrome и Chrome/Edge на ПК). В обычной вкладке API тоже виден, но
     register() бросает InvalidStateError — ловим и молчим: планировщик
     в открытой вкладке продолжает работать как прежде.
     ============================================================ */

  /** Доступен ли вообще Periodic Background Sync (без попыток регистрации). */
  function periodicSyncSupported() {
    var sw = global.navigator && global.navigator.serviceWorker;
    return !!(sw && global.ServiceWorkerRegistration &&
      global.ServiceWorkerRegistration.prototype &&
      typeof global.ServiceWorkerRegistration.prototype.periodicSync === 'object' &&
      global.ServiceWorkerRegistration.prototype.periodicSync !== null &&
      typeof global.ServiceWorkerRegistration.prototype.periodicSync.register === 'function');
  }

  /**
   * Зарегистрировать фоновую проверку напоминаний. Промис всегда
   * разрешается — строка-статус для панели, исключений не бросает:
   * фоновый канал — необязательное улучшение, любой сбой означает
   * просто «работает то, что работало раньше».
   * @returns {Promise<string>} 'registered' | 'unavailable' | 'denied' | 'error'
   */
  function registerPeriodicSync() {
    var sw = global.navigator && global.navigator.serviceWorker;
    if (!sw || !periodicSyncSupported()) return Promise.resolve('unavailable');

    // Chrome требует permission 'periodic-background-sync' = granted;
    // где navigator.permissions нет (старые стабы, тесты), пробуем и так.
    var permitted = Promise.resolve('granted');
    try {
      if (global.navigator.permissions && typeof global.navigator.permissions.query === 'function') {
        permitted = global.navigator.permissions.query({ name: 'periodic-background-sync' }).then(
          function (st) { return (st && st.state) || 'granted'; },
          function () { return 'granted'; }
        );
      }
    } catch (e) { /* считаем, что разрешено: register() всё равно проверит сам */ }

    return permitted.then(function (state) {
      if (state === 'denied') return 'denied';
      return sw.ready.then(function (reg) {
        if (!reg || !reg.periodicSync || typeof reg.periodicSync.register !== 'function') return 'unavailable';
        return reg.periodicSync.register(TAG, { minInterval: PSYNC_MIN_INTERVAL_MS }).then(
          function () { return 'registered'; },
          function () { return 'error'; }
        );
      }, function () { return 'error'; });
    }).catch(function () { return 'error'; });
  }

  /** Снять фоновую регистрацию; сбои игнорируем — выключение не должно падать. */
  function unregisterPeriodicSync() {
    var sw = global.navigator && global.navigator.serviceWorker;
    if (!sw || !periodicSyncSupported()) return Promise.resolve(false);
    return sw.ready.then(function (reg) {
      if (!reg || !reg.periodicSync || typeof reg.periodicSync.unregister !== 'function') return false;
      return reg.periodicSync.unregister(TAG).catch(function () { return false; });
    }, function () { return false; }).catch(function () { return false; });
  }

  /**
   * Состояние фоновой регистрации для панели: строка-статус или null,
   * если канал вообще не поддерживается.
   */
  function periodicSyncState() {
    var sw = global.navigator && global.navigator.serviceWorker;
    if (!sw || !periodicSyncSupported()) return Promise.resolve(null);
    return sw.ready.then(function (reg) {
      if (!reg || !reg.periodicSync || typeof reg.periodicSync.getTags !== 'function') return 'unavailable';
      return reg.periodicSync.getTags().then(function (tags) {
        return (tags && tags.indexOf(TAG) !== -1) ? 'registered' : 'off';
      }, function () { return 'unavailable'; });
    }, function () { return 'unavailable'; }).catch(function () { return 'unavailable'; });
  }

  /* ============================================================
     Зеркало в IndexedDB
     ============================================================ */

  /** Запись сводки в IndexedDB. Никогда не отклоняется: false = не удалось. */
  function mirror() {
    return new Promise(function (resolve) {
      var record;
      try { record = summary(); } catch (e) { resolve(false); return; }
      if (!global.indexedDB) { resolve(false); return; }

      var req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(false);
        return;
      }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onblocked = function () { resolve(false); };
      req.onerror = function () { resolve(false); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(record);
          tx.oncomplete = function () { closeDb(db); resolve(true); };
          tx.onerror = function () { closeDb(db); resolve(false); };
          tx.onabort = function () { closeDb(db); resolve(false); };
        } catch (e) {
          closeDb(db);
          resolve(false);
        }
      };
    });
  }

  function closeDb(db) {
    try { if (db && typeof db.close === 'function') db.close(); } catch (e) { /* уже закрыта */ }
  }

  /**
   * Дебаунс записи: настройки меняются по буквам, а в IndexedDB
   * незачем ходить на каждое нажатие клавиши.
   */
  function scheduleMirror() {
    if (mirrorTimer) global.clearTimeout(mirrorTimer);
    mirrorTimer = global.setTimeout(function () {
      mirrorTimer = null;
      mirror();
    }, MIRROR_DEBOUNCE_MS);
  }

  /** Страница уходит в фон (или уже ушла) — таймеры вот-вот замрут. */
  function isHidden() {
    return !!(global.document && global.document.visibilityState === 'hidden');
  }

  /**
   * Записать сводку немедленно, отменив отложенную запись.
   *
   * Дебаунс выше нужен, пока страница на экране: настройки меняются по
   * буквам. Но ждать 1,2 с при уходе со страницы нельзя — мобильные
   * браузеры замораживают таймеры сразу после ухода в фон, и отложенная
   * запись не случится уже никогда. Тогда service worker прочитает
   * устаревшую сводку: например, увидит старую дату последнего показа
   * и пришлёт второе напоминание за день.
   */
  function flushMirror() {
    if (mirrorTimer) { global.clearTimeout(mirrorTimer); mirrorTimer = null; }
    return mirror();
  }

  /**
   * Обновить сводку: на экране — с дебаунсом, в фоне — сразу.
   * Единая точка входа, чтобы ни один путь не остался «отложенным».
   */
  function refreshMirror() {
    if (isHidden()) return flushMirror();
    scheduleMirror();
    return true;
  }

  /**
   * Держим зеркало свежим. Подписка на store ловит смену настроек и правки
   * через store, а обёртка над flush — завершение сессии тренировки:
   * study.js сохраняет прогресс через S.save() и подписчиков не будит.
   * Обёртка не меняет поведение flush, только добавляет запись сводки.
   */
  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;

    var S = store();
    if (!S) return;
    if (typeof S.subscribe === 'function') S.subscribe(function () { refreshMirror(); });
    if (typeof S.flush === 'function') {
      var original = S.flush;
      S.flush = function () {
        var result = original.apply(this, arguments);
        // flush зовут и при уходе со страницы (app.js: pagehide и
        // visibilitychange) — тогда пишем сводку сразу, без дебаунса.
        refreshMirror();
        return result;
      };
    }
  }

  /**
   * Уход со страницы: дописываем сводку немедленно.
   *
   * app.js тоже зовёт store.flush() на этих событиях, и обычно этого
   * достаточно (обёртка над flush выше). Свой слушатель нужен на случай,
   * когда данных не менялось и flush ничего не делает, — тогда сводка
   * уже свежая, а вызов выходит пустым и ничего не портит.
   */
  function installLifecycle() {
    if (lifecycleInstalled) return;
    lifecycleInstalled = true;

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('pagehide', function () { flushMirror(); });
    }
    if (global.document && typeof global.document.addEventListener === 'function') {
      global.document.addEventListener('visibilitychange', function () {
        if (isHidden()) flushMirror();
      });
    }
  }

  installHooks();
  installLifecycle();

  // Если напоминания уже включены — поднимаем планировщик сами:
  // приложение может не знать о модуле (его подключает другой файл).
  if (supported() && settings().enabled) start();

  App.notify = {
    /* замороженная схема IndexedDB — sw.js ссылается на эти константы */
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORE: STORE,
    SUMMARY_KEY: SUMMARY_KEY,
    TAG: TAG,
    TARGET_HASH: TARGET_HASH,

    supported: supported,
    permission: permission,
    request: request,

    settings: settings,
    configure: configure,

    registerPeriodicSync: registerPeriodicSync,
    unregisterPeriodicSync: unregisterPeriodicSync,
    periodicSyncState: periodicSyncState,
    periodicSyncSupported: periodicSyncSupported,

    dueToday: dueToday,
    shouldNotify: shouldNotify,

    dayAllowed: dayAllowed,
    normalizeDays: normalizeDays,
    DAY_LABELS: DAY_LABELS,

    test: test,
    start: start,
    stop: stop,

    summary: summary,
    mirror: mirror,

    /* помощники, полезные и снаружи (и в тестах) */
    dateKey: dateKey,
    timeToMinutes: timeToMinutes,
    normalizeTime: normalizeTime,
    reminderText: reminderText,
    scheduleMirror: scheduleMirror,
    flushMirror: flushMirror,
    refreshMirror: refreshMirror,
    isHidden: isHidden
  };
})(window);

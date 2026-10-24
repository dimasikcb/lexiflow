/* ============================================================
   LexiFlow — ttsnet.js
   Сетевая озвучка: скачивание MP3 со стороннего бесплатного сервиса
   и хранение файлов в Cache API, чтобы после загрузки речь работала
   без интернета.

   Почему отдельный модуль, а не правка speech.js: у сети и кэша своя
   ответственность, а speech.js должен оставаться проверяемым без сети
   (его тесты запускаются в Node, где ни fetch, ни caches нет).

   Как это работает:
   1. providerUrl() собирает адрес запроса, cacheKey() — ключ в кэше.
   2. getAudio() сначала ищет готовый файл в кэше, потом идёт в сеть
      и кладёт результат в кэш. Второй раз та же фраза читается офлайн.
   3. play() играет файл через <audio>. Пофразовой подсветки слов при
      этом НЕТ — у MP3 нет события onboundary, и подделать его нечем.
      Поэтому текст карточки не разбивается на .tts-word и не подсве-
      чивается целиком: подсветка шла бы «на глазок» и расходилась бы
      со звуком. Пока файл играет, кнопка 🔊 просто помечена как играющая.

   Честные ограничения (проверено на этой машине 2026-09-21):
   • Сервис отвечает только на запросы с браузерным User-Agent.
     Из curl без -A приходит 403 {"error":{"code":"API_KEY_REQUIRED"}}.
     Из страницы UA всегда браузерный, поэтому это не мешает.
   • Параметр voice= не работает: Russian Female и Russian Male дают
     БАЙТОВО ОДИНАКОВЫЙ файл (8064 байта, md5 7b3137345aff76e83bd06ec9b3914382).
     Поэтому выбора голоса в интерфейсе нет — только язык.
   • Сервис бесплатный и может отказать или измениться. Любая неудача
     возвращает null, и вызывающий код падает обратно на Web Speech.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});

  /* Единственный известный адрес, который отдаёт MP3 с CORS-заголовком
     access-control-allow-origin: * — без него байты из страницы не прочитать
     и в кэш не положить (у translate.google.com CORS нет). */
  var ENDPOINT = 'https://code.responsivevoice.org/getvoice.php';

  /* Имя кэша отдельное от служебного кэша service worker (lexiflow-v1.x.x):
     обновление приложения не должно сносить скачанную озвучку, а очистка
     озвучки — ломать офлайн-оболочку. */
  var CACHE_NAME = 'lexiflow-audio-v1';

  /* Префикс синтетических ключей. Это не настоящие адреса — по ним никто
     не ходит, они нужны только как ключ в Cache API. Домен .local выбран,
     чтобы ключ никогда не совпал с реальным запросом приложения. */
  var KEY_PREFIX = 'https://lexiflow.local/audio/';

  /* Самый короткий реальный ответ сервиса — 4224 байта (одно слово из
     одной буквы). Ошибка приходит как 69 байт JSON. Порог 1024 надёжно
     отделяет одно от другого, не отсекая самые короткие фразы. */
  var MIN_AUDIO_BYTES = 1024;

  /* Сколько запросов идут одновременно. Сервис чужой и бесплатный —
     десяток параллельных запросов выглядит как атака. */
  var MAX_CONCURRENT = 2;

  /* Типы, которыми сервер и прокси отдают ошибки. Такой ответ — не звук,
     даже если размер приличный. */
  var BAD_TYPES = /^(text\/|application\/(json|xml|xhtml))/;

  /* Результат play(), когда фразу перебила следующая. Отличается от false:
     false — «звука не будет, читай системным голосом», SUPERSEDED —
     «звук уже идёт, только другой». Вызывающие проверяют ложь, поэтому
     строка здесь уместна: она истинна и не включает системный голос. */
  var SUPERSEDED = 'superseded';

  /* ---------- Чистые функции ---------- */

  /**
   * Привести текст к тому виду, в котором он уходит на сервер и ложится
   * в ключ кэша. Лишние пробелы сводятся, края обрезаются: «привет  мир»
   * и « привет мир » — это одна и та же фраза, второй запрос не нужен.
   */
  function normText(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Базовый код языка для сервиса: en-US → en.
   * Пустой код означает английский — как и везде в приложении
   * (см. speech.js: toBcp47('') → 'en-US').
   */
  function normLang(lang) {
    var s = String(lang === null || lang === undefined ? '' : lang).trim().toLowerCase().replace('_', '-');
    if (!s) return 'en';
    return s.split('-')[0];
  }

  /**
   * Адрес запроса. Чистая функция: сети не касается, поэтому её
   * проверяют тесты — в первую очередь кодирование кириллицы и знаков.
   * encodeURIComponent, а не escape/encodeURI: только он одинаково
   * безопасно кодирует и «#», и «&», и «+», и кириллицу.
   */
  function providerUrl(text, lang) {
    return ENDPOINT +
      '?t=' + encodeURIComponent(normText(text)) +
      '&tl=' + encodeURIComponent(normLang(lang));
  }

  /**
   * Ключ кэша. Стабильный: одна и та же фраза на одном языке всегда даёт
   * один ключ, поэтому повторная загрузка не нужна.
   *
   * РЕГИСТР НЕ НОРМАЛИЗУЕТСЯ — и это важно. В кэше лежат байты озвучки
   * конкретной строки: «US» и «us» сервис прочитает по-разному, «I» и «i»
   * тоже. Если свести регистр, ключ «Hello» вернул бы файл со словом
   * «hello» — то есть приложение отдало бы не то, что просили.
   * А вот пробелы нормализуются, потому что нормализованный текст уходит
   * и в providerUrl: ключ и содержимое всегда описывают одну строку.
   *
   * Язык в ключе обязателен: одно и то же слово в разных языках — разные файлы.
   */
  function cacheKey(text, lang) {
    return KEY_PREFIX + encodeURIComponent(normLang(lang)) + '/' + encodeURIComponent(normText(text));
  }

  /**
   * Похож ли ответ на звук. Отсекает ошибки сервера, отданные как текст
   * или как пустой ответ: 200 с телом {"error":…} в кэш попасть не должен,
   * иначе приложение навсегда сохранит «тишину» и будет считать, что
   * фраза скачана.
   *
   * Чистая функция — проверяется тестами без сети.
   */
  function looksLikeAudio(contentType, size) {
    var n = Number(size) || 0;
    if (n < MIN_AUDIO_BYTES) return false;
    var ct = String(contentType === null || contentType === undefined ? '' : contentType)
      .toLowerCase().trim();
    if (BAD_TYPES.test(ct)) return false;
    if (ct.indexOf('audio/') === 0) return true;
    /* Пустой или незнакомый тип: тип ничего не сказал, но ошибку мы уже
       отсеяли выше, а размер приличный. Так проходит application/octet-stream,
       которым часть серверов отдаёт mp3. */
    return ct === '' || ct === 'application/octet-stream' || ct === 'binary/octet-stream';
  }

  /* ---------- Окружение ---------- */

  function supported() {
    return typeof global.caches !== 'undefined' && typeof global.fetch === 'function';
  }

  function online() {
    try {
      return !(global.navigator && global.navigator.onLine === false);
    } catch (e) { return true; }
  }

  /**
   * Разрешена ли сетевая озвучка в настройках. По умолчанию разрешена —
   * запрет должен быть явным (`enabled: false`), иначе обновление
   * приложения молча вернуло бы пользователя к роботизированному голосу.
   */
  function enabled() {
    try {
      var st = App.store && App.store.settings ? App.store.settings() : null;
      if (!st || !st.ttsNet) return true;
      return st.ttsNet.enabled !== false;
    } catch (e) { return true; }
  }

  /**
   * Нужен ли для этого языка сетевой голос. Решает качество системного:
   * «нет голоса» и «робот» — повод идти в сеть, а обычный или
   * нейросетевой системный голос лучше не трогать вовсе.
   *
   * Здесь же живёт главная экономия: при хорошем системном голосе мы
   * не отправляем текст фраз на чужой сервер ни разу.
   */
  function needsNetwork(lang) {
    var SP = App.speech;
    if (!SP || typeof SP.voiceQuality !== 'function') return false;
    try {
      var v = typeof SP.resolveVoice === 'function' ? SP.resolveVoice(lang) : null;
      var q = SP.voiceQuality(v, lang);
      return q.level === 'none' || q.level === 'poor';
    } catch (e) { return false; }
  }

  function setDownloaded(bytes) {
    try {
      if (!App.store || !App.store.settings) return;
      var cur = App.store.settings().ttsNet || {};
      if (cur.downloaded === bytes) return;
      App.store.updateSettings({ ttsNet: { enabled: !!cur.enabled, downloaded: bytes } });
    } catch (e) { /* настройки недоступны — не повод ломать загрузку */ }
  }

  /**
   * Стоит ли озвучивать файлом, а не синтезом речи.
   *
   * Три условия, и все разные:
   *   1. браузер умеет Cache и fetch;
   *   2. системный голос для этого языка плохой или его нет — при хорошем
   *      голосе файлы не нужны вовсе;
   *   3. озвучку из интернета разрешили ИЛИ в приложении есть свой пакет
   *      файлов. Пакет — это локальные файлы, они не уходят на сервер,
   *      поэтому работают и при выключенном режиме, и без интернета.
   *
   * Офлайн здесь не проверяется намеренно: без сети файлы из пакета и
   * из кэша всё равно годятся, а неудачная попытка скачать просто
   * вернёт null, и вызывающий уйдёт на системный голос.
   */
  function available(lang) {
    if (!supported()) return false;
    if (lang && !needsNetwork(lang)) return false;
    if (enabled()) return true;
    return hasPack();
  }

  /**
   * Озвучим ли этот язык файлом на самом деле — с учётом офлайна.
   *
   * available() отвечает «стоит ли пытаться», а здесь нужен ответ «получится
   * ли»: без интернета и без своих файлов скачивать нечего, и приложение
   * уйдёт на системный голос. Этим пользуется подсказка перед тренировкой,
   * чтобы не обещать качественную озвучку, которой не будет.
   *
   * Оговорка честная: hasPack() говорит лишь, что пакет есть, а не что в нём
   * лежит именно эта фраза. Для свежесобранного пакета это одно и то же.
   */
  function willUseFiles(lang) {
    if (!available(lang)) return false;
    if (online()) return true;
    return hasPack();
  }

  /* ---------- Кэш ---------- */

  function openCache() {
    return global.caches.open(CACHE_NAME);
  }

  /** Файл из кэша или null. Ошибки хранилища не должны ломать озвучку. */
  function cacheGet(text, lang) {
    if (!supported()) return Promise.resolve(null);
    return openCache().then(function (cache) {
      return cache.match(cacheKey(text, lang));
    }).then(function (res) {
      if (!res) return null;
      return res.blob().then(function (blob) {
        return blob && blob.size > 0 ? blob : null;
      });
    }).catch(function () { return null; });
  }

  function cachePut(text, lang, blob) {
    if (!supported() || !blob) return Promise.resolve(false);
    return openCache().then(function (cache) {
      var key = new global.Request(cacheKey(text, lang));
      var res = new global.Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } });
      return cache.put(key, res).then(function () { return true; });
    }).catch(function () { return false; });
  }

  /* ---------- Сеть ---------- */

  /**
   * Скачать озвучку одной фразы.
   * Промис НИКОГДА не отклоняется: любая неудача — это null, и вызывающий
   * код спокойно возвращается к системному голосу.
   */
  function fetchAudio(text, lang) {
    if (!supported()) return Promise.resolve(null);
    var t = normText(text);
    if (!t) return Promise.resolve(null);
    if (!online()) return Promise.resolve(null);

    return global.fetch(providerUrl(t, lang), {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      if (!res || !res.ok) return null;
      var ct = (res.headers && res.headers.get) ? res.headers.get('content-type') : '';
      return res.blob().then(function (blob) {
        if (!blob || !looksLikeAudio(ct, blob.size)) return null;
        return blob;
      });
    }).catch(function () { return null; });
  }

  /* ---------- Пакет озвучки внутри приложения ---------- */

  /* Манифест и файлы кладёт tools/build-audio-pack.js: это готовая озвучка
     слов приложения, скачанная один раз и лежащая рядом с кодом. */
  var PACK_FILE = 'audio/manifest.json';
  var pack = null;          // загруженный манифест
  var packTried = false;    // уже пробовали — второй раз не дёргаем
  var packPending = null;

  /**
   * Манифест пакета. Пакета может не быть вовсе (приложение поставляется
   * и без него) — тогда null, и всё работает как прежде.
   */
  function loadPack() {
    if (pack) return Promise.resolve(pack);
    if (packTried) return Promise.resolve(null);
    if (!supported()) return Promise.resolve(null);
    if (packPending) return packPending;
    packTried = true;
    packPending = global.fetch(PACK_FILE, { credentials: 'same-origin', cache: 'no-cache' })
      .then(function (res) { return (res && res.ok) ? res.json() : null; })
      .then(function (json) {
        pack = (json && json.phrases) ? json : null;
        return pack;
      })
      .catch(function () { pack = null; return null; });
    return packPending;
  }

  /**
   * Запись пакета для фразы. Чистая функция: манифест передаётся явно,
   * поэтому её проверяют тесты без сети и без загрузки файла.
   */
  function packEntryIn(manifest, text, lang) {
    if (!manifest || !manifest.phrases) return null;
    var entry = manifest.phrases[cacheKey(text, lang)];
    return (entry && entry.file) ? entry : null;
  }

  /** Файл из пакета для фразы. По уже загруженному манифесту. */
  function packFile(text, lang) {
    var entry = packEntryIn(pack, text, lang);
    return entry ? String(entry.file) : null;
  }

  /** Загружен ли пакет (синхронно, по уже прочитанному манифесту). */
  function hasPack() { return !!pack; }

  function packAudio(text, lang) {
    return loadPack().then(function () {
      var file = packFile(text, lang);
      if (!file) return null;
      return global.fetch(file, { credentials: 'same-origin' }).then(function (res) {
        if (!res || !res.ok) return null;
        return res.blob().then(function (blob) {
          return (blob && looksLikeAudio(blob.type, blob.size)) ? blob : null;
        });
      }).catch(function () { return null; });
    });
  }

  /**
   * Порядок: свои файлы → кэш → сеть.
   *
   * Пакет стоит первым, потому что он уже лежит в приложении: ни сети,
   * ни Cache API не нужно, а значит озвучка работает сразу после первой
   * установки и в офлайне. Кэш — то, что докачал сам пользователь.
   * Сеть — только последняя инстанция.
   */
  function getAudio(text, lang) {
    if (!supported()) return Promise.resolve(null);
    var t = normText(text);
    if (!t) return Promise.resolve(null);

    return packAudio(t, lang).then(function (packed) {
      if (packed) return packed;
      return cacheGet(t, lang).then(function (cached) {
        if (cached) return cached;
        if (!enabled() || !online()) return null;
        return fetchAudio(t, lang).then(function (blob) {
          if (!blob) return null;
          return cachePut(t, lang, blob).then(function () { return blob; });
        });
      });
    });
  }

  /* ---------- Проигрывание ---------- */

  var currentAudio = null;   // ссылка держится: иначе сборщик мусора оборвёт звук
  var currentUrl = '';       // objectURL, который надо освободить
  var playingButton = null;
  var currentOnEnd = null;   // чужой колбэк окончания (кнопка из speech.js)

  function releaseAudio() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        /* Снимаем адрес ДО отзыва blob-ссылки. Иначе загрузка, которая ещё
           не закончилась, остаётся висеть на уже несуществующем адресе и
           падает с ERR_FILE_NOT_FOUND — в консоли это выглядит как ошибка
           приложения, хотя звук мы просто остановили сами. */
        currentAudio.removeAttribute('src');
      } catch (e) { /* ignore */ }
      currentAudio = null;
    }
    if (currentUrl && global.URL && global.URL.revokeObjectURL) {
      try { global.URL.revokeObjectURL(currentUrl); } catch (e) { /* ignore */ }
    }
    currentUrl = '';
  }

  function markPlaying(btn, on) {
    if (!btn || !btn.classList) return;
    if (on) {
      playingButton = btn;
      btn.classList.add('is-playing');
    } else {
      btn.classList.remove('is-playing');
      if (playingButton === btn) playingButton = null;
    }
  }

  function makeAudio() {
    if (typeof global.Audio === 'function') return new global.Audio();
    if (global.document && global.document.createElement) return global.document.createElement('audio');
    return null;
  }

  /**
   * Остановить сетевую озвучку. Зовётся в том числе из speech.stop(),
   * чтобы кнопка 🔊 вела себя одинаково для файла и для синтеза речи.
   */
  function stop() {
    releaseAudio();
    if (playingButton) markPlaying(playingButton, false);
    /* Остановка извне (уход с экрана, очистка кэша) должна снять отметку
       и во втором месте: кнопку рисует speech.js и держит своё состояние. */
    var cb = currentOnEnd;
    currentOnEnd = null;
    if (cb) { try { cb(); } catch (e) { /* ignore */ } }
  }

  /**
   * Проиграть фразу из кэша или из сети.
   * @returns Promise<boolean|string> — true, если звук действительно начал
   *   играть; SUPERSEDED, если эту фразу перебила следующая (звук идёт, но
   *   другой); false означает «не получилось», и вызывающий обязан упасть
   *   обратно на Web Speech. Промис не отклоняется никогда.
   *
   * @param {object} [opts] — { button } кнопка, которой управляет is-playing
   */
  function play(text, lang, opts) {
    opts = opts || {};
    if (!supported()) return Promise.resolve(false);

    return getAudio(text, lang).then(function (blob) {
      if (!blob) return false;

      var audio = makeAudio();
      if (!audio) return false;
      if (!global.URL || !global.URL.createObjectURL) return false;

      stop();
      try {
        currentUrl = global.URL.createObjectURL(blob);
      } catch (e) { return false; }

      audio.src = currentUrl;
      audio.preload = 'auto';
      currentAudio = audio;
      currentOnEnd = opts.onend || null;
      markPlaying(opts.button, true);

      var finished = false;
      function done() {
        if (finished) return;
        finished = true;
        /* Освобождаем только свой файл: к этому моменту могло начаться
           проигрывание другой фразы, и её трогать нельзя. */
        if (currentAudio === audio) releaseAudio();
        markPlaying(opts.button, false);
        var cb = currentOnEnd;
        currentOnEnd = null;
        if (cb) { try { cb(); } catch (e) { /* ignore */ } }
      }
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = function () {
        // остановка извне (stop(), уход с экрана) — снимаем отметку с кнопки
        if (audio.paused) markPlaying(opts.button, false);
      };

      var started = audio.play();
      if (started && typeof started.then === 'function') {
        return started.then(function () { return true; }).catch(function () {
          done(false);
          /* Нас перебила другая фраза: пока файл грузился, начали играть
             следующий. Это НЕ провал — значит, звук идёт, просто другой.
             Если здесь вернуть false, вызывающий услужливо включит системный
             голос поверх уже звучащего файла, и человек слышит робота там,
             где уже звучит нормальная озвучка. */
          if (currentAudio && currentAudio !== audio) return SUPERSEDED;
          /* Автовоспроизведение запрещено браузером или файл не открылся.
             Это не ошибка приложения: просто играем системным голосом. */
          return false;
        });
      }
      return true;
    }).catch(function () { return false; });
  }

  /* ============================================================
     Остановка при уходе с экрана

     Звук из свёрнутого окна — та же проблема, что и у синтеза речи:
     браузер не замолкает сам. Слушатели на события, а не таймеры:
     мобильные браузеры замораживают таймеры в фоне.
     ============================================================ */
  function stopWhenHidden() {
    if (global.document && global.document.visibilityState === 'hidden') stop();
  }
  if (global.document && typeof global.document.addEventListener === 'function') {
    global.document.addEventListener('visibilitychange', stopWhenHidden);
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('pagehide', function () { stop(); });
  }

  /* ---------- Пачка ---------- */

  /** Список уникальных нормализованных фраз без пустых строк. */
  function uniqueTexts(texts) {
    var seen = {}, out = [];
    (texts || []).forEach(function (t) {
      var s = normText(t);
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out;
  }

  /**
   * Скачать пачку фраз (колода или сессия) с прогрессом.
   *
   * Параллелизм ограничен MAX_CONCURRENT: сервис чужой и бесплатный,
   * десяток одновременных запросов выглядит как атака.
   *
   * @param {string[]} texts
   * @param {string} lang
   * @param {function} [onProgress] — { done, total, bytes, failed }
   * @returns Promise<{done, total, bytes, failed, stopped}>
   *   done — сколько фраз доступно офлайн после загрузки (включая те,
   *   что уже лежали в кэше), bytes — сколько байт скачано именно в этом
   *   запуске, failed — сколько фраз не удалось получить, stopped — правда,
   *   если страница выгружалась и очередь оборвалась на середине.
   *   Общий размер кэша берётся из stats(), а не отсюда.
   */
  function preload(texts, lang, onProgress) {
    var list = uniqueTexts(texts);
    var result = { done: 0, total: list.length, bytes: 0, failed: 0, stopped: false };
    if (!list.length) return Promise.resolve(result);
    if (!available()) {
      result.failed = list.length;
      if (onProgress) onProgress(result);
      return Promise.resolve(result);
    }

    var queue = list.slice();
    var active = 0;
    var stopped = false;

    /* Оборвать загрузку на visibilitychange нельзя: её человек запустил сам,
       и переключение вкладки не должно её прерывать. А pagehide означает,
       что страница уходит насовсем — начинать новые запросы бессмысленно.
       Событие, а не таймер: мобильные браузеры таймеры в фоне замораживают. */
    function onPageHide() { stopped = true; }
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('pagehide', onPageHide);
    }

    function cleanup() {
      if (typeof global.removeEventListener === 'function') {
        global.removeEventListener('pagehide', onPageHide);
      }
    }

    return new Promise(function (resolve) {
      function report() {
        if (onProgress) onProgress(result);
      }

      function pump() {
        if (stopped) {
          result.stopped = true;
          if (!active) { cleanup(); resolve(result); }
          return;
        }
        /* Ограничение параллелизма стоит здесь, а не только у вызывающего:
           тогда и стартовый запуск, и «добор» после каждой фразы проходят
           через одну проверку, и больше MAX_CONCURRENT запросов не бывает. */
        if (active >= MAX_CONCURRENT) return;
        if (!queue.length) {
          if (!active) { cleanup(); resolve(result); }
          return;
        }
        var text = queue.shift();
        active++;
        getAudio(text, lang).then(function (blob) {
          if (blob) {
            result.done++;
            result.bytes += blob.size;
          } else {
            result.failed++;
          }
        }).then(function () {
          active--;
          report();
          pump();
        });
        pump();   // добираем параллелизм, пока он ниже предела
      }

      for (var i = 0; i < MAX_CONCURRENT; i++) pump();
      report();
    });
  }

  /* ---------- Статистика и очистка ---------- */

  /**
   * Сколько фраз скачано и сколько это занимает.
   * Это единственный честный источник для «подтверждения загрузки»:
   * число берётся из кэша, а не из настроек, поэтому его нельзя
   * «унаследовать» с другого устройства.
   * @returns Promise<{count, bytes}>
   */
  function stats() {
    if (!supported()) return Promise.resolve({ count: 0, bytes: 0 });
    return openCache().then(function (cache) {
      return cache.keys().then(function (keys) {
        var mine = (keys || []).filter(function (req) {
          return String(req && req.url || '').indexOf(KEY_PREFIX) === 0;
        });
        return Promise.all(mine.map(function (req) {
          return cache.match(req).then(function (res) {
            if (!res) return 0;
            return res.blob().then(function (b) { return b ? b.size : 0; });
          }).catch(function () { return 0; });
        })).then(function (sizes) {
          var bytes = 0;
          sizes.forEach(function (n) { bytes += n; });
          return { count: mine.length, bytes: bytes };
        });
      });
    }).catch(function () { return { count: 0, bytes: 0 }; });
  }

  /** Полная очистка скачанной озвучки. Оболочка приложения не затрагивается. */
  function purge() {
    if (!supported()) return Promise.resolve(0);
    stop();
    return openCache().then(function (cache) {
      return cache.keys().then(function (keys) {
        var mine = (keys || []).filter(function (req) {
          return String(req && req.url || '').indexOf(KEY_PREFIX) === 0;
        });
        return Promise.all(mine.map(function (req) {
          return cache.delete(req).catch(function () { return false; });
        })).then(function () {
          setDownloaded(0);
          return mine.length;
        });
      });
    }).catch(function () { return 0; });
  }

  /* Манифест пакета читаем сразу при загрузке: он маленький, а знать о
     готовых файлах нужно до того, как человек нажмёт 🔊 — иначе первый
     звук ушёл бы в сеть, хотя лежит рядом. */
  if (supported()) loadPack();

  App.ttsnet = {
    ENDPOINT: ENDPOINT,
    CACHE_NAME: CACHE_NAME,
    KEY_PREFIX: KEY_PREFIX,
    MIN_AUDIO_BYTES: MIN_AUDIO_BYTES,
    MAX_CONCURRENT: MAX_CONCURRENT,
    SUPERSEDED: SUPERSEDED,
    normText: normText,
    normLang: normLang,
    providerUrl: providerUrl,
    cacheKey: cacheKey,
    looksLikeAudio: looksLikeAudio,
    supported: supported,
    online: online,
    enabled: enabled,
    needsNetwork: needsNetwork,
    available: available,
    willUseFiles: willUseFiles,
    PACK_FILE: PACK_FILE,
    loadPack: loadPack,
    packEntryIn: packEntryIn,
    packFile: packFile,
    hasPack: hasPack,
    packAudio: packAudio,
    fetchAudio: fetchAudio,
    getAudio: getAudio,
    play: play,
    stop: stop,
    preload: preload,
    stats: stats,
    purge: purge,
    setDownloaded: setDownloaded
  };
})(window);

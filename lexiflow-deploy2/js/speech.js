/* ============================================================
   LexiFlow — speech.js
   Озвучивание через Web Speech API (работает офлайн на устройстве).

   Что сделано «поверх» браузера, чтобы речь звучала чище:

   • Голос выбирается по качеству. Нейросетевые и облачные голоса
     (Microsoft … Online (Natural), Google, Siri) звучат заметно
     естественнее системных «compact» — им даётся приоритет.
     Пользователь может закрепить конкретный голос в настройках.
   • Между репликами выдерживается пауза. Без неё Chrome обрывает
     начало следующей фразы — это и есть тот самый «щелчок».
   • Утterance удерживается в переменной. Иначе сборщик мусора может
     «съесть» фразу на середине — речь обрывается на полуслове.
   • Ждём загрузку списка голосов. Иначе первая фраза читается
     голосом по умолчанию, часто роботизированным.
   • Длинные фразы периодически «подталкиваем»: движок ставит их
     на паузу после ~15 секунд и не всегда доводит до конца.
   • Событие onboundary превращаем в субтитры: подсвечиваем то слово,
     которое произносится прямо сейчас, — текст и звук не расходятся.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});

  var LANGS = {
    en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT',
    ru: 'ru-RU', pl: 'pl-PL', tr: 'tr-TR', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
    ar: 'ar-SA', nl: 'nl-NL', sv: 'sv-SE', cs: 'cs-CZ', uk: 'uk-UA', he: 'he-IL',
    hi: 'hi-IN', el: 'el-GR', fi: 'fi-FI', no: 'nb-NO', da: 'da-DK', hu: 'hu-HU', ro: 'ro-RO'
  };

  var LANG_NAMES = {
    en: 'Английский', de: 'Немецкий', fr: 'Французский', es: 'Испанский', it: 'Итальянский',
    pt: 'Португальский', ru: 'Русский', pl: 'Польский', tr: 'Турецкий', zh: 'Китайский',
    ja: 'Японский', ko: 'Корейский', ar: 'Арабский', nl: 'Нидерландский', sv: 'Шведский',
    cs: 'Чешский', uk: 'Украинский', he: 'Иврит', hi: 'Хинди', el: 'Греческий',
    fi: 'Финский', no: 'Норвежский', da: 'Датский', hu: 'Венгерский', ro: 'Румынский'
  };

  /* Пауза между репликами: даёт движку полностью остановиться. */
  var MIN_GAP_MS = 70;
  /* Сколько ждём список голосов, если он ещё не загрузился. */
  var VOICES_WAIT_MS = 700;
  /* С такой длины фразы включаем «подталкивание» движка. */
  var LONG_TEXT = 90;
  /* Максимальная длина одного куска речи: длинные движок читает невыразительно. */
  var MAX_CHUNK = 110;
  /* Пауза между фразами внутри одной реплики, мс (при rate = 1). */
  var CHUNK_GAP = 170;

  /* Оценка качества голоса: чем выше балл, тем естественнее звучание. */
  var GOOD_HINTS = [
    [/natural|neural|premium|enhanced|multilingual/i, 60],
    [/google/i, 45],
    [/siri/i, 40],
    [/yandex|alena|milena/i, 30],
    [/online|network/i, 20]
  ];
  var BAD_HINTS = [
    [/compact|espeak|festival|pico|robot|sam\b/i, -45],
    [/novelty|whisper|zarvox|bells|bubbles|cellos|trinoids|jester|organ|boing|bahh|deranged|hysterical/i, -60]
  ];

  function supported() {
    return typeof global.speechSynthesis !== 'undefined' && typeof global.SpeechSynthesisUtterance !== 'undefined';
  }

  function toBcp47(code) {
    if (!code) return 'en-US';
    if (String(code).indexOf('-') > 0) return code;
    return LANGS[String(code).toLowerCase()] || code;
  }

  /** Базовый код языка: en-US → en. */
  function baseLang(code) {
    return String(toBcp47(code)).toLowerCase().split('-')[0];
  }

  /* ---------- Голоса ---------- */

  var voices = [];

  function refreshVoices() {
    /* API может исчезнуть уже после загрузки (приватный режим, смена
       настроек браузера). Тогда голосов нет, а не «остались прежние»:
       иначе приложение продолжало бы считать, что голос есть. */
    if (!supported()) { voices = []; return voices; }
    try { voices = global.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    return voices;
  }

  if (supported()) {
    refreshVoices();
    try { global.speechSynthesis.onvoiceschanged = refreshVoices; } catch (e) { /* ignore */ }
  }

  /**
   * Насколько голос подходит для языка. Чистая функция — её проверяют тесты.
   * Чужой язык получает большой минус, поэтому «похожий» голос никогда
   * не перебьёт правильный.
   */
  function scoreVoice(v, lang) {
    if (!v) return -1000;
    var target = String(toBcp47(lang)).toLowerCase().replace('_', '-');
    var base = target.split('-')[0];
    var vlang = String(v.lang || '').toLowerCase().replace('_', '-');
    var score = 0;

    if (vlang === target) score += 100;
    else if (vlang.split('-')[0] === base) score += 65;
    else score -= 200;

    var name = String(v.name || '');
    GOOD_HINTS.forEach(function (h) { if (h[0].test(name)) score += h[1]; });
    BAD_HINTS.forEach(function (h) { if (h[0].test(name)) score += h[1]; });

    // сетевые голоса обычно синтезируются на сервере и звучат естественнее
    if (v.localService === false) score += 12;
    if (v.default) score += 2;
    return score;
  }

  /** Все голоса для языка, отсортированные от лучшего к худшему. */
  function voicesFor(lang) {
    if (!voices.length) refreshVoices();
    var base = baseLang(lang);
    return voices
      .filter(function (v) { return String(v.lang || '').toLowerCase().replace('_', '-').split('-')[0] === base; })
      .slice()
      .sort(function (a, b) { return scoreVoice(b, lang) - scoreVoice(a, lang); });
  }

  /**
   * Голос для языка.
   * @param {string} lang
   * @param {string} [voiceURI] — закреплённый пользователем голос
   * @param {boolean} [preferLocal] — офлайн: берём только локальные
   */
  function resolveVoice(lang, voiceURI, preferLocal) {
    if (!voices.length) refreshVoices();
    if (voiceURI) {
      var exact = voices.filter(function (v) { return v.voiceURI === voiceURI; })[0];
      if (exact) return exact;
    }
    var list = voicesFor(lang);
    if (preferLocal) {
      var local = list.filter(function (v) { return v.localService !== false; });
      if (local.length) return local[0];
    }
    return list[0] || null;
  }

  function pickVoice(lang) { return resolveVoice(lang); }

  function hasVoiceFor(lang) { return !!pickVoice(lang); }

  /* Названия браузеров: от них зависит, какие голоса вообще доступны. */
  function browserName(uaOverride) {
    var ua = String(uaOverride !== undefined
      ? uaOverride
      : ((global.navigator && global.navigator.userAgent) || ''));
    if (/Edg\//.test(ua)) return 'Edge';
    if (/YaBrowser/.test(ua)) return 'Яндекс Браузер';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'неизвестный';
  }

  /**
   * Насколько голос звучит «по-человечески». Отдельная функция, потому что
   * пользователю важно не число, а понятный вердикт и что делать дальше.
   */
  function voiceQuality(v, lang) {
    if (!v) {
      return {
        level: 'none',
        label: 'Голос не найден',
        hint: 'В системе нет голоса для этого языка — речь будет читаться чужим произношением.'
      };
    }
    var name = String(v.name || '');
    if (/natural|neural|premium|enhanced|multilingual|siri|google/i.test(name) || v.localService === false) {
      return { level: 'neural', label: 'Нейросетевой', hint: 'Звучит естественно — это лучший вариант.' };
    }
    if (/compact|espeak|festival|pico|robot|microsoft david|microsoft zira|microsoft irina|microsoft pavel/i.test(name)) {
      return {
        level: 'poor',
        label: 'Роботизированный',
        hint: 'Звучит механически. Откройте приложение в Microsoft Edge — там есть нейросетевые голоса Microsoft Natural.'
      };
    }
    return { level: 'normal', label: 'Системный', hint: 'Обычный системный голос, без нейросети.' };
  }

  /** Человеческое название языка: 'en' → «Английский». */
  function langName(lang) {
    var base = baseLang(lang);
    return LANG_NAMES[base] || base;
  }

  /**
   * Что сказать человеку про голоса для этих языков.
   * Возвращает null, если озвучка в порядке, иначе {level, title, text}.
   *
   * Живёт здесь, а не на экране тренировки, по двум причинам: это вывод
   * о голосах, а не о разметке, и так его можно проверить тестами без браузера.
   */
  function voiceAdvice(langs) {
    var list = (langs || []).filter(Boolean);
    if (!list.length) return null;

    if (!supported()) {
      return {
        level: 'unsupported',
        title: 'Браузер не умеет озвучивать',
        text: 'Кнопка 🔊 не появится: этот браузер не поддерживает синтез речи. ' +
          'Откройте LexiFlow в Chrome, Edge или Safari.'
      };
    }

    var worst = worstQuality(list);
    if (!worst || worst.level === 'normal' || worst.level === 'neural') return null;

    /* Плохой системный голос — ещё не повод человека тревожить: если фразы
       этой тренировки приложение прочитает файлом, системный голос тут
       ни при чём. Раньше подсказка считалась только по голосу системы,
       поэтому «Скачать качественную озвучку» висел даже тогда, когда
       качественная озвучка уже звучала. */
    if (filesCover(list)) return null;

    var names = list.map(langName).join(', ');
    if (worst.level === 'none') {
      return {
        level: 'none',
        title: 'Озвучка не установлена',
        /* Раньше здесь было «кнопка 🔊 будет молчать» — и это неправда:
           кнопка рисуется всегда при поддержке синтеза, а Chrome читает
           текст голосом по умолчанию, то есть чужим произношением.
           Человек слышит речь и не понимает, почему она такая. */
        text: 'В системе нет голоса для языка «' + names + '», поэтому кнопка 🔊 читает слова ' +
          'голосом по умолчанию — с чужим произношением. ' +
          'LexiFlow сам озвучит эти фразы голосом из интернета — он звучит естественнее системного. ' +
          'Нажмите «Скачать качественную озвучку», чтобы фразы сохранились на устройстве ' +
          'и работали без интернета.'
      };
    }
    return {
      level: 'poor',
      title: 'Озвучка звучит роботом',
      text: 'Для языка «' + names + '» в системе найден только механический голос. ' +
        'LexiFlow заменит его голосом из интернета — тот же текст звучит заметно живее. ' +
        'Нажмите «Скачать качественную озвучку», чтобы фразы сохранились на устройстве ' +
        'и работали без интернета.'
    };
  }

  /**
   * Закроет ли озвучку файлами сетевой модуль (пакет → кэш → сеть).
   * Спрашиваем его, а не угадываем: кому решать, как не ему.
   */
  function filesCover(langs) {
    var T = App.ttsnet;
    if (!T || typeof T.willUseFiles !== 'function') return false;
    var list = (langs || []).filter(Boolean);
    if (!list.length) return false;
    try {
      return list.every(function (lang) { return T.willUseFiles(lang); });
    } catch (e) { return false; }
  }

  /** Итог по всем языкам: худшее качество важнее лучшего. */
  function worstQuality(langs) {
    var order = { none: 0, poor: 1, normal: 2, neural: 3 };
    var worst = null;
    (langs || []).forEach(function (lang) {
      var q = voiceQuality(resolveVoice(lang, pinnedVoice(lang)), lang);
      if (!worst || order[q.level] < order[worst.level]) worst = q;
    });
    return worst;
  }

  /** Закреплённый пользователем голос из настроек (ключ — базовый код языка). */
  function pinnedVoice(lang) {
    try {
      var st = App.store && App.store.settings ? App.store.settings() : null;
      return (st && st.ttsVoice && st.ttsVoice[baseLang(lang)]) || '';
    } catch (e) { return ''; }
  }

  function settings() {
    try { return App.store && App.store.settings ? App.store.settings() : {}; }
    catch (e) { return {}; }
  }

  /* ---------- Подготовка текста ---------- */

  /**
   * Убираем всё, что движок читает непредсказуемо: управляющие символы,
   * невидимые маркеры, эмодзи. Плюс сводим пробелы к одному — лишние
   * паузы внутри фразы звучат как «спотыкание».
   */
  function cleanText(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufeff]/g, ' ')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Словарные сокращения: движок читает «sb» как «эс-бэ», а не «somebody». */
  var EN_ABBR = [
    [/\bsmb\.?(?=[\s,.;:!?)]|$)/gi, 'somebody'],
    [/\bsb\.?(?=[\s,.;:!?)]|$)/gi, 'somebody'],
    [/\bsmth\.?(?=[\s,.;:!?)]|$)/gi, 'something'],
    [/\bsth\.?(?=[\s,.;:!?)]|$)/gi, 'something'],
    [/\be\.\s?g\.(?=\s|$|,)/gi, 'for example'],
    [/\bi\.\s?e\.(?=\s|$|,)/gi, 'that is'],
    [/\bvs\.?(?=\s|$)/gi, 'versus'],
    [/\betc\.?(?=\s|$)/gi, 'etcetera'],
    [/\bBrE\b/g, 'British English'],
    [/\bAmE\b/g, 'American English'],
    [/\badj\.(?=\s)/gi, 'adjective'],
    [/\badv\.(?=\s)/gi, 'adverb']
  ];

  /**
   * Привести текст к тому, как его стоит произносить.
   * Пунктуация-разделитель превращается в запятую: движок читает её как
   * короткую паузу, поэтому перечисление через «→» звучит естественно.
   */
  function normalizeForSpeech(text, lang) {
    var s = String(text === null || text === undefined ? '' : text);
    if (!s) return '';
    s = s.replace(/\s*[→⇒]\s*/g, ', ');
    s = s.replace(/\s+[-–—]\s+/g, ', ');
    s = s.replace(/\s+\/\s+/g, ', ');
    s = s.replace(/\s*\|\s*/g, ', ');
    if (baseLang(lang) === 'en') {
      EN_ABBR.forEach(function (pair) { s = s.replace(pair[0], pair[1]); });
      s = s.replace(/\s*&\s*/g, ' and ');
    }
    return s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  }

  /**
   * Разбить текст на фразы. Движок читает каждую фразу отдельной репликой,
   * поэтому между ними появляется настоящая пауза — речь перестаёт «тараторить»
   * одним потоком. Заодно ни одна реплика не выходит за лимит, после которого
   * Chrome обрывает длинную фразу.
   *
   * Возвращает [{ text, start }], где start — индекс начала фразы
   * в исходной строке (нужен для подсветки слов).
   */
  function chunkText(text, maxLen) {
    var limit = maxLen || MAX_CHUNK;
    var s = String(text === null || text === undefined ? '' : text);
    var out = [];
    var i = 0;
    var n = s.length;

    while (i < n) {
      while (i < n && /\s/.test(s.charAt(i))) i++;
      if (i >= n) break;

      var start = i;
      var windowEnd = Math.min(n, i + limit);
      var cut = windowEnd;

      if (windowEnd < n) {
        var win = s.slice(i, windowEnd);

        // Приоритет границ: конец предложения → знак сильнее запятой → пробел.
        // Так реплика по возможности заканчивается там, где в речи и так пауза.
        var sentEnd = -1, m;
        var reSent = /[.!?…]+["»')\]]?(?=\s|$)/g;
        while ((m = reSent.exec(win)) !== null) sentEnd = m.index + m[0].length;

        var strongEnd = -1;
        var reStrong = /[,;:—–]\s/g;
        while ((m = reStrong.exec(win)) !== null) strongEnd = m.index + m[0].length;

        if (sentEnd >= 20) cut = i + sentEnd;
        else if (strongEnd >= 24) cut = i + strongEnd;
        else if (sentEnd > 0) cut = i + sentEnd;      // короткое предложение — режем по нему
        else {
          var sp = win.lastIndexOf(' ');
          if (sp > 12) cut = i + sp + 1;
        }
      }

      if (cut <= start) cut = windowEnd;   // страховка от зацикливания

      var piece = s.slice(start, cut).trim();
      if (piece) out.push({ text: piece, start: start });
      i = cut;
    }

    if (!out.length && s.trim()) out.push({ text: s.trim(), start: s.indexOf(s.trim()) });
    return out;
  }

  /* ---------- Субтитры: подсветка произносимого слова ---------- */

  /**
   * Разбить текст элемента на слова и подсвечивать то, что читается сейчас.
   * Работает на событии onboundary (Chrome, Edge, Firefox). Если браузер
   * его не присылает, подсветка просто не появляется — текст не ломается.
   */
  function makeHighlighter(el, text) {
    if (!el || !global.document) return null;
    var doc = global.document;
    var tokens = [];
    var frag = doc.createDocumentFragment();
    var re = /\S+/g;
    var m, last = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      var span = doc.createElement('span');
      span.className = 'tts-word';
      span.textContent = m[0];
      frag.appendChild(span);
      tokens.push({ start: m.index, end: m.index + m[0].length, el: span });
      last = m.index + m[0].length;
    }
    if (!tokens.length) return null;
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));

    var prev = null;
    try {
      el.textContent = '';
      el.appendChild(frag);
    } catch (e) { return null; }

    function activate(node) {
      if (!node || node === prev) return;
      if (prev) prev.classList.remove('is-spoken');
      node.classList.add('is-spoken');
      prev = node;
    }

    return {
      mark: function (charIndex, charLength) {
        var from = charIndex;
        var to = charIndex + (charLength || 1);
        for (var i = 0; i < tokens.length; i++) {
          if (tokens[i].end > from && tokens[i].start < to) { activate(tokens[i].el); return; }
        }
      },
      /** Подсветить слово по счёту — для браузеров без onboundary (Safari). */
      markAt: function (index) {
        if (tokens[index]) activate(tokens[index].el);
      },
      reset: function () {
        tokens.forEach(function (t) { t.el.classList.remove('is-spoken'); });
        prev = null;
      },
      words: tokens.length
    };
  }

  /* ---------- Произнесение ---------- */

  var current = null;      // держим ссылку: иначе Chrome теряет utterance в GC
  var watchdog = null;     // «подталкивание» длинных фраз
  var fallback = null;     // расчётная подсветка для браузеров без onboundary
  var runToken = 0;        // отменяет отложенный запуск, если попросили другой текст
  var speakingFlag = false;

  function clearWatchdog() {
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
  }

  function clearFallback() {
    if (fallback) { clearInterval(fallback); clearTimeout(fallback); fallback = null; }
  }

  /**
   * Chrome и Edge ставят длинную фразу на паузу примерно через 15 секунд.
   * Периодический pause/resume заставляет движок дочитать её до конца.
   */
  function startWatchdog() {
    clearWatchdog();
    watchdog = setInterval(function () {
      var syn = global.speechSynthesis;
      var alive = false;
      try { alive = syn.speaking; } catch (e) { alive = false; }
      if (!alive) { clearWatchdog(); return; }
      try { syn.pause(); syn.resume(); } catch (e) { clearWatchdog(); }
    }, 9000);
  }

  /**
   * Полная остановка текущей реплики и ожидание паузы.
   * Именно этот шаг убирает «щелчок» и проглоченное первое слово.
   */
  function hardStop(cb) {
    var syn = global.speechSynthesis;
    var started = Date.now();
    try { syn.cancel(); } catch (e) { /* ignore */ }
    (function wait() {
      var busy = false;
      try { busy = syn.speaking || syn.pending; } catch (e) { busy = false; }
      var elapsed = Date.now() - started;
      if ((!busy && elapsed >= MIN_GAP_MS) || elapsed > 500) { cb(); return; }
      setTimeout(wait, 20);
    })();
  }

  /** Ждём список голосов, но не дольше VOICES_WAIT_MS. */
  function whenVoicesReady(cb) {
    if (voices.length) { cb(); return; }
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      refreshVoices();
      cb();
    }, VOICES_WAIT_MS);
    var handler = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      refreshVoices();
      cb();
    };
    try { global.speechSynthesis.addEventListener('voiceschanged', handler, { once: true }); }
    catch (e) { /* браузер без addEventListener на synthesis — сработает таймаут */ }
  }

  /**
   * Произнести одну фразу.
   * @param {object} [highlighter] — общий на всю реплику подсветчик слов;
   *   сбрасывать его между фразами нельзя, поэтому это забота вызывающего.
   * @param {number} [offset] — смещение фразы в полном тексте, для подсветки.
   */
  function fire(text, lang, opts, highlighter, offset) {
    whenVoicesReady(function () {
      var syn = global.speechSynthesis;
      var st = settings();
      var u = new global.SpeechSynthesisUtterance(text);

      var voice = resolveVoice(lang, opts.voiceURI || pinnedVoice(lang), !global.navigator.onLine);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang || toBcp47(lang);
      } else {
        u.lang = toBcp47(lang);
      }

      // Громкость всегда максимальная: «ровнее» звук делает не она,
      // а отсутствие наложения реплик друг на друга.
      u.rate = App.util.clamp(opts.rate || st.ttsRate || 0.95, 0.4, 1.6);
      u.pitch = App.util.clamp(opts.pitch || st.ttsPitch || 1, 0.5, 1.6);
      u.volume = App.util.clamp(opts.volume === undefined ? (st.ttsVolume === undefined ? 1 : st.ttsVolume) : opts.volume, 0, 1);

      var highlight = highlighter || null;
      var finished = false;
      var boundarySeen = false;

      function finish() {
        if (finished) return;
        finished = true;
        clearWatchdog();
        clearFallback();
        speakingFlag = false;
        current = null;
        if (opts.onend) opts.onend();
      }

      /**
       * Safari не присылает onboundary вообще. Если за 450 мс ни одного
       * события не пришло — подсвечиваем слова по расчётному темпу речи.
       */
      function startFallbackHighlight() {
        if (!highlight || highlight.words < 1) return;
        var charsPerSec = 14 * (u.rate || 1);
        var total = Math.max(600, (text.length / charsPerSec) * 1000);
        var step = Math.max(140, total / highlight.words);
        var i = 0;
        fallback = setTimeout(function () {
          if (finished || boundarySeen) return;
          fallback = setInterval(function () {
            if (finished || boundarySeen) { clearFallback(); return; }
            if (i >= highlight.words) { clearFallback(); return; }
            highlight.markAt(i++);
          }, step);
        }, 450);
      }

      u.onstart = function () {
        speakingFlag = true;
        startFallbackHighlight();
        if (opts.onstart) opts.onstart();
      };
      u.onboundary = function (e) {
        if (highlight && e && typeof e.charIndex === 'number') {
          boundarySeen = true;
          clearFallback();      // живая синхронизация точнее расчётной
          highlight.mark((offset || 0) + e.charIndex, e.charLength);
        }
        if (opts.onboundary) opts.onboundary(e);
      };
      u.onend = finish;
      u.onerror = finish;

      current = u;
      try {
        syn.speak(u);
      } catch (e) {
        console.warn('LexiFlow: TTS недоступен', e);
        finish();
        return;
      }
      if (text.length > LONG_TEXT) startWatchdog();
    });
  }

  /* Подсветчик текущей реплики — чтобы stop() мог снять подсветку. */
  var activeHighlight = null;

  function releaseHighlight() {
    if (!activeHighlight) return;
    var h = activeHighlight;
    activeHighlight = null;
    setTimeout(function () { h.reset(); }, 260);
  }

  /**
   * Произнести текст.
   * @param {string} text
   * @param {string} lang — код языка (en, de, en-US…)
   * @param {object} opts — {rate, pitch, volume, voiceURI, highlight, onstart, onboundary, onend}
   */
  function speak(text, lang, opts) {
    opts = opts || {};
    var clean = normalizeForSpeech(cleanText(text), lang);
    if (!supported() || !clean) {
      if (opts.onend) opts.onend();
      return false;
    }

    var myToken = ++runToken;
    var st = settings();
    var rate = App.util.clamp(opts.rate || st.ttsRate || 0.95, 0.4, 1.6);
    // Одиночное слово читаем чуть медленнее: так отчётливее слышны звуки.
    if (clean.length <= 22 && clean.indexOf(' ') < 0) rate = Math.max(0.5, rate * 0.9);
    // Паузы между фразами масштабируем вместе с темпом, иначе на 0,6× они «съедаются».
    var gap = Math.round(CHUNK_GAP / rate);

    var chunks = chunkText(clean, MAX_CHUNK);
    var highlight = (opts.highlight && st.ttsHighlight !== false)
      ? makeHighlighter(opts.highlight, clean)
      : null;

    releaseHighlight();
    activeHighlight = highlight;

    hardStop(function () {
      // пока ждали тишину, могли попросить другой текст
      if (myToken !== runToken) return;

      var done = 0;
      function playNext() {
        if (myToken !== runToken) return;
        if (done >= chunks.length) {
          releaseHighlight();
          if (opts.onend) opts.onend();
          return;
        }
        var chunk = chunks[done++];
        var last = done >= chunks.length;
        fire(chunk.text, lang, {
          rate: rate,
          pitch: opts.pitch,
          volume: opts.volume,
          voiceURI: opts.voiceURI,
          onstart: opts.onstart,
          onboundary: opts.onboundary,
          onend: function () {
            if (last) {
              releaseHighlight();
              if (opts.onend) opts.onend();
            } else {
              setTimeout(playNext, gap);
            }
          }
        }, highlight, chunk.start);
      }

      playNext();
    });
    return true;
  }

  function stop() {
    runToken++;
    clearWatchdog();
    clearFallback();
    releaseHighlight();
    speakingFlag = false;
    current = null;
    // кнопка не должна остаться в состоянии «играет», если чтение прервали снаружи
    clearPlaying();
    /* Сетевая озвучка (js/ttsnet.js) — вторая «говорилка», и останавливать
       её надо здесь же: вызывающий код зовёт speech.stop() и вправе ждать,
       что наступит тишина. Модуль может быть не подключён — тогда пропускаем. */
    if (App.ttsnet && typeof App.ttsnet.stop === 'function') {
      try { App.ttsnet.stop(); } catch (e) { /* ignore */ }
    }
    if (!supported()) return;
    try { global.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  function isSpeaking() {
    if (!supported()) return false;
    try { return !!global.speechSynthesis.speaking; } catch (e) { return speakingFlag; }
  }

  /* ============================================================
     Не говорить, когда приложения не видно
     ============================================================ */

  /**
   * Синтез речи не замолкает сам, когда вкладка уходит в фон, а «подталкиватель»
   * длинных фраз вдобавок будит его через pause/resume каждые девять секунд.
   * Получалось так: человек свернул окно или переключился на другое приложение,
   * а слово продолжало звучать оттуда. Поэтому уход с экрана и выгрузка
   * страницы останавливают чтение.
   */
  function stopWhenHidden() {
    if (global.document && global.document.visibilityState === 'hidden') stop();
  }

  /**
   * Возврат на вкладку — повод перечитать список голосов.
   *
   * Chrome кэширует список голосов и сам его не обновляет: если человек
   * поставил голос в системе, пока приложение было свёрнуто, до перезагрузки
   * страницы приложение о нём не узнает. Событие voiceschanged при этом
   * приходит не всегда (аудит: после cancel() и при возврате на вкладку —
   * ни одного события), поэтому перечитываем по факту возврата.
   * Это дёшево: getVoices() — обычный вызов без сети.
   */
  function onVisibilityChange() {
    var doc = global.document;
    if (!doc) return;
    if (doc.visibilityState === 'hidden') { stop(); return; }
    refreshVoices();
  }

  if (global.document && typeof global.document.addEventListener === 'function') {
    global.document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof global.addEventListener === 'function') {
    /* pagehide надёжнее beforeunload: на мобильных Safari последний
       не срабатывает, а страница уходит в фоновый кэш. */
    global.addEventListener('pagehide', function () { stop(); });
  }

  /* ---------- Кнопка озвучивания ---------- */

  var playingBtn = null;

  function clearPlaying() {
    if (playingBtn) { playingBtn.classList.remove('is-playing'); playingBtn = null; }
  }

  /** Системный голос — то, что звучало до появления сетевой озвучки. */
  function speakWithVoice(text, lang, opts) {
    var st = settings();
    speak(text, lang, {
      rate: opts.rate || st.ttsRate,
      highlight: opts.target || null,
      onend: clearPlaying
    });
  }

  /**
   * Озвучить фразу лучшим из доступных способов: сначала готовый файл
   * (пакет внутри приложения → кэш → сеть), при неудаче — системный синтез.
   *
   * Это ЕДИНЫЙ вход для всех мест, где приложение говорит само, а не по
   * кнопке 🔊: автопрогон карточки, режим аудирования, горячая клавиша
   * повтора, предпросмотр в редакторе. Пока каждое из этих мест звало
   * speak() напрямую, человек слышал системного робота там, где по кнопке
   * уже звучал нормальный файл — и считал озвучку недоделанной.
   *
   * @returns {boolean} — true, если проигрывание начато (чем угодно).
   */
  function speakBest(text, lang, opts) {
    opts = opts || {};
    var T = App.ttsnet;
    var canFiles = T && typeof T.play === 'function' && typeof T.available === 'function' && T.available(lang);
    if (!canFiles) return speak(text, lang, opts);

    /* Подсветка при файловой озвучке: раньше её не было вовсе (у MP3 нет onboundary), из-за чего текст и звук жили отдельно. Теперь файловый плеер сам ведёт подсветчик по реальному времени аудио (timeupdate): подсвеченное слово следует за звуком, а не за расчётным темпом. */
    var fhl = null;
    if (opts.highlight && settings().ttsHighlight !== false) {
      fhl = makeHighlighter(opts.highlight, cleanText(text));
    }

    T.play(text, lang, { onend: opts.onend, highlight: fhl }).then(function (played) {
      /* Ложь — единственный сигнал «звука не будет». SUPERSEDED (перебили
         следующей фразой) сюда не попадает: там уже звучит другая фраза,
         и системный голос говорил бы поверх неё. */
      if (played) return;
      speak(text, lang, opts);
    });
    return true;
  }

  /**
   * Попробовать сетевую озвучку (скачанный MP3). Возвращает true, если
   * попытка «занята»: если файла нет и скачать не удалось, кнопка сама
   * упадёт обратно на системный голос.
   *
   * Порядок именно такой: сеть — надстройка над Web Speech, а не замена.
   * Офлайн, выключенная настройка и недоступный сервис одинаково приводят
   * к системному голосу, а не к тишине.
   *
   * Подсветки слов здесь нет намеренно: у MP3 нет события onboundary,
   * и синхронизировать текст со звуком нечем. Подсветка «по расчёту»
   * разъезжалась бы со звуком — это хуже, чем её отсутствие.
   */
  function tryNetworkAudio(btn, text, lang, opts) {
    var T = App.ttsnet;
    if (!T || typeof T.play !== 'function' || typeof T.available !== 'function') return false;
    // Язык обязателен: при нормальном системном голосе сеть не нужна вовсе.
    if (!T.available(lang)) return false;

    T.play(text, lang, { button: btn, onend: clearPlaying }).then(function (ok) {
      if (ok) return;
      // не получилось — за это время могли нажать другую кнопку
      if (playingBtn !== btn) return;
      speakWithVoice(text, lang, opts);
    });
    return true;
  }

  /**
   * Кнопка «Прослушать».
   * @param {string} text
   * @param {string} lang
   * @param {object} opts — {small, rate, target, slow}
   *   target — элемент, слова которого подсвечиваются во время чтения
   */
  function audioButton(text, lang, opts) {
    opts = opts || {};
    var U = App.util;
    if (!supported()) return null;

    var btn = U.h('button', {
      class: 'icon-btn icon-btn--round' + (opts.small ? ' icon-btn--sm' : ''),
      type: 'button',
      title: 'Прослушать',
      'aria-label': 'Прослушать',
      onclick: function (e) {
        e.stopPropagation();
        e.preventDefault();
        // повторное нажатие останавливает чтение
        if (playingBtn === btn) { stop(); clearPlaying(); return; }
        stop();
        clearPlaying();
        playingBtn = btn;
        btn.classList.add('is-playing');
        if (tryNetworkAudio(btn, text, lang, opts)) return;
        speakWithVoice(text, lang, opts);
      }
    }, U.icon('sound', opts.small ? 15 : 18));
    return btn;
  }

  App.speech = {
    LANGS: LANGS,
    LANG_NAMES: LANG_NAMES,
    supported: supported,
    toBcp47: toBcp47,
    baseLang: baseLang,
    hasVoiceFor: hasVoiceFor,
    voices: refreshVoices,
    voicesFor: voicesFor,
    resolveVoice: resolveVoice,
    scoreVoice: scoreVoice,
    voiceQuality: voiceQuality,
    worstQuality: worstQuality,
    voiceAdvice: voiceAdvice,
    langName: langName,
    browserName: browserName,
    cleanText: cleanText,
    normalizeForSpeech: normalizeForSpeech,
    chunkText: chunkText,
    speak: speak,
    speakBest: speakBest,
    stop: stop,
    isSpeaking: isSpeaking,
    audioButton: audioButton
  };
})(window);

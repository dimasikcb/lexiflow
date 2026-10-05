/* ============================================================
   LexiFlow — store.js
   Слой данных: колоды, карточки, журнал повторений, настройки.
   Хранение — localStorage (работает и на file://, и в PWA),
   автосохранение с дебаунсом + принудительный flush.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, SRS = App.srs;

  var STORAGE_KEY = 'lexiflow.data.v1';
  var DATA_VERSION = 1;

  var DEFAULT_APP_SETTINGS = {
    theme: 'auto',            // auto | dark | light
    defaultMode: 'flip',      // режим тренировки по умолчанию
    defaultDir: 'fwd',        // fwd | rev | mixed
    sessionLimit: 40,         // карточек за сессию
    dailyGoal: 30,            // цель повторений в день
    ttsRate: 0.95,
    ttsPitch: 1,              // тон голоса
    ttsVolume: 1,             // громкость
    ttsVoice: {},             // закреплённые голоса: { en: voiceURI, de: … }
    /* Какие предупреждения об озвучке человек уже закрыл: { 'en:none': true }.
       Ключ включает уровень голоса, поэтому если голос появится или сменится
       на роботизированный, предупреждение покажется снова. */
    ttsNoticeSeen: {},
    ttsHighlight: true,       // подсвечивать произносимое слово
    ttsAutoPlay: true,
    /* Сетевая озвучка (js/ttsnet.js): MP3 со стороннего сервиса, скачанный
       в кэш браузера. Включена по умолчанию, потому что включается НЕ всегда,
       а только когда нормального голоса в системе нет: решение принимает
       ttsnet.available(lang) — он смотрит на качество системного голоса
       (none/poor → идём в сеть, normal/neural → читает система).
       Если человек не хочет отправлять фразы на чужой сервер, он выключает
       это в настройках, и тогда остаётся системный голос.
       downloaded — подсказка для интерфейса; правду о содержимом кэша
       даёт ttsnet.stats(), потому что кэш у каждого устройства свой. */
    ttsNet: {
      enabled: true,
      downloaded: 0
    },
    showTranscription: true,
    keyboardShortcuts: true,
    reduceMotion: false,
    /* Синхронизация. Токен здесь же, но в синхронизируемый файл он не попадает
       (см. syncPayload) — иначе первый же экспорт опубликовал бы ключ. */
    sync: {
      provider: 'off',        // off | gist
      token: '',              // GitHub fine-grained token, право только gist
      gistId: '',             // id секретного гиста
      auto: true,             // синхронизировать автоматически
      lastAt: 0,              // время последней удачной синхронизации
      lastError: ''
    },
    /* Напоминания */
    notify: {
      enabled: false,
      time: '19:00',          // во сколько напоминать
      onlyIfDue: true,        // только если есть карточки к повторению
      lastShown: ''           // YYYY-MM-DD последнего показа, чтобы не спамить
    }
  };

  /* Сколько надгробий храним. Старые удаления помнить вечно не нужно. */
  var TOMBSTONE_LIMIT = 2000;

  var state = null;
  var listeners = [];
  var saveTimer = null;
  var storageOk = true;

  /* ---------- Инициализация ---------- */

  /**
   * Копия настроек по умолчанию. Важно: вложенный объект голосов нужно
   * клонировать, иначе правки пользователя утекут в DEFAULT_APP_SETTINGS.
   */
  function freshSettings() {
    var out = Object.assign({}, DEFAULT_APP_SETTINGS);
    out.ttsVoice = Object.assign({}, DEFAULT_APP_SETTINGS.ttsVoice);
    out.ttsNoticeSeen = Object.assign({}, DEFAULT_APP_SETTINGS.ttsNoticeSeen);
    out.ttsNet = Object.assign({}, DEFAULT_APP_SETTINGS.ttsNet);
    out.sync = Object.assign({}, DEFAULT_APP_SETTINGS.sync);
    out.notify = Object.assign({}, DEFAULT_APP_SETTINGS.notify);
    return out;
  }

  function emptyData() {
    return {
      version: DATA_VERSION,
      decks: [],
      cards: [],
      logs: [],
      /* Удаления. Без них удалённая на телефоне карточка «воскресает»
         с компьютера при первом же слиянии. */
      tombstones: [],
      settingsUpdatedAt: 0,
      settings: freshSettings(),
      meta: { createdAt: Date.now(), lastOpen: Date.now(), seeded: false }
    };
  }

  function load() {
    var raw = null;
    try {
      raw = global.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageOk = false;
    }
    if (!raw) {
      state = emptyData();
      return state;
    }
    try {
      var parsed = JSON.parse(raw);
      state = migrate(parsed);
    } catch (e) {
      console.error('LexiFlow: повреждённые данные, создан новый набор', e);
      state = emptyData();
    }
    return state;
  }

  function migrate(data) {
    var base = emptyData();
    var out = Object.assign(base, data || {});
    out.version = DATA_VERSION;
    out.settings = Object.assign({}, DEFAULT_APP_SETTINGS, data && data.settings);
    out.settings.ttsVoice = Object.assign({}, out.settings.ttsVoice);
    out.settings.ttsNoticeSeen = Object.assign({}, out.settings.ttsNoticeSeen);
    out.settings.sync = Object.assign({}, DEFAULT_APP_SETTINGS.sync, data && data.settings && data.settings.sync);
    out.settings.notify = Object.assign({}, DEFAULT_APP_SETTINGS.notify, data && data.settings && data.settings.notify);
    /* Отдельным слиянием, а не общим Object.assign выше: у сетевой озвучки
       явное «выключено» пользователя должно пережить загрузку, и объект
       нужно клонировать, иначе правки утекут в DEFAULT_APP_SETTINGS. */
    out.settings.ttsNet = Object.assign({}, DEFAULT_APP_SETTINGS.ttsNet, data && data.settings && data.settings.ttsNet);
    out.settingsUpdatedAt = out.settingsUpdatedAt || 0;
    out.meta = Object.assign({}, base.meta, data && data.meta);
    out.decks = Array.isArray(out.decks) ? out.decks : [];
    out.cards = Array.isArray(out.cards) ? out.cards : [];
    out.logs = Array.isArray(out.logs) ? out.logs : [];
    out.tombstones = Array.isArray(out.tombstones) ? out.tombstones : [];
    // нормализация
    out.decks.forEach(function (d) {
      d.settings = SRS.sanitizeSettings(d.settings);
      if (!d.id) d.id = U.uid('d');
      if (!d.createdAt) d.createdAt = Date.now();
      if (!d.updatedAt) d.updatedAt = d.createdAt;
      if (!d.color) d.color = pickColor(out.decks.indexOf(d));
    });
    out.cards.forEach(function (c) {
      if (!c.id) c.id = U.uid('c');
      if (!c.createdAt) c.createdAt = Date.now();
      if (!c.updatedAt) c.updatedAt = c.createdAt;
      if (!Array.isArray(c.examples)) c.examples = [];
      if (!Array.isArray(c.tags)) c.tags = [];
      if (!c.srs) c.srs = SRS.newState(SRS.DEFAULT_SETTINGS, c.createdAt || Date.now());
    });
    out.tombstones = out.tombstones.filter(function (t) { return t && t.id && t.kind; });
    // журнал ограничиваем 20 000 последних записей, чтобы не разрастался
    if (out.logs.length > 20000) out.logs = out.logs.slice(-20000);
    return out;
  }

  function get() {
    if (!state) load();
    return state;
  }

  /* ---------- Сохранение ---------- */

  function save() {
    if (!state) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 220);
  }

  function flush() {
    if (!state) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
      if (!flush.warned) {
        flush.warned = true;
        U.toast('Не удалось сохранить данные (хранилище переполнено). Сделайте экспорт бэкапа.', 'err', 6000);
      }
      console.error('LexiFlow: ошибка сохранения', e);
    }
  }

  function isStorageOk() { return storageOk; }

  /** Уведомить подписчиков об изменении данных. */
  function notify(reason) {
    save();
    listeners.forEach(function (fn) {
      try { fn(reason); } catch (e) { console.error(e); }
    });
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  /* ---------- Надгробия удалений ---------- */

  /**
   * Запомнить удаление. Без этого при слиянии удалённая запись вернётся
   * с другого устройства: там она всё ещё существует и «новее» не станет.
   */
  function addTombstone(id, kind) {
    if (!id) return;
    var data = get();
    if (!Array.isArray(data.tombstones)) data.tombstones = [];
    // повторное удаление той же записи не должно копить дубликаты
    data.tombstones = data.tombstones.filter(function (t) { return !(t.id === id && t.kind === kind); });
    data.tombstones.push({ id: id, kind: kind, at: Date.now() });
    if (data.tombstones.length > TOMBSTONE_LIMIT) {
      data.tombstones = data.tombstones.slice(-TOMBSTONE_LIMIT);
    }
  }

  function tombstones() { return get().tombstones || []; }

  function clearTombstones() {
    var data = get();
    data.tombstones = [];
    notify('tombstones:clear');
  }

  /* ---------- Колоды ---------- */

  var COLORS = ['#7c5cff', '#2ec5b6', '#ff7a59', '#f0b429', '#3ea6ff', '#e94f8a', '#48c774', '#9b6bff'];

  function pickColor(i) { return COLORS[i % COLORS.length]; }

  function createDeck(input) {
    var data = get();
    var deck = {
      id: U.uid('d'),
      name: (input && input.name) || 'Новая колода',
      description: (input && input.description) || '',
      langFrom: (input && input.langFrom) || 'en',
      langTo: (input && input.langTo) || 'ru',
      color: (input && input.color) || pickColor(data.decks.length),
      icon: (input && input.icon) || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      settings: SRS.sanitizeSettings(input && input.settings)
    };
    data.decks.push(deck);
    notify('deck:create');
    return deck;
  }

  function updateDeck(id, patch) {
    var deck = getDeck(id);
    if (!deck) return null;
    Object.assign(deck, patch);
    if (patch && patch.settings) deck.settings = SRS.sanitizeSettings(patch.settings);
    deck.updatedAt = Date.now();
    notify('deck:update');
    return deck;
  }

  function getDeck(id) {
    return get().decks.find(function (d) { return d.id === id; }) || null;
  }

  function deleteDeck(id, deleteCards) {
    var data = get();
    data.decks = data.decks.filter(function (d) { return d.id !== id; });
    addTombstone(id, 'deck');
    if (deleteCards !== false) {
      var ids = {};
      data.cards.forEach(function (c) { if (c.deckId === id) ids[c.id] = true; });
      data.cards = data.cards.filter(function (c) { return c.deckId !== id; });
      data.logs = data.logs.filter(function (l) { return !ids[l.cardId]; });
      Object.keys(ids).forEach(function (cid) { addTombstone(cid, 'card'); });
    } else {
      data.cards.forEach(function (c) { if (c.deckId === id) { c.deckId = null; c.updatedAt = Date.now(); } });
    }
    notify('deck:delete');
  }

  function duplicateDeck(id) {
    var data = get();
    var src = getDeck(id);
    if (!src) return null;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = U.uid('d');
    copy.name = src.name + ' (копия)';
    copy.createdAt = copy.updatedAt = Date.now();
    data.decks.push(copy);
    cardsOf(id).forEach(function (c) {
      var cc = JSON.parse(JSON.stringify(c));
      cc.id = U.uid('c');
      cc.deckId = copy.id;
      cc.createdAt = cc.updatedAt = Date.now();
      cc.srs = SRS.newState(copy.settings, Date.now());
      data.cards.push(cc);
    });
    notify('deck:duplicate');
    return copy;
  }

  /* ---------- Карточки ---------- */

  function createCard(input) {
    var data = get();
    var deck = getDeck(input.deckId);
    var settings = deck ? deck.settings : SRS.DEFAULT_SETTINGS;
    var now = Date.now();
    var card = {
      id: U.uid('c'),
      deckId: input.deckId || null,
      word: (input.word || '').trim(),
      translation: (input.translation || '').trim(),
      transcription: (input.transcription || '').trim(),
      examples: (input.examples || []).filter(function (e) { return e && (e.text || e.translation); }),
      notes: (input.notes || '').trim(),
      tags: (input.tags || []).filter(Boolean),
      audioUrl: input.audioUrl || '',
      createdAt: now,
      updatedAt: now,
      suspended: false,
      srs: SRS.newState(settings, now)
    };
    data.cards.push(card);
    if (deck) deck.updatedAt = now;
    notify('card:create');
    return card;
  }

  function updateCard(id, patch) {
    var card = getCard(id);
    if (!card) return null;
    Object.assign(card, patch);
    card.updatedAt = Date.now();
    notify('card:update');
    return card;
  }

  function getCard(id) {
    return get().cards.find(function (c) { return c.id === id; }) || null;
  }

  function deleteCard(id) {
    var data = get();
    data.cards = data.cards.filter(function (c) { return c.id !== id; });
    data.logs = data.logs.filter(function (l) { return l.cardId !== id; });
    addTombstone(id, 'card');
    notify('card:delete');
  }

  function deleteCards(ids) {
    var set = {};
    ids.forEach(function (i) { set[i] = true; });
    var data = get();
    data.cards = data.cards.filter(function (c) { return !set[c.id]; });
    data.logs = data.logs.filter(function (l) { return !set[l.cardId]; });
    ids.forEach(function (i) { addTombstone(i, 'card'); });
    notify('card:delete-many');
  }

  function cardsOf(deckId) {
    return get().cards.filter(function (c) { return c.deckId === deckId; });
  }

  function allCards(deckIds) {
    if (!deckIds || !deckIds.length) return get().cards.slice();
    var set = {};
    deckIds.forEach(function (d) { set[d] = true; });
    return get().cards.filter(function (c) { return set[c.deckId]; });
  }

  /** Сброс прогресса карточки. */
  function resetCard(id) {
    var card = getCard(id);
    if (!card) return;
    var deck = getDeck(card.deckId);
    card.srs = SRS.newState(deck ? deck.settings : SRS.DEFAULT_SETTINGS, Date.now());
    card.updatedAt = Date.now();
    notify('card:reset');
  }

  function resetDeckProgress(deckId) {
    var deck = getDeck(deckId);
    if (!deck) return;
    var now = Date.now();
    cardsOf(deckId).forEach(function (c) { c.srs = SRS.newState(deck.settings, now); });
    get().logs = get().logs.filter(function (l) { return l.deckId !== deckId; });
    notify('deck:reset');
  }

  /* ---------- Журнал повторений ---------- */

  function addLog(entry) {
    var data = get();
    var log = Object.assign({
      id: U.uid('l'),
      ts: Date.now(),
      grade: 3,
      mode: 'flip',
      dir: 'fwd',
      correct: true,
      ms: 0,
      deckId: null,
      cardId: null,
      stateFrom: 'new',
      stateTo: 'learning',
      test: false
    }, entry);
    data.logs.push(log);
    /* Журнал - такие же данные, как колоды: тренировка на телефоне должна доехать до второго устройства. Без notify() синк узнавал о прогрессе только по 15-секундному фоновому тику, а в закрывшемся приложении ответы могли не уехать вовсе. */
    notify('log:add');
    return log;
  }

  function removeLog(id) {
    var data = get();
    data.logs = data.logs.filter(function (l) { return l.id !== id; });
    notify('log:remove');
  }

  function logsSince(ts) {
    return get().logs.filter(function (l) { return l.ts >= ts; });
  }

  /* ---------- Настройки приложения ---------- */

  function settings() { return get().settings; }

  function updateSettings(patch) {
    var data = get();
    Object.assign(data.settings, patch);
    data.settingsUpdatedAt = Date.now();
    notify('settings:update');
    return get().settings;
  }

  /* ---------- Статистика ---------- */

  function deckStats(deckId, now) {
    now = now || Date.now();
    var cards = deckId ? cardsOf(deckId) : get().cards;
    var st = { total: cards.length, new: 0, learning: 0, review: 0, suspended: 0, due: 0, leeches: 0 };
    var dayEnd = U.startOfDay(now) + U.MS_DAY;
    cards.forEach(function (c) {
      if (c.suspended) { st.suspended++; return; }
      if (SRS.isNew(c)) st.new++;
      else if (SRS.isLearning(c)) st.learning++;
      else st.review++;
      if (c.srs && c.srs.due < dayEnd) st.due++;
      if (c.srs && c.srs.leech) st.leeches++;
    });
    return st;
  }

  /** Сколько новых карточек уже введено сегодня (по журналу). */
  function newIntroducedToday(deckId, now) {
    var dayStart = U.startOfDay(now || Date.now());
    var count = 0;
    get().logs.forEach(function (l) {
      if (l.ts < dayStart) return;
      if (deckId && l.deckId !== deckId) return;
      if (l.stateFrom === 'new') count++;
    });
    return count;
  }

  function reviewsToday(deckId, now) {
    var dayStart = U.startOfDay(now || Date.now());
    var count = 0;
    get().logs.forEach(function (l) {
      if (l.ts < dayStart) return;
      if (deckId && l.deckId !== deckId) return;
      count++;
    });
    return count;
  }

  /** Серия дней подряд с хотя бы одним повторением. */
  function streak(now) {
    now = now || Date.now();
    var days = {};
    get().logs.forEach(function (l) { days[U.dayKey(l.ts)] = true; });
    var count = 0;
    var cursor = U.startOfDay(now);
    // если сегодня ещё не занимались — серию считаем со вчера
    if (!days[U.dayKey(cursor)]) cursor -= U.MS_DAY;
    while (days[U.dayKey(cursor)]) {
      count++;
      cursor -= U.MS_DAY;
    }
    return count;
  }

  /* ---------- Импорт / экспорт ---------- */

  /**
   * Полный бэкап. Секреты вырезаются: файл бэкапа люди пересылают друг другу
   * и кладут в облако, а токен синхронизации даёт доступ к хранилищу данных.
   */
  function exportAll() {
    var safe = Object.assign({}, get().settings);
    safe.sync = Object.assign({}, safe.sync, { token: '', gistId: '' });
    return JSON.stringify({
      app: 'LexiFlow',
      version: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      decks: get().decks,
      cards: get().cards,
      logs: get().logs,
      tombstones: get().tombstones || [],
      settings: safe
    }, null, 2);
  }

  function exportDeck(deckId, withProgress) {
    var deck = getDeck(deckId);
    if (!deck) return '{}';
    var cards = cardsOf(deckId).map(function (c) {
      var copy = JSON.parse(JSON.stringify(c));
      if (!withProgress) copy.srs = null;
      return copy;
    });
    return JSON.stringify({
      app: 'LexiFlow',
      version: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      decks: [deck],
      cards: cards
    }, null, 2);
  }

  function csvEscape(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv(deckIds) {
    return csvForCards(allCards(deckIds));
  }

  /** CSV по произвольному набору карточек (используется и в словаре). */
  function csvForCards(cards) {
    // Если у карточек больше одного примера — добавляем парные колонки
    // «Пример 2 / Перевод примера 2» и т. д., чтобы ничего не потерялось.
    var maxExamples = 1;
    cards.forEach(function (c) {
      var n = (c.examples || []).length;
      if (n > maxExamples) maxExamples = n;
    });

    var head = ['Колода', 'Слово', 'Перевод', 'Транскрипция'];
    for (var e = 1; e <= maxExamples; e++) {
      head.push(e === 1 ? 'Пример' : 'Пример ' + e);
      head.push(e === 1 ? 'Перевод примера' : 'Перевод примера ' + e);
    }
    head = head.concat(['Теги', 'Состояние', 'Интервал (дн)', 'Следующее повторение']);

    var rows = [head];
    cards.forEach(function (c) {
      var deck = getDeck(c.deckId);
      var exs = c.examples || [];
      var row = [deck ? deck.name : '', c.word, c.translation, c.transcription];
      for (var i = 0; i < maxExamples; i++) {
        var ex = exs[i] || {};
        row.push(ex.text || '', ex.translation || '');
      }
      row.push(
        (c.tags || []).join(' '),
        SRS.stateLabel(c),
        c.srs ? (c.srs.state === 'review' ? c.srs.interval : '') : '',
        c.srs ? new Date(c.srs.due).toISOString().slice(0, 10) : ''
      );
      rows.push(row);
    });
    return '\uFEFF' + rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n');
  }

  /** Разбор CSV с поддержкой кавычек и разделителей , ; \t */
  function parseDelimited(text) {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var firstLine = text.split('\n')[0] || '';
    var counts = [
      { sep: ',', n: (firstLine.match(/,/g) || []).length },
      { sep: ';', n: (firstLine.match(/;/g) || []).length },
      { sep: '\t', n: (firstLine.match(/\t/g) || []).length }
    ].sort(function (a, b) { return b.n - a.n; });
    var sep = counts[0].n > 0 ? counts[0].sep : ',';

    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = '';
        if (row.some(function (f) { return f.trim() !== ''; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(function (f) { return f.trim() !== ''; })) rows.push(row);
    return rows;
  }

  /**
   * Универсальный импорт.
   * @param {string} text — содержимое файла
   * @param {object} opts — {deckId, newDeckName, format:'auto'|'json'|'csv'|'lines', skipHeader, dedupe}
   * @returns {{added:number, skipped:number, decks:number}}
   */
  function importText(text, opts) {
    opts = opts || {};
    var trimmed = String(text || '').trim();
    if (!trimmed) return { added: 0, skipped: 0, decks: 0, error: 'Пустой файл' };

    // формат по умолчанию — автоопределение (JSON начинается с { или [)
    var format = opts.format || 'auto';
    var looksJson = trimmed[0] === '{' || trimmed[0] === '[';

    if (format === 'json' || (format === 'auto' && looksJson)) {
      var payload;
      try { payload = JSON.parse(trimmed); }
      catch (e) { return { added: 0, skipped: 0, decks: 0, error: 'Некорректный JSON' }; }
      return importJson(payload, opts);
    }
    return importTabular(trimmed, opts);
  }

  function importJson(payload, opts) {
    var data = get();
    var result = { added: 0, skipped: 0, decks: 0 };
    var isBareList = Array.isArray(payload);
    var decksIn = isBareList ? [] : (payload.decks || []);
    var cardsIn = isBareList ? payload : (payload.cards || []);
    var now = Date.now();

    var fixedDeckId = opts.deckId || null;
    var specById = {};
    decksIn.forEach(function (d) { if (d && d.id) specById[d.id] = d; });

    // Колоды создаются лениво: если все карточки окажутся дубликатами,
    // пустые колоды в базе не появятся.
    var createdByKey = {};

    function ensureDeck(spec) {
      var key = spec && spec.id ? 'id:' + spec.id : 'default';
      if (createdByKey[key]) return createdByKey[key];
      var deck = {
        id: U.uid('d'),
        name: (spec && spec.name) || opts.newDeckName || 'Импортированная колода',
        description: (spec && spec.description) || '',
        langFrom: (spec && spec.langFrom) || 'en',
        langTo: (spec && spec.langTo) || 'ru',
        color: (spec && spec.color) || pickColor(data.decks.length),
        createdAt: now, updatedAt: now, archived: false,
        settings: SRS.sanitizeSettings(spec && spec.settings)
      };
      data.decks.push(deck);
      createdByKey[key] = deck.id;
      result.decks++;
      return deck.id;
    }

    var existing = {};
    if (opts.dedupe !== false) {
      data.cards.forEach(function (c) {
        existing[U.normalize(c.word) + '|' + U.normalize(c.translation)] = true;
      });
    }

    cardsIn.forEach(function (c) {
      if (!c || (!c.word && !c.translation)) { result.skipped++; return; }
      var key = U.normalize(c.word) + '|' + U.normalize(c.translation);
      if (existing[key]) { result.skipped++; return; }

      var deckId = fixedDeckId || ensureDeck(specById[c.deckId] || null);
      var deck = getDeck(deckId);
      data.cards.push({
        id: U.uid('c'),
        deckId: deckId,
        word: String(c.word || '').trim(),
        translation: String(c.translation || '').trim(),
        transcription: String(c.transcription || '').trim(),
        examples: Array.isArray(c.examples) ? c.examples.filter(function (e) { return e && (e.text || e.translation); }) : [],
        notes: c.notes || '',
        tags: Array.isArray(c.tags) ? c.tags : String(c.tags || '').split(/[\s,]+/).filter(Boolean),
        audioUrl: c.audioUrl || '',
        createdAt: c.createdAt || now,
        updatedAt: now,
        suspended: !!c.suspended,
        srs: (c.srs && c.srs.state) ? c.srs : SRS.newState(deck ? deck.settings : SRS.DEFAULT_SETTINGS, now)
      });
      existing[key] = true;
      result.added++;
    });

    // файл без карточек, но с колодами — сохраняем структуру
    if (!cardsIn.length && !fixedDeckId) {
      decksIn.forEach(function (d) { ensureDeck(d); });
    }

    notify('import');
    return result;
  }

  function createDeckSilent(data, name) {
    var deck = {
      id: U.uid('d'),
      name: name,
      description: '',
      langFrom: 'en', langTo: 'ru',
      color: pickColor(data.decks.length),
      createdAt: Date.now(), updatedAt: Date.now(), archived: false,
      settings: SRS.sanitizeSettings(null)
    };
    data.decks.push(deck);
    return deck;
  }

  /**
   * Импорт CSV / TSV / строк «слово - перевод».
   * Если в файле есть колонка «Колода», строки раскладываются по своим колодам
   * (существующие находятся по имени, отсутствующие создаются).
   */
  function importTabular(text, opts) {
    var data = get();
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var result = { added: 0, skipped: 0, decks: 0 };
    if (!lines.length) return result;

    var rows = parseDelimited(lines.join('\n'));
    var headerMap = null;
    if (opts.columnMap) {
      /* Явная карта колонок из UI («что есть что»): заголовки не угадываем,
         но первую строку выбрасываем, если сказано «есть заголовки». */
      if (opts.skipHeader !== false) rows = rows.slice(1);
    } else if (opts.skipHeader !== false) {
      headerMap = detectHeader(rows[0]);
      if (headerMap) rows = rows.slice(1);
    }

    var existing = {};
    if (opts.dedupe !== false) {
      data.cards.forEach(function (c) {
        existing[U.normalize(c.word) + '|' + U.normalize(c.translation)] = true;
      });
    }

    var fixedDeckId = opts.deckId || null;
    var fallbackDeckId = null;
    var deckByName = {};

    /** Колода для строки: явная, из колонки «Колода» или общая по умолчанию. */
    function deckFor(rec) {
      if (fixedDeckId) return fixedDeckId;
      var name = (rec && rec.deck ? rec.deck : '').trim();
      if (name) {
        if (!deckByName[name]) {
          var found = data.decks.filter(function (d) { return d.name === name; })[0];
          if (found) {
            deckByName[name] = found.id;
          } else {
            var created = createDeckSilent(data, name);
            deckByName[name] = created.id;
            result.decks++;
          }
        }
        return deckByName[name];
      }
      if (!fallbackDeckId) {
        fallbackDeckId = createDeckSilent(data, opts.newDeckName || guessDeckName(lines[0])).id;
        result.decks++;
      }
      return fallbackDeckId;
    }

    rows.forEach(function (cells) {
      var rec = recordFromRow(cells, headerMap, opts);
      if (!rec || (!rec.word && !rec.translation)) { result.skipped++; return; }
      var key = U.normalize(rec.word) + '|' + U.normalize(rec.translation);
      if (existing[key]) { result.skipped++; return; }
      var deckId = deckFor(rec);
      var targetDeck = getDeck(deckId);
      data.cards.push({
        id: U.uid('c'),
        deckId: deckId,
        word: rec.word,
        translation: rec.translation,
        transcription: rec.transcription || '',
        examples: (rec.examples || []).filter(function (e) { return e && (e.text || e.translation); }),
        notes: '', tags: rec.tags || [],
        audioUrl: '', createdAt: Date.now(), updatedAt: Date.now(), suspended: false,
        srs: SRS.newState(targetDeck ? targetDeck.settings : SRS.DEFAULT_SETTINGS, Date.now())
      });
      existing[key] = true;
      result.added++;
    });

    notify('import');
    return result;
  }

  /**
   * Заголовок таблицы.
   * Понимает несколько примеров: «Пример», «Пример 2», «Пример 3»… и парные
   * «Перевод примера», «Перевод примера 2»… (то же по-английски: Example 2,
   * Example translation 2). Плюс общий столбец «Примеры», внутри которого
   * примеры разделяются `||` или переводом строки.
   */
  function detectHeader(cells) {
    if (!cells) return null;
    var joined = cells.map(function (c) { return U.normalize(c); }).join('|');
    var hasWord = /(^|\|)(word|слово|термин|term|front|лицо)(\||$)/.test(joined);
    var hasTrans = /(^|\|)(translation|перевод|meaning|значение|back|definition)(\||$)/.test(joined);
    if (!hasWord && !hasTrans) return null;
    var map = {};
    var byNum = {};
    cells.forEach(function (c, i) {
      var k = U.normalize(c);
      var m;
      if (/^(word|слово|термин|term|front)$/.test(k)) map.word = i;
      else if (/^(translation|перевод|meaning|значение|back|definition)$/.test(k)) map.translation = i;
      else if (/^(transcription|транскрипция|ipa|phonetic)$/.test(k)) map.transcription = i;
      else if (/^(tags?|теги)$/.test(k)) map.tags = i;
      else if (/^(deck|колода)$/.test(k)) map.deck = i;
      else if ((m = k.match(/^(?:examples?|примеры?|sentences?|предложения?)\s*(\d*)$/))) {
        var n = m[1] ? parseInt(m[1], 10) : 1;
        byNum[n] = byNum[n] || {};
        byNum[n].text = i;
      } else if ((m = k.match(/^(?:(?:example|пример|sentence|предложение)\s+translation|перевод\s+примера)\s*(\d*)$/))) {
        var n2 = m[1] ? parseInt(m[1], 10) : 1;
        byNum[n2] = byNum[n2] || {};
        byNum[n2].translation = i;
      }
    });
    map.examplePairs = Object.keys(byNum)
      .map(function (k) { return parseInt(k, 10); })
      .sort(function (a, b) { return a - b; })
      .map(function (k) { return byNum[k]; });
    if (map.examplePairs.length) {
      map.example = map.examplePairs[0].text;
      map.exampleTranslation = map.examplePairs[0].translation;
    }
    return map;
  }

  /** Разбить ячейку на несколько значений: через `||` или перевод строки. */
  function splitCellList(value) {
    return String(value === undefined || value === null ? '' : value)
      .split(/\|\||\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /** Собрать примеры употребления из строки таблицы. */
  function collectExamples(cells, headerMap) {
    var pairs = (headerMap && headerMap.examplePairs) || [];
    var out = [];
    pairs.forEach(function (pair) {
      if (pair.text === undefined) return;
      var texts = splitCellList(cells[pair.text]);
      var trans = pair.translation === undefined ? [] : splitCellList(cells[pair.translation]);
      var n = Math.max(texts.length, trans.length);
      for (var i = 0; i < n; i++) {
        var text = texts[i] || '';
        var tr = trans[i] || (trans.length === 1 && i === 0 ? trans[0] : '');
        if (text || tr) out.push({ text: text, translation: tr });
      }
    });
    return out;
  }

  function recordFromRow(cells, headerMap, opts) {
    var get2 = function (i) { return i === undefined || i === null ? '' : String(cells[i] === undefined ? '' : cells[i]).trim(); };
    /* Явная карта колонок (UI «что есть что»): индексы задаёт пользователь. */
    if (opts && opts.columnMap) {
      var cm = opts.columnMap;
      return {
        word: get2(cm.word),
        translation: get2(cm.translation),
        transcription: get2(cm.transcription),
        examples: cm.example !== undefined
          ? collectExamples(cells, { examplePairs: [{ text: cm.example, translation: cm.exampleTranslation }] })
          : [],
        deck: get2(cm.deck),
        tags: get2(cm.tags).split(/[\s,]+/).filter(Boolean)
      };
    }
    if (headerMap) {
      return {
        word: get2(headerMap.word !== undefined ? headerMap.word : 0),
        translation: get2(headerMap.translation !== undefined ? headerMap.translation : 1),
        transcription: get2(headerMap.transcription),
        examples: collectExamples(cells, headerMap),
        deck: get2(headerMap.deck),
        tags: get2(headerMap.tags).split(/[\s,]+/).filter(Boolean)
      };
    }
    if (cells.length >= 2) {
      var a = String(cells[0] || '').trim();
      var b = String(cells[1] || '').trim();
      if (!a && !b) return null;
      return {
        word: opts.reverse ? b : a,
        translation: opts.reverse ? a : b,
        transcription: String(cells[2] || '').trim(),
        // без заголовков примеры читаем из 4-й и 5-й колонок (как в экспорте)
        examples: (cells[3] || cells[4])
          ? collectExamples(cells, { examplePairs: [{ text: 3, translation: 4 }] })
          : []
      };
    }
    // одна колонка: «слово - перевод» / «слово = перевод» / «слово : перевод»
    var line = String(cells[0] || '');
    var m = line.match(/^(.+?)\s*(?:[-–—=:]|\t)\s*(.+)$/);
    if (m) {
      var left = m[1].trim(), right = m[2].trim();
      return { word: opts.reverse ? right : left, translation: opts.reverse ? left : right };
    }
    return { word: line.trim(), translation: '' };
  }

  function guessDeckName(firstLine) {
    return 'Импорт ' + new Date().toLocaleDateString('ru-RU');
  }

  /** Полная замена данных (используется при восстановлении бэкапа). */
  function replaceAll(payload, mode) {
    var incoming = migrate(payload);
    if (mode === 'replace') {
      state = incoming;
    } else {
      var data = get();
      var map = {};
      incoming.decks.forEach(function (d) {
        var copy = JSON.parse(JSON.stringify(d));
        copy.id = U.uid('d');
        map[d.id] = copy.id;
        data.decks.push(copy);
      });
      incoming.cards.forEach(function (c) {
        var copy = JSON.parse(JSON.stringify(c));
        copy.id = U.uid('c');
        copy.deckId = map[c.deckId] || c.deckId;
        data.cards.push(copy);
      });
      incoming.logs.forEach(function (l) {
        var copy = JSON.parse(JSON.stringify(l));
        copy.id = U.uid('l');
        copy.cardId = map[c.id] || copy.cardId;
        data.logs.push(copy);
      });
    }
    notify('restore');
    return state;
  }

  function wipe() {
    state = emptyData();
    notify('wipe');
  }

  /**
   * Удалить все учебные данные, но оставить настройки устройства.
   *
   * Так делает кнопка «Удалить все данные» на экране «Данные». Отличается от
   * wipe() двумя вещами, и обе обязательны:
   *
   * 1. На каждую запись ставится надгробие. Без него облако не узнаёт об
   *    удалении и возвращает всё обратно при первом же обмене — человек видит,
   *    что удалённые колоды «сами вернулись».
   * 2. Настройки (в том числе токен синхронизации) остаются на месте. Если
   *    стереть и их, отправлять надгробия будет некуда, и получится то же
   *    самое: данные вернутся, как только синхронизацию включат заново.
   */
  function clearData() {
    var data = get();
    var at = Date.now();

    var tombs = (data.tombstones || []).slice();
    data.decks.forEach(function (d) { tombs.push({ id: d.id, kind: 'deck', at: at }); });
    data.cards.forEach(function (c) { tombs.push({ id: c.id, kind: 'card', at: at }); });

    var next = emptyData();
    next.tombstones = tombs.slice(-TOMBSTONE_LIMIT);
    next.settings = Object.assign({}, data.settings);
    next.settingsUpdatedAt = data.settingsUpdatedAt;
    /* seeded оставляем поднятым: иначе после очистки снова приехали бы
       демонстрационные колоды, которые человек только что удалил. */
    next.meta = Object.assign({}, data.meta, { seeded: true });
    state = next;
    notify('wipe');
    return state;
  }

  /* ---------- Демо-данные ---------- */

  var DEMO = [
    {
      name: 'Английский: базовый', description: 'Частотные слова для старта', langFrom: 'en', langTo: 'ru', color: '#7c5cff',
      cards: [
        ['although', 'хотя, несмотря на', 'ɔːlˈðəʊ', 'Although it was late, we kept working.', 'Хотя было поздно, мы продолжали работать.'],
        ['to improve', 'улучшать(ся)', 'ɪmˈpruːv', 'I want to improve my English.', 'Я хочу улучшить свой английский.'],
        ['effort', 'усилие, старание', 'ˈefət', 'It took a lot of effort.', 'Это потребовало много усилий.'],
        ['to achieve', 'достигать', 'əˈtʃiːv', 'She achieved her goal.', 'Она достигла своей цели.'],
        ['opportunity', 'возможность', 'ˌɒpəˈtjuːnəti', 'This is a great opportunity.', 'Это отличная возможность.'],
        ['to avoid', 'избегать', 'əˈvɔɪd', 'Try to avoid mistakes.', 'Старайся избегать ошибок.'],
        ['however', 'однако', 'haʊˈevə', 'However, I disagree.', 'Однако я не согласен.'],
        ['to require', 'требовать', 'rɪˈkwaɪə', 'The job requires patience.', 'Работа требует терпения.'],
        ['reliable', 'надёжный', 'rɪˈlaɪəbl', 'He is a reliable friend.', 'Он надёжный друг.'],
        ['to suggest', 'предлагать', 'səˈdʒest', 'I suggest a break.', 'Я предлагаю перерыв.'],
        ['slightly', 'немного, слегка', 'ˈslaɪtli', 'It is slightly different.', 'Это немного отличается.'],
        ['to provide', 'предоставлять', 'prəˈvaɪd', 'We provide free support.', 'Мы предоставляем бесплатную поддержку.']
      ]
    },
    {
      name: 'Deutsch: Alltag', description: 'Немецкий на каждый день', langFrom: 'de', langTo: 'ru', color: '#2ec5b6',
      cards: [
        ['der Termin', 'встреча, срок', 'tɛʁˈmiːn', 'Ich habe morgen einen Termin.', 'У меня завтра встреча.'],
        ['die Erfahrung', 'опыт', 'ɛɐ̯ˈfaːʁʊŋ', 'Er hat viel Erfahrung.', 'У него большой опыт.'],
        ['vermeiden', 'избегать', 'fɛɐ̯ˈmaɪdn̩', 'Das sollte man vermeiden.', 'Этого следует избегать.'],
        ['die Möglichkeit', 'возможность', 'ˈmøːklɪçkaɪt', 'Es gibt viele Möglichkeiten.', 'Есть много возможностей.'],
        ['wichtig', 'важный', 'ˈvɪçtɪç', 'Das ist sehr wichtig.', 'Это очень важно.'],
        ['sich erinnern', 'вспоминать', 'zɪç ɛɐ̯ˈʔɪnɐn', 'Ich kann mich nicht erinnern.', 'Я не могу вспомнить.'],
        ['die Entscheidung', 'решение', 'ɛntˈʃaɪdʊŋ', 'Das war eine gute Entscheidung.', 'Это было хорошее решение.'],
        ['obwohl', 'хотя', 'ɔpˈvoːl', 'Obwohl es regnet, gehe ich spazieren.', 'Хотя идёт дождь, я иду гулять.']
      ]
    }
  ];

  function seedDemo() {
    var data = get();
    if (data.meta.seeded || data.decks.length) return false;
    DEMO.forEach(function (spec) {
      var deck = {
        id: U.uid('d'), name: spec.name, description: spec.description,
        langFrom: spec.langFrom, langTo: spec.langTo, color: spec.color,
        createdAt: Date.now(), updatedAt: Date.now(), archived: false,
        settings: SRS.sanitizeSettings(null)
      };
      data.decks.push(deck);
      spec.cards.forEach(function (row) {
        data.cards.push({
          id: U.uid('c'), deckId: deck.id,
          word: row[0], translation: row[1], transcription: row[2],
          examples: row[3] ? [{ text: row[3], translation: row[4] || '' }] : [],
          notes: '', tags: [], audioUrl: '',
          createdAt: Date.now(), updatedAt: Date.now(), suspended: false,
          srs: SRS.newState(deck.settings, Date.now())
        });
      });
    });
    data.meta.seeded = true;
    notify('seed');
    return true;
  }

  /* ---------- Обмен данными для синхронизации ---------- */

  /**
   * Копия данных для отправки в облако. Токен и прочие секреты вырезаются:
   * иначе первый же синхронизированный файл опубликовал бы ключ доступа,
   * а его видит любое устройство, подключённое к тому же хранилищу.
   */
  function syncPayload() {
    var data = get();
    var copy = {
      version: data.version,
      decks: data.decks,
      cards: data.cards,
      logs: data.logs,
      tombstones: data.tombstones || [],
      settingsUpdatedAt: data.settingsUpdatedAt || 0,
      settings: Object.assign({}, data.settings),
      meta: data.meta,
      updatedAt: Date.now(),
      device: deviceId()
    };
    copy.settings.sync = { provider: 'off', token: '', gistId: '', auto: false, lastAt: 0, lastError: '' };
    delete copy.settings.sync;
    return copy;
  }

  /**
   * Принять результат слияния. Локальные секреты (токен, id гиста)
   * сохраняются: они не часть общих данных, а ключ от хранилища.
   */
  function applyMerged(merged) {
    var data = get();
    var keepSync = Object.assign({}, data.settings.sync);
    var keepNotify = Object.assign({}, data.settings.notify);
    var next = migrate(Object.assign({}, merged));
    // Токен и напоминания — локальные для устройства. Из облака их не берём:
    // токен вообще не уезжает наружу, а «последний показ» у каждого свой.
    next.settings.sync = keepSync;
    next.settings.notify = keepNotify;
    state = next;
    notify('sync:apply');
    return state;
  }

  /* Идентификатор устройства: по нему видно, чьи правки победили. */
  var DEVICE_KEY = 'lexiflow.device.v1';
  function deviceId() {
    var id = null;
    try { id = global.localStorage.getItem(DEVICE_KEY); } catch (e) { id = null; }
    if (!id) {
      id = U.uid('dev');
      try { global.localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* приватный режим */ }
    }
    return id;
  }

  App.store = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_APP_SETTINGS: DEFAULT_APP_SETTINGS,
    COLORS: COLORS,
    TOMBSTONE_LIMIT: TOMBSTONE_LIMIT,
    load: load,
    get: get,
    save: save,
    flush: flush,
    isStorageOk: isStorageOk,
    subscribe: subscribe,
    notify: notify,
    addTombstone: addTombstone,
    tombstones: tombstones,
    clearTombstones: clearTombstones,
    syncPayload: syncPayload,
    applyMerged: applyMerged,
    deviceId: deviceId,
    createDeck: createDeck,
    updateDeck: updateDeck,
    getDeck: getDeck,
    deleteDeck: deleteDeck,
    duplicateDeck: duplicateDeck,
    createCard: createCard,
    updateCard: updateCard,
    getCard: getCard,
    deleteCard: deleteCard,
    deleteCards: deleteCards,
    cardsOf: cardsOf,
    allCards: allCards,
    resetCard: resetCard,
    resetDeckProgress: resetDeckProgress,
    addLog: addLog,
    removeLog: removeLog,
    logsSince: logsSince,
    settings: settings,
    updateSettings: updateSettings,
    deckStats: deckStats,
    newIntroducedToday: newIntroducedToday,
    reviewsToday: reviewsToday,
    streak: streak,
    exportAll: exportAll,
    exportDeck: exportDeck,
    exportCsv: exportCsv,
    csvForCards: csvForCards,
    importText: importText,
    parseTable: parseDelimited,
    replaceAll: replaceAll,
    wipe: wipe,
    clearData: clearData,
    seedDemo: seedDemo,
    pickColor: pickColor,
    /* Демонстрационные колоды наружу — только для сборочного инструмента:
       tools/build-audio-pack.js составляет из них список фраз и скачивает
       к ним озвучку. Приложение этот список не использует. */
    DEMO: DEMO
  };
})(window);

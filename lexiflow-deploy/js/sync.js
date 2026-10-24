/* ============================================================
   LexiFlow — sync.js
   Слияние данных с нескольких устройств и облачное хранилище
   на GitHub Gist.

   Сеть используется только тогда, когда пользователь сам включил
   синхронизацию: без токена и идентификатора гиста ни один запрос
   не уходит. Ядро модуля — чистая функция merge(), её можно
   вызывать сколько угодно раз без побочных эффектов.

   Секреты (токен GitHub и идентификатор гиста) живут только в
   настройках устройства. В слияние и в отправляемый файл они не
   попадают никогда — см. mergeSettings() и syncPayload().
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util;
  var S = App.store;

  var API = 'https://api.github.com';
  var GIST_FILE = 'lexiflow.json';
  var GIST_DESC = 'LexiFlow sync';

  /* Столько же, сколько хранит store.js: журнал не должен расти вечно. */
  var LOG_LIMIT = 20000;

  /* GitHub отдаёт содержимое файла гиста целиком только пока оно
     меньше ~1 МБ. Отправлять больше нельзя: облако вернуло бы
     обрезанный файл, а заметить потерю данных было бы нечем. */
  var MAX_BYTES = 900000;

  /* Автосинхронизация: раз в пять минут и через несколько секунд
     после правки — чтобы каждая нажатая карточка не дёргала сеть. */
  /* Пока приложение на экране, обмен идёт часто: удалил карточку на телефоне —
     на компьютере она должна исчезнуть сама, без ручной синхронизации.
     Пятиминутный интервал для этого не годился: человек ждал «реального
     времени», а видел расхождение на несколько минут. */
  var LIVE_INTERVAL = 15000;
  var AUTO_INTERVAL = 5 * 60 * 1000;
  var CHANGE_DELAY = 5000;

  /* Удаление ждать не должно.
     Обычная правка потерпит: если телефон уснёт, она уедет позже. Но удаление,
     не доехавшее до облака, воскрешает колоду на втором устройстве — ровно
     это и происходило: таймер на пять секунд замирал вместе с фоновой
     вкладкой на телефоне, и надгробие оставалось на устройстве. */
  var URGENT_DELAY = 400;

  /* Тело запроса с keepalive браузер ограничивает 64 КБ. Больше — не рискнём. */
  var KEEPALIVE_LIMIT = 60000;

  /* Сколько приложение должно отсутствовать в фоне, чтобы при возвращении
     сразу забрать чужие правки. Телефон открывают и закрывают постоянно, а
     таймеры в фоне стоят: правило «прошло пять минут» не наступало никогда,
     и удалённая на компьютере колода спокойно жила на телефоне. */
  var RESUME_AFTER = 45 * 1000;

  /* Первый обмен после запуска приложения. Небольшая задержка нужна, чтобы
     не соревноваться с отрисовкой первого экрана. */
  var START_DELAY = 1500;

  /**
   * Сколько ждать перед отправкой правки.
   * Чистая функция: по причине изменения решает, срочное оно или нет.
   * Удаления срочные, всё остальное — обычная задержка.
   */
  function changeDelay(reason) {
    var text = String(reason || '');
    return /delete|remove|wipe|reset|clear|tombstone/i.test(text) ? URGENT_DELAY : CHANGE_DELAY;
  }

  /**
   * Отпечаток данных: по нему видно, пришло ли из облака что-то новое.
   * Идентификаторы и время правки — то есть и появление, и удаление, и
   * изменение записи меняют отпечаток.
   */
  function dataSignature(data) {
    data = data || {};
    var parts = [];
    asArray(data.decks).forEach(function (d) { parts.push('d' + d.id + ':' + num(d.updatedAt)); });
    asArray(data.cards).forEach(function (c) { parts.push('c' + c.id + ':' + num(c.updatedAt)); });
    return parts.sort().join('|');
  }

  /**
   * Перерисовывать ли экран после пришедших из облака правок.
   * Чистая функция: решение принимается по состоянию экрана, без DOM.
   *
   * Удаление с телефона должно исчезать на компьютере само. Но вырывать
   * экран из рук нельзя: открытый диалог, незаконченный ввод и идущая
   * тренировка дороже, чем свежесть картинки — там обновление подождёт
   * до выхода, а сессия и так держит свои карточки.
   */
  function shouldRefreshOnRemote(state) {
    state = state || {};
    if (state.inSession) return false;
    if (state.modalOpen) return false;
    if (state.typing) return false;
    return true;
  }

  /**
   * Нужно ли тянуть данные при возвращении в приложение.
   * Чистая функция — по ней и проверяется поведение, без ожидания таймеров.
   *
   * @param {{dirty?: boolean, awayMs?: number, sinceLastMs?: number}} state
   *   awayMs — сколько приложение было в фоне (Infinity, если не знаем).
   *   sinceLastMs — сколько прошло с последнего удачного обмена.
   */
  function shouldSyncOnResume(state) {
    state = state || {};
    if (state.dirty) return true;
    /* Сколько именно приложение отсутствовало — неизвестно (первый запуск,
       браузер не сказал): считаем, что давно, и данные забираем. */
    var away = state.awayMs;
    if (typeof away !== 'number' || !isFinite(away)) return true;
    if (away > RESUME_AFTER) return true;
    return num(state.sinceLastMs) > AUTO_INTERVAL;
  }

  /* ============================================================
     1. СЛИЯНИЕ (чистая функция)
     ============================================================ */

  function asArray(value) { return Array.isArray(value) ? value : []; }

  function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : 0;
  }

  function clone(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function indexById(list) {
    var map = {};
    asArray(list).forEach(function (record) {
      if (record && record.id) map[record.id] = record;
    });
    return map;
  }

  /** Порядок записей: сначала локальные, потом незнакомые из облака. */
  function orderedIds(first, second) {
    var seen = {};
    var ids = [];
    [first, second].forEach(function (list) {
      asArray(list).forEach(function (record) {
        if (!record || !record.id || seen[record.id]) return;
        seen[record.id] = true;
        ids.push(record.id);
      });
    });
    return ids;
  }

  /**
   * Слияние записей одного вида — колод или карточек.
   *
   * Правила:
   *   • запись есть только с одной стороны — берём её;
   *   • запись есть с обеих — побеждает та, у которой больше updatedAt;
   *   • при полном равенстве updatedAt побеждает УДАЛЁННАЯ сторона.
   *     Это правило нужно, чтобы оба устройства приняли одно и то же
   *     решение и не начали перекидывать запись друг другу. На практике
   *     точное совпадение миллисекунд почти невозможно, но поведение
   *     должно быть определено, а не случайно.
   *   • запись выбрасывается, если для неё есть надгробие с at >= updatedAt.
   *     Без этого удалённая на телефоне карточка воскресала бы с компьютера.
   */
  function mergeRecords(kind, localList, remoteList, tombByKey, stats) {
    var localById = indexById(localList);
    var remoteById = indexById(remoteList);
    var out = [];

    orderedIds(localList, remoteList).forEach(function (id) {
      var mine = localById[id];
      var theirs = remoteById[id];
      var winner;
      var fromRemote;

      if (mine && theirs) {
        if (num(theirs.updatedAt) >= num(mine.updatedAt)) { winner = theirs; fromRemote = true; }
        else { winner = mine; fromRemote = false; }
      } else if (mine) {
        winner = mine;
        fromRemote = false;
      } else {
        winner = theirs;
        fromRemote = true;
      }
      if (!winner) return;

      var tomb = tombByKey[kind + ':' + id];
      if (tomb && num(tomb.at) >= num(winner.updatedAt)) { stats.deleted++; return; }

      out.push(clone(winner));
      if (!fromRemote) return;
      if (mine) {
        if (kind === 'deck') stats.decksUpdated++; else stats.cardsUpdated++;
      } else {
        if (kind === 'deck') stats.decksAdded++; else stats.cardsAdded++;
      }
    });

    return out;
  }

  /**
   * Надгробия объединяются по паре (id, kind): остаётся более позднее
   * время удаления. Возвращаются и список, и карта для быстрых проверок.
   */
  function mergeTombstones(localList, remoteList) {
    var byKey = {};
    var list = [];

    function absorb(items) {
      asArray(items).forEach(function (tomb) {
        if (!tomb || !tomb.id || !tomb.kind) return;
        var key = tomb.kind + ':' + tomb.id;
        var current = byKey[key];
        if (!current) {
          current = { id: tomb.id, kind: tomb.kind, at: num(tomb.at) };
          byKey[key] = current;
          list.push(current);
        } else if (num(tomb.at) > current.at) {
          current.at = num(tomb.at);
        }
      });
    }

    absorb(localList);
    absorb(remoteList);
    return { list: list, byKey: byKey };
  }

  /**
   * Настройки приложения.
   * Побеждает сторона с большим settingsUpdatedAt, при равенстве — локальная:
   * на своём устройстве пользователь должен видеть то, что настроил сам.
   *
   * settings.sync и settings.notify — не общие данные, а состояние устройства.
   * Они не участвуют в сравнении и берутся из локальной копии. Токен и
   * идентификатор гиста при этом обнуляются: результат слияния уходит и в
   * сеть, и в экспорт, а ключ доступа не должен покидать устройство.
   * applyMerged() вернёт сохранённые значения из локального состояния,
   * поэтому подключение не сломается.
   */
  function mergeSettings(local, remote, stats) {
    var localAt = num(local.settingsUpdatedAt);
    var remoteAt = num(remote.settingsUpdatedAt);
    var fromRemote = remoteAt > localAt;
    stats.settingsFrom = fromRemote ? 'remote' : 'local';

    var base = (fromRemote ? remote.settings : local.settings) || {};
    var out = clone(base);
    if (!out || typeof out !== 'object' || Array.isArray(out)) out = {};

    var localSync = (local.settings && local.settings.sync) || {};
    out.sync = clone(localSync) || {};
    if (typeof out.sync !== 'object' || Array.isArray(out.sync)) out.sync = {};
    out.sync.token = '';
    out.sync.gistId = '';

    out.notify = clone((local.settings && local.settings.notify) || {}) || {};

    out.ttsNet = clone((local.settings && local.settings.ttsNet) || {}) || {};
    return out;
  }

  /** Журнал повторений: объединение по id, порядок по времени, без удалённых карточек. */
  function mergeLogs(localList, remoteList, tombByKey, stats) {
    var localIds = {};
    var byId = {};

    asArray(localList).forEach(function (log) {
      if (!log || !log.id) return;
      localIds[log.id] = true;
      byId[log.id] = log;
    });
    /* Записи журнала неизменяемы: одинаковый id означает одинаковое
       содержимое, поэтому при совпадении остаётся первая (локальная). */
    asArray(remoteList).forEach(function (log) {
      if (!log || !log.id || byId[log.id]) return;
      byId[log.id] = log;
    });

    var dropped = 0;
    var logs = [];
    Object.keys(byId).forEach(function (id) {
      var log = byId[id];
      if (log.cardId && tombByKey['card:' + log.cardId]) { dropped++; return; }
      logs.push(clone(log));
    });

    /* Сортировка по ts, при равенстве — по id: иначе порядок зависел бы
       от того, какое устройство сливает первым, и копии расходились бы. */
    logs.sort(function (a, b) {
      var diff = num(a.ts) - num(b.ts);
      if (diff) return diff;
      var x = String(a.id), y = String(b.id);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    if (logs.length > LOG_LIMIT) logs = logs.slice(-LOG_LIMIT);

    logs.forEach(function (log) { if (!localIds[log.id]) stats.logsAdded++; });
    stats.logsDropped = dropped;
    return logs;
  }

  /**
   * Слияние двух наборов данных.
   * Ничего не читает и не пишет: ни DOM, ни сеть, ни хранилище.
   *
   * @param {object} local — своя копия (обычно App.store.syncPayload())
   * @param {object} remote — копия из облака
   * @returns {{data: object, stats: object}}
   */
  function merge(local, remote) {
    local = local || {};
    remote = remote || {};

    var stats = {
      decksAdded: 0,
      decksUpdated: 0,
      cardsAdded: 0,
      cardsUpdated: 0,
      deleted: 0,
      logsAdded: 0,
      logsDropped: 0,
      orphans: 0,
      settingsFrom: 'local'
    };

    var tombs = mergeTombstones(local.tombstones, remote.tombstones);
    var decks = mergeRecords('deck', local.decks, remote.decks, tombs.byKey, stats);
    var cards = mergeRecords('card', local.cards, remote.cards, tombs.byKey, stats);

    /* Карточка, чья колода не пережила слияние, остаётся в наборе,
       но теряет привязку: она уходит в раздел «без колоды», а не исчезает. */
    var deckIds = {};
    decks.forEach(function (deck) { deckIds[deck.id] = true; });
    cards.forEach(function (card) {
      if (card.deckId === null || card.deckId === undefined) return;
      if (deckIds[card.deckId]) return;
      card.deckId = null;
      stats.orphans++;
    });

    var logs = mergeLogs(local.logs, remote.logs, tombs.byKey, stats);
    var settings = mergeSettings(local, remote, stats);

    /* Служебные поля устройства остаются своими, но флаг «демо уже
       показывали» поднимается, если его подняло любое из устройств:
       иначе новое устройство снова засеяло бы демо-колоды. */
    var meta = Object.assign({}, remote.meta || {}, local.meta || {});
    if ((local.meta && local.meta.seeded) || (remote.meta && remote.meta.seeded)) meta.seeded = true;

    var data = {
      version: num(local.version) || num(remote.version) || 1,
      decks: decks,
      cards: cards,
      logs: logs,
      tombstones: tombs.list,
      settingsUpdatedAt: Math.max(num(local.settingsUpdatedAt), num(remote.settingsUpdatedAt)),
      settings: settings,
      meta: meta
    };

    return { data: data, stats: stats };
  }

  /* ============================================================
     2. СОСТОЯНИЕ И ПОДПИСКИ
     ============================================================ */

  /* Внутреннее состояние: 'idle' | 'syncing' | 'ok' | 'error'.
     'off' не хранится, а вычисляется — так его нельзя забыть сбросить. */
  var live = { state: 'idle', at: 0, message: '' };
  var subscribers = [];
  var busy = false;
  var running = false;
  var autoTimer = null;
  var changeTimer = null;
  var firstTimer = null;
  /* Есть правки, которые ещё не уехали в облако. В отличие от changeTimer
     этот флаг переживает отмену таймера: по нему приложение понимает, что
     при возвращении в него нужно отправить данные, а не ждать пять минут. */
  var dirty = false;
  /* Когда страница ушла в фон: по этому времени решается, забирать ли
     чужие правки при возвращении. */
  var hiddenAt = 0;

  function syncCfg() {
    var settings = S.settings() || {};
    return settings.sync || {};
  }

  function isConfigured() {
    var cfg = syncCfg();
    return !!(cfg.token && cfg.gistId);
  }

  function status() {
    if (!isConfigured()) {
      return { state: 'off', at: num(syncCfg().lastAt), message: '' };
    }
    return { state: live.state, at: live.at || num(syncCfg().lastAt), message: live.message };
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    subscribers.push(cb);
    return function () {
      subscribers = subscribers.filter(function (fn) { return fn !== cb; });
    };
  }

  function setStatus(state, message) {
    live.state = state;
    live.message = message || '';
    if (state === 'ok') live.at = num(syncCfg().lastAt);
    var snapshot = status();
    subscribers.slice().forEach(function (fn) {
      try { fn(snapshot); } catch (e) { console.error('LexiFlow: подписчик синхронизации упал', e); }
    });
    return snapshot;
  }

  /**
   * Правка блока sync напрямую, без updateSettings.
   * Отметка о последней синхронизации и флаг автосинхронизации — это не
   * правка настроек: если поднимать settingsUpdatedAt на каждом обмене,
   * локальные настройки будут вечно «свежими» и затрут чужие.
   */
  function patchSync(patch) {
    var settings = S.settings();
    if (!settings.sync) settings.sync = {};
    Object.keys(patch).forEach(function (key) { settings.sync[key] = patch[key]; });
    S.notify('sync:settings');
    return settings.sync;
  }

  function refreshStatus() {
    if (!isConfigured()) {
      live.state = 'idle';
      live.message = '';
      return setStatus('off', '');
    }
    if (live.state !== 'syncing' && live.state !== 'error') live.state = 'idle';
    return setStatus(live.state, live.message);
  }

  /** Ошибка синхронизации: попадает и в статус, и в настройки. Токен сюда не передаётся. */
  function fail(message) {
    patchSync({ lastError: message });
    setStatus('error', message);
    return { ok: false, error: message };
  }

  function configure(patch) {
    patch = patch || {};
    var next = Object.assign({}, syncCfg(), patch);
    S.updateSettings({ sync: next });
    applyAuto();
    refreshStatus();
    return syncCfg();
  }

  /* ============================================================
     3. ХРАНИЛИЩЕ GITHUB GIST
     ============================================================ */

  /** Один запрос к api.github.com. Никогда не отклоняется: ошибка — это результат. */
  function request(path, opts) {
    opts = opts || {};
    var fetchFn = global.fetch;
    if (typeof fetchFn !== 'function') {
      return Promise.resolve({ ok: false, status: 0, unsupported: true });
    }
    if (global.navigator && global.navigator.onLine === false) {
      return Promise.resolve({ ok: false, status: 0, offline: true });
    }

    var headers = {
      'Authorization': 'Bearer ' + opts.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    var init = { method: opts.method || 'GET', headers: headers, cache: 'no-store' };
    if (opts.body !== undefined) {
      var body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
      init.body = body;
      /* keepalive доводит запрос до конца, даже если страницу уже закрывают.
         Нужен ровно для одного случая: успеть отправить удаление, когда
         человек свернул приложение. Браузер разрешает так не больше 64 КБ,
         поэтому большой набор данных отправляем обычным способом. */
      if (opts.keepalive && body.length <= KEEPALIVE_LIMIT) init.keepalive = true;
    }

    return fetchFn(API + path, init).then(function (response) {
      return response.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        return { ok: !!response.ok, status: response.status, json: json };
      });
    }, function () {
      return { ok: false, status: 0, network: true };
    });
  }

  /** Человеческое объяснение ответа GitHub. Токен в текст не попадает. */
  function describeError(res) {
    if (res.unsupported) return 'Браузер не поддерживает сетевые запросы — синхронизация недоступна.';
    if (res.offline) return 'Нет подключения к интернету. Синхронизация продолжится, когда связь появится.';
    if (res.network) return 'Не удалось связаться с GitHub. Проверьте соединение и попробуйте ещё раз.';
    if (res.status === 401) return 'GitHub отклонил токен (401). Проверьте, что он скопирован целиком и не истёк.';
    if (res.status === 403) return 'GitHub отказал в доступе (403). Убедитесь, что у токена стоит право «Gist: Read and write» (настройки → Developer settings → Tokens).';
    if (res.status === 404) return 'GitHub вернул 404. Если это ошибка при создании хранилища — у токена нет права «Gist: Read and write». Проверьте настройку токена на GitHub и создайте новый.';
    if (res.status === 422) return 'GitHub отклонил данные (422). Проверьте, что у токена есть право создавать гисты.';
    if (res.status >= 500) return 'GitHub временно недоступен (код ' + res.status + '). Попробуйте позже.';
    return 'GitHub вернул ошибку ' + res.status + '.';
  }

  /** Тело файла гиста. Содержимое приходит уже очищенным от секретов. */
  function fileBody(content) {
    var files = {};
    files[GIST_FILE] = { content: content };
    return files;
  }

  /** Пустая строка — можно отправлять; иначе готовое объяснение, почему нет. */
  function tooBig(content) {
    var size = (U && U.bytesOf) ? U.bytesOf(content) : content.length;
    if (size <= MAX_BYTES) return '';
    var human = (U && U.fmtBytes) ? U.fmtBytes(size) : (size + ' Б');
    return 'Данных слишком много для гиста (' + human + '). GitHub хранит файл целиком примерно до 1 МБ — ' +
      'выгрузите лишние колоды в резервную копию или отключите синхронизацию.';
  }

  function createGist(token) {
    var content = JSON.stringify(S.syncPayload());
    var big = tooBig(content);
    if (big) return Promise.resolve({ error: big });

    return request('/gists', {
      method: 'POST',
      token: token,
      body: { description: GIST_DESC, public: false, files: fileBody(content) }
    }).then(function (res) {
      if (!res.ok) return { error: describeError(res) };
      var id = res.json && res.json.id;
      if (!id) return { error: 'GitHub не вернул идентификатор хранилища.' };
      return { id: id };
    });
  }

  function writeGist(token, gistId, content, keepalive) {
    var big = tooBig(content);
    if (big) return Promise.resolve({ error: big });

    return request('/gists/' + gistId, {
      method: 'PATCH',
      token: token,
      keepalive: !!keepalive,
      body: { files: fileBody(content) }
    }).then(function (res) {
      if (!res.ok) return { error: describeError(res) };
      return { id: gistId };
    });
  }

  function readRemote(token, gistId) {
    return request('/gists/' + gistId, { token: token }).then(function (res) {
      if (!res.ok) return { error: describeError(res) };

      var file = (res.json && res.json.files) ? res.json.files[GIST_FILE] : null;
      /* Гист есть, а файла ещё нет — считаем облако пустым и просто
         заливаем свои данные. Это первый запуск, а не ошибка. */
      if (!file) return { data: {} };
      if (file.truncated) {
        return { error: 'Файл синхронизации слишком большой: GitHub отдаёт его частями. ' +
          'Уменьшите набор данных и подключитесь заново.' };
      }
      if (!file.content) return { data: {} };

      var parsed;
      try { parsed = JSON.parse(file.content); }
      catch (e) { return { error: 'Файл синхронизации повреждён: не удалось разобрать JSON.' }; }
      if (!parsed || typeof parsed !== 'object') return { data: {} };
      return { data: parsed };
    });
  }

  /** Переиспользуем уже подключённый гист, чтобы подключения не плодили копии. */
  function ensureGist(token) {
    var existing = String(syncCfg().gistId || '');
    if (!existing) return createGist(token);

    return request('/gists/' + existing, { token: token }).then(function (res) {
      if (res.ok) return writeGist(token, existing, JSON.stringify(S.syncPayload()));
      if (res.status === 404) return createGist(token);
      return { error: describeError(res) };
    });
  }

  /* ============================================================
     4. ПУБЛИЧНЫЕ ДЕЙСТВИЯ
     ============================================================ */

  /**
   * Подключиться к уже существующему хранилищу по его коду.
   *
   * Это нужно второму устройству. Без кода оно создало бы СВОЙ гист:
   * статус был бы «подключено», ошибок бы не было, а данные двух
   * устройств никогда бы не встретились — каждое писало бы в своё.
   */
  function join(token, gistId) {
    var value = String(token || '').trim();
    var id = String(gistId || '').trim();

    return new Promise(function (resolve) {
      if (!value) { resolve(fail('Введите токен GitHub.')); return; }
      if (!id) { resolve(fail('Введите код хранилища.')); return; }
      if (typeof global.fetch !== 'function') {
        resolve(fail('Браузер не поддерживает сетевые запросы — синхронизация недоступна.'));
        return;
      }

      setStatus('syncing', 'Проверяем токен…');
      request('/user', { token: value }).then(function (res) {
        if (!res.ok) { resolve(fail(describeError(res))); return null; }

        return request('/gists/' + encodeURIComponent(id), { token: value }).then(function (gres) {
          if (!gres.ok) {
            if (gres.status === 404) {
              resolve(fail('Хранилище не найдено (404). Код или токен неверные — они должны быть от одного аккаунта GitHub.'));
            } else {
              resolve(fail(describeError(gres) + ' [HTTP ' + gres.status + ']'));
            }
            return null;
          }

          configure({ provider: 'gist', token: value, gistId: id, auto: true, lastError: '' });
          patchSync({ lastAt: 0, lastError: '' });
          setStatus('idle', 'Хранилище подключено, забираем данные…');

          /* Сразу тянем данные: иначе подключение выглядит как «настроено,
             но пусто», и человек не понимает, сработало ли оно. */
          return now().then(function (out) {
            resolve(out && out.ok ? { ok: true, gistId: id, login: (res.json && res.json.login) || '' } : out);
            return null;
          });
        });
      }).then(null, function (e) {
        resolve(fail('Не удалось связаться с GitHub: ' + String(e && e.message || e)));
      });
    });
  }

  /**
   * Подключение: сначала проверяем токен, и только потом сохраняем.
   * Иначе нерабочий токен осел бы в настройках и автосинхронизация
   * молча писала бы ошибку на каждом запуске.
   */
  function connect(token) {
    var value = String(token || '').trim();

    return new Promise(function (resolve) {
      if (!value) { resolve(fail('Введите токен GitHub.')); return; }
      if (typeof global.fetch !== 'function') {
        resolve(fail('Браузер не поддерживает сетевые запросы — синхронизация недоступна.'));
        return;
      }

      setStatus('syncing', 'Проверяем токен…');
      request('/user', { token: value }).then(function (res) {
        if (!res.ok) { resolve(fail(describeError(res))); return; }

        /* Токен рабочий — прошлая ошибка больше не актуальна. */
        live.state = 'idle';
        live.message = '';

        return ensureGist(value).then(function (out) {
          if (out.error) { resolve(fail(out.error)); return; }

          configure({ provider: 'gist', token: value, gistId: out.id, lastError: '' });
          patchSync({ lastAt: 0, lastError: '' });
          var login = (res.json && res.json.login) || '';
          setStatus('idle', login ? 'Хранилище подключено: ' + login : 'Хранилище подключено');
          resolve({ ok: true, gistId: out.id, login: login });
        });
      }).then(null, function (e) {
        resolve(fail('Не удалось связаться с GitHub: ' + String(e && e.message || e)));
      });
    });
  }

  /**
   * Обмен с облаком: прочитать, слить, применить, отправить обратно.
   * @param {{keepalive?: boolean}} [opts] — keepalive для отправки в момент,
   *   когда страница закрывается.
   */
  function now(opts) {
    opts = opts || {};
    var cfg = syncCfg();

    if (!isConfigured()) return Promise.resolve({ ok: false, error: 'Синхронизация не настроена.' });
    if (busy) return Promise.resolve({ ok: false, error: 'Синхронизация уже идёт.' });
    if (typeof global.fetch !== 'function') {
      return Promise.resolve(fail('Браузер не поддерживает сетевые запросы — синхронизация недоступна.'));
    }

    busy = true;
    setStatus('syncing', 'Синхронизация…');

    return readRemote(cfg.token, cfg.gistId).then(function (res) {
      if (res.error) return fail(res.error);

      var merged = merge(S.syncPayload(), res.data);
      var before = dataSignature(S.get());
      S.applyMerged(merged.data);
      /* Экран обновляем только когда из облака и правда пришло что-то новое.
         Иначе каждые 15 секунд всё перерисовывалось бы без причины. */
      if (dataSignature(S.get()) !== before) S.notify('sync:remote');

      /* Отправляем ровно то, что лежит в хранилище после слияния:
         syncPayload() сам вырезает токен и идентификатор гиста. */
      var content = JSON.stringify(S.syncPayload());
      var big = tooBig(content);
      if (big) return fail(big);

      return writeGist(cfg.token, cfg.gistId, content, opts.keepalive).then(function (written) {
        if (written.error) return fail(written.error);
        var at = Date.now();
        patchSync({ lastAt: at, lastError: '' });
        /* Данные в облаке. Снимаем флаг только здесь: при ошибке он остаётся,
           и приложение повторит отправку, когда связь вернётся. */
        dirty = false;
        setStatus('ok', 'Синхронизировано');
        return { ok: true, stats: merged.stats, at: at };
      });
    }).then(function (out) {
      busy = false;
      return out;
    }, function (e) {
      busy = false;
      return fail('Синхронизация прервана: ' + String(e && e.message || e));
    });
  }

  function disconnect() {
    running = false;
    clearTimers();
    configure({
      provider: 'off',
      token: '',
      gistId: '',
      auto: false,
      lastAt: 0,
      lastError: ''
    });
    live.state = 'idle';
    live.message = '';
    live.at = 0;
    setStatus('off', '');
    return true;
  }

  /* ============================================================
     5. АВТОСИНХРОНИЗАЦИЯ
     ============================================================ */

  function isOnline() {
    return !(global.navigator && global.navigator.onLine === false);
  }

  function isVisible() {
    return !(global.document && global.document.visibilityState === 'hidden');
  }

  /**
   * Как часто спрашивать облако. Чистая функция — её и проверяют тесты,
   * не дожидаясь настоящих таймеров.
   *
   * В фоне браузер режет таймеры и сеть, а тратить заряд на частые запросы
   * незачем: там интервал остаётся длинным, а на возвращение на экран есть
   * отдельное правило (shouldSyncOnResume).
   */
  function autoInterval(state) {
    state = state || {};
    var visible = typeof state.visible === 'boolean' ? state.visible : isVisible();
    return visible ? LIVE_INTERVAL : AUTO_INTERVAL;
  }

  function clearTimers() {
    if (autoTimer) { global.clearInterval(autoTimer); autoTimer = null; }
    if (changeTimer) { global.clearTimeout(changeTimer); changeTimer = null; }
    if (firstTimer) { global.clearTimeout(firstTimer); firstTimer = null; }
  }

  function autoSync(opts) {
    if (busy || !running || !isConfigured() || !syncCfg().auto) return;
    if (!isOnline()) return;
    now(opts);
  }

  /**
   * Перепланировать очередной обмен.
   *
   * setTimeout, а не setInterval: интервал зависит от того, на экране ли
   * вкладка, и меняется на ходу. Планируем следующий заход сразу после
   * нынешнего — overlapping невозможен, autoSync() сам занятость проверит.
   */
  function scheduleAuto() {
    if (autoTimer) { global.clearTimeout(autoTimer); autoTimer = null; }
    if (!running || !isConfigured() || !syncCfg().auto || !isOnline()) return;
    autoTimer = global.setTimeout(function () {
      autoTimer = null;
      autoSync();
      scheduleAuto();
    }, autoInterval());
  }

  /** Приводит таймеры в соответствие с настройками: без токена ничего не планируется. */
  function applyAuto() {
    if (isConfigured() && syncCfg().auto) {
      running = true;
      clearTimers();
      if (!isOnline()) return;
      scheduleAuto();
    } else {
      running = false;
      clearTimers();
    }
  }

  /**
   * Первый обмен после включения — с задержкой, чтобы не бить в сеть сразу.
   * @param {number} [delay] — своя задержка вместо CHANGE_DELAY (запуск приложения).
   */
  function scheduleSoon(delay) {
    if (firstTimer) { global.clearTimeout(firstTimer); firstTimer = null; }
    if (!running || !isConfigured()) return;
    firstTimer = global.setTimeout(function () {
      firstTimer = null;
      autoSync();
    }, typeof delay === 'number' ? delay : CHANGE_DELAY);
  }

  /** Флаг автосинхронизации пишем только при реальном изменении. */
  function setAutoFlag(value) {
    var on = !!value;
    if (!!syncCfg().auto === on) return;
    patchSync({ auto: on });
  }

  function start() {
    setAutoFlag(true);
    applyAuto();
    /* При запуске приложения первый обмен нужен быстро — иначе холодный
       старт показывает вчерашние данные. START_DELAY (1,5 c) быстрее
       обычной задержки (5 c), но не бьёт по сети мгновенно. */
    scheduleSoon(START_DELAY);
    return status();
  }

  function stop() {
    setAutoFlag(false);
    applyAuto();
    return status();
  }

  /**
   * Запланировать отправку после правки.
   * Удаления уходят почти сразу (см. changeDelay): не доехавшее удаление
   * воскрешает запись на другом устройстве, а обычная правка может подождать.
   */
  function scheduleChange(reason) {
    if (!running || !isConfigured() || !syncCfg().auto) return false;
    dirty = true;

    var delay = changeDelay(reason);
    if (changeTimer) {
      /* Отправка уже назначена. Срочную правку переносим на ближайшее время,
         а обычная пусть ждёт уже выбранного срока — не откладываем её заново. */
      if (delay >= CHANGE_DELAY) return true;
      global.clearTimeout(changeTimer);
    }
    changeTimer = global.setTimeout(function () {
      changeTimer = null;
      autoSync();
    }, delay);
    return true;
  }

  /**
   * Отправить несохранённое немедленно — когда страница уходит в фон или
   * закрывается. В фоне таймеры замирают, поэтому удаление, отложенное на
   * пять секунд, могло не уехать вообще. Запрос помечается keepalive, чтобы
   * браузер довёл его до конца уже во время закрытия страницы.
   */
  function flushPending() {
    if (!dirty || !running || !isConfigured() || !syncCfg().auto) return false;
    if (changeTimer) { global.clearTimeout(changeTimer); changeTimer = null; }
    autoSync({ keepalive: true });
    return true;
  }

  /* Любая правка данных планирует отправку. События самого слияния
     пропускаем — иначе синхронизация запускала бы саму себя. */
  if (S && typeof S.subscribe === 'function') {
    S.subscribe(function (reason) {
      if (String(reason || '').indexOf('sync:') === 0) return;
      scheduleChange(reason);
    });
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('online', function () {
      if (running && isConfigured()) autoSync();
    });
    global.addEventListener('offline', function () {
      if (running && isConfigured()) setStatus('idle', 'Офлайн: синхронизация ждёт связи');
    });
    /* pagehide надёжнее beforeunload: на мобильных Safari последний
       не срабатывает, а страница уходит в фоновый кэш. */
    global.addEventListener('pagehide', function () { flushPending(); });
  }

  if (global.document && typeof global.document.addEventListener === 'function') {
    global.document.addEventListener('visibilitychange', function () {
      if (!running || !isConfigured()) return;

      if (global.document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        flushPending();
        scheduleAuto();   // в фоне реже
        return;
      }

      /* Вернулись на экран: с этого момента снова спрашиваем облако часто. */
      scheduleAuto();

      /* Вернулись в приложение. На телефоне это происходит постоянно, поэтому
         данные забираем, если отсутствовали заметное время: иначе удалённая
         на компьютере колода оставалась бы на экране до ручной синхронизации. */
      var away = hiddenAt ? Date.now() - hiddenAt : Infinity;
      hiddenAt = 0;
      if (shouldSyncOnResume({ dirty: dirty, awayMs: away, sinceLastMs: Date.now() - num(syncCfg().lastAt) })) {
        autoSync();
      }
    });
  }

  /* Автосинхронизация возобновляется из app.js init() после S.load(),
     потому что syncCfg() на момент загрузки модуля ещё не видит
     данные из localStorage. Здесь лишь планируем первый обмен, если
     уже настроено (холодный запуск без app.js — например, unit-тесты). */
  if (syncCfg().auto && isConfigured()) {
    applyAuto();
    scheduleSoon(START_DELAY);
  }

  App.sync = {
    merge: merge,
    isConfigured: isConfigured,
    status: status,
    onChange: onChange,
    configure: configure,
    connect: connect,
    join: join,
    now: now,
    disconnect: disconnect,
    start: start,
    stop: stop,
    /* Есть ли правки, не уехавшие в облако. Панель показывает это словами,
       а страница использует при уходе в фон (flushPending). */
    pending: function () { return dirty; },
    flushPending: flushPending,
    changeDelay: changeDelay,
    shouldSyncOnResume: shouldSyncOnResume,
    shouldRefreshOnRemote: shouldRefreshOnRemote,
    autoInterval: autoInterval,
    dataSignature: dataSignature
  };
})(window);

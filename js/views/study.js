/* ============================================================
   LexiFlow — views/study.js
   Движок тренировки и тестирования.
   Режимы: карточка (флип), выбор варианта, ввод перевода,
   аудирование, микс. Оценка Again/Hard/Good/Easy с превью
   интервалов, отмена последнего ответа, экран результатов.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, S = App.store, SRS = App.srs, SP = App.speech;
  var h = U.h, icon = U.icon;
  var V = App.views = App.views || {};

  var MODES = [
    { id: 'flip', label: 'Карточки', icon: 'cards', hint: 'Классический флип: смотрите слово и оцените себя' },
    { id: 'choice', label: 'Выбор варианта', icon: 'list', hint: 'Выберите правильный перевод из четырёх' },
    { id: 'typing', label: 'Ввод перевода', icon: 'keyboard', hint: 'Вспомните и напишите перевод вручную' },
    { id: 'listening', label: 'Аудирование', icon: 'sound', hint: 'Слушайте слово и выбирайте перевод' },
    { id: 'mixed', label: 'Микс', icon: 'shuffle', hint: 'Все режимы по очереди в одной сессии' }
  ];

  var DIRS = [
    { id: 'fwd', label: 'Слово → перевод' },
    { id: 'rev', label: 'Перевод → слово' },
    { id: 'mixed', label: 'В обе стороны' }
  ];

  var session = null;

  /* ---------- Вспомогательные ---------- */

  function modeMeta(id) {
    return MODES.find(function (m) { return m.id === id; }) || MODES[0];
  }

  function deckSettingsFor(deckIds) {
    // если выбрана одна колода — берём её настройки; иначе усреднённые (берём первую)
    var d = deckIds.length === 1 ? S.getDeck(deckIds[0]) : null;
    return SRS.sanitizeSettings(d ? d.settings : SRS.DEFAULT_SETTINGS);
  }

  function primaryLang(deckIds, side) {
    var deck = deckIds.length ? S.getDeck(deckIds[0]) : null;
    if (!deck) return side === 'to' ? 'ru' : 'en';
    return side === 'to' ? deck.langTo : deck.langFrom;
  }

  function langForCard(card, side) {
    var deck = S.getDeck(card.deckId);
    if (!deck) return side === 'to' ? 'ru' : 'en';
    return side === 'to' ? deck.langTo : deck.langFrom;
  }

  /* ---------- Проверка озвучки перед началом ---------- */

  /**
   * Языки, которые понадобятся в этой тренировке.
   * Слово читается на языке колоды, но в обратном направлении и в примерах
   * звучит и язык перевода, поэтому проверяем оба.
   */
  function sessionLangs() {
    var langs = [];
    ((session && session.deckIds) || []).forEach(function (id) {
      var deck = S.getDeck(id);
      if (!deck) return;
      [deck.langFrom, deck.langTo].forEach(function (lang) {
        if (lang && langs.indexOf(lang) < 0) langs.push(lang);
      });
    });
    return langs;
  }

  /* Ключ включает уровень голоса: если голос появится или сменится на
     роботизированный, предупреждение покажется снова, а не потеряется. */
  function noticeKey(langs, level) {
    return langs.slice().sort().join(',') + ':' + level;
  }

  function rememberNotice(key) {
    var seen = Object.assign({}, S.settings().ttsNoticeSeen);
    seen[key] = true;
    S.updateSettings({ ttsNoticeSeen: seen });
  }

  /**
   * Фразы текущей сессии по языкам: слово и перевод каждой карточки плюс
   * примеры. Именно это уйдёт на скачивание, поэтому список строится из
   * очереди сессии, а не из всей колоды — качать то, что человек не увидит,
   * значит зря дёргать чужой бесплатный сервис.
   */
  function sessionPhrases() {
    var byLang = {};
    var seen = {};
    function add(lang, text) {
      if (!lang || !text) return;
      var base = SP.baseLang(lang);
      if (!byLang[base]) byLang[base] = [];
      byLang[base].push(text);
    }
    var items = session.learn.concat(session.main);
    if (session.current && session.current.item) items.push(session.current.item);
    items.forEach(function (item) {
      var card = item.card;
      if (!card || seen[card.id]) return;
      seen[card.id] = true;
      var deck = S.getDeck(card.deckId);
      var from = deck ? deck.langFrom : 'en';
      var to = deck ? deck.langTo : 'ru';
      add(from, card.word);
      add(to, card.translation);
      (card.examples || []).forEach(function (ex) { if (ex && ex.text) add(from, ex.text); });
    });
    return byLang;
  }

  function pluralPhrases(n) {
    return n + ' ' + U.plural(n, 'фраза', 'фразы', 'фраз');
  }

  /**
   * Кнопка «Скачать качественную озвучку»: включает сетевую озвучку
   * (это и есть осознанное согласие — текст уходит на чужой сервер)
   * и качает фразы сессии, показывая прогресс и честный итог.
   *
   * Итог не «загружено успешно», а «сколько фраз теперь доступно офлайн»:
   * число берётся из кэша (ttsnet.stats), а не из факта запуска загрузки.
   */
  function downloadAudioButton() {
    if (!App.ttsnet || !App.ttsnet.preload) return null;

    var status = h('span', { class: 'muted small' });
    var bar = h('div', { class: 'progress progress--sm' }, h('div', { class: 'progress__bar', style: { width: '0%' } }));
    var box = h('div', { class: 'tts-notice__progress', style: { display: 'none' } }, status, bar);

    function show(text, pct) {
      box.style.display = '';
      status.textContent = text;
      var fill = bar.querySelector('.progress__bar');
      if (fill && pct !== undefined && pct !== null) {
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      }
    }

    function run() {
      var byLang = sessionPhrases();
      var langs = Object.keys(byLang);
      if (!langs.length) { show('В этой тренировке нечего озвучивать.', 0); return; }

      /* Настройка включена по умолчанию, но пишем её явно: человек мог
         выключить сетевую озвучку раньше, а это действие — его осознанное
         согласие (в диалоге прямо сказано, что текст уходит на чужой сервер). */
      var cur = S.settings().ttsNet || {};
      S.updateSettings({ ttsNet: { enabled: true, downloaded: cur.downloaded || 0 } });
      if (!App.ttsnet.available()) {
        show('Нет интернета — остаётся системный голос.', 0);
        return;
      }

      var total = 0;
      langs.forEach(function (l) { total += byLang[l].length; });
      var seen = 0;      // обработано фраз в уже пройденных языках
      var failed = 0;
      show('Скачиваю озвучку: 0 из ' + total, 0);

      /* Языки идут по очереди, а не параллельно: у preload свой предел
         параллелизма внутри языка, и складывать их не нужно — сервис чужой. */
      var chain = Promise.resolve();
      langs.forEach(function (lang) {
        chain = chain.then(function () {
          return App.ttsnet.preload(byLang[lang], lang, function (p) {
            var processed = seen + p.done + p.failed;
            show('Скачиваю озвучку: ' + Math.min(processed, total) + ' из ' + total,
              total ? processed / total * 100 : 0);
          });
        }).then(function (res) {
          failed += res.failed;
          seen += res.done + res.failed;
          return res;
        });
      });

      chain.then(function () {
        return App.ttsnet.stats();
      }).then(function (st) {
        if (!st.count) {
          show('Не удалось: сервис озвучки недоступен. Остаётся системный голос.', 0);
          return;
        }
        var size = U.fmtBytes(st.bytes);
        if (failed) {
          show('Частично: озвучено ' + pluralPhrases(st.count) + ', ' + size +
            '. Остальное прочитает системный голос.', 100);
        } else {
          show('Готово: озвучено ' + pluralPhrases(st.count) + ', ' + size +
            ' — теперь работает без интернета.', 100);
        }
      }).catch(function () {
        show('Не удалось: сервис озвучки недоступен. Остаётся системный голос.', 0);
      });
    }

    var btn = h('button', {
      class: 'btn btn--primary btn--sm',
      onclick: function () {
        U.confirmDialog('Скачать качественную озвучку?',
          'Нужен интернет. Текст фраз этой тренировки уйдёт на сторонний бесплатный сервис ' +
          'озвучки (code.responsivevoice.org). После загрузки озвучка работает без интернета. ' +
          'Сервис может отказать — тогда останется системный голос.',
          'Скачать').then(function (ok) {
            if (!ok) return;
            run();
          });
      }
    }, icon('download', 15), h('span', { text: 'Скачать качественную озвучку' }));

    return h('div', { class: 'tts-notice__download' }, h('div', { class: 'inline-row' }, btn), box);
  }

  /**
   * Предупреждение об озвучке в начале тренировки.
   *
   * Зачем: человек нажимает 🔊, слышит чужое произношение или робота и не
   * понимает почему. Голоса для этого языка в системе может не быть вовсе —
   * а изнутри карточки это выглядит как поломка приложения. Поэтому
   * проверяем голоса до первого слова и говорим, что делать: поставить
   * голос в системе, открыть приложение в Edge или скачать озвучку здесь.
   */
  function ttsNotice() {
    if (!session || session.ttsNoticeClosed || !SP || !SP.voiceAdvice) return null;

    var langs = sessionLangs();
    if (!langs.length) return null;

    /* Что именно не так с голосами, решает speech.js — там же это и проверяется. */
    var advice = SP.voiceAdvice(langs);
    if (!advice) return null;

    var level = advice.level;
    var key = noticeKey(langs, level);
    if ((S.settings().ttsNoticeSeen || {})[key]) return null;

    var notice = h('div', { class: 'tts-notice' + (level === 'poor' ? ' tts-notice--soft' : '') },
      h('div', { class: 'tts-notice__text' },
        h('b', { text: advice.title }),
        h('span', { class: 'small', text: advice.text })
      ),
      h('div', { class: 'tts-notice__actions' },
        h('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: function () { App.router.go('#/settings'); }
        }, icon('sound', 15), h('span', { text: 'Настройки озвучки' })),
        h('button', {
          class: 'icon-btn', title: 'Больше не показывать',
          onclick: function () {
            session.ttsNoticeClosed = true;
            rememberNotice(key);
            if (notice && notice.remove) notice.remove();
          }
        }, icon('close', 16))
      ),
      /* Кнопка действия, а не только совет уйти в настройки: раньше блок
         честно объяснял проблему, но решить её из тренировки было нельзя. */
      downloadAudioButton()
    );
    return notice;
  }

  /** Собрать очередь на сессию. */
  function buildQueue(deckIds, opts) {
    var now = Date.now();
    var settings = deckSettingsFor(deckIds);
    var cards = S.allCards(deckIds).filter(function (c) { return !c.suspended; });

    var learning = [], review = [], fresh = [];
    cards.forEach(function (c) {
      if (SRS.isNew(c)) fresh.push(c);
      else if (SRS.isLearning(c)) learning.push(c);
      else review.push(c);
    });

    learning = learning.filter(function (c) { return c.srs.due <= now; })
      .sort(function (a, b) { return a.srs.due - b.srs.due; });
    review = review.filter(function (c) { return c.srs.due <= now; })
      .sort(function (a, b) { return a.srs.due - b.srs.due; });

    // лимит новых в день
    var newBudget;
    if (opts.ignoreLimits) {
      newBudget = fresh.length;
    } else {
      var perDeck = {};
      deckIds.forEach(function (id) {
        var used = S.newIntroducedToday(id, now);
        var d = S.getDeck(id);
        perDeck[id] = Math.max(0, (d ? d.settings.newPerDay : settings.newPerDay) - used);
      });
      var budget = 0;
      fresh.forEach(function (c) { if (perDeck[c.deckId] === undefined) perDeck[c.deckId] = settings.newPerDay; });
      Object.keys(perDeck).forEach(function (k) { budget += perDeck[k]; });
      newBudget = Math.min(fresh.length, budget);
    }

    if (settings.newOrder === 'random') shuffle(fresh);
    else fresh.sort(function (a, b) { return a.createdAt - b.createdAt; });
    fresh = fresh.slice(0, newBudget);

    // лимит повторений
    var reviewBudget = opts.ignoreLimits ? review.length : Math.min(review.length, settings.maxReviewsPerDay);

    var learnQueue = learning.map(function (c) { return { card: c, kind: 'learn', due: c.srs.due }; });
    var mainQueue = review.slice(0, reviewBudget).map(function (c) { return { card: c, kind: 'review', due: c.srs.due }; })
      .concat(fresh.map(function (c) { return { card: c, kind: 'new', due: 0 }; }));

    if (opts.shuffleMain) shuffle(mainQueue);
    if (opts.limit) mainQueue = mainQueue.slice(0, opts.limit);

    return {
      learn: learnQueue,
      main: mainQueue,
      counts: { new: fresh.length, learning: learning.length, due: review.slice(0, reviewBudget).length }
    };
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildTestQueue(deckIds, count) {
    var cards = S.allCards(deckIds).filter(function (c) { return !c.suspended && c.word && c.translation; });
    // приоритет карточкам с прогрессом
    cards.sort(function (a, b) {
      var sa = SRS.isNew(a) ? 1 : 0, sb = SRS.isNew(b) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      return (b.srs.reps || 0) - (a.srs.reps || 0);
    });
    var pool = cards.slice(0, Math.max(count * 2, count));
    shuffle(pool);
    return pool.slice(0, count).map(function (c) { return { card: c, kind: 'test', due: 0 }; });
  }

  /* ============================================================
     Стартовый экран сессии
     ============================================================ */

  function renderStudy(root, params) {
    var deckIds = params.id && params.id !== 'all' ? [params.id] : S.get().decks.map(function (d) { return d.id; });
    var deck = params.id && params.id !== 'all' ? S.getDeck(params.id) : null;
    if (!deckIds.length) {
      U.clear(root);
      root.appendChild(h('div', { class: 'page' },
        V.decks.emptyState('layers', 'Нет колод для тренировки', 'Сначала создайте колоду и добавьте в неё слова.',
          h('button', { class: 'btn btn--primary', onclick: function () { App.router.go('#/decks'); } }, h('span', { text: 'К колодам' })))));
      return;
    }

    var cfg = renderStudy._cfg || (renderStudy._cfg = {
      mode: S.settings().defaultMode || 'flip',
      dir: S.settings().defaultDir || 'fwd',
      limit: S.settings().sessionLimit || 40,
      useLimits: true,
      shuffle: false
    });

    var now = Date.now();
    var totals = { new: 0, learning: 0, due: 0, total: 0 };
    deckIds.forEach(function (id) {
      var st = S.deckStats(id, now);
      totals.new += st.new; totals.learning += st.learning; totals.due += st.due; totals.total += st.total;
    });

    var modeRow = h('div', { class: 'mode-grid' });
    MODES.forEach(function (m) {
      if (m.id === 'listening' && !SP.supported()) return;
      modeRow.appendChild(h('button', {
        class: 'mode-card' + (cfg.mode === m.id ? ' is-active' : ''),
        onclick: function () {
          cfg.mode = m.id;
          U.qsa('.mode-card', modeRow).forEach(function (c) { c.classList.remove('is-active'); });
          this.classList.add('is-active');
        }
      },
        h('span', { class: 'mode-card__icon' }, icon(m.icon, 20)),
        h('b', { text: m.label }),
        h('small', { text: m.hint })
      ));
    });

    var dirRow = h('div', { class: 'chips' });
    DIRS.forEach(function (d) {
      dirRow.appendChild(h('button', {
        class: 'chip' + (cfg.dir === d.id ? ' is-active' : ''),
        onclick: function () {
          cfg.dir = d.id;
          U.qsa('.chip', dirRow).forEach(function (c) { c.classList.remove('is-active'); });
          this.classList.add('is-active');
        }
      }, h('span', { text: d.label })));
    });

    var limitInput = h('input', {
      class: 'input', type: 'number', min: 0, max: 500, value: cfg.limit,
      onchange: function () { cfg.limit = Math.max(0, Math.min(500, Number(this.value) || 0)); }
    });

    var limitsToggle = h('input', {
      type: 'checkbox', checked: cfg.useLimits,
      onchange: function () { cfg.useLimits = this.checked; }
    });
    var shuffleToggle = h('input', {
      type: 'checkbox', checked: cfg.shuffle,
      onchange: function () { cfg.shuffle = this.checked; }
    });

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go(deck ? '#/deck/' + deck.id : '#/decks'); } }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: deck ? 'Тренировка: ' + deck.name : 'Тренировка по всем колодам' }),
          h('p', { class: 'page-sub', text: totals.due + ' к повторению · ' + totals.learning + ' в обучении · ' + totals.new + ' новых' })
        )
      )
    );

    var launcher = h('div', { class: 'panel panel--wide' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title', text: 'Режим тренировки' })),
      modeRow,
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Направление' }),
        dirRow
      ),
      h('div', { class: 'panel__section panel__section--row' },
        h('label', { class: 'switch-row' }, limitsToggle, h('span', { text: 'Учитывать дневные лимиты' })),
        h('label', { class: 'switch-row' }, shuffleToggle, h('span', { text: 'Перемешать порядок' })),
        h('label', { class: 'switch-row switch-row--num' }, h('span', { text: 'Карточек за сессию' }), limitInput)
      ),
      h('div', { class: 'panel__foot' },
        h('button', { class: 'btn btn--primary btn--lg', onclick: function () { startSession(deckIds, cfg, false); } },
          icon('play', 18), h('span', { text: 'Начать тренировку' })),
        h('button', { class: 'btn btn--ghost btn--lg', onclick: function () { App.router.go('#/test/' + (params.id || 'all')); } },
          icon('target', 18), h('span', { text: 'Режим теста' }))
      )
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page' }, head, launcher)]);
  }

  /* ============================================================
     Сессия
     ============================================================ */

  function startSession(deckIds, cfg, isTest) {
    var opts = {
      ignoreLimits: !cfg.useLimits,
      shuffleMain: !!cfg.shuffle,
      limit: cfg.limit
    };
    var q = isTest ? null : buildQueue(deckIds, opts);
    var queue = isTest
      ? { learn: [], main: buildTestQueue(deckIds, cfg.count || 20), counts: { new: 0, learning: 0, due: 0 } }
      : q;

    session = {
      deckIds: deckIds,
      mode: cfg.mode,
      dir: cfg.dir,
      applySrs: !isTest,
      test: !!isTest,
      learn: queue.learn,
      main: queue.main,
      initialCounts: queue.counts,
      current: null,
      cardStartTs: 0,
      startedAt: Date.now(),
      answered: 0,
      correct: 0,
      totalPlanned: queue.learn.length + queue.main.length,
      history: [],
      undoStack: [],
      mistakes: [],
      finished: false,
      interstitial: null
    };

    /* Дальше отрисовывает роутер: go() либо кликнет render сам (hash тот же),
       либо поменяет hash, и сессию нарисует hashchange. Свой renderSession()
       здесь давал вторую отрисовку той же карточки, а с ней — второй,
       уже ненужный запуск озвучки. */
    App.router.go(isTest ? '#/test/' + (deckIds.length === 1 ? deckIds[0] : 'all') + '/run' : '#/study/' + (deckIds.length === 1 ? deckIds[0] : 'all') + '/run');
  }

  function renderSession() {
    var root = U.qs('#view');
    if (!session) { App.router.refresh(); return; }
    if (session.finished) { finish(); return; }

    var bar = h('header', { class: 'study__bar' },
      h('button', { class: 'icon-btn', title: 'Выйти', onclick: function () { exitSession(); } }, icon('close', 20)),
      h('div', { class: 'study__meter' },
        h('div', { class: 'study__meter-top' },
          h('span', { class: 'study__meter-label', id: 'study-label', text: progressLabel() }),
          h('span', { class: 'study__meter-right', text: modeMeta(currentModeId()).label })
        ),
        h('div', { class: 'progress progress--sm' },
          h('div', { class: 'progress__bar', id: 'study-progress', style: { width: progressPct() + '%' } })
        )
      ),
      h('div', { class: 'study__actions' },
        /* Бейдж стрика прямо в тренировке: отвечает Duolingo-эффекту —
           видно, что сессия продлевает серию. */
        (function () {
          var st = App.streak ? App.streak.computeStreak(S.get().logs, Date.now(), S.settings().streakGoal) : null;
          if (!st) return null;
          return h('span', {
            class: 'streak-badge' + (st.doneToday ? ' streak-badge--done' : ''),
            title: st.doneToday ? 'Серия сегодня продлена!' : 'Осталось ' + App.streak.remainingToday(st, S.settings().streakGoal) + ' ответов до продления серии',
            text: '🔥 ' + st.current
          });
        })(),
        h('button', {
          class: 'icon-btn', title: 'Отменить последний ответ', id: 'undo-btn',
          disabled: session.undoStack.length ? null : true,
          onclick: function () { undo(); }
        }, icon('undo', 18))
      )
    );

    U.clear(root);
    U.append(root, [
      h('div', { class: 'study' + (session.test ? ' study--test' : '') },
        bar,
        /* Проверка голосов — до первого слова, а не после немой кнопки 🔊 */
        ttsNotice(),
        h('div', { class: 'study__stage', id: 'stage' }),
        h('div', { class: 'study__footer', id: 'study-footer' })
      )
    ]);

    if (!session.current) { next(); return; }

    // повторная отрисовка того же вопроса (например, при смене hash) —
    // карточка не должна «съедаться» повторным вызовом next()
    session.current.revealed = false;
    session.cardStartTs = Date.now();
    renderCard();
    updateProgress();
  }

  function currentModeId() {
    if (session.mode !== 'mixed') return session.mode;
    return session.current ? session.current.mode : 'flip';
  }

  /** Сколько уникальных карточек ещё в работе (включая текущую на экране). */
  function remainingUnique() {
    var set = {};
    session.learn.forEach(function (i) { set[i.card.id] = 1; });
    session.main.forEach(function (i) { set[i.card.id] = 1; });
    if (session.current) set[session.current.card.id] = 1;
    return Object.keys(set).length;
  }

  function progressLabel() {
    return 'Отвечено: ' + session.answered + ' · осталось ' + remainingUnique();
  }

  function progressPct() {
    var rem = remainingUnique();
    var total = session.answered + rem;
    return total ? Math.round(session.answered / total * 100) : 0;
  }

  function updateProgress() {
    var label = U.qs('#study-label'), bar = U.qs('#study-progress');
    if (label) label.textContent = progressLabel();
    if (bar) bar.style.width = progressPct() + '%';
    var undoBtn = U.qs('#undo-btn');
    if (undoBtn) undoBtn.disabled = !session.undoStack.length;
  }

  /** Взять следующую карточку. */
  function next() {
    var now = Date.now();
    var item = null;

    // карточки в обучении, срок которых наступил
    if (session.learn.length && session.learn[0].due <= now) {
      item = session.learn.shift();
    } else if (session.main.length) {
      item = session.main.shift();
    } else if (session.learn.length) {
      // остались только карточки обучения с задержкой
      showInterstitial();
      return;
    }

    if (!item) { finish(); return; }

    var mode = session.mode === 'mixed' ? pickMixedMode(item.card) : session.mode;
    session.current = { item: item, card: item.card, mode: mode, dir: resolveDir(), revealed: false };
    session.cardStartTs = now;
    renderCard();
    updateProgress();
  }

  function pickMixedMode(card) {
    var pool = ['flip', 'choice', 'typing'];
    if (SP.supported()) pool.push('listening');
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function resolveDir() {
    if (session.dir === 'mixed') return Math.random() < 0.5 ? 'fwd' : 'rev';
    return session.dir;
  }

  /* ---------- Отрисовка карточки ---------- */

  function renderCard() {
    var stage = U.qs('#stage');
    var footer = U.qs('#study-footer');
    if (!stage || !footer) return;
    U.clear(stage); U.clear(footer);
    if (!session.current) return;

    var c = session.current;
    var card = c.card;
    var mode = c.mode;
    if (mode === 'listening') { renderListening(stage, footer, c); return; }
    if (mode === 'choice') { renderChoice(stage, footer, c); return; }
    if (mode === 'typing') { renderTyping(stage, footer, c); return; }
    renderFlip(stage, footer, c);
  }

  /** Промпт (лицевая сторона) карточки. */
  function promptSide(card, dir) {
    var frontText = dir === 'fwd' ? card.word : card.translation;
    var lang = dir === 'fwd' ? langForCard(card, 'from') : langForCard(card, 'to');
    var ipa = dir === 'fwd' ? card.transcription : '';
    var wordSpan = h('span', { class: 'qcard__word-text', text: frontText });
    var wrap = h('div', { class: 'qcard__prompt' },
      h('div', { class: 'qcard__label', text: dir === 'fwd' ? 'Переведите' : 'Как это будет на изучаемом языке?' }),
      h('div', { class: 'qcard__word' },
        wordSpan,
        SP.supported() ? SP.audioButton(frontText, lang, { rate: S.settings().ttsRate, target: wordSpan }) : null
      ),
      ipa && S.settings().showTranscription
        ? h('div', { class: 'qcard__ipa', text: '[' + ipa.replace(/^\[|\]$/g, '') + ']' })
        : null
    );
    return wrap;
  }

  function answerSide(card, dir) {
    var answerText = dir === 'fwd' ? card.translation : card.word;
    var lang = dir === 'fwd' ? langForCard(card, 'to') : langForCard(card, 'from');
    var ipa = dir === 'fwd' ? '' : card.transcription;
    var answerSpan = h('span', { class: 'qcard__answer-text', text: answerText });
    return h('div', { class: 'qcard__answer' },
      h('div', { class: 'qcard__answer-main' },
        answerSpan,
        SP.supported() ? SP.audioButton(answerText, lang, { rate: S.settings().ttsRate, target: answerSpan }) : null
      ),
      ipa && S.settings().showTranscription ? h('div', { class: 'qcard__ipa', text: '[' + ipa.replace(/^\[|\]$/g, '') + ']' }) : null,
      card.examples && card.examples.length
        ? h('ul', { class: 'qcard__examples' },
            card.examples.map(function (ex) {
              var exSpan = h('span', { class: 'qcard__example-text', text: ex.text });
              return h('li', {},
                exSpan,
                SP.supported() ? SP.audioButton(ex.text, dir === 'fwd' ? langForCard(card, 'from') : langForCard(card, 'to'), { small: true, target: exSpan }) : null,
                ex.translation ? h('span', { class: 'qcard__example-trans', text: ex.translation }) : null
              );
            })
          )
        : null,
      card.notes ? h('div', { class: 'qcard__notes', text: card.notes }) : null,
      (card.tags && card.tags.length)
        ? h('div', { class: 'qcard__tags' }, card.tags.map(function (t) { return h('span', { class: 'tag', text: t }); }))
        : null
    );
  }

  /* --- Режим «Карточки» --- */

  function renderFlip(stage, footer, c) {
    var card = c.card;
    var wrap = h('div', { class: 'qcard' }, promptSide(card, c.dir));
    stage.appendChild(wrap);

    function reveal() {
      if (c.revealed) return;
      c.revealed = true;
      wrap.appendChild(answerSide(card, c.dir));
      wrap.classList.add('is-revealed');
      U.clear(footer);
      footer.appendChild(ratingRow(card, null));
      autoplayAnswer(card, c.dir);
    }

    if (!c.revealed) {
      footer.appendChild(h('button', { class: 'btn btn--primary btn--lg btn--wide', onclick: reveal },
        h('span', { text: 'Показать ответ' }),
        h('span', { class: 'kbd-hint', text: 'Пробел' })
      ));
      setPrimaryAction(reveal);
    } else {
      footer.appendChild(ratingRow(card, null));
    }
    if (S.settings().ttsAutoPlay && !c.revealed) autoplayQuestion(card, c.dir);
  }

  /* --- Режим «Выбор варианта» --- */

  function renderChoice(stage, footer, c) {
    var card = c.card;
    var correctText = c.dir === 'fwd' ? card.translation : card.word;
    var options = buildOptions(card, c.dir);
    var wrap = h('div', { class: 'qcard' }, promptSide(card, c.dir));
    var grid = h('div', { class: 'choices' });
    var locked = false;

    options.forEach(function (opt) {
      var btn = h('button', { class: 'choice' },
        h('span', { class: 'choice__key', text: String(options.indexOf(opt) + 1) }),
        h('span', { class: 'choice__text', text: opt })
      );
      btn.addEventListener('click', function () {
        if (locked) return;
        locked = true;
        var isCorrect = U.normalize(opt) === U.normalize(correctText);
        U.qsa('.choice', grid).forEach(function (b) {
          var t = b.querySelector('.choice__text').textContent;
          if (U.normalize(t) === U.normalize(correctText)) b.classList.add('is-correct');
          else if (b === btn) b.classList.add('is-wrong');
          b.classList.add('is-locked');
        });
        c.revealed = true;
        wrap.appendChild(answerSide(card, c.dir));
        U.clear(footer);
        footer.appendChild(h('button', {
          class: 'btn btn--primary btn--lg btn--wide',
          onclick: function () { commit(isCorrect ? SRS.GRADES.GOOD : SRS.GRADES.AGAIN, isCorrect); }
        }, h('span', { text: 'Далее' }), h('span', { class: 'kbd-hint', text: 'Пробел' })));
        setPrimaryAction(function () { commit(isCorrect ? SRS.GRADES.GOOD : SRS.GRADES.AGAIN, isCorrect); });
        updateProgress();
      });
      grid.appendChild(btn);
    });

    wrap.appendChild(grid);
    stage.appendChild(wrap);
    if (S.settings().ttsAutoPlay) autoplayQuestion(card, c.dir);
  }

  function buildOptions(card, dir) {
    var correctText = dir === 'fwd' ? card.translation : card.word;
    var pool = S.allCards(session.deckIds.length ? session.deckIds : null);
    var seen = {};
    seen[U.normalize(correctText)] = true;
    var distractors = [];
    // сначала — карточки той же колоды
    var sameDeck = pool.filter(function (x) { return x.deckId === card.deckId; });
    var others = pool.filter(function (x) { return x.deckId !== card.deckId; });
    [sameDeck, others].forEach(function (list) {
      var shuffled = shuffle(list.slice());
      shuffled.forEach(function (x) {
        var t = dir === 'fwd' ? x.translation : x.word;
        if (!t) return;
        var k = U.normalize(t);
        if (seen[k]) return;
        seen[k] = true;
        distractors.push(t);
      });
    });
    distractors = distractors.slice(0, 3);
    var opts = [correctText].concat(distractors);
    shuffle(opts);
    return opts;
  }

  /* --- Режим «Ввод перевода» --- */

  function renderTyping(stage, footer, c) {
    var card = c.card;
    var expected = c.dir === 'fwd' ? card.translation : card.word;
    var input = h('input', {
      class: 'input input--answer', type: 'text', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', placeholder: 'Введите ответ и нажмите Enter', 'aria-label': 'Ответ'
    });
    var wrap = h('div', { class: 'qcard' }, promptSide(card, c.dir),
      h('div', { class: 'typing' }, input)
    );
    var locked = false;

    function check() {
      if (locked) return;
      var value = input.value.trim();
      if (!value) { U.toast('Введите ответ', 'warn', 1500); return; }
      locked = true;
      var ok = U.normalize(value) === U.normalize(expected);
      var near = !ok && U.levenshtein(U.normalize(value), U.normalize(expected)) <= (U.normalize(expected).length > 6 ? 2 : 1);
      var grade = ok ? SRS.GRADES.GOOD : near ? SRS.GRADES.HARD : SRS.GRADES.AGAIN;

      input.disabled = true;
      input.classList.add(ok ? 'is-ok' : near ? 'is-near' : 'is-bad');
      wrap.appendChild(h('div', { class: 'typing__result typing__result--' + (ok ? 'ok' : near ? 'near' : 'bad') },
        h('div', { class: 'typing__verdict' },
          icon(ok ? 'check' : near ? 'info' : 'close', 17),
          h('span', { text: ok ? 'Верно!' : near ? 'Почти — есть опечатка' : 'Неверно' })
        ),
        h('div', { class: 'typing__diff', html: ok ? U.esc(value) : U.diffHtml(value, expected) })
      ));
      wrap.appendChild(answerSide(card, c.dir));
      U.clear(footer);
      footer.appendChild(ratingRow(card, grade));
      updateProgress();
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); check(); }
    });
    setTimeout(function () { input.focus(); }, 60);
    setPrimaryAction(check);
    stage.appendChild(wrap);
  }

  /* --- Режим «Аудирование» --- */

  function renderListening(stage, footer, c) {
    var card = c.card;
    var dir = c.dir;
    var spoken = dir === 'fwd' ? card.word : card.translation;
    var spokenLang = dir === 'fwd' ? langForCard(card, 'from') : langForCard(card, 'to');
    var correctText = dir === 'fwd' ? card.translation : card.word;
    var options = buildOptions(card, dir);
    var locked = false;

    var playBtn = h('button', { class: 'audio-hero' },
      h('span', { class: 'audio-hero__ring' }),
      icon('sound', 34),
      h('span', { class: 'audio-hero__hint', text: 'Нажмите, чтобы прослушать' })
    );
    function play(rate) {
      playBtn.classList.add('is-playing');
      var done = function () { playBtn.classList.remove('is-playing'); };
      /* Тот же путь, что у 🔊: сначала готовый файл, иначе системный голос.
         Раньше аудирование всегда говорило системой — и в режиме, который
         целиком построен на звуке, это слышнее всего. */
      if (typeof SP.speakBest === 'function') {
        SP.speakBest(spoken, spokenLang, { rate: rate || S.settings().ttsRate, onend: done });
      } else {
        SP.speak(spoken, spokenLang, { rate: rate || S.settings().ttsRate, onend: done });
      }
      // страховка: если ни файл, ни синтез не сказали «конец», кнопка не должна вечно «играть»
      setTimeout(done, 8000);
    }
    playBtn.addEventListener('click', function () { play(); });

    var grid = h('div', { class: 'choices choices--audio' });
    options.forEach(function (opt, i) {
      var btn = h('button', { class: 'choice' },
        h('span', { class: 'choice__key', text: String(i + 1) }),
        h('span', { class: 'choice__text', text: opt })
      );
      btn.addEventListener('click', function () {
        if (locked) return;
        locked = true;
        var isCorrect = U.normalize(opt) === U.normalize(correctText);
        U.qsa('.choice', grid).forEach(function (b) {
          var t = b.querySelector('.choice__text').textContent;
          if (U.normalize(t) === U.normalize(correctText)) b.classList.add('is-correct');
          else if (b === btn) b.classList.add('is-wrong');
          b.classList.add('is-locked');
        });
        wrap.appendChild(answerSide(card, dir));
        U.clear(footer);
        footer.appendChild(h('button', {
          class: 'btn btn--primary btn--lg btn--wide',
          onclick: function () { commit(isCorrect ? SRS.GRADES.GOOD : SRS.GRADES.AGAIN, isCorrect); }
        }, h('span', { text: 'Далее' }), h('span', { class: 'kbd-hint', text: 'Пробел' })));
        setPrimaryAction(function () { commit(isCorrect ? SRS.GRADES.GOOD : SRS.GRADES.AGAIN, isCorrect); });
        updateProgress();
      });
      grid.appendChild(btn);
    });

    var controls = h('div', { class: 'audio-controls' },
      playBtn,
      h('div', { class: 'audio-controls__row' },
        h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { play(0.6); } }, icon('refresh', 15), h('span', { text: 'Медленно' })),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { play(1.05); } }, icon('sound', 15), h('span', { text: 'Обычно' }))
      )
    );

    var wrap = h('div', { class: 'qcard' },
      h('div', { class: 'qcard__prompt qcard__prompt--audio' },
        h('div', { class: 'qcard__label', text: 'Прослушайте и выберите перевод' }),
        controls
      ),
      grid
    );
    stage.appendChild(wrap);
    if (S.settings().ttsAutoPlay) setTimeout(function () { play(); }, 320);
  }

  /* ---------- Ряд кнопок оценки ---------- */

  function ratingRow(card, suggested) {
    var deck = S.getDeck(card.deckId);
    var settings = SRS.sanitizeSettings(deck ? deck.settings : SRS.DEFAULT_SETTINGS);
    var previews = session.applySrs ? SRS.preview(card, settings, Date.now()) : null;
    var row = h('div', { class: 'rating-row' });
    [1, 2, 3, 4].forEach(function (g) {
      var btn = h('button', {
        class: 'rate rate--' + g + (suggested === g ? ' is-suggested' : ''),
        onclick: function () { commit(g, g >= 3); }
      },
        h('span', { class: 'rate__label', text: SRS.GRADE_LABELS[g] }),
        h('span', { class: 'rate__interval', text: previews ? previews[g] : (session.test ? '—' : '') }),
        h('span', { class: 'rate__key', text: SRS.GRADE_HOTKEYS[g] })
      );
      row.appendChild(btn);
    });
    return row;
  }

  /**
   * Озвучить фразу ровно тем же путём, что и кнопка 🔊: сначала файл
   * (свой пакет → кэш → сеть), а если не вышло — системный голос.
   *
   * Раньше автовоспроизведение шло напрямую в App.speech.speak и потому
   * всегда звучало системным голосом — тем самым роботом, от которого
   * человек как раз и ушёл к сетевой озвучке. Путь обязан быть один,
   * иначе карточка «сама» говорит хуже, чем по кнопке.
   *
   * Подсветка слов при файле не работает: у MP3 нет события onboundary.
   */
  function speakAuto(text, lang, highlightEl) {
    if (typeof SP.speakBest === 'function') {
      SP.speakBest(text, lang, { rate: S.settings().ttsRate, highlight: highlightEl });
      return;
    }
    SP.speak(text, lang, { rate: S.settings().ttsRate, highlight: highlightEl });
  }

  var autoTimer = 0;   // ждущий автопрогон вопроса

  function autoplayQuestion(card, dir) {
    if (!SP.supported() || !card.word) return;
    /* Экран иногда отрисовывается дважды подряд (смена hash и перерисовка
       сессии), и без clearTimeout фраза стартовала два раза одновременно:
       второй файл перебивал первый, тот считался провалом, и приложение
       падало обратно на системный голос — ровно тот робот, от которого
       человек ушёл к сетевой озвучке. Ждущий прогон всегда один. */
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      autoTimer = 0;
      if (!session || !session.current || session.current.card.id !== card.id) return;
      speakAuto(dir === 'fwd' ? card.word : card.translation,
        dir === 'fwd' ? langForCard(card, 'from') : langForCard(card, 'to'),
        U.qs('.qcard__word-text'));
    }, 260);
  }

  function autoplayAnswer(card, dir) {
    if (!SP.supported() || !S.settings().ttsAutoPlay) return;
    var text = dir === 'fwd' ? card.word : card.translation;
    speakAuto(text, dir === 'fwd' ? langForCard(card, 'from') : langForCard(card, 'to'),
      U.qs('.qcard__answer-text'));
  }

  /* ---------- Обработка ответа ---------- */

  function commit(grade, correct) {
    if (!session || !session.current) return;
    var c = session.current;
    var card = c.card;
    var now = Date.now();
    var deck = S.getDeck(card.deckId);
    var settings = SRS.sanitizeSettings(deck ? deck.settings : SRS.DEFAULT_SETTINGS);
    var prevSrs = JSON.parse(JSON.stringify(card.srs));
    var result = SRS.answer(card, grade, settings, now);
    var logEntry = null;

    if (session.applySrs) {
      card.srs = result.srs;
      logEntry = S.addLog({
        cardId: card.id, deckId: card.deckId, ts: now, grade: grade,
        mode: c.mode, dir: c.dir, correct: !!correct,
        ms: now - session.cardStartTs,
        stateFrom: result.stateFrom, stateTo: result.stateTo, test: false
      });
      S.save();
      session.undoStack.push({
        cardId: card.id, prevSrs: prevSrs, logId: logEntry.id,
        item: c.item, wasInLearn: result.stateTo === 'learning' || result.stateTo === 'relearning',
        due: result.srs.due, grade: grade
      });
      if (result.leech) U.toast('Карточка помечена как трудная', 'warn', 2000);
    } else {
      logEntry = S.addLog({
        cardId: card.id, deckId: card.deckId, ts: now, grade: grade,
        mode: c.mode, dir: c.dir, correct: !!correct,
        ms: now - session.cardStartTs, stateFrom: 'test', stateTo: 'test', test: true
      });
      S.save();
      session.undoStack.push({ cardId: card.id, prevSrs: prevSrs, logId: logEntry.id, item: c.item, test: true, grade: grade });
    }

    session.answered++;
    if (correct) session.correct++;
    if (!correct) session.mistakes.push({ card: card, mode: c.mode, dir: c.dir });
    session.history.push(card.id);

    // возврат в очередь, если карточка ещё учится
    if (session.applySrs) {
      if (result.stateTo === 'learning' || result.stateTo === 'relearning') {
        session.learn.push({ card: card, kind: 'learn', due: result.srs.due });
        session.learn.sort(function (a, b) { return a.due - b.due; });
      }
    }

    session.current = null;
    next();
  }

  function undo() {
    if (!session || !session.undoStack.length) return;
    var last = session.undoStack.pop();
    var card = S.getCard(last.cardId);
    if (!card) { next(); return; }
    card.srs = last.prevSrs;
    if (last.logId) S.removeLog(last.logId);
    S.save();
    session.answered = Math.max(0, session.answered - 1);
    if (last.grade >= 3) session.correct = Math.max(0, session.correct - 1);
    if (session.history.length) session.history.pop();
    if (session.mistakes.length && last.grade < 3) session.mistakes.pop();

    session.learn = session.learn.filter(function (i) { return i.card.id !== last.cardId; });

    // карточка, которая сейчас на экране, возвращается в очередь
    if (session.current && session.current.item && session.current.item.card.id !== last.cardId) {
      session.main.unshift(session.current.item);
    }
    // отменённая карточка показывается снова — первой
    if (last.item) session.main.unshift(last.item);

    U.toast('Ответ отменён', 'info', 1600);
    session.current = null;
    next();
  }

  /* ---------- Ожидание карточек обучения ---------- */

  function showInterstitial() {
    var stage = U.qs('#stage');
    var footer = U.qs('#study-footer');
    if (!stage || !footer) return;
    var item = session.learn[0];
    var now = Date.now();
    var wait = Math.max(0, item.due - now);

    U.clear(stage); U.clear(footer);
    var timerEl = h('b', { class: 'inter__timer', text: U.fmtInterval(Math.max(wait, 1000)) });
    var box = h('div', { class: 'inter' },
      h('div', { class: 'inter__icon' }, icon('clock', 30)),
      h('h2', { class: 'inter__title', text: 'Карточки в обучении' }),
      h('p', { class: 'inter__text' }, 'Осталось ' + session.learn.length + ' ' +
        U.plural(session.learn.length, 'карточка', 'карточки', 'карточек') + '. Следующая будет доступна через ', timerEl),
      h('div', { class: 'inter__actions' },
        h('button', { class: 'btn btn--primary', onclick: function () { forceNext(); } }, icon('play', 17), h('span', { text: 'Показать сейчас' })),
        h('button', { class: 'btn btn--ghost', onclick: function () { finish(); } }, h('span', { text: 'Завершить сессию' }))
      )
    );
    stage.appendChild(box);

    var tick = setInterval(function () {
      if (!session || session.current || !document.body.contains(box)) { clearInterval(tick); return; }
      var left = item.due - Date.now();
      if (left <= 0) { clearInterval(tick); next(); return; }
      timerEl.textContent = U.fmtInterval(left);
    }, 500);
    session._interTimer = tick;
  }

  function forceNext() {
    if (session._interTimer) clearInterval(session._interTimer);
    var item = session.learn.shift();
    if (!item) { finish(); return; }
    var mode = session.mode === 'mixed' ? pickMixedMode(item.card) : session.mode;
    session.current = { item: item, card: item.card, mode: mode, dir: resolveDir(), revealed: false };
    session.cardStartTs = Date.now();
    renderCard();
    updateProgress();
  }

  /* ---------- Завершение ---------- */

  function finish() {
    if (!session) return;
    if (session._interTimer) clearInterval(session._interTimer);
    session.finished = true;
    SP.stop();
    var stage = U.qs('#stage');
    var footer = U.qs('#study-footer');
    if (!stage) { App.router.refresh(); return; }
    U.clear(stage); U.clear(footer);

    var answered = session.answered;
    var accuracy = answered ? Math.round(session.correct / answered * 100) : 0;
    var elapsed = Date.now() - session.startedAt;
    var remaining = countRemaining();

    var statRow = h('div', { class: 'result-stats' },
      resultStat('Повторено', String(answered)),
      resultStat('Верно', accuracy + '%'),
      resultStat('Время', U.fmtDuration(elapsed)),
      resultStat('В минуту', answered ? U.round1(answered / Math.max(elapsed / 60000, 0.05)) : '0')
    );

    var body = [h('div', { class: 'result' },
      h('div', { class: 'result__icon' + (session.test ? ' result__icon--test' : '') },
        icon(session.test ? 'trophy' : 'sparkle', 34)),
      h('h2', { class: 'result__title', text: session.test ? 'Тест завершён' : 'Сессия завершена' }),
      h('p', { class: 'result__sub', text: session.test
        ? 'Результат: ' + session.correct + ' из ' + answered + ' верных ответов'
        : (answered ? 'Отличная работа! Продолжайте в том же темпе.' : 'Сегодня нечего повторять — возвращайтесь позже.') }),
      statRow
    )];

    if (session.test && session.mistakes.length) {
      body.push(h('div', { class: 'panel' },
        h('div', { class: 'panel__head' }, h('h3', { class: 'panel__title', text: 'Ошибки (' + session.mistakes.length + ')' })),
        h('div', { class: 'mistake-list' },
          session.mistakes.slice(0, 30).map(function (m) {
            return h('div', { class: 'mistake' },
              h('b', { text: m.card.word }),
              h('span', { class: 'mistake__trans', text: m.card.translation })
            );
          })
        )
      ));
    }

    var actions = h('div', { class: 'result__actions' });
    if (session.test) {
      if (session.mistakes.length) {
        actions.appendChild(h('button', {
          class: 'btn btn--primary btn--lg',
          onclick: function () { retryMistakes(); }
        }, icon('refresh', 17), h('span', { text: 'Повторить ошибки (' + session.mistakes.length + ')' })));
      }
      actions.appendChild(h('button', {
        class: 'btn btn--ghost btn--lg',
        onclick: function () {
          var ids = session.deckIds;
          session = null;
          App.router.go('#/test/' + (ids.length === 1 ? ids[0] : 'all'));
        }
      }, h('span', { text: 'Пройти заново' })));
    } else if (remaining.total > 0) {
      actions.appendChild(h('button', {
        class: 'btn btn--primary btn--lg',
        onclick: function () { continueSession(); }
      }, icon('play', 17), h('span', { text: 'Продолжить (' + remaining.total + ')' })));
    }
    actions.appendChild(h('button', {
      class: 'btn btn--ghost btn--lg',
      onclick: function () {
        var ids = session.deckIds;
        session = null;
        App.router.go(ids.length === 1 ? '#/deck/' + ids[0] : '#/decks');
      }
    }, h('span', { text: 'К колоде' })));
    actions.appendChild(h('button', {
      class: 'btn btn--ghost btn--lg',
      onclick: function () { session = null; App.router.go('#/stats'); }
    }, icon('chart', 17), h('span', { text: 'Статистика' })));

    body.push(actions);
    U.append(stage, body);
    updateProgress();
    var label = U.qs('#study-label');
    if (label) label.textContent = 'Итоги';
    var bar = U.qs('#study-progress');
    if (bar) bar.style.width = '100%';
  }

  function resultStat(label, value) {
    return h('div', { class: 'result-stat' }, h('b', { text: value }), h('span', { text: label }));
  }

  function countRemaining() {
    var now = Date.now();
    var ids = session ? session.deckIds : [];
    var cards = S.allCards(ids).filter(function (c) { return !c.suspended; });
    var due = cards.filter(function (c) { return !SRS.isNew(c) && c.srs.due <= now; }).length;
    return { total: due, due: due };
  }

  function continueSession() {
    var ids = session.deckIds;
    var cfg = { mode: session.mode, dir: session.dir, useLimits: true, shuffle: false, limit: 0 };
    var more = buildQueue(ids, { ignoreLimits: false, shuffleMain: false, limit: 0 });
    session.learn = session.learn.concat(more.learn);
    session.main = session.main.concat(more.main);
    session.finished = false;
    renderSession();
  }

  function retryMistakes() {
    var cards = session.mistakes.map(function (m) { return m.card; }).filter(function (c) { return S.getCard(c.id); });
    var ids = session.deckIds;
    var mode = session.mode === 'mixed' ? 'choice' : session.mode;
    session = {
      deckIds: ids, mode: mode, dir: session.dir, applySrs: false, test: true,
      learn: [], main: cards.map(function (c) { return { card: c, kind: 'test', due: 0 }; }),
      initialCounts: { new: 0, learning: 0, due: 0 }, current: null, cardStartTs: 0,
      startedAt: Date.now(), answered: 0, correct: 0, totalPlanned: cards.length,
      history: [], undoStack: [], mistakes: [], finished: false, interstitial: null
    };
    App.router.go('#/test/' + (ids.length === 1 ? ids[0] : 'all') + '/run');
    renderSession();
  }

  function exitSession() {
    if (!session) { App.router.go('#/decks'); return; }
    var answered = session.answered;
    var ids = session.deckIds;
    function leave() {
      session = null;
      SP.stop();
      App.router.go(ids.length === 1 ? '#/deck/' + ids[0] : '#/decks');
    }
    if (!answered) { leave(); return; }
    U.confirmDialog('Выйти из тренировки?', 'Прогресс по отвеченным карточкам уже сохранён.', 'Выйти')
      .then(function (ok) { if (ok) leave(); });
  }

  /** Тихий сброс сессии при переходе на другой экран (без диалогов). */
  function discardSession() {
    if (!session) return;
    if (session._interTimer) clearInterval(session._interTimer);
    SP.stop();
    session = null;
  }

  /* ---------- Клавиатура ---------- */

  function setPrimaryAction(fn) {
    App.router.setPrimary(fn);
  }

  function bindKeyboard() {
    if (App._studyKeysBound) return;
    App._studyKeysBound = true;
    document.addEventListener('keydown', function (e) {
      if (!session || session.finished) return;
      if (!S.settings().keyboardShortcuts) return;
      var tag = (e.target.tagName || '').toLowerCase();
      var typingInField = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === 'Escape') { return; }
      if (typingInField) return;

      if (e.key === ' ' || e.key === 'Enter') {
        if (session.current && !session.current.revealed && session.current.mode !== 'flip') {
          e.preventDefault();
          var primary = U.qs('#study-footer .btn--primary');
          if (primary) primary.click();
          return;
        }
        e.preventDefault();
        var primary2 = U.qs('#study-footer .btn--primary');
        if (primary2) primary2.click();
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        var rates = U.qsa('.rate');
        if (rates.length) { e.preventDefault(); rates[Number(e.key) - 1].click(); return; }
        var choices = U.qsa('.choice');
        if (choices.length && Number(e.key) <= choices.length) { e.preventDefault(); choices[Number(e.key) - 1].click(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'r' && SP.supported() && session.current) {
        var card = session.current.card;
        var dir = session.current.dir;
        var say = typeof SP.speakBest === 'function' ? SP.speakBest : SP.speak;
        say(dir === 'fwd' ? card.word : card.translation,
          dir === 'fwd' ? langForCard(card, 'from') : langForCard(card, 'to'), { rate: S.settings().ttsRate });
      }
    });
  }

  /* ============================================================
     Экран теста
     ============================================================ */

  function renderTest(root, params) {
    bindKeyboard();
    if (params.sub === 'run' && session && session.test) { renderSession(); return; }

    var deckIds = params.id && params.id !== 'all' ? [params.id] : S.get().decks.map(function (d) { return d.id; });
    var deck = params.id && params.id !== 'all' ? S.getDeck(params.id) : null;
    var available = S.allCards(deckIds).filter(function (c) { return c.word && c.translation && !c.suspended; }).length;

    if (!available) {
      U.clear(root);
      root.appendChild(h('div', { class: 'page' },
        V.decks.emptyState('cards', 'Нет слов для теста', 'Добавьте слова в колоду, чтобы пройти тест.',
          h('button', { class: 'btn btn--primary', onclick: function () { App.router.go(deck ? '#/deck/' + deck.id : '#/decks'); } }, h('span', { text: 'К колоде' })))));
      return;
    }

    var cfg = renderTest._cfg || (renderTest._cfg = { mode: 'choice', count: Math.min(20, available), dir: 'fwd' });
    if (cfg.count > available) cfg.count = available;

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go(deck ? '#/deck/' + deck.id : '#/decks'); } }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'Тест' + (deck ? ': ' + deck.name : ' по всем колодам') }),
          h('p', { class: 'page-sub', text: 'Проверка знаний без влияния на интервалы повторения' })
        )
      )
    );

    var modeRow = h('div', { class: 'mode-grid mode-grid--compact' });
    MODES.filter(function (m) { return m.id !== 'flip'; }).forEach(function (m) {
      if (m.id === 'listening' && !SP.supported()) return;
      modeRow.appendChild(h('button', {
        class: 'mode-card' + (cfg.mode === m.id ? ' is-active' : ''),
        onclick: function () {
          cfg.mode = m.id;
          U.qsa('.mode-card', modeRow).forEach(function (c) { c.classList.remove('is-active'); });
          this.classList.add('is-active');
        }
      }, h('span', { class: 'mode-card__icon' }, icon(m.icon, 18)), h('b', { text: m.label })));
    });

    var countInput = h('input', {
      class: 'input', type: 'number', min: 5, max: available, value: cfg.count,
      onchange: function () { cfg.count = Math.max(1, Math.min(available, Number(this.value) || 10)); }
    });

    var dirRow = h('div', { class: 'chips' });
    DIRS.forEach(function (d) {
      dirRow.appendChild(h('button', {
        class: 'chip' + (cfg.dir === d.id ? ' is-active' : ''),
        onclick: function () {
          cfg.dir = d.id;
          U.qsa('.chip', dirRow).forEach(function (c) { c.classList.remove('is-active'); });
          this.classList.add('is-active');
        }
      }, h('span', { text: d.label })));
    });

    var panel = h('div', { class: 'panel panel--wide' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title', text: 'Параметры теста' })),
      modeRow,
      h('div', { class: 'panel__section' }, h('span', { class: 'field__label', text: 'Направление' }), dirRow),
      h('div', { class: 'panel__section panel__section--row' },
        h('label', { class: 'switch-row switch-row--num' }, h('span', { text: 'Количество вопросов' }), countInput),
        h('span', { class: 'muted small', text: 'Доступно слов: ' + available })
      ),
      h('div', { class: 'panel__foot' },
        h('button', {
          class: 'btn btn--primary btn--lg',
          onclick: function () {
            var mode = cfg.mode === 'mixed' ? 'mixed' : cfg.mode;
            startSession(deckIds, { mode: mode, dir: cfg.dir, count: cfg.count, useLimits: false, limit: 0 }, true);
          }
        }, icon('target', 18), h('span', { text: 'Начать тест' }))
      )
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page' }, head, panel)]);
  }

  /* ============================================================
     Публичный API
     ============================================================ */

  V.study = {
    render: function (root, params) { bindKeyboard(); if (params.sub === 'run' && session && !session.test) { renderSession(); return; } renderStudy(root, params); },
    renderTest: renderTest,
    renderSession: renderSession,
    hasSession: function () { return !!session; },
    activeSession: function () { return session; },
    exit: exitSession,
    discard: discardSession,
    MODES: MODES,
    DIRS: DIRS,
    modeMeta: modeMeta
  };
})(window);

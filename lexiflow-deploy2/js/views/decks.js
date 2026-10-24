/* ============================================================
   LexiFlow — views/decks.js
   Экран колод, экран колоды и редактор карточки.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, S = App.store, SRS = App.srs, SP = App.speech;
  var h = U.h, icon = U.icon;

  /* ---------- Общие строительные блоки ---------- */

  function langName(code) {
    if (!code) return '—';
    var base = String(code).split('-')[0].toLowerCase();
    return SP.LANG_NAMES[base] || code.toUpperCase();
  }

  function deckTile(deck, stats, onOpen) {
    var total = stats.total || 0;
    var progress = total ? Math.round((stats.review + stats.learning) / total * 100) : 0;
    var tile = h('article', {
      class: 'deck-tile',
      style: { '--deck-color': deck.color },
      tabindex: '0',
      role: 'button',
      onclick: function (e) {
        if (e.target.closest('.deck-tile__menu, .icon-btn, .btn')) return;
        onOpen(deck.id);
      },
      onkeydown: function (e) { if (e.key === 'Enter') onOpen(deck.id); }
    },
      h('div', { class: 'deck-tile__glow' }),
      h('header', { class: 'deck-tile__head' },
        h('div', { class: 'deck-tile__badge' }, icon('layers', 18)),
        h('div', { class: 'deck-tile__meta' },
          h('h3', { class: 'deck-tile__name', text: deck.name }),
          h('p', { class: 'deck-tile__langs', text: langName(deck.langFrom) + ' → ' + langName(deck.langTo) })
        ),
        deckMenuButton(deck)
      ),
      h('div', { class: 'deck-tile__counts' },
        countPill('due', stats.due, 'к повторению'),
        countPill('new', stats.new, 'новых'),
        countPill('total', total, 'всего')
      ),
      h('div', { class: 'progress' },
        h('div', { class: 'progress__bar', style: { width: progress + '%' } })
      ),
      h('footer', { class: 'deck-tile__foot' },
        h('span', { class: 'muted small', text: progress + '% в работе' }),
        stats.due > 0
          ? h('span', { class: 'deck-tile__cta' }, icon('play', 15), h('span', { text: 'Учить' }))
          : h('span', { class: 'deck-tile__cta deck-tile__cta--ghost' }, icon('play', 15), h('span', { text: 'Учить' }))
      )
    );
    return tile;
  }

  function countPill(kind, value, label) {
    return h('div', { class: 'count-pill count-pill--' + kind },
      h('b', { text: String(value) }),
      h('span', { text: label })
    );
  }

  function deckMenuButton(deck) {
    return h('button', {
      class: 'icon-btn deck-tile__menu',
      title: 'Действия',
      'aria-label': 'Действия с колодой',
      onclick: function (e) { e.stopPropagation(); deckMenu(deck); }
    }, icon('settings', 17));
  }

  function deckMenu(deck) {
    var body = h('div', { class: 'menu-list' });
    var items = [
      { icon: 'edit', label: 'Изменить колоду', fn: function () { App.views.decks.openDeckDialog(deck); } },
      { icon: 'play', label: 'Начать тренировку', fn: function () { App.router.go('#/study/' + deck.id); } },
      { icon: 'target', label: 'Пройти тест', fn: function () { App.router.go('#/test/' + deck.id); } },
      { icon: 'plus', label: 'Добавить слово', fn: function () { App.views.decks.openCardEditor(null, deck.id); } },
      { icon: 'copy', label: 'Дублировать', fn: function () { S.duplicateDeck(deck.id); U.toast('Колода скопирована', 'ok'); App.router.refresh(); } },
      { icon: 'refresh', label: 'Сбросить прогресс', fn: function () {
          U.confirmDialog('Сбросить прогресс?', 'Все карточки колоды «' + deck.name + '» снова станут новыми. Слова останутся на месте.', 'Сбросить')
            .then(function (ok) { if (ok) { S.resetDeckProgress(deck.id); U.toast('Прогресс сброшен', 'ok'); App.router.refresh(); } });
        } },
      { icon: 'download', label: 'Экспорт колоды (JSON)', fn: function () {
          U.download(safeName(deck.name) + '.json', S.exportDeck(deck.id, true), 'application/json');
        } },
      { icon: 'trash', label: 'Удалить колоду', danger: true, fn: function () {
          U.confirmDialog('Удалить колоду?', 'Колода «' + deck.name + '» и все её карточки будут удалены безвозвратно.', 'Удалить')
            .then(function (ok) { if (ok) { S.deleteDeck(deck.id); U.toast('Колода удалена', 'ok'); App.router.refresh(); } });
        } }
    ];
    items.forEach(function (it) {
      body.appendChild(h('button', {
        class: 'menu-item' + (it.danger ? ' menu-item--danger' : ''),
        onclick: function () { modal.close(); it.fn(); }
      }, icon(it.icon, 18), h('span', { text: it.label })));
    });
    var modal = U.modal({ title: deck.name, body: body, sheet: false });
  }

  function safeName(s) {
    return String(s || 'deck').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'deck';
  }

  function emptyState(iconName, title, text, action) {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty__icon' }, icon(iconName, 30)),
      h('h3', { class: 'empty__title', text: title }),
      h('p', { class: 'empty__text', text: text }),
      action || null
    );
  }

  /* ============================================================
     Экран «Колоды»
     ============================================================ */

  function renderDecks(root) {
    var data = S.get();
    var now = Date.now();
    var deckList = data.decks.filter(function (d) { return !d.archived; });

    var query = renderDecks._query || '';
    var filtered = deckList.filter(function (d) {
      if (!query) return true;
      return (d.name + ' ' + d.description).toLowerCase().indexOf(query.toLowerCase()) >= 0;
    });

    var totals = { due: 0, new: 0, total: 0, learning: 0 };
    deckList.forEach(function (d) {
      var st = S.deckStats(d.id, now);
      totals.due += st.due; totals.new += st.new; totals.total += st.total; totals.learning += st.learning;
    });
    var doneToday = S.reviewsToday(null, now);
    var goal = data.settings.dailyGoal || 30;
    var goalPct = Math.min(100, Math.round(doneToday / goal * 100));
    /* Стрик как в Duolingo: день засчитывается только при достаточном числе
       ответов (streakGoal, по умолчанию 10), а не за один ответ. Рекорд и
       «сегодня добрано» считаются там же — из синхронизируемого журнала. */
    var streakSt = App.streak
      ? App.streak.computeStreak(data.logs, now, data.settings.streakGoal)
      : { current: S.streak(now), best: S.streak(now), todayCount: doneToday, doneToday: doneToday >= 10 };
    var series = streakSt.current;
    var streakGoal = data.settings.streakGoal || (App.streak ? App.streak.DEFAULT_GOAL : 10);

    var searchInput = h('input', {
      class: 'input input--search',
      type: 'search',
      placeholder: 'Поиск по колодам…',
      value: query,
      oninput: function () {
        renderDecks._query = this.value;
        var list = U.qs('#deck-list');
        if (list) renderDeckList(list, deckList, this.value, now);
      }
    });

    var header = h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Мои колоды' }),
        h('p', { class: 'page-sub', text: deckList.length + ' ' + U.plural(deckList.length, 'колода', 'колоды', 'колод') + ' · ' + totals.total + ' ' + U.plural(totals.total, 'слово', 'слова', 'слов') })
      ),
      h('div', { class: 'page-head__actions' },
        h('div', { class: 'search-wrap' }, icon('search', 16), searchInput),
        h('button', { class: 'btn btn--primary', onclick: function () { App.views.decks.openDeckDialog(null); } },
          icon('plus', 17), h('span', { text: 'Новая колода' }))
      )
    );

    var overview = h('div', { class: 'overview' },
      h('div', { class: 'ov-card ov-card--accent' },
        h('div', { class: 'ov-card__top' }, icon('clock', 18), h('span', { text: 'К повторению' })),
        h('b', { class: 'ov-card__value', text: String(totals.due) }),
        h('span', { class: 'ov-card__hint', text: totals.learning ? 'включая ' + totals.learning + ' в обучении' : 'на сегодня' })
      ),
      h('div', { class: 'ov-card' },
        h('div', { class: 'ov-card__top' }, icon('sparkle', 18), h('span', { text: 'Новые слова' })),
        h('b', { class: 'ov-card__value', text: String(totals.new) }),
        h('span', { class: 'ov-card__hint', text: 'ещё не изучены' })
      ),
      h('div', { class: 'ov-card' },
        h('div', { class: 'ov-card__top' }, icon('flame', 18), h('span', { text: 'Серия дней' })),
        h('b', { class: 'ov-card__value', text: String(series) }),
        h('span', { class: 'ov-card__hint', text: series ? 'рекорд: ' + streakSt.best + ' · ' + (streakSt.doneToday ? 'сегодня добрано!' : 'сегодня: ' + streakSt.todayCount + '/' + streakGoal) : 'начните сегодня' })
      ),
      h('div', { class: 'ov-card' },
        h('div', { class: 'ov-card__top' }, icon('target', 18), h('span', { text: 'Цель дня' })),
        h('b', { class: 'ov-card__value', text: doneToday + '/' + goal }),
        h('div', { class: 'progress progress--sm' }, h('div', { class: 'progress__bar', style: { width: goalPct + '%' } }))
      )
    );

    var list = h('div', { class: 'deck-grid', id: 'deck-list' });
    renderDeckList(list, deckList, query, now);

    U.clear(root);
    U.append(root, [
      h('div', { class: 'page' }, header, overview, list)
    ]);
  }

  function renderDeckList(container, decks, query, now) {
    U.clear(container);
    var filtered = decks.filter(function (d) {
      if (!query) return true;
      return (d.name + ' ' + d.description).toLowerCase().indexOf(query.toLowerCase()) >= 0;
    });
    if (!decks.length) {
      container.appendChild(emptyState('layers', 'Пока нет ни одной колоды',
        'Создайте первую колоду — например «Английский: базовый» — и добавьте в неё слова.',
        h('button', { class: 'btn btn--primary', onclick: function () { App.views.decks.openDeckDialog(null); } },
          icon('plus', 17), h('span', { text: 'Создать колоду' }))
      ));
      return;
    }
    if (!filtered.length) {
      container.appendChild(emptyState('search', 'Ничего не найдено', 'Попробуйте изменить поисковый запрос.'));
      return;
    }
    filtered.forEach(function (deck) {
      container.appendChild(deckTile(deck, S.deckStats(deck.id, now), function (id) { App.router.go('#/deck/' + id); }));
    });
  }

  /* ============================================================
     Диалог создания / редактирования колоды
     ============================================================ */

  function openDeckDialog(deck) {
    var isNew = !deck;
    deck = deck || { name: '', description: '', langFrom: 'en', langTo: 'ru', color: S.COLORS[0], settings: SRS.DEFAULT_SETTINGS };

    var nameInput = h('input', { class: 'input', placeholder: 'Например: Английский: базовый', value: deck.name, maxlength: 60 });
    var descInput = h('input', { class: 'input', placeholder: 'Короткое описание (необязательно)', value: deck.description || '' });
    var fromSel = langSelect(deck.langFrom);
    var toSel = langSelect(deck.langTo);
    var colorRow = h('div', { class: 'color-row' });
    var chosen = { color: deck.color || S.COLORS[0] };
    S.COLORS.forEach(function (c) {
      var b = h('button', {
        type: 'button',
        class: 'color-dot' + (c === chosen.color ? ' is-active' : ''),
        style: { background: c },
        'aria-label': 'Цвет ' + c,
        onclick: function () {
          chosen.color = c;
          U.qsa('.color-dot', colorRow).forEach(function (x) { x.classList.remove('is-active'); });
          b.classList.add('is-active');
        }
      });
      colorRow.appendChild(b);
    });

    var body = h('div', { class: 'form' },
      field('Название колоды', nameInput),
      field('Описание', descInput),
      h('div', { class: 'form__row' },
        field('Изучаемый язык', fromSel),
        field('Язык перевода', toSel)
      ),
      field('Цвет', colorRow)
    );

    U.modal({
      title: isNew ? 'Новая колода' : 'Настройки колоды',
      body: body,
      actions: [
        { label: 'Отмена', variant: 'ghost' },
        {
          label: isNew ? 'Создать' : 'Сохранить', variant: 'primary', keepOpen: false,
          onClick: function () {
            var name = nameInput.value.trim();
            if (!name) { U.toast('Введите название колоды', 'err'); nameInput.focus(); return false; }
            var payload = {
              name: name,
              description: descInput.value.trim(),
              langFrom: fromSel.value,
              langTo: toSel.value,
              color: chosen.color
            };
            if (isNew) {
              var created = S.createDeck(payload);
              U.toast('Колода создана', 'ok');
              App.router.go('#/deck/' + created.id);
            } else {
              S.updateDeck(deck.id, payload);
              U.toast('Сохранено', 'ok');
              App.router.refresh();
            }
          }
        }
      ]
    });
  }

  function langSelect(value) {
    var sel = h('select', { class: 'input' });
    var codes = Object.keys(SP.LANG_NAMES).sort(function (a, b) {
      return SP.LANG_NAMES[a].localeCompare(SP.LANG_NAMES[b], 'ru');
    });
    codes.forEach(function (c) {
      sel.appendChild(h('option', { value: c, text: SP.LANG_NAMES[c] + ' (' + c + ')', selected: c === value }));
    });
    if (value && codes.indexOf(value) < 0) sel.appendChild(h('option', { value: value, text: value, selected: true }));
    return sel;
  }

  function field(label, control, hint) {
    return h('label', { class: 'field' },
      h('span', { class: 'field__label', text: label }),
      control,
      hint ? h('span', { class: 'field__hint', text: hint }) : null
    );
  }

  /* ============================================================
     Экран колоды
     ============================================================ */

  function renderDeck(root, params) {
    var deck = S.getDeck(params.id);
    if (!deck) {
      U.clear(root);
      root.appendChild(h('div', { class: 'page' }, emptyState('warning', 'Колода не найдена', 'Возможно, она была удалена.',
        h('button', { class: 'btn btn--primary', onclick: function () { App.router.go('#/decks'); } }, h('span', { text: 'К списку колод' })))));
      return;
    }
    var now = Date.now();
    var stats = S.deckStats(deck.id, now);
    var filter = renderDeck._filter || 'all';
    var query = renderDeck._query || '';

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go('#/decks'); } }, icon('back', 20)),
        h('div', { style: { '--deck-color': deck.color } },
          h('h1', { class: 'page-title' },
            h('span', { class: 'dot', style: { background: deck.color } }),
            h('span', { text: deck.name })
          ),
          h('p', { class: 'page-sub', text: langName(deck.langFrom) + ' → ' + langName(deck.langTo) + (deck.description ? ' · ' + deck.description : '') })
        )
      ),
      h('div', { class: 'page-head__actions' },
        h('button', { class: 'btn btn--ghost', onclick: function () { openDeckDialog(deck); } }, icon('edit', 16), h('span', { text: 'Настроить' })),
        h('button', { class: 'btn btn--ghost', onclick: function () { openDeckSettings(deck); } }, icon('clock', 16), h('span', { text: 'Интервалы' })),
        h('button', { class: 'btn btn--primary', onclick: function () { App.router.go('#/study/' + deck.id); } }, icon('play', 16), h('span', { text: 'Учить' }))
      )
    );

    var actions = h('div', { class: 'action-bar' },
      actionCard('sparkle', 'Добавить слово', 'Слово, перевод, транскрипция, примеры', function () { openCardEditor(null, deck.id); }),
      actionCard('target', 'Тест', 'Выбор варианта, ввод, аудирование', function () { App.router.go('#/test/' + deck.id); }),
      actionCard('list', 'Список слов', 'Поиск, правка, массовые операции', function () { App.router.go('#/browse/' + deck.id); }),
      actionCard('chart', 'Прогресс', 'Статистика по этой колоде', function () { App.router.go('#/stats/' + deck.id); })
    );

    var statsRow = h('div', { class: 'stat-row' },
      statChip('К повторению', stats.due, 'due'),
      statChip('Новые', stats.new, 'new'),
      statChip('В обучении', stats.learning, 'learning'),
      statChip('Повторение', stats.review, 'review'),
      statChip('Всего', stats.total, 'total')
    );

    var body = h('div', { class: 'page' },
      head,
      statsRow,
      actions,
      h('section', { class: 'panel' },
        h('div', { class: 'panel__head' },
          h('h2', { class: 'panel__title', text: 'Слова в колоде' }),
          h('div', { class: 'panel__tools' },
            h('div', { class: 'search-wrap search-wrap--sm' }, icon('search', 15),
              h('input', {
                class: 'input input--search', type: 'search', placeholder: 'Поиск слова…', value: query,
                oninput: function () {
                  renderDeck._query = this.value;
                  renderWordList(U.qs('#word-list'), deck, this.value, renderDeck._filter || 'all', now);
                }
              })
            ),
            h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { openBulkImport(deck); } }, icon('upload', 15), h('span', { text: 'Импорт' }))
          )
        ),
        filterChips(deck, function (f) {
          renderDeck._filter = f;
          renderWordList(U.qs('#word-list'), deck, renderDeck._query || '', f, now);
        }),
        h('div', { class: 'word-list', id: 'word-list' })
      )
    );

    U.clear(root);
    root.appendChild(body);
    renderWordList(U.qs('#word-list'), deck, query, filter, now);
  }

  function statChip(label, value, kind) {
    return h('div', { class: 'stat-chip stat-chip--' + kind },
      h('b', { text: String(value) }),
      h('span', { text: label })
    );
  }

  function actionCard(iconName, title, text, onclick) {
    return h('button', { class: 'action-card', onclick: onclick },
      h('span', { class: 'action-card__icon' }, icon(iconName, 19)),
      h('span', { class: 'action-card__body' },
        h('b', { text: title }),
        h('small', { text: text })
      ),
      icon('chevron', 16)
    );
  }

  function filterChips(deck, onPick) {
    var current = renderDeck._filter || 'all';
    var defs = [
      { id: 'all', label: 'Все' },
      { id: 'due', label: 'К повторению' },
      { id: 'new', label: 'Новые' },
      { id: 'learning', label: 'В обучении' },
      { id: 'review', label: 'Повторение' },
      { id: 'leech', label: 'Трудные' }
    ];
    var row = h('div', { class: 'chips' });
    defs.forEach(function (d) {
      row.appendChild(h('button', {
        class: 'chip' + (current === d.id ? ' is-active' : ''),
        onclick: function () {
          U.qsa('.chip', row).forEach(function (c) { c.classList.remove('is-active'); });
          this.classList.add('is-active');
          onPick(d.id);
        }
      }, h('span', { text: d.label })));
    });
    return row;
  }

  function cardMatches(card, filter, now) {
    var dayEnd = U.startOfDay(now) + U.MS_DAY;
    switch (filter) {
      case 'due': return card.srs && card.srs.due < dayEnd && !card.suspended;
      case 'new': return SRS.isNew(card);
      case 'learning': return SRS.isLearning(card);
      case 'review': return SRS.isReview(card);
      case 'leech': return !!(card.srs && card.srs.leech);
      default: return true;
    }
  }

  function renderWordList(container, deck, query, filter, now) {
    if (!container) return;
    U.clear(container);
    var cards = S.cardsOf(deck.id);
    var q = (query || '').trim().toLowerCase();
    var list = cards.filter(function (c) {
      if (!cardMatches(c, filter, now)) return false;
      if (!q) return true;
      return (c.word + ' ' + c.translation + ' ' + c.transcription + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    list.sort(function (a, b) { return (a.srs && a.srs.due || 0) - (b.srs && b.srs.due || 0); });

    if (!cards.length) {
      container.appendChild(emptyState('cards', 'В колоде пока нет слов',
        'Добавьте первое слово вручную или импортируйте список из файла.',
        h('div', { class: 'row-gap' },
          h('button', { class: 'btn btn--primary', onclick: function () { openCardEditor(null, deck.id); } }, icon('plus', 16), h('span', { text: 'Добавить слово' })),
          h('button', { class: 'btn btn--ghost', onclick: function () { openBulkImport(deck); } }, icon('upload', 16), h('span', { text: 'Импорт списка' })),
          h('button', { class: 'btn btn--ghost', onclick: function () { App.router.go('#/ai'); } }, icon('sparkle', 16), h('span', { text: 'Слова от нейросети' }))
        )));
      return;
    }
    if (!list.length) {
      container.appendChild(emptyState('search', 'Ничего не найдено', 'Измените запрос или выберите другой фильтр.'));
      return;
    }

    list.forEach(function (card) {
      container.appendChild(wordRow(card, deck, now));
    });
  }

  function wordRow(card, deck, now) {
    var stateKind = SRS.isNew(card) ? 'new' : SRS.isLearning(card) ? 'learning' : 'review';
    var wordSpan = h('span', { class: 'word-row__word', text: card.word });
    var row = h('div', { class: 'word-row' },
      h('div', { class: 'word-row__main' },
        h('div', { class: 'word-row__top' },
          wordSpan,
          card.transcription ? h('span', { class: 'word-row__ipa', text: '[' + card.transcription.replace(/^\[|\]$/g, '') + ']' }) : null,
          SP.supported() ? SP.audioButton(card.word, deck.langFrom, { small: true, target: wordSpan }) : null,
          card.suspended ? h('span', { class: 'tag tag--muted', text: 'на паузе' }) : null,
          card.srs && card.srs.leech ? h('span', { class: 'tag tag--warn', text: 'трудное' }) : null
        ),
        h('div', { class: 'word-row__trans', text: card.translation }),
        card.examples && card.examples.length
          ? h('div', { class: 'word-row__example' },
              h('span', { text: card.examples[0].text ? '«' + card.examples[0].text + '»' : card.examples[0].translation }),
              card.examples[0].text && card.examples[0].translation
                ? h('span', { class: 'word-row__example-trans', text: ' — ' + card.examples[0].translation })
                : null,
              card.examples.length > 1
                ? h('span', { class: 'word-row__example-more', text: ' +' + (card.examples.length - 1) })
                : null
            )
          : null
      ),
      h('div', { class: 'word-row__side' },
        h('span', { class: 'tag tag--' + stateKind, text: SRS.stateLabel(card) }),
        h('span', { class: 'word-row__due', text: card.srs ? U.fmtRelative(card.srs.due, now) : '' })
      ),
      h('div', { class: 'word-row__actions' },
        h('button', { class: 'icon-btn', title: 'Редактировать', onclick: function () { openCardEditor(card, deck.id); } }, icon('edit', 16)),
        h('button', {
          class: 'icon-btn', title: card.suspended ? 'Возобновить' : 'Поставить на паузу',
          onclick: function () {
            S.updateCard(card.id, { suspended: !card.suspended });
            App.router.refresh();
          }
        }, icon(card.suspended ? 'play' : 'pause', 16)),
        h('button', {
          class: 'icon-btn icon-btn--danger', title: 'Удалить',
          onclick: function () {
            U.confirmDialog('Удалить слово?', '«' + card.word + '» будет удалено из колоды.', 'Удалить')
              .then(function (ok) { if (ok) { S.deleteCard(card.id); U.toast('Удалено', 'ok'); App.router.refresh(); } });
          }
        }, icon('trash', 16))
      )
    );
    return row;
  }

  /* ============================================================
     Редактор карточки
     ============================================================ */

  function openCardEditor(card, deckId) {
    var isNew = !card;
    var data = S.get();
    var decks = data.decks;
    if (!decks.length) {
      U.toast('Сначала создайте колоду', 'err');
      openDeckDialog(null);
      return;
    }
    var draft = card ? JSON.parse(JSON.stringify(card)) : {
      deckId: deckId || decks[0].id, word: '', translation: '', transcription: '',
      examples: [], notes: '', tags: [], audioUrl: '', suspended: false
    };
    var deck = S.getDeck(draft.deckId) || decks[0];

    var deckSel = h('select', { class: 'input' });
    decks.forEach(function (d) {
      deckSel.appendChild(h('option', { value: d.id, text: d.name, selected: d.id === draft.deckId }));
    });
    deckSel.addEventListener('change', function () {
      deck = S.getDeck(deckSel.value);
      updatePreview();
    });

    var wordInput = h('input', { class: 'input input--lg', placeholder: 'Слово или фраза', value: draft.word, maxlength: 120 });
    var transInput = h('input', { class: 'input input--lg', placeholder: 'Перевод', value: draft.translation, maxlength: 200 });
    var ipaInput = h('input', { class: 'input', placeholder: 'например: ɔːlˈðəʊ', value: draft.transcription, maxlength: 120 });
    var tagsInput = h('input', { class: 'input', placeholder: 'теги через пробел', value: (draft.tags || []).join(' ') });
    var notesInput = h('textarea', { class: 'input input--area', placeholder: 'Заметка к слову (необязательно)', rows: 2 }, draft.notes || '');
    var suspendedInput = h('input', { type: 'checkbox', checked: !!draft.suspended });

    var examplesWrap = h('div', { class: 'examples' });
    var examples = (draft.examples && draft.examples.length) ? draft.examples.slice() : [];

    function renderExamples() {
      U.clear(examplesWrap);
      if (!examples.length) {
        examplesWrap.appendChild(h('p', { class: 'muted small', text: 'Примеры употребления помогают запоминать слова в контексте.' }));
      }
      examples.forEach(function (ex, idx) {
        var textIn = h('input', { class: 'input', placeholder: 'Пример: Although it was late, we kept working.', value: ex.text || '' });
        var transIn = h('input', { class: 'input', placeholder: 'Перевод примера', value: ex.translation || '' });
        textIn.addEventListener('input', function () { examples[idx].text = textIn.value; });
        transIn.addEventListener('input', function () { examples[idx].translation = transIn.value; });
        examplesWrap.appendChild(h('div', { class: 'example-row' },
          h('div', { class: 'example-row__fields' }, textIn, transIn),
          h('button', {
            class: 'icon-btn icon-btn--danger', title: 'Удалить пример', type: 'button',
            onclick: function () { examples.splice(idx, 1); renderExamples(); }
          }, icon('trash', 16))
        ));
      });
      examplesWrap.appendChild(h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: function () { examples.push({ text: '', translation: '' }); renderExamples(); }
      }, icon('plus', 15), h('span', { text: 'Добавить пример' })));
    }
    renderExamples();

    // Озвучивание слова
    var speakRow = h('div', { class: 'inline-row' });
    function updatePreview() {
      U.clear(speakRow);
      if (SP.supported()) {
        speakRow.appendChild(h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onclick: function () {
            var t = wordInput.value.trim();
            if (!t) { U.toast('Введите слово', 'warn'); return; }
            /* Как везде: сначала готовый файл, потом системный голос. Иначе
               предпросмотр в редакторе говорит роботом, а та же фраза в
               тренировке — нормальным голосом. */
            var say = typeof SP.speakBest === 'function' ? SP.speakBest : SP.speak;
            say(t, deck.langFrom, { rate: S.settings().ttsRate });
          }
        }, icon('sound', 15), h('span', { text: 'Прослушать (' + langName(deck.langFrom) + ')' })));
      }
      if (isNew) {
        speakRow.appendChild(h('span', { class: 'muted small', text: 'Карточка начнёт обучение сразу после добавления.' }));
      } else {
        speakRow.appendChild(h('span', { class: 'muted small',
          text: 'Состояние: ' + SRS.stateLabel(draft) + ' · следующее повторение ' + U.fmtRelative(draft.srs.due) }));
      }
    }
    updatePreview();

    function collect() {
      return {
        deckId: deckSel.value,
        word: wordInput.value.trim(),
        translation: transInput.value.trim(),
        transcription: ipaInput.value.trim(),
        tags: tagsInput.value.split(/[\s,]+/).filter(Boolean),
        notes: notesInput.value.trim(),
        suspended: suspendedInput.checked,
        examples: examples.filter(function (e) { return (e.text || '').trim() || (e.translation || '').trim(); })
          .map(function (e) { return { text: (e.text || '').trim(), translation: (e.translation || '').trim() }; })
      };
    }

    function save(andAnother) {
      var payload = collect();
      if (!payload.word) { U.toast('Введите слово', 'err'); wordInput.focus(); return false; }
      if (!payload.translation) { U.toast('Введите перевод', 'err'); transInput.focus(); return false; }
      if (isNew) {
        S.createCard(payload);
        U.toast('Слово добавлено', 'ok');
        if (andAnother) {
          wordInput.value = ''; transInput.value = ''; ipaInput.value = '';
          examples = []; renderExamples();
          App.router.refresh();
          wordInput.focus();
          return false; // не закрываем окно
        }
      } else {
        S.updateCard(card.id, payload);
        U.toast('Изменения сохранены', 'ok');
      }
      App.router.refresh();
      return true;
    }

    var body = h('div', { class: 'form' },
      field('Колода', deckSel),
      field('Слово', h('div', { class: 'inline-row' }, wordInput)),
      field('Перевод', transInput),
      field('Транскрипция', ipaInput, 'Можно вставить в квадратных скобках — они уберутся автоматически.'),
      h('div', { class: 'form__block' },
        h('span', { class: 'field__label', text: 'Примеры употребления' }),
        examplesWrap
      ),
      h('div', { class: 'form__row' },
        field('Теги', tagsInput),
        field('На паузе', h('label', { class: 'switch' }, suspendedInput, h('span', { class: 'switch__track' })))
      ),
      field('Заметка', notesInput),
      speakRow
    );

    U.modal({
      title: isNew ? 'Новое слово' : 'Редактирование слова',
      body: body,
      actions: isNew
        ? [
            { label: 'Отмена', variant: 'ghost' },
            { label: 'Сохранить и ещё', variant: 'ghost', onClick: function () { return save(true); } },
            { label: 'Добавить', variant: 'primary', onClick: function () { return save(false); } }
          ]
        : [
            { label: 'Отмена', variant: 'ghost' },
            { label: 'Сохранить', variant: 'primary', onClick: function () { return save(false); } }
          ]
    });
  }

  /* ============================================================
     Настройки интервалов колоды
     ============================================================ */

  function openDeckSettings(deck) {
    var s = SRS.sanitizeSettings(deck.settings);
    function num(key, label, hint, min, max, step) {
      var input = h('input', {
        class: 'input', type: 'number', value: s[key], min: min, max: max, step: step || 1
      });
      return { key: key, input: input, node: field(label, input, hint) };
    }
    function steps(key, label, hint) {
      var input = h('input', { class: 'input', value: s[key].join(', ') });
      return { key: key, input: input, node: field(label, input, hint) };
    }

    var items = [
      steps('learningSteps', 'Шаги обучения (минуты)', 'Например: 1, 10 — через 1 и 10 минут после первого показа.'),
      steps('relearningSteps', 'Шаги после забывания', 'Куда возвращается карточка, если вы её забыли.'),
      num('graduatingInterval', 'Интервал выпуска (дней)', 'Первый интервал после успешного обучения.', 1, 365),
      num('easyInterval', 'Интервал для «Легко» (дней)', 'Если ответ легко дался на этапе обучения.', 1, 365),
      num('newPerDay', 'Новых карточек в день', 'Сколько новых слов показывать ежедневно.', 0, 500),
      num('maxReviewsPerDay', 'Повторений в день (максимум)', 'Ограничение нагрузки на день.', 0, 2000),
      num('startingEase', 'Стартовый ease-фактор', '2.5 — стандарт. Влияет на рост интервалов.', 1.3, 4, 0.05),
      num('easyBonus', 'Бонус за «Легко»', 'Множитель интервала при ответе «Легко».', 1, 3, 0.05),
      num('hardInterval', 'Множитель «Трудно»', 'Во сколько раз растёт интервал при «Трудно».', 1, 2, 0.05),
      num('intervalModifier', 'Модификатор интервала', '0.8 — учить интенсивнее, 1.2 — мягче.', 0.1, 3, 0.05),
      num('lapseMultiplier', 'Остаток интервала при забывании', '0 — сброс в обучение, 0.5 — половина интервала.', 0, 1, 0.05),
      num('minInterval', 'Минимальный интервал (дней)', '', 1, 30),
      num('maxInterval', 'Максимальный интервал (дней)', '1095 дней ≈ 3 года.', 1, 36500),
      num('leechThreshold', 'Порог «трудной» карточки', 'После скольких провалов помечать карточку.', 1, 50)
    ];

    var body = h('div', { class: 'form form--grid' },
      h('p', { class: 'muted small', text: 'Эти параметры влияют только на колоду «' + deck.name + '».' }),
      items.map(function (i) { return i.node; })
    );

    U.modal({
      title: 'Интервалы повторения',
      body: body,
      actions: [
        { label: 'Сбросить', variant: 'ghost', keepOpen: true, onClick: function () {
            SRS.DEFAULT_SETTINGS && items.forEach(function (i) {
              var v = SRS.DEFAULT_SETTINGS[i.key];
              i.input.value = Array.isArray(v) ? v.join(', ') : v;
            });
            return false;
          } },
        { label: 'Отмена', variant: 'ghost' },
        { label: 'Сохранить', variant: 'primary', onClick: function () {
            var patch = {};
            items.forEach(function (i) {
              if (Array.isArray(s[i.key])) {
                patch[i.key] = i.input.value.split(/[,\s]+/).map(Number).filter(function (n) { return n > 0; });
              } else {
                patch[i.key] = Number(i.input.value);
              }
            });
            S.updateDeck(deck.id, { settings: patch });
            U.toast('Интервалы обновлены', 'ok');
            App.router.refresh();
          } }
      ]
    });
  }

  /* ============================================================
     Быстрый импорт в колоду
     ============================================================ */

  function openBulkImport(deck) {
    var area = h('textarea', {
      class: 'input input--area input--mono', rows: 8,
      placeholder: 'each line:\nalthough - хотя\nimprove - улучшать\neffort, усилие\n\nили вставьте CSV с колонками: слово, перевод, транскрипция'
    });
    var body = h('div', { class: 'form' },
      h('p', { class: 'muted small', text: 'Каждая строка — одно слово. Разделитель: «-», «=», «:», табуляция или запятая.' }),
      h('p', { class: 'muted small', text: 'Колонки с заголовком понимаются автоматически: слово, перевод, транскрипция, пример, перевод примера (в том числе «Пример 2», «Перевод примера 2»…). Несколько примеров в одной ячейке разделяйте «||».' }),
      area,
      h('p', { class: 'muted small', text: 'Файл можно выбрать ниже (CSV, TSV или JSON).' }),
      filePicker(function (text, name) { area.value = text; U.toast('Файл «' + name + '» загружен', 'ok'); })
    );
    U.modal({
      title: 'Импорт слов в «' + deck.name + '»',
      body: body,
      actions: [
        { label: 'Отмена', variant: 'ghost' },
        { label: 'Импортировать', variant: 'primary', onClick: function () {
            var text = area.value.trim();
            if (!text) { U.toast('Вставьте список слов', 'err'); return false; }
            var res = S.importText(text, { deckId: deck.id });
            if (res.error) { U.toast(res.error, 'err'); return false; }
            U.toast('Добавлено: ' + res.added + (res.skipped ? ', пропущено дублей: ' + res.skipped : ''), 'ok', 3600);
            App.router.refresh();
          } }
      ]
    });
  }

  function filePicker(onText) {
    var input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.json', class: 'hidden' });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { onText(String(reader.result || ''), f.name); };
      reader.readAsText(f);
      input.value = '';
    });
    var label = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () { input.click(); } },
      icon('upload', 15), h('span', { text: 'Выбрать файл' }));
    return h('div', { class: 'inline-row' }, label, input);
  }

  App.views = App.views || {};
  App.views.decks = {
    render: renderDecks,
    renderDeck: renderDeck,
    openDeckDialog: openDeckDialog,
    openDeckSettings: openDeckSettings,
    openCardEditor: openCardEditor,
    openBulkImport: openBulkImport,
    renderWordList: renderWordList,
    openBulkImportForDeck: openBulkImport,
    deckTile: deckTile,
    emptyState: emptyState,
    field: field,
    langName: langName,
    langSelect: langSelect,
    actionCard: actionCard,
    safeName: safeName,
    filePicker: filePicker
  };
})(window);

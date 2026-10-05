/* ============================================================
   LexiFlow — views/browse.js
   Просмотр и массовая работа со словами: поиск, фильтры,
   сортировка, выбор, перенос в другую колоду, экспорт.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, S = App.store, SRS = App.srs, SP = App.speech;
  var h = U.h, icon = U.icon;
  var V = (App.views = App.views || {});

  var PAGE = 60;

  var state = {
    query: '', deckId: 'all', status: 'all', sort: 'due',
    selected: {}, page: 1
  };

  function renderBrowse(root, params) {
    if (params && params.id && params.id !== 'all') state.deckId = params.id;
    var now = Date.now();
    var data = S.get();
    if (!data.decks.length) {
      U.clear(root);
      root.appendChild(h('div', { class: 'page' },
        V.decks.emptyState('cards', 'Слов пока нет', 'Создайте колоду и добавьте в неё слова.',
          h('button', { class: 'btn btn--primary', onclick: function () { App.router.go('#/decks'); } }, h('span', { text: 'К колодам' })))));
      return;
    }

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go('#/decks'); } }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'Словарь' }),
          h('p', { class: 'page-sub', id: 'browse-count', text: '' })
        )
      ),
      h('div', { class: 'page-head__actions' },
        h('button', { class: 'btn btn--ghost', onclick: exportSelection }, icon('download', 16), h('span', { text: 'Экспорт CSV' })),
        h('button', { class: 'btn btn--primary', onclick: function () { V.decks.openCardEditor(null, state.deckId !== 'all' ? state.deckId : data.decks[0].id); } },
          icon('plus', 16), h('span', { text: 'Добавить' }))
      )
    );

    var deckSel = h('select', { class: 'input', onchange: function () { state.deckId = this.value; state.page = 1; state.selected = {}; refresh(); } });
    deckSel.appendChild(h('option', { value: 'all', text: 'Все колоды', selected: state.deckId === 'all' }));
    data.decks.forEach(function (d) {
      deckSel.appendChild(h('option', { value: d.id, text: d.name, selected: state.deckId === d.id }));
    });

    var statusSel = h('select', { class: 'input', onchange: function () { state.status = this.value; state.page = 1; refresh(); } });
    [['all', 'Любое состояние'], ['new', 'Новые'], ['learning', 'В обучении'], ['review', 'На повторении'], ['due', 'К повторению'], ['leech', 'Трудные'], ['suspended', 'На паузе']]
      .forEach(function (o) { statusSel.appendChild(h('option', { value: o[0], text: o[1], selected: state.status === o[0] })); });

    var sortSel = h('select', { class: 'input', onchange: function () { state.sort = this.value; state.page = 1; refresh(); } });
    [['due', 'По сроку повторения'], ['added', 'По дате добавления'], ['alpha', 'По алфавиту'], ['interval', 'По интервалу'], ['lapses', 'По числу провалов']]
      .forEach(function (o) { sortSel.appendChild(h('option', { value: o[0], text: o[1], selected: state.sort === o[0] })); });

    var search = h('input', {
      class: 'input input--search', type: 'search', placeholder: 'Слово, перевод или тег…', value: state.query,
      oninput: function () { state.query = this.value; state.page = 1; refresh(); }
    });

    var toolbar = h('div', { class: 'browse-toolbar' },
      h('div', { class: 'search-wrap search-wrap--grow' }, icon('search', 16), search),
      deckSel, statusSel, sortSel
    );

    var bulkBar = h('div', { class: 'bulk-bar', id: 'bulk-bar' });
    var list = h('div', { class: 'browse-list', id: 'browse-list' });

    U.clear(root);
    U.append(root, [h('div', { class: 'page' }, head, toolbar, bulkBar, list)]);
    refresh();

    function refresh() { renderList(); }
  }

  function filtered() {
    var now = Date.now();
    var q = state.query.trim().toLowerCase();
    var cards = state.deckId === 'all' ? S.get().cards.slice() : S.cardsOf(state.deckId);
    var dayEnd = U.startOfDay(now) + U.MS_DAY;

    cards = cards.filter(function (c) {
      switch (state.status) {
        case 'new': if (!SRS.isNew(c)) return false; break;
        case 'learning': if (!SRS.isLearning(c)) return false; break;
        case 'review': if (!SRS.isReview(c)) return false; break;
        case 'due': if (!(c.srs && c.srs.due < dayEnd)) return false; break;
        case 'leech': if (!(c.srs && c.srs.leech)) return false; break;
        case 'suspended': if (!c.suspended) return false; break;
      }
      if (!q) return true;
      return (c.word + ' ' + c.translation + ' ' + c.transcription + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });

    cards.sort(function (a, b) {
      switch (state.sort) {
        case 'alpha': return a.word.localeCompare(b.word, 'ru');
        case 'added': return (b.createdAt || 0) - (a.createdAt || 0);
        case 'interval': return ((b.srs && b.srs.interval) || 0) - ((a.srs && a.srs.interval) || 0);
        case 'lapses': return ((b.srs && b.srs.lapses) || 0) - ((a.srs && a.srs.lapses) || 0);
        default: return ((a.srs && a.srs.due) || 0) - ((b.srs && b.srs.due) || 0);
      }
    });
    return cards;
  }

  function renderList() {
    var list = U.qs('#browse-list');
    var countEl = U.qs('#browse-count');
    if (!list) return;
    var cards = filtered();
    var shown = cards.slice(0, state.page * PAGE);
    U.clear(list);

    if (countEl) {
      countEl.textContent = cards.length + ' ' + U.plural(cards.length, 'слово', 'слова', 'слов') +
        (state.deckId === 'all' ? ' во всех колодах' : '');
    }

    if (!cards.length) {
      list.appendChild(V.decks.emptyState('search', 'Ничего не найдено', 'Измените запрос или фильтры.'));
      renderBulkBar();
      return;
    }

    shown.forEach(function (card) {
      list.appendChild(browseRow(card));
    });

    if (shown.length < cards.length) {
      list.appendChild(h('button', {
        class: 'btn btn--ghost btn--wide',
        onclick: function () { state.page++; renderList(); }
      }, h('span', { text: 'Показать ещё (' + (cards.length - shown.length) + ')' })));
    }
    renderBulkBar();
  }

  function browseRow(card) {
    var deck = S.getDeck(card.deckId);
    var now = Date.now();
    var checked = !!state.selected[card.id];
    var cb = h('input', { type: 'checkbox', checked: checked, 'aria-label': 'Выбрать слово' });
    cb.addEventListener('change', function () {
      if (cb.checked) state.selected[card.id] = true;
      else delete state.selected[card.id];
      renderBulkBar();
    });

    var stateKind = SRS.isNew(card) ? 'new' : SRS.isLearning(card) ? 'learning' : 'review';
    var wordEl = h('b', { class: 'browse-row__word', text: card.word });

    return h('div', { class: 'browse-row' + (checked ? ' is-selected' : '') },
      h('label', { class: 'check' }, cb, h('span', { class: 'check__box' }, icon('check', 13))),
      h('div', { class: 'browse-row__main' },
        h('div', { class: 'browse-row__top' },
          wordEl,
          card.transcription ? h('span', { class: 'word-row__ipa', text: '[' + card.transcription.replace(/^\[|\]$/g, '') + ']' }) : null,
          SP.supported() && deck ? SP.audioButton(card.word, deck.langFrom, { small: true, target: wordEl }) : null
        ),
        h('span', { class: 'browse-row__trans', text: card.translation }),
        deck ? h('span', { class: 'tag tag--muted', text: deck.name }) : null,
        (card.tags || []).map(function (t) { return h('span', { class: 'tag', text: t }); })
      ),
      h('div', { class: 'browse-row__side' },
        h('span', { class: 'tag tag--' + stateKind, text: SRS.stateLabel(card) }),
        h('span', { class: 'muted small', text: card.srs ? U.fmtRelative(card.srs.due, now) : '' })
      ),
      h('div', { class: 'browse-row__actions' },
        h('button', { class: 'icon-btn', title: 'Редактировать', onclick: function () { V.decks.openCardEditor(card, card.deckId); } }, icon('edit', 16)),
        h('button', {
          class: 'icon-btn', title: 'Показать в тренировке',
          onclick: function () {
            var ids = card.deckId ? [card.deckId] : [];
            App.router.go('#/study/' + (ids.length ? ids[0] : 'all'));
          }
        }, icon('play', 16)),
        h('button', {
          class: 'icon-btn icon-btn--danger', title: 'Удалить',
          onclick: function () {
            U.confirmDialog('Удалить слово?', '«' + card.word + '» будет удалено.', 'Удалить')
              .then(function (ok) { if (ok) { S.deleteCard(card.id); U.toast('Удалено', 'ok'); renderList(); } });
          }
        }, icon('trash', 16))
      )
    );
  }

  function selectedIds() { return Object.keys(state.selected); }

  function renderBulkBar() {
    var bar = U.qs('#bulk-bar');
    if (!bar) return;
    U.clear(bar);
    var ids = selectedIds();
    if (!ids.length) return;

    var deckSel = h('select', { class: 'input input--sm' });
    deckSel.appendChild(h('option', { value: '', text: 'Перенести в колоду…' }));
    S.get().decks.forEach(function (d) { deckSel.appendChild(h('option', { value: d.id, text: d.name })); });
    deckSel.addEventListener('change', function () {
      if (!deckSel.value) return;
      ids.forEach(function (id) {
        var c = S.getCard(id);
        if (c) { c.deckId = deckSel.value; c.updatedAt = Date.now(); }
      });
      S.notify('bulk:move');
      U.toast('Перенесено: ' + ids.length, 'ok');
      state.selected = {};
      renderList();
    });

    U.append(bar, [
      h('span', { class: 'bulk-bar__count', text: 'Выбрано: ' + ids.length }),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: function () {
          ids.forEach(function (id) { S.resetCard(id); });
          U.toast('Прогресс сброшен', 'ok'); state.selected = {}; renderList();
        } }, icon('refresh', 15), h('span', { text: 'Сбросить прогресс' })),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: function () {
          ids.forEach(function (id) {
            var c = S.getCard(id);
            if (c) c.suspended = true;
          });
          S.notify('bulk:suspend');
          U.toast('Поставлено на паузу', 'ok'); state.selected = {}; renderList();
        } }, icon('pause', 15), h('span', { text: 'На паузу' })),
      deckSel,
      h('button', { class: 'btn btn--danger btn--sm', onclick: function () {
          U.confirmDialog('Удалить выбранные?', 'Будет удалено ' + ids.length + ' ' + U.plural(ids.length, 'слово', 'слова', 'слов') + '.', 'Удалить')
            .then(function (ok) { if (ok) { S.deleteCards(ids); U.toast('Удалено', 'ok'); state.selected = {}; renderList(); } });
        } }, icon('trash', 15), h('span', { text: 'Удалить' })),
      h('button', { class: 'icon-btn', title: 'Снять выбор', onclick: function () { state.selected = {}; renderList(); } }, icon('close', 16))
    ]);
  }

  function exportSelection() {
    var ids = selectedIds();
    var deckIds = ids.length
      ? null
      : (state.deckId === 'all' ? S.get().decks.map(function (d) { return d.id; }) : [state.deckId]);
    var csv;
    if (ids.length) {
      var all = S.get().cards.filter(function (c) { return ids.indexOf(c.id) >= 0; });
      csv = csvFor(all);
    } else {
      csv = S.exportCsv(deckIds);
    }
    U.download('lexiflow-words-' + U.dayKey(Date.now()) + '.csv', csv, 'text/csv');
    U.toast('Файл CSV сохранён', 'ok');
  }

  function csvFor(cards) {
    // общий генератор: сохраняет все примеры и прогресс повторений
    return S.csvForCards(cards);
  }

  V.browse = { render: renderBrowse };
})(window);

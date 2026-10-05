/* ============================================================
   LexiFlow — views/stats.js
   Статистика обучения: активность, серия дней, точность,
   тепловая карта, прогноз повторений, распределение карточек.
   Графики — собственный SVG без внешних библиотек (офлайн).
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, S = App.store, SRS = App.srs;
  var h = U.h, icon = U.icon;
  var V = (App.views = App.views || {});
  var SVGNS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      node.setAttribute(k, attrs[k]);
    });
    return node;
  }

  /* ---------- Графики ---------- */

  function barChart(days, opts) {
    opts = opts || {};
    var W = 680, Hgt = 200, padL = 36, padR = 10, padT = 14, padB = 26;
    var plotW = W - padL - padR, plotH = Hgt - padT - padB;
    var max = Math.max.apply(null, days.map(function (d) { return d.total; }).concat([5]));
    var step = plotW / days.length;
    var barW = Math.max(4, step * 0.62);

    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hgt, class: 'chart', role: 'img', 'aria-label': 'Активность повторений' });

    // сетка
    [0, 0.5, 1].forEach(function (t) {
      var y = padT + plotH * (1 - t);
      root.appendChild(svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'chart__grid' }));
      var label = svg('text', { x: padL - 8, y: y + 4, class: 'chart__axis', 'text-anchor': 'end' });
      label.textContent = String(Math.round(max * t));
      root.appendChild(label);
    });

    days.forEach(function (d, i) {
      var x = padL + i * step + (step - barW) / 2;
      var totalH = d.total ? Math.max(2, plotH * (d.total / max)) : 0;
      if (totalH) {
        root.appendChild(svg('rect', {
          x: x, y: padT + plotH - totalH, width: barW, height: totalH, rx: Math.min(3, barW / 2),
          class: 'chart__bar'
        }));
      }
      if (d.fresh) {
        var freshH = Math.max(2, plotH * (d.fresh / max));
        root.appendChild(svg('rect', {
          x: x, y: padT + plotH - freshH, width: barW, height: Math.min(freshH, totalH || freshH),
          rx: Math.min(3, barW / 2), class: 'chart__bar chart__bar--fresh'
        }));
      }
      if (d.total) {
        var title = svg('title');
        title.textContent = d.label + ': ' + d.total + ' повторений' + (d.fresh ? ' (' + d.fresh + ' новых)' : '');
        var hit = svg('rect', { x: padL + i * step, y: padT, width: step, height: plotH, class: 'chart__hit' });
        hit.appendChild(title);
        root.appendChild(hit);
      }
      if (i % 5 === 0 || i === days.length - 1) {
        var t = svg('text', { x: padL + i * step + step / 2, y: Hgt - 8, class: 'chart__axis', 'text-anchor': 'middle' });
        t.textContent = d.short;
        root.appendChild(t);
      }
    });
    return root;
  }

  function forecastChart(days) {
    var W = 680, Hgt = 170, padL = 34, padR = 10, padT = 14, padB = 26;
    var plotW = W - padL - padR, plotH = Hgt - padT - padB;
    var max = Math.max.apply(null, days.map(function (d) { return d.value; }).concat([3]));
    var step = plotW / days.length;
    var barW = Math.max(6, step * 0.6);
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hgt, class: 'chart', role: 'img', 'aria-label': 'Прогноз повторений' });
    [0, 1].forEach(function (t) {
      var y = padT + plotH * (1 - t);
      root.appendChild(svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'chart__grid' }));
      var label = svg('text', { x: padL - 8, y: y + 4, class: 'chart__axis', 'text-anchor': 'end' });
      label.textContent = String(Math.round(max * t));
      root.appendChild(label);
    });
    days.forEach(function (d, i) {
      var x = padL + i * step + (step - barW) / 2;
      var barH = d.value ? Math.max(2, plotH * (d.value / max)) : 0;
      if (barH) {
        root.appendChild(svg('rect', {
          x: x, y: padT + plotH - barH, width: barW, height: barH, rx: 3, class: 'chart__bar chart__bar--forecast'
        }));
      }
      var t = svg('text', { x: padL + i * step + step / 2, y: Hgt - 8, class: 'chart__axis', 'text-anchor': 'middle' });
      t.textContent = d.label;
      root.appendChild(t);
      if (d.value) {
        var v = svg('text', { x: padL + i * step + step / 2, y: padT + plotH - barH - 4, class: 'chart__value', 'text-anchor': 'middle' });
        v.textContent = String(d.value);
        root.appendChild(v);
      }
    });
    return root;
  }

  function donut(parts) {
    var size = 168, r = 60, cx = size / 2, cy = size / 2, stroke = 20;
    var circ = 2 * Math.PI * r;
    var total = parts.reduce(function (a, p) { return a + p.value; }, 0) || 1;
    var root = svg('svg', { viewBox: '0 0 ' + size + ' ' + size, class: 'donut', role: 'img', 'aria-label': 'Распределение карточек' });
    root.appendChild(svg('circle', { cx: cx, cy: cy, r: r, fill: 'none', class: 'donut__track', 'stroke-width': stroke }));
    var offset = 0;
    parts.forEach(function (p) {
      if (!p.value) return;
      var len = circ * (p.value / total);
      var arc = svg('circle', {
        cx: cx, cy: cy, r: r, fill: 'none', stroke: p.color, 'stroke-width': stroke,
        'stroke-dasharray': len + ' ' + (circ - len),
        'stroke-dashoffset': -offset,
        transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
        'stroke-linecap': 'butt'
      });
      var title = svg('title');
      title.textContent = p.label + ': ' + p.value;
      arc.appendChild(title);
      root.appendChild(arc);
      offset += len;
    });
    var big = svg('text', { x: cx, y: cy + 2, class: 'donut__value', 'text-anchor': 'middle' });
    big.textContent = String(total);
    root.appendChild(big);
    var cap = svg('text', { x: cx, y: cy + 20, class: 'donut__label', 'text-anchor': 'middle' });
    cap.textContent = 'карточек';
    root.appendChild(cap);
    return root;
  }

  function heatmap(days) {
    // days: [{key, count, label}] — 26 недель, столбцы = недели
    var cell = 13, gap = 3, cols = Math.ceil(days.length / 7);
    var W = cols * (cell + gap) + 26, Hgt = 7 * (cell + gap) + 22;
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hgt, class: 'heatmap', role: 'img', 'aria-label': 'Тепловая карта активности' });
    var levels = ['l0', 'l1', 'l2', 'l3', 'l4'];
    function levelOf(n) {
      if (!n) return 0;
      if (n < 8) return 1;
      if (n < 20) return 2;
      if (n < 40) return 3;
      return 4;
    }
    ['пн', 'ср', 'пт'].forEach(function (name, i) {
      var row = i * 2;
      var t = svg('text', { x: 0, y: 12 + row * (cell + gap) + cell - 2, class: 'chart__axis' });
      t.textContent = name;
      root.appendChild(t);
    });
    days.forEach(function (d, i) {
      var col = Math.floor(i / 7), row = i % 7;
      var rect = svg('rect', {
        x: 26 + col * (cell + gap), y: 12 + row * (cell + gap),
        width: cell, height: cell, rx: 3, class: 'heat heat--' + levels[levelOf(d.count)]
      });
      var title = svg('title');
      title.textContent = d.label + ': ' + d.count + ' ' + U.plural(d.count, 'повторение', 'повторения', 'повторений');
      rect.appendChild(title);
      root.appendChild(rect);
    });
    return root;
  }

  /* ---------- Агрегация данных ---------- */

  function buildStats(deckId) {
    var now = Date.now();
    var data = S.get();
    var logs = deckId ? data.logs.filter(function (l) { return l.deckId === deckId; }) : data.logs;
    var realLogs = logs.filter(function (l) { return !l.test; });

    var byDay = {};
    realLogs.forEach(function (l) {
      var k = U.dayKey(l.ts);
      if (!byDay[k]) byDay[k] = { total: 0, fresh: 0, correct: 0 };
      byDay[k].total++;
      if (l.stateFrom === 'new') byDay[k].fresh++;
      if (l.correct) byDay[k].correct++;
    });

    // активность за 30 дней
    var activity = [];
    for (var i = 29; i >= 0; i--) {
      var ts = U.startOfDay(now) - i * U.MS_DAY;
      var k = U.dayKey(ts);
      var d = byDay[k] || { total: 0, fresh: 0 };
      var date = new Date(ts);
      activity.push({
        key: k, total: d.total, fresh: d.fresh,
        label: date.getDate() + ' ' + U.MONTHS_SHORT[date.getMonth()],
        short: String(date.getDate())
      });
    }

    // тепловая карта 26 недель
    var heat = [];
    var totalDays = 26 * 7;
    var start = U.startOfDay(now) - (totalDays - 1) * U.MS_DAY;
    // выравниваем по понедельнику
    var startDow = (new Date(start).getDay() + 6) % 7;
    start -= startDow * U.MS_DAY;
    for (var j = 0; j < totalDays + startDow; j++) {
      var ts2 = start + j * U.MS_DAY;
      var k2 = U.dayKey(ts2);
      var rec = byDay[k2];
      var dt = new Date(ts2);
      heat.push({
        key: k2, count: rec ? rec.total : 0,
        label: dt.getDate() + ' ' + U.MONTHS_SHORT[dt.getMonth()] + ' ' + dt.getFullYear()
      });
    }
    // последняя колонка может быть неполной — это нормально для тепловой карты

    // прогноз на 14 дней
    var cards = deckId ? S.cardsOf(deckId) : data.cards;
    var forecast = [];
    var base = U.startOfDay(now);
    for (var f = 0; f < 14; f++) {
      var from = base + f * U.MS_DAY, to = from + U.MS_DAY;
      var cnt = cards.filter(function (c) {
        return c.srs && c.srs.state !== 'new' && !c.suspended && c.srs.due >= (f === 0 ? 0 : from) && c.srs.due < to;
      }).length;
      var d2 = new Date(from);
      forecast.push({ label: f === 0 ? 'сег' : String(d2.getDate()), value: cnt });
    }

    // распределение
    var states = { new: 0, learning: 0, review: 0 };
    var leeches = [];
    cards.forEach(function (c) {
      if (SRS.isNew(c)) states.new++;
      else if (SRS.isLearning(c)) states.learning++;
      else states.review++;
      if (c.srs && c.srs.leech) leeches.push(c);
    });

    var todayLogs = realLogs.filter(function (l) { return l.ts >= U.startOfDay(now); });
    var todayTime = todayLogs.reduce(function (a, l) { return a + (l.ms || 0); }, 0);
    var last30 = realLogs.filter(function (l) { return l.ts >= U.startOfDay(now) - 29 * U.MS_DAY; });
    var correct30 = last30.filter(function (l) { return l.correct; }).length;
    var accuracy = last30.length ? Math.round(correct30 / last30.length * 100) : 0;
    var totalTime = realLogs.reduce(function (a, l) { return a + (l.ms || 0); }, 0);

    return {
      activity: activity, heat: heat, forecast: forecast, states: states,
      leeches: leeches.sort(function (a, b) { return (b.srs.lapses || 0) - (a.srs.lapses || 0); }).slice(0, 20),
      todayCount: todayLogs.length, todayTime: todayTime, accuracy: accuracy,
      last30Count: last30.length, totalReviews: realLogs.length, totalTime: totalTime,
      streak: S.streak(now), cards: cards
    };
  }

  /* ---------- Отрисовка ---------- */

  function renderStats(root, params) {
    var deckId = params && params.id && params.id !== 'all' ? params.id : null;
    var deck = deckId ? S.getDeck(deckId) : null;
    var st = buildStats(deckId);
    var settings = S.settings();
    var goal = settings.dailyGoal || 30;
    var goalPct = Math.min(100, Math.round(st.todayCount / goal * 100));

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go(deck ? '#/deck/' + deck.id : '#/decks'); } }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: deck ? 'Прогресс: ' + deck.name : 'Статистика обучения' }),
          h('p', { class: 'page-sub', text: 'Всего повторений: ' + st.totalReviews + ' · время в изучении: ' + U.fmtDuration(st.totalTime) })
        )
      )
    );

    var kpis = h('div', { class: 'kpi-grid' },
      kpi('fire', 'Серия', st.streak + ' ' + U.plural(st.streak, 'день', 'дня', 'дней'), st.streak ? 'занимаетесь каждый день' : 'начните серию сегодня', 'accent'),
      kpi('target', 'Сегодня', st.todayCount + '/' + goal, 'цель выполнена на ' + goalPct + '%'),
      kpi('check', 'Точность', st.accuracy + '%', 'за последние 30 дней'),
      kpi('clock', 'Время сегодня', U.fmtDuration(st.todayTime), 'активное время ответов')
    );

    var activityPanel = h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title', text: 'Активность за 30 дней' }),
        h('div', { class: 'legend' },
          h('span', { class: 'legend__item' }, h('i', { class: 'legend__dot legend__dot--bar' }), h('span', { text: 'повторения' })),
          h('span', { class: 'legend__item' }, h('i', { class: 'legend__dot legend__dot--fresh' }), h('span', { text: 'новые слова' }))
        )
      ),
      barChart(st.activity)
    );

    var donutPanel = h('section', { class: 'panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title', text: 'Состояние карточек' })),
      h('div', { class: 'donut-wrap' },
        donut([
          { label: 'Новые', value: st.states.new, color: '#7c5cff' },
          { label: 'В обучении', value: st.states.learning, color: '#f0b429' },
          { label: 'На повторении', value: st.states.review, color: '#2ec5b6' }
        ]),
        h('ul', { class: 'donut-legend' },
          legendRow('#7c5cff', 'Новые', st.states.new),
          legendRow('#f0b429', 'В обучении', st.states.learning),
          legendRow('#2ec5b6', 'На повторении', st.states.review)
        )
      )
    );

    var forecastPanel = h('section', { class: 'panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title', text: 'Прогноз повторений на 14 дней' })),
      forecastChart(st.forecast)
    );

    var heatPanel = h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title', text: 'Календарь активности' }),
        h('div', { class: 'legend legend--heat' },
          h('span', { class: 'muted small', text: 'меньше' }),
          [0, 1, 2, 3, 4].map(function (l) { return h('i', { class: 'heat heat--l' + l }); }),
          h('span', { class: 'muted small', text: 'больше' })
        )
      ),
      h('div', { class: 'heat-wrap' }, heatmap(st.heat))
    );

    var panels = h('div', { class: 'stats-grid' }, activityPanel, h('div', { class: 'stats-col' }, donutPanel));

    var content = [head, kpis, panels, forecastPanel, heatPanel];

    if (!deckId) content.push(deckTable());
    if (st.leeches.length) content.push(leechPanel(st.leeches));

    if (!st.totalReviews && !st.cards.length) {
      content = [head, V.decks.emptyState('chart', 'Пока нет данных',
        'Начните тренировку — статистика появится после первых ответов.',
        h('button', { class: 'btn btn--primary', onclick: function () { App.router.go('#/decks'); } }, h('span', { text: 'К колодам' })))];
    }

    U.clear(root);
    U.append(root, [h('div', { class: 'page' }, content)]);
  }

  function kpi(iconName, label, value, hint, variant) {
    return h('div', { class: 'kpi' + (variant ? ' kpi--' + variant : '') },
      h('div', { class: 'kpi__top' }, icon(iconName, 17), h('span', { text: label })),
      h('b', { class: 'kpi__value', text: value }),
      h('span', { class: 'kpi__hint', text: hint })
    );
  }

  function legendRow(color, label, value) {
    return h('li', { class: 'donut-legend__row' },
      h('i', { class: 'legend__dot', style: { background: color } }),
      h('span', { class: 'donut-legend__label', text: label }),
      h('b', { text: String(value) })
    );
  }

  function deckTable() {
    var now = Date.now();
    var decks = S.get().decks;
    var table = h('table', { class: 'table' },
      h('thead', {}, h('tr', {},
        h('th', { text: 'Колода' }), h('th', { text: 'Всего' }), h('th', { text: 'Новые' }),
        h('th', { text: 'В обучении' }), h('th', { text: 'Повторение' }), h('th', { text: 'К повторению' }),
        h('th', { text: 'Точность' }), h('th', {})
      ))
    );
    var body = h('tbody');
    decks.forEach(function (d) {
      var s = S.deckStats(d.id, now);
      var logs = S.get().logs.filter(function (l) { return l.deckId === d.id && !l.test; });
      var last = logs.slice(-200);
      var acc = last.length ? Math.round(last.filter(function (l) { return l.correct; }).length / last.length * 100) + '%' : '—';
      body.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'dot', style: { background: d.color } }), h('span', { text: d.name })),
        h('td', { text: String(s.total) }),
        h('td', { text: String(s.new) }),
        h('td', { text: String(s.learning) }),
        h('td', { text: String(s.review) }),
        h('td', {}, h('b', { text: String(s.due) })),
        h('td', { text: acc }),
        h('td', {}, h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { App.router.go('#/stats/' + d.id); } }, h('span', { text: 'Подробнее' })))
      ));
    });
    table.appendChild(body);
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title', text: 'По колодам' })),
      h('div', { class: 'table-wrap' }, table)
    );
  }

  function leechPanel(leeches) {
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title', text: 'Трудные слова' }),
        h('span', { class: 'muted small', text: 'Слова, которые вы забываете чаще всего' })
      ),
      h('div', { class: 'leech-list' },
        leeches.map(function (c) {
          var deck = S.getDeck(c.deckId);
          return h('div', { class: 'leech' },
            h('div', { class: 'leech__main' },
              h('b', { text: c.word }),
              h('span', { class: 'leech__trans', text: c.translation }),
              deck ? h('span', { class: 'tag tag--muted', text: deck.name }) : null
            ),
            h('span', { class: 'tag tag--warn', text: (c.srs.lapses || 0) + ' провалов' }),
            h('button', { class: 'icon-btn', title: 'Редактировать', onclick: function () { V.decks.openCardEditor(c, c.deckId); } }, icon('edit', 16))
          );
        })
      )
    );
  }

  V.stats = { render: renderStats, buildStats: buildStats };
})(window);

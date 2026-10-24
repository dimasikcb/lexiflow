/* ============================================================
   LexiFlow — quicksettings.js
   Быстрые настройки на телефоне: плавающая кнопка ⚙ и шторка
   снизу (bottom sheet) с самыми нужными тумблерами.
   На ПК (шире 900px) кнопка скрыта — там настройки в сайдбаре.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});

  function init() {
    var S = App.store, U = App.util;
    if (!S || !U || !U.h) return;            // модули ещё не готовы
    if (global.__lexiflowQS) return;          // защита от повторной вставки
    global.__lexiflowQS = true;

    var st = S.settings();

    function sheetClose() {
      var sh = U.qs('#qs-sheet');
      if (sh) sh.remove();
      var ov = U.qs('#qs-overlay');
      if (ov) ov.remove();
    }

    function row(label, control) {
      return U.h('div', { class: 'qs-row' },
        U.h('span', { class: 'qs-row__label', text: label }),
        control);
    }

    function toggle(value, onchange) {
      return U.h('button', {
        class: 'qs-toggle' + (value ? ' qs-toggle--on' : ''),
        role: 'switch',
        'aria-checked': value ? 'true' : 'false',
        onclick: function () { onchange(!value); sheetClose(); open(); }
      }, U.h('span', { class: 'qs-toggle__knob' }));
    }

    function numInput(value, min, max, onchange) {
      return U.h('input', {
        class: 'input qs-num', type: 'number', min: String(min), max: String(max),
        value: String(value),
        onchange: function () {
          var v = U.clamp(parseInt(this.value, 10) || min, min, max);
          this.value = String(v);
          onchange(v);
        }
      });
    }

    function open() {
      if (U.qs('#qs-sheet')) { sheetClose(); return; }
      st = S.settings();

      var themeLabel = { auto: 'Авто', dark: 'Тёмная', light: 'Светлая' }[st.theme || 'auto'] || 'Авто';
      var nextTheme = { auto: 'light', dark: 'auto', light: 'dark' };

      var overlay = U.h('div', { class: 'qs-overlay', id: 'qs-overlay', onclick: sheetClose });
      var sheet = U.h('div', { class: 'qs-sheet', id: 'qs-sheet', role: 'dialog', 'aria-label': 'Быстрые настройки' },
        U.h('div', { class: 'qs-sheet__grip' }),
        U.h('h3', { class: 'qs-sheet__title', text: 'Быстрые настройки' }),

        row('Тема: ' + themeLabel, toggle((st.theme || 'auto') !== 'light', function (on) {
          S.updateSettings({ theme: on ? nextTheme[st.theme || 'auto'] || 'dark' : 'light' });
        })),

        row('Озвучивание', toggle(st.ttsAutoPlay !== false, function (on) {
          S.updateSettings({ ttsAutoPlay: on });
        })),

        row('Подсветка слов при озвучке', toggle(st.ttsHighlight !== false, function (on) {
          S.updateSettings({ ttsHighlight: on });
        })),

        row('Карт за сеанс', numInput(st.sessionLimit || 40, 5, 100, function (v) {
          S.updateSettings({ sessionLimit: v });
        })),

        row('Повторений в день (цель)', numInput(st.dailyGoal || 30, 5, 500, function (v) {
          S.updateSettings({ dailyGoal: v });
        })),

        row('Ответов для стрика 🔥', numInput(st.streakGoal || (App.streak ? App.streak.DEFAULT_GOAL : 10), 1, 100, function (v) {
          S.updateSettings({ streakGoal: v });
        })),

        U.h('button', { class: 'btn btn--block', onclick: function () { sheetClose(); if (App.router) App.router.navigate('#/settings'); } },
          'Все настройки')
      );

      document.body.appendChild(overlay);
      document.body.appendChild(sheet);
    }

    function mount() {
      var btn = U.h('button', {
        class: 'qs-fab', id: 'qs-fab', 'aria-label': 'Быстрые настройки', title: 'Быстрые настройки'
      }, U.icon ? (U.icon('settings', 20) || '⚙') : '⚙');
      btn.addEventListener('click', open);
      document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  }

  if (typeof document !== 'undefined') init();
})(window);

/* ============================================================
   LexiFlow — views/notify.js
   Панель напоминаний: включение, время, проверка разрешения.
   Собирается теми же классами и хелперами, что и views/tools.js,
   чтобы настройки выглядели однородно.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util;
  var h = U.h, icon = U.icon;
  var V = (App.views = App.views || {});

  var PERMISSION_LABELS = {
    unsupported: 'Не поддерживается',
    default: 'Разрешение не выдано',
    granted: 'Разрешено',
    denied: 'Запрещено'
  };

  var PERMISSION_CLASSES = {
    unsupported: 'tag tag--muted',
    default: 'tag tag--muted',
    granted: 'tag',
    denied: 'tag tag--warn'
  };

  var PERMISSION_HINTS = {
    unsupported: 'браузер не умеет показывать уведомления',
    default: 'браузер спросит разрешение при включении',
    granted: 'напоминания можно показывать',
    denied: 'запрещено в настройках сайта'
  };

  /* ---------- Сборка панели (в стиле views/tools.js) ---------- */

  function panelShell(title, iconName) {
    var children = Array.prototype.slice.call(arguments, 2);
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title' }, icon(iconName, 17), h('span', { text: title }))
      ),
      h('div', { class: 'panel__body' }, children.filter(Boolean))
    );
  }

  function row(label, hint, control) {
    return h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: label }),
        hint ? h('span', { class: 'muted small', text: hint }) : null
      ),
      h('div', { class: 'setting-row__control' }, control)
    );
  }

  /** Переключатель. Возвращает узел и сам чекбокс: панели нужно его состояние. */
  function switchRow(label, hint, checked, onChange) {
    var input = h('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', function () { onChange(input.checked); });
    var node = h('label', { class: 'setting-row setting-row--switch' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: label }),
        hint ? h('span', { class: 'muted small', text: hint }) : null
      ),
      h('span', { class: 'switch' }, input, h('span', { class: 'switch__track' }))
    );
    return { node: node, input: input };
  }

  /** Выполнить действие и вернуть промис: configure() может спросить разрешение. */
  function run(result, onDone) {
    if (result && typeof result.then === 'function') result.then(onDone, onDone);
    else onDone(result);
  }

  /* ============================================================
     Панель
     ============================================================ */

  function panelView() {
    var N = App.notify;

    var statusText = h('div', { class: 'setting-row__text' });
    var permNote = h('div', {});

    var enableSwitch = switchRow(
      'Напоминать о повторении',
      'Одно напоминание в день — не чаще, чем раз в сутки.',
      N.settings().enabled,
      function (checked) {
        var wasEnabled = !!App.notify.settings().enabled;
        run(App.notify.configure({ enabled: checked }), function (next) {
          var nowEnabled = !!(next && next.enabled);
          enableSwitch.input.checked = nowEnabled;
          // configure() сам объясняет отказ, поэтому тост — только про успех
          if (nowEnabled !== wasEnabled) {
            U.toast(nowEnabled ? 'Напоминания включены' : 'Напоминания выключены', nowEnabled ? 'ok' : 'info', 2600);
          }
          paint();
        });
      }
    );

    var timeInput = h('input', { class: 'input', type: 'time', value: N.settings().time });
    timeInput.addEventListener('change', function () {
      var input = this;
      run(App.notify.configure({ time: input.value }), function (next) {
        input.value = (next && next.time) || input.value;
        U.toast('Напоминание в ' + input.value, 'ok', 2400);
        paint();
      });
    });

    var onlyIfDueSwitch = switchRow(
      'Только если есть что повторять',
      'Если долгов нет, уведомление не придёт — даже в назначенное время.',
      N.settings().onlyIfDue,
      function (checked) {
        run(App.notify.configure({ onlyIfDue: checked }), function (next) {
          onlyIfDueSwitch.input.checked = !!(next && next.onlyIfDue);
          paint();
        });
      }
    );

    var testBtn = h('button', {
      class: 'btn btn--ghost',
      onclick: function () {
        testBtn.disabled = true;
        run(App.notify.test(), function () { testBtn.disabled = false; paint(); });
      }
    }, icon('check', 16), h('span', { text: 'Проверить уведомление' }));

    var root = panelShell('Напоминания', 'clock',
      h('div', { class: 'setting-row' }, statusText),
      enableSwitch.node,
      row('Время напоминания', 'Проверка идёт каждую минуту, пока приложение открыто.', timeInput),
      onlyIfDueSwitch.node,
      row('Проверка', 'Покажет пробное уведомление прямо сейчас. Браузер спросит разрешение, если оно ещё не выдано.', testBtn),
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Что нужно знать' }),
        h('p', { class: 'muted small', text: 'LexiFlow — статическое приложение без сервера: push-уведомлений у него нет. Напоминание показывает сама открытая страница, поэтому оно срабатывает, пока приложение открыто — в том числе в фоновой вкладке.' }),
        h('p', { class: 'muted small', text: 'Если вкладка закрыта, напоминание не придёт: будить браузер некому. Это ограничение проекта, а не ошибка настроек. Надёжнее всего установить LexiFlow на устройство и держать его запущенным.' }),
        h('p', { class: 'muted small', text: 'Время сверяется с локальными часами устройства, а отметка о показе хранится по местной дате — поэтому напоминание приходит не чаще одного раза в сутки и не сбивается при переходе через полночь.' }),
        permNote
      )
    );

    /* ---------- Отрисовка состояния ---------- */

    function paint() {
      var perm = App.notify.permission();
      var cfg = App.notify.settings();
      var due = App.notify.dueToday();

      U.clear(statusText);
      U.append(statusText, [
        h('b', { text: 'Разрешение браузера' }),
        h('span', { class: 'inline-row' },
          h('span', { class: PERMISSION_CLASSES[perm] || 'tag', text: PERMISSION_LABELS[perm] || perm }),
          h('span', { class: 'muted small', text: PERMISSION_HINTS[perm] || '' })
        ),
        h('span', { class: 'muted small', text: due > 0
          ? 'Сейчас ждут повторения: ' + due + ' ' + U.plural(due, 'карточка', 'карточки', 'карточек')
          : 'Сейчас всё повторено — ждать нечего' })
      ]);

      U.clear(permNote);
      if (perm === 'denied') {
        U.append(permNote, [
          h('p', { class: 'warn-text', text: 'Уведомления для этого сайта запрещены. Откройте настройки браузера: значок замка рядом с адресом → «Уведомления» → «Разрешить». После этого обновите страницу — приложение не может вернуть разрешение само.' })
        ]);
      } else if (perm === 'unsupported') {
        U.append(permNote, [
          h('p', { class: 'muted small', text: 'Этот браузер не поддерживает уведомления. Настройка сохранится, но показывать напоминания он не сможет — откройте приложение в Chrome, Edge, Firefox или Safari.' })
        ]);
      } else if (cfg.enabled && cfg.lastShown) {
        U.append(permNote, [
          h('p', { class: 'muted small', text: 'Последнее напоминание: ' + cfg.lastShown + '.' })
        ]);
      }

      enableSwitch.input.checked = !!cfg.enabled;
      enableSwitch.input.disabled = !App.notify.supported();
      timeInput.value = cfg.time;
      timeInput.disabled = !App.notify.supported();
      onlyIfDueSwitch.input.checked = !!cfg.onlyIfDue;
      onlyIfDueSwitch.input.disabled = !App.notify.supported();
      testBtn.disabled = !App.notify.supported();
    }

    /* Настройки меняются и из других мест приложения — держим панель в курсе.
       Отписываемся, как только её убрали из документа, иначе подписки
       копились бы при каждом переходе по экранам. */
    var everAttached = false;
    var unsubscribe = App.store.subscribe(function () {
      var inDocument = !!(global.document && global.document.body && global.document.body.contains(root));
      if (inDocument) { everAttached = true; paint(); return; }
      if (everAttached) {
        unsubscribe();
        if (global.removeEventListener) global.removeEventListener('focus', onFocus);
      }
    });

    /* Разрешение меняется в интерфейсе браузера, а не в приложении:
       перечитываем его при возвращении на вкладку. */
    function onFocus() { paint(); }
    if (global.addEventListener) global.addEventListener('focus', onFocus);

    paint();
    return root;
  }

  /* ============================================================
     Полноэкранный вариант (отдельный маршрут, если понадобится)
     ============================================================ */

  function render(root) {
    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', {
          class: 'icon-btn', 'aria-label': 'Назад',
          onclick: function () { App.router.go('#/settings'); }
        }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'Напоминания' }),
          h('p', { class: 'page-sub', text: 'Одно уведомление в день, если есть что повторять' })
        )
      )
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page page--narrow' }, head, panelView())]);
  }

  V.notify = { render: render, panel: panelView };
})(window);

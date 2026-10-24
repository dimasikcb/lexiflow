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
    var backgroundNote = h('div', {});
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

    /* Дни недели: 0 = воскресенье … 6 = суббота — как Date.getDay и как
       settings.notify.days в js/notify.js. Значение держим в скрытом чекбоксе
       switchRow — paintDays() читает и пишет его. Последний выбранный день
       не снимается: набор «напоминать никогда» через интерфейс не собрать. */
    var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
    var daysRow = switchRow('Дни', 'В выбранные дни напоминание приходит, в остальные — нет.', true, function () {});
    daysRow.node.classList.add('hidden');
    var daysBox = h('span', { class: 'chips' });
    function paintDays(selected) {
      var list = App.notify.normalizeDays(selected) || ALL_DAYS;
      U.clear(daysBox);
      ALL_DAYS.forEach(function (day) {
        var b = h('button', {
          class: 'chip' + (list.indexOf(day) !== -1 ? ' is-active' : ''),
          type: 'button',
          text: App.notify.DAY_LABELS[day]
        });
        b.addEventListener('click', function () {
          var current = (App.notify.normalizeDays(daysRow.input.value) || ALL_DAYS).slice();
          var idx = current.indexOf(day);
          if (idx !== -1) {
            if (current.length === 1) return; // «никогда» не выбирается здесь
            current.splice(idx, 1);
          } else {
            current.push(day);
            current.sort(function (a, c) { return a - c; });
          }
          daysRow.input.value = current;
          paintDays(current);
          run(App.notify.configure({ days: current }), function (next) {
            daysRow.input.value = (next && App.notify.normalizeDays(next.days)) || ALL_DAYS;
            paintDays(daysRow.input.value);
          });
        });
        U.append(daysBox, [b]);
      });
    }
    daysRow.input.value = App.notify.normalizeDays(N.settings().days) || ALL_DAYS;
    paintDays(daysRow.input.value);
    var daysControl = h('div', { class: 'setting-row__control' }, daysBox);
    daysRow.node.appendChild(daysControl);

    var testBtn = h('button', {
      class: 'btn btn--ghost',
      onclick: function () {
        testBtn.disabled = true;
        run(App.notify.test(), function () { testBtn.disabled = false; paint(); });
      }
    }, icon('check', 16), h('span', { text: 'Проверить уведомление' }));

    /* iOS Safari не умеет показывать уведомления из вкладки: без установки
       на домашний экран напоминания там недоступны вовсе. */
    var iosNote = h('p', { class: 'muted small', text: 'На iPhone и iPad в Safari уведомления не приходят вовсе: установите LexiFlow на домашний экран («Поделиться» → «На экран «Домой»») и открывайте его с иконки — тогда напоминание придёт, пока приложение открыто.' });

    var root = panelShell('Напоминания', 'clock',
      h('div', { class: 'setting-row' }, statusText),
      enableSwitch.node,
      row('Время напоминания', 'Проверка идёт каждую минуту, пока приложение открыто.', timeInput),
      onlyIfDueSwitch.node,
      daysRow.node,
      row('Проверка', 'Покажет пробное уведомление прямо сейчас. Браузер спросит разрешение, если оно ещё не выдано.', testBtn),
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Что нужно знать' }),
        h('p', { class: 'muted small', text: 'LexiFlow — статическое приложение без сервера: push-уведомлений у него нет. Напоминание показывает само устройство: пока приложение открыто (в том числе в фоновой вкладке) — каждую минуту; в установленном приложении Chrome/Edge — ещё и фоновая проверка, когда приложение закрыто.' }),
        h('p', { class: 'muted small', text: 'Если вкладка закрыта, напоминание не придёт — выручает фоновая проверка в установленном приложении Chrome/Edge, но и та срабатывает, когда браузер сочтёт возможным: может и реже раза в день. Точное время при закрытом приложении без своего сервера гарантировать нельзя — это ограничение платформы, а не настроек.' }),
        h('p', { class: 'muted small', text: 'Время сверяется с локальными часами устройства, а отметка о показе хранится по местной дате — поэтому напоминание приходит не чаще одного раза в сутки и не сбивается при переходе через полночь.' }),
        iosNote,
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
          : 'Сейчас всё повторено — ждать нечего' }),
        backgroundNote
      ]);

      /* Фоновая проверка (Periodic Background Sync) есть не везде — когда
         канала нет, строка остаётся пустой и места не занимает. */
      U.clear(backgroundNote);
      App.notify.periodicSyncState().then(function (state) {
        paintBackgroundStatus(state === 'registered' ? true : (state === 'off' ? false : null));
      });

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

      // строка «Дни» видна только при включённых напоминаниях
      daysRow.node.classList.toggle('hidden', !cfg.enabled);
      daysRow.input.disabled = !App.notify.supported();
      paintDays(App.notify.normalizeDays(cfg.days) || ALL_DAYS);
    }

    /** Строка «Фон» в статусе: null — канал не поддерживается, строку не рисуем. */
    function paintBackgroundStatus(active) {
      if (active === null) return;
      U.append(statusText, [
        h('span', { class: 'inline-row' },
          h('span', { class: 'tag' + (active ? '' : ' tag--muted'), text: active ? 'Фон: включён' : 'Фон: выключен' }),
          h('span', { class: 'muted small', text: active
            ? 'закрытое приложение тоже проверит напоминание — когда браузер сочтёт возможным'
            : 'включите напоминания заново в установленном приложении, чтобы фоновые проверки заработали' })
        )
      ]);
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

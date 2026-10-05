/* ============================================================
   LexiFlow — views/sync.js
   Панель синхронизации: подключение хранилища GitHub Gist,
   ручной обмен, автосинхронизация и отключение.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, S = App.store;
  var h = U.h, icon = U.icon;
  var V = (App.views = App.views || {});

  var STATUS_LABELS = {
    off: 'Не настроено',
    idle: 'Готово к обмену',
    syncing: 'Синхронизация…',
    ok: 'Синхронизировано',
    error: 'Ошибка'
  };

  var STATUS_CLASSES = {
    off: 'tag tag--muted',
    idle: 'tag tag--muted',
    syncing: 'tag',
    ok: 'tag',
    error: 'tag tag--warn'
  };

  /* ---------- Сборка панели (в стиле views/tools.js) ---------- */

  function panelShell(title, iconName) {
    var children = Array.prototype.slice.call(arguments, 2);
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title' }, icon(iconName, 17), h('span', { text: title }))
      ),
      h('div', { class: 'panel__body' }, children)
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

  /** Короткая сводка изменений для тоста. */
  function statsText(stats) {
    stats = stats || {};
    var parts = [];
    if (stats.decksAdded) parts.push('колод +' + stats.decksAdded);
    if (stats.decksUpdated) parts.push('колод обновлено: ' + stats.decksUpdated);
    if (stats.cardsAdded) parts.push('карточек +' + stats.cardsAdded);
    if (stats.cardsUpdated) parts.push('карточек обновлено: ' + stats.cardsUpdated);
    if (stats.deleted) parts.push('удалено: ' + stats.deleted);
    if (stats.logsAdded) parts.push('записей журнала +' + stats.logsAdded);
    if (stats.orphans) parts.push('осталось без колоды: ' + stats.orphans);
    return parts.length ? parts.join(', ') : 'изменений не было';
  }

  /* ============================================================
     Панель
     ============================================================ */

  function panelView() {
    var SY = App.sync;
    var cfg = S.settings().sync || {};

    var statusText = h('div', { class: 'setting-row__text' });

    /* Подпись держим ссылкой, а не поиском по DOM: так её можно менять
       из syncUi() без обращения к разметке. */
    var connectLabel = h('span', { text: 'Создать хранилище' });

    var connectBtn = h('button', {
      class: 'btn btn--primary',
      onclick: doConnect
    }, icon('check', 16), connectLabel);

    /* Токен GitHub: нужен один раз, чтобы создать хранилище.
       Fine-grained token с единственным правом «Gist: read and write».
       Хранится только на этом устройстве. */
    var tokenInput = h('input', {
      class: 'input input--mono',
      type: 'password',
      placeholder: 'Вставьте токен GitHub',
      autocomplete: 'off',
      spellcheck: 'false'
    });

    /* Второе устройство подключается по коду: иначе оно заведёт своё
       хранилище, и данные двух устройств не встретятся никогда. */
    var gistInput = h('input', {
      class: 'input input--mono',
      type: 'text',
      placeholder: 'Код хранилища с другого устройства',
      autocomplete: 'off',
      spellcheck: 'false'
    });

    var joinBtn = h('button', {
      class: 'btn btn--ghost',
      onclick: doJoin
    }, icon('download', 16), h('span', { text: 'Подключиться к хранилищу' }));

    var codeBox = h('div', { class: 'inline-row' });

    var nowBtn = h('button', {
      class: 'btn btn--ghost',
      onclick: doNow
    }, icon('refresh', 16), h('span', { text: 'Синхронизировать сейчас' }));

    var offBtn = h('button', {
      class: 'btn btn--danger',
      onclick: doDisconnect
    }, icon('close', 16), h('span', { text: 'Отключить' }));

    var autoInput = h('input', { type: 'checkbox', checked: !!cfg.auto });
    autoInput.addEventListener('change', function () {
      if (autoInput.checked) SY.start(); else SY.stop();
      U.toast(autoInput.checked ? 'Автосинхронизация включена' : 'Автосинхронизация выключена', 'info', 2200);
      syncUi();
    });

    var autoRow = h('label', { class: 'setting-row setting-row--switch' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: 'Синхронизировать автоматически' }),
        h('span', { class: 'muted small', text: 'Отправляет правки через несколько секунд после изменения и раз в 5 минут, пока приложение открыто.' })
      ),
      h('span', { class: 'switch' }, autoInput, h('span', { class: 'switch__track' }))
    );

    var root = panelShell('Синхронизация', 'refresh',
      h('div', { class: 'setting-row' }, statusText),
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Токен GitHub' }),
          h('span', { class: 'muted small', text: 'Нужен один раз. Классический Personal Access Token с правом «gist». Fine-grained токены не работают с Gist API. Хранится только на этом устройстве и не попадает в гист и в резервную копию.' })
        ),
        h('div', { class: 'setting-row__control setting-row__control--stack' },
          tokenInput,
          h('div', { class: 'inline-row' }, connectBtn, nowBtn, offBtn)
        )
      ),
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Код хранилища' }),
          h('span', { class: 'muted small', text: 'Покажите этот код на втором устройстве — тогда оба будут писать в одно место.' })
        ),
        h('div', { class: 'setting-row__control setting-row__control--stack' },
          codeBox,
          gistInput,
          h('div', { class: 'inline-row' }, joinBtn)
        )
      ),
      autoRow,
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Как это работает' }),
        h('p', { class: 'muted small', text: 'Копия колод, слов и прогресса лежит в секретном гисте GitHub — это обычный файл JSON. Серверов LexiFlow не существует: приложение обменивается данными напрямую с api.github.com и только тогда, когда синхронизация включена.' }),
        h('p', { class: 'muted small', text: 'Перед отправкой своя копия сливается с облачной: побеждает более свежая правка, а удаления переносятся отдельно через надгробия (tombstones), поэтому ничего не воскресает и не теряется, даже если править по очереди с двух устройств.' }),
        h('p', { class: 'muted small', text: 'Секретный гист не индексируется поиском, но открывается по ссылке любому, у кого она есть. Токен даёт право записи только в этот гист — выдайте ему единственное разрешение «Gist: read and write», тогда утечка токена не откроет доступ к остальным репозиториям.' }),
        h('p', { class: 'muted small' },
          'Создать токен: GitHub → Settings → Developer settings → Personal access tokens → ',
          h('b', { text: 'Tokens (classic)' }),
          ' → Generate new token (classic) → право ',
          h('b', { text: 'gist' }),
          '. Fine-grained токены не поддерживают Gist API. ',
          h('a', {
            href: 'https://github.com/settings/tokens',
            target: '_blank',
            rel: 'noopener',
            text: 'Открыть страницу токенов'
          })
        )
      )
    );

    /* ---------- Обновление интерфейса ---------- */

    function paintStatus(snapshot) {
      U.clear(statusText);
      var at = snapshot.at;
      /* Пока синхронизация не настроена, status() не хранит сообщений —
         но причина прошлой неудачи важна, поэтому читаем её из настроек. */
      var lastError = (S.settings().sync || {}).lastError || '';
      U.append(statusText, [
        h('b', { text: 'Синхронизация' }),
        h('span', { class: 'inline-row' },
          h('span', { class: STATUS_CLASSES[snapshot.state] || 'tag', text: STATUS_LABELS[snapshot.state] || snapshot.state }),
          h('span', { class: 'muted small', text: at
            ? 'последний обмен: ' + U.fmtDateTime(at) + ' · ' + U.fmtRelative(at)
            : 'обмен ещё не выполнялся' })
        ),
        snapshot.message
          ? h('span', { class: snapshot.state === 'error' ? 'warn-text' : 'muted small', text: snapshot.message })
          : (lastError ? h('span', { class: 'warn-text', text: 'Прошлая попытка не удалась: ' + lastError }) : null),
        /* Правки, не уехавшие в облако, показываем прямо: иначе непонятно,
           почему колода, удалённая на телефоне, ещё жива на компьютере. */
        (SY.pending && SY.pending())
          ? h('span', { class: 'warn-text', text: 'Есть неотправленные правки — уйдут в облако при первой возможности.' })
          : null
      ]);
    }

    function syncUi() {
      var snapshot = SY.status();
      var configured = SY.isConfigured();
      var syncing = snapshot.state === 'syncing';
      var gistId = (S.settings().sync || {}).gistId || '';

      paintStatus(snapshot);

      connectBtn.disabled = syncing;
      joinBtn.disabled = syncing;
      nowBtn.disabled = !configured || syncing;
      offBtn.disabled = !configured;
      autoInput.checked = !!S.settings().sync.auto;
      connectLabel.textContent = configured ? 'Пересоздать' : 'Создать';
      tokenInput.placeholder = configured
        ? 'Токен сохранён — введите новый, чтобы заменить'
        : 'Вставьте токен GitHub';

      /* Показываем код, только когда хранилище есть: пустое поле сбивало бы
         с толку — непонятно, надо ли что-то вводить. */
      U.clear(codeBox);
      if (!gistId) return;
      U.append(codeBox, [
        h('code', { class: 'code code--wrap', text: gistId }),
        h('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: function () {
            U.copyText(gistId);
            U.toast('Код хранилища скопирован', 'ok', 2400);
          }
        }, icon('copy', 15), h('span', { text: 'Скопировать' }))
      ]);
    }

    /* Статус меняется из любого места приложения — держим панель в курсе.
       Отписываемся, как только панель убрали из документа, иначе подписки
       копились бы при каждом переходе по экранам. */
    var everAttached = false;
    var unsubscribe = SY.onChange(function () {
      var inDocument = !!(global.document && global.document.body && global.document.body.contains(root));
      if (inDocument) everAttached = true;
      else if (everAttached) { unsubscribe(); return; }
      syncUi();
    });

    /* ---------- Действия ---------- */

    function doConnect() {
      var token = tokenInput.value.trim();
      if (!token) { U.toast('Вставьте токен GitHub', 'err'); return; }

      connectBtn.disabled = true;
      SY.connect(token).then(function (res) {
        connectBtn.disabled = false;
        if (!res || !res.ok) {
          U.toast((res && res.error) || 'Не удалось подключиться', 'err', 5200);
          syncUi();
          return;
        }
        /* Токен не держим в поле ввода: он уже сохранён в настройках. */
        tokenInput.value = '';
        tokenInput.placeholder = 'Токен сохранён — введите новый, чтобы заменить';
        U.toast(res.login ? 'Хранилище подключено: ' + res.login : 'Хранилище подключено', 'ok', 3200);
        syncUi();
      }, function () {
        connectBtn.disabled = false;
        U.toast('Не удалось подключиться к GitHub', 'err', 4200);
        syncUi();
      });
    }

    function doJoin() {
      /* Токен: если поле пустое, а в настройках уже сохранён — используем его.
         Это главный сценарий: второе устройство уже знает токен (вставил его
         при первом подключении), но при вводе кода хранилища вводит только код. */
      var token = tokenInput.value.trim() || S.settings().sync.token;
      var code = gistInput.value.trim();
      if (!token) { U.toast('Введите токен GitHub', 'err'); return; }
      if (!code) { U.toast('Введите код хранилища с первого устройства', 'err'); return; }

      joinBtn.disabled = true;
      SY.join(token, code).then(function (res) {
        joinBtn.disabled = false;
        if (!res || !res.ok) {
          U.toast((res && res.error) || 'Не удалось подключиться к хранилищу', 'err', 5600);
          syncUi();
          return;
        }
        /* Токен не держим в поле ввода: он уже сохранён в настройках. */
        tokenInput.value = '';
        tokenInput.placeholder = 'Токен сохранён — введите новый, чтобы заменить';
        gistInput.value = '';
        U.toast('Хранилище подключено, данные перенесены', 'ok', 3600);
        syncUi();
      }, function () {
        joinBtn.disabled = false;
        U.toast('Не удалось подключиться к GitHub', 'err', 4200);
        syncUi();
      });
    }

    function doNow() {
      nowBtn.disabled = true;
      SY.now().then(function (res) {
        nowBtn.disabled = false;
        if (!res || !res.ok) {
          U.toast((res && res.error) || 'Синхронизация не удалась', 'err', 5200);
          syncUi();
          return;
        }
        U.toast('Готово: ' + statsText(res.stats), 'ok', 5200);
        if (App.router && App.router.refresh) App.router.refresh();
        syncUi();
      }, function () {
        nowBtn.disabled = false;
        U.toast('Синхронизация не удалась', 'err', 4200);
        syncUi();
      });
    }

    function doDisconnect() {
      U.confirmDialog('Отключить синхронизацию?',
        'Токен и адрес хранилища будут удалены с этого устройства. Копия данных в гисте останется — её можно подключить заново или удалить вручную на GitHub.',
        'Отключить'
      ).then(function (ok) {
        if (!ok) return;
        SY.disconnect();
        tokenInput.value = '';
        tokenInput.placeholder = 'Вставьте токен GitHub';
        U.toast('Синхронизация отключена', 'ok', 3200);
        syncUi();
      });
    }

    syncUi();
    return root;
  }

  /* ============================================================
     Полноэкранный вариант (если понадобится отдельный маршрут)
     ============================================================ */

  function render(root) {
    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', {
          class: 'icon-btn', 'aria-label': 'Назад',
          onclick: function () { App.router.go('#/settings'); }
        }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'Синхронизация' }),
          h('p', { class: 'page-sub', text: 'Одна база слов и прогресса на всех ваших устройствах' })
        )
      )
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page page--narrow' }, head, panelView())]);
  }

  V.sync = { render: render, panel: panelView };
})(window);

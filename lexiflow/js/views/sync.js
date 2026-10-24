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

    var tokenInput = h('input', {
      class: 'input input--mono',
      type: 'password',
      placeholder: 'Вставьте токен GitHub',
      autocomplete: 'off',
      spellcheck: 'false'
    });

    /* Второе устройство подключается по коду приглашения: одно поле,
       одна кнопка. Токен и адрес хранилища уже внутри кода — их не нужно
       знать и создавать вручную. */
    var inviteInput = h('input', {
      class: 'input input--mono',
      type: 'text',
      placeholder: 'Код приглашения: LF2-…',
      autocomplete: 'off',
      spellcheck: 'false'
    });
    inviteInput.value = '';

    var inviteBtn = h('button', {
      class: 'btn btn--primary',
      onclick: doInvite
    }, icon('download', 16), h('span', { text: 'Подключиться по коду' }));

    var scanBtn = h('button', {
      class: 'btn btn--ghost',
      onclick: doScan
    }, icon('target', 16), h('span', { text: 'Сканировать QR' }));

    /* Ручной путь остаётся (и как запасной вариант, и для тех, кто
       настраивал синхронизацию раньше): он спрятан в «подробности». */
    var gistInput = h('input', {
      class: 'input input--mono',
      type: 'text',
      placeholder: 'Код хранилища с другого устройства',
      autocomplete: 'off',
      spellcheck: 'false'
    });

    var joinBtn = h('button', {
      class: 'btn btn--ghost btn--sm',
      onclick: doJoin
    }, icon('download', 15), h('span', { text: 'Подключиться к хранилищу' }));

    var codeBox = h('div', { class: 'inline-row' });
    var qrBox = h('div', { class: 'invite-qr' });

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

    /* ---------- Сценарии ----------

       Новое устройство: код приглашения — один шаг. Больше ничего
       знать не нужно: токен и адрес хранилища едут внутри кода.
       Ручной путь (создать хранилище самому) остаётся в «подробностях»:
       он редко нужен, но важен как запасной вариант. */

    var inviteSection = h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: 'Приглашение от другого устройства' }),
        h('span', { class: 'muted small', text: 'Откройте LexiFlow на устройстве, где синхронизация уже настроена, и скопируйте оттуда код приглашения. Одна вставка — и данные обоих устройств сольются.' })
      ),
      h('div', { class: 'setting-row__control setting-row__control--stack' },
        inviteInput,
        h('div', { class: 'inline-row' }, inviteBtn, scanBtn),
        h('span', { class: 'muted small', text: 'Код выглядит так: LF2-много букв и цифр, и ещё 4 символа. QR есть только на первом устройстве: нажмите «Сканировать QR» и наведите камеру на его экран.' })
      )
    );

    var shareSection = h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: 'Пригласить второе устройство' }),
        h('span', { class: 'muted small', text: 'Вставьте этот код (или отсканируйте QR) на втором устройстве — они начнут писать в одно хранилище. Код равен вашему токену GitHub: покажите его только своему устройству. Отозвать код можно, создав новый токен на GitHub.' })
      ),
      h('div', { class: 'setting-row__control setting-row__control--stack' },
        codeBox,
        qrBox
      )
    );

    /* ---------- Сценарии ----------

       Главный путь первого устройства: создать своё хранилище. Он обязан
       быть виден сразу — раньше токен и кнопка «Создать» лежали внутри
       свёрнутого <details>, и человек, открывший экран, вообще не находил
       способа начать: ни кода приглашения, ни хранилища. Поэтому:
         • не настроено  → «Подключить хранилище» (токен + кнопка),
           затем приглашение по коду;
         • настроено     → код приглашения и QR, кнопки обмена;
       В свёрнутые «подробности» уходит только ручной путь вторым
       устройством (код хранилища) — он редкий и запасной. */

    var createSection = h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: 'Подключить хранилище' }),
        h('span', { class: 'muted small', text: 'Нужен один раз. Классический Personal Access Token с правом «Gist: read and write»: приложение создаст секретный гист и будет держать в нём копию колод, слов и прогресса. Токен хранится только на этом устройстве и не попадает ни в гист, ни в резервную копию.' })
      ),
      h('div', { class: 'setting-row__control setting-row__control--stack' },
        tokenInput,
        h('div', { class: 'inline-row' }, connectBtn),
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

    var actionsSection = h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: 'Обмен с хранилищем' })
      ),
      h('div', { class: 'setting-row__control setting-row__control--stack' },
        h('div', { class: 'inline-row' }, nowBtn, offBtn)
      )
    );

    var manualSection = h('details', { class: 'panel__section sync-manual' },
      h('summary', { class: 'field__label', text: 'Вручную: код хранилища' }),
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Код хранилища' }),
          h('span', { class: 'muted small', text: 'Ручной путь второго устройства: тот же токен плюс код хранилища с первого устройства. Обычно проще вставить код приглашения — он несёт оба значения сразу.' })
        ),
        h('div', { class: 'setting-row__control setting-row__control--stack' },
          gistInput,
          h('div', { class: 'inline-row' }, joinBtn)
        )
      )
    );

    var root = panelShell('Синхронизация', 'refresh',
      h('div', { class: 'setting-row' }, statusText),
      createSection,
      inviteSection,
      shareSection,
      actionsSection,
      autoRow,
      manualSection,
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Как это работает' }),
        h('p', { class: 'muted small', text: 'Копия колод, слов и прогресса лежит в секретном гисте GitHub — это обычный файл JSON. Серверов LexiFlow не существует: приложение обменивается данными напрямую с api.github.com и только тогда, когда синхронизация включена.' }),
        h('p', { class: 'muted small', text: 'Перед отправкой своя копия сливается с облачной: побеждает более свежая правка, а удаления переносятся отдельно через надгробия (tombstones), поэтому ничего не воскресает и не теряется, даже если править по очереди с двух устройств.' }),
        h('p', { class: 'muted small', text: 'Код приглашения равен вашему токену — он даёт право писать в этот гист и только в него. Покажите его своему второму устройству (или отправьте QR); чтобы отозвать доступ, пересоздайте токен на GitHub и подключитесь заново.' })
      )
    );

    /* ---------- Обновление интерфейса ---------- */

    function paintStatus(snapshot) {
      U.clear(statusText);
      var at = snapshot.at;
      /* Пока синхронизация не настроена, status() не хранит сообщений —
         но причина прошлой неудачи важна, поэтому читаем её из настроек. */
      var lastError = (S.settings().sync || {}).lastError || '';
      var pendingHint = null;
      /* Про состояние говорим словами. «Не настроено» без пояснения читается
         как поломка: человек видит кнопку «Сканировать QR», ждёт рядом QR —
         и не понимает, почему его нет. Объясняем прямо: QR рисует то
         устройство, где хранилище уже подключено. */
      var stateHint = null;
      if (!SY.isConfigured()) {
        stateHint = 'В этом браузере хранилище ещё не подключено. ' +
          'QR-код приглашения рисуется только на устройстве, где хранилище уже настроено, — здесь его не будет. ' +
          'Вставьте код приглашения с первого устройства или отсканируйте камерой его экран.';
      }
      /* Правки, не уехавшие в облако, показываем прямо: иначе непонятно,
         почему колода, удалённая на телефоне, ещё жива на компьютере.
         Причину называем словами — «при первой возможности» без объяснения
         читалось как «и никогда». */
      if (SY.pending && SY.pending()) {
        var why;
        if (snapshot.state === 'syncing') why = 'отправляем…';
        else if (navigator.onLine === false) why = 'нет сети — уедут, когда связь вернётся';
        else if (snapshot.state === 'error' || lastError) why = 'последняя попытка не удалась — повторяем';
        else why = 'уедут в течение нескольких секунд';
        pendingHint = 'Есть неотправленные правки: ' + why + '.';
      }
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
        stateHint ? h('span', { class: 'muted small', text: stateHint }) : null,
        pendingHint ? h('span', { class: 'warn-text', text: pendingHint }) : null
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
      inviteBtn.disabled = syncing;
      scanBtn.disabled = syncing;
      nowBtn.disabled = !configured || syncing;
      offBtn.disabled = !configured;
      autoInput.checked = !!S.settings().sync.auto;
      /* Кнопка видна только когда хранилища ещё нет, поэтому всегда
         «Создать». «Пересоздать» убрано намеренно: новая хранилища —
         это новый пустой гист, а старая копия данных осталась бы в старом,
         и человек потерял бы к ним доступ не поняв почему. Путь к смене
         хранилища — «Отключить», затем «Создать». */
      connectLabel.textContent = 'Создать';
      tokenInput.placeholder = configured
        ? 'Токен сохранён — введите новый, чтобы заменить'
        : 'Вставьте токен GitHub';

      /* Сценарий: кому что показывать.
         Не настроено — сначала «Подключить хранилище» (главный путь),
         затем приглашение по коду. Кода приглашения и кнопок обмена
         пока нет — они бы вели в пустоту.
         Настроено — код приглашения и QR второму устройству, кнопки
         обмена. Поле токена остаётся доступным через «Пересоздать»:
         хранилище уже есть, и создавать его заново надо осознанно. */
      createSection.style.display = configured ? 'none' : '';
      inviteSection.style.display = configured ? 'none' : '';
      shareSection.style.display = configured ? '' : 'none';
      actionsSection.style.display = configured ? '' : 'none';
      /* Кнопку сканера прячем, если браузер не умеет: на десктопе камеры
         обычно нет, а недоступная кнопка выглядит поломкой. */
      scanBtn.style.display = scanSupported() ? '' : 'none';

      /* Показываем код приглашения, только когда хранилище есть:
         пустое поле сбивало бы с толку — непонятно, надо ли что-то вводить. */
      U.clear(codeBox);
      U.clear(qrBox);
      if (!gistId) return;

      var code = SY.inviteCode ? SY.inviteCode() : '';
      if (!code) return;
      U.append(codeBox, [
        h('code', { class: 'code code--wrap', text: code }),
        h('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: function () {
            U.copyText(code);
            U.toast('Код приглашения скопирован', 'ok', 2400);
          }
        }, icon('copy', 15), h('span', { text: 'Скопировать' }))
      ]);
      /* QR рисуем, только когда панель на экране: qr.svg() кодирует строку
         матрицей и на слабом телефоне это заметная работа. */
      try {
        if (App.qr && typeof App.qr.svg === 'function') {
          U.append(qrBox, [
            App.qr.svg(code, { ec: 'M' }),
            h('span', { class: 'muted small', text: 'QR-код приглашения: покажите его камере второго устройства' })
          ]);
        }
      } catch (e) { console.warn('LexiFlow: не удалось построить QR', e); }
    }

    /* Статус меняется из любого места приложения — держим панель в курсе.
       Отписываемся, как только панель убрали из документа, иначе подписки
       копились бы при каждом переходе по экранам. */
    var everAttached = false;
    var unsubscribe = SY.onChange(function () {
      var inDocument = !!(global.document && global.document.body && global.document.body.contains(root));
      if (inDocument) everAttached = true;
      else if (everAttached) { unsubscribe(); stopScan(); return; }
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

    function doInvite() {
      var code = inviteInput.value.trim();
      if (!code) { U.toast('Вставьте код приглашения из приложения на первом устройстве', 'err'); return; }

      /* Локальная проверка до запроса: опечатку видно сразу, без ожидания
         и без общего сообщения «не удалось подключиться». */
      if (SY.inviteParse && !SY.inviteParse(code)) {
        U.toast('Код не похож на приглашение: должно начинаться с LF2- и быть целиком одним куском', 'err', 5600);
        return;
      }

      inviteBtn.disabled = true;
      SY.joinInvite(code).then(function (res) {
        inviteBtn.disabled = false;
        if (!res || !res.ok) {
          U.toast((res && res.error) || 'Не удалось подключиться по коду приглашения', 'err', 5600);
          syncUi();
          return;
        }
        inviteInput.value = '';
        U.toast(res.login ? 'Готово: устройства синхронизируются (' + res.login + ')' : 'Готово: устройства синхронизируются', 'ok', 3600);
        syncUi();
      }, function () {
        inviteBtn.disabled = false;
        U.toast('Не удалось связаться с GitHub', 'err', 4200);
        syncUi();
      });
    }

    /* ---------- Сканер QR (BarcodeDetector) ----------
       На Chrome Android сканер встроен в браузер — сторонних библиотек
       не нужно. Спросили камеру, смотрим кадры, нашли QR — подставляем
       код и подключаемся. Где детектора нет — кнопки не будет. */

    var scanStream = null;
    var scanTimer = null;

    function scanSupported() {
      return typeof global.BarcodeDetector === 'function';
    }

    function stopScan() {
      if (scanTimer) { global.clearInterval(scanTimer); scanTimer = null; }
      if (scanStream) {
        scanStream.getTracks().forEach(function (t) { t.stop(); });
        scanStream = null;
      }
      U.closeModals();
    }

    function doScan() {
      if (!scanSupported()) {
        U.toast('Этот браузер не умеет сканировать QR — вставьте код вручную', 'err', 4200);
        return;
      }
      if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) {
        U.toast('Камера недоступна — вставьте код вручную', 'err', 4200);
        return;
      }

      var video = h('video', { class: 'scan-video', playsinline: '', muted: '' });
      U.modal({
        title: 'Сканирование приглашения',
        body: h('div', { class: 'scan' },
          video,
          h('p', { class: 'muted small', text: 'Наведите камеру на QR-код на экране первого устройства.' })
        ),
        actions: [{ label: 'Отмена', variant: 'ghost' }]
      });

      global.BarcodeDetector.getSupportedFormats().then(function (formats) {
        if (!formats || formats.indexOf('qr_code') === -1) {
          stopScan();
          U.toast('Браузер поддерживает сканер, но не QR — вставьте код вручную', 'err', 5200);
          return;
        }
        var detector = new global.BarcodeDetector({ formats: ['qr_code'] });
        return global.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
          scanStream = stream;
          video.srcObject = stream;
          if (video.play) video.play();
          scanTimer = global.setInterval(function () {
            if (video.readyState < 2) return;
            detector.detect(video).then(function (codes) {
              if (!codes || !codes.length) return;
              var code = codes[0].rawValue || '';
              stopScan();
              if (SY.inviteParse && SY.inviteParse(code)) {
                inviteInput.value = code;
                doInvite();
              } else {
                U.toast('QR-код не похож на приглашение LexiFlow', 'err', 5200);
              }
            }).catch(function () { /* кадр не разобран — смотрим следующий */ });
          }, 350);
        }).catch(function () {
          stopScan();
          U.toast('Камера недоступна — вставьте код вручную', 'err', 4200);
        });
      }).catch(function () {
        stopScan();
        U.toast('Сканер не запустился — вставьте код вручную', 'err', 4200);
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

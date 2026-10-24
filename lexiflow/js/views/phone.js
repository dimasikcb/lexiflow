/* ============================================================
   LexiFlow — views/phone.js
   Экран «На телефон»: QR-код со ссылкой на приложение, понятное
   объяснение, что мешает открыть её с телефона, и пошаговая
   установка для Android и iPhone.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (global.App = global.App || {});
  var U = App.util;
  var h = U.h, icon = U.icon;
  var V = (App.views = App.views || {});

  /** Ширина QR-кода на экране: подгоняем размер модуля под эту величину. */
  var QR_TARGET_PX = 288;

  /* ============================================================
     Адрес страницы
     ============================================================ */

  /** Адрес без якоря: телефон должен открыть приложение, а не конкретный экран. */
  function shareUrl() {
    var href = String((global.location && global.location.href) || '');
    var hash = href.indexOf('#');
    if (hash >= 0) href = href.slice(0, hash);
    return href;
  }

  function protocolOf(url) {
    var m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    return m ? m[1].toLowerCase() : '';
  }

  function hostOf(url) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url);
    if (!m) return '';
    var authority = m[1];
    var at = authority.lastIndexOf('@');
    if (at >= 0) authority = authority.slice(at + 1);
    if (authority.charAt(0) === '[') return authority.slice(0, authority.indexOf(']') + 1).toLowerCase();
    var colon = authority.indexOf(':');
    return (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase();
  }

  /**
   * Почему телефон не откроет этот адрес.
   * Локальный адрес — самый частый случай: приложение открыто на компьютере
   * как файл или через localhost, и телефону такое имя ничего не говорит.
   */
  function unreachableReason(url) {
    var protocol = protocolOf(url);
    if (protocol === 'file') {
      return 'Страница открыта прямо с диска (адрес начинается с file://). У телефона нет доступа ' +
        'к файлам этого компьютера, поэтому такая ссылка не откроется.';
    }
    if (protocol !== 'http' && protocol !== 'https') {
      return 'Адрес с протоколом «' + protocol + '://» телефон не поймёт. Нужен обычный веб-адрес.';
    }
    var host = hostOf(url);
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '0.0.0.0') {
      return 'Адрес «' + host + '» означает «этот самый компьютер». Для телефона «localhost» — это он сам, ' +
        'а не ваш компьютер, поэтому ссылка приведёт в пустоту.';
    }
    return null;
  }

  function isSecure(url) {
    var protocol = protocolOf(url);
    if (protocol === 'https') return true;
    if (protocol !== 'http') return false;
    var host = hostOf(url);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  }

  /* ============================================================
     Сборка экрана
     ============================================================ */

  function render(root) {
    var url = shareUrl();
    var problem = url ? unreachableReason(url) : 'Не удалось определить адрес страницы.';
    var secure = url ? isSecure(url) : false;
    var protocol = protocolOf(url);
    var host = hostOf(url);

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', {
          class: 'icon-btn', 'aria-label': 'Назад',
          onclick: function () { App.router.go('#/settings'); }
        }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'На телефон' }),
          h('p', { class: 'page-sub', text: 'Отсканируйте код — и LexiFlow откроется на телефоне' })
        )
      )
    );

    /* --- QR-код и ссылка --- */
    var qrBox = h('div', { class: 'inline-row' });
    var qrNote = null;

    if (!url) {
      qrNote = h('p', { class: 'warn-text', text: 'Не удалось определить адрес страницы, поэтому QR-код не построен.' });
    } else if (!App.qr || typeof App.qr.svg !== 'function') {
      qrNote = h('p', { class: 'warn-text', text: 'Модуль QR-кода (js/qr.js) не подключён к странице.' });
    } else {
      try {
        var code = App.qr.encode(url, { ec: 'M' });
        var modules = code.matrix.length;
        var scale = Math.max(3, Math.floor(QR_TARGET_PX / modules));
        var node = App.qr.svg(url, {
          ec: 'M',
          scale: scale,
          label: 'QR-код со ссылкой на LexiFlow: ' + url
        });
        // На узком экране код ужимается, но остаётся квадратным.
        node.style.maxWidth = '100%';
        node.style.height = 'auto';
        node.style.display = 'block';
        node.style.margin = '0 auto';
        qrBox.appendChild(node);
      } catch (e) {
        qrNote = h('p', { class: 'warn-text', text: e && e.message ? e.message : 'Не удалось построить QR-код.' });
      }
    }

    var statusTag = problem
      ? h('span', { class: 'tag tag--warn', text: 'Телефон не откроет' })
      : h('span', { class: 'tag tag--muted', text: protocol + '://' + host });

    var copyBtn = h('button', {
      class: 'btn btn--primary btn--sm',
      onclick: function () {
        if (!U.copyText) return;
        U.copyText(url).then(function (ok) {
          U.toast(ok ? 'Ссылка скопирована — отправьте её себе в мессенджер'
            : 'Скопировать не удалось: выделите адрес и нажмите Ctrl+C', ok ? 'ok' : 'err', 4200);
        });
      }
    }, icon('copy', 15), h('span', { text: 'Скопировать ссылку' }));

    var qrPanel = panel('Ссылка для телефона', 'grid',
      h('p', { class: 'muted small', text: 'Наведите камеру телефона на код — откроется та же версия приложения. ' +
        'Код построен прямо в браузере: адрес никуда не отправляется.' }),
      qrBox.childNodes.length ? qrBox : null,
      qrNote,
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Адрес' }),
        h('pre', { class: 'code code--wrap', text: url || '—' }),
        h('div', { class: 'inline-row' },
          copyBtn,
          statusTag
        )
      )
    );

    /* --- Предупреждение о локальном адресе --- */
    var localPanel = problem ? panel('Этот адрес не откроется на телефоне', 'warning',
      h('p', { class: 'warn-text', text: problem }),
      h('div', { class: 'install-guide' },
        h('p', { text: 'Что делать: приложение нужно сначала выложить в интернет по обычному адресу ' +
          '(например, на GitHub Pages, Netlify или Vercel), а затем открыть этот экран на опубликованной ' +
          'версии — QR-код построится уже по рабочей ссылке.' }),
        h('ul', {},
          h('li', { text: 'Пока приложение не опубликовано, адрес действует только на этом компьютере.' }),
          h('li', { text: 'Код выше всё равно можно проверить: он честно кодирует тот адрес, что открыт сейчас.' }),
          h('li', { text: 'Если выложить приложение на свой компьютер в локальной сети, телефон откроет его ' +
            'по адресу вида http://192.168.… — но установка и офлайн-режим там работать не будут.' })
        )
      )
    ) : null;

    /* --- Android --- */
    var androidPanel = panel('Android и Chrome', 'install',
      h('div', { class: 'install-guide' },
        h('p', { text: 'В Chrome установка занимает четыре шага — приложение появится на главном экране ' +
          'и откроется без адресной строки.' }),
        h('ol', {},
          h('li', {}, h('b', { text: 'Откройте ссылку в Chrome.' }), ' Проще всего — отсканировать QR-код камерой или нажать на ссылку, отправленную себе в мессенджер.'),
          h('li', {}, h('b', { text: 'Нажмите «⋮»' }), ' в правом верхнем углу.'),
          h('li', {}, h('b', { text: 'Выберите «Установить приложение»' }), ' — или «Добавить на главный экран», если пункт называется иначе.'),
          h('li', {}, h('b', { text: 'Подтвердите' }), ' — значок LexiFlow появится среди приложений.')
        ),
        h('p', { class: 'muted small', text: 'Иногда Chrome сам предлагает установку полосой внизу экрана — тогда достаточно нажать «Установить».' })
      )
    );

    /* --- iPhone --- */
    var iphonePanel = panel('iPhone и iPad (Safari)', 'install',
      h('div', { class: 'install-guide' },
        h('p', { text: 'В Safari кнопки установки нет: приложение добавляют на главный экран вручную. ' +
          'Важно открыть ссылку именно в Safari — Chrome на iPhone так не умеет.' }),
        h('ol', {},
          h('li', {}, h('b', { text: 'Откройте ссылку в Safari.' })),
          h('li', {}, h('b', { text: 'Нажмите «Поделиться»' }), ' — квадрат со стрелкой вверх в нижней панели.'),
          h('li', {}, h('b', { text: 'Выберите «На экран «Домой»».' }), ' Пункт может быть ниже в списке — пролистайте его.'),
          h('li', {}, h('b', { text: 'Нажмите «Добавить»' }), ' — иконка появится на главном экране.')
        ),
        h('p', { class: 'muted small', text: 'После добавления приложение открывается на весь экран и работает офлайн.' })
      )
    );

    /* --- HTTPS --- */
    var httpsPanel = panel('Почему нужен HTTPS', 'info',
      h('p', { class: 'muted small', text: 'Офлайн-режим держится на служебном работнике (service worker) — это фоновая ' +
        'программа браузера, которая кэширует страницы приложения. Браузеры разрешают её только на защищённых адресах.' }),
      h('ul', { class: 'tips' },
        h('li', {}, h('b', { text: 'HTTPS — работает.' }), ' Приложение установится и будет открываться без интернета.'),
        h('li', {}, h('b', { text: 'localhost и 127.0.0.1 — работают.' }), ' Браузер считает их защищёнными, но телефону такой адрес недоступен.'),
        h('li', {}, h('b', { text: 'Обычный http:// на другом адресе — не работает.' }), ' Страница откроется, но офлайн-режим и установка на главный экран будут недоступны.')
      ),
      !secure && url ? h('p', { class: 'warn-text', text: 'Сейчас приложение открыто по адресу ' + protocol +
        '://' + host + ' — для телефона и офлайн-режима нужен HTTPS.' }) : null
    );

    /* --- Данные --- */
    var dataPanel = panel('Данные на телефоне', 'refresh',
      h('p', { class: 'muted small', text: 'На телефоне LexiFlow начнёт с чистого листа: колоды, прогресс и статистика ' +
        'хранятся в памяти того браузера, где вы занимаетесь, и сами на другое устройство не переходят. ' +
        'Это не потеря данных — просто два независимых набора.' }),
      h('div', { class: 'install-guide' },
        h('ol', {},
          h('li', {}, 'Установите приложение на телефон и создайте там хотя бы одну колоду.'),
          h('li', {}, 'Откройте на обоих устройствах экран «Синхронизация» и свяжите их одним кодом.'),
          h('li', {}, 'После обмена колоды, слова и прогресс появятся на обоих устройствах.')
        )
      ),
      h('div', { class: 'inline-row' },
        h('button', {
          class: 'btn btn--primary btn--sm',
          onclick: function () { App.router.go('#/sync'); }
        }, icon('refresh', 15), h('span', { text: 'Открыть «Синхронизацию»' })),
        h('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: function () { App.router.go('#/data'); }
        }, icon('download', 15), h('span', { text: 'Резервная копия' }))
      )
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page page--narrow' },
      head, qrPanel, localPanel, androidPanel, iphonePanel, httpsPanel, dataPanel)]);
  }

  /* ---------- Вспомогательные блоки (в стиле views/tools.js) ---------- */

  function panel(title, iconName) {
    var children = Array.prototype.slice.call(arguments, 2);
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title' }, icon(iconName, 17), h('span', { text: title }))
      ),
      h('div', { class: 'panel__body' }, children.filter(Boolean))
    );
  }

  V.phone = {
    render: render,
    shareUrl: shareUrl,
    unreachableReason: unreachableReason,
    hostOf: hostOf,
    isSecure: isSecure
  };
})(window);

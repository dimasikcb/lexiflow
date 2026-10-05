/* ============================================================
   LexiFlow — app.js
   Роутер, оболочка интерфейса, темы, PWA (установка и офлайн).
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, S = App.store;
  var h = U.h, icon = U.icon;

  /* ============================================================
     Тема
     ============================================================ */

  var theme = {
    media: null,
    apply: function (mode) {
      var resolved = mode;
      if (mode === 'auto') {
        resolved = theme.media && theme.media.matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', resolved);
      var meta = U.qs('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0e1016' : '#f5f6fa');
      var btn = U.qs('#theme-toggle');
      if (btn) {
        U.clear(btn);
        btn.appendChild(icon(resolved === 'dark' ? 'moon' : 'sun', 18));
      }
    },
    toggle: function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      S.updateSettings({ theme: next });
      theme.apply(next);
    },
    init: function () {
      theme.media = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
      if (theme.media && theme.media.addEventListener) {
        theme.media.addEventListener('change', function () {
          if (S.settings().theme === 'auto') theme.apply('auto');
        });
      }
      theme.apply(S.settings().theme || 'auto');
    }
  };
  App.theme = theme;

  /* ============================================================
     PWA
     ============================================================ */

  var deferredPrompt = null;
  var swRegistration = null;

  var pwa = {
    init: function () {
      global.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        pwa.renderInstallBanner();
        if (U.qs('#settings')) App.router.refresh();
      });
      global.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        U.toast('LexiFlow установлен на устройство', 'ok', 3200);
        pwa.renderInstallBanner();
      });
      pwa.register();
      setTimeout(function () {
        if (pwa.canInstall() || pwa.isIosSafari()) pwa.renderInstallBanner();
      }, 2500);
    },
    register: function () {
      if (!('serviceWorker' in navigator)) return;
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        swRegistration = reg;
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              U.toast('Доступна новая версия — перезагрузите страницу', 'info', 5000);
            }
          });
        });
      }).catch(function (e) {
        console.warn('LexiFlow: service worker не зарегистрирован', e);
      });
    },
    canInstall: function () { return !!deferredPrompt; },
    isStandalone: function () {
      return (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
        global.navigator.standalone === true;
    },
    isIosSafari: function () {
      var ua = navigator.userAgent || '';
      return /iPad|iPhone|iPod/.test(ua) && !global.MSStream;
    },
    statusText: function () {
      if (!('serviceWorker' in navigator)) return 'Не поддерживается браузером';
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return 'Доступен при запуске через веб-сервер';
      if (!navigator.onLine) return 'Работает офлайн';
      return swRegistration ? 'Активен, приложение кэшировано' : 'Регистрация…';
    },
    promptInstall: function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choice) {
          if (choice.outcome === 'accepted') U.toast('Устанавливаем…', 'ok');
          deferredPrompt = null;
          pwa.renderInstallBanner();
        });
        return;
      }
      if (pwa.isIosSafari()) {
        U.modal({
          title: 'Установка на iPhone / iPad',
          body: h('div', { class: 'install-guide' },
            h('p', { text: 'Safari не показывает кнопку установки автоматически. Добавьте приложение на главный экран вручную:' }),
            h('ol', {},
              h('li', { text: 'Нажмите кнопку «Поделиться» в нижней панели Safari.' }),
              h('li', { text: 'Выберите «На экран “Домой”».' }),
              h('li', { text: 'Подтвердите — иконка LexiFlow появится среди приложений.' })
            ),
            h('p', { class: 'muted small', text: 'После установки приложение откроется в полноэкранном режиме и будет работать офлайн.' })
          ),
          actions: [{ label: 'Понятно', variant: 'primary' }]
        });
        return;
      }
      U.modal({
        title: 'Установка приложения',
        body: h('div', { class: 'install-guide' },
          h('p', { text: 'Браузер пока не предложил установку автоматически. Обычно она доступна через меню браузера:' }),
          h('ul', {},
            h('li', { text: 'Chrome / Edge: значок «Установить приложение» в адресной строке или меню «⋮» → «Установить приложение».' }),
            h('li', { text: 'Android: меню «⋮» → «Добавить на главный экран».' }),
            h('li', { text: 'Safari на Mac: «Файл» → «Добавить в Dock».' })
          )
        ),
        actions: [{ label: 'Понятно', variant: 'primary' }]
      });
    },
    update: function () {
      if (!swRegistration) { location.reload(); return; }
      swRegistration.update().then(function () {
        U.toast('Проверено. Загружаем свежую версию…', 'info');
        setTimeout(function () { location.reload(); }, 700);
      }).catch(function () { location.reload(); });
    },
    renderInstallBanner: function () {
      var bar = U.qs('#install-bar');
      if (!bar) return;
      var route = router.current || {};
      var onStudy = route.name === 'study' || route.name === 'test';
      var show = (pwa.canInstall() || (pwa.isIosSafari() && !pwa.isStandalone())) &&
        !pwa.isStandalone() && !S.get().meta.installDismissed && !onStudy;
      U.clear(bar);
      bar.classList.toggle('is-visible', !!show);
      if (!show) return;
      U.append(bar, [
        h('span', { class: 'install-bar__icon' }, icon('install', 18)),
        h('div', { class: 'install-bar__text' },
          h('b', { text: 'Установите LexiFlow' }),
          h('span', { class: 'muted small', text: 'Работает офлайн, открывается как обычное приложение' })
        ),
        h('button', { class: 'btn btn--primary btn--sm', onclick: function () { pwa.promptInstall(); } }, h('span', { text: 'Установить' })),
        h('button', {
          class: 'icon-btn', title: 'Скрыть', onclick: function () {
            S.get().meta.installDismissed = true;
            S.save();
            pwa.renderInstallBanner();
          }
        }, icon('close', 16))
      ]);
    }
  };
  App.pwa = pwa;

  /* ============================================================
     Роутер
     ============================================================ */

  var NAV = [
    { id: 'decks', label: 'Колоды', icon: 'layers', hash: '#/decks' },
    { id: 'study', label: 'Учить', icon: 'play', hash: '#/study/all' },
    { id: 'browse', label: 'Словарь', icon: 'list', hash: '#/browse/all' },
    { id: 'stats', label: 'Прогресс', icon: 'chart', hash: '#/stats' },
    { id: 'settings', label: 'Ещё', icon: 'settings', hash: '#/settings' }
  ];

  var router = {
    current: { name: 'decks', params: {} },
    primary: null,
    setPrimary: function (fn) { router.primary = fn; },

    parse: function () {
      var hash = (location.hash || '#/decks').replace(/^#\/?/, '');
      var parts = hash.split('/').filter(Boolean);
      if (!parts.length) return { name: 'decks', params: {} };
      var name = parts[0];
      var id = parts[1] || null;
      var sub = parts[2] || null;
      var map = { decks: 'decks', deck: 'deck', study: 'study', test: 'test', browse: 'browse', stats: 'stats', settings: 'settings', data: 'data', ai: 'ai', sync: 'sync', notify: 'notify', phone: 'phone' };
      return { name: map[name] || 'decks', params: { id: id, sub: sub } };
    },

    go: function (hash) {
      if (location.hash === hash) { router.render(); return; }
      location.hash = hash;
    },

    refresh: function () { router.render(); },

    render: function () {
      var route = router.parse();
      var prev = router.current;
      router.current = route;
      var root = U.qs('#view');
      if (!root) return;
      router.primary = null;

      // смена экрана закрывает открытые диалоги и сбрасывает незавершённую сессию
      U.closeModals();
      var onStudy = route.name === 'study' || route.name === 'test';
      if (!onStudy && prev && (prev.name === 'study' || prev.name === 'test')) {
        App.views.study.discard();
      }

      try {
        switch (route.name) {
          case 'deck': App.views.decks.renderDeck(root, route.params); break;
          case 'study': App.views.study.render(root, route.params); break;
          case 'test': App.views.study.renderTest(root, route.params); break;
          case 'browse': App.views.browse.render(root, route.params); break;
          case 'stats': App.views.stats.render(root, route.params); break;
          case 'settings': App.views.tools.renderSettings(root); break;
          case 'data': App.views.tools.renderData(root); break;
          case 'ai': App.views.ai.render(root); break;
          case 'sync': App.views.sync.render(root); break;
          case 'notify': App.views.notify.render(root); break;
          case 'phone': App.views.phone.render(root); break;
          default: App.views.decks.render(root, route.params);
        }
      } catch (e) {
        console.error('LexiFlow: ошибка отрисовки', e);
        U.clear(root);
        root.appendChild(h('div', { class: 'page' },
          h('div', { class: 'empty' },
            h('div', { class: 'empty__icon' }, icon('warning', 30)),
            h('h3', { class: 'empty__title', text: 'Что-то пошло не так' }),
            h('p', { class: 'empty__text', text: String(e && e.message || e) }),
            h('button', { class: 'btn btn--primary', onclick: function () { App.router.go('#/decks'); } }, h('span', { text: 'На главную' }))
          )));
      }

      router.updateNav(route);
      pwa.renderInstallBanner();
      var main = U.qs('#main');
      if (main) main.scrollTop = 0;
      global.scrollTo(0, 0);
    },

    updateNav: function (route) {
      var activeId = route.name === 'deck' ? 'decks'
        : route.name === 'test' ? 'study'
        : route.name === 'data' ? 'settings'
        : route.name;
      U.qsa('[data-nav]').forEach(function (el) {
        el.classList.toggle('is-active', el.dataset.nav === activeId);
      });
      var title = { decks: 'Колоды', deck: 'Колода', study: 'Тренировка', test: 'Тест', browse: 'Словарь', stats: 'Прогресс', settings: 'Настройки', data: 'Данные', ai: 'Промпт для нейросети', sync: 'Синхронизация', notify: 'Напоминания', phone: 'На телефон' }[route.name] || 'LexiFlow';
      document.title = 'LexiFlow — ' + title;
    }
  };
  App.router = router;

  /* ============================================================
     Оболочка
     ============================================================ */

  function buildShell() {
    var sidebar = U.qs('#sidebar');
    var tabbar = U.qs('#tabbar');

    U.clear(sidebar);
    U.append(sidebar, [
      h('div', { class: 'brand' },
        h('div', { class: 'brand__logo' }, icon('layers', 20)),
        h('div', { class: 'brand__text' },
          h('b', { text: 'LexiFlow' }),
          h('span', { text: 'интервальное повторение' })
        )
      ),
      h('nav', { class: 'nav' },
        NAV.map(function (n) {
          return h('a', {
            class: 'nav__item', href: n.hash, dataset: { nav: n.id }
          }, icon(n.icon, 19), h('span', { text: n.label }));
        })
      ),
      h('div', { class: 'nav nav--secondary' },
        h('a', { class: 'nav__item', href: '#/ai', dataset: { nav: 'ai' } }, icon('sparkle', 19), h('span', { text: 'Промпт для нейросети' })),
        h('a', { class: 'nav__item', href: '#/sync', dataset: { nav: 'sync' } }, icon('refresh', 19), h('span', { text: 'Синхронизация' })),
        h('a', { class: 'nav__item', href: '#/notify', dataset: { nav: 'notify' } }, icon('bell', 19), h('span', { text: 'Напоминания' })),
        h('a', { class: 'nav__item', href: '#/phone', dataset: { nav: 'phone' } }, icon('grid', 19), h('span', { text: 'На телефон' })),
        h('a', { class: 'nav__item', href: '#/data', dataset: { nav: 'data' } }, icon('download', 19), h('span', { text: 'Импорт / экспорт' }))
      ),
      h('div', { class: 'sidebar__foot' },
        h('button', { class: 'nav__item nav__item--btn', id: 'theme-toggle', onclick: function () { theme.toggle(); } }, icon('moon', 19), h('span', { text: 'Сменить тему' }))
      )
    ]);

    U.clear(tabbar);
    U.append(tabbar, NAV.map(function (n) {
      return h('a', { class: 'tab', href: n.hash, dataset: { nav: n.id } },
        icon(n.icon, 21), h('span', { text: n.label }));
    }));
  }

  /* ============================================================
     Инициализация
     ============================================================ */

  function init() {
    S.load();

    // первый запуск — демонстрационные колоды, чтобы приложение не выглядело пустым
    var data = S.get();
    if (!data.decks.length && !data.meta.seeded) {
      S.seedDemo();
      S.flush();
    }
    data.meta.lastOpen = Date.now();

    theme.init();
    if (S.settings().reduceMotion) document.documentElement.classList.add('reduce-motion');

    buildShell();

    global.addEventListener('hashchange', function () { router.render(); });
    if (!location.hash) location.hash = '#/decks';

    router.render();

    /* Синхронизация уже была настроена на этом устройстве — возобновляем.
       S.load() уже прогнал данные из localStorage, поэтому isConfigured()
       видит настоящие настройки. */
    if (App.sync && App.sync.isConfigured()) {
      App.sync.start();
    }

    pwa.init();

    // сохранение при уходе со страницы
    global.addEventListener('beforeunload', function () { S.flush(); });
    // pagehide — страховка для iOS Safari: beforeunload там ненадёжен,
    // а свернул приложение и потерял правки — обидно. flush() идемпотентен.
    global.addEventListener('pagehide', function () { S.flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') S.flush();
    });

    /* Правки с другого устройства. Удалил карточку на телефоне — на
       компьютере она обязана исчезнуть сама, а не ждать ручной
       синхронизации: для этого синхронизация и заведена. Обновляем только
       когда ничего не вырываем из рук (см. App.sync.shouldRefreshOnRemote). */
    if (typeof S.subscribe === 'function') {
      S.subscribe(function (reason) {
        if (String(reason || '') !== 'sync:remote') return;
        var route = router.current || {};
        var active = document.activeElement;
        if (!App.sync.shouldRefreshOnRemote({
          inSession: route.name === 'study' || route.name === 'test',
          modalOpen: !!U.qs('.modal'),
          typing: !!active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || '')
        })) return;
        router.render();
        U.toast('Данные обновлены с другого устройства', 'info', 2000);
      });
    }

    // связь между вкладками
    global.addEventListener('storage', function (e) {
      if (e.key === S.STORAGE_KEY && e.newValue) {
        try {
          S.load();
          router.render();
          U.toast('Данные обновлены в другой вкладке', 'info');
        } catch (err) { /* ignore */ }
      }
    });

    global.addEventListener('online', function () { U.toast('Соединение восстановлено', 'ok', 1600); });
    global.addEventListener('offline', function () { U.toast('Офлайн-режим: приложение продолжает работать', 'info', 2600); });

    console.log('%cLexiFlow', 'font-weight:700;color:#7c5cff', 'готово · колод: ' + data.decks.length + ', карточек: ' + data.cards.length);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);

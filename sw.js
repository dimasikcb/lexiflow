/* ============================================================
   LexiFlow — service worker
   Кэширует оболочку приложения и все ресурсы, чтобы приложение
   открывалось и работало без интернета.
   ============================================================ */

var VERSION = 'lexiflow-v1.15.0';
/* Иконки, шрифты и файлы озвучки практически не меняются — их можно брать
   из кэша сразу. Имена файлов озвучки содержат хеш содержимого, поэтому
   закешированный MP3 всегда соответствует фразе.
   Код, стили и манифест, наоборот, обновляются часто: их тянем из сети,
   а кэш используем только как запасной вариант для офлайна. */
var CACHE_FIRST = /\.(?:png|jpe?g|svg|webp|gif|ico|woff2?|ttf|mp3)$/i;
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/util.js',
  './js/srs.js',
  './js/store.js',
  './js/speech.js',
  './js/ttsnet.js',
  './js/sync.js',
  './js/notify.js',
  './js/qr.js',
  './js/app.js',
  './js/views/decks.js',
  './js/views/browse.js',
  './js/views/study.js',
  './js/views/stats.js',
  './js/views/tools.js',
  './js/views/ai.js',
  './js/views/sync.js',
  './js/views/notify.js',
  './js/views/phone.js',
  './import-templates/sample-en-ru.csv',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // каждый ресурс кэшируем отдельно: отсутствие одного не ломает установку
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== VERSION) return caches.delete(key);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Навигация: сначала сеть, при офлайне — кэшированный index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./') || new Response('Офлайн: приложение не закэшировано', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  // Иконки и шрифты: сразу из кэша, при промахе — из сети.
  if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Остальное (js, css, манифест, csv): сначала сеть, кэш — только запасной.
  // Иначе после обновления приложение ещё одну перезагрузку показывает старый код.
  event.respondWith(networkFirst(req));
});

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.status === 200 && res.type === 'basic') {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (cached) {
      return cached || new Response('', { status: 504 });
    });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(function (cached) {
    if (cached) return cached;
    return fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return new Response('', { status: 504 });
    });
  });
}

self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

/* ============================================================
   Напоминания.

   Service worker не видит localStorage, поэтому страница кладёт
   сводку в IndexedDB, а здесь мы её читаем. Схему задаёт
   js/notify.js: база lexiflow-sw, хранилище reminder, ключ state.
   ============================================================ */

var REMINDER_DB = 'lexiflow-sw';
var REMINDER_STORE = 'reminder';
var REMINDER_KEY = 'state';
var REMINDER_TAG = 'lexiflow-reminder';

function readReminder() {
  return new Promise(function (resolve) {
    var req;
    try { req = indexedDB.open(REMINDER_DB, 1); } catch (e) { resolve(null); return; }
    req.onerror = function () { resolve(null); };
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(REMINDER_STORE)) {
        db.createObjectStore(REMINDER_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = function () {
      var db = req.result;
      try {
        if (!db.objectStoreNames.contains(REMINDER_STORE)) { resolve(null); return; }
        var tx = db.transaction(REMINDER_STORE, 'readonly');
        var get = tx.objectStore(REMINDER_STORE).get(REMINDER_KEY);
        get.onsuccess = function () { resolve(get.result || null); };
        get.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    };
  });
}

/** Локальная дата в виде YYYY-MM-DD — по ней видно, показывали ли уже сегодня. */
function todayKey(d) {
  d = d || new Date();
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * Пора ли напоминать. Те же правила, что в js/notify.js shouldNotify:
 * включено, сегодня ещё не показывали, время наступило, и — если просили —
 * есть что повторять.
 */
function reminderDue(state, now) {
  if (!state || !state.enabled) return false;
  if (state.lastShown === todayKey(now)) return false;
  var parts = String(state.time || '').split(':');
  var h = parseInt(parts[0], 10), min = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(min)) return false;
  var minutesNow = now.getHours() * 60 + now.getMinutes();
  if (minutesNow < h * 60 + min) return false;
  if (state.onlyIfDue !== false && !(state.due > 0)) return false;
  return true;
}

function showReminder(state) {
  var due = state && state.due ? state.due : 0;
  var body = due > 0
    ? 'К повторению: ' + due + ' ' + pluralCards(due)
    : 'Загляните — есть что повторить.';
  return self.registration.showNotification('LexiFlow', {
    body: body,
    tag: REMINDER_TAG,
    renotify: false,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: './index.html#/study/all' }
  });
}

function pluralCards(n) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'карточка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'карточки';
  return 'карточек';
}

/**
 * Periodic Background Sync — единственный способ показать напоминание,
 * когда приложение закрыто. Поддерживается не везде (Chrome на Android
 * и в установленных PWA), поэтому это дополнение, а не основа.
 */
self.addEventListener('periodicsync', function (event) {
  if (event.tag !== 'lexiflow-reminder') return;
  event.waitUntil(readReminder().then(function (state) {
    if (reminderDue(state, new Date())) return showReminder(state);
    return null;
  }).catch(function () { return null; }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './index.html#/study/all';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if ('focus' in client) {
          if ('navigate' in client) {
            return client.navigate(target).then(function () { return client.focus(); });
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return null;
    })
  );
});

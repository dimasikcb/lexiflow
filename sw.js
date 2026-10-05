/* ============================================================
   LexiFlow â€” service worker
   ÐšÑÑˆÐ¸Ñ€ÑƒÐµÑ‚ Ð¾Ð±Ð¾Ð»Ð¾Ñ‡ÐºÑƒ Ð¿Ñ€Ð¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ñ Ð¸ Ð²ÑÐµ Ñ€ÐµÑÑƒÑ€ÑÑ‹, Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð¿Ñ€Ð¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ
   Ð¾Ñ‚ÐºÑ€Ñ‹Ð²Ð°Ð»Ð¾ÑÑŒ Ð¸ Ñ€Ð°Ð±Ð¾Ñ‚Ð°Ð»Ð¾ Ð±ÐµÐ· Ð¸Ð½Ñ‚ÐµÑ€Ð½ÐµÑ‚Ð°.
   ============================================================ */

var VERSION = 'lexiflow-v1.18.2';
/* Ð˜ÐºÐ¾Ð½ÐºÐ¸, ÑˆÑ€Ð¸Ñ„Ñ‚Ñ‹ Ð¸ Ñ„Ð°Ð¹Ð»Ñ‹ Ð¾Ð·Ð²ÑƒÑ‡ÐºÐ¸ Ð¿Ñ€Ð°ÐºÑ‚Ð¸Ñ‡ÐµÑÐºÐ¸ Ð½Ðµ Ð¼ÐµÐ½ÑÑŽÑ‚ÑÑ â€” Ð¸Ñ… Ð¼Ð¾Ð¶Ð½Ð¾ Ð±Ñ€Ð°Ñ‚ÑŒ
   Ð¸Ð· ÐºÑÑˆÐ° ÑÑ€Ð°Ð·Ñƒ. Ð˜Ð¼ÐµÐ½Ð° Ñ„Ð°Ð¹Ð»Ð¾Ð² Ð¾Ð·Ð²ÑƒÑ‡ÐºÐ¸ ÑÐ¾Ð´ÐµÑ€Ð¶Ð°Ñ‚ Ñ…ÐµÑˆ ÑÐ¾Ð´ÐµÑ€Ð¶Ð¸Ð¼Ð¾Ð³Ð¾, Ð¿Ð¾ÑÑ‚Ð¾Ð¼Ñƒ
   Ð·Ð°ÐºÐµÑˆÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð½Ñ‹Ð¹ MP3 Ð²ÑÐµÐ³Ð´Ð° ÑÐ¾Ð¾Ñ‚Ð²ÐµÑ‚ÑÑ‚Ð²ÑƒÐµÑ‚ Ñ„Ñ€Ð°Ð·Ðµ.
   ÐšÐ¾Ð´, ÑÑ‚Ð¸Ð»Ð¸ Ð¸ Ð¼Ð°Ð½Ð¸Ñ„ÐµÑÑ‚, Ð½Ð°Ð¾Ð±Ð¾Ñ€Ð¾Ñ‚, Ð¾Ð±Ð½Ð¾Ð²Ð»ÑÑŽÑ‚ÑÑ Ñ‡Ð°ÑÑ‚Ð¾: Ð¸Ñ… Ñ‚ÑÐ½ÐµÐ¼ Ð¸Ð· ÑÐµÑ‚Ð¸,
   Ð° ÐºÑÑˆ Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐµÐ¼ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ ÐºÐ°Ðº Ð·Ð°Ð¿Ð°ÑÐ½Ð¾Ð¹ Ð²Ð°Ñ€Ð¸Ð°Ð½Ñ‚ Ð´Ð»Ñ Ð¾Ñ„Ð»Ð°Ð¹Ð½Ð°. */
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
      // ÐºÐ°Ð¶Ð´Ñ‹Ð¹ Ñ€ÐµÑÑƒÑ€Ñ ÐºÑÑˆÐ¸Ñ€ÑƒÐµÐ¼ Ð¾Ñ‚Ð´ÐµÐ»ÑŒÐ½Ð¾: Ð¾Ñ‚ÑÑƒÑ‚ÑÑ‚Ð²Ð¸Ðµ Ð¾Ð´Ð½Ð¾Ð³Ð¾ Ð½Ðµ Ð»Ð¾Ð¼Ð°ÐµÑ‚ ÑƒÑÑ‚Ð°Ð½Ð¾Ð²ÐºÑƒ
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

  // ÐÐ°Ð²Ð¸Ð³Ð°Ñ†Ð¸Ñ: ÑÐ½Ð°Ñ‡Ð°Ð»Ð° ÑÐµÑ‚ÑŒ, Ð¿Ñ€Ð¸ Ð¾Ñ„Ð»Ð°Ð¹Ð½Ðµ â€” ÐºÑÑˆÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð½Ñ‹Ð¹ index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./') || new Response('ÐžÑ„Ð»Ð°Ð¹Ð½: Ð¿Ñ€Ð¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ Ð½Ðµ Ð·Ð°ÐºÑÑˆÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð¾', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  // Ð˜ÐºÐ¾Ð½ÐºÐ¸ Ð¸ ÑˆÑ€Ð¸Ñ„Ñ‚Ñ‹: ÑÑ€Ð°Ð·Ñƒ Ð¸Ð· ÐºÑÑˆÐ°, Ð¿Ñ€Ð¸ Ð¿Ñ€Ð¾Ð¼Ð°Ñ…Ðµ â€” Ð¸Ð· ÑÐµÑ‚Ð¸.
  if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // ÐžÑÑ‚Ð°Ð»ÑŒÐ½Ð¾Ðµ (js, css, Ð¼Ð°Ð½Ð¸Ñ„ÐµÑÑ‚, csv): ÑÐ½Ð°Ñ‡Ð°Ð»Ð° ÑÐµÑ‚ÑŒ, ÐºÑÑˆ â€” Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð·Ð°Ð¿Ð°ÑÐ½Ð¾Ð¹.
  // Ð˜Ð½Ð°Ñ‡Ðµ Ð¿Ð¾ÑÐ»Ðµ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ Ð¿Ñ€Ð¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ ÐµÑ‰Ñ‘ Ð¾Ð´Ð½Ñƒ Ð¿ÐµÑ€ÐµÐ·Ð°Ð³Ñ€ÑƒÐ·ÐºÑƒ Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÑ‚ ÑÑ‚Ð°Ñ€Ñ‹Ð¹ ÐºÐ¾Ð´.
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
   ÐÐ°Ð¿Ð¾Ð¼Ð¸Ð½Ð°Ð½Ð¸Ñ.

   Service worker Ð½Ðµ Ð²Ð¸Ð´Ð¸Ñ‚ localStorage, Ð¿Ð¾ÑÑ‚Ð¾Ð¼Ñƒ ÑÑ‚Ñ€Ð°Ð½Ð¸Ñ†Ð° ÐºÐ»Ð°Ð´Ñ‘Ñ‚
   ÑÐ²Ð¾Ð´ÐºÑƒ Ð² IndexedDB, Ð° Ð·Ð´ÐµÑÑŒ Ð¼Ñ‹ ÐµÑ‘ Ñ‡Ð¸Ñ‚Ð°ÐµÐ¼. Ð¡Ñ…ÐµÐ¼Ñƒ Ð·Ð°Ð´Ð°Ñ‘Ñ‚
   js/notify.js: Ð±Ð°Ð·Ð° lexiflow-sw, Ñ…Ñ€Ð°Ð½Ð¸Ð»Ð¸Ñ‰Ðµ reminder, ÐºÐ»ÑŽÑ‡ state.
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

/** Ð›Ð¾ÐºÐ°Ð»ÑŒÐ½Ð°Ñ Ð´Ð°Ñ‚Ð° Ð² Ð²Ð¸Ð´Ðµ YYYY-MM-DD â€” Ð¿Ð¾ Ð½ÐµÐ¹ Ð²Ð¸Ð´Ð½Ð¾, Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°Ð»Ð¸ Ð»Ð¸ ÑƒÐ¶Ðµ ÑÐµÐ³Ð¾Ð´Ð½Ñ. */
function todayKey(d) {
  d = d || new Date();
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * ÐŸÐ¾Ñ€Ð° Ð»Ð¸ Ð½Ð°Ð¿Ð¾Ð¼Ð¸Ð½Ð°Ñ‚ÑŒ. Ð¢Ðµ Ð¶Ðµ Ð¿Ñ€Ð°Ð²Ð¸Ð»Ð°, Ñ‡Ñ‚Ð¾ Ð² js/notify.js shouldNotify:
 * Ð²ÐºÐ»ÑŽÑ‡ÐµÐ½Ð¾, ÑÐµÐ³Ð¾Ð´Ð½Ñ ÐµÑ‰Ñ‘ Ð½Ðµ Ð¿Ð¾ÐºÐ°Ð·Ñ‹Ð²Ð°Ð»Ð¸, Ð²Ñ€ÐµÐ¼Ñ Ð½Ð°ÑÑ‚ÑƒÐ¿Ð¸Ð»Ð¾, Ð´ÐµÐ½ÑŒ Ð½ÐµÐ´ÐµÐ»Ð¸
 * Ñ€Ð°Ð·Ñ€ÐµÑˆÑ‘Ð½, Ð¸ â€” ÐµÑÐ»Ð¸ Ð¿Ñ€Ð¾ÑÐ¸Ð»Ð¸ â€” ÐµÑÑ‚ÑŒ Ñ‡Ñ‚Ð¾ Ð¿Ð¾Ð²Ñ‚Ð¾Ñ€ÑÑ‚ÑŒ.
 */
function reminderDue(state, now) {
  if (!state || !state.enabled) return false;
  if (state.lastShown === todayKey(now)) return false;
  var parts = String(state.time || '').split(':');
  var h = parseInt(parts[0], 10), min = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(min)) return false;
  var minutesNow = now.getHours() * 60 + now.getMinutes();
  if (minutesNow < h * 60 + min) return false;
  if (!reminderDayAllowed(state.days, now.getDay())) return false;
  if (state.onlyIfDue !== false && !(state.due > 0)) return false;
  return true;
}

/**
 * Ð Ð°Ð·Ñ€ÐµÑˆÑ‘Ð½ Ð»Ð¸ Ð´ÐµÐ½ÑŒ Ð½ÐµÐ´ÐµÐ»Ð¸ (0 = Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ â€¦ 6 = ÑÑƒÐ±Ð±Ð¾Ñ‚Ð°, ÐºÐ°Ðº Date.getDay).
 * ÐŸÑƒÑÑ‚Ð¾Ð¹ Ð¸Ð»Ð¸ Ð±Ð¸Ñ‚Ñ‹Ð¹ ÑÐ¿Ð¸ÑÐ¾Ðº â€” Â«Ð²ÑÐµ Ð´Ð½Ð¸Â»: Ñ‚Ð° Ð¶Ðµ ÑÐµÐ¼Ð°Ð½Ñ‚Ð¸ÐºÐ°, Ñ‡Ñ‚Ð¾ Ð² js/notify.js
 * (normalizeDays). Ð›Ð¾Ð³Ð¸ÐºÑƒ Ð´ÑƒÐ±Ð»Ð¸Ñ€ÑƒÐµÐ¼, Ð¿Ð¾Ñ‚Ð¾Ð¼Ñƒ Ñ‡Ñ‚Ð¾ notify.js Ñ€Ð°ÑÑÑ‡Ð¸Ñ‚Ð°Ð½ Ð½Ð° Ð¾ÐºÐ½Ð¾
 * (window), Ð° service worker ÐµÐ³Ð¾ Ð½Ðµ Ð²Ð¸Ð´Ð¸Ñ‚.
 */
function reminderDayAllowed(days, weekday) {
  if (!Array.isArray(days) || !days.length) return true;
  for (var i = 0; i < days.length; i++) {
    var d = Math.floor(Number(days[i]));
    if (d === weekday && d >= 0 && d <= 6) return true;
  }
  return false;
}

function showReminder(state) {
  var due = state && state.due ? state.due : 0;
  var body = due > 0
    ? 'Ðš Ð¿Ð¾Ð²Ñ‚Ð¾Ñ€ÐµÐ½Ð¸ÑŽ: ' + due + ' ' + pluralCards(due)
    : 'Ð—Ð°Ð³Ð»ÑÐ½Ð¸Ñ‚Ðµ â€” ÐµÑÑ‚ÑŒ Ñ‡Ñ‚Ð¾ Ð¿Ð¾Ð²Ñ‚Ð¾Ñ€Ð¸Ñ‚ÑŒ.';
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
  if (m10 === 1 && m100 !== 11) return 'ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ°';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ¸';
  return 'ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐµÐº';
}

/**
 * Periodic Background Sync â€” ÐµÐ´Ð¸Ð½ÑÑ‚Ð²ÐµÐ½Ð½Ñ‹Ð¹ ÑÐ¿Ð¾ÑÐ¾Ð± Ð¿Ð¾ÐºÐ°Ð·Ð°Ñ‚ÑŒ Ð½Ð°Ð¿Ð¾Ð¼Ð¸Ð½Ð°Ð½Ð¸Ðµ,
 * ÐºÐ¾Ð³Ð´Ð° Ð¿Ñ€Ð¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ Ð·Ð°ÐºÑ€Ñ‹Ñ‚Ð¾. ÐŸÐ¾Ð´Ð´ÐµÑ€Ð¶Ð¸Ð²Ð°ÐµÑ‚ÑÑ Ð½Ðµ Ð²ÐµÐ·Ð´Ðµ (Chrome Ð½Ð° Android
 * Ð¸ Ð² ÑƒÑÑ‚Ð°Ð½Ð¾Ð²Ð»ÐµÐ½Ð½Ñ‹Ñ… PWA), Ð¿Ð¾ÑÑ‚Ð¾Ð¼Ñƒ ÑÑ‚Ð¾ Ð´Ð¾Ð¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ðµ, Ð° Ð½Ðµ Ð¾ÑÐ½Ð¾Ð²Ð°.
 */
self.addEventListener('periodicsync', function (event) {
  if (event.tag !== REMINDER_TAG) return;
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

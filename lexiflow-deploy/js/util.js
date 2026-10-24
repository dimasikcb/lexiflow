/* ============================================================
   LexiFlow — util.js
   Базовые утилиты: DOM-хелперы, даты, строки, модалки, тосты.
   Без внешних зависимостей — приложение должно работать офлайн.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (global.App = global.App || {});

  /* ---------- DOM ---------- */

  function h(tag, attrs) {
    var children = Array.prototype.slice.call(arguments, 2);
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return append(node, c);
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /** Иконка (инлайновый SVG из спрайта путей). */
  function icon(name, size) {
    var p = ICONS[name] || '';
    var s = size || 20;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', s);
    svg.setAttribute('height', s);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = p;
    return svg;
  }

  var ICONS = {
    decks: '<rect x="3" y="5" width="14" height="14" rx="3"/><path d="M8 5V3.8A1.8 1.8 0 0 1 9.8 2H19a2 2 0 0 1 2 2v9.2A1.8 1.8 0 0 1 19.2 15H18"/>',
    cards: '<rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M6 3.5h12"/>',
    play: '<path d="M7 4.6v14.8a1 1 0 0 0 1.53.85l11.2-7.4a1 1 0 0 0 0-1.7L8.53 3.75A1 1 0 0 0 7 4.6Z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 17V5M7 9l5-5 5 5M5 21h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    undo: '<path d="M3 8h11a5 5 0 0 1 0 10H8"/><path d="M6 5 3 8l3 3"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    bell: '<path d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15L18 15.5Z"/><path d="M9.8 21h4.4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    fire: '<path d="M12 22c4 0 6.5-2.7 6.5-6.3 0-4.4-4.2-6.2-4.2-9.7 0-.9-.5-1.7-1.3-2 .3 1.9-.6 3.4-2 4.6C9.2 10.2 7 12 7 15.4 7 19.2 8.8 22 12 22Z"/>',
    flame: '<path d="M12 2s5 5.5 5 10a5 5 0 0 1-10 0c0-1.8.9-3.3 1.8-4.4.4 1.6 1.3 2.4 2.2 2.4 1.4 0 1.9-1.2 1.9-2.6C12.9 5.6 12 3.6 12 2Z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    tag: '<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warning: '<path d="M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M10 17h4M12 13v4M9 20h6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    install: '<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="3"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    pause: '<rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/>',
    brain: '<path d="M9.5 3.5A2.5 2.5 0 0 0 7 6v.4A3 3 0 0 0 5 9a3 3 0 0 0 .6 1.8A3 3 0 0 0 5 13a3 3 0 0 0 2 2.8V17a2.5 2.5 0 0 0 5 0V6a2.5 2.5 0 0 0-2.5-2.5Z"/><path d="M14.5 3.5A2.5 2.5 0 0 1 17 6v.4A3 3 0 0 1 19 9a3 3 0 0 1-.6 1.8A3 3 0 0 1 19 13a3 3 0 0 1-2 2.8V17a2.5 2.5 0 0 1-5 0"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>'
  };

  /* ---------- Строки / числа ---------- */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Нормализация для сравнения ответов: регистр, диакритика, пунктуация, пробелы. */
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’'`´]/g, "'")
      .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Расстояние Левенштейна (для «почти верного» ответа). */
  function levenshtein(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    var cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[b.length];
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  /* ---------- Даты ---------- */

  var MS_MIN = 60000, MS_DAY = 86400000;

  /** Начало дня (локальное время) для timestamp. */
  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Ключ дня YYYY-MM-DD в локальном времени. */
  function dayKey(ts) {
    var d = new Date(ts);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
  }

  function fmtDateTime(ts) {
    var d = new Date(ts);
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ', ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** «через 3 дн», «5 мин назад». */
  function fmtRelative(ts, now) {
    now = now || Date.now();
    var diff = ts - now;
    var abs = Math.abs(diff);
    var past = diff < 0;
    var text;
    if (abs < MS_MIN) text = 'меньше минуты';
    else if (abs < 3600000) text = Math.round(abs / MS_MIN) + ' ' + plural(Math.round(abs / MS_MIN), 'минуту', 'минуты', 'минут');
    else if (abs < MS_DAY) text = Math.round(abs / 3600000) + ' ' + plural(Math.round(abs / 3600000), 'час', 'часа', 'часов');
    else if (abs < MS_DAY * 30) text = Math.round(abs / MS_DAY) + ' ' + plural(Math.round(abs / MS_DAY), 'день', 'дня', 'дней');
    else if (abs < MS_DAY * 365) text = Math.round(abs / (MS_DAY * 30)) + ' ' + plural(Math.round(abs / (MS_DAY * 30)), 'месяц', 'месяца', 'месяцев');
    else text = Math.round(abs / (MS_DAY * 365)) + ' ' + plural(Math.round(abs / (MS_DAY * 365)), 'год', 'года', 'лет');
    if (text === 'меньше минуты') return past ? 'только что' : 'меньше минуты';
    return past ? text + ' назад' : 'через ' + text;
  }

  /** Короткая метка интервала: 10 мин / 3 д / 2 мес / 1,4 г */
  function fmtInterval(ms) {
    if (ms <= 0) return 'сейчас';
    if (ms < 3600000) {
      var m = Math.max(1, Math.round(ms / MS_MIN));
      return m + ' мин';
    }
    if (ms < MS_DAY) {
      var hh = Math.round(ms / 3600000);
      return hh + ' ' + plural(hh, 'ч', 'ч', 'ч');
    }
    var days = ms / MS_DAY;
    if (days < 30) return round1(days) + ' д';
    if (days < 365) return round1(days / 30) + ' мес';
    return round1(days / 365) + ' г';
  }

  function round1(n) {
    return (Math.round(n * 10) / 10).toString().replace('.', ',');
  }

  function fmtDuration(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' с';
    var m = Math.floor(s / 60), ss = s % 60;
    if (m < 60) return m + ':' + String(ss).padStart(2, '0');
    var h = Math.floor(m / 60);
    return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  /* ---------- Размеры данных ---------- */

  function bytesOf(str) {
    if (!str) return 0;
    if (typeof TextEncoder !== 'undefined') {
      try { return new TextEncoder().encode(str).length; } catch (e) { /* fallthrough */ }
    }
    return unescape(encodeURIComponent(str)).length;
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return round1(n / 1024) + ' КБ';
    return round1(n / (1024 * 1024)) + ' МБ';
  }

  /* ---------- Файлы ---------- */

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: (mime || 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 400);
  }

  /* ---------- Тосты ---------- */

  function toast(message, type, ms) {
    var root = qs('#toasts');
    if (!root) return;
    var icons = { ok: 'check', err: 'warning', warn: 'warning', info: 'info' };
    var node = h('div', { class: 'toast toast--' + (type || 'info') },
      icon(icons[type] || 'info', 18),
      h('span', { text: message })
    );
    root.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('is-in'); });
    setTimeout(function () {
      node.classList.remove('is-in');
      setTimeout(function () { node.remove(); }, 260);
    }, ms || 2600);
  }

  /* ---------- Модальные окна ---------- */

  function modal(opts) {
    var root = qs('#modal-root');
    var sheet = opts.sheet !== false;
    var body = h('div', { class: 'modal__body' });
    var foot = h('div', { class: 'modal__foot' });

    function close(result) {
      overlay.classList.remove('is-in');
      document.body.classList.remove('is-locked');
      setTimeout(function () { overlay.remove(); }, 200);
      if (opts.onClose) opts.onClose(result);
    }

    var titleRow = h('div', { class: 'modal__head' },
      h('h2', { class: 'modal__title', text: opts.title || '' }),
      h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onclick: function () { close(null); } }, icon('close', 18))
    );

    (opts.actions || []).forEach(function (a) {
      foot.appendChild(h('button', {
        class: 'btn ' + (a.variant ? 'btn--' + a.variant : 'btn--ghost'),
        onclick: function () {
          var r = a.onClick ? a.onClick() : undefined;
          if (r === false) return;
          if (a.keepOpen !== true) close(r === undefined ? true : r);
        }
      }, a.icon ? icon(a.icon, 17) : null, h('span', { text: a.label })));
    });
    if (foot.childNodes.length === 0) foot.remove();

    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) append(body, [opts.body]);

    var dialog = h('div', { class: 'modal' + (sheet ? ' modal--sheet' : '') }, titleRow, body, foot.childNodes.length ? foot : null);
    var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) close(null); } }, dialog);
    root.appendChild(overlay);
    document.body.classList.add('is-locked');
    requestAnimationFrame(function () { overlay.classList.add('is-in'); });

    var focusable = dialog.querySelector('input, textarea, select, button:not(.icon-btn)');
    if (focusable && opts.autofocus !== false) setTimeout(function () { focusable.focus(); }, 120);

    document.addEventListener('keydown', function onKey(e) {
      if (!document.body.contains(overlay)) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape') { close(null); }
    });

    return { close: close, body: body, dialog: dialog };
  }

  function confirmDialog(title, text, confirmLabel) {
    return new Promise(function (resolve) {
      modal({
        title: title,
        body: h('p', { class: 'modal__text', text: text }),
        actions: [
          { label: 'Отмена', variant: 'ghost', onClick: function () { resolve(false); } },
          { label: confirmLabel || 'Удалить', variant: 'danger', onClick: function () { resolve(true); } }
        ],
        onClose: function () { resolve(false); }
      });
    });
  }

  /**
   * Скопировать текст в буфер обмена.
   * С фолбэком через скрытый textarea — он нужен, когда приложение открыто
   * по file:// или в браузере без Clipboard API.
   */
  function copyText(text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(fallback()); });
      } else {
        resolve(fallback());
      }
    });
  }

  /** Принудительно закрыть все открытые модальные окна (например, при смене экрана). */
  function closeModals() {
    var root = qs('#modal-root');
    if (!root) return;
    qsa('.overlay', root).forEach(function (o) { o.remove(); });
    document.body.classList.remove('is-locked');
  }

  /* ---------- Форматирование ответа с подсветкой ошибок ---------- */

  function diffHtml(answer, expected) {
    var a = answer.split(''), b = expected.split('');
    // LCS-таблица для подсветки
    var n = a.length, m = b.length;
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = 1; i <= n; i++)
      for (var j = 1; j <= m; j++)
        dp[i][j] = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    var out = [], i2 = n, j2 = m;
    while (i2 > 0 && j2 > 0) {
      if (a[i2 - 1].toLowerCase() === b[j2 - 1].toLowerCase()) { out.unshift({ c: b[j2 - 1], ok: true }); i2--; j2--; }
      else if (dp[i2 - 1][j2] >= dp[i2][j2 - 1]) { out.unshift({ c: a[i2 - 1], ok: false }); i2--; }
      else { out.unshift({ c: b[j2 - 1], ok: false, missing: true }); j2--; }
    }
    while (i2 > 0) { out.unshift({ c: a[--i2], ok: false }); }
    while (j2 > 0) { out.unshift({ c: b[--j2], ok: false, missing: true }); }
    return out.map(function (p) {
      if (p.missing) return '<ins>' + esc(p.c) + '</ins>';
      return p.ok ? esc(p.c) : '<del>' + esc(p.c) + '</del>';
    }).join('');
  }

  App.util = {
    h: h, qs: qs, qsa: qsa, clear: clear, append: append, icon: icon, ICONS: ICONS,
    esc: esc, normalize: normalize, levenshtein: levenshtein, plural: plural, uid: uid, clamp: clamp,
    debounce: debounce, startOfDay: startOfDay, dayKey: dayKey, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    fmtRelative: fmtRelative, fmtInterval: fmtInterval, fmtDuration: fmtDuration, round1: round1,
    download: download, toast: toast, modal: modal, confirmDialog: confirmDialog, closeModals: closeModals, diffHtml: diffHtml,
    copyText: copyText,
    bytesOf: bytesOf, fmtBytes: fmtBytes,
    MS_MIN: MS_MIN, MS_DAY: MS_DAY, MONTHS_SHORT: MONTHS_SHORT, WEEKDAYS_SHORT: WEEKDAYS_SHORT
  };
})(window);

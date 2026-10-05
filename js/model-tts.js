/* ============================================================
   LexiFlow — model-tts.js
   Сменная оффлайн TTS-модель: Xenova/mms-tts-rus (VITS, ONNX,
   ~38 МБ quantized) через transformers.js v2 с CDN.

   Почему так (по отчёту исследования, run 3fbeb847):
   • text-to-speech pipeline есть только в v2 — в v3 он удалён,
     поэтому библиотека пинована на @xenova/transformers@2.7.0.
   • Файлы модели лежат на huggingface.co с CORS-заголовком,
     поэтому скачиваются прямо со страницы в Cache API.
   • Паттерн надёжности — как в ttsnet.js: промисы никогда не
     отклоняются, любая неудача = false, вызывающий код спокойно
     возвращается к системному голосу.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});

  /* Модель одна и фиксированная (MVP): русский, один голос. */
  var MODEL = {
    id: 'Xenova/mms-tts-rus',
    base: 'https://huggingface.co/Xenova/mms-tts-rus/resolve/main/',
    sizeBytes: 38362796
  };

  /* Полный набор файлов, нужный пайплайну v2 (проверено по дереву
     репозитория модели). Квантованный ONNX лежит в onnx/. */
  var FILES = [
    'config.json',
    'quantize_config.json',
    'special_tokens_map.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
    'added_tokens.json',
    'onnx/model_quantized.onnx'
  ];

  var CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.7.0';
  var WASM_PATHS = CDN + '/dist/';

  /* Кэш отдельный от lexiflow-audio-v1 и от служебного кэша service
     worker: обновление приложения не должно сносить модель, а удаление
     модели — ломать офлайн-оболочку. Ключи синтетические (.local),
     как в ttsnet.js: по ним никто не ходит, это только ключи хранилища. */
  var CACHE_NAME = 'lexiflow-tts-model';
  var KEY_PREFIX = 'https://lexiflow.local/tts-model/v1/';

  /* ---------- Состояние ---------- */

  var _state = 'idle';      // idle | downloading | ready | error
  var _lib = null;          // загруженный модуль transformers.js
  var _libPromise = null;
  var _pipe = null;         // готовый синтезатор
  var _audio = null;        // играющий Audio (держим ссылку — иначе GC оборвёт звук)
  var _url = '';            // blob-ссылка, которую надо освободить

  function state() { return _state; }

  function modelInfo() {
    return { id: MODEL.id, sizeBytes: MODEL.sizeBytes, state: _state };
  }

  function supported() {
    return typeof global.caches !== 'undefined' && typeof global.fetch === 'function';
  }

  /* ---------- Чистые функции ---------- */

  /** Адрес файла в репозитории модели. */
  function fileUrl(name) { return MODEL.base + name; }

  /** Ключ в кэше: URL файла без базовой части. */
  function fileKey(name) { return KEY_PREFIX + name; }

  /** Имя файла по ключу кэша (обратное fileKey). Иначе — null. */
  function fileFromKey(key) {
    var s = String(key);
    if (s.indexOf(KEY_PREFIX) !== 0) return null;
    return s.slice(KEY_PREFIX.length);
  }

  /**
   * Процент скачивания: сумма полученного к примерному размеру модели.
   * content-length есть не у всех файлов (tokenizer.json отдаётся без
   * него), поэтому считаем по байтам, а не по числу файлов.
   */
  function progressPct(received) {
    var sum = 0;
    received.forEach(function (n) { sum += n; });
    return Math.max(0, Math.min(99, Math.round(sum / MODEL.sizeBytes * 100)));
  }

  /** WAV-заголовок + 16-бит PCM. Чистая функция — удобно для тестов. */
  function wavBytes(samples, rate) {
    var n = samples.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buf;
  }

  /* ---------- Кэш ---------- */

  function openCache() {
    return global.caches.open(CACHE_NAME);
  }

  /** Есть ли все файлы модели в кэше. Не отклоняется. */
  function hasModel() {
    if (!supported()) return Promise.resolve(false);
    return openCache().then(function (cache) {
      return Promise.all(FILES.map(function (f) { return cache.match(fileKey(f)); }));
    }).then(function (list) {
      return list.every(Boolean);
    }).catch(function () { return false; });
  }

  /**
   * Скачать модель в кэш. Файлы идут по очереди (порядок не важен,
   * но так прогресс честный). Промис никогда не отклоняется:
   * true — скачалось, false — нет (сеть, диск, прерывание).
   * onProgress(pct) вызывается по мере получения байтов.
   */
  function downloadModel(onProgress) {
    if (!supported()) { _state = 'error'; return Promise.resolve(false); }
    if (_state === 'downloading') return Promise.resolve(false);
    _state = 'downloading';
    if (onProgress) { try { onProgress(0); } catch (e) { /* колбэк не должен ломать загрузку */ } }

    var received = [];   // байты по каждому завершённому файлу

    function fetchOne(cache, name) {
      return global.fetch(fileUrl(name), { mode: 'cors', credentials: 'omit', cache: 'no-store' })
        .then(function (res) {
          if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : 0));
          var reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
          if (!reader) {
            /* Поток недоступен (старый браузер): читаем целиком. */
            return res.arrayBuffer().then(function (buf) {
              received.push(buf.byteLength);
              return cache.put(fileKey(name), new global.Response(buf)).then(function () { return true; });
            });
          }
          var chunks = [];
          function pull() {
            return reader.read().then(function (r) {
              if (r.done) return null;
              chunks.push(r.value);
              if (onProgress) { try { onProgress(progressPct(received)); } catch (e) { /* ignore */ } }
              return pull();
            });
          }
          return pull().then(function () {
            received.push(chunks.reduce(function (a, c) { return a + c.byteLength; }, 0));
            return cache.put(fileKey(name), new global.Response(new Blob(chunks))).then(function () { return true; });
          });
        });
    }

    var chain = openCache().then(function (cache) {
      var seq = Promise.resolve();
      FILES.forEach(function (f) {
        seq = seq.then(function () {
          return fetchOne(cache, f).then(function () {
            if (onProgress) { try { onProgress(progressPct(received)); } catch (e) { /* ignore */ } }
          });
        });
      });
      return seq;
    });

    return chain.then(function () {
      _state = 'ready';
      if (onProgress) { try { onProgress(100); } catch (e) { /* ignore */ } }
      return true;
    }).catch(function () {
      _state = 'error';
      return false;
    });
  }

  /** Удалить модель из кэша. true — кэш пуст (или уже был пуст). */
  function deleteModel() {
    _state = 'idle';
    _pipe = null;
    if (!supported()) return Promise.resolve(true);
    return openCache().then(function (cache) {
      var seq = Promise.resolve();
      FILES.forEach(function (f) {
        seq = seq.then(function () { return cache.delete(fileKey(f)); });
      });
      return seq;
    }).then(function () { return true; }).catch(function () { return true; });
  }

  /* ---------- Библиотека и синтез ---------- */

  /**
   * Динамический import transformers.js v2 с CDN. Дофлайн для первой
   * версии не требуется: если CDN недоступен при синтезе — speak()
   * вернёт false, и вызывающий вернётся к системному голосу.
   */
  function loadLib() {
    if (_lib) return Promise.resolve(_lib);
    if (_libPromise) return _libPromise;
    _libPromise = import(CDN)
      .catch(function () { return import(CDN + '/dist/transformers.min.js'); })
      .then(function (m) {
        _lib = m;
        try {
          m.env.allowLocalModels = false;
          m.env.useBrowserCache = false;
          m.env.customCache = {
            match: function (url) { return cacheMatch(url); },
            put: function () { return Promise.resolve(); }
          };
          if (m.env.backends && m.env.backends.onnx && m.env.backends.onnx.wasm) {
            m.env.backends.onnx.wasm.wasmPaths = WASM_PATHS;
          }
        } catch (e) { /* настройки окружения — не повод падать */ }
        return m;
      })
      .catch(function (e) { _libPromise = null; throw e; });
    return _libPromise;
  }

  /** Ответ из нашего кэша по URL модели (или undefined — тогда библиотека пойдёт в сеть). */
  function cacheMatch(url) {
    var s = String(url && url.url ? url.url : url);
    var name = null;
    for (var i = 0; i < FILES.length; i++) {
      if (s === fileUrl(FILES[i]) || s === fileKey(FILES[i])) { name = FILES[i]; break; }
    }
    if (!name) return Promise.resolve(undefined);
    return openCache().then(function (cache) { return cache.match(fileKey(name)); })
      .catch(function () { return undefined; });
  }

  /** Синтезатор с кэшем модели. Ошибка = reject, но speak() его гасит. */
  function makePipeline() {
    if (_pipe) return Promise.resolve(_pipe);
    return loadLib().then(function (m) {
      return m.pipeline('text-to-speech', MODEL.id, { quantized: true });
    }).then(function (p) { _pipe = p; return p; });
  }

  /** Остановить текущее воспроизведение модели. */
  function stop() {
    if (_audio) {
      try { _audio.pause(); _audio.removeAttribute('src'); } catch (e) { /* ignore */ }
      _audio = null;
    }
    if (_url) { try { URL.revokeObjectURL(_url); } catch (e) { /* ignore */ } _url = ''; }
  }

  /** Сыграть WAV из Float32Array. true — пошёл звук, false — нет. */
  function playWav(samples, rate, opts) {
    return new Promise(function (resolve) {
      try {
        var blob = new Blob([wavBytes(samples, rate)], { type: 'audio/wav' });
        stop();
        _url = URL.createObjectURL(blob);
        var a = new Audio();
        _audio = a;
        a.src = _url;
        a.onended = function () {
          stop();
          if (opts && typeof opts.onend === 'function') { try { opts.onend(); } catch (e) { /* ignore */ } }
          resolve(true);
        };
        a.onerror = function () { stop(); resolve(false); };
        a.play().catch(function () { stop(); resolve(false); });
      } catch (e) { stop(); resolve(false); }
    });
  }

  /**
   * Озвучить текст моделью. Промис никогда не отклоняется:
   * true — звук пошёл, false — не получилось (нет модели, нет CDN,
   * ошибка синтеза) и вызывающий уходит на системный голос.
   */
  function speak(text, opts) {
    opts = opts || {};
    if (!supported() || !text || !String(text).trim()) return Promise.resolve(false);
    return hasModel().then(function (ok) {
      if (!ok) return false;
      return makePipeline().then(function (synth) {
        return Promise.resolve().then(function () { return synth(String(text).trim()); }).then(function (out) {
          if (!out || !out.audio || !out.sampling_rate) return false;
          return playWav(out.audio, out.sampling_rate, opts);
        });
      });
    }).catch(function () { return false; });
  }

  /* ---------- Экспорт ---------- */

  App.modelTts = {
    MODEL: MODEL,
    FILES: FILES,
    fileUrl: fileUrl,
    fileKey: fileKey,
    fileFromKey: fileFromKey,
    progressPct: progressPct,
    wavBytes: wavBytes,
    state: state,
    modelInfo: modelInfo,
    supported: supported,
    hasModel: hasModel,
    downloadModel: downloadModel,
    deleteModel: deleteModel,
    speak: speak,
    stop: stop
  };
})(window);

/**
 * LexiFlow — сборщик пакета озвучки.
 *
 * Запуск:
 *   node tools/build-audio-pack.js                  # озвучка демонстрационных колод
 *   node tools/build-audio-pack.js --data backup.json  # озвучка своих карточек
 *   node tools/build-audio-pack.js --force          # перекачать всё заново
 *
 * Что делает: берёт фразы приложения и один раз скачивает к ним озвучку
 * с бесплатного сервиса, складывая MP3 в audio/ и опись в audio/manifest.json.
 * Дальше приложение берёт эти файлы первыми — им не нужны ни интернет,
 * ни Cache API. Чего в пакете нет, то докачивается при наличии сети.
 *
 * Здесь, а не в браузере, потому что сборка идёт один раз: так мы не
 * заставляем каждого пользователя качать одно и то же.
 *
 * Ограничения, проверенные 2026-09-21:
 *   • сервис отвечает только на браузерный User-Agent (без него 403);
 *   • параметр voice= не работает — выбирать голос не из чего;
 *   • сервис бесплатный и может отказать: неудача не ломает сборку,
 *     соответствующая фраза просто останется без файла.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'audio');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/* ---------- Параметры ---------- */

const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const DATA_FILE = argValue('--data');
const FORCE = argv.includes('--force');
const CONCURRENCY = 3;

/* ---------- Загрузка модулей приложения (ключи кэша должны совпасть) ---------- */

global.window = global;
global.navigator = { userAgent: UA };
global.localStorage = {
  getItem: () => null, setItem() {}, removeItem() {}, clear() {}
};
const fakeEl = () => ({
  style: {}, classList: { add() {}, remove() {}, toggle() {} },
  appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => []
});
global.document = {
  createElement: fakeEl, createElementNS: fakeEl,
  createTextNode: t => ({ textContent: String(t) }),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {}, classList: { add() {}, remove() {} } },
  documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } },
  visibilityState: 'visible'
};

['js/util.js', 'js/srs.js', 'js/store.js', 'js/speech.js', 'js/ttsnet.js'].forEach(f => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
});

const T = App.ttsnet;

/* ---------- Какие фразы озвучивать ---------- */

function phrasesFromDemo() {
  const out = [];
  App.store.DEMO.forEach(spec => {
    spec.cards.forEach(row => {
      if (row[0]) out.push({ text: row[0], lang: spec.langFrom, kind: 'слово' });
      if (row[3]) out.push({ text: row[3], lang: spec.langFrom, kind: 'пример' });
      if (row[1]) out.push({ text: row[1], lang: spec.langTo, kind: 'перевод' });
    });
  });
  return out;
}

function phrasesFromBackup(data) {
  const langs = {};
  (data.decks || []).forEach(d => { langs[d.id] = { from: d.langFrom, to: d.langTo }; });
  const out = [];
  (data.cards || []).forEach(c => {
    const L = langs[c.deckId] || { from: 'en', to: 'ru' };
    if (c.word) out.push({ text: c.word, lang: L.from, kind: 'слово' });
    (c.examples || []).forEach(e => {
      if (e && e.text) out.push({ text: e.text, lang: L.from, kind: 'пример' });
    });
    if (c.translation) out.push({ text: c.translation, lang: L.to, kind: 'перевод' });
  });
  return out;
}

let phrases;
if (DATA_FILE) {
  const raw = fs.readFileSync(path.resolve(process.cwd(), DATA_FILE), 'utf8');
  const parsed = JSON.parse(raw);
  phrases = phrasesFromBackup(parsed.data ? parsed.data : parsed);
  console.log('Источник фраз:', DATA_FILE);
} else {
  phrases = phrasesFromDemo();
  console.log('Источник фраз: демонстрационные колоды приложения');
}

/* Одинаковые фразы не качаем дважды. */
const seen = new Set();
phrases = phrases.filter(p => {
  const k = T.cacheKey(p.text, p.lang);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
console.log('Фраз к озвучиванию:', phrases.length);

/* ---------- Скачивание ---------- */

function download(url) {
  return new Promise(resolve => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        // без identity сервер может отдать gzip, и распаковка тут ни к чему
        'Accept-Encoding': 'identity'
      },
      timeout: 20000
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ ok: false, why: 'HTTP ' + res.statusCode });
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const type = String(res.headers['content-type'] || '');
        if (!T.looksLikeAudio(type, buf.length)) {
          resolve({ ok: false, why: 'не похоже на звук (' + type + ', ' + buf.length + ' б)' });
          return;
        }
        resolve({ ok: true, buf, type });
      });
    });
    req.on('error', e => resolve({ ok: false, why: String(e && e.message || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, why: 'таймаут' }); });
  });
}

function fileNameFor(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12) + '.mp3';
}

async function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const phrasesMap = {};
  if (!FORCE && fs.existsSync(manifestPath)) {
    try {
      const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      Object.assign(phrasesMap, old.phrases || {});
    } catch (e) { /* битый манифест — просто соберём заново */ }
  }

  let done = 0, skipped = 0, failed = 0, bytes = 0;

  async function worker(queue) {
    while (queue.length) {
      const item = queue.shift();
      const key = T.cacheKey(item.text, item.lang);
      const lang = T.normLang(item.lang);

      const known = phrasesMap[key];
      if (known && !FORCE && fs.existsSync(path.join(ROOT, known.file))) {
        skipped++;
        continue;
      }

      const url = T.providerUrl(item.text, lang);
      let res = await download(url);
      if (!res.ok) res = await download(url);      // одна повторная попытка

      done++;
      if (!res.ok) {
        failed++;
        console.log('  ✗ [' + lang + '] ' + item.text.slice(0, 40) + ' — ' + res.why);
        continue;
      }

      const langDir = path.join(OUT_DIR, lang);
      fs.mkdirSync(langDir, { recursive: true });
      const rel = 'audio/' + lang + '/' + fileNameFor(key);
      fs.writeFileSync(path.join(ROOT, rel), res.buf);
      bytes += res.buf.length;

      phrasesMap[key] = {
        file: rel, lang, text: item.text, bytes: res.buf.length
      };
      process.stdout.write('\r  скачано ' + done + ' из ' + phrases.length);
    }
  }

  const queue = phrases.slice();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue)));

  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    provider: 'code.responsivevoice.org',
    /* Ключ — ровно то, что выдаёт App.ttsnet.cacheKey(), иначе приложение
       не найдёт файл. */
    phrases: phrasesMap
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

  const count = Object.keys(phrasesMap).length;
  console.log('\nГотово: фраз в пакете =', count,
    '| скачано =', done - failed, '| пропущено =', skipped, '| неудач =', failed,
    '| всего байт =', bytes);
  console.log('Манифест:', path.relative(process.cwd(), manifestPath));
}

build().catch(e => { console.error('СБОЙ:', e && e.stack || e); process.exit(1); });

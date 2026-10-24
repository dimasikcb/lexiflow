const { chromium } = require('playwright');
const fs = require('fs');

/* По умолчанию проверяем локальный сервер. Переменная окружения позволяет
   прогнать тот же набор по опубликованному адресу:
   LEXIFLOW_BASE=https://.../index.html node tools/e2e-check.js */
const BASE = process.env.LEXIFLOW_BASE || 'http://127.0.0.1:8777/index.html';
const OUT = require('path').join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const logs = [];

function log(...a) { console.log(...a); }

/* Хостинг дописывает в страницу свой маячок аналитики (beacon.cdn.qq.com,
   svibeacon.onezapp.com). Он таймаутится и сыплет ошибками в консоль,
   но к приложению не имеет отношения — как и favicon. Такой шум ошибкой
   не считаем, иначе прогон по опубликованному адресу всегда красный.
   Локально этого шума нет, и фильтр ничего не скрывает. */
const HOST_NOISE = /beacon|analytics|favicon/i;

/* Хостинг не называет адрес в тексте ошибки консоли, поэтому его
   «Failed to load resource: net::ERR_TIMED_OUT» не отличить от нашего
   по самой строке. Запоминаем момент его же неудачного запроса: если
   такая ошибка пришла сразу после него — это шум площадки, а не баг. */
let noiseFailAt = 0;
function isHostNoise(text) {
  if (HOST_NOISE.test(text || '')) return true;
  return /Failed to load resource/.test(text || '') && Date.now() - noiseFailAt < 3000;
}

/**
 * Развернуть свёрнутую панель настроек, внутри которой лежит элемент.
 * Разделы настроек — аккордеон: все панели свёрнуты, содержимое
 * появляется по клику на заголовок. Считать текст в свёрнутой панели
 * можно, а нажимать кнопки внутри — нет, поэтому раздел сначала
 * разворачиваем, как это делает человек.
 */
async function expandPanel(page, selector) {
  const need = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    const panel = el && el.closest('.panel');
    if (!panel || !panel.classList.contains('panel--folded')) return false;
    const head = panel.querySelector('.panel__head');
    if (head) head.click();
    return true;
  }, selector);
  if (need) await page.waitForTimeout(200);
}

/** Дождаться, пока в элементе появится нужный текст: сеть на живом адресе медленнее. */
async function waitForText(page, selector, re, timeout = 30000) {
  const started = Date.now();
  let text = '';
  while (Date.now() - started < timeout) {
    text = await page.evaluate(s => ((document.querySelector(s) || {}).textContent || ''), selector)
      .catch(() => '');
    if (re.test(text)) return text;
    await page.waitForTimeout(500);
  }
  return text;
}

/* Сетевая озвучка: живой сервис в тестах не используется — он чужой и
   бесплатный, зависеть от него нельзя, да и ходить на него без нужды
   незачем. Запрос подменяем заранее заготовленным MP3 (tools/fixtures).
   Маршрут ставится СРАЗУ и держится весь прогон: приложение теперь
   само уходит в сеть, если системный голос плох, а значит запрос может
   случиться на любом экране, а не только в своём разделе. */
const TTS_FIXTURE = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'sample-en.mp3'));
let ttsRouteMode = 'fixture';       // fixture | abort
const ttsRequests = [];

function installTtsRoute(target) {
  return target.route('**/code.responsivevoice.org/**', route => {
    ttsRequests.push(route.request().url());
    if (ttsRouteMode === 'abort') return route.abort();
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: TTS_FIXTURE });
  });
}

(async () => {
  /* --mute-audio: проверка кликает по кнопкам озвучки, и без этого флага
     браузер говорит вслух через системный голос — это слышно в комнате. */
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await installTtsRoute(page);

  page.on('console', m => {
    const t = m.type();
    logs.push(`[${t}] ${m.text()}`);
    if (t === 'error' && !isHostNoise(m.text())) errors.push('console.error: ' + m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => {
    if (HOST_NOISE.test(r.url())) { noiseFailAt = Date.now(); return; }
    errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText));
  });

  /* 'load', а не 'networkidle': на живом хостинге площадка подмешивает в
     страницу свой маячок, соединение не закрывается, и networkidle не
     наступает никогда. Свои ожидания ниже есть у каждого экрана. */
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  // --- 1. Главный экран ---
  const deckTiles = await page.locator('.deck-tile').count();
  const ovCards = await page.locator('.ov-card').count();
  log('Главная: колод =', deckTiles, '| карточек обзора =', ovCards);
  await page.screenshot({ path: OUT + '/01-decks.png', fullPage: true });

  // --- 2. Экран колоды ---
  await page.locator('.deck-tile').first().click();
  await page.waitForTimeout(500);
  const wordRows = await page.locator('.word-row').count();
  log('Колода: строк слов =', wordRows, '| заголовок =', await page.locator('.page-title').first().innerText());
  await page.screenshot({ path: OUT + '/02-deck.png', fullPage: true });

  // --- 3. Редактор карточки ---
  await page.locator('.action-card').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal input.input--lg').first().fill('serendipity');
  await page.locator('.modal input.input--lg').nth(1).fill('счастливая случайность');
  await page.locator('.modal input').nth(2).fill('ˌserənˈdɪpəti');
  await page.locator('.modal button:has-text("Добавить пример")').click();
  await page.locator('.modal .example-row input').first().fill('A serendipity discovery.');
  await page.screenshot({ path: OUT + '/03-card-editor.png' });
  await page.locator('.modal__foot button:has-text("Добавить")').click();
  await page.waitForTimeout(500);
  const rowsAfter = await page.locator('.word-row').count();
  log('После добавления слова: строк =', rowsAfter, '(было ' + wordRows + ')');

  // --- 4. Тренировка: режим «Карточки» ---
  await page.locator('.btn:has-text("Учить")').first().click();
  await page.waitForTimeout(400);
  log('Экран выбора режима: режимов =', await page.locator('.mode-card').count());
  await page.screenshot({ path: OUT + '/04-study-setup.png', fullPage: true });
  await page.locator('.btn:has-text("Начать тренировку")').click();
  await page.waitForTimeout(600);
  const promptText = await page.locator('.qcard__word-text').innerText().catch(() => '—');
  log('Тренировка (flip): слово =', promptText);
  await page.screenshot({ path: OUT + '/05-study-flip.png' });

  // --- 4a. Проверка озвучки в начале тренировки ---
  /* В headless-браузере голосов нет, но само по себе это больше не повод
     тревожить человека: фразы звучат из своего пакета файлов. Поэтому
     предупреждение проверяем в единственном честном виде — когда файлов
     нет совсем. Иначе тест ловил бы не баг, а правильное молчание. */
  await page.evaluate(() => {
    window.__willUseFiles = App.ttsnet.willUseFiles;
    App.ttsnet.willUseFiles = () => false;
    App.router.refresh();
  });
  await page.waitForTimeout(500);
  const ttsNotice = await page.evaluate(() => {
    const box = document.querySelector('.tts-notice');
    if (!box) return { present: false, text: '', buttons: [] };
    return {
      present: true,
      title: (box.querySelector('b') || {}).textContent || '',
      text: (box.querySelector('span') || {}).textContent || '',
      buttons: Array.prototype.map.call(box.querySelectorAll('button'), b => b.textContent.trim()).filter(Boolean),
      hasClose: !!box.querySelector('.icon-btn'),
      soft: box.classList.contains('tts-notice--soft')
    };
  });
  log('Проверка озвучки при старте: блок =', ttsNotice.present, '| заголовок =', JSON.stringify(ttsNotice.title),
      '| кнопка настроек =', ttsNotice.buttons.indexOf('Настройки озвучки') >= 0,
      '| крестик =', ttsNotice.hasClose, '| мягкий вид =', ttsNotice.soft);
  // Текст обязан быть честным: кнопка не молчит, она читает слова голосом
  // по умолчанию, то есть чужим произношением. Это проверено в аудите
  // (onstart 168 мс, onend 3031 мс, onerror нет), и прежняя формулировка
  // «кнопка будет молчать» отправляла человека искать несуществующую поломку.
  log('Проверка озвучки: совет непустой =', (ttsNotice.text || '').length > 40,
      '| сказано про Edge =', /Edge/.test(ttsNotice.text || ''),
      '| сказано про чужое произношение =', /чужим произношением/.test(ttsNotice.text || ''),
      '| прежней ошибки про молчащую кнопку нет =', !/будет молчать/.test(ttsNotice.text || ''));
  if (!/чужим произношением/.test(ttsNotice.text || '')) {
    errors.push('текст предупреждения об озвучке не объясняет, что слова прочитает чужой голос: ' + ttsNotice.text);
  }
  if (/будет молчать/.test(ttsNotice.text || '')) {
    errors.push('вернулась неверная формулировка «кнопка будет молчать»: ' + ttsNotice.text);
  }
  // В блоке должна быть кнопка действия, а не только совет уйти в настройки
  log('Проверка озвучки: кнопка скачивания в блоке =',
      ttsNotice.buttons.indexOf('Скачать качественную озвучку') >= 0,
      '| всего кнопок =', ttsNotice.buttons.join(' / '));
  await page.screenshot({ path: OUT + '/04b-study-tts-notice.png' });

  // «Больше не показывать» убирает блок и запоминается в настройках
  await page.locator('.tts-notice .icon-btn').click();
  await page.waitForTimeout(250);
  const noticeAfterClose = await page.evaluate(() => ({
    gone: document.querySelectorAll('.tts-notice').length === 0,
    seenKeys: Object.keys(App.store.settings().ttsNoticeSeen || {}),
    // карточка под блоком не должна пострадать
    word: (document.querySelector('.qcard__word-text') || {}).textContent || ''
  }));
  log('Проверка озвучки: блок убран =', noticeAfterClose.gone,
      '| запомнено ключей =', noticeAfterClose.seenKeys.length,
      '| слово на месте =', noticeAfterClose.word === promptText);

  /* И обратная сторона — та самая жалоба: файлы звучат, а приложение всё
     равно просит скачать озвучку. С рабочим пакетом блока быть не должно. */
  await page.evaluate(() => {
    App.ttsnet.willUseFiles = window.__willUseFiles;
    App.store.updateSettings({ ttsNoticeSeen: {} });
    App.router.refresh();
  });
  await page.waitForTimeout(500);
  const noticeWithFiles = await page.evaluate(() => ({
    present: !!document.querySelector('.tts-notice'),
    will: App.ttsnet.willUseFiles('en'),
    advice: App.speech.voiceAdvice(['en'])
  }));
  log('При рабочей озвучке из файлов: блок =', noticeWithFiles.present,
      '| файлом для en =', noticeWithFiles.will, '| совет =', noticeWithFiles.advice);
  if (noticeWithFiles.present) {
    errors.push('озвучка уже идёт из файлов, а блок «скачай озвучку» показан');
  }

  // --- 4b. Озвучка: кнопка «Прослушать» и субтитры ---
  const playBtn = page.locator('.qcard__word .icon-btn').first();
  log('Озвучка: кнопка прослушивания есть =', (await playBtn.count()) > 0);
  await playBtn.click();
  await page.waitForTimeout(950); // пауза между репликами (70 мс) + ожидание голосов (700 мс)
  const spoken = await page.evaluate(() => {
    const host = document.querySelector('.qcard__word-text');
    if (!host) return null;
    const words = host.querySelectorAll('.tts-word');
    return {
      words: words.length,
      // текст карточки не должен пострадать от разбивки на фрагменты
      text: host.textContent.replace(/\s+/g, ' ').trim()
    };
  });
  log('Озвучка: фрагментов-субтитров =', spoken.words,
      '| текст сохранён =', spoken.text === promptText.replace(/\s+/g, ' ').trim(),
      '| кнопка помечена как играющая =', await playBtn.evaluate(b => b.classList.contains('is-playing')));
  await page.screenshot({ path: OUT + '/05b-study-tts.png' });

  // повторное нажатие останавливает чтение и снимает отметку с кнопки
  // force: кнопка пульсирует (.is-playing), и Playwright бесконечно ждёт
  // «стабильности» — клик по анимированному элементу так не проходит
  await playBtn.click({ force: true });
  await page.waitForTimeout(250);
  log('Озвучка: отметка кнопки после повторного нажатия =', await playBtn.evaluate(b => b.classList.contains('is-playing')),
      '(в headless-браузере фраза успевает закончиться сама — контракт проверяем ниже)',
      '| App.speech.stop() снимает отметку =', await page.evaluate(() => {
        const b = document.querySelector('.qcard__word .icon-btn');
        App.speech.speak('test', 'en', {});
        b.classList.add('is-playing');
        App.speech.stop();
        const cleared = !b.classList.contains('is-playing');
        b.classList.remove('is-playing');
        return cleared;
      }));

  // ветка «остановить» проверяется детерминированно: два клика без пауз
  const toggle = await page.evaluate(() => {
    const b = App.speech.audioButton('hello world', 'en', {});
    document.body.appendChild(b);
    b.click();
    const afterFirst = b.classList.contains('is-playing');
    b.click();
    const afterSecond = b.classList.contains('is-playing');
    b.remove();
    App.speech.stop();
    return { afterFirst, afterSecond };
  });
  log('Озвучка: двойной клик — играет после 1-го =', toggle.afterFirst, ', после 2-го =', toggle.afterSecond);

  // Уход с экрана обязан останавливать чтение: иначе слово продолжает
  // звучать из свёрнутого окна или из другого приложения.
  const hiddenStops = await page.evaluate(async () => {
    const b = App.speech.audioButton('leaving the app', 'en', {});
    document.body.appendChild(b);
    b.click();
    await new Promise(r => setTimeout(r, 250));
    const before = b.classList.contains('is-playing');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const after = b.classList.contains('is-playing');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const afterReturn = b.classList.contains('is-playing');
    b.remove();
    App.speech.stop();
    return { before, after, afterReturn };
  });
  log('Озвучка: уход с экрана — играло до =', hiddenStops.before, ', после =', hiddenStops.after,
      '| возврат на экран не возобновляет =', hiddenStops.afterReturn === false,
      '(ожидается true → false → false)');
  await page.locator('.btn:has-text("Показать ответ")').click();
  await page.waitForTimeout(400);
  const rates = await page.locator('.rate').count();
  const intervals = await page.locator('.rate__interval').allInnerTexts();
  log('Показан ответ: кнопок оценки =', rates, '| интервалы =', intervals.join(' / '));
  await page.screenshot({ path: OUT + '/06-study-answer.png' });

  // субтитры в предложении-примере: каждое слово становится отдельным фрагментом
  const exPlay = page.locator('.qcard__examples .icon-btn').first();
  if (await exPlay.count()) {
    await exPlay.click();
    await page.waitForTimeout(950);
    const exSplit = await page.evaluate(() => {
      const host = document.querySelector('.qcard__example-text');
      if (!host) return null;
      return {
        words: host.querySelectorAll('.tts-word').length,
        text: host.textContent.replace(/\s+/g, ' ').trim()
      };
    });
    log('Озвучка примера: фрагментов =', exSplit.words, '| текст =', JSON.stringify(exSplit.text));
    await page.screenshot({ path: OUT + '/06b-study-example-tts.png' });
    await exPlay.click();
    await page.waitForTimeout(200);
  }
  // оценка «Нормально» + отмена
  await page.locator('.rate').nth(2).click();
  await page.waitForTimeout(400);
  const afterUndoBefore = await page.locator('.study__meter-label').innerText();
  await page.locator('#undo-btn').click();
  await page.waitForTimeout(400);
  const afterUndo = await page.locator('.study__meter-label').innerText();
  log('Отмена ответа:', afterUndoBefore, '→', afterUndo);
  const undoBackCard = await page.locator('.qcard__word-text').innerText().catch(() => '—');
  log('После отмены снова показана карточка:', undoBackCard, '(ожидалось:', promptText + ')');
  await page.locator('.btn:has-text("Показать ответ")').click();
  await page.waitForTimeout(300);
  await page.locator('.rate').nth(2).click();
  await page.waitForTimeout(300);

  // --- 4c. Повторный вход в ту же колоду: предупреждение не возвращается ---
  // Отказ запоминается по набору языков, поэтому та же колода больше не
  // должна показывать блок — иначе он мозолил бы глаза каждый раз.
  await page.goto(BASE + '#/decks', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.locator('.deck-tile').first().click();
  await page.waitForTimeout(400);
  await page.locator('.btn:has-text("Учить")').first().click();
  await page.waitForTimeout(300);
  await page.locator('.btn:has-text("Начать тренировку")').click();
  await page.waitForTimeout(600);
  log('Проверка озвучки: в той же колоде блок не возвращается =',
      (await page.locator('.tts-notice').count()) === 0);

  // --- 5. Режим «Выбор варианта» ---
  await page.goto(BASE + '#/study/all', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.locator('.mode-card:has-text("Выбор варианта")').click();
  await page.locator('.btn:has-text("Начать тренировку")').click();
  await page.waitForTimeout(600);
  const choices = await page.locator('.choice').count();
  log('Режим выбора: вариантов =', choices);
  const noticeAgain = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.tts-notice').length,
    title: (document.querySelector('.tts-notice b') || {}).textContent || '',
    seen: Object.keys(App.store.settings().ttsNoticeSeen || {})
  }));
  // Здесь тренировка идёт по ВСЕМ колодам, а во второй демо-колоде немецкий.
  // Новый язык — новое предупреждение, и это правильно: про немецкий человек
  // ещё ничего не закрывал.
  log('Проверка озвучки: новый язык в сессии — блок уместен снова =', noticeAgain.blocks === 1,
      '| заголовок =', JSON.stringify(noticeAgain.title),
      '| запомненные ключи =', noticeAgain.seen.join(' / '));
  await page.screenshot({ path: OUT + '/07-study-choice.png' });
  await page.locator('.choice').first().click();
  await page.waitForTimeout(400);
  log('Ответ выбран, подсветка:', await page.locator('.choice.is-correct, .choice.is-wrong').count(), 'вариант(ов)');
  await page.screenshot({ path: OUT + '/08-study-choice-answered.png' });

  // --- 6. Режим «Ввод перевода» ---
  await page.goto(BASE + '#/study/all', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.locator('.mode-card:has-text("Ввод перевода")').click();
  await page.locator('.btn:has-text("Начать тренировку")').click();
  await page.waitForTimeout(500);
  await page.locator('.input--answer').fill('тест ответа');
  await page.locator('.input--answer').press('Enter');
  await page.waitForTimeout(400);
  log('Ввод перевода: результат =', await page.locator('.typing__verdict').innerText().catch(() => '—'));
  await page.screenshot({ path: OUT + '/09-study-typing.png' });

  // --- 7. Тест ---
  await page.goto(BASE + '#/test/all', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  log('Тест: панель параметров, режимов =', await page.locator('.mode-card').count());
  await page.screenshot({ path: OUT + '/10-test-setup.png', fullPage: true });
  await page.locator('.btn:has-text("Начать тест")').click();
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    const ch = page.locator('.choice').first();
    if (await ch.count()) {
      await ch.click();
      await page.waitForTimeout(250);
      const next = page.locator('.btn:has-text("Далее")');
      if (await next.count()) { await next.click(); await page.waitForTimeout(300); }
    }
  }
  log('Тест идёт, прогресс =', await page.locator('.study__meter-label').innerText().catch(() => '—'));

  // --- 8. Статистика ---
  await page.goto(BASE + '#/stats', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  log('Статистика: KPI =', await page.locator('.kpi').count(),
      '| графиков =', await page.locator('svg.chart').count(),
      '| heatmap-ячеек =', await page.locator('.heat').count(),
      '| строк таблицы =', await page.locator('.table tbody tr').count());
  await page.screenshot({ path: OUT + '/11-stats.png', fullPage: true });

  // --- 9. Словарь ---
  await page.goto(BASE + '#/browse/all', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  log('Словарь: строк =', await page.locator('.browse-row').count());
  await page.locator('.check input').first().check();
  await page.waitForTimeout(300);
  log('Массовые операции: панель видна =', await page.locator('.bulk-bar .bulk-bar__count').count() > 0);
  await page.screenshot({ path: OUT + '/12-browse.png', fullPage: true });

  // --- 10. Данные ---
  await page.goto(BASE + '#/data', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  log('Данные: панелей =', await page.locator('.panel').count(),
      '| строк экспорта =', await page.locator('.export-row').count(),
      '| форматов =', await page.locator('.format-card').count());
  await page.screenshot({ path: OUT + '/13-data.png', fullPage: true });

  // --- 10b. Страница «Промпт для нейросети» (конструктор) ---
  await page.locator('.btn:has-text("Промпт для нейросети")').click();
  await page.waitForTimeout(600);
  const ai1 = await page.locator('#ai-prompt').inputValue();
  log('Промпт: строк =', ai1.split('\n').length,
      '| заголовки CSV =', ai1.indexOf('Слово,Перевод,Транскрипция,Пример,Перевод примера') > 0,
      '| тема =', /«(.+?)»/.exec(ai1)[1]);
  // переключаем «два примера» и колонку «Колода»
  await page.locator('.segmented__item:has-text("Два")').click();
  await page.locator('.setting-row--switch').click();
  await page.waitForTimeout(400);
  const ai2 = await page.locator('#ai-prompt').inputValue();
  log('Конструктор: «Пример 2» в заголовках =', ai2.indexOf('Пример 2') > 0,
      '| колонка «Колода» =', ai2.indexOf('Колода,Слово') > 0,
      '| инструкция про подтемы =', ai2.indexOf('по 3–4 подтемам') > 0);
  await page.locator('.btn:has-text("Скопировать промпт")').click();
  await page.waitForTimeout(400);
  log('Копирование промпта:', JSON.stringify(await page.locator('#toasts .toast').first().innerText().catch(() => '—')));
  await page.screenshot({ path: OUT + '/13b-ai-prompt.png', fullPage: true });
  await page.goto(BASE + '#/data', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // --- 10c. Импорт готового файла из import-templates ---
  await page.locator('input[type="file"]').first().setInputFiles(
    require('path').join(__dirname, '..', 'import-templates', 'sample-en-ru.csv')
  );
  await page.waitForTimeout(700);
  log('Файл примера загружен в поле, символов =', (await page.locator('.input--area').first().inputValue()).length);
  await page.locator('.btn:has-text("Импортировать")').click();
  await page.waitForTimeout(800);
  const sample = await page.evaluate(() => {
    const d = App.store.get().decks.filter(x => x.name === 'Пример: английский')[0];
    if (!d) return null;
    const cards = App.store.cardsOf(d.id);
    return {
      cards: cards.length,
      twoExamples: cards.filter(c => c.examples.length === 2).length,
      sample: cards.filter(c => c.word === 'to commute')[0].examples.map(e => e.text + ' / ' + e.translation).join(' | ')
    };
  });
  log('Импорт файла примера:', JSON.stringify(sample));
  await page.screenshot({ path: OUT + '/13c-sample-import.png', fullPage: true });

  // --- 11. Импорт CSV (проверка логики) ---
  const importArea = page.locator('.input--area').first();
  await importArea.fill('word,translation,transcription\nnimble,ловкий,ˈnɪmbl\nresilient,стойкий,rɪˈzɪliənt');
  await page.locator('.btn:has-text("Импортировать")').click();
  await page.waitForTimeout(600);
  const decksNow = await page.evaluate(() => App.store.get().decks.length);
  const cardsNow = await page.evaluate(() => App.store.get().cards.length);
  log('После импорта CSV: колод =', decksNow, '| карточек =', cardsNow);
  await page.screenshot({ path: OUT + '/14-import.png', fullPage: true });

  // --- 11b. Импорт JSON-бэкапа без замены (слияние, всё должно уйти в дубликаты) ---
  const backup = await page.evaluate(() => App.store.exportAll());
  await importArea.fill(backup);
  await page.locator('.btn:has-text("Импортировать")').click();
  await page.waitForTimeout(700);
  const afterJson = await page.evaluate(() => ({
    decks: App.store.get().decks.length,
    cards: App.store.get().cards.length,
    decksOk: App.store.get().decks.every(d => !!d.id && !!d.settings)
  }));
  log('После импорта JSON-копии (слияние): колод =', afterJson.decks, '| карточек =', afterJson.cards,
      '| целостность колод =', afterJson.decksOk);
  await page.screenshot({ path: OUT + '/14b-import-json.png', fullPage: true });

  // --- 11c. Импорт CSV с примерами на двух языках (и вторым примером) ---
  await importArea.fill(
    'Слово,Перевод,Транскрипция,Пример,Перевод примера,Пример 2,Перевод примера 2\n' +
    'brisk,бодрый,brɪsk,"A brisk walk helps.","Бодрая прогулка помогает.","The air was brisk.","Воздух был свежим."'
  );
  await page.locator('.btn:has-text("Импортировать")').click();
  await page.waitForTimeout(700);
  const bi = await page.evaluate(() => {
    const c = App.store.get().cards.filter(x => x.word === 'brisk')[0];
    return c ? c.examples.map(e => e.text + ' / ' + e.translation) : null;
  });
  log('Импорт примера на двух языках:', bi ? bi.join('  |  ') : 'карточка не найдена');
  await page.screenshot({ path: OUT + '/14c-import-bilingual.png', fullPage: true });

  // карточка в колоде: пример + перевод + счётчик дополнительных примеров
  const briskDeck = await page.evaluate(() => {
    const c = App.store.get().cards.filter(x => x.word === 'brisk')[0];
    return c ? c.deckId : null;
  });
  await page.goto(BASE + '#/deck/' + briskDeck, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const exLine = await page.locator('.word-row:has-text("brisk") .word-row__example').innerText().catch(() => '—');
  log('Строка слова в колоде:', JSON.stringify(exLine));
  await page.screenshot({ path: OUT + '/14d-deck-bilingual.png', fullPage: true });

  // --- 12. Настройки ---
  await page.goto(BASE + '#/settings', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  log('Настройки: секций =', await page.locator('.panel').count(),
      '| переключателей =', await page.locator('.switch').count(),
      '| кнопка промпта =', (await page.locator('.btn:has-text("Промпт для нейросети")').count()) > 0);
  const ttsUi = await page.evaluate(() => ({
    sliders: document.querySelectorAll('.range-row').length,
    values: Array.prototype.map.call(document.querySelectorAll('.range-row__value'), e => e.textContent.trim()),
    voiceRows: document.querySelectorAll('.voice-rows .setting-row').length,
    selects: document.querySelectorAll('.voice-rows select').length,
    samples: Array.prototype.filter.call(document.querySelectorAll('.voice-rows .btn'), b => /Прослушать/.test(b.textContent)).length,
    hint: (document.querySelector('.voice-rows') && document.querySelector('.voice-rows').closest('.panel'))
      ? /Natural|Neural|Google/.test(document.querySelector('.voice-rows').closest('.panel').textContent) : false,
    // страховка от «0 undefined» и прочих недописанных подписей
    undefinedText: /undefined|NaN|\[object/.test(document.querySelector('.voice-rows').textContent),
    // вердикт о качестве голоса: пользователь должен видеть, что звучит и что делать
    diagLevels: Array.prototype.map.call(document.querySelectorAll('.voice-diag'), e => e.className.replace('voice-diag ', '')),
    diagAdvice: Array.prototype.map.call(document.querySelectorAll('.voice-diag__fix'), e => e.textContent.length),
    badges: Array.prototype.map.call(document.querySelectorAll('.quality-badge'), e => e.textContent)
  }));
  log('Озвучка в настройках: ползунков =', ttsUi.sliders, '| значения =', ttsUi.values.join(' / '),
      '| строк голосов =', ttsUi.voiceRows, '| списков =', ttsUi.selects,
      '| кнопок прослушивания =', ttsUi.samples, '| подсказка про нейросетевые голоса =', ttsUi.hint,
      '| текст без «undefined» =', !ttsUi.undefinedText);
  log('Диагностика голоса: блоков =', ttsUi.diagLevels.length, '| вердикт =', ttsUi.diagLevels.join(','),
      '| совет непустой =', ttsUi.diagAdvice.every(n => n > 40), '| метки голосов =', ttsUi.badges.join(' / '));
  await page.screenshot({ path: OUT + '/15-settings.png', fullPage: true });

  // --- 12a. Сетевая озвучка: скачивание и работа офлайн ---
  // Маршрут подмены уже стоит с самого начала прогона (см. installTtsRoute).
  // Офлайн доказывается так: после скачивания маршрут ОБРЫВАЕТСЯ, и фраза
  // всё равно играет, а новых запросов при этом не появляется — значит,
  // звук пришёл из кэша, а не из сети.

  await page.goto(BASE + '#/settings', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const netUi = await page.evaluate(() => ({
    block: !!document.querySelector('.tts-net'),
    warn: (document.querySelector('.tts-net__warn') || {}).textContent || '',
    switchOn: !!(document.querySelector('.tts-net .switch input') || {}).checked,
    stored: App.store.settings().ttsNet,
    buttons: Array.prototype.map.call(document.querySelectorAll('.tts-net button'), b => b.textContent.trim()).filter(Boolean),
    deckSelect: !!document.querySelector('.tts-net select'),
    status: (document.querySelector('.tts-net__status') || {}).textContent || '',
    available: App.ttsnet.available()
  }));
  log('Сетевая озвучка: блок в настройках =', netUi.block,
      '| включена по умолчанию =', netUi.switchOn === true,
      '| в данных =', JSON.stringify(netUi.stored),
      '| список колод =', netUi.deckSelect,
      '| кнопки =', netUi.buttons.join(' / '));
  log('Сетевая озвучка: предупреждения — интернет =', /интернет/i.test(netUi.warn),
      '| сторонний сервис назван =', /code\.responsivevoice\.org/.test(netUi.warn),
      '| работает без интернета после загрузки =', /без интернета/i.test(netUi.warn),
      '| честно про отказ сервиса =', /может перестать работать|может отказать/.test(netUi.warn),
      '| статус =', JSON.stringify(netUi.status));
  /* Режим включён по умолчанию, потому что сам решает, идти ли в сеть:
     при хорошем системном голосе он молчит. Проверяем именно это —
     и что выключить его можно. */
  if (netUi.switchOn !== true) errors.push('сетевая озвучка не включена по умолчанию');
  if (!/code\.responsivevoice\.org/.test(netUi.warn)) {
    errors.push('в интерфейсе не сказано, на какой сторонний сервис уходит текст');
  }
  await page.screenshot({ path: OUT + '/15e-tts-net.png', fullPage: true });

  /* Разделы настроек — аккордеон: все панели свёрнуты, содержимое
     появляется по клику на заголовок. Считать текст в свёрнутой
     панели можно, а нажимать кнопки внутри — нет, поэтому раздел
     озвучки сначала разворачиваем, как это делает человек. */
  await expandPanel(page, '.tts-net');

  // Включаем режим — это и есть осознанное действие пользователя.
  await page.locator('.tts-net .switch input').check();
  await page.waitForTimeout(300);
  const netOn = await page.evaluate(() => ({
    on: App.store.settings().ttsNet.enabled,
    available: App.ttsnet.available(),
    online: navigator.onLine
  }));
  log('Сетевая озвучка: после включения — в настройках =', netOn.on,
      '| доступна =', netOn.available, '| сеть =', netOn.online);

  // Скачиваем озвучку выбранной колоды с прогрессом.
  const requestsBefore = ttsRequests.length;
  await page.locator('.tts-net .btn:has-text("Скачать озвучку")').click();
  /* Не фиксированная пауза, а ожидание результата: на живом адресе сеть
     медленнее, и пять секунд там не хватало — тест ловил «Скачиваю: 28 из 39»
     и объявлял это багом приложения. */
  await waitForText(page, '.tts-net__progress', /Готово|Частично|Не удалось/);
  const afterDownload = await page.evaluate(async () => ({
    stats: await App.ttsnet.stats(),
    status: (document.querySelector('.tts-net__status') || {}).textContent || '',
    progress: (document.querySelector('.tts-net__progress') || {}).textContent || '',
    done: /Готово/.test((document.querySelector('.tts-net__progress') || {}).textContent || ''),
    selected: (document.querySelector('.tts-net select') || {}).value || ''
  }));
  log('Сетевая озвучка: запросов к сервису =', ttsRequests.length - requestsBefore,
      '| фраз в кэше =', afterDownload.stats.count, '| размер =', afterDownload.stats.bytes,
      '| подтверждение =', JSON.stringify(afterDownload.progress));
  log('Сетевая озвучка: строка состояния =', JSON.stringify(afterDownload.status));
  if (afterDownload.stats.count < 1) {
    errors.push('после скачивания в кэше нет ни одной фразы: ' + JSON.stringify(afterDownload.stats));
  }
  if (!afterDownload.done) {
    errors.push('пользователю не показано подтверждение загрузки: ' + afterDownload.progress);
  }
  await page.screenshot({ path: OUT + '/15f-tts-net-done.png', fullPage: true });

  // Главное доказательство: сеть обрывается, а фраза всё равно звучит.
  ttsRouteMode = 'abort';
  const requestsBeforeOffline = ttsRequests.length;
  const offline = await page.evaluate(async () => {
    const deckId = document.querySelector('.tts-net select').value;
    const deck = App.store.getDeck(deckId);
    const card = App.store.cardsOf(deckId).filter(c => c.word)[0];
    const lang = App.speech.baseLang(deck.langFrom);
    const before = await App.ttsnet.stats();
    const played = await App.ttsnet.play(card.word, lang, {});
    const blob = await App.ttsnet.getAudio(card.word, lang);
    const after = await App.ttsnet.stats();
    return {
      phrase: card.word, lang, played,
      fromCache: !!(blob && blob.size > 0),
      before: before.count, after: after.count
    };
  });
  const requestsDuringOffline = ttsRequests.length - requestsBeforeOffline;
  log('Офлайн-проверка: сеть оборвана, фраза =', JSON.stringify(offline.phrase), '(', offline.lang, ')',
      '| заиграла =', offline.played,
      '| отдана из кэша =', offline.fromCache,
      '| фраз в кэше до =', offline.before, 'после =', offline.after,
      '| обращений в сеть за это время =', requestsDuringOffline);
  if (!offline.played) errors.push('с оборванной сетью фраза не заиграла — офлайн-режим не работает');
  if (!offline.fromCache) errors.push('с оборванной сетью фраза не отдана из кэша');
  if (requestsDuringOffline !== 0) {
    errors.push('при проигрывании фраза пошла в сеть, хотя лежала в кэше (' + requestsDuringOffline + ' запросов)');
  }

  // Кнопка 🔊 должна пользоваться тем же путём: скачанный файл, а не синтез.
  const buttonPath = await page.evaluate(async () => {
    const deckId = document.querySelector('.tts-net select').value;
    const deck = App.store.getDeck(deckId);
    const card = App.store.cardsOf(deckId).filter(c => c.word)[0];
    const lang = App.speech.baseLang(deck.langFrom);
    const btn = App.speech.audioButton(card.word, lang, {});
    document.body.appendChild(btn);
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    const playing = btn.classList.contains('is-playing');
    btn.click();
    const stopped = !btn.classList.contains('is-playing');
    btn.remove();
    App.speech.stop();
    return { playing, stopped };
  });
  log('Кнопка озвучки: играет через скачанный файл =', buttonPath.playing,
      '| повторное нажатие останавливает =', buttonPath.stopped);
  if (!buttonPath.playing) {
    errors.push('кнопка 🔊 не воспользовалась скачанной озвучкой при включённом режиме');
  }

  // Очистка кэша: удаляет файлы и обнуляет счётчик.
  const purged = await page.evaluate(async () => {
    const before = await App.ttsnet.stats();
    document.querySelector('.tts-net .btn--danger').click();
    await new Promise(r => setTimeout(r, 200));
    const confirm = document.querySelector('.modal__foot .btn--danger, .modal__foot .btn--primary');
    if (confirm) confirm.click();
    await new Promise(r => setTimeout(r, 600));
    return { before: before.count, after: (await App.ttsnet.stats()).count };
  });
  log('Очистка кэша озвучки: было фраз =', purged.before, '→ стало =', purged.after);
  if (purged.after !== 0) errors.push('очистка кэша озвучки не сработала: осталось ' + purged.after);

  // Блок предупреждения в тренировке умеет не только советовать, но и
  // скачать озвучку прямо из сессии — по фразам этой самой тренировки.
  ttsRouteMode = 'fixture';
  await page.evaluate(() => App.store.updateSettings({ ttsNoticeSeen: {} }));
  await page.goto(BASE + '#/study/all', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  /* Свой пакет закрывает язык файлами, и блок бы не показался — здесь
     проверяется именно его скачивающая кнопка, поэтому файлы «выключаем». */
  await page.evaluate(() => { App.ttsnet.willUseFiles = () => false; });
  await page.locator('.btn:has-text("Начать тренировку")').click();
  await page.waitForTimeout(800);
  const studyNotice = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.tts-notice').length,
    hasButton: Array.prototype.some.call(document.querySelectorAll('.tts-notice button'),
      b => /Скачать качественную озвучку/.test(b.textContent))
  }));
  log('Скачивание из тренировки: блок =', studyNotice.blocks, '| кнопка в блоке =', studyNotice.hasButton);
  if (!studyNotice.hasButton) errors.push('в блоке предупреждения нет кнопки скачивания озвучки');

  const requestsBeforeStudy = ttsRequests.length;
  await page.locator('.tts-notice .btn--primary').click();
  await page.waitForTimeout(300);
  const askedConsent = await page.evaluate(() =>
    /code\.responsivevoice\.org/.test((document.querySelector('.modal__text') || {}).textContent || ''));
  await page.locator('.modal__foot .btn--danger').click();
  await waitForText(page, '.tts-notice__progress', /Готово|Частично|Не удалось/);
  const studyResult = await page.evaluate(async () => ({
    text: (document.querySelector('.tts-notice__progress') || {}).textContent || '',
    stats: await App.ttsnet.stats(),
    enabled: App.store.settings().ttsNet.enabled
  }));
  log('Скачивание из тренировки: спрошено согласие =', askedConsent,
      '| запросов =', ttsRequests.length - requestsBeforeStudy,
      '| фраз в кэше =', studyResult.stats.count,
      '| режим включён =', studyResult.enabled);
  log('Скачивание из тренировки: подтверждение =', JSON.stringify(studyResult.text));
  if (!askedConsent) errors.push('перед отправкой текста на сторонний сервис согласие не спрошено');
  if (!studyResult.enabled) errors.push('кнопка в тренировке не включила сетевую озвучку');
  if (!/Готово|Частично|Не удалось/.test(studyResult.text)) {
    errors.push('после скачивания из тренировки не показан результат: ' + studyResult.text);
  }
  await page.screenshot({ path: OUT + '/15g-tts-net-study.png', fullPage: true });

  // Возвращаем как было: режим выключен, кэш очищен, маршрут снят.
  await page.evaluate(async () => {
    App.ttsnet.stop();
    await App.ttsnet.purge();
    App.store.updateSettings({ ttsNet: { enabled: false, downloaded: 0 } });
  });
  /* Маршрут не снимаем до конца прогона: режим выключен, но если какой-то
     экран всё же дёрнет озвучку, запрос должен уйти в заглушку, а не на
     чужой живой сервис. */

  // --- 12a2. Пакет озвучки внутри приложения ---
  // Это и есть «из своей базы»: готовые файлы лежат рядом с кодом, поэтому
  // озвучка работает без интернета и при выключенном сетевом режиме.
  // Маршрут к сервису в этот момент обрывает запросы (см. выше), так что
  // любой звук здесь — доказанно из файлов приложения.
  ttsRouteMode = 'abort';
  const requestsBeforePack = ttsRequests.length;
  const packUi = await page.evaluate(async () => {
    await App.ttsnet.purge();                 // кэш пуст: только пакет
    const m = await App.ttsnet.loadPack();
    return {
      loaded: !!m,
      count: m && m.phrases ? Object.keys(m.phrases).length : 0,
      word: App.ttsnet.packFile('although', 'en'),
      de: App.ttsnet.packFile('der Termin', 'de'),
      missing: App.ttsnet.packFile('такой фразы в пакете нет', 'en'),
      hasPack: App.ttsnet.hasPack(),
      played: await App.ttsnet.play('although', 'en'),
      cached: (await App.ttsnet.stats()).count
    };
  });
  log('Пакет озвучки: загружен =', packUi.loaded, '| фраз =', packUi.count,
      '| слово en =', packUi.word, '| слово de =', packUi.de, '| чужое =', packUi.missing);
  log('Пакет без сервиса: проигралось =', packUi.played,
      '| фраз в кэше =', packUi.cached, '(0 — звук взят из файлов)',
      '| запросов к сервису =', ttsRequests.length - requestsBeforePack);
  if (!packUi.loaded || !packUi.count) errors.push('пакет озвучки приложения не загрузился');
  if (packUi.missing !== null) errors.push('пакет отдал файл для фразы, которой в нём нет');
  if (!packUi.played) errors.push('фраза из пакета не проигралась при отрезанном сервисе');
  if (ttsRequests.length !== requestsBeforePack) {
    errors.push('озвучка из пакета полезла в интернет: ' + (ttsRequests.length - requestsBeforePack) + ' запросов');
  }
  await page.screenshot({ path: OUT + '/15h-tts-pack.png', fullPage: true });

  // --- 12b. Синхронизация ---
  await page.goto(BASE + '#/sync', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const syncUi = await page.evaluate(() => ({
    panels: document.querySelectorAll('.panel').length,
    hasInput: !!document.querySelector('.panel input'),
    buttons: Array.prototype.map.call(document.querySelectorAll('.panel button'), b => b.textContent.trim()).filter(Boolean),
    title: (document.querySelector('.page-title') || {}).textContent || ''
  }));
  log('Синхронизация: заголовок =', JSON.stringify(syncUi.title), '| панелей =', syncUi.panels,
      '| поле токена =', syncUi.hasInput, '| кнопки =', syncUi.buttons.slice(0, 6).join(' / '));
  // токен не должен попадать ни в разметку, ни в статус
  const tokenLeak = await page.evaluate(() => {
    App.store.updateSettings({ sync: { provider: 'gist', token: 'ghp_TESTTOKEN', gistId: 'g1', auto: false } });
    const html = document.body.innerHTML;
    const backup = App.store.exportAll();
    const payload = JSON.stringify(App.store.syncPayload());
    App.store.updateSettings({ sync: { provider: 'off', token: '', gistId: '', auto: false } });
    return {
      inDom: html.indexOf('ghp_TESTTOKEN') >= 0,
      inBackup: backup.indexOf('ghp_TESTTOKEN') >= 0,
      inPayload: payload.indexOf('ghp_TESTTOKEN') >= 0
    };
  });
  log('Токен: в разметке =', tokenLeak.inDom, '| в бэкапе =', tokenLeak.inBackup, '| в данных для облака =', tokenLeak.inPayload, '(всё должно быть false)');

  // Второе устройство должно подключаться к ЧУЖОМУ хранилищу по коду.
  // Без поля кода оно завело бы своё, и данные не встретились бы никогда.
  const joinUi = await page.evaluate(() => {
    App.sync.configure({ provider: 'gist', token: 'ghp_TESTTOKEN', gistId: 'GISTCODE123', auto: false });
    const read = () => ({
      placeholders: Array.prototype.map.call(document.querySelectorAll('.panel input'), i => i.placeholder),
      codes: Array.prototype.map.call(document.querySelectorAll('.panel code'), c => c.textContent),
      buttons: Array.prototype.map.call(document.querySelectorAll('.panel button'), b => b.textContent.trim()).filter(Boolean)
    });
    const configured = read();
    App.sync.disconnect();
    return { configured: configured, after: read() };
  });
  log('Подключение по коду: поле =', joinUi.configured.placeholders.indexOf('Код хранилища с другого устройства') >= 0,
      '| код виден =', joinUi.configured.codes.indexOf('GISTCODE123') >= 0,
      '| кнопка подключения =', joinUi.configured.buttons.indexOf('Подключиться к хранилищу') >= 0,
      '| кнопка копирования =', joinUi.configured.buttons.indexOf('Скопировать') >= 0);
  log('После отключения код скрыт =', joinUi.after.codes.length === 0,
      '| кнопка снова «Создать хранилище» =', joinUi.after.buttons.indexOf('Создать хранилище') >= 0);
  await page.screenshot({ path: OUT + '/15b-sync.png', fullPage: true });

  // --- 12c. Напоминания ---
  await page.goto(BASE + '#/notify', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const notifyUi = await page.evaluate(() => ({
    title: (document.querySelector('.page-title') || {}).textContent || '',
    toggles: document.querySelectorAll('.switch').length,
    timeInput: document.querySelectorAll('input[type="time"]').length,
    supported: App.notify.supported(),
    permission: App.notify.permission(),
    schema: [App.notify.DB_NAME, App.notify.DB_VERSION, App.notify.STORE, App.notify.SUMMARY_KEY].join('/'),
    // сервис-воркер читает сводку из IndexedDB — схема должна совпадать
    summaryKeys: Object.keys(App.notify.summary()).sort().join(',')
  }));
  log('Напоминания: заголовок =', JSON.stringify(notifyUi.title), '| переключателей =', notifyUi.toggles,
      '| поле времени =', notifyUi.timeInput, '| Notification =', notifyUi.supported, '/', notifyUi.permission);
  log('Напоминания: схема IndexedDB =', notifyUi.schema, '| поля сводки =', notifyUi.summaryKeys);
  await page.screenshot({ path: OUT + '/15c-notify.png', fullPage: true });

  // Сводка для service worker должна доехать до IndexedDB при уходе в фон,
  // а не остаться в отложенном таймере: мобильные браузеры замораживают
  // таймеры сразу после сворачивания, и тогда service worker читает
  // устаревшую сводку — например, старую дату последнего показа — и шлёт
  // второе напоминание за день.
  await page.waitForTimeout(1400);   // гасим все отложенные записи прошлых экранов
  const mirrorOnHide = await page.evaluate(async () => {
    function readState() {
      return new Promise(resolve => {
        const req = indexedDB.open('lexiflow-sw', 1);
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('reminder')) { db.close(); resolve(null); return; }
          const get = db.transaction('reminder', 'readonly').objectStore('reminder').get('state');
          get.onsuccess = () => { const v = get.result || null; db.close(); resolve(v); };
          get.onerror = () => { db.close(); resolve(null); };
        };
      });
    }

    const before = await readState();
    App.store.updateSettings({ dailyGoal: 42 });   // правка, видимая в сводке

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 150));    // много меньше дебаунса в 1,2 с
    const after = await readState();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    App.store.updateSettings({ dailyGoal: 30 });   // возвращаем как было

    return {
      goalBefore: before ? before.goal : null,
      goalAfter: after ? after.goal : null,
      advanced: !!(before && after && after.updatedAt > before.updatedAt)
    };
  });
  log('Сводка при уходе в фон: цель до =', mirrorOnHide.goalBefore,
      '→ после сворачивания =', mirrorOnHide.goalAfter,
      '| запись обновилась =', mirrorOnHide.advanced, '(ожидается 42 и true)');
  if (mirrorOnHide.goalAfter !== 42 || !mirrorOnHide.advanced) {
    errors.push('сводка для service worker не записалась при уходе в фон: ' +
      JSON.stringify(mirrorOnHide));
  }

  // --- 12d. Навигация и экран «На телефон» ---
  const navItems = await page.locator('.nav--secondary .nav__item').count();
  log('Сайдбар: пунктов во вторичном меню =', navItems, '(промпт, синхронизация, напоминания, на телефон, импорт)');

  await page.goto(BASE + '#/phone', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const phoneUi = await page.evaluate(() => {
    const svg = document.querySelector('#phone-qr, .qr svg, .panel svg');
    return {
      title: (document.querySelector('.page-title') || {}).textContent || '',
      qr: !!svg,
      qrModules: svg ? svg.querySelectorAll('rect').length : 0,
      // QR должен кодировать реальный адрес приложения
      hasLocalWarning: /localhost|127\.0\.0\.1/.test(document.body.textContent),
      steps: /Android/i.test(document.body.textContent) && /iPhone|Safari/i.test(document.body.textContent)
    };
  });
  log('На телефон: заголовок =', JSON.stringify(phoneUi.title), '| QR отрисован =', phoneUi.qr,
      '| модулей =', phoneUi.qrModules, '| предупреждение про локальный адрес =', phoneUi.hasLocalWarning,
      '| инструкции для Android и iPhone =', phoneUi.steps);
  await page.screenshot({ path: OUT + '/15d-phone.png', fullPage: true });

  await page.goto(BASE + '#/settings', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // --- 13. Светлая тема ---
  await expandPanel(page, '.segmented__item');
  await page.locator('.segmented__item:has-text("Светлая")').click();
  await page.waitForTimeout(400);
  await page.goto(BASE + '#/decks', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/16-light.png', fullPage: true });
  await page.goto(BASE + '#/settings', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await expandPanel(page, '.segmented__item');
  await page.locator('.segmented__item:has-text("Тёмная")').click();
  await page.waitForTimeout(300);

  // --- 14. PWA: манифест и service worker ---
  const manifest = await page.evaluate(async () => {
    const r = await fetch('manifest.webmanifest');
    return r.json();
  });
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? (reg.active ? 'active' : 'installing') : 'none';
  });
  log('PWA: name =', manifest.name, '| display =', manifest.display, '| иконок =', manifest.icons.length,
      '| ярлыков =', (manifest.shortcuts || []).length, '| SW =', swState);

  // --- 15. Мобильный вид ---
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const mp = await mobile.newPage();
  await installTtsRoute(mp);
  mp.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(BASE, { waitUntil: 'load' });
  await mp.waitForTimeout(700);
  log('Мобильный: таббар виден =', await mp.locator('.tabbar').isVisible(),
      '| сайдбар скрыт =', !(await mp.locator('.sidebar').isVisible()));
  await mp.screenshot({ path: OUT + '/17-mobile-decks.png', fullPage: true });
  await mp.goto(BASE + '#/study/all', { waitUntil: 'load' });
  await mp.waitForTimeout(500);
  await mp.locator('.btn:has-text("Начать тренировку")').click();
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: OUT + '/18-mobile-study.png' });
  await mp.locator('.btn:has-text("Показать ответ")').click().catch(() => {});
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: OUT + '/19-mobile-answer.png' });

  // --- 16. Офлайн-проверка (SW кэш) ---
  const offCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const op = await offCtx.newPage();
  await installTtsRoute(op);
  op.on('pageerror', e => errors.push('offline pageerror: ' + e.message));
  await op.goto(BASE, { waitUntil: 'load' });
  // кэш service worker заполняется не мгновенно: на живом адресе это секунды
  await op.waitForTimeout(4000);
  await op.context().setOffline(true);
  /* На опубликованном адресе «выключить сеть» означает выключить и сам
     хостинг: страницу нечем отдать, если кэш ещё не заполнен. Локально
     приложение обязано подняться из кэша — там ошибка остаётся ошибкой. */
  const reloadError = await op.reload({ waitUntil: 'load' }).then(() => null, e => String(e && e.message));
  if (reloadError && /127\.0\.0\.1|localhost/.test(BASE)) {
    errors.push('offline reload failed: ' + reloadError);
  }
  if (reloadError) log('Офлайн-перезагрузка на опубликованном адресе не удалась (сеть выключена полностью):',
    reloadError.slice(0, 60));
  await op.waitForTimeout(900);
  const offlineOk = await op.locator('.deck-tile').count();
  log('Офлайн после перезагрузки: колод отрисовано =', offlineOk);
  await op.screenshot({ path: OUT + '/20-offline.png', fullPage: true });

  // --- 17. Холодный старт: приложение сразу забирает чужие правки ---
  // Самый частый случай на телефоне: приложение открыли заново. Раньше в этот
  // момент в сеть никто не шёл, и удалённая на компьютере колода оставалась
  // на экране до ручной синхронизации.
  const startCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const sp2 = await startCtx.newPage();
  await installTtsRoute(sp2);
  sp2.on('pageerror', e => errors.push('startup pageerror: ' + e.message));
  sp2.on('console', m => {
    if (m.type() === 'error' && !isHostNoise(m.text())) errors.push('startup: ' + m.text());
  });

  // Своя сеть вместо GitHub и заранее настроенная синхронизация:
  // так проверяется именно запуск, без токена и без настоящего гиста.
  await sp2.addInitScript(() => {
    try {
      localStorage.setItem('lexiflow.data.v1', JSON.stringify({
        version: 1, decks: [], cards: [], logs: [], tombstones: [],
        settingsUpdatedAt: 0,
        settings: {
          sync: {
            provider: 'gist', token: 'ghp_E2E', gistId: 'gistE2E',
            auto: true, lastAt: 0, lastError: ''
          }
        },
        meta: { seeded: true }
      }));
    } catch (e) { /* нет доступа к localStorage — проверка ниже это покажет */ }

    window.__syncCalls = [];
    const realFetch = window.fetch;
    window.fetch = function (url, init) {
      const u = String(url);
      if (u.indexOf('api.github.com') < 0) return realFetch.apply(this, arguments);
      window.__syncCalls.push(((init && init.method) || 'GET') + ' ' + u.replace('https://api.github.com', ''));
      const payload = {
        version: 1, decks: [], cards: [], logs: [], tombstones: [],
        settingsUpdatedAt: 0, settings: { theme: 'auto' }, meta: {}
      };
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          id: 'gistE2E',
          files: { 'lexiflow.json': { content: JSON.stringify(payload) } }
        }))
      });
    };
  });

  await sp2.goto(BASE + '#/decks', { waitUntil: 'load' });
  await sp2.waitForTimeout(3000);
  const startup = await sp2.evaluate(() => ({
    calls: window.__syncCalls || [],
    configured: !!(App.sync && App.sync.isConfigured && App.sync.isConfigured()),
    state: App.sync && App.sync.status ? App.sync.status().state : ''
  }));
  log('Холодный старт: настроено =', startup.configured, '| статус =', startup.state,
      '| запросов к GitHub =', startup.calls.length, '|', startup.calls.join(' / '));
  if (!startup.calls.some(c => c.indexOf('GET /gists/gistE2E') === 0)) {
    errors.push('холодный старт: приложение не прочитало хранилище само (' +
      (startup.calls.join(' / ') || 'ни одного запроса') + ')');
  }
  await sp2.screenshot({ path: OUT + '/21-startup-sync.png', fullPage: true });

  // --- 18. Реальное время: удаление с телефона видно на компьютере ---
  // Колоду удалили на другом устройстве: в облаке её нет, осталось надгробие.
  // Компьютер обязан убрать её с экрана сам — без ручной синхронизации и без
  // перезагрузки. Для этого опрос облака идёт каждые 2 секунды, пока вкладка
  // на экране (в фоне таймеры браузер режет, там интервал остаётся длинным).
  const liveCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const lp = await liveCtx.newPage();
  await installTtsRoute(lp);
  lp.on('pageerror', e => errors.push('live pageerror: ' + e.message));
  lp.on('console', m => {
    if (m.type() === 'error' && !isHostNoise(m.text())) errors.push('live: ' + m.text());
  });

  await lp.addInitScript(() => {
    const deck = (id, name) => ({
      id: id, name: name, langFrom: 'en', langTo: 'ru',
      createdAt: 1, updatedAt: 2, settings: null
    });
    const base = {
      version: 1,
      decks: [deck('live1', 'Оставшаяся колода'), deck('live2', 'Удалённая на телефоне')],
      cards: [], logs: [], tombstones: [],
      settingsUpdatedAt: 0, settings: { theme: 'auto' }, meta: { seeded: true }
    };
    try {
      localStorage.setItem('lexiflow.data.v1', JSON.stringify(Object.assign({}, base, {
        settings: { sync: { provider: 'gist', token: 'ghp_LIVE', gistId: 'gistLIVE', auto: true, lastAt: 0, lastError: '' } }
      })));
    } catch (e) { /* нет доступа — проверка ниже это покажет */ }

    window.__remote = base;          // то, что «лежит в облаке»
    window.__syncCalls = [];
    const realFetch = window.fetch;
    window.fetch = function (url, init) {
      const u = String(url);
      if (u.indexOf('api.github.com') < 0) return realFetch.apply(this, arguments);
      window.__syncCalls.push(((init && init.method) || 'GET') + ' ' + u.replace('https://api.github.com', ''));
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          id: 'gistLIVE',
          files: { 'lexiflow.json': { content: JSON.stringify(window.__remote) } }
        }))
      });
    };
  });

  await lp.goto(BASE + '#/decks', { waitUntil: 'load' });
  await lp.waitForTimeout(3000);

  const liveBefore = await lp.evaluate(() => ({
    tiles: document.querySelectorAll('.deck-tile').length,
    names: Array.prototype.map.call(document.querySelectorAll('.deck-tile'),
      t => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24))
  }));
  log('Реальное время: на старте колод =', liveBefore.tiles, '|', liveBefore.names.join(' / '));
  if (liveBefore.tiles !== 2) {
    errors.push('для проверки реального времени нужно две колоды, а отрисовано ' + liveBefore.tiles);
  }

  // «телефон» удалил колоду: в облаке её нет, вместо неё — надгробие
  await lp.evaluate(() => {
    window.__remote = {
      version: 1,
      decks: [window.__remote.decks[0]],
      cards: [], logs: [],
      tombstones: [{ id: 'live2', kind: 'deck', at: Date.now() }],
      settingsUpdatedAt: 0, settings: { theme: 'auto' }, meta: { seeded: true }
    };
  });
  const callsBeforeLive = await lp.evaluate(() => (window.__syncCalls || []).length);

  await lp.waitForTimeout(9000);  // интервал опроса 2 с + запас на сам запрос

  const liveAfter = await lp.evaluate(() => ({
    tiles: document.querySelectorAll('.deck-tile').length,
    names: Array.prototype.map.call(document.querySelectorAll('.deck-tile'),
      t => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)),
    decks: App.store.get().decks.map(d => d.name),
    calls: (window.__syncCalls || []).length
  }));
  log('Реальное время: после удаления колод =', liveAfter.tiles, '|', liveAfter.names.join(' / '),
      '| в данных =', liveAfter.decks.join(' / '),
      '| запросов за время ожидания =', liveAfter.calls - callsBeforeLive);
  await lp.screenshot({ path: OUT + '/22-live-sync.png', fullPage: true });

  if (liveAfter.calls - callsBeforeLive < 1) {
    errors.push('опрос облака раз в 5 секунд не работает: за время ожидания запросов не было');
  }
  if (liveAfter.decks.some(n => /Удалённая/.test(n))) {
    errors.push('удалённая на другом устройстве колода осталась в данных');
  }
  if (liveAfter.tiles !== 1) {
    errors.push('экран не обновился сам: удалённая колода осталась на экране (плиток ' + liveAfter.tiles + ')');
  }

  await browser.close();

  log('\n=== ОШИБКИ КОНСОЛИ: ' + errors.length + ' ===');
  errors.slice(0, 30).forEach(e => log('  ! ' + e));
  fs.writeFileSync(OUT + '/report.txt', 'ОШИБКИ (' + errors.length + '):\n' + errors.join('\n') + '\n\nЛОГИ:\n' + logs.join('\n'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });

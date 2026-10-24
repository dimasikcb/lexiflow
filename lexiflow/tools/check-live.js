/**
 * LexiFlow — проверка ОПУБЛИКОВАННОГО приложения в браузере.
 *
 * Запуск:
 *   NODE_PATH=<путь к node_modules с playwright> node tools/check-live.js <url>
 *
 * Отличие от tools/e2e-check.js: тот гоняет весь набор по локальному серверу
 * и ждёт 'networkidle'. На реальном хостинге 'networkidle' не наступает
 * никогда — хостинг подмешивает в страницу свой маячок аналитики, который
 * держит соединение открытым. Поэтому здесь ждём 'load' и проверяем только
 * то, что важно именно для опубликованного адреса: приложение открывается,
 * ошибок в консоли нет, service worker встаёт на учёт, а QR-код на экране
 * «На телефон» кодирует ПУБЛИЧНЫЙ адрес, а не localhost.
 */

const { chromium } = require('playwright');

const URL_ARG = process.argv[2] || '';
if (!URL_ARG) {
  console.error('Укажите адрес: node tools/check-live.js https://…/index.html');
  process.exit(2);
}

/* Хостинг дописывает в <head> свой маячок (beacon.cdn.qq.com). Это его
   собственная аналитика показов, к приложению отношения не имеет, поэтому
   её шум в консоли не считаем ошибкой приложения. */
const HOST_NOISE = /beacon|analytics|favicon|manifest|sw\.js.*(404)/i;

(async () => {
  /* --mute-audio: без флага браузер озвучивает страницу вслух — слышно. */
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error' && !HOST_NOISE.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', e => {
    if (!HOST_NOISE.test(String(e && e.message))) errors.push('pageerror: ' + (e && e.message));
  });

  await page.goto(URL_ARG + '#/decks', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);

  const app = await page.evaluate(() => {
    const link = document.querySelector('link[rel="manifest"]');
    return {
      title: document.title,
      decks: document.querySelectorAll('.deck-card, .card-tile, .deck-row').length,
      hasApp: typeof window.App === 'object' && !!window.App.store,
      navItems: document.querySelectorAll('.nav--secondary .nav__item').length,
      manifest: link ? link.getAttribute('href') : ''
    };
  });
  console.log('Приложение: заголовок =', JSON.stringify(app.title));
  console.log('Ядро загружено =', app.hasApp, '| карточек колод =', app.decks,
              '| пунктов меню =', app.navItems, '| манифест =', app.manifest);

  // QR должен кодировать публичный адрес: иначе телефон уйдёт на localhost
  await page.goto(URL_ARG + '#/phone', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);
  const phone = await page.evaluate(() => {
    const text = document.body.textContent || '';
    /* Слова «localhost» есть на экране всегда — в списке подходящих адресов.
       Поэтому ищем не упоминание, а сам баннер «Этот адрес не откроется
       на телефоне» и метку «Телефон не откроет». */
    const pre = document.querySelector('pre.code');
    const tag = document.querySelector('.panel .tag');
    return {
      qr: !!document.querySelector('.qr svg, #phone-qr, .panel svg'),
      warnsLocal: /Этот адрес не откроется на телефоне/.test(text)
        || Array.prototype.some.call(document.querySelectorAll('.tag--warn'),
          t => /Телефон не откроет/.test(t.textContent || '')),
      /* Именно тот адрес, по которому построен QR: экран печатает его сам */
      shownUrl: pre ? (pre.textContent || '').trim() : '',
      tag: tag ? (tag.textContent || '').trim() : '',
      secure: location.protocol === 'https:'
    };
  });
  console.log('Экран «На телефон»: QR =', phone.qr, '| баннер «не откроется на телефоне» =', phone.warnsLocal,
              '| протокол HTTPS =', phone.secure);
  console.log('Адрес, по которому построен QR =', phone.shownUrl);
  console.log('Метка рядом со ссылкой =', JSON.stringify(phone.tag));

  const expectedOrigin = URL_ARG.replace(/index\.html.*$/, '').replace(/\/$/, '');
  const urlMatches = phone.shownUrl.indexOf(expectedOrigin) === 0 && /^https:/.test(phone.shownUrl);
  console.log('QR построен по публичному адресу =', urlMatches);

  // Сборка на хостинге должна содержать поле кода хранилища: без него второе
  // устройство заведёт своё хранилище и данные не встретятся.
  await page.goto(URL_ARG + '#/sync', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1000);
  const sync = await page.evaluate(() => {
    const placeholders = Array.prototype.map.call(
      document.querySelectorAll('.panel input'), i => i.placeholder);
    const buttons = Array.prototype.map.call(
      document.querySelectorAll('.panel button'), b => b.textContent.trim()).filter(Boolean);
    return { placeholders: placeholders, buttons: buttons };
  });
  const hasJoin = sync.placeholders.indexOf('Код хранилища с другого устройства') >= 0;
  const hasJoinBtn = sync.buttons.indexOf('Подключиться к хранилищу') >= 0;
  console.log('Панель синхронизации: поле кода =', hasJoin, '| кнопка подключения =', hasJoinBtn,
              '| кнопки =', sync.buttons.slice(0, 5).join(' / '));

  // Опубликованная сборка должна быть свежей: иначе на телефоне останутся
  // старые баги, а на компьютере уже исправленные — худший вид расхождения.
  const build = await page.evaluate(async () => ({
    clearData: typeof (App.store || {}).clearData === 'function',
    voiceAdvice: typeof (App.speech || {}).voiceAdvice === 'function',
    flushPending: typeof (App.sync || {}).flushPending === 'function',
    resume: typeof (App.sync || {}).shouldSyncOnResume === 'function',
    // сводка для service worker должна уметь писаться немедленно
    flushMirror: typeof (App.notify || {}).flushMirror === 'function',
    refreshMirror: typeof (App.notify || {}).refreshMirror === 'function',
    // качественная озвучка: модуль и пакет готовых файлов приложения
    netTts: typeof (App.ttsnet || {}).available === 'function',
    packFile: typeof (App.ttsnet || {}).packFile === 'function',
    packPhrases: App.ttsnet && App.ttsnet.loadPack
      ? Object.keys(((await App.ttsnet.loadPack()) || {}).phrases || {}).length
      : 0,
    urgentDelete: (App.sync || {}).changeDelay ? App.sync.changeDelay('deck:delete') : -1,
    slowEdit: (App.sync || {}).changeDelay ? App.sync.changeDelay('card:update') : -1,
    // реальное время: частый опрос облака и обновление экрана после чужих правок
    speakBest: typeof (App.speech || {}).speakBest === 'function',
    liveInterval: (App.sync || {}).autoInterval ? App.sync.autoInterval({ visible: true }) : -1,
    refreshOnRemote: typeof (App.sync || {}).shouldRefreshOnRemote === 'function'
  }));
  const buildFresh = build.clearData && build.voiceAdvice && build.flushPending && build.resume
    && build.flushMirror && build.refreshMirror && build.netTts && build.packFile
    && build.packPhrases > 0
    && build.urgentDelete > 0 && build.urgentDelete < build.slowEdit
    && build.speakBest && build.refreshOnRemote && build.liveInterval > 0 && build.liveInterval <= 30000;
  console.log('Свежесть сборки: clearData =', build.clearData, '| voiceAdvice =', build.voiceAdvice,
              '| flushPending =', build.flushPending, '| возврат в приложение =', build.resume,
              '| сводка в фон сразу =', build.flushMirror && build.refreshMirror);
  console.log('Озвучка: сетевой модуль =', build.netTts, '| пакет файлов =', build.packFile,
              '| фраз в пакете =', build.packPhrases, '| единый путь =', build.speakBest,
              '| удаление', build.urgentDelete + 'мс против правки', build.slowEdit + 'мс');
  console.log('Реальное время: опрос облака раз в', build.liveInterval + 'мс',
              '| обновление экрана после чужих правок =', build.refreshOnRemote);

  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'нет поддержки';
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? (reg.active ? 'active' : (reg.installing ? 'installing' : 'waiting')) : 'не зарегистрирован';
  });
  console.log('Service worker =', sw);

  console.log('\n=== ОШИБКИ КОНСОЛИ (без шума хостинга): ' + errors.length + ' ===');
  errors.slice(0, 5).forEach(e => console.log('  ! ' + e));

  /* Колод в чистом браузере нет — это нормально, поэтому их количество
     печатаем, но в вердикт не берём. */
  const ok = app.hasApp && app.navItems >= 5 && phone.qr && !phone.warnsLocal
    && phone.secure && urlMatches && hasJoin && hasJoinBtn && buildFresh && errors.length === 0;
  console.log(ok ? '\nПРОВЕРКА ПРОЙДЕНА' : '\nЕСТЬ ПРОБЛЕМЫ (см. выше)');

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('СБОЙ:', e && e.message); process.exit(1); });

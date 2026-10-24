const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8777/index.html';
const OUT = require('path').join(__dirname, 'output', 'dark');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  /* --mute-audio: без флага браузер озвучивает страницу вслух — слышно. */
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/1-decks.png' });

  await p.locator('.deck-tile').first().click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/2-deck.png' });

  // добавляем прогресс: 6 ответов в режиме карточек
  await p.locator('.btn:has-text("Учить")').first().click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/3-study-setup.png' });
  await p.locator('.btn:has-text("Начать тренировку")').click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/4-study-flip.png' });

  // озвучка: подсветка произносимого слова (субтитры)
  const flipPlay = p.locator('.qcard__word .icon-btn').first();
  if (await flipPlay.count()) {
    await flipPlay.click();
    await p.waitForTimeout(950);
    await p.screenshot({ path: OUT + '/4b-study-tts.png' });
    await flipPlay.click();
    await p.waitForTimeout(200);
  }

  await p.locator('.btn:has-text("Показать ответ")').click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/5-study-answer.png' });

  // озвучка примера-предложения
  const exPlay = p.locator('.qcard__examples .icon-btn').first();
  if (await exPlay.count()) {
    await exPlay.click();
    await p.waitForTimeout(950);
    await p.screenshot({ path: OUT + '/5b-study-example-tts.png' });
    await exPlay.click();
    await p.waitForTimeout(200);
  }

  const grades = [2, 3, 3, 4, 3, 1, 3, 3, 4, 2, 3, 3];
  for (const g of grades) {
    const show = p.locator('.btn:has-text("Показать ответ")');
    if (await show.count()) { await show.click(); await p.waitForTimeout(220); }
    const rate = p.locator('.rate').nth(g - 1);
    if (await rate.count()) { await rate.click(); await p.waitForTimeout(260); }
  }
  await p.screenshot({ path: OUT + '/6-study-progress.png' });

  // режим выбора варианта
  await p.goto(BASE + '#/study/all', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.locator('.mode-card:has-text("Выбор варианта")').click();
  await p.locator('.btn:has-text("Начать тренировку")').click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/7-study-choice.png' });
  await p.locator('.choice').first().click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/8-study-choice-answered.png' });

  // аудирование
  await p.goto(BASE + '#/study/all', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const listen = p.locator('.mode-card:has-text("Аудирование")');
  if (await listen.count()) {
    await listen.click();
    await p.locator('.btn:has-text("Начать тренировку")').click();
    await p.waitForTimeout(700);
    await p.screenshot({ path: OUT + '/9-study-listening.png' });
  }

  // тест
  await p.goto(BASE + '#/test/all', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.locator('.btn:has-text("Начать тест")').click();
  await p.waitForTimeout(600);
  for (let i = 0; i < 5; i++) {
    const ch = p.locator('.choice').first();
    if (await ch.count()) { await ch.click(); await p.waitForTimeout(200); }
    const next = p.locator('.btn:has-text("Далее")');
    if (await next.count()) { await next.click(); await p.waitForTimeout(250); }
  }
  await p.screenshot({ path: OUT + '/10-test-run.png' });

  // статистика
  await p.goto(BASE + '#/stats', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + '/11-stats.png', fullPage: true });

  // словарь + массовые операции
  await p.goto(BASE + '#/browse/all', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.locator('.check input').nth(0).check();
  await p.locator('.check input').nth(1).check();
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/12-browse.png' });

  // импорт/экспорт
  await p.goto(BASE + '#/data', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/13-data.png', fullPage: true });

  // конструктор промпта для нейросети
  await p.goto(BASE + '#/ai', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/13b-ai-prompt.png', fullPage: true });

  // настройки
  await p.goto(BASE + '#/settings', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/14-settings.png', fullPage: true });

  // настройки: раздел озвучки — темп, тон, громкость и выбор голоса
  const voiceRows = p.locator('.voice-rows').first();
  if (await voiceRows.count()) {
    await voiceRows.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await p.screenshot({ path: OUT + '/14b-settings-tts.png' });
  }

  // синхронизация, напоминания, доступ с телефона
  await p.goto(BASE + '#/sync', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/13c-sync.png', fullPage: true });
  await p.goto(BASE + '#/notify', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/13d-notify.png', fullPage: true });
  await p.goto(BASE + '#/phone', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/13e-phone.png', fullPage: true });

  // редактор карточки
  await p.goto(BASE + '#/deck/' + (await p.evaluate(() => App.store.get().decks[0].id)), { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.locator('.word-row .icon-btn').first().click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/15-card-editor.png' });

  // интервалы колоды
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.locator('.btn:has-text("Интервалы")').click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/16-intervals.png' });

  // мобильные
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
  const mp = await mctx.newPage();
  mp.on('pageerror', e => errs.push('mobile: ' + e.message));
  await mp.goto(BASE, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(900);
  await mp.screenshot({ path: OUT + '/17-mobile-decks.png' });
  await mp.goto(BASE + '#/stats', { waitUntil: 'load' });
  await mp.waitForTimeout(900);
  await mp.screenshot({ path: OUT + '/18-mobile-stats.png', fullPage: true });
  await mp.goto(BASE + '#/ai', { waitUntil: 'load' });
  await mp.waitForTimeout(700);
  await mp.screenshot({ path: OUT + '/18b-mobile-ai.png', fullPage: true });
  await mp.goto(BASE + '#/study/all', { waitUntil: 'load' });
  await mp.waitForTimeout(500);
  await mp.locator('.btn:has-text("Начать тренировку")').click();
  await mp.waitForTimeout(700);
  await mp.locator('.btn:has-text("Показать ответ")').click();
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: OUT + '/19-mobile-answer.png' });

  await browser.close();
  console.log('Скриншоты готовы. Ошибок:', errs.length, errs.slice(0, 5).join(' | '));
})();

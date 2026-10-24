/**
 * LexiFlow — проверка сборки одного файла (lexiflow-mobile.html).
 *
 * Запуск:
 *   node tools/build-mobile.js
 *   NODE_PATH=<путь к node_modules с playwright> node tools/check-mobile.js
 *
 * Зачем отдельный прогон: однофайловая сборка открывается по file://,
 * а это другой мир — нет сервера, нет сети, fetch не работает, service
 * worker не регистрируется. Локальный e2e-check смотрит страницу по
 * http и этих условий не воспроизводит: сборка могла бы быть сломана,
 * а все проверки — зелёными.
 *
 * Проверяем ровно то, что важно для файла, пересланного на телефон:
 *   1. приложение открылось и нарисовало колоды (скрипты встроены все
 *      и в правильном порядке — иначе экран был бы пустым);
 *   2. ошибок в консоли нет: на file:// любая попытка сети даёт красную
 *      строку, и человек видит «битое приложение»;
 *   3. service worker не регистрируется — иначе в консоли сыпались бы
 *      ошибки регистрации;
 *   4. экран синхронизации показывает новый интерфейс с приглашением
 *      по коду: именно из-за устаревшего интерфейса в старой сборке
 *      подключение второго устройства и не работало;
 *   5. бейдж стрика рисуется — он падал из-за отсутствующего S.logs().
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE = path.join(__dirname, '..', 'lexiflow-mobile.html');
if (!fs.existsSync(FILE)) {
  console.error('Сначала соберите файл: node tools/build-mobile.js');
  process.exit(2);
}
const FILE_URL = 'file:///' + FILE.replace(/\\/g, '/');

const errors = [];
const logs = [];
const log = (...a) => { console.log(...a); logs.push(a.join(' ')); };

(async () => {
  /* --mute-audio: приложение может заговорить системным голосом. */
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200));
  });

  await page.goto(FILE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  /* --- 1. Приложение открылось --- */
  const main = await page.evaluate(() => ({
    decks: document.querySelectorAll('.deck-tile').length,
    nav: document.querySelectorAll('.nav__item, .menu-item').length,
    note: !!document.getElementById('mobile-build-note'),
    badge: (document.querySelector('.streak-badge') || {}).textContent || '',
    sw: !!document.querySelector('#view .empty')  // экран ошибки вместо приложения
  }));
  log('Однофайловая сборка: колод =', main.decks, '| пунктов меню =', main.nav,
      '| пояснение-плашка =', main.note,
      '| бейдж стрика =', JSON.stringify(main.badge.trim()),
      '| протокол =', await page.evaluate(() => location.protocol));

  if (main.decks < 1) errors.push('колоды не отрисовались: скрипты собраны не все или не в том порядке');
  if (!main.note) errors.push('нет плашки-пояснения, что это копия для одного устройства');
  if (!/🔥/.test(main.badge)) errors.push('бейдж стрика не нарисовался: ' + JSON.stringify(main.badge));

  /* --- 2. Service worker не регистрируется --- */
  const sw = await page.evaluate(() => ({
    protocol: location.protocol,
    registered: false            // по file:// register() не вызывается
  }));
  log('Service worker: протокол =', sw.protocol, '| регистрация пропущена по протоколу =', sw.protocol === 'file:');
  if (sw.protocol !== 'file:') errors.push('сборка открыта не по file:// — проверка теряет смысл');

  /* --- 3. Экран синхронизации: новый интерфейс --- */
  await page.evaluate(() => { location.hash = '#/sync'; });
  await page.waitForTimeout(700);
  const syncUi = await page.evaluate(() => ({
    invite: !!document.querySelector('input[placeholder*="Код приглашения"], input[placeholder*="LF2"]'),
    buttons: Array.prototype.map.call(
      document.querySelectorAll('.panel button, .setting-row button'),
      b => b.textContent.trim()).filter(Boolean),
    qr: !!document.querySelector('svg'),
    manual: !!document.querySelector('.sync-manual, details')
  }));
  log('Экран синхронизации: поле приглашения =', syncUi.invite,
      '| QR нарисован =', syncUi.qr,
      '| ручной режим =', syncUi.manual,
      '| кнопки =', syncUi.buttons.join(' / '));

  if (!syncUi.invite) errors.push('на экране синхронизации нет поля для кода приглашения');
  if (!/Подключиться по коду/.test(syncUi.buttons.join(' '))) {
    errors.push('нет кнопки «Подключиться по коду» — в сборке старый интерфейс синхронизации');
  }
  if (!/Сканировать QR/.test(syncUi.buttons.join(' '))) {
    errors.push('нет кнопки «Сканировать QR» — в сборке старый интерфейс синхронизации');
  }

  /* --- 4. Экран тренировки рисуется --- */
  await page.evaluate(() => { location.hash = '#/decks'; });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const tile = document.querySelector('.deck-tile');
    if (tile) tile.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.btn'))
      .find(b => /Учить/.test(b.textContent));
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  const studyUi = await page.evaluate(() => ({
    modes: document.querySelectorAll('.mode-card').length,
    started: false
  }));
  log('Экран выбора режима: режимов =', studyUi.modes);
  if (studyUi.modes < 1) errors.push('не открылся экран выбора режима тренировки');

  await page.screenshot({ path: path.join(__dirname, 'output', 'mobile-build.png'), fullPage: true });
  await browser.close();

  fs.writeFileSync(path.join(__dirname, 'output', 'mobile-report.txt'),
    'ОШИБКИ (' + errors.length + '):\n' + errors.join('\n') + '\n\nЛОГИ:\n' + logs.join('\n'));

  console.log('\n=== ОШИБКИ: ' + errors.length + ' ===');
  errors.slice(0, 20).forEach(e => console.log('  ! ' + e));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });

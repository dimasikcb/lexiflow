/* Одна команда на публикацию: проверки → версия → сборка → деплой → проверка.
 *
 * Запуск (из папки lexiflow/):
 *   $env:GH_TOKEN = 'ghp_…'
 *   node tools/publish.js
 *
 * Зачем: пользователь просил «если изменение — то комитится». Здесь любая
 * правка превращается в один коммит на GitHub Pages, и версия на сайте
 * поднимается автоматически. Если тесты падают — публикации нет, старое
 * остаётся целым.
 *
 * Ключи:
 *   --no-deploy   прогнать проверки и собрать, но не публиковать
 *   --version=x.y.z  задать версию вручную (иначе патч +1)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const ARGS = process.argv.slice(2);
const NO_DEPLOY = ARGS.indexOf('--no-deploy') >= 0;
const FORCED = (ARGS.find(a => a.indexOf('--version=') === 0) || '').split('=')[1];

function run(args, opts) {
  const started = Date.now();
  const out = execFileSync(NODE, args, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, (opts && opts.env) || {})
  });
  return { out, ms: Date.now() - started };
}

function step(title) { console.log('\n▸ ' + title); }

function tail(text, lines) {
  const arr = String(text || '').trim().split('\n');
  return arr.slice(-(lines || 3)).join('\n');
}

function readVersion() {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(app);
  if (!m) throw new Error('в js/app.js нет APP_VERSION');
  return m[1];
}

function writeVersion(version) {
  for (const rel of ['js/app.js', 'sw.js']) {
    const p = path.join(ROOT, rel);
    const src = fs.readFileSync(p, 'utf8');
    const next = src.replace(/lexiflow-v\d+\.\d+\.\d+/g, version);
    if (src === next) throw new Error('версия не нашлась в ' + rel);
    fs.writeFileSync(p, next, 'utf8');
  }
}

function bump(version) {
  if (FORCED) return 'lexiflow-v' + FORCED.replace(/^lexiflow-v/, '');
  const m = /^lexiflow-v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error('непонятный формат версии: ' + version);
  return 'lexiflow-v' + m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'lexiflow-publish' } }, (res) => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
  });
}

(async function main() {
  const before = readVersion();
  const version = bump(before);
  step('Версия: ' + before + ' → ' + version);

  step('Контракт модулей');
  console.log(tail(run(['tools/check-contract.js']).out, 2));

  step('Юнит-тесты');
  const suites = ['core', 'sync', 'notify', 'qr', 'streak'];
  let total = 0;
  for (const name of suites) {
    const { out } = run(['tools/test-' + name + '.js']);
    const m = /ВСЕ ТЕСТЫ ПРОЙДЕНЫ: (\d+)/.exec(out);
    if (!m) {
      console.log(tail(out, 12));
      throw new Error('тесты «' + name + '» не прошли — публикация отменена');
    }
    total += Number(m[1]);
    console.log('  ' + name + ': ' + m[1]);
  }
  console.log('  всего: ' + total);

  step('Поднять версию в js/app.js и sw.js');
  writeVersion(version);
  console.log('  ' + version);

  step('Контракт после смены версии');
  console.log(tail(run(['tools/check-contract.js']).out, 1));

  step('Однофайловая сборка');
  console.log(tail(run(['tools/build-mobile.js']).out, 1));

  step('Деплой-папка');
  console.log(tail(run(['tools/sync-deploy.js']).out, 2));

  if (NO_DEPLOY) {
    console.log('\nГотово без публикации: ' + version + '. Для деплоя уберите --no-deploy.');
    return;
  }
  if (!process.env.GH_TOKEN) {
    console.log('\nПроверки и сборка готовы (' + version + '), но GH_TOKEN не задан — публикации нет.');
    process.exitCode = 2;
    return;
  }

  step('Публикация на GitHub Pages');
  const deploy = run(['tools/deploy-gh-pages.js'], { env: { GH_TOKEN: process.env.GH_TOKEN } });
  const deployTail = deploy.out.split('\n').filter(l => !/blob ok|сеть подвела/.test(l));
  console.log(tail(deployTail.join('\n'), 6));

  step('Проверка живого адреса');
  const stamp = Date.now();
  const live = await get('https://dimasikcb.github.io/lexiflow/js/app.js?v=' + stamp);
  const liveVersion = (/lexiflow-v\d+\.\d+\.\d+/.exec(live) || [])[0];
  console.log('  на сайте: ' + (liveVersion || 'версия не найдена') + ' | ожидали: ' + version);
  if (liveVersion !== version) {
    console.log('  GitHub Pages ещё собирает — через минуту проверьте сами.');
    process.exitCode = 3;
    return;
  }
  console.log('\nОпубликовано: ' + version + ' → https://dimasikcb.github.io/lexiflow/');
})().catch((e) => {
  console.error('\nОСТАНОВЛЕНО: ' + (e && e.message || e));
  process.exit(1);
});

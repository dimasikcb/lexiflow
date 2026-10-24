// Deploy lexiflow-deploy3 to GitHub Pages via GitHub API (no git binary needed)
// Usage: node deploy-gh-pages.js [--dry-run]
// Env: GH_TOKEN (token with public_repo scope),
//      GH_HEADERS (full JSON object of request headers, prepared by the caller)
//
// Папка — та же, что и для сайта: tools/sync-deploy.js собирает
// lexiflow-deploy3, второй копии быть не должно (однажды деплой ушёл из
// устаревшей lexiflow-deploy2 — версия на сайте отличалась от проекта).
const https = require('https');
const fs = require('fs');
const path = require('path');

const DRY = process.argv.indexOf('--dry-run') >= 0;

const OWNER = 'dimasikcb';
const REPO = 'lexiflow';
const BRANCH = 'main';
const SRC = path.resolve(__dirname, '..', '..', 'lexiflow-deploy3');
const SKIP_DIRS = new Set(['node_modules', '.git']);
const SKIP_FILES = new Set(['PUBLISH.md', 'deploy-gh-pages.js']);

/** Версия берётся из sw.js деплой-папки: раньше в сообщении коммита стояла
    цифра, вписанная руками, и врала. */
function deployedVersion() {
  try {
    const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');
    const m = /VERSION\s*=\s*'([^']+)'/.exec(sw);
    return m ? m[1] : 'unknown';
  } catch (e) { return 'unknown'; }
}

if (DRY) {
  const files = walk(SRC, '');
  console.log('Сухой прогон: ' + SRC);
  console.log('Версия: ' + deployedVersion());
  console.log('Файлов: ' + files.length + ' (' +
    (files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0) + ' КБ)');
  console.log('index.html: ' + files.filter(f => f.rel === 'index.html').length +
    ', js: ' + files.filter(f => /^js\//.test(f.rel)).length +
    ', audio: ' + files.filter(f => /^audio\//.test(f.rel)).length);
  console.log('Коммит: Deploy LexiFlow ' + deployedVersion());
  process.exit(0);
}

if (!process.env.GH_TOKEN) {
  console.error('GH_TOKEN не задан: нужен классический токен со scope public_repo');
  process.exit(1);
}
/* GH_HEADERS не обязателен: без него заголовки собираются из токена.
   Токен при этом остаётся в переменной окружения и в файлы не попадает. */
const HEADERS = process.env.GH_HEADERS
  ? JSON.parse(process.env.GH_HEADERS)
  : {
      'User-Agent': 'lexiflow-deploy-script',
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'Authorization': 'token ' + process.env.GH_TOKEN
    };

function apiOnce(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: HEADERS,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch (e) {}
        if (res.statusCode >= 400) {
          reject(new Error(`${method} ${urlPath} -> ${res.statusCode}: ${buf.slice(0, 400)}`));
        } else resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* Сеть до api.github.com рвётся (ECONNRESET на 92 загрузках — обычное дело).
   Повторяем только сетевые сбои: ответ 4xx повторять бессмысленно. */
async function api(method, urlPath, body, attempt) {
  attempt = attempt || 1;
  try {
    return await apiOnce(method, urlPath, body);
  } catch (e) {
    const network = /ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|socket hang up/i.test(e && e.message || '');
    if (!network || attempt >= 4) throw e;
    console.log(`  сеть подвела (${e.message}) — повтор ${attempt}/3: ${method} ${urlPath}`);
    await sleep(800 * attempt);
    return api(method, urlPath, body, attempt + 1);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(p, rel));
    else if (!SKIP_FILES.has(e.name)) out.push({ rel, abs: p, size: fs.statSync(p).size });
  }
  return out;
}

async function main() {
  // 1. Ensure repo exists
  let repo;
  try {
    repo = (await api('GET', `/repos/${OWNER}/${REPO}`)).json;
    console.log('repo exists, default branch:', repo.default_branch);
  } catch (e) {
    if (!/404/.test(e.message)) throw e;
    console.log('creating repo...');
    repo = (await api('POST', '/user/repos', {
      name: REPO, private: false, auto_init: false,
      description: 'LexiFlow - тренажёр иностранных слов (PWA)',
    })).json;
    console.log('repo created');
  }

  // 2. Base commit
  let baseCommit = null, baseTree = null;
  try {
    const ref = (await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)).json;
    baseCommit = ref.object.sha;
    baseTree = (await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${baseCommit}`)).json.tree.sha;
    console.log('base commit:', baseCommit);
  } catch (e) {
    console.log('branch empty, starting from scratch');
  }

  // 2b. Empty repo: Git Data API needs at least one commit; make it via Contents API
  if (!baseCommit) {
    await api('PUT', `/repos/${OWNER}/${REPO}/contents/README.md`, {
      message: 'init',
      content: Buffer.from('# LexiFlow\n\nPWA deployment repository.\n').toString('base64'),
    });
    const ref2 = (await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)).json;
    baseCommit = ref2.object.sha;
    baseTree = (await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${baseCommit}`)).json.tree.sha;
    console.log('init commit created:', baseCommit);
  }

  // 3. Blobs
  const files = walk(SRC, '');
  console.log('files to upload:', files.length,
    '(' + (files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0) + ' KB)');
  const tree = [];
  for (const f of files) {
    const content = fs.readFileSync(f.abs).toString('base64');
    const blob = (await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content, encoding: 'base64',
    })).json;
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  blob ok:', f.rel);
  }

  // 4. Tree + commit + ref
  const newTree = (await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    base_tree: baseTree || undefined, tree,
  })).json;
  const commitBody = {
    message: 'Deploy LexiFlow ' + deployedVersion(),
    tree: newTree.sha,
    parents: baseCommit ? [baseCommit] : [],
  };
  const commit = (await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, commitBody)).json;
  try {
    await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${BRANCH}`, sha: commit.sha,
    });
    console.log('branch created at', commit.sha);
  } catch (e) {
    await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha });
    console.log('branch updated to', commit.sha);
  }

  // 5. Enable Pages
  try {
    await api('POST', `/repos/${OWNER}/${REPO}/pages`, {
      source: { branch: BRANCH, path: '/' },
    });
    console.log('Pages enabled');
  } catch (e) {
    if (/409/.test(e.message)) console.log('Pages already enabled');
    else throw e;
  }

  // 6. Wait for build
  let built = false;
  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    try {
      const b = (await api('GET', `/repos/${OWNER}/${REPO}/pages/builds/latest`)).json;
      console.log(`build: ${b.status} (${b.error ? 'err: ' + (b.error.message || '') : 'ok'})`);
      if (b.status === 'built') { built = true; break; }
      if (b.status === 'errored') break;
    } catch (e) { console.log('build status pending...'); }
  }
  console.log(built ? 'BUILD OK' : 'BUILD NOT CONFIRMED (check later)');
  console.log('URL: https://dimasikcb.github.io/lexiflow/');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

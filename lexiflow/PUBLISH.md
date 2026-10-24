# Как опубликовать новую версию LexiFlow

Инструкция для ИИ-ассистента. Задача: раздать актуальную версию приложения
(`lexiflow/`) по публичному HTTPS-адресу, чтобы её можно было открыть на
телефоне без общего WiFi.

## Состояние (обновлено 19.10.2026, v1.18.10)

- **Каноническая кода:** `C:\Users\admin\WorkBuddy AI\2026-09-19-21-29-08\lexiflow`
  (это живой проект, правки сюда).
- **Текущая версия в `sw.js`:** `lexiflow-v1.18.10` (18.10.2026: звук и вибрация уведомлений, честное объяснение «почему не приходят»; шаги обучения —
  «Трудно» больше не совпадает со «Снова» (1 / 6 / 10 мин / 4 д); отдельное
  уведомление на каждое слово с наступившим сроком; дневной лимит повторений
  считается за день, а не за сессию; быстрые настройки больше не чёрные в
  светлой теме).
- **АКТУАЛЬНАЯ ПУБЛИКАЦИЯ (GitHub Pages):**
  `https://dimasikcb.github.io/lexiflow/` — выложена 18.10.2026 скриптом
  `tools/deploy-gh-pages.js` из `lexiflow-deploy3`, отдаёт `lexiflow-v1.18.10`
  (`js/app.js` и `sw.js` проверены запросом). `tools/check-live.js` по этому
  адресу — «ПРОВЕРКА ПРОЙДЕНА», 0 ошибок консоли.
- **Второй адрес (agentos, v1.18.5):**
  `https://b09c8515584e4a1bbd67dacd2826ea9f.sg2.agentos-app.run` — выложен
  13.10.2026 через `workbuddy_sites_deploy`; обновление требует этого
  инструмента, в обычных сессиях он недоступен.
- **Предыдущая публикация (v1.11.0, протухшая):**
  `https://dad281a3fe60497e8cae2672449197a9.sg.agentos-app.run`
  — адрес оставить как запасной, не обновлять.
- **Для деплоя на GitHub** нужен классический токен со скопом `public_repo`
  (`GH_HEADERS` теперь необязателен — заголовки собираются из токена).
  Проверка без сети и без токена: `node tools/deploy-gh-pages.js --dry-run`.
- **Папка для деплоя:** `C:\Users\admin\WorkBuddy AI\2026-09-19-21-29-08\lexiflow-deploy3`
  — синхронизируется из проекта скриптом `tools/sync-deploy.js` (Шаг 2).
- **Гист для синхронизации:** `09d24472eb75e4dc78492f7805ffa7c5`
  (GitHub-аккаунт `dimasikcb`). Токен синка — классический, скоп `gist`;
  сам токен сюда НЕ записывать (секрет).

## Шаг 1. Проверить актуальность версии

```bash
grep "lexiflow-v" "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow/sw.js" | head -1
```

Взяли из вывода версию `vX.Y.Z`. Если вы меняли код приложения —
**обязательно** поменяйте `VERSION` в `sw.js` (иначе офлайн-кэш не обновится),
и **обязательно** проверьте, что все файлы подключены на странице и есть
в `SHELL` — за это отвечает `tools/check-contract.js` (Шаг 1а).

## Шаг 1а. Прогнать проверки (быстро, без браузера)

```bash
cd "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow" && \
  node tools/check-contract.js && \
  for t in test-core test-sync test-notify test-qr test-streak; do node tools/$t.js | tail -1; done
```

Ожидаемо (13.10.2026): 402 + 349 + 157 + 180 + 43 = **1131 проверок**, все зелёные.
`check-contract.js` ловит три класса багов, которые уже ломали релиз:
1. вызов несуществующей функции модуля (`App.streak.remainingToday`,
   `S.logs`) — падал целый экран посреди отрисовки;
2. файл подключён в `index.html`, но его нет в `SHELL` у `sw.js` —
   приложение работало в онлайне и молча ломалось после перезагрузки без сети;
3. `VERSION` в `sw.js` разошёлся с `App.version` в `js/app.js` — телефон
   тянет новый код со старым кэшем, а номер версии на экране врёт.

Если падает — чинить, не деплоить.

## Шаг 2. Синхронизировать деплой-папку

```bash
cd "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow" && node tools/sync-deploy.js
```

Скрипт копирует из проекта всё, кроме `tools/`, `node_modules/`, `.git`,
`.zwork`, документации и исследований. **Аудио тащит** — без пакета озвучки
приложение падает на сетевой сервис. Проверить перед выкладкой:

```bash
node tools/sync-deploy.js --dry-run    # показать, что изменится
```

## Шаг 3. Однофайловая сборка для телефона (по желанию)

```bash
node tools/build-mobile.js             # → lexiflow-mobile.html (~630 КБ)
NODE_PATH="…node_modules" node tools/check-mobile.js   # проверить сборку
```

Собирается ИЗ ТЕКУЩИХ ИСТОЧНИКОВ. Ручную правку файла не делать: однажды
в пересланном телефоне оказался старый интерфейс синхронизации, и
подключение второго устройства не работало. Дрейфа больше нет — сборка
всегда актуальна, но после правок интерфейса её нужно пересобирать.

## Шаг 4. Опубликовать (основной путь — workbuddy_sites_deploy)

Файлы на диске уже записаны (шаги 1–3). Вызов:

```json
{
  "action": "deploy",
  "directory": "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow-deploy3",
  "language": "node",
  "port": 8777,
  "startCmd": "node server.js",
  "installCmd": "",
  "appName": "LexiFlow — тренажёр слов",
  "userAskedToPublish": true
}
```

`userAskedToPublish: true` — только если в **последнем сообщении**
пользователь просил опубликовать/обновить. Иначе площадка откажется
перезаписать живую ссылку и попросит подтверждение — тогда спросить
и повторить вызов с флагом.

## Шаг 5. Проверить, что загрузилось

```bash
# версия на хостинге
curl -s --max-time 20 "https://<адрес>/sw.js" | grep -o "lexiflow-v[0-9.]*" | head -1

# полная проверка в браузере
cd "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow" && \
  NODE_PATH="C:/Users/admin/.workbuddy-ai/binaries/node/workspace/node_modules" \
  "C:/Users/admin/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" \
  tools/check-live.js "https://<адрес>/index.html"
```

Ожидаем `ПРОВЕРКА ПРОЙДЕНА` и ту же версию, что на шаге 1.
Для полной уверенности — весь прогон по живому адресу:

```bash
LEXIFLOW_BASE="https://<адрес>/index.html" \
  NODE_PATH="C:/Users/admin/.workbuddy-ai/binaries/node/workspace/node_modules" \
  "C:/Users/admin/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" \
  tools/e2e-check.js 2>&1 | tail -3
```

Ожидаем `=== ОШИБКИ КОНСОЛИ: 0 ===`. Так проверялся релиз 13.10.2026.

## Чек-лист перед «готово»

- [x] `check-contract.js` + 1125 unit-проверок — 13.10.2026
- [x] `e2e-check.js` по локальному серверу — 0 ошибок консоли, 13.10.2026
- [x] `check-mobile.js` — однофайловая сборка открывается без ошибок, 13.10.2026
- [x] `lexiflow-deploy3/sw.js` имеет `lexiflow-v1.18.0` — 13.10.2026
- [x] Опубликованный `sw.js` отдаёт `lexiflow-v1.18.0` — 13.10.2026
- [x] `check-live.js` по живому адресу — `ПРОВЕРКА ПРОЙДЕНА`, 13.10.2026
- [x] Полный `e2e-check.js` по живому адресу — 0 ошибок консоли, 13.10.2026
- [ ] На телефоне открыть ссылку и подключиться по коду приглашения
      (или по коду хранилища, что вернёт `App.sync.join(token, gistId)`
      в консоли) — проверить пользователю.

## Файлы

- **Код приложения:** `lexiflow/` — рабочий проект.
- **Деплой:** `lexiflow-deploy3/` — копия для публикации, синхронизируется
  `tools/sync-deploy.js`. Старые `lexiflow-deploy/` и `lexiflow-deploy2/`
  не использовать: в первом v1.15.0, во второй мусор (`redesign-report.md`,
  `kokoro_voices.json` с текстом «Entry not found»).
- **Однофайловая сборка для телефона:** `lexiflow/lexiflow-mobile.html`,
  собирается `tools/build-mobile.js`, проверяется `tools/check-mobile.js`.
- **Копия проекта в «Документы»:** `C:\Users\admin\Documents\lexiflow`
  (если нужны правки там — это копия, синхронизировать с рабочей).

## Инструменты проекта (что чем запускать)

| Файл | Зачем |
|---|---|
| `tools/check-contract.js` | контракт модулей + полнота офлайн-оболочки (быстро, без браузера) |
| `tools/test-core.js` | ядро: SRS, магазин, импорт/экспорт, журнал ответов |
| `tools/test-sync.js` | синхронизация, слияние, коды приглашения |
| `tools/test-notify.js` | напоминания и схема IndexedDB для service worker |
| `tools/test-qr.js` | свой кодировщик QR |
| `tools/test-streak.js` | серия дней (js/streak.js) |
| `tools/e2e-check.js` | полный прогон в браузере (локально или по `LEXIFLOW_BASE`) |
| `tools/check-live.js <url>` | быстрая проверка опубликованного адреса |
| `tools/check-mobile.js` | однофайловая сборка (file://) |
| `tools/sync-deploy.js` | синхронизация деплой-папки |
| `tools/build-mobile.js` | сборка одного HTML-файла |
| `tools/build-audio-pack.js` | пакет озвучки (`audio/manifest.json`) |
| `tools/deploy-gh-pages.js` | GitHub Pages (нужен токен `public_repo`) |

## Важные нюансы (из MEMORY.md)

- **Подключение второго устройства — одним кодом.** На первом устройстве
  в «Синхронизация» показывается код `LF2-…` и QR с ним. На втором достаточно
  вставить код (или отсканировать камерой) — токен и адрес хранилища едут
  внутри кода, вручную их вводить не нужно. Код можно отозвать, пересоздав
  токен.
- **Автосинхронизация уже встроена** (js/sync.js): обмен при видимой вкладке
  каждые 15 с, в фоне раз в 5 мин, через 5 с после правки (удаления — через
  0,4 с), при возвращении онлайн и при возврате в приложение после >45 с
  отсутствия; при уходе со страницы неотправленное уезжает с keepalive.
  Управляется флагом `sync.auto` (по умолчанию вкл., тумблер в Настройках).
  Конфликты решаются слиянием: записи — по `updatedAt`, удаления —
  надгробиями, настройки — по `settingsUpdatedAt`.
- **Опубликованная версия ≠ локальная**: локальные правки
  не отражаются на живом хостинге, пока не деплой.
- **Service worker на телефонах держит кэш**: при смене версии
  `sw.js` старое приложение не подтянется само. Пользователю
  надо вручную обновить PWA (или открыть свежий адрес).
- **Разделы настроек — аккордеон**: все панели свёрнуты, содержимое
  появляется по клику на заголовок. В тестах кнопки внутри панели
  нажимать только после `expandPanel(page, селектор)`.
- **Гист хранит данные пользователей**: токен и `gistId` в облако
  не уходят (`syncPayload()` в `js/store.js` их вырезает). Не менять
  это поведение.
- **Старая публикация (v1.11.0, протухшая):**
  `https://dad281a3fe60497e8cae2672449197a9.sg.agentos-app.run`
  — площадка живая (05.10 проверка дала HTTP 200), но встроенный
  деплой-инструмент `workbuddy_sites_deploy` в сессиях больше не попадается
  (в каталоге инструментов его нет). Адрес оставить как запасной, не обновлять.
- **Папка для деплоя:** `C:\Users\admin\WorkBuddy AI\2026-09-19-21-29-08\lexiflow-deploy2`
  — облегчённая копия без `tools/`, `audio/`, `README.md`, `node_modules`.
  Есть `server.js` (слушает `$PORT`, биндится на `0.0.0.0`).
- **Гист для синхронизации:** `09d24472eb75e4dc78492f7805ffa7c5`
  (GitHub-аккаунт `dimasikcb`). Токен для деплоя в Pages — классический,
  скопы `gist, public_repo`; сам токен сюда НЕ записывать (секрет).
  Старый токен (только gist) отозван GitHub после утечки — не использовать.

## Шаг 1. Проверить актуальность версии

```bash
grep "lexiflow-v" "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow/sw.js" | head -1
```

Взяли из вывода версию `vX.Y.Z`. Если вы меняли код приложения —
**обязательно** поменяйте `VERSION` в `sw.js` (иначе офлайн-кэш не обновится).

## Шаг 2. Проверить, что прогоняются тесты

```bash
cd "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow"
# поднять локальный сервер на :8777 (в фоне, run_in_background: true)
"C:/Users/admin/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" -e "
const http=require('http'),fs=require('fs'),path=require('path'),root=process.cwd();
const srv=http.createServer((req,res)=>{
  let f=req.url==='/'?'/index.html':req.url;
  try{const c=fs.readFileSync(path.join(root,f));const ext=path.extname(f);
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.mp3':'audio/mpeg'};
  res.writeHead(200,{'Content-Type':types[ext]||'text/plain','Access-Control-Allow-Origin':'*'});res.end(c);
  }catch(e){res.writeHead(404);res.end('nf');}
});
srv.listen(8777,()=>console.log('serving on 8777'));
setTimeout(()=>process.exit(0),180000);
"
# потом (сервер уже на :8777):
NODE_PATH="C:/Users/admin/.workbuddy-ai/binaries/node/workspace/node_modules" \
  "C:/Users/admin/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" \
  tools/test-sync.js 2>&1 | tail -3
```

Ожидаю `ВСЕ ТЕСТЫ ПРОЙДЕНЫ: 319` (или больше, если растёт).
Если падают — чинить, не деплоить.

## Шаг 3. Синхронизировать deploy-папку (если меняли код)

```bash
cd "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow" && \
  "C:/Users/admin/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" -e "
const fs=require('fs'),path=require('path');
const src='C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow';
const dst='C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow-deploy2';
const SKIP=['tools','node_modules','.git','audio','README.md','PUBLISH.md'];
function walk(dir){
  for (const e of fs.readdirSync(dir,{withFileTypes:true})){
    if (SKIP.includes(e.name)) continue;
    const p=path.join(dir,e.name);
    const rel=path.relative(src,p);
    const t=path.join(dst,rel);
    if (e.isDirectory()){ fs.mkdirSync(t,{recursive:true}); walk(p); }
    else { fs.mkdirSync(path.dirname(t),{recursive:true}); fs.copyFileSync(p,t); }
  }
}
walk(src);
fs.copyFileSync(path.join(src,'server.js'), path.join(dst,'server.js'));
console.log('synced');
"
```

Памятка: в SKIP есть `PUBLISH.md` — не тащить инструкцию в деплой.

## Шаг 4. Опубликовать (одна команда: `tools/publish.js`)

`powershell
Set-Location 'C:\Users\admin\WorkBuddy AI\2026-09-19-21-29-08\lexiflow'
 = 'ghp_…'
node tools/publish.js
`'n'
Скрипт сам: поднимает патч-версию в `js/app.js` и `sw.js`, прогоняет
контракт и все юнит-тесты (упали — публикации нет), собирает
`lexiflow-mobile.html`, синхронизирует `lexiflow-deploy3`, деплоит на GitHub
Pages и проверяет, что живой адрес отдаёт новую версию. `--no-deploy` —
только проверки и сборка. Браузерные `check-*` запускать до публикации.

### Вручную (если нужен контроль по шагам)

Деплой идёт через GitHub API без git-клиента (git на машине не установлен).
Скрипт: `tools/deploy-gh-pages.js` — сам создаёт репозиторий `dimasikcb/lexiflow`,
заливает содержимое `lexiflow-deploy3/` одним коммитом (та же папка, что и для
сайта; `lexiflow-deploy2` больше не используется), включает Pages и ждёт
окончания сборки. Сообщение коммита берётся из `VERSION` в `sw.js`, поэтому
вранья вроде «Deploy LexiFlow v1.15.0» на 1.18.x больше не будет.

Подготовка: попросить у пользователя fresh-токен со скопом `public_repo`
(+ `gist` для синка) и положить его в `GH_TOKEN`. `GH_HEADERS` теперь
необязателен: без него скрипт сам собирает заголовки GitHub API
(User-Agent `lexiflow-deploy-script`, Accept `application/vnd.github+json`,
Content-Type `application/json`, авторизация `token <ТОКЕН>`).

```powershell
Set-Location 'C:\Users\admin\WorkBuddy AI\2026-09-19-21-29-08\lexiflow'
$env:GH_TOKEN = 'ghp_…'
& 'C:\Users\admin\.workbuddy-ai\binaries\node\versions\22.22.2-2\node.exe' tools\deploy-gh-pages.js
```

Перед запуском полезно `node tools/deploy-gh-pages.js --dry-run`: печатает
версию, число файлов и текст коммита, ничего не отправляя и не требуя токена.

Ожидаю в конце: `BUILD OK` и URL `https://dimasikcb.github.io/lexiflow/`.
Проверка после деплоя (шаг 5) обязательна.

Замечания:
- Скрипт идемпотентен: репозиторий и Pages не создаёт повторно,
  просто обновляет ветку `main` новым коммитом.
- В репозитории лежит служебный `README.md` из init-коммита —
  он не мешает и в деплой-папку не попадает.
- Токен — секрет: в PUBLISH.md и в любые файлы его не записывать.
  Если токен попал в переписку/файлы — отозвать на
  github.com/settings/tokens.

### Запасной путь (история): встроенный `workbuddy_sites_deploy`

На 28.09 он отдавал `fetch failed`, на 05.10 площадка была жива (HTTP 200),
но сам инструмент недоступен в сессиях. Если он снова появится в каталоге
инструментов, вызов такой (деплой-папка та же):

```json
{
  "directory": "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow-deploy2",
  "language": "node",
  "port": 8777,
  "startCmd": "node server.js",
  "installCmd": "",
  "appName": "LexiFlow тренажёр",
  "userAskedToPublish": true
}
```

`userAskedToPublish: true` только если **в текущей сессии** пользователь
просил опубликовать. Иначе оставить пустым — тогда вернётся
`sites_deploy_needs_confirmation`, спросить у пользователя и только
потом запустить снова с флагом.

### План Б: GitHub Pages без скрипта (вручную)

Не нужен — основной путь (выше) уже делает всё через GitHub API.
Если скрипт сломался: токен должен иметь скоп `public_repo`
(git-клиента на машине нет, поэтому только Contents/Git Data API).

### План В: локальный + туннель

Если публичная публикация совсем не нужна, достаточно:

```bash
cd "C:/Users/admin/WorkBuddy AI/2026-09-19-21-29-08/lexiflow" && \
  "C:/Users/admin/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" server.js
# run_in_background: true
```

И адрес `http://192.168.0.101:8777` (WiFi-IP ноутбука) —
для телефонов в той же сети. Проверить, что порт слушает на 0.0.0.0:

```bash
netstat -ano | grep "0.0.0.0:8777" | head -1
```

## Шаг 5. Проверить, что загрузилось

```powershell
curl.exe -s --max-time 15 "https://dimasikcb.github.io/lexiflow/sw.js" | findstr "lexiflow-v"
```

Должна показаться свежая версия (та, что из шага 1).
Старая не обновится у уже установленных PWA — service worker
принудительно перечитается только после смены `VERSION` в `sw.js`.

## Чек-лист перед «готово»

- [x] `test-sync.js` прошёл (319) — 05.10.2026, после правки addLog/removeLog
- [x] `lexiflow-deploy2/sw.js` имеет `VERSION = lexiflow-v1.16.0` — 05.10.2026
- [x] Опубликованный `sw.js` отдаёт `lexiflow-v1.16.0` на
      https://dimasikcb.github.io/lexiflow/ — 05.10.2026
- [ ] На телефоне открывается https://dimasikcb.github.io/lexiflow/
      и подключается по коду `09d24472eb75e4dc78492f7805ffa7c5`
      (или по коду хранилища, что вернёт `App.sync.join(token, gistId)`
      в консоли) — проверить пользователю.

## Файлы

- **Код приложения:** `lexiflow/` — рабочий проект.
- **Деплой:** `lexiflow-deploy2/` — облегчённая копия, её заливает
  `tools/deploy-gh-pages.js` (меньше объёма, без `tools/` и `audio/`).
- **Офлайн-версия для телефона (один HTML):** `lexiflow/lexiflow-mobile.html`.
  Пересоздавать тем же скриптом из шага «Планы B» — искать в истории.
- **Копия проекта в «Документы»:** `C:\Users\admin\Documents\lexiflow`
  (если нужны правки там — это копия, синхронизировать с рабочей).

## Важные нюансы (из MEMORY.md)

- **Автосинхронизация уже встроена** (js/sync.js): обмен при видимой вкладке
  каждые 15 с, в фоне раз в 5 мин, через 5 с после правки (удаления — через
  0.4 с), при возвращении онлайн и при возврате в приложение после >45 с
  отсутствия; при уходе со страницы неотправленное уезжает с keepalive.
  Управляется флагом `sync.auto` (по умолчанию вкл., тумблер в Настройках).
  Конфликты решаются слиянием: записи — по `updatedAt`, удаления —
  надгробиями, настройки — по `settingsUpdatedAt`.
- **Опубликованная версия ≠ локальная**: локальные правки
  не отражаются на живом хостинге, пока не деплой.
- **Service worker на телефонах держит кэш**: при смене версии
  `sw.js` старое приложение не подтянется само. Пользователю
  надо вручную обновить PWA (или открыть свежий адрес).
- **Гист хранит данные пользователей**: токен и `gistId` в облако
  не уходят (`syncPayload()` в `js/store.js` их вырезает). Не менять
  это поведение.
- **`doJoin()` берёт сохранённый токен** (строка ~284 в
  `js/views/sync.js`): `var token = tokenInput.value.trim() ||
  S.settings().sync.token;` — главный сценарий для 2-го устройства.

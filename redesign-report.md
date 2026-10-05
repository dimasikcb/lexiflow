# LexiFlow: редизайн (минимализм) + Duolingo-стрик + быстрые настройки
Отчёт исследования. Граница: только факты и рекомендации, код не менялся.
Все ссылки вида `файл:NN` от корня рабочей папки `lexiflow/`.

---

## 1. Текущая структура UI

### 1.1 Каркас
- `index.html:29-34` — каркас: `<aside id="sidebar">` (29), `<main id="main">` с `#install-bar` (31) и `#view` (32), `<nav id="tabbar">` (34). Всё содержимое экранов рендерится JS в `#view`.
- `index.html:36,38` — `#toasts` (36) и `#modal-root` (38).
- `index.html:9` — `data-theme="dark"` по умолчанию; тема управляется через `data-theme` (js/app.js:20).

### 1.2 Роутер и навигация
- Роутер: `js/app.js:204-281`. Hash-based парсинг `#/name/id/sub` — `app.js:206-213` (map маршрутов: decks, deck, study, test, browse, stats, settings, data, ai, sync, notify, phone).
- `render()` — `app.js:218-263`: switch по маршрутам (`app.js:237-251`), `settings → App.views.tools.renderSettings` (`app.js:239`), `data → App.views.tools.renderData` (`app.js:240`).
- `updateNav()` — `app.js:265-281`: активный таб (`deck→decks`, `test→study`, `data→settings`, `app.js:267-269`), заголовок документа (`app.js:272-274`).
- `NAV` — `app.js:186-192`, 5 табов: Колоды `#/decks`, Учить `#/study/all`, Словарь `#/browse/all`, Прогресс `#/stats`, **«Ещё» `#/settings`** (настройки).
- **Нижняя навигация на мобильных**: рендерится в `buildShell()` — `app.js:316-319` (`.tab` в `#tabbar`). Видима только ≤900px: `css/style.css:1174-1177` (`.sidebar { display:none }`, `.tabbar { display:flex }`). Стили таббара: `css/style.css:192-214`.
- Десктоп-сайдбар: `app.js:288-313` — brand, основная nav (NAV), вторичная nav (ai/sync/notify/phone/data, `app.js:301-307`), фут с `#theme-toggle` (`app.js:312`).

### 1.3 Экраны (js/views/*)
- decks.js — главный экран, экран колоды, редактор карточки; study.js — тренировка и тест; browse.js, stats.js, tools.js (настройки+данные), ai.js, sync.js, notify.js, phone.js.

### 1.4 Настройки сейчас: сколько тапов
Полный экран `renderSettings` — `js/views/tools.js:17-315`. Порядок панелей на странице — `tools.js:309`: head → Внешний вид (45) → Тренировка (69) → Озвучивание (78, голоса дальше) → syncPanel (303) → notifyPanel (304) → Приложение (257) → Хранилище (279) → about (307).
- **Тема**: на телефоне 2 тапа («Ещё» → segmented «Тема оформления», `tools.js:31-52`); на десктопе 1 тап (`#theme-toggle`, `app.js:312`).
- **Звук/TTS**: «Ещё» → прокрутка длинной страницы до «Озвучивание» (скорость/тон/громкость — `tools.js:83-90`, автоплей — `tools.js:93`).
- **Режим тренировки по умолчанию**: «Ещё» → панель «Тренировка» (`tools.js:60-66`).
- **Напоминания**: «Ещё» → notifyPanel (`tools.js:304`, сам panel — `js/views/notify.js`).
- Т.е. всё важное — 2 тапа + прокрутка страницы из ~8 панелей. Кнопки быстрых настроек на телефоне нет: `#theme-toggle` живёт только в десктопном сайдбаре (`app.js:312`).

### 1.5 Типографика и отступы
- Токены — `css/style.css:8-37` (`:root`): `--bg:#0e1016` (9), `--accent:#7c5cff` (14), тени (26-28), радиусы `--radius:18px / --radius-md:14px / --radius-sm:10px` (29-31), `--sidebar-w:268px` (32), `--maxw:1180px` (33), шрифт Inter (34). Светлая тема — `css/style.css:39-61`.
- Кастомные свойства есть, но **шкалы отступов нет** — паддинги/гэпы захардкожены россыпью (8, 9, 10, 12, 13, 14, 16, 18, 22, 26px…).
- База: body 15px/1.5 — `css/style.css:69-80`; `.page-title` 26px — `css/style.css:275-278`; `.page-sub` 13.5px — `css/style.css:280`; `.small` 13px — `css/style.css:91`.
- `.page` — паддинг 28/32/56, gap 22 — `css/style.css:120-128`; на ≤900px: 18/14 + нижний 96px под таббар, gap 16 — `css/style.css:1179`.

---

## 2. Минимализм: конкретные правки (эволюционно, без переписывания)

Принцип: правки только в CSS + точечно в разметке главного экрана; ни один id/класс не переименовывается (см. §5) — тесты и e2e не ломаются.

### 2.1 Единая шкала отступов
- `css/style.css:8` (`:root`) — добавить: `--sp-1:4px; --sp-2:8px; --sp-3:14px; --sp-4:20px;` и далее менять по месту, начиная с крупных блоков (не тотально):
  - `css/style.css:120-128` `.page` — `padding: 28px 32px 56px` → `padding: var(--sp-4) 28px 56px`, `gap: 22px` → `gap: var(--sp-4)`.
  - `css/style.css:302-310` `.ov-card` — `padding: 16px 18px` → `padding: var(--sp-3) var(--sp-4)`.

### 2.2 Меньше рамок/теней/глоу (главные источники шума)
- `css/style.css:337-342` `.deck-tile__glow` (радиальное пятно на каждой плитке колоды) — `opacity: .17` → `0` (или удалить блок). Самый заметный шум на главном экране.
- `css/style.css:335` `.deck-tile:hover` — убрать `transform: translateY(-3px)` и `box-shadow`, оставить только смену `border-color`.
- `css/style.css:233` `.btn--primary` — градиент + тень → `background: var(--accent); box-shadow: none;` (сплошной цвет).
- `css/style.css:150-155` `.brand__logo` — `box-shadow: 0 8px 22px …` → `box-shadow: none`.
- `css/style.css:27-28` смягчить токены теней: `--shadow` → `0 6px 16px rgba(0,0,0,.24)`, `--shadow-lg` → `0 16px 44px rgba(0,0,0,.32)`.
- `css/style.css:312` `.ov-card--accent` — градиент `linear-gradient(150deg,…)` → `background: var(--panel)` + `border-left: 2px solid var(--accent)` (тише, но выделяется).
- `css/style.css:358-366` `.count-pill` — убрать `border: 1px solid var(--border-soft)`, оставить фон `var(--panel-2)`; `.count-pill b` (367) оставить 14px.
- Радиусы — консистентнее и строже: `css/style.css:29-31` `--radius: 18px→14px; --radius-md: 14px→12px; --radius-sm: 10px→8px;` и точечно `.qcard` `css/style.css:824-831` `border-radius: 22px` → `16px`, `padding: 26px` → `22px`.

### 2.3 Крупнее приоритеты
- `css/style.css:316` `.ov-card__value` 27px → **31px** (цифры — главный контент главного экрана); мобильный вариант уже 23px (`css/style.css:1183` — поднять до 25px).
- `css/style.css:275-278` `.page-title` 26px — оставить (уже крупный).
- `css/style.css:397` `.panel__title` 16px → 15.5px, `font-weight: 650` (панели тише, приоритет — контент).
- Опционально убрать дубль-CTA: `js/views/decks.js:50-56` фут плитки всегда показывает «Учить» (активный при due>0, ghost иначе). Минимализм: ghost-вариант скрыть — `css: .deck-tile__cta--ghost { display:none }` (плитка без долга становится тише). Классы остаются, e2e не завязан на `.deck-tile__cta`.

### 2.4 Какие классы переиспользовать (ничего нового изобретать не надо)
`.ov-card`, `.panel` (`css/style.css:381-403`), `.setting-row` (`css/style.css:1100-1110`), `.chip/.chips` (447-461), `.segmented` (673-676), `.switch` (666-671), `.btn` + модификаторы (218-242), `.icon-btn` (244-261), `.empty` (505-521), `.kpi` (1034+), `.tag`, `.modal--sheet` (см. §4). Для стрика и быстрых настроек добавляются максимум 2 маленьких блока (`.streak-flame`, `.quick-fab`) — на базе существующих токенов.

---

## 3. Стрик как в Duolingo

### 3.1 Что уже есть (важно: стрик в коде УЖЕ существует)
- `js/store.js:491-505` — `S.streak(now)`: серия дней, в которых была **хотя бы 1** запись в logs. День = локальная дата (`U.dayKey`, `js/util.js:182-188`), старт дня (`U.startOfDay`, `js/util.js:175-179`), шаг `U.MS_DAY` (`js/util.js:172`). Если сегодня ещё не занимались — серия считается со вчера (`store.js:497-498`).
- Уже показывается: главный экран — ov-card «Серия дней» (`js/views/decks.js:141`, рендер `decks.js:178-182`); статистика — kpi «Серия» (`js/views/stats.js:261`, рендер `stats.js:281`); уведомления — `js/notify.js:201` кладёт `streak` в summary для service worker.
- Структура log: `js/store.js:405-425` — `{ id, ts, grade (1-4), mode, dir, correct, ms, deckId, cardId, stateFrom, stateTo, test }` (дефолты `store.js:407-420`). Пишется на каждый ответ тренировки/теста: `js/views/study.js:982-987` (тренировка) и `study.js:996-1000` (тест, `test:true`).

### 3.2 Где хранить: нигде, кроме рекорда (синк-безопасно)
- **Синхронизация logs**: `mergeLogs` — `js/sync.js:274-310`. Журнал **неизменяем**: «одинаковый id означает одинаковое содержимое» (`sync.js:281-285`), объединение по id без конфликтов, сортировка по ts (`sync.js:300-305`), лимит `LOG_LIMIT = 20000` (`sync.js:26`, дублирующий срез в `store.js:163`: `slice(-20000)`).
- Вывод пользователя подтверждён: **стрик правильнее деривировать из logs** — оба устройства из одинаковых logs посчитают одинаковую серию, конфликтов синка не будет. Отдельное поле `streak.current` в state не нужно и вредно (state-поля без merge-логики конфликтуют).
- **Рекорд (`best`)** из logs надёжно не вычислить: лимит 20000 записей со временем отрезает старые дни. Хранить рекорд в settings нельзя: настройки мержатся **целиком** по `settingsUpdatedAt` (`mergeSettings` — `sync.js:251-272`; тест фиксирует семантику «настройки берутся у победителя целиком, а не по полям» — `tools/test-sync.js:379`), т.е. рекорд с одного устройства затрётся любой более свежей правкой настроек с другого.
  - Рекомендация: `meta.streakBest`. `meta` мержится поверх (`Object.assign({}, remote.meta, local.meta)` — `sync.js:373-377`), значения на устройствах совпадают, т.к. обе стороны считают max одинаково; при записи всегда `best = max(best, current)`. Ограничение честно записать: при жёстком офлайн-расхождении `meta` может остаться device-local — не критично, это только рекорд-число.
- **Порог дня и часовой пояс**: порог — настройка `settings.streak = { threshold: 10 }` (объект влить по образцу `notify` в `DEFAULT_APP_SETTINGS` — `store.js:66-72` и в `migrate()` — `store.js:139-141`). Пояс: день определяется локальной датой устройства (`util.js:182-188`); на устройствах в разных поясах серия может считаться немного по-разному — принять как известное ограничение (у Duolingo то же поведение).

### 3.3 Правила (предложение)
- День засчитан при **≥10 ответах** (`threshold = min(10, dailyGoal)`, чтобы цель дня никогда не была ниже порога). Ответы = все записи logs (включая `test:true`) — тест тоже усилие; строгий вариант — только `test:false`, флаг вынести в настройку.
- **Фриз**: авто-заморозка **1 пропущенного дня на серию** (упрощение Duolingo без покупок): пока серия продолжается дальше, единственная «дырка» в 1 день её не рвёт, но и не добавляет день в счёт. Это тоже **деривируется из logs** — состояния не требует, синк-бесплатно.
- При пропуске ≥2 дней подряд (или дырка в конце) серия обнуляется — как сейчас.

### 3.4 Псевдокод
```js
// день = локальная дата пользователя (уже есть: U.dayKey, U.startOfDay, U.MS_DAY)
THRESHOLD = settings.streak.threshold || Math.min(10, settings.dailyGoal || 30)
FREEZE_MAX = 1  // авто-фриз: один пропуск на серию

function streakEx(now) {
  // counts: { 'YYYY-MM-DD': количество ответов } — logs уже отсортированы по ts (sync.js:300)
  counts = {};
  for (log of S.get().logs) counts[dayKey(log.ts)] = (counts[dayKey(log.ts)] || 0) + 1;

  cur = dayKey(startOfDay(now));            // сегодня
  activeToday = (counts[cur] || 0) >= THRESHOLD;
  if (!activeToday) cur = dayKey(startOfDay(now) - MS_DAY);  // как store.js:497-498

  current = 0; freezesLeft = FREEZE_MAX;
  while (true) {
    if ((counts[cur] || 0) >= THRESHOLD) { current++; cur = prevDay(cur); continue; }
    // фриз перекрывает ровно один пропуск, только если серия продолжается раньше
    if (freezesLeft > 0 && (counts[prevDay(cur)] || 0) >= THRESHOLD) {
      freezesLeft--; cur = prevDay(cur); continue;   // день не добавляется
    }
    break;
  }
  meta.streakBest = Math.max(meta.streakBest || 0, current);  // рекорд (max при записи)
  return { current, best: meta.streakBest, freezesLeft,
           today: { count: counts[dayKey(startOfDay(now))] || 0, threshold: THRESHOLD } };
}
```

### 3.5 Точки UI
- Главный экран: обогатить ov-card «Серия дней» (`decks.js:178-182`): огонёк 🔥 + `current`, hint = `best: N` / «сегодня X/10»; опционально мини-полоска 7 последних дней (данные уже в `counts`).
- Тренировка: в `study__bar` (`js/views/study.js:502-519`) справа от undo (`study.js:514-518`) добавить chip 🔥 `current` + `today.count/threshold`; обновлять после каждого ответа (точка — после `S.addLog`, `study.js:982-987` / `996-1000`).
- Статистика: kpi «Серия» (`stats.js:281`) — добавить `best`.
- Настройки: новый блок «Серия и цель» в `renderSettings` после панели «Тренировка» (`tools.js:69-76`): порог дня, вкл/выкл фриза (если фриз сделать отключаемым — флаг в `settings.streak`).
- Уведомления (`notify.js:201`) — переключить на новую функцию, семантика «серия» сохранится.

### 3.6 Совместимость
- Существующий `S.streak()` (`store.js:491-505`) **не переименовывать**: его вызывают `decks.js:141`, `stats.js:261`, `notify.js:201`. Добавить `streakEx()` и переподключить эти 3 вызова; старую функцию оставить (делегирует или работает по-старому).
- Тесты: `tools/test-notify.js:447` проверяет только `typeof sum.streak === 'number'` — безопасно. `tools/test-core.js:161` грузит `store.js` — добавить юнит-тесты на `streakEx` в test-core (порог, фриз, граница дня).

---

## 4. Быстрая кнопка настроек на телефоне

### 4.1 Куда поставить
- «Шапки» на мобильных нет — заголовки рисует каждый view. Нижняя навигация занята 5 табами, «Настройки» уже сидят в 5-м («Ещё») — дублировать табом не стоит (6 иконок на 360px при шрифте 10.5px — `css/style.css:210` — тесно).
- **Рекомендация**: плавающая круглая иконка-кнопка **`.quick-fab`** fixed в правом верхнем углу (`top: calc(10px + env(safe-area-inset-top)); right: 12px; z-index: 70;` — над контентом, под таббаром по логике слоёв), видима только ≤900px (там же, где `.tabbar` — `css/style.css:1174`). На study/test скрывается (`onStudy` уже вычисляется в `app.js:227`).
- Альтернатива, если FAB не нравится: кнопка в каждую `page-head__actions` — дороже (правки во всех views), отказано.

### 4.2 Какой экран: bottom sheet уже существует
- `U.modal()` — `js/util.js:300-357`: по умолчанию `sheet:true` (`util.js:302`), Esc/клик по оверлею закрывают, `body.is-locked` ставится. Мобильный стиль — `css/style.css:1192-1194`: `.modal--sheet` radius `20px 20px 0 0`, `max-height: 92dvh`, оверлей прижат к низу (`css/style.css:1191`). **Новый компонент модалки писать не нужно** — только содержимое.

### 4.3 Состав быстрых настроек (2 тапа до любого пункта)
1. Тема: segmented auto/тёмная/светлая — переиспользовать логику `tools.js:31-52` (+ `App.theme.apply`, `app.js:13-46`).
2. Звук/TTS: switch «Автоматически озвучивать карточку» (`ttsAutoPlay`) + слайдер «Громкость» (`ttsVolume`) — как в `tools.js:83-93`.
3. Режим по умолчанию: chips из `V.study.MODES` → `defaultMode` (как `tools.js:60-64`).
4. Напоминания: switch `notify.enabled` + время (cfg из `js/notify.js`).
5. После стрика: порог дня (число) + фриз on/off (`settings.streak`).
6. Ссылки-строки: «Все настройки» `#/settings`, «Синхронизация» `#/sync`, «Импорт/экспорт» `#/data` (роут-переходы закрывают sheet сами — смена маршрута вызывает `U.closeModals()`, `app.js:226`).

### 4.4 Точки правки
- `js/app.js` `buildShell()` (`app.js:284-320`): отрисовать `.quick-fab` (иконка `settings`, уже есть в наборе — используется в `decks.js:92`) рядом с таббаром; `onclick → App.views.quick.open()`.
- Новый файл `js/views/quick.js` (функция `open()` собирает sheet через `U.modal`) + `<script src="js/views/quick.js">` в `index.html` перед `js/app.js` (рядом с `index.html:53`). vm-тесты его не грузят — риск нулевой.
- `js/app.js` `router.render()` (`app.js:218-263`): после `updateNav` (`app.js:259`) — `qs('#quick-fab').classList.toggle('is-hidden', onStudy)` (переменная `onStudy` — `app.js:227`).
- `css/style.css`: блок `.quick-fab` (+ `.is-hidden`) в секции таббара (`css/style.css:190-214`), media ≤900px; содержимое sheet — только реиспользование `.setting-row`, `.switch-row`, `.segmented`, `.chips`.
- **Не трогать**: `#tabbar` рендер (`app.js:316-319`), NAV (`app.js:186-192`), порядок скриптов после `app.js`.

---

## 5. Как не сломать тесты: защищённые идентификаторы

### 5.1 vm-тесты (node, DOM полностью заглушен)
- `tools/test-sync.js:23-101` — фейковый DOM: `querySelector → null`, `querySelectorAll → []` (87-88, 42), элемент-заглушка без реального дерева. Грузит только `js/util.js, js/srs.js, js/store.js, js/sync.js, js/views/sync.js` (`test-sync.js:105`).
- `tools/test-core.js:161` — то же + `js/speech.js, js/ttsnet.js, js/views/ai.js`. `tools/test-notify.js:125` — + `js/notify.js, js/views/notify.js`.
- Утверждения по рендеру — **по тексту**, не по id (`test-sync.js:745-767`: «есть кнопка создания хранилища» и т.п.).
- Следствие: переименование DOM id/class vm-тесты не заметят. Опасно другое — переименование **API-имён** (`App.store.streak`, `S.reviewsToday`, `S.deckStats`, `S.updateSettings({dailyGoal})` — проверяется в `test-core`/`e2e-check.js:845`; `App.sync.merge/shouldRefreshOnRemote/shouldSyncOnResume`, `views.sync.panel().render`).

### 5.2 e2e-check.js (реальный браузер, Playwright) — вот что ломать нельзя
Селекторы, фактически используемые (`tools/e2e-check.js`):
- **id**: `#undo-btn` (304), `#ai-prompt` (413, 421), `#toasts .toast` (427).
- **каркас**: `.tabbar` видимость (932), `.sidebar` скрытость (933).
- **классы**: `.deck-tile` (96, 320), `.action-card` (103), `.modal button:has-text(...)` (108, 111), `.btn:has-text("Учить" | "Начать тренировку" | "Показать ответ" | "Далее" | "Импортировать" | "Промпт для нейросети" | "Скопировать промпт")` (117, 121, 275, 378, 411, 425, 438…), `.tts-notice` (+ `b`, `span`, `button`, `.icon-btn`) (139-195), `.qcard__word-text` (180, 211), `.tts-word` (213), `.qcard__word .icon-btn` (231), `.qcard__example-text` (288), `.rate` (301, 312), `.mode-card` (332, 357), `.choice` (349), `.table tbody tr` (390), `.segmented__item:has-text("Два")` (418), `.setting-row--switch` (419), `.range-row` (509), `.range-row__value` (510), `.voice-rows` (+ `select`, `.btn`, `.setting-row`) (511-517), `.voice-diag` (519), `.voice-diag__fix` (520).
- Плюс маршруты `#/decks #/study/all #/test/all #/stats #/browse/all #/data #/settings #/deck/...` и API `App.store.updateSettings` (845).

### 5.3 Защищённый список (итог)
- **id (не переименовывать)**: `#undo-btn`, `#ai-prompt`, `#toasts`, `#modal-root`, `#view`, `#tabbar`, `#sidebar`, `#main`, `#install-bar`, внутренние `#deck-list` (`decks.js:150`), `#study-label`, `#study-progress` (`study.js:506,510`), `#theme-toggle` (`app.js:25,312`).
- **классы (не переименовывать)**: все перечисленные в 5.2 + `.deck-tile__cta--ghost` можно только скрывать, не удалять из разметки.
- **API (не переименовывать)**: `S.streak/reviewsToday/deckStats/updateSettings/addLog`, `App.sync.*`, `App.theme.apply`, `V.study.MODES/DIRS`.
- Новые элементы (`.quick-fab`, `.streak-*`) — добавлять новыми именами, коллизий нет.

### 5.4 Деплой-примечание
CSS/JS кэшируются network-first (`sw.js:11-12`), но для чистоты инвалида кэша поднять `VERSION` — `sw.js:7` (`'lexiflow-v1.16.0'` → v1.17.0) при выкатке правок.

---

## Краткий итог рекомендаций
1. Минимализм: ~15 точечных правок в `css/style.css` (§2), из них самые заметные — убрать `.deck-tile__glow` (337-342), тени у primary-кнопки (233) и лого (150-155), ввести шкалу `--sp-*`, поднять `.ov-card__value` (316).
2. Стрик: деривировать из logs (уже начато `store.js:491-505`), порог 10 ответов, авто-фриз 1 день/серию, рекорд в `meta.streakBest`, псевдокод §3.4, UI — главный экран + study__bar + stats.
3. Быстрые настройки: `.quick-fab` (правый верх, ≤900px, скрыт в сессии) → bottom sheet через существующий `U.modal`/`.modal--sheet`; состав §4.3; правки — `app.js:buildShell`, `router.render`, новый `js/views/quick.js`, немного CSS.
4. Тесты: vm-тесты нечувствительны к DOM; e2e ломается на id/классы из §5.2 — список защищённых идентификаторов зафиксирован.

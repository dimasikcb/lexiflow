# LexiFlow — исследование для максимальной кастомизации тренажёра

Дата: 2026-10-05. Режим: только исследование, код не менялся.
Все ссылки — на текущий код рабочей папки. Всё, что помечено «определено», проверено по коду напрямую (файл:строка). Дизайн-предложения (разделы 3–5) — решения, не факты.

---

## 1. Инвентаризация существующих настроек

### 1.1 Глобальные settings (store.js)

Дефолты: `DEFAULT_APP_SETTINGS` — js/store.js:15-70. Хранение: `state.settings` в localStorage `lexiflow.data.v1` (store.js:14). Чтение: `S.settings()` store.js:439. Запись: `updateSettings(patch)` store.js:441-448 — `Object.assign` + `settingsUpdatedAt = Date.now()` + `notify('settings:update')`.

| Имя | Тип | Дефолт | Где в UI правится | Синхронизируется |
|---|---|---|---|---|
| `theme` | enum auto\|dark\|light | `'auto'` (store.js:16) | tools.js:33-52 (сегменты «Внешний вид», panel :45) | да |
| `defaultMode` | enum id режима | `'flip'` (store.js:17) | tools.js:53-57 (select «Режим по умолчанию») | да |
| `defaultDir` | enum fwd\|rev\|mixed | `'fwd'` (store.js:18) | tools.js:58-61 (select «Направление») | да |
| `sessionLimit` | число | `40` (store.js:19) | tools.js:63-64 («Карточек за сессию», min 0 max 500) | да |
| `dailyGoal` | число | `30` (store.js:20) | tools.js:66-67 («Цель повторений в день», min 5 max 1000) | да |
| `ttsRate` | число 0.5–1.4 | `0.95` (store.js:21) | tools.js:80-82 (rangeRow «Скорость речи») | да |
| `ttsPitch` | число 0.6–1.4 | `1` (store.js:22) | tools.js:83-85 | да |
| `ttsVolume` | число 0.3–1 | `1` (store.js:23) | tools.js:86-88 | да |
| `ttsVoice` | объект {lang: voiceURI} | `{}` (store.js:24) | tools.js:119-198 (voiceRow, закрепление голоса) | да |
| `ttsNoticeSeen` | объект-множество ключей | `{}` (store.js:28) | UI нет — пишется автоматически (study.js:80-86, 240-241) | да |
| `ttsHighlight` | bool | `true` (store.js:29) | tools.js:89 («Подсвечивать произносимое слово») | да |
| `ttsAutoPlay` | bool | `true` (store.js:30) | tools.js:90 («Автоматически озвучивать карточку») | да |
| `ttsNet.enabled/.downloaded` | bool / число | `true / 0` (store.js:40-43) | tools.js:336+ (блок сетевой озвучки) | **нет** — устройство-локальные (sync.js:269) |
| `showTranscription` | bool | `true` (store.js:44) | tools.js:46 | да |
| `keyboardShortcuts` | bool | `true` (store.js:45) | tools.js:71 | да |
| `reduceMotion` | bool | `false` (store.js:46) | tools.js:47-50 | да |
| `sync.*` | объект | store.js:49-55 | views/sync.js (экран «Синхронизация») | **нет** — устройство-локальные; токен/gistId не уезжают (syncPayload store.js:1065-1080, merge sync.js:261-265) |
| `notify.*` | объект | store.js:58-63 | views/notify.js:88-120 | **нет** — устройство-локальные (sync.js:267) |

Потребители вне настроек-экрана: `dailyGoal` — decks.js:138-140 (прогресс на дашборде), views/stats.js:270-273, notify.js:193-203 (текст напоминания, :202). `sessionLimit` — только study.js:364. `defaultMode/defaultDir` — study.js:362-363.

### 1.2 Настройки колоды (deck.settings)

Дефолты: `SRS.DEFAULT_SETTINGS` — js/srs.js:18-35. Санитизация: `SRS.sanitizeSettings` srs.js:44-65 (clampNum srs.js:37-42, cleanSteps srs.js:67-75). Редактор: `openDeckSettings` — js/views/decks.js:695-763 (модал «Интервалы повторения», кнопка-шестерёнка decks.js:72-73 → deckMenu). Сохранение: `S.updateDeck(deck.id, {settings: patch})` decks.js:751 → store.js:263-270, где patch повторно прогоняется через `SRS.sanitizeSettings` (store.js:267). При загрузке данных тоже: migrate store.js:~141-146. Дефолт при создании колоды: decks.js:228.

| Имя | Тип | Дефолт | Clamp в sanitize | Где в UI |
|---|---|---|---|---|
| `newPerDay` | int | `20` (srs.js:19) | 0–500 (srs.js:46) | decks.js:713 |
| `maxReviewsPerDay` | int | `300` (srs.js:20) | 0–2000 (srs.js:47) | decks.js:714 |
| `learningSteps` | int[] мин | `[1,10]` (srs.js:21) | сортировка, 0–100000, макс 6 эл. (srs.js:67-75) | decks.js:705 |
| `relearningSteps` | int[] мин | `[10]` (srs.js:22) | там же | decks.js:706 |
| `graduatingInterval` | int дн. | `1` (srs.js:23) | 1–365 (srs.js:49) | decks.js:707 |
| `easyInterval` | int дн. | `4` (srs.js:24) | 1–365 (srs.js:50) | decks.js:708 |
| `startingEase` | float | `2.5` (srs.js:25) | 1.3–4 (srs.js:51) | decks.js:715 |
| `easyBonus` | float | `1.3` (srs.js:26) | 1–3 (srs.js:52) | decks.js:716 |
| `hardInterval` | float | `1.2` (srs.js:27) | 1–2 (srs.js:53) | decks.js:717 |
| `intervalModifier` | float | `1.0` (srs.js:28) | 0.1–3 (srs.js:54) | decks.js:718 |
| `lapseMultiplier` | float | `0.0` (srs.js:29) | 0–1 (srs.js:55) | decks.js:719 |
| `minInterval` | int дн. | `1` (srs.js:30) | 1–30 (srs.js:56) | decks.js:720 |
| `maxInterval` | int дн. | `1095` (srs.js:31) | 1–36500 (srs.js:57) | decks.js:721 |
| `leechThreshold` | int | `8` (srs.js:32) | 1–50 (srs.js:58) | decks.js:722 |
| `autoPlayAudio` | bool | `true` (srs.js:33) | нет (не клампится) | **UI нет — «мёртвая» настройка** |
| `newOrder` | enum random\|added | `'random'` (srs.js:34) | нет | **UI нет; работает** (study.js:304-305) |

В редакторе decks.js:704-723 — только 14 полей; `autoPlayAudio` и `newOrder` в UI не показаны.

### 1.3 Механика sanitize/синхронизации (важно для схемы)

- Глобальные settings **не санитизируются**: migrate (store.js:130-139) делает shallow-merge дефолтов с сохранёнными + клонирует вложенные объекты (ttsVoice, ttsNoticeSeen, sync, notify, ttsNet). Клэмпов нет — диапазоны держатся только в UI (tools.js:63-67). Неизвестные поля проходят насквозь.
- `updateSettings` (store.js:441-448) тоже без sanitize: любой patch попадает в settings как есть.
- Синхронизация: побеждает сторона с большим `settingsUpdatedAt`, настройки берутся **целиком**, а не по полям (js/sync.js:251-271, база clone :257-258). Исключения — устройство-локальные блоки `sync`, `notify`, `ttsNet` (sync.js:261-269). `settingsUpdatedAt` в результате = max (sync.js:367).
- Настройки колоды едут в payload вместе с decks (store.js:1069-1070) и сливаются послайдово — sanitize на обоих концах (migrate при load/applyMerged).
- `dailyGoal` участвует в тесте «настройки берутся целиком»: tools/test-sync.js:373-379 (`r.data.settings.dailyGoal === undefined`).

### 1.4 Сводка: что уже кастомизируемо, что захардкожено

Уже кастомизируемо (с UI): размер сессии (глобально), цель дня (глобально), режим/направление по умолчанию (глобально), тема, транскрипция, горячие клавиши, reduce motion, весь TTS-блок, все SRS-интервалы колоды, `newPerDay`/`maxReviewsPerDay` на колоду.

Кастомизируемо «наполовину» (дефолт есть, UI нет): `newOrder` (работает, decks не может его поменять), `autoPlayAudio` на колоду (объявлена, движком не читается — см. §2.8).

Захардкожено (настроек нет вообще): автопауза между картами, таймер на ответ, глубина undo, число кнопок оценки, звуки/вибрация ответа, размер шрифта, порог часа смены суток, дефолт числа вопросов теста, пул дистракторов.

---

## 2. Найденные хардкоды тренировки (файл:NN, текущие значения)

2.1. **Размер сессии.** Дефолт глобальный `sessionLimit: 40` (store.js:19). Читается в лаунчере: `limit: S.settings().sessionLimit || 40` (study.js:364) в session-cfg `renderStudy._cfg` (study.js:361-367, живёт в памяти до перезагрузки). Поле ввода лаунчера: study.js:405-408 — `min: 0, max: 500`, клэмп `0..500`; подпись «Карточек за сессию» (study.js:439). Применение: `if (opts.limit) mainQueue = mainQueue.slice(0, opts.limit)` (study.js:315-316) — режется только main-очередь (review+new); learn-очередь не режется. Прокидывание в opts: study.js:457-462. Диапазон пользователя (5–100) сейчас не enforced: допустимо 0 («без ограничения», tools.js:63) и до 500.

2.2. **Дневной лимит новых.** `newPerDay` — на колоду (srs.js:19). Применение: study.js:287-302 — на каждую выбранную колоду `perDeck[id] = max(0, d.settings.newPerDay − S.newIntroducedToday(id))` (учёт по журналу: store.js:468-477, `stateFrom === 'new'`), потом сумма бюджетов. Обход: чекбокс «Учитывать дневные лимиты» лаунчера (study.js:410-413, UI :437) → `opts.ignoreLimits` (study.js:289-291).

2.3. **Дневной лимит повторений.** `maxReviewsPerDay` — на колоду (srs.js:20). Применение: `reviewBudget = min(review.length, settings.maxReviewsPerDay)` (study.js:309). **Квирк:** при выборе нескольких колод `deckSettingsFor` берёт дефолты SRS, а не настройки (study.js:37-41) — значит, для мультиколоды лимит повторений фактически всегда 300, а `newPerDay` при этом считается по-колодно (study.js:292-302). Схема кастомизации должна решить это явно (сумма/максимум по колодам или глобальный оверрайд).

2.4. **Порядок карт.** Новые: `newOrder` на колоду — `'random'` → shuffle, иначе сортировка по `createdAt` (study.js:304-305). Основная очередь: перемешивание только чекбоксом лаунчера «Перемешать порядок» (study.js:414-417, UI :438; применяется study.js:315) — не persisted, каждый раз с нуля. Review/learning всегда по `due` (study.js:280-284).

2.5. **Интервалы показа / «выучено».** Уже настройки колоды: шаги обучения `learningSteps`/`relearningSteps`, выпуск `graduatingInterval` (= порог «выучено» для состояния learning→review), `easyInterval`, и т.д. (см. §1.2). Отдельного флага «выучено» нет — состояние определяется машиной состояний SRS.

2.6. **Автопроизношение.** Глобально `ttsAutoPlay` (store.js:30): вопрос — study.js:704 (flip), :747 (choice), :898 (listening, задержка 320 мс), ответ — study.js:960-965. Задержка автопрогона вопроса захардкожена: `setTimeout(..., 260)` (study.js:951-957). Долрослой «пауза между картами» отсутствует — следующая карта показывается сразу после оценки (next(), study.js:576+). Дефолт `ttsRate` используется во всех точках озвучки (study.js:639, 656, 845-847, 935-938, 1286).

2.7. **Таймер на ответ.** Отсутствует. Единственное время — фиксация длительности ответа в журнал: `ms: now − session.cardStartTs` (study.js:985, 999; cardStartTs ставится в study.js:538, 595, 1088). Никаких лимитов/автопоказа по таймеру нет.

2.8. **Undo.** Стек на сессию: `session.undoStack` (study.js:484), push при каждом ответе (study.js:989-993, 1002). Кнопка `#undo-btn` (study.js:514-518), `undo()` study.js:1022-1040: восстанавливает `card.srs`, удаляет log, откатывает счётчики, выкидывает из learn-очереди. **Глубина не ограничена** (в пределах сессии), конфигурации нет. Горячая клавиша Ctrl+Z за флагом `keyboardShortcuts` (study.js:1254-1256).

2.9. **Число кнопок оценки.** Жёстко 4: `[1, 2, 3, 4].forEach` (study.js:908); шкала `GRADES` srs.js:14-17, подписи `GRADE_LABELS`, хоткеи `1..4` (srs.js:15-16, обработчик study.js:1254+). Превью интервалов: `SRS.preview` (study.js:906). Схема 2/4/6 потребует ветвления в ratingRow + семантики 6-кнопочной шкалы.

2.10. **Дефолт числа вопросов теста.** `count: min(20, available)` (study.js:1311), применяет `buildTestQueue(deckIds, cfg.count || 20)` (study.js:465), клэмп ввода 1..available (study.js:1337-1340). Пул с приоритетом: `cards.slice(0, max(count*2, count))` (study.js:341). Кнопка «Продолжить» добирает полную очередь без лимита: `limit: 0` (study.js:1197-1202).

2.11. **Граница суток.** «Сегодня» = `U.startOfDay` (store.js:452-455, 468-486) — календарная полночь; настройки «новый день начинается в N часов» нет.

2.12. **Вибрация/звуки ответа.** Отсутствуют полностью: grep `vibrate|new Audio|beep` по js/ — только воспроизведение TTS-аудио (ttsnet.js:412-414 и speech.js), фидбек-звуков оценки нет.

2.13. **Размер шрифта.** Настройки нет; база — css/style.css:72 (`font-size: 15px`) и точечные значения по всей таблице.

---

## 3. Предлагаемая схема параметров (двухуровневая: глобально + переопределение на колоде)

Принцип (как в Anki): поведение расписания/нагрузки — на уровне колоды с наследованием; сессионное поведение и «оболочка» — глобально. Глобальные поля синкаются автоматически (едут в `settings`), колодные — вместе с decks. Локальные для устройства (`sync/notify/ttsNet`) не трогаем.

Уровень: **G** = store settings, **D** = deck.settings. Поле «Override» — переопределяется ли на колоде.

| Параметр | Имя (предложение) | Уровень | Тип / диапазон | Дефолт | Override | Примечание |
|---|---|---|---|---|---|---|
| Карт за сессию | `sessionLimit` (существует) | G | int 5–100 (0 = без лимита — сохранить) | 40 | нет | уже синкается; клэмп добавить в sanitize |
| Новых карт в день | `newPerDay` (существует) | D | int 0–200 | 20 | — | клэмп сузить с 500 до 200 при желании |
| Максимум повторений в день | `maxReviewsPerDay` (существует) | D | int 0–2000 | 300 | — | для мультиколоды — сумма по колодам (фикс квирка §2.3) |
| Цель повторений в день | `dailyGoal` (существует) | G | int 5–1000 | 30 | нет | только индикация; не трогать имя — тесты/потребители |
| Желаемый retention | `desiredRetention` (новое) | G (потом D) | float 0.70–0.95, шаг 0.01 | 0.90 | да (позже) | резерв под FSRS-агента; пока только хранить и показывать |
| Число кнопок оценки | `ratingButtons` (новое) | G | enum 2\|4\|6 | 4 | нет | study.js:908 ветвление; 2 = Again/Good |
| Автопроизношение | `ttsAutoPlay` (G, существует) + `autoPlayAudio` (D, существует, «спит») | G+D | bool | true / true | да | правило: играть если G && (не D-оверрайд || D). Оживить D = 2–3 строки в study.js:704/747/961 |
| Пауза между картами | `autoAdvanceMs` (новое) | G | int 0–5000 мс | 0 | нет | вставить задержку в next()/после оценки |
| Режим (обычный/тест) | не настройка — уже выбор в лаунчере (study.js:427-446, 1355-1371) | — | — | — | — | `defaultMode` G остаётся дефолтом лаунчера |
| Тема | `theme` (существует) | G | enum auto\|dark\|light | auto | нет | без изменений |
| Размер шрифта | `fontScale` (новое) | G | enum s\|m\|l (или 0.9–1.3) | m | нет | html-класс + CSS-переменные поверх style.css:72 |
| Вибрация | `haptics` (новое) | G | bool | false | нет | navigator.vibrate на «Снова»/финиш; if supported |
| Звук ответа | `answerSound` (новое) | G | enum off\|correct\|wrong\|both | off | нет | короткие аудио-фидбеки; TTS не трогать |
| Порядок новых | `newOrder` (существует) | D | enum random\|added | random | — | добавить UI в decks.js:704-723 |
| Направление по умолчанию | `defaultDir` (G) + `dir` (D, новое) | G+D | enum fwd\|rev\|mixed | fwd | да | лаунчер предлагает D-значение, если задано |
| Таймер на ответ | `answerTimerSec` (новое) | G | int 0 = выкл, 10–120 | 0 | нет | авто-reveal/авто-Good по таймеру; низкий приоритет |
| Глубина undo | `undoDepth` (новое) | G | int 0 = безлимит, 1–50 | 0 | нет | обрезать push в study.js:989-1002 |
| Задержка автопрогона | `autoplayDelayMs` (новое) | G | int 100–3000 мс | 260 | нет | заменить константы study.js:957/898 |

Что куда положить (итог): **в settings (глобально, синкается)** — sessionLimit, dailyGoal, desiredRetention, ratingButtons, autoAdvanceMs, fontScale, haptics, answerSound, undoDepth, autoplayDelayMs, answerTimerSec, defaultDir; **в deck.settings** — newPerDay, maxReviewsPerDay, newOrder, dir, autoPlayAudio (+ позже desiredRetention-D). Не переезжают: всё расписание SRS остаётся на колоде (уже так).

### Санитизация новых полей (обратная совместимость)

1. **Глобальные:** завести `sanitizeAppSettings(raw)` по образцу `SRS.sanitizeSettings`: `Object.assign({}, DEFAULT_APP_SETTINGS, raw)` + клэмп каждого числа (повторить `clampNum`-паттерн srs.js:37-42) + валидация enum'ов (`['auto','dark','light'].indexOf(...) >= 0 ? v : def`). Вызывать в: migrate (store.js:130-139 вместо текущего shallow-merge), `updateSettings` (store.js:441-448, перед Object.assign), `applyMerged` (store.js:1086+ — фактически покрывается migrate). Это закроет и существующую дыру «настройки без клэмпов».
2. **Колодные:** новые поля добавить в `SRS.DEFAULT_SETTINGS` (srs.js:18-35) и в `sanitizeSettings` (srs.js:44-65: клэмпы + enum-проверки). Старые данные получают дефолты автоматически: migrate прогоняет каждую колоду через sanitizeSettings (store.js:~145), редактор сохраняет через updateDeck → sanitize (store.js:267).
3. **Синхронизация:** nothing extra — новые глобальные поля едут в settings и сливаются целиком по settingsUpdatedAt (sync.js:251-271); старый клиент их сохранит как неизвестные поля, новый клиент старым данным даст дефолты через sanitize. Ключевой инвариант теста не трогать: настройки берутся у победителя целиком, `dailyGoal` у проигравшего исчезает (tools/test-sync.js:373-379).
4. **Что не ломать в тестах** (проверено grep-ом):
   - tools/test-sync.js:370-394 — whole-winner слияние по settingsUpdatedAt; :397-431 — device-локальность sync/notify/ttsNet и вырезание токенов; :483-507 — syncPayload/applyMerged; :578-599 — tombstones/seed.
   - tools/test-core.js:189-277 — sanitize колодных настроек, включая мусор: `garbage.newPerDay === 0`, `maxInterval === 1` (:274-277) — новые колодные поля добавлять по этому образцу; :802-805 — правки пользователя не утекают в DEFAULT-объекты (новые вложенные объекты клонировать в freshSettings, store.js:79-88).
   - tools/e2e-check.js:845-854 — использует `updateSettings({ dailyGoal: 42 })`; :190, 674, 718, 771-775 — ttsNoticeSeen/ttsNet/sync. Переименований не делать.
   - Список защищённых DOM-id для e2e — за другим агентом (в tools/test-sync.js по grep 'protected|getElementById' не находится; e2e-check.js использует `#undo-btn` через UI, см. study.js:515).

---

## 4. UI-схема

Текущее состояние: один экран «Настройки» `#/settings` → `renderSettings` (js/views/tools.js:17+), секции-панели собираются декларативно: «Внешний вид» (tools.js:45), «Тренировка» (tools.js:69-75), «Озвучивание» (tools.js:78+), ниже вторичная навигация списком (app.js:303-310: ai, sync, notify, phone, data). Нижний таббар — 5 пунктов, строится из `NAV` (app.js:186-192); index.html содержит только `#main` и пустой `#tabbar` (index.html:33-35) — навигация полностью генерируется в app.js.

Рекомендация: **оставить один экран** с секциями (он и так вертикальный скролл; новые секции встраиваются как новые `panel(...)` вызовы), новых роутов не нужно:

- Расширить панель «Тренировка» (tools.js:69): ratingButtons, undoDepth, autoAdvanceMs, answerTimerSec — строки через существующие хелперы `row/switchRow/rangeRow`.
- Новая панель «Нагрузка» или внутри «Тренировки»: sessionLimit (уже там), dailyGoal (уже там) + сводка «по колодам: новых N, повторений M» со ссылками в редакторы колод.
- Новая панель «Внешний вид»: добавить fontScale к теме (tools.js:45-52).
- Новая панель «Обратная связь»: haptics, answerSound.
- **Пресеты** («Спокойный / Обычный / Интенсив»): три чипа-кнопки вверху панели «Тренировка» ИЛИ на экране лаунчера тренировки (study.js:427-446, перед «Начать тренировку»). Состав пресета = готовые наборы {sessionLimit, newPerDay, maxReviewsPerDay, dailyGoal, autoAdvanceMs}; применение = один `updateSettings(...)` + цикл `updateDeck(id, {settings})` по всем/выбранной колоде (оба API санитизацию дают бесплатно). Пресеты менять ничего неpersistят кроме самих значений (без поля «активный пресет» — меньше состояния, не синхронизируется лишнее).
- Настройки колоды: расширить модал openDeckSettings (decks.js:704-723) — добавить select `newOrder`, select `dir`, switch `autoPlayAudio` (когда оживёт), сохранив формат `items` (num/steps) как есть.
- Тесты: экран настроек скриншотится в e2e (tools/e2e-check.js:529, tools/screenshots.js:124) — структура DOM меняется добавлением, не переименованием; `updateSettings` вызовы сохранить.

Альтернатива (отклонена): отдельный роут `#/settings/training` — router поддерживает sub-параметр (app.js:200-207), но маппинга нет и выигрыша против панелей нет.

---

## 5. Порядок внедрения и оценка размера правок

Первая очередь (то, что просит пользователь, минимальным диффом):

1. **Карт за сеанс** — уже есть; работы: клэмп 5–100 (0 оставить как «без лимита») в sanitizeAppSettings + подпись-хинт. Файлы: store.js (санитизация), tools.js (хинт), study.js:405-408 (согласовать min/max).
2. **Новых карт в день** — уже есть на колоду (decks.js:713); добавить: показ остатка на лаунчере (данные уже есть: study.js:287-302) + пресеты.
3. **Максимум повторений в день** — уже есть (decks.js:714); починить мультиколоду (§2.3 квирк: deckSettingsFor study.js:37-41 → сумма/макс по выбранным колодам).
4. **Автопроизношение на колоду** — оживить `autoPlayAudio` (srs.js:33): условие в study.js:704, 747, 961 + switch в decks.js.
5. **Пресеты Спокойный/Обычный/Интенсив** — tools.js (панель «Тренировка») или study.js (лаунчер): ~1 функция применения + 3 набора значений.
6. **Порядок новых** — UI для `newOrder` в decks.js:704-723 (select) — поле уже работает (study.js:304-305).
7. **Пауза между картами + глубина undo** — новые глобальные поля, точки вставки: next()/оценка (study.js:576-598, 1011-1019) и push в undoStack (study.js:989-1002).

Вторая очередь: fontScale, haptics, answerSound, ratingButtons 2/4/6, answerTimerSec, autoplayDelayMs, dir на колоду, desiredRetention (поле создать сразу, семантику — вместе с FSRS-агентом).

Оценка размера правок (строки, ±20%):

| Файл | Первая очередь | Вторая очередь |
|---|---|---|
| js/store.js | +30–40 (новые дефолты, sanitizeAppSettings, хуки в migrate/updateSettings) | +15 |
| js/srs.js | +8–10 (autoPlayAudio в sanitize — тривиально; enum-хелпер) | +20 (dir, retention-клэмпы) |
| js/views/study.js | +35–45 (мультиколода-лимиты, D-autoplay, пауза, undo-глубина, остаток на лаунчере, пресет-кнопки если тут) | +30 (timer, delay, кнопки оценки) |
| js/views/tools.js | +60–80 (строки настроек + пресеты) | +50 |
| js/views/decks.js | +20–25 (newOrder, dir, autoPlayAudio в модал) | +10 |
| css/style.css | +0–10 | +15 (font-scale переменные) |
| tools/test-core.js | +15–25 (санитизация новых полей по образцу :274-277) | +10 |
| tools/test-sync.js | 0 (инварианты не трогаются) | 0 |

Риски/внимание: (а) не переименовывать `sessionLimit`/`dailyGoal` — тесты и notify.js:202; (б) sanitize глобальных настроек добавить до массового введения новых полей, иначе клэмпов нет нигде; (в) new-поля в freshSettings клонировать, если станут объектами (store.js:79-88 — прецедент ttsVoice); (г) e2e-скриншоты настроек перегенерировать.

---

## Приложение: точки-якоря для кодирующего агента

- Очередь: buildQueue study.js:270-323; тест-очередь study.js:333-344; старт сессии study.js:457-462; объект сессии study.js:468-488.
- Оценка: ratingRow study.js:903-921; запись ответа study.js:975-1019; undo study.js:1022-1040.
- Автозвук: study.js:704, 747, 898, 933-965; задержки 260/320 мс.
- Лимиты дня: newIntroducedToday store.js:468-477; reviewsToday store.js:479-487.
- Настройки: дефолты store.js:15-70; migrate store.js:127-153; updateSettings store.js:441-448; syncPayload store.js:1065-1080; applyMerged store.js:1086-1098.
- Слияние: sync.js:251-271 (settings), :367 (settingsUpdatedAt=max).
- Редактор колоды: decks.js:695-763; создание колоды decks.js:228.
- Навигация: app.js:186-192 (таббар), :303-310 (вторичные), :233-246 (роуты).

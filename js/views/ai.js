/* ============================================================
   LexiFlow — views/ai.js
   Конструктор промпта для нейросети: пользователь выбирает язык,
   тему, уровень и число примеров, а страница собирает готовый
   запрос под формат импорта LexiFlow.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util;
  var h = U.h, icon = U.icon;
  var V = (App.views = App.views || {});

  /* Падежные формы нужны, чтобы фраза в промпте звучала по-русски:
     «слов английского языка», «предложение на английском языке». */
  var LANGS = [
    { nom: 'английский', gen: 'английского', prep: 'английском' },
    { nom: 'немецкий', gen: 'немецкого', prep: 'немецком' },
    { nom: 'французский', gen: 'французского', prep: 'французском' },
    { nom: 'испанский', gen: 'испанского', prep: 'испанском' },
    { nom: 'итальянский', gen: 'итальянского', prep: 'итальянском' },
    { nom: 'португальский', gen: 'португальского', prep: 'португальском' },
    { nom: 'китайский', gen: 'китайского', prep: 'китайском' },
    { nom: 'японский', gen: 'японского', prep: 'японском' },
    { nom: 'турецкий', gen: 'турецкого', prep: 'турецком' },
    { nom: 'польский', gen: 'польского', prep: 'польском' },
    { nom: 'чешский', gen: 'чешского', prep: 'чешском' },
    { nom: 'арабский', gen: 'арабского', prep: 'арабском' }
  ];
  var LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

  function langOf(name) {
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].nom === name) return LANGS[i];
    }
    return { nom: name, gen: name, prep: name };
  }

  /** Настройки конструктора. Живут в памяти вкладки — переживать перезагрузку им не нужно. */
  var state = {
    lang: 'английский',
    topic: 'Повседневная жизнь',
    level: 'B1',
    count: 50,
    examples: 1,
    byDeck: false
  };

  /**
   * Собрать текст промпта.
   * Формулировки согласованы с парсером `store.importTabular()`: заголовки,
   * кавычки для полей с запятыми, отсутствие markdown-обёртки.
   */
  function buildPrompt(st) {
    st = st || state;
    var cols = ['Слово', 'Перевод', 'Транскрипция', 'Пример', 'Перевод примера'];
    if (st.examples > 1) cols.push('Пример 2', 'Перевод примера 2');
    if (st.byDeck) cols.unshift('Колода');

    var L = langOf(st.lang);
    var out = [];
    out.push('Создай список из ' + st.count + ' слов ' + L.gen + ' языка по теме «' + st.topic +
      '» уровня ' + st.level + ' для изучения русского человека.');
    out.push('');
    out.push('Верни результат ТОЛЬКО как CSV-файл, без пояснений и без markdown-разметки (без ```).');
    out.push('Первая строка — заголовки ровно такие:');
    out.push(cols.join(','));
    out.push('');
    out.push('Требования к строкам:');

    var n = 0;
    if (st.byDeck) {
      out.push(++n + '. Колода — короткое название подтемы: разложи слова по 3–4 подтемам внутри темы «' + st.topic + '».');
    }
    out.push(++n + '. Слово — на ' + L.prep + ' языке, в словарной форме (для глаголов — инфинитив; в английском — с частицей to).');
    out.push(++n + '. Перевод — на русском, кратко, можно несколько значений через запятую.');
    out.push(++n + '. Транскрипция — в IPA, без квадратных скобок, например: ɔːlˈðəʊ');
    out.push(++n + '. Пример — короткое предложение на ' + L.prep + ' языке, в котором есть это слово.');
    out.push(++n + '. Перевод примера — точный перевод этого предложения на русский.');
    out.push(++n + '. Если внутри значения есть запятая или кавычки — оберни всё поле в двойные кавычки: "хотя, несмотря на"');
    out.push(++n + '. Никаких пустых полей и повторов слов.');
    if (st.examples > 1) {
      out.push(++n + '. Второй пример должен показывать другое значение или другой контекст.');
    }
    out.push('');
    out.push('Сохрани ответ в файл words.csv в кодировке UTF-8.');
    return out.join('\n');
  }

  function render(root) {
    var area = h('textarea', {
      class: 'input input--area input--mono', id: 'ai-prompt', rows: 18, spellcheck: 'false'
    });

    function refresh() {
      area.value = buildPrompt(state);
      // Поле растёт под текст, чтобы промпт было видно целиком.
      // scrollHeight имеет смысл только когда элемент уже в документе,
      // поэтому первый вызов идёт после U.append().
      area.style.height = 'auto';
      var hgt = area.scrollHeight;
      area.style.height = (hgt > 0 ? Math.min(hgt + 12, 560) : 220) + 'px';
    }

    /* --- Параметры --- */
    // Внимание: `selected`/`checked` нельзя передавать в h() как boolean —
    // setAttribute('selected','false') всё равно выделяет пункт. Ставим свойства вручную.
    var langSel = h('select', { class: 'input' },
      LANGS.map(function (l) { return h('option', { value: l.nom, text: l.nom.charAt(0).toUpperCase() + l.nom.slice(1) }); }));
    langSel.value = state.lang;
    langSel.addEventListener('change', function () { state.lang = this.value; refresh(); });

    var topicIn = h('input', { class: 'input', value: state.topic, maxlength: 80, placeholder: 'Например: Путешествия' });
    topicIn.addEventListener('input', function () { state.topic = this.value.trim() || 'Повседневная жизнь'; refresh(); });

    var levelSel = h('select', { class: 'input' },
      LEVELS.map(function (l) { return h('option', { value: l, text: l }); }));
    levelSel.value = state.level;
    levelSel.addEventListener('change', function () { state.level = this.value; refresh(); });

    var countIn = h('input', { class: 'input', type: 'number', min: '5', max: '300', step: '5', value: String(state.count) });
    countIn.addEventListener('input', function () {
      state.count = U.clamp(parseInt(this.value, 10) || 50, 5, 300);
      refresh();
    });

    var exSeg = h('div', { class: 'segmented' });
    [[1, 'Один'], [2, 'Два']].forEach(function (o) {
      exSeg.appendChild(h('button', {
        class: 'segmented__item' + (state.examples === o[0] ? ' is-active' : ''),
        onclick: function () {
          state.examples = o[0];
          U.qsa('.segmented__item', exSeg).forEach(function (b) { b.classList.remove('is-active'); });
          this.classList.add('is-active');
          refresh();
        }
      }, h('span', { text: o[1] })));
    });

    var deckBox = h('input', { type: 'checkbox' });
    deckBox.checked = state.byDeck;
    deckBox.addEventListener('change', function () { state.byDeck = this.checked; refresh(); });

    var deckRow = h('label', { class: 'setting-row setting-row--switch' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: 'Разложить по колодам' }),
        h('span', { class: 'muted small', text: 'Модель добавит колонку «Колода» и распределит слова по подтемам.' })
      ),
      h('span', { class: 'switch' }, deckBox, h('span', { class: 'switch__track' }))
    );

    var params = panel('Что нужно выучить', 'target',
      settingRow('Язык', 'Слова, которые вы учите.', langSel),
      settingRow('Тема', 'Чем уже тема, тем полезнее список.', topicIn),
      settingRow('Уровень', 'Сложность слов и предложений.', levelSel),
      settingRow('Сколько слов', 'Оптимально 20–50 за раз: список реально выучить.', countIn),
      settingRow('Примеров на слово', 'Два примера показывают слово в разных контекстах.', exSeg),
      deckRow
    );

    /* --- Готовый промпт --- */
    var copyBtn = h('button', { class: 'btn btn--primary btn--sm', onclick: function () {
      U.copyText(area.value).then(function (ok) {
        U.toast(ok ? 'Промпт скопирован — вставьте его в нейросеть'
          : 'Скопировать не удалось: выделите текст в поле и нажмите Ctrl+C', ok ? 'ok' : 'err', 4200);
      });
    } }, icon('copy', 15), h('span', { text: 'Скопировать промпт' }));

    var downloadBtn = h('button', { class: 'btn btn--ghost btn--sm', onclick: function () {
      U.download('prompt-lexiflow.txt', area.value, 'text/plain');
      U.toast('Файл с промптом сохранён', 'ok');
    } }, icon('download', 15), h('span', { text: 'Скачать .txt' }));

    var resetBtn = h('button', { class: 'btn btn--ghost btn--sm', onclick: function () {
      refresh();
      U.toast('Промпт собран заново по параметрам выше', 'ok');
    } }, icon('refresh', 15), h('span', { text: 'Собрать заново' }));

    var promptPanel = panel('Готовый промпт', 'brain',
      h('p', { class: 'muted small', text: 'Скопируйте текст в ChatGPT, Gemini, Claude или DeepSeek. Текст можно править прямо в поле — кнопки работают с тем, что в нём написано.' }),
      area,
      h('div', { class: 'inline-row' }, copyBtn, downloadBtn, resetBtn)
    );

    /* --- Как использовать --- */
    var howPanel = panel('Как это использовать', 'info',
      h('ol', { class: 'steps' },
        h('li', {}, h('b', { text: 'Скопируйте промпт' }), ' и вставьте его в чат с нейросетью. Замените тему, язык и уровень прямо в тексте, если нужно.'),
        h('li', {}, h('b', { text: 'Сохраните ответ файлом.' }), ' Если в чате есть кнопка «Скачать» — нажмите её и переименуйте файл в ', h('code', { text: 'words.csv' }), '. Если кнопки нет — скопируйте текст в Блокнот, уберите обрамляющие ', h('code', { text: '```' }), ' и сохраните с кодировкой UTF-8.'),
        h('li', {}, h('b', { text: 'Загрузите файл в LexiFlow.' }), ' Экран «Импорт / экспорт» → «Выбрать файл» → «Импортировать».')
      ),
      h('div', { class: 'inline-row' },
        h('button', { class: 'btn btn--primary btn--sm', onclick: function () { App.router.go('#/data'); } }, icon('upload', 15), h('span', { text: 'Перейти к импорту' })),
        h('a', { class: 'btn btn--ghost btn--sm', href: 'import-templates/sample-en-ru.csv', download: 'sample-en-ru.csv' },
          icon('download', 15), h('span', { text: 'Скачать пример CSV' })),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { showFormats(); } }, icon('eye', 15), h('span', { text: 'Форматы и колонки' }))
      )
    );

    /* --- Если не получилось --- */
    var troublePanel = panel('Если импорт не сработал', 'warning',
      h('ul', { class: 'tips' },
        h('li', {}, h('b', { text: 'Все слова слиплись в одну карточку.' }), ' Модель отдала таблицу не через запятую — попросите «строго CSV, разделитель — запятая».'),
        h('li', {}, h('b', { text: 'Слова есть, примеров нет.' }), ' Сверьте заголовки: их должно быть ровно ', h('code', { text: 'Слово,Перевод,Транскрипция,Пример,Перевод примера' }), '.'),
        h('li', {}, h('b', { text: 'Строки разъехались.' }), ' В примере была запятая, а поле не в кавычках. Напомните модели: «поля с запятыми — в двойных кавычках».'),
        h('li', {}, h('b', { text: 'Слова пропущены как дубликаты.' }), ' Такие слова уже есть в колоде — снимите галочку «Пропускать дубликаты» при импорте.'),
        h('li', {}, h('b', { text: 'Нужны ещё примеры.' }), ' Вернитесь к параметру «Примеров на слово» и выберите «Два».')
      )
    );

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go('#/data'); } }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'Промпт для нейросети' }),
          h('p', { class: 'page-sub', text: 'Соберите запрос — нейросеть вернёт готовый файл со словами' })
        )
      )
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page page--narrow' }, head, params, promptPanel, howPanel, troublePanel)]);
    refresh();
  }

  /** Справка по форматам файла — тем же составом, что и на экране данных. */
  function showFormats() {
    U.modal({
      title: 'Колонки файла',
      body: h('div', {},
        h('p', { class: 'modal__text', text: 'Минимальный набор — слово и перевод. Остальное добавляется, если модель его выдала.' }),
        h('pre', { class: 'code code--wrap', text:
          'Слово,Перевод,Транскрипция,Пример,Перевод примера\n' +
          'although,хотя,ɔːlˈðəʊ,"Although it was late, we kept working.","Хотя было поздно, мы продолжали работать."' }),
        h('ul', { class: 'tips' },
          h('li', {}, h('code', { text: 'Пример 2' }), ' и ', h('code', { text: 'Перевод примера 2' }), ' — второй пример на карточку.'),
          h('li', {}, h('code', { text: 'Колода' }), ' — разложить строки по колодам.'),
          h('li', {}, 'Несколько примеров в одной ячейке разделяйте ', h('code', { text: '||' }), '.'),
          h('li', {}, 'Формат JSON сохраняет прогресс повторений — он используется для резервных копий.')
        )
      ),
      actions: [{ label: 'Понятно', variant: 'primary' }]
    });
  }

  function settingRow(title, hint, control) {
    return h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: title }),
        h('span', { class: 'muted small', text: hint })
      ),
      h('div', { class: 'setting-row__control setting-row__control--stack' }, control)
    );
  }

  function panel(title, iconName) {
    var children = Array.prototype.slice.call(arguments, 2);
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title' }, icon(iconName, 17), h('span', { text: title }))
      ),
      h('div', { class: 'panel__body' }, children.filter(Boolean))
    );
  }

  V.ai = { render: render, buildPrompt: buildPrompt, state: state };
})(window);

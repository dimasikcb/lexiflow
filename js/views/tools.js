/* ============================================================
   LexiFlow — views/tools.js
   Настройки приложения и работа с данными: импорт, экспорт,
   резервные копии, установка PWA, офлайн-режим.
   ============================================================ */
(function (global) {
  'use strict';
  var App = (global.App = global.App || {});
  var U = App.util, S = App.store, SRS = App.srs, SP = App.speech;
  var h = U.h, icon = U.icon;
  var V = (App.views = App.views || {});

  /* ============================================================
     Настройки
     ============================================================ */

  function renderSettings(root) {
    var st = S.settings();
    var data = S.get();

    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go('#/decks'); } }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'Настройки' }),
          h('p', { class: 'page-sub', text: 'Интерфейс, режимы тренировки, озвучивание и хранилище' })
        )
      )
    );

    /* --- Внешний вид --- */
    var themeRow = h('div', { class: 'segmented' });
    [['auto', 'Как в системе'], ['dark', 'Тёмная'], ['light', 'Светлая']].forEach(function (o) {
      themeRow.appendChild(h('button', {
        class: 'segmented__item' + (st.theme === o[0] ? ' is-active' : ''),
        onclick: function () {
          S.updateSettings({ theme: o[0] });
          App.theme.apply(o[0]);
          U.qsa('.segmented__item', themeRow).forEach(function (b) { b.classList.remove('is-active'); });
          this.classList.add('is-active');
        }
      }, h('span', { text: o[1] })));
    });

    var appearance = panel('Внешний вид', 'palette',
      row('Тема оформления', themeRow),
      switchRow('Показывать транскрипцию', st.showTranscription, function (v) { S.updateSettings({ showTranscription: v }); }),
      switchRow('Меньше анимаций', st.reduceMotion, function (v) {
        S.updateSettings({ reduceMotion: v });
        document.documentElement.classList.toggle('reduce-motion', v);
      })
    );

    /* --- Тренировка --- */
    var modeSel = h('select', { class: 'input' });
    V.study.MODES.forEach(function (m) { modeSel.appendChild(h('option', { value: m.id, text: m.label, selected: st.defaultMode === m.id })); });
    modeSel.addEventListener('change', function () { S.updateSettings({ defaultMode: modeSel.value }); });

    var dirSel = h('select', { class: 'input' });
    V.study.DIRS.forEach(function (d) { dirSel.appendChild(h('option', { value: d.id, text: d.label, selected: st.defaultDir === d.id })); });
    dirSel.addEventListener('change', function () { S.updateSettings({ defaultDir: dirSel.value }); });

    var limitInput = h('input', { class: 'input input--num', type: 'number', min: 0, max: 500, value: st.sessionLimit });
    limitInput.addEventListener('change', function () { S.updateSettings({ sessionLimit: Math.max(0, Number(this.value) || 0) }); });

    var goalInput = h('input', { class: 'input input--num', type: 'number', min: 5, max: 1000, value: st.dailyGoal });
    goalInput.addEventListener('change', function () { S.updateSettings({ dailyGoal: Math.max(1, Number(this.value) || 30) }); });

    var training = panel('Тренировка', 'play',
      row('Режим по умолчанию', modeSel),
      row('Направление', dirSel),
      row('Карточек за сессию', limitInput, '0 — без ограничения'),
      row('Цель повторений в день', goalInput),
      switchRow('Горячие клавиши (1–4, Пробел, Ctrl+Z)', st.keyboardShortcuts, function (v) { S.updateSettings({ keyboardShortcuts: v }); })
    );

    /* --- Озвучивание --- */
    var ttsPanel = panel('Озвучивание', 'sound',
      SP.supported()
        ? h('div', {},
            rangeRow('Скорость речи', '0,95× — обычный темп. Ниже 0,8× удобно разбирать трудные слова.',
              0.5, 1.4, 0.05, st.ttsRate, function (v) { return U.round1(v) + '×'; },
              function (v) { S.updateSettings({ ttsRate: v }); }),
            rangeRow('Тон', 'Выше 1,2 звучит неестественно — держитесь около единицы.',
              0.6, 1.4, 0.05, st.ttsPitch === undefined ? 1 : st.ttsPitch, function (v) { return U.round1(v); },
              function (v) { S.updateSettings({ ttsPitch: v }); }),
            rangeRow('Громкость', 'Синтез речи идёт в общий поток устройства — системный микшер тоже влияет.',
              0.3, 1, 0.05, st.ttsVolume === undefined ? 1 : st.ttsVolume, function (v) { return Math.round(v * 100) + '%'; },
              function (v) { S.updateSettings({ ttsVolume: v }); })
          )
        : h('p', { class: 'muted small', text: 'Синтез речи недоступен в этом браузере. Аудирование и озвучивание слов будут скрыты.' }),
      SP.supported() ? switchRow('Подсвечивать произносимое слово', st.ttsHighlight !== false, function (v) { S.updateSettings({ ttsHighlight: v }); }) : null,
      SP.supported() ? switchRow('Автоматически озвучивать карточку', st.ttsAutoPlay, function (v) { S.updateSettings({ ttsAutoPlay: v }); }) : null,
      SP.supported() ? h('p', { class: 'muted small', text: 'Слова подсвечиваются синхронно с речью — это работает как субтитры. Если браузер не сообщает границы слов (Safari), подсветка идёт по расчётному темпу речи.' }) : null
    );

    /* Голоса для языков, которые есть в колодах */
    if (SP.supported()) {
      var voiceRows = h('div', { class: 'voice-rows' });

      /**
       * Фраза для прослушивания. Одно слово не показывает ни темп, ни паузы,
       * поэтому берём пример из колоды — на нём слышно, как звучит речь целиком.
       */
      function sampleFor(lang) {
        var word = null;
        var sentence = null;
        data.cards.forEach(function (c) {
          if (sentence) return;
          var d = S.getDeck(c.deckId);
          if (!d || SP.baseLang(d.langFrom) !== lang) return;
          if (!word && c.word) word = c.word;
          var ex = (c.examples || []).filter(function (e) { return e.text; })[0];
          if (ex) sentence = ex.text;
        });
        return sentence || word || 'Hello';
      }

      function deckLanguages() {
        var seen = {}, out = [];
        data.decks.forEach(function (d) {
          [d.langFrom, d.langTo].forEach(function (code) {
            var base = SP.baseLang(code);
            if (!base || seen[base]) return;
            seen[base] = true;
            out.push(base);
          });
        });
        return out;
      }

      function voiceRow(lang) {
        var list = SP.voicesFor(lang);
        var pinned = (st.ttsVoice && st.ttsVoice[lang]) || '';
        var sel = h('select', { class: 'input' });
        sel.appendChild(h('option', {
          value: '',
          text: list.length ? 'Автоматически — лучший доступный' : 'Голоса для этого языка не найдены'
        }));
        list.forEach(function (v) {
          sel.appendChild(h('option', {
            value: v.voiceURI,
            text: v.name + (v.localService === false ? ' · онлайн' : '')
          }));
        });
        sel.value = pinned;
        sel.addEventListener('change', function () {
          var next = Object.assign({}, st.ttsVoice || {});
          if (this.value) next[lang] = this.value; else delete next[lang];
          st.ttsVoice = next;
          S.updateSettings({ ttsVoice: next });
          U.toast(this.value ? 'Голос закреплён' : 'Голос снова выбирается автоматически', 'ok', 2400);
        });

        var sample = sampleFor(lang);
        var effective = SP.resolveVoice(lang, pinned);
        var quality = SP.voiceQuality(effective, lang);
        return h('div', { class: 'setting-row' },
          h('div', { class: 'setting-row__text' },
            h('b', { text: SP.LANG_NAMES[lang] || lang.toUpperCase() }),
            h('span', { class: 'inline-row' },
              h('span', { class: 'quality-badge quality-badge--' + quality.level, text: quality.label }),
              h('span', { class: 'muted small', text: effective ? effective.name : 'голос не найден' })
            ),
            h('span', { class: 'muted small', text: list.length + ' ' + U.plural(list.length, 'голос', 'голоса', 'голосов') +
              ' · ' + quality.hint })
          ),
          h('div', { class: 'setting-row__control setting-row__control--stack' },
            sel,
            h('div', { class: 'inline-row' },
              h('button', {
                class: 'btn btn--ghost btn--sm',
                title: sample,
                /* Здесь НАМЕРЕННО системный голос, а не файл: кнопка отвечает
                   на вопрос «как звучит выбранный голос», и подменить её
                   файлом — значит обмануть человека. Настройки темпа, высоты
                   и громкости тоже действуют только на синтез. */
                onclick: function () { SP.speak(sample, lang, { rate: st.ttsRate, pitch: st.ttsPitch, volume: st.ttsVolume }); }
              }, icon('sound', 15), h('span', { text: 'Прослушать: ' + (sample.length > 42 ? sample.slice(0, 40).trim() + '…' : sample) }))
            )
          )
        );
      }

      /** Сводка: понятно, что за голос звучит и что делать, если он плохой. */
      function voiceDiagnostics(langs) {
        var all = SP.voices();
        var worst = SP.worstQuality(langs) || SP.voiceQuality(null, langs[0]);
        var browser = SP.browserName();

        var fix = null;
        if (worst.level === 'neural') {
          fix = 'Всё в порядке: браузер отдаёт нейросетевой голос.';
        } else if (browser === 'Edge') {
          fix = 'В Edge есть нейросетевые голоса Microsoft Natural — выберите голос с этим словом в названии в списке ниже.';
        } else if (browser === 'Chrome' || browser === 'Яндекс Браузер' || browser === 'Opera') {
          fix = 'Этот браузер берёт голоса из системы, и они звучат механически. Откройте приложение в Microsoft Edge — там те же нейросетевые голоса Microsoft Natural доступны бесплатно и без ключей.';
        } else if (browser === 'Firefox') {
          fix = 'Firefox в Windows читает только системные голоса. Откройте приложение в Microsoft Edge, чтобы получить нейросетевые голоса Microsoft Natural.';
        } else {
          fix = 'Откройте приложение в браузере с нейросетевыми голосами — например, в Microsoft Edge на компьютере или в Chrome на Android.';
        }

        return h('div', { class: 'voice-diag voice-diag--' + worst.level },
          h('div', { class: 'voice-diag__head' },
            icon('sound', 16),
            h('b', { text: worst.label }),
            h('span', { class: 'muted small', text: 'браузер: ' + browser + ' · голосов найдено: ' + all.length })
          ),
          h('p', { class: 'voice-diag__fix', text: fix })
        );
      }

      function fillVoiceRows() {
        U.clear(voiceRows);
        var langs = deckLanguages();
        if (!langs.length) {
          voiceRows.appendChild(h('p', { class: 'muted small', text: 'Создайте колоду — здесь появятся голоса для её языков.' }));
          return;
        }
        voiceRows.appendChild(voiceDiagnostics(langs));
        langs.forEach(function (l) { voiceRows.appendChild(voiceRow(l)); });
      }

      fillVoiceRows();
      // список голосов браузер отдаёт асинхронно — перерисовываем, когда он придёт
      var onVoicesChanged = function () {
        if (!document.body.contains(voiceRows)) {
          try { global.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged); } catch (e) { /* ignore */ }
          return;
        }
        fillVoiceRows();
      };
      try { global.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged); } catch (e) { /* ignore */ }

      ttsPanel.querySelector('.panel__body').appendChild(
        h('div', { class: 'panel__section' },
          h('span', { class: 'field__label', text: 'Голоса' }),
          voiceRows,
          h('p', { class: 'muted small', text: 'Приложение не обращается к платным сервисам: оно использует голоса, которые уже есть в браузере. Голоса с пометкой Natural, Neural или Google звучат естественно, «Compact» — механически. Если голос помечен как «онлайн», в офлайне браузер вернётся к системному.' })
        )
      );
    }

    /* --- Качественная озвучка из интернета (js/ttsnet.js) ---
       Здесь человек сам решает отдать текст фраз на сторонний сервис.
       По умолчанию это выключено, поэтому панель начинается с честного
       предупреждения, а не с кнопки «Скачать». */
    var netSection = ttsNetSection(data);
    if (netSection) ttsPanel.querySelector('.panel__body').appendChild(netSection);

    /* --- Приложение и офлайн --- */
    var swStatus = h('span', { class: 'tag tag--muted', text: App.pwa.statusText() });
    var installBtn = h('button', { class: 'btn btn--primary', onclick: function () { App.pwa.promptInstall(); } },
      icon('install', 17), h('span', { text: 'Установить приложение' }));

    var appPanel = panel('Приложение', 'install',
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Установка на устройство' }),
          h('span', { class: 'muted small', text: 'Добавьте LexiFlow на главный экран — приложение откроется без браузера и будет работать офлайн.' })
        ),
        App.pwa.canInstall() ? installBtn : h('span', { class: 'tag', text: App.pwa.isStandalone() ? 'Уже установлено' : 'Через меню браузера' })
      ),
      row('Офлайн-режим', swStatus),
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Версия' }),
          h('span', { class: 'muted small', text: 'LexiFlow 1.0 · данные хранятся только на этом устройстве' })
        ),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { App.pwa.update(); } }, icon('refresh', 15), h('span', { text: 'Проверить обновления' }))
      )
    );

    /* --- Хранилище --- */
    var used = App.util.bytesOf(JSON.stringify(data));
    var quota = 5 * 1024 * 1024;
    var pct = Math.min(100, Math.round(used / quota * 100));
    var storagePanel = panel('Хранилище', 'layers',
      h('div', { class: 'storage' },
        h('div', { class: 'storage__row' },
          h('span', { text: 'Занято: ' + App.util.fmtBytes(used) + ' из ~5 МБ' }),
          h('b', { text: pct + '%' })
        ),
        h('div', { class: 'progress' }, h('div', { class: 'progress__bar', style: { width: pct + '%' } })),
        h('div', { class: 'storage__stats' },
          chip(String(data.decks.length), 'колод'),
          chip(String(data.cards.length), 'карточек'),
          chip(String(data.logs.length), 'записей журнала')
        )
      ),
      h('div', { class: 'inline-row' },
        h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { App.router.go('#/data'); } }, icon('download', 15), h('span', { text: 'Импорт и экспорт' })),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { App.router.go('#/ai'); } }, icon('sparkle', 15), h('span', { text: 'Промпт для нейросети' })),
        h('button', { class: 'btn btn--danger btn--sm', onclick: wipeAll }, icon('trash', 15), h('span', { text: 'Удалить все данные' }))
      ),
      !S.isStorageOk() ? h('p', { class: 'warn-text', text: 'Внимание: браузер не смог сохранить данные. Освободите место и сделайте резервную копию.' }) : null
    );

    /* --- Синхронизация и напоминания ---
       Панели живут в своих модулях: у каждого своя логика и свои тесты.
       Здесь только подключаем их в общий экран настроек. */
    var syncPanel = (App.views.sync && App.views.sync.panel) ? App.views.sync.panel() : null;
    var notifyPanel = (App.views.notify && App.views.notify.panel) ? App.views.notify.panel() : null;

    var about = h('div', { class: 'about' },
      h('p', {}, 'LexiFlow — тренажёр иностранных слов с интервальным повторением. ',
        'Работает полностью на вашем устройстве: слова, прогресс и статистика не отправляются на серверы.'),
      h('p', { class: 'muted small', text: 'Совет: делайте экспорт резервной копии — данные хранятся в браузере и могут быть потеряны при очистке сайта.' })
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page page--narrow' }, head, appearance, training, ttsPanel, syncPanel, notifyPanel, appPanel, storagePanel, about)]);
  }

  /* ============================================================
     Качественная озвучка из интернета (js/ttsnet.js)
     ============================================================ */

  /**
   * Скачивание озвучки со стороннего сервиса в кэш браузера.
   *
   * Зачем это вообще: голос в систему из веб-страницы поставить нельзя —
   * в Web Speech API такого метода нет (проверено аудитором: у speechSynthesis
   * только speak/cancel/pause/resume/getVoices, у SpeechSynthesisVoice —
   * только чтение свойств, new SpeechSynthesisVoice() даёт TypeError).
   * А на проверенной машине для en/de/fr/es голосов в системе НОЛЬ.
   * Единственный доступный способ получить естественную речь — скачать
   * готовые файлы. Плата за это — текст фраз уходит на чужой сервер,
   * поэтому по умолчанию режим выключен.
   */
  function ttsNetSection(data) {
    var T = App.ttsnet;
    if (!T) return null;

    function netSettings() { return S.settings().ttsNet || { enabled: false, downloaded: 0 }; }

    function saveNet(patch) {
      var cur = netSettings();
      S.updateSettings({ ttsNet: {
        enabled: patch.enabled === undefined ? !!cur.enabled : !!patch.enabled,
        downloaded: patch.downloaded === undefined ? (cur.downloaded || 0) : patch.downloaded
      } });
    }

    var statusText = h('span', { class: 'muted small', text: 'Считаю скачанное…' });
    var barFill = h('div', { class: 'progress__bar', style: { width: '0%' } });
    var progressText = h('span', { class: 'muted small' });
    var progressWrap = h('div', { class: 'tts-net__progress', style: { display: 'none' } },
      progressText, h('div', { class: 'progress progress--sm' }, barFill));

    function setProgress(text, pct) {
      progressWrap.style.display = '';
      progressText.textContent = text;
      barFill.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
    }

    /**
     * Строка состояния. Число берётся из кэша, а не из настроек: настройки
     * синхронизируются между устройствами, а кэш у каждого свой, и число
     * из настроек показало бы на телефоне чужие фразы.
     */
    function refreshStats() {
      return T.stats().then(function (s) {
        statusText.textContent = s.count
          ? 'Фраз сохранено: ' + s.count + ', занимает ' + U.fmtBytes(s.bytes) + '.'
          : 'Пока ничего не скачано.';
        saveNet({ downloaded: s.bytes });
        return s;
      }).catch(function () {
        statusText.textContent = 'Не удалось прочитать кэш озвучки.';
        return { count: 0, bytes: 0 };
      });
    }

    /** Фразы колоды: слово и примеры — на её языке, перевод — на языке перевода. */
    function deckPhrases(deckId) {
      var deck = S.getDeck(deckId);
      if (!deck) return {};
      var byLang = {};
      function add(lang, text) {
        if (!lang || !text) return;
        var base = SP.baseLang(lang);
        if (!byLang[base]) byLang[base] = [];
        byLang[base].push(text);
      }
      S.cardsOf(deckId).forEach(function (c) {
        add(deck.langFrom, c.word);
        add(deck.langTo, c.translation);
        (c.examples || []).forEach(function (ex) { if (ex && ex.text) add(deck.langFrom, ex.text); });
      });
      return byLang;
    }

    var enabledInput = h('input', { type: 'checkbox', checked: !!netSettings().enabled });
    enabledInput.addEventListener('change', function () {
      saveNet({ enabled: enabledInput.checked });
      U.toast(enabledInput.checked
        ? 'Озвучка из интернета включена'
        : 'Озвучка из интернета выключена — остаётся системный голос', 'ok', 2800);
    });

    /**
     * Включение — это согласие отдать текст фраз на чужой сервер, поэтому
     * оно всегда через явный вопрос, а не «само собой» при нажатии кнопки.
     */
    function ensureEnabled() {
      if (netSettings().enabled) return Promise.resolve(true);
      return U.confirmDialog('Включить озвучку из интернета?',
        'Текст озвучиваемых фраз уйдёт на сторонний бесплатный сервис code.responsivevoice.org. ' +
        'Нужен интернет; скачанное потом работает без интернета. Сервис может отказать — тогда ' +
        'приложение вернётся к системному голосу.',
        'Включить').then(function (ok) {
          if (!ok) return false;
          saveNet({ enabled: true });
          enabledInput.checked = true;
          return true;
        });
    }

    var deckSel = h('select', { class: 'input' });
    data.decks.forEach(function (d) {
      deckSel.appendChild(h('option', { value: d.id, text: d.name }));
    });

    function downloadDeck() {
      var deckId = deckSel.value;
      if (!deckId) return;
      var byLang = deckPhrases(deckId);
      var langs = Object.keys(byLang);
      if (!langs.length) { setProgress('В этой колоде нечего озвучивать.', 0); return; }

      var total = 0;
      langs.forEach(function (l) { total += byLang[l].length; });
      var seen = 0, failed = 0;
      setProgress('Скачиваю: 0 из ' + total, 0);

      /* Языки по очереди: у preload свой предел параллелизма, складывать их
         нельзя — сервис чужой и бесплатный. */
      var chain = Promise.resolve();
      langs.forEach(function (lang) {
        chain = chain.then(function () {
          return T.preload(byLang[lang], lang, function (p) {
            var processed = seen + p.done + p.failed;
            setProgress('Скачиваю: ' + Math.min(processed, total) + ' из ' + total,
              total ? processed / total * 100 : 0);
          });
        }).then(function (res) {
          failed += res.failed;
          seen += res.done + res.failed;
          return res;
        });
      });

      chain.then(refreshStats).then(function (s) {
        if (!s.count) { setProgress('Не удалось: сервис озвучки недоступен. Остаётся системный голос.', 0); return; }
        setProgress(failed
          ? 'Готово частично: озвучено ' + s.count + ' фраз, ' + U.fmtBytes(s.bytes) + '. Часть фраз сервис не отдал.'
          : 'Готово: озвучено ' + s.count + ' фраз, ' + U.fmtBytes(s.bytes) + ' — теперь работает без интернета.', 100);
      }).catch(function () {
        setProgress('Не удалось: сервис озвучки недоступен. Остаётся системный голос.', 0);
      });
    }

    function listenSample() {
      var deck = S.getDeck(deckSel.value);
      var lang = deck ? SP.baseLang(deck.langFrom) : 'en';
      var byLang = deckPhrases(deckSel.value);
      var sample = (byLang[lang] || [])[0] || 'Hello';
      setProgress('Скачиваю пример: ' + sample, 30);
      T.play(sample, lang, {}).then(function (ok) {
        if (ok) { setProgress('Играет: ' + sample, 100); refreshStats(); return; }
        setProgress('Не удалось получить пример — сервис не ответил.', 0);
      });
    }

    var deckRow = h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: 'Скачать озвучку колоды' }),
        h('span', { class: 'muted small', text: 'Слова, переводы и примеры выбранной колоды сохранятся в браузере.' })
      ),
      h('div', { class: 'setting-row__control setting-row__control--stack' },
        data.decks.length ? deckSel : h('span', { class: 'muted small', text: 'Сначала создайте колоду.' }),
        h('div', { class: 'inline-row' },
          h('button', {
            class: 'btn btn--primary btn--sm',
            disabled: data.decks.length ? null : true,
            onclick: function () { ensureEnabled().then(function (ok) { if (ok) downloadDeck(); }); }
          }, icon('download', 15), h('span', { text: 'Скачать озвучку' })),
          h('button', {
            class: 'btn btn--ghost btn--sm',
            disabled: data.decks.length ? null : true,
            onclick: function () { ensureEnabled().then(function (ok) { if (ok) listenSample(); }); }
          }, icon('sound', 15), h('span', { text: 'Послушать пример' }))
        )
      )
    );

    var clearBtn = h('button', {
      class: 'btn btn--danger btn--sm',
      onclick: function () {
        U.confirmDialog('Очистить скачанную озвучку?',
          'Файлы озвучки будут удалены из кэша браузера. Системный голос продолжит работать, ' +
          'а скачанные фразы при необходимости можно загрузить снова.', 'Очистить')
          .then(function (ok) {
            if (!ok) return;
            T.purge().then(function (n) {
              U.toast('Удалено фраз: ' + n, 'ok', 2600);
              setProgress('Кэш озвучки очищен.', 0);
              return refreshStats();
            });
          });
      }
    }, icon('trash', 15), h('span', { text: 'Очистить кэш' }));

    /* Статус считаем сразу при отрисовке панели. */
    refreshStats();

    return h('div', { class: 'panel__section tts-net' },
      h('span', { class: 'field__label', text: 'Качественная озвучка из интернета' }),
      h('div', { class: 'tts-net__warn' },
        h('span', {}, h('b', { text: 'Нужен интернет. ' }),
          'Текст озвучиваемых фраз отправляется на сторонний бесплатный сервис ' +
          '(code.responsivevoice.org). По умолчанию это выключено.'),
        h('span', {}, 'Скачанное остаётся в браузере и работает без интернета. ',
          'Сервис бесплатный и может перестать работать — тогда приложение вернётся к системному голосу, ' +
          'ничего не сломается.'),
        h('span', {}, 'Голос в системе этот режим не меняет: он только добавляет второй источник звука.')
      ),
      h('label', { class: 'setting-row setting-row--switch' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Скачивать озвучку из интернета' }),
          h('span', { class: 'muted small', text: 'Кнопка 🔊 сначала берёт скачанный файл, и только если его нет — системный голос.' })
        ),
        h('span', { class: 'switch' }, enabledInput, h('span', { class: 'switch__track' }))
      ),
      deckRow,
      progressWrap,
      h('div', { class: 'tts-net__status' }, statusText, clearBtn),
      h('p', { class: 'muted small', text: 'Выбора голоса здесь нет намеренно: у сервиса параметр voice= не работает — Russian Female и Russian Male дают байтово одинаковый файл (проверено). Меняется только язык.' })
    );
  }

  function panel(title, iconName, ...children) {
    return h('section', { class: 'panel' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title' }, icon(iconName, 17), h('span', { text: title }))
      ),
      h('div', { class: 'panel__body' }, children.filter(Boolean))
    );
  }

  function row(label, control, hint) {
    return h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' },
        h('b', { text: label }),
        hint ? h('span', { class: 'muted small', text: hint }) : null
      ),
      h('div', { class: 'setting-row__control' }, control)
    );
  }

  /** Строка с ползунком: подпись, значение и пояснение под ними. */
  function rangeRow(label, hint, min, max, step, value, format, onChange) {
    var input = h('input', { class: 'input', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    var out = h('span', { class: 'range-row__value muted small', text: format(value) });
    input.addEventListener('input', function () {
      var v = Number(this.value);
      out.textContent = format(v);
      onChange(v);
    });
    return row(label, h('div', { class: 'range-row' }, input, out), hint);
  }

  function switchRow(label, checked, onChange) {
    var input = h('input', { type: 'checkbox', checked: checked });
    input.addEventListener('change', function () { onChange(input.checked); });
    return h('label', { class: 'setting-row setting-row--switch' },
      h('div', { class: 'setting-row__text' }, h('b', { text: label })),
      h('span', { class: 'switch' }, input, h('span', { class: 'switch__track' }))
    );
  }

  function chip(value, label) {
    return h('span', { class: 'storage__chip' }, h('b', { text: value }), h('span', { text: label }));
  }

  function wipeAll() {
    var synced = !!(S.settings().sync && S.settings().sync.gistId);
    var question = synced
      ? 'Все колоды, слова и статистика будут удалены и здесь, и в синхронизированном хранилище. ' +
        'Отменить это нельзя. Если нужно стереть данные только на этом устройстве, сначала ' +
        'отключите синхронизацию.'
      : 'Все колоды, слова и статистика будут удалены с этого устройства. Действие необратимо.';

    U.confirmDialog('Удалить все данные?', question, 'Удалить всё')
      .then(function (ok) {
        if (!ok) return;
        /* Именно clearData, а не wipe: он ставит надгробия и сохраняет токен.
           После wipe данные вернулись бы из облака при первой же синхронизации. */
        S.clearData();
        U.toast(synced ? 'Данные удалены здесь и в хранилище' : 'Все данные удалены', 'ok', 3600);
        App.router.go('#/decks');
      });
  }

  /* ============================================================
     Импорт / экспорт
     ============================================================ */

  function renderData(root) {
    var data = S.get();
    var head = h('div', { class: 'page-head' },
      h('div', { class: 'page-head__main' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: function () { App.router.go('#/settings'); } }, icon('back', 20)),
        h('div', {},
          h('h1', { class: 'page-title', text: 'Импорт и экспорт' }),
          h('p', { class: 'page-sub', text: 'Резервные копии, перенос слов между устройствами, CSV и JSON' })
        )
      )
    );

    /* --- Экспорт --- */
    var deckExport = h('div', { class: 'export-list' });
    data.decks.forEach(function (d) {
      var count = S.cardsOf(d.id).length;
      deckExport.appendChild(h('div', { class: 'export-row' },
        h('div', { class: 'export-row__main' },
          h('span', { class: 'dot', style: { background: d.color } }),
          h('b', { text: d.name }),
          h('span', { class: 'muted small', text: count + ' ' + U.plural(count, 'слово', 'слова', 'слов') })
        ),
        h('div', { class: 'export-row__actions' },
          h('button', { class: 'btn btn--ghost btn--sm', onclick: function () {
              U.download(V.decks.safeName(d.name) + '.json', S.exportDeck(d.id, true), 'application/json');
              U.toast('Колода экспортирована', 'ok');
            } }, icon('download', 15), h('span', { text: 'JSON' })),
          h('button', { class: 'btn btn--ghost btn--sm', onclick: function () {
              U.download(V.decks.safeName(d.name) + '.csv', S.exportCsv([d.id]), 'text/csv');
              U.toast('Колода экспортирована в CSV', 'ok');
            } }, icon('download', 15), h('span', { text: 'CSV' }))
        )
      ));
    });

    var exportPanel = panel('Экспорт', 'download',
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Полная резервная копия (JSON)' }),
          h('span', { class: 'muted small', text: 'Колоды, слова, прогресс, статистика и настройки в одном файле.' })
        ),
        h('button', { class: 'btn btn--primary', onclick: function () {
            U.download('lexiflow-backup-' + U.dayKey(Date.now()) + '.json', S.exportAll(), 'application/json');
            U.toast('Резервная копия сохранена', 'ok');
          } }, icon('download', 16), h('span', { text: 'Скачать' }))
      ),
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Все слова в CSV' }),
          h('span', { class: 'muted small', text: 'Открывается в Excel, Google Таблицах и Anki-совместимых сервисах.' })
        ),
        h('button', { class: 'btn btn--ghost', onclick: function () {
            U.download('lexiflow-words-' + U.dayKey(Date.now()) + '.csv', S.exportCsv(null), 'text/csv');
            U.toast('Файл сохранён', 'ok');
          } }, icon('download', 16), h('span', { text: 'Скачать' }))
      ),
      deckExport.childNodes.length ? h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Отдельные колоды' }), deckExport) : null
    );

    /* --- Импорт --- */
    var targetSel = h('select', { class: 'input' });
    targetSel.appendChild(h('option', { value: '', text: '— создать новую колоду —' }));
    data.decks.forEach(function (d) { targetSel.appendChild(h('option', { value: d.id, text: 'В колоду: ' + d.name })); });

    var newDeckName = h('input', { class: 'input', placeholder: 'Название новой колоды', value: 'Импорт ' + U.dayKey(Date.now()) });
    var dedupeInput = h('input', { type: 'checkbox', checked: true });
    var reverseInput = h('input', { type: 'checkbox', checked: false });
    var headerInput = h('input', { type: 'checkbox', checked: true });
    var replaceInput = h('input', { type: 'checkbox', checked: false });

    var area = h('textarea', {
      class: 'input input--area input--mono', rows: 7,
      placeholder: 'Вставьте сюда:\n• JSON резервной копии\n• CSV/TSV: слово, перевод, транскрипция\n• строки вида «word - перевод»'
    });

    var fileInput = h('input', { type: 'file', accept: '.json,.csv,.tsv,.txt', class: 'hidden' });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        area.value = String(reader.result || '');
        U.toast('Файл «' + f.name + '» загружен — проверьте настройки и нажмите «Импортировать»', 'ok', 3600);
      };
      reader.readAsText(f);
      fileInput.value = '';
    });

    function doImport() {
      var text = area.value.trim();
      if (!text) { U.toast('Вставьте данные или выберите файл', 'err'); return; }
      var isJson = text[0] === '{' || text[0] === '[';
      if (isJson && replaceInput.checked) {
        try {
          var payload = JSON.parse(text);
          U.confirmDialog('Заменить все данные?', 'Текущие колоды и прогресс будут полностью заменены данными из файла.', 'Заменить')
            .then(function (ok) {
              if (!ok) return;
              S.replaceAll(payload, 'replace');
              U.toast('Данные восстановлены из резервной копии', 'ok', 3600);
              App.router.refresh();
            });
        } catch (e) { U.toast('Некорректный JSON', 'err'); }
        return;
      }
      var res = S.importText(text, {
        deckId: targetSel.value || null,
        newDeckName: newDeckName.value.trim() || 'Импортированная колода',
        dedupe: dedupeInput.checked,
        reverse: reverseInput.checked,
        skipHeader: headerInput.checked
      });
      if (res.error) { U.toast(res.error, 'err'); return; }
      U.toast('Добавлено слов: ' + res.added + (res.skipped ? ' · пропущено: ' + res.skipped : '') +
        (res.decks ? ' · новых колод: ' + res.decks : ''), 'ok', 4200);
      App.router.refresh();
    }

    var importPanel = panel('Импорт', 'upload',
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-row__text' },
          h('b', { text: 'Куда добавить слова' }),
          h('span', { class: 'muted small', text: 'Выберите существующую колоду или создайте новую.' })
        ),
        h('div', { class: 'setting-row__control setting-row__control--stack' }, targetSel, newDeckName)
      ),
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Данные' }), area,
        h('div', { class: 'inline-row' },
          h('button', { class: 'btn btn--ghost btn--sm', onclick: function () { fileInput.click(); } }, icon('upload', 15), h('span', { text: 'Выбрать файл' })),
          fileInput,
          h('button', {
            class: 'btn btn--ghost btn--sm',
            onclick: function () { App.router.go('#/ai'); }
          }, icon('sparkle', 15), h('span', { text: 'Промпт для нейросети' })),
          h('span', { class: 'muted small', text: 'Поддерживаются .json, .csv, .tsv, .txt' })
        )
      ),
      h('div', { class: 'panel__section' },
        h('span', { class: 'field__label', text: 'Параметры' }),
        h('div', { class: 'options-grid' },
          checkOption(dedupeInput, 'Пропускать дубликаты'),
          checkOption(headerInput, 'Первая строка — заголовки'),
          checkOption(reverseInput, 'Поменять колонки местами'),
          checkOption(replaceInput, 'JSON: заменить все данные')
        )
      ),
      h('div', { class: 'panel__foot' },
        h('button', { class: 'btn btn--primary btn--lg', onclick: doImport }, icon('upload', 17), h('span', { text: 'Импортировать' }))
      )
    );

    var formats = h('div', { class: 'format-list' },
      formatCard('JSON', 'Резервная копия или отдельная колода. Сохраняет прогресс повторений.', '{\n  "decks": [...],\n  "cards": [...]\n}'),
      formatCard('CSV / TSV', 'Табличный формат. Колонки: слово, перевод, транскрипция, пример, перевод примера. Примеров может быть несколько — добавьте колонки «Пример 2», «Перевод примера 2» или разделите примеры символом «||».',
        'Слово,Перевод,Транскрипция,Пример,Перевод примера\nalthough,хотя,ɔːlˈðəʊ,"Although it was late, we kept working.","Хотя было поздно, мы продолжали работать."'),
      formatCard('Строки', 'Самый простой способ — по одному слову в строке.', 'although - хотя\nimprove - улучшать')
    );

    var aiPanel = panel('Список слов от нейросети', 'sparkle',
      h('p', { class: 'muted small', text: 'Не хочется придумывать слова вручную? Соберите готовый запрос для ChatGPT, Gemini, Claude или DeepSeek — модель вернёт файл со словами, переводами и примерами, который останется загрузить в блоке «Импорт» выше.' }),
      h('div', { class: 'inline-row' },
        h('button', {
          class: 'btn btn--primary btn--sm',
          onclick: function () { App.router.go('#/ai'); }
        }, icon('sparkle', 15), h('span', { text: 'Открыть конструктор промпта' })),
        h('a', {
          class: 'btn btn--ghost btn--sm',
          href: 'import-templates/sample-en-ru.csv', download: 'sample-en-ru.csv'
        }, icon('download', 15), h('span', { text: 'Скачать пример CSV' }))
      )
    );

    U.clear(root);
    U.append(root, [h('div', { class: 'page page--narrow' }, head, exportPanel, importPanel, aiPanel,
      panel('Поддерживаемые форматы', 'info', formats))]);
  }

  function checkOption(input, label) {
    return h('label', { class: 'check-option' }, input, h('span', { text: label }));
  }

  function formatCard(title, text, sample) {
    return h('div', { class: 'format-card' },
      h('b', { text: title }),
      h('p', { class: 'muted small', text: text }),
      h('pre', { class: 'code', text: sample })
    );
  }

  V.tools = { renderSettings: renderSettings, renderData: renderData };
})(window);

/* ============================================================
   LexiFlow — qr.js
   Собственный кодировщик QR-кода по ISO/IEC 18004: байтовый режим,
   уровни коррекции L и M, версии 1–10, автоматический подбор версии,
   маски и служебная информация.

   Почему свой, а не сервис картинок: ссылку на приложение нельзя
   отправлять на сторонний сервер — это и утечка адреса, и отказ
   в офлайне. Поэтому здесь только чистый JS без единой зависимости.

   Кодирование и отрисовка разделены: encode() не обращается к DOM,
   поэтому его можно проверить в Node (см. tools/test-qr.js).
   ============================================================ */
(function (global) {
  'use strict';

  var App = (global.App = global.App || {});

  /* ============================================================
     Таблицы стандарта (нужны версии 1–10)
     ============================================================ */

  /** Полное число кодовых слов (данные + коррекция) по версиям 1–10. */
  var TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

  /** Общее число кодовых слов коррекции по уровням L и M. */
  var EC_TOTAL = {
    L: [7, 10, 15, 20, 26, 36, 40, 48, 60, 72],
    M: [10, 16, 26, 36, 48, 64, 72, 88, 110, 130]
  };

  /** Число блоков коррекции по уровням L и M. */
  var EC_BLOCKS = {
    L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
  };

  /** Двухбитный код уровня: L = 01, M = 00. */
  var EC_CODE = { L: 1, M: 0 };

  var MAX_VERSION = 10;
  var QUIET_DEFAULT = 4;      // поля тишины в модулях — требование стандарта
  var SCALE_DEFAULT = 4;      // размер модуля в пикселях для SVG
  var DARK_DEFAULT = '#000000';
  var LIGHT_DEFAULT = '#ffffff';

  /* ============================================================
     Арифметика поля GF(256) — основа кода Рида–Соломона
     ============================================================ */

  var EXP = new Array(512);
  var LOG = new Array(256);

  (function initGalois() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d; // x^8 + x^4 + x^3 + x^2 + 1
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** Порождающий полином для нужного числа кодовых слов коррекции. */
  var GENERATORS = {};
  function rsGenerator(degree) {
    if (GENERATORS[degree]) return GENERATORS[degree];
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1);
      for (var j = 0; j < next.length; j++) next[j] = 0;
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    GENERATORS[degree] = poly;
    return poly;
  }

  /** Остаток от деления данных на порождающий полином — это и есть коррекция. */
  function rsRemainder(data, degree) {
    var gen = rsGenerator(degree);
    var buf = data.slice();
    for (var i = 0; i < degree; i++) buf.push(0);
    for (i = 0; i < data.length; i++) {
      var factor = buf[i];
      if (factor === 0) continue;
      for (var j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], factor);
    }
    return buf.slice(data.length);
  }

  /* ============================================================
     Подготовка данных
     ============================================================ */

  /** QR кодирует байты, поэтому строку переводим в UTF-8 вручную. */
  function utf8Bytes(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i++;
        }
      }
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd; // одиночный суррогат
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return out;
  }

  /** Поток бит: индикатор режима, счётчик символов и сами байты. */
  function BitBuffer() {
    this.bytes = [];
    this.length = 0;
  }

  BitBuffer.prototype.putBit = function (bit) {
    var index = this.length >>> 3;
    if (this.bytes.length <= index) this.bytes.push(0);
    if (bit) this.bytes[index] |= 0x80 >>> (this.length & 7);
    this.length++;
  };

  BitBuffer.prototype.put = function (value, bits) {
    for (var i = bits - 1; i >= 0; i--) this.putBit((value >>> i) & 1);
  };

  /* ============================================================
     Раскладка кодовых слов
     ============================================================ */

  function dataCodewords(version, level) {
    return TOTAL_CODEWORDS[version - 1] - EC_TOTAL[level][version - 1];
  }

  /**
   * Разбиение на блоки. Число длинных блоков и размер коррекции
   * выводятся из таблиц: так меньше шансов ошибиться, чем при
   * переписывании готовых троек (число блоков, данные, коррекция).
   */
  function blockLayout(version, level) {
    var total = TOTAL_CODEWORDS[version - 1];
    var dataTotal = total - EC_TOTAL[level][version - 1];
    var count = EC_BLOCKS[level][version - 1];
    var longBlocks = total % count;
    var shortData = Math.floor(dataTotal / count);
    return {
      shortBlocks: count - longBlocks,
      shortData: shortData,
      longBlocks: longBlocks,
      ecPerBlock: Math.floor(total / count) - shortData
    };
  }

  /** Сколько байт влезает в версию: 4 бита режима + 8 или 16 бит счётчика. */
  function byteCapacity(version, level) {
    return dataCodewords(version, level) - (version <= 9 ? 2 : 3);
  }

  /* ============================================================
     Служебная информация: формат и версия
     ============================================================ */

  function bchDigit(value) {
    var digit = 0;
    while (value !== 0) { digit++; value >>>= 1; }
    return digit;
  }

  var FORMAT_GENERATOR = 0x537;    // x^10+x^8+x^5+x^4+x^2+x+1
  var FORMAT_MASK = 0x5412;        // чтобы нулевой формат не был «пустым»
  var VERSION_GENERATOR = 0x1f25;  // x^12+x^11+x^10+x^9+x^8+x^5+x^2+1

  /** 15 бит формата: 5 бит данных, 10 бит BCH, маска. */
  function formatBits(level, mask) {
    var data = (EC_CODE[level] << 3) | mask;
    var rest = data << 10;
    while (bchDigit(rest) - bchDigit(FORMAT_GENERATOR) >= 0) {
      rest ^= FORMAT_GENERATOR << (bchDigit(rest) - bchDigit(FORMAT_GENERATOR));
    }
    return ((data << 10) | rest) ^ FORMAT_MASK;
  }

  /** 18 бит версии — нужны начиная с 7-й версии. */
  function versionBits(version) {
    var rest = version << 12;
    while (bchDigit(rest) - bchDigit(VERSION_GENERATOR) >= 0) {
      rest ^= VERSION_GENERATOR << (bchDigit(rest) - bchDigit(VERSION_GENERATOR));
    }
    return (version << 12) | rest;
  }

  /* ============================================================
     Функциональные узоры
     ============================================================ */

  function blank(size) {
    var out = [];
    for (var i = 0; i < size; i++) {
      var row = [];
      for (var j = 0; j < size; j++) row.push(0);
      out.push(row);
    }
    return out;
  }

  function copy(matrix) {
    var out = [];
    for (var i = 0; i < matrix.length; i++) out.push(matrix[i].slice());
    return out;
  }

  /** «Глазок» 7×7 и светлая разделительная полоса вокруг него. */
  function placeFinder(matrix, reserved, top, left) {
    var size = matrix.length;
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var row = top + r, col = left + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        reserved[row][col] = 1;
        var dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix[row][col] = dark ? 1 : 0;
      }
    }
  }

  /** Синхронизирующие полосы: чередование от тёмного модуля. */
  function placeTiming(matrix, reserved) {
    var size = matrix.length;
    for (var i = 8; i < size - 8; i++) {
      reserved[i][6] = 1;
      matrix[i][6] = i % 2 === 0 ? 1 : 0;
      reserved[6][i] = 1;
      matrix[6][i] = i % 2 === 0 ? 1 : 0;
    }
  }

  /** Координаты центров выравнивающих узоров. */
  function alignmentCenters(version) {
    if (version === 1) return [];
    var size = 17 + 4 * version;
    var count = Math.floor(version / 7) + 2;
    var step = Math.ceil((size - 13) / (2 * count - 2)) * 2;
    var positions = [size - 7];
    for (var i = 1; i < count - 1; i++) positions.push(positions[i - 1] - step);
    positions.push(6);
    positions.sort(function (a, b) { return a - b; });
    return positions;
  }

  function placeAlignment(matrix, reserved, version) {
    var pos = alignmentCenters(version);
    var last = pos.length - 1;
    for (var i = 0; i <= last; i++) {
      for (var j = 0; j <= last; j++) {
        // три угла заняты «глазками»
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        drawAlignment(matrix, reserved, pos[i], pos[j]);
      }
    }
  }

  function drawAlignment(matrix, reserved, row, col) {
    for (var r = -2; r <= 2; r++) {
      for (var c = -2; c <= 2; c++) {
        var dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
        reserved[row + r][col + c] = 1;
        matrix[row + r][col + c] = dark ? 1 : 0;
      }
    }
  }

  /** Разметка модулей формата, чтобы маска их не тронула и не заняла данные. */
  function reserveFormat(reserved) {
    var size = reserved.length;
    for (var i = 0; i < 15; i++) {
      reserved[i < 6 ? i : (i < 8 ? i + 1 : size - 15 + i)][8] = 1;
      reserved[8][i < 8 ? size - i - 1 : (i < 9 ? 15 - i : 14 - i)] = 1;
    }
    reserved[size - 8][8] = 1; // тёмный модуль
  }

  function placeFormat(matrix, level, mask) {
    var size = matrix.length;
    var bits = formatBits(level, mask);
    for (var i = 0; i < 15; i++) {
      var bit = (bits >> i) & 1;
      matrix[i < 6 ? i : (i < 8 ? i + 1 : size - 15 + i)][8] = bit;
      matrix[8][i < 8 ? size - i - 1 : (i < 9 ? 15 - i : 14 - i)] = bit;
    }
    matrix[size - 8][8] = 1;
  }

  function placeVersion(matrix, reserved, version) {
    var size = matrix.length;
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      var row = Math.floor(i / 3);
      var col = size - 11 + (i % 3);
      reserved[row][col] = 1;
      matrix[row][col] = bit;
      reserved[col][row] = 1;
      matrix[col][row] = bit;
    }
  }

  /** Зигзаг снизу вверх по два столбца: так данные ложатся по стандарту. */
  function placeData(matrix, reserved, codewords) {
    var size = matrix.length;
    var totalBits = codewords.length * 8;
    var index = 0;
    var upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // вертикальная синхрополоса пропускается
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (reserved[row][cc]) continue;
          // остаточные биты (их не больше семи) остаются нулями
          matrix[row][cc] = index < totalBits
            ? (codewords[index >> 3] >> (7 - (index & 7))) & 1
            : 0;
          index++;
        }
      }
      upward = !upward;
    }
  }

  /* ============================================================
     Маски и оценка результата
     ============================================================ */

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  function applyMask(matrix, reserved, mask) {
    var size = matrix.length;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (reserved[r][c]) continue;
        if (maskBit(mask, r, c)) matrix[r][c] ^= 1;
      }
    }
  }

  var PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

  /** N1: подряд идущие модули одного цвета в строке или столбце. */
  function penaltyRuns(matrix) {
    var size = matrix.length, score = 0;
    for (var i = 0; i < size; i++) {
      var runRow = 1, runCol = 1;
      for (var j = 1; j < size; j++) {
        if (matrix[i][j] === matrix[i][j - 1]) runRow++;
        else { if (runRow >= 5) score += PENALTY_N1 + runRow - 5; runRow = 1; }
        if (matrix[j][i] === matrix[j - 1][i]) runCol++;
        else { if (runCol >= 5) score += PENALTY_N1 + runCol - 5; runCol = 1; }
      }
      if (runRow >= 5) score += PENALTY_N1 + runRow - 5;
      if (runCol >= 5) score += PENALTY_N1 + runCol - 5;
    }
    return score;
  }

  /** N2: квадраты 2×2 одного цвета. */
  function penaltyBlocks(matrix) {
    var size = matrix.length, score = 0;
    for (var i = 0; i < size - 1; i++) {
      for (var j = 0; j < size - 1; j++) {
        var sum = matrix[i][j] + matrix[i][j + 1] + matrix[i + 1][j] + matrix[i + 1][j + 1];
        if (sum === 0 || sum === 4) score += PENALTY_N2;
      }
    }
    return score;
  }

  /** N3: узор 1:1:3:1:1 с полосой света — двойник «глазка». */
  function penaltyFinderLike(matrix) {
    var size = matrix.length, score = 0;
    var PATTERN_A = 0x5d0; // 10111010000
    var PATTERN_B = 0x05d; // 00001011101
    for (var i = 0; i < size; i++) {
      var bitsRow = 0, bitsCol = 0;
      for (var j = 0; j < size; j++) {
        bitsRow = ((bitsRow << 1) & 0x7ff) | matrix[i][j];
        if (j >= 10 && (bitsRow === PATTERN_A || bitsRow === PATTERN_B)) score += PENALTY_N3;
        bitsCol = ((bitsCol << 1) & 0x7ff) | matrix[j][i];
        if (j >= 10 && (bitsCol === PATTERN_A || bitsCol === PATTERN_B)) score += PENALTY_N3;
      }
    }
    return score;
  }

  /** N4: перекос доли тёмных модулей от половины. */
  function penaltyBalance(matrix) {
    var size = matrix.length, dark = 0;
    for (var i = 0; i < size; i++) {
      for (var j = 0; j < size; j++) dark += matrix[i][j];
    }
    var percent = dark * 100 / (size * size);
    return PENALTY_N4 * Math.floor(Math.abs(percent - 50) / 5);
  }

  function penalty(matrix) {
    return penaltyRuns(matrix) + penaltyBlocks(matrix) +
      penaltyFinderLike(matrix) + penaltyBalance(matrix);
  }

  /** Поля тишины: сканеру нужна светлая рамка вокруг кода. */
  function addQuietZone(matrix, quiet) {
    var size = matrix.length;
    var full = size + quiet * 2;
    var out = [];
    for (var r = 0; r < full; r++) {
      var row = [];
      for (var c = 0; c < full; c++) {
        var sr = r - quiet, sc = c - quiet;
        row.push(sr >= 0 && sr < size && sc >= 0 && sc < size ? matrix[sr][sc] : 0);
      }
      out.push(row);
    }
    return out;
  }

  /* ============================================================
     Кодирование
     ============================================================ */

  /**
   * Собрать QR-код.
   * opts.ec    — уровень коррекции 'L' или 'M' (по умолчанию 'M');
   * opts.quiet — поля тишины в модулях (по умолчанию 4).
   * Возвращает версию, маску, матрицу без полей тишины (core)
   * и матрицу с полями (matrix).
   */
  function encode(text, opts) {
    opts = opts || {};
    var level = String(opts.ec === undefined || opts.ec === null ? 'M' : opts.ec).toUpperCase();
    // Проверяем именно по списку: обращение к EC_TOTAL пропустило бы
    // унаследованные свойства вроде «constructor».
    if (level !== 'L' && level !== 'M') {
      throw new Error('Уровень коррекции «' + opts.ec + '» не поддерживается: доступны только L и M.');
    }
    var quiet = opts.quiet === undefined ? QUIET_DEFAULT : Math.max(0, opts.quiet | 0);

    var data = utf8Bytes(String(text === undefined || text === null ? '' : text));
    if (!data.length) throw new Error('Пустой текст: QR-коду нечего кодировать.');

    var version = 0;
    for (var v = 1; v <= MAX_VERSION; v++) {
      if (data.length <= byteCapacity(v, level)) { version = v; break; }
    }
    if (!version) {
      throw new Error('Текст не помещается в QR-код: ' + data.length + ' байт, а максимум для ' +
        MAX_VERSION + '-й версии с уровнем ' + level + ' — ' + byteCapacity(MAX_VERSION, level) +
        ' байт. Сократите ссылку.');
    }

    /* --- битовый поток данных --- */
    var totalData = dataCodewords(version, level);
    var buffer = new BitBuffer();
    buffer.put(0x4, 4);                                  // байтовый режим
    buffer.put(data.length, version <= 9 ? 8 : 16);      // счётчик символов
    for (var i = 0; i < data.length; i++) buffer.put(data[i], 8);

    var capacityBits = totalData * 8;
    var terminator = Math.min(4, capacityBits - buffer.length);
    for (i = 0; i < terminator; i++) buffer.putBit(0);
    while (buffer.length % 8 !== 0) buffer.putBit(0);

    var codewords = buffer.bytes.slice();
    var PAD = [0xec, 0x11];
    for (i = 0; codewords.length < totalData; i++) codewords.push(PAD[i % 2]);

    /* --- блоки коррекции и перемежение --- */
    var layout = blockLayout(version, level);
    var blocks = [], ecc = [], offset = 0;
    var blockCount = layout.shortBlocks + layout.longBlocks;
    for (i = 0; i < blockCount; i++) {
      var blockSize = i < layout.shortBlocks ? layout.shortData : layout.shortData + 1;
      var block = codewords.slice(offset, offset + blockSize);
      offset += blockSize;
      blocks.push(block);
      ecc.push(rsRemainder(block, layout.ecPerBlock));
    }

    var stream = [];
    var longest = layout.shortData + (layout.longBlocks ? 1 : 0);
    for (var k = 0; k < longest; k++) {
      for (i = 0; i < blockCount; i++) {
        if (k < blocks[i].length) stream.push(blocks[i][k]);
      }
    }
    for (k = 0; k < layout.ecPerBlock; k++) {
      for (i = 0; i < blockCount; i++) stream.push(ecc[i][k]);
    }

    /* --- матрица --- */
    var size = 17 + 4 * version;
    var matrix = blank(size);
    var reserved = blank(size);

    placeFinder(matrix, reserved, 0, 0);
    placeFinder(matrix, reserved, 0, size - 7);
    placeFinder(matrix, reserved, size - 7, 0);
    placeTiming(matrix, reserved);
    placeAlignment(matrix, reserved, version);
    reserveFormat(reserved);
    if (version >= 7) placeVersion(matrix, reserved, version);
    placeData(matrix, reserved, stream);

    /* --- выбор маски: наименьший штраф по четырём правилам стандарта --- */
    var bestMask = 0, bestScore = Infinity, bestMatrix = null;
    for (var mask = 0; mask < 8; mask++) {
      var candidate = copy(matrix);
      applyMask(candidate, reserved, mask);
      placeFormat(candidate, level, mask);
      var score = penalty(candidate);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
        bestMatrix = candidate;
      }
    }

    return {
      version: version,
      ec: level,
      mask: bestMask,
      score: bestScore,
      size: size,
      core: bestMatrix,
      matrix: addQuietZone(bestMatrix, quiet),
      quiet: quiet
    };
  }

  /* ============================================================
     Отрисовка
     ============================================================ */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * SVG-элемент с QR-кодом.
   * opts.scale — размер модуля в пикселях, opts.width/height — итоговый размер,
   * opts.dark/opts.light — цвета, opts.label — подпись для скринридера.
   */
  function svg(text, opts) {
    opts = opts || {};
    var doc = global.document;
    if (!doc || !doc.createElementNS) throw new Error('Для отрисовки QR-кода нужен DOM.');

    var code = encode(text, opts);
    var rows = code.matrix;
    var count = rows.length;
    var scale = opts.scale || SCALE_DEFAULT;
    var width = opts.width || count * scale;
    var height = opts.height || width;

    var node = doc.createElementNS(SVG_NS, 'svg');
    node.setAttribute('xmlns', SVG_NS);
    node.setAttribute('viewBox', '0 0 ' + count + ' ' + count);
    node.setAttribute('width', String(width));
    node.setAttribute('height', String(height));
    node.setAttribute('role', 'img');
    node.setAttribute('shape-rendering', 'crispEdges');
    node.setAttribute('aria-label', opts.label || 'QR-код со ссылкой на приложение');

    // Светлая подложка: сканер ищет код по контрасту с фоном.
    var background = doc.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', String(count));
    background.setAttribute('height', String(count));
    background.setAttribute('fill', opts.light || LIGHT_DEFAULT);
    node.appendChild(background);

    // Тёмные модули одним контуром — компактнее, чем прямоугольник на каждый.
    var path = '';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (rows[r][c]) path += 'M' + c + ' ' + r + 'h1v1h-1z';
      }
    }
    var dark = doc.createElementNS(SVG_NS, 'path');
    dark.setAttribute('d', path);
    dark.setAttribute('fill', opts.dark || DARK_DEFAULT);
    node.appendChild(dark);

    return node;
  }

  /* ============================================================
     Публичный интерфейс
     ============================================================ */

  App.qr = {
    /** Матрица из 0/1 вместе с полями тишины. */
    matrix: function (text, opts) { return encode(text, opts).matrix; },
    /** Готовый SVG-элемент. */
    svg: svg,
    /** Внутренние части — нужны тестам и странице «На телефон». */
    encode: encode,
    formatBits: formatBits,
    versionBits: versionBits,
    byteCapacity: byteCapacity,
    blockLayout: blockLayout,
    MAX_VERSION: MAX_VERSION,
    QUIET_DEFAULT: QUIET_DEFAULT,
    EC_LEVELS: ['L', 'M']
  };
})(window);

/**
 * LexiFlow — тесты QR-кодировщика (без браузера).
 *
 * Запуск:
 *   node tools/test-qr.js
 *
 * Проверяет js/qr.js в минимальном shim-окружении, как tools/test-core.js:
 * поддельные document и localStorage, сам модуль при этом не меняется.
 *
 * Что именно проверяется: размер и структура матрицы, функциональные узоры
 * (глазки, разделители, синхрополосы, выравнивающие узоры, тёмный модуль),
 * служебная информация формата и версии, подбор версии, ёмкость, ошибки,
 * детерминированность и отрисовка в SVG.
 *
 * Откуда взяты эталонные значения (не из этого кода):
 *   • таблица формата C.1 и таблица версий D.1 — из стандарта
 *     ISO/IEC 18004:2015; значения сверены с node-qrcode@1.5.4;
 *   • ёмкости байтового режима — таблица 7 стандарта;
 *   • хеши матриц — из node-qrcode@1.5.4 в принудительном байтовом режиме
 *     (qrcode 1.5.4 сам выбирает буквенно-цифровой режим для ASCII,
 *     поэтому режим задавался явно: QRCode.create([{ data, mode: 'byte' }])).
 *   Дополнительно матрицы этого кодировщика были прочитаны двумя
 *   независимыми декодерами — jsQR 1.4.0 и OpenCV (QRCodeDetector).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

/* ---------- Минимальное окружение браузера ---------- */

/** Элемент, который запоминает атрибуты и детей — нужен для проверки SVG. */
function fakeElement(tag) {
  const el = {
    tagName: tag || 'div',
    attrs: {},
    children: [],
    style: {}, dataset: {}, textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    append() {}, remove() {}, focus() {}, click() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => []
  };
  return el;
}

global.window = global;
const storage = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: k => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};
global.document = {
  createElement: fakeElement,
  createElementNS: (ns, tag) => fakeElement(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, contains: () => false },
  documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } },
  readyState: 'complete'
};
global.requestAnimationFrame = fn => setTimeout(fn, 0);

const ROOT = path.join(__dirname, '..');
['js/util.js', 'js/qr.js'].forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInThisContext(code, { filename: f });
});

const U = App.util, QR = App.qr;

/* ---------- Мини-фреймворк ---------- */

let pass = 0, fail = 0, group = '';

function section(name) { group = name; console.log('\n' + name); }
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : ''));
  }
}
function eq(actual, expected, name) { ok(actual === expected, name, { actual, expected }); }

/* ---------- Вспомогательные функции ---------- */

function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function rowStr(matrix) { return matrix.map(r => r.join('')).join('\n'); }
function encode(text, opts) { return QR.encode(text, opts); }
function core(text, opts) { return QR.encode(text, opts).core; }
function repeated(n) { return new Array(n + 1).join('a'); }
function repeatedChar(ch, n) { return new Array(n + 1).join(ch); }

/** Прямоугольный фрагмент матрицы в виде строк. */
function windowOf(matrix, top, left, size) {
  const out = [];
  for (let r = 0; r < size; r++) out.push(matrix[top + r].slice(left, left + size).join(''));
  return out;
}

/** Выравнивающий узор 5×5 вокруг указанного центра. */
function alignmentAt(matrix, center) {
  return windowOf(matrix, center - 2, center - 2, 5);
}

/** Поля тишины: рамка шириной quiet должна быть полностью светлой. */
function borderIsLight(matrix, quiet) {
  const size = matrix.length;
  for (let i = 0; i < size; i++) {
    for (let q = 0; q < quiet; q++) {
      if (matrix[i][q] !== 0 || matrix[i][size - 1 - q] !== 0) return false;
      if (matrix[q][i] !== 0 || matrix[size - 1 - q][i] !== 0) return false;
    }
  }
  return true;
}

/** Чтение 15 бит формата из обеих копий. */
function readFormat(matrix) {
  const size = matrix.length;
  let first = 0, second = 0;
  for (let i = 0; i < 15; i++) {
    const row = i < 6 ? i : (i < 8 ? i + 1 : size - 15 + i);
    const col = i < 8 ? size - i - 1 : (i < 9 ? 15 - i : 14 - i);
    first |= matrix[row][8] << i;
    second |= matrix[8][col] << i;
  }
  return { first, second };
}

/** Разбор SVG-контура обратно в матрицу. */
function matrixFromPath(d, count) {
  const grid = [];
  for (let i = 0; i < count; i++) grid.push(new Array(count).fill(0));
  const re = /M(\d+) (\d+)h1v1h-1z/g;
  let m;
  while ((m = re.exec(d)) !== null) grid[Number(m[2])][Number(m[1])] = 1;
  return grid;
}

const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
const ALIGNMENT = ['11111', '10001', '10101', '10001', '11111'];
const URL_LONG = 'https://lexiflow.example.org/';

/* ============================================================
   1. Размер матрицы и поля тишины
   ============================================================ */

section('QR: размер матрицы и поля тишины');
{
  const enc = encode('HELLO', { ec: 'M' });
  eq(enc.version, 1, 'короткая строка укладывается в 1-ю версию');
  eq(enc.size, 21, 'сторона символа 1-й версии — 21 модуль');
  eq(enc.core.length, 21, 'матрица без полей тишины квадратная');
  eq(enc.core[0].length, 21, 'число строк и столбцов совпадает');
  ok(enc.core.every(r => r.every(v => v === 0 || v === 1)), 'в матрице только 0 и 1');
  eq(enc.matrix.length, 29, 'с полями тишины матрица шире на 8 модулей');
  eq(enc.matrix[0].length, 29, 'матрица с полями тишины квадратная');
  ok(borderIsLight(enc.matrix, 4), 'все модули полей тишины светлые');
  eq(enc.quiet, 4, 'ширина полей тишины по умолчанию — 4 модуля');
  ok(Array.isArray(enc.core[0]) && Array.isArray(enc.matrix[0]), 'matrix() отдаёт массив строк');
}

section('QR: сторона символа равна 17 + 4 × версия');
{
  for (let v = 1; v <= 10; v++) {
    // ровно заполняем ёмкость версии, чтобы получить именно её
    const enc = encode(repeated(QR.byteCapacity(v, 'M')), { ec: 'M' });
    eq(enc.version, v, v + '-я версия выбрана по ёмкости');
    eq(enc.size, 17 + 4 * v, v + '-я версия: сторона = 17 + 4×' + v);
    eq(enc.core.length, 17 + 4 * v, v + '-я версия: матрица квадратная');
  }
}

/* ============================================================
   2. Функциональные узоры
   ============================================================ */

section('QR: глазки и разделители');
{
  const m = core(URL_LONG, { ec: 'M' });
  const size = m.length;
  eq(size, 29, 'ссылка на 29 байт даёт 3-ю версию');

  eq(windowOf(m, 0, 0, 7).join('|'), FINDER.join('|'), 'верхний левый глазок имеет форму 7×7');
  eq(windowOf(m, 0, size - 7, 7).join('|'), FINDER.join('|'), 'верхний правый глазок на месте');
  eq(windowOf(m, size - 7, 0, 7).join('|'), FINDER.join('|'), 'нижний левый глазок на месте');

  eq(m[7].slice(0, 8).join(''), '00000000', 'разделитель под верхним левым глазком светлый');
  eq(m.slice(0, 8).map(r => r[7]).join(''), '00000000', 'разделитель справа от верхнего левого глазка светлый');
  eq(m[7].slice(size - 8).join(''), '00000000', 'разделитель под верхним правым глазком светлый');
  eq(m.slice(0, 8).map(r => r[size - 8]).join(''), '00000000', 'разделитель слева от верхнего правого глазка светлый');
  eq(m[size - 8].slice(0, 8).join(''), '00000000', 'разделитель над нижним левым глазком светлый');
  eq(m.slice(size - 8).map(r => r[7]).join(''), '00000000', 'разделитель справа от нижнего левого глазка светлый');
}

section('QR: синхронизирующие полосы');
{
  const m = core(URL_LONG, { ec: 'M' });
  const size = m.length;
  let rowOk = true, colOk = true;
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] !== (i % 2 === 0 ? 1 : 0)) rowOk = false;
    if (m[i][6] !== (i % 2 === 0 ? 1 : 0)) colOk = false;
  }
  ok(rowOk, 'горизонтальная полоса чередуется от тёмного модуля');
  ok(colOk, 'вертикальная полоса чередуется от тёмного модуля');
  eq(m[6][8], 1, 'первый модуль полосы тёмный');
  eq(m[6][9], 0, 'второй модуль полосы светлый');
  eq(m[6][size - 9], (size - 9) % 2 === 0 ? 1 : 0, 'последний модуль полосы продолжает чередование');
}

section('QR: тёмный модуль и выравнивающие узоры');
{
  const m3 = core(URL_LONG, { ec: 'M' });
  eq(m3[m3.length - 8][8], 1, 'тёмный модуль всегда установлен');

  const m1 = core('HELLO', { ec: 'M' });
  eq(m1[m1.length - 8][8], 1, 'тёмный модуль установлен и в 1-й версии');

  const m2 = core(repeated(26), { ec: 'M' });
  eq(m2.length, 25, 'строка на 26 байт даёт 2-ю версию');
  eq(alignmentAt(m2, 18).join('|'), ALIGNMENT.join('|'), 'выравнивающий узор 2-й версии на месте');

  const m7 = core(repeated(122), { ec: 'M' });
  eq(m7.length, 45, 'строка на 122 байта даёт 7-ю версию');
  eq(alignmentAt(m7, 22).join('|'), ALIGNMENT.join('|'), 'выравнивающий узор 7-й версии на месте');
  eq(windowOf(m7, 4, 20, 5).join('|'), ALIGNMENT.join('|'), 'узор на пересечении с синхрополосой (строка 6, столбец 22)');
  eq(windowOf(m7, 20, 4, 5).join('|'), ALIGNMENT.join('|'), 'узор на пересечении с синхрополосой (строка 22, столбец 6)');
  eq(alignmentAt(m7, 38).join('|'), ALIGNMENT.join('|'), 'последний выравнивающий узор в правом нижнем углу');
}

/* ============================================================
   3. Служебная информация
   ============================================================ */

section('QR: служебная информация формата (таблица C.1 стандарта)');
{
  // ISO/IEC 18004:2015, таблица C.1 — значения для уровней L и M, масок 0–7.
  const FORMAT_L = [0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976];
  const FORMAT_M = [0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0];

  let allOk = true;
  for (let mask = 0; mask < 8; mask++) {
    if (QR.formatBits('L', mask) !== FORMAT_L[mask]) allOk = false;
    if (QR.formatBits('M', mask) !== FORMAT_M[mask]) allOk = false;
  }
  ok(allOk, 'все 16 значений формата совпадают с таблицей C.1');

  const enc = encode('HELLO', { ec: 'M' });
  const read = readFormat(enc.core);
  eq(read.first, QR.formatBits('M', enc.mask), 'первая копия формата лежит на своих местах');
  eq(read.second, QR.formatBits('M', enc.mask), 'вторая копия формата лежит на своих местах');
  eq(read.first, read.second, 'обе копии формата идентичны');
  eq((read.first ^ 0x5412) >> 10, (0 << 3) | enc.mask, 'в формате записаны уровень M и номер маски');
  ok(enc.mask >= 0 && enc.mask <= 7, 'номер маски лежит в диапазоне 0–7');

  const encL = encode('HELLO', { ec: 'L' });
  const readL = readFormat(encL.core);
  eq((readL.first ^ 0x5412) >> 10, (1 << 3) | encL.mask, 'для уровня L в формате стоит код 01');
  eq(readL.first, QR.formatBits('L', encL.mask), 'формат уровня L совпадает с расчётным');
}

section('QR: информация о версии (таблица D.1 стандарта)');
{
  // ISO/IEC 18004:2015, таблица D.1 — 18 бит для версий 7–10.
  const VERSION_TABLE = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
  let allOk = true;
  for (let v = 7; v <= 10; v++) {
    if (QR.versionBits(v) !== VERSION_TABLE[v]) allOk = false;
  }
  ok(allOk, 'все значения версии совпадают с таблицей D.1');

  const enc = encode(repeated(122), { ec: 'M' });
  eq(enc.version, 7, 'информация о версии нужна начиная с 7-й версии');
  const bits = QR.versionBits(7);
  let placed = 0;
  for (let i = 0; i < 18; i++) {
    const row = Math.floor(i / 3);
    const col = enc.size - 11 + (i % 3);
    if (enc.core[row][col] === ((bits >> i) & 1)) placed++;
    if (enc.core[col][row] === ((bits >> i) & 1)) placed++;
  }
  eq(placed, 36, 'обе копии информации о версии записаны в матрицу');
}

/* ============================================================
   4. Эталонные векторы
   ============================================================ */

section('QR: эталонные векторы (независимый источник)');
{
  /* Матрицы взяты из node-qrcode@1.5.4 в байтовом режиме. */
  const VECTORS = [
    {
      name: 'HELLO',
      text: 'HELLO', ec: 'M', version: 1, mask: 4,
      core: 'c346c75add5698735afe3f7eb4f3e6c57ccefd9563f45f65c6d76aa518fb6f91',
      padded: '2766da3ca0126c1fa0424f365144b6ec964a4d207469efa77dd8aa22059ab871'
    },
    {
      name: 'ссылка на приложение',
      text: 'https://lexiflow.example.org/', ec: 'M', version: 3, mask: 2,
      core: '22b3a493236ccda0528d52e155a4a7e3a4152d12c37446da162e73aaa15fb7ad',
      padded: 'e60867fe4fedc65340d69a76ae243af479a464646545f9e95186247ebdfd301c'
    },
    {
      name: 'уровень L',
      text: 'https://example.com/lexiflow', ec: 'L', version: 2, mask: 4,
      core: 'd110078a70410113582213abf5b67e97f1e4e219392062acb1e1418a603dc94d',
      padded: '4907db81cd25e432b41820e1791b5e51e209780a6407f162aaa43bea03e6cf5e'
    },
    {
      name: 'длинная строка (7-я версия)',
      text: repeatedChar('x', 120), ec: 'M', version: 7, mask: 2,
      core: 'b91b7e904d3e58a975798fdfb7444272ea2003b536350a6486d8dd7edd238cfe',
      padded: '38e81d6f0506e3592929ac1220562137489455168030458c15602cd6f3cce05b'
    }
  ];

  VECTORS.forEach(v => {
    const enc = encode(v.text, { ec: v.ec });
    eq(enc.version, v.version, v.name + ': версия совпадает с эталоном');
    eq(enc.mask, v.mask, v.name + ': маска совпадает с эталоном');
    eq(sha(rowStr(enc.core)), v.core, v.name + ': хеш символа совпадает с эталоном');
    eq(sha(rowStr(enc.matrix)), v.padded, v.name + ': хеш с полями тишины совпадает с эталоном');
  });
}

/* ============================================================
   5. Подбор версии, ёмкость, блоки
   ============================================================ */

section('QR: ёмкость байтового режима (таблица 7 стандарта)');
{
  const CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  const CAPACITY_L = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
  let okM = true, okL = true;
  for (let v = 1; v <= 10; v++) {
    if (QR.byteCapacity(v, 'M') !== CAPACITY_M[v - 1]) okM = false;
    if (QR.byteCapacity(v, 'L') !== CAPACITY_L[v - 1]) okL = false;
  }
  ok(okM, 'ёмкость уровня M совпадает с таблицей 7 для всех версий');
  ok(okL, 'ёмкость уровня L совпадает с таблицей 7 для всех версий');
  eq(QR.byteCapacity(1, 'M'), 14, '1-я версия, уровень M: 14 байт');
  eq(QR.byteCapacity(10, 'M'), 213, '10-я версия, уровень M: 213 байт');
  eq(QR.byteCapacity(10, 'L'), 271, '10-я версия, уровень L: 271 байт');
  ok(QR.byteCapacity(10, 'L') > QR.byteCapacity(10, 'M'), 'уровень L вмещает больше, чем M');
}

section('QR: автоматический подбор версии');
{
  eq(encode(repeated(14), { ec: 'M' }).version, 1, '14 байт — предел 1-й версии на уровне M');
  eq(encode(repeated(15), { ec: 'M' }).version, 2, '15 байт уже не влезают в 1-ю версию');
  eq(encode(repeated(26), { ec: 'M' }).version, 2, '26 байт — предел 2-й версии');
  eq(encode(repeated(27), { ec: 'M' }).version, 3, '27 байт требуют 3-й версии');
  eq(encode(repeated(122), { ec: 'M' }).version, 7, '122 байта требуют 7-й версии');
  eq(encode(repeated(123), { ec: 'M' }).version, 8, '123 байта требуют 8-й версии');
  eq(encode(repeated(213), { ec: 'M' }).version, 10, '213 байт — предел 10-й версии');
  eq(encode(repeated(15), { ec: 'L' }).version, 1, 'на уровне L 15 байт ещё влезают в 1-ю версию');
  eq(encode('HELLO', { ec: 'M' }).version, 1, 'короткая строка — всегда 1-я версия');
  ok(encode(repeated(100), { ec: 'L' }).version < encode(repeated(100), { ec: 'M' }).version,
    'на уровне L версия не больше, чем на уровне M',
    { L: encode(repeated(100), { ec: 'L' }).version, M: encode(repeated(100), { ec: 'M' }).version });
}

section('QR: разбиение на блоки коррекции');
{
  // [версия, уровень, коротких блоков, данных в коротком, длинных блоков, коррекции в блоке]
  const LAYOUTS = [
    [1, 'M', 1, 16, 0, 10],
    [4, 'M', 2, 32, 0, 18],
    [5, 'M', 2, 43, 0, 24],
    [8, 'M', 2, 38, 2, 22],
    [9, 'M', 3, 36, 2, 22],
    [10, 'M', 4, 43, 1, 26],
    [10, 'L', 2, 68, 2, 18]
  ];
  LAYOUTS.forEach(row => {
    const got = QR.blockLayout(row[0], row[1]);
    eq(got.shortBlocks, row[2], row[0] + '-я версия (' + row[1] + '): коротких блоков');
    eq(got.shortData, row[3], row[0] + '-я версия (' + row[1] + '): данных в коротком блоке');
    eq(got.longBlocks, row[4], row[0] + '-я версия (' + row[1] + '): длинных блоков');
    eq(got.ecPerBlock, row[5], row[0] + '-я версия (' + row[1] + '): коррекции в блоке');
  });

  // сумма блоков должна ровно заполнять символ
  const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  let sumsOk = true;
  for (let v = 1; v <= 10; v++) {
    ['L', 'M'].forEach(level => {
      const l = QR.blockLayout(v, level);
      const total = l.shortBlocks * (l.shortData + l.ecPerBlock) +
        l.longBlocks * (l.shortData + 1 + l.ecPerBlock);
      if (total !== TOTAL_CODEWORDS[v - 1]) sumsOk = false;
    });
  }
  ok(sumsOk, 'блоки данных и коррекции ровно заполняют символ во всех версиях');
}

/* ============================================================
   6. Текст, детерминированность, ошибки
   ============================================================ */

section('QR: кодирование текста в UTF-8');
{
  eq(encode('привет', { ec: 'M' }).version, 1, 'кириллица кодируется в UTF-8: 12 байт — 1-я версия');
  eq(encode(repeated(13) + 'п', { ec: 'M' }).version, 2, 'двухбайтовая буква увеличивает размер данных');
  eq(encode('😀', { ec: 'M' }).version, 1, 'эмодзи занимает 4 байта и влезает в 1-ю версию');
  eq(encode('ЁЖИК', { ec: 'M' }).version, 1, 'заглавная кириллица кодируется как UTF-8');
  ok(encode('привет', { ec: 'M' }).size === encode('abcdef', { ec: 'M' }).size,
    'кириллица из 6 букв занимает столько же, сколько 12 латинских');
}

section('QR: детерминированность');
{
  eq(rowStr(core(URL_LONG, { ec: 'M' })), rowStr(core(URL_LONG, { ec: 'M' })), 'один и тот же текст даёт один и тот же код');
  eq(rowStr(core(repeated(120), { ec: 'L' })), rowStr(core(repeated(120), { ec: 'L' })), 'длинный текст тоже воспроизводится точно');
  eq(sha(rowStr(core('привет', { ec: 'M' }))), sha(rowStr(core('привет', { ec: 'M' }))), 'кириллица воспроизводится байт в байт');
  const a = encode(URL_LONG, { ec: 'M' }), b = encode(URL_LONG, { ec: 'M' });
  eq(a.mask, b.mask, 'маска выбирается одинаково');
  eq(a.version, b.version, 'версия выбирается одинаково');
}

section('QR: понятные ошибки');
{
  let err = null;
  try { encode(repeated(214), { ec: 'M' }); } catch (e) { err = e; }
  ok(!!err, 'слишком длинный текст выбрасывает ошибку');
  ok(err && err.message.indexOf('не помещается') >= 0, 'в ошибке сказано, что текст не помещается');
  ok(err && err.message.indexOf('214') >= 0, 'в ошибке указан размер данных');
  ok(err && err.message.indexOf('213') >= 0, 'в ошибке указан предел для 10-й версии');
  ok(err && /[А-Яа-яЁё]/.test(err.message), 'сообщение об ошибке написано по-русски');

  err = null;
  try { encode(repeated(272), { ec: 'L' }); } catch (e) { err = e; }
  ok(!!err, 'на уровне L 272 байта тоже не влезают');

  err = null;
  try { encode('HELLO', { ec: 'Q' }); } catch (e) { err = e; }
  ok(!!err, 'уровень Q не поддерживается');
  ok(err && err.message.indexOf('L и M') >= 0, 'ошибка перечисляет доступные уровни');

  err = null;
  try { encode('HELLO', { ec: 'H' }); } catch (e) { err = e; }
  ok(!!err, 'уровень H не поддерживается');

  err = null;
  try { encode('', {}); } catch (e) { err = e; }
  ok(!!err, 'пустой текст выбрасывает ошибку');
  ok(err && /пуст/i.test(err.message), 'в ошибке про пустой текст понятное объяснение');
}

section('QR: поля тишины настраиваются');
{
  eq(QR.matrix('HELLO', { ec: 'M', quiet: 0 }).length, 21, 'quiet: 0 — матрица равна символу');
  eq(QR.matrix('HELLO', { ec: 'M', quiet: 2 }).length, 25, 'quiet: 2 добавляет 4 модуля');
  eq(QR.matrix('HELLO', { ec: 'M' }).length, 29, 'по умолчанию поля тишины — 4 модуля');
  eq(rowStr(QR.matrix('HELLO', { ec: 'M', quiet: 0 })), rowStr(core('HELLO', { ec: 'M' })),
    'quiet: 0 совпадает с ядром символа');
  ok(borderIsLight(QR.matrix('HELLO', { ec: 'M', quiet: 6 }), 6), 'рамка в 6 модулей тоже светлая');
}

/* ============================================================
   7. Отрисовка в SVG
   ============================================================ */

section('QR: отрисовка в SVG');
{
  const enc = encode(URL_LONG, { ec: 'M' });
  const node = QR.svg(URL_LONG, { ec: 'M', scale: 5 });

  eq(node.tagName, 'svg', 'svg() возвращает элемент svg');
  eq(node.attrs.viewBox, '0 0 37 37', 'viewBox совпадает с числом модулей с полями тишины');
  eq(node.attrs.width, String(37 * 5), 'ширина = модули × масштаб');
  eq(node.attrs.height, String(37 * 5), 'высота равна ширине');
  eq(node.attrs['shape-rendering'], 'crispEdges', 'модули рисуются без сглаживания');
  ok(!!node.attrs['aria-label'], 'у кода есть подпись для скринридера');
  ok(node.attrs['aria-label'].indexOf('QR') >= 0, 'подпись по умолчанию говорит, что это QR-код');

  const rect = node.children.filter(c => c.tagName === 'rect')[0];
  ok(!!rect, 'есть подложка под код');
  eq(rect.attrs.fill, '#ffffff', 'подложка светлая — иначе сканер не найдёт код');
  eq(rect.attrs.width, '37', 'подложка накрывает весь код');

  const path = node.children.filter(c => c.tagName === 'path')[0];
  ok(!!path, 'модули нарисованы контуром');
  eq(path.attrs.fill, '#000000', 'модули чёрные');
  eq(rowStr(matrixFromPath(path.attrs.d, 37)), rowStr(enc.matrix),
    'SVG рисует ровно те модули, что стоят в матрице');

  const scaled = QR.svg(URL_LONG, { ec: 'M', scale: 8, label: 'Своя подпись' });
  eq(scaled.attrs.width, String(37 * 8), 'масштаб модуля влияет на размер');
  eq(scaled.attrs['aria-label'], 'Своя подпись', 'подпись можно задать');

  // кодировщик не должен зависеть от DOM
  const savedDocument = global.document;
  global.document = undefined;
  let err = null;
  try { QR.svg('HELLO', {}); } catch (e) { err = e; }
  global.document = savedDocument;
  ok(!!err, 'без DOM отрисовка честно сообщает об ошибке');
  ok(!!err && /[А-Яа-яЁё]/.test(err.message), 'ошибка отрисовки тоже на русском');
  eq(encode('HELLO', {}).version, 1, 'кодировщик работает без DOM');
}

/* ============================================================
   Итог
   ============================================================ */

console.log('\n' + '─'.repeat(52));
console.log(fail === 0
  ? `ВСЕ ТЕСТЫ ПРОЙДЕНЫ: ${pass}`
  : `ПРОЙДЕНО ${pass}, ПРОВАЛЕНО ${fail}`);
console.log('─'.repeat(52));
process.exit(fail === 0 ? 0 : 1);

// Ведомость растений (без DOM): для каждого вида — количество, размер
// посадки, цена за единицу, сумма, цветение/примечание; итог стоимости
// озеленения. Группы: деревья, кустарники, цветы и злаки, газон.
//
// Вид = тип каталога + вариант («tree-fruit|apple» — яблоня). Штучные
// растения — шт, живые изгороди — м, газон и клумбы — м² (цена за м²).
// Растения в коробах (parent) считаются как все. Правки пользователя —
// в справочнике проекта site.landscape.plants (core/landscape.js,
// normalizePlantBook): { 'kind|variant': { size, price, note } }; нет
// записи — значения каталога ниже (цены по умолчанию пустые).

import { landscapeDef, normalizePlantEntry, objectAreaM2, objectLengthM, variantOf } from './landscape.js';

export const PLANT_GROUPS = [
  { id: 'trees', title: 'Деревья' },
  { id: 'shrubs', title: 'Кустарники' },
  { id: 'flowers', title: 'Цветы и злаки' },
  { id: 'lawn', title: 'Газон' },
];

const FLOWER_KINDS = new Set(['flowers-clump', 'grass-clump', 'bed-round', 'bed-rect', 'bed-strip']);
const LAWN_KINDS = new Set(['lawn-patch', 'lawn-area']);
const HEDGE_KINDS = new Set(['hedge', 'hedge-box', 'hedge-line']);
const AREA_KINDS = new Set(['bed-round', 'bed-rect', 'bed-strip', 'lawn-patch', 'lawn-area']);

// Каталог посадочного материала: size — высота посадки, мм; name — название
// вида (иначе «тип, вариант»); note — цветение/примечание.
const INFO = {
  'tree-pine': { size: 2000 }, 'tree-pine|scots': { name: 'Сосна обыкновенная' }, 'tree-pine|mugo': { name: 'Сосна горная', size: 600 },
  'tree-spruce': { size: 2000 }, 'tree-spruce|common': { name: 'Ель обыкновенная' }, 'tree-spruce|blue': { name: 'Ель голубая', size: 1500 },
  'tree-birch': { size: 3000 },
  'tree-oak': { size: 3000 }, 'tree-oak|oak': { name: 'Дуб' }, 'tree-oak|maple': { name: 'Клён' },
  'tree-oak|maple-red': { name: 'Клён красный', note: 'красная листва осенью' },
  'tree-fruit': { size: 1800 }, 'tree-fruit|apple': { name: 'Яблоня', note: 'цветение IV–V' },
  'tree-fruit|pear': { name: 'Груша', note: 'цветение IV–V' }, 'tree-fruit|cherry': { name: 'Вишня', note: 'цветение IV–V' },
  'tree-fruit|apricot': { name: 'Абрикос', note: 'цветение III–IV' },
  'tree-thuja': { size: 1500 }, 'tree-thuja|thuja': { name: 'Туя колонновидная' }, 'tree-thuja|cypress': { name: 'Кипарис' },
  'tree-bonsai': { size: 1200 },
  'shrub-box': { size: 400 }, 'shrub-box|box': { name: 'Самшит шаровидный' }, 'shrub-box|pittosporum': { name: 'Питтоспорум (шар светлый)' },
  'shrub-juniper': { size: 400 },
  'shrub-flower': { size: 800 }, 'shrub-flower|lilac': { name: 'Сирень', note: 'цветение V–VI' },
  'shrub-flower|spiraea': { name: 'Спирея', note: 'цветение V–VII' }, 'shrub-flower|hydrangea': { name: 'Гортензия', note: 'цветение VII–IX' },
  hedge: { size: 1000 }, 'hedge-box': { size: 300 }, 'hedge-line': { size: 1000 },
  'flowers-clump': { size: 300 }, 'flowers-clump|lavender': { name: 'Лаванда', note: 'цветение VI–VIII' },
  'flowers-clump|roses': { name: 'Розы', note: 'цветение VI–IX' }, 'flowers-clump|echinacea': { name: 'Эхинацея', note: 'цветение VII–IX' },
  'grass-clump': { size: 500 }, 'grass-clump|miscanthus': { name: 'Мискантус', note: 'метёлки VIII–X' },
  'grass-clump|festuca': { name: 'Овсяница сизая' },
  'bed-round|roses': { note: 'цветение VI–IX' }, 'bed-rect|roses': { note: 'цветение VI–IX' },
  'bed-round|lavender': { note: 'цветение VI–VIII' }, 'bed-rect|lavender': { note: 'цветение VI–VIII' },
  'bed-strip|lavender': { note: 'цветение VI–VIII' }, 'bed-strip|tulips': { note: 'цветение IV–V' },
};

export function plantGroupOf(kind) {
  const def = landscapeDef(kind);
  if (!def || def.cat !== 'green') return null;
  if (def.group === 'Деревья') return 'trees';
  if (def.group === 'Кустарники') return 'shrubs';
  if (FLOWER_KINDS.has(kind)) return 'flowers';
  if (LAWN_KINDS.has(kind)) return 'lawn';
  return null; // короба, валуны — не растения
}

export const plantUnit = (kind) => (AREA_KINDS.has(kind) ? 'м²' : HEDGE_KINDS.has(kind) ? 'м' : 'шт');

export function plantKey(o) {
  const def = landscapeDef(o?.kind);
  return def ? `${o.kind}|${variantOf(o, def)?.id || 'default'}` : null;
}

// Значения каталога для вида: { name, size, note }.
export function plantDefaults(key) {
  const [kind, variant] = String(key).split('|');
  const def = landscapeDef(kind);
  if (!def) return null;
  const base = INFO[kind] || {};
  const own = INFO[`${kind}|${variant}`] || {};
  const v = def.variants.find((x) => x.id === variant) || def.variants[0];
  const name = own.name || base.name || (def.variants.length > 1 ? `${def.title}, ${v.title.toLowerCase()}` : def.title);
  return { name, species: Boolean(own.name || base.name), size: own.size ?? base.size ?? null, note: own.note ?? base.note ?? '' };
}

// Количество объекта в единицах вида: шт — 1, м — длина, м² — площадь.
function quantity(o, unit) {
  if (unit === 'м²') return objectAreaM2(o);
  if (unit === 'м') return o.kind === 'hedge-line' ? objectLengthM(o) : Math.max(o.w, o.h) / 1000;
  return 1;
}

const round2 = (v) => Math.round(v * 100) / 100;

// Ведомость: { groups: [{ id, title, rows, total }], rows, total, priced, unpriced }.
// Строка: { pos, key, kind, variant, group, title, unit, count, qty, size,
// sizeDefault, price, sum, note }; total — сумма по строкам с ценой.
export function plantSchedule(objects, book = {}) {
  const map = new Map();
  for (const o of objects || []) {
    const group = plantGroupOf(o.kind);
    if (!group) continue;
    const key = plantKey(o);
    if (!map.has(key)) {
      const d = plantDefaults(key);
      const e = normalizePlantEntry(book?.[key]) || {};
      map.set(key, {
        key, kind: o.kind, variant: key.split('|')[1], group, title: d.name, unit: plantUnit(o.kind),
        count: 0, qty: 0, size: e.size ?? d.size, sizeDefault: d.size, price: e.price ?? null, sum: null,
        note: e.note ?? d.note, noteDefault: d.note,
      });
    }
    const r = map.get(key);
    r.count += 1;
    r.qty += quantity(o, r.unit);
  }
  const order = Object.fromEntries(PLANT_GROUPS.map((g, i) => [g.id, i]));
  const rows = [...map.values()]
    .sort((a, b) => order[a.group] - order[b.group] || a.title.localeCompare(b.title, 'ru'))
    .map((r, i) => {
      const qty = r.unit === 'шт' ? r.qty : round2(r.qty);
      return { ...r, pos: i + 1, qty, sum: r.price != null ? round2(r.price * qty) : null };
    });
  const groups = PLANT_GROUPS.map((g) => {
    const list = rows.filter((r) => r.group === g.id);
    return { ...g, rows: list, total: round2(list.reduce((s, r) => s + (r.sum || 0), 0)) };
  }).filter((g) => g.rows.length);
  return {
    groups, rows,
    total: round2(rows.reduce((s, r) => s + (r.sum || 0), 0)),
    priced: rows.filter((r) => r.price != null).length,
    unpriced: rows.filter((r) => r.price == null).length,
  };
}

// Правка справочника (в mutate): patch — { size, price, note }; значение,
// равное каталожному, или пустое — не хранится.
export function setPlantEntry(landscape, key, patch) {
  const d = plantDefaults(key);
  if (!d || !landscape) return null;
  const cur = { ...(landscape.plants?.[key] || {}), ...patch };
  if (cur.size != null && cur.size !== '' && Number(cur.size) === d.size) delete cur.size;
  if (typeof cur.note === 'string' && cur.note.trim() === d.note) delete cur.note;
  const e = normalizePlantEntry(cur);
  const book = { ...(landscape.plants || {}) };
  if (e) book[key] = e; else delete book[key];
  if (Object.keys(book).length) landscape.plants = book; else delete landscape.plants;
  return e;
}

// Числа для таблиц: «1 250», «12,5», деньги — без копеек, если целые.
export const fmtQty = (r) => (r.unit === 'шт' ? String(r.qty) : r.qty.toFixed(1).replace('.', ','));
export function fmtMoney(v) {
  if (v == null) return '';
  const fixed = Number.isInteger(v) ? String(v) : v.toFixed(2);
  const [a, b] = fixed.split('.');
  return `${a.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}${b ? `,${b}` : ''}`;
}

// Строки CSV (;) — блок «Ведомость растений» после основной ведомости.
export function plantCsvLines(schedule, cell) {
  if (!schedule.rows.length) return [];
  const num = (v) => (v == null ? '' : String(v).replace('.', ','));
  const lines = ['', cell('Ведомость растений'),
    ['Поз.', 'Группа', 'Наименование', 'Кол-во', 'Ед.', 'Размер посадки, мм', 'Цена за ед.', 'Сумма', 'Цветение / примечание'].join(';')];
  for (const g of schedule.groups) {
    for (const r of g.rows) {
      lines.push([r.pos, cell(g.title), cell(r.title), num(r.qty), r.unit, r.size ?? '', num(r.price), num(r.sum), cell(r.note)].join(';'));
    }
  }
  lines.push(['', '', cell('Итого стоимость озеленения'), '', '', '', '', num(schedule.total), schedule.unpriced ? cell(`без цены: ${schedule.unpriced} поз.`) : ''].join(';'));
  return lines;
}

// Для JSON-экспорта.
export function plantScheduleExport(schedule) {
  if (!schedule.rows.length) return null;
  return {
    rows: schedule.rows.map((r) => ({
      pos: r.pos, key: r.key, kind: r.kind, variant: r.variant, group: r.group, title: r.title, unit: r.unit,
      count: r.count, qty: r.qty, planting_size_mm: r.size, price: r.price, sum: r.sum, note: r.note || '',
    })),
    total: schedule.total,
    unpriced: schedule.unpriced,
  };
}

// DXF: таблица текстом (слой key) с левым верхним углом в (x, y), мм.
export function plantScheduleDxf(schedule, x, y, layer = 'lsNotes', h = 250) {
  if (!schedule.rows.length) return [];
  const out = [];
  const step = h * 1.8;
  let yy = y;
  const text = (dx, t, hh = h) => { if (t !== '' && t != null) out.push({ type: 'text', layer, x: x + dx, y: yy, height: hh, text: String(t).replace(/\u00a0/g, ' ') }); };
  text(0, 'ВЕДОМОСТЬ РАСТЕНИЙ', h * 1.3);
  yy += step * 1.4;
  const head = () => { text(0, 'Поз. Наименование'); text(h * 36, 'Кол-во'); text(h * 46, 'Посадка, мм'); text(h * 58, 'Цена'); text(h * 68, 'Сумма'); };
  head();
  for (const g of schedule.groups) {
    yy += step * 1.2;
    text(0, g.title.toUpperCase());
    for (const r of g.rows) {
      yy += step;
      text(0, `${r.pos}. ${r.title}`);
      text(h * 36, `${fmtQty(r)} ${r.unit}`);
      text(h * 46, r.size ?? '');
      text(h * 58, fmtMoney(r.price));
      text(h * 68, fmtMoney(r.sum));
    }
  }
  yy += step * 1.4;
  text(0, `Итого стоимость озеленения: ${fmtMoney(schedule.total)}${schedule.unpriced ? ` (без цены: ${schedule.unpriced} поз.)` : ''}`);
  return out;
}

// Составная (параметрическая) мебель. Чистый модуль без DOM.
//
// У предмета project.items[] может быть необязательное поле comp — объект
// параметров { type, … }. По предмету и comp строится список частей
//   parts: [{ kind, x, y, w, h, rotation }]
// в ЛОКАЛЬНЫХ осях предмета (мм, Y вниз, центр предмета в (0, 0), без его
// поворота). kind части — id блока мебели (core/blocks.js): render рисует его
// тем же глифом, что и обычный предмет, экспорт выгружает отдельным блоком.
// Размер предмета (w×h) — это его основа (столешница), части — дополнение
// вокруг: выделение и растягивание идут по основе, габарит — по всему.
//
// Типы составной мебели — в TYPES: { kinds, defaults(kind), normalize(raw,
// kind), parts(item, comp) }. Сейчас один — 'dining' (стол со стульями);
// диван-конструктор и кухня добавятся сюда же своими типами.
//
// Стол со стульями, comp = {
//   type: 'dining',
//   chair: 'chair' | null,   // id блока стула; null — без стульев
//   offset: 100,             // мм от края стола до переднего края стула;
//                            // < 0 — стул задвинут под стол
//   spacing: 150,            // мм, зазор между соседними стульями
//   sides: { top, bottom, left, right }, // стороны со стульями (прямоугольный)
//   count: 0,                // круглый стол: число стульев, 0 — сколько влезет
// }
// На стороне длиной L помещается floor((L + spacing) / (ширина_стула + spacing))
// стульев, ряд центрируется. Стул смотрит лицом (+Y блока) к столу.

import { furnitureBlock } from './blocks.js';

export const DINING_KINDS = ['dining-table', 'dining-table-6', 'table-round', 'conference-table'];
const ROUND_KINDS = new Set(['table-round']);
const DEFAULT_CHAIR = 'chair';
const MAX_PER_SIDE = 40;

const num = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

export const isRoundTable = (kind) => ROUND_KINDS.has(kind);

// Сколько стульев шириной cw влезает на сторону длиной len с зазором gap.
export function chairsFit(len, cw, gap) {
  if (!(len > 0 && cw > 0)) return 0;
  return Math.max(0, Math.min(MAX_PER_SIDE, Math.floor((len + gap + 1e-6) / (cw + gap))));
}

function chairBlock(comp) {
  if (!comp.chair) return null;
  return furnitureBlock(comp.chair) || furnitureBlock(DEFAULT_CHAIR);
}

const dining = {
  kinds: DINING_KINDS,
  defaults(kind) {
    const all = kind === 'conference-table';
    return {
      type: 'dining',
      chair: DEFAULT_CHAIR,
      offset: 100,
      spacing: 150,
      sides: { top: true, bottom: true, left: all, right: all },
      count: 0,
    };
  },
  normalize(raw, kind) {
    const d = dining.defaults(kind);
    const s = raw.sides && typeof raw.sides === 'object' ? raw.sides : d.sides;
    return {
      type: 'dining',
      chair: raw.chair === null ? null : (typeof raw.chair === 'string' && raw.chair ? raw.chair : d.chair),
      offset: num(raw.offset, d.offset, -1000, 2000),
      spacing: num(raw.spacing, d.spacing, 0, 3000),
      sides: { top: Boolean(s.top), bottom: Boolean(s.bottom), left: Boolean(s.left), right: Boolean(s.right) },
      count: num(raw.count, 0, 0, MAX_PER_SIDE),
    };
  },
  parts(item, comp) {
    const block = chairBlock(comp);
    if (!block) return [];
    const { w: cw, h: cd } = block;
    const out = [];
    const push = (x, y, rotation) => out.push({ kind: block.id, x, y, w: cw, h: cd, rotation });
    if (isRoundTable(item.kind)) {
      // По эллипсу столешницы: n стульев равномерно, первый — сверху.
      const a = item.w / 2;
      const b = item.h / 2;
      const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      const n = comp.count > 0 ? comp.count : chairsFit(perimeter - comp.spacing, cw, comp.spacing);
      const dist = comp.offset + cd / 2;
      for (let i = 0; i < n; i += 1) {
        const t = -Math.PI / 2 + (2 * Math.PI * i) / n;
        let nx = b * Math.cos(t);
        let ny = a * Math.sin(t);
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        const rot = (Math.atan2(nx, -ny) * 180) / Math.PI;
        push(a * Math.cos(t) + nx * dist, b * Math.sin(t) + ny * dist, ((Math.round(rot * 1000) / 1000) + 360) % 360);
      }
      return out;
    }
    const row = (len) => {
      const n = chairsFit(len, cw, comp.spacing);
      const pitch = cw + comp.spacing;
      return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
    };
    const hw = item.w / 2;
    const hh = item.h / 2;
    const out0 = comp.offset + cd / 2; // центр стула от края стола
    // Блок стула смотрит в +Y; поворот 0 — лицом вниз (к столу сверху).
    if (comp.sides.top) for (const t of row(item.w)) push(t, -hh - out0, 0);
    if (comp.sides.bottom) for (const t of row(item.w)) push(t, hh + out0, 180);
    if (comp.sides.left) for (const t of row(item.h)) push(-hw - out0, t, 270);
    if (comp.sides.right) for (const t of row(item.h)) push(hw + out0, t, 90);
    return out;
  },
};

export const TYPES = Object.freeze({ dining });

// Тип составной мебели, подходящий виду предмета (или null).
export function compTypeFor(kind) {
  return Object.keys(TYPES).find((t) => TYPES[t].kinds.includes(kind)) || null;
}

// comp по умолчанию для вида предмета; null — вид не составной.
export function defaultComp(kind) {
  const t = compTypeFor(kind);
  return t ? TYPES[t].defaults(kind) : null;
}

// Проверка comp при загрузке: неизвестный тип или чужой вид → null.
export function normalizeComp(raw, kind) {
  if (!raw || typeof raw !== 'object') return null;
  const type = TYPES[raw.type];
  if (!type || !type.kinds.includes(kind)) return null;
  return type.normalize(raw, kind);
}

// Приводит comp у списка предметов (на месте): битый comp удаляется.
export function normalizeItemsComp(items) {
  for (const item of items || []) {
    if (!item || !('comp' in item)) continue;
    const comp = normalizeComp(item.comp, item.kind);
    if (comp) item.comp = comp; else delete item.comp;
  }
  return items;
}

// Новому предмету составного вида — comp по умолчанию (на месте).
export function withDefaultComp(item) {
  const comp = defaultComp(item.kind);
  if (comp && !item.comp) item.comp = comp;
  return item;
}

// Части предмета в его локальных осях; [] — не составной.
export function compositeParts(item) {
  const comp = item?.comp && normalizeComp(item.comp, item.kind);
  if (!comp) return [];
  return TYPES[comp.type].parts(item, comp);
}

const rotate = (x, y, deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

// Части в осях дома (как обычные предметы: центр x, y и поворот).
export function partsInHouse(item, parts = compositeParts(item)) {
  const rot = item.rotation || 0;
  return parts.map((p) => {
    const q = rotate(p.x, p.y, rot);
    return { ...p, x: item.x + q.x, y: item.y + q.y, rotation: (((p.rotation || 0) + rot) % 360 + 360) % 360 };
  });
}

// Габарит (AABB в осях дома) предмета вместе с частями.
export function compositeBounds(item) {
  const rects = [{ x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation || 0 }, ...partsInHouse(item)];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const r of rects) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const q = rotate((sx * r.w) / 2, (sy * r.h) / 2, r.rotation || 0);
      minX = Math.min(minX, r.x + q.x); maxX = Math.max(maxX, r.x + q.x);
      minY = Math.min(minY, r.y + q.y); maxY = Math.max(maxY, r.y + q.y);
    }
  }
  const round = (v) => Math.round(v * 1000) / 1000 + 0; // + 0: без «-0»
  return { x: round(minX), y: round(minY), w: round(maxX - minX), h: round(maxY - minY) };
}

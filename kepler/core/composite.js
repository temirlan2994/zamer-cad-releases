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
// kind), parts(item, comp), fixedSize?, fit?(item, comp) }: 'dining' (стол со
// стульями) и 'sofa' (диван-конструктор, ниже). У fixedSize-типа размер
// предмета — габарит частей (fit пересчитывает его), основа не рисуется.
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

// ---------------------------------------------------------------------------
// Диван-конструктор, comp = {
//   type: 'sofa',
//   depth: 950,   // мм, глубина сиденья — общая для всех модулей
//   dir: 0,       // направление первого модуля: 0 →, 1 ↓, 2 ←, 3 ↑ (×90° по часовой)
//   modules: [{ type: 'arm' | 'seat' | 'ottoman' | 'chaise' | 'corner', w }],
// }
// Модули идут цепочкой вдоль спинки. У каждого модуля своя рамка: начало O
// на линии спинки, u — направление цепочки, v = u, повёрнутый на +90°, —
// «вперёд» (к сидящему). Прямой модуль занимает [0, w] вдоль u и [0, глубина]
// вдоль v; угловой — квадрат depth×depth со спинкой с двух сторон, после него
// цепочка поворачивает на +90° (все углы дивана — в одну сторону, так
// собираются Г и П). Модули стыкуются без зазоров; пересечение частей —
// неверная сборка (editSofa такую не допускает).
// Здесь размер предмета w×h — это габарит дивана (считается из модулей, не
// растягивается), части заполняют его целиком.

export const SOFA_KINDS = ['sofa', 'sofa-2', 'sofa-corner', 'sofa-u'];
export const SOFA_BACK = 220; // мм, толщина спинки
export const SOFA_CHAISE_EXTRA = 700; // мм, на сколько шезлонг длиннее сиденья
const SOFA_MAX_MODULES = 24;

// Типы модулей: подпись, ширина по умолчанию и пределы (угловой — depth×depth).
export const SOFA_MODULES = Object.freeze({
  seat: { title: 'Сиденье', short: 'Сиденье', w: 900, min: 400, max: 1600, back: true },
  corner: { title: 'Угловой', short: 'Угол', back: true },
  arm: { title: 'Подлокотник', short: 'Подлок.', w: 200, min: 100, max: 400, back: false },
  ottoman: { title: 'Пуф (без спинки)', short: 'Пуф', w: 900, min: 400, max: 1600, back: false },
  chaise: { title: 'Шезлонг', short: 'Шезлонг', w: 900, min: 600, max: 1600, back: true },
});

const SOFA_DEFAULTS = {
  sofa: { depth: 950, dir: 0, mods: [['arm'], ['seat', 900], ['seat', 900], ['arm']] },
  'sofa-2': { depth: 900, dir: 0, mods: [['arm'], ['seat', 600], ['seat', 600], ['arm']] },
  // Г: спинка сверху и слева, подлокотники справа и снизу (как прежний глиф).
  'sofa-corner': { depth: 900, dir: 3, mods: [['arm'], ['seat', 500], ['corner'], ['seat', 750], ['seat', 750], ['arm']] },
  'sofa-u': {
    depth: 900,
    dir: 3,
    mods: [['arm'], ['seat', 650], ['seat', 650], ['corner'], ['seat', 600], ['seat', 600], ['corner'], ['seat', 650], ['seat', 650], ['arm']],
  },
};

// Модуль по умолчанию заданного типа (ширина — из SOFA_MODULES).
export function sofaModule(type, w) {
  const def = SOFA_MODULES[type];
  if (!def) return null;
  if (type === 'corner') return { type };
  return { type, w: num(w, def.w, def.min, def.max) };
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // 0 →, 1 ↓, 2 ←, 3 ↑ (ось Y вниз)
const turnsBefore = (modules, i) => modules.slice(0, i).filter((m) => m.type === 'corner').length;

// Раскладка цепочки в «сырых» осях (первый модуль начинается в (0, 0)).
// parts — прямоугольники модулей (центр, w вдоль u, h вдоль v, поворот),
// ends — места присоединения: середина свободного торца и наружная нормаль.
export function sofaLayout(comp) {
  const D = comp.depth;
  let dir = ((comp.dir || 0) % 4 + 4) % 4;
  let ox = 0; let oy = 0;
  const parts = [];
  const joints = [];
  let prevDepth = 0;
  const startU = DIRS[dir];
  const n = comp.modules.length;
  comp.modules.forEach((m, i) => {
    const [ux, uy] = DIRS[dir];
    const vx = -uy; const vy = ux; // u, повёрнутый на +90°
    const corner = m.type === 'corner';
    const len = corner ? D : m.w;
    const depth = m.type === 'chaise' ? D + SOFA_CHAISE_EXTRA : D;
    // Стык с предыдущим модулем: «+» у передней кромки стыка (вставка в середину).
    if (i > 0) {
      const jd = Math.max(prevDepth, depth);
      joints.push({ end: 'joint', at: i, x: ox + vx * jd, y: oy + vy * jd, nx: vx, ny: vy });
    }
    parts.push({
      kind: `sofa:${m.type}`,
      x: ox + (ux * len) / 2 + (vx * depth) / 2,
      y: oy + (uy * len) / 2 + (vy * depth) / 2,
      w: len,
      h: depth,
      rotation: dir * 90,
      module: i,
      back: SOFA_MODULES[m.type].back ? Math.min(SOFA_BACK, D / 3) : 0,
      // Стык: общую кромку рисует предыдущий модуль, этот — только остаток
      // своей боковой кромки, если он глубже соседа (шезлонг после сиденья).
      startFrom: i > 0 ? Math.min(prevDepth, depth) : 0,
      joinStart: i > 0,
      joinEnd: i < n - 1,
    });
    if (corner) {
      ox += ux * D + vx * D; oy += uy * D + vy * D;
      dir = (dir + 1) % 4;
      prevDepth = D;
    } else {
      ox += ux * len; oy += uy * len;
      prevDepth = depth;
    }
  });
  const [ux, uy] = DIRS[dir];
  const vx = -uy; const vy = ux;
  const ends = [
    { end: 'start', at: 0, x: ((-startU[1]) * D) / 2, y: (startU[0] * D) / 2, nx: -startU[0], ny: -startU[1] },
    { end: 'end', at: n, x: ox + (vx * D) / 2, y: oy + (vy * D) / 2, nx: ux, ny: uy },
    ...joints,
  ];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of parts) {
    const odd = (p.rotation / 90) % 2 === 1;
    const hw = (odd ? p.h : p.w) / 2;
    const hh = (odd ? p.w : p.h) / 2;
    minX = Math.min(minX, p.x - hw); maxX = Math.max(maxX, p.x + hw);
    minY = Math.min(minY, p.y - hh); maxY = Math.max(maxY, p.y + hh);
  }
  return { parts, ends, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

// Прямоугольник части (AABB, все повороты кратны 90°).
export function partRect(p) {
  const odd = Math.round(p.rotation / 90) % 2 !== 0;
  const w = odd ? p.h : p.w;
  const h = odd ? p.w : p.h;
  return { x: p.x - w / 2, y: p.y - h / 2, w, h };
}

// Есть ли у частей наложения (площадь пересечения больше 1 мм²).
export function partsOverlap(parts) {
  const rects = parts.map(partRect);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]; const b = rects[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 1e-6 && iy > 1e-6 && ix * iy > 1) return true;
    }
  }
  return false;
}

const centered = (layout) => {
  const cx = layout.box.x + layout.box.w / 2;
  const cy = layout.box.y + layout.box.h / 2;
  const r = (v) => Math.round(v * 1000) / 1000 + 0;
  return {
    parts: layout.parts.map((p) => ({ ...p, x: r(p.x - cx), y: r(p.y - cy) })),
    ends: layout.ends.map((e) => ({ ...e, x: r(e.x - cx), y: r(e.y - cy) })),
    w: r(layout.box.w),
    h: r(layout.box.h),
  };
};

const sofa = {
  kinds: SOFA_KINDS,
  fixedSize: true, // размер предмета = габарит модулей
  defaults(kind) {
    const d = SOFA_DEFAULTS[kind] || SOFA_DEFAULTS.sofa;
    return { type: 'sofa', depth: d.depth, dir: d.dir, modules: d.mods.map(([t, w]) => sofaModule(t, w)) };
  },
  normalize(raw, kind) {
    const d = sofa.defaults(kind);
    const mods = Array.isArray(raw.modules)
      ? raw.modules.map((m) => (m && typeof m === 'object' ? sofaModule(m.type, m.w) : null)).filter(Boolean).slice(0, SOFA_MAX_MODULES)
      : [];
    return {
      type: 'sofa',
      depth: num(raw.depth, d.depth, 500, 1400),
      dir: ((num(raw.dir, d.dir, -1000, 1000) % 4) + 4) % 4,
      modules: mods.length ? mods : d.modules,
    };
  },
  parts(item, comp) {
    return centered(sofaLayout(comp)).parts;
  },
  // Размер предмета по модулям (центр предмета не меняется).
  fit(item, comp) {
    const c = centered(sofaLayout(comp));
    item.w = c.w;
    item.h = c.h;
  },
};

export const TYPES = Object.freeze({ dining, sofa });

// Размер предмета задаётся частями (диван-конструктор): не растягивается.
export function isFixedSizeComp(item) {
  const comp = item?.comp && normalizeComp(item.comp, item.kind);
  return Boolean(comp && TYPES[comp.type].fixedSize);
}

const rot = (x, y, deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9;
  const s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return { x: x * c - y * s, y: x * s + y * c };
};

// Места «+» дивана в осях дома: { end, x, y, nx, ny } — середина свободного
// торца цепочки и наружная нормаль. [] — не диван-конструктор.
export function sofaEnds(item) {
  return sofaSpots(item).filter((e) => e.end !== 'joint');
}

// Все места «+»: торцы и стыки между модулями ({ end: 'joint', at } —
// вставка перед модулем at). Нормаль стыка — вперёд, от спинки.
export function sofaSpots(item) {
  const comp = item?.comp && normalizeComp(item.comp, item.kind);
  if (!comp || comp.type !== 'sofa') return [];
  const r = item.rotation || 0;
  return centered(sofaLayout(comp)).ends.map((e) => {
    const p = rot(e.x, e.y, r);
    const n = rot(e.nx, e.ny, r);
    const r3 = (v) => Math.round(v * 1000) / 1000 + 0; // + 0: без «-0»
    return { end: e.end, at: e.at, x: r3(item.x + p.x), y: r3(item.y + p.y), nx: r3(n.x), ny: r3(n.y) };
  });
}

// Точка (в осях дома) попадает в один из модулей дивана — не в пустой
// внутренний угол Г/П. Для прочих предметов — в их прямоугольник.
export function pointInComposite(item, px, py) {
  const local = rot(px - item.x, py - item.y, -(item.rotation || 0));
  const inRect = (r) => local.x >= r.x - 1e-6 && local.x <= r.x + r.w + 1e-6 && local.y >= r.y - 1e-6 && local.y <= r.y + r.h + 1e-6;
  if (isFixedSizeComp(item)) return compositeParts(item).some((p) => inRect(partRect(p)));
  return inRect({ x: -item.w / 2, y: -item.h / 2, w: item.w, h: item.h });
}

// Линии модулей дивана (в локальных осях предмета) для чертежа: каждый
// отрезок кромки — один раз (общие и частично совпадающие кромки соседних
// модулей сливаются), скругления подлокотников на свободных концах — дугами.
// { segs: [[x1, y1, x2, y2]], arcs: [{ cx, cy, r, a0, a1 }] }
export function sofaLines(parts) {
  const raw = [];
  const arcs = [];
  for (const part of parts) {
    const type = part.kind.slice(5);
    const { w, h } = part;
    const x0 = -w / 2; const x1 = w / 2; const y0 = -h / 2; const y1 = h / 2;
    const r = type === 'arm' ? Math.min(90, w * 0.45) : 0;
    const rs = part.joinStart ? 0 : r;
    const re = part.joinEnd ? 0 : r;
    const local = [
      [x0 + rs, y0, x1 - re, y0], // спинка (задняя кромка)
      [x1, y0 + re, x1, y1 - re], // конец
      [x0 + rs, y1, x1 - re, y1], // передняя кромка
      [x0, y0 + rs, x0, y1 - rs], // начало
    ];
    const b = part.back || 0;
    if (b > 0 && type === 'corner') local.push([x0, y0 + b, x1 - b, y0 + b], [x1 - b, y0 + b, x1 - b, y1]);
    else if (b > 0) local.push([x0, y0 + b, x1, y0 + b]);
    if (type === 'chaise') { const ys = y1 - h * 0.32; local.push([x0 + w * 0.12, ys, x1 - w * 0.12, ys]); }
    const deg = part.rotation || 0;
    const tp = (x, y) => { const q = rot(x, y, deg); return [part.x + q.x, part.y + q.y]; };
    for (const [ax, ay, bx, by] of local) raw.push([...tp(ax, ay), ...tp(bx, by)]);
    const a = (deg * Math.PI) / 180;
    const arc = (cx, cy, a0, a1) => { const [X, Y] = tp(cx, cy); arcs.push({ cx: X, cy: Y, r, a0: a0 + a, a1: a1 + a }); };
    if (rs) { arc(x0 + rs, y0 + rs, Math.PI, Math.PI * 1.5); arc(x0 + rs, y1 - rs, Math.PI / 2, Math.PI); }
    if (re) { arc(x1 - re, y0 + re, Math.PI * 1.5, Math.PI * 2); arc(x1 - re, y1 - re, 0, Math.PI / 2); }
  }
  return { segs: dedupeSegments(raw), arcs };
}

// Осевые (горизонтальные/вертикальные) отрезки без повторов: из каждого
// вычитается то, что уже покрыто отрезками той же прямой.
export function dedupeSegments(segs) {
  const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
  const covered = new Map(); // прямая → [[a, b]]
  const out = [];
  for (const [x1, y1, x2, y2] of segs) {
    const horiz = Math.abs(y1 - y2) < 1e-6;
    const vert = Math.abs(x1 - x2) < 1e-6;
    if (!horiz && !vert) { out.push([x1, y1, x2, y2]); continue; }
    const key = horiz ? `h${r3(y1)}` : `v${r3(x1)}`;
    let pieces = [horiz ? [Math.min(x1, x2), Math.max(x1, x2)] : [Math.min(y1, y2), Math.max(y1, y2)]];
    const cov = covered.get(key) || [];
    for (const [ca, cb] of cov) {
      pieces = pieces.flatMap(([a, b]) => {
        if (cb <= a + 1e-6 || ca >= b - 1e-6) return [[a, b]];
        const rest = [];
        if (ca > a + 1e-6) rest.push([a, ca]);
        if (cb < b - 1e-6) rest.push([cb, b]);
        return rest;
      });
    }
    for (const [a, b] of pieces) {
      if (b - a < 0.5) continue;
      out.push(horiz ? [r3(a), r3(y1), r3(b), r3(y1)] : [r3(x1), r3(a), r3(x1), r3(b)]);
      cov.push([a, b]);
    }
    covered.set(key, cov);
  }
  return out;
}

// Правка дивана-конструктора без изменения предмета. op:
//   { op: 'add', end: 'start' | 'end', type, w? } — модуль к торцу цепочки;
//   { op: 'insert', at, type, w? } — модуль перед модулем at (0…n);
//   { op: 'remove', index };  { op: 'set', index, type?, w? };  { op: 'depth', value }.
// Возвращает { comp, x, y, w, h } — новые поля предмета, или null, если правка
// невозможна (модули пересекаются, удаление последнего модуля, неверный тип).
// Якорь — модуль рядом с местом правки: он остаётся на месте и в той же
// ориентации, диван не «прыгает».
export function editSofa(item, edit) {
  const old = item?.comp && normalizeComp(item.comp, item.kind);
  if (!old || old.type !== 'sofa') return null;
  const mods = old.modules.map((m) => ({ ...m }));
  let from = 0; // индекс якоря в старой цепочке
  let to = 0; //   … и в новой
  const n = mods.length;
  const idx = Number(edit?.index);
  let depth = old.depth;
  switch (edit?.op) {
    case 'add':
    case 'insert': {
      // add: к торцу (end: 'start' | 'end'); insert: перед модулем at (0…n).
      const m = sofaModule(edit.type, edit.w);
      if (!m || n >= SOFA_MAX_MODULES) return null;
      const at = edit.op === 'add' ? (edit.end === 'start' ? 0 : n) : Number(edit.at);
      if (!(Number.isInteger(at) && at >= 0 && at <= n)) return null;
      mods.splice(at, 0, m);
      // Якорь — модуль перед вставкой (в начале — бывший первый).
      if (at === 0) { from = 0; to = 1; } else { from = at - 1; to = at - 1; }
      break;
    }
    case 'remove': {
      if (n <= 1 || !(idx >= 0 && idx < n)) return null;
      mods.splice(idx, 1);
      from = idx > 0 ? idx - 1 : 1;
      to = idx > 0 ? idx - 1 : 0;
      break;
    }
    case 'set': {
      if (!(idx >= 0 && idx < n)) return null;
      // Смена типа без ширины — ширина по умолчанию нового типа.
      const type = edit.type || mods[idx].type;
      const m = sofaModule(type, edit.w ?? (type === mods[idx].type ? mods[idx].w : undefined));
      if (!m) return null;
      mods[idx] = m;
      from = idx; to = idx;
      break;
    }
    case 'depth':
      depth = num(edit.value, old.depth, 500, 1400);
      break;
    default:
      return null;
  }
  // Направление первого модуля — так, чтобы якорь сохранил ориентацию.
  const dir = ((old.dir + turnsBefore(old.modules, from) - turnsBefore(mods, to)) % 4 + 4) % 4;
  const comp = normalizeComp({ type: 'sofa', depth, dir, modules: mods }, item.kind);
  const a = centered(sofaLayout(old));
  const b = centered(sofaLayout(comp));
  if (partsOverlap(b.parts)) return null;
  const pa = a.parts[from];
  const pb = b.parts[to];
  // Для якоря берём его угол «начало спинки» — он не зависит от его ширины.
  const anchor = (p) => {
    const [ux, uy] = DIRS[(p.rotation / 90) % 4];
    return { x: p.x - (ux * p.w) / 2 + (uy * p.h) / 2, y: p.y - (uy * p.w) / 2 - (ux * p.h) / 2 };
  };
  const qa = anchor(pa);
  const qb = anchor(pb);
  const d = rot(qa.x - qb.x, qa.y - qb.y, item.rotation || 0);
  const round = (v) => Math.round(v * 1000) / 1000 + 0;
  return { comp, x: round(item.x + d.x), y: round(item.y + d.y), w: b.w, h: b.h };
}

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
    if (comp) { item.comp = comp; TYPES[comp.type].fit?.(item, comp); } else delete item.comp;
  }
  return items;
}

// Новому предмету составного вида — comp по умолчанию (на месте).
export function withDefaultComp(item) {
  const comp = defaultComp(item.kind);
  if (comp && !item.comp) {
    item.comp = comp;
    TYPES[comp.type].fit?.(item, comp); // диван: размер — по модулям
  }
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

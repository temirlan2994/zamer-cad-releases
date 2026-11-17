// Эргономика мебели: зоны пользования предметов, зазоры, проходы и
// проходимость комнаты. Чистый модуль без DOM: рисует ui/render-ergonomics.js,
// управляет режимом ui/ergonomics.js, замечания — core/issues.js (группа ergo).
//
// Все зазоры меряются ПО ЗОНЕ ПОЛЬЗОВАНИЯ предмета: «лицо» предмета — его
// локальная сторона +Y (спинка дивана, изголовье кровати, задняя стенка шкафа
// — вдоль −Y, как в каталоге и авторасстановке core/furnish.js). Зона —
// полоса от стороны предмета наружу; зазор — расстояние до ближайшего
// препятствия (стена комнаты, вложенное помещение, другой предмет на полу) в
// пределах ширины полосы. Повёрнутые на любой угол предметы считаются в осях
// дома честно (многоугольники, а не габариты).
//
// Проходимость: сетка 50 мм по комнате, карта расстояний до препятствий
// (точное евклидово преобразование), «человек» — круг диаметром 600 (800 —
// удобный проход). Достижимость предмета — поиск в ширину от порогов дверей.
//
// Нормы — в одной таблице ERGO_NORMS (типовые значения СП 55.13330 / Нойферт,
// мм): crit — меньше — ошибка (красный), need — меньше — замечание (жёлтый).
//
// Находка: { id, severity: 'error'|'warn', rule, group, roomId, itemIds,
//   text, gap, need, crit, zone, band, dim, labelAt, label, fix? }
//   zone — многоугольник зоны пользования (оси дома), band — нарушающая
//   полоса от предмета до препятствия, dim — { a, b } размер зазора,
//   label — короткая подпись «420 < 700».
// Нормальные зоны (для показа «зелёным») — okZones: [{ zone, itemIds, rule, group }].

import { DEFAULT_PARTITION, furnitureDef, isRoundItem, isStructural } from './catalog.js';
import { compositeParts, isFixedSizeComp } from './composite.js';
import { itemsInRoom } from './furnish.js';
import { furniture3d } from './furniture3d.js';
import { roomContainsPoint, roomPolygon, roomRects } from './room-shape.js';
import { nestedOuterRect } from './rooms.js';
import { slabOpeningCutRects, slabOpenings } from './slab-openings.js';
import { doorLeaves, openingRect, wallRects } from './walls.js';

export const ERGO_CELL = 50; // шаг сетки проходимости, мм
export const ERGO_FLUSH = 50; // «вплотную»: зазор до 50 мм — предмет приставлен намеренно
export const ERGO_TOLERANCE = 20; // допуск нормы: недобор до 20 мм — не замечание

// Группы правил (флажки в «Видах»).
export const ERGO_GROUPS = Object.freeze([
  { id: 'passage', title: 'Проходы' },
  { id: 'bed', title: 'Кровать' },
  { id: 'storage', title: 'Шкафы' },
  { id: 'kitchen', title: 'Кухня' },
  { id: 'bath', title: 'Санузел' },
  { id: 'doors', title: 'Двери' },
  { id: 'windows', title: 'Окна' },
]);

// Таблица норм, мм. crit — критично (меньше — ошибка), need — норма
// (меньше — «тесно»).
export const ERGO_NORMS = Object.freeze({
  passage: { crit: 600, need: 800 }, // общий проход: человек 600, удобно 800
  bedSide: { crit: 600, need: 700 }, // проход сбоку кровати
  bedFoot: { crit: 600, need: 700 }, // в ногах кровати
  kidsBed: { crit: 500, need: 600 },
  wardrobe: { crit: 600, need: 800 }, // распашной шкаф: дверца ~450 + человек
  sliding: { crit: 500, need: 600 }, // шкаф-купе
  drawers: { crit: 600, need: 800 }, // комод: выдвинутый ящик + человек
  shelf: { crit: 500, need: 600 }, // стеллаж, обувница, тумба
  sofa: { crit: 600, need: 800 }, // проход перед диваном (без журнального столика)
  armchair: { crit: 450, need: 600 },
  sofaTable: { min: 300, max: 600 }, // диван ↔ журнальный столик: удобно 350–450, дальше 600 — не дотянуться
  tv: { min: 1500, max: 4000 }, // диван ↔ ТВ
  dining: { crit: 600, need: 800 }, // от края стола: отодвинуть стул и пройти
  desk: { crit: 600, need: 800 }, // за стулом у рабочего стола
  kitchen: { crit: 700, need: 1000 }, // перед кухней, между рядами
  island: { crit: 700, need: 1000 },
  bar: { crit: 600, need: 800 },
  triangle: { sideMin: 1200, sideMax: 2700, sumMin: 3600, sumMax: 6600 },
  toiletFront: { crit: 500, need: 600 }, // перед унитазом
  toiletSide: { crit: 100, need: 200 }, // от края унитаза: ось ≥ 400 до стены (≥ 300 — тесно)
  basin: { crit: 600, need: 700 },
  bath: { crit: 600, need: 700 },
  urinal: { crit: 500, need: 600 },
  laundry: { crit: 500, need: 700 },
  doorPad: 100, // зона открывания = дуга створки + 100
  doorFront: { crit: 600, need: 900 }, // свободно перед дверью
  windowDepth: 400, // полоса перед окном
  windowTall: 800, // выше — «закрывает окно» (не ниже подоконника + 100)
});

const COFFEE = ['coffee-table', 'coffee-table-2', 'side-table', 'pouf', 'bar-table'];
const TV_KINDS = new Set(['tv', 'tv-stand']);
const Z = (side, norm, o = {}) => ({ side, norm, ...o });
const SIDES4 = (norm, o) => ['front', 'back', 'left', 'right'].map((s) => Z(s, norm, o));

// Профили предметов: вид → группа правил и зоны пользования.
//   side — сторона в локальных осях (front = +Y), span — доля стороны
//   (от «спинки» к «лицу» у боковых, слева направо у передней), flushOk —
//   вплотную к стене/мебели можно, ignore — виды, которые зону не нарушают.
const PROFILES = [
  { kinds: ['bed-double', 'bed-king', 'bed-queen', 'bed-single', 'bed-bunk'], group: 'bed', bed: true,
    zones: [Z('left', 'bedSide', { span: [0.25, 1], flushOk: true }), Z('right', 'bedSide', { span: [0.25, 1], flushOk: true }), Z('front', 'bedFoot', { flushOk: true, what: 'в ногах' })] },
  { kinds: ['kids-bed'], group: 'bed', bed: true,
    zones: [Z('left', 'kidsBed', { span: [0.25, 1], flushOk: true }), Z('right', 'kidsBed', { span: [0.25, 1], flushOk: true }), Z('front', 'kidsBed', { flushOk: true, what: 'в ногах' })] },
  { kinds: ['crib'], group: 'bed', zones: [Z('front', 'kidsBed', { what: 'спереди' })] },
  { kinds: ['wardrobe', 'wardrobe-corner', 'wardrobe-rack', 'coat-rack', 'display-cabinet', 'pantry'], group: 'storage', zones: [Z('front', 'wardrobe', { what: 'перед фасадом', twoWay: true })] },
  { kinds: ['wardrobe-sliding'], group: 'storage', zones: [Z('front', 'sliding', { what: 'перед фасадом', twoWay: true })] },
  { kinds: ['dresser', 'sideboard', 'chest', 'filing-cabinet', 'changing-table'], group: 'storage', zones: [Z('front', 'drawers', { what: 'перед ящиками', twoWay: true })] },
  { kinds: ['bookcase', 'shoe-bench', 'toy-box', 'console-table', 'tv-stand', 'aquarium', 'safe'], group: 'storage', zones: [Z('front', 'shelf', { what: 'спереди', twoWay: true })] },
  { kinds: ['sofa', 'sofa-2', 'sofa-corner', 'sofa-u', 'loveseat', 'sofa-bed', 'daybed'], group: 'passage', sofa: true,
    zones: [Z('front', 'sofa', { ignore: COFFEE, what: 'перед диваном' })] },
  { kinds: ['armchair', 'armchair-lounge', 'recliner'], group: 'passage', sofa: true, zones: [Z('front', 'armchair', { ignore: COFFEE, what: 'перед креслом' })] },
  { kinds: ['dining-table', 'dining-table-6', 'table-round', 'conference-table'], group: 'passage', zones: SIDES4('dining', { flushOk: true, what: 'за стулом' }) },
  { kinds: ['desk', 'desk-corner', 'desk-l', 'office-desk', 'kids-desk', 'dressing-table', 'piano', 'workbench'], group: 'passage', zones: [Z('front', 'desk', { what: 'за стулом' })] },
  { kinds: ['kitchen-row', 'kitchen-corner', 'kitchen-u', 'stove', 'cooktop-hood', 'sink', 'oven', 'dishwasher', 'fridge', 'fridge-side'], group: 'kitchen', zones: [Z('front', 'kitchen', { what: 'перед кухней' })] },
  { kinds: ['kitchen-island'], group: 'kitchen', zones: SIDES4('island', { flushOk: true, what: 'у острова' }) },
  { kinds: ['bar-counter'], group: 'kitchen', zones: [Z('front', 'bar', { what: 'перед стойкой' })] },
  { kinds: ['toilet', 'bidet'], group: 'bath', zones: [Z('front', 'toiletFront', { what: 'спереди' }), Z('left', 'toiletSide', { what: 'сбоку' }), Z('right', 'toiletSide', { what: 'сбоку' })] },
  { kinds: ['washbasin', 'washbasin-double', 'vanity-unit'], group: 'bath', zones: [Z('front', 'basin', { what: 'перед раковиной' })] },
  { kinds: ['bath', 'bath-corner', 'jacuzzi', 'shower'], group: 'bath', zones: [Z('front', 'bath', { what: 'у входа', twoWay: true })] },
  { kinds: ['urinal'], group: 'bath', zones: [Z('front', 'urinal', { what: 'спереди' })] },
  { kinds: ['washer', 'dryer'], group: 'bath', zones: [Z('front', 'laundry', { what: 'перед дверцей' })] },
];
const PROFILE = new Map(PROFILES.flatMap((p) => p.kinds.map((k) => [k, p])));
export const ergoProfile = (kind) => PROFILE.get(kind) || null;

// Таблица правил для отчёта и подсказок: [{ kinds, group, zones: [{ side, crit, need }] }].
export function ergoRulesTable() {
  return PROFILES.map((p) => ({
    kinds: [...p.kinds], group: p.group,
    zones: p.zones.map((z) => ({ side: z.side, what: z.what || 'проход', ...ERGO_NORMS[z.norm] })),
  }));
}

// ---------------------------------------------------------------- геометрия

const rad = (d) => ((d || 0) * Math.PI) / 180;
const title = (kind) => furnitureDef(kind)?.title || kind;
const round = (v) => Math.round(v);
const isChair = (kind) => furnitureDef(kind)?.cat === 'chairs';

// Рамка предмета/части: центр, размеры, поворот, зеркало.
function frame(x, y, w, h, rot, mirrored = false) {
  const r = rad(rot);
  return { cx: x, cy: y, w, h, c: Math.cos(r), s: Math.sin(r), m: mirrored ? -1 : 1 };
}
const toHouse = (f, lx, ly) => ({ x: f.cx + f.m * lx * f.c - ly * f.s, y: f.cy + f.m * lx * f.s + ly * f.c });

function rectPoly(f, round_ = false) {
  if (round_) {
    const out = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (i * Math.PI) / 6;
      out.push(toHouse(f, (Math.cos(a) * f.w) / 2, (Math.sin(a) * f.h) / 2));
    }
    return out;
  }
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toHouse(f, (a * f.w) / 2, (b * f.h) / 2));
}

function bboxOf(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}
const bboxHit = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// Пересечение многоугольника subject с выпуклым clip (Сазерленд — Ходжман).
function clipConvex(subject, clip) {
  const sign = polyArea(clip) >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i += 1) {
    const a = clip[i]; const b = clip[(i + 1) % clip.length];
    const side = (p) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j += 1) {
      const p = input[j]; const q = input[(j + 1) % input.length];
      const sp = side(p); const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}
const overlapArea = (a, b) => Math.abs(polyArea(clipConvex(a, b)));

function pointInConvex(poly, x, y) {
  let pos = false; let neg = false;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c > 1e-9) pos = true; else if (c < -1e-9) neg = true;
    if (pos && neg) return false;
  }
  return true;
}

function segDist2(px, py, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  const x = a.x + dx * t - px; const y = a.y + dy * t - py;
  return x * x + y * y;
}
function polyDist(poly, x, y) {
  if (pointInConvex(poly, x, y)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) best = Math.min(best, segDist2(x, y, poly[i], poly[(i + 1) % poly.length]));
  return Math.sqrt(best);
}

// ---------------------------------------------------------------- предметы

// Высота верха предмета/части, мм (core/furniture3d.js).
function topOf(kind, layer) {
  const spec = furniture3d(kind, layer);
  return { top: (spec.z0 || 0) + (spec.h || 0), z0: spec.z0 || 0, h: spec.h || 0 };
}

// Стоит ли предмет на полу (мешает проходу): подвесные (низ ≥ 700) и
// плоские (ковёр, коврик) — нет; стулья двигаются — не препятствие.
function onFloor(kind) {
  if (isChair(kind)) return false;
  const t = topOf(kind);
  return t.z0 < 700 && t.h > 30;
}

// Части предмета на полу как рамки: составной — по частям (диван,
// кухня — нижний ряд), стол со стульями — столешница (стулья двигаются).
function itemFrames(item) {
  const own = frame(item.x, item.y, item.w, item.h, item.rotation, item.mirrored);
  if (!isFixedSizeComp(item)) return [{ f: own, kind: item.kind, round: isRoundItem(item.kind) || item.kind === 'table-round' }];
  const parts = compositeParts(item).filter((p) => p.layer !== 'upper');
  if (!parts.length) return [{ f: own, kind: item.kind }];
  return parts.map((p) => {
    // Часть в осях предмета (зеркало — по X), затем поворот предмета.
    const c = toHouse(own, p.x, p.y);
    const rot = (item.mirrored ? -(p.rotation || 0) : (p.rotation || 0)) + (item.rotation || 0);
    return { f: frame(c.x, c.y, p.w, p.h, rot, item.mirrored), kind: p.kind, part: p };
  });
}

// Рамки зон пользования: у дивана — сиденья (одинаково повёрнутые и
// одинаковой глубины — одной рамкой), у кухни — нижний ряд по сторонам.
function zoneFrames(item) {
  if (!isFixedSizeComp(item)) return [frame(item.x, item.y, item.w, item.h, item.rotation, item.mirrored)];
  const frames = itemFrames(item).filter((q) => {
    const k = String(q.kind);
    if (k.startsWith('sofa:')) return ['sofa:seat', 'sofa:chaise'].includes(k);
    return k.startsWith('kitchen:');
  });
  const groups = new Map();
  for (const q of frames) {
    const ang = Math.round(Math.atan2(q.f.s, q.f.c) * 180 / Math.PI);
    const key = `${(ang + 360) % 360}:${Math.round(q.f.h)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q.f);
  }
  const out = [];
  for (const list of groups.values()) {
    // Объединение частей в осях первой части (+ глубина общая).
    const f0 = list[0];
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const f of list) {
      for (const p of rectPoly(f)) {
        const dx = p.x - f0.cx; const dy = p.y - f0.cy;
        const u = dx * f0.c + dy * f0.s; const v = -dx * f0.s + dy * f0.c;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
    }
    const cu = (u0 + u1) / 2; const cv = (v0 + v1) / 2;
    out.push({ cx: f0.cx + cu * f0.c - cv * f0.s, cy: f0.cy + cu * f0.s + cv * f0.c, w: u1 - u0, h: v1 - v0, c: f0.c, s: f0.s, m: 1 });
  }
  return out.sort((a, b) => b.w - a.w);
}

// Сторона рамки: начало O (середина), наружная нормаль n, касательная t,
// полудлина L (вдоль t).
function sideGeom(f, side) {
  const lx = { x: f.m * f.c, y: f.m * f.s }; // локальная ось X в осях дома
  const ly = { x: -f.s, y: f.c }; // локальная ось Y (лицо)
  if (side === 'front') return { O: toHouse(f, 0, f.h / 2), n: ly, t: lx, L: f.w / 2 };
  if (side === 'back') return { O: toHouse(f, 0, -f.h / 2), n: { x: -ly.x, y: -ly.y }, t: lx, L: f.w / 2 };
  if (side === 'left') return { O: toHouse(f, -f.w / 2, 0), n: { x: -lx.x, y: -lx.y }, t: ly, L: f.h / 2 };
  return { O: toHouse(f, f.w / 2, 0), n: lx, t: ly, L: f.h / 2 };
}

// Направление на плане по нормали (оси дома, Y вниз).
function dirWord(n) {
  if (Math.abs(n.x) >= Math.abs(n.y)) return n.x > 0 ? 'справа' : 'слева';
  return n.y > 0 ? 'снизу' : 'сверху';
}

// ---------------------------------------------------------------- контекст

// Двери и окна этажа: геометрия считается один раз на проект (стены те же).
export function ergoContext(project, walls) {
  const doors = [];
  const windows = [];
  for (const o of project.openings || []) {
    if (o.kind !== 'door' && o.kind !== 'window') continue;
    const placed = openingRect(project, o, walls);
    if (!placed) continue;
    const entry = { opening: o, rect: placed.rect, orient: placed.wall.orient };
    if (o.kind === 'door') {
      const required = Array.isArray(o.requiredLeafIndices)
        ? new Set(o.requiredLeafIndices.filter((index) => Number.isInteger(index) && index >= 0))
        : null;
      entry.leaves = doorLeaves(project, o, walls)
        .flatMap((leaf, leafIndex) => (required && !required.has(leafIndex) ? [] : [sectorOf(leaf)]));
      doors.push(entry);
    } else windows.push(entry);
  }
  return { doors, windows };
}

// Сектор открывания створки (+ запас doorPad): многоугольник с вершиной в петле.
function sectorOf(leaf) {
  const { hinge, closed, open } = leaf;
  const r = Math.hypot(closed.x - hinge.x, closed.y - hinge.y) + ERGO_NORMS.doorPad;
  const a1 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
  const a2 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const pts = [{ x: hinge.x, y: hinge.y }];
  for (let i = 0; i <= 8; i += 1) {
    const a = a1 + (d * i) / 8;
    pts.push({ x: hinge.x + Math.cos(a) * r, y: hinge.y + Math.sin(a) * r });
  }
  return { poly: pts, hinge, through: leaf.through, r, a1, d };
}

// Грань проёма, обращённая в комнату: { O, n, t, L } или null.
function openingFace(entry, inside) {
  const { rect, orient } = entry;
  const h = orient === 'h' || (orient !== 'v' && rect.w >= rect.h);
  const cx = rect.x + rect.w / 2; const cy = rect.y + rect.h / 2;
  const faces = h
    ? [{ O: { x: cx, y: rect.y + rect.h }, n: { x: 0, y: 1 } }, { O: { x: cx, y: rect.y }, n: { x: 0, y: -1 } }]
    : [{ O: { x: rect.x + rect.w, y: cy }, n: { x: 1, y: 0 } }, { O: { x: rect.x, y: cy }, n: { x: -1, y: 0 } }];
  for (const f of faces) {
    if (inside(f.O.x + f.n.x * 60, f.O.y + f.n.y * 60)) {
      return { ...f, t: h ? { x: 1, y: 0 } : { x: 0, y: 1 }, L: (h ? rect.w : rect.h) / 2 };
    }
  }
  return null;
}

// ---------------------------------------------------------------- замер зазора

// Полоса [u0, u1] × [0, maxD] в осях стороны (O, t, n); ближайшее препятствие.
// → { gap, u, ob } (gap = Infinity — свободно до maxD).
function probe(O, t, n, u0, u1, maxD, obstacles, skip) {
  const corners = [[u0, 0], [u1, 0], [u1, maxD], [u0, maxD]].map(([u, d]) => ({ x: O.x + t.x * u + n.x * d, y: O.y + t.y * u + n.y * d }));
  const box = bboxOf(corners);
  let best = { gap: Infinity, u: (u0 + u1) / 2, ob: null };
  const local = (p) => {
    const dx = p.x - O.x; const dy = p.y - O.y;
    return { u: dx * t.x + dy * t.y, d: dx * n.x + dy * n.y };
  };
  for (const ob of obstacles) {
    if (skip && skip(ob)) continue;
    if (!bboxHit(box, ob.bbox)) continue;
    const pts = ob.seg ? ob.seg.map(local) : ob.poly.map(local);
    const clipped = ob.seg ? clipSegment(pts[0], pts[1], u0, u1, maxD) : clipBox(pts, u0, u1, maxD);
    for (const p of clipped) {
      if (p.d < best.gap) best = { gap: Math.max(0, p.d), u: p.u, ob };
    }
  }
  return best;
}

// Выпуклый многоугольник (в осях u, d) ∩ прямоугольник [u0,u1]×[0,maxD].
function clipBox(pts, u0, u1, maxD) {
  let out = pts;
  const planes = [(p) => p.u - u0, (p) => u1 - p.u, (p) => p.d, (p) => maxD - p.d];
  for (const f of planes) {
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j += 1) {
      const p = input[j]; const q = input[(j + 1) % input.length];
      const sp = f(p); const sq = f(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const k = sp / (sp - sq);
        out.push({ u: p.u + (q.u - p.u) * k, d: p.d + (q.d - p.d) * k });
      }
    }
    if (!out.length) break;
  }
  return out;
}

// Отрезок (Лян — Барски) ∩ прямоугольник → концы внутри.
function clipSegment(a, b, u0, u1, maxD) {
  let t0 = 0; let t1 = 1;
  const du = b.u - a.u; const dd = b.d - a.d;
  const checks = [[-du, a.u - u0], [du, u1 - a.u], [-dd, a.d], [dd, maxD - a.d]];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return []; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return []; if (r > t0) t0 = r; } else { if (r < t0) return []; if (r < t1) t1 = r; }
  }
  return [{ u: a.u + du * t0, d: a.d + dd * t0 }, { u: a.u + du * t1, d: a.d + dd * t1 }];
}

// ---------------------------------------------------------------- проходимость

// Точное евклидово преобразование расстояний (Фельценшвальб — Хуттенлохер),
// квадраты расстояний в клетках. f: 0 — источник, Infinity — нет.
function edt(f, cols, rows) {
  const INF = 1e20;
  const out = new Float64Array(cols * rows);
  const n = Math.max(cols, rows);
  const d = new Float64Array(n); const v = new Int32Array(n); const z = new Float64Array(n + 1); const g = new Float64Array(n);
  const pass = (get, set, len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q += 1) {
      let s;
      for (;;) {
        s = ((get(q) + q * q) - (get(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s <= z[k] && k > 0) k -= 1; else break;
      }
      if (s <= z[k]) { k = 0; v[0] = q; z[0] = -INF; z[1] = INF; continue; }
      k += 1; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q += 1) {
      while (z[k + 1] < q) k += 1;
      const dq = q - v[k];
      d[q] = dq * dq + get(v[k]);
    }
    for (let q = 0; q < len; q += 1) set(q, d[q]);
  };
  for (let x = 0; x < cols; x += 1) {
    pass((q) => (f[q * cols + x] ? INF : 0), (q, val) => { out[q * cols + x] = val; }, rows);
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) g[x] = out[y * cols + x];
    pass((q) => g[q], (q, val) => { out[y * cols + q] = val; }, cols);
  }
  return out;
}
// Обёртка: src[i] = 1 — источник (расстояние 0).
function distanceFrom(src, cols, rows) {
  const f = new Uint8Array(cols * rows);
  for (let i = 0; i < f.length; i += 1) f[i] = src[i] ? 0 : 1;
  return edt(f, cols, rows);
}

// Сетка комнаты: свободные клетки, расстояния, классы ширины прохода.
function passGrid(room, inside, floorPolys, cellMm = ERGO_CELL) {
  const C = Math.max(25, Math.round(Number(cellMm) || ERGO_CELL));
  // Сетка с полями в одну клетку: поля — «стена».
  const x0 = room.x - C; const y0 = room.y - C;
  const cols = Math.ceil(room.w / C) + 2; const rows = Math.ceil(room.h / C) + 2;
  const free = new Uint8Array(cols * rows);
  for (let y = 1; y < rows - 1; y += 1) {
    const cy = y0 + (y + 0.5) * C;
    for (let x = 1; x < cols - 1; x += 1) {
      const cx = x0 + (x + 0.5) * C;
      if (cx < room.x + room.w && cy < room.y + room.h && inside(cx, cy)) free[y * cols + x] = 1;
    }
  }
  for (const poly of floorPolys) {
    const b = bboxOf(poly);
    const xa = Math.max(1, Math.floor((b.x0 - x0) / C)); const xb = Math.min(cols - 2, Math.ceil((b.x1 - x0) / C));
    const ya = Math.max(1, Math.floor((b.y0 - y0) / C)); const yb = Math.min(rows - 2, Math.ceil((b.y1 - y0) / C));
    for (let y = ya; y <= yb; y += 1) {
      for (let x = xa; x <= xb; x += 1) {
        const i = y * cols + x;
        if (free[i] && pointInConvex(poly, x0 + (x + 0.5) * C, y0 + (y + 0.5) * C)) free[i] = 0;
      }
    }
  }
  const blocked = new Uint8Array(free.length);
  for (let i = 0; i < free.length; i += 1) blocked[i] = free[i] ? 0 : 1;
  const d2 = distanceFrom(blocked, cols, rows); // до препятствия, клетки²
  const fits = (R) => {
    const r2 = (R / C) ** 2;
    const s = new Uint8Array(free.length);
    for (let i = 0; i < s.length; i += 1) s[i] = free[i] && d2[i] >= r2 - 1e-9 ? 1 : 0;
    return s;
  };
  const s300 = fits(ERGO_NORMS.passage.crit / 2);
  const s400 = fits(ERGO_NORMS.passage.need / 2);
  return { x0, y0, cols, rows, cell: C, free, d2, s300, s400 };
}

// Единая сетка свободного пола для аналитических маршрутов. Она использует
// те же точные контуры сложных помещений и повёрнутой/составной мебели, что
// и основной анализ эргономики. Ширина в clearanceMm — расчётный диаметр
// свободного пространства в центре клетки, а не нормативный обмер.
export function buildRoomWalkGrid(project, room, walls = [], { cellMm = ERGO_CELL } = {}) {
  const partition = project?.settings?.partition || DEFAULT_PARTITION;
  const children = (project?.rooms || []).filter((candidate) => candidate.parentId === room.id);
  const inside = (x, y) => roomContainsPoint(room, x, y)
    && !children.some((child) => roomContainsPoint(child, x, y));
  const floorPolys = [];
  const obstacles = [];
  const addObstacle = (polygon, meta) => {
    floorPolys.push(polygon);
    obstacles.push({ ...meta, polygon, bounds: bboxOf(polygon) });
  };
  for (const child of children) {
    // roomRects — точное неперекрывающееся разложение Г-/П-контура. Рост
    // каждой части добавляет стену вокруг помещения, не закрывая целиком
    // свободную вогнутую часть его bbox.
    for (const part of roomRects(child)) {
      const rect = {
        x: part.x - partition,
        y: part.y - partition,
        w: part.w + partition * 2,
        h: part.h + partition * 2,
      };
      addObstacle([
        { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
      ], { kind: 'nested_room', id: child.id });
    }
  }
  const wallId = (wall) => wall?.wallId || wall?.id || wall?.key || null;
  const doorCuts = (project?.openings || []).filter((opening) => opening.kind === 'door')
    .map((opening) => openingRect(project, opening, walls))
    .filter(Boolean)
    .map((placed) => ({ wallId: wallId(placed.wall), rect: placed.rect }));
  const subtractRect = (base, cut) => {
    const x0 = Math.max(base.x, cut.x); const y0 = Math.max(base.y, cut.y);
    const x1 = Math.min(base.x + base.w, cut.x + cut.w);
    const y1 = Math.min(base.y + base.h, cut.y + cut.h);
    if (x1 <= x0 || y1 <= y0) return [base];
    return [
      { x: base.x, y: base.y, w: base.w, h: y0 - base.y },
      { x: base.x, y: y1, w: base.w, h: base.y + base.h - y1 },
      { x: base.x, y: y0, w: x0 - base.x, h: y1 - y0 },
      { x: x1, y: y0, w: base.x + base.w - x1, h: y1 - y0 },
    ].filter((rect) => rect.w > 1e-6 && rect.h > 1e-6);
  };
  for (const wall of walls || []) {
    if (wall.hidden || (wall.kind !== 'manual' && wall.source !== 'manual')) continue;
    let parts = wallRects(wall);
    for (const cut of doorCuts) {
      if (cut.wallId && cut.wallId === wallId(wall)) parts = parts.flatMap((part) => subtractRect(part, cut.rect));
    }
    for (const rect of parts) {
      addObstacle([
        { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
      ], { kind: 'wall', id: wallId(wall) });
    }
  }
  // Проём в перекрытии — не пол. В том числе учитываем автоматически
  // выведенные проёмы над лестницами; межэтажный коннектор проверяется
  // отдельно и не даёт обычному маршруту пройти через пустоту.
  for (const opening of slabOpenings(project, project?.activeLevel)) {
    for (const rect of slabOpeningCutRects(opening, Math.max(25, Number(cellMm) || ERGO_CELL))) {
      addObstacle([
        { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
      ], { kind: 'slab_opening', id: opening.id });
    }
  }
  const itemIds = [];
  for (const item of itemsInRoom(project, room)) {
    // Для общего анализа эргономики отдельный стул считается подвижным, но
    // точный маршрут не должен рисоваться сквозь его текущее положение.
    if (!onFloor(item.kind) && !isChair(item.kind) && !isFixedSizeComp(item)) continue;
    itemIds.push(item.id);
    const frames = itemFrames(item);
    // Dining-композит не fixed-size: itemFrames уже содержит столешницу,
    // а видимые стулья добавляем по их точным трансформированным частям.
    if (item?.comp?.type === 'dining') {
      const own = frame(item.x, item.y, item.w, item.h, item.rotation, item.mirrored);
      for (const part of compositeParts(item)) {
        const center = toHouse(own, part.x, part.y);
        const rotation = (item.mirrored ? -(part.rotation || 0) : (part.rotation || 0))
          + (item.rotation || 0);
        frames.push({
          f: frame(center.x, center.y, part.w, part.h, rotation, item.mirrored),
          kind: part.kind,
        });
      }
    }
    for (const entry of frames) {
      addObstacle(rectPoly(entry.f, entry.round), { kind: 'item', id: item.id });
    }
  }
  const grid = passGrid(room, inside, floorPolys, cellMm);
  const boundary = roomPolygon(room);
  const clearanceMm = new Uint16Array(grid.free.length);
  for (let index = 0; index < clearanceMm.length; index += 1) {
    if (!grid.free[index]) continue;
    const x = grid.x0 + ((index % grid.cols) + 0.5) * grid.cell;
    const y = grid.y0 + (Math.floor(index / grid.cols) + 0.5) * grid.cell;
    let radius2 = Infinity;
    for (let edge = 0; edge < boundary.length; edge += 1) {
      radius2 = Math.min(radius2, segDist2(x, y, boundary[edge], boundary[(edge + 1) % boundary.length]));
    }
    let radius = Math.sqrt(radius2);
    for (const polygon of floorPolys) radius = Math.min(radius, polyDist(polygon, x, y));
    clearanceMm[index] = Math.min(65535, Math.max(0, Math.floor(radius * 2)));
  }
  return {
    roomId: room.id,
    ...grid,
    clearanceMm,
    obstaclePolygons: floorPolys,
    obstacles,
    containsPoint: inside,
    roomBoundary: boundary,
    itemIds,
  };
}

// Классы ширины прохода свободных клеток: 1 — уже 600, 2 — 600–800, 3 — норма.
function heatClasses(g) {
  const { cols, rows, cell, free, s300, s400 } = g;
  const c300 = distanceFrom(s300, cols, rows);
  const c400 = distanceFrom(s400, cols, rows);
  const r3 = (ERGO_NORMS.passage.crit / 2 / cell) ** 2;
  const r4 = (ERGO_NORMS.passage.need / 2 / cell) ** 2;
  const cls = new Uint8Array(cols * rows);
  for (let i = 0; i < cls.length; i += 1) {
    if (!free[i]) continue;
    cls[i] = c400[i] <= r4 + 1e-9 ? 3 : c300[i] <= r3 + 1e-9 ? 2 : 1;
  }
  // Углы и пристенок: круг «человека» в угол не влезает, но место у стены
  // рядом с нормальным проходом (до 250 мм) — тоже норма, без красных уголков.
  const near = (250 / cell) ** 2;
  for (const k of [3, 2]) {
    const src = new Uint8Array(cls.length);
    for (let i = 0; i < cls.length; i += 1) src[i] = cls[i] >= k ? 1 : 0;
    const dk = distanceFrom(src, cols, rows);
    for (let i = 0; i < cls.length; i += 1) if (free[i] && cls[i] < k && g.d2[i] <= near && dk[i] <= near) cls[i] = k;
  }
  return cls;
}

// Поиск в ширину по клеткам mask от затравок.
function flood(g, mask, seeds) {
  const { cols, rows } = g;
  const seen = new Uint8Array(cols * rows);
  const queue = [];
  for (const i of seeds) if (mask[i] && !seen[i]) { seen[i] = 1; queue.push(i); }
  while (queue.length) {
    const i = queue.pop();
    const x = i % cols; const y = (i / cols) | 0;
    if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue.push(i - 1); }
    if (x < cols - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue.push(i + 1); }
    if (y > 0 && mask[i - cols] && !seen[i - cols]) { seen[i - cols] = 1; queue.push(i - cols); }
    if (y < rows - 1 && mask[i + cols] && !seen[i + cols]) { seen[i + cols] = 1; queue.push(i + cols); }
  }
  return seen;
}

function cellsIn(g, poly) {
  const { x0, y0, cols, rows, cell } = g;
  const b = bboxOf(poly);
  const out = [];
  const xa = Math.max(0, Math.floor((b.x0 - x0) / cell)); const xb = Math.min(cols - 1, Math.ceil((b.x1 - x0) / cell));
  const ya = Math.max(0, Math.floor((b.y0 - y0) / cell)); const yb = Math.min(rows - 1, Math.ceil((b.y1 - y0) / cell));
  for (let y = ya; y <= yb; y += 1) {
    for (let x = xa; x <= xb; x += 1) {
      if (pointInConvex(poly, x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell)) out.push(y * cols + x);
    }
  }
  return out;
}

// Дотягивается ли человек (клетки seen) до многоугольника: центр не дальше reach.
function reaches(g, seen, polys, reach) {
  const { x0, y0, cols, rows, cell } = g;
  for (const poly of polys) {
    const b = bboxOf(poly);
    const xa = Math.max(0, Math.floor((b.x0 - reach - x0) / cell)); const xb = Math.min(cols - 1, Math.ceil((b.x1 + reach - x0) / cell));
    const ya = Math.max(0, Math.floor((b.y0 - reach - y0) / cell)); const yb = Math.min(rows - 1, Math.ceil((b.y1 + reach - y0) / cell));
    for (let y = ya; y <= yb; y += 1) {
      for (let x = xa; x <= xb; x += 1) {
        if (seen[y * cols + x] && polyDist(poly, x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell) <= reach) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- анализ комнаты

const SEV_RANK = { error: 2, warn: 1, ok: 0 };
// Норма сравнивается с зазором, округлённым до мм (599,99 — это 600);
// «тесно» — если не хватает больше ERGO_TOLERANCE (198 при норме 200 — норма).
const sevOf = (gap, crit, need) => { const g = Math.round(gap); return g < crit ? 'error' : g < need - ERGO_TOLERANCE ? 'warn' : 'ok'; };
const fmtM = (mm) => (mm / 1000).toFixed(1).replace('.', ',');

/**
 * Эргономика одной комнаты. → { roomId, findings, okZones, heat, triangle }.
 * ctx — ergoContext(project, walls) (двери и окна; иначе посчитается).
 * opts.heat — посчитать классы проходимости (тепловая карта; дольше).
 */
export function analyzeRoomErgonomics(project, room, walls, ctx = null, opts = {}) {
  const out = { roomId: room.id, findings: [], okZones: [], heat: null, triangle: null };
  const items = itemsInRoom(project, room);
  if (!items.length) return out;
  const c = ctx || ergoContext(project, walls);
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const children = project.rooms.filter((r) => r.parentId === room.id);
  const inside = (x, y) => roomContainsPoint(room, x, y) && !children.some((ch) => roomContainsPoint(ch, x, y));

  // Препятствия: стены комнаты (рёбра контура), вложенные помещения, мебель на полу.
  const obstacles = [];
  const rp = roomPolygon(room);
  rp.forEach((a, i) => {
    const b = rp[(i + 1) % rp.length];
    obstacles.push({ type: 'wall', seg: [a, b], bbox: bboxOf([a, b]) });
  });
  for (const ch of children) {
    const r = nestedOuterRect(ch, partition);
    const poly = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
    obstacles.push({ type: 'room', poly, bbox: bboxOf(poly), name: ch.name });
  }
  const shapes = new Map(); // id → [{ poly, kind, top }]
  for (const item of items) {
    const list = itemFrames(item).map((q) => {
      const poly = rectPoly(q.f, q.round);
      const kind = q.part ? item.kind : q.kind;
      const t = q.part ? topOf(q.kind, q.part.layer) : topOf(item.kind);
      return { poly, kind, top: t.top };
    });
    shapes.set(item.id, list);
    if (!onFloor(item.kind) && !isFixedSizeComp(item)) continue;
    for (const s of list) obstacles.push({ type: 'item', itemId: item.id, kind: item.kind, poly: s.poly, bbox: bboxOf(s.poly) });
  }
  const byId = new Map(items.map((it) => [it.id, it]));
  const findings = [];
  const okZones = out.okZones;
  const obName = (ob) => (!ob ? '' : ob.type === 'wall' ? ' до стены' : ob.type === 'room' ? ` до «${ob.name}»` : ` до «${title(ob.kind)}»`);

  // --- Зоны пользования предметов.
  for (const item of items) {
    const prof = ergoProfile(item.kind);
    if (!prof) continue;
    const frames = zoneFrames(item);
    const flushSides = [];
    frames.forEach((f, fi) => {
      for (const z of prof.zones) {
        const norm = ERGO_NORMS[z.norm];
        const [s0, s1] = z.span || [0, 1];
        const inset = 30;
        const ignore = z.ignore ? new Set(z.ignore) : null;
        const skip = (ob) => ob.itemId === item.id || (ignore && ob.type === 'item' && ignore.has(ob.kind));
        const measure = (side) => {
          const geo = sideGeom(f, side);
          let a0 = -geo.L + 2 * geo.L * s0 + inset; let a1 = -geo.L + 2 * geo.L * s1 - inset;
          let hit = a1 > a0 ? probe(geo.O, geo.t, geo.n, a0, a1, norm.need + 50, obstacles, skip) : null;
          // Угол Г-образной кухни или шкафов: соседний предмет той же группы
          // встал вплотную у края фасада — угловая зона, фасад меряется дальше.
          for (let k = 0; k < 2 && hit?.ob?.type === 'item' && hit.gap <= ERGO_FLUSH + 20
            && (prof.group === 'kitchen' || prof.group === 'storage') && ergoProfile(hit.ob.kind)?.group === prof.group; k += 1) {
            const us = hit.ob.poly.map((p) => (p.x - geo.O.x) * geo.t.x + (p.y - geo.O.y) * geo.t.y);
            const lo = Math.min(...us); const hi = Math.max(...us);
            if (lo <= a0 + 10) a0 = hi + 10; else if (hi >= a1 - 10) a1 = lo - 10; else break;
            hit = a1 - a0 > 100 ? probe(geo.O, geo.t, geo.n, a0, a1, norm.need + 50, obstacles, skip) : { gap: Infinity, u: 0, ob: null };
          }
          return { g: geo, u0: a0, u1: a1, hit };
        };
        let m = measure(z.side);
        // Шкаф, комод, ванна рисуются симметрично — «лицо» не видно: если
        // сзади свободнее, чем спереди, — лицом считается задняя сторона.
        if (z.twoWay && m.hit && m.hit.gap < norm.need) {
          const back = measure('back');
          if (back.hit && back.hit.gap > m.hit.gap) m = back;
        }
        const { g, u0, u1, hit } = m;
        if (!hit) continue;
        const P = (u, d) => ({ x: g.O.x + g.t.x * u + g.n.x * d, y: g.O.y + g.t.y * u + g.n.y * d });
        const zone = [P(u0, 0), P(u1, 0), P(u1, norm.need), P(u0, norm.need)];
        const key = `${item.id}:${fi}:${z.side}`;
        if (z.flushOk && hit.gap <= ERGO_FLUSH) { flushSides.push(z.side); continue; }
        const sev = sevOf(hit.gap, norm.crit, norm.need);
        if (sev === 'ok') { okZones.push({ zone, itemIds: [item.id], rule: 'zone', group: prof.group }); continue; }
        const gap = round(hit.gap);
        const what = z.what ? (z.side === 'left' || z.side === 'right' ? `${z.what} ${dirWord(g.n)}` : z.what) : `проход ${dirWord(g.n)}`;
        const a = P(hit.u, 0); const b = P(hit.u, hit.gap);
        findings.push({
          id: `ergo:zone:${room.id}:${key}`, severity: sev, rule: 'zone', group: prof.group, roomId: room.id,
          itemIds: hit.ob?.itemId ? [item.id, hit.ob.itemId] : [item.id],
          text: `«${title(item.kind)}»: ${what} ${gap} мм${obName(hit.ob)}, нужно ≥ ${norm.need}`,
          gap, need: norm.need, crit: norm.crit, zone,
          band: gap > 0 ? [P(u0, 0), P(u1, 0), P(u1, hit.gap), P(u0, hit.gap)] : null,
          dim: gap > 0 ? { a, b } : null,
          labelAt: gap > 0 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : P((u0 + u1) / 2, norm.need / 2),
          label: `${gap} < ${norm.need}`,
          fix: { itemId: item.id, n: g.n, gap: hit.gap, need: norm.need, flushOk: Boolean(z.flushOk), side: z.side },
          pairKey: hit.ob?.itemId ? [item.id, hit.ob.itemId].sort().join('|') : null,
        });
      }
    });
    // Кровать: хотя бы один бок свободен.
    if (prof.bed && flushSides.includes('left') && flushSides.includes('right')) {
      const poly = shapes.get(item.id)[0].poly;
      const ctr = { x: item.x, y: item.y };
      findings.push({
        id: `ergo:bed:${room.id}:${item.id}`, severity: 'error', rule: 'bed', group: 'bed', roomId: room.id, itemIds: [item.id],
        text: `«${title(item.kind)}»: к кровати не подойти сбоку — оба бока вплотную`,
        gap: 0, need: ERGO_NORMS.bedSide.need, crit: ERGO_NORMS.bedSide.crit, zone: poly, band: null, dim: null,
        labelAt: ctr, label: `0 < ${ERGO_NORMS.bedSide.need}`,
      });
    }
    // Диван/кресло: журнальный столик и ТВ впереди.
    if (prof.sofa && frames.length) {
      const g = sideGeom(frames[0], 'front');
      const u0 = -g.L * 0.6; const u1 = g.L * 0.6;
      const coffee = probe(g.O, g.t, g.n, u0, u1, 1200, obstacles, (ob) => ob.type !== 'item' || ob.itemId === item.id || !COFFEE.includes(ob.kind));
      if (Number.isFinite(coffee.gap) && coffee.ob.kind !== 'pouf') {
        const nm = ERGO_NORMS.sofaTable;
        const gap = round(coffee.gap);
        if (gap < nm.min || gap > nm.max) {
          const P = (u, d) => ({ x: g.O.x + g.t.x * u + g.n.x * d, y: g.O.y + g.t.y * u + g.n.y * d });
          const a = P(coffee.u, 0); const b = P(coffee.u, coffee.gap);
          findings.push({
            id: `ergo:coffee:${room.id}:${item.id}:${coffee.ob.itemId}`, severity: 'warn', rule: 'coffee', group: 'passage', roomId: room.id,
            itemIds: [item.id, coffee.ob.itemId],
            text: `«${title(item.kind)}» ↔ «${title(coffee.ob.kind)}»: ${gap} мм, удобно 350–450`,
            gap, need: 350, crit: nm.min, zone: [P(u0, 0), P(u1, 0), P(u1, Math.max(gap, 450)), P(u0, Math.max(gap, 450))],
            band: gap > 0 ? [P(u0, 0), P(u1, 0), P(u1, coffee.gap), P(u0, coffee.gap)] : null,
            dim: gap > 0 ? { a, b } : null, labelAt: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            label: gap < nm.min ? `${gap} < 350` : `${gap} > 450`,
          });
        }
      }
      // ТВ: по всем предметам комнаты (телевизор висит на стене — не препятствие).
      const tvObs = items.filter((it) => TV_KINDS.has(it.kind)).flatMap((it) => shapes.get(it.id).map((s) => ({ type: 'item', itemId: it.id, kind: it.kind, poly: s.poly, bbox: bboxOf(s.poly) })));
      if (tvObs.length) {
        const tv = probe(g.O, g.t, g.n, -g.L, g.L, 6000, tvObs, null);
        if (Number.isFinite(tv.gap)) {
          const nm = ERGO_NORMS.tv;
          const gap = round(tv.gap);
          if (gap < nm.min || gap > nm.max) {
            const P = (u, d) => ({ x: g.O.x + g.t.x * u + g.n.x * d, y: g.O.y + g.t.y * u + g.n.y * d });
            const a = P(tv.u, 0); const b = P(tv.u, tv.gap);
            findings.push({
              id: `ergo:tv:${room.id}:${item.id}:${tv.ob.itemId}`, severity: 'warn', rule: 'tv', group: 'passage', roomId: room.id,
              itemIds: [item.id, tv.ob.itemId],
              text: `«${title(item.kind)}» ↔ ТВ: ${fmtM(gap)} м, удобно 1,5–4 м`,
              gap, need: nm.min, crit: nm.min, zone: null, band: null, dim: { a, b }, labelAt: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
              label: gap < nm.min ? `${gap} < ${nm.min}` : `${gap} > ${nm.max}`,
            });
          }
        }
      }
    }
  }

  // --- Пересечение мебели с мебелью (стул под столом и ковёр — можно).
  const solid = items.filter((it) => (onFloor(it.kind) || isFixedSizeComp(it)) && !isStructural(it.kind));
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const A = shapes.get(solid[i].id); const B = shapes.get(solid[j].id);
      let area = 0;
      for (const a of A) for (const b of B) if (bboxHit(bboxOf(a.poly), bboxOf(b.poly))) area += overlapArea(a.poly, b.poly);
      const areaOf = (L) => L.reduce((s, q) => s + Math.abs(polyArea(q.poly)), 0);
      if (area > 0.02 * Math.min(areaOf(A), areaOf(B)) && area > 1e4) {
        const zone = clipConvex(A[0].poly, B[0].poly);
        const at = zone.length ? { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, y: zone.reduce((s, p) => s + p.y, 0) / zone.length } : { x: solid[i].x, y: solid[i].y };
        findings.push({
          id: `ergo:overlap:${room.id}:${[solid[i].id, solid[j].id].sort().join('|')}`, severity: 'error', rule: 'overlap', group: 'passage', roomId: room.id,
          itemIds: [solid[i].id, solid[j].id],
          text: `«${title(solid[i].kind)}» и «${title(solid[j].kind)}» пересекаются`,
          gap: 0, need: 0, crit: 0, zone: zone.length > 2 ? zone : null, band: null, dim: null, labelAt: at, label: '✕',
        });
      }
    }
  }

  // --- Двери: зона открывания и место перед дверью.
  const floorObs = obstacles.filter((ob) => ob.type === 'item');
  for (const door of c.doors) {
    let swingHit = false;
    for (const [li, leaf] of door.leaves.entries()) {
      if (!inside(leaf.through.x, leaf.through.y)) continue;
      const lb = bboxOf(leaf.poly);
      const hitIds = new Set();
      for (const ob of floorObs) {
        if (hitIds.has(ob.itemId) || !bboxHit(lb, ob.bbox)) continue;
        if (overlapArea(ob.poly, leaf.poly) > 1e4) hitIds.add(ob.itemId);
      }
      for (const id of hitIds) {
        swingHit = true;
        const it = byId.get(id);
        findings.push({
          id: `ergo:door:${room.id}:${door.opening.id}:${li}:${id}`, severity: 'error', rule: 'door', group: 'doors', roomId: room.id,
          itemIds: [id], doorId: door.opening.id,
          text: `«${title(it.kind)}» мешает открыть дверь`,
          gap: 0, need: 0, crit: 0, zone: leaf.poly, sector: leaf, band: null, dim: null,
          labelAt: { x: leaf.hinge.x + (leaf.through.x - leaf.hinge.x) * 0.6, y: leaf.hinge.y + (leaf.through.y - leaf.hinge.y) * 0.6 },
          label: '⛔ дверь',
        });
      }
      if (!hitIds.size) okZones.push({ zone: leaf.poly, itemIds: [], rule: 'door', group: 'doors', sector: leaf });
    }
    if (swingHit) continue;
    const face = openingFace(door, inside);
    if (!face) continue;
    const nm = ERGO_NORMS.doorFront;
    const u0 = -face.L + 30; const u1 = face.L - 30;
    if (u1 <= u0) continue;
    // Только мебель: вложенное помещение у двери — это его собственная стена.
    const hit = probe(face.O, face.t, face.n, u0, u1, nm.need + 50, obstacles, (ob) => ob.type !== 'item');
    const sev = sevOf(hit.gap, nm.crit, nm.need);
    const P = (u, d) => ({ x: face.O.x + face.t.x * u + face.n.x * d, y: face.O.y + face.t.y * u + face.n.y * d });
    const zone = [P(u0, 0), P(u1, 0), P(u1, nm.need), P(u0, nm.need)];
    if (sev === 'ok') { okZones.push({ zone, itemIds: [], rule: 'door-front', group: 'doors' }); continue; }
    const gap = round(hit.gap);
    const a = P(hit.u, 0); const b = P(hit.u, hit.gap);
    const what = hit.ob?.type === 'item' ? `«${title(hit.ob.kind)}»` : `«${hit.ob?.name || 'помещение'}»`;
    findings.push({
      id: `ergo:door-front:${room.id}:${door.opening.id}`, severity: sev, rule: 'door-front', group: 'doors', roomId: room.id,
      itemIds: hit.ob?.itemId ? [hit.ob.itemId] : [], doorId: door.opening.id,
      text: `Перед дверью ${gap} мм до ${what}, нужно ≥ ${nm.need}`,
      gap, need: nm.need, crit: nm.crit, zone,
      band: gap > 0 ? [P(u0, 0), P(u1, 0), P(u1, hit.gap), P(u0, hit.gap)] : null,
      dim: gap > 0 ? { a, b } : null,
      labelAt: gap > 0 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : P(0, nm.need / 2), label: `${gap} < ${nm.need}`,
    });
  }

  // --- Окна: высокий предмет перед окном.
  for (const win of c.windows) {
    const face = openingFace(win, inside);
    if (!face) continue;
    const sill = Number.isFinite(win.opening.sill) ? win.opening.sill : 900;
    const limit = Math.max(ERGO_NORMS.windowTall, sill + 100);
    const D = ERGO_NORMS.windowDepth;
    const u0 = -face.L + 30; const u1 = face.L - 30;
    if (u1 <= u0) continue;
    const P = (u, d) => ({ x: face.O.x + face.t.x * u + face.n.x * d, y: face.O.y + face.t.y * u + face.n.y * d });
    for (const item of items) {
      if (isStructural(item.kind)) continue;
      const tall = shapes.get(item.id).filter((s) => s.top > limit).map((s) => ({ type: 'item', poly: s.poly, bbox: bboxOf(s.poly) }));
      if (!tall.length) continue;
      const hit = probe(face.O, face.t, face.n, u0, u1, D, tall, null);
      if (!Number.isFinite(hit.gap)) continue;
      findings.push({
        id: `ergo:window:${room.id}:${win.opening.id}:${item.id}`, severity: 'warn', rule: 'window', group: 'windows', roomId: room.id,
        itemIds: [item.id], text: `«${title(item.kind)}» закрывает окно (выше ${limit} мм)`,
        gap: round(hit.gap), need: D, crit: 0, zone: [P(u0, 0), P(u1, 0), P(u1, D), P(u0, D)], band: null, dim: null,
        labelAt: P(0, D / 2), label: '▦ окно',
      });
    }
  }

  // --- Проходимость и доступ от дверей.
  const floorPolys = obstacles.filter((ob) => ob.poly).map((ob) => ob.poly);
  const grid = passGrid(room, inside, floorPolys);
  if (opts.heat) {
    out.heat = { x0: grid.x0, y0: grid.y0, cols: grid.cols, rows: grid.rows, cell: grid.cell, cls: heatClasses(grid) };
  }
  const seedCells = [];
  let firstFace = null;
  for (const door of c.doors) {
    const face = openingFace(door, inside);
    if (!face) continue;
    firstFace = firstFace || face;
    const depth = ERGO_NORMS.passage.need / 2 + 2 * ERGO_CELL;
    const seed = [0, 1, 2, 3].map((k) => {
      const u = k === 0 || k === 3 ? -face.L : face.L;
      const d = k < 2 ? 0 : depth;
      return { x: face.O.x + face.t.x * u + face.n.x * d, y: face.O.y + face.t.y * u + face.n.y * d };
    });
    seedCells.push(...cellsIn(grid, seed));
  }
  if (seedCells.length) {
    const seen6 = flood(grid, grid.s300, seedCells);
    const seen8 = flood(grid, grid.s400, seedCells);
    const busy = new Set(findings.filter((f) => f.severity !== 'ok').flatMap((f) => f.itemIds));
    const cands = []; const lost = [];
    for (const item of items) {
      if (isStructural(item.kind) || item.kind === 'stairs' || isChair(item.kind)) continue;
      if (!onFloor(item.kind) && !isFixedSizeComp(item)) continue;
      const polys = shapes.get(item.id).map((s) => s.poly);
      cands.push(item);
      const reach6 = reaches(grid, seen6, polys, ERGO_NORMS.passage.crit / 2 + 150);
      const P = { x: item.x, y: item.y };
      if (!reach6) {
        findings.push({
          id: `ergo:reach:${room.id}:${item.id}`, severity: 'error', rule: 'reach', group: 'passage', roomId: room.id, itemIds: [item.id],
          text: `К «${title(item.kind)}» не подойти: проход уже ${ERGO_NORMS.passage.crit} мм`,
          gap: 0, need: ERGO_NORMS.passage.crit, crit: ERGO_NORMS.passage.crit, zone: null, hatch: polys, band: null, dim: null,
          labelAt: P, label: '⛔',
        });
        lost.push(findings[findings.length - 1]);
        continue;
      }
      if (busy.has(item.id)) continue; // уже есть замечание по его зонам
      if (!reaches(grid, seen8, polys, ERGO_NORMS.passage.need / 2 + 150)) {
        findings.push({
          id: `ergo:neck:${room.id}:${item.id}`, severity: 'warn', rule: 'neck', group: 'passage', roomId: room.id, itemIds: [item.id],
          text: `К «${title(item.kind)}» тесно: проход уже ${ERGO_NORMS.passage.need} мм`,
          gap: ERGO_NORMS.passage.crit, need: ERGO_NORMS.passage.need, crit: ERGO_NORMS.passage.crit, zone: null, hatch: null, band: null, dim: null,
          labelAt: P, label: `< ${ERGO_NORMS.passage.need}`,
        });
      }
    }
    // Не подойти ни к чему — перекрыт вход: одна находка вместо списка.
    if (cands.length >= 2 && lost.length === cands.length) {
      for (const f of lost) findings.splice(findings.indexOf(f), 1);
      const at = firstFace ? { x: firstFace.O.x + firstFace.n.x * 500, y: firstFace.O.y + firstFace.n.y * 500 } : { x: room.x + room.w / 2, y: room.y + room.h / 2 };
      findings.push({
        id: `ergo:reach:${room.id}:entrance`, severity: 'error', rule: 'reach', group: 'passage', roomId: room.id,
        itemIds: lost.map((f) => f.itemIds[0]),
        text: `Вход перекрыт: от двери не пройти ни к одному предмету (проход уже ${ERGO_NORMS.passage.crit} мм)`,
        gap: 0, need: ERGO_NORMS.passage.crit, crit: ERGO_NORMS.passage.crit, zone: null, hatch: lost.flatMap((f) => f.hatch),
        band: null, dim: null, labelAt: at, label: '⛔ вход',
      });
    }
  }

  // --- Кухня: рабочий треугольник «мойка — плита — холодильник».
  const pts = {};
  for (const item of items) {
    const plain = { sink: 'sink', stove: 'hob', 'cooktop-hood': 'hob', fridge: 'fridge', 'fridge-side': 'fridge' }[item.kind];
    if (plain && !pts[plain]) pts[plain] = { x: item.x, y: item.y, itemId: item.id };
    if (isFixedSizeComp(item) && item.comp?.type === 'kitchen') {
      for (const q of itemFrames(item)) {
        const el = q.part?.element;
        if (['sink', 'hob', 'fridge'].includes(el) && !pts[el]) pts[el] = { x: q.f.cx, y: q.f.cy, itemId: item.id };
      }
    }
  }
  if (pts.sink && pts.hob && pts.fridge) {
    const nm = ERGO_NORMS.triangle;
    const P3 = [pts.sink, pts.hob, pts.fridge];
    const names = ['мойка', 'плита', 'холодильник'];
    const sides = [0, 1, 2].map((i) => round(Math.hypot(P3[(i + 1) % 3].x - P3[i].x, P3[(i + 1) % 3].y - P3[i].y)));
    const sum = sides.reduce((s, v) => s + v, 0);
    const bad = [];
    sides.forEach((len, i) => {
      const nmx = `${names[i]}–${names[(i + 1) % 3]}`;
      if (len < nm.sideMin) bad.push(`${nmx} ${fmtM(len)} м < 1,2`);
      else if (len > nm.sideMax) bad.push(`${nmx} ${fmtM(len)} м > 2,7`);
    });
    if (sum < nm.sumMin) bad.push(`сумма ${fmtM(sum)} м < 3,6`);
    else if (sum > nm.sumMax) bad.push(`сумма ${fmtM(sum)} м > 6,6`);
    const at = { x: (P3[0].x + P3[1].x + P3[2].x) / 3, y: (P3[0].y + P3[1].y + P3[2].y) / 3 };
    out.triangle = { points: P3.map((p) => ({ x: p.x, y: p.y })), sides, sum, severity: bad.length ? 'warn' : 'ok', labelAt: at };
    if (bad.length) {
      findings.push({
        id: `ergo:triangle:${room.id}`, severity: 'warn', rule: 'triangle', group: 'kitchen', roomId: room.id,
        itemIds: [...new Set(P3.map((p) => p.itemId))],
        text: `Рабочий треугольник ${fmtM(sum)} м: ${bad.join(', ')} (норма: стороны 1,2–2,7 м, сумма 3,6–6,6 м)`,
        gap: sum, need: nm.sumMin, crit: 0, zone: null, band: null, dim: null, labelAt: at, label: `Σ ${fmtM(sum)} м`,
      });
    }
  }

  // Одна находка на пару предметов: зоны обоих смотрят друг на друга —
  // остаётся строже нарушенная.
  const byPair = new Map();
  const kept = [];
  for (const f of findings) {
    if (!f.pairKey) { kept.push(f); continue; }
    const prev = byPair.get(f.pairKey);
    const worse = (x) => SEV_RANK[x.severity] * 1e6 + (x.need - x.gap);
    if (!prev) { byPair.set(f.pairKey, f); kept.push(f); continue; }
    if (worse(f) > worse(prev)) { kept[kept.indexOf(prev)] = f; byPair.set(f.pairKey, f); }
  }
  out.findings = kept;
  return out;
}

/**
 * Эргономика этажа: все комнаты с мебелью.
 * → { rooms: [результат комнаты], findings, counts: { error, warn } }.
 * opts.groups — включённые группы правил (Set/массив; по умолчанию все).
 */
export function analyzeErgonomics(project, walls, opts = {}) {
  const ctx = opts.ctx || ergoContext(project, walls);
  const rooms = project.rooms.map((room) => analyzeRoomErgonomics(project, room, walls, ctx, opts));
  return summarizeErgo(rooms, opts.groups);
}

// Сводка по готовым результатам комнат (фильтр групп).
export function summarizeErgo(rooms, groups = null) {
  const on = groups ? new Set(groups) : null;
  const findings = rooms.flatMap((r) => r.findings).filter((f) => !on || on.has(f.group));
  return {
    rooms,
    findings,
    counts: {
      error: findings.filter((f) => f.severity === 'error').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
    },
  };
}

// Комната, в которой стоит предмет (вложенная — раньше родителя).
export function roomOfItem(project, item) {
  let found = null;
  for (const r of project.rooms) {
    if (roomContainsPoint(r, item.x, item.y) && (!found || r.parentId === found.id)) found = r;
  }
  return found;
}

/**
 * Сдвиг предмета, исправляющий находку зоны: { dx, dy, text } или null.
 * Пробуются: отодвинуть на недостающее (вдоль нормали стороны) и — если
 * бок можно ставить вплотную — придвинуть вплотную. Годится сдвиг, после
 * которого предмет в той же комнате, находка ушла и ошибок по предмету и в
 * комнате не прибавилось. Шаг — 10 мм.
 */
export function suggestErgoFix(project, walls, finding, ctx = null) {
  const fx = finding?.fix;
  if (!fx || finding.rule !== 'zone') return null;
  const item = project.items.find((it) => it.id === fx.itemId);
  if (!item) return null;
  const room = project.rooms.find((r) => r.id === finding.roomId);
  if (!room) return null;
  const c = ctx || ergoContext(project, walls);
  const base = analyzeRoomErgonomics(project, room, walls, c, { heat: false });
  const errs = (res, id) => res.findings.filter((f) => f.severity === 'error' && (!id || f.itemIds.includes(id))).length;
  const step = (v) => Math.ceil(v / 10) * 10;
  const cands = [];
  const away = step(fx.need - fx.gap);
  if (away > 0) cands.push({ d: -away, text: `Отодвинуть на ${away} мм` });
  if (fx.flushOk && fx.gap > ERGO_FLUSH) { const to = Math.floor(fx.gap / 10) * 10; if (to > 0) cands.push({ d: to, text: `Придвинуть вплотную (${to} мм)` }); }
  cands.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  for (const cand of cands) {
    const dx = round(fx.n.x * cand.d) + 0; const dy = round(fx.n.y * cand.d) + 0; // + 0: без «-0»
    const moved = { ...item, x: item.x + dx, y: item.y + dy };
    // Этаж — свойства-аксессоры проекта (не перечисляются): переносим явно.
    const sim = {
      ...project, rooms: project.rooms, openings: project.openings,
      items: project.items.map((it) => (it.id === item.id ? moved : it)),
    };
    if (roomOfItem(sim, moved)?.id !== room.id) continue;
    // Предмет не вылезает за стены.
    const polys = itemFrames(moved).map((q) => rectPoly(q.f, q.round));
    if (polys.some((poly) => poly.some((p) => !roomContainsPoint(room, p.x + Math.sign(moved.x - p.x) * 1, p.y + Math.sign(moved.y - p.y) * 1)))) continue;
    const res = analyzeRoomErgonomics(sim, room, walls, c, { heat: false });
    const still = res.findings.find((f) => f.id === finding.id);
    if (still && SEV_RANK[still.severity] >= SEV_RANK[finding.severity]) continue;
    if (errs(res, item.id) > errs(base, item.id) - (finding.severity === 'error' ? 1 : 0)) continue;
    if (errs(res) > errs(base)) continue;
    return { dx, dy, text: cand.text };
  }
  return null;
}

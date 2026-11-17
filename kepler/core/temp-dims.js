// Временные размеры выбранного предмета мебели (как в Revit). Чистый модуль
// без DOM: от граней предмета по осям дома (влево/вправо/вверх/вниз) — до
// ближайшей цели, «видимой» лучом из края: внутренней грани стены комнаты,
// внешнего габарита вложенного помещения или другой мебели этой комнаты.
//
// Повёрнутый предмет берётся по описывающему габариту в осях дома
// (itemBounds; у стола со стульями — вместе со стульями).

import { itemBounds, itemShapes } from './clearance.js';
import { itemsInRoom } from './furnish.js';
import { nestedOuterRect } from './rooms.js';
import { roomContainsPoint, roomPolygon } from './room-shape.js';
import { DEFAULT_PARTITION } from './catalog.js';

export const TEMP_DIM_MAX = 6000; // дальше — не показываем, мм
export const TEMP_DIM_DIRS = ['left', 'right', 'up', 'down'];
export const OPPOSITE_DIR = { left: 'right', right: 'left', up: 'down', down: 'up' };
const EPS = 0.5; // допуск касания, мм
const MIN_OVERLAP = 1; // минимальное перекрытие проекций, мм

// Комната предмета: самая глубокая (вложенная) из содержащих его центр.
export function itemRoom(project, item) {
  const hits = project.rooms.filter((room) => roomContainsPoint(room, item.x, item.y));
  if (!hits.length) return null;
  return hits.find((room) => room.parentId && hits.some((p) => p.id === room.parentId)) || hits[0];
}

// Препятствия в осях дома: отрезки {orient:'h'|'v', edge, from, to, kind}.
// Прямоугольник даёт четыре отрезка — луч найдёт ближнюю к предмету грань.
function obstacles(project, room, item) {
  const out = [];
  const poly = roomPolygon(room);
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) >= EPS) {
      out.push({ orient: 'h', edge: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x), kind: 'wall' });
    } else if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) >= EPS) {
      out.push({ orient: 'v', edge: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y), kind: 'wall' });
    }
  }
  const pushRect = (r, kind, id) => {
    out.push({ orient: 'h', edge: r.y, from: r.x, to: r.x + r.w, kind, id });
    out.push({ orient: 'h', edge: r.y + r.h, from: r.x, to: r.x + r.w, kind, id });
    out.push({ orient: 'v', edge: r.x, from: r.y, to: r.y + r.h, kind, id });
    out.push({ orient: 'v', edge: r.x + r.w, from: r.y, to: r.y + r.h, kind, id });
  };
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  for (const child of project.rooms) {
    if (child.parentId === room.id) pushRect(nestedOuterRect(child, partition), 'room', child.id);
  }
  for (const other of itemsInRoom(project, room)) {
    if (other.id === item.id) continue;
    for (const r of itemShapes(other)) pushRect(r, 'item', other.id);
  }
  return out;
}

// Размеры: [{ dir, from, to, value, targetKind, targetId }] — from на грани
// предмета, to на цели (оси дома, мм). Нулевые (вплотную) не возвращаются,
// кроме opts.keepZero.
export function tempDimensions(project, item, { maxDist = TEMP_DIM_MAX, keepZero = false } = {}) {
  if (!project || !item) return [];
  const room = itemRoom(project, item);
  if (!room) return [];
  const box = itemBounds(item);
  const x0 = box.x; const x1 = box.x + box.w;
  const y0 = box.y; const y1 = box.y + box.h;
  const obs = obstacles(project, room, item);
  const result = [];
  for (const dir of TEMP_DIM_DIRS) {
    const horizontal = dir === 'left' || dir === 'right';
    const orient = horizontal ? 'v' : 'h';
    const lo = horizontal ? y0 : x0;
    const hi = horizontal ? y1 : x1;
    const face = dir === 'left' ? x0 : dir === 'right' ? x1 : dir === 'up' ? y0 : y1;
    const sign = dir === 'right' || dir === 'down' ? 1 : -1;
    let best = null;
    for (const o of obs) {
      if (o.orient !== orient) continue;
      const a = Math.max(lo, o.from);
      const b = Math.min(hi, o.to);
      if (b - a < MIN_OVERLAP) continue;
      const dist = (o.edge - face) * sign;
      if (dist < -EPS) continue; // позади грани или внутри предмета
      if (!best || dist < best.dist - EPS || (Math.abs(dist - best.dist) <= EPS && b - a > best.b - best.a)) {
        best = { o, dist: Math.max(0, dist), a, b };
      }
    }
    if (!best || best.dist > maxDist) continue;
    if (best.dist < EPS && !keepZero) continue;
    const mid = (best.a + best.b) / 2;
    const target = best.o.edge;
    const from = horizontal ? { x: face, y: mid } : { x: mid, y: face };
    const to = horizontal ? { x: target, y: mid } : { x: mid, y: target };
    result.push({ dir, from, to, value: best.dist, targetKind: best.o.kind, targetId: best.o.id || null });
  }
  return result;
}

// Новое положение центра, при котором расстояние в сторону dim.dir станет value.
// dim — элемент tempDimensions (нужны dir и текущее value). Размер не меняется.
export function moveItemToDistance(item, dim, value) {
  const delta = dim.value - value; // > 0 — ближе к цели
  if (dim.dir === 'right') return { x: item.x + delta, y: item.y };
  if (dim.dir === 'left') return { x: item.x - delta, y: item.y };
  if (dim.dir === 'down') return { x: item.x, y: item.y + delta };
  return { x: item.x, y: item.y - delta };
}

// Проверка ввода: предмет не должен войти в цель или упереться в препятствие
// с противоположной стороны (стену, мебель) и выйти из комнаты.
// → { ok, x, y, reason? }
export function planTempDimMove(project, item, dir, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return { ok: false, reason: 'Расстояние должно быть числом не меньше 0' };
  const dims = tempDimensions(project, item, { maxDist: Infinity, keepZero: true });
  const dim = dims.find((d) => d.dir === dir);
  if (!dim) return { ok: false, reason: 'Нет размера в эту сторону' };
  const away = v - dim.value; // > 0 — отходим от цели, к противоположной стороне
  const opp = dims.find((d) => d.dir === OPPOSITE_DIR[dir]);
  if (away > EPS) {
    if (!opp) return { ok: false, reason: 'Предмет выйдет из комнаты' };
    if (away > opp.value + EPS) {
      const what = opp.targetKind === 'item' ? 'другую мебель' : opp.targetKind === 'room' ? 'стену помещения' : 'стену';
      return { ok: false, reason: `Так не помещается: предмет упрётся в ${what} — свободно ${Math.round(dim.value + opp.value)} мм` };
    }
  }
  const at = moveItemToDistance(item, dim, v);
  return { ok: true, x: at.x, y: at.y };
}

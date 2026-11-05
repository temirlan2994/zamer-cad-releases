// Посадки в клумбе-коробе (без DOM): растение привязано к коробу полем
// parent = id короба и хранит обычные мировые x, y, rotation. Так проще
// всего для истории (снимок проекта), сохранения и экспорта: схема та же,
// поле необязательное; битая ссылка снимается normalizeLandscape().
//
// Короб двигается, поворачивается, копируется и удаляется вместе со своими
// растениями (функции ниже вызывает ui/landscape.js). Растение, поставленное
// или перетащенное на короб, садится внутрь и не выходит за борт (clamp);
// вытащенное за борт — отвязывается.

import { pointInPolygon } from './zamer/geometry.js';
import { fillArea } from './landscape-tools.js';
import {
  PLANTER_KINDS, cloneLandscapeObject, createLandscapeObject, isPathShape, landscapeDef, planterInner, planterWall,
  pointInObject,
  rotateObjectAbout, toLocal, toWorld,
} from './landscape.js';

export const isPlanter = (o) => PLANTER_KINDS.has(o?.kind);

// Что можно посадить в короб: растения и камни (не покрытия, не фигуры).
export function canPlantInto(kind) {
  const def = landscapeDef(kind);
  return Boolean(def && def.cat === 'green' && !def.cover && !isPathShape(def) && !PLANTER_KINDS.has(kind));
}

export const childrenOf = (objects, id) => objects.filter((o) => o.parent === id);

// ids + растения коробов из ids (для переноса, поворота, удаления).
export function withChildren(objects, ids) {
  const set = new Set(ids);
  for (const o of objects) if (o.parent && set.has(o.parent)) set.add(o.id);
  return set;
}

// Короб под точкой p; верхний — последний в списке.
export function planterAt(objects, p, excludeId = null) {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i];
    if (!isPlanter(o) || o.id === excludeId) continue;
    // По наружному контуру: брошенное на борт — тоже в короб (сдвинется внутрь).
    if (pointInObject(o, p)) return o;
  }
  return null;
}

// Полуразмер растения вдоль осей короба (с учётом поворотов обоих).
// Деревья — по стволу (крона может нависать над бортом).
function extentIn(box, o) {
  const def = landscapeDef(o.kind);
  if (def?.group === 'Деревья') return { x: 150, y: 150 };
  if (def?.shape === 'point' || def?.shape === 'circle') return { x: o.w / 2, y: o.w / 2 };
  const rel = (((o.rotation || 0) - (box.rotation || 0)) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rel)); const s = Math.abs(Math.sin(rel));
  return { x: (c * o.w + s * o.h) / 2, y: (s * o.w + c * o.h) / 2 };
}

// Растение внутрь короба: центр — во внутреннем контуре с отступом на
// полуразмер (если растение крупнее засыпки — по центру короба).
export function clampIntoPlanter(box, o) {
  const ext = extentIn(box, o);
  if (box.kind === 'planter-box') {
    const wall = planterWall(box);
    const ia = Math.max(0, box.w / 2 - wall);
    const ib = Math.max(0, box.h / 2 - wall);
    const l = toLocal(box, o);
    const mx = Math.max(0, ia - Math.min(ext.x, ia));
    const my = Math.max(0, ib - Math.min(ext.y, ib));
    const p = toWorld(box, Math.min(mx, Math.max(-mx, l.x)), Math.min(my, Math.max(-my, l.y)));
    o.x = Math.round(p.x);
    o.y = Math.round(p.y);
    return o;
  }
  // Контур: проталкиваем от ближайшего ребра внутрь (несколько шагов).
  const poly = planterInner(box);
  const r = Math.max(ext.x, ext.y);
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sgn = area > 0 ? 1 : -1;
  const cx = poly.reduce((s, q) => s + q.x, 0) / poly.length;
  const cy = poly.reduce((s, q) => s + q.y, 0) / poly.length;
  let p = { x: o.x, y: o.y };
  for (let iter = 0; iter < 4; iter += 1) {
    let best = null;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) {
        const len = Math.sqrt(len2);
        best = { d, q, n: { x: (-dy / len) * sgn, y: (dx / len) * sgn } };
      }
    }
    const inside = pointInPolygon(p, poly);
    const need = Math.min(r, Math.hypot(cx - best.q.x, cy - best.q.y) * 0.5);
    if (inside && best.d >= need - 1) break;
    p = { x: best.q.x + best.n.x * need, y: best.q.y + best.n.y * need };
  }
  if (!pointInPolygon(p, poly)) p = { x: cx, y: cy };
  o.x = Math.round(p.x);
  o.y = Math.round(p.y);
  return o;
}

// Посадить растение в короб под ним (или отвязать, если короба нет).
// Возвращает короб или null.
export function settleInPlanter(objects, o) {
  if (!canPlantInto(o.kind)) return null;
  const box = planterAt(objects, o, o.id);
  if (!box) { delete o.parent; return null; }
  o.parent = box.id;
  clampIntoPlanter(box, o);
  return box;
}

// Растения, сдвинутые без своего короба, — пересадить/отвязать.
export function settleMoved(objects, ids) {
  const moved = new Set(ids);
  for (const o of objects) {
    if (!moved.has(o.id) || !canPlantInto(o.kind)) continue;
    if (o.parent && moved.has(o.parent)) continue; // едет вместе с коробом
    settleInPlanter(objects, o);
  }
}

// Короб поменял размер/контур/толщину: растения — пропорционально на новое
// место (если известен прежний короб before) и внутрь борта.
export function refitChildren(objects, box, before = null, starts = null) {
  for (const c of childrenOf(objects, box.id)) {
    const s = starts?.get(c.id);
    if (s) { c.x = s.x; c.y = s.y; }
    if (before && before.w > 0 && before.h > 0) {
      const l = toLocal(before, c);
      const p = toWorld(box, (l.x * box.w) / before.w, (l.y * box.h) / before.h);
      c.x = Math.round(p.x);
      c.y = Math.round(p.y);
    }
    clampIntoPlanter(box, c);
  }
}

// Поворот растений вместе с коробом на deg вокруг его центра (от исходных
// положений starts: id → { x, y, rotation }, если заданы).
export function rotateChildren(objects, box, deg, starts = null) {
  for (const c of childrenOf(objects, box.id)) {
    const s = starts?.get(c.id);
    if (s) { c.x = s.x; c.y = s.y; c.rotation = s.rotation; }
    rotateObjectAbout(c, box.x, box.y, deg);
  }
}

// Копии группы (короба с растениями): новые id, parent переназначен; у
// растения без своего короба в группе parent сохраняется (затем settle).
export function cloneGroup(list, dx = 0, dy = 0) {
  const ids = new Map();
  const copies = list.map((o) => {
    const c = cloneLandscapeObject(o, dx, dy);
    ids.set(o.id, c.id);
    return c;
  });
  for (const c of copies) if (c.parent && ids.has(c.parent)) c.parent = ids.get(c.parent);
  return copies;
}

// Снять ссылки на удалённые короба.
export function pruneParents(objects) {
  const planters = new Set(objects.filter(isPlanter).map((o) => o.id));
  for (const o of objects) if (o.parent && !planters.has(o.parent)) delete o.parent;
}


// Растения для посадки в короб (панель свойств короба).
export const PLANTER_PLANTS = [
  'flowers-clump', 'grass-clump', 'shrub-box', 'hedge-box', 'shrub-flower', 'shrub-juniper', 'tree-thuja', 'tree-fruit',
  'tree-birch', 'tree-bonsai', 'boulder',
];

// Заполнить короб растениями kind (густота 0..1): разброс по засыпке без
// наложений с уже посаженными; узкий короб — рядом по оси. Новые объекты
// привязаны к коробу (parent) и уже внутри борта.
export function plantInPlanter(objects, box, { kind, density = 0.5, variant } = {}) {
  const def = landscapeDef(kind);
  if (!def || !canPlantInto(kind)) return [];
  const inner = planterInner(box);
  const circles = childrenOf(objects, box.id).map((c) => ({ x: c.x, y: c.y, r: Math.max(c.w, c.h) / 2 }));
  // Контур — разброс; прямоугольный короб — ровные ряды (как сажают в коробах).
  let list = box.kind === 'planter-area' ? fillArea(inner, { kind, density, seed: `${box.id}:${circles.length}`, circles, variant }) : [];
  if (!list.length && box.kind === 'planter-area') {
    // Узкий контур: сетка по засыпке без отступа от борта (clamp ниже).
    const d = Math.max(def.w, def.h);
    const step = d * (1 + (1 - Math.min(1, Math.max(0.05, density))) * 0.6);
    const xs = inner.map((q) => q.x); const ys = inner.map((q) => q.y);
    const taken = [...circles];
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
      for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
        if (!pointInPolygon({ x, y }, inner) || taken.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + d * 0.4)) continue;
        list.push(createLandscapeObject(kind, Math.round(x), Math.round(y), { variant }));
        taken.push({ x, y, r: d / 2 });
      }
    }
  }
  if (box.kind === 'planter-box') {
    // Узкий короб: ряды вдоль длинной оси с шагом по размеру растения.
    const wall = planterWall(box);
    const along = box.w >= box.h;
    const len = (along ? box.w : box.h) - wall * 2;
    const across = (along ? box.h : box.w) - wall * 2;
    const d = Math.max(def.w, def.h);
    const step = d * (1 + (1 - Math.min(1, Math.max(0.05, density))) * 0.6);
    const n = Math.max(1, Math.floor(len / step));
    const rows = Math.max(1, Math.floor(across / step));
    const taken = [...circles];
    list = [];
    for (let r = 0; r < rows; r += 1) {
      const u = -across / 2 + (across / rows) * (r + 0.5);
      for (let i = 0; i < n; i += 1) {
        const t = -len / 2 + (len / n) * (i + 0.5) + (r % 2 ? step / 4 : 0);
        const p = along ? toWorld(box, t, u) : toWorld(box, u, t);
        if (taken.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < c.r + d * 0.4)) continue;
        list.push(createLandscapeObject(kind, Math.round(p.x), Math.round(p.y), { variant }));
        taken.push({ x: p.x, y: p.y, r: d / 2 });
      }
    }
  }
  for (const o of list) {
    o.parent = box.id;
    clampIntoPlanter(box, o);
  }
  return list;
}

// Читаемость плана без DOM: где поставить подпись комнаты, чтобы её не
// перекрывали мебель, дуги дверей и вложенные помещения, и какой текст
// рисовать при данном масштабе. Координаты — мм в осях дома.

import { compositeBounds } from './composite.js';
import { roomLabelPoint, roomPolygon, roomRects } from './room-shape.js';
import { doorLeaves, openingRect } from './walls.js';

// Площадь пересечения двух прямоугольников {x, y, w, h}.
export function rectOverlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function pointsBox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[j]; const b = points[i];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Доля рамки подписи вне контура комнаты (сетка 5×5 точек).
function outsideShare(poly, box) {
  let out = 0;
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      if (!pointInPolygon(poly, box.x + (box.w * i) / 4, box.y + (box.h * j) / 4)) out += 1;
    }
  }
  return out / 25;
}

function itemBox(item) {
  if (item.comp) return compositeBounds(item);
  const r = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(r)); const s = Math.abs(Math.sin(r));
  const w = item.w * c + item.h * s;
  const h = item.w * s + item.h * c;
  return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}

// Препятствия для подписей: мебель и лестницы, створки дверей с дугами,
// проёмы, помещения (вложенная комната — препятствие для внешней).
export function labelObstacles(project, walls) {
  const out = [];
  for (const item of project.items || []) out.push({ ...itemBox(item), kind: 'item' });
  for (const opening of project.openings || []) {
    const placed = openingRect(project, opening, walls);
    if (placed) out.push({ ...placed.rect, kind: 'opening' });
    if (opening.kind !== 'door') continue;
    for (const leaf of doorLeaves(project, opening, walls)) {
      const far = { x: leaf.closed.x + leaf.open.x - leaf.hinge.x, y: leaf.closed.y + leaf.open.y - leaf.hinge.y };
      out.push({ ...pointsBox([leaf.hinge, leaf.closed, leaf.open, far]), kind: 'door' });
    }
  }
  for (const room of project.rooms || []) {
    for (const rect of roomRects(room)) out.push({ ...rect, kind: 'room', roomId: room.id });
  }
  return out;
}

// Точка подписи комнаты. labelW/labelH — рамка подписи в мм. Кандидаты —
// центр (roomLabelPoint), центры и углы ячеек сетки по габариту; оценка —
// доля рамки, занятая препятствиями или вне комнаты, плюс малый штраф за
// удаление от центра. Если лучше центра ничего нет — центр.
export function roomLabelAnchor(room, obstacles = [], opts = {}) {
  const base = roomLabelPoint(room);
  const labelW = Math.max(1, opts.labelW ?? 1600);
  const labelH = Math.max(1, opts.labelH ?? 900);
  const n = opts.grid ?? 6;
  const poly = roomPolygon(room);
  const bb = pointsBox(poly);
  const area = labelW * labelH;
  const zone = { x: bb.x - labelW, y: bb.y - labelH, w: bb.w + labelW * 2, h: bb.h + labelH * 2 };
  const near = obstacles.filter((o) => o.roomId !== room.id && o.w > 0 && o.h > 0 && rectOverlap(o, zone) > 0);
  const cost = (p) => {
    const box = { x: p.x - labelW / 2, y: p.y - labelH / 2, w: labelW, h: labelH };
    let c = 0;
    for (const o of near) c += rectOverlap(box, o);
    return c / area + outsideShare(poly, box) * 1.5;
  };
  const baseCost = cost(base);
  // Подпись крупнее комнаты: сдвиг не поможет — центр.
  if (labelW > bb.w || labelH > bb.h) return { x: base.x, y: base.y, cost: baseCost, moved: false };
  if (baseCost < 1e-6) return { x: base.x, y: base.y, cost: 0, moved: false };
  const diag = Math.hypot(bb.w, bb.h) || 1;
  let best = null;
  const steps = n * 2;
  for (let i = 1; i < steps; i += 1) {
    for (let j = 1; j < steps; j += 1) {
      const p = { x: bb.x + (bb.w * i) / steps, y: bb.y + (bb.h * j) / steps };
      if (!pointInPolygon(poly, p.x, p.y)) continue;
      const c = cost(p);
      const score = c + (0.15 * Math.hypot(p.x - base.x, p.y - base.y)) / diag;
      if (!best || score < best.score) best = { ...p, cost: c, score };
    }
  }
  // Сдвиг оправдан, только если заметно освобождает подпись.
  if (!best || best.cost > baseCost - 0.05) return { x: base.x, y: base.y, cost: baseCost, moved: false };
  return { x: best.x, y: best.y, cost: best.cost, moved: true };
}

// Текст плана при масштабе pxPerM (экранных px на метр). Шрифт имени
// уменьшается при отдалении; мельче 8 px подписи не рисуются, размеры
// скрываются раньше. На печати подписи и размеры остаются (шрифт ≥ 7 px).
export const LABEL_MIN_FONT = 8;
export const DIMS_MIN_PX_PER_M = 20;

export function planTextScale(pxPerM, { print = false } = {}) {
  const font = Math.min(13, Math.max(0, pxPerM) * 0.5);
  if (print) return { labels: true, font: Math.max(7, font), dims: true };
  return { labels: font >= LABEL_MIN_FONT, font, dims: pxPerM >= DIMS_MIN_PX_PER_M };
}

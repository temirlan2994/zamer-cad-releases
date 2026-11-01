// Проходы у мебели. Чистый модуль без DOM.
//
// Человек — круг диаметром MIN_PASSAGE (600 мм): мебель, вложенные
// помещения и стены комнаты раздуваются на радиус, проходимость считается
// поиском по сетке 100 мм от порогов дверей. Предмет «доступен», если до
// него можно дойти (клетка рядом с раздутым габаритом достижима).
// Дополнительно: мебель пересекается с мебелью, мебель в зоне открывания
// двери.

import { furnitureDef } from './catalog.js';
import { buildRoomContext, itemsInRoom } from './furnish.js';

export const MIN_PASSAGE = 600;
const CELL = 100;

// Честный габарит повёрнутого предмета.
export function itemBounds(item) {
  const r = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = item.w * c + item.h * s;
  const h = item.w * s + item.h * c;
  return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 });
const title = (item) => furnitureDef(item.kind)?.title || item.kind;
// Лестничный марш — конструкция: препятствие, но подходить к нему не нужно.
const SKIP_REACH = new Set(['stairs']);

// Замечания по комнате: [{ kind: 'overlap'|'door'|'reach', itemIds, text }].
export function furnitureIssues(project, room, walls) {
  const items = itemsInRoom(project, room);
  if (!items.length) return [];
  const issues = [];
  const boxes = items.map(itemBounds);

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = overlapArea(boxes[i], boxes[j]);
      if (a > 0.02 * Math.min(boxes[i].w * boxes[i].h, boxes[j].w * boxes[j].h)) {
        issues.push({ kind: 'overlap', itemIds: [items[i].id, items[j].id], text: `«${title(items[i])}» и «${title(items[j])}» пересекаются` });
      }
    }
  }

  const ctx = buildRoomContext(project, room, walls);
  items.forEach((item, i) => {
    if (ctx.doorZones.some((z) => overlapArea(z, boxes[i]) > 1e4)) {
      issues.push({ kind: 'door', itemIds: [item.id], text: `«${title(item)}» мешает открыть дверь` });
    }
  });

  if (!ctx.doorCells.length) return issues; // без дверей проходы не проверить
  const R = MIN_PASSAGE / 2;
  const inner = ctx.inner;
  const cols = Math.max(1, Math.round(inner.w / CELL));
  const rows = Math.max(1, Math.round(inner.h / CELL));
  const center = (cx, cy) => ({ x: inner.x + (cx + 0.5) * CELL, y: inner.y + (cy + 0.5) * CELL });
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const blocked = new Uint8Array(cols * rows);
  const obstacles = [...boxes, ...ctx.solids.map((s) => s.rect)].map((r) => grow(r, R));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const p = center(x, y);
      const nearWall = p.x - inner.x < R || inner.x + inner.w - p.x < R || p.y - inner.y < R || inner.y + inner.h - p.y < R;
      if (nearWall || obstacles.some((o) => inRect(p, o))) blocked[y * cols + x] = 1;
    }
  }
  // Старт — свободные клетки перед дверью (порог, раздутый внутрь комнаты).
  const visited = new Uint8Array(cols * rows);
  const queue = [];
  const seeds = ctx.doorCells.map((c) => grow(c, R + CELL * 2));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (!blocked[idx] && seeds.some((s) => inRect(center(x, y), s))) { visited[idx] = 1; queue.push(idx); }
    }
  }
  while (queue.length) {
    const idx = queue.pop();
    const x = idx % cols;
    const y = (idx / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (!blocked[n] && !visited[n]) { visited[n] = 1; queue.push(n); }
    }
  }
  items.forEach((item, i) => {
    if (SKIP_REACH.has(item.kind)) return;
    const ring = grow(boxes[i], R + CELL * 1.5);
    let reached = false;
    for (let y = 0; y < rows && !reached; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (visited[y * cols + x] && inRect(center(x, y), ring)) { reached = true; break; }
      }
    }
    if (!reached) issues.push({ kind: 'reach', itemIds: [item.id], text: `К «${title(item)}» не подойти: проход уже ${MIN_PASSAGE} мм` });
  });
  return issues;
}

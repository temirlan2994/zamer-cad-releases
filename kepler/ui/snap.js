// Привязки и проверки при изменении размеров комнат и мебели.

import { DEFAULT_PARTITION, GRID_STEP, isOpenRoom, isShaft } from '../core/catalog.js';
import { itemRect } from '../core/furnish.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, validateRoomPlacement } from '../core/rooms.js';
import { MAX_SHARED_GAP, sharedWallThickness } from '../core/walls.js';
import { state } from './state.js';

// Линии привязки: грани стен и кромки других комнат.
function collectSnapLines(excludeRoomId) {
  const xs = [];
  const ys = [];
  for (const wall of state.walls) {
    // Не привязываем редактируемое помещение к его же общей стене: иначе
    // после первого соединения ручка липнет к старому положению и двигается
    // ступенями.
    if (excludeRoomId && wall.rooms.includes(excludeRoomId)) continue;
    xs.push(wall.band.x, wall.band.x + wall.band.w);
    ys.push(wall.band.y, wall.band.y + wall.band.h);
  }
  for (const r of state.project.rooms) {
    if (r.id === excludeRoomId) continue;
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { xs, ys };
}

function snapValue(value, candidates, tol) {
  let best = null;
  for (const c of candidates) {
    const d = Math.abs(value - c);
    if (d <= tol && (!best || d < best.d)) best = { c, d };
  }
  return best ? best.c : null;
}

export function applyResize(room, dragState, plan) {
  const start = dragState.start;
  const dx = plan.x - dragState.plan.x;
  const dy = plan.y - dragState.plan.y;
  const snap = (v) => Math.round(v / GRID_STEP) * GRID_STEP;
  const h = dragState.handle;
  const minSize = isShaft(room) ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE;
  let { x, y, w, h: hh } = start;
  if (h.includes('w')) { const nx = snap(start.x + dx); w = start.x + start.w - nx; x = nx; }
  if (h.includes('e')) { w = snap(start.w + dx); }
  if (h.includes('n')) { const ny = snap(start.y + dy); hh = start.y + start.h - ny; y = ny; }
  if (h.includes('s')) { hh = snap(start.h + dy); }
  // Привязка подвижной грани к стенам/кромкам соседних комнат.
  const tol = 14 / state.view.scale;
  const partition = state.project.settings?.partition || DEFAULT_PARTITION;
  const dockTol = Math.max(tol, Math.max(0, MAX_SHARED_GAP - partition));
  const dockXs = [];
  const dockYs = [];
  for (const other of state.project.rooms) {
    if (other.id === room.id || isOpenRoom(other)) continue;
    if ((other.parentId || null) !== (room.parentId || null)) continue;
    const overlapY = Math.min(y + hh, other.y + other.h) - Math.max(y, other.y) > 1;
    const overlapX = Math.min(x + w, other.x + other.w) - Math.max(x, other.x) > 1;
    // Зазор стыковки — толщина общей стены этой пары (своя или перегородка).
    const gap = sharedWallThickness(state.project, room.id, other.id);
    if (overlapY && h.includes('e') && other.x > x) dockXs.push(other.x - gap);
    if (overlapY && h.includes('w') && other.x + other.w < x + w) dockXs.push(other.x + other.w + gap);
    if (overlapX && h.includes('s') && other.y > y) dockYs.push(other.y - gap);
    if (overlapX && h.includes('n') && other.y + other.h < y + hh) dockYs.push(other.y + other.h + gap);
  }
  const lines = dragState.snapLines || (dragState.snapLines = collectSnapLines(room.id));
  if (h.includes('w')) {
    const dock = snapValue(x, dockXs, dockTol);
    const s = dock ?? snapValue(x, lines.xs, tol);
    if (s !== null) { w += x - s; x = s; }
  }
  if (h.includes('e')) {
    const dock = snapValue(x + w, dockXs, dockTol);
    const s = dock ?? snapValue(x + w, lines.xs, tol);
    if (s !== null) w = s - x;
  }
  if (h.includes('n')) {
    const dock = snapValue(y, dockYs, dockTol);
    const s = dock ?? snapValue(y, lines.ys, tol);
    if (s !== null) { hh += y - s; y = s; }
  }
  if (h.includes('s')) {
    const dock = snapValue(y + hh, dockYs, dockTol);
    const s = dock ?? snapValue(y + hh, lines.ys, tol);
    if (s !== null) hh = s - y;
  }
  if (w < minSize) { if (h.includes('w')) x -= minSize - w; w = minSize; }
  if (hh < minSize) { if (h.includes('n')) y -= minSize - hh; hh = minSize; }
  room.x = x; room.y = y; room.w = w; room.h = hh;
}

// Привязка мебели к стенам: кромки/центр предмета липнут к граням стен.
export function snapItemToWalls(item) {
  const tol = 12 / state.view.scale;
  const lines = collectSnapLines(null);
  const rect = itemRect(item);
  const sx = snapValue(rect.x, lines.xs, tol);
  const ex = snapValue(rect.x + rect.w, lines.xs, tol);
  const cx = snapValue(item.x, lines.xs, tol);
  if (sx !== null) item.x += sx - rect.x;
  else if (ex !== null) item.x += ex - (rect.x + rect.w);
  else if (cx !== null) item.x = cx;
  const r2 = itemRect(item);
  const sy = snapValue(r2.y, lines.ys, tol);
  const ey = snapValue(r2.y + r2.h, lines.ys, tol);
  const cy = snapValue(item.y, lines.ys, tol);
  if (sy !== null) item.y += sy - r2.y;
  else if (ey !== null) item.y += ey - (r2.y + r2.h);
  else if (cy !== null) item.y = cy;
}

export function resizeVerdict(room) {
  const verdict = validateRoomPlacement(state.project, room, room.id);
  if (!verdict.ok) return verdict;
  for (const child of state.project.rooms) {
    if (child.parentId !== room.id) continue;
    const childVerdict = validateRoomPlacement(state.project, child, child.id);
    if (!childVerdict.ok) return { ok: false, reason: `«${child.name}» перестаёт помещаться: ${childVerdict.reason}` };
  }
  return { ok: true };
}

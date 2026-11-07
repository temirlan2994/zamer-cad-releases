// Привязки и проверки при изменении размеров комнат и мебели.

import { gridStepForScale, isShaft } from '../core/catalog.js';
import { itemRect } from '../core/furnish.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, validateRoomPlacement } from '../core/rooms.js';
import { wallSnapCoords } from '../core/walls.js';
import { state } from './state.js';

// Линии привязки: грани стен и кромки других комнат.
// exclude — id комнаты или Set id (растягиваемая + попутчики общей стены).
function collectSnapLines(exclude) {
  const xs = [];
  const ys = [];
  const skip = exclude instanceof Set ? exclude : new Set(exclude ? [exclude] : []);
  for (const wall of state.walls) {
    // Не привязываем редактируемое помещение к его же общей стене: иначе
    // после первого соединения ручка липнет к старому положению и двигается
    // ступенями.
    if (wall.rooms?.some((id) => skip.has(id))) continue;
    const c = wallSnapCoords(wall);
    xs.push(...c.xs);
    ys.push(...c.ys);
  }
  for (const r of state.project.rooms) {
    if (skip.has(r.id)) continue;
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { xs, ys };
}

// Шаг привязки по текущему приближению камеры (мельче при крупном плане).
export function gridStep() {
  return gridStepForScale(state.view?.scale);
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
  const grid = gridStep();
  const snap = (v) => Math.round(v / grid) * grid;
  const h = dragState.handle;
  const minSize = isShaft(room) ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE;
  let { x, y, w, h: hh } = start;
  if (h.includes('w')) { const nx = snap(start.x + dx); w = start.x + start.w - nx; x = nx; }
  if (h.includes('e')) { w = snap(start.w + dx); }
  if (h.includes('n')) { const ny = snap(start.y + dy); hh = start.y + start.h - ny; y = ny; }
  if (h.includes('s')) { hh = snap(start.h + dy); }
  // Привязка подвижной грани к стенам/кромкам соседних комнат.
  const tol = 14 / state.view.scale;
  // Shift — без магнита: только сетка.
  if (dragState.noSnap) {
    if (w < minSize) { if (h.includes('w')) x -= minSize - w; w = minSize; }
    if (hh < minSize) { if (h.includes('n')) y -= minSize - hh; hh = minSize; }
    room.x = x; room.y = y; room.w = w; room.h = hh;
    return;
  }
  // Стыковка к соседним блокам — магнит блоков (ui/block-gesture.js,
  // core/v7/magnet.js) поверх этого результата; здесь — линии стен и кромок.
  const lines = dragState.snapLines || (dragState.snapLines = collectSnapLines(
    new Set([room.id, ...(dragState.follow || []).map((f) => f.id)])));
  if (h.includes('w')) {
    const s = snapValue(x, lines.xs, tol);
    if (s !== null) { w += x - s; x = s; }
  }
  if (h.includes('e')) {
    const s = snapValue(x + w, lines.xs, tol);
    if (s !== null) w = s - x;
  }
  if (h.includes('n')) {
    const s = snapValue(y, lines.ys, tol);
    if (s !== null) { hh += y - s; y = s; }
  }
  if (h.includes('s')) {
    const s = snapValue(y + hh, lines.ys, tol);
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

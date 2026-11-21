// Инструмент «Стена»: ручные стены кликами по осям (core/wall-manual.js).
// Клик — начало, следующий клик — конец стены и начало следующей (цепочка).
// Ось свободная, как у линии ZamerCAD; F8/Ctrl включают орто, полярка и
// объектные привязки работают через общий core/draw-snap.js.
// Esc, Enter, двойной клик или клик в ту же точку — конец цепочки.

import { addManualWall, wallAxisVerdict } from '../core/wall-manual.js';
import { createLoopRoom, findLoopAt, splitRoomByWall } from '../core/bound-rooms.js';
import { wallClassThickness, wallRects } from '../core/walls.js';
import { toast } from './dom.js';
import { gridStep } from './snap.js';
import { massSnapPoints } from './plan-masses.js';
import { gridSnapPoints } from './plan-grids.js';
import { clearDrawSnap, snapAt } from './draw-snap-ui.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

const HINT_START = 'Стена: укажите начало · свободный угол · F8 — орто · Shift — без привязок';
const HINT_NEXT = 'Стена: укажите конец · F8/Ctrl — орто · число — длина, Tab — угол · Enter/Esc — закончить';

export function startWallTool() {
  if (state.modeName !== 'plan') return;
  setTool({
    kind: 'wall', start: null, cursor: null,
    thickness: wallClassThickness(state.project.settings, 'partition'), wallType: 'partition', justify: 'center',
    count: 0,
  }, HINT_START);
  state.selection = null;
}

function snapped(plan, event) {
  const t = state.tool;
  const shapes = [];
  for (const wall of state.walls || []) {
    if (wall.hidden) continue;
    if (wall.polys?.length) for (const poly of wall.polys) shapes.push({ points: poly, closed: true });
    else for (const r of wallRects(wall)) shapes.push({
      points: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], closed: true,
    });
    if (wall.center) shapes.push({
      points: [{ x: wall.center.x1, y: wall.center.y1 }, { x: wall.center.x2, y: wall.center.y2 }], closed: false,
    });
  }
  for (const wall of state.project.walls || []) shapes.push({ points: [wall.axis.a, wall.axis.b], closed: false });
  return snapAt(plan, event, {
    prev: t.start, points: [...massSnapPoints(), ...gridSnapPoints()], extraShapes: shapes, grid: gridStep(),
  });
}

// Предпросмотр под курсором.
export function wallToolHover(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'wall') return;
  const s = snapped(plan, event);
  t.cursor = s.point;
  state.gridSnapTag = s.label ? { x: s.point.x, y: s.point.y, text: s.label } : null;
  t.valid = t.start ? wallAxisVerdict(t.start, s.point).ok : true;
  requestDraw();
}

// Клик/тап: начало оси или конец очередной стены цепочки.
export function wallToolClick(plan, event, { exact = false } = {}) {
  const t = state.tool;
  if (t?.kind !== 'wall') return;
  const p = exact ? plan : snapped(plan, event).point;
  if (!t.start) {
    t.start = p;
    t.cursor = p;
    setHint(HINT_NEXT);
    requestDraw();
    return;
  }
  if (Math.hypot(p.x - t.start.x, p.y - t.start.y) < 1) { finishWallChain(); return; }
  const verdict = wallAxisVerdict(t.start, p);
  if (!verdict.ok) { toast(verdict.reason, true); return; }
  const a = t.start;
  mutate(() => {
    addManualWall(state.project, a, p, { thickness: t.thickness, wallType: t.wallType, justify: t.justify });
  });
  t.count += 1;
  t.start = p; // цепочка: следующая стена от конца предыдущей
  requestDraw();
}

// ---------------------------------------------------------------- Помещение из петли стен
//
// Инструмент «Помещение» (core/bound-rooms.js): клик внутри замкнутой петли
// ручных стен превращает её в обычную комнату — стены петли становятся
// стенами комнаты (толщина, класс, проёмы сохраняются).

const HINT_ROOM = 'Помещение: кликните внутри замкнутой петли стен · Esc — отмена';

export function startBoundRoomTool() {
  if (state.modeName !== 'plan') return;
  setTool({ kind: 'bound-room', preview: null, reason: null }, HINT_ROOM);
  state.selection = null;
}

export function boundRoomHover(plan) {
  const t = state.tool;
  if (t?.kind !== 'bound-room') return;
  const found = findLoopAt(state.project, state.walls || [], plan);
  t.preview = found.ok ? found.shape : null;
  t.reason = found.ok ? null : found.reason;
  requestDraw();
}

export function boundRoomClick(plan) {
  const t = state.tool;
  if (t?.kind !== 'bound-room') return;
  let res = null;
  const found = findLoopAt(state.project, state.walls || [], plan);
  if (!found.ok) { toast(found.reason, true); return; }
  mutate(() => { res = createLoopRoom(state.project, state.walls || [], plan); });
  if (!res?.ok) { toast(res?.reason || 'Помещение не создано', true); return; }
  cancelTool();
  selectObject({ type: 'room', id: res.room.id });
  toast(`Помещение «${res.room.name}» создано из стен · тип и имя — в свойствах${res.lost.length ? ` · проёмов без места: ${res.lost.length}` : ''}`);
}

// «Разделить на два»: комната по ручной стене → две комнаты.
export function splitByWallAction(roomId, wallId) {
  let res = null;
  mutate(() => { res = splitRoomByWall(state.project, state.walls || [], roomId, wallId); });
  if (!res?.ok) { toast(res?.reason || 'Разделить не получилось', true); return; }
  selectObject({ type: 'room', id: res.roomIds[1] });
  toast(`Комната разделена на две${res.lost.length ? ` · проёмов удалено: ${res.lost.length}` : ''} · Ctrl+Z — отменить`);
}

// Конец цепочки: инструмент выключается, последняя стена выбирается.
export function finishWallChain() {
  const t = state.tool;
  if (t?.kind !== 'wall') return false;
  const made = t.count;
  clearDrawSnap();
  cancelTool();
  const last = state.project.walls?.[state.project.walls.length - 1];
  if (made && last) {
    selectObject({ type: 'wall', key: `m|${last.id}` });
    toast(`Стен построено: ${made} · Ctrl+Z — отменить последнюю`);
  }
  return true;
}

// Инструмент «Стена»: ручные стены кликами по осям (core/wall-manual.js).
// Клик — начало, следующий клик — конец стены и начало следующей (цепочка).
// Ось всегда ортогональна; привязка к граням/углам стен, осям и торцам
// ручных стен, иначе к сетке; Shift — без привязки (только орто).
// Esc, Enter, двойной клик или клик в ту же точку — конец цепочки.

import { addManualWall, snapWallPoint, wallAxisVerdict } from '../core/wall-manual.js';
import { createLoopRoom, findLoopAt, splitRoomByWall } from '../core/bound-rooms.js';
import { wallClassThickness } from '../core/walls.js';
import { toast } from './dom.js';
import { gridStep } from './snap.js';
import { massSnapPoints } from './plan-masses.js';
import { gridPointTol, gridSnapPoints } from './plan-grids.js';
import { wallCenterSnapOpts } from './block-gesture.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

const HINT_START = 'Стена: кликните начало оси · Shift — без привязки · Esc — отмена';
const HINT_NEXT = 'Стена: кликните конец (цепочка продолжится) · двойной клик, Enter или Esc — закончить';

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
  return snapWallPoint({
    p: plan,
    prev: t.start,
    walls: state.walls || [],
    manual: state.project.walls || [],
    points: massSnapPoints(), // вершины эскиза масс
    gridPoints: gridSnapPoints(), gridTol: gridPointTol(), // координационные оси: концы и линия — на ось, пересечение — угол
    tol: 12 / state.view.scale,
    grid: gridStep(),
    free: Boolean(event?.shiftKey),
    ...wallCenterSnapOpts(event), // центр стены и середина стены (Alt — без них)
  });
}

// Предпросмотр под курсором.
export function wallToolHover(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'wall') return;
  const s = snapped(plan, event);
  t.cursor = s.point;
  t.snapX = s.snapX;
  t.snapY = s.snapY;
  state.gridSnapTag = s.label ? { x: s.point.x, y: s.point.y, text: s.label } : null; // «центр стены»
  t.valid = t.start ? wallAxisVerdict(t.start, s.point).ok : true;
  requestDraw();
}

// Клик/тап: начало оси или конец очередной стены цепочки.
export function wallToolClick(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'wall') return;
  const p = snapped(plan, event).point;
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
  cancelTool();
  const last = state.project.walls?.[state.project.walls.length - 1];
  if (made && last) {
    selectObject({ type: 'wall', key: `m|${last.id}` });
    toast(`Стен построено: ${made} · Ctrl+Z — отменить последнюю`);
  }
  return true;
}

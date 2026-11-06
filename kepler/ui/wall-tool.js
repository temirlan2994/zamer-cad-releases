// Инструмент «Стена»: ручные стены кликами по осям (core/wall-manual.js).
// Клик — начало, следующий клик — конец стены и начало следующей (цепочка).
// Ось всегда ортогональна; привязка к граням/углам стен, осям и торцам
// ручных стен, иначе к сетке; Shift — без привязки (только орто).
// Esc, Enter, двойной клик или клик в ту же точку — конец цепочки.

import { addManualWall, snapWallPoint, wallAxisVerdict } from '../core/wall-manual.js';
import { wallClassThickness } from '../core/walls.js';
import { toast } from './dom.js';
import { gridStep } from './snap.js';
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
    tol: 12 / state.view.scale,
    grid: gridStep(),
    free: Boolean(event?.shiftKey),
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

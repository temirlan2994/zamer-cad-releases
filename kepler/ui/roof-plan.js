// «План крыши» (вид в дереве «Виды», ключ 'roofplan'): режим «План», где
// видны и правятся только крыши-плиты (core/roofs.js); этажи — бледная
// неинтерактивная подложка (ui/render-roofs.js drawRoofPlan). На обычном
// плане этажа крыши не рисуются и клики не ловят.
//
// Здесь: вход/выход (setRoofPlan), наведение, жесты мыши/пальца и двойной
// клик — как у помещения: тянуть крышу — перенос, квадраты — вершины,
// кружки на рёбрах — сдвиг ребра (Г, П-формы), двойной клик по ребру —
// новая вершина (деление ребра), по вершине — удалить; синие точки — вынос
// от контура. Привязка — к линиям (грани других крыш и масс, оси, грани
// помещений всех этажей — только геометрия, не связь), иначе шаг по зуму;
// Shift — без привязки. Жест — одна запись истории, Esc — отмена.
// Инструмент «Крыша» (K): протянуть прямоугольник или клик по помещению
// подложки — новая крыша по его форме.

import {
  applyRoofOutlineHandle, boxOutline, createRoof, dragOverhang, insertRoofVertex, moveRoof, nearestOutlineEdge,
  removeRoofVertex, roofFromRooms, roofRects, roofSnapLines, snapCoord, snapRoofMove,
} from '../core/roofs.js';
import { massBox } from '../core/masses.js';
import { isShaft } from '../core/catalog.js';
import { roomContainsPoint } from '../core/room-shape.js';
import { canvas, toast } from './dom.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, restoreFrom, snapshot } from './store.js';
import { renderProps } from './props.js';
import { cancelTool, selectObject, setHint } from './tools.js';
import { requestDraw } from './view.js';
import { drawnRoofHandles, isRoofPlan, roofById, roofs, selectedRoof } from './plan-roofs.js';
import { addRoof, roofSnapper, setRoofs, topLevelId, updateRoof } from './roofs.js';

export const ROOF_PLAN_HINT = 'План крыши: тяните крышу — перенос · квадраты — вершины, кружки — рёбра · двойной клик по ребру — новая вершина, по вершине — удалить · K — новая крыша';
const MIN_SIDE = 500; // мм — наименьшая сторона нарисованной крыши

export { isRoofPlan };

// Включить/выключить «План крыши» (режим «План» уже открыт).
export function setRoofPlan(on) {
  const next = Boolean(on);
  if (Boolean(state.roofPlan) === next) return;
  state.roofPlan = next;
  cancelTool();
  if (state.selection?.type !== 'roof' || !next) state.selection = null;
  state.hover = null;
  state.roofLabel = null;
  document.body.classList.toggle('mode-roofplan', next);
  setHint(next ? ROOF_PLAN_HINT : '');
  renderProps();
  requestDraw();
}

// ---------------------------------------------------------------- попадание

const tolPx = (event) => (event?.pointerType === 'touch' || event?.pointerType === 'pen' ? 20 : 10);

// Ручка выбранной крыши под курсором (экран): вершина важнее середины ребра,
// та — точки выноса.
export function roofHandleAt(screen, event = null) {
  if (!screen) return null;
  const r = tolPx(event);
  const rank = { vertex: 0, edge: 1, overhang: 2 };
  let best = null; let bd = Infinity;
  for (const h of drawnRoofHandles()) {
    const d = Math.hypot(h.s.x - screen.x, h.s.y - screen.y);
    if (d > r) continue;
    const score = d + rank[h.kind] * 4;
    if (score < bd) { bd = score; best = h; }
  }
  return best;
}

// Крыша под точкой (плита с выносом), верхняя — последняя в списке.
export function roofBodyAt(plan) {
  const tol = 4 / (state.view?.scale || 1);
  const list = roofs();
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const r = list[i];
    if (roofRects(state.project, r).some((b) => plan.x >= b.x0 - tol && plan.x <= b.x1 + tol && plan.y >= b.y0 - tol && plan.y <= b.y1 + tol)) return r;
  }
  return null;
}

// Помещение подложки под точкой — с верхнего этажа вниз → { levelId, roomId }.
export function underlayRoomAt(plan) {
  const levels = [...(state.project.levels || [])].sort((a, b) => b.elevation - a.elevation);
  for (const l of levels) {
    const room = (l.rooms || []).filter((r) => !isShaft(r)).reverse().find((r) => roomContainsPoint(r, plan.x, plan.y));
    if (room) return { levelId: l.id, roomId: room.id };
  }
  return null;
}

// ---------------------------------------------------------------- привязки

function snapLines(skipId) {
  return roofSnapLines(state.project, skipId, massBox, { geometry: true });
}
const tolMm = () => 12 / (state.view?.scale || 1);

function snapPoint(plan, event, skipId = null) {
  if (event?.shiftKey) return { x: Math.round(plan.x), y: Math.round(plan.y), snapped: false };
  const lines = snapLines(skipId);
  const step = gridStep();
  const sx = snapCoord(plan.x, lines.xs, tolMm(), step);
  const sy = snapCoord(plan.y, lines.ys, tolMm(), step);
  return { x: sx.value, y: sy.value, snapped: sx.snapped || sy.snapped };
}

const fmtM = (v) => (Math.abs(v) / 1000).toFixed(2);

// ---------------------------------------------------------------- наведение

export function roofPlanHover(plan, screen, event) {
  const t = state.tool;
  if (t?.kind === 'roof') {
    const next = underlayRoomAt(plan);
    t.hover = next;
    t.cursor = snapPoint(plan, event);
    if (canvas?.style) canvas.style.cursor = 'crosshair';
    requestDraw();
    return;
  }
  const h = roofHandleAt(screen, event);
  const body = h ? null : roofBodyAt(plan);
  if (canvas?.style) {
    canvas.style.cursor = h ? (h.kind === 'vertex' ? 'move' : 'grab') : body ? 'move' : 'default';
  }
  const next = body ? { type: 'roof', id: body.id } : null;
  if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
}

// ---------------------------------------------------------------- жесты

// Нажатие на «Плане крыши» → жест (input.js ведёт его) или панорама.
export function roofPlanPointerDown(event, screen, plan) {
  const t = state.tool;
  if (t?.kind === 'roof') {
    const a = snapPoint(plan, event);
    t.draw = { a, b: a };
    t.hover = underlayRoomAt(plan); // касание: наведения не было
    return { kind: 'roofplan-draw', screen0: screen, moved: false };
  }
  const roof = selectedRoof();
  const h = roof ? roofHandleAt(screen, event) : null;
  if (roof && h) {
    const base = { id: roof.id, start: structuredClone(roof), plan0: { x: plan.x, y: plan.y }, screen0: screen, before: snapshot(), moved: false };
    if (h.kind === 'overhang') return { ...base, kind: 'roofplan-overhang', sides: h.sides };
    return { ...base, kind: 'roofplan-shape', handle: { id: h.id, kind: h.kind, index: h.index } };
  }
  const body = roofBodyAt(plan);
  if (body) {
    selectObject({ type: 'roof', id: body.id });
    return {
      kind: 'roofplan-move', id: body.id, start: structuredClone(body), plan0: { x: plan.x, y: plan.y },
      screen0: screen, before: snapshot(), moved: false,
    };
  }
  if (state.selection) selectObject(null);
  return { kind: 'pan', start: screen, view: { ...state.view } };
}

const putRoof = (next) => setRoofs(roofs().map((x) => (x.id === next.id ? next : x)));
const farEnough = (drag, screen) => drag.moved || Math.hypot(screen.x - drag.screen0.x, screen.y - drag.screen0.y) >= 3;

export function roofPlanDragMove(drag, plan, screen, event) {
  if (drag.kind === 'roofplan-draw') {
    const t = state.tool;
    if (!t?.draw) return;
    if (farEnough(drag, screen)) drag.moved = true;
    t.draw.b = snapPoint(plan, event);
    const w = t.draw.b.x - t.draw.a.x; const h = t.draw.b.y - t.draw.a.y;
    state.roofLabel = drag.moved ? { x: plan.x, y: plan.y, text: `${fmtM(w)} × ${fmtM(h)} м` } : null;
    requestDraw();
    return;
  }
  if (!farEnough(drag, screen)) return;
  const start = drag.start;
  if (drag.kind === 'roofplan-move') {
    const raw = { dx: plan.x - drag.plan0.x, dy: plan.y - drag.plan0.y };
    const lines = event?.shiftKey ? { xs: [], ys: [] } : snapLines(drag.id);
    const s = snapRoofMove(start, raw.dx, raw.dy, event?.shiftKey ? { step: 0 } : { ...lines, tol: tolMm(), step: gridStep() });
    putRoof(moveRoof(start, s.dx, s.dy));
    drag.moved = s.dx !== 0 || s.dy !== 0 || drag.moved;
    state.roofLabel = { x: plan.x, y: plan.y, text: `сдвиг ${s.dx} × ${s.dy} мм${s.snapped ? ' · по грани' : ''}` };
  } else if (drag.kind === 'roofplan-shape') {
    const p = snapPoint(plan, event, drag.id);
    const next = applyRoofOutlineHandle(start, drag.handle, p, { mergeTolerance: event?.shiftKey ? 0 : tolMm() });
    if (next) {
      putRoof(next);
      drag.moved = true;
      const xs = next.outline.map((q) => q.x); const ys = next.outline.map((q) => q.y);
      state.roofLabel = { x: plan.x, y: plan.y, text: `${fmtM(Math.max(...xs) - Math.min(...xs))} × ${fmtM(Math.max(...ys) - Math.min(...ys))} м${p.snapped ? ' · по грани' : ''}` };
    }
  } else if (drag.kind === 'roofplan-overhang') {
    const snap = roofSnapper(start, event, state.view.scale) || ((s, raw) => ({ value: Math.round(raw), label: null }));
    const { roof, labels } = dragOverhang(start, drag.sides, plan.x - drag.plan0.x, plan.y - drag.plan0.y, snap);
    putRoof(roof);
    drag.moved = JSON.stringify(roof.overhang) !== JSON.stringify(start.overhang);
    const val = drag.sides.map((s) => roof.overhang[s]);
    state.roofLabel = { x: plan.x, y: plan.y, text: `вынос ${val.join(' / ')} мм${labels.length ? ` · ${labels[0]}` : ''}` };
  }
  requestDraw();
}

export function roofPlanDragEnd(drag) {
  state.roofLabel = null;
  if (drag.kind === 'roofplan-draw') {
    const t = state.tool;
    const d = t?.draw;
    if (t) t.draw = null;
    if (!d) { requestDraw(); return; }
    let roof;
    if (drag.moved) {
      const b = { x0: Math.min(d.a.x, d.b.x), y0: Math.min(d.a.y, d.b.y), x1: Math.max(d.a.x, d.b.x), y1: Math.max(d.a.y, d.b.y) };
      if (b.x1 - b.x0 < MIN_SIDE || b.y1 - b.y0 < MIN_SIDE) { toast(`Крыша меньше ${MIN_SIDE} мм — протяните больше`, true); requestDraw(); return; }
      roof = createRoof({ levelId: topLevelId(), outline: boxOutline(b) }, roofs());
    } else if (t?.hover) {
      roof = roofFromRooms(state.project, t.hover.levelId, [t.hover.roomId], {}, roofs());
    } else {
      toast('Протяните прямоугольник или кликните по помещению подложки');
      requestDraw();
      return;
    }
    if (!roof) { requestDraw(); return; }
    cancelTool();
    addRoof(roof);
    document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
    setHint(ROOF_PLAN_HINT);
    toast(`${roof.name}: тяните крышу, вершины и рёбра · «Свойства» — край, парапет, вынос`);
    renderProps();
    requestDraw();
    return;
  }
  if (!drag.moved) { requestDraw(); return; }
  refreshDerived();
  pushHistory(drag.before);
  afterChange();
}

export function roofPlanDragCancel(drag) {
  state.roofLabel = null;
  if (drag.kind === 'roofplan-draw') {
    if (state.tool) state.tool.draw = null;
    requestDraw();
    return;
  }
  if (drag.moved) restoreFrom(drag.before);
  if (roofById(drag.id)) selectObject({ type: 'roof', id: drag.id });
  requestDraw();
}

// Двойной клик: по вершине — удалить её, по ребру — новая вершина.
export function roofPlanDblClick(screen, plan) {
  if (state.tool) return;
  const roof = selectedRoof() || roofBodyAt(plan);
  if (!roof) return;
  if (!selectedRoof()) selectObject({ type: 'roof', id: roof.id });
  const h = roofHandleAt(screen);
  if (h?.kind === 'vertex') {
    const next = removeRoofVertex(roof, h.index);
    if (!next) { toast('Эту вершину не удалить: контур станет негодным (у прямоугольника — 4 вершины)', true); return; }
    updateRoof(roof.id, () => next);
    toast('Вершина удалена · Ctrl+Z — вернуть');
    return;
  }
  const e = nearestOutlineEdge(roof, plan);
  if (e.index < 0 || e.dist > tolPx() / (state.view?.scale || 1)) return;
  const next = insertRoofVertex(roof, e.index, plan);
  if (!next) { toast('Слишком близко к вершине', true); return; }
  updateRoof(roof.id, () => next);
  toast('Ребро разделено — тяните половину ребра (кружок) или новую вершину');
}

// Сменился вид (дерево видов, этаж, инструмент плана): перерисовать холст,
// подсказка «Плана крыши» уходит вместе с ним.
document.addEventListener('kepler:view', () => {
  if (!isRoofPlan() && document.getElementById('canvasHint')?.textContent === ROOF_PLAN_HINT) setHint('');
  requestDraw();
});

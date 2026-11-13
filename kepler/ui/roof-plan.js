// «План крыши» (вид в дереве «Виды», ключ 'roofplan'): режим «План», где
// видны и правятся только крыши-плиты (core/roofs.js); этажи — бледная
// неинтерактивная подложка (ui/render-roofs.js drawRoofPlan). На обычном
// плане этажа крыши не рисуются и клики не ловят.
//
// Здесь: вход/выход (setRoofPlan), наведение, жесты мыши/пальца и двойной
// клик — как у стены помещения: тянуть крышу — перенос; кружки на рёбрах —
// сдвиг ребра целиком (соседи удлиняются); тянуть ребро за любое другое
// место — эта часть ребра (от точки до ближнего конца) уходит уступом (Г,
// П, Т-формы); клик по ребру — излом (малый квадрат), дальше тянуть часть
// ребра между изломами или сам излом; квадраты — вершины, тянутся свободно
// (косые рёбра: трапеция, ромб), притягиваясь к x/y других вершин (прямой
// угол), Alt — оба ребра параллельно (прямые углы сохраняются); двойной
// клик по вершине — удалить, по ребру — излом; синие точки — вынос от
// контура. Привязка — к линиям (грани других крыш и масс, оси, грани
// помещений всех этажей — только геометрия, не связь), иначе шаг по зуму;
// Shift — без привязки. Жест — одна запись истории, Esc — отмена.
// Инструмент «Крыша» (K): протянуть прямоугольник, клик по помещению
// подложки — новая крыша по его форме; клик мимо помещений или Alt+клик —
// контур по точкам (замкнуть — клик по первой точке, Enter или двойной
// клик; Backspace — убрать точку, Esc — бросить; отрезок у оси липнет к ней).

import {
  applyRoofOutlineHandle, boxOutline, createRoof, dragOverhang, insertRoofVertex, moveRoof, nearestOutlineEdge,
  pointInOutline, pushRoofEdgePart, removeRoofVertex, roofFromRooms, roofIsSlanted, roofRects, roofSlabOutline,
  roofSnapLines, snapCoord, snapRoofMove, tidyOutline, validOutline,
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
import { planToScreen, requestDraw } from './view.js';
import { drawnRoofHandles, isRoofPlan, roofById, roofs, selectedRoof } from './plan-roofs.js';
import { ROOF_DRAW_HINT, addRoof, roofSnapper, setRoofs, topLevelId, updateRoof } from './roofs.js';

export const ROOF_PLAN_HINT = 'План крыши: тяните крышу — перенос · ребро за любое место — уступ, кружок — всё ребро · клик по ребру — излом · вершины — свободно (Alt — прямые углы) · двойной клик по вершине — удалить · K — новая крыша';
export const ROOF_POLY_HINT = 'Контур крыши: клики по точкам · замкнуть — клик по первой точке, Enter или двойной клик · Backspace — убрать точку · Shift — без привязки · Esc — бросить';
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
    if (roofIsSlanted(r)) {
      if (pointInOutline(roofSlabOutline(state.project, r), plan.x, plan.y)) return r;
      continue;
    }
    if (roofRects(state.project, r).some((b) => plan.x >= b.x0 - tol && plan.x <= b.x1 + tol && plan.y >= b.y0 - tol && plan.y <= b.y1 + tol)) return r;
  }
  return null;
}

// Ребро контура выбранной крыши под курсором (не у ручки) → { index, at }.
export function roofEdgeAt(roof, plan, event = null) {
  if (!roof) return null;
  const e = nearestOutlineEdge(roof, plan);
  if (e.index < 0 || e.dist > tolPx(event) / (state.view?.scale || 1)) return null;
  return { index: e.index, at: { x: plan.x, y: plan.y } };
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
    const next = t.poly ? null : underlayRoomAt(plan);
    t.hover = next;
    t.cursor = t.poly ? polySnap(t, plan, event) : snapPoint(plan, event);
    t.closeHot = closesPoly(t, screen);
    if (canvas?.style) canvas.style.cursor = 'crosshair';
    requestDraw();
    return;
  }
  const h = roofHandleAt(screen, event);
  const edge = h ? null : roofEdgeAt(selectedRoof(), plan, event);
  const body = h ? null : roofBodyAt(plan);
  if (canvas?.style) {
    canvas.style.cursor = h ? (h.kind === 'vertex' ? 'move' : 'grab') : edge ? 'copy' : body ? 'move' : 'default';
  }
  const next = body ? { type: 'roof', id: body.id } : null;
  if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
}

// ---------------------------------------------------------------- жесты

// Нажатие на «Плане крыши» → жест (input.js ведёт его) или панорама.
export function roofPlanPointerDown(event, screen, plan) {
  const t = state.tool;
  if (t?.kind === 'roof') {
    if (t.poly) return { kind: 'roofplan-poly', screen0: screen, plan: { x: plan.x, y: plan.y }, shift: Boolean(event?.shiftKey), moved: false };
    const a = snapPoint(plan, event);
    t.draw = { a, b: a };
    t.hover = event?.altKey ? null : underlayRoomAt(plan); // касание: наведения не было
    return { kind: 'roofplan-draw', screen0: screen, plan: { x: plan.x, y: plan.y }, alt: Boolean(event?.altKey), moved: false };
  }
  const roof = selectedRoof();
  const h = roof ? roofHandleAt(screen, event) : null;
  if (roof && h) {
    const base = { id: roof.id, start: structuredClone(roof), plan0: { x: plan.x, y: plan.y }, screen0: screen, before: snapshot(), moved: false };
    if (h.kind === 'overhang') return { ...base, kind: 'roofplan-overhang', sides: h.sides };
    return { ...base, kind: 'roofplan-shape', handle: { id: h.id, kind: h.kind, index: h.index } };
  }
  const edge = roof ? roofEdgeAt(roof, plan, event) : null;
  if (edge) {
    return {
      kind: 'roofplan-break', id: roof.id, start: structuredClone(roof), index: edge.index, at: edge.at,
      plan0: { x: plan.x, y: plan.y }, screen0: screen, before: snapshot(), moved: false,
    };
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
  if (drag.kind === 'roofplan-poly') {
    const t = state.tool;
    if (t) { t.cursor = polySnap(t, plan, event); t.closeHot = closesPoly(t, screen); }
    drag.plan = { x: plan.x, y: plan.y };
    drag.shift = Boolean(event?.shiftKey);
    requestDraw();
    return;
  }
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
  } else if (drag.kind === 'roofplan-shape' || drag.kind === 'roofplan-break') {
    const p = snapPoint(plan, event, drag.id);
    const opts = { mergeTolerance: event?.shiftKey ? 0 : tolMm(), free: !event?.altKey };
    const next = drag.kind === 'roofplan-break'
      ? pushRoofEdgePart(start, drag.index, drag.at, p, { ...opts, minGap: minGap() })
      : applyRoofOutlineHandle(start, drag.handle, p, opts);
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
  if (drag.kind === 'roofplan-poly') {
    const t = state.tool;
    if (!t?.poly) { requestDraw(); return; }
    if (closesPoly(t, drag.screen0)) { finishRoofPoly(); return; }
    addPolyPoint(t, polySnap(t, drag.plan, { shiftKey: drag.shift }));
    return;
  }
  if (drag.kind === 'roofplan-break' && !drag.moved) {
    // Клик по ребру — излом (точка на прямой ребра).
    const next = insertRoofVertex(drag.start, drag.index, drag.at, minGap());
    if (!next) { toast('Слишком близко к вершине', true); requestDraw(); return; }
    updateRoof(drag.id, () => next);
    lastBreak = { id: drag.id, x: drag.at.x, y: drag.at.y, time: Date.now() };
    toast('Излом на ребре — тяните часть ребра или сам излом · двойной клик — убрать');
    return;
  }
  if (drag.kind === 'roofplan-draw') {
    const t = state.tool;
    const d = t?.draw;
    if (t) t.draw = null;
    if (!d) { requestDraw(); return; }
    let roof;
    if (!drag.moved && t && (drag.alt || !t.hover)) {
      // Клик мимо помещений (или Alt+клик) — начало контура по точкам.
      t.poly = [];
      t.hover = null;
      addPolyPoint(t, d.a);
      setHint(ROOF_POLY_HINT);
      return;
    }
    if (drag.moved) {
      const b = { x0: Math.min(d.a.x, d.b.x), y0: Math.min(d.a.y, d.b.y), x1: Math.max(d.a.x, d.b.x), y1: Math.max(d.a.y, d.b.y) };
      if (b.x1 - b.x0 < MIN_SIDE || b.y1 - b.y0 < MIN_SIDE) { toast(`Крыша меньше ${MIN_SIDE} мм — протяните больше`, true); requestDraw(); return; }
      roof = createRoof({ levelId: topLevelId(), outline: boxOutline(b) }, roofs());
    } else if (t?.hover) {
      roof = roofFromRooms(state.project, t.hover.levelId, [t.hover.roomId], {}, roofs());
    } else {
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
  if (drag.kind === 'roofplan-draw' || drag.kind === 'roofplan-poly') {
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
  if (state.tool?.kind === 'roof' && state.tool.poly) {
    // Двойной клик поставил две одинаковые точки — лишняя уходит, контур замыкается.
    finishRoofPoly();
    return;
  }
  if (state.tool) return;
  const roof = selectedRoof() || roofBodyAt(plan);
  if (!roof) return;
  if (!selectedRoof()) selectObject({ type: 'roof', id: roof.id });
  const h = roofHandleAt(screen);
  // Двойной клик по ребру: первый клик уже поставил излом — он остаётся.
  const fresh = lastBreak && lastBreak.id === roof.id && Date.now() - lastBreak.time < 700
    && Math.hypot(plan.x - lastBreak.x, plan.y - lastBreak.y) <= tolPx() / (state.view?.scale || 1);
  lastBreak = null;
  if (fresh) return;
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

// ---------------------------------------------------------------- контур по точкам

let lastBreak = null; // { id, x, y, time } — излом от последнего клика по ребру
const minGap = () => Math.max(100, 8 / (state.view?.scale || 1));

// Точка контура: привязка (линии, шаг); отрезок почти по оси от предыдущей
// точки (или к первой) — ровно по оси; Shift — как есть.
function polySnap(t, plan, event) {
  const p = snapPoint(plan, event);
  const last = t.poly?.at(-1);
  if (!last || event?.shiftKey) return p;
  const tol = tolMm();
  if (Math.abs(p.x - last.x) <= tol) p.x = last.x;
  if (Math.abs(p.y - last.y) <= tol) p.y = last.y;
  const first = t.poly[0];
  if (t.poly.length >= 2) {
    if (Math.abs(p.x - first.x) <= tol) p.x = first.x;
    if (Math.abs(p.y - first.y) <= tol) p.y = first.y;
  }
  return p;
}

// Курсор у первой точки (≥ 3 точек) — клик замыкает.
function closesPoly(t, screen) {
  if (!t?.poly || t.poly.length < 3 || !screen) return false;
  const s = planToScreen(t.poly[0].x, t.poly[0].y);
  return Math.hypot(s.x - screen.x, s.y - screen.y) <= 12;
}

function addPolyPoint(t, p) {
  const last = t.poly.at(-1);
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) t.poly.push({ x: Math.round(p.x), y: Math.round(p.y) });
  t.cursor = { x: p.x, y: p.y };
  requestDraw();
}

// Замкнуть контур → новая крыша (негодный контур — сообщение, точки остаются).
export function finishRoofPoly() {
  const t = state.tool;
  if (t?.kind !== 'roof' || !t.poly) return false;
  const pts = tidyOutline(t.poly);
  if (pts.length < 3 || !validOutline(pts)) {
    toast(pts.length < 3 ? 'Нужно не меньше трёх точек' : 'Контур пересекает сам себя или слишком мал', true);
    requestDraw();
    return true;
  }
  const roof = createRoof({ levelId: topLevelId(), outline: pts }, roofs());
  if (!roof) return true;
  cancelTool();
  addRoof(roof);
  document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
  setHint(ROOF_PLAN_HINT);
  toast(`${roof.name}: контур по точкам · тяните вершины и рёбра`);
  renderProps();
  requestDraw();
  return true;
}

// Клавиши контура по точкам: Enter — замкнуть, Backspace — убрать точку,
// Esc — бросить контур (инструмент остаётся). → обработано ли.
export function roofPolyKey(event) {
  const t = state.tool;
  if (t?.kind !== 'roof' || !t.poly || !isRoofPlan()) return false;
  if (event.key === 'Enter') { finishRoofPoly(); return true; }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    t.poly.pop();
    if (!t.poly.length) { t.poly = null; setHint(ROOF_DRAW_HINT); }
    requestDraw();
    return true;
  }
  if (event.key === 'Escape') {
    t.poly = null;
    t.closeHot = false;
    setHint(ROOF_DRAW_HINT);
    requestDraw();
    return true;
  }
  return false;
}

// Сменился вид (дерево видов, этаж, инструмент плана): перерисовать холст,
// подсказка «Плана крыши» уходит вместе с ним.
document.addEventListener('kepler:view', () => {
  if (!isRoofPlan() && document.getElementById('canvasHint')?.textContent === ROOF_PLAN_HINT) setHint('');
  requestDraw();
});

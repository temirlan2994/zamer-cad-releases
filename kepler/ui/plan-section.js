// Разрезы по линии на плане этажа (как в Revit): инструмент «Разрез» (S),
// линия разреза на плане (штрихпунктир, «головки» с номером и стрелкой
// взгляда), выбор, ручки концов и сдвиг линии, «Свойства» разреза.
// Модель — project.views (core/views.js, kind 'section'), построение вида —
// core/section.js, окно вида — ui/elevation-view.js.
//
// Инструмент: клик — начало, клик — конец (привязки как у стены: к граням и
// углам стен, иначе к сетке; Ctrl или «Орто» — ортогонально; Shift — без
// привязки), затем клик в сторону взгляда (стрелки идут за курсором) или
// Enter — сторона под курсором. Esc — отмена.

import { houseDepth, sectionFrame, sideOfPoint } from '../core/section.js';
import { HEAD_R } from './render-plan-section.js';
import {
  VIEW_SCALES, addSectionView, findView, removeView, viewScale,
} from '../core/views.js';
import { snapWallPoint } from '../core/wall-manual.js';
import { escapeHtml, toast } from './dom.js';
import { snapSettings } from './draw-snap-ui.js';
import { closeElevation, openElevation, openElevationId, refreshElevationView } from './elevation-view.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, snapshot } from './store.js';
import { renderToolOptions } from './props.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

const MIN_LEN = 300; // мм — короче линия разреза не бывает
const HINT_A = 'Разрез: кликните начало линии · Ctrl — орто, Shift — без привязки · Esc — отмена';
const HINT_B = 'Разрез: кликните конец линии · Esc — отмена';
const HINT_SIDE = 'Разрез: кликните с той стороны, куда смотреть (или Enter) · Esc — отмена';

export const isPlanSectionTool = () => state.tool?.kind === 'psec';

export function startPlanSectionTool() {
  if (state.modeName !== 'plan') return;
  setTool({ kind: 'psec', points: [], cursor: null, side: 1 }, HINT_A);
  state.selection = null;
}

export function togglePlanSectionTool() {
  if (isPlanSectionTool()) cancelTool(); else startPlanSectionTool();
}

function snapPoint(plan, event, prev) {
  const ortho = Boolean(prev) && Boolean(event?.ctrlKey || snapSettings().ortho);
  return snapWallPoint({
    p: plan, prev: ortho ? prev : null, walls: state.walls || [], manual: state.project.walls || [],
    tol: 12 / state.view.scale, grid: gridStep(), free: Boolean(event?.shiftKey),
  }).point;
}

export function planSectionHover(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'psec') return;
  if (t.points.length < 2) t.cursor = snapPoint(plan, event, t.points[0] || null);
  else {
    t.cursor = { x: plan.x, y: plan.y };
    t.side = sideOfPoint({ a: t.points[0], b: t.points[1] }, plan);
  }
  requestDraw();
}

export function planSectionClick(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'psec') return;
  if (t.points.length < 2) {
    const p = snapPoint(plan, event, t.points[0] || null);
    if (t.points.length === 1 && Math.hypot(p.x - t.points[0].x, p.y - t.points[0].y) < MIN_LEN) {
      toast(`Линия разреза короче ${MIN_LEN} мм`, true);
      return;
    }
    t.points.push(p);
    t.cursor = p;
    if (t.points.length === 2) t.side = sideOfPoint({ a: t.points[0], b: t.points[1] }, plan);
    setHint(t.points.length === 1 ? HINT_B : HINT_SIDE);
    renderToolOptions(true);
    requestDraw();
    return;
  }
  t.side = sideOfPoint({ a: t.points[0], b: t.points[1] }, plan);
  commitTool();
}

function commitTool() {
  const t = state.tool;
  if (t?.kind !== 'psec' || t.points.length < 2) return;
  const [a, b] = t.points;
  let view = null;
  mutate(() => {
    view = addSectionView(state.project, { levelId: state.project.activeLevel, a, b, side: t.side });
  });
  cancelTool();
  selectObject({ type: 'section', id: view.id });
  toast(`${view.name} создан · двойной клик по линии или пункт в «Видах» — открыть`);
}

// Enter — принять сторону под курсором. true — клавиша съедена.
export function handlePlanSectionKey(event) {
  if (!isPlanSectionTool()) return false;
  if (event.key === 'Enter') {
    if (state.tool.points.length === 2) commitTool();
    return true;
  }
  return false;
}

// ------------------------------------------------------------ выбор и ручки

function segDist(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// Что под курсором (экран): { id, part: 'a' | 'b' | 'move' | 'line' } или null.
export function hitPlanSection(screen) {
  if (state.modeName !== 'plan') return null;
  const tol = state.coarsePointer ? 12 : 6;
  const sel = state.selection?.type === 'section' ? state.selection.id : null;
  const ui = (state._planSecUI || []).filter((r) => r.bold);
  const s = ui.find((r) => r.id === sel);
  if (s) {
    const ht = tol + 4;
    if (Math.hypot(screen.x - s.A.x, screen.y - s.A.y) <= ht) return { id: s.id, part: 'a' };
    if (Math.hypot(screen.x - s.B.x, screen.y - s.B.y) <= ht) return { id: s.id, part: 'b' };
    if (Math.hypot(screen.x - s.M.x, screen.y - s.M.y) <= ht) return { id: s.id, part: 'move' };
  }
  let best = null;
  for (const r of ui) {
    let d = segDist(screen, r.A, r.B);
    for (const c of r.heads) d = Math.min(d, Math.max(0, Math.hypot(screen.x - c.x, screen.y - c.y) - HEAD_R));
    if (d <= tol && (!best || d < best.d)) best = { d, id: r.id };
  }
  return best ? { id: best.id, part: 'line' } : null;
}

// Нажатие на линию/ручку разреза: выбор и начало перетаскивания (drag) или null.
export function planSectionPointerDown(event, screen, plan) {
  const hit = hitPlanSection(screen);
  if (!hit) return null;
  const view = findView(state.project, hit.id);
  if (!view) return null;
  selectObject({ type: 'section', id: view.id });
  const base = { id: view.id, before: snapshot(), moved: false, start: structuredClone(view.line), plan0: { x: plan.x, y: plan.y } };
  if (hit.part === 'a' || hit.part === 'b') return { kind: 'psec-end', end: hit.part, ...base };
  return { kind: 'psec-move', ...base };
}

export function planSectionDragMove(drag, plan, event) {
  const view = findView(state.project, drag.id);
  if (!view) return;
  if (drag.kind === 'psec-end') {
    const other = drag.start[drag.end === 'a' ? 'b' : 'a'];
    const p = snapPoint(plan, event, other);
    if (Math.hypot(p.x - other.x, p.y - other.y) < MIN_LEN) return;
    view.line = { ...structuredClone(drag.start), [drag.end]: { x: Math.round(p.x), y: Math.round(p.y) } };
  } else {
    const g = event?.shiftKey ? 1 : gridStep();
    const dx = Math.round((plan.x - drag.plan0.x) / g) * g;
    const dy = Math.round((plan.y - drag.plan0.y) / g) * g;
    view.line = {
      a: { x: drag.start.a.x + dx, y: drag.start.a.y + dy },
      b: { x: drag.start.b.x + dx, y: drag.start.b.y + dy },
    };
  }
  drag.moved = view.line.a.x !== drag.start.a.x || view.line.a.y !== drag.start.a.y
    || view.line.b.x !== drag.start.b.x || view.line.b.y !== drag.start.b.y;
  requestDraw();
}

// Конец перетаскивания — одна запись истории.
export function planSectionDragEnd(drag) {
  if (!drag.moved) { requestDraw(); return; }
  pushHistory(drag.before);
  afterChange();
}

// Двойной клик по линии или головке — открыть вид. true — открыт.
export function planSectionDblClick(screen) {
  const hit = hitPlanSection(screen);
  if (!hit) return false;
  return openElevation(hit.id);
}

// Подсветка под курсором (без инструмента).
export function planSectionHoverTarget(screen) {
  const hit = hitPlanSection(screen);
  return hit ? { type: 'section', id: hit.id } : null;
}

// ------------------------------------------------------------ правка

export function flipSectionView(id) {
  const v = findView(state.project, id);
  if (!v || v.kind !== 'section') return;
  mutate(() => { v.side = v.side === -1 ? 1 : -1; });
  refreshElevationView();
}

export function deleteSectionView(id) {
  const v = findView(state.project, id);
  if (!v || v.kind !== 'section') return;
  if (openElevationId() === id) closeElevation();
  if (state.selection?.type === 'section' && state.selection.id === id) state.selection = null;
  mutate(() => { removeView(state.project, id); });
  selectObject(null);
  toast(`${v.name} удалён · Ctrl+Z — вернуть`);
}

function editSection(id, fn) {
  const v = findView(state.project, id);
  if (!v) return;
  mutate(() => fn(v));
  refreshElevationView();
}

// «Свойства» выбранной линии разреза.
export function renderSectionProps(panel, view) {
  const fr = sectionFrame(view);
  const level = state.project.levels.find((l) => l.id === view.levelId);
  const scale = viewScale(view);
  const auto = houseDepth(state.project, view);
  panel.innerHTML = `
    <h2>Разрез</h2>
    <p class="subtitle">${level ? `План «${escapeHtml(level.name)}» · ` : ''}линия ${fr ? (fr.len / 1000).toFixed(2) : '—'} м</p>
    <div class="prop-block" id="secProps">
      <label class="prop-field"><span>Название</span>
        <input id="secName" type="text" maxlength="40" value="${escapeHtml(view.name)}"></label>
      <button type="button" id="secFlip" title="Смотреть в другую сторону от линии">⇄ Развернуть</button>
      <label class="prop-field"><span>Глубина видимости, мм</span>
        <input id="secDepth" type="number" step="100" min="100" inputmode="numeric" value="${view.depth ?? ''}" placeholder="до габарита дома (${auto})"></label>
      <div class="prop-row"><span>Масштаб</span><strong>1:${scale}</strong></div>
      <div class="elev-scale" role="radiogroup" aria-label="Масштаб разреза">
        ${VIEW_SCALES.map((s) => `<button type="button" role="radio" data-sec-scale="${s}" aria-checked="${s === scale}"${s === scale ? ' class="active"' : ''}>1:${s}</button>`).join('')}
      </div>
      <button type="button" id="secOpen" class="primary">Открыть вид</button>
      <p class="hint">Тяните квадраты на концах — длина и угол линии, кружок посередине или саму линию — сдвиг. Двойной клик по линии — открыть вид.</p>
      <button type="button" id="secDelete" class="danger">Удалить разрез</button>
    </div>`;
  const id = view.id;
  panel.querySelector('#secName').addEventListener('change', (e) => {
    const name = String(e.target.value).trim();
    if (!name || name === view.name) { e.target.value = view.name; return; }
    editSection(id, (v) => { v.name = name; });
  });
  panel.querySelector('#secFlip').addEventListener('click', () => flipSectionView(id));
  panel.querySelector('#secDepth').addEventListener('change', (e) => {
    const d = Math.round(Number(String(e.target.value).replace(',', '.')));
    editSection(id, (v) => { if (Number.isFinite(d) && d > 0) v.depth = d; else delete v.depth; });
  });
  panel.querySelectorAll('[data-sec-scale]').forEach((b) => b.addEventListener('click', () => {
    const s = Number(b.dataset.secScale);
    if (s !== viewScale(view)) editSection(id, (v) => { v.scale = s; });
  }));
  panel.querySelector('#secOpen').addEventListener('click', () => openElevation(id));
  panel.querySelector('#secDelete').addEventListener('click', () => deleteSectionView(id));
}

// Координационные оси в редакторе (core/grid-axes.js): инструмент «Ось» (G),
// выбор и правка на плане, «Свойства» оси, команды «Оси по стенам»,
// «Удалить все оси». Рисование — ui/render-axes.js, настройки вида и цели
// привязки — ui/plan-grids.js.
//
// Инструмент: курсор ведёт призрак оси (вертикальная — по движению вдоль x,
// горизонтальная — вдоль y; Tab — сменить и закрепить), привязка к граням и
// углам стен, другим осям, иначе к шагу по зуму; Shift — без привязки; клик —
// ось с автономером; инструмент остаётся для серии; Esc — выйти.
//
// Выбор — state.selection = { type: 'grid', id }: клик по кружку или по
// линии вне комнат и стен (выбранную ось можно тянуть за линию где угодно).
// Перетаскивание линии двигает ось (по своему направлению), кружка — меняет
// длину (from/to). Один жест — одна запись истории.

import {
  createGrid, gridExtent, gridSegment, houseBox, moveGrid, nextGridLabel, autoGrids, resetGridExtent,
  autoNumberGrids, setGridExtent, visibleGrids,
} from '../core/grid-axes.js';
import { snapWallPoint } from '../core/wall-manual.js';
import { captureLevels, hasGridPins, moveGridWithPins, restoreLevels } from '../core/grid-pins.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { escapeHtml, toast } from './dom.js';
import { GRID_HEAD_R } from './render-axes.js';
import { planGridPref, setPlanGridPref } from './plan-grids.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, refreshDerived, snapshot } from './store.js';
import { renderProps, renderToolOptions } from './props.js';
import { cancelTool, selectObject, setTool } from './tools.js';
import { requestDraw } from './view.js';

export const GRID_HINT = 'Ось: клик — поставить · Tab — вертикальная/горизонтальная · Shift — без привязки · Esc — выйти';

export const grids = () => state.project?.grids || [];
export const gridById = (id) => grids().find((g) => g.id === id) || null;
export const selectedGrid = () => (state.selection?.type === 'grid' ? gridById(state.selection.id) : null);
export const isGridTool = () => state.tool?.kind === 'grid';
export const gridKindTitle = (kind) => (kind === 'x' ? 'Вертикальная' : 'Горизонтальная');

// ---------------------------------------------------------------- команды

function setGrids(list) {
  const next = planGridPref().auto ? autoNumberGrids(list) : list;
  if (next.length) state.project.grids = next; else delete state.project.grids;
}

export function addGrid(grid, { select = false } = {}) {
  mutate(() => { setGrids([...grids(), grid]); });
  if (select) selectObject({ type: 'grid', id: grid.id });
  return grid;
}

export function updateGrid(id, fn) {
  const g = gridById(id);
  if (!g) return null;
  let next = null;
  mutate(() => {
    next = fn(g);
    setGrids(grids().map((x) => (x.id === id ? next : x)));
  });
  return next;
}

export function deleteGrid(id) {
  const g = gridById(id);
  if (!g) return;
  const pinned = hasGridPins(state.project, id); // привязки снимет syncGridPins (ui/store.js)
  mutate(() => { setGrids(grids().filter((x) => x.id !== id)); });
  if (state.selection?.type === 'grid' && state.selection.id === id) selectObject(null);
  toast(`Ось ${g.label} удалена${pinned ? ' · стены откреплены' : ''} · Ctrl+Z — вернуть`);
}

// Сдвиг оси в положение at («Свойства», стрелки): прикреплённые стены едут
// с ней (core/grid-pins.js), комнаты растягиваются — один шаг истории.
export function moveGridTo(id, at) {
  const g = gridById(id);
  if (!g || !Number.isFinite(at)) return null;
  if (!hasGridPins(state.project, id)) return updateGrid(id, (x) => moveGrid(x, at));
  const before = snapshot();
  const res = moveGridWithPins(state.project, id, at);
  if (!res.ok) { toast(`Ось не сдвинуть: ${res.reason}`, true); renderProps(); requestDraw(); return null; }
  setGrids(grids());
  reconcileEats(state.project);
  refreshDerived();
  pushHistory(before);
  afterChange();
  return gridById(id);
}

export function deleteAllGrids() {
  const n = grids().length;
  if (!n) return;
  mutate(() => { setGrids([]); });
  if (state.selection?.type === 'grid') selectObject(null);
  toast(`Удалено осей: ${n} · Ctrl+Z — вернуть`);
}

export function showHiddenGrids() {
  if (!grids().some((g) => g.hidden)) return;
  mutate(() => { setGrids(grids().map((g) => { const { hidden: _h, ...rest } = g; return rest; })); });
}

// «Оси по стенам»: добавляет только недостающие оси (существующие не трогает).
export function autoGridsAction() {
  if (!planGridPref().on) setPlanGridPref({ on: true });
  const fresh = autoGrids(state.project, { walls: state.walls || [], mode: planGridPref().snap });
  if (!fresh.length) {
    toast(houseBox(state.project) ? 'Недостающих осей нет' : 'Нет комнат — оси ставить не по чему');
    requestDraw();
    return 0;
  }
  mutate(() => { setGrids([...grids(), ...fresh]); });
  toast(`Оси по стенам: добавлено ${fresh.length} · Ctrl+Z — отменить`);
  return fresh.length;
}

// ---------------------------------------------------------------- привязка

// Положение оси под курсором: к граням и углам стен, другим осям, иначе к шагу.
function snapAt(plan, kind, event, skipId = null) {
  const points = visibleGrids(grids()).filter((g) => g.id !== skipId)
    .map((g) => (g.kind === 'x' ? { x: g.at, y: NaN } : { x: NaN, y: g.at }));
  const s = snapWallPoint({
    p: plan, walls: state.walls || [], manual: state.project.walls || [], points,
    tol: 12 / state.view.scale, grid: gridStep(), free: Boolean(event?.shiftKey),
  });
  const v = kind === 'x' ? s.point.x : s.point.y;
  return Math.round(v);
}

// ---------------------------------------------------------------- инструмент

export function startGridTool() {
  if (state.modeName !== 'plan') return;
  if (!planGridPref().on) setPlanGridPref({ on: true });
  setTool({ kind: 'grid', gkind: 'x', locked: false, cursor: null, last: null, acc: { x: 0, y: 0 } }, GRID_HINT);
  state.selection = null;
  requestDraw();
}

export function toggleGridTool() {
  if (isGridTool()) cancelTool(); else startGridTool();
}

export function setGridToolKind(kind, lock = true) {
  const t = state.tool;
  if (t?.kind !== 'grid' || (kind !== 'x' && kind !== 'y')) return;
  t.gkind = kind;
  if (lock) t.locked = true;
  if (t.last) {
    const at = snapAt(t.last, kind, null);
    t.cursor = kind === 'x' ? { x: at, y: t.last.y } : { x: t.last.x, y: at };
  }
  renderToolOptions(true);
  requestDraw();
}

export function gridToolHover(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'grid') return;
  // Направление — по движению курсора (в осях дома), пока не закреплено Tab.
  if (t.last && !t.locked) {
    const k = state.view.scale || 0.1;
    t.acc = { x: t.acc.x * 0.8 + (plan.x - t.last.x) * k, y: t.acc.y * 0.8 + (plan.y - t.last.y) * k };
    const ax = Math.abs(t.acc.x); const ay = Math.abs(t.acc.y);
    const next = ax > 1.6 * ay && ax > 6 ? 'x' : ay > 1.6 * ax && ay > 6 ? 'y' : t.gkind;
    if (next !== t.gkind) { t.gkind = next; renderToolOptions(true); }
  }
  t.last = { x: plan.x, y: plan.y };
  const at = snapAt(plan, t.gkind, event);
  t.cursor = t.gkind === 'x' ? { x: at, y: plan.y } : { x: plan.x, y: at };
  requestDraw();
}

export function gridToolClick(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'grid') return;
  const at = snapAt(plan, t.gkind, event);
  if (grids().some((g) => g.kind === t.gkind && Math.abs(g.at - at) < 1)) {
    toast('Здесь ось уже есть', true);
    return;
  }
  const g = createGrid({ kind: t.gkind, at }, grids());
  addGrid(g);
  // Призрак — до следующего движения курсора (на касании его нет вовсе).
  t.cursor = null;
  toast(`Ось ${g.label} · ${t.gkind === 'x' ? 'x' : 'y'} = ${at} мм`);
  requestDraw();
}

// Строка параметров инструмента (ui/props.js renderToolOptions).
export function renderGridToolOptions(body) {
  const t = state.tool;
  body.innerHTML = `<strong class="to-title">Ось</strong>
    <label class="prop-field"><span>Направление</span>
      <select id="toGridKind">
        <option value="x" ${t.gkind === 'x' ? 'selected' : ''}>Вертикальная · 1, 2, 3…</option>
        <option value="y" ${t.gkind === 'y' ? 'selected' : ''}>Горизонтальная · А, Б, В…</option>
      </select></label>
    <span class="to-note">клик — поставить ось · Tab — сменить · Shift — без привязки</span>`;
  body.querySelector('#toGridKind').addEventListener('change', (e) => setGridToolKind(e.target.value));
}

// ---------------------------------------------------------------- выбор

function segDist(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// Что под курсором (экран): { id, part: 'head', end } | { id, part: 'line' } | null.
// lineAll — линия любой оси (иначе только выбранной), кружки — всегда.
export function hitGrid(screen, { lineAll = true } = {}) {
  if (state.modeName !== 'plan' || !planGridPref().on) return null;
  const ui = state._gridUI || [];
  const tol = state.coarsePointer ? 12 : 6;
  const sel = state.selection?.type === 'grid' ? state.selection.id : null;
  let best = null;
  for (const r of ui) {
    for (const h of r.heads) {
      const d = Math.hypot(screen.x - h.x, screen.y - h.y);
      if (d <= GRID_HEAD_R + 2 && (!best || d < best.d)) best = { d, id: r.id, part: 'head', end: h.end };
    }
  }
  if (best) return { id: best.id, part: 'head', end: best.end };
  for (const r of ui) {
    if (!lineAll && r.id !== sel) continue;
    const d = segDist(screen, r.A, r.B);
    if (d <= tol && (!best || d < best.d)) best = { d, id: r.id };
  }
  return best ? { id: best.id, part: 'line' } : null;
}

export function gridHoverTarget(screen, lineAll) {
  const hit = hitGrid(screen, { lineAll });
  return hit ? { type: 'grid', id: hit.id } : null;
}

// Нажатие на ось: выбор и начало перетаскивания (drag) или null.
export function gridPointerDown(event, screen, plan, { lineAll = false } = {}) {
  const hit = hitGrid(screen, { lineAll });
  if (!hit) return null;
  const g = gridById(hit.id);
  if (!g) return null;
  selectObject({ type: 'grid', id: g.id });
  const base = { id: g.id, before: snapshot(), moved: false, plan0: { x: plan.x, y: plan.y } };
  if (hit.part === 'head') return { kind: 'grid-end', end: hit.end, start: gridExtent(state.project, g), ...base };
  return { kind: 'grid-move', start: g.at, ...base };
}

export function gridDragMove(drag, plan, event) {
  const g = gridById(drag.id);
  if (!g) return;
  let next;
  if (drag.kind === 'grid-move') {
    const d = g.kind === 'x' ? plan.x - drag.plan0.x : plan.y - drag.plan0.y;
    const raw = drag.start + d;
    // Прикреплённые стены (core/grid-pins.js): каждый кадр — от снимка начала
    // жеста, ось и стены сдвигаются вместе; привязка — только к шагу сетки
    // (грани своих же стен ехали бы с осью). Не получилось — последнее удачное.
    if (drag.pinSave === undefined) drag.pinSave = hasGridPins(state.project, g.id) ? captureLevels(state.project) : null;
    if (drag.pinSave) {
      const step = event?.shiftKey ? 1 : gridStep();
      const at = Math.round(raw / step) * step;
      restoreLevels(drag.pinSave);
      state.project.grids = grids().map((x) => (x.id === g.id ? moveGrid(x, drag.start) : x));
      const res = moveGridWithPins(state.project, g.id, at);
      if (res.ok) { drag.lastOk = at; drag.reason = null; } else {
        drag.reason = res.reason;
        if (drag.lastOk !== undefined) moveGridWithPins(state.project, g.id, drag.lastOk);
      }
      drag.moved = gridById(g.id).at !== drag.start;
      refreshDerived();
      requestDraw();
      return;
    }
    const at = snapAt(g.kind === 'x' ? { x: raw, y: plan.y } : { x: plan.x, y: raw }, g.kind, event, g.id);
    next = moveGrid(g, at);
    drag.moved = next.at !== drag.start;
  } else {
    const along = g.kind === 'x' ? plan.y : plan.x;
    const step = event?.shiftKey ? 1 : gridStep();
    const v = Math.round(along / step) * step;
    const from = drag.end === 'from' ? v : drag.start.from;
    const to = drag.end === 'to' ? v : drag.start.to;
    if ((drag.end === 'from' && to - from < 600) || (drag.end === 'to' && to - from < 600)) return;
    next = setGridExtent(g, from, to);
    drag.moved = next.from !== drag.start.from || next.to !== drag.start.to;
  }
  state.project.grids = grids().map((x) => (x.id === g.id ? next : x));
  requestDraw();
}

// Конец перетаскивания — одна запись истории.
export function gridDragEnd(drag) {
  if (drag.reason) toast(`Дальше ось не сдвинуть: ${drag.reason}`, true);
  if (!drag.moved) { requestDraw(); return; }
  setGrids(grids()); // автонумерация по новому порядку
  pushHistory(drag.before);
  afterChange();
}

// Клавиши: G — инструмент; Tab — сменить направление; стрелки — сдвиг
// выбранной оси. true — клавиша съедена.
export function handleGridKey(event) {
  const mod = event.ctrlKey || event.metaKey || event.altKey;
  if (state.modeName !== 'plan') return false;
  if (event.code === 'KeyG' && !mod && !event.shiftKey && (!state.tool || isGridTool())) {
    toggleGridTool();
    import('./toolstrip.js').then((m) => m.renderToolstrip());
    return true;
  }
  if (isGridTool() && event.key === 'Tab' && !mod) {
    setGridToolKind(state.tool.gkind === 'x' ? 'y' : 'x');
    return true;
  }
  const g = !state.tool ? selectedGrid() : null;
  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (g && nudge && !mod) {
    const d = g.kind === 'x' ? nudge[0] : nudge[1];
    if (!d) return true;
    const step = event.shiftKey ? gridStep() * 10 : gridStep();
    moveGridTo(g.id, g.at + d * step);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- «Свойства»

// «Переименовать» (плашка выделения): фокус в поле марки «Свойств».
export function focusGridLabel() {
  renderProps();
  const input = document.querySelector('#gridLabel');
  if (input) { input.focus(); input.select(); }
}

// Сколько стен прикреплено к оси (подпись в «Свойствах» оси).
function pinnedNote(g) {
  let n = 0;
  for (const l of state.project.levels || []) {
    for (const r of l.rooms || []) n += (r.axisPins || []).filter((p) => p.gridId === g.id).length;
    for (const w of l.walls || []) n += Object.values(w.axisPins || {}).filter((p) => p?.gridId === g.id).length;
  }
  return n ? `<div class="prop-row"><span>Прикреплено граней стен</span><strong id="gridPinned">${n}</strong></div>` : '';
}

export function renderGridProps(panel, g) {
  const ext = gridExtent(state.project, g);
  const custom = Number.isFinite(g.from) && Number.isFinite(g.to);
  panel.innerHTML = `
    <h2>Ось ${escapeHtml(g.label)}</h2>
    <p class="subtitle">Координационная ось · ${gridKindTitle(g.kind).toLowerCase()}</p>
    <div class="prop-block" id="gridProps">
      <label class="prop-field"><span>Марка</span>
        <input id="gridLabel" type="text" maxlength="8" value="${escapeHtml(g.label)}"></label>
      <label class="prop-field"><span>Направление</span>
        <select id="gridKind">
          <option value="x" ${g.kind === 'x' ? 'selected' : ''}>Вертикальная (x) · 1, 2, 3…</option>
          <option value="y" ${g.kind === 'y' ? 'selected' : ''}>Горизонтальная (y) · А, Б, В…</option>
        </select></label>
      <label class="prop-field"><span>Положение ${g.kind === 'x' ? 'x' : 'y'}, мм</span>
        <input id="gridAt" type="number" step="10" inputmode="numeric" value="${Math.round(g.at)}"></label>
      <div class="prop-row"><span>Длина линии</span><strong>${Math.round(ext.to - ext.from)} мм${custom ? '' : ' (по дому)'}</strong></div>
      <label class="check-row"><input type="checkbox" id="gridHidden" ${g.hidden ? 'checked' : ''}><span>Скрыть на плане</span></label>
      <div class="prop-grid">
        <button type="button" id="gridResetLen" ${custom ? '' : 'disabled'} title="Длина — по габариту дома + 1500 мм">Длина по дому</button>
        <button type="button" id="gridDelete" class="danger">Удалить</button>
      </div>
      ${pinnedNote(g)}
      <p class="hint">Тяните линию — сдвиг оси, кружок — длина. Грани комнат и стены липнут к осям при переносе и растяжении (тумблер магнита в «Привязках»); замок у стены — прикрепить к оси. Настройки показа — в «Свойствах» без выбора.</p>
    </div>`;
  const id = g.id;
  panel.querySelector('#gridLabel').addEventListener('change', (e) => {
    const label = String(e.target.value).trim().slice(0, 8);
    if (!label || label === g.label) { e.target.value = g.label; return; }
    if (grids().some((x) => x.id !== id && x.kind === g.kind && x.label === label)) toast(`Марка ${label} уже есть у другой оси`, true);
    updateGrid(id, (x) => ({ ...x, label, manual: true })); // ручная марка не перенумеровывается
  });
  panel.querySelector('#gridAt').addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (!Number.isFinite(v)) { e.target.value = Math.round(g.at); return; }
    moveGridTo(id, v);
  });
  panel.querySelector('#gridKind').addEventListener('change', (e) => {
    const kind = e.target.value;
    if (kind === g.kind) return;
    // Новое направление: ось — через середину отрезка, марка — следующая свободная.
    const seg = gridSegment(state.project, g);
    const mid = kind === 'x' ? (seg.a.x + seg.b.x) / 2 : (seg.a.y + seg.b.y) / 2;
    updateGrid(id, (x) => { const { manual: _m, ...rest } = x; return { ...resetGridExtent(rest), kind, at: Math.round(mid), label: nextGridLabel(grids().filter((o) => o.id !== id), kind) }; });
  });
  panel.querySelector('#gridHidden').addEventListener('change', (e) => {
    updateGrid(id, (x) => { const { hidden: _h, ...rest } = x; return e.target.checked ? { ...rest, hidden: true } : rest; });
  });
  panel.querySelector('#gridResetLen').addEventListener('click', () => updateGrid(id, (x) => resetGridExtent(x)));
  panel.querySelector('#gridDelete').addEventListener('click', () => deleteGrid(id));
}

// Блок «Координационные оси» в «Свойствах» вида плана (ui/props-views.js).
export function gridViewBlock() {
  const pref = planGridPref();
  const list = grids();
  const hidden = list.filter((g) => g.hidden).length;
  return `
    <h3>Координационные оси</h3>
    <div class="prop-block" id="viewsGrids">
      <label class="check-row"><input type="checkbox" id="viewsGridOn" ${pref.on ? 'checked' : ''}><span>Показывать оси на плане</span><em>${list.length}</em></label>
      <label class="check-row"><input type="checkbox" id="viewsGridNumber" ${pref.auto ? 'checked' : ''}><span>Автонумерация осей</span></label>
      <label class="check-row"><input type="checkbox" id="viewsGridDims" ${pref.dims ? 'checked' : ''}><span>Размеры между осями</span></label>
      <label class="check-row"><input type="checkbox" id="viewsGridSheets" ${pref.sheets ? 'checked' : ''}><span>Оси на листах планов</span></label>
      <label class="prop-field"><span>Привязка к оси</span>
        <select id="viewsGridSnap">
          <option value="face" ${pref.snap === 'face' ? 'selected' : ''}>по грани (комнаты или наружной стены)</option>
          <option value="axis" ${pref.snap === 'axis' ? 'selected' : ''}>по оси стены</option>
        </select></label>
      <label class="check-row" title="Стена, притянутая магнитом к оси, сразу прикрепляется (замок закрыт). Выключено — прикрепляет клик по замку"><input type="checkbox" id="viewsGridRemember" ${pref.remember ? 'checked' : ''}><span>Привязка стен к осям: запоминать при магните</span></label>
      <div class="prop-grid">
        <button type="button" id="viewsGridAuto" title="Оси по наружным и несущим стенам; существующие оси остаются">Оси по стенам</button>
        <button type="button" id="viewsGridClear" class="danger" ${list.length ? '' : 'disabled'}>Удалить все оси</button>
      </div>
      ${hidden ? `<button type="button" id="viewsGridShow">Показать скрытые оси (${hidden})</button>` : ''}
      <p class="hint">Инструмент «Ось» (G) — слева. Комнаты и стены липнут к осям в радиусе 300 мм; замок у выделенной стены на оси — прикрепить: стена поедет вместе с осью.</p>
    </div>`;
}

export function bindGridViewBlock(panel, rerender) {
  const on = (sel, ev, fn) => panel.querySelector(sel)?.addEventListener(ev, fn);
  on('#viewsGridOn', 'change', (e) => { setPlanGridPref({ on: e.target.checked }); requestDraw(); });
  on('#viewsGridNumber', 'change', (e) => {
    setPlanGridPref({ auto: e.target.checked });
    if (e.target.checked && grids().length) mutate(() => { setGrids(grids()); });
    requestDraw(); rerender();
  });
  on('#viewsGridDims', 'change', (e) => { setPlanGridPref({ dims: e.target.checked }); requestDraw(); });
  on('#viewsGridSheets', 'change', async (e) => {
    setPlanGridPref({ sheets: e.target.checked });
    try { (await import('./sheet-view.js')).refreshSheetView?.(); } catch { /* листа нет */ }
    requestDraw();
  });
  on('#viewsGridSnap', 'change', (e) => setPlanGridPref({ snap: e.target.value }));
  on('#viewsGridRemember', 'change', (e) => setPlanGridPref({ remember: e.target.checked }));
  on('#viewsGridAuto', 'click', () => { autoGridsAction(); rerender(); });
  on('#viewsGridClear', 'click', () => { deleteAllGrids(); rerender(); });
  on('#viewsGridShow', 'click', () => { showHiddenGrids(); rerender(); });
}

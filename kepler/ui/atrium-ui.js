// Черновик хранится только у инструмента. Проём, ограждение и выбранное окно
// попадают в историю проекта вместе после подтверждения.
import { applyAtrium, previewAtrium } from '../core/atrium.js';
import { openingRect } from '../core/walls.js';
import { roomContainsPoint, roomLabelPoint, roomPolygon } from '../core/room-shape.js';
import { el, toast } from './dom.js';
import { state } from './state.js';
import { mutate, PROJECT_CHANGE_EVENT } from './store.js';
import { cancelTool, selectObject, setTool } from './tools.js';
import { requestDraw } from './view.js';

const tool = () => state.tool?.kind === 'atrium' ? state.tool : null;
const sourceRoom = (draft) => state.project.rooms.find((r) => r.id === draft.roomId);
const sideNames = ['Верхняя стена', 'Правая стена', 'Нижняя стена', 'Левая стена'];

function updateWindowMark(draft) {
  const opening = state.project.openings.find((o) => o.id === draft.windowId);
  draft.windowRect = opening ? openingRect(state.project, opening, state.walls)?.rect : null;
}

function refreshPreview(draft) {
  const picking = draft.area === 'rect' && !draft.rect;
  draft.roomOutline = roomPolygon(sourceRoom(draft));
  draft.preview = picking ? null : previewAtrium(state.project, draft.levelId, draft.roomId, { rect: draft.rect });
  const preview = draft.preview;
  const windows = preview?.windows || [];
  if (!windows.some((w) => w.id === draft.windowId)) draft.windowId = null;
  updateWindowMark(draft);

  const panel = el('atriumPanel');
  panel.hidden = false;
  panel.dataset.picking = String(picking);
  for (const btn of panel.querySelectorAll('[data-atrium-area]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.atriumArea === draft.area));
  }
  let message;
  if (picking) message = draft.anchor ? 'Укажите противоположный угол на плане.' : 'Укажите первый угол проёма на плане.';
  else if (!preview.ok) message = preview.reason;
  else {
    const upper = state.project.levels.find((l) => l.id === preview.upperLevelId);
    const area = (preview.area / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    message = `В полу уровня «${upper.name}» появится проём ${area} м².`;
  }
  if (picking && draft.keyboard && draft.cursor) {
    message += ` X ${draft.cursor.x}, Y ${draft.cursor.y} мм. Стрелки — шаг 100 мм, Shift — 1 м, Enter — точка.`;
  }
  el('atriumStatus').textContent = message;
  el('atriumRailRow').hidden = !preview?.ok || !preview.rails.length;
  el('atriumRails').checked = draft.railing;
  el('atriumWindowRow').hidden = !preview?.ok || !windows.length;
  const select = el('atriumWindow');
  const options = [new Option('Оставить как есть', '')];
  windows.forEach((w, i) => {
    const side = sideNames[w.side] || 'Стена';
    options.push(new Option(`${i + 1}. ${side} · ${Math.round(w.width)} мм`, w.id));
  });
  select.replaceChildren(...options);
  select.value = draft.windowId || '';
  el('atriumApply').disabled = !preview?.ok || state.editLocked;
  el('atriumRedraw').hidden = draft.area !== 'rect' || !draft.rect;
  requestDraw();
}

function chooseArea(area, keyboard = false) {
  const draft = tool();
  if (!draft) return;
  Object.assign(draft, { area, anchor: null, cursor: null, rect: null, keyboard });
  if (keyboard && area === 'rect') {
    draft.cursor = roomLabelPoint(sourceRoom(draft));
    el('atriumPanel').focus({ preventScroll: true });
  }
  refreshPreview(draft);
}

function finish(restore = false) {
  const draft = tool();
  if (!draft) return;
  cancelTool();
  if (restore && state.project.activeLevel === draft.levelId && sourceRoom(draft)) {
    selectObject({ type: 'room', id: draft.roomId });
    draft.returnTo3d?.();
    const action = draft.returnTo3d && el('v3Atrium').offsetWidth ? el('v3Atrium') :
      el('selectionToolbar')?.querySelector('[data-selection-action="atrium"]');
    action?.focus({ preventScroll: true });
  }
}

function commit() {
  const draft = tool();
  if (!draft?.preview?.ok || state.editLocked) return;
  const options = { rect: draft.rect, windowId: draft.windowId, railing: draft.railing };
  const check = previewAtrium(state.project, draft.levelId, draft.roomId, options);
  if (!check.ok) { refreshPreview(draft); return; }
  let result;
  const changed = mutate(() => { result = applyAtrium(state.project, draft.levelId, draft.roomId, options); });
  if (!changed) return;
  if (!result.ok) {
    el('atriumStatus').textContent = result.reason;
    return;
  }
  finish(true);
  toast('Второй свет создан');
}

let bound = false;
function bindControls() {
  if (bound) return;
  bound = true;
  const panel = el('atriumPanel');
  panel.addEventListener('click', (event) => {
    const area = event.target.closest('[data-atrium-area]')?.dataset.atriumArea;
    if (area && area !== tool()?.area) chooseArea(area, event.detail === 0);
  });
  el('atriumRedraw').addEventListener('click', (event) => chooseArea('rect', event.detail === 0));
  el('atriumRails').addEventListener('change', (event) => {
    if (tool()) { tool().railing = event.target.checked; requestDraw(); }
  });
  el('atriumWindow').addEventListener('change', (event) => {
    const draft = tool();
    if (!draft) return;
    draft.windowId = event.target.value || null;
    updateWindowMark(draft);
    requestDraw();
  });
  el('atriumClose').addEventListener('click', () => finish(true));
  el('atriumApply').addEventListener('click', commit);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); finish(true); return; }
    const draft = tool();
    if (event.target !== panel || !draft?.keyboard || draft.area !== 'rect' || draft.rect) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction && event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (direction) {
      const step = event.shiftKey ? 1000 : 100;
      draft.cursor = { x: draft.cursor.x + direction[0] * step, y: draft.cursor.y + direction[1] * step };
      refreshPreview(draft);
    } else {
      atriumClick(draft.cursor, true);
      if (draft.rect) el(draft.preview?.ok ? 'atriumApply' : 'atriumRedraw').focus();
    }
  });
  document.addEventListener('kepler:view', () => {
    if (tool() && (state.analyticalView || state.sheetOpen || state.elevOpen || state.modeName !== 'plan' || state.roofPlan)) finish();
  });
  document.addEventListener(PROJECT_CHANGE_EVENT, () => {
    const draft = tool();
    if (!draft) return;
    if (state.project?.activeLevel === draft.levelId && sourceRoom(draft)) refreshPreview(draft);
    else finish();
  });
}

export async function startAtrium() {
  if (state.editLocked || state.selection?.type !== 'room') return;
  const roomId = state.selection.id;
  const levelId = state.project.levels.find((level) => level.rooms.some((r) => r.id === roomId))?.id;
  if (!levelId) return;
  const { activeViewId, openView } = await import('./props-views.js');
  const returnTo3d = activeViewId() === '3d' ? () => openView('3d') : null;
  if (state.analyticalView) (await import('./project-route.js')).closeAnalyticalView();
  if (activeViewId() !== `plan:${levelId}`) openView(`plan:${levelId}`);
  bindControls();
  selectObject(null);
  const draft = { kind: 'atrium', levelId, roomId, railing: true, windowId: null, returnTo3d };
  setTool(draft);
  chooseArea('room');
  el('atriumPanel').querySelector('[data-atrium-area="room"]').focus({ preventScroll: true });
}

function snapCorner(polygon, point) {
  const tolerance = Math.min(150, 9 / state.view.scale);
  const snap = (axis) => {
    let value = Math.round(point[axis] / 10) * 10;
    let best = tolerance;
    for (const p of polygon) {
      const d = Math.abs(p[axis] - point[axis]);
      if (d <= best) { value = p[axis]; best = d; }
    }
    return value;
  };
  return { x: snap('x'), y: snap('y') };
}

export function atriumHover(point) {
  const draft = tool();
  if (draft?.area !== 'rect' || draft.rect) return;
  const room = sourceRoom(draft);
  if (!room) return;
  if (draft.keyboard) return;
  draft.cursor = snapCorner(draft.roomOutline, point);
  requestDraw();
}

export function atriumClick(point, keyboard = false) {
  const draft = tool();
  if (draft?.area !== 'rect' || draft.rect) return;
  const room = sourceRoom(draft);
  if (!room) return;
  draft.keyboard = keyboard;
  const p = keyboard ? point : snapCorner(draft.roomOutline, point);
  if (!draft.anchor) {
    if (!roomContainsPoint(room, p.x, p.y)) {
      el('atriumStatus').textContent = 'Первый угол должен быть внутри выбранной комнаты.';
      return;
    }
    draft.anchor = p;
  } else {
    const a = draft.anchor;
    draft.rect = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(a.x - p.x), h: Math.abs(a.y - p.y) };
  }
  draft.cursor = p;
  refreshPreview(draft);
}

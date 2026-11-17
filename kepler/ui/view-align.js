// Поворот ВИДА (камеры) текущего режима: «Выровнять вид по двум точкам»,
// поле угла, «Сбросить», «Развернуть оси дома по виду». Панель — кнопка ⟲
// у правого края холста. Данные проекта поворот вида не меняет (кроме
// варианта А: в пустом «Плане» оси дома встают по экрану) — см.
// core/view-angles.js.

import { buildingCenter } from '../core/building.js';
import { siteWarning } from '../core/rooms.js';
import { roomPolygon } from '../core/room-shape.js';
import { neighborRectCorners } from '../core/site.js';
import {
  buildingAlignedToView, customViewAngle, isPlanEmpty, lineViewAngle, resetViewAngle, setViewAngle, viewAngle,
} from '../core/view-angles.js';
import { wallRects } from '../core/walls.js';
import { underlayHandles } from '../render.js';
import { canvas, el, toast } from './dom.js';
import { snapAt } from './draw-snap-ui.js';
import { applyModeRotation } from './modes.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { isPhone, toggleSheet } from './mobile.js';
import { refreshViewsPanel } from './props-views.js';
import { planToWorld, requestDraw, screenToWorld, worldToPlan } from './view.js';

const MODE_TITLES = { plan: '«План»', site: '«Участок»', landscape: '«Ландшафт»' };
const DEFAULT_HINTS = {
  plan: 'По умолчанию — по осям дома',
  site: 'По умолчанию — север вверх',
  landscape: 'По умолчанию — север вверх',
};

const fmt = (deg) => `${deg > 0 ? '+' : ''}${(Math.round(deg * 10) / 10).toLocaleString('ru-RU')}°`;
const screenCenterWorld = () => screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);

// ------------------------------------------------------------ Привязки

// Рёбра и углы для привязки точек: комнаты и стены активного этажа, соседи,
// края подложки (мир). Граница, красная линия, дороги, контур дома и
// ландшафт добавляет сам snapAt (snapContext).
export function alignSnapShapes() {
  const shapes = [];
  const p = state.project;
  if (!p) return shapes;
  const toW = (pt) => planToWorld(pt);
  for (const r of p.rooms || []) {
    try { shapes.push({ points: roomPolygon(r).map(toW), closed: true }); } catch { /* битая форма — без привязки */ }
  }
  for (const w of state.walls || []) {
    for (const r of wallRects(w)) {
      shapes.push({
        points: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].map(toW),
        closed: true,
      });
    }
  }
  const site = p.site || {};
  for (const n of site.neighbors || []) shapes.push({ points: neighborRectCorners(n), closed: true });
  if (site.underlay?.widthPx && site.underlay?.mmPerPx) shapes.push({ points: underlayHandles(site.underlay), closed: true });
  return shapes;
}

export function snapAlignPoint(world, event) {
  const pts = state.tool?.points || [];
  return snapAt(world, event, { prev: pts[0] || null, points: pts, grid: 0, extraShapes: alignSnapShapes() }).point;
}

// ------------------------------------------------------------ Команды

// Задать угол вида текущего режима. pivotWorld — точка, остающаяся на месте
// экрана (по умолчанию — центр холста).
export function applyViewAngle(deg, pivotWorld = null) {
  const mode = state.modeName;
  const pivot = pivotWorld || screenCenterWorld();
  let res = { angle: deg, axesChanged: false };
  mutate(() => { res = setViewAngle(state.project, mode, deg, { pivot: worldToPlan(pivot) }); });
  applyModeRotation(pivot);
  requestDraw();
  renderViewPanel();
  return res;
}

export function resetViewAngleCmd() {
  const mode = state.modeName;
  if (customViewAngle(state.project, mode) == null) { toast(`Вид ${MODE_TITLES[mode]} уже по умолчанию`); return; }
  mutate(() => { resetViewAngle(state.project, mode); });
  applyModeRotation();
  requestDraw();
  renderViewPanel();
  toast(`Вид ${MODE_TITLES[mode]} сброшен: ${DEFAULT_HINTS[mode].replace('По умолчанию — ', '')}`);
}

// Явная команда: оси дома (данные) встают по экрану текущего вида. Дом
// поворачивается на месте вокруг центра габарита; Ctrl+Z — вернуть.
export function axesToViewCmd() {
  const project = state.project;
  if (isPlanEmpty(project)) {
    toast('Дом ещё не нарисован: при выравнивании вида «Плана» оси встанут по экрану сами');
    return;
  }
  const pivot = buildingCenter(project) || worldToPlan(screenCenterWorld());
  const next = buildingAlignedToView(project, state.modeName, pivot);
  if (!next) { toast('Оси дома уже идут по виду'); return; }
  const pivotWorld = planToWorld(pivot);
  mutate(() => { project.building = next; });
  applyModeRotation(pivotWorld);
  requestDraw();
  renderViewPanel();
  const warning = siteWarning(project);
  const shown = next.rotation > 180 ? next.rotation - 360 : next.rotation;
  toast(`Оси дома развёрнуты по виду: поворот дома ${fmt(shown)} (дом повернулся на участке на месте).`
    + `${warning ? ` ⚠ ${warning}.` : ''} Ctrl+Z — вернуть`, true);
}

// «Выровнять вид по двум точкам»; повторный клик во время инструмента — отмена.
export function startAlignView() {
  if (state.tool?.kind === 'align-view') {
    cancelTool();
    toast('Выравнивание вида отменено');
    return;
  }
  // Панель прячется, чтобы не закрывать холст; повторный клик по ⟲ (или по
  // «Выровнять» в панели) отменяет инструмент.
  setTool({ kind: 'align-view', points: [] },
    'Кликните две точки вдоль линии (стена, край участка, сосед, подложка) — она станет горизонтальной · Esc — отмена');
}

export function addAlignViewPoint(world) {
  const points = state.tool.points;
  points.push({ x: world.x, y: world.y });
  state.alignCursor = { x: world.x, y: world.y };
  if (points.length < 2) { setHint('Теперь кликните вторую точку вдоль той же линии'); requestDraw(); return; }
  const [a, b] = points;
  const mode = state.modeName;
  const angle = Math.hypot(b.x - a.x, b.y - a.y) < 10 ? null : lineViewAngle(a, b, viewAngle(state.project, mode));
  if (angle == null) { toast('Точки слишком близко'); state.tool.points = []; state.alignCursor = null; requestDraw(); return; }
  state.alignCursor = null;
  cancelTool();
  const res = applyViewAngle(angle, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  toast(`Вид ${MODE_TITLES[mode]} повёрнут: ${fmt(res.angle)}.`
    + (res.axesChanged ? ' План пуст — оси дома тоже встали по экрану.' : ' Дом и участок не сдвинулись.')
    + ' «Сбросить» — вернуть вид по умолчанию', true);
}

// ------------------------------------------------------------ Панель

export function renderViewPanel() {
  if (!state.project) return;
  el('viewBtn')?.classList.toggle('active', customViewAngle(state.project, state.modeName) != null);
  el('viewBtn')?.classList.toggle('armed', state.tool?.kind === 'align-view');
  refreshViewsPanel();
}

export function bindViewPanel() {
  el('viewBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'align-view') { startAlignView(); return; }
    if (state.tool) cancelTool();
    state.sheetSel = null;
    if (state.selection) selectObject(null);
    if (isPhone() && !document.body.classList.contains('sheet-props')) toggleSheet('props');
    el('propsTabMain').click();
    const group = document.querySelector('#propsBody details[data-sec="rotation"]');
    if (!group) return;
    const parent = group.closest('#viewSection');
    if (parent) parent.open = true;
    group.open = true;
    const input = el('viewsAngleInput');
    input?.focus({ preventScroll: true });
    group.scrollIntoView({ block: 'nearest' });
  });
  renderViewPanel();
}

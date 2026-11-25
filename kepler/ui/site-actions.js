// Действия режима «Участок»: ломаные, въезд, соседи, север, поворот дома.

import { buildingCenter, rotateBuildingAbout } from '../core/building.js';
import { siteWarning } from '../core/rooms.js';
import { DEFAULT_ROAD_WIDTH, polygonAreaM2 } from '../core/site.js';
import { entryAt } from '../core/site-entries.js';
import { canvas, toast } from './dom.js';
import { snapAt } from './draw-snap-ui.js';
import { applyModeRotation } from './modes.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject, setHint } from './tools.js';
import {
  planToWorld, requestDraw, screenToWorld, worldToPlan, worldToScreen,
} from './view.js';

function makeSiteId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function finishDraft() {
  const draft = state.draft;
  if (!draft) return;
  const site = state.project.site;
  if (draft.kind === 'boundary') {
    if (draft.points.length < 3) { toast('Нужно минимум 3 точки'); return; }
    mutate(() => { site.boundary = draft.points.map((p) => ({ ...p })); });
    selectObject({ type: 'site', kind: 'boundary' });
    toast(`Граница участка: ${polygonAreaM2(site.boundary).toFixed(1)} м². Красная зона — отступ ${(site.setbackBoundary / 1000).toLocaleString('ru-RU')} м`);
  } else if (draft.kind === 'redline') {
    if (draft.points.length < 2) { toast('Нужно минимум 2 точки'); return; }
    mutate(() => {
      site.redLine = draft.points.map((p) => ({ ...p }));
      site.redLineClosed = Boolean(draft.closed);
    });
    selectObject({ type: 'site', kind: 'redline' });
  } else if (draft.kind === 'road') {
    if (draft.points.length < 2) { toast('Нужно минимум 2 точки'); return; }
    const road = {
      id: makeSiteId('road'), points: draft.points.map((p) => ({ ...p })),
      width: DEFAULT_ROAD_WIDTH, closed: Boolean(draft.closed),
    };
    mutate(() => { site.roads.push(road); });
    selectObject({ type: 'site', kind: 'road', id: road.id });
  }
  cancelTool();
}

// Сетка черчения контуров участка — 100 мм (как раньше).
const DRAFT_GRID = 100;

// Курсор у первой точки (от 3 точек) — замыкание контура.
function nearFirst(draft, world) {
  if (draft.points.length < 3) return false;
  const first = worldToScreen(draft.points[0].x, draft.points[0].y);
  const here = worldToScreen(world.x, world.y);
  return Math.hypot(first.x - here.x, first.y - here.y) < 15;
}

// Привязка точки черновика (core/draw-snap.js): лучи, выравнивание, объекты, сетка.
function snapDraft(world, event) {
  const draft = state.draft;
  const pts = draft.points;
  return snapAt(world, event, {
    prev: pts[pts.length - 1] || null, points: pts, grid: DRAFT_GRID,
    exclude: { siteKind: draft.kind === 'redline' ? 'redline' : draft.kind === 'boundary' ? 'boundary' : '' },
  }).point;
}

// Наведение при черчении: курсор черновика с привязкой.
export function updateDraftCursor(world, event) {
  const draft = state.draft;
  draft.snapStart = false;
  draft.snapLabel = 'Замкнуть';
  if (!event?.shiftKey && nearFirst(draft, world)) {
    draft.cursor = { x: draft.points[0].x, y: draft.points[0].y };
    draft.snapStart = true;
    state.drawSnap = null;
  } else {
    draft.cursor = snapDraft(world, event);
  }
  requestDraw();
}

// exact — точка уже вычислена (динамический ввод), без привязки.
export function addDraftPoint(world, event = null, { exact = false } = {}) {
  const draft = state.draft;
  // Клик по начальной точке (когда к ней привязались) — замкнуть контур.
  if (!exact && !event?.shiftKey && nearFirst(draft, world)) { draft.closed = true; finishDraft(); return; }
  const point = exact ? { x: world.x, y: world.y } : snapDraft(world, event);
  const last = draft.points[draft.points.length - 1];
  if (last && Math.hypot(last.x - point.x, last.y - point.y) < 1) return; // повторный клик (двойной)
  draft.points.push({ x: point.x, y: point.y });
  if (!exact) snapDraft(world, event); // направляющие — уже от новой точки
  requestDraw();
}

// Точка въезда на границе, ближайшая к курсору, со стрелкой внутрь участка.
export function computeEntryAt(world, entry = { kind: state.tool?.entryKind || 'gate', opening: state.tool?.opening, wicket: state.tool?.wicket }) {
  return entryAt(state.project.site, world, entry);
}

export function placeNeighborAt(world) {
  const site = state.project.site;
  const neighbor = {
    id: makeSiteId('nbr'),
    x: Math.round(world.x / 100) * 100,
    y: Math.round(world.y / 100) * 100,
    w: 8000,
    h: 8000,
    rot: 0,
    height: 6000,
  };
  mutate(() => { site.neighbors.push(neighbor); });
  // Инструмент остаётся активным — дом можно сразу двигать/крутить/масштабировать.
  selectObject({ type: 'site', kind: 'neighbor', id: neighbor.id });
  toast('Соседний дом добавлен: тяните углы — размер и поворот; вокруг зона 6 м');
}

export function addNorthPoint(world) {
  const points = state.tool.points;
  points.push({ x: world.x, y: world.y });
  if (points.length < 2) { setHint('Теперь кликните вторую точку — конец стрелки на север'); requestDraw(); return; }
  const dx = points[1].x - points[0].x;
  const dy = points[1].y - points[0].y;
  if (Math.hypot(dx, dy) < 200) { toast('Точки слишком близко'); state.tool.points = []; return; }
  const north = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  mutate(() => {
    state.project.site.north = Math.round(north * 10) / 10;
    state.project.site.solarVerified = false;
  });
  state.northCursor = null;
  applyModeRotation();
  cancelTool();
  toast(`Север задан: ${Math.round(north)}°`);
}

// Поворот дома (оси комнат относительно участка). Дом крутится НА МЕСТЕ —
// вокруг центра своего габарита (пустой дом — вокруг центра экрана). Если
// у «Плана» нет своего угла вида, камера идёт по осям дома: дом остаётся
// неподвижным и прямым, а поворачивается участок вокруг него. Поворот ВИДА
// без изменения данных — ui/view-align.js.
export function setBuildingRotation(deg) {
  const project = state.project;
  const pivot = buildingCenter(project)
    || worldToPlan(screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2));
  const pivotWorld = planToWorld(pivot);
  mutate(() => { project.building = rotateBuildingAbout(project.building, pivot, deg); });
  applyModeRotation(pivotWorld);
  requestDraw();
  return siteWarning(project);
}

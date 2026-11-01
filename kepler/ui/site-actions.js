// Действия режима «Участок»: ломаные, въезд, соседи, север, выравнивание вида.

import { DEFAULT_ROAD_WIDTH, nearestPointOnPolyline, polygonAreaM2 } from '../core/site.js';
import { pointInPolygon } from '../core/zamer/geometry.js';
import { toast } from './dom.js';
import { applyModeRotation } from './modes.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject, setHint } from './tools.js';
import { requestDraw, worldToScreen } from './view.js';

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

export function addDraftPoint(world) {
  const draft = state.draft;
  const snap = (v) => Math.round(v / 100) * 100;
  const point = { x: snap(world.x), y: snap(world.y) };
  // Клик по начальной точке (когда к ней привязались) — замкнуть контур.
  if (draft.points.length >= 3) {
    const first = worldToScreen(draft.points[0].x, draft.points[0].y);
    const here = worldToScreen(point.x, point.y);
    if (Math.hypot(first.x - here.x, first.y - here.y) < 15) { draft.closed = true; finishDraft(); return; }
  }
  draft.points.push(point);
  requestDraw();
}

// Точка въезда на границе, ближайшая к курсору, со стрелкой внутрь участка.
export function computeEntryAt(world) {
  const site = state.project.site;
  if (!site.boundary || site.boundary.length < 3) return null;
  const near = nearestPointOnPolyline(site.boundary, world, true);
  if (!near) return null;
  const candidates = [near.angle + 90, near.angle - 90];
  let dir = candidates[0];
  const rad = (candidates[0] * Math.PI) / 180;
  const probe = { x: near.x + Math.cos(rad) * 500, y: near.y + Math.sin(rad) * 500 };
  if (!pointInPolygon(probe, site.boundary)) dir = candidates[1];
  return { x: near.x, y: near.y, dir, dist: near.dist };
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
  mutate(() => { state.project.site.north = Math.round(north * 10) / 10; });
  state.northCursor = null;
  applyModeRotation();
  cancelTool();
  toast(`Север задан: ${Math.round(north)}°`);
}

// Выравнивание ВИДА по 2 точкам: весь ракурс (участок + дом + съёмка) целиком
// поворачивается так, чтобы кликнутая линия стала горизонтальной. Это просто
// поворот камеры — план не меняется, одинаково в обоих режимах.
export function addAlignPoint(world) {
  const points = state.tool.points;
  points.push({ x: world.x, y: world.y });
  state.alignCursor = { x: world.x, y: world.y };
  if (points.length < 2) { setHint('Теперь кликните вторую точку вдоль той же линии'); requestDraw(); return; }
  const dx = points[1].x - points[0].x;
  const dy = points[1].y - points[0].y;
  if (Math.hypot(dx, dy) < 10) { toast('Точки слишком близко'); state.tool.points = []; return; }
  // world — истинные координаты; угол линии в мире фиксирован. Чтобы линия
  // стала горизонтальной на экране, поворот вида = −уголЛинии (минимальный).
  let rot = -(Math.atan2(dy, dx) * 180) / Math.PI;
  rot = ((rot % 180) + 180) % 180;
  if (rot > 90) rot -= 180;
  state.alignCursor = null;
  mutate(() => { state.project.viewRotation = ((rot % 360) + 360) % 360; });
  applyModeRotation();
  cancelTool();
  toast(`Вид повёрнут (${rot > 0 ? '+' : ''}${rot.toFixed(1)}°). Повторный клик по «Выровнять» — сброс.`);
}

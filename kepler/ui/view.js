// Вид: перевод координат экран ↔ мир, перерисовка, масштаб, «показать всё».

import { projectPoint, unprojectPoint } from '../render.js';
import { canvas, refs, renderer } from './dom.js';
import { findWall } from './hit.js';
import { state } from './state.js';
import { positionWallButtons } from './tools.js';
import { positionCalInput } from './underlay.js';

let drawQueued = false;

export function screenToWorld(sx, sy) {
  return unprojectPoint(state.view, sx, sy);
}

export function worldToScreen(x, y) {
  return projectPoint(state.view, x, y);
}

export function pointerScreen(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function pointerWorld(event) {
  const p = pointerScreen(event);
  return screenToWorld(p.x, p.y);
}

export function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    renderer.draw(state);
  });
}

export function zoomAt(screen, factor) {
  const world = screenToWorld(screen.x, screen.y);
  state.view.scale = Math.min(0.6, Math.max(0.004, state.view.scale * factor));
  const projected = worldToScreen(world.x, world.y);
  state.view.panX += screen.x - projected.x;
  state.view.panY += screen.y - projected.y;
  refs.statusScale.textContent = scaleLabel();
  positionCalInput();
  if (state.selection?.type === 'wall') { const w = findWall(state.selection.key, state.selection.from); if (w) positionWallButtons(w); }
  requestDraw();
}

export function scaleLabel() {
  const denominator = Math.round(96 / 25.4 / state.view.scale);
  return `≈ 1:${denominator}`;
}

export function fitView() {
  const site = state.project.site;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const extend = (x, y) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const room of state.project.rooms) {
    extend(room.x - 400, room.y - 400);
    extend(room.x + room.w + 400, room.y + room.h + 400);
  }
  if (state.modeName === 'site' && site) {
    for (const p of site.boundary || []) extend(p.x, p.y);
    for (const road of site.roads || []) for (const p of road.points) extend(p.x, p.y);
    for (const n of site.neighbors || []) { extend(n.x - n.w / 2, n.y - n.h / 2); extend(n.x + n.w / 2, n.y + n.h / 2); }
    const u = site.underlay;
    if (u) { extend(u.x, u.y); extend(u.x + u.widthPx * u.mmPerPx, u.y + u.heightPx * u.mmPerPx); }
  }
  if (minX === Infinity) {
    state.view.scale = state.modeName === 'site' ? 0.02 : 0.08;
    state.view.panX = canvas.clientWidth / 2;
    state.view.panY = canvas.clientHeight / 2;
    requestDraw();
    return;
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Учитываем поворот: вписываем диагональ.
  const span = Math.max(maxX - minX, maxY - minY) * (state.view.rotation ? 1.2 : 1);
  const scale = Math.min(0.6, Math.max(0.004, Math.min(width / (state.view.rotation ? span : maxX - minX), height / (state.view.rotation ? span : maxY - minY)) * 0.9));
  state.view.scale = scale;
  const projected = projectPoint({ ...state.view, panX: 0, panY: 0 }, cx, cy);
  state.view.panX = width / 2 - projected.x;
  state.view.panY = height / 2 - projected.y;
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}

export function bindView() {
  new ResizeObserver(() => requestDraw()).observe(canvas);
}

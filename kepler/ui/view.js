// Вид: перевод координат экран ↔ мир, перерисовка, масштаб, «показать всё».

import { composeView, rectCornersWorld, toLocal, toWorld } from '../core/building.js';
import { neighborRectCorners } from '../core/site.js';
import { projectPoint, underlayHandles, unprojectPoint } from '../render.js';
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

// Объекты дома (комнаты, стены, проёмы, мебель) живут в локальных
// координатах дома; участок — в мировых. Вид дома — тот же вид, сдвинутый и
// повёрнутый на поворот дома (core/building.js).
export function planView() {
  return composeView(state.view, state.project?.building);
}

export function screenToPlan(sx, sy) {
  return unprojectPoint(planView(), sx, sy);
}

export function planToScreen(x, y) {
  return projectPoint(planView(), x, y);
}

export function worldToPlan(p) {
  return toLocal(state.project.building, p);
}

export function planToWorld(p) {
  return toWorld(state.project.building, p);
}

// Поворот камеры так, чтобы мировая точка pivot осталась на том же месте
// экрана (по умолчанию — то, что сейчас в центре канваса).
export function rotateViewTo(rotation, pivot = null) {
  const p = pivot || screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const before = worldToScreen(p.x, p.y);
  state.view.rotation = rotation;
  const after = worldToScreen(p.x, p.y);
  state.view.panX += before.x - after.x;
  state.view.panY += before.y - after.y;
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
    // «Готово» видна, пока чертится ломаная (на телефоне нет Enter).
    const done = document.getElementById('draftDone');
    if (done) done.hidden = !state.draft;
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
  // Все точки — в мировых координатах; дом переводится из своих осей.
  const pts = [];
  const pad = 400;
  for (const room of state.project.rooms) {
    pts.push(...rectCornersWorld(state.project.building,
      { x: room.x - pad, y: room.y - pad, w: room.w + pad * 2, h: room.h + pad * 2 }));
  }
  if (state.modeName === 'site' && site) {
    for (const p of site.boundary || []) pts.push(p);
    for (const road of site.roads || []) pts.push(...road.points);
    for (const n of site.neighbors || []) pts.push(...neighborRectCorners(n));
    if (site.underlay) pts.push(...underlayHandles(site.underlay));
  }
  if (!pts.length) {
    state.view.scale = state.modeName === 'site' ? 0.02 : 0.08;
    state.view.panX = canvas.clientWidth / 2;
    state.view.panY = canvas.clientHeight / 2;
    requestDraw();
    return;
  }
  // Габарит в повёрнутой системе экрана (масштаб 1, без сдвига) — вписывается
  // точно при любом повороте вида.
  const unit = { ...state.view, scale: 1, panX: 0, panY: 0 };
  const proj = pts.map((p) => projectPoint(unit, p.x, p.y));
  const minX = Math.min(...proj.map((p) => p.x));
  const maxX = Math.max(...proj.map((p) => p.x));
  const minY = Math.min(...proj.map((p) => p.y));
  const maxY = Math.max(...proj.map((p) => p.y));
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = Math.min(0.6, Math.max(0.004,
    Math.min(width / Math.max(maxX - minX, 1), height / Math.max(maxY - minY, 1)) * 0.9));
  state.view.scale = scale;
  state.view.panX = width / 2 - ((minX + maxX) / 2) * scale;
  state.view.panY = height / 2 - ((minY + maxY) / 2) * scale;
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}

export function bindView() {
  new ResizeObserver(() => requestDraw()).observe(canvas);
}

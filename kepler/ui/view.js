// Вид: перевод координат экран ↔ мир, перерисовка, масштаб, «показать всё».

import { composeView, rectCornersWorld, toLocal, toWorld } from '../core/building.js';
import { hasContent } from '../core/model.js';
import { neighborRectCorners } from '../core/site.js';
import { allMasses, massRect } from '../core/masses.js';
import { projectPoint, underlayHandles, unprojectPoint } from '../render.js';
import { canvas, refs, renderer } from './dom.js';
import { findWall } from './hit.js';
import { state } from './state.js';
import { positionWallButtons } from './tools.js';
import { positionCalInput } from './underlay.js';
import { positionElevInput } from './terrain.js';

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
    if (!state.project) return; // ResizeObserver может сработать до восстановления аккаунта и модели.
    renderer.draw(state);
    const firstDraw = document.getElementById('firstDrawActions');
    if (firstDraw) firstDraw.hidden = !state.project || state.modeName !== 'plan' || Boolean(
      state.tool || state.selection || state.editLocked || state.roofPlan || state.sheetOpen ||
      state.elevOpen || state.libraryPinned || state.project.views?.length || hasContent(state.project)
    );
    // «Готово» видна, пока чертится ломаная (на телефоне нет Enter).
    const done = document.getElementById('draftDone');
    if (done) done.hidden = !state.draft && state.tool?.kind !== 'slab-opening';
  });
}

export function zoomAt(screen, factor) {
  markViewTouched();
  const world = screenToWorld(screen.x, screen.y);
  state.view.scale =Math.min(0.6, Math.max(0.004, state.view.scale * factor));
  const projected = worldToScreen(world.x, world.y);
  state.view.panX += screen.x - projected.x;
  state.view.panY += screen.y - projected.y;
  refs.statusScale.textContent = scaleLabel();
  positionCalInput();
  positionElevInput();
  if (state.selection?.type === 'wall') { const w = findWall(state.selection.key, state.selection.from); if (w) positionWallButtons(w); }
  requestDraw();
}

export function scaleLabel() {
  const denominator = Math.round(96 / 25.4 / state.view.scale);
  return `≈ 1:${denominator}`;
}

// Поля «Вписать», px: под размерные цепочки дома (render.js рисует их снаружи
// стен: слева и снизу до 3–4 поясов по ~60 px — внутренние, по проёмам,
// габарит; сверху и справа — по два), под статус-строку и этажи снизу, под
// плашки связности и панель выделения сверху, под кнопки масштаба справа.
const CHAIN_PX = 60;
export function fitMargins(hasRooms) {
  const chains = hasRooms ? CHAIN_PX : 0;
  return {
    left: 16 + chains * 4,
    right: 16 + Math.max(chains * 2, 44), // кнопки +/− справа внизу
    top: 16 + Math.max(chains * 2, 44), // плашка связности / панель выделения
    bottom: 32 + Math.max(chains * 3, 44), // статус-строка + этажи
  };
}

// Поля не съедают больше половины канваса по каждой оси — на телефоне
// пропорционально ужимаются.
export function fitBox(width, height, margins) {
  const fit = (size, a, b) => {
    const k = a + b > size * 0.5 ? (size * 0.5) / (a + b) : 1;
    return [a * k, b * k];
  };
  const [left, right] = fit(width, margins.left, margins.right);
  const [top, bottom] = fit(height, margins.top, margins.bottom);
  return { left, top, width: width - left - right, height: height - top - bottom };
}

// Пользователь сам двигал вид в этом режиме — при входе в режим не вписываем.
export function markViewTouched() {
  const key = state.analyticalView?.id || state.modeName;
  if (state.views?.[key]) state.views[key].touched = true;
}

// Вписать вид при входе в режим один раз, если пользователь его ещё не
// двигал (modes.js). fitView сбрасывает флаги: после загрузки проекта или
// «Вписать» другой режим снова впишется при первом входе.
export function fitViewOnce() {
  const saved = state.views?.[state.analyticalView?.id || state.modeName];
  if (!saved || saved.touched || saved.fitted) return false;
  fitView();
  return true;
}

function resetFitFlags() {
  const active = state.analyticalView?.id || state.modeName;
  for (const [mode, saved] of Object.entries(state.views || {})) {
    if (!saved) continue;
    saved.touched = false;
    saved.fitted = mode === active;
  }
}

export function fitView() {
  const site = state.project.site;
  // Все точки — в мировых координатах; дом переводится из своих осей.
  const pts = [];
  // Наружные стены — в мм вокруг комнат; цепочки — в полях fitMargins.
  const pad = (state.project.settings?.exterior || 400) + 100;
  resetFitFlags();
  for (const room of state.project.rooms) {
    pts.push(...rectCornersWorld(state.project.building,
      { x: room.x - pad, y: room.y - pad, w: room.w + pad * 2, h: room.h + pad * 2 }));
  }
  const siteView = state.modeName === 'site' || state.modeName === 'landscape';
  // Боковой каталог лежит поверх холста. Участок должен помещаться справа
  // от него даже на узком планшете. У нижнего листа телефона такого отступа нет.
  const landscapeCatalog = state.modeName === 'landscape' && window.matchMedia('(min-width: 641px)').matches;
  const covered = landscapeCatalog ? document.querySelector('.library').offsetWidth : 0;
  const box = fitBox(canvas.clientWidth - covered, canvas.clientHeight, fitMargins(!covered && state.project.rooms.length > 0));
  box.left += covered;
  // Массы (core/masses.js) — основания в осях дома: эскиз тоже вписывается.
  if (state.modeName === 'plan') {
    for (const m of allMasses(state.project)) {
      pts.push(...rectCornersWorld(state.project.building, massRect(m)));
    }
  }
  if (siteView && site) {
    for (const p of site.boundary || []) pts.push(p);
    for (const road of site.roads || []) pts.push(...road.points);
    for (const n of site.neighbors || []) pts.push(...neighborRectCorners(n));
    if (state.modeName === 'landscape') {
      for (const o of site.landscape?.objects || []) pts.push({ x: o.x - o.w / 2, y: o.y - o.h / 2 }, { x: o.x + o.w / 2, y: o.y + o.h / 2 });
    }
    if (site.underlay) pts.push(...underlayHandles(site.underlay));
  }
  if (!pts.length) {
    state.view.scale = siteView ? 0.02 : 0.08;
    state.view.panX = covered + (canvas.clientWidth - covered) / 2;
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
  const scale = Math.min(0.6, Math.max(0.004,
    Math.min(box.width / Math.max(maxX - minX, 1), box.height / Math.max(maxY - minY, 1)) * 0.95));
  state.view.scale = scale;
  state.view.panX = box.left + box.width / 2 - ((minX + maxX) / 2) * scale;
  state.view.panY = box.top + box.height / 2 - ((minY + maxY) / 2) * scale;
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}

// Показать прямоугольник плана (оси дома) без смены режима: центр — в
// середину видимой части холста; масштаб меняется, только если объект не
// влезает или совсем мелкий. opts.left — поле слева, px (открытая панель).
export function showPlanRect(rect, opts = {}) {
  if (!rect) return;
  const pad = 400;
  const corners = rectCornersWorld(state.project.building,
    { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 });
  const unit = { ...state.view, scale: 1, panX: 0, panY: 0 };
  const proj = corners.map((p) => projectPoint(unit, p.x, p.y));
  const minX = Math.min(...proj.map((p) => p.x));
  const maxX = Math.max(...proj.map((p) => p.x));
  const minY = Math.min(...proj.map((p) => p.y));
  const maxY = Math.max(...proj.map((p) => p.y));
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const left = Math.min(opts.left ?? 24, width * 0.6);
  const box = { left, top: 60, width: Math.max(width - left - 24, 40), height: Math.max(height - 60 - 70, 40) };
  const fit = Math.min(box.width / Math.max(maxX - minX, 1), box.height / Math.max(maxY - minY, 1));
  const scale = Math.min(0.6, Math.max(0.004, Math.min(fit, Math.max(state.view.scale, fit * 0.35))));
  markViewTouched();
  state.view.scale = scale;
  state.view.panX = box.left + box.width / 2 - ((minX + maxX) / 2) * scale;
  state.view.panY = box.top + box.height / 2 - ((minY + maxY) / 2) * scale;
  refs.statusScale.textContent = scaleLabel();
  positionCalInput();
  positionElevInput();
  requestDraw();
}

export function bindView() {
  const actions = document.getElementById('firstDrawActions');
  for (const action of actions.querySelectorAll('[data-first-tool]')) {
    const tool = document.getElementById(action.dataset.firstTool);
    const icon = tool.querySelector('svg').cloneNode(true);
    action.prepend(icon);
    action.addEventListener('click', () => tool.click());
  }
  // Параметры инструмента занимают строку только пока он активен. Когда
  // она закрывается после клика, оставляем чертёж под указателем.
  const options = document.getElementById('toolOptions');
  let previousHeight = options.offsetHeight;
  let previousTop = canvas.getBoundingClientRect().top;
  let previousMode = state.modeName;
  new ResizeObserver(() => {
    const height = options.offsetHeight;
    const top = canvas.getBoundingClientRect().top;
    const shift = previousTop - top;
    if (window.innerWidth > 640 && previousMode === state.modeName && height !== previousHeight &&
        Math.abs(shift - (previousHeight - height)) < 2) state.view.panY += shift;
    previousHeight = height;
    previousTop = top;
    previousMode = state.modeName;
    requestDraw();
  }).observe(canvas);
  // Смена режима без изменения размера холста не вызывает наблюдателя, и
  // previousMode оставался прежним: первая же подсказка в новом режиме
  // (например, «Линия — тянуть ребро» в «Ландшафте») сдвигала чертёж из-под
  // указателя. Через два кадра — когда resize от самой смены уже обработан —
  // принимаем текущий режим и положение холста за исходные.
  document.addEventListener('kepler:view', () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      previousHeight = options.offsetHeight;
      previousTop = canvas.getBoundingClientRect().top;
      previousMode = state.modeName;
    }));
  });
}

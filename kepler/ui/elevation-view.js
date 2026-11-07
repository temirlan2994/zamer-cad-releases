// Фасад, открытый на холсте (дерево видов → «Фасад Север»…), как лист и
// 3D — окном поверх плана: режим редактора («План», «Участок», «Ландшафт»)
// и этаж не меняются, «✕ Закрыть вид» и Esc возвращают предыдущий вид.
// Только просмотр: колесо — масштаб у курсора, перетаскивание — сдвиг,
// двойной клик — вписать. Геометрия — core/elevation.js, рисование —
// ui/render-elevation.js. Настройки вида (масштаб, отметки) хранятся в
// project.views (core/views.js) — в «Свойствах» без выбора.

import { buildElevation } from '../core/elevation.js';
import { VIEW_SCALES, findView, materializeView, viewScale } from '../core/views.js';
import { el, escapeHtml } from './dom.js';
import { closeSheets, isPhone } from './mobile.js';
import { closeSheet, notifyViewChange } from './sheet-view.js';
import { elevationColors, drawElevation, fitElevation } from './render-elevation.js';
import { history, state } from './state.js';
import { mutate } from './store.js';

let cache = null; // { stamp, project, el }
let cam = null; // { k, ox, oy, zoom, scale, id }
let observers = null;
let drag = null;

export const isElevationOpen = () => state.elevationOpen != null;
export const openElevationId = () => state.elevationOpen || null;

export function elevationView(id = state.elevationOpen) {
  return id ? findView(state.project, id) : null;
}

export const elevationTitle = (view) => `${view.name} 1:${viewScale(view)}`;

function stampOf(id) {
  return `${id}/${history.undo.length}/${history.redo.length}`;
}

function geometry() {
  const view = elevationView();
  if (!view) return null;
  const stamp = stampOf(view.id);
  if (cache?.stamp !== stamp || cache.project !== state.project) {
    cache = { stamp, project: state.project, el: buildElevation(state.project, view.dir) };
  }
  return cache.el;
}

export function openElevation(id) {
  const view = findView(state.project, id);
  if (!view || view.kind !== 'elevation') return false;
  closeSheet();
  if (isPhone()) closeSheets(); // телефон: нижний лист уезжает, вид — во весь холст
  state.elevationOpen = id;
  state.selection = null;
  state.hover = null;
  cam = null;
  renderElevationView();
  document.body.classList.add('elevation-open');
  notifyViewChange();
  return true;
}

export function closeElevation() {
  if (!isElevationOpen()) return;
  state.elevationOpen = null;
  cam = null;
  const box = el('elevView');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  observers?.forEach((o) => o.disconnect());
  observers = null;
  document.body.classList.remove('elevation-open');
  notifyViewChange();
}

// Настройки вида: масштаб (знаменатель) и отметки. Правка — в project.views
// одной записью истории (Ctrl+Z возвращает).
export function setElevationScale(scale) {
  const id = state.elevationOpen;
  if (!id || !VIEW_SCALES.includes(scale)) return;
  if (viewScale(elevationView(id)) === scale) return;
  mutate(() => { materializeView(state.project, id).scale = scale; });
  cam = null; // новый масштаб — заново вписать при zoom = 1
  refreshElevationView();
}

export function setElevationMarks(on) {
  const id = state.elevationOpen;
  if (!id) return;
  mutate(() => {
    const v = materializeView(state.project, id);
    if (on) delete v.marks; else v.marks = false;
  });
  refreshElevationView();
}

// После правок (Ctrl+Z, другой проект): перерисовать.
export function refreshElevationView() {
  if (!isElevationOpen()) return;
  if (!elevationView()) { closeElevation(); return; }
  if (!document.getElementById('elevView')?.querySelector('#elevCanvas')) { renderElevationView(); return; }
  const title = document.getElementById('elevView')?.querySelector('#elevViewTitle');
  if (title) title.textContent = elevationTitle(elevationView());
  if (cam && cam.scale !== viewScale(elevationView())) cam = null;
  draw();
}

function renderElevationView() {
  const box = el('elevView');
  const view = elevationView();
  if (!box || !view) return;
  box.hidden = false;
  box.innerHTML = `
    <div class="elev-view-bar">
      <b class="elev-view-title" id="elevViewTitle">${escapeHtml(elevationTitle(view))}</b>
      <span class="elev-view-meta">колесо — масштаб · тяните — сдвиг · двойной клик — вписать</span>
      <span class="elev-view-gap"></span>
      <button type="button" id="elevViewFit">Вписать</button>
      <button type="button" id="elevViewClose">✕ Закрыть вид</button>
    </div>
    <div class="elev-view-body" id="elevViewBody"><canvas id="elevCanvas" aria-label="${escapeHtml(view.name)}"></canvas></div>`;
  box.querySelector('#elevViewClose').addEventListener('click', closeElevation);
  box.querySelector('#elevViewFit').addEventListener('click', () => { cam = null; draw(); });
  const canvas = box.querySelector('#elevCanvas');
  bindCanvas(canvas);
  observers?.forEach((o) => o.disconnect());
  observers = [];
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => draw());
    ro.observe(box.querySelector('#elevViewBody'));
    observers.push(ro);
  }
  // Тема (data-theme у <html>, системная тема) — перерисовать.
  const mo = new MutationObserver(() => draw());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  observers.push(mo);
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (mq?.addEventListener) {
    const onMq = () => draw();
    mq.addEventListener('change', onMq);
    observers.push({ disconnect: () => mq.removeEventListener('change', onMq) });
  }
  draw();
}

function draw() {
  const canvas = document.getElementById('elevView')?.querySelector('#elevCanvas');
  const view = elevationView();
  if (!canvas || !view) return;
  const body = canvas.parentElement;
  const w = Math.max(1, body.clientWidth);
  const h = Math.max(1, body.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const geo = geometry();
  const scale = viewScale(view);
  if (!cam || cam.id !== view.id) cam = { ...fitElevation(geo, w, h, scale, 1), scale, id: view.id };
  const colors = elevationColors(getComputedStyle(document.documentElement).getPropertyValue('--canvas'));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);
  if (!geo.polys.length) {
    ctx.fillStyle = colors.muted;
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Пусто: на плане нет стен — нарисуйте помещения.', w / 2, h / 2);
  }
  drawElevation(ctx, geo, { view: cam, colors, marks: view.marks !== false, title: elevationTitle(view), dpr });
  state.elevationDrawn = { id: view.id, polys: geo.polys.length, zoom: cam.zoom, scale };
}

function zoomAt(sx, sy, factor) {
  if (!cam) return;
  const z = Math.min(20, Math.max(0.1, cam.zoom * factor));
  const f = z / cam.zoom;
  cam.ox = sx - (sx - cam.ox) * f;
  cam.oy = sy - (sy - cam.oy) * f;
  cam.k *= f;
  cam.zoom = z;
  draw();
}

function bindCanvas(canvas) {
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  const pointers = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    drag = { ...local(e), pinch: null };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !cam) return;
    const p = local(e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.set(e.pointerId, p);
      const [a2, b2] = [...pointers.values()];
      const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (d0 > 0) zoomAt((a2.x + b2.x) / 2, (a2.y + b2.y) / 2, d1 / d0);
      return;
    }
    pointers.set(e.pointerId, p);
    if (!drag) return;
    cam.ox += p.x - drag.x;
    cam.oy += p.y - drag.y;
    drag = { ...p };
    draw();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (!pointers.size) drag = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', () => { cam = null; draw(); });
}

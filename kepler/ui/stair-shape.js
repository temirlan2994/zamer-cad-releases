import { toLocal } from '../core/building.js';
import { deriveEntrances, entranceParts } from '../core/entrance.js';
import { stairTreads } from '../core/landscape.js';
import { STAIR_EDGES, stairRectPolygon } from '../core/stair-shape.js';
import { escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, snapshot } from './store.js';
import { selectObject } from './tools.js';

let env, layer, drag;
let cache = null;
export const stairShapeDragging = () => Boolean(drag);

function target() {
  const sel = state.selection;
  if (state.tool || state.editLocked) return null;
  if (sel?.type === 'entrance') {
    const object = state.project.openings.find((o) => o.id === sel.id);
    const entry = object && deriveEntrances(state.project).find((e) => e.openingId === object.id);
    if (!entry?.landing) return null;
    return { object, parts: entranceParts(entry), get: () => object.entrance?.shapeEdits || {},
      set: (shapeEdits) => { object.entrance = { ...object.entrance, shapeEdits }; } };
  }
  if (sel?.type === 'landscape' && sel.ids?.length === 1) {
    const object = state.project.site.landscape.objects.find((o) => o.id === sel.ids[0]);
    if (object?.kind !== 'stairs-out' || object.locked) return null;
    const rad = (object.rotation || 0) * Math.PI / 180;
    const origin = toLocal(state.project.building, object);
    const axis = (x, y) => {
      const p = toLocal(state.project.building, { x: object.x + x, y: object.y + y });
      return { x: p.x - origin.x, y: p.y - origin.y };
    };
    const xAxis = axis(Math.cos(rad), Math.sin(rad));
    const yAxis = axis(-Math.sin(rad), Math.cos(rad));
    const parts = stairTreads(object).reverse().map((t) => {
      const rect = { left: t.left, right: t.right, back: t.top, front: t.bottom };
      return { key: t.key, title: `Ступень ${t.key.slice(5)} (от верха)`, base: t.base, rect, origin, xAxis, yAxis,
        polygon: stairRectPolygon(rect, origin, xAxis, yAxis), z: t.z };
    });
    return { object, parts, get: () => object.meta?.shapeEdits || {}, set: (shapeEdits) => { object.meta = { ...object.meta, shapeEdits }; } };
  }
  return null;
}

const chosen = (t) => t?.parts.find((p) => p.key === state.selection?.part) || t?.parts[0];
const patchRect = (t, part, rect) => t.set({ ...t.get(), [part.key]: Object.fromEntries(STAIR_EDGES.map((e) => [e, Math.round(rect[e] - part.base[e])])) });

export function stairShapeFields() {
  const t = target(); const p = chosen(t);
  if (!p) return '';
  const r = p.rect;
  return `<section class="prop-block stair-shape-fields"><h3>Форма каждой ступени</h3>
    <label class="prop-field"><span>Редактировать</span><select id="stairPart">${t.parts.map((part) => `<option value="${part.key}" ${part.key === p.key ? 'selected' : ''}>${escapeHtml(part.title)}</option>`).join('')}</select></label>
    <div class="prop-grid porch-fields">${[
    ['Width', 'Ширина, мм', r.right - r.left, 100, 24000],
    ['Depth', 'Глубина, мм', r.front - r.back, 100, 24000],
    ['Side', 'Смещение вбок, мм', (r.left + r.right - p.base.left - p.base.right) / 2, -12000, 12000],
    ['Along', 'Вдоль марша, мм', (r.front + r.back - p.base.front - p.base.back) / 2, -12000, 12000],
  ].map(([id, title, value, min, max]) => `<label class="prop-field"><span>${title}</span><input id="stairPart${id}" type="number" min="${min}" max="${max}" step="50" value="${Math.round(value)}"></label>`).join('')}</div>
    <p class="hint">В «Ландшафте» и 3D тяните круглые ручки выбранной ступени. Shift — без шага. Esc — отменить.</p>
    <button type="button" id="stairPartReset">Сбросить форму элемента</button></section>`;
}

export function bindStairShapeFields(panel) {
  const t = target(); const part = chosen(t);
  if (!part || !panel.querySelector('#stairPart')) return;
  panel.querySelector('#stairPart').addEventListener('change', (e) => selectObject({ ...state.selection, part: e.target.value }));
  for (const id of ['Width', 'Depth', 'Side', 'Along']) {
    const input = panel.querySelector(`#stairPart${id}`);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(v) || v < Number(input.min) || v > Number(input.max)) { toast('Проверьте размер ступени'); return; }
      const r = { ...part.rect };
      if (id === 'Width') r.right = r.left + v;
      if (id === 'Depth') r.front = r.back + v;
      if (id === 'Side') {
        const dx = v - (r.left + r.right - part.base.left - part.base.right) / 2;
        r.left += dx; r.right += dx;
      }
      if (id === 'Along') {
        const dy = v - (r.front + r.back - part.base.front - part.base.back) / 2;
        r.front += dy; r.back += dy;
      }
      mutate(() => patchRect(t, part, r));
    });
  }
  panel.querySelector('#stairPartReset').addEventListener('click', () => mutate(() => {
    const edits = { ...t.get() }; delete edits[part.key]; t.set(edits);
  }));
}

function activePart() {
  if (!env) return null;
  const faces = env.faces(); const key = JSON.stringify(state.selection);
  if (cache?.faces === faces && cache.key === key && cache.project === state.project) return cache.value;
  const t = target(); const part = chosen(t);
  let value = null;
  if (part) {
    const face = faces.find((f) => f.stairPart === part.key && f.normal.z > .9 &&
      (state.selection.type === 'entrance' ? f.openingId === t.object.id : f.landscapeId === t.object.id));
    if (face) value = { t, part: { ...part, z: face.pts[0].z } };
  }
  cache = { faces, key, project: state.project, value };
  return value;
}

function edgePoint(part, edge) {
  const r = part.rect;
  const x = edge === 'left' || edge === 'right' ? r[edge] : (r.left + r.right) / 2;
  const y = edge === 'front' || edge === 'back' ? r[edge] : (r.back + r.front) / 2;
  return { x: part.origin.x + part.xAxis.x * x + part.yAxis.x * y,
    y: part.origin.y + part.xAxis.y * x + part.yAxis.y * y, z: part.z };
}

export function updateStairShapeHandles() {
  if (!layer) return;
  const active = activePart();
  layer.hidden = !active;
  if (!active) return;
  const bounds = env.canvas().getBoundingClientRect();
  const parent = layer.getBoundingClientRect();
  for (const button of layer.querySelectorAll('[data-stair-edge]')) {
    const point = env.project(edgePoint(active.part, button.dataset.stairEdge));
    const visible = point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
    button.hidden = !visible;
    if (visible) { button.style.left = `${point.x - parent.left}px`; button.style.top = `${point.y - parent.top}px`; }
    button.title = `${active.part.title}: тяните край`;
  }
}

function finish(cancel = false) {
  const d = drag; if (!d) return;
  drag = null;
  if (cancel) d.t.set(d.edits);
  else if (JSON.stringify(d.edits) !== JSON.stringify(d.t.get())) { pushHistory(d.before); afterChange(); }
  cache = null; env.rebuild(); env.hint();
}
export const cancelStairShapeDrag = () => finish(true);

export function initStairShape3d(value) {
  env = value;
  if (layer) return;
  layer = document.createElement('div'); layer.className = 'stair-shape-handles'; layer.hidden = true;
  layer.setAttribute('aria-label', 'Края выбранной ступени');
  const labels = { left: 'Левый край', right: 'Правый край', back: 'Задний край', front: 'Передний край' };
  layer.innerHTML = STAIR_EDGES.map((edge) => `<button type="button" data-stair-edge="${edge}" aria-label="${labels[edge]}">${['left', 'right'].includes(edge) ? '↔' : '↕'}</button>`).join('');
  env.canvas().parentElement.appendChild(layer);
  layer.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('[data-stair-edge]'); const a = activePart();
    if (!button || !a || event.button !== 0 || drag) return;
    event.preventDefault(); event.stopPropagation(); button.setPointerCapture(event.pointerId);
    const point = edgePoint(a.part, button.dataset.stairEdge);
    drag = { ...a, edge: button.dataset.stairEdge, pointer: event.pointerId, before: snapshot(),
      edits: structuredClone(a.t.get()), x: event.clientX, y: event.clientY, point,
      start: env.rayPlaneZ(env.ray(event), a.part.z) };
  });
  layer.addEventListener('pointermove', (event) => {
    const d = drag; if (!d || d.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const axis = ['left', 'right'].includes(d.edge) ? d.part.xAxis : d.part.yAxis;
    const point = env.rayPlaneZ(env.ray(event), d.part.z);
    let delta;
    if (point && d.start) delta = (point.x - d.start.x) * axis.x + (point.y - d.start.y) * axis.y;
    else {
      const a = env.project(d.point); const b = env.project({ x: d.point.x + axis.x * 1000, y: d.point.y + axis.y * 1000, z: d.point.z });
      const dx = b.x - a.x; const dy = b.y - a.y;
      delta = ((event.clientX - d.x) * dx + (event.clientY - d.y) * dy) * 1000 / Math.max(1, dx * dx + dy * dy);
    }
    const step = event.shiftKey ? 1 : 50;
    const r = { ...d.part.rect }; r[d.edge] += Math.round(delta / step) * step;
    if (r.right - r.left < 100 || r.front - r.back < 100 || r.right - r.left > 24000 || r.front - r.back > 24000) return;
    patchRect(d.t, d.part, r); cache = null; env.rebuild();
    env.hint(`${d.part.title} · ${Math.round(r.right - r.left)} × ${Math.round(r.front - r.back)} мм · Esc — отменить`);
  });
  layer.addEventListener('pointerup', (e) => { if (drag?.pointer === e.pointerId) { e.stopPropagation(); finish(); } });
  layer.addEventListener('pointercancel', () => finish(true));
  layer.addEventListener('lostpointercapture', () => { if (drag) finish(true); });
  document.addEventListener('keydown', (e) => {
    if (drag && (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ'))) {
      e.preventDefault(); e.stopImmediatePropagation(); finish(true);
    }
  }, true);
  document.addEventListener('pointerdown', (e) => { if (drag && e.pointerId !== drag.pointer) finish(true); }, true);
}

// Общая модель редактирования для ручек на плане и в 3D.
export function stairShapeSelection() {
  const t = target(); const part = chosen(t);
  return part ? { t, part } : null;
}
export { edgePoint as stairShapeEdgePoint, patchRect as setStairShapeRect };

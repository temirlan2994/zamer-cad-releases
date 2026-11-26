import { toLocal } from '../core/building.js';
import { deriveEntrances, entranceParts } from '../core/entrance.js';
import { stairTreads } from '../core/landscape.js';
import { STAIR_EDGES, STAIR_HEIGHT_EDGES, STAIR_MIN_THICKNESS, stairRectPolygon } from '../core/stair-shape.js';
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
        polygon: stairRectPolygon(rect, origin, xAxis, yAxis), z: t.z, z0: t.z0, baseZ: t.baseZ };
    });
    return { object, parts, get: () => object.meta?.shapeEdits || {}, set: (shapeEdits) => { object.meta = { ...object.meta, shapeEdits }; } };
  }
  return null;
}

const chosen = (t) => t?.parts.find((p) => p.key === state.selection?.part);
const patchRect = (t, part, rect) => t.set({ ...t.get(), [part.key]: { ...t.get()[part.key], ...Object.fromEntries(STAIR_EDGES.map((e) => [e, Math.round(rect[e] - part.base[e])])) } });
const patchHeight = (t, part, edge, value) => t.set({ ...t.get(), [part.key]: { ...t.get()[part.key], [edge]: Math.round(value - part.baseZ[edge]) } });
const validHeight = (part, edge, value) => {
  const thickness = edge === 'upper' ? value - part.z0 : part.z - value;
  return Number.isFinite(value) && Math.abs(value - part.baseZ[edge]) <= 48000 && thickness >= STAIR_MIN_THICKNESS && thickness <= 24000;
};

export function stairShapeFields() {
  const t = target(); const p = chosen(t);
  if (!t) return '';
  if (!p) return `<section class="prop-block"><p class="hint">Повторно нажмите на нужную ступень или площадку, чтобы изменить её отдельно.</p>
    <label class="prop-field"><span>Редактировать</span><select id="stairPart"><option value="" selected>Вся лестница</option>${t.parts.map((part) => `<option value="${part.key}">${escapeHtml(part.title)}</option>`).join('')}</select></label></section>`;
  const r = p.rect;
  const datum = state.selection.type === 'entrance' ? 'Отметки — от пола ±0.000.' : 'Отметки — от основания лестницы.';
  return `<section class="prop-block stair-shape-fields"><h3>Форма каждой ступени</h3>
    <label class="prop-field"><span>Редактировать</span><select id="stairPart">${t.parts.map((part) => `<option value="${part.key}" ${part.key === p.key ? 'selected' : ''}>${escapeHtml(part.title)}</option>`).join('')}</select></label>
    <div class="prop-grid porch-fields">${[
    ['Width', 'Ширина, мм', r.right - r.left, 100, 24000],
    ['Depth', 'Глубина, мм', r.front - r.back, 100, 24000],
    ['Side', 'Смещение вбок, мм', (r.left + r.right - p.base.left - p.base.right) / 2, -12000, 12000],
    ['Along', 'Вдоль марша, мм', (r.front + r.back - p.base.front - p.base.back) / 2, -12000, 12000],
  ].map(([id, title, value, min, max]) => `<label class="prop-field"><span>${title}</span><input id="stairPart${id}" type="number" min="${min}" max="${max}" step="50" value="${Math.round(value)}"></label>`).join('')}</div>
    <div class="prop-grid porch-fields">${[
    ['upper', 'Верхняя грань, мм', p.z, Math.max(p.baseZ.upper - 48000, p.z0 + STAIR_MIN_THICKNESS), Math.min(p.baseZ.upper + 48000, p.z0 + 24000)],
    ['lower', 'Нижняя грань, мм', p.z0, Math.max(p.baseZ.lower - 48000, p.z - 24000), Math.min(p.baseZ.lower + 48000, p.z - STAIR_MIN_THICKNESS)],
  ].map(([edge, title, value, min, max]) => `<label class="prop-field"><span>${title}</span><input id="stairPart-${edge}" type="number" min="${Math.ceil(min)}" max="${Math.floor(max)}" step="10" value="${Math.round(value)}"></label>`).join('')}</div>
    <p class="hint">Толщина: <output id="stairPartThickness">${Math.round(p.z - p.z0)}</output> мм. ${datum}</p>
    <p class="hint">Тяните точки в центрах граней. Боковые меняют ширину и глубину, верхняя и нижняя — высоту и толщину. Shift — без шага. Esc — отменить.</p>
    <button type="button" id="stairPartReset">Сбросить форму элемента</button>
    <button type="button" id="stairWhole">Вся лестница</button></section>`;
}

export function bindStairShapeFields(panel) {
  const t = target(); const part = chosen(t);
  if (!t || !panel.querySelector('#stairPart')) return;
  const selectPart = (part) => { const next = { ...state.selection }; if (part) next.part = part; else delete next.part; selectObject(next); };
  panel.querySelector('#stairPart').addEventListener('change', (e) => selectPart(e.target.value));
  if (!part) return;
  panel.querySelector('#stairWhole').addEventListener('click', () => selectPart(null));
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
  for (const edge of STAIR_HEIGHT_EDGES) {
    const input = panel.querySelector(`#stairPart-${edge}`);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!input.value.trim() || !validHeight(part, edge, v)) { toast('Верх должен быть выше низа минимум на 20 мм'); input.value = Math.round(edge === 'upper' ? part.z : part.z0); return; }
      mutate(() => patchHeight(t, part, edge, v));
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
    const partFaces = faces.filter((f) => f.stairPart === part.key &&
      (state.selection.type === 'entrance' ? f.openingId === t.object.id : f.landscapeId === t.object.id));
    const face = partFaces.find((f) => f.normal.z > .9);
    if (face) {
      const offset = face.pts[0].z - part.z;
      value = { t, part: { ...part, z: face.pts[0].z, z0: part.z0 + offset, datumOffset: offset,
        baseZ: { lower: part.baseZ.lower + offset, upper: part.baseZ.upper + offset }, centers: faceCenters(part, partFaces) } };
    }
  }
  cache = { faces, key, project: state.project, value };
  return value;
}

function faceCenters(part, faces) {
  const centers = {};
  for (const edge of [...STAIR_EDGES, ...STAIR_HEIGHT_EDGES]) {
    const axis = ['left', 'right'].includes(edge) ? part.xAxis : part.yAxis;
    const matching = faces.filter((f) => edge === 'upper' ? f.normal.z > .9 : edge === 'lower' ? f.normal.z < -.9
      : f.pts.every((p) => Math.abs((p.x - part.origin.x) * axis.x + (p.y - part.origin.y) * axis.y - part.rect[edge]) < .1));
    // Верх и низ разбиты на треугольники: общие вершины считаем один раз.
    const vertices = [...new Map(matching.flatMap((f) => f.pts).map((p) => [
      `${p.x.toFixed(3)}|${p.y.toFixed(3)}|${p.z.toFixed(3)}`, p,
    ])).values()];
    if (vertices.length) centers[edge] = vertices.reduce((a, p) => ({ x: a.x + p.x / vertices.length,
      y: a.y + p.y / vertices.length, z: a.z + p.z / vertices.length }), { x: 0, y: 0, z: 0 });
  }
  return centers;
}

function edgePoint(part, edge) {
  if (part.centers?.[edge]) return part.centers[edge];
  const r = part.rect;
  const x = edge === 'left' || edge === 'right' ? r[edge] : (r.left + r.right) / 2;
  const y = edge === 'front' || edge === 'back' ? r[edge] : (r.back + r.front) / 2;
  return { x: part.origin.x + part.xAxis.x * x + part.yAxis.x * y,
    y: part.origin.y + part.xAxis.y * x + part.yAxis.y * y, z: (part.z + part.z0) / 2 };
}

function heightPoint(part, edge) {
  if (part.centers?.[edge]) return part.centers[edge];
  const r = part.rect; const x = (r.left + r.right) / 2; const y = (r.back + r.front) / 2;
  return { x: part.origin.x + part.xAxis.x * x + part.yAxis.x * y,
    y: part.origin.y + part.xAxis.y * x + part.yAxis.y * y, z: edge === 'upper' ? part.z : part.z0 };
}

function heightScreen(part, edge) {
  const p = heightPoint(part, edge); const a = env.project(p);
  const b = env.project({ ...p, z: p.z + 1000 });
  const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy);
  // При виде строго сверху высота редактируется числом в свойствах.
  if (length < 3) return null;
  return a;
}

function heightAtPointer(d, event) {
  // Вертикальная плоскость обращена к камере; грань следует за точкой
  // захвата также в перспективе.
  const ray = env.ray({ clientX: d.screen.x + event.clientX - d.x, clientY: d.screen.y + event.clientY - d.y });
  const n = d.normal; const denominator = ray.d.x * n.x + ray.d.y * n.y;
  if (Math.abs(denominator) < 1e-9) return null;
  const distance = ((d.point.x - ray.o.x) * n.x + (d.point.y - ray.o.y) * n.y) / denominator;
  return ray.o.z + distance * ray.d.z;
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
    button.title = `${active.part.title} · ${button.getAttribute('aria-label')}: тяните грань`;
  }
  for (const button of layer.querySelectorAll('[data-stair-height]')) {
    const edge = button.dataset.stairHeight; const point = heightScreen(active.part, edge);
    button.hidden = !point || point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom;
    if (point) { button.style.left = `${point.x - parent.left}px`; button.style.top = `${point.y - parent.top}px`; }
    button.title = `${edge === 'upper' ? 'Верхняя' : 'Нижняя'} грань · ${Math.round((edge === 'upper' ? active.part.z : active.part.z0) - active.part.datumOffset)} мм: тяните по высоте`;
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

export function closestStairHandle(layer, event) {
  const distance = (b) => { const r = b.getBoundingClientRect(); return Math.hypot(event.clientX - r.x - r.width / 2, event.clientY - r.y - r.height / 2); };
  return [...layer.querySelectorAll('button')].filter((b) => !b.hidden).sort((a, b) => distance(a) - distance(b))[0];
}

export function initStairShape3d(value) {
  env = value;
  if (layer) return;
  layer = document.createElement('div'); layer.className = 'stair-shape-handles'; layer.hidden = true;
  layer.setAttribute('aria-label', 'Грани выбранной ступени');
  const labels = { left: 'Левая грань', right: 'Правая грань', back: 'Задняя грань', front: 'Передняя грань' };
  layer.innerHTML = STAIR_EDGES.map((edge) => `<button type="button" data-stair-edge="${edge}" aria-label="${labels[edge]}"></button>`).join('');
  layer.innerHTML += STAIR_HEIGHT_EDGES.map((edge) => `<button type="button" data-stair-height="${edge}" aria-label="${edge === 'upper' ? 'Верхняя' : 'Нижняя'} грань"></button>`).join('');
  env.canvas().parentElement.appendChild(layer);
  layer.addEventListener('pointerdown', (event) => {
    let button = event.target.closest('[data-stair-edge], [data-stair-height]'); const a = activePart();
    if (!button || !a || event.button !== 0 || drag) return;
    // Невидимые области касания могут пересекаться у тонких ступеней.
    // Захватываем ближайшую точку, независимо от порядка кнопок в DOM.
    button = closestStairHandle(layer, event);
    event.preventDefault(); event.stopPropagation(); button.setPointerCapture(event.pointerId);
    const height = button.dataset.stairHeight;
    const point = height ? heightPoint(a.part, height) : edgePoint(a.part, button.dataset.stairEdge);
    drag = { ...a, edge: height || button.dataset.stairEdge, height: Boolean(height), pointer: event.pointerId, before: snapshot(),
      edits: structuredClone(a.t.get()), x: event.clientX, y: event.clientY, point,
      screen: env.project(point), normal: env.ray(event).d,
      start: env.rayPlaneZ(env.ray(event), point.z) };
  });
  layer.addEventListener('pointermove', (event) => {
    const d = drag; if (!d || d.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (d.height) {
      const z = heightAtPointer(d, event); if (z === null) return;
      const delta = z - d.point.z;
      const initial = d.edge === 'upper' ? d.part.z : d.part.z0;
      const value = initial + Math.round(delta / (event.shiftKey ? 1 : 10)) * (event.shiftKey ? 1 : 10);
      if (!validHeight(d.part, d.edge, value)) return;
      if (value === initial) d.t.set(d.edits); else patchHeight(d.t, d.part, d.edge, value);
      cache = null; env.rebuild();
      const thickness = d.edge === 'upper' ? value - d.part.z0 : d.part.z - value;
      env.hint(`${d.part.title} · ${d.edge === 'upper' ? 'Верх' : 'Низ'} ${Math.round(value - d.part.datumOffset)} мм · Толщина ${Math.round(thickness)} мм · Esc — отменить`);
      return;
    }
    const axis = ['left', 'right'].includes(d.edge) ? d.part.xAxis : d.part.yAxis;
    const point = env.rayPlaneZ(env.ray(event), d.point.z);
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

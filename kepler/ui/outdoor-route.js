import { fmtElev, makeLandscapeId, normalizeElev } from '../core/landscape.js';
import { groundFn } from '../core/landscape-section.js';
import { outdoorLights, plotOutdoorRoute, ROUTE_KINDS, ROUTE_LIMIT } from '../core/outdoor-route.js';
import { travelAnchorAt } from '../core/outdoor-stair-links.js';
import { el, toast } from './dom.js';
import { addLandscapeObjects, landscapeObjects, snapLs } from './landscape.js';
import { state } from './state.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

const hint = 'Укажите точки пути. Настройте участки в свойствах и нажмите «Готово»';
const fitNumber = (value, min, max, fallback) => Math.min(max, Math.max(min, Number(value) || fallback));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function startOutdoorRoute() {
  setTool({
    kind: 'ls-route', mode: 'path', points: [], cursor: null, sections: [],
    lampSide: 'off', lampStep: 2200, id: makeLandscapeId(), ground: groundFn(state.project),
  }, hint);
  selectObject(null);
}

function snappedNode(tool, world, event) {
  const point = snapLs(world, event, { prev: tool.points.at(-1), points: tool.points });
  const radius = Math.min(450, 12 / state.view.scale);
  const anchor = event.shiftKey ? null : travelAnchorAt(point, landscapeObjects(), radius);
  const p = anchor?.point ?? point;
  return { x: Math.round(p.x), y: Math.round(p.y), free: event.shiftKey === true };
}

export function outdoorRouteHover(world, canvas, event) {
  state.tool.cursor = snappedNode(state.tool, world, event);
  canvas.style.cursor = 'crosshair';
  requestDraw();
  return true;
}

export function addOutdoorRoutePoint(tool, world, event) {
  if (state.tool !== tool) return;
  if (tool.points.length >= ROUTE_LIMIT) { toast('В маршруте до 32 точек', true); return; }
  const p = snappedNode(tool, world, event);
  if (tool.points.length && distance(tool.points.at(-1), p) < 200) return;
  tool.points.push(p);
  if (tool.points.length > 1) tool.sections.push({ kind: 'auto', width: 1800 });
  tool.cursor = null;
  updateRoute(tool);
  selectObject(null);
}

function updateRoute(tool) {
  tool.preview = plotOutdoorRoute(tool.points, {
    sections: tool.sections, ground: tool.ground, objects: landscapeObjects(), tolerance: 65, id: tool.id,
  });
  setHint(tool.preview.errors[0] || hint);
  drawProfile(tool);
  updateReadout(tool);
  requestDraw();
}

export function finishOutdoorRoute() {
  const tool = state.tool;
  if (tool?.kind !== 'ls-route') return false;
  updateRoute(tool);
  if (tool.points.length < 2 || tool.preview.errors.length) {
    toast(tool.preview.errors[0] || 'Добавьте хотя бы две точки', true);
    return false;
  }
  const objects = tool.preview.objects;
  if (tool.lampSide !== 'off') objects.push(...outdoorLights(objects, {
    ground: tool.ground, side: tool.lampSide, step: tool.lampStep, id: tool.id,
  }));
  cancelTool();
  addLandscapeObjects(objects);
  return true;
}

export function handleOutdoorRouteKey(event) {
  const tool = state.tool;
  if (event.key === 'Enter') { event.preventDefault(); finishOutdoorRoute(); return true; }
  if (event.key === 'Backspace') {
    event.preventDefault();
    tool.points.pop();
    tool.sections.pop();
    tool.cursor = null;
    updateRoute(tool);
    selectObject(null);
    return true;
  }
  return event.key === 'Delete';
}

const width = 500;
const height = 108;
const padX = 28;
const padY = 15;

function drawProfile(tool) {
  const panel = el('lsRouteProfile');
  const { nodes, runs, samples, total } = tool.preview;
  panel.hidden = !samples.length;
  if (!samples.length) { tool.profile = null; return; }
  const levels = samples.flatMap((p) => [p.ground, p.top]).concat(nodes.map((n) => n.level));
  const min = Math.min(...levels) - 100;
  const max = Math.max(Math.max(...levels) + 100, min + 480);
  // Фиксируем шкалу на время перетаскивания, чтобы узел не «убегал» от указателя.
  const range = dragScale || { min, max };
  const x = (s) => padX + (s / total) * (width - 2 * padX);
  const y = (z) => height - padY - (z - range.min) * (height - 2 * padY) / (range.max - range.min);
  const line = (key) => samples.map((p) => `${x(p.s).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const length = (total / 1000).toFixed(1).replace('.', ',');
  panel.querySelector('span').textContent = `${length} м · земля и проект`;
  panel.querySelector('svg').innerHTML = `
    <polyline class="ls-profile-ground" points="${line('ground')}"/>
    <polyline class="ls-profile-built" points="${line('top')}"/>
    ${nodes.map((n, i) => {
      const cx = x(i ? runs[i - 1].offset + runs[i - 1].length : 0);
      const cy = y(n.level);
      return `<g data-route-node="${i}"><title>Точка ${i + 1} · ${fmtElev(n.level)} м</title>
        <circle cx="${cx}" cy="${cy}" r="7"/><text x="${cx}" y="${cy - 10}">${fmtElev(n.level)}</text></g>`;
    }).join('')}`;
  tool.profile = range;
}

let draggedNode = null;
let dragScale = null;

export function bindOutdoorRouteProfile() {
  const panel = el('lsRouteProfile');
  const svg = panel.querySelector('svg');
  panel.querySelector('button').addEventListener('click', () => {
    const hidden = svg.classList.toggle('folded');
    panel.querySelector('button').setAttribute('aria-expanded', String(!hidden));
  });
  svg.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('[data-route-node]');
    if (state.tool?.kind !== 'ls-route' || !node || !state.tool.profile) return;
    draggedNode = Number(node.dataset.routeNode);
    dragScale = state.tool.profile;
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  svg.addEventListener('pointermove', (event) => {
    const tool = state.tool;
    if (tool?.kind !== 'ls-route' || draggedNode == null || !dragScale) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const { y } = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const t = (height - padY - y) / (height - 2 * padY);
    tool.points[draggedNode].level = normalizeElev(Math.round((dragScale.min + t * (dragScale.max - dragScale.min)) / 10) * 10);
    updateRoute(tool);
  });
  const end = () => {
    if (draggedNode == null) return;
    draggedNode = null;
    dragScale = null;
    if (state.tool?.kind === 'ls-route') { updateRoute(state.tool); selectObject(null); }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

const choices = (list, value) => list.map(({ id, title }) => `<option value="${id}"${id === value ? ' selected' : ''}>${title}</option>`).join('');
const lightSides = [{ id: 'off', title: 'Без света' }, { id: 'left', title: 'Слева' },
  { id: 'right', title: 'Справа' }, { id: 'both', title: 'С двух сторон' }];

function routeTitle(r) {
  return `${r.index + 1}–${r.index + 2} · ${ROUTE_KINDS.find((k) => k.id === r.kind).title}`;
}

function updateReadout(tool) {
  const sum = el('lsRouteReadout');
  if (!sum) return;
  const { nodes, total, samples, errors } = tool.preview;
  const fill = Math.max(0, ...samples.map((s) => s.top - s.ground));
  const cut = Math.max(0, ...samples.map((s) => s.ground - s.top));
  const earth = [fill >= 40 && `выше земли до ${Math.round(fill)} мм`, cut >= 40 && `ниже земли до ${Math.round(cut)} мм`].filter(Boolean);
  sum.textContent = errors[0] || (total ? [`${(total / 1000).toFixed(1)} м`, ...earth].join(' · ') : hint);
  const finish = el('lsRouteFinish');
  if (finish) finish.disabled = tool.points.length < 2 || Boolean(errors.length);
  nodes.forEach((node, index) => {
    const field = document.querySelector(`[data-route-level="${index}"]`);
    if (field) field.placeholder = node.level;
  });
  for (const run of tool.preview.runs) {
    const row = document.querySelector(`[data-route-section="${run.index}"]`);
    if (!row) continue;
    row.querySelector('summary').textContent = routeTitle(run);
    row.querySelector('[data-route-stair]').hidden = run.kind !== 'stairs';
    row.querySelector('[data-route-slab]').hidden = run.kind !== 'slabs';
  }
}

export function renderOutdoorRouteProps(panel) {
  const tool = state.tool;
  if (!tool.preview) updateRoute(tool);
  const { nodes, runs } = tool.preview;
  panel.innerHTML = `
    <h2>Маршрут по участку</h2>
    <div class="prop-block">
      <p id="lsRouteReadout" class="hint" aria-live="polite"></p>
      <details${tool.points.length <= 4 ? ' open' : ''}><summary>Отметки точек</summary>
        <div class="prop-grid">${nodes.map((n, i) => `<label class="prop-field"><span>Точка ${i + 1}, мм</span>
          <input type="number" step="10" min="-20000" max="20000" data-route-level="${i}" value="${tool.points[i].level ?? ''}" placeholder="${n.level}"></label>`).join('')}</div>
      </details>
      ${runs.map((r) => `<details data-route-section="${r.index}"${r.index === runs.length - 1 ? ' open' : ''}>
        <summary>${routeTitle(r)}</summary>
        <div class="prop-grid">
          <label class="prop-field"><span>Тип участка</span><select data-route-field="kind">${choices(ROUTE_KINDS, tool.sections[r.index].kind)}</select></label>
          <label class="prop-field"><span>Ширина, мм</span><input data-route-field="width" type="number" min="500" max="6000" step="50" value="${r.width}"></label>
        </div>
        <label class="prop-field" data-route-stair${r.kind === 'stairs' ? '' : ' hidden'}><span>Удлинение средней площадки, мм</span><input data-route-field="landing" type="number" min="0" max="6000" step="50" value="${r.landing}"></label>
        <label class="check-row" data-route-slab${r.kind === 'slabs' ? '' : ' hidden'}><input type="checkbox" data-route-field="stagger"${r.stagger ? ' checked' : ''}><span>Чередовать размер и смещение плит</span></label>
      </details>`).join('')}
      <div class="prop-grid">
        <label class="prop-field"><span>Свет вдоль маршрута</span><select id="lsRouteLightSide">${choices(lightSides, tool.lampSide)}</select></label>
        <label class="prop-field"><span>Шаг светильников, мм</span><input id="lsRouteLightStep" type="number" min="500" max="10000" step="100" value="${tool.lampStep}"></label>
      </div>
    </div>
    <div class="prop-actions"><button type="button" id="lsRouteFinish">Готово</button><button type="button" id="lsRouteCancel">Отмена</button></div>`;
  updateReadout(tool);
  panel.querySelectorAll('[data-route-level]').forEach((input) => input.addEventListener('change', () => {
    tool.points[Number(input.dataset.routeLevel)].level = normalizeElev(input.value);
    updateRoute(tool);
  }));
  panel.querySelectorAll('[data-route-field]').forEach((input) => input.addEventListener('change', () => {
    const index = Number(input.closest('[data-route-section]').dataset.routeSection);
    const field = input.dataset.routeField;
    const row = tool.sections[index];
    row[field] = field === 'kind' ? input.value : field === 'stagger' ? input.checked
      : fitNumber(input.value, field === 'width' ? 500 : 0, 6000, field === 'width' ? 1800 : 0);
    if (field === 'width' || field === 'landing') input.value = row[field];
    updateRoute(tool);
  }));
  el('lsRouteLightSide').addEventListener('change', (e) => { tool.lampSide = e.target.value; });
  el('lsRouteLightStep').addEventListener('change', (e) => {
    tool.lampStep = fitNumber(e.target.value, 500, 10000, 2200);
    e.target.value = tool.lampStep;
  });
  el('lsRouteFinish').addEventListener('click', finishOutdoorRoute);
  el('lsRouteCancel').addEventListener('click', () => { cancelTool(); selectObject(null); });
}

export function outdoorLightsHtml(o) {
  if (!['path', 'stairs-out'].includes(o.kind)) return '';
  return `<details><summary>Свет вдоль</summary><div class="prop-grid">
    <label class="prop-field"><span>Сторона</span><select id="lsEdgeLightSide">${choices(lightSides.slice(1), 'left')}</select></label>
    <label class="prop-field"><span>Шаг, мм</span><input id="lsEdgeLightStep" type="number" min="500" max="10000" step="100" value="2200"></label>
  </div><button type="button" id="lsEdgeLightAdd">Расставить светильники</button></details>`;
}

export function bindOutdoorLights(panel, o) {
  panel.querySelector('#lsEdgeLightAdd')?.addEventListener('click', () => {
    const step = fitNumber(el('lsEdgeLightStep').value, 500, 10000, 2200);
    const lamps = outdoorLights([o], { ground: groundFn(state.project), step, side: el('lsEdgeLightSide').value });
    if (!lamps.length) { toast('Участок слишком короткий для светильников', true); return; }
    addLandscapeObjects(lamps, { select: false });
    selectObject({ type: 'landscape', ids: [o.id] });
    toast(`Светильников добавлено · ${lamps.length}`);
  });
}

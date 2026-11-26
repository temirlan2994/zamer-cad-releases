// Ручки краёв выбранной проступи на плане ландшафта. Изменения используют
// ту же модель shapeEdits, что и свойства и 3D; один жест — одна запись истории.
import { STAIR_EDGES } from '../core/stair-shape.js';
import { canvas } from './dom.js';
import { invalidateEntrancePlan } from './render-entrance.js';
import { closestStairHandle, setStairShapeRect, stairShapeEdgePoint, stairShapeSelection } from './stair-shape.js';
import { state } from './state.js';
import { afterChange, pushHistory, snapshot } from './store.js';
import { setHint } from './tools.js';
import { planToScreen, requestDraw, screenToPlan } from './view.js';

let layer, drag, cached;
function active() {
  if (!state.project || state.modeName !== 'landscape' || state.tool || state.editLocked || document.body.classList.contains('v3-open')) return null;
  const key = JSON.stringify(state.selection);
  if (drag) return drag.current;
  if (cached?.project === state.project && cached.revision === state.drawingRevision && cached.key === key && cached.walls === state.walls) return cached.value;
  let value = stairShapeSelection();
  // У отдельной лестницы выбор целиком сохраняет штатные ручки всего объекта.
  // Конкретная ступень выбирается в списке «Редактировать».
  if (state.selection?.type === 'landscape' && !state.selection.part) value = null;
  cached = { project: state.project, revision: state.drawingRevision, key, walls: state.walls, value };
  return value;
}

function clientPlan(event) {
  const r = canvas.getBoundingClientRect();
  return screenToPlan(event.clientX - r.left, event.clientY - r.top);
}

export function updateStairShapePlanHandles() {
  if (!layer) return;
  if (drag && (state.project !== drag.project || state.modeName !== 'landscape' || state.editLocked || state.tool)) finish(true);
  const current = active();
  layer.hidden = !current;
  if (!current) return;
  const parent = layer.getBoundingClientRect(); const bounds = canvas.getBoundingClientRect();
  for (const button of layer.querySelectorAll('[data-stair-plan-edge]')) {
    const edge = button.dataset.stairPlanEdge;
    const part = current.part; const point = stairShapeEdgePoint(part, edge);
    const a = planToScreen(point.x, point.y);
    const x = bounds.left + a.x; const y = bounds.top + a.y;
    button.hidden = x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
    button.style.left = `${x - parent.left}px`; button.style.top = `${y - parent.top}px`;
    button.title = `${part.title}: тяните край`;
  }
}

function finish(cancel = false) {
  const d = drag; if (!d) return;
  drag = null;
  if (cancel) d.t.set(d.edits);
  else if (JSON.stringify(d.edits) !== JSON.stringify(d.t.get())) { pushHistory(d.before); afterChange(); }
  cached = null; invalidateEntrancePlan(state); setHint(''); requestDraw();
}

export function initStairShapePlan() {
  if (layer) return;
  layer = document.createElement('div'); layer.className = 'stair-shape-handles stair-shape-plan-handles'; layer.hidden = true;
  layer.setAttribute('aria-label', 'Края выбранной ступени на плане');
  const labels = { left: 'Левый край', right: 'Правый край', back: 'Задний край', front: 'Передний край' };
  layer.innerHTML = STAIR_EDGES.map((edge) => `<button type="button" data-stair-plan-edge="${edge}" aria-label="${labels[edge]}"></button>`).join('');
  canvas.parentElement.appendChild(layer);
  layer.addEventListener('pointerdown', (event) => {
    let button = event.target.closest('[data-stair-plan-edge]'); const current = active();
    if (!button || !current || event.button !== 0 || drag) return;
    button = closestStairHandle(layer, event);
    event.preventDefault(); event.stopPropagation(); button.setPointerCapture(event.pointerId);
    drag = { ...current, current, project: state.project, edge: button.dataset.stairPlanEdge, pointer: event.pointerId,
      before: snapshot(), edits: structuredClone(current.t.get()), start: clientPlan(event) };
  });
  layer.addEventListener('pointermove', (event) => {
    const d = drag; if (!d || event.pointerId !== d.pointer) return;
    event.preventDefault(); event.stopPropagation();
    const p = clientPlan(event); const axis = ['left', 'right'].includes(d.edge) ? d.part.xAxis : d.part.yAxis;
    const delta = (p.x - d.start.x) * axis.x + (p.y - d.start.y) * axis.y;
    const step = event.shiftKey ? 1 : 50;
    const rect = { ...d.part.rect }; rect[d.edge] += Math.round(delta / step) * step;
    if (rect.right - rect.left < 100 || rect.front - rect.back < 100 || rect.right - rect.left > 24000 || rect.front - rect.back > 24000) return;
    if (Math.abs(rect[d.edge] - d.part.base[d.edge]) > 48000) return;
    if (rect[d.edge] === d.part.rect[d.edge]) {
      if (JSON.stringify(d.t.get()) !== JSON.stringify(d.edits)) d.t.set(d.edits);
    }
    else setStairShapeRect(d.t, d.part, rect);
    d.current = { t: d.t, part: { ...d.part, rect } };
    invalidateEntrancePlan(state); requestDraw();
    setHint(`${d.part.title} · ${Math.round(rect.right - rect.left)} × ${Math.round(rect.front - rect.back)} мм · Esc — отменить`);
  });
  layer.addEventListener('pointerup', (event) => { if (event.pointerId === drag?.pointer) { event.stopPropagation(); finish(); } });
  layer.addEventListener('pointercancel', () => finish(true));
  layer.addEventListener('lostpointercapture', () => { if (drag) finish(true); });
  window.addEventListener('keydown', (event) => {
    if (drag && (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ'))) {
      event.preventDefault(); event.stopImmediatePropagation(); finish(true);
    }
  }, true);
  document.addEventListener('pointerdown', (event) => { if (drag && drag.pointer !== event.pointerId) finish(true); }, true);
}

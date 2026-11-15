// Проёмы в перекрытии на плане: выбор (контур, диагонали, подпись), ручки
// сторон и углов, сдвиг, «Свойства», удаление, «Вернуть авто по лестнице».
// Модель — core/slab-openings.js, рисование — ui/render-slab.js.
//
// Выбор — { type: 'slab', levelId, id }; id авто-проёма — 'auto:<id лестницы>'.
// Любая правка авто-проёма превращает его в ручной (за лестницей больше не
// следует) — выбор переходит на новую запись.

import {
  createSlabOpening, dragSlabRect, findSlabOpening, removeSlabOpening, resetSlabOpeningAuto,
  setSlabOpeningPolygon, setSlabOpeningRect, slabOpeningArea, slabOpeningPolygon, slabOpeningStair,
} from '../core/slab-openings.js';
import { snapWallPoint } from '../core/wall-manual.js';
import { canvas, escapeHtml, toast } from './dom.js';
import { SLAB_HANDLE } from './render-slab.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, refreshDerived, snapshot } from './store.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

const HANDLE_TITLES = {
  n: 'верхняя сторона', s: 'нижняя сторона', w: 'левая сторона', e: 'правая сторона',
  nw: 'угол', ne: 'угол', se: 'угол', sw: 'угол',
};

function segDist(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]; const b = polygon[i];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Что под курсором (экран): { id, part: <ручка> | 'edge' } или null.
export function hitSlab(screen) {
  if (state.modeName !== 'plan' || state.roofPlan) return null;
  const ui = state._slabUI || [];
  const tol = state.coarsePointer ? 10 : 5;
  const sel = state.selection?.type === 'slab' ? state.selection.id : null;
  const s = ui.find((r) => r.id === sel);
  if (s?.handles) {
    for (const h of s.handles) {
      if (Math.hypot(screen.x - h.s.x, screen.y - h.s.y) <= SLAB_HANDLE / 2 + tol) return { id: s.id, part: h.id };
    }
  }
  let best = null;
  for (const r of ui) {
    const P = r.P;
    let d = Infinity;
    for (let i = 0; i < P.length; i += 1) d = Math.min(d, segDist(screen, P[i], P[(i + 1) % P.length]));
    if (!r.polygon && P.length === 4) d = Math.min(d, segDist(screen, P[0], P[2]), segDist(screen, P[1], P[3]));
    if (pointInPolygon(screen, P)) d = Math.min(d, tol);
    const L = r.label;
    if (L && screen.x >= L.x0 && screen.x <= L.x1 && screen.y >= L.y0 && screen.y <= L.y1) d = 0;
    if (d <= tol && (!best || d < best.d)) best = { d, id: r.id };
  }
  return best ? { id: best.id, part: 'edge' } : null;
}

export function slabHoverTarget(screen) {
  const hit = hitSlab(screen);
  return hit ? { type: 'slab', levelId: state.project.activeLevel, id: hit.id } : null;
}

// Нажатие: ручка выбранного — правка размера, контур — выбор и сдвиг. → drag или null.
export function slabPointerDown(event, screen, plan) {
  const hit = hitSlab(screen);
  if (!hit) return null;
  const levelId = state.project.activeLevel;
  const o = findSlabOpening(state.project, levelId, hit.id);
  if (!o) return null;
  selectObject({ type: 'slab', levelId, id: o.id });
  const base = {
    levelId, id: o.id, start: { x: o.x, y: o.y, w: o.w, h: o.h },
    points: slabOpeningPolygon(o).map((p) => ({ ...p })), plan0: { x: plan.x, y: plan.y }, before: snapshot(), moved: false,
  };
  if (hit.part === 'edge') return { kind: 'slab-move', ...base };
  if (hit.part.startsWith('v:')) return { kind: 'slab-polygon', index: Number(hit.part.slice(2)), ...base };
  if (hit.part.startsWith('m:')) {
    const edge = Number(hit.part.slice(2));
    const a = base.points[edge]; const b = base.points[(edge + 1) % base.points.length];
    base.points.splice(edge + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const rec = setSlabOpeningPolygon(state.project, levelId, o.id, base.points);
    if (!rec) return null;
    if (rec.id !== base.id) {
      base.id = rec.id;
      state.selection = { type: 'slab', levelId, id: rec.id };
    }
    requestDraw();
    return { kind: 'slab-polygon', index: edge + 1, inserted: true, ...base, moved: true };
  }
  return { kind: 'slab-handle', handle: hit.part, ...base };
}

export function slabDragMove(drag, plan, event) {
  const g = event?.shiftKey ? 1 : gridStep();
  let rect; let polygon = null;
  if (drag.kind === 'slab-move') {
    const dx = Math.round((plan.x - drag.plan0.x) / g) * g;
    const dy = Math.round((plan.y - drag.plan0.y) / g) * g;
    if (!drag.moved && !dx && !dy) return;
    if (findSlabOpening(state.project, drag.levelId, drag.id)?.outline?.length) {
      polygon = drag.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else rect = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy };
  } else if (drag.kind === 'slab-polygon') {
    polygon = drag.points.map((p, i) => (i === drag.index
      ? { x: Math.round(plan.x / g) * g, y: Math.round(plan.y / g) * g } : { ...p }));
  } else {
    rect = dragSlabRect(drag.start, drag.handle, plan, g);
  }
  // Авто-проём при первой правке становится ручным — выбор идёт за записью.
  const rec = polygon
    ? setSlabOpeningPolygon(state.project, drag.levelId, drag.id, polygon)
    : setSlabOpeningRect(state.project, drag.levelId, drag.id, rect);
  if (!rec) return;
  if (rec.id !== drag.id) {
    drag.id = rec.id;
    state.selection = { type: 'slab', levelId: drag.levelId, id: rec.id };
  }
  drag.moved = true;
  state.slabLabel = drag.kind === 'slab-handle'
    ? { x: plan.x, y: plan.y, text: `Проём ${rec.w} × ${rec.h} мм · ${HANDLE_TITLES[drag.handle]}` }
    : drag.kind === 'slab-polygon'
      ? { x: plan.x, y: plan.y, text: `Контур · ${(slabOpeningArea(rec) / 1e6).toFixed(2).replace('.', ',')} м² · ${slabOpeningPolygon(rec).length} вершин` }
      : { x: plan.x, y: plan.y, text: `Проём: сдвиг ${rec.x - drag.start.x}, ${rec.y - drag.start.y} мм` };
  requestDraw();
}

export function slabDragEnd(drag) {
  state.slabLabel = null;
  if (!drag.moved) { requestDraw(); return; }
  refreshDerived();
  pushHistory(drag.before);
  afterChange();
}

// ------------------------------------------------------------ инструмент создания

const TOOL_HINT = 'Проём: кликайте точки контура · клик по первой точке или Enter — готово · Backspace — убрать точку · Esc — отмена';

export function startSlabOpeningTool() {
  if (state.modeName !== 'plan' || state.roofPlan) return;
  if (state.tool?.kind === 'slab-opening') { cancelTool(); return; }
  setTool({ kind: 'slab-opening', points: [], cursor: null, snapStart: false }, TOOL_HINT);
  canvas.style.cursor = 'crosshair';
  state.selection = null;
}

function snapSlabPoint(plan, event) {
  const t = state.tool;
  return snapWallPoint({
    p: plan, walls: state.walls || [], manual: state.project.walls || [], points: t?.points || [],
    tol: 12 / state.view.scale, grid: gridStep(), free: Boolean(event?.shiftKey), centers: false, mids: false,
  }).point;
}

function slabNearStart(plan) {
  const t = state.tool;
  if (t?.kind !== 'slab-opening' || t.points.length < 3) return false;
  return Math.hypot(plan.x - t.points[0].x, plan.y - t.points[0].y) <= 15 / state.view.scale;
}

export function slabToolHover(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'slab-opening') return false;
  t.snapStart = slabNearStart(plan) && !event?.shiftKey;
  t.cursor = t.snapStart ? { ...t.points[0] } : snapSlabPoint(plan, event);
  requestDraw();
  return true;
}

export function slabToolClick(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'slab-opening') return false;
  if (slabNearStart(plan) && !event?.shiftKey) { finishSlabOpeningTool(); return true; }
  const p = snapSlabPoint(plan, event);
  const last = t.points.at(-1);
  if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1) t.points.push({ x: p.x, y: p.y });
  t.cursor = { ...p };
  t.snapStart = false;
  setHint(t.points.length < 3 ? `Проём: поставлено точек ${t.points.length} из минимум 3` : TOOL_HINT);
  requestDraw();
  return true;
}

export function finishSlabOpeningTool() {
  const t = state.tool;
  if (t?.kind !== 'slab-opening') return false;
  if (t.points.length < 3) { toast('Для проёма нужно минимум 3 точки', true); return true; }
  let rec = null;
  mutate(() => { rec = createSlabOpening(state.project, state.project.activeLevel, t.points); });
  if (!rec) { toast('Контур пересекает сам себя или меньше 300 мм', true); return true; }
  const levelId = state.project.activeLevel;
  cancelTool();
  selectObject({ type: 'slab', levelId, id: rec.id });
  toast(`Проём создан · ${(slabOpeningArea(rec) / 1e6).toFixed(2).replace('.', ',')} м² · тяните вершины и «+» на рёбрах`);
  return true;
}

export function slabToolKey(event) {
  const t = state.tool;
  if (t?.kind !== 'slab-opening') return false;
  if (event.key === 'Enter') return finishSlabOpeningTool();
  if (event.key === 'Backspace') {
    t.points.pop(); t.cursor = t.points.at(-1) || null; t.snapStart = false; requestDraw(); return true;
  }
  return false;
}

export function makeSlabFreeShape(sel = state.selection) {
  const o = selectedSlab(sel);
  if (!o) return;
  let rec = null;
  mutate(() => { rec = setSlabOpeningPolygon(state.project, sel.levelId, o.id, slabOpeningPolygon(o)); });
  if (rec) {
    selectObject({ type: 'slab', levelId: sel.levelId, id: rec.id });
    toast('Свободный контур включён: тяните вершины, «+» добавляет новую');
  }
}

// ------------------------------------------------------------ правка

export function selectedSlab(sel = state.selection) {
  if (sel?.type !== 'slab') return null;
  return findSlabOpening(state.project, sel.levelId || state.project.activeLevel, sel.id);
}

export function deleteSlab(sel = state.selection) {
  const o = selectedSlab(sel);
  if (!o) return;
  if (o.auto) {
    toast('Проём по лестнице удаляется вместе с ней — или в «Свойствах» лестницы «Ведёт на этаж: никуда»', true);
    return;
  }
  mutate(() => { removeSlabOpening(state.project, sel.levelId, o.id); });
  selectObject(null);
  toast('Проём в перекрытии удалён · Ctrl+Z — вернуть');
}

export function resetSlabAuto(sel = state.selection) {
  const o = selectedSlab(sel);
  if (!o || o.auto) return;
  let id = null;
  mutate(() => { id = resetSlabOpeningAuto(state.project, sel.levelId, o.id); });
  if (id) {
    selectObject({ type: 'slab', levelId: sel.levelId, id });
    toast('Проём снова по лестнице: следует за ней');
  }
}

export function slabToolbar(sel) {
  const o = selectedSlab(sel);
  if (!o) return null;
  const shape = o.outline?.length
    ? `${(slabOpeningArea(o) / 1e6).toFixed(2).replace('.', ',')} м² · ${slabOpeningPolygon(o).length} вершин`
    : `${o.w} × ${o.h} мм`;
  return { o, label: `Проём в перекрытии · ${shape}${o.auto ? ' · по лестнице' : ''}` };
}

export function renderSlabProps(panel, sel) {
  const o = selectedSlab(sel);
  if (!o) return false;
  const stair = slabOpeningStair(state.project, o);
  const levelId = sel.levelId || state.project.activeLevel;
  const fromName = (() => {
    if (!stair) return '';
    const l = state.project.levels.find((x) => (x.items || []).some((i) => i.id === stair.id));
    return l ? escapeHtml(l.name) : '';
  })();
  const area = (slabOpeningArea(o) / 1e6).toFixed(2).replace('.', ',');
  panel.innerHTML = `
    <h2>Проём в перекрытии</h2>
    <p class="subtitle">${o.auto
    ? `Автоматически по лестнице${fromName ? ` с этажа «${fromName}»` : ''}: габарит маршей и площадок + 100 мм. Следует за лестницей. Тяните сторону или угол на плане — станет ручным.`
    : stair ? 'Изменён вручную: за лестницей больше не следует.' : 'Ручной проём.'}
      ${o.outline?.length ? ` Свободный контур: ${slabOpeningPolygon(o).length} вершин; тяните круги, «+» на рёбрах добавляет вершину.` : ''}</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина (X), мм</span><input id="slabW" type="number" step="50" min="300" value="${o.w}"></label>
        <label class="prop-field"><span>Глубина (Y), мм</span><input id="slabH" type="number" step="50" min="300" value="${o.h}"></label>
        <label class="prop-field"><span>Левый край X, мм</span><input id="slabX" type="number" step="50" value="${o.x}"></label>
        <label class="prop-field"><span>Верхний край Y, мм</span><input id="slabY" type="number" step="50" value="${o.y}"></label>
      </div>
      <div class="prop-row"><span>Площадь</span><strong>${area} м²</strong></div>
      <div class="prop-row"><span>Форма</span><strong>${o.outline?.length ? `свободная · ${slabOpeningPolygon(o).length} вершин` : 'прямоугольник'}</strong></div>
      <div class="prop-row"><span>Режим</span><strong id="slabMode">${o.auto ? 'авто по лестнице' : 'ручной'}</strong></div>
      ${!o.outline?.length ? '<button id="slabFreeShape" type="button">Редактировать произвольный контур</button>' : ''}
      ${!o.auto && stair ? '<button id="slabAuto" type="button">Вернуть авто по лестнице</button>' : ''}
    </div>
    <p class="empty-hint">Перекрытие и пол этажа в проёме вырезаны (3D, разрезы); площадь помещений над проёмом уменьшена.</p>`;
  const apply = () => {
    const v = (id, d) => { const n = Number(panel.querySelector(id).value); return Number.isFinite(n) ? n : d; };
    const rect = { x: v('#slabX', o.x), y: v('#slabY', o.y), w: v('#slabW', o.w), h: v('#slabH', o.h) };
    let rec = null;
    mutate(() => { rec = setSlabOpeningRect(state.project, levelId, o.id, rect); });
    if (rec) selectObject({ type: 'slab', levelId, id: rec.id });
  };
  for (const id of ['#slabW', '#slabH', '#slabX', '#slabY']) panel.querySelector(id).addEventListener('change', apply);
  panel.querySelector('#slabAuto')?.addEventListener('click', () => resetSlabAuto(sel));
  panel.querySelector('#slabFreeShape')?.addEventListener('click', () => makeSlabFreeShape(sel));
  return true;
}

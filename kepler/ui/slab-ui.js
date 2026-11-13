// Проёмы в перекрытии на плане: выбор (контур, диагонали, подпись), ручки
// сторон и углов, сдвиг, «Свойства», удаление, «Вернуть авто по лестнице».
// Модель — core/slab-openings.js, рисование — ui/render-slab.js.
//
// Выбор — { type: 'slab', levelId, id }; id авто-проёма — 'auto:<id лестницы>'.
// Любая правка авто-проёма превращает его в ручной (за лестницей больше не
// следует) — выбор переходит на новую запись.

import {
  dragSlabRect, findSlabOpening, removeSlabOpening, resetSlabOpeningAuto, setSlabOpeningRect, slabOpeningStair,
} from '../core/slab-openings.js';
import { escapeHtml, toast } from './dom.js';
import { SLAB_HANDLE } from './render-slab.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';
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
    for (let i = 0; i < 4; i += 1) d = Math.min(d, segDist(screen, P[i], P[(i + 1) % 4]));
    d = Math.min(d, segDist(screen, P[0], P[2]), segDist(screen, P[1], P[3]));
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
  const base = { levelId, id: o.id, start: { x: o.x, y: o.y, w: o.w, h: o.h }, plan0: { x: plan.x, y: plan.y }, before: snapshot(), moved: false };
  if (hit.part === 'edge') return { kind: 'slab-move', ...base };
  return { kind: 'slab-handle', handle: hit.part, ...base };
}

export function slabDragMove(drag, plan, event) {
  const g = event?.shiftKey ? 1 : gridStep();
  let rect;
  if (drag.kind === 'slab-move') {
    const dx = Math.round((plan.x - drag.plan0.x) / g) * g;
    const dy = Math.round((plan.y - drag.plan0.y) / g) * g;
    if (!drag.moved && !dx && !dy) return;
    rect = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy };
  } else {
    rect = dragSlabRect(drag.start, drag.handle, plan, g);
  }
  // Авто-проём при первой правке становится ручным — выбор идёт за записью.
  const rec = setSlabOpeningRect(state.project, drag.levelId, drag.id, rect);
  if (!rec) return;
  if (rec.id !== drag.id) {
    drag.id = rec.id;
    state.selection = { type: 'slab', levelId: drag.levelId, id: rec.id };
  }
  drag.moved = true;
  state.slabLabel = drag.kind === 'slab-handle'
    ? { x: plan.x, y: plan.y, text: `Проём ${rec.w} × ${rec.h} мм · ${HANDLE_TITLES[drag.handle]}` }
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
  return { o, label: `Проём в перекрытии · ${o.w} × ${o.h} мм${o.auto ? ' · по лестнице' : ''}` };
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
  const area = ((o.w * o.h) / 1e6).toFixed(2).replace('.', ',');
  panel.innerHTML = `
    <h2>Проём в перекрытии</h2>
    <p class="subtitle">${o.auto
    ? `Автоматически по лестнице${fromName ? ` с этажа «${fromName}»` : ''}: габарит маршей и площадок + 100 мм. Следует за лестницей. Тяните сторону или угол на плане — станет ручным.`
    : stair ? 'Изменён вручную: за лестницей больше не следует.' : 'Ручной проём.'}</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина (X), мм</span><input id="slabW" type="number" step="50" min="300" value="${o.w}"></label>
        <label class="prop-field"><span>Глубина (Y), мм</span><input id="slabH" type="number" step="50" min="300" value="${o.h}"></label>
        <label class="prop-field"><span>Левый край X, мм</span><input id="slabX" type="number" step="50" value="${o.x}"></label>
        <label class="prop-field"><span>Верхний край Y, мм</span><input id="slabY" type="number" step="50" value="${o.y}"></label>
      </div>
      <div class="prop-row"><span>Площадь</span><strong>${area} м²</strong></div>
      <div class="prop-row"><span>Режим</span><strong id="slabMode">${o.auto ? 'авто по лестнице' : 'ручной'}</strong></div>
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
  return true;
}

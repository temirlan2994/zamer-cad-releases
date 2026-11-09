// Массы (core/masses.js) в редакторе: команды (создать, править, копировать,
// повернуть, поставить на землю, удалить), «Свойства» массы и инструмент
// «Масса» на плане (2 клика — основание, высота по умолчанию 3000 мм; правка
// высоты — в «Свойствах»). Главный сценарий — в 3D (ui/mass3d.js).
//
// Выбор массы — state.selection = { type: 'mass', id }.

import {
  MASS_H_DEFAULT, MASS_MIN, copyMass, createMass, floorsLabel, massSnapCoords, massStats, massStep,
  resizeMass, rotateMass90, snapValue, stackMass,
} from '../core/masses.js';
import { wallSnapCoords } from '../core/walls.js';
import { escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { renderProps } from './props.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

export const MASS_HINT = 'Масса: клик — угол, клик — противоположный угол, потянуть вверх — высота, клик — готово · Enter/числа — точный размер · Esc';
const PLAN_HINT_A = 'Масса: клик — угол основания · Shift — без привязки, Ctrl — квадрат · Esc — выйти';
const PLAN_HINT_B = 'Масса: клик — противоположный угол (высота 3000 мм, правка — в «Свойствах») · Esc — назад';

export const masses = () => state.project?.masses || [];
export const massById = (id) => masses().find((m) => m.id === id) || null;
export const selectedMass = () => (state.selection?.type === 'mass' ? massById(state.selection.id) : null);
export const isMassTool = () => state.tool?.kind === 'mass';

// Высота этажа для подписей «≈ N этажей»: активный этаж (или первый).
export function massLevelHeight() {
  const p = state.project;
  const l = (p?.levels || []).find((x) => x.id === p.activeLevel) || p?.levels?.[0];
  return Number(l?.height) > 0 ? Number(l.height) : 3000;
}

// Линии привязки основания: грани других масс, комнат и стен активного этажа.
export function massBaseSnap(skip = null) {
  const c = massSnapCoords(masses(), skip);
  const xs = [...c.xs]; const ys = [...c.ys];
  for (const r of state.project?.rooms || []) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
  for (const w of state.walls || []) {
    try {
      const s = wallSnapCoords(w);
      xs.push(...s.xs); ys.push(...s.ys);
    } catch { /* стена без геометрии */ }
  }
  return { xs, ys, zs: c.zs };
}

// ---------------------------------------------------------------- команды

export function addMass(mass) {
  mutate(() => { state.project.masses = [...masses(), mass]; });
  selectObject({ type: 'mass', id: mass.id });
  return mass;
}

export function updateMass(id, fn) {
  const m = massById(id);
  if (!m) return null;
  let next = null;
  mutate(() => {
    next = fn(m);
    state.project.masses = masses().map((x) => (x.id === id ? next : x));
  });
  return next;
}

export function deleteMass(id) {
  const m = massById(id);
  if (!m) return;
  mutate(() => {
    state.project.masses = masses().filter((x) => x.id !== id);
    if (!state.project.masses.length) delete state.project.masses;
  });
  if (state.selection?.type === 'mass' && state.selection.id === id) selectObject(null);
  toast(`«${m.name}» удалена · Ctrl+Z — вернуть`);
}

export function duplicateMass(id, offset = null) {
  const m = massById(id);
  if (!m) return null;
  return addMass(copyMass(m, masses(), offset));
}

export function rotateMass(id) {
  updateMass(id, (m) => rotateMass90(m));
  toast('Масса повёрнута на 90° · Ctrl+Z — отменить');
}

export function groundMass(id) {
  updateMass(id, (m) => ({ ...m, z0: 0 }));
}

// ---------------------------------------------------------------- инструмент на плане

export function startMassTool() {
  if (state.modeName !== 'plan') { toast('Массы создаются в режиме «План» и в 3D', true); return; }
  setTool({ kind: 'mass', stage: 'corner', a: null, b: null, cursor: null }, PLAN_HINT_A);
  state.selection = null;
  renderProps();
  document.dispatchEvent(new CustomEvent('kepler:mass-tool'));
}

export function toggleMassTool() {
  if (!isMassTool()) { startMassTool(); return; }
  cancelTool();
  document.dispatchEvent(new CustomEvent('kepler:mass-tool'));
}

// Шаг Esc: стадия назад; на первой стадии — выйти. true — что-то отменено.
export function massToolBack() {
  const t = state.tool;
  if (t?.kind !== 'mass') return false;
  if (t.stage === 'height') { t.stage = 'base'; t.h = null; }
  else if (t.stage === 'base') { t.stage = 'corner'; t.a = null; t.b = null; setHint(PLAN_HINT_A); }
  else { cancelTool(); document.dispatchEvent(new CustomEvent('kepler:mass-tool')); }
  requestDraw();
  return true;
}

function snapPlanPoint(plan, event, a = null) {
  const step = massStep(state.view.scale);
  if (event?.shiftKey) return { x: Math.round(plan.x), y: Math.round(plan.y) };
  const lines = massBaseSnap();
  const tol = 12 / state.view.scale;
  const p = { x: snapValue(plan.x, lines.xs, tol, step).value, y: snapValue(plan.y, lines.ys, tol, step).value };
  if (a && event?.ctrlKey) {
    const s = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
    p.x = a.x + Math.sign(p.x - a.x || 1) * s;
    p.y = a.y + Math.sign(p.y - a.y || 1) * s;
  }
  return p;
}

export function massPlanHover(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'mass') return;
  t.cursor = snapPlanPoint(plan, event, t.a);
  requestDraw();
}

export function massPlanClick(plan, event) {
  const t = state.tool;
  if (t?.kind !== 'mass') return;
  const p = snapPlanPoint(plan, event, t.a);
  t.cursor = p;
  if (!t.a) {
    t.a = p;
    t.stage = 'base';
    setHint(PLAN_HINT_B);
    requestDraw();
    return;
  }
  const w = Math.abs(p.x - t.a.x); const d = Math.abs(p.y - t.a.y);
  if (w < MASS_MIN || d < MASS_MIN) { toast(`Основание массы — не меньше ${MASS_MIN} мм`, true); return; }
  const level = (state.project.levels || []).find((l) => l.id === state.project.activeLevel);
  let m = createMass({ x: (p.x + t.a.x) / 2, y: (p.y + t.a.y) / 2, w, d, z0: Number(level?.elevation) || 0, h: MASS_H_DEFAULT }, masses());
  if (!m.z0) m = stackMass(m, masses());
  t.a = null; t.stage = 'corner';
  addMass(m);
  setHint(PLAN_HINT_A);
  toast(`${m.name}: ${m.w} × ${m.d} × ${m.h} мм · высота — в «Свойствах», форма — в 3D`);
}

// ---------------------------------------------------------------- «Свойства»

const numField = (id, label, value, step = 100) => `
  <label class="prop-field"><span>${label}</span>
    <input id="${id}" type="number" step="${step}" min="0" inputmode="numeric" value="${Math.round(value)}"></label>`;

export function renderMassProps(panel, m) {
  const st = massStats(m, massLevelHeight());
  panel.innerHTML = `
    <h2>Масса</h2>
    <p class="subtitle">Концептуальная форма · ${escapeHtml(floorsLabel(m.h, massLevelHeight()))}</p>
    <div class="prop-block" id="massProps">
      <label class="prop-field"><span>Название</span>
        <input id="massName" type="text" maxlength="60" value="${escapeHtml(m.name)}"></label>
      <div class="prop-grid">
        ${numField('massW', 'Ширина, мм', m.w)}
        ${numField('massD', 'Глубина, мм', m.d)}
        ${numField('massH', 'Высота, мм', m.h)}
        ${numField('massZ0', 'Отметка низа, мм', m.z0)}
      </div>
      <div class="prop-row"><span>Площадь основания</span><strong id="massArea">${st.area.toFixed(1)} м²</strong></div>
      <div class="prop-row"><span>Объём</span><strong id="massVolume">${st.volume.toFixed(1)} м³</strong></div>
      <div class="prop-row"><span>Этажей</span><strong>≈ ${st.floors}</strong></div>
      <div class="prop-grid">
        <button type="button" id="massRotate" title="Повернуть на 90° вокруг центра (R)">↻ Повернуть 90°</button>
        <button type="button" id="massGround" ${m.z0 ? '' : 'disabled'}>Поставить на землю</button>
        <button type="button" id="massCopy" title="Копия рядом (Ctrl+D)">Копировать</button>
        <button type="button" id="massDelete" class="danger">Удалить</button>
      </div>
      <p class="hint">В 3D у выбранной массы: стрелки гизмо — перенос по оси (квадрат — по плоскости), точки — размер (противоположная грань стоит). Двойной клик по точке — число. На плане этажа масса видна эскизом.</p>
    </div>`;
  const id = m.id;
  panel.querySelector('#massName').addEventListener('change', (e) => {
    const name = String(e.target.value).trim().slice(0, 60);
    if (!name || name === m.name) { e.target.value = m.name; return; }
    updateMass(id, (x) => ({ ...x, name }));
  });
  const bindNum = (sel, key) => panel.querySelector(sel).addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (!Number.isFinite(v) || (key !== 'z0' && v <= 0) || v < 0) { e.target.value = Math.round(m[key]); return; }
    updateMass(id, (x) => resizeMass(x, { [key]: v }));
  });
  bindNum('#massW', 'w');
  bindNum('#massD', 'd');
  bindNum('#massH', 'h');
  bindNum('#massZ0', 'z0');
  panel.querySelector('#massRotate').addEventListener('click', () => rotateMass(id));
  panel.querySelector('#massGround').addEventListener('click', () => groundMass(id));
  panel.querySelector('#massCopy').addEventListener('click', () => duplicateMass(id));
  panel.querySelector('#massDelete').addEventListener('click', () => deleteMass(id));
}

// Массы (core/masses.js) в редакторе: команды (создать, править, копировать,
// повернуть, поставить на землю, удалить), «Свойства» массы и инструмент
// «Масса» на плане (2 клика — основание, высота по умолчанию 3000 мм; правка
// высоты — в «Свойствах»). Главный сценарий — в 3D (ui/mass3d.js).
//
// Выбор массы — state.selection = { type: 'mass', id }.

import {
  MASS_H_DEFAULT, MASS_MIN, allMasses, copyMass, createMass, createMassVoid, floorsLabel, massExtent, massSnapCoords, massStats, massStep,
  resizeMass, rotateMass90, snapValue, solidMasses, stackMass, voidMasses,
} from '../core/masses.js';
import { fitFacadeBand, fitSoffitLight, updateFacadeAttachment } from '../core/facade.js';
import { FACADE_ELEMENTS } from '../data/facade-catalog.js';
import { massVoidCutsProject } from '../core/mesh3d.js';
import { wallSnapCoords } from '../core/walls.js';
import { escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { renderProps } from './props.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';

export const MASS_HINT = 'Масса: клик — угол, клик — противоположный угол, потянуть вверх — высота, клик — готово · Enter/числа — точный размер · Esc';
export const MASS_VOID_HINT = 'Полая масса: постройте вычитающий объём как обычную массу · он вырежет стены, полы, перекрытия и массы · Esc';
const PLAN_HINT_A = 'Масса: клик — угол основания · Shift — без привязки, Ctrl — квадрат · Esc — выйти';
const PLAN_HINT_B = 'Масса: клик — противоположный угол (высота 3000 мм, правка — в «Свойствах») · Esc — назад';
const planHintA = (t) => (t?.void ? 'Полая масса: клик — угол вычитающего объёма · Shift — без привязки · Esc — выйти' : PLAN_HINT_A);
const planHintB = (t) => (t?.void ? 'Полая масса: клик — противоположный угол · высота — в «Свойствах» и 3D' : PLAN_HINT_B);

export const masses = () => allMasses(state.project);
export const solidMassList = () => solidMasses(state.project);
export const massVoids = () => voidMasses(state.project);
export const massById = (id) => masses().find((m) => m.id === id) || null;
export const massIsVoid = (id) => massVoids().some((m) => m.id === id);
export const selectedMass = () => (state.selection?.type === 'mass' ? massById(state.selection.id) : null);
export const isMassTool = () => state.tool?.kind === 'mass';
const massGeometryKey = (mass) => [mass.x, mass.y, mass.w, mass.d, mass.z0, mass.h, mass.rotation].join('|');

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
  const isVoid = mass.id.startsWith('void-');
  if (isVoid && !massVoidCutsProject(state.project, mass)) {
    toast('Полая масса ничего не пересекает и удалена', true);
    return null;
  }
  mutate(() => {
    if (isVoid) state.project.massVoids = [...massVoids(), mass];
    else state.project.masses = [...solidMassList(), mass];
  });
  selectObject({ type: 'mass', id: mass.id });
  return mass;
}

export function updateMass(id, fn) {
  const m = massById(id);
  if (!m) return null;
  let next = null;
  let removed = false;
  const wasVoid = massIsVoid(id);
  mutate(() => {
    next = updateFacadeAttachment(state.project, m, fn(m));
    const geometryChanged = massGeometryKey(next) !== massGeometryKey(m);
    if (wasVoid) {
      if (!geometryChanged || massVoidCutsProject(state.project, next)) state.project.massVoids = massVoids().map((x) => (x.id === id ? next : x));
      else {
        state.project.massVoids = massVoids().filter((x) => x.id !== id);
        if (!state.project.massVoids.length) delete state.project.massVoids;
        next = null;
        removed = true;
      }
    } else state.project.masses = solidMassList().map((x) => (x.id === id ? next : x));
    if (removed && state.selection?.type === 'mass' && state.selection.id === id) state.selection = null;
  });
  if (removed) toast('Полая масса больше ничего не пересекает и удалена', true);
  return massById(id);
}

// Жест 3D меняет модель без mutate, чтобы всё движение было одной записью
// Undo. По отпусканию мыши удаляем потерявший цель cutter тем же жестом.
export function pruneUnusedMassVoidLive(id) {
  const mass = massById(id);
  if (!mass || !massIsVoid(id) || massVoidCutsProject(state.project, mass)) return false;
  state.project.massVoids = massVoids().filter((item) => item.id !== id);
  if (!state.project.massVoids.length) delete state.project.massVoids;
  if (state.selection?.type === 'mass' && state.selection.id === id) state.selection = null;
  return true;
}

export function deleteMass(id) {
  const m = massById(id);
  if (!m) return;
  const wasVoid = massIsVoid(id);
  mutate(() => {
    if (wasVoid) {
      state.project.massVoids = massVoids().filter((x) => x.id !== id);
      if (!state.project.massVoids.length) delete state.project.massVoids;
    } else {
      state.project.masses = solidMassList().filter((x) => x.id !== id);
      if (!state.project.masses.length) delete state.project.masses;
    }
  });
  if (state.selection?.type === 'mass' && state.selection.id === id) selectObject(null);
  toast(`«${m.name}» удалена · Ctrl+Z — вернуть`);
}

export function duplicateMass(id, offset = null) {
  const m = massById(id);
  if (!m) return null;
  if (!massIsVoid(id)) return addMass(updateFacadeAttachment(state.project, m, copyMass(m, solidMassList(), offset)));
  const { ex } = massExtent(m);
  const o = offset || { x: ex + 1000, y: 0 };
  return addMass(createMassVoid({ ...m, id: undefined, name: `${m.name} копия`, x: m.x + o.x, y: m.y + o.y }, massVoids()));
}

export function rotateMass(id) {
  if (updateMass(id, (m) => rotateMass90(m))) toast('Масса повёрнута на 90° · Ctrl+Z — отменить');
}

export function groundMass(id) {
  updateMass(id, (m) => ({ ...m, z0: 0 }));
}

// ---------------------------------------------------------------- инструмент на плане

export function startMassTool(voidMode = false) {
  if (state.modeName !== 'plan') { toast('Массы создаются в режиме «План» и в 3D', true); return; }
  setTool({ kind: 'mass', void: Boolean(voidMode), stage: 'corner', a: null, b: null, cursor: null }, voidMode ? MASS_VOID_HINT : PLAN_HINT_A);
  state.selection = null;
  renderProps();
  document.dispatchEvent(new CustomEvent('kepler:mass-tool'));
}

export function toggleMassTool(voidMode = false) {
  if (!isMassTool() || Boolean(state.tool?.void) !== Boolean(voidMode)) { startMassTool(voidMode); return; }
  cancelTool();
  document.dispatchEvent(new CustomEvent('kepler:mass-tool'));
}

// Шаг Esc: стадия назад; на первой стадии — выйти. true — что-то отменено.
export function massToolBack() {
  const t = state.tool;
  if (t?.kind !== 'mass') return false;
  if (t.stage === 'height') { t.stage = 'base'; t.h = null; }
  else if (t.stage === 'base') { t.stage = 'corner'; t.a = null; t.b = null; setHint(planHintA(t)); }
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
    setHint(planHintB(t));
    requestDraw();
    return;
  }
  const w = Math.abs(p.x - t.a.x); const d = Math.abs(p.y - t.a.y);
  if (w < MASS_MIN || d < MASS_MIN) { toast(`Основание массы — не меньше ${MASS_MIN} мм`, true); return; }
  const level = (state.project.levels || []).find((l) => l.id === state.project.activeLevel);
  const spec = { x: (p.x + t.a.x) / 2, y: (p.y + t.a.y) / 2, w, d, z0: Number(level?.elevation) || 0, h: MASS_H_DEFAULT };
  let m = t.void ? createMassVoid(spec, massVoids()) : createMass(spec, solidMassList());
  if (!t.void && !m.z0) m = stackMass(m, solidMassList());
  t.a = null; t.stage = 'corner';
  const added = addMass(m);
  setHint(planHintA(t));
  if (added) toast(`${m.name}: ${m.w} × ${m.d} × ${m.h} мм · ${t.void ? 'вырезает пересечённые объёмы' : 'форма — в 3D'}`);
}

// Живая правка одним 3D-жестом: история оформляется в mass3d.js.
export function replaceMassLive(id, next) {
  if (massIsVoid(id)) state.project.massVoids = massVoids().map((m) => (m.id === id ? next : m));
  else state.project.masses = solidMassList().map((m) => (m.id === id ? next : m));
  if (next.facadeKind === 'canopy') {
    for (const light of state.project.masses) if (light.canopyId === next.id) fitSoffitLight(light, next);
  }
}

// ---------------------------------------------------------------- «Свойства»

const numField = (id, label, value, step = 100, min = 0) => `
  <label class="prop-field"><span>${label}</span>
    <input id="${id}" type="number" step="${step}" ${min == null ? '' : `min="${min}"`} inputmode="decimal" value="${Math.round(value)}"></label>`;

function renderFacadeProps(panel, m) {
  const preset = FACADE_ELEMENTS[m.facadeKind];
  panel.innerHTML = `
    <h2>${escapeHtml(m.name)}</h2>
    <div class="prop-block" id="massProps">
      <label class="prop-field"><span>${m.facadeKind === 'light' ? 'Цвет света' : 'Отделка'}</span>
        <select id="facadeFinish">${Object.entries(preset.finishes).map(([name, color]) =>
          `<option value="${color}" ${m.color === color ? 'selected' : ''}>${name}</option>`).join('')}</select>
      </label>
      <div class="prop-grid">
        ${numField('massW', 'Ширина, мм', m.w, 1, 12)}
        ${numField('massD', m.facadeKind === 'post' ? 'Глубина стойки, мм' : 'Вынос от стены, мм', m.d, 1, 12)}
        ${numField('massH', m.facadeKind === 'decking' ? 'Толщина настила, мм' : 'Высота, мм', m.h, 1, 12)}
        ${numField('massZ0', 'Отметка низа, мм', m.z0, 1, null)}
      </div>
      ${m.facadeKind === 'band' && m.facadeHost && !Number.isFinite(m.facadeHost.bandAnchor)
        ? '<button type="button" id="facadeFitBand">Растянуть от угла до угла</button>' : ''}
      ${m.facadeHost || m.canopyId ? `<div class="prop-row"><span>${m.canopyId ? 'Под кромкой навеса' : Number.isFinite(m.facadeHost?.bandAnchor) ? 'От угла до угла' : 'Связь со стеной'}</span><button type="button" id="facadeDetach">Отвязать</button></div>` : ''}
      <details><summary>Положение на плане</summary><div class="prop-grid">
        ${numField('facadeX', 'Центр X, мм', m.x, 1, null)}
        ${numField('facadeY', 'Центр Y, мм', m.y, 1, null)}
      </div></details>
      <div class="prop-grid"><button type="button" id="massCopy">Копировать рядом</button>
        <button type="button" id="massDelete" class="danger">Удалить</button></div>
    </div>`;
  panel.querySelector('#facadeFitBand')?.addEventListener('click', () => mutate(() => {
    if (!fitFacadeBand(state.project, m, m.facadeHost.along / m.facadeHost.span)) toast('В этом месте нет непрерывной наружной стены', true);
  }));
  panel.querySelector('#facadeDetach')?.addEventListener('click', () => updateMass(m.id, (x) => {
    const next = { ...x };
    delete next.facadeHost;
    delete next.canopyId;
    return next;
  }));
  panel.querySelector('#facadeFinish').addEventListener('change', (e) => updateMass(m.id, (x) => ({ ...x, color: e.target.value })));
  for (const [id, key] of Object.entries({ massW: 'w', massD: 'd', massH: 'h', massZ0: 'z0', facadeX: 'x', facadeY: 'y' })) {
    panel.querySelector('#' + id).addEventListener('change', (e) => {
      const v = e.target.valueAsNumber;
      if (!Number.isFinite(v) || !e.target.validity.valid) { e.target.value = m[key]; return; }
      updateMass(m.id, (x) => key === 'x' || key === 'y' ? { ...x, [key]: v } : resizeMass(x, { [key]: v }));
    });
  }
  panel.querySelector('#massCopy').addEventListener('click', () => duplicateMass(m.id));
  panel.querySelector('#massDelete').addEventListener('click', () => deleteMass(m.id));
}

export function renderMassProps(panel, m) {
  if (FACADE_ELEMENTS[m.facadeKind]) { renderFacadeProps(panel, m); return; }
  const st = massStats(m, massLevelHeight());
  const isVoid = massIsVoid(m.id);
  panel.innerHTML = `
    <h2>${isVoid ? 'Полая масса' : 'Масса'}</h2>
    <p class="subtitle">${isVoid ? 'Вычитающий объём: удаляет пересечённую геометрию' : `Концептуальная форма · ${escapeHtml(floorsLabel(m.h, massLevelHeight()))}`}</p>
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
      <div class="prop-row"><span>${isVoid ? 'Вычитаемый объём' : 'Объём'}</span><strong id="massVolume">${st.volume.toFixed(1)} м³</strong></div>
      <div class="prop-row"><span>Этажей</span><strong>≈ ${st.floors}</strong></div>
      <div class="prop-grid">
        <button type="button" id="massRotate" title="Повернуть на 90° вокруг центра (R)">↻ Повернуть 90°</button>
        <button type="button" id="massGround" ${m.z0 ? '' : 'disabled'}>Поставить на землю</button>
        <button type="button" id="massCopy" title="Копия рядом (Ctrl+D)">Копировать</button>
        <button type="button" id="massDelete" class="danger">Удалить</button>
      </div>
      <p class="hint">В 3D у выбранной ${isVoid ? 'полой ' : ''}массы: стрелки гизмо — перенос, точки — размер. ${isVoid ? 'Оранжевый каркас показывает объём вычитания.' : 'На плане этажа масса видна эскизом.'}</p>
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

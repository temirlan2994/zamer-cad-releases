// Массы в 3D (core/masses.js): создание и правка боксов прямо в окне 3D —
// главный сценарий «концептуальной формы» (как «Масса» в Revit, «Тяни-
// толкай» в SketchUp). Окно 3D (ui/view3d.js) отдаёт сюда события и
// окружение env (луч, проекция осей, масштаб, перерисовка, подпись у курсора).
//
// Инструмент «Масса» (state.tool.kind === 'mass'), стадии:
//   'corner' — курсор скользит по плоскости основания: верх массы под
//              курсором («поставить на грань»), пол этажа или земля z = 0;
//              клик — первый угол;
//   'base'   — рамка-призрак основания на той же плоскости с живыми
//              размерами; привязка: шаг по масштабу, грани других масс,
//              комнат и стен; Shift — без привязки, Ctrl — квадрат; клик —
//              основание зафиксировано;
//   'height' — движение мыши вверх/вниз тянет высоту (проекция вертикали
//              на экран), шаг 100 мм (Shift — 10), привязка к отметкам
//              этажей и верху/низу других масс; клик — масса готова и
//              выбрана, инструмент остаётся (серия; Esc — выйти).
// Числа: во время 'base'/'height' цифры открывают поле у курсора: ширина →
// Tab → глубина → Enter → высота → Enter. Esc — стадия назад.
// Касание: тапы по шагам (третий тап — высота по положению пальца).
//
// Правка выбранной массы: тянуть грань — push/pull (верх — высота, бок —
// эта грань, противоположная стоит), Alt + тянуть грань — перенос по
// плоскости основания (опора: на землю или на верх другой массы); двойной
// клик по грани — число. Касание: удержание грани выбранной массы. Каждый
// жест — одна запись истории.

import {
  MASS_H_DEFAULT, MASS_MIN, createMass, faceSize, floorsLabel, isSupported, massBox,
  massStep, resizeFace, setFaceSize, snapValue, stackMass,
} from '../core/masses.js';
import { basePlane, pickMass, rayPlaneZ } from '../core/pick3d.js';
import { massFaces } from '../core/mesh3d.js';
import { toast } from './dom.js';
import { MASS_HINT, addMass, massBaseSnap, massById, massLevelHeight, masses, updateMass } from './masses.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';

const GHOST = '#3d7fe0';
const SNAP_PX = 10; // px — радиус привязки к граням и отметкам

let env = null;
let drag = null; // жест правки массы
let hover = null; // { id, face } — грань выбранной массы под мышью
let lastCursor = null; // { x, y } клиентские координаты последнего движения
let numField = null; // { kind: 'w'|'d'|'h'|'face', face?, id? }

export function initMass3d(e) { env = e; }

const tool = () => (state.tool?.kind === 'mass' ? state.tool : null);
export const massToolOn = () => Boolean(tool());
export const massDragging = () => Boolean(drag);
export const massHover = () => hover;

export function massBoxes() {
  return masses().map((m) => ({ id: m.id, ...massBox(m) }));
}

// Отметки привязки высоты: этажи (низ и верх) и другие массы.
function zLines(skip = null) {
  const zs = [];
  for (const l of state.project?.levels || []) {
    const e = Number(l.elevation) || 0;
    zs.push(e, e + (Number(l.height) || 0));
  }
  for (const m of masses()) {
    if (m.id === skip) continue;
    const b = massBox(m);
    zs.push(b.z0, b.z1);
  }
  return zs;
}

function snapXY(p, e, skip = null) {
  if (e?.shiftKey) return { x: Math.round(p.x), y: Math.round(p.y) };
  const k = env.worldPerPx();
  const step = massStep(1 / k);
  const lines = massBaseSnap(skip);
  return { x: snapValue(p.x, lines.xs, SNAP_PX * k, step).value, y: snapValue(p.y, lines.ys, SNAP_PX * k, step).value };
}

function setStage(t, stage) {
  t.stage = stage;
  env.hint(stageHint(t));
}

function stageHint(t) {
  if (t.stage === 'base') return 'Масса: клик — противоположный угол · Shift — без привязки, Ctrl — квадрат · цифры — ширина, Tab — глубина · Esc — назад';
  if (t.stage === 'height' && t.touch) return 'Масса: тап выше основания — высота по пальцу, масса готова · Esc — назад';
  if (t.stage === 'height') return 'Масса: тяните вверх — высота, клик — готово · Shift — шаг 10 мм · цифры + Enter — высота · Esc — назад';
  return MASS_HINT;
}

export function massToolHint() {
  const t = tool();
  return t ? stageHint(t) : null;
}

// Сброс стадий (вход в 3D, выход из него).
export function resetMassTool() {
  const t = tool();
  if (t) Object.assign(t, { stage: 'corner', a: null, b: null, h: null, z: 0, cursor: null, screen2: null });
  hideNum();
  env?.label(null);
}

// ---------------------------------------------------------------- создание

function heightFrom(t, e) {
  let d = env.axisDelta({ x: 0, y: 0, z: 1 }, e.clientX - t.screen2.x, e.clientY - t.screen2.y);
  if (!d) d = -(e.clientY - t.screen2.y) * env.worldPerPx();
  let h = Math.max(MASS_MIN, d);
  if (e.shiftKey) return Math.max(MASS_MIN, Math.round(h / 10) * 10);
  const tol = SNAP_PX * env.worldPerPx();
  const top = snapValue(t.z + h, zLines(), tol, 0);
  if (top.line != null && top.line - t.z >= MASS_MIN) return top.line - t.z;
  h = Math.round(h / 100) * 100;
  return Math.max(MASS_MIN, h);
}

function squareB(a, b) {
  const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
}

// Движение мыши при включённом инструменте.
export function massToolMove(e) {
  const t = tool();
  if (!t || !env) return;
  lastCursor = { x: e.clientX, y: e.clientY };
  if (numField) return; // идёт ввод числа — призрак стоит
  const ray = env.ray(e);
  if (t.stage === 'corner' || !t.stage) {
    const plane = basePlane(massBoxes(), ray, { floor: env.floorHit(e) });
    if (!plane) { t.cursor = null; env.label(null); env.redraw(); return; }
    const p = snapXY(plane.point, e);
    t.cursor = { x: p.x, y: p.y, z: plane.z };
    const on = plane.massId ? massById(plane.massId) : null;
    env.label(on ? `на «${on.name}» · отм. ${Math.round(plane.z)}` : plane.z ? `отм. ${Math.round(plane.z)}` : null, e.clientX, e.clientY);
  } else if (t.stage === 'base') {
    const p = rayPlaneZ(ray, t.z);
    if (!p) return;
    let b = snapXY(p, e);
    if (e.ctrlKey || e.metaKey) b = squareB(t.a, b);
    t.b = b;
    env.label(`${Math.round(Math.abs(b.x - t.a.x))} × ${Math.round(Math.abs(b.y - t.a.y))} мм`, e.clientX, e.clientY);
  } else if (t.stage === 'height') {
    t.h = heightFrom(t, e);
    env.label(`${Math.round(t.h)} мм · ${floorsLabel(t.h, massLevelHeight())}`, e.clientX, e.clientY);
  }
  env.redraw();
}

function commitTool(t) {
  const w = Math.abs(t.b.x - t.a.x);
  const d = Math.abs(t.b.y - t.a.y);
  const m = createMass({
    x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2, w, d, z0: t.z, h: t.h || MASS_H_DEFAULT,
  }, masses());
  Object.assign(t, { stage: 'corner', a: null, b: null, h: null, screen2: null });
  hideNum();
  env.label(null);
  addMass(m);
  env.hint(stageHint(t));
  return m;
}

// Клик (или тап) инструментом.
export function massToolClick(e) {
  const t = tool();
  if (!t || !env) return;
  t.touch = e.pointerType === 'touch';
  massToolMove(e);
  if (t.stage === 'corner' || !t.stage) {
    if (!t.cursor) return;
    t.a = { x: t.cursor.x, y: t.cursor.y };
    t.z = t.cursor.z || 0;
    t.b = { ...t.a };
    setStage(t, 'base');
  } else if (t.stage === 'base') {
    if (!t.b || Math.abs(t.b.x - t.a.x) < MASS_MIN || Math.abs(t.b.y - t.a.y) < MASS_MIN) {
      toast(`Основание массы — не меньше ${MASS_MIN} мм`, true);
      return;
    }
    t.screen2 = { x: e.clientX, y: e.clientY };
    t.h = MASS_MIN;
    setStage(t, 'height');
    // Касание: высота — следующим тапом; мышь — сразу тянется.
  } else if (t.stage === 'height') {
    commitTool(t);
  }
  env.redraw();
}

// Esc: стадия назад (true — съедено); на первой стадии — false (выйти).
export function massToolBack() {
  const t = tool();
  if (!t) return false;
  if (numField) { hideNum(); return true; }
  if (t.stage === 'height') { t.h = null; setStage(t, 'base'); env.redraw(); return true; }
  if (t.stage === 'base') { t.a = null; t.b = null; setStage(t, 'corner'); env.label(null); env.redraw(); return true; }
  return false;
}

// Призрак и ручки — грани-наложения для окна 3D (kind 'overlay').
export function massOverlay() {
  if (!env) return [];
  const out = [];
  const t = tool();
  const k = env.worldPerPx();
  if (t?.a && t.b && (t.stage === 'base' || t.stage === 'height')) {
    const x0 = Math.min(t.a.x, t.b.x); const x1 = Math.max(t.a.x, t.b.x);
    const y0 = Math.min(t.a.y, t.b.y); const y1 = Math.max(t.a.y, t.b.y);
    if (t.stage === 'height' && t.h > 0) {
      const ghost = massFaces([{ id: 'ghost', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, d: y1 - y0, z0: t.z, h: t.h, rotation: 0, color: GHOST }], { alpha: 0.3 });
      for (const f of ghost) out.push({ ...f, kind: 'overlay', twoSided: true, edgeRgba: [0.15, 0.4, 0.85, 0.9] });
    } else if (x1 - x0 > 0.5 || y1 - y0 > 0.5) {
      const z = t.z + 2;
      const P = [{ x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z }];
      out.push({
        pts: P, normal: { x: 0, y: 0, z: 1 }, color: GHOST, alpha: 0.3, kind: 'overlay', twoSided: true,
        edges: P.map((p, i) => [p, P[(i + 1) % 4]]), edgeRgba: [0.15, 0.4, 0.85, 0.95],
      });
    }
  }
  // Сетка земли (шаг 1 м, 40 × 40 м) — ориентир, пока включён инструмент.
  if (t) {
    const c = t.a || t.cursor || { x: 0, y: 0 };
    const cx = Math.round(c.x / 5000) * 5000; const cy = Math.round(c.y / 5000) * 5000;
    const z = (t.a ? t.z : t.cursor?.z || 0) + 1;
    const R = 20000; const edges = [];
    for (let k = -R; k <= R; k += 1000) {
      edges.push([{ x: cx + k, y: cy - R, z }, { x: cx + k, y: cy + R, z }], [{ x: cx - R, y: cy + k, z }, { x: cx + R, y: cy + k, z }]);
    }
    out.push({ pts: [], normal: { x: 0, y: 0, z: 1 }, color: GHOST, alpha: 0, kind: 'overlay', edges, edgeRgba: [0.2, 0.32, 0.5, 0.16] });
  }
  if (t?.cursor && (t.stage === 'corner' || !t.stage)) {
    const s = 5 * k;
    const c = t.cursor;
    const z = (c.z || 0) + 2;
    const P = [{ x: c.x - s, y: c.y - s, z }, { x: c.x + s, y: c.y - s, z }, { x: c.x + s, y: c.y + s, z }, { x: c.x - s, y: c.y + s, z }];
    out.push({ pts: P, normal: { x: 0, y: 0, z: 1 }, color: GHOST, alpha: 0.85, kind: 'overlay', twoSided: true });
  }
  // Ручки выбранной массы: маркеры в центрах верхней и боковых граней.
  const sel = !t && state.selection?.type === 'mass' ? massById(state.selection.id) : null;
  if (sel) {
    const b = massBox(sel);
    const s = 4.5 * k;
    const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2; const cz = (b.z0 + b.z1) / 2;
    const marks = {
      top: { x: cx, y: cy, z: b.z1 }, px: { x: b.x1, y: cy, z: cz }, nx: { x: b.x0, y: cy, z: cz },
      py: { x: cx, y: b.y1, z: cz }, ny: { x: cx, y: b.y0, z: cz },
    };
    for (const [face, p] of Object.entries(marks)) {
      const hot = (hover?.id === sel.id && hover.face === face) || (drag?.id === sel.id && drag.face === face);
      const color = hot ? '#ff9f1c' : '#ffffff';
      const cube = [
        [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
        [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]],
        [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
      ];
      for (const q of cube) {
        const P = q.map(([a, bb, c]) => ({ x: p.x + a * s, y: p.y + bb * s, z: p.z + c * s }));
        out.push({ pts: P, normal: { x: 0, y: 0, z: 1 }, color, alpha: 1, kind: 'overlay', twoSided: true, edges: P.map((pp, i) => [pp, P[(i + 1) % 4]]), edgeRgba: [0.15, 0.4, 0.85, 1] });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- правка

// Грань выбранной массы под лучом (только выбранной): { id, face, point, t } или null.
export function selectedMassHit(ray) {
  const sel = state.selection?.type === 'mass' ? massById(state.selection.id) : null;
  if (!sel) return null;
  return pickMass([{ id: sel.id, ...massBox(sel) }], ray);
}

const FACE_CURSOR = { top: 'ns-resize', bottom: 'ns-resize', px: 'ew-resize', nx: 'ew-resize', py: 'ew-resize', ny: 'ew-resize' };

export function massHoverAt(ray, e) {
  const hit = selectedMassHit(ray);
  const next = hit && hit.face !== 'bottom' ? { id: hit.id, face: hit.face } : null;
  const changed = (next?.face || null) !== (hover?.face || null) || (next?.id || null) !== (hover?.id || null);
  hover = next;
  return { changed, cursor: next ? (e?.altKey ? 'move' : FACE_CURSOR[next.face]) : null };
}

export function clearMassHover() {
  const had = Boolean(hover);
  hover = null;
  return had;
}

// Начало жеста по грани выбранной массы. true — жест начат.
export function startMassDrag(e, ray) {
  const hit = selectedMassHit(ray);
  if (!hit || hit.face === 'bottom') return false;
  const m = massById(hit.id);
  const move = Boolean(e.altKey);
  drag = {
    id: m.id, face: hit.face, mode: move ? 'move' : 'face', start: { ...m }, x0: e.clientX, y0: e.clientY,
    planeZ: hit.point.z, p0: hit.point, before: snapshot(), changed: false,
    supported: isSupported(m, masses()),
  };
  hover = { id: m.id, face: hit.face };
  env.redraw();
  return true;
}

function faceCoord(box, face) {
  return { top: box.z1, bottom: box.z0, px: box.x1, nx: box.x0, py: box.y1, ny: box.y0 }[face];
}

function dragFace(e) {
  const d = drag;
  const axis = { top: { x: 0, y: 0, z: 1 }, px: { x: 1, y: 0, z: 0 }, nx: { x: -1, y: 0, z: 0 }, py: { x: 0, y: 1, z: 0 }, ny: { x: 0, y: -1, z: 0 } }[d.face];
  let delta = env.axisDelta(axis, e.clientX - d.x0, e.clientY - d.y0);
  if (!delta && d.face === 'top') delta = -(e.clientY - d.y0) * env.worldPerPx();
  const box0 = massBox(d.start);
  const sign = d.face === 'nx' || d.face === 'ny' ? -1 : 1;
  const raw = faceCoord(box0, d.face) + sign * delta;
  let at;
  if (e.shiftKey) at = Math.round(raw / 10) * 10;
  else {
    const k = env.worldPerPx();
    const lines = d.face === 'top' ? zLines(d.id) : (d.face === 'px' || d.face === 'nx' ? massBaseSnap(d.id).xs : massBaseSnap(d.id).ys);
    const step = d.face === 'top' ? 100 : massStep(1 / k);
    at = snapValue(raw, lines, SNAP_PX * k, step).value;
  }
  const next = resizeFace(d.start, d.face, sign * (at - faceCoord(box0, d.face)));
  return next;
}

function dragMove(e) {
  const d = drag;
  const p = rayPlaneZ(env.ray(e), d.planeZ);
  if (!p) return null;
  let dx = p.x - d.p0.x;
  let dy = p.y - d.p0.y;
  const b = massBox(d.start);
  if (!e.shiftKey) {
    const k = env.worldPerPx();
    const tol = SNAP_PX * k;
    const step = massStep(1 / k);
    const lines = massBaseSnap(d.id);
    const fit = (lo, hi, v, list) => {
      let best = null;
      for (const L of list) {
        for (const edge of [lo, hi]) {
          const dd = L - (edge + v);
          if (Math.abs(dd) <= tol && (!best || Math.abs(dd) < Math.abs(best))) best = dd;
        }
      }
      return best != null ? v + best : Math.round(v / step) * step;
    };
    dx = fit(b.x0, b.x1, dx, lines.xs);
    dy = fit(b.y0, b.y1, dy, lines.ys);
  }
  let next = { ...d.start, x: d.start.x + dx, y: d.start.y + dy };
  if (d.supported) next = stackMass(next, masses().filter((m) => m.id !== d.id));
  return next;
}

export function moveMassDrag(e) {
  if (!drag) return;
  const next = drag.mode === 'move' ? dragMove(e) : dragFace(e);
  if (!next) return;
  state.project.masses = masses().map((m) => (m.id === drag.id ? next : m));
  drag.changed = JSON.stringify(next) !== JSON.stringify(drag.start);
  const b = massBox(next);
  const text = drag.mode === 'move'
    ? `Перенос: ${Math.round(next.x - drag.start.x)}, ${Math.round(next.y - drag.start.y)} мм${next.z0 ? ` · низ ${Math.round(next.z0)}` : ''}`
    : drag.face === 'top'
      ? `Высота: ${Math.round(b.z1 - b.z0)} мм · ${floorsLabel(b.z1 - b.z0, massLevelHeight())}`
      : `${drag.face === 'px' || drag.face === 'nx' ? 'Размер по X' : 'Размер по Y'}: ${Math.round(faceSize(next, drag.face))} мм`;
  env.label(text, e.clientX, e.clientY);
  env.redraw(true);
}

export function finishMassDrag() {
  const d = drag;
  drag = null;
  env.label(null);
  if (!d) return;
  if (!d.changed) { env.redraw(true); return; }
  refreshDerived();
  pushHistory(d.before);
  afterChange();
  selectObject({ type: 'mass', id: d.id });
}

export function cancelMassDrag() {
  const d = drag;
  drag = null;
  env?.label(null);
  if (!d) return;
  state.project.masses = masses().map((m) => (m.id === d.id ? d.start : m));
  env.redraw(true);
}

// ---------------------------------------------------------------- числа

function numInput() { return document.getElementById('v3MassNum'); }

function hideNum() {
  const input = numInput();
  if (input) input.hidden = true;
  numField = null;
}

const FIELD_LABEL = { w: 'Ширина', d: 'Глубина', h: 'Высота' };

function showNum(kind, value, extra = {}) {
  const input = numInput();
  if (!input) return;
  numField = { kind, ...extra };
  const at = lastCursor || { x: innerWidth / 2, y: innerHeight / 2 };
  const r = input.parentElement.getBoundingClientRect();
  input.style.left = `${Math.round(at.x - r.left)}px`;
  input.style.top = `${Math.round(at.y - r.top)}px`;
  const label = kind === 'face' ? (extra.face === 'top' ? 'Высота' : 'Размер') : FIELD_LABEL[kind];
  input.setAttribute('aria-label', `${label} массы, мм`);
  input.placeholder = label;
  input.title = `${label}, мм — Enter применить${kind === 'w' ? ', Tab — глубина' : ''}, Esc отмена`;
  input.value = value == null ? '' : String(Math.round(value));
  input.hidden = false;
  env.hint(`${label}, мм — Enter${kind === 'w' ? ' · Tab — глубина' : ''} · Esc — отмена`);
  input.focus();
  if (value != null) input.select();
}

function curDims(t) {
  return { w: t.b ? Math.abs(t.b.x - t.a.x) : 0, d: t.b ? Math.abs(t.b.y - t.a.y) : 0 };
}

function fixBase(t, w, d) {
  const sx = Math.sign((t.b?.x ?? t.a.x + 1) - t.a.x) || 1;
  const sy = Math.sign((t.b?.y ?? t.a.y + 1) - t.a.y) || 1;
  t.b = { x: t.a.x + sx * w, y: t.a.y + sy * d };
  t.screen2 = lastCursor ? { ...lastCursor } : { x: innerWidth / 2, y: innerHeight / 2 };
  t.h = t.h || MASS_H_DEFAULT;
  setStage(t, 'height');
  env.redraw();
}

// Клавиша в окне 3D для масс. true — съедена.
export function massKey(event) {
  const t = tool();
  if (!t) return false;
  const digit = /^[0-9]$/.test(event.key);
  if ((t.stage === 'base' || t.stage === 'height') && (digit || event.key === 'Enter')) {
    event.preventDefault();
    if (t.stage === 'base') showNum('w', digit ? null : curDims(t).w);
    else showNum('h', digit ? null : t.h || MASS_H_DEFAULT);
    if (digit) numInput().value = event.key;
    return true;
  }
  return false;
}

function applyNum(e) {
  const input = numInput();
  const f = numField;
  if (!f || !input) return;
  const v = Number(String(input.value).replace(',', '.'));
  if (!Number.isFinite(v) || v < MASS_MIN) { toast(`Нужно число от ${MASS_MIN} мм`, true); return; }
  const t = tool();
  if (f.kind === 'face') {
    hideNum();
    const next = updateMass(f.id, (m) => setFaceSize(m, f.face, v) || m);
    if (next) selectObject({ type: 'mass', id: next.id });
    env.hint();
    return;
  }
  if (!t) { hideNum(); return; }
  if (f.kind === 'w') {
    t.typedW = v;
    if (e?.key === 'Tab') { showNum('d', curDims(t).d || null); return; }
    hideNum();
    fixBase(t, v, curDims(t).d || v);
    showNum('h', MASS_H_DEFAULT);
  } else if (f.kind === 'd') {
    const w = t.typedW || curDims(t).w || v;
    hideNum();
    fixBase(t, w, v);
    showNum('h', MASS_H_DEFAULT);
  } else if (f.kind === 'h') {
    hideNum();
    if (!t.b || t.stage !== 'height') return;
    t.h = v;
    t.typedW = null;
    commitTool(t);
    env.redraw();
  }
}

export function bindMassNum() {
  const input = numInput();
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'Tab' && numField?.kind === 'w')) { e.preventDefault(); e.stopPropagation(); applyNum(e); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideNum(); env.hint(); }
  });
  input.addEventListener('blur', () => { setTimeout(() => { if (numField && document.activeElement !== input) { hideNum(); env.hint(); } }, 0); });
}

export const massNumOpen = () => Boolean(numField);
export function closeMassNum() { hideNum(); }

// Двойной клик по грани выбранной массы — точное значение.
export function massDblClick(e, ray) {
  const hit = selectedMassHit(ray);
  if (!hit || hit.face === 'bottom') return false;
  const m = massById(hit.id);
  lastCursor = { x: e.clientX, y: e.clientY };
  showNum('face', faceSize(m, hit.face), { face: hit.face, id: m.id });
  return true;
}

// Для автотестов.
export function debugMass3d() {
  const t = tool();
  return {
    tool: Boolean(t), stage: t?.stage || null, a: t?.a || null, b: t?.b || null, z: t?.z ?? null, h: t?.h ?? null,
    dragging: Boolean(drag), hover, num: numField?.kind || null,
  };
}


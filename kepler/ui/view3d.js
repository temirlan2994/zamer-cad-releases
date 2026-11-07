// 3D-просмотр дома поверх плана: WebGL с буфером глубины (запасной путь —
// грани по глубине на canvas 2D), перспектива, простое освещение. Мышь: тянуть — вращать, колесо — масштаб,
// правой/средней или с Shift — сдвиг. Пальцы: один — вращать, два —
// масштаб и сдвиг. Esc или «✕» — закрыть.
//
// Стены — объекты (как в Revit): клик выбирает стену (общий выбор с планом,
// state.selection), выбранная подсвечивается; её грани — ручки: верх —
// высота, бок — сдвиг (Alt — толщина), торец ручной стены — длина; двойной
// клик по ручке — ввод числа. Касание: тап — выбор, удержание грани
// выбранной стены — перетаскивание. Попадание — луч на процессоре
// (core/pick3d.js), правка — core/wall-edit3d.js; во время жеста
// пересобирается только слой стен этажа, в историю — одна запись.
//
// Модель — core/mesh3d.js (оси дома: x вправо, y вниз по плану, z вверх).
// Здесь она переводится в правую систему: X = x, Y = −y, Z = z.

import { GRID_STEP } from '../core/catalog.js';
import { buildHouseMesh, buildLevelWalls } from '../core/mesh3d.js';
import { LEVEL_KEYS } from '../core/model.js';
import {
  axisDelta, cameraBasis, pickWall, projectPoint, screenRay, wallBoxes,
} from '../core/pick3d.js';
import {
  GRIP_LABEL, applyGrip, applyGripValue, findWallRecord, gripFor, gripValue,
} from '../core/wall-edit3d.js';
import { el, toast } from './dom.js';
import { switchLevel } from './levels.js';
import { isSiteView } from './modes.js';
import { reconcileOpenings } from './plan-actions.js';
import { state } from './state.js';
import {
  afterChange, pushHistory, refreshDerived, restoreFrom, snapshot,
} from './store.js';
import { selectObject } from './tools.js';

// dist — масштаб ортографического вида; eyeDist — физическое расстояние до
// камеры. Их нельзя связывать: при сильном приближении камера иначе входит в
// дом, и ближняя плоскость начинает срезать стены.
const cam = { yaw: -2.2, pitch: 0.62, dist: 25000, eyeDist: 50000, target: { x: 0, y: 0, z: 1500 } };
const opts = { roof: false, site: true, terrainScale: 1, landscape: true };
let faces = [];
let active = false;
let gl = null; // WebGL-контекст (null — рисуем через canvas 2D)
let glState = null; // программа, атрибуты, буферы
let use2d = false;
let drawQueued = false;
const pointers = new Map();
let gesture = null;

const W = (p) => ({ x: p.x, y: -p.y, z: p.z }); // оси дома → правая система
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const LIGHT = norm({ x: 0.45, y: -0.6, z: 0.95 });

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const camera = (width, height) => cameraBasis(cam, width, height);

// ---------------------------------------------------------------- выбор стен

const SEL_COLOR = '#a9c8ef'; // выбранная стена
const GRIP_COLOR = '#5b94dd'; // грань-ручка под мышью / в жесте
const CLICK_SLOP = 5; // px — дальше это вращение, а не клик
const HOLD_MS = 450; // удержание пальцем — перетаскивание ручки
let boxes = null; // коробки стен для луча (кеш до пересборки)
let hover = null; // { key, level, face, normal, kind } — ручка выбранной стены под мышью
let edit = null; // жест правки стены

// Стены выбираются и правятся только в «Плане» (в «Участке»/«Ландшафте»
// план стен не правится).
const wallsEditable = () => !isSiteView();

function selectedRef() {
  const sel = state.selection;
  return sel?.type === 'wall' && state.project ? { key: sel.key, level: state.project.activeLevel } : null;
}

const refMatches = (ref, sel) => Boolean(ref && sel && ref.level === sel.level && (ref.key === sel.key || ref.keys?.includes(sel.key)));
const sameNormal = (a, b) => a && b && a.x === b.x && a.y === b.y && a.z === b.z;

function faceColor(face) {
  if (face.kind !== 'wall' || !face.ref) return face.color;
  const sel = selectedRef();
  if (!refMatches(face.ref, sel)) return face.color;
  if (hover && refMatches(face.ref, hover) && face.ref.face === hover.face && sameNormal(face.normal, hover.normal)) return GRIP_COLOR;
  return SEL_COLOR;
}

// Нормаль многоугольника по Ньюэллу (для двусторонних граней).
function polyNormal(P) {
  let nx = 0; let ny = 0; let nz = 0;
  for (let i = 0; i < P.length; i += 1) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return norm({ x: nx, y: ny, z: nz });
}

function render() {
  drawQueued = false;
  const canvas = el('canvas3d');
  if (!active || !canvas) return;
  if (!use2d && !gl) initGl(canvas);
  if (gl) renderGl(canvas); else render2d(canvas);
}

// ---------------------------------------------------------------- WebGL

const VS = `attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uMVP; varying vec4 vColor;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vColor = aColor; }`;
const FS = `precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }`;

function initGl(canvas) {
  const ctx = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!ctx) { use2d = true; return; }
  const shader = (type, src) => {
    const sh = ctx.createShader(type);
    ctx.shaderSource(sh, src);
    ctx.compileShader(sh);
    return sh;
  };
  const prog = ctx.createProgram();
  ctx.attachShader(prog, shader(ctx.VERTEX_SHADER, VS));
  ctx.attachShader(prog, shader(ctx.FRAGMENT_SHADER, FS));
  ctx.linkProgram(prog);
  if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) { use2d = true; return; }
  gl = ctx;
  glState = {
    prog,
    aPos: ctx.getAttribLocation(prog, 'aPos'),
    aColor: ctx.getAttribLocation(prog, 'aColor'),
    uMVP: ctx.getUniformLocation(prog, 'uMVP'),
    buffers: null,
  };
  uploadGeometry();
}

const EDGE_KINDS = new Set(['wall', 'roof', 'neighbor', 'plinth']);

// Грани → треугольники (затенение по Ламберту заранее) и рёбра.
function uploadGeometry() {
  if (!gl) return;
  const opaque = [];
  const glass = [];
  const lines = [];
  for (const face of faces) {
    const P = face.pts.map(W);
    const n = face.twoSided || !(face.normal.x || face.normal.y || face.normal.z) ? polyNormal(P) : W(face.normal);
    const lit = face.twoSided ? Math.abs(dot(n, LIGHT)) : Math.max(0, dot(n, LIGHT));
    const k = (0.6 + 0.4 * lit) / 255;
    const [r, g, b] = hexRgb(faceColor(face)).map((c) => c * k);
    const a = face.alpha ?? 1;
    const out = a < 1 ? glass : opaque;
    for (let i = 1; i < P.length - 1; i += 1) {
      for (const p of [P[0], P[i], P[i + 1]]) out.push(p.x, p.y, p.z, r, g, b, a);
    }
    if (Array.isArray(face.edges)) {
      for (const [a0, b0] of face.edges) {
        const p = W(a0);
        const q = W(b0);
        lines.push(p.x, p.y, p.z, 0.12, 0.16, 0.21, 0.48, q.x, q.y, q.z, 0.12, 0.16, 0.21, 0.48);
      }
    } else if (EDGE_KINDS.has(face.kind) && !face.noEdges) {
      for (let i = 0; i < P.length; i += 1) {
        const p = P[i];
        const q = P[(i + 1) % P.length];
        lines.push(p.x, p.y, p.z, 0.16, 0.2, 0.25, 0.35, q.x, q.y, q.z, 0.16, 0.2, 0.25, 0.35);
      }
    }
  }
  const make = (data) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return { buf, count: data.length / 7 };
  };
  if (glState.buffers) for (const b of Object.values(glState.buffers)) gl.deleteBuffer(b.buf);
  glState.buffers = { opaque: make(opaque), glass: make(glass), lines: make(lines) };
}

function orthographic(left, right, bottom, top, near, far) {
  return [
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, -2 / (far - near), 0,
    -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
  ];
}

function lookAt(eye, target) {
  const z = norm(sub(eye, target));
  const x = norm(cross({ x: 0, y: 0, z: 1 }, z));
  const y = cross(z, x);
  return [x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function renderGl(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const c = camera(width, height);
  // Аксонометрия без перспективных искажений — стандартный рабочий 3D-вид,
  // близкий к Revit. cam.dist здесь управляет масштабом, а не перспективой.
  const worldPerPx = cam.dist / c.focal;
  const halfW = (width * worldPerPx) / 2;
  const halfH = (height * worldPerPx) / 2;
  const far = Math.max(2e6, cam.eyeDist * 4);
  const mvp = mul(orthographic(-halfW, halfW, -halfH, halfH, 10, far), lookAt(c.eye, cam.target));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.9, 0.93, 0.96, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(glState.prog);
  gl.uniformMatrix4fv(glState.uMVP, false, new Float32Array(mvp));
  const draw = (b, mode) => {
    if (!b.count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.enableVertexAttribArray(glState.aPos);
    gl.vertexAttribPointer(glState.aPos, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(glState.aColor);
    gl.vertexAttribPointer(glState.aColor, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(mode, 0, b.count);
  };
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 1); // рёбра поверх граней без мерцания
  draw(glState.buffers.opaque, gl.TRIANGLES);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  draw(glState.buffers.lines, gl.LINES);
  gl.depthMask(false); // стекло прозрачное: не закрывает то, что за ним
  draw(glState.buffers.glass, gl.TRIANGLES);
  gl.depthMask(true);
}

// ---------------------------------------------------------------- canvas 2D

function render2d(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#dfe9f5');
  sky.addColorStop(1, '#f7f9fb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const c = camera(width, height);
  const near = 100;
  const list = [];
  for (const face of faces) {
    const P = face.pts.map(W);
    const centroid = P.reduce((s, p) => ({ x: s.x + p.x / P.length, y: s.y + p.y / P.length, z: s.z + p.z / P.length }), { x: 0, y: 0, z: 0 });
    const toEye = sub(c.eye, centroid);
    let n;
    if (face.twoSided) {
      n = polyNormal(P);
      if (dot(n, toEye) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    } else {
      n = W(face.normal);
      if (dot(n, toEye) <= 0) continue; // задняя грань
    }
    const pts = [];
    let depth = 0;
    let behind = false;
    const scale = c.focal / cam.dist;
    for (const p of P) {
      const d = sub(p, c.eye);
      const zc = dot(d, c.f);
      if (zc < near) { behind = true; break; }
      pts.push({ x: c.cx + dot(d, c.r) * scale, y: c.cy - dot(d, c.u) * scale });
      depth += zc;
    }
    if (behind) continue;
    const light = 0.6 + 0.4 * Math.max(0, dot(n, LIGHT));
    const [r, g, b] = hexRgb(faceColor(face));
    const edgePts = Array.isArray(face.edges) ? face.edges.map(([a0, b0]) => [a0, b0].map((raw) => {
      const d = sub(W(raw), c.eye);
      return { x: c.cx + dot(d, c.r) * scale, y: c.cy - dot(d, c.u) * scale };
    })) : null;
    list.push({ pts, edgePts, noEdges: face.noEdges, depth: depth / P.length, fill: `rgba(${Math.round(r * light)},${Math.round(g * light)},${Math.round(b * light)},${face.alpha ?? 1})`, kind: face.kind });
  }
  const layer = (k) => (k === 'ground' ? 0 : k === 'boundary' ? 1 : 2);
  list.sort((a, b) => layer(a.kind) - layer(b.kind) || b.depth - a.depth);
  ctx.lineJoin = 'round';
  for (const it of list) {
    ctx.beginPath();
    it.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = it.fill;
    ctx.fill();
    if (it.edgePts) {
      ctx.strokeStyle = 'rgba(30,38,48,0.48)';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      for (const [a, b] of it.edgePts) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    } else if (EDGE_KINDS.has(it.kind) && !it.noEdges) {
      ctx.strokeStyle = 'rgba(30,38,48,0.22)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
}

function requestRender() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(render);
}

// Камера смотрит на центр дома (стены и полы) с расстояния по его размеру;
// участок и соседи при этом могут уходить за край — колесом можно отдалить.
function frameHouse() {
  const house = faces.filter((f) => f.kind === 'wall' || f.kind === 'floor').flatMap((f) => f.pts).map(W);
  const pts = house.length ? house : faces.flatMap((f) => f.pts).map(W);
  if (!pts.length) return;
  const min = (k) => Math.min(...pts.map((p) => p[k]));
  const max = (k) => Math.max(...pts.map((p) => p[k]));
  cam.target = { x: (min('x') + max('x')) / 2, y: (min('y') + max('y')) / 2, z: max('z') / 3 };
  const span = Math.hypot(max('x') - min('x'), max('y') - min('y'), max('z') - min('z'));
  cam.dist = Math.min(400000, Math.max(8000, span * 1.1));
  cam.eyeDist = Math.max(25000, span * 3);
}

// Ползунок рельефа виден, только когда есть отметки высот.
function syncReliefControl() {
  const wrap = el('v3ReliefWrap');
  if (wrap) wrap.hidden = !(state.project?.site?.terrain?.points?.length >= 3);
}


const HINT_IDLE = 'Клик по стене — выбрать (и на плане) · тянуть — вращать, колесо — масштаб';
const HINT_SEL = 'Тяните верх стены — высота, бок — сдвиг (Alt — толщина), торец ручной стены — длина · двойной клик по грани — число · Ctrl — без привязки';
const HINT_SEL_TOUCH = 'Удерживайте грань выбранной стены и тяните: верх — высота, бок — сдвиг';
const HINT_SITE = 'Стены выбираются и правятся в режиме «План»';
let touchUsed = false;

function setHint(text) {
  const hint = el('v3Hint');
  if (!hint) return;
  if (text === undefined) {
    if (!wallsEditable()) text = HINT_SITE;
    else if (selectedRef()) text = touchUsed ? HINT_SEL_TOUCH : HINT_SEL;
    else text = HINT_IDLE;
  }
  hint.textContent = text;
}

// Подсветка выбора и ручки: перекраска граней.
function refreshHighlight() {
  uploadGeometry();
  requestRender();
  setHint();
}

export function refresh3d() {
  if (!active || edit) return;
  syncReliefControl();
  faces = buildHouseMesh(state.project, opts);
  boxes = null;
  uploadGeometry();
  requestRender();
  setHint();
}

export function open3d() {
  active = true;
  el('view3d').hidden = false;
  el('view3dBtn')?.classList.add('active');
  syncReliefControl();
  faces = buildHouseMesh(state.project, opts);
  boxes = null;
  hover = null;
  uploadGeometry();
  frameHouse();
  requestRender();
  setHint();
  document.dispatchEvent(new CustomEvent('kepler:view')); // дерево видов, «Свойства»
}

export function close3d() {
  if (edit) cancelEdit();
  hideNumber();
  active = false;
  hover = null;
  el('view3d').hidden = true;
  el('view3dBtn')?.classList.remove('active');
  document.dispatchEvent(new CustomEvent('kepler:view'));
}

export const is3dOpen = () => active;

// ---------------------------------------------------------------- луч и ручки

function canvasPoint(e) {
  const r = el('canvas3d').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

function pickAt(e) {
  if (!state.project || !wallsEditable()) return null;
  const c = canvasPoint(e);
  boxes ||= wallBoxes(state.project);
  return pickWall(boxes, screenRay(cam, c.w, c.h, c.x, c.y));
}

const onSelectedWall = (hit) => {
  const sel = selectedRef();
  return Boolean(hit && sel && hit.key === sel.key && hit.levelId === sel.level);
};

function gripAt(hit, e) {
  return onSelectedWall(hit) ? gripFor(hit, { alt: e.altKey }) : null;
}

const GRIP_CURSOR = { height: 'ns-resize', move: 'move', thickness: 'col-resize', length: 'ew-resize' };

function updateHover(e) {
  const hit = pickAt(e);
  const grip = gripAt(hit, e);
  const next = grip ? { key: hit.key, level: hit.levelId, face: hit.face, normal: hit.normal, kind: grip.kind } : null;
  el('canvas3d').style.cursor = grip ? GRIP_CURSOR[grip.kind] : '';
  const same = (!next && !hover) || (next && hover && next.key === hover.key && next.face === hover.face && sameNormal(next.normal, hover.normal));
  hover = next;
  if (!same) { uploadGeometry(); requestRender(); }
}

// Выбор стены кликом/тапом (пусто — снять выбор стены). Стена другого
// этажа делает его активным.
function clickSelect(hit) {
  if (!wallsEditable()) return;
  const defer = state.touchDeferSelect;
  state.touchDeferSelect = false;
  try {
    if (!hit) {
      if (state.selection?.type === 'wall') selectObject(null);
    } else {
      if (hit.levelId !== state.project.activeLevel) switchLevel(hit.levelId);
      selectObject({ type: 'wall', key: hit.key, from: hit.kind === 'manual' ? undefined : hit.from });
    }
  } finally {
    state.touchDeferSelect = defer;
  }
  hover = null;
  refreshHighlight();
}

function restoreStart(e) {
  for (const k of LEVEL_KEYS) state.project[k] = structuredClone(e.start[k]);
}

function startEdit(hit, grip, x0, y0) {
  const rec = findWallRecord(state.project, hit.key, hit.kind === 'manual' ? undefined : hit.from);
  if (!rec) return false;
  const levelId = state.project.activeLevel;
  edit = {
    rec, grip, levelId, x0, y0, d: 0, snap: GRID_STEP, changed: false,
    before: snapshot(),
    start: Object.fromEntries(LEVEL_KEYS.map((k) => [k, structuredClone(state.project[k])])),
    base: faces.filter((f) => f.wallsOf !== levelId),
  };
  hover = { key: hit.key, level: hit.levelId, face: hit.face, normal: hit.normal, kind: grip.kind };
  gesture = { kind: 'edit' };
  el('canvas3d').style.cursor = GRIP_CURSOR[grip.kind];
  setHint(`${GRIP_LABEL[grip.kind]}: ${gripValue(state.project, rec, grip)} мм`);
  uploadGeometry();
  requestRender();
  return true;
}

// Кадр жеста: модель — от состояния начала жеста + полное смещение;
// пересобирается только слой стен этажа.
function moveEdit(e) {
  const c = canvasPoint(e);
  const d = axisDelta(cam, c.w, c.h, edit.grip.axis, e.clientX - edit.x0, e.clientY - edit.y0);
  restoreStart(edit);
  edit.snap = e.ctrlKey || e.metaKey ? 0 : GRID_STEP;
  const res = applyGrip(state.project, edit.rec, edit.grip, d, { snap: edit.snap });
  edit.d = d;
  edit.changed = res.ok && !res.unchanged;
  faces = edit.base.concat(buildLevelWalls(state.project, edit.levelId));
  boxes = null;
  uploadGeometry();
  requestRender();
  if (!res.ok) { setHint(`Нельзя: ${res.reason}`); return; }
  const g = edit.grip;
  if (g.kind === 'move') {
    const shift = Math.round(edit.snap ? Math.round(d / edit.snap) * edit.snap : d);
    setHint(`Сдвиг: ${shift > 0 ? '+' : ''}${shift} мм`);
  } else {
    const rec = g.kind === 'height' ? edit.rec : findWallRecord(state.project, edit.rec.key, edit.rec.kind === 'manual' ? undefined : edit.rec.from);
    setHint(`${GRIP_LABEL[g.kind]}: ${gripValue(state.project, rec || edit.rec, g)} мм`);
  }
}

// Запись правки: проёмы, производные, одна запись истории, выбор той же стены.
function commitWallChange(before, rec) {
  reconcileOpenings();
  refreshDerived();
  pushHistory(before);
  afterChange();
  const moved = state.walls.find((w) => w.key === rec.key);
  selectObject({ type: 'wall', key: rec.key, from: rec.kind === 'manual' ? undefined : (moved?.from ?? rec.from) });
  refreshHighlight();
}

function finishEdit() {
  const e = edit;
  edit = null;
  gesture = null;
  restoreStart(e);
  if (!e.changed) { refresh3d(); return; }
  const res = applyGrip(state.project, e.rec, e.grip, e.d, { snap: e.snap, finalize: true });
  if (!res.ok || res.unchanged) {
    restoreStart(e);
    if (!res.ok) toast(`Нельзя: ${res.reason}`, true);
    refresh3d();
    return;
  }
  commitWallChange(e.before, e.rec);
}

function cancelEdit() {
  const e = edit;
  edit = null;
  gesture = null;
  restoreStart(e);
  refresh3d();
}

// ---------------------------------------------------------------- ввод числа

let numTarget = null;

function hideNumber() {
  const input = el('v3Num');
  if (input) input.hidden = true;
  numTarget = null;
}

function openNumber(e, hit, grip) {
  const input = el('v3Num');
  if (!input) return;
  const rec = findWallRecord(state.project, hit.key, hit.kind === 'manual' ? undefined : hit.from);
  if (!rec) return;
  numTarget = { rec, grip };
  const c = canvasPoint(e);
  input.style.left = `${Math.round(c.x)}px`;
  input.style.top = `${Math.round(c.y)}px`;
  input.title = `${GRIP_LABEL[grip.kind]}, мм — Enter применить, Esc отмена`;
  input.setAttribute('aria-label', `${GRIP_LABEL[grip.kind]} стены, мм`);
  input.value = String(gripValue(state.project, rec, grip));
  input.hidden = false;
  setHint(`${GRIP_LABEL[grip.kind]}, мм — Enter применить, Esc отмена`);
  input.focus();
  input.select();
}

function applyNumber() {
  const t = numTarget;
  const input = el('v3Num');
  hideNumber();
  if (!t || !input) return;
  const before = snapshot();
  const res = applyGripValue(state.project, t.rec, t.grip, input.value);
  if (!res.ok) {
    restoreFrom(before);
    toast(`Нельзя: ${res.reason}`, true);
    setHint();
    return;
  }
  commitWallChange(before, t.rec);
}

// ---------------------------------------------------------------- жесты

function onDown(e) {
  const canvas = el('canvas3d');
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (e.pointerType === 'touch') touchUsed = true;
  hideNumber();
  const pan = e.button === 1 || e.button === 2 || e.shiftKey;
  if (pointers.size === 2) {
    if (gesture?.hold) clearTimeout(gesture.hold);
    if (edit) cancelEdit();
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1, camDist: cam.dist, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    return;
  }
  if (pan || e.button !== 0 || pointers.size > 2) {
    gesture = { kind: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
    return;
  }
  const hit = pickAt(e);
  const grip = gripAt(hit, e);
  // Мышь: нажатие на грань выбранной стены — сразу ручка.
  if (grip && e.pointerType === 'mouse' && startEdit(hit, grip, e.clientX, e.clientY)) return;
  gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: true, hit };
  // Палец/перо: удержание грани выбранной стены — ручка (как на плане).
  if (grip) {
    const g = gesture;
    g.hold = setTimeout(() => {
      if (gesture !== g || !g.click || pointers.size !== 1) return;
      if (startEdit(hit, grip, g.x0, g.y0)) navigator.vibrate?.(15);
    }, HOLD_MS);
  }
}

function panBy(dx, dy) {
  const canvas = el('canvas3d');
  const c = camera(canvas.clientWidth, canvas.clientHeight);
  const k = cam.dist / c.focal;
  cam.target = {
    x: cam.target.x - (c.r.x * dx - c.u.x * dy) * k,
    y: cam.target.y - (c.r.y * dx - c.u.y * dy) * k,
    z: cam.target.z - (c.r.z * dx - c.u.z * dy) * k,
  };
}

function onMove(e) {
  if (!pointers.has(e.pointerId) || !gesture) {
    if (e.pointerType === 'mouse' && !gesture && active) updateHover(e);
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.kind === 'edit') { moveEdit(e); return; }
  if (gesture.kind === 'pinch') {
    const [a, b] = [...pointers.values()];
    if (!b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    cam.dist = Math.min(400000, Math.max(3000, (gesture.camDist * gesture.dist0) / d));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    panBy(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
    gesture.mid = mid;
  } else {
    if (gesture.click) {
      if (Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) <= CLICK_SLOP) return;
      gesture.click = false;
      clearTimeout(gesture.hold);
    }
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    if (gesture.kind === 'pan') panBy(dx, dy);
    else {
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.min(1.5, Math.max(0.05, cam.pitch + dy * 0.006));
    }
  }
  requestRender();
}

function onUp(e) {
  const g = gesture;
  pointers.delete(e.pointerId);
  if (g?.kind === 'edit') {
    if (!pointers.size) finishEdit();
    return;
  }
  if (g?.hold) clearTimeout(g.hold);
  if (g?.click && !pointers.size) {
    gesture = null;
    clickSelect(g.hit);
    return;
  }
  if (!pointers.size) gesture = null;
  else if (gesture?.kind === 'pinch') {
    const [p] = [...pointers.values()];
    gesture = { kind: 'orbit', x: p.x, y: p.y };
  }
}

function onCancel(e) {
  if (gesture?.kind === 'edit') {
    pointers.delete(e.pointerId);
    cancelEdit();
    return;
  }
  if (gesture?.hold) clearTimeout(gesture.hold);
  if (gesture) gesture.click = false;
  onUp(e);
}

function onDblClick(e) {
  const hit = pickAt(e);
  const grip = gripAt(hit, e);
  if (grip) openNumber(e, hit, grip);
}

export function bind3d() {
  const canvas = el('canvas3d');
  el('view3dBtn')?.addEventListener('click', () => (active ? close3d() : open3d()));
  el('v3Close')?.addEventListener('click', close3d);
  el('v3Roof')?.addEventListener('change', (e) => { opts.roof = e.target.checked; refresh3d(); });
  el('v3Site')?.addEventListener('change', (e) => { opts.site = e.target.checked; refresh3d(); });
  el('v3Landscape')?.addEventListener('change', (e) => { opts.landscape = e.target.checked; refresh3d(); });
  el('v3Relief')?.addEventListener('input', (e) => {
    opts.terrainScale = Math.max(1, Math.min(5, Number(e.target.value) || 1));
    const label = el('v3ReliefVal');
    if (label) label.textContent = String(opts.terrainScale);
    refresh3d();
  });
  el('v3Fit')?.addEventListener('click', () => { frameHouse(); requestRender(); });
  const num = el('v3Num');
  num?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyNumber(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideNumber(); setHint(); }
  });
  num?.addEventListener('blur', () => { if (numTarget) { hideNumber(); setHint(); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', () => {
    if (!hover || gesture) return;
    hover = null;
    canvas.style.cursor = '';
    uploadGeometry();
    requestRender();
  });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.min(400000, Math.max(3000, cam.dist * Math.exp(e.deltaY * 0.0012)));
    requestRender();
  }, { passive: false });
  new ResizeObserver(() => requestRender()).observe(canvas);
}

// Для автотестов: камера, число граней, выбранная стена.
export function debug3d() {
  return {
    active, faces: faces.length, webgl: Boolean(gl), cam: { ...cam, target: { ...cam.target } },
    selectedKey: selectedRef()?.key ?? null, editing: Boolean(edit),
    highlighted: faces.filter((f) => f.kind === 'wall' && faceColor(f) !== f.color).length,
  };
}

// Для автотестов: что под точкой экрана (clientX/Y) — стена и грань.
export function debug3dPick(x, y) {
  const hit = pickAt({ clientX: x, clientY: y });
  return hit ? { key: hit.key, face: hit.face, levelId: hit.levelId } : null;
}

// Для автотестов: точка в осях дома → экранные координаты (clientX/Y).
export function debug3dScreen(p) {
  const canvas = el('canvas3d');
  const r = canvas.getBoundingClientRect();
  const q = projectPoint(cam, r.width, r.height, p);
  return { x: r.left + q.x, y: r.top + q.y };
}

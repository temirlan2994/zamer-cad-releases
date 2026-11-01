// 3D-просмотр дома поверх плана: WebGL с буфером глубины (запасной путь —
// грани по глубине на canvas 2D), перспектива, простое освещение. Мышь: тянуть — вращать, колесо — масштаб,
// правой/средней или с Shift — сдвиг. Пальцы: один — вращать, два —
// масштаб и сдвиг. Esc или «✕» — закрыть.
//
// Модель — core/mesh3d.js (оси дома: x вправо, y вниз по плану, z вверх).
// Здесь она переводится в правую систему: X = x, Y = −y, Z = z.

import { buildHouseMesh } from '../core/mesh3d.js';
import { el } from './dom.js';
import { state } from './state.js';

const cam = { yaw: -2.2, pitch: 0.62, dist: 25000, target: { x: 0, y: 0, z: 1500 } };
const opts = { roof: false, site: true };
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

function camera(width, height) {
  const cp = Math.cos(cam.pitch);
  const eye = {
    x: cam.target.x + cam.dist * cp * Math.cos(cam.yaw),
    y: cam.target.y + cam.dist * cp * Math.sin(cam.yaw),
    z: cam.target.z + cam.dist * Math.sin(cam.pitch),
  };
  const f = norm(sub(cam.target, eye));
  const r = norm(cross(f, { x: 0, y: 0, z: 1 }));
  const u = cross(r, f);
  const focal = 0.95 * Math.min(width, height);
  return { eye, f, r, u, focal, cx: width / 2, cy: height / 2 };
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

const EDGE_KINDS = new Set(['wall', 'roof', 'neighbor']);

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
    const [r, g, b] = hexRgb(face.color).map((c) => c * k);
    const a = face.alpha ?? 1;
    const out = a < 1 ? glass : opaque;
    for (let i = 1; i < P.length - 1; i += 1) {
      for (const p of [P[0], P[i], P[i + 1]]) out.push(p.x, p.y, p.z, r, g, b, a);
    }
    if (EDGE_KINDS.has(face.kind)) {
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

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
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
  // Тот же угол обзора, что у запасного пути: focal = 0.95·min(w, h).
  const fovy = 2 * Math.atan(height / 2 / c.focal);
  const mvp = mul(perspective(fovy, width / Math.max(1, height), 100, 2e6), lookAt(c.eye, cam.target));
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
    for (const p of P) {
      const d = sub(p, c.eye);
      const zc = dot(d, c.f);
      if (zc < near) { behind = true; break; }
      pts.push({ x: c.cx + (c.focal * dot(d, c.r)) / zc, y: c.cy - (c.focal * dot(d, c.u)) / zc });
      depth += zc;
    }
    if (behind) continue;
    const light = 0.6 + 0.4 * Math.max(0, dot(n, LIGHT));
    const [r, g, b] = hexRgb(face.color);
    list.push({ pts, depth: depth / P.length, fill: `rgba(${Math.round(r * light)},${Math.round(g * light)},${Math.round(b * light)},${face.alpha ?? 1})`, kind: face.kind });
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
    if (it.kind === 'wall' || it.kind === 'roof' || it.kind === 'neighbor') {
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
  cam.dist = Math.min(400000, Math.max(8000, span * 1.7));
}

export function refresh3d() {
  if (!active) return;
  faces = buildHouseMesh(state.project, opts);
  uploadGeometry();
  requestRender();
}

export function open3d() {
  active = true;
  el('view3d').hidden = false;
  el('view3dBtn')?.classList.add('active');
  faces = buildHouseMesh(state.project, opts);
  uploadGeometry();
  frameHouse();
  requestRender();
}

export function close3d() {
  active = false;
  el('view3d').hidden = true;
  el('view3dBtn')?.classList.remove('active');
}

export const is3dOpen = () => active;

function onDown(e) {
  const canvas = el('canvas3d');
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const pan = e.button === 1 || e.button === 2 || e.shiftKey;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1, camDist: cam.dist, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  } else {
    gesture = { kind: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
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
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.kind === 'pinch') {
    const [a, b] = [...pointers.values()];
    if (!b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    cam.dist = Math.min(400000, Math.max(3000, (gesture.camDist * gesture.dist0) / d));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    panBy(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
    gesture.mid = mid;
  } else {
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
  pointers.delete(e.pointerId);
  if (!pointers.size) gesture = null;
  else if (gesture?.kind === 'pinch') {
    const [p] = [...pointers.values()];
    gesture = { kind: 'orbit', x: p.x, y: p.y };
  }
}

export function bind3d() {
  const canvas = el('canvas3d');
  el('view3dBtn')?.addEventListener('click', () => (active ? close3d() : open3d()));
  el('v3Close')?.addEventListener('click', close3d);
  el('v3Roof')?.addEventListener('change', (e) => { opts.roof = e.target.checked; refresh3d(); });
  el('v3Site')?.addEventListener('change', (e) => { opts.site = e.target.checked; refresh3d(); });
  el('v3Fit')?.addEventListener('click', () => { frameHouse(); requestRender(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.min(400000, Math.max(3000, cam.dist * Math.exp(e.deltaY * 0.0012)));
    requestRender();
  }, { passive: false });
  new ResizeObserver(() => requestRender()).observe(canvas);
}

// Для автотестов: камера и число граней.
export function debug3d() {
  return { active, faces: faces.length, webgl: Boolean(gl), cam: { ...cam, target: { ...cam.target } } };
}

// Рендеринг модели общими материалами, прозрачностью и тестом глубины
// в окне 3D и на печатном листе. У каждого холста собственный контекст.
import { cameraBasis } from '../core/pick3d.js';

export const W = (p) => ({ x: p.x, y: -p.y, z: p.z }); // оси дома → правая система
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const LIGHT = norm({ x: 0.45, y: -0.6, z: 0.95 });

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Нормаль многоугольника по Ньюэллу (для двусторонних граней).
export function polyNormal(P) {
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

const VS = `attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uMVP; varying vec4 vColor;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vColor = aColor; }`;
const FS = `precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }`;

export function createSceneGL(canvas) {
  const ctx = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!ctx) return null;
  const shader = (type, src) => {
    const sh = ctx.createShader(type);
    ctx.shaderSource(sh, src);
    ctx.compileShader(sh);
    return sh;
  };
  const prog = ctx.createProgram();
  for (const [type, source] of [[ctx.VERTEX_SHADER, VS], [ctx.FRAGMENT_SHADER, FS]]) {
    const sh = shader(type, source);
    ctx.attachShader(prog, sh);
    ctx.deleteShader(sh);
  }
  ctx.linkProgram(prog);
  if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) { ctx.deleteProgram(prog); return null; }
  return { gl: ctx,
    prog,
    aPos: ctx.getAttribLocation(prog, 'aPos'),
    aColor: ctx.getAttribLocation(prog, 'aColor'),
    uMVP: ctx.getUniformLocation(prog, 'uMVP'),
    buffers: null,
  };
}

export const EDGE_KINDS = new Set(['wall', 'roof', 'roof-drain', 'neighbor', 'plinth', 'foundation', 'entrance', 'furniture', 'stairs']);

// Грани → треугольники (затенение по Ламберту заранее) и рёбра.
function faceArrays(list, faceColor, faceAlpha) {
  const opaque = [];
  const glass = [];
  const lines = [];
  for (const face of list) {
    const P = face.pts.map(W);
    const n = face.twoSided || !(face.normal.x || face.normal.y || face.normal.z) ? polyNormal(P) : W(face.normal);
    const lit = face.twoSided ? Math.abs(dot(n, LIGHT)) : Math.max(0, dot(n, LIGHT));
    const k = face.flat ? 1 / 255 : (0.6 + 0.4 * lit) / 255; // flat — гизмо без тени
    const [r, g, b] = hexRgb(faceColor(face)).map((c) => c * k);
    const a = faceAlpha(face);
    const out = a < 1 ? glass : opaque;
    for (let i = 1; i < P.length - 1; i += 1) {
      for (const p of [P[0], P[i], P[i + 1]]) out.push(p.x, p.y, p.z, r, g, b, a);
    }
    if (Array.isArray(face.edges)) {
      const [er, eg, eb, ea] = face.edgeRgba || [0.12, 0.16, 0.21, 0.48];
      for (const [a0, b0] of face.edges) {
        const p = W(a0);
        const q = W(b0);
        lines.push(p.x, p.y, p.z, er, eg, eb, ea, q.x, q.y, q.z, er, eg, eb, ea);
      }
    } else if (EDGE_KINDS.has(face.kind) && !face.noEdges) {
      for (let i = 0; i < P.length; i += 1) {
        const p = P[i];
        const q = P[(i + 1) % P.length];
        lines.push(p.x, p.y, p.z, 0.16, 0.2, 0.25, 0.35, q.x, q.y, q.z, 0.16, 0.2, 0.25, 0.35);
      }
    }
  }
  return { opaque, glass, lines };
}

export function sceneBuffers(gl, faces, color = (face) => face.color, alpha = (face) => face.alpha ?? 1) {
  const arrays = faceArrays(faces, color, alpha);
  const make = (data) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return { buf, count: data.length / 7 };
  };
  return { opaque: make(arrays.opaque), glass: make(arrays.glass), lines: make(arrays.lines) };
}

function orthographic(left, right, bottom, top, near, far) {
  return [
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, -2 / (far - near), 0,
    -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
  ];
}

function perspectiveFromFocal(focal, width, height, near, far) {
  const sx = (2 * focal) / Math.max(1, width);
  const sy = (2 * focal) / Math.max(1, height);
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
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

export function drawSceneGL(glState, cam, width, height) {
  const gl = glState.gl;
  const c = cameraBasis(cam, width, height);
  const worldPerPx = cam.dist / c.focal;
  const halfW = (width * worldPerPx) / 2;
  const halfH = (height * worldPerPx) / 2;
  const far = Math.max(2e6, cam.eyeDist * 4);
  const projection = cam.projection === 'perspective'
    ? perspectiveFromFocal(c.focal, width, height, 50, far)
    : orthographic(-halfW, halfW, -halfH, halfH, 10, far);
  const mvp = mul(projection, lookAt(c.eye, cam.target));
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
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
  const over = glState.over || { opaque: { count: 0 }, glass: { count: 0 }, lines: { count: 0 } };
  draw(glState.buffers.opaque, gl.TRIANGLES);
  draw(over.opaque, gl.TRIANGLES);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  draw(glState.buffers.lines, gl.LINES);
  draw(over.lines, gl.LINES);
  gl.depthMask(false); // стекло прозрачное: не закрывает то, что за ним
  draw(glState.buffers.glass, gl.TRIANGLES);
  draw(over.glass, gl.TRIANGLES);
  // Подземная часть масс: только там, где её закрывает земля (или дом).
  if (glState.under) {
    gl.depthFunc(gl.GREATER);
    draw(glState.under.glass, gl.TRIANGLES);
    draw(glState.under.lines, gl.LINES);
    gl.depthFunc(gl.LEQUAL);
  }
  // Гизмо и точки массы — поверх всего (порядок — как в списке).
  if (glState.top) {
    gl.disable(gl.DEPTH_TEST);
    draw(glState.top.glass, gl.TRIANGLES);
    draw(glState.top.opaque, gl.TRIANGLES);
    draw(glState.top.lines, gl.LINES);
    gl.enable(gl.DEPTH_TEST);
  }
  gl.depthMask(true);
}

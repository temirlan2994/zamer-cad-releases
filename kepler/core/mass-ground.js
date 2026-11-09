// Подземная часть масс на рельефе (чистый модуль без DOM).
//
// hz(x, y) — отметка земли в осях дома относительно пола 1 этажа (как
// terrainHeightFn в core/mesh3d.js; ровная земля — 0). Часть массы ниже
// поверхности земли отдаётся отдельными гранями kind 'massUnder' (окно 3D
// рисует их бледно сквозь землю), а линия пересечения с землёй — рёбрами
// грани kind 'massLine' («ватерлиния»).
//
// Бока массы режутся на полосы шагом step (по умолчанию 500 мм, не больше 40
// на сторону); в полосе профиль земли линейный, подземная часть — отсечение
// прямоугольника полосы полуплоскостью z ≤ g(s). Верх и низ — сеткой ячеек:
// ячейка под землёй, если земля в её центре выше грани.

import { MASS_COLOR, massBox } from './masses.js';

const EPS = 1; // мм — касание земли не считаем погружением
const LINE_LIFT = 15; // мм — ватерлиния чуть над землёй (не тонет в сетке)

// Отсечение многоугольника (s, z) полуплоскостью f(P) ≥ 0, f линейна.
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a); const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push({ s: a.s + (b.s - a.s) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

// Отрезок (s0, g0)–(s1, g1) в пределах z0 ≤ z ≤ z1 → [[s, z], [s, z]] или null.
function clipSeg(s0, g0, s1, g1, z0, z1) {
  let t0 = 0; let t1 = 1;
  const dz = g1 - g0;
  for (const [p, q] of [[-dz, g0 - z0], [dz, z1 - g0]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
  }
  if (t1 - t0 < 1e-9) return null;
  return [{ s: s0 + (s1 - s0) * t0, z: g0 + dz * t0 }, { s: s0 + (s1 - s0) * t1, z: g0 + dz * t1 }];
}

const v = (x, y, z) => ({ x, y, z });

// Сводка погружения массы: { under, line, cells } — under — многоугольники
// подземной части (3D-точки в осях дома, с нормалью), line — отрезки линии
// пересечения с землёй, edges — подземные рёбра бокса (низ и углы).
export function massGroundSplit(box, hz, { step = 500 } = {}) {
  const under = [];
  const line = [];
  const edges = [];
  if (typeof hz !== 'function') return { under, line, edges };
  const { x0, y0, x1, y1, z0, z1 } = box;
  const sides = [
    { a: { x: x0, y: y0 }, b: { x: x1, y: y0 }, n: v(0, -1, 0) },
    { a: { x: x1, y: y0 }, b: { x: x1, y: y1 }, n: v(1, 0, 0) },
    { a: { x: x1, y: y1 }, b: { x: x0, y: y1 }, n: v(0, 1, 0) },
    { a: { x: x0, y: y1 }, b: { x: x0, y: y0 }, n: v(-1, 0, 0) },
  ];
  for (const side of sides) {
    const len = Math.hypot(side.b.x - side.a.x, side.b.y - side.a.y);
    const n = Math.max(1, Math.min(40, Math.ceil(len / step)));
    const at = (s) => ({ x: side.a.x + ((side.b.x - side.a.x) * s) / len, y: side.a.y + ((side.b.y - side.a.y) * s) / len });
    const S = []; const G = [];
    for (let i = 0; i <= n; i += 1) {
      const s = (len * i) / n;
      const p = at(s);
      S.push(s);
      G.push(hz(p.x, p.y));
    }
    const to3 = (q) => { const p = at(q.s); return v(p.x, p.y, q.z); };
    for (let i = 0; i < n; i += 1) {
      const s0 = S[i]; const s1 = S[i + 1]; const g0 = G[i]; const g1 = G[i + 1];
      if (g0 <= z0 + EPS && g1 <= z0 + EPS) continue;
      const g = (q) => g0 + ((g1 - g0) * (q.s - s0)) / ((s1 - s0) || 1);
      const rect = [{ s: s0, z: z0 }, { s: s1, z: z0 }, { s: s1, z: z1 }, { s: s0, z: z1 }];
      const poly = clipPoly(rect, (q) => g(q) - q.z);
      if (poly.length >= 3) under.push({ pts: poly.map(to3), normal: side.n });
      const seg = clipSeg(s0, g0, s1, g1, z0, z1);
      if (seg && (seg[0].z > z0 + EPS || seg[1].z > z0 + EPS) && (seg[0].z < z1 - EPS || seg[1].z < z1 - EPS)) {
        line.push(seg.map((q) => { const p = to3(q); return v(p.x, p.y, p.z + LINE_LIFT); }));
      }
      // Нижнее ребро под землёй (по полосе).
      const bot = clipSeg(s0, g0 - z0, s1, g1 - z0, EPS, Infinity);
      if (bot) edges.push(bot.map((q) => { const p = at(q.s); return v(p.x, p.y, z0); }));
    }
    // Угол в начале стороны: вертикаль от низа до земли (не выше верха).
    if (G[0] > z0 + EPS) edges.push([v(side.a.x, side.a.y, z0), v(side.a.x, side.a.y, Math.min(z1, G[0]))]);
  }
  // Низ и верх — ячейками (ряды под землёй сливаются).
  const span = Math.max(x1 - x0, y1 - y0);
  const cells = Math.max(1, Math.min(16, Math.ceil(span / Math.max(step * 2, 1))));
  const nx = Math.max(1, Math.round((cells * (x1 - x0)) / (span || 1)));
  const ny = Math.max(1, Math.round((cells * (y1 - y0)) / (span || 1)));
  const dx = (x1 - x0) / nx; const dy = (y1 - y0) / ny;
  for (const [z, normal] of [[z0, v(0, 0, -1)], [z1, v(0, 0, 1)]]) {
    for (let j = 0; j < ny; j += 1) {
      let run = null;
      const flush = (iEnd) => {
        if (run == null) return;
        const ax = x0 + run * dx; const bx = x0 + iEnd * dx;
        const ay = y0 + j * dy; const by = ay + dy;
        under.push({ pts: [v(ax, ay, z), v(bx, ay, z), v(bx, by, z), v(ax, by, z)], normal });
        run = null;
      };
      for (let i = 0; i < nx; i += 1) {
        const inside = hz(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy) > z + EPS;
        if (inside && run == null) run = i;
        if (!inside) flush(i);
      }
      flush(nx);
    }
  }
  return { under, line, edges };
}

// Грани подземной части всех масс: kind 'massUnder' (бледные, сквозь землю)
// и по одной грани kind 'massLine' с рёбрами ватерлинии на массу.
export function massGroundFaces(masses, hz, { alpha = 0.22, step = 500 } = {}) {
  const out = [];
  if (typeof hz !== 'function') return out;
  for (const m of masses || []) {
    const box = massBox(m);
    const { under, line, edges } = massGroundSplit(box, hz, { step });
    if (!under.length) continue;
    const color = m.color || MASS_COLOR;
    for (const f of under) {
      out.push({ pts: f.pts, normal: f.normal, color, alpha, kind: 'massUnder', massId: m.id, twoSided: true });
    }
    out.push({
      pts: [], normal: v(0, 0, 1), color, alpha: 0, kind: 'massUnder', massId: m.id,
      edges, edgeRgba: [0.22, 0.38, 0.62, 0.6],
    });
    if (line.length) {
      out.push({
        pts: [], normal: v(0, 0, 1), color, alpha: 0, kind: 'massLine', massId: m.id,
        edges: line, edgeRgba: [0.08, 0.12, 0.2, 0.95],
      });
    }
  }
  return out;
}

// Погружена ли масса (быстрая проверка по полосам и ячейкам).
export function massUnderground(m, hz, opts) {
  return massGroundSplit(massBox(m), hz, opts).under.length > 0;
}

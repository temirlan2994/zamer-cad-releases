// Перетаскивание ребра замкнутого контура в двух понятных режимах:
// вдоль самого ребра (оба конца едут вместе) и перпендикулярно ему
// (соседние рёбра остаются на своих прямых). Используется редактором проёмов.

import { edgeFrame, moveEdgeLs } from './landscape-handles.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;
const quantize = (value, step) => (step > 0 ? Math.round(value / step) * step : value);

export function polygonEdgeMode(points, index, delta) {
  const frame = edgeFrame(points, index);
  if (!frame || !delta) return null;
  const along = dot(delta, frame.u);
  const normal = dot(delta, frame.n);
  return Math.abs(along) >= Math.abs(normal) ? 'along' : 'normal';
}

export function polygonEdgeAxis(points, index, mode) {
  const frame = edgeFrame(points, index);
  if (!frame) return null;
  return mode === 'along' ? frame.u : frame.n;
}

// delta — вектор указателя от начала жеста. mode после первого заметного
// движения фиксирует UI, чтобы грань не перескакивала между осями.
export function dragPolygonEdge(points, index, delta, { mode = null, snap = 0 } = {}) {
  const frame = edgeFrame(points, index);
  if (!frame || !delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return null;
  const picked = mode || polygonEdgeMode(points, index, delta);
  if (picked === 'normal') {
    const raw = dot(delta, frame.n);
    const moved = moveEdgeLs(points, index, true, raw, { snap });
    if (!moved) return null;
    return {
      ...moved, mode: picked,
      delta: { x: frame.n.x * moved.d, y: frame.n.y * moved.d },
    };
  }
  const d = quantize(dot(delta, frame.u), snap);
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  const next = (index + 1) % out.length;
  for (const i of [index, next]) {
    out[i] = { x: Math.round(out[i].x + frame.u.x * d), y: Math.round(out[i].y + frame.u.y * d) };
  }
  return { points: out, d, mode: 'along', clamped: false, delta: { x: frame.u.x * d, y: frame.u.y * d } };
}


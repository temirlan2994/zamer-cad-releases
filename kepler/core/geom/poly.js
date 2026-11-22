// Измерения и простые преобразования полигонов (ядро v7). Чистый модуль.
// Виды геометрии — как в core/geom/clip.js: Ring / Polygon / MultiPolygon.

import { asMulti, clean, difference, intersection, union } from './clip.js';

export { asMulti };

// Площадь контура со знаком (> 0 — «внешний»: Σ x_i·y_{i+1} − x_{i+1}·y_i > 0).
export function ringArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const a = ring[i]; const b = ring[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function orientation(ring) {
  return Math.sign(ringArea(ring));
}

export function orientRing(ring, sign = 1) {
  return orientation(ring) === -sign ? ring.slice().reverse() : ring.slice();
}

// Площадь (мм²): внешние контуры минус дыры.
export function area(g) {
  let s = 0;
  for (const poly of asMulti(g)) {
    poly.forEach((ring, i) => { s += i === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring)); });
  }
  return s;
}

// Площадь только внешних контуров (без вычета дыр) — «брутто».
export function outerArea(g) {
  let s = 0;
  for (const poly of asMulti(g)) s += Math.abs(ringArea(poly[0]));
  return s;
}

export function perimeter(g) {
  let s = 0;
  for (const poly of asMulti(g)) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i]; const b = ring[(i + 1) % ring.length];
        s += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
  }
  return s;
}

export function bbox(g) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const poly of asMulti(g)) {
    for (const p of poly[0] || []) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  }
  return { x0, y0, x1, y1 };
}

export function boxesOverlap(a, b, pad = 0) {
  return a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
}

function onSegment(a, b, p, tol) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= tol;
}

function ringContains(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j]; const b = ring[i];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Точка в геометрии (граница с допуском tol мм считается внутри).
export function pointInPolygon(g, p, tol = 0.5) {
  for (const poly of asMulti(g)) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 1) if (onSegment(ring[i], ring[(i + 1) % ring.length], p, tol)) return true;
    }
    if (!ringContains(poly[0], p)) continue;
    if (poly.slice(1).some((h) => ringContains(h, p))) continue;
    return true;
  }
  return false;
}

// Удаление повторов и коллинеарных точек (tol — допуск отклонения, мм).
export function simplifyRing(ring, tol = 0) {
  let pts = ring.slice();
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const out = [];
    for (let i = 0, n = pts.length; i < n; i += 1) {
      const a = out.length ? out[out.length - 1] : pts[(i - 1 + n) % n];
      const b = pts[i]; const c = pts[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const same = Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
      if (same || (len > 0 ? Math.abs(cross) / len <= tol : true)) { changed = true; continue; }
      out.push(b);
    }
    pts = out;
  }
  return pts.length >= 3 ? pts : [];
}

export function simplify(g, tol = 0) {
  return asMulti(g).map((poly) => poly.map((r) => simplifyRing(r, tol)).filter((r) => r.length))
    .filter((poly) => poly.length && poly[0].length);
}

// Связные компоненты: каждый полигон объединения — отдельная компонента
// (касание в точке не связывает).
export function components(g) {
  return union(g).map((poly) => [poly]);
}

// Внутренняя точка полигона: середина самого широкого интервала на
// горизонтали посреди самого высокого промежутка между вершинами.
export function interiorPoint(g) {
  const polys = asMulti(g);
  if (!polys.length) return null;
  const poly = polys.slice().sort((a, b) => area([b]) - area([a]))[0];
  const ys = [...new Set(poly.flat().map((p) => p.y))].sort((a, b) => a - b);
  let y = ys[0]; let gap = -1;
  for (let i = 0; i + 1 < ys.length; i += 1) {
    if (ys[i + 1] - ys[i] > gap) { gap = ys[i + 1] - ys[i]; y = (ys[i] + ys[i + 1]) / 2; }
  }
  const xs = [];
  for (const ring of poly) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  }
  return best ? { x: (best[0] + best[1]) / 2, y } : { ...poly[0][0] };
}

export function rectRing(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

// Поворот на deg (по формуле x' = x·cos − y·sin, y' = x·sin + y·cos; при оси Y
// вниз положительный угол — по часовой на экране) и сдвиг.
export function transformPoint(p, { x = 0, y = 0, rotation = 0 } = {}) {
  const r = ((rotation % 360) + 360) % 360;
  let px; let py;
  if (r === 0) { px = p.x; py = p.y; } else if (r === 90) { px = -p.y; py = p.x; } else if (r === 180) { px = -p.x; py = -p.y; } else if (r === 270) { px = p.y; py = -p.x; } else {
    const a = (r * Math.PI) / 180; const c = Math.cos(a); const s = Math.sin(a);
    px = p.x * c - p.y * s; py = p.x * s + p.y * c;
  }
  return { x: px + x, y: py + y };
}

export function transform(g, t) {
  return asMulti(g).map((poly) => poly.map((ring) => ring.map((p) => transformPoint(p, t))));
}

export function translate(g, dx, dy) {
  return asMulti(g).map((poly) => poly.map((ring) => ring.map((p) => ({ x: p.x + dx, y: p.y + dy }))));
}

// ---------------------------------------------------------------- смещение контура

// Полосы вдоль рёбер шириной d наружу (out=true) или внутрь и клинья в
// углах (миттер; для прямых углов = сумма Минковского с квадратом).
function edgeBands(g, d, out) {
  const parts = [];
  for (const poly of union(g)) {
    for (const ring of poly) {
      const n = ring.length;
      const norm = (a, b) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        // Внутренность слева (−dy, dx); наружу — справа (dy, −dx).
        const nx = (b.y - a.y) / len; const ny = -(b.x - a.x) / len;
        return out ? { x: nx, y: ny } : { x: -nx, y: -ny };
      };
      for (let i = 0; i < n; i += 1) {
        const a = ring[i]; const b = ring[(i + 1) % n];
        const m = norm(a, b);
        parts.push([[a, b, { x: b.x + m.x * d, y: b.y + m.y * d }, { x: a.x + m.x * d, y: a.y + m.y * d }]]);
        const c = ring[(i + 2) % n];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        // Выпуклый (наружу) — левый поворот; для эрозии нужны вогнутые.
        if (out ? cross <= 0 : cross >= 0) continue;
        const m2 = norm(b, c);
        const bis = { x: m.x + m2.x, y: m.y + m2.y };
        const bl = Math.hypot(bis.x, bis.y);
        const cosHalf = bl / 2;
        const p1 = { x: b.x + m.x * d, y: b.y + m.y * d };
        const p2 = { x: b.x + m2.x * d, y: b.y + m2.y * d };
        if (cosHalf > 0.25) {
          const k = d / cosHalf / bl;
          parts.push([[b, p1, { x: b.x + bis.x * k, y: b.y + bis.y * k }, p2]]);
        } else parts.push([[b, p1, p2]]);
      }
    }
  }
  return parts;
}

// Расширение на d мм (миттер).
export function buffer(g, d) {
  if (!(d > 0)) return union(g);
  return union(g, edgeBands(g, d, true));
}

// Сужение на d мм.
export function erode(g, d) {
  if (!(d > 0)) return union(g);
  return difference(g, edgeBands(g, d, false));
}

// Морфологическое «открытие»: убирает части тоньше 2d, остальное не трогает.
export function opening(g, d) {
  const core = erode(g, d);
  if (!core.length) return [];
  return intersection(g, buffer(core, d));
}

export { clean, difference, intersection, union };

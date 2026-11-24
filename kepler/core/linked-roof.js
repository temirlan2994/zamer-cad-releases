// Pure geometry for the linked (derived) roof. The input is the same compact
// orthogonal grid used by core/mesh3d.js: { xs, ys, nx, ny, mask }.
//
// z/baseZ is the underside of the roof at an eave. Thickness is vertical: the
// soffit follows the top surface at a constant Z offset. This keeps the result
// deterministic for elevations/sections and preserves the old flat-slab
// meaning of roof thickness.

import { intersection } from './geom/clip.js';
import { pointInPolygon } from './geom/poly.js';

export const LINKED_ROOF_TYPES = ['flat', 'shed', 'gable', 'hip'];
export const LINKED_ROOF_DIRECTIONS = ['auto', 'n', 'e', 's', 'w'];

const TYPE_SET = new Set(LINKED_ROOF_TYPES);
const DIRECTION_SET = new Set(LINKED_ROOF_DIRECTIONS);
const EPS = 1e-6;

const finite = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const keyOf = (i, j) => `${i}:${j}`;
const samePoint = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

function cleanPoly(points) {
  const out = [];
  for (const point of points) {
    if (!out.length || !samePoint(out.at(-1), point)) out.push(point);
  }
  if (out.length > 1 && samePoint(out[0], out.at(-1))) out.pop();
  return out;
}

function faceNormal(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  const length = Math.hypot(x, y, z);
  return length > EPS ? { x: x / length, y: y / length, z: z / length } : null;
}

function orientedFace(points, upward, fields) {
  let pts = points;
  let normal = faceNormal(pts);
  if (!normal) return null;
  if ((upward && normal.z < 0) || (!upward && normal.z > 0)) {
    pts = [...pts].reverse();
    normal = faceNormal(pts);
  }
  return normal ? { pts, normal, ...fields } : null;
}

function validGrid(grid) {
  if (!grid || !Array.isArray(grid.xs) || !Array.isArray(grid.ys)) return null;
  const xs = grid.xs.map(Number);
  const ys = grid.ys.map(Number);
  if (xs.length < 2 || ys.length < 2 || xs.some((x) => !Number.isFinite(x)) || ys.some((y) => !Number.isFinite(y))) return null;
  if (xs.some((x, i) => i && x <= xs[i - 1]) || ys.some((y, i) => i && y <= ys[i - 1])) return null;
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (!grid.mask || grid.mask.length < nx * ny) return null;
  return { xs, ys, nx, ny, mask: grid.mask };
}

function componentsOf(grid) {
  const { nx, ny, mask } = grid;
  const active = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && Boolean(mask[j * nx + i]);
  const seen = new Set();
  const components = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (!active(i, j) || seen.has(keyOf(i, j))) continue;
      const cells = [];
      const queue = [[i, j]];
      seen.add(keyOf(i, j));
      for (let at = 0; at < queue.length; at += 1) {
        const [ci, cj] = queue[at];
        cells.push({ i: ci, j: cj });
        for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const ni = ci + di;
          const nj = cj + dj;
          const key = keyOf(ni, nj);
          if (!active(ni, nj) || seen.has(key)) continue;
          seen.add(key);
          queue.push([ni, nj]);
        }
      }
      components.push(cells);
    }
  }
  return components;
}

function componentBounds(grid, cells) {
  const minI = Math.min(...cells.map((cell) => cell.i));
  const maxI = Math.max(...cells.map((cell) => cell.i));
  const minJ = Math.min(...cells.map((cell) => cell.j));
  const maxJ = Math.max(...cells.map((cell) => cell.j));
  return {
    minI, maxI, minJ, maxJ,
    x0: grid.xs[minI], x1: grid.xs[maxI + 1],
    y0: grid.ys[minJ], y1: grid.ys[maxJ + 1],
  };
}

function isRectComponent(cells, bounds) {
  return cells.length === (bounds.maxI - bounds.minI + 1) * (bounds.maxJ - bounds.minJ + 1);
}

function mergedBoundaryEdges(grid, cells) {
  const own = new Set(cells.map((cell) => keyOf(cell.i, cell.j)));
  const groups = new Map();
  const add = (side, fixed, lo, hi) => {
    const key = `${side}:${fixed}`;
    if (!groups.has(key)) groups.set(key, { side, fixed, intervals: [] });
    groups.get(key).intervals.push([Math.min(lo, hi), Math.max(lo, hi)]);
  };
  for (const { i, j } of cells) {
    const x0 = grid.xs[i];
    const x1 = grid.xs[i + 1];
    const y0 = grid.ys[j];
    const y1 = grid.ys[j + 1];
    if (!own.has(keyOf(i, j - 1))) add('n', y0, x0, x1);
    if (!own.has(keyOf(i + 1, j))) add('e', x1, y0, y1);
    if (!own.has(keyOf(i, j + 1))) add('s', y1, x0, x1);
    if (!own.has(keyOf(i - 1, j))) add('w', x0, y0, y1);
  }
  const edges = [];
  for (const group of groups.values()) {
    const sorted = group.intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of sorted) {
      if (merged.length && interval[0] <= merged.at(-1)[1] + EPS) merged.at(-1)[1] = Math.max(merged.at(-1)[1], interval[1]);
      else merged.push([...interval]);
    }
    for (const [lo, hi] of merged) {
      let a;
      let b;
      let normal;
      if (group.side === 'n') { a = { x: lo, y: group.fixed }; b = { x: hi, y: group.fixed }; normal = { x: 0, y: -1 }; }
      else if (group.side === 's') { a = { x: hi, y: group.fixed }; b = { x: lo, y: group.fixed }; normal = { x: 0, y: 1 }; }
      else if (group.side === 'e') { a = { x: group.fixed, y: lo }; b = { x: group.fixed, y: hi }; normal = { x: 1, y: 0 }; }
      else { a = { x: group.fixed, y: hi }; b = { x: group.fixed, y: lo }; normal = { x: -1, y: 0 }; }
      edges.push({ a, b, normal, side: group.side });
    }
  }
  return edges;
}

function distanceToSegment(point, edge) {
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 < EPS) return Math.hypot(point.x - edge.a.x, point.y - edge.a.y);
  const t = clamp(((point.x - edge.a.x) * dx + (point.y - edge.a.y) * dy) / length2, 0, 1);
  return Math.hypot(point.x - edge.a.x - dx * t, point.y - edge.a.y - dy * t);
}

function resolveDirection(type, requested, bounds) {
  if (type === 'flat' || type === 'hip') return 'auto';
  if (requested !== 'auto') return requested;
  if (type === 'shed') return 's';
  return bounds.x1 - bounds.x0 >= bounds.y1 - bounds.y0 ? 'n' : 'e';
}

function roofHeight(type, direction, bounds, boundaries, tangent) {
  if (type === 'flat' || tangent <= EPS) return () => 0;
  if (type === 'shed') {
    if (direction === 'n') return (point) => Math.max(0, point.y - bounds.y0) * tangent;
    if (direction === 's') return (point) => Math.max(0, bounds.y1 - point.y) * tangent;
    if (direction === 'w') return (point) => Math.max(0, point.x - bounds.x0) * tangent;
    return (point) => Math.max(0, bounds.x1 - point.x) * tangent;
  }
  const eaveSides = direction === 'n' || direction === 's' ? new Set(['n', 's']) : new Set(['e', 'w']);
  const sources = type === 'hip' ? boundaries : boundaries.filter((edge) => eaveSides.has(edge.side));
  return (point) => {
    if (!sources.length) return 0;
    return Math.max(0, Math.min(...sources.map((edge) => distanceToSegment(point, edge)))) * tangent;
  };
}

function rectanglePatches(type, direction, bounds) {
  const { x0, x1, y0, y1 } = bounds;
  const rect = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  if (type === 'flat' || type === 'shed') return [rect];
  if (type === 'gable') {
    if (direction === 'n' || direction === 's') {
      const y = (y0 + y1) / 2;
      return [
        [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y }, { x: x0, y }],
        [{ x: x0, y }, { x: x1, y }, { x: x1, y: y1 }, { x: x0, y: y1 }],
      ];
    }
    const x = (x0 + x1) / 2;
    return [
      [{ x: x0, y: y0 }, { x, y: y0 }, { x, y: y1 }, { x: x0, y: y1 }],
      [{ x, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x, y: y1 }],
    ];
  }
  const width = x1 - x0;
  const height = y1 - y0;
  if (width >= height) {
    const y = (y0 + y1) / 2;
    const left = x0 + height / 2;
    const right = x1 - height / 2;
    return [
      [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: right, y }, { x: left, y }],
      [{ x: x1, y: y0 }, { x: x1, y: y1 }, { x: right, y }],
      [{ x: left, y }, { x: right, y }, { x: x1, y: y1 }, { x: x0, y: y1 }],
      [{ x: x0, y: y0 }, { x: left, y }, { x: x0, y: y1 }],
    ].map(cleanPoly);
  }
  const x = (x0 + x1) / 2;
  const top = y0 + width / 2;
  const bottom = y1 - width / 2;
  return [
    [{ x: x0, y: y0 }, { x, y: top }, { x, y: bottom }, { x: x0, y: y1 }],
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x, y: top }],
    [{ x, y: top }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x, y: bottom }],
    [{ x, y: bottom }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  ].map(cleanPoly);
}

function cellPatches(grid, cells, split) {
  const patches = [];
  for (const { i, j } of cells) {
    const x0 = grid.xs[i];
    const x1 = grid.xs[i + 1];
    const y0 = grid.ys[j];
    const y1 = grid.ys[j + 1];
    const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    if (!split) { patches.push(corners); continue; }
    const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    for (let k = 0; k < 4; k += 1) patches.push([corners[k], corners[(k + 1) % 4], center]);
  }
  return patches;
}

function drainageSides(type, direction) {
  if (type === 'flat' || type === 'hip') return new Set(['n', 'e', 's', 'w']);
  if (type === 'shed') return new Set([direction]);
  return direction === 'n' || direction === 's' ? new Set(['n', 's']) : new Set(['e', 'w']);
}

function optionMetadata(options) {
  const raw = options.metadata && typeof options.metadata === 'object' ? options.metadata
    : (options.meta && typeof options.meta === 'object' ? options.meta : {});
  const out = { ...raw };
  for (const key of ['autoRoofId', 'roofId', 'roofSource', 'level']) {
    if (options[key] != null) out[key] = options[key];
  }
  return out;
}

// Returns an Array<face>. For consumers that also draw gutters, the array has
// a drainageEdges property. The first top face of every connected component
// also carries its local `edges` and `drainageEdges`, matching slabFaces' edge
// metadata convention.
export function slopedRoofFaces(rawGrid, options = {}) {
  const grid = validGrid(rawGrid);
  const faces = [];
  const allDrainage = [];
  faces.drainageEdges = allDrainage;
  if (!grid) return faces;

  const type = TYPE_SET.has(options.type) ? options.type : 'flat';
  const requestedDirection = DIRECTION_SET.has(options.direction) ? options.direction : 'auto';
  const pitchDeg = type === 'flat' ? 0 : clamp(finite(options.pitchDeg, 20), 0, 75);
  const tangent = Math.tan((pitchDeg * Math.PI) / 180);
  const thickness = clamp(finite(options.thickness, 250), 1, 5000);
  const baseZ = finite(options.z ?? options.baseZ ?? options.z0, 0);
  const eaveTop = baseZ + thickness;
  const color = typeof options.color === 'string' ? options.color : '#9aa3ad';
  const kind = typeof options.kind === 'string' ? options.kind : 'roof';
  const soffitKind = typeof options.soffitKind === 'string' ? options.soffitKind : 'roof-soffit';
  const drainageEnabled = options.drainage !== false && options.drainage?.enabled !== false;
  const sharedMetadata = optionMetadata(options);

  componentsOf(grid).forEach((cells, component) => {
    const bounds = componentBounds(grid, cells);
    const boundaries = mergedBoundaryEdges(grid, cells);
    const direction = resolveDirection(type, requestedDirection, bounds);
    const riseAt = roofHeight(type, direction, bounds, boundaries, tangent);
    const topAt = (point) => eaveTop + riseAt(point);
    const bottomAt = (point) => topAt(point) - thickness;
    const metadata = {
      ...sharedMetadata, roofType: type, pitchDeg, roofDirection: direction, roofComponent: component,
    };
    const patches = isRectComponent(cells, bounds)
      ? rectanglePatches(type, direction, bounds)
      : cellPatches(grid, cells, type === 'gable' || type === 'hip');
    let firstTop = null;
    for (const rawPatch of patches) {
      const patch = cleanPoly(rawPatch);
      if (patch.length < 3) continue;
      const bottomPts = patch.map((point) => ({ x: point.x, y: point.y, z: bottomAt(point) }));
      const top = orientedFace(patch.map((point) => ({ x: point.x, y: point.y, z: topAt(point) })), true, {
        color, kind, edges: [], roofSurface: 'top', roofThickness: thickness, bottomPts, ...metadata,
      });
      const bottom = orientedFace(bottomPts, false, {
        color, kind: soffitKind, edges: [], roofSurface: 'bottom', roofThickness: thickness, ...metadata,
      });
      if (top) {
        const lows = bottomPts.map((point) => point.z);
        if (Math.max(...lows) - Math.min(...lows) < EPS) top.cutZ0 = lows[0];
        faces.push(top);
        if (!firstTop) firstTop = top;
      }
      if (bottom) faces.push(bottom);
    }

    // Тонкий торец двускатной плиты следует коньку. Соединять оба
    // карниза одной горизонтальной полосой у фронтона нельзя.
    const endEdges = type === 'gable' ? boundaries.flatMap((edge) => {
      const axis = edge.normal.x ? 'y' : 'x';
      const fixed = edge.normal.x ? 'x' : 'y';
      const lo = Math.min(edge.a[axis], edge.b[axis]); const hi = Math.max(edge.a[axis], edge.b[axis]);
      const along = [...new Set(patches.flat().filter((p) => p[fixed] === edge.a[fixed] && p[axis] >= lo && p[axis] <= hi)
        .map((p) => p[axis]))].sort((a, b) => (a - b) * Math.sign(edge.b[axis] - edge.a[axis]));
      const chain = [];
      for (const value of along) {
        const point = { ...edge.a, [axis]: value };
        if (chain.length > 1) {
          const a = chain.at(-2); const b = chain.at(-1);
          const fraction = (b[axis] - a[axis]) / (value - a[axis]);
          if (Math.abs(topAt(b) - (topAt(a) + (topAt(point) - topAt(a)) * fraction)) < EPS) chain.pop();
        }
        chain.push(point);
      }
      return chain.slice(1).map((b, i) => ({ ...edge, a: chain[i], b }));
    }) : boundaries;
    const outlineEdges = [];
    for (const edge of endEdges) {
      const topA = { ...edge.a, z: topAt(edge.a) };
      const topB = { ...edge.b, z: topAt(edge.b) };
      const bottomA = { ...edge.a, z: bottomAt(edge.a) };
      const bottomB = { ...edge.b, z: bottomAt(edge.b) };
      const side = orientedFace([bottomA, bottomB, topB, topA], true, {
        color, kind, edges: [], roofSurface: 'edge', roofThickness: thickness, ...metadata,
      });
      if (side) {
        // A vertical face has no useful up/down orientation. Use the exact
        // outward grid normal so lighting is stable at gable ends and eaves.
        side.normal = { x: edge.normal.x, y: edge.normal.y, z: 0 };
        faces.push(side);
      }
      outlineEdges.push([topA, topB], [bottomA, bottomB], [bottomA, topA], [bottomB, topB]);
    }

    const localDrainage = [];
    if (drainageEnabled) {
      const sides = drainageSides(type, direction);
      for (const edge of boundaries.filter((candidate) => sides.has(candidate.side))) {
        localDrainage.push({
          a: { ...edge.a, z: topAt(edge.a) }, b: { ...edge.b, z: topAt(edge.b) },
          normal: edge.normal, side: edge.side, kind: 'roof-drain', ...metadata,
        });
      }
    }
    allDrainage.push(...localDrainage);
    if (firstTop) {
      firstTop.edges = outlineEdges;
      firstTop.drainageEdges = localDrainage;
    }
  });

  return faces;
}

// Вертикальные полосы разбивают даже многоугольник с внутренними кольцами
// на выпуклые трапеции и треугольники. Используется лишь при косом резаке.
export function convexStrips(polygon) {
  const segments = polygon.flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })));
  const xs = [...new Set(segments.map(({ a }) => a.x))].sort((a, b) => a - b);
  const yAt = ({ a, b }, x) => a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
  const strips = [];
  for (let i = 1; i < xs.length; i += 1) {
    const lo = xs[i - 1]; const hi = xs[i];
    const mid = (lo + hi) / 2;
    const crossings = segments.filter(({ a, b }) => mid > Math.min(a.x, b.x) && mid < Math.max(a.x, b.x))
      .sort((a, b) => yAt(a, mid) - yAt(b, mid));
    for (let j = 1; j < crossings.length; j += 2) {
      const top = crossings[j - 1]; const bottom = crossings[j];
      strips.push(cleanPoly([{ x: lo, y: yAt(top, lo) }, { x: hi, y: yAt(top, hi) },
        { x: hi, y: yAt(bottom, hi) }, { x: lo, y: yAt(bottom, lo) }]));
    }
  }
  return strips;
}

// По окончательному наружному контуру вырезаем верхние объёмы и косые
// ручные крыши, сохраняя плоскость исходного ската и толщину подшивки.
export function clipLinkedRoofFaces(faces, region) {
  const boundary = region.outline.flatMap((polygon) => polygon.flatMap((ring) =>
    ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }))));
  const result = [];
  for (const face of faces.filter((f) => f.roofSurface === 'top')) {
    const clipped = intersection(face.pts, region.outline);
    const { x, y, z } = face.pts[0];
    const normal = face.normal;
    const lift = (p) => ({ ...p, z: z - ((p.x - x) * normal.x + (p.y - y) * normal.y) / normal.z });
    const down = (p) => ({ ...p, z: p.z - region.thickness });
    for (const polygon of clipped) {
      for (const strip of convexStrips(polygon)) {
        const pts = strip.map(lift);
        const bottomPts = pts.map(down);
        result.push({ ...face, pts, edges: [], bottomPts },
          { ...face, kind: 'roof-soffit', roofSurface: 'bottom', pts: bottomPts.slice().reverse(),
            normal: { x: -normal.x, y: -normal.y, z: -normal.z }, edges: [] });
      }
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i += 1) {
          const a = lift(ring[i]); const b = lift(ring[(i + 1) % ring.length]);
          // Внутренние границы полос и соседних скатов не являются торцами.
          if (!boundary.some((edge) => distanceToSegment(a, edge) < 0.75 && distanceToSegment(b, edge) < 0.75)) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          if (length < EPS) continue;
          const c = down(a); const d = down(b);
          result.push({ kind: 'roof', color: face.color, roofSurface: 'edge',
            roofType: region.roofType, pitchDeg: region.pitchDeg, level: region.levelId,
            roofId: region.id, autoRoofId: region.id, roofSource: 'linked', roofThickness: region.thickness,
            normal: { x: (b.y - a.y) / length, y: -(b.x - a.x) / length, z: 0 },
            pts: [a, c, d, b], edges: [[a, b], [c, d], [a, c]] });
        }
      }
    }
  }
  return result;
}

// На стыке с верхней стеной или ручной крышей наружного желоба нет.
// Длинный прямолинейный карниз может быть занят лишь на части своей длины.
export function freeDrainageEdges(edges, { blocked, oblique, outline }) {
  if (!blocked.length && !oblique.length) return edges;
  const result = [];
  for (const edge of edges) {
    const { a, b, normal } = edge;
    const axis = Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? 'x' : 'y';
    const cross = axis === 'x' ? 'y' : 'x';
    const line = a[cross] + normal[cross] * 0.1;
    const stops = [a[axis], b[axis]];
    const lo = Math.min(...stops); const hi = Math.max(...stops);
    const intervals = blocked.filter((r) => line > r[cross + '0'] && line < r[cross + '1'] &&
      hi > r[axis + '0'] && lo < r[axis + '1']);
    for (const rect of intervals) stops.push(rect[axis + '0'], rect[axis + '1']);
    const inside = a[cross] - normal[cross] * 0.1;
    const addCrossings = (ring, atLine) => {
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        if ((p[cross] > atLine) === (q[cross] > atLine)) return;
        stops.push(p[axis] + (q[axis] - p[axis]) * (atLine - p[cross]) / (q[cross] - p[cross]));
      });
    };
    for (const ring of oblique) addCrossings(ring, line);
    for (const polygon of outline) for (const ring of polygon) addCrossings(ring, inside);
    const coords = [...new Set(stops.filter((v) => v >= lo && v <= hi))].sort((p, q) => p - q);
    const at = (v) => ({ ...a, [axis]: v, z: a.z + (b.z - a.z) * (v - a[axis]) / (b[axis] - a[axis]) });
    for (let i = 1; i < coords.length; i += 1) {
      const mid = (coords[i - 1] + coords[i]) / 2;
      if (intervals.some((r) => mid > r[axis + '0'] && mid < r[axis + '1'])) continue;
      if (!pointInPolygon(outline, { [axis]: mid, [cross]: inside }, 0) ||
          oblique.some((ring) => pointInPolygon(ring, { [axis]: mid, [cross]: line }, 0))) continue;
      result.push({ ...edge, a: at(coords[i - 1]), b: at(coords[i]) });
    }
  }
  return result;
}

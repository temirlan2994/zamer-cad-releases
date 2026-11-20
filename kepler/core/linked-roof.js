// Pure geometry for the linked (derived) roof. The input is the same compact
// orthogonal grid used by core/mesh3d.js: { xs, ys, nx, ny, mask }.
//
// z/baseZ is the underside of the roof at an eave. Thickness is vertical: the
// soffit follows the top surface at a constant Z offset. This keeps the result
// deterministic for elevations/sections and preserves the old flat-slab
// meaning of roof thickness.

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

    const outlineEdges = [];
    for (const edge of boundaries) {
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

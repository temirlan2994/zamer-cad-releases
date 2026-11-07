// Булевы операции над полигонами с дырками под любым углом (ядро v7).
// Чистый модуль без DOM и без зависимостей.
//
// Представление (мм, ось Y вниз — для алгоритма безразлично):
//   Ring         = [{x, y}, ...]           — без повтора первой точки;
//   Polygon      = [outer, hole1, ...];
//   MultiPolygon = [Polygon, ...].
// На вход годится любой из трёх видов; на выход — всегда MultiPolygon:
// внешние контуры с положительной площадью по формуле шнурования
// (Σ x_i·y_{i+1} − x_{i+1}·y_i > 0), дыры — с отрицательной, коллинеарные
// точки слиты, порядок канонический (детерминированный результат).
//
// Алгоритм — «разбиение рёбер + классификация»:
//  1. Координаты округляются до 0,5 мм и дальше живут целыми числами
//     (единица = 0,5 мм): все предикаты (ориентация, «точка на отрезке»)
//     точные.
//  2. Все рёбра всех входов режутся друг о друга (пересечения, касания,
//     совпадающие участки). Точка пересечения округляется до сетки, проход
//     повторяется, пока новых разрезов нет (snap rounding без «горячих
//     пикселей» — для чертежей домов этого достаточно).
//  3. Совпадающие под-рёбра сливаются, у каждого — вектор вкладов в
//     число оборотов по каждому входу.
//  4. Для каждого под-ребра число оборотов слева считается лучом от
//     символически сдвинутой точки (середина + ε·нормаль + ε²·g) — без
//     эпсилонов в данных, вырожденные случаи (касания, общие рёбра, нулевая
//     площадь) решаются точно. Справа = слева − вклад ребра.
//  5. Ребро остаётся, если предикат операции слева и справа различается;
//     оно ориентируется «результат слева» и рёбра сшиваются в контуры
//     (на узле — первый поворот по часовой от обратного направления, так
//     касающиеся в точке части остаются отдельными полигонами).
//  6. Дыры приписываются наименьшему охватывающему внешнему контуру.
// Сложность — O((n + k) log n) на разбиение и O(n · m) на классификацию
// (m — рёбра в полосе по Y): для планов домов (сотни–тысячи рёбер) — мс.

export const UNITS_PER_MM = 2;
const MAX_SNAP_PASSES = 12;
const G_X = 1;
const G_Y = Math.SQRT2; // «иррациональное» направление второго сдвига

const toInt = (v) => Math.round(v * UNITS_PER_MM);
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const sgn3 = (a, b, c) => sgn(a) || sgn(b) || sgn(c);

// ---------------------------------------------------------------- вход

export function asMulti(g) {
  if (!Array.isArray(g) || !g.length) return [];
  const f = g[0];
  if (f && typeof f.x === 'number') return [[g]];
  if (Array.isArray(f) && f.length && f[0] && typeof f[0].x === 'number') return [g];
  return g.filter((p) => Array.isArray(p) && p.length && Array.isArray(p[0]));
}

function ringInt(ring) {
  const pts = [];
  for (const p of ring) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const x = toInt(p.x); const y = toInt(p.y);
    const l = pts[pts.length - 1];
    if (l && l[0] === x && l[1] === y) continue;
    pts.push([x, y]);
  }
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
}

function area2(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

const lexLess = (ax, ay, bx, by) => ax < bx || (ax === bx && ay < by);

function mkEdge(p, q, set, nsets) {
  const c = new Array(nsets).fill(0);
  if (lexLess(q[0], q[1], p[0], p[1])) { c[set] = -1; return { ax: q[0], ay: q[1], bx: p[0], by: p[1], c }; }
  c[set] = 1;
  return { ax: p[0], ay: p[1], bx: q[0], by: q[1], c };
}

// Внешний контур — против часовой (площадь > 0), дыры — по часовой.
// orient: true — привести; false — взять ориентацию как есть (для clean).
function addSet(edges, geom, set, nsets, orient = true) {
  for (const poly of asMulti(geom)) {
    poly.forEach((ring, ri) => {
      const pts = ringInt(ring);
      if (pts.length < 3) return;
      const a = area2(pts);
      if (a === 0 && orient) return; // без ориентации (clean) «бабочка» с нулевой суммой — не пустая
      const flip = orient && Math.sign(a) !== (ri === 0 ? 1 : -1);
      for (let i = 0, n = pts.length; i < n; i += 1) {
        let p = pts[i]; let q = pts[(i + 1) % n];
        if (flip) [p, q] = [q, p];
        edges.push(mkEdge(p, q, set, nsets));
      }
    });
  }
}

// ---------------------------------------------------------------- разбиение

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

// Строго внутри отрезка (точка уже на его прямой).
function strictlyInside(e, x, y) {
  if ((x === e.ax && y === e.ay) || (x === e.bx && y === e.by)) return false;
  if (e.ax !== e.bx) return x > Math.min(e.ax, e.bx) && x < Math.max(e.ax, e.bx);
  return y > Math.min(e.ay, e.by) && y < Math.max(e.ay, e.by);
}

function addSplit(splits, i, x, y) {
  let s = splits.get(i);
  if (!s) { s = []; splits.set(i, s); }
  s.push([x, y]);
}

function testPair(edges, i, j, splits) {
  const e = edges[i]; const f = edges[j];
  const d1 = orient(e.ax, e.ay, e.bx, e.by, f.ax, f.ay);
  const d2 = orient(e.ax, e.ay, e.bx, e.by, f.bx, f.by);
  if (d1 === 0 && d2 === 0) {
    if (strictlyInside(e, f.ax, f.ay)) addSplit(splits, i, f.ax, f.ay);
    if (strictlyInside(e, f.bx, f.by)) addSplit(splits, i, f.bx, f.by);
    if (strictlyInside(f, e.ax, e.ay)) addSplit(splits, j, e.ax, e.ay);
    if (strictlyInside(f, e.bx, e.by)) addSplit(splits, j, e.bx, e.by);
    return;
  }
  const d3 = orient(f.ax, f.ay, f.bx, f.by, e.ax, e.ay);
  const d4 = orient(f.ax, f.ay, f.bx, f.by, e.bx, e.by);
  if (d1 === 0 && strictlyInside(e, f.ax, f.ay)) addSplit(splits, i, f.ax, f.ay);
  if (d2 === 0 && strictlyInside(e, f.bx, f.by)) addSplit(splits, i, f.bx, f.by);
  if (d3 === 0 && strictlyInside(f, e.ax, e.ay)) addSplit(splits, j, e.ax, e.ay);
  if (d4 === 0 && strictlyInside(f, e.bx, e.by)) addSplit(splits, j, e.bx, e.by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const ex = e.bx - e.ax; const ey = e.by - e.ay;
    const fx = f.bx - f.ax; const fy = f.by - f.ay;
    const den = ex * fy - ey * fx;
    const t = ((f.ax - e.ax) * fy - (f.ay - e.ay) * fx) / den;
    const x = Math.round(e.ax + ex * t); const y = Math.round(e.ay + ey * t);
    if (!((x === e.ax && y === e.ay) || (x === e.bx && y === e.by))) addSplit(splits, i, x, y);
    if (!((x === f.ax && y === f.ay) || (x === f.bx && y === f.by))) addSplit(splits, j, x, y);
  }
}

function findSplits(edges) {
  const order = edges.map((_, i) => i).sort((a, b) => edges[a].ax - edges[b].ax);
  const splits = new Map();
  let active = [];
  for (const i of order) {
    const e = edges[i];
    const eMinY = Math.min(e.ay, e.by); const eMaxY = Math.max(e.ay, e.by);
    const next = [];
    for (const j of active) {
      const f = edges[j];
      if (f.bx < e.ax) continue; // ушло из полосы
      next.push(j);
      if (Math.max(f.ay, f.by) < eMinY || Math.min(f.ay, f.by) > eMaxY) continue;
      testPair(edges, i, j, splits);
    }
    next.push(i);
    active = next;
  }
  return splits;
}

function applySplits(edges, splits) {
  const out = [];
  edges.forEach((e, i) => {
    const s = splits.get(i);
    if (!s) { out.push(e); return; }
    const pts = [[e.ax, e.ay], ...s, [e.bx, e.by]];
    pts.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
    for (let k = 0; k + 1 < pts.length; k += 1) {
      const p = pts[k]; const q = pts[k + 1];
      if (p[0] === q[0] && p[1] === q[1]) continue;
      out.push({ ax: p[0], ay: p[1], bx: q[0], by: q[1], c: e.c });
    }
  });
  return out;
}

function mergeDup(edges) {
  const map = new Map();
  for (const e of edges) {
    const key = `${e.ax},${e.ay},${e.bx},${e.by}`;
    const m = map.get(key);
    if (!m) { map.set(key, { ...e, c: e.c.slice() }); continue; }
    for (let k = 0; k < e.c.length; k += 1) m.c[k] += e.c[k];
  }
  return [...map.values()].filter((e) => e.c.some((v) => v !== 0));
}

function arrange(edges) {
  for (let pass = 0; pass < MAX_SNAP_PASSES; pass += 1) {
    const splits = findSplits(edges);
    if (!splits.size) break;
    edges = applySplits(edges, splits);
  }
  return mergeDup(edges);
}

// ---------------------------------------------------------------- классификация

// Полосы по Y для луча: ребро — во всех полосах своего диапазона Y.
function yIndex(edges) {
  let y0 = Infinity; let y1 = -Infinity;
  for (const e of edges) { y0 = Math.min(y0, e.ay, e.by); y1 = Math.max(y1, e.ay, e.by); }
  const n = Math.max(1, Math.min(512, Math.ceil(edges.length / 4)));
  const h = Math.max(1, (y1 - y0) / n);
  const band = (y) => Math.min(n - 1, Math.max(0, Math.floor((y - y0) / h)));
  const bands = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const b0 = band(Math.min(e.ay, e.by)); const b1 = band(Math.max(e.ay, e.by));
    for (let b = b0; b <= b1; b += 1) bands[b].push(e);
  }
  return { bands, band };
}

// Число оборотов в символической точке P = M + ε·n + ε²·g, где M —
// середина (mx2, my2 — удвоенные координаты), n — нормаль. Рёбра —
// направленные a→b с вкладом c (массив по наборам) или числом.
function windingAt(cands, mx2, my2, nx, ny, out) {
  for (const f of cands) {
    const ya = sgn3(my2 - 2 * f.ay, ny, G_Y);
    const yb = sgn3(my2 - 2 * f.by, ny, G_Y);
    if (ya === yb) continue;
    const fx = f.bx - f.ax; const fy = f.by - f.ay;
    const s = sgn3(fx * (my2 - 2 * f.ay) - fy * (mx2 - 2 * f.ax), fx * ny - fy * nx, fx * G_Y - fy * G_X);
    let k = 0;
    if (ya > 0 && yb < 0) { if (s > 0) k = 1; } else if (s < 0) k = -1;
    if (!k) continue;
    if (typeof f.c === 'number') out[0] += k * f.c;
    else for (let i = 0; i < out.length; i += 1) out[i] += k * f.c[i];
  }
  return out;
}

// Левая нормаль (в смысле «площадь > 0 — внутренность слева»).
const leftN = (e) => [-(e.by - e.ay), e.bx - e.ax];

function classify(edges, nsets, pred) {
  if (!edges.length) return [];
  const idx = yIndex(edges);
  const wl = new Array(nsets);
  const wr = new Array(nsets);
  const out = [];
  for (const e of edges) {
    const mx2 = e.ax + e.bx; const my2 = e.ay + e.by;
    const [nx, ny] = leftN(e);
    wl.fill(0);
    windingAt(idx.bands[idx.band(my2 / 2)], mx2, my2, nx, ny, wl);
    for (let k = 0; k < nsets; k += 1) wr[k] = wl[k] - e.c[k];
    const inL = pred(wl); const inR = pred(wr);
    if (inL === inR) continue;
    out.push(inL ? [[e.ax, e.ay], [e.bx, e.by]] : [[e.bx, e.by], [e.ax, e.ay]]);
  }
  return out;
}

// ---------------------------------------------------------------- сшивка контуров

const pkey = (p) => `${p[0]},${p[1]}`;
const TAU = Math.PI * 2;

function linkRings(dedges) {
  const byStart = new Map();
  dedges.forEach((d, i) => {
    const k = pkey(d[0]);
    const l = byStart.get(k);
    if (l) l.push(i); else byStart.set(k, [i]);
  });
  const used = new Uint8Array(dedges.length);
  const rings = [];
  for (let i = 0; i < dedges.length; i += 1) {
    if (used[i]) continue;
    const ring = [];
    let e = i;
    let ok = false;
    for (let guard = 0; guard <= dedges.length; guard += 1) {
      used[e] = 1;
      ring.push(dedges[e][0]);
      const [from, v] = dedges[e];
      const cands = (byStart.get(pkey(v)) || []).filter((j) => !used[j] || j === i);
      if (!cands.length) break;
      let best = -1; let bestD = Infinity;
      const r = Math.atan2(from[1] - v[1], from[0] - v[0]);
      for (const j of cands) {
        const to = dedges[j][1];
        let d = r - Math.atan2(to[1] - v[1], to[0] - v[0]);
        while (d <= 0) d += TAU;
        while (d > TAU) d -= TAU;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best === i) { ok = true; break; }
      e = best;
    }
    if (ok && ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function simplifyInt(pts) {
  let ring = pts.slice();
  let changed = true;
  while (changed && ring.length >= 3) {
    changed = false;
    const next = [];
    for (let i = 0, n = ring.length; i < n; i += 1) {
      const a = next.length ? next[next.length - 1] : ring[(i - 1 + n) % n];
      const b = ring[i]; const c = ring[(i + 1) % n];
      if ((a[0] === b[0] && a[1] === b[1]) || orient(a[0], a[1], b[0], b[1], c[0], c[1]) === 0) { changed = true; continue; }
      next.push(b);
    }
    ring = next;
  }
  return ring.length >= 3 ? ring : [];
}

// Направленные рёбра контура для windingAt (вклад 1).
const ringEdges = (pts) => pts.map((p, i) => {
  const q = pts[(i + 1) % pts.length];
  return { ax: p[0], ay: p[1], bx: q[0], by: q[1], c: 1 };
});

function ringBox(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

function assemble(rings) {
  const outers = []; const holes = [];
  for (const raw of rings) {
    const pts = simplifyInt(raw);
    if (!pts.length) continue;
    const a = area2(pts);
    if (a > 0) outers.push({ pts, a, box: ringBox(pts), edges: ringEdges(pts), holes: [] });
    else if (a < 0) holes.push(pts);
  }
  for (const h of holes) {
    const [p, q] = [h[0], h[1]];
    const mx2 = p[0] + q[0]; const my2 = p[1] + q[1];
    const nx = -(q[1] - p[1]); const ny = q[0] - p[0];
    let best = null;
    for (const o of outers) {
      if (mx2 / 2 < o.box.x0 || mx2 / 2 > o.box.x1 || my2 / 2 < o.box.y0 || my2 / 2 > o.box.y1) continue;
      const w = windingAt(o.edges, mx2, my2, nx, ny, [0]);
      if (w[0] !== 0 && (!best || o.a < best.a)) best = o;
    }
    if (best) best.holes.push(h);
  }
  return outers.map((o) => [o.pts, ...o.holes]);
}

// ---------------------------------------------------------------- выход

function canonRing(pts) {
  let k = 0;
  for (let i = 1; i < pts.length; i += 1) if (lexLess(pts[i][0], pts[i][1], pts[k][0], pts[k][1])) k = i;
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[(k + i) % pts.length];
    out.push({ x: p[0] / UNITS_PER_MM, y: p[1] / UNITS_PER_MM });
  }
  return out;
}

const cmpRing = (a, b) => (a[0].x - b[0].x) || (a[0].y - b[0].y) || (a.length - b.length);

function output(polys) {
  const res = polys.map((poly) => {
    const outer = canonRing(poly[0]);
    const holes = poly.slice(1).map(canonRing).sort(cmpRing);
    return [outer, ...holes];
  });
  return res.sort((a, b) => cmpRing(a[0], b[0]));
}

// ---------------------------------------------------------------- API

// Общий оверлей: sets — входы, pred(windings[]) → лежит ли точка в результате.
// orient=false — ориентация контуров берётся как есть (clean самопересечений).
export function overlay(sets, pred, { orient: doOrient = true } = {}) {
  const edges = [];
  sets.forEach((g, i) => addSet(edges, g, i, sets.length, doOrient));
  if (!edges.length) return [];
  const arranged = arrange(edges);
  return output(assemble(linkRings(classify(arranged, sets.length, pred))));
}

export function union(...geoms) {
  const all = [];
  for (const g of geoms) all.push(...asMulti(g));
  return overlay([all], (w) => w[0] > 0);
}

export function intersection(a, b) {
  if (!boxesTouch(a, b)) return [];
  return overlay([a, b], (w) => w[0] > 0 && w[1] > 0);
}

export function difference(a, ...bs) {
  const cut = [];
  for (const g of bs) cut.push(...asMulti(g));
  if (!cut.length || !boxesTouch(a, cut)) return union(a);
  return overlay([a, cut], (w) => w[0] > 0 && !(w[1] > 0));
}

export function xor(a, b) {
  return overlay([a, b], (w) => (w[0] > 0) !== (w[1] > 0));
}

// Починка «грязного» полигона: самопересечения, произвольная ориентация,
// повторы точек → корректный MultiPolygon (правило ненулевого числа оборотов).
export function clean(g) {
  return overlay([g], (w) => w[0] !== 0, { orient: false });
}

function geomBox(g) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const poly of asMulti(g)) {
    for (const p of poly[0] || []) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  }
  return { x0, y0, x1, y1 };
}

function boxesTouch(a, b) {
  const p = geomBox(a); const q = geomBox(b);
  return p.x0 <= q.x1 && q.x0 <= p.x1 && p.y0 <= q.y1 && q.y0 <= p.y1;
}

// Разрез участка по линии (без DOM): профиль земли по рельефу, сечения и
// проекции объектов ландшафта и дома — список примитивов в плоскости
// разреза. Отрисовка (SVG, «Эскиз»/«Чертёж») — ui/landscape-section-svg.js,
// DXF — buildSectionDxf ниже.
//
// Плоскость разреза: x — по развёрнутой линии разреза слева направо (как
// видит наблюдатель, смотрящий в сторону side), z — вверх, мм от нуля
// участка (пол 1 этажа = 0, как в 3D: рельеф — относительно site.terrain.floorZ
// или средней отметки под домом). На плане ось Y вниз; «left» — слева по ходу
// линии, нормаль (u.y, −u.x).
//
// Примитив: { id, kind, title, cat, cut, depth, shape: 'poly' | 'plant',
//   pts: [{x, z}] (poly), plant: { x, z, w, h, look } (plant),
//   mat, color, label?, at? }. cut — объект в сечении, depth — расстояние от
// плоскости разреза, мм (дальние рисуются бледнее).

import { LOUNGE_COLORS, loungeParts } from './landscape-lounge.js';
import { rectCornersWorld, toLocal as buildingLocal, toWorld as buildingWorld } from './building.js';
import { facadeParts } from './facade.js';
import { floorSlabFaces, linkedRoofFaces, roofFaces } from './mesh3d.js';
import { faceLineSegments } from './section.js';
import { clipFace } from './geom/clip.js';
import { wallZRange } from './wall-z-range.js';
import { massBox } from './masses.js';
import {
  LS_COLORS, PLATFORM_KINDS, curbLines, elevOf, fmtElev, insetPolygon, landscapeDef, lineLayout, loungeEntranceLevel, objectColors, objectOutline, platformTop,
  gradedPathLevel, isGradedPath, isLevelPath, objectPath, pathSurfaceThickness, planterInner, retainingEdges, retainingInfo, ribbonOutline, seededRandom, stairTreads, stairsInfo, steppingSlabs, toWorld,
  variantOf, SECTION_DEPTH,
} from './landscape.js';
import { levelProject, sortedLevels } from './model.js';
import { levelWindowOpenings } from './spanning-windows.js';
import { openingHeight, openingSill } from './opening-preset.js';
import { houseTerrain, interpolateZ, terrainModel } from './terrain.js';
import { deriveWalls, openingRect } from './walls.js';
import { buildDxf } from './zamer/dxf.js';
import { pointInPolygon } from './zamer/geometry.js';
import { envelopeOf, resolvedZeroAboveGround } from './envelope.js';

export const SECTION_DXF_LAYER = { key: 'lsSection', name: 'LANDSCAPE_SECTION', color: 1 };

// Порядок рисования при равной глубине: засыпки → вода → покрытия → конструкции → дом → прочее → растения.
const CAT_ORDER = { fill: 0, water: 1, cover: 2, built: 3, house: 4, object: 5, plant: 6 };

// ------------------------------------------------------------ Линия разреза

// Отрезки ломаной: { a, u (орт), len, s0 (расстояние от начала) }.
export function sectionFrame(points) {
  const segs = [];
  let s = 0;
  for (let i = 0; i < (points?.length || 0) - 1; i += 1) {
    const a = points[i]; const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    segs.push({ a, b, u: { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, len, s0: s });
    s += len;
  }
  return { segs, length: s };
}

// Точка мира → { s (вдоль линии; за концами — < 0 или > длины), d (смещение:
// > 0 — слева по ходу) }. Ближайший отрезок.
export function stationOf(frame, p) {
  let best = null;
  const last = frame.segs.length - 1;
  frame.segs.forEach((g, i) => {
    const t = (p.x - g.a.x) * g.u.x + (p.y - g.a.y) * g.u.y;
    let tc = Math.max(0, Math.min(g.len, t));
    const foot = { x: g.a.x + g.u.x * tc, y: g.a.y + g.u.y * tc };
    const dist = Math.hypot(p.x - foot.x, p.y - foot.y);
    if ((i === 0 && t < 0) || (i === last && t > g.len)) tc = t; // за концом — продолжение прямой
    const d = (p.x - g.a.x) * g.u.y - (p.y - g.a.y) * g.u.x;
    if (!best || dist < best.dist - 1e-6) best = { s: g.s0 + tc, d, dist, seg: i };
  });
  return best || { s: 0, d: 0, dist: 0, seg: -1 };
}

// Точка мира на расстоянии s вдоль линии и орт направления там.
export function pointAtStation(frame, s) {
  const segs = frame.segs;
  if (!segs.length) return { x: 0, y: 0, u: { x: 1, y: 0 } };
  let g = segs[segs.length - 1];
  for (const seg of segs) if (s <= seg.s0 + seg.len) { g = seg; break; }
  const t = Math.max(0, Math.min(g.len, s - g.s0));
  return { x: g.a.x + g.u.x * t, y: g.a.y + g.u.y * t, u: g.u };
}

// Участки линии внутри многоугольника: [[s0, s1], …] по возрастанию.
export function cutIntervals(frame, poly) {
  if (!poly || poly.length < 3) return [];
  const out = [];
  const n = poly.length;
  for (const g of frame.segs) {
    const rx = g.u.x * g.len; const ry = g.u.y * g.len;
    const ts = [0, 1];
    for (let i = 0; i < n; i += 1) {
      const c = poly[i]; const d = poly[(i + 1) % n];
      const qx = d.x - c.x; const qy = d.y - c.y;
      const den = rx * qy - ry * qx;
      if (Math.abs(den) < 1e-9) continue;
      const wx = c.x - g.a.x; const wy = c.y - g.a.y;
      const t = (wx * qy - wy * qx) / den;
      const v = (wx * ry - wy * rx) / den;
      if (t > 0 && t < 1 && v >= -1e-9 && v <= 1 + 1e-9) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i += 1) {
      const t0 = ts[i]; const t1 = ts[i + 1];
      if ((t1 - t0) * g.len < 1) continue;
      const tm = (t0 + t1) / 2;
      if (pointInPolygon({ x: g.a.x + rx * tm, y: g.a.y + ry * tm }, poly)) out.push([g.s0 + t0 * g.len, g.s0 + t1 * g.len]);
    }
  }
  return mergeIntervals(out);
}

function mergeIntervals(list, gap = 1) {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + gap) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

// a минус b (списки интервалов).
function subtractIntervals(a, b) {
  let rest = a.map((iv) => [...iv]);
  for (const [c0, c1] of b) {
    const next = [];
    for (const [a0, a1] of rest) {
      if (c1 <= a0 || c0 >= a1) { next.push([a0, a1]); continue; }
      if (c0 > a0) next.push([a0, c0]);
      if (c1 < a1) next.push([c1, a1]);
    }
    rest = next;
  }
  return rest.filter(([x0, x1]) => x1 - x0 >= 1);
}

// ------------------------------------------------------------ Рельеф

// Отметка земли (мм от нуля) в точке мира; без рельефа — 0.
export function groundFn(project) {
  const model = terrainModel(project.site?.terrain);
  if (!model?.tris?.length) {
    const zero = resolvedZeroAboveGround(project);
    const fn = () => (zero == null ? 0 : -zero);
    fn.siteDatum = fn();
    fn.flat = true;
    return fn;
  }
  const house = houseTerrain(project, model);
  const avg = model.pts.reduce((t, p) => t + p.z, 0) / model.pts.length;
  const floorZ = house ? house.floorZ : (Number.isFinite(project.site.terrain.floorZ) ? project.site.terrain.floorZ : avg);
  const relativeDatum = project.envelope?.zeroAboveGround != null;
  const zero = relativeDatum ? resolvedZeroAboveGround(project, house) : null;
  const reference = house?.groundReferenceZ ?? avg;
  const fn = (x, y) => {
    const z = interpolateZ(model, x, y, { clamp: true });
    return relativeDatum ? (z ?? reference) - reference - zero : (z ?? floorZ) - floorZ;
  };
  fn.siteDatum = relativeDatum ? -zero : reference - floorZ;
  fn.flat = false;
  return fn;
}

// ------------------------------------------------------------ Профиль

const isPlantDef = (def) => def.cat === 'green' && def.shape !== 'poly'
  && (def.group === 'Деревья' || (def.group === 'Кустарники' && def.look !== 'hedge') || ['grass-clump', 'flowers-clump', 'boulder'].includes(def.kind));

// Вид растения — по варианту, где вариант и есть вид (сосна обыкновенная, яблоня…).
const SPECIES_KINDS = new Set(['tree-pine', 'tree-spruce', 'tree-oak', 'tree-fruit', 'tree-thuja', 'shrub-box', 'shrub-flower', 'grass-clump']);
function titleOf(o, def) {
  if (SPECIES_KINDS.has(def.kind) && def.variants.length > 1) return variantOf(o, def)?.title || def.title;
  return def.title;
}

// Покрытие: материал и толщина слоя (мм) — по виду и варианту.
function coverSpec(o, def) {
  const v = o.variant;
  if (def.kind === 'lawn-area' || def.kind === 'lawn-patch' || def.kind === 'parking-guest') return { mat: 'lawn', t: 40 };
  if (def.kind === 'board') return { mat: 'wood', t: 40 };
  if (def.kind === 'slab') return { mat: 'stone', t: 50 };
  if (def.kind === 'gravel-area' || v === 'gravel') return { mat: 'gravel', t: 80 };
  if (def.kind === 'deck-area' || def.kind === 'terrace-deck' || v === 'deck') return { mat: 'wood', t: Math.max(120, Math.min(600, o.height || 0)) };
  if (def.kind === 'playground') return { mat: v === 'sand' ? 'sand' : 'rubber', t: 60 };
  if (v === 'asphalt' || def.kind === 'parking-1') return { mat: 'asphalt', t: 60 };
  if (v === 'concrete') return { mat: 'concrete', t: 100 };
  return { mat: 'tiles', t: 60 };
}

const DECK_BOARDS = 180; // доска + лага, мм
const DECK_KINDS = new Set(['deck-area', 'terrace-deck']);
const WATER = { pool: 1500, 'pool-area': 1500, pond: 700, 'pond-area': 700 };
const SHELTER_LOOKS = new Set(['gazebo', 'pergola', 'carport', 'greenhouse']);
const FENCE_LOOKS = new Set(['fence', 'fence-line', 'gate']);

const MAT_BY_VARIANT = { concrete: 'concrete', stone: 'stone', graphite: 'stone', corten: 'metal', wood: 'wood', gabion: 'stone', metal: 'metal' };

// Профиль разреза. line — { points, side?, depth?, name? } или массив точек.
// side — 'left' | 'right' (куда смотрим по ходу линии), opts.depth — глубина
// вида, мм. Возвращает { length, side, flip, name, ground: [{x,z}], prims,
// marks: [{x, z, text, kind}], box: {x0, x1, z0, z1} } или null (короткая линия).
export function sectionProfile(project, line, side, opts = {}) {
  const points = Array.isArray(line) ? line : line?.points;
  const frame = sectionFrame(points || []);
  if (frame.length < 100) return null;
  const sideId = (side ?? line?.side) === 'right' ? 'right' : 'left';
  const sign = sideId === 'left' ? 1 : -1;
  const maxDepth = Math.max(500, Number(opts.depth ?? line?.depth) || SECTION_DEPTH);
  const L = frame.length;
  const flip = sideId === 'right'; // смотрим вправо — правая рука наблюдателя против хода линии
  const X = (s) => (flip ? L - s : s);
  const zg = opts.ground ?? groundFn(project);
  const groundAtS = (s) => { const p = pointAtStation(frame, s); return zg(p.x, p.y); };
  const steps = (a, b) => (zg.flat ? 1 : Math.max(1, Math.ceil((b - a) / 300)));

  // Полоса над участком [sa, sb]: низ и верх — функции s.
  const band = (sa, sb, bot, top, dense = false) => {
    const n = dense ? Math.max(steps(sa, sb), Math.ceil((sb - sa) / 150)) : steps(sa, sb);
    const lo = []; const hi = [];
    for (let i = 0; i <= n; i += 1) {
      const s = sa + ((sb - sa) * i) / n;
      lo.push({ x: X(s), z: bot(s) });
      hi.push({ x: X(s), z: top(s) });
    }
    return [...lo, ...hi.reverse()];
  };
  const rect = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  const clipS = ([a, b]) => [Math.max(0, a), Math.min(L, b)];

  // Проекция многоугольника: диапазон s и ближайшая глубина (или null).
  const projected = (poly) => {
    let s0 = Infinity; let s1 = -Infinity; let dMin = Infinity; let dMax = -Infinity;
    for (const p of poly) {
      const st = stationOf(frame, p);
      const dd = st.d * sign;
      s0 = Math.min(s0, st.s); s1 = Math.max(s1, st.s);
      dMin = Math.min(dMin, dd); dMax = Math.max(dMax, dd);
    }
    if (dMax < 0 || dMin > maxDepth) return null;
    const [a, b] = clipS([s0, s1]);
    if (b - a < 1) return null;
    return { s0: a, s1: b, depth: Math.max(0, dMin) };
  };

  const prims = [];
  const marks = [];
  const excavations = [];
  const platforms = [];
  const add = (p) => { prims.push(p); return p; };
  // На ровном участке «±0.00» у земли не ставим — только у пола дома.
  const mark = (s, z, text, kind = 'elev') => { if (zg.flat && Math.round(z) === 0 && kind !== 'floor') return; if (s >= -1 && s <= L + 1) marks.push({ x: X(Math.max(0, Math.min(L, s))), z, text, kind }); };

  // Тело объекта по контуру: в сечении — полосы по участкам линии (по
  // рельефу), иначе — проекция прямоугольником на отметке центра.
  // z0, z1 — над основанием base(s).
  const body = (o, poly, z0, z1, base, info, { cuts = null, projectedToo = true } = {}) => {
    const iv = cuts ?? cutIntervals(frame, poly);
    if (iv.length) {
      for (const seg of iv) {
        const [a, b] = clipS(seg);
        if (b - a < 1) continue;
        add({ ...info, cut: true, depth: 0, shape: 'poly', pts: band(a, b, (s) => base(s) + z0, (s) => base(s) + z1), s0: a, s1: b });
      }
      return iv;
    }
    if (!projectedToo) return iv;
    const pr = projected(poly);
    if (!pr) return iv;
    const bz = base((pr.s0 + pr.s1) / 2, o);
    add({ ...info, cut: false, depth: pr.depth, shape: 'poly', pts: rect(X(pr.s0), X(pr.s1), bz + z0, bz + z1), s0: pr.s0, s1: pr.s1 });
    return iv;
  };

  const objects = project.site?.landscape?.objects || [];
  const byId = new Map(objects.map((o) => [o.id, o]));
  const liftOf = (o) => {
    const p = o.parent ? byId.get(o.parent) : null;
    return p ? Math.max(0, (p.height || 0) - 60) + elevOf(p) : 0;
  };

  for (const o of objects) {
    const def = landscapeDef(o.kind);
    if (!def || def.shape === 'note') continue;
    const C = objectColors(o, def);
    const elev = elevOf(o);
    const lift = liftOf(o);
    const h = Math.max(0, o.height ?? def.height ?? 0);
    const look = def.look;
    // Основание: земля по линии (в сечении) или под центром объекта (в проекции).
    const center = { x: o.x, y: o.y };
    const deck = DECK_KINDS.has(o.kind);
    const levelPath = isLevelPath(o);
    const graded = isGradedPath(o);
    const fixed = ((PLATFORM_KINDS.has(o.kind) || o.kind === 'stairs-out') && Number.isFinite(o.elev)) || (PLATFORM_KINDS.has(o.kind) && o.height > 0) || o.kind === 'sunken-lounge';
    const siteDatum = zg.siteDatum ?? 0;
    const top = levelPath ? siteDatum + elev : fixed ? siteDatum + platformTop(o, zg(center.x, center.y) - siteDatum) : 0;
    const path = graded ? objectPath(o) : null;
    const baseCut = (s) => {
      if (graded) {
        const point = pointAtStation(frame, s);
        return siteDatum + gradedPathLevel(o, point.x, point.y, path);
      }
      return fixed || levelPath ? top : groundAtS(s) + elev + lift;
    };
    const baseProj = () => fixed || levelPath ? top : zg(center.x, center.y) + elev + lift;
    const base = (s, proj) => proj ? baseProj() : baseCut(s);
    const info = { id: o.id, kind: o.kind, title: titleOf(o, def), color: C[0], color2: C[1] || C[0], look };
    if (fixed && (Number.isFinite(o.elev) || o.kind === 'sunken-lounge')) {
      for (const [a, b] of cutIntervals(frame, objectOutline(o, 16))) {
        if (top < Math.max(groundAtS(a), groundAtS(b), groundAtS((a + b) / 2))) excavations.push({ a, b, top });
      }
    }

    if (o.kind === 'sunken-lounge') {
      const upper = loungeEntranceLevel(o, objects, (p) => zg(p.x, p.y) - siteDatum);
      const drop = Math.max(0, upper + siteDatum - top);
      body(o, objectOutline(o, 48), -100, 0, base, { ...info, cat: 'cover', mat: 'stone' });
      for (const part of loungeParts(o, drop)) {
        body(o, part.poly, part.bottom, part.top, base, { ...info, title: '', cat: 'built',
          mat: part.material === 'base' ? 'wood' : 'stone', color: LOUNGE_COLORS[part.material] }, { projectedToo: false });
      }
      continue;
    }

    // --- Растения: силуэты.
    if (isPlantDef(def)) {
      const st = stationOf(frame, center);
      const dd = st.d * sign;
      const rot = ((o.rotation || 0) * Math.PI) / 180;
      const u = pointAtStation(frame, Math.max(0, Math.min(L, st.s))).u;
      const ang = Math.atan2(u.y, u.x) - rot;
      const half = Math.sqrt(((o.w / 2) * Math.cos(ang)) ** 2 + (((o.h || o.w) / 2) * Math.sin(ang)) ** 2);
      const across = Math.sqrt(((o.w / 2) * Math.sin(ang)) ** 2 + (((o.h || o.w) / 2) * Math.cos(ang)) ** 2);
      if (dd < -across || dd > maxDepth + across) continue;
      if (st.s + half < 0 || st.s - half > L) continue;
      const z = baseProj();
      const H = def.group === 'Деревья' ? Math.max(1500, h) : Math.max(look === 'juniper' ? 150 : 250, h);
      const cut = Math.abs(st.d) <= across;
      add({ ...info, cat: 'plant', cut, depth: Math.max(0, dd), shape: 'plant', plant: { x: X(st.s), z, w: half * 2, h: H, look, seed: o.id, variant: o.variant }, s0: st.s - half, s1: st.s + half });
      continue;
    }

    // --- Подпорная стенка: тело, капа, засыпка со стороны верха.
    if (look === 'retaining') {
      const ri = retainingInfo(o);
      const mat = MAT_BY_VARIANT[o.variant] || 'concrete';
      const outline = objectOutline(o);
      const iv = body(o, outline, 0, Math.max(50, ri.height), base, { ...info, cat: 'built', mat });
      if (ri.cap) body(o, lineLayout({ ...o, width: ri.capW }).outline, ri.height, ri.height + ri.capH, base, { ...info, cat: 'built', mat: 'concrete', title: 'Капа' });
      if (iv.length) {
        // Сторона верха: нормаль к низу (план) против направления линии разреза.
        const edges = retainingEdges(o);
        const path = objectPath(o);
        const [a0, a1] = clipS(iv[0]);
        const pm = pointAtStation(frame, (a0 + a1) / 2);
        let best = null;
        for (let i = 0; i < path.length - 1; i += 1) {
          const p = path[i]; const q = path[i + 1];
          const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
          const ux = (q.x - p.x) / len; const uy = (q.y - p.y) / len;
          const t = Math.max(0, Math.min(len, (pm.x - p.x) * ux + (pm.y - p.y) * uy));
          const dist = Math.hypot(pm.x - p.x - ux * t, pm.y - p.y - uy * t);
          if (!best || dist < best.dist) best = { dist, n: { x: -uy * edges.lowSign, y: ux * edges.lowSign } };
        }
        const dot = best ? best.n.x * pm.u.x + best.n.y * pm.u.y : 0;
        const topZ = baseCut((a0 + a1) / 2) + ri.drop;
        if (Math.abs(dot) > 0.2) {
          // Верх — по ходу линии разреза, если нормаль к низу смотрит назад (dot < 0).
          const dir = dot < 0 ? 1 : -1;
          const face = dir > 0 ? a1 : a0;
          const plateau = 1500;
          const run = Math.max(300, ri.drop * 1.5);
          const far = face + dir * (plateau + run);
          const sA = Math.max(0, Math.min(L, Math.min(face, far)));
          const sB = Math.max(0, Math.min(L, Math.max(face, far)));
          if (sB - sA > 1) {
            const topAt = (s) => {
              const k = Math.abs(s - face);
              const g = groundAtS(s);
              if (k <= plateau) return Math.max(g, topZ);
              return Math.max(g, topZ - ((k - plateau) / run) * (topZ - g));
            };
            add({ id: `${o.id}:fill`, kind: 'fill', title: 'Засыпка', cat: 'fill', cut: true, depth: 0, shape: 'poly', mat: 'soil', color: LS_COLORS.soil[0], look: 'fill',
              pts: band(sA, sB, groundAtS, topAt, true), s0: sA, s1: sB });
          }
          mark(face + dir * 400, topZ, fmtElev(topZ));
        }
        mark((a0 + a1) / 2, baseCut((a0 + a1) / 2) + ri.height + (ri.cap ? ri.capH : 0), fmtElev(baseCut((a0 + a1) / 2) + ri.height + (ri.cap ? ri.capH : 0)));
        mark(dot < 0 ? a0 - 400 : a1 + 400, baseCut((a0 + a1) / 2), fmtElev(baseCut((a0 + a1) / 2)));
      }
      continue;
    }

    // --- Лестница: ступени-блоки реальной высоты.
    if (look === 'stairs') {
      const st = stairsInfo(o);
      const fw = Math.max(100, st.flight);
      const mat = MAT_BY_VARIANT[o.variant] || 'concrete';
      let any = false;
      for (const { bottom, top: yTop, z: zTop } of stairTreads(o, st)) {
        const poly = [toWorld(o, -fw / 2, yTop), toWorld(o, fw / 2, yTop), toWorld(o, fw / 2, bottom), toWorld(o, -fw / 2, bottom)];
        const iv = body(o, poly, 0, zTop, base, { ...info, cat: 'built', mat, title: zTop >= st.rise - 0.1 ? info.title : '' });
        if (iv.length) any = true;
        if (st.cheek > 0) {
          for (const sx of [-1, 1]) {
            const cx = sx * (o.w / 2 - st.cheek / 2);
            const cp = [toWorld(o, cx - st.cheek / 2, yTop), toWorld(o, cx + st.cheek / 2, yTop), toWorld(o, cx + st.cheek / 2, bottom), toWorld(o, cx - st.cheek / 2, bottom)];
            body(o, cp, 0, zTop + 150, base, { ...info, cat: 'built', mat, title: '' });
          }
        }
      }
      if (any) {
        const iv = cutIntervals(frame, objectOutline(o));
        const [a0, a1] = clipS([iv[0][0], iv[iv.length - 1][1]]);
        const top = toWorld(o, 0, -o.h / 2); const bot = toWorld(o, 0, o.h / 2);
        const sTop = stationOf(frame, top).s; const sBot = stationOf(frame, bot).s;
        const z0 = baseCut((a0 + a1) / 2);
        if (Math.abs(sTop - sBot) > 200) {
          mark(Math.max(a0, Math.min(a1, sBot)), z0, fmtElev(z0));
          mark(Math.max(a0, Math.min(a1, sTop)), z0 + st.rise, fmtElev(z0 + st.rise));
        } else mark((a0 + a1) / 2, z0 + st.rise, fmtElev(z0 + st.rise));
      }
      continue;
    }

    // --- Короб: борта, засыпка.
    if (look === 'planter' || look === 'planter-area') {
      const H = Math.max(0, h);
      const outer = objectOutline(o, 32);
      const inner = planterInner(o);
      const ivO = cutIntervals(frame, outer);
      const mat = MAT_BY_VARIANT[o.variant] || 'concrete';
      const fillMat = o.meta?.fill === 'gravel' ? 'gravel' : o.meta?.fill === 'mulch' ? 'mulch' : 'soil';
      if (ivO.length) {
        const ivI = cutIntervals(frame, inner);
        body(o, outer, 0, H, base, { ...info, cat: 'built', mat }, { cuts: subtractIntervals(ivO, ivI) });
        body(o, inner, 0, Math.max(10, H - 60), base, { ...info, cat: 'fill', mat: fillMat, title: '', id: `${o.id}:fill`, color: LS_COLORS[fillMat]?.[0] || LS_COLORS.soil[0] }, { cuts: ivI });
        const [a0, a1] = clipS([ivO[0][0], ivO[ivO.length - 1][1]]);
        mark((a0 + a1) / 2, baseCut((a0 + a1) / 2) + H, fmtElev(baseCut((a0 + a1) / 2) + H));
      } else body(o, outer, 0, H, base, { ...info, cat: 'built', mat });
      continue;
    }

    // --- Бордюр (линия).
    if (look === 'curb') {
      body(o, objectOutline(o), 0, Math.max(20, h), base, { ...info, cat: 'built', mat: MAT_BY_VARIANT[o.variant] || 'concrete' });
      continue;
    }

    // --- Вода: чаша ниже земли.
    if (WATER[o.kind] != null) {
      const outline = objectOutline(o, 32);
      const full = cutIntervals(frame, outline);
      const dry = objects.filter((item) => item.kind === 'sunken-lounge').flatMap((item) => cutIntervals(frame, objectOutline(item, 48)));
      const iv = subtractIntervals(full, dry);
      const depthW = WATER[o.kind];
      const pond = o.kind.startsWith('pond');
      for (const seg of iv) {
        const [a, b] = clipS(seg);
        if (b - a < 1) continue;
        const mid = (seg[0] + seg[1]) / 2; const half = (seg[1] - seg[0]) / 2 || 1;
        const bottom = (s) => baseCut(s) - (pond ? depthW * Math.max(0.15, 1 - ((s - mid) / half) ** 2) : depthW);
        if (!pond) add({ ...info, id: `${o.id}:bowl`, cat: 'water', cut: true, depth: 0, shape: 'poly', mat: 'concrete', title: '', pts: band(a - 200 < 0 ? a : a - 200, Math.min(L, b + 200), (s) => baseCut(s) - depthW - 200, baseCut), s0: a, s1: b });
        add({ ...info, cat: 'water', cut: true, depth: 0, shape: 'poly', mat: 'water', color: LS_COLORS.water[0], pts: band(a, b, bottom, (s) => baseCut(s) - 120), s0: a, s1: b });
      }
      continue;
    }

    // --- Покрытия: площади, дорожки, площадки.
    const coverLike = def.cover && !SHELTER_LOOKS.has(look)
      && (def.shape === 'poly' || o.kind === 'path' || def.layer === 'ground' || look === 'pad' || look === 'deck');
    if (coverLike && !['flowerbed', 'vegbeds', 'sandbox', 'jacuzzi', 'firepit'].includes(look)) {
      const spec = coverSpec(o, def);
      const outline = objectOutline(o, 32);
      const iv = cutIntervals(frame, outline);
      // Настил на лагах: верх — над основанием на высоту настила.
      // С отметкой elev — это верх покрытия (как подпись на плане).
      if (PLATFORM_KINDS.has(o.kind) && !o.locked && iv.length) {
        const spans = iv.map(clipS).filter(([a, b]) => b - a >= 1);
        const widest = spans.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
        if (widest) {
          const mid = (widest[0] + widest[1]) / 2;
          const ground = zg(center.x, center.y) - siteDatum;
          platforms.push({ id: o.id, title: info.title, x: X(mid), z: baseCut(mid), ground, level: Math.round(platformTop(o, ground)) });
        }
      }
      const deckH = deck ? Math.max(0, baseProj() - zg(center.x, center.y)) : 0;
      if (o.kind === 'path' && o.variant === 'stepping') {
        for (const sl of steppingSlabs(o)) {
          const c = Math.cos(sl.angle); const sn = Math.sin(sl.angle);
          const poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ax, ay]) => ({ x: sl.x + (ax * sl.along / 2) * c - (ay * sl.across / 2) * sn, y: sl.y + (ax * sl.along / 2) * sn + (ay * sl.across / 2) * c }));
          const followsGround = o.meta?.pathLevel === 'terrain';
          const slabBase = followsGround ? () => zg(sl.x, sl.y) + elev : base;
          const thickness = pathSurfaceThickness(o);
          body(o, poly, levelPath ? -thickness : followsGround ? 0 : -10, levelPath ? 0 : followsGround ? thickness : 50,
            slabBase, { ...info, cat: 'cover', mat: 'stone' }, { projectedToo: false });
        }
      } else if (iv.length) {
        // Подиум (отметка над землёй) + слой покрытия; верх — отметка.
        for (const seg of iv) {
          const [a, b] = clipS(seg);
          if (b - a < 1) continue;
          const terrainPath = o.kind === 'path' && o.meta?.pathLevel === 'terrain';
          const thickness = levelPath || terrainPath || graded ? pathSurfaceThickness(o) : spec.t;
          const top = terrainPath ? (s) => baseCut(s) + thickness : baseCut;
          if (spec.mat === 'wood' && deckH > 60) {
            // Настил: доски сверху, под ними — лаги/опоры (пусто).
            add({ ...info, id: `${o.id}:under`, title: '', cat: 'fill', cut: true, depth: 0, shape: 'poly', mat: 'void', pts: band(a, b, (s) => groundAtS(s) + lift, (s) => top(s) - DECK_BOARDS), s0: a, s1: b });
            add({ ...info, cat: 'cover', cut: true, depth: 0, shape: 'poly', mat: 'wood', pts: band(a, b, (s) => top(s) - DECK_BOARDS, top), s0: a, s1: b });
            continue;
          }
          if (elev > 0 && !levelPath && !graded) add({ ...info, id: `${o.id}:podium`, title: '', cat: 'fill', cut: true, depth: 0, shape: 'poly', mat: 'soil', color: LS_COLORS.soil[1], pts: band(a, b, (s) => groundAtS(s) + lift, (s) => top(s) - spec.t), s0: a, s1: b });
          add({ ...info, cat: 'cover', cut: true, depth: 0, shape: 'poly', mat: spec.mat, pts: band(a, b, (s) => top(s) - thickness, top), s0: a, s1: b });
        }
        if (elev !== 0 || deckH >= 200) {
          const [a0, a1] = clipS([iv[0][0], iv[iv.length - 1][1]]);
          const s = (a0 + a1) / 2;
          mark(s, baseCut(s), fmtElev(baseCut(s)));
        }
      } else if (elev > 0 || deckH > 150) {
        // В проекции видна только приподнятая площадка: от земли до верха.
        body(o, outline, -Math.max(deckH, elev), 0, base, { ...info, cat: 'cover', mat: spec.mat }, { cuts: [] });
      }
      if (o.curb) addCurb(o, base);
      continue;
    }

    // --- Живые изгороди и ограждения: стенка по контуру.
    if (look === 'hedge' || look === 'hedge-line' || (look === 'fence-line' && o.variant === 'hedge')) {
      const poly = look === 'hedge' ? objectOutline(o) : lineLayout({ ...o, width: Math.max(o.width || def.h, 500) }).outline;
      body(o, poly, 0, Math.max(400, h), base, { ...info, cat: 'plant', mat: 'leaf', look: 'hedge' });
      continue;
    }
    if (FENCE_LOOKS.has(look)) {
      const poly = look === 'fence-line' ? lineLayout({ ...o, width: Math.min(o.width || def.h, 200) }).outline : objectOutline(o);
      body(o, poly, 0, Math.max(600, h), base, { ...info, cat: 'object', mat: o.variant === 'mesh' ? 'mesh' : MAT_BY_VARIANT[o.variant] || 'wood', look: 'fence' });
      continue;
    }
    // --- Цветники, грядки, песочница: невысокий короб с грунтом.
    if (look === 'flowerbed' || look === 'vegbeds' || look === 'sandbox') {
      const H = Math.max(150, Math.min(h, 450));
      body(o, objectOutline(o, 32), 0, H, base, { ...info, cat: 'built', mat: look === 'sandbox' ? 'sand' : 'soil', color: look === 'sandbox' ? LS_COLORS.sand[0] : LS_COLORS.soil[0] });
      continue;
    }
    if (h <= 0) continue; // септик и т. п. — под землёй, не показываем
    // --- Прочие малые формы и постройки — габарит в сечении/проекции.
    const H = SHELTER_LOOKS.has(look) ? Math.max(2000, h) : look === 'lamp' ? Math.max(500, h) : Math.max(150, Math.min(h, 3500));
    body(o, objectOutline(o, 24), 0, H, base, { ...info, cat: 'object', mat: SHELTER_LOOKS.has(look) ? 'shelter' : 'object', look });
    if (o.curb) addCurb(o, base);
  }

  function addCurb(o, base) {
    const c = o.curb;
    const info = { id: `${o.id}:curb`, kind: 'curb', title: 'Бордюр', cat: 'built', mat: MAT_BY_VARIANT[c.variant] || 'concrete', color: objectColors({ kind: 'curb', variant: c.variant })[0], look: 'curb' };
    for (const { pts, closed } of curbLines(o)) {
      if (closed) {
        const outer = insetPolygon(pts, -c.width / 2);
        const inner = insetPolygon(pts, c.width / 2);
        body(o, outer, -60, Math.max(20, c.height), base, info, { cuts: subtractIntervals(cutIntervals(frame, outer), cutIntervals(frame, inner)), projectedToo: false });
      } else body(o, ribbonOutline(pts, c.width), -60, Math.max(20, c.height), base, info, { projectedToo: false });
    }
  }

  // A landscape drag keeps its cut line and house fixed between pointer events.
  if (opts.house) {
    prims.push(...opts.house.prims);
    marks.push(...opts.house.marks);
  } else {
    houseSection(project, { frame, X, L, maxDepth, sign, add, mark, rect, projected, clipS });
  }

  // Земля по линии.
  const ground = [];
  const n = zg.flat ? 1 : Math.min(800, Math.max(2, Math.ceil(L / 250)));
  const stations = new Set(Array.from({ length: n + 1 }, (_, i) => L * i / n));
  for (const { a, b } of excavations) { stations.add(a); stations.add(b); }
  const cutGround = (s, interiors) => Math.min(groundAtS(s), ...interiors.map((cut) => cut.top));
  const sorted = [...stations].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1]; const b = sorted[i];
    const mid = (a + b) / 2;
    const active = excavations.filter((cut) => cut.a <= mid && mid <= cut.b);
    const left = { x: X(a), z: cutGround(a, active) };
    if (!ground.length || ground[ground.length - 1].z !== left.z) ground.push(left);
    ground.push({ x: X(b), z: cutGround(b, active) });
  }
  if (X(0) > X(L)) ground.reverse();
  // Отметки земли на концах (только с рельефом — на ровном участке ±0.00 везде).
  if (!zg.flat) {
    mark(0, groundAtS(0), fmtElev(groundAtS(0)), 'ground');
    mark(L, groundAtS(L), fmtElev(groundAtS(L)), 'ground');
  }

  prims.sort((a, b) => (b.depth - a.depth) || ((CAT_ORDER[a.cat] ?? 5) - (CAT_ORDER[b.cat] ?? 5)));
  for (const p of prims) p.fade = Math.min(1, p.depth / maxDepth);

  // Габарит по z.
  let z0 = Math.min(0, ...ground.map((p) => p.z));
  let z1 = Math.max(0, ...ground.map((p) => p.z));
  // По x — линия разреза; кроны у концов не обрезаются (до 30 % длины).
  let bx0 = 0; let bx1 = L;
  for (const p of prims) {
    if (p.shape === 'plant') {
      z0 = Math.min(z0, p.plant.z); z1 = Math.max(z1, p.plant.z + p.plant.h);
      bx0 = Math.min(bx0, p.plant.x - p.plant.w * 0.55); bx1 = Math.max(bx1, p.plant.x + p.plant.w * 0.55);
      continue;
    }
    for (const q of p.pts) { z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  }
  return {
    name: (Array.isArray(line) ? '' : line?.name) || opts.name || 'А',
    length: L, side: sideId, flip, depth: maxDepth, ground, prims, platforms: platforms.sort((a, b) => a.x - b.x),
    marks: dedupeMarks(marks), box: { x0: Math.max(-L * 0.3, bx0), x1: Math.min(L * 1.3, bx1), z0: z0 - 600, z1: z1 + 700 },
  };
}

function dedupeMarks(marks) {
  const out = [];
  for (const m of marks.sort((a, b) => a.x - b.x)) {
    if (out.some((q) => q.text === m.text && Math.abs(q.x - m.x) < 1500)) continue;
    out.push(m);
  }
  return out;
}

// Keep the material around a rectangular mass cutter. Cutting each dimension
// off the remaining core produces at most six disjoint boxes.
function outsideCutter(box, cut) {
  const axes = ['x', 'y', 'z'];
  if (axes.some((axis) => box[axis + '1'] <= cut[axis + '0'] || box[axis + '0'] >= cut[axis + '1'])) return [box];
  const rest = { ...box };
  const pieces = [];
  for (const axis of axes) {
    const lo = axis + '0'; const hi = axis + '1';
    if (rest[lo] < cut[lo]) { pieces.push({ ...rest, [hi]: cut[lo] }); rest[lo] = cut[lo]; }
    if (rest[hi] > cut[hi]) { pieces.push({ ...rest, [lo]: cut[hi] }); rest[hi] = cut[hi]; }
  }
  return pieces;
}

// Плиты и крыши берутся из модели здания. Каждое звено ломаного разреза
// пересекает скаты в локальных осях дома, с точными Z на обоих концах.
function houseCovers(project, { frame, X, add, maxDepth, sign }) {
  const b = project.building;
  const solids = new Map();
  const faces = [...floorSlabFaces(project), ...linkedRoofFaces(project), ...roofFaces(project)];
  for (const face of faces) {
    if (face.kind === 'roof-drain') continue;
    const id = face.roofId || face.autoRoofId || ('slab:' + face.level);
    if (!solids.has(id)) solids.set(id, []);
    solids.get(id).push(face);
  }
  const segments = frame.segs.map((seg) => {
    const a = buildingLocal(b, seg.a);
    const end = buildingLocal(b, { x: seg.a.x + seg.u.x * seg.len, y: seg.a.y + seg.u.y * seg.len });
    return { a, dir: { x: (end.x - a.x) / seg.len, y: (end.y - a.y) / seg.len }, len: seg.len, s0: seg.s0 };
  });
  for (const [id, solid] of solids) {
    const slab = solid[0].kind === 'slab';
    const info = { id: 'house:' + id, kind: slab ? 'house-slab' : 'house-roof', title: '', cat: 'house',
      shape: 'poly', mat: slab ? 'concrete' : 'metal', look: slab ? 'slab' : 'roof' };
    let cut = false;
    for (const face of solid) {
      if (face.normal.z <= 0 || (face.alpha != null && face.alpha < 1)) continue;
      const thick = face.roofThickness ?? (face.pts[0].z - face.cutZ0);
      if (!(thick > 0)) continue;
      for (const seg of segments) {
        for (const [from, to] of faceLineSegments(seg, face)) {
          const s0 = seg.s0 + from.t; const s1 = seg.s0 + to.t;
          const x0 = X(s0); const x1 = X(s1);
          add({ ...info, cut: true, depth: 0, color: face.color, s0, s1, pts: [
            { x: x0, z: from.z - thick }, { x: x1, z: to.z - thick }, { x: x1, z: to.z }, { x: x0, z: from.z },
          ] });
          cut = true;
        }
      }
    }
    if (slab || cut) continue;
    for (const face of solid) {
      // Координаты проекции: x — станция, y — глубина в направлении взгляда.
      let pts = face.pts.map((p) => {
        const st = stationOf(frame, buildingWorld(b, p));
        return { x: st.s, y: st.d * sign, z: p.z };
      });
      for (const plane of [(p) => p.x, (p) => frame.length - p.x, (p) => p.y, (p) => maxDepth - p.y]) pts = clipFace(pts, plane);
      if (pts.length < 3) continue;
      const area = pts.reduce((sum, p, i) => {
        const q = pts[(i + 1) % pts.length];
        return sum + p.x * q.z - q.x * p.z;
      }, 0);
      if (Math.abs(area) < 1) continue;
      add({ ...info, cut: false, depth: Math.min(...pts.map((p) => p.y)), color: face.color,
        pts: pts.map((p) => ({ x: X(p.x), z: p.z })) });
    }
  }
}

// Дом: стены по этажам (сечение с проёмами), перекрытия, плита; дом за
// линией — силуэт.
function houseSection(project, ctx) {
  const { frame, maxDepth, add, mark, rect, projected, clipS, X } = ctx;
  if (!project.building) return;
  if (project.levels?.length) houseCovers(project, ctx);
  const levels = project.levels?.length ? sortedLevels(project) : [{ id: null, elevation: 0, height: 3000 }];
  const b = project.building;
  const cutters = (project.massVoids || []).map(massBox);
  for (const mass of project.masses || []) {
    if (!['decking', 'post', 'canopy'].includes(mass.facadeKind)) continue;
    const pieces = cutters.reduce((parts, cut) => parts.flatMap((part) => outsideCutter(part, cut)), facadeParts(mass));
    for (const piece of pieces) {
      const outline = rectCornersWorld(b, { x: piece.x0, y: piece.y0, w: piece.x1 - piece.x0, h: piece.y1 - piece.y0 });
      const iv = cutIntervals(frame, outline);
      const projection = iv.length ? null : projected(outline);
      const spans = projection ? [[projection.s0, projection.s1]] : iv;
      for (const span of spans) {
        const [a, c] = clipS(span);
        if (c - a < 1) continue;
        add({ id: `facade:${mass.id}`, kind: mass.facadeKind, title: mass.name, cat: 'house', cut: !projection,
          depth: projection?.depth ?? 0, shape: 'poly', mat: mass.facadeKind === 'decking' ? 'wood' : 'metal',
          color: piece.color, look: mass.facadeKind, pts: rect(X(a), X(c), piece.z0, piece.z1), s0: a, s1: c });
      }
    }
  }
  const envelope = envelopeOf(project);
  const terrainHouse = project.site?.terrain?.points?.length >= 3 ? houseTerrain(project) : null;
  const zero = resolvedZeroAboveGround(project, terrainHouse);
  const groundAt = groundFn(project);
  let anyCut = false;
  let topZ = 0;
  const footprintPolys = [];
  levels.forEach((lv, li) => {
    const lp = lv.id ? levelProject(project, lv.id) : project;
    const rooms = (lp.rooms || []).filter((r) => !r.parentId);
    if (!rooms.length) return;
    const z0 = Number(lv.elevation) || 0;
    const H = Math.max(1000, Number(lv.height) || 3000);
    topZ = Math.max(topZ, z0 + H);
    const walls = deriveWalls(lp).filter((w) => !w.hidden && w.band);
    const span = [];
    const holesByWall = new Map();
    for (const op of levelWindowOpenings(lp, walls)) {
      const placed = openingRect(lp, op, walls);
      if (!placed) continue;
      const poly = rectCornersWorld(b, placed.rect);
      const iv = cutIntervals(frame, poly);
      if (!iv.length) continue;
      const bottom = openingSill(op, lv);
      const top = bottom + openingHeight(op, lv);
      if (!holesByWall.has(placed.wall)) holesByWall.set(placed.wall, []);
      holesByWall.get(placed.wall).push(...iv.map((v) => ({ iv: v, bottom, top, kind: op.kind })));
    }
    for (const w of walls) {
      const poly = rectCornersWorld(b, w.band);
      if (li === 0) footprintPolys.push(poly);
      const iv = cutIntervals(frame, poly);
      if (!iv.length) continue;
      anyCut = true;
      span.push(...iv);
      const range = wallZRange(lp, w, H);
      const holes = (holesByWall.get(w) || []).map((h) => ({ ...h, bottom: Math.max(h.bottom, range.z0),
        top: Math.min(h.top, range.z1) })).filter((h) => h.top > h.bottom);
      const info = { id: `house:${lv.id || 0}:${w.key || ''}`, kind: 'house-wall', title: '', cat: 'house', cut: true, depth: 0, shape: 'poly', mat: 'brick', color: '#d9cfc2', look: 'wall' };
      const solid = subtractIntervals(iv, holes.map((h) => h.iv));
      for (const seg of solid) {
        const [a, c] = clipS(seg);
        if (c - a >= 1) add({ ...info, pts: rect(X(a), X(c), z0 + range.z0, z0 + range.z1), s0: a, s1: c });
      }
      for (const h of holes) {
        for (const seg of iv) {
          const a = Math.max(seg[0], h.iv[0]); const c = Math.min(seg[1], h.iv[1]);
          if (c - a < 1) continue;
          const [ca, cc] = clipS([a, c]);
          if (h.bottom > range.z0) add({ ...info, pts: rect(X(ca), X(cc), z0 + range.z0, z0 + h.bottom), s0: ca, s1: cc });
          if (h.top < range.z1) add({ ...info, pts: rect(X(ca), X(cc), z0 + h.top, z0 + range.z1), s0: ca, s1: cc });
          add({ ...info, kind: 'house-opening', mat: h.kind === 'window' ? 'glass' : 'void', color: '#dfe9ea', pts: rect(X(ca), X(cc), z0 + h.bottom, z0 + h.top), s0: ca, s1: cc });
        }
      }
    }
    // Опора нижнего этажа и отметки полов — по комнатам и стенам.
    for (const r of rooms) span.push(...cutIntervals(frame, rectCornersWorld(b, r)));
    const merged = mergeIntervals(span, 50);
    for (const seg of merged) {
      const [a, c] = clipS(seg);
      if (c - a < 1) continue;
      if (li === 0 && envelope.foundation.enabled && zero != null) {
        const minGround = footprintPolys.length
          ? Math.min(...footprintPolys.flatMap((poly) => poly.map((point) => groundAt(point.x, point.y))))
          : -zero;
        const bottom = Math.min(z0, minGround) - envelope.foundation.depth;
        add({ id: 'house:foundation', kind: 'house-slab', title: '', cat: 'house', cut: true, depth: 0, shape: 'poly', mat: 'concrete', color: '#9d9890', look: 'slab', pts: rect(X(a), X(c), bottom, z0), s0: a, s1: c });
      }
    }
    if (merged.length) {
      const s = merged[0][0];
      mark(Math.max(0, s) + 300, z0, fmtElev(z0), 'floor');
    }
  });
  if (anyCut) {
    mark(firstHouseS(frame, footprintPolys) + 300, topZ, fmtElev(topZ), 'floor');
    return;
  }
  // Дом за линией — силуэт (по пятну нижнего этажа).
  if (!footprintPolys.length) return;
  let pr = null;
  for (const poly of footprintPolys) {
    const p = projected(poly);
    if (!p) continue;
    pr = pr ? { s0: Math.min(pr.s0, p.s0), s1: Math.max(pr.s1, p.s1), depth: Math.min(pr.depth, p.depth) } : p;
  }
  if (!pr || pr.depth > maxDepth) return;
  add({ id: 'house', kind: 'house', title: 'Дом', cat: 'house', cut: false, depth: pr.depth, shape: 'poly', mat: 'house', color: '#e6ded3', look: 'house', pts: rect(X(pr.s0), X(pr.s1), 0, topZ), s0: pr.s0, s1: pr.s1 });
}

function firstHouseS(frame, polys) {
  let s = Infinity;
  for (const p of polys) for (const iv of cutIntervals(frame, p)) s = Math.min(s, iv[0]);
  return Number.isFinite(s) ? Math.max(0, s) : 0;
}

// ------------------------------------------------------------ Силуэты растений

// Контуры растения в плоскости разреза: { crown: [{x,z}], trunk: [{x,z}] | null }.
// Условные формы по look каталога; неровность — детерминированная (по id).
export function plantShape(prim) {
  const { x, z, w, h, look, seed } = prim.plant;
  const rand = seededRandom(seed || 'p');
  const r = w / 2;
  const blob = (cx, cz, rx, rz, n = 28, k = 0.07) => {
    const ph = rand() * 6.28;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const t = (i / n) * Math.PI * 2;
      const j = 1 + k * Math.sin(5 * t + ph) + k * 0.6 * Math.sin(9 * t + ph * 1.7) + (rand() - 0.5) * k * 0.6;
      out.push({ x: cx + Math.cos(t) * rx * j, z: cz + Math.sin(t) * rz * j });
    }
    return out;
  };
  const trunk = (top, tw) => [{ x: x - tw / 2, z }, { x: x + tw / 2, z }, { x: x + tw * 0.35, z: top }, { x: x - tw * 0.35, z: top }];
  const tw = Math.max(90, Math.min(r * 0.12, h * 0.03));
  if (look === 'spruce') {
    const crown = [];
    const tiers = 6;
    const z0 = z + h * 0.08;
    crown.push({ x, z: z + h });
    for (let i = 1; i <= tiers; i += 1) {
      const zz = z + h - ((h - (z0 - z)) * i) / tiers;
      const rr = (r * i) / tiers;
      crown.push({ x: x + rr, z: zz }, { x: x + rr * 0.72, z: zz + (h / tiers) * 0.25 });
    }
    const right = crown.slice(1);
    const left = right.map((p) => ({ x: 2 * x - p.x, z: p.z })).reverse();
    return { crown: [crown[0], ...right, ...left], trunk: trunk(z0 + 50, tw) };
  }
  if (look === 'pine') {
    const top = z + h;
    const cz = top - h * 0.16;
    return { crown: [...blob(x, cz, r, h * 0.17, 30, 0.1)], trunk: trunk(cz - h * 0.12, tw) };
  }
  if (look === 'thuja') return { crown: blob(x, z + h * 0.52, r, h * 0.48, 24, 0.04), trunk: null };
  if (look === 'bonsai') {
    const a = blob(x - r * 0.15, z + h * 0.62, r * 0.75, h * 0.16, 22, 0.08);
    return { crown: a, crown2: blob(x + r * 0.45, z + h * 0.88, r * 0.38, h * 0.1, 18, 0.08), trunk: trunk(z + h * 0.62, tw * 1.3) };
  }
  if (look === 'ball') return { crown: blob(x, z + h / 2, r, h / 2, 24, 0.03), trunk: null };
  if (look === 'juniper') return { crown: blob(x, z, r, h, 26, 0.06).filter((p) => p.z >= z - 1), trunk: null };
  if (look === 'grass' || look === 'flowers') {
    const crown = [{ x: x - r * 0.25, z }];
    const n = 9;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const ang = Math.PI * (0.9 - 0.8 * t);
      crown.push({ x: x + Math.cos(ang) * r, z: z + Math.sin(ang) * h * (0.85 + rand() * 0.15) });
      if (i < n) crown.push({ x: x + Math.cos(ang - 0.05) * r * 0.35, z: z + Math.sin(ang - 0.05) * h * 0.35 });
    }
    crown.push({ x: x + r * 0.25, z });
    return { crown, trunk: null };
  }
  if (look === 'boulder') return { crown: blob(x, z, r, h, 16, 0.12).filter((p) => p.z >= z - 1), trunk: null };
  if (look === 'shrub') return { crown: blob(x, z + h * 0.5, r, h * 0.5, 26, 0.1), trunk: null };
  // Лиственные (берёза, дуб, плодовые): ствол + округлая крона.
  const crownH = Math.min(h * 0.68, Math.max(r * 1.6, h * 0.5));
  const cz = z + h - crownH / 2;
  return { crown: blob(x, cz, r, crownH / 2, 30, 0.08), trunk: trunk(cz - crownH * 0.4, tw) };
}

// ------------------------------------------------------------ Линия на плане

// Знаки разреза на плане (мир): линия, штрихи на концах, стрелки взгляда,
// буквы. Длины — в мм (size — длина стрелки).
export function sectionPlanMarks(section, size = 1200) {
  const pts = section.points;
  const frame = sectionFrame(pts);
  if (!frame.segs.length) return null;
  const sign = section.side === 'right' ? -1 : 1;
  const ends = [];
  const first = frame.segs[0]; const last = frame.segs[frame.segs.length - 1];
  for (const [p, g, out] of [[pts[0], first, -1], [pts[pts.length - 1], last, 1]]) {
    const n = { x: g.u.y * sign, y: -g.u.x * sign }; // в сторону взгляда
    const tail = { x: p.x + g.u.x * out * size * 0.15, y: p.y + g.u.y * out * size * 0.15 };
    const tip = { x: tail.x + n.x * size, y: tail.y + n.y * size };
    const text = { x: tip.x + n.x * size * 0.35 + g.u.x * out * size * 0.3, y: tip.y + n.y * size * 0.35 + g.u.y * out * size * 0.3 };
    ends.push({ at: { x: p.x, y: p.y }, stroke: [{ x: p.x - g.u.x * out * size * 0.6, y: p.y - g.u.y * out * size * 0.6 }, tail], tail, tip, dir: n, text });
  }
  return { points: pts, ends, name: section.name };
}

// ------------------------------------------------------------ DXF

// Сущности разреза для DXF (слой LANDSCAPE_SECTION): x — вдоль линии, y — вверх
// (z). buildDxf переворачивает y, поэтому пишем y = −z.
export function sectionDxfEntities(profile, { ox = 0, oy = 0 } = {}) {
  const layer = SECTION_DXF_LAYER.key;
  const out = [];
  const P = (q) => ({ x: ox + q.x, y: oy - q.z });
  const poly = (pts, closed = true) => {
    for (let i = 0; i < (closed ? pts.length : pts.length - 1); i += 1) {
      const a = P(pts[i]); const b = P(pts[(i + 1) % pts.length]);
      out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  };
  poly(profile.ground, false);
  for (const p of profile.prims) {
    if (p.shape === 'plant') {
      const sh = plantShape(p);
      poly(sh.crown);
      if (sh.crown2) poly(sh.crown2);
      if (sh.trunk) poly(sh.trunk);
    } else poly(p.pts);
  }
  for (const m of profile.marks) {
    const a = P({ x: m.x, z: m.z });
    out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: a.x - 150, y2: a.y - 250 });
    out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: a.x + 150, y2: a.y - 250 });
    out.push({ type: 'line', layer, x1: a.x - 150, y1: a.y - 250, x2: a.x + 150, y2: a.y - 250 });
    out.push({ type: 'line', layer, x1: a.x, y1: a.y - 250, x2: a.x + 1200, y2: a.y - 250 });
    out.push({ type: 'text', layer, x: a.x + 150, y: a.y - 300, height: 200, text: m.text });
  }
  for (const p of profile.prims) {
    if (!p.title || (!p.cut && p.depth > profile.depth * 0.5)) continue;
    const x = p.shape === 'plant' ? p.plant.x : (Math.min(...p.pts.map((q) => q.x)) + Math.max(...p.pts.map((q) => q.x))) / 2;
    const z = p.shape === 'plant' ? p.plant.z + p.plant.h : Math.max(...p.pts.map((q) => q.z));
    const a = P({ x, z: z + 300 });
    out.push({ type: 'text', layer, x: a.x, y: a.y, height: 180, text: p.title });
  }
  const t = P({ x: 0, z: profile.box.z1 + 800 });
  out.push({ type: 'text', layer, x: t.x, y: t.y, height: 400, text: `Разрез ${profile.name}–${profile.name}` });
  return out;
}

export function buildSectionDxf(profile) {
  return buildDxf(sectionDxfEntities(profile), { extraLayers: [SECTION_DXF_LAYER] });
}

// Линии разрезов на генплане (DXF): ось, штрихи, стрелки, буквы.
export function sectionPlanDxfEntities(sections = []) {
  const layer = SECTION_DXF_LAYER.key;
  const out = [];
  for (const s of sections) {
    const m = sectionPlanMarks(s);
    if (!m) continue;
    for (let i = 0; i < m.points.length - 1; i += 1) {
      const a = m.points[i]; const b = m.points[i + 1];
      out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    for (const e of m.ends) {
      out.push({ type: 'line', layer, x1: e.stroke[0].x, y1: e.stroke[0].y, x2: e.stroke[1].x, y2: e.stroke[1].y });
      out.push({ type: 'line', layer, x1: e.tail.x, y1: e.tail.y, x2: e.tip.x, y2: e.tip.y });
      const back = { x: -e.dir.x * 300, y: -e.dir.y * 300 };
      const side = { x: -e.dir.y * 120, y: e.dir.x * 120 };
      out.push({ type: 'line', layer, x1: e.tip.x, y1: e.tip.y, x2: e.tip.x + back.x + side.x, y2: e.tip.y + back.y + side.y });
      out.push({ type: 'line', layer, x1: e.tip.x, y1: e.tip.y, x2: e.tip.x + back.x - side.x, y2: e.tip.y + back.y - side.y });
      out.push({ type: 'text', layer, x: e.text.x - 150, y: e.text.y + 200, height: 450, text: s.name });
    }
  }
  return out;
}

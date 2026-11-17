// Ландшафт в 3D (без DOM): низкополигональные формы для объектов
// project.site.landscape — деревья (ствол + крона), кусты-шары, валуны,
// клумбы, покрытия и настил тонкими плитами по земле (по рельефу, если он
// есть), бассейн и пруд, беседки и навесы на столбах, фонари, ограждения,
// разметка парковки. Грани — в осях дома (как core/mesh3d.js): x вправо,
// y вниз по плану, z вверх; объекты ландшафта — в мире (участок),
// переводятся toLocal(building).

import { toLocal } from './building.js';
import {
  LS_COLORS, curbLines, insetPolygon, isPathShape, isRoundObject, landscapeDef, lineLayout, objectColors, objectOutline,
  elevOf, objectPath, planterInner, retainingInfo, ribbonOutline, seededRandom, stairsInfo, steppingSlabs,
} from './landscape.js';

const v = (x, y, z) => ({ x, y, z });
const KIND = 'landscape';
const TAU = Math.PI * 2;

// ------------------------------------------------------------ Примитивы

// Треугольники многоугольника (отсечение ушей; порядок обхода — любой).
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const idx = [...Array(n).keys()];
  if (area < 0) idx.reverse();
  const out = [];
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard < n * n) {
    guard += 1;
    let cut = false;
    for (let i = 0; i < idx.length; i += 1) {
      const ia = idx[(i + idx.length - 1) % idx.length]; const ib = idx[i]; const ic = idx[(i + 1) % idx.length];
      const a = poly[ia]; const b = poly[ib]; const c = poly[ic];
      if (cross(a, b, c) <= 0) continue;
      if (idx.some((k) => k !== ia && k !== ib && k !== ic && inside(poly[k], a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break; // вырожденный контур — остаток веером
  }
  for (let i = 1; i < idx.length - 1; i += 1) out.push([poly[idx[0]], poly[idx[i]], poly[idx[i + 1]]]);
  return out;
}

// Плоский многоугольник на высоте z (+ рельеф hz) — треугольниками.
function flat(poly, z, color, hz, extra = {}) {
  return triangulate(poly).map((t) => ({
    pts: t.map((p) => v(p.x, p.y, z + hz(p.x, p.y))), normal: v(0, 0, 1), color, kind: KIND, twoSided: true, ...extra,
  }));
}

// Призма: верх (треугольниками) и бока; низ — по земле.
function prism(poly, z0, z1, color, hz, { side = color, top = true } = {}) {
  const faces = top ? flat(poly, z1, color, hz) : [];
  const cx = poly.reduce((t, p) => t + p.x, 0) / poly.length;
  const cy = poly.reduce((t, p) => t + p.y, 0) / poly.length;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const len = Math.hypot(nx, ny) || 1;
    const za = hz(a.x, a.y); const zb = hz(b.x, b.y);
    faces.push({ pts: [v(a.x, a.y, za + z0), v(b.x, b.y, zb + z0), v(b.x, b.y, zb + z1), v(a.x, a.y, za + z1)], normal: v(nx / len, ny / len, 0), color: side, kind: KIND });
  }
  return faces;
}

const box = (cx, cy, w, d, z0, z1, color, hz, rot = 0) => prism(rectPoly(cx, cy, w, d, rot), z0, z1, color, hz);

function rectPoly(cx, cy, w, d, rot = 0) {
  const c = Math.cos(rot); const s = Math.sin(rot);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

function circlePoly(cx, cy, rx, ry = rx, n = 8, rot = 0) {
  return Array.from({ length: n }, (_, i) => {
    const t = rot + (i / n) * TAU;
    return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry };
  });
}

// Эллипсоид (низкополигональный): центр (cx, cy, cz), полуоси rx, ry, rz.
// jitter — неровность (валуны), rand — детерминированный ряд.
function ellipsoid(cx, cy, cz, rx, ry, rz, color, { lat = 4, lon = 8, jitter = 0, rand = null, rot = 0 } = {}) {
  const faces = [];
  const k = [];
  for (let i = 0; i <= lat; i += 1) {
    k.push([]);
    for (let j = 0; j < lon; j += 1) k[i].push(jitter && i > 0 && i < lat ? 1 - jitter + rand() * jitter * 2 : 1);
  }
  const P = (i, j) => {
    const phi = (i / lat) * Math.PI; // 0 — верх
    const th = rot + (j / lon) * TAU;
    const kk = k[i][j % lon];
    const x = Math.sin(phi) * Math.cos(th) * rx * kk;
    const y = Math.sin(phi) * Math.sin(th) * ry * kk;
    const z = Math.cos(phi) * rz;
    return v(cx + x, cy + y, cz + z);
  };
  for (let i = 0; i < lat; i += 1) {
    for (let j = 0; j < lon; j += 1) {
      const a = P(i, j); const b = P(i, j + 1); const c = P(i + 1, j + 1); const d = P(i + 1, j);
      const pts = i === 0 ? [a, c, d] : i === lat - 1 ? [a, b, c] : [a, b, c, d];
      const m = pts.reduce((s, p) => v(s.x + p.x / pts.length, s.y + p.y / pts.length, s.z + p.z / pts.length), v(0, 0, 0));
      const nx = (m.x - cx) / rx; const ny = (m.y - cy) / ry; const nz = (m.z - cz) / rz;
      const len = Math.hypot(nx, ny, nz) || 1;
      faces.push({ pts, normal: v(nx / len, ny / len, nz / len), color, kind: KIND });
    }
  }
  return faces;
}

// Конус: основание радиуса r на z0, вершина на z1.
function cone(cx, cy, r, z0, z1, color, n = 8) {
  const faces = [];
  const base = circlePoly(cx, cy, r, r, n);
  const apex = v(cx, cy, z1);
  for (let i = 0; i < n; i += 1) {
    const a = base[i]; const b = base[(i + 1) % n];
    const mx = (a.x + b.x) / 2 - cx; const my = (a.y + b.y) / 2 - cy;
    const len = Math.hypot(mx, my, r * r / Math.max(1, z1 - z0)) || 1;
    faces.push({ pts: [v(a.x, a.y, z0), v(b.x, b.y, z0), apex], normal: v(mx / len, my / len, (r * r / Math.max(1, z1 - z0)) / len), color, kind: KIND });
  }
  faces.push({ pts: base.map((p) => v(p.x, p.y, z0)), normal: v(0, 0, -1), color, kind: KIND });
  return faces;
}

// Пирамида крыши над многоугольником: свес на z0, конёк/вершина на z1.
function pyramid(poly, z0, z1, color) {
  const cx = poly.reduce((t, p) => t + p.x, 0) / poly.length;
  const cy = poly.reduce((t, p) => t + p.y, 0) / poly.length;
  const apex = v(cx, cy, z1);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return { pts: [v(a.x, a.y, z0), v(b.x, b.y, z0), apex], normal: v(0, 0, 0), color, kind: KIND, twoSided: true };
  });
}

// Многоугольник, расширенный на d (кайма бассейна) — смещение рёбер с митрой.
export function offsetPolygon(poly, d) {
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sgn = area > 0 ? -1 : 1; // наружу
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i + n - 1) % n]; const b = poly[(i + 1) % n];
    const n1 = norm(a, p); const n2 = norm(p, b);
    let nx = n1.x + n2.x; let ny = n1.y + n2.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const cos = Math.max(0.5, nx * n1.x + ny * n1.y);
    return { x: p.x + nx * (d / cos) * sgn, y: p.y + ny * (d / cos) * sgn };
  });
}
function norm(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

// ------------------------------------------------------------ Объекты

const GREEN_FLAT = new Set(['lawn-patch', 'lawn-area', 'parking-guest']);

// Грани одного объекта (точки — уже в осях дома: o.x, o.y, outline, path).
function objectFaces(o, def, outline, path, hz) {
  const C = objectColors(o, def);
  const h = Math.max(0, o.height ?? def.height ?? 0);
  const at = (x, y) => hz(x, y);
  const z0 = at(o.x, o.y);
  const rand = seededRandom(o.id);
  const rot = ((o.rotation || 0) * Math.PI) / 180;
  const faces = [];
  const look = def.look;

  // --- Деревья: ствол + крона.
  if (def.group === 'Деревья') {
    const H = Math.max(1500, h);
    const ry = (o.h || o.w) / 2;
    const rx = o.w / 2;
    const trunk = Math.max(80, Math.min(rx, ry) * 0.09);
    const conifer = look === 'pine' || look === 'spruce' || look === 'thuja';
    const trunkTop = look === 'spruce' ? H * 0.15 : look === 'thuja' ? H * 0.1 : look === 'pine' ? H * 0.5 : look === 'bonsai' ? H * 0.45 : H * 0.38;
    faces.push(...prism(circlePoly(o.x, o.y, trunk, trunk, 6), 0, trunkTop + (conifer ? H * 0.1 : 0), '#6b4a33', hz));
    if (look === 'spruce') faces.push(...cone(o.x, o.y, Math.min(rx, ry), z0 + trunkTop, z0 + H, C[0], 10));
    else if (look === 'thuja') faces.push(...ellipsoid(o.x, o.y, z0 + (trunkTop + H) / 2, rx, ry, (H - trunkTop) / 2, C[0], { lon: 8, rot }));
    else if (look === 'pine') faces.push(...ellipsoid(o.x, o.y, z0 + H * 0.75, rx, ry, H * 0.25, C[0], { lon: 10 }));
    else if (look === 'bonsai') {
      faces.push(...ellipsoid(o.x, o.y, z0 + H * 0.65, rx * 0.8, ry * 0.8, H * 0.18, C[0], { lon: 8 }));
      faces.push(...ellipsoid(o.x + rx * 0.45, o.y - ry * 0.2, z0 + H * 0.92, rx * 0.4, ry * 0.4, H * 0.1, C[1], { lon: 6, lat: 3 }));
    } else {
      const crownH = (H - trunkTop) / 2 + H * 0.06;
      faces.push(...ellipsoid(o.x, o.y, z0 + H - crownH, rx, ry, crownH, C[0], { lon: 10, jitter: 0.06, rand }));
    }
    return faces;
  }
  // --- Кусты, злаки: шары/эллипсоиды.
  if (look === 'ball' || look === 'shrub' || look === 'grass' || look === 'juniper') {
    const H = Math.max(300, h);
    const rx = o.w / 2; const ry = o.h / 2;
    const rz = look === 'juniper' ? H : Math.min(H / 2, Math.max(rx, ry));
    return ellipsoid(o.x, o.y, z0 + (look === 'juniper' ? 0 : rz), rx, ry, rz, C[0], { lon: 8, jitter: look === 'shrub' ? 0.08 : 0, rand, rot });
  }
  if (look === 'boulder') {
    const stones = o.variant === 'trio' ? [[-0.3, -0.15, 0.62], [0.42, 0.1, 0.48], [-0.05, 0.55, 0.36]] : [[0, 0, 1]];
    for (const [sx, sy, k] of stones) {
      const c = { x: o.x + (sx * o.w / 2) * Math.cos(rot) - (sy * o.h / 2) * Math.sin(rot), y: o.y + (sx * o.w / 2) * Math.sin(rot) + (sy * o.h / 2) * Math.cos(rot) };
      faces.push(...ellipsoid(c.x, c.y, at(c.x, c.y), (o.w / 2) * k, (o.h / 2) * k, Math.max(200, h) * k, C[0], { lat: 3, lon: 7, jitter: 0.18, rand, rot }));
    }
    return faces;
  }
  if (look === 'hedge' || look === 'hedge-line' || (look === 'fence-line' && o.variant === 'hedge')) {
    const poly = look === 'hedge' ? outline : lineLayout({ ...o, width: Math.max(o.width || def.h, 500) }).outline;
    return prism(poly, 0, Math.max(400, h), C[0], hz, { side: C[1] || C[0] });
  }
  // --- Ограждения: полотно + столбы.
  if (look === 'fence-line' || look === 'fence' || look === 'gate') {
    const H = Math.max(600, h);
    const mesh = o.variant === 'mesh';
    const poly = look === 'fence-line' ? lineLayout({ ...o, width: Math.min(o.width || def.h, mesh ? 40 : 200) }).outline : outline;
    faces.push(...prism(poly, mesh ? 50 : 100, H, C[0], hz).map((f) => (mesh ? { ...f, alpha: 0.45 } : f)));
    const line = look === 'fence-line' ? path : [outline[0], outline[1]].map((p, i) => ({ x: (p.x + outline[3 - i].x) / 2, y: (p.y + outline[3 - i].y) / 2 }));
    let total = 0;
    for (let i = 1; i < line.length; i += 1) total += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    const n = Math.max(1, Math.round(total / 2500));
    for (let k = 0; k <= n && k < 400; k += 1) {
      const p = along(line, (total * k) / n);
      faces.push(...box(p.x, p.y, 100, 100, 0, H + 100, C[1] || C[0], hz));
    }
    return faces;
  }
  // --- Клумба-короб: стенки-кольцо, засыпка чуть ниже верха борта.
  if (look === 'planter' || look === 'planter-area') {
    const H = Math.max(0, h);
    const inner = planterInner(o);
    if (H > 0) faces.push(...wallRing(outline, inner, 0, H, C[0], C[1], hz));
    const fill = { soil: LS_COLORS.soil[0], mulch: LS_COLORS.mulch[0], gravel: LS_COLORS.gravel[1] }[o.meta?.fill] || LS_COLORS.soil[0];
    faces.push(...flat(inner, Math.max(10, H - 60), fill, hz));
    return faces;
  }
  // --- Наружная лестница: ступени-блоки реальной высоты, борта по бокам.
  if (look === 'stairs') {
    const st = stairsInfo(o);
    const n = Math.max(1, st.steps);
    const t = o.h / n;
    const fw = Math.max(100, st.flight);
    const at2 = (lx, ly) => ({ x: o.x + lx * Math.cos(rot) - ly * Math.sin(rot), y: o.y + lx * Math.sin(rot) + ly * Math.cos(rot) });
    for (let i = 0; i < n; i += 1) {
      const ly = o.h / 2 - (i + 0.5) * t; // снизу (+Y) вверх
      const zTop = Math.max(20, (i + 1) * st.riser);
      const c = at2(0, ly);
      faces.push(...prism(rectPoly(c.x, c.y, fw, t, rot), 0, zTop, C[0], hz, { side: C[1] }));
      if (st.cheek > 0) {
        for (const sx of [-1, 1]) {
          const cc = at2(sx * (o.w / 2 - st.cheek / 2), ly);
          faces.push(...prism(rectPoly(cc.x, cc.y, st.cheek, t, rot), 0, zTop + 150, C[2] || C[0], hz, { side: C[1] }));
        }
      }
    }
    return faces;
  }
  if (look === 'curb') return prism(outline, 0, Math.max(20, h), C[0], hz, { side: C[1] || C[0] });
  // --- Подпорная стенка: тело на всю высоту над низом, капа со свесом.
  if (look === 'retaining') {
    const ri = retainingInfo(o);
    const H = Math.max(50, ri.height);
    faces.push(...prism(outline, 0, H, C[2] || C[0], hz, { side: C[1] || C[0] }));
    if (ri.cap) faces.push(...prism(lineLayout({ ...o, width: ri.capW }).outline, H, H + ri.capH, C[2] || C[0], hz, { side: C[0] }));
    return faces;
  }
  // --- Покрытия-линии: дорожки.
  if (def.shape === 'line') {
    if (o.kind === 'path' && o.variant === 'stepping') {
      for (const sl of steppingSlabs(o)) faces.push(...prism(rectPoly(sl.x, sl.y, sl.along, sl.across, sl.angle), 0, 40, C[sl.ci ?? 0] || C[0], hz));
      return faces;
    }
    const z = o.variant === 'deck' ? 120 : 25;
    // Контур — с углами по типу (срез/встык/угловая/скругление).
    return o.variant === 'deck' ? prism(outline, 0, z, C[0], hz, { side: C[1] }) : flat(outline, z, C[0], hz);
  }
  // --- Вода.
  if (look === 'pool' || look === 'area-pool' || look === 'jacuzzi') {
    const water = look === 'pool' ? outlineInset(o, 450, rot) : outline;
    const coping = look === 'pool' ? outline : offsetPolygon(outline, 350);
    faces.push(...flat(coping, 30, LS_COLORS.coping[0], hz));
    faces.push(...flat(water, 45, look === 'area-pool' ? C[0] : C[1], hz, { kind: 'landscape-water' }));
    if (look === 'jacuzzi') faces.push(...prism(coping, 0, 450, LS_COLORS.coping[1], hz, { top: false }));
    return faces;
  }
  if (look === 'pond' || look === 'area-pond') {
    faces.push(...flat(outline, 20, C[1], hz, { kind: 'landscape-water' }));
    // Берег — камни по контуру.
    let total = 0;
    const ring = [...outline, outline[0]];
    for (let i = 1; i < ring.length; i += 1) total += Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y);
    const n = Math.min(60, Math.max(8, Math.round(total / 700)));
    for (let k = 0; k < n; k += 1) {
      const p = along(ring, (total * k) / n);
      const s = 180 + rand() * 160;
      faces.push(...ellipsoid(p.x, p.y, at(p.x, p.y), s, s, s * 0.6, LS_COLORS.stone[k % 3], { lat: 2, lon: 5, jitter: 0.2, rand }));
    }
    return faces;
  }
  if (look === 'fountain' || look === 'well') {
    faces.push(...prism(circlePoly(o.x, o.y, o.w / 2, o.w / 2, 10), 0, Math.min(h, 700), LS_COLORS.stone[1], hz));
    faces.push(...flat(circlePoly(o.x, o.y, o.w / 2 - 120, o.w / 2 - 120, 10), Math.min(h, 700) - 60, LS_COLORS.water[0], hz, { kind: 'landscape-water' }));
    if (look === 'well' && o.variant === 'roof') {
      for (const sx of [-1, 1]) faces.push(...box(o.x + sx * (o.w / 2 - 60), o.y, 80, 80, 0, h, LS_COLORS.wood[1], hz));
      faces.push(...pyramid(rectPoly(o.x, o.y, o.w * 1.1, o.w * 0.9, rot), z0 + h - 400, z0 + h + 150, LS_COLORS.roof[0]));
    }
    return faces;
  }
  // --- Постройки на столбах: беседка, пергола, навес.
  if (look === 'gazebo' || look === 'pergola' || look === 'carport') {
    const H = Math.max(2000, h);
    const eave = look === 'gazebo' && o.variant !== 'flat' ? H * 0.72 : H;
    const inset = outlineInset(o, 150, rot);
    for (const p of inset) faces.push(...box(p.x, p.y, 120, 120, 0, eave, look === 'carport' ? C[1] : LS_COLORS.wood[1], hz, rot));
    faces.push(...flat(outline, 30, LS_COLORS.deck[0], hz));
    if (look === 'pergola') {
      const cos = Math.cos(rot); const sin = Math.sin(rot);
      for (let x = -o.w / 2 + 200; x <= o.w / 2 - 200; x += 450) {
        faces.push(...box(o.x + x * cos, o.y + x * sin, 60, o.h, eave - 180, eave, C[0], () => z0, rot));
      }
    } else if (look === 'carport' || o.variant === 'flat') {
      faces.push(...prism(outline, eave, eave + 120, C[0], () => z0).map((f) => (o.variant === 'poly' ? { ...f, alpha: 0.6 } : f)));
    } else {
      faces.push(...pyramid(o.variant === 'hex' ? circlePoly(o.x, o.y, o.w / 2 + 250, o.h / 2 + 250, 6, rot) : offsetPolygon(outline, 250), z0 + eave, z0 + H, C[0]));
    }
    return faces;
  }
  if (look === 'lamp') {
    const H = Math.max(500, h);
    faces.push(...box(o.x, o.y, 90, 90, 0, H, LS_COLORS.metal[0], hz));
    faces.push(...box(o.x, o.y, 220, 220, H, H + 160, '#fff1b8', hz));
    return faces;
  }
  if (look === 'greenhouse') {
    faces.push(...prism(outline, 0, Math.max(1500, h) * 0.7, LS_COLORS.glass[0], hz).map((f) => ({ ...f, alpha: 0.5 })));
    faces.push(...pyramid(outline, z0 + Math.max(1500, h) * 0.7, z0 + Math.max(1500, h), LS_COLORS.glass[1]).map((f) => ({ ...f, alpha: 0.5 })));
    return faces;
  }
  if (look === 'parking') {
    faces.push(...flat(outline, 15, C[0], hz));
    const spaces = Math.max(1, Math.round(Number(o.meta?.spaces) || (o.kind === 'parking-2' ? 2 : 1)));
    const cos = Math.cos(rot); const sin = Math.sin(rot);
    for (let i = 0; i <= spaces; i += 1) {
      const x = -o.w / 2 + (o.w * i) / spaces;
      faces.push(...flat(rectPoly(o.x + x * cos, o.y + x * sin, 100, o.h - 300, rot), 22, '#f4f4f0', hz));
    }
    return faces;
  }
  if (look === 'flowerbed' || look === 'vegbeds' || look === 'sandbox') {
    const H = Math.max(150, Math.min(h, 450));
    faces.push(...prism(outline, 0, H, look === 'sandbox' ? LS_COLORS.sand[0] : LS_COLORS.soil[0], hz, { side: look === 'flowerbed' ? LS_COLORS.stone[1] : LS_COLORS.wood[1] }));
    if (look === 'flowerbed') {
      const flowers = variantOf(o, def);
      faces.push(...flat(offsetPolygon(outline, -120), H + 30, flowers || LS_COLORS.leaf[1], hz));
    }
    return faces;
  }
  if (look === 'firepit') {
    faces.push(...flat(circlePoly(o.x, o.y, o.w / 2, o.w / 2, 12), 20, LS_COLORS.gravel[0], hz));
    faces.push(...prism(circlePoly(o.x, o.y, o.w * 0.12, o.w * 0.12, 8), 0, 350, LS_COLORS.stone[2], hz));
    faces.push(...flat(circlePoly(o.x, o.y, o.w * 0.09, o.w * 0.09, 8), 360, LS_COLORS.fire[1], hz));
    if (o.variant === 'bench') {
      for (let k = 0; k < 8; k += 1) {
        if (k === 2) continue; // проход
        const t = (k / 8) * TAU;
        const rr = o.w * 0.4;
        faces.push(...box(o.x + Math.cos(t) * rr, o.y + Math.sin(t) * rr, o.w * 0.28, 420, 0, 450, LS_COLORS.wood[0], hz, t + Math.PI / 2));
      }
    }
    return faces;
  }
  // --- Покрытия (площадки, газон, настил) — тонкие плиты по земле.
  if (GREEN_FLAT.has(o.kind) || (def.layer === 'ground' && def.cover && h <= 0)) {
    // Газон — чуть над землёй (−5) и ниже пола дома (0): контур по всему
    // участку не закрывает полы; покрытия — над газоном.
    const z = GREEN_FLAT.has(o.kind) ? -2 : look.startsWith('area-') ? 6 : 15;
    return flat(outline, z, C[0], hz);
  }
  if (def.cover && h > 0 && h <= 450) return prism(outline, 0, h, C[0], hz, { side: C[1] || C[0] });
  // --- Прочие малые формы — призма габарита (не выше 1,2 м: условно).
  return prism(isRoundObject(o, def) ? circlePoly(o.x, o.y, o.w / 2, o.h / 2, 10, rot) : outline, 0, Math.max(150, Math.min(h || 400, 1200)), C[0], hz, { side: C[1] || C[0] });
}

// Стенка-кольцо между контурами outer и inner (одинаковое число вершин):
// верх — четырёхугольники рёбер, бока — наружу и внутрь.
function wallRing(outer, inner, z0, z1, top, side, hz) {
  const faces = [];
  const n = Math.min(outer.length, inner.length);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    faces.push(...prism([outer[i], outer[j], inner[j], inner[i]], z0, z1, top, hz, { side }));
  }
  return faces;
}

// Бордюр по периметру хозяина (поле curb): лента ширины width, высоты height.
function curbFaces(o, hz) {
  const c = o.curb;
  const C = objectColors({ kind: 'curb', variant: c.variant });
  const z1 = Math.max(20, c.height);
  const faces = [];
  for (const { pts, closed } of curbLines(o)) {
    if (closed) faces.push(...wallRing(insetPolygon(pts, -c.width / 2), insetPolygon(pts, c.width / 2), 0, z1, C[0], C[1], hz));
    else faces.push(...prism(ribbonOutline(pts, c.width), 0, z1, C[0], hz, { side: C[1] }));
  }
  return faces;
}

function variantOf(o, def) {
  const variant = def.variants.find((x) => x.id === o.variant);
  return variant?.colors?.[0] || null;
}

function outlineInset(o, d, rot) {
  return rectPoly(o.x, o.y, Math.max(100, o.w - d * 2), Math.max(100, o.h - d * 2), rot);
}

function along(line, s) {
  let rest = s;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]; const b = line[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= len || i === line.length - 1) {
      const t = len ? Math.min(1, rest / len) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= len;
  }
  return line[0];
}

// Все грани ландшафта в осях дома. hz(x, y) — рельеф (оси дома) или null.
export function landscapeFaces(project, hz = null) {
  const objects = project.site?.landscape?.objects || [];
  if (!objects.length) return [];
  const b = project.building;
  const local = (p) => toLocal(b, p);
  const rotB = b?.rotation || 0;
  const ground = hz || (() => 0);
  const faces = [];
  // Посадки в коробе стоят на засыпке: подъём = высота борта − 60.
  const lift = new Map(objects.filter((o) => o.kind === 'planter-box' || o.kind === 'planter-area')
    .map((o) => [o.id, Math.max(0, (o.height || 0) - 60)]));
  for (const o0 of objects) {
    const def = landscapeDef(o0.kind);
    if (!def || def.shape === 'note') continue; // выноски — только на плане
    const c = local(o0);
    // Копия объекта в осях дома: центр, поворот, вершины.
    const o = { ...o0, x: c.x, y: c.y, rotation: (o0.rotation || 0) - rotB };
    if (o0.points) o.points = o0.points.map(local);
    const outline = objectOutline(o, 16);
    const path = isPathShape(def) ? objectPath(o) : [];
    // Подъём: посадки в коробе — на засыпку; площадки с отметкой — на отметку.
    const elev = elevOf(o0);
    const up = (o0.parent ? lift.get(o0.parent) || 0 : 0) + elev;
    const hz2 = up ? (x, y) => ground(x, y) + up : ground;
    for (const f of objectFaces(o, def, outline, path, hz2)) faces.push(f);
    // Приподнятая площадка/лестница — на подиуме: бока от земли до отметки.
    if (elev > 0 && outline.length >= 3) {
      const C = objectColors({ kind: 'curb', variant: o.kind === 'deck-area' ? 'wood' : 'stone' });
      faces.push(...prism(outline, 0, elev, C[1], ground, { top: false }));
    }
    if (o.curb) for (const f of curbFaces(o, hz2)) faces.push(f);
  }
  return faces;
}

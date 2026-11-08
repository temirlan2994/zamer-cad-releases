// Проверка инвариантов стен растеризацией (сетка 10 мм). Не зависит от
// устройства deriveWalls: стена — это кусок с полигоном `poly` либо
// прямоугольником `band`; скрытые (hidden) не учитываются.
//
// Инварианты (ключи результата):
//  a holes     — нет дыр: замкнутая незанятая область внутри дома допустима
//                только как двор (обе стороны габарита ≥ 300 мм), щели — нет;
//  b coverage  — каждая точка границы закрытой комнаты снаружи покрыта стеной;
//  c intrusion — стены не заходят внутрь чистых контуров закрытых комнат
//                (кроме зоны вложенных комнат и шахт с их стенами); терраса
//                и балкон лежат под домом — стена дома может их накрывать;
//  d thickness — толщина стены по нормали к грани постоянна и равна заданной
//                (зазор до соседа ≤ 450 либо назначенная толщина);
//  e area      — сумма площадей кусков = площадь их объединения (нет наложений);
//  f fragments — нет «обломков»: каждая связная часть стен касается закрытой комнаты.

import { isOpenRoom, isShaft } from '../core/catalog.js';
import { roomBoundaryEdges, roomRects } from '../core/room-shape.js';
import { ownKey } from '../core/walls.js';

export const G = 10;
const MAX_GAP = 450;
const RAY = 100; // клеток (1 м) — дальше стену не меряем

function rectPoly(b) {
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
}

function polyArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function wallPieces(walls, { hidden = false } = {}) {
  const out = [];
  for (const w of walls) {
    if (w.hidden && !hidden) continue;
    // Будущий формат: wall.polys — несколько контуров (внешний + дыры не нужны:
    // область стен без дыр задаётся набором простых полигонов).
    const polys = w.polys || (w.poly ? [w.poly] : (w.band ? [rectPoly(w.band)] : []));
    for (const poly of polys) if (poly.length >= 3 && polyArea(poly) > 0) out.push({ wall: w, poly });
  }
  return out;
}

function makeGrid(project) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of project.rooms) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  // Ручные стены (схема 6) — тоже в габарите.
  for (const w of project.walls || []) {
    for (const p of [w.axis?.a, w.axis?.b]) {
      if (!p) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  const pad = 1500;
  x0 = Math.floor((x0 - pad) / G) * G; y0 = Math.floor((y0 - pad) / G) * G;
  const nx = Math.ceil((x1 + pad - x0) / G); const ny = Math.ceil((y1 + pad - y0) / G);
  return { x0, y0, nx, ny };
}

// Чётно-нечётная заливка полигона по центрам клеток.
function fillPoly(grid, arr, poly) {
  const { x0, y0, nx, ny } = grid;
  let minY = Infinity; let maxY = -Infinity;
  for (const p of poly) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const j0 = Math.max(0, Math.floor((minY - y0) / G)); const j1 = Math.min(ny - 1, Math.ceil((maxY - y0) / G));
  for (let j = j0; j <= j1; j += 1) {
    const yc = y0 + (j + 0.5) * G;
    const xs = [];
    for (let k = 0; k < poly.length; k += 1) {
      const a = poly[k]; const b = poly[(k + 1) % poly.length];
      if ((a.y <= yc) === (b.y <= yc)) continue;
      xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const iFrom = Math.max(0, Math.ceil((xs[k] - x0) / G - 0.5));
      const iTo = Math.min(nx - 1, Math.ceil((xs[k + 1] - x0) / G - 0.5) - 1);
      for (let i = iFrom; i <= iTo; i += 1) arr[j * nx + i] += 1;
    }
  }
}

function roomMask(grid, r, expand = 0) {
  const arr = new Uint8Array(grid.nx * grid.ny);
  for (const q of roomRects(r)) {
    fillPoly(grid, arr, rectPoly({ x: q.x - expand, y: q.y - expand, w: q.w + 2 * expand, h: q.h + 2 * expand }));
  }
  return arr;
}

function isInternal(project, r) {
  return isShaft(r) || Boolean(r.parentId && project.rooms.some((o) => o.id === r.parentId));
}

// Назначенная толщина собственной стены стороны комнаты.
function assignedThickness(project, r, side) {
  const s = project.settings || {};
  const own = Number(project.wallOverrides?.[ownKey(r.id, side)]?.thickness);
  if (own > 0) return own;
  return isInternal(project, r) ? (s.partition || 100) : (s.exterior || 250);
}

function maxAssigned(project, r) {
  return Math.max(...roomBoundaryEdges(r).map((e) => assignedThickness(project, r, e.side)));
}

function isAncestor(project, anc, r) {
  let cur = r;
  for (let guard = 0; cur?.parentId && guard < 10; guard += 1) {
    if (cur.parentId === anc.id) return true;
    cur = project.rooms.find((o) => o.id === cur.parentId);
  }
  return false;
}

function fmt(grid, idx) {
  const i = idx % grid.nx; const j = Math.floor(idx / grid.nx);
  return `(${grid.x0 + i * G + G / 2}, ${grid.y0 + j * G + G / 2})`;
}

export function checkWallInvariants(project, walls) {
  const grid = makeGrid(project);
  const { nx, ny } = grid;
  const N = nx * ny;
  // Скрытая стена («линия разделения») не рисуется, но входит в область стен W:
  // для геометрических инвариантов она — обычная стена.
  const pieces = wallPieces(walls, { hidden: true });
  const count = new Uint16Array(N);
  const manualCount = new Uint16Array(N); // клетки ручных стен (source: 'manual')
  let pieceArea = 0;
  for (const p of pieces) {
    fillPoly(grid, count, p.poly);
    if (p.wall.source === 'manual') fillPoly(grid, manualCount, p.poly);
    pieceArea += polyArea(p.poly);
  }
  const wall = (k) => count[k] > 0;
  const manual = (k) => manualCount[k] > 0;

  // g — скрытая стена не забирает углы и узлы видимых: её куски — внутри её
  // собственной полосы band (угол ведёт видимая стена).
  const grabs = [];
  for (const p of pieces) {
    if (!p.wall.hidden || !p.wall.band) continue;
    const one = new Uint8Array(N);
    fillPoly(grid, one, p.poly);
    const b = p.wall.band;
    let n = 0; let first = -1;
    for (let k = 0; k < N; k += 1) {
      if (!one[k]) continue;
      const x = grid.x0 + (k % nx + 0.5) * G; const y = grid.y0 + (Math.floor(k / nx) + 0.5) * G;
      if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) { n += 1; if (first < 0) first = k; }
    }
    if (n) grabs.push(`${p.wall.key}: ${n * G * G / 1e6} м² у ${fmt(grid, first)}`);
  }
  const hiddenCheck = { ok: grabs.length === 0, count: grabs.length, sample: grabs.slice(0, 3) };

  const rooms = project.rooms;
  const masks = new Map(rooms.map((r) => [r.id, roomMask(grid, r)]));
  const closed = rooms.filter((r) => !isOpenRoom(r));
  const shafts = rooms.filter((r) => isShaft(r));
  const shaftZone = new Uint8Array(N); // шахта вместе со своими стенами
  for (const s of shafts) {
    const em = roomMask(grid, s, maxAssigned(project, s));
    for (let k = 0; k < N; k += 1) if (em[k]) shaftZone[k] = 1;
  }
  const cell = (x, y) => {
    const i = Math.floor((x - grid.x0) / G); const j = Math.floor((y - grid.y0) / G);
    return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i;
  };
  const result = { hidden: hiddenCheck };

  // a — дыры.
  const occupied = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) if (wall(k)) occupied[k] = 1;
  for (const m of masks.values()) for (let k = 0; k < N; k += 1) if (m[k]) occupied[k] = 1;
  const seen = new Uint8Array(N);
  const stack = [];
  for (let i = 0; i < nx; i += 1) { stack.push(i, (ny - 1) * nx + i); }
  for (let j = 0; j < ny; j += 1) { stack.push(j * nx, j * nx + nx - 1); }
  while (stack.length) {
    const k = stack.pop();
    if (seen[k] || occupied[k]) continue;
    seen[k] = 1;
    const i = k % nx;
    if (i > 0) stack.push(k - 1);
    if (i < nx - 1) stack.push(k + 1);
    if (k >= nx) stack.push(k - nx);
    if (k < N - nx) stack.push(k + nx);
  }
  // Замкнутые пустоты: компоненты связности; узкие (< 300 мм) — щели.
  const holes = [];
  for (let k0 = 0; k0 < N; k0 += 1) {
    if (occupied[k0] || seen[k0]) continue;
    const comp = [];
    let i0 = Infinity; let i1 = -Infinity; let j0 = Infinity; let j1 = -Infinity;
    stack.push(k0);
    while (stack.length) {
      const k = stack.pop();
      if (seen[k] || occupied[k]) continue;
      seen[k] = 1; comp.push(k);
      const i = k % nx; const j = Math.floor(k / nx);
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      if (i > 0) stack.push(k - 1);
      if (i < nx - 1) stack.push(k + 1);
      if (k >= nx) stack.push(k - nx);
      if (k < N - nx) stack.push(k + nx);
    }
    if (Math.min(i1 - i0 + 1, j1 - j0 + 1) * G < 300) holes.push(...comp);
  }
  result.holes = { ok: holes.length === 0, count: holes.length, sample: holes.slice(0, 3).map((k) => fmt(grid, k)) };

  // c — стены внутри комнат.
  const intrusions = [];
  for (const r of rooms) {
    // Открытая площадка (терраса, балкон) лежит под домом: стена дома
    // может заходить на неё — стены не меняются от примыкания террасы.
    if (isOpenRoom(r)) continue;
    const m = masks.get(r.id);
    const carved = new Uint8Array(N);
    for (const s of rooms) {
      if (s === r) continue;
      if (!isAncestor(project, r, s) && !(isShaft(s) && !isShaft(r))) continue;
      const em = roomMask(grid, s, maxAssigned(project, s));
      for (let k = 0; k < N; k += 1) if (em[k]) carved[k] = 1;
    }
    let n = 0; let first = -1;
    for (let k = 0; k < N; k += 1) {
      // Ручная стена внутри комнаты — решение пользователя, не дефект (c).
      if (m[k] && wall(k) && !manual(k) && !carved[k]) { n += 1; if (first < 0) first = k; }
    }
    if (n) intrusions.push(`${r.id}: ${n * G * G / 1e6} м² от ${fmt(grid, first)}`);
  }
  result.intrusion = { ok: intrusions.length === 0, count: intrusions.length, sample: intrusions.slice(0, 3) };

  // b, d — обход граней закрытых комнат.
  const uncovered = [];
  const bumps = [];
  for (const r of closed) {
    for (const e of roomBoundaryEdges(r)) {
      const out = e.orient === 'h' ? [0, e.outward] : [e.outward, 0];
      const base = e.orient === 'h' ? { x: 0, y: e.edge } : { x: e.edge, y: 0 };
      for (let t = e.from + G / 2; t < e.to; t += G) {
        const at = (k) => ({
          x: (e.orient === 'h' ? t : base.x) + out[0] * (k + 0.5) * G,
          y: (e.orient === 'h' ? base.y : t) + out[1] * (k + 0.5) * G,
        });
        const p0 = at(0);
        const k0 = cell(p0.x, p0.y);
        if (k0 < 0) continue;
        const inShaft = shafts.some((s) => s !== r && masks.get(s.id)[k0]);
        if (inShaft) continue; // стену здесь «съела» шахта — проверяем только (c)
        if (!wall(k0)) uncovered.push(`${r.id}/${e.side} ${fmt(grid, k0)}`);
        // d — замер толщины лучом наружу.
        const hosts = rooms.filter((o) => masks.get(o.id)[k0]); // комнаты, где стартует луч (родитель)
        const stops = rooms.filter((o) => o !== r && !hosts.includes(o));
        let measured = 0; let dist = Infinity; let nearShaft = false; let viaManual = false;
        for (let k = 0; k < RAY; k += 1) {
          const p = at(k); const kk = cell(p.x, p.y);
          if (kk < 0) break;
          if (stops.some((o) => masks.get(o.id)[kk])) { dist = k * G; break; }
          if (!wall(kk)) break;
          if (shaftZone[kk]) nearShaft = true;
          if (manual(kk)) viaManual = true;
          measured = (k + 1) * G;
        }
        if (measured === 0) continue; // это уже нарушение (b)
        // Луч прошёл через ручную стену (узел, продолжение) — толщина комнатной
        // стены здесь не определена.
        if (viaManual) continue;
        // Луч стартует в теле перпендикулярной стены той же комнаты (у
        // вогнутого угла) — он идёт вдоль её оси, это не толщина.
        const inPerp = roomBoundaryEdges(r).some((e2) => {
          if (e2.orient === e.orient) return false;
          const along = e2.orient === 'h' ? p0.x : p0.y;
          const across = ((e2.orient === 'h' ? p0.y : p0.x) - e2.edge) * e2.outward;
          return along > e2.from && along < e2.to && across > 0 && across < assignedThickness(project, r, e2.side) + G;
        });
        if (inPerp) continue;
        // Луч на всю длину — он идёт вдоль оси перпендикулярной стены (угол,
        // Т-узел), это не толщина. Стены шахты — отдельная конструкция.
        if (measured >= RAY * G || nearShaft) continue;
        // Две собственные стены спина к спине ровно заполняют зазор между
        // комнатами (зазор > перегородки, ≤ сумме их толщин) — не бугор.
        const stopAt = Number.isFinite(dist) ? stops.find((o) => { const p = at(dist / G); const kk = cell(p.x, p.y); return kk >= 0 && masks.get(o.id)[kk]; }) : null;
        if (stopAt && Math.abs(measured - dist) <= G &&
          dist <= assignedThickness(project, r, e.side) + maxAssigned(project, stopAt) + G) continue;
        let expected;
        if (dist <= MAX_GAP) expected = dist;
        else {
          // Назначенная толщина: максимум по всем коллинеарным граням закрытых
          // комнат с тем же направлением наружу (вложенная у грани родителя).
          expected = assignedThickness(project, r, e.side);
          for (const o of closed) {
            if (o === r) continue;
            for (const oe of roomBoundaryEdges(o)) {
              if (oe.orient !== e.orient || oe.outward !== e.outward || Math.abs(oe.edge - e.edge) > 0.5) continue;
              if (t < oe.from || t > oe.to) continue;
              expected = Math.max(expected, assignedThickness(project, o, oe.side));
            }
          }
        }
        if (Math.abs(measured - expected) > G) bumps.push(`${r.id}/${e.side} ${fmt(grid, k0)}: ${measured} вместо ${expected}`);
      }
    }
  }
  result.coverage = { ok: uncovered.length === 0, count: uncovered.length, sample: uncovered.slice(0, 3) };
  result.thickness = { ok: bumps.length === 0, count: bumps.length, sample: bumps.slice(0, 3) };

  // f — обломки: компонента стен без соседства с чистым контуром закрытой комнаты.
  const anyClosed = new Uint8Array(N);
  for (const r of closed) { const m = masks.get(r.id); for (let k = 0; k < N; k += 1) if (m[k]) anyClosed[k] = 1; }
  const wseen = new Uint8Array(N);
  const fragments = [];
  for (let k0 = 0; k0 < N; k0 += 1) {
    if (!wall(k0) || wseen[k0]) continue;
    let touches = false; let size = 0;
    stack.push(k0);
    while (stack.length) {
      const k = stack.pop();
      if (wseen[k] || !wall(k)) continue;
      wseen[k] = 1; size += 1;
      if (manual(k)) touches = true; // ручная стена может стоять отдельно
      const i = k % nx;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k >= nx ? k - nx : -1, k < N - nx ? k + nx : -1];
      for (const q of nb) {
        if (q < 0) continue;
        if (anyClosed[q] || anyClosed[k]) touches = true;
        if (wall(q) && !wseen[q]) stack.push(q);
      }
    }
    if (!touches) fragments.push(`${(size * G * G / 1e6).toFixed(4)} м² у ${fmt(grid, k0)}`);
  }
  result.fragments = { ok: fragments.length === 0, count: fragments.length, sample: fragments.slice(0, 3) };

  // e — площади.
  let cells = 0;
  for (let k = 0; k < N; k += 1) if (count[k]) cells += 1;
  const unionArea = cells * G * G;
  const diff = pieceArea - unionArea;
  result.area = {
    ok: Math.abs(diff) <= Math.max(1e4, unionArea * 0.002),
    count: Math.round(diff / 1e4) / 100,
    sample: [`сумма кусков ${(pieceArea / 1e6).toFixed(3)} м², объединение ${(unionArea / 1e6).toFixed(3)} м²`],
  };
  return result;
}

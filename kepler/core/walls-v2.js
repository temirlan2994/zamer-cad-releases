// Стены v2: стена — область (docs/walls-geometry-design.md, этапы A–B
// docs/walls-v2-architecture.md). Стены, выведенные из комнат, и ручные
// стены этажа (project.walls, source: 'manual') — в одной области W.
//
//   W = ⋃_r ( Ring_r \ ⋃_{s ∉ Anc(r)} P_s ),
//   Ring_r — выдавливание сегментов рёбер комнаты r наружу на их толщину плюс
//   угловые прямоугольники t_prev × t_next в вершинах.
//
// Всё ортогонально, поэтому вместо полигонального отсечения — сжатая сетка
// (core/ortho-grid.js): клетка входит в W, если её покрывает прямоугольник
// кольца r и она не лежит в чужой комнате s ∉ Anc(r). Каждая клетка получает
// одного владельца (сегмент) — куски стен не пересекаются, заплатки
// joint/chamfer и удлинение углов не нужны.
//
// Записи — те же, что у deriveWalls v1 (kind own/shared, key, from/to, band,
// center, edge, outward, rooms, sides, thickness, wallType, hidden); band —
// чистое выдавливание сегмента. Новое: rects (непересекающиеся куски области
// этого сегмента) и polys (их контуры).

import { isOpenRoom, isShaft } from './catalog.js';
import { roomContainsPoint, roomRects } from './room-shape.js';
import { cutWallsInsideShafts, wallRects, wallSegments } from './walls.js';
import { gridAxis, mergeCells, rectsCycles, snapHalf } from './ortho-grid.js';
import { wallBodies } from './v7/wall-body.js';

const TYPE_RANK = { exterior: 3, bearing: 2, partition: 1 };

// Ступенька тоньше JOG_TOL мм — шум, а не замысел: помещения стоят со сдвигом
// на 10–50 мм (неточная расстановка, съедание по номиналу соседа). Раньше
// каждый такой сдвиг давал в стене ступеньку, а микроребро помещения —
// свою стену полной толщины поперёк (зубец/выступ на стыке). Теперь:
//   • участок стены короче JOG_TOL своей полосы и углов не строит;
//   • угловой прямоугольник ставится только в выпуклой вершине помещения
//     (в вогнутой он лишний, а при укороченной соседней полосе торчал);
//   • после раздачи клеток ступеньки тоньше JOG_TOL в теле стен заполняются
//     в сторону прироста тела (fillThinSteps): грань стены — одна прямая,
//     внутренняя грань закрывает полоску пола, наружные — заподлицо.
export const JOG_TOL = 50;

// Сравнение сегментов при равной близости: shared > own, толще, класс
// (наружная > несущая > перегородка), ключ, начало. < 0 — a лучше.
function segOrder(a, b) {
  if (a.kind !== b.kind) return a.kind === 'shared' ? -1 : 1;
  if (Math.abs(a.thickness - b.thickness) > 0.5) return b.thickness - a.thickness;
  const ra = TYPE_RANK[a.wallType] || 0;
  const rb = TYPE_RANK[b.wallType] || 0;
  if (ra !== rb) return rb - ra;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.from - b.from;
}

function overlaps(a, b, eps = 0.5) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > eps &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > eps;
}

function inRect(r, x, y, eps = 0) {
  return x >= r.x - eps && x <= r.x + r.w + eps && y >= r.y - eps && y <= r.y + r.h + eps;
}

// ---------------------------------------------------------------- Ручные стены
//
// Ручная стена (level.walls[], core/wall-manual.js) — ось-отрезок a→b в осях
// дома, толщина и привязка justify: какая грань тела лежит на оси —
// 'center' (ось посередине), 'left' (левая грань по направлению a→b, тело
// справа), 'right' (правая грань, тело слева). Ось Y вниз: «слева» от
// направления (dx, dy) — нормаль (dy, −dx).
//
// Ось может быть под любым углом. Ортогональные стены по-прежнему проходят
// через сжатую сетку v2; косые получают точное полигональное тело через
// core/v7/wall-body.js (тот же миттер L/T/X, что у нового ядра).
export function manualWallGeometry(wall) {
  const a = wall?.axis?.a;
  const b = wall?.axis?.b;
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let orient;
  if (Math.abs(dy) < 0.5 && Math.abs(dx) >= 1) orient = 'h';
  else if (Math.abs(dx) < 0.5 && Math.abs(dy) >= 1) orient = 'v';
  else orient = 'a';
  const t = Number(wall.thickness) > 0 ? Number(wall.thickness) : 100;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const tangent = { x: dx / length, y: dy / length };
  const left = { x: tangent.y, y: -tangent.x };
  if (orient === 'a') {
    let lo = -t / 2; let hi = t / 2;
    if (wall.justify === 'left') { lo = -t; hi = 0; }
    else if (wall.justify === 'right') { lo = 0; hi = t; }
    const at = (p, off) => ({ x: p.x + left.x * off, y: p.y + left.y * off });
    const poly = [at(a, lo), at(b, lo), at(b, hi), at(a, hi)];
    const xs = poly.map((p) => p.x); const ys = poly.map((p) => p.y);
    return {
      orient, from: 0, to: length, line: 0, lo, hi, length, thickness: t,
      dir: 1, leftSign: 1, axisStart: 0, tangent, normal: left,
      a: { ...a }, b: { ...b }, poly,
      band: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      center: { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
    };
  }
  const line = orient === 'h' ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
  const from = orient === 'h' ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
  const to = orient === 'h' ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
  const dir = Math.sign(orient === 'h' ? dx : dy);
  const leftSign = orient === 'h' ? -dir : dir; // поперечный знак «слева»
  let lo; let hi;
  if (wall.justify === 'left') { const far = line - leftSign * t; lo = Math.min(line, far); hi = Math.max(line, far); }
  else if (wall.justify === 'right') { const far = line + leftSign * t; lo = Math.min(line, far); hi = Math.max(line, far); }
  else { lo = line - t / 2; hi = line + t / 2; }
  const band = orient === 'h'
    ? { x: from, y: lo, w: to - from, h: hi - lo }
    : { x: lo, y: from, w: hi - lo, h: to - from };
  const mid = (lo + hi) / 2;
  return {
    orient, from, to, line, lo, hi, band, thickness: t, dir, leftSign,
    length, tangent, normal: left, a: { ...a }, b: { ...b },
    axisStart: orient === 'h' ? a.x : a.y,
    center: orient === 'h' ? { x1: from, y1: mid, x2: to, y2: mid } : { x1: mid, y1: from, x2: mid, y2: to },
  };
}

// Высота стены этажа: низ/верх от пола этажа (мм). top.level — отметка
// другого этажа + offset; иначе top.height; иначе чистая высота этажа.
function manualWallZ(project, wall) {
  const levels = project.levels || [];
  const level = levels.find((l) => l.id === project.activeLevel) || levels[0] || null;
  const levelH = Number(level?.height) > 0 ? Number(level.height) : 3000;
  const elev = Number(level?.elevation) || 0;
  const z0 = Number(wall.base?.offset) || 0;
  let z1;
  const topLevel = wall.top?.level ? levels.find((l) => l.id === wall.top.level) : null;
  if (topLevel) z1 = (Number(topLevel.elevation) || 0) - elev + (Number(wall.top.offset) || 0);
  else if (Number(wall.top?.height) > 0) z1 = z0 + Number(wall.top.height);
  else z1 = levelH - 300; // как roomCeiling: высота этажа − плита
  return { z0, z1: Math.max(z0 + 1, z1) };
}

// Запись-сегмент ручной стены (до атрибуции клеток).
function manualSegment(project, wall, g) {
  return {
    key: `m|${wall.id}`, kind: 'manual', source: 'manual', wallId: wall.id,
    orient: g.orient, rooms: [], sides: {},
    from: g.from, to: g.to, edge: g.line, outward: g.leftSign,
    axisStart: g.axisStart, axisDir: g.dir, justify: wall.justify || 'center',
    thickness: g.thickness, band: { ...g.band }, center: { ...g.center },
    wallType: wall.wallType || 'partition', hidden: Boolean(wall.hidden),
    roomBounding: wall.roomBounding !== false,
    ...manualWallZ(project, wall),
  };
}

// Удлинение торцов ручной стены до дальней грани поперечной стены, на
// которой (или в 1 мм от грани/оси которой) лежит торец: узел без щели.
// Лишнее отсекает объединение — клетки чужой полосы остаются её.
function extendManualEnds(seg, others) {
  const ext = { ...seg.band };
  const h = seg.orient === 'h';
  for (const end of ['from', 'to']) {
    const along = seg[end];
    const px = h ? along : seg.edge;
    const py = h ? seg.edge : along;
    let reach = along;
    for (const o of others) {
      if (o.self === seg) continue;
      if (o.orient && o.orient === seg.orient) continue; // продолжение по прямой — не узел
      const r = o.rect;
      if (!inRect(r, px, py, 1)) continue;
      const lo = h ? r.x : r.y;
      const hi = h ? r.x + r.w : r.y + r.h;
      if (end === 'from') reach = Math.min(reach, lo);
      else reach = Math.max(reach, hi);
    }
    if (h) {
      if (end === 'from') { ext.w += ext.x - reach; ext.x = reach; } else ext.w = reach - ext.x;
    } else if (end === 'from') { ext.h += ext.y - reach; ext.y = reach; } else ext.h = reach - ext.y;
  }
  return ext;
}

function appendAngledManualWalls(records, project, manualWalls) {
  const manual = manualWalls.map((wall) => ({ wall, geometry: manualWallGeometry(wall) }));
  const angled = manual.filter((entry) => entry.geometry?.orient === 'a');
  if (!angled.length) return records;
  const source = manual.map(({ wall }) => ({
    id: wall.id, a: wall.axis.a, b: wall.axis.b, thickness: wall.thickness,
    justify: wall.justify, wallType: wall.wallType, hidden: wall.hidden,
  }));
  const bodies = new Map(wallBodies(source).map((body) => [body.id, body]));
  for (const { wall, geometry: g } of angled) {
    const body = bodies.get(wall.id);
    const poly = body?.polygon?.[0]?.[0] || g.poly;
    const xs = poly.map((p) => p.x); const ys = poly.map((p) => p.y);
    records.push({
      key: `m|${wall.id}`, kind: 'manual', source: 'manual', wallId: wall.id,
      orient: 'a', rooms: [], sides: {}, from: 0, to: g.length, edge: 0,
      axisStart: 0, axisDir: 1, justify: wall.justify || 'center',
      thickness: g.thickness, wallType: wall.wallType || 'partition', hidden: Boolean(wall.hidden),
      roomBounding: wall.roomBounding !== false, band: {
        x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
      },
      center: { ...g.center }, tangent: g.tangent, normal: g.normal,
      poly, polys: [poly], ...manualWallZ(project, wall),
    });
  }
  return records;
}

export function deriveWallsV2(project) {
  const rooms = project.rooms || [];
  const manualWalls = project.walls || [];
  const n = rooms.length;
  const roomIndex = new Map(rooms.map((r, i) => [r.id, i]));
  const { walls: roomSegs, faces } = wallSegments(project, { covered: false });
  for (const s of roomSegs) s.source = 'room';
  // Ручные стены этажа — те же сегменты, но со своей областью (не режутся
  // чужими помещениями) и с удлинёнными торцами в узлах.
  const manualSegs = [];
  for (const w of manualWalls) {
    const g = manualWallGeometry(w);
    if (g && g.orient !== 'a') manualSegs.push(manualSegment(project, w, g));
  }
  const segs = [...roomSegs, ...manualSegs];

  // Anc(r): комнаты, внутри которых стенам r можно быть — предки по parentId;
  // у шахты ещё и все комнаты, которые она (со своими стенами) перекрывает.
  const anc = rooms.map(() => new Uint8Array(n));
  const maxThick = new Float64Array(n);
  for (const s of segs) for (const id of s.rooms) {
    const i = roomIndex.get(id);
    if (i !== undefined) maxThick[i] = Math.max(maxThick[i], s.thickness);
  }
  rooms.forEach((r, i) => {
    let cur = r;
    for (let guard = 0; cur?.parentId && guard < 20; guard += 1) {
      const pi = roomIndex.get(cur.parentId);
      if (pi === undefined) break;
      anc[i][pi] = 1;
      cur = rooms[pi];
    }
    if (!isShaft(r)) return;
    const t = maxThick[i];
    const zone = roomRects(r).map((q) => ({ x: q.x - t, y: q.y - t, w: q.w + 2 * t, h: q.h + 2 * t }));
    rooms.forEach((o, k) => {
      if (k === i || isShaft(o)) return;
      if (roomRects(o).some((q) => zone.some((z) => overlaps(q, z)))) anc[i][k] = 1;
    });
  });

  // Кандидаты-прямоугольники: полосы сегментов и угловые прямоугольники.
  const cands = [];
  const allowedOf = (ids) => {
    const a = new Uint8Array(n);
    for (const id of ids) {
      const i = roomIndex.get(id);
      if (i === undefined) continue;
      for (let k = 0; k < n; k += 1) if (anc[i][k]) a[k] = 1;
    }
    return a;
  };
  // Микроучасток (сдвиг помещений, ребро-ступенька): без своей полосы.
  const micro = (seg) => seg.source !== 'manual' && seg.to - seg.from <= JOG_TOL + 0.25;
  segs.forEach((seg, si) => {
    const b = seg.band;
    if (seg.source === 'manual' || !b || b.w <= 0.25 || b.h <= 0.25 || micro(seg)) return;
    const f = faces.get(seg) || {};
    cands.push({
      x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, si, corner: false,
      allowed: allowedOf(seg.rooms), faceEdges: Object.values(f).map((q) => q.edge),
    });
  });
  // Углы: пара сегментов одной комнаты (горизонтальный и вертикальный), чьи
  // концы сходятся в вершине контура. Прямоугольник t_v × t_h наружу от
  // вершины; владелец — видимый более толстый сегмент. В вогнутой вершине он
  // целиком внутри полос — не мешает.
  const byRoom = new Map();
  segs.forEach((seg, si) => {
    const f = faces.get(seg);
    if (!f || micro(seg)) return;
    for (const [id, face] of Object.entries(f)) {
      if (!byRoom.has(id)) byRoom.set(id, []);
      byRoom.get(id).push({ si, seg, edge: face.edge, outward: face.outward });
    }
  });
  const near = (a, b) => Math.abs(a - b) < 0.75;
  for (const [id, list] of byRoom) {
    const hs = list.filter((q) => q.seg.orient === 'h');
    const vs = list.filter((q) => q.seg.orient === 'v');
    const room = rooms[roomIndex.get(id)];
    for (const h of hs) {
      for (const v of vs) {
        // Вершина (v.edge, h.edge) — конец обоих сегментов.
        if (!(near(h.seg.from, v.edge) || near(h.seg.to, v.edge))) continue;
        if (!(near(v.seg.from, h.edge) || near(v.seg.to, h.edge))) continue;
        const cx = v.edge; const cy = h.edge;
        // Вогнутая вершина: четверть «наружу от v, внутрь от h» — в помещении.
        // Там угол закрывают сами полосы; прямоугольник лишний и при
        // укороченной/суженной соседней полосе давал выступ.
        if (room && roomContainsPoint(room, cx + v.outward, cy - h.outward)) continue;
        const x2 = cx + v.outward * v.seg.thickness;
        const y2 = cy + h.outward * h.seg.thickness;
        // Владелец угла: видимый, затем более толстый (наружная стена ведёт
        // угол над перегородкой), затем общий порядок.
        let owner;
        if (Boolean(h.seg.hidden) !== Boolean(v.seg.hidden)) owner = h.seg.hidden ? v : h;
        else if (Math.abs(h.seg.thickness - v.seg.thickness) > 0.5) owner = h.seg.thickness > v.seg.thickness ? h : v;
        else owner = segOrder(h.seg, v.seg) <= 0 ? h : v;
        cands.push({
          x0: Math.min(cx, x2), y0: Math.min(cy, y2), x1: Math.max(cx, x2), y1: Math.max(cy, y2),
          si: owner.si, corner: true, allowed: allowedOf([id]), faceEdges: [],
        });
      }
    }
  }

  // Ручные стены: полоса тела, торцы продлены в узлах; помещения их не режут
  // (free). core — тело без продления: в нём ручная стена спорит с комнатной
  // на равных (крест), продление уступает любой стене.
  const nodeRects = [
    ...cands.map((c) => ({ rect: { x: c.x0, y: c.y0, w: c.x1 - c.x0, h: c.y1 - c.y0 }, orient: c.corner ? null : segs[c.si].orient, self: segs[c.si] })),
    ...manualSegs.map((s) => ({ rect: s.band, orient: s.orient, self: s })),
  ];
  segs.forEach((seg, si) => {
    if (seg.source !== 'manual' || seg.band.w <= 0.25 || seg.band.h <= 0.25) return;
    const e = extendManualEnds(seg, nodeRects);
    cands.push({
      x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h, si, corner: false,
      manual: true, free: true, core: seg.band, faceEdges: [],
    });
  });

  // Сетка.
  // Открытые помещения (терраса, балкон) клетки не занимают: стены дома
  // поверх них не режутся — терраса лежит под домом.
  const roomBoxes = rooms.map((r) => (isOpenRoom(r) ? [] : roomRects(r)));
  const xsRaw = []; const ysRaw = [];
  for (const c of cands) { xsRaw.push(c.x0, c.x1); ysRaw.push(c.y0, c.y1); }
  for (const list of roomBoxes) for (const q of list) { xsRaw.push(q.x, q.x + q.w); ysRaw.push(q.y, q.y + q.h); }
  const ax = gridAxis(xsRaw);
  const ay = gridAxis(ysRaw);
  const xs = ax.coords; const ys = ay.coords;
  const nx = Math.max(0, xs.length - 1); const ny = Math.max(0, ys.length - 1);
  const N = nx * ny;

  // Какие комнаты покрывают клетку (обычно одна; вложенные/шахты — несколько).
  const cover = new Int32Array(N).fill(-1);
  const multi = new Map();
  roomBoxes.forEach((list, ri) => {
    for (const q of list) {
      const i0 = ax.at(q.x); const i1 = ax.at(q.x + q.w); const j0 = ay.at(q.y); const j1 = ay.at(q.y + q.h);
      for (let j = j0; j < j1; j += 1) {
        for (let i = i0; i < i1; i += 1) {
          const k = j * nx + i;
          if (cover[k] < 0) cover[k] = ri;
          else if (cover[k] !== ri) {
            const m = multi.get(k);
            if (m) { if (!m.includes(ri)) m.push(ri); } else multi.set(k, [ri]);
          }
        }
      }
    }
  });
  const permitted = (allowed, k) => {
    if (cover[k] < 0) return true;
    if (!allowed[cover[k]]) return false;
    const m = multi.get(k);
    return !m || m.every((ri) => allowed[ri]);
  };

  // Владелец клетки.
  const best = new Int32Array(N).fill(-1);
  const bestDist = new Float64Array(N);
  cands.forEach((c, ci) => {
    const seg = segs[c.si];
    const i0 = ax.at(c.x0); const i1 = ax.at(c.x1); const j0 = ay.at(c.y0); const j1 = ay.at(c.y1);
    for (let j = j0; j < j1; j += 1) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      for (let i = i0; i < i1; i += 1) {
        const k = j * nx + i;
        if (!c.free && !permitted(c.allowed, k)) continue;
        const cx = (xs[i] + xs[i + 1]) / 2;
        let d = Infinity;
        if (!c.corner) {
          const across = seg.orient === 'h' ? cy : cx;
          for (const e of c.faceEdges) d = Math.min(d, Math.abs(across - e));
        }
        const cur = best[k];
        if (cur < 0) { best[k] = ci; bestDist[k] = d; continue; }
        const o = cands[cur];
        const oseg = segs[o.si];
        let better;
        if (Boolean(seg.hidden) !== Boolean(oseg.hidden)) better = !seg.hidden;
        else if (c.manual || o.manual) better = manualBetter(c, seg, o, oseg, cx, cy);
        else if (Math.abs(d - bestDist[k]) > 0.25 && (Number.isFinite(d) || Number.isFinite(bestDist[k]))) better = d < bestDist[k];
        else better = segOrder(seg, oseg) < 0;
        if (better) { best[k] = ci; bestDist[k] = d; }
      }
    }
  });

  // Ступеньки тоньше JOG_TOL — заподлицо (клетка может отойти стене, если
  // лежит вне помещений или в помещении этой стены / его предке).
  const ownRooms = segs.map((seg) => new Set((seg.rooms || []).map((id) => roomIndex.get(id)).filter((i) => i !== undefined)));
  // bound — владелец клетки-ступеньки, к которой выравнивается грань (−1 —
  // щель). Вне помещений (наружная грань) выравниваются только стены одной
  // толщины: уступ от разной толщины (300 и 250) — замысел, не шум.
  const canFill = (ci, k, bound) => {
    const c = cands[ci];
    if (cover[k] < 0) {
      return bound < 0 || Math.abs(segs[c.si].thickness - segs[cands[bound].si].thickness) <= 0.5;
    }
    if (c.free) return true;
    const own = ownRooms[c.si];
    const ok = (ri) => own.has(ri) || (c.allowed && c.allowed[ri]);
    if (!ok(cover[k])) return false;
    const m = multi.get(k);
    return !m || m.every(ok);
  };
  fillThinSteps(best, (ci) => !segs[cands[ci].si].hidden, canFill, xs, ys, (k) => cover[k] >= 0);

  // Сегмент → записи (у шахт сегмент режется на куски, как в v1).
  const records = [];
  const piecesOf = segs.map((seg) => {
    const parts = [{ ...seg, band: { ...seg.band }, center: { ...seg.center } }];
    if (seg.source !== 'manual') cutWallsInsideShafts(parts, rooms);
    for (const p of parts) records.push(p);
    return parts;
  });
  const recordIndex = new Map(records.map((r, i) => [r, i]));
  const phantom = new Map(); // сегмент без кусков, но с клетками
  const label = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k += 1) {
    const ci = best[k];
    if (ci < 0) continue;
    const si = cands[ci].si;
    const seg = segs[si];
    const parts = piecesOf[si];
    let rec;
    if (!parts.length) {
      if (!phantom.has(si)) {
        const p = { ...seg, band: { ...seg.band }, center: { ...seg.center } };
        phantom.set(si, p);
        recordIndex.set(p, records.length);
        records.push(p);
      }
      rec = phantom.get(si);
    } else if (parts.length === 1) rec = parts[0];
    else {
      const i = k % nx; const j = Math.floor(k / nx);
      const along = seg.orient === 'h' ? (xs[i] + xs[i + 1]) / 2 : (ys[j] + ys[j + 1]) / 2;
      let bestGap = Infinity;
      for (const p of parts) {
        const gap = along < p.from ? p.from - along : (along > p.to ? along - p.to : 0);
        if (gap < bestGap) { bestGap = gap; rec = p; }
      }
    }
    label[k] = recordIndex.get(rec);
  }

  const merged = mergeCells(label, xs, ys);
  records.forEach((rec, i) => {
    const rects = (merged.get(i) || []).filter((r) => r.w > 0.25 && r.h > 0.25);
    rec.rects = rects;
    rec.polys = recordPolys(rects);
  });
  // Главный путь (проекты без ручных стен) остаётся без дополнительных
  // полигональных вычислений — это важно для больших планов.
  if (!manualWalls.length) return records;
  // Косые ручные стены не раскладываем на ортогональную сетку. Полигональное
  // ядро строит их вместе со всеми ручными стенами, поэтому узел с прямой
  // стеной получает аккуратный миттер, а не щель или торчащий торец.
  return appendAngledManualWalls(records, project, manualWalls);
}

// Спор за клетку, где хотя бы один кандидат — ручная стена. Продление торца
// (вне тела core) уступает любой стене; затем толще; при равенстве — ручная;
// две ручные — по ключу.
function manualBetter(c, seg, o, oseg, x, y) {
  const ext = (q) => Boolean(q.manual) && !inRect(q.core, x, y, 0.25);
  const ec = ext(c);
  const eo = ext(o);
  if (ec !== eo) return !ec;
  if (Math.abs(seg.thickness - oseg.thickness) > 0.5) return seg.thickness > oseg.thickness;
  if (Boolean(c.manual) !== Boolean(o.manual)) return Boolean(c.manual);
  if (seg.key !== oseg.key) return seg.key < oseg.key;
  return seg.from < oseg.from;
}

// Заполнение ступенек тела стен тоньше JOG_TOL на сжатой сетке. best —
// владелец клетки (−1 — пусто), visible(ci) — видна ли стена владельца,
// canFill(ci, k, bound) — можно ли стене занять клетку (bound — владелец
// ступеньки, к которой выравнивается грань; −1 — щель). Полоса сетки (столбец или
// строка) тоньше JOG_TOL просматривается вдоль; пустая клетка рядом с видимой
// стеной поперёк полосы:
//   • стена с обеих сторон — щель, заполняется;
//   • стена с одной стороны — заполняется, если ряд таких клеток вдоль полосы
//     упирается в ступеньку: клетку полосы, занятую стеной с той же стороны
//     и свободную с другой (грань продолжается на соседней линии). Ряд у
//     поперечной стены (занято с обеих сторон) не трогается — иначе стены
//     толстели бы от посторонних линий сетки.
// Заполнение идёт только в сторону прироста тела: грань — одна прямая.
// Последним проходом щели между видимой и скрытой стеной отходят скрытой
// (грань видимой не сдвигается, а в области стен нет дыры).
// Клетка тоньше JOG_TOL по обеим осям вне помещений, окружённая стенами и
// помещениями (≥ 2 стены), — пустота-зубец у узла: тоже заполняется
// (inRoom(k) — клетка в помещении).
export function fillThinSteps(best, visible, canFill, xs, ys, inRoom = () => false) {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx <= 0 || ny <= 0) return;
  let any = false; // последний проход: скрытые — тоже стена, только щели
  const ownerAt = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    const ci = best[j * nx + i];
    return ci >= 0 && (any || visible(ci)) ? ci : -1;
  };
  // Полоса — окно из соседних линий сетки l0..l1 общей толщиной ≤ JOG_TOL
  // (ступенька 50 мм может состоять из линий 40 + 10 от посторонних граней).
  const sweep = (vertical) => {
    let changed = false;
    const lines = vertical ? nx : ny;
    const len = vertical ? ny : nx;
    const coords = vertical ? xs : ys;
    const idx = (line, t) => (vertical ? t * nx + line : line * nx + t);
    const owner = (line, t) => (vertical ? ownerAt(line, t) : ownerAt(t, line));
    for (let l0 = 0; l0 < lines; l0 += 1) {
      for (let l1 = l0; l1 < lines && coords[l1 + 1] - coords[l0] <= JOG_TOL + 0.25; l1 += 1) {
        const empty = (t) => {
          for (let l = l0; l <= l1; l += 1) if (best[idx(l, t)] >= 0) return false;
          return true;
        };
        const full = (t) => {
          if (t < 0 || t >= len) return false;
          for (let l = l0; l <= l1; l += 1) if (owner(l, t) < 0) return false;
          return true;
        };
        const side = (t, s) => owner(s < 0 ? l0 - 1 : l1 + 1, t);
        const open = (t) => empty(t) && (side(t, -1) >= 0 || side(t, 1) >= 0);
        // Ступенька в ряду t со стороны s → владелец клетки окна у этой стороны.
        const stepAt = (t, s) => (full(t) && side(t, s) >= 0 && side(t, -s) < 0 ? owner(s < 0 ? l0 : l1, t) : -1);
        let t = 0;
        while (t < len) {
          if (!open(t)) { t += 1; continue; }
          let t1 = t;
          while (t1 + 1 < len && open(t1 + 1)) t1 += 1;
          for (let q = t; q <= t1; q += 1) {
            const a = side(q, -1);
            const b = side(q, 1);
            let src = -1;
            let bound = -1;
            if (a >= 0 && b >= 0) src = any && visible(a) ? b : a;
            else if (!any) {
              const s = a >= 0 ? -1 : 1;
              bound = stepAt(t - 1, s);
              if (bound < 0) bound = stepAt(t1 + 1, s);
              if (bound >= 0) src = a >= 0 ? a : b;
            }
            if (src < 0) continue;
            let ok = true;
            for (let l = l0; l <= l1 && ok; l += 1) ok = canFill(src, idx(l, q), bound);
            if (!ok) continue;
            for (let l = l0; l <= l1; l += 1) best[idx(l, q)] = src;
            changed = true;
          }
          t = t1 + 1;
        }
      }
    }
    return changed;
  };
  for (let guard = 0; guard < 4; guard += 1) {
    const a = sweep(true);
    const b = sweep(false);
    if (!a && !b) break;
  }
  any = true;
  sweep(true);
  sweep(false);
  const thinX = (i) => xs[i + 1] - xs[i] <= JOG_TOL + 0.25;
  const thinY = (j) => ys[j + 1] - ys[j] <= JOG_TOL + 0.25;
  for (let j = 0; j < ny; j += 1) {
    if (!thinY(j)) continue;
    for (let i = 0; i < nx; i += 1) {
      const k = j * nx + i;
      if (!thinX(i) || best[k] >= 0 || inRoom(k)) continue;
      const near = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      let walls = 0; let enclosed = true; let src = -1;
      for (const [a, b] of near) {
        const o = ownerAt(a, b);
        if (o >= 0) {
          walls += 1;
          if (src < 0 || (visible(src) && !visible(o))) src = o; // скрытая — без следа на плане
        } else if (a < 0 || b < 0 || a >= nx || b >= ny || !inRoom(b * nx + a)) enclosed = false;
      }
      if (walls >= 2 && enclosed && canFill(src, k, -1)) best[k] = src;
    }
  }
}

// Стена, на которой стоит проём с host { wallId, t } (ручная стена), и
// абсолютная координата его центра вдоль стены. null — стены нет.
export function resolveOpeningWall(project, opening, walls) {
  const host = opening?.host;
  if (!host) return null;
  const wall = (walls || []).find((w) => w.kind === 'manual' && w.wallId === host.wallId);
  if (!wall) return null;
  return { wall, absCenter: wall.axisStart + wall.axisDir * Number(host.t) };
}

// Контуры куска стены: обход границы; если внутри есть дыра (редко) —
// прямоугольники как есть (простые полигоны без вложенности).
function recordPolys(rects) {
  if (!rects.length) return [];
  if (rects.length === 1) return [rectPoly(rects[0])];
  const cycles = rectsCycles(rects);
  if (cycles.some((c) => c.area < 0)) return rects.map(rectPoly);
  return cycles.map((c) => c.pts);
}

function rectPoly(r) {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}

// Единый контур видимых стен (наружные циклы и дворы/дыры) — для штриха и
// DXF: рисуется один раз, без швов между кусками. → [{ pts, hole }].
export function wallOutline(walls) {
  const rects = [];
  const angled = [];
  for (const w of walls) if (!w.hidden) rects.push(...wallRects(w));
  for (const w of walls) if (!w.hidden && !wallRects(w).length) {
    for (const poly of w.polys || (w.poly ? [w.poly] : [])) if (poly.length >= 3) angled.push({ pts: poly, hole: false });
  }
  return rectsCycles(rects.map((r) => ({ x: snapHalf(r.x), y: snapHalf(r.y), w: snapHalf(r.x + r.w) - snapHalf(r.x), h: snapHalf(r.y + r.h) - snapHalf(r.y) })))
    .map((c) => ({ pts: c.pts, hole: c.area < 0 })).concat(angled);
}

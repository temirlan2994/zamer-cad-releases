// Стены v2: стена — область (docs/walls-geometry-design.md, этап A
// docs/walls-v2-architecture.md). Только стены, выведенные из комнат.
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

import { isShaft } from './catalog.js';
import { roomRects } from './room-shape.js';
import { cutWallsInsideShafts, wallRects, wallSegments } from './walls.js';
import { gridAxis, mergeCells, rectsCycles, snapHalf } from './ortho-grid.js';

const TYPE_RANK = { exterior: 3, bearing: 2, partition: 1 };

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

export function deriveWallsV2(project) {
  const rooms = project.rooms || [];
  const n = rooms.length;
  const roomIndex = new Map(rooms.map((r, i) => [r.id, i]));
  const { walls: segs, faces } = wallSegments(project, { covered: false });

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
  segs.forEach((seg, si) => {
    const b = seg.band;
    if (!b || b.w <= 0.25 || b.h <= 0.25) return;
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
    if (!f) return;
    for (const [id, face] of Object.entries(f)) {
      if (!byRoom.has(id)) byRoom.set(id, []);
      byRoom.get(id).push({ si, seg, edge: face.edge, outward: face.outward });
    }
  });
  const near = (a, b) => Math.abs(a - b) < 0.75;
  for (const [id, list] of byRoom) {
    const hs = list.filter((q) => q.seg.orient === 'h');
    const vs = list.filter((q) => q.seg.orient === 'v');
    for (const h of hs) {
      for (const v of vs) {
        // Вершина (v.edge, h.edge) — конец обоих сегментов.
        if (!(near(h.seg.from, v.edge) || near(h.seg.to, v.edge))) continue;
        if (!(near(v.seg.from, h.edge) || near(v.seg.to, h.edge))) continue;
        const cx = v.edge; const cy = h.edge;
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

  // Сетка.
  const roomBoxes = rooms.map((r) => roomRects(r));
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
        if (!permitted(c.allowed, k)) continue;
        let d = Infinity;
        if (!c.corner) {
          const across = seg.orient === 'h' ? cy : (xs[i] + xs[i + 1]) / 2;
          for (const e of c.faceEdges) d = Math.min(d, Math.abs(across - e));
        }
        const cur = best[k];
        if (cur < 0) { best[k] = ci; bestDist[k] = d; continue; }
        const o = cands[cur];
        const oseg = segs[o.si];
        let better;
        if (Boolean(seg.hidden) !== Boolean(oseg.hidden)) better = !seg.hidden;
        else if (Math.abs(d - bestDist[k]) > 0.25 && (Number.isFinite(d) || Number.isFinite(bestDist[k]))) better = d < bestDist[k];
        else better = segOrder(seg, oseg) < 0;
        if (better) { best[k] = ci; bestDist[k] = d; }
      }
    }
  });

  // Сегмент → записи (у шахт сегмент режется на куски, как в v1).
  const records = [];
  const piecesOf = segs.map((seg) => {
    const parts = [{ ...seg, band: { ...seg.band }, center: { ...seg.center } }];
    cutWallsInsideShafts(parts, rooms);
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
  return records;
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
  for (const w of walls) if (!w.hidden) rects.push(...wallRects(w));
  return rectsCycles(rects.map((r) => ({ x: snapHalf(r.x), y: snapHalf(r.y), w: snapHalf(r.x + r.w) - snapHalf(r.x), h: snapHalf(r.y + r.h) - snapHalf(r.y) })))
    .map((c) => ({ pts: c.pts, hole: c.area < 0 }));
}

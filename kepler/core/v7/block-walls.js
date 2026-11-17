// Стены блоков v7 — производные записи того же вида, что ручные стены
// (core/v7/wall-body.js). Чистый модуль.
//
// Видимая форма блока (core/v7/carve.js) — чистая площадь помещения; стены
// стоят СНАРУЖИ неё:
//  • ребро, напротив которого на расстоянии 1…MAX_SHARED_GAP идёт встречное
//    ребро другого блока, — ОДНА общая стена пары (по центру зазора, толщина
//    = зазор), как общая стена v6;
//  • участок ребра, уже закрытый телом ручной стены снаружи, — без стены
//    блока (ручная стена главнее; так «разобранный» блок не удваивает стены);
//  • остальное — своя стена блока (наружная толщина), тело наружу.
// Концы стен у вершин, где соседний участок — общая/ручная стена, тянутся
// до её оси: стыки L/T/X без щелей и дыр (сетка 2×2 сходится в одном узле).

import { MAX_SHARED_GAP, blockEdges, blockHasWalls, pairKey } from './model.js';
import { snapPt, wallFrame } from './wall-body.js';

const MIN_SIN = 0.3; // острее — не продлеваем (встык)

const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const at = (e, s, o = 0) => ({ x: e.a.x + e.d.x * s + e.n.x * o, y: e.a.y + e.d.y * s + e.n.y * o });

function blockRingsEdges(block, shape, bi) {
  const edges = [];
  shape.forEach((poly, pi) => poly.forEach((ring, ri) => {
    const first = edges.length;
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const a = ring[i]; const b = ring[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      edges.push({
        block, bi, tag: `${pi}.${ri}.${i}`, a, b, len, d, n: { x: d.y, y: -d.x }, // n — наружу
        prev: first + ((i - 1 + n) % n), next: first + ((i + 1) % n), pieces: [],
      });
    }
  }));
  return edges;
}

function nominalIndex(block, e) {
  for (const ne of blockEdges(block)) {
    const len = Math.hypot(ne.b.x - ne.a.x, ne.b.y - ne.a.y);
    if (len < 1) continue;
    const d = { x: (ne.b.x - ne.a.x) / len, y: (ne.b.y - ne.a.y) / len };
    if (dot(d, e.d) < 0.9995) continue;
    if (Math.abs(cross(d, sub(e.a, ne.a))) > 0.75) continue;
    const s0 = dot(sub(e.a, ne.a), d); const s1 = dot(sub(e.b, ne.a), d);
    if (Math.min(s1, len) - Math.max(s0, 0) > 0.5) return ne.index;
  }
  return -1;
}

// Разметка ребра: участки 'shared' | 'covered' | 'own' и «половина» —
// расстояние от ребра до оси стены соседнего участка (для продления).
function labelEdge(e) {
  const xs = new Set([0, e.len]);
  for (const p of e.pieces) { xs.add(Math.max(0, Math.min(e.len, p.s0))); xs.add(Math.max(0, Math.min(e.len, p.s1))); }
  const pts = [...xs].sort((a, b) => a - b);
  const runs = [];
  for (let k = 0; k + 1 < pts.length; k += 1) {
    const x = pts[k]; const y = pts[k + 1];
    if (y - x < 1e-6) continue;
    const m = (x + y) / 2;
    const over = e.pieces.filter((p) => p.s0 <= m && p.s1 >= m);
    const sh = over.filter((p) => p.kind === 'shared').sort((p, q) => p.gap - q.gap)[0];
    const cv = over.filter((p) => p.kind === 'covered').sort((p, q) => q.half - p.half)[0];
    const lab = sh ? { kind: 'shared', half: sh.gap / 2 } : cv ? { kind: 'covered', half: cv.half } : { kind: 'own', half: 0 };
    const last = runs[runs.length - 1];
    if (last && last.kind === lab.kind && last.half === lab.half) last.s1 = y;
    else runs.push({ ...lab, s0: x, s1: y });
  }
  e.runs = runs;
  e.startLab = runs[0] || { kind: 'own', half: 0 };
  e.endLab = runs[runs.length - 1] || { kind: 'own', half: 0 };
}

function extAtStart(edges, e) {
  const p = edges[e.prev];
  if (p.endLab.kind === 'own') return 0;
  const s = cross(p.d, e.d);
  return s > MIN_SIN ? p.endLab.half / s : 0;
}

function extAtEnd(edges, e) {
  const q = edges[e.next];
  if (q.startLab.kind === 'own') return 0;
  const s = cross(e.d, q.d);
  return s > MIN_SIN ? q.startLab.half / s : 0;
}

function realWallCover(e, w) {
  const f = w.frame || wallFrame(w);
  if (Math.abs(cross(e.d, f.d)) > 1e-3) return null;
  const o = dot(sub(w.a, e.a), e.n);
  const sign = dot(f.L, e.n) > 0 ? 1 : -1;
  const r0 = sign > 0 ? o + f.lo : o - f.hi;
  const r1 = sign > 0 ? o + f.hi : o - f.lo;
  if (!(r0 <= 1 && r1 >= 1)) return null;
  const sa = dot(sub(w.a, e.a), e.d); const sb = dot(sub(w.b, e.a), e.d);
  const s0 = Math.max(0, Math.min(sa, sb)); const s1 = Math.min(e.len, Math.max(sa, sb));
  if (s1 - s0 <= 1) return null;
  return { kind: 'covered', s0, s1, half: (Math.max(r0, 0) + r1) / 2 };
}

const boxOf = (shape) => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const poly of shape) for (const p of poly[0]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
};
const near = (a, b, pad) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;

// level, settings, carved (carveLevel().byId), realWalls — записи ручных
// стен ({ id, a, b, thickness, justify, roomBounding, frame? }).
// → записи стен блоков: { id, a, b, thickness, justify, hidden, source: 'block',
//   kind: 'exterior'|'partition', blockId?, edgeIndex?, pair? }.
export function blockWalls(level, settings, carved, realWalls) {
  const blocks = (level.blocks || []).filter(blockHasWalls).slice().sort((p, q) => (p.id < q.id ? -1 : 1));
  const edges = [];
  const perBlock = blocks.map((b, bi) => {
    const shape = carved[b.id]?.shape || [];
    const list = blockRingsEdges(b, shape, bi);
    const from = edges.length;
    for (const e of list) { e.prev += from; e.next += from; edges.push(e); }
    return { b, box: boxOf(shape), from, to: edges.length };
  });
  // Общие стены пар.
  const shared = [];
  for (let i = 0; i < perBlock.length; i += 1) {
    for (let j = i + 1; j < perBlock.length; j += 1) {
      const P = perBlock[i]; const Q = perBlock[j];
      if (!near(P.box, Q.box, MAX_SHARED_GAP)) continue;
      for (let ei = P.from; ei < P.to; ei += 1) {
        const e = edges[ei];
        for (let fi = Q.from; fi < Q.to; fi += 1) {
          const f = edges[fi];
          if (dot(e.d, f.d) > -0.9995) continue;
          const ga = dot(sub(f.a, e.a), e.n); const gb = dot(sub(f.b, e.a), e.n);
          if (Math.abs(ga - gb) > 0.5) continue;
          const gap = (ga + gb) / 2;
          if (gap < 1 || gap > MAX_SHARED_GAP) continue;
          const sa = dot(sub(f.a, e.a), e.d); const sb = dot(sub(f.b, e.a), e.d);
          const s0 = Math.max(0, Math.min(sa, sb)); const s1 = Math.min(e.len, Math.max(sa, sb));
          if (s1 - s0 <= 1) continue;
          const u = (s) => dot(sub(at(e, s), f.a), f.d);
          const u0 = u(s1); const u1 = u(s0);
          e.pieces.push({ kind: 'shared', s0, s1, gap });
          f.pieces.push({ kind: 'shared', s0: u0, s1: u1, gap });
          shared.push({ e, f, s0, s1, u0, u1, gap });
        }
      }
    }
  }
  // Ручные стены, закрывающие рёбра снаружи.
  const bounding = realWalls.filter((w) => w.roomBounding !== false);
  for (const P of perBlock) {
    const near2 = bounding.filter((w) => {
      const pad = (Number(w.thickness) || 0) + 2;
      return near(P.box, { x0: Math.min(w.a.x, w.b.x), y0: Math.min(w.a.y, w.b.y), x1: Math.max(w.a.x, w.b.x), y1: Math.max(w.a.y, w.b.y) }, pad);
    });
    if (!near2.length) continue;
    for (let ei = P.from; ei < P.to; ei += 1) {
      for (const w of near2) { const c = realWallCover(edges[ei], w); if (c) edges[ei].pieces.push(c); }
    }
  }
  for (const e of edges) labelEdge(e);

  const out = [];
  // Свои стены блоков.
  for (const P of perBlock) {
    const b = P.b;
    let k = 0;
    for (let ei = P.from; ei < P.to; ei += 1) {
      const e = edges[ei];
      const idx = nominalIndex(b, e);
      const ov = idx >= 0 ? b.edges?.[idx] : null;
      const thickness = Number(ov?.thickness) || Number(b.walls?.exterior) || Number(settings?.exterior) || 250;
      for (const r of e.runs) {
        if (r.kind !== 'own' || r.s1 - r.s0 < 1) continue;
        const s0 = r.s0 - (r.s0 < 0.5 ? extAtStart(edges, e) : 0);
        const s1 = r.s1 + (r.s1 > e.len - 0.5 ? extAtEnd(edges, e) : 0);
        k += 1;
        out.push({
          id: `${b.id}:${e.tag}.${k}`, a: snapPt(at(e, s0)), b: snapPt(at(e, s1)), thickness, justify: 'right',
          hidden: Boolean(ov?.hidden), roomBounding: true, source: 'block', kind: ov?.kind || 'exterior',
          blockId: b.id, edgeIndex: idx,
        });
      }
    }
  }
  // Общие стены пар.
  const pairCount = new Map();
  for (const s of shared) {
    const { e, f } = s;
    let ext0 = 0; let ext1 = 0;
    if (s.s0 < 0.5) ext0 = Math.max(ext0, extAtStart(edges, e));
    if (s.u1 > f.len - 0.5) ext0 = Math.max(ext0, extAtEnd(edges, f));
    if (s.s1 > e.len - 0.5) ext1 = Math.max(ext1, extAtEnd(edges, e));
    if (s.u0 < 0.5) ext1 = Math.max(ext1, extAtStart(edges, f));
    const pk = pairKey(e.block.id, f.block.id);
    const k = (pairCount.get(pk) || 0) + 1;
    pairCount.set(pk, k);
    const ov = level.pairs?.[pk];
    out.push({
      id: `${pk}:${k}`, a: snapPt(at(e, s.s0 - ext0, s.gap / 2)), b: snapPt(at(e, s.s1 + ext1, s.gap / 2)),
      thickness: s.gap, justify: 'center', hidden: Boolean(ov?.hidden), roomBounding: true, source: 'block',
      kind: 'partition', pair: [e.block.id, f.block.id].sort(),
    });
  }
  return out;
}

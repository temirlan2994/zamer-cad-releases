// Тела стен v7 под любым углом: стыки в узлах (общие концы осей) —
// миттер (L), T и X — по соседним граням; проёмы вычитаются из тела.
// Чистый модуль. Стена-запись: { id, a, b, thickness, justify, ... } —
// и ручные стены, и стены блоков (core/v7/block-walls.js) идут через этот
// же код, поэтому «разобрать блок на стены» не меняет геометрию.
//
// Рамка стены: d — единичное направление a→b, L(d) = (d.y, −d.x) — «лево»
// на экране при оси Y вниз (как leftSign в core/walls-v2.js). Тело занимает
// смещения [lo, hi] вдоль L: justify 'center' → [−t/2, t/2], 'right' (правая
// грань на оси, тело слева) → [0, t], 'left' → [−t, 0].

import { clean, difference } from '../geom/poly.js';

const PARALLEL_SIN = 0.05; // ≈ 3°: почти коллинеарные — встык, без миттера
const MITER_LIMIT = 3; // миттер дальше 3·t от узла — срезается (встык)

export const snap = (v) => Math.round(v * 2) / 2;
export const snapPt = (p) => ({ x: snap(p.x), y: snap(p.y) });

export function wallFrame(w) {
  const dx = w.b.x - w.a.x; const dy = w.b.y - w.a.y;
  const len = Math.hypot(dx, dy);
  const d = { x: dx / len, y: dy / len };
  const L = { x: d.y, y: -d.x };
  const t = Number(w.thickness) || 0;
  let lo = -t / 2; let hi = t / 2;
  if (w.justify === 'right') { lo = 0; hi = t; } else if (w.justify === 'left') { lo = -t; hi = 0; }
  return { len, d, L, lo, hi, t };
}

const along = (c, e) => (c.x - e.node.x) * e.d.x + (c.y - e.node.y) * e.d.y;
const key = (p) => `${p.x},${p.y}`;
const add = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k });

function intersectLines(p, d, q, e) {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < PARALLEL_SIN) return null;
  const s = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return add(p, d, s);
}

// Углы концов всех стен: для каждой стены { a: {hi, lo, node}, b: {...} }.
function joinCorners(records, frames) {
  const nodes = new Map();
  records.forEach((w, i) => {
    const f = frames[i];
    for (const atStart of [true, false]) {
      const node = atStart ? w.a : w.b;
      const dOut = atStart ? f.d : { x: -f.d.x, y: -f.d.y };
      const end = {
        i, atStart, node, d: dOut, L: { x: dOut.y, y: -dOut.x },
        lo: atStart ? f.lo : -f.hi, hi: atStart ? f.hi : -f.lo, t: f.t, len: f.len,
      };
      const k = key(node);
      const list = nodes.get(k);
      if (list) list.push(end); else nodes.set(k, [end]);
    }
  });
  const corners = records.map(() => ({ a: null, b: null }));
  for (const ends of nodes.values()) {
    for (const e of ends) { e.cHi = add(e.node, e.L, e.hi); e.cLo = add(e.node, e.L, e.lo); }
    if (ends.length > 1) {
      ends.sort((p, q) => Math.atan2(q.d.y, q.d.x) - Math.atan2(p.d.y, p.d.x));
      for (let k = 0; k < ends.length; k += 1) {
        const p = ends[k]; const q = ends[(k + 1) % ends.length];
        const c = intersectLines(add(p.node, p.L, p.hi), p.d, add(q.node, q.L, q.lo), q.d);
        if (!c) continue;
        if (Math.hypot(c.x - p.node.x, c.y - p.node.y) > MITER_LIMIT * Math.max(p.t, q.t, 1)) continue;
        // Угол дальше другого конца короткой стены — миттер вылез бы за неё.
        if (along(c, p) > p.len + 0.5 || along(c, q) > q.len + 0.5) continue;
        p.cHi = c; q.cLo = c;
      }
    }
    for (const e of ends) corners[e.i][e.atStart ? 'a' : 'b'] = { hi: e.cHi, lo: e.cLo, node: e.node, n: ends.length };
  }
  return corners;
}

// Прямоугольник проёма поперёк тела (с запасом 2 мм за грани).
export function openingCut(w, f, t, width) {
  const s0 = t - width / 2; const s1 = t + width / 2;
  const p = (s, o) => add(add(w.a, f.d, s), f.L, o);
  return [p(s0, f.lo - 2), p(s1, f.lo - 2), p(s1, f.hi + 2), p(s0, f.hi + 2)];
}

// records — стены (концы уже на сетке 0,5 мм); openingsByWall — Map
// wallId → [{ t, width }]. → [{ ...record, frame, polygon, cut }].
export function wallBodies(records, openingsByWall = new Map()) {
  const valid = records.filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) >= 1 && Number(w.thickness) > 0);
  const frames = valid.map(wallFrame);
  const corners = joinCorners(valid, frames);
  return valid.map((w, i) => {
    const A = corners[i].a; const B = corners[i].b;
    const ring = [A.lo, B.hi];
    if (B.n >= 3) ring.push(B.node);
    ring.push(B.lo, A.hi);
    if (A.n >= 3) ring.push(A.node);
    const polygon = clean([ring]);
    const ops = openingsByWall.get(w.id) || [];
    const cut = ops.length ? difference(polygon, ops.map((o) => [openingCut(w, frames[i], o.t, o.width)])) : polygon;
    return { ...w, frame: frames[i], polygon, cut };
  });
}

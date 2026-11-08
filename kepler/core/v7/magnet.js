// Примагничивание блока (v7) — функция для жестов этапа 2; derive её не
// вызывает. Предложенный габарит движущегося блока прижимается гранью к
// грани ближайших блоков с зазором = толщина их общей перегородки (там
// derive поставит общую стену), либо выравнивается по одноимённой грани.
// По X и Y — независимо. Вложенный блок прижимается к внутренним граням
// родителя (с тем же зазором) и к соседям по родителю.
//
// magnetSnap(project, movingId, rect {x,y,w,h}, { distance=300, enabled=true })
// → { x, y, dx, dy, guides: [{ axis, at, from, to, kind, target }] }.

import { DEFAULT_EXTERIOR } from '../catalog.js';
import { activeLevel7, blockBox, blockById, blockIsOpen, pairGap as wallPairGap } from './model.js';

// Зазор прижатия. Открытое помещение (терраса, балкон) общей перегородки не
// получает: к закрытому соседу оно прижимается к наружной грани его стены
// (зазор = толщина наружной стены), к другой открытой площадке — вплотную.
function pairGap(level, settings, a, b) {
  const ao = blockIsOpen(a); const bo = blockIsOpen(b);
  if (!ao && !bo) return wallPairGap(level, settings, a, b);
  if (ao && bo) return 0;
  const closed = ao ? b : a;
  return Number(closed.walls?.exterior) || Number(settings?.exterior) || DEFAULT_EXTERIOR;
}

function candidates(rect, t, gap, axis, inner) {
  const [p, s] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
  const lo = rect[p]; const hi = rect[p] + rect[s];
  const tlo = t[p]; const thi = t[p] + t[s];
  if (inner) {
    return [
      { delta: tlo + gap - lo, at: tlo + gap, kind: 'contact' },
      { delta: thi - gap - hi, at: thi - gap, kind: 'contact' },
    ];
  }
  return [
    { delta: thi + gap - lo, at: thi + gap, kind: 'contact' },
    { delta: tlo - gap - hi, at: tlo - gap, kind: 'contact' },
    { delta: tlo - lo, at: tlo, kind: 'align' },
    { delta: thi - hi, at: thi, kind: 'align' },
  ];
}

// Перекрываются ли проекции на другую ось (с запасом pad).
function across(rect, t, axis, pad) {
  const [p, s] = axis === 'x' ? ['y', 'h'] : ['x', 'w'];
  return rect[p] <= t[p] + t[s] + pad && t[p] <= rect[p] + rect[s] + pad;
}

function magnetTargets(level, movingId, extraSkip = null) {
  const moving = blockById(level, movingId);
  if (!moving) return null;
  const skip = new Set([movingId, ...(extraSkip || [])]);
  for (const b of level.blocks) if (b.parentId === movingId) skip.add(b.id);
  const ctx = moving.parentId || null;
  return { moving, ctx, targets: level.blocks.filter((b) => !skip.has(b.id) && ((b.parentId || null) === ctx || b.id === ctx)) };
}

// Примагничивание подвижных граней при растяжении: edges — подмножество
// 'w','e','n','s' (как ручки комнаты). Грань прижимается к грани соседа с
// зазором перегородки или выравнивается с одноимённой гранью.
// skip — ids блоков, к которым не прижимать (попутчики общей стены,
// core/wall-follow.js: они едут вместе с гранью).
// → { rect, guides } (rect — новый габарит; guides — как у magnetSnap).
export function magnetEdges(project, movingId, rect, edges, { distance = 300, enabled = true, levelId, skip = null } = {}) {
  const out = { rect: { ...rect }, guides: [] };
  if (!enabled || !(distance > 0) || !edges?.length) return out;
  const level = activeLevel7(project, levelId);
  const found = magnetTargets(level, movingId, skip);
  if (!found) return out;
  const r = out.rect;
  for (const edge of edges) {
    const axis = edge === 'w' || edge === 'e' ? 'x' : 'y';
    const [p, s] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
    const hiSide = edge === 'e' || edge === 's';
    const at0 = hiSide ? r[p] + r[s] : r[p];
    let best = null;
    for (const t of found.targets) {
      const box = blockBox(t);
      const inner = t.id === found.ctx;
      if (!inner && !across(r, box, axis, distance)) continue;
      const gap = pairGap(level, project.settings, found.moving, t);
      const tlo = box[p]; const thi = box[p] + box[s];
      const list = inner
        ? [{ at: hiSide ? thi - gap : tlo + gap, kind: 'contact' }]
        : [
          { at: hiSide ? tlo - gap : thi + gap, kind: 'contact' },
          { at: tlo, kind: 'align' }, { at: thi, kind: 'align' },
        ];
      for (const c of list) {
        const d = Math.abs(c.at - at0);
        if (d > distance) continue;
        const score = d + (c.kind === 'align' ? 0.01 : 0);
        if (!best || score < best.score) best = { ...c, score, box, target: t.id };
      }
    }
    if (!best) continue;
    if (hiSide) r[s] = best.at - r[p];
    else { r[s] += r[p] - best.at; r[p] = best.at; }
    const [q, z] = axis === 'x' ? ['y', 'h'] : ['x', 'w'];
    out.guides.push({ axis, at: best.at, from: Math.min(r[q], best.box[q]), to: Math.max(r[q] + r[z], best.box[q] + best.box[z]), kind: best.kind, target: best.target, edge });
  }
  return out;
}

export function magnetSnap(project, movingId, rect, { distance = 300, enabled = true, levelId } = {}) {
  const none = { x: rect.x, y: rect.y, dx: 0, dy: 0, guides: [] };
  if (!enabled || !(distance > 0)) return none;
  const level = activeLevel7(project, levelId);
  const found = magnetTargets(level, movingId);
  if (!found) return none;
  const { moving, ctx, targets } = found;
  const best = { x: null, y: null };
  for (const t of targets) {
    const box = blockBox(t);
    const gap = pairGap(level, project.settings, moving, t);
    const inner = t.id === ctx;
    for (const axis of ['x', 'y']) {
      // Соседи по другой оси — с перекрытием проекций или в пределах радиуса.
      if (!inner && !across(rect, box, axis, distance)) continue;
      for (const c of candidates(rect, box, gap, axis, inner)) {
        const score = Math.abs(c.delta) + (c.kind === 'align' ? 0.01 : 0);
        if (Math.abs(c.delta) > distance) continue;
        if (!best[axis] || score < best[axis].score) best[axis] = { ...c, score, target: t.id, box };
      }
    }
  }
  const dx = best.x ? best.x.delta : 0;
  const dy = best.y ? best.y.delta : 0;
  const out = { x: rect.x + dx, y: rect.y + dy, dx, dy, guides: [] };
  const moved = { ...rect, x: out.x, y: out.y };
  if (best.x) {
    const b = best.x.box;
    out.guides.push({ axis: 'x', at: best.x.at, from: Math.min(moved.y, b.y), to: Math.max(moved.y + moved.h, b.y + b.h), kind: best.x.kind, target: best.x.target });
  }
  if (best.y) {
    const b = best.y.box;
    out.guides.push({ axis: 'y', at: best.y.at, from: Math.min(moved.x, b.x), to: Math.max(moved.x + moved.w, b.x + b.w), kind: best.y.kind, target: best.y.target });
  }
  return out;
}

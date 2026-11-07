// Примагничивание блока (v7) — функция для жестов этапа 2; derive её не
// вызывает. Предложенный габарит движущегося блока прижимается гранью к
// грани ближайших блоков с зазором = толщина их общей перегородки (там
// derive поставит общую стену), либо выравнивается по одноимённой грани.
// По X и Y — независимо. Вложенный блок прижимается к внутренним граням
// родителя (с тем же зазором) и к соседям по родителю.
//
// magnetSnap(project, movingId, rect {x,y,w,h}, { distance=300, enabled=true })
// → { x, y, dx, dy, guides: [{ axis, at, from, to, kind, target }] }.

import { activeLevel7, blockBox, blockById, pairGap } from './model.js';

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

export function magnetSnap(project, movingId, rect, { distance = 300, enabled = true, levelId } = {}) {
  const none = { x: rect.x, y: rect.y, dx: 0, dy: 0, guides: [] };
  if (!enabled || !(distance > 0)) return none;
  const level = activeLevel7(project, levelId);
  const moving = blockById(level, movingId);
  if (!moving) return none;
  const skip = new Set([movingId]);
  for (const b of level.blocks) if (b.parentId === movingId) skip.add(b.id);
  const ctx = moving.parentId || null;
  const targets = level.blocks.filter((b) => !skip.has(b.id) && ((b.parentId || null) === ctx || b.id === ctx));
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

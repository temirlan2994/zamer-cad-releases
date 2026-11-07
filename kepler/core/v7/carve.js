// «Съедание на лету» (v7): видимая форма блока = номинальная форма минус
// номинальные формы блоков выше по порядку (z, затем id), расширенные на
// толщину их общей перегородки. Между блоками остаётся зазор ровно этой
// толщины — там derive ставит одну общую перегородку.
//
// Никакой памяти: результат — чистая функция текущих номинальных форм и
// порядка. Сдвинули верхний блок прочь — нижний сразу снова целый.
//
// Не получается (как core/room-eat.js) — форма остаётся номинальной,
// перекрытие видно и возвращается причина:
//   'whole'    — нижний целиком под верхними;
//   'split'    — остаток распадается на части;
//   'small'    — ни одна часть остатка не вмещает квадрат EAT_MIN_REMAIN;
//   'children' — под верхний попадает вложенный блок нижнего.
// Вложенные блоки (parentId) всегда выше родителя и вырезают себя из него.
// Открытые площадки и шахты в съедании не участвуют (как eatablePair).

import { area, bbox, boxesOverlap, buffer, difference, erode, intersection, opening, union } from '../geom/poly.js';
import { blockGeom, blockIsOpen, blockIsShaft, blockOrder, pairGap } from './model.js';

export const EAT_MIN_REMAIN = 500; // = core/room-eat.js EAT_MIN_REMAIN
export const EAT_SLIVER = 250; // = core/room-eat.js EAT_SLIVER: тоньше — волосок, срезается
const HIT_MM2 = 100; // пересечение меньше — касание, а не перекрытие

const eatable = (b) => !b.parentId && !blockIsShaft(b) && !blockIsOpen(b);

function tryCut(nominal, cutters) {
  let rest = difference(nominal, ...cutters);
  rest = opening(rest, EAT_SLIVER / 2 - 0.5);
  if (!rest.length) return { ok: false, why: 'whole' };
  if (!erode(rest, EAT_MIN_REMAIN / 2 - 0.5).length) return { ok: false, why: 'small' };
  if (rest.length > 1) return { ok: false, why: 'split' };
  return { ok: true, shape: rest };
}

// → { byId: { [id]: { nominal, shape, status, eaten, by, failedBy } }, issues }
export function carveLevel(level, settings) {
  const blocks = level.blocks || [];
  const nominal = new Map();
  const boxes = new Map();
  for (const b of blocks) {
    const mp = union([blockGeom(b)]); // ориентирован, на сетке 0,5 мм
    nominal.set(b.id, mp);
    boxes.set(b.id, bbox(mp));
  }
  const byId = {};
  const issues = [];
  for (const b of blocks) {
    const nom = nominal.get(b.id);
    const res = { nominal: nom, shape: nom, status: 'ok', eaten: false, by: [], failedBy: [] };
    byId[b.id] = res;
    const children = blocks.filter((c) => c.parentId === b.id);
    const tops = eatable(b) ? blocks.filter((e) => e !== b && eatable(e) && blockOrder(e, b) > 0) : [];
    const hits = [];
    for (const e of [...children, ...tops]) {
      const gap = pairGap(level, settings, b, e);
      if (!boxesOverlap(boxes.get(b.id), boxes.get(e.id), gap)) continue;
      const cutter = buffer(nominal.get(e.id), gap);
      if (area(intersection(nom, cutter)) <= HIT_MM2) continue;
      hits.push({ id: e.id, cutter, child: e.parentId === b.id });
    }
    if (!hits.length) continue;
    const topHits = hits.filter((h) => !h.child);
    let cut = tryCut(nom, hits.map((h) => h.cutter));
    if (cut.ok && topHits.length) {
      const topCut = topHits.flatMap((h) => h.cutter);
      const bad = children.find((c) => area(intersection(nominal.get(c.id), topCut)) > HIT_MM2);
      if (bad) cut = { ok: false, why: 'children', child: bad.id };
    }
    if (cut.ok) {
      Object.assign(res, { shape: cut.shape, eaten: true, by: hits.map((h) => h.id).sort() });
      continue;
    }
    res.status = cut.why;
    res.failedBy = topHits.map((h) => h.id).sort();
    issues.push({ kind: 'overlap', block: b.id, by: res.failedBy, why: cut.why, child: cut.child || null });
    // Вложенные всё равно вырезаются из родителя, если это возможно.
    const childHits = hits.filter((h) => h.child);
    if (childHits.length) {
      const own = tryCut(nom, childHits.map((h) => h.cutter));
      if (own.ok) Object.assign(res, { shape: own.shape, eaten: true, by: childHits.map((h) => h.id).sort() });
    }
  }
  issues.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
  return { byId, issues };
}

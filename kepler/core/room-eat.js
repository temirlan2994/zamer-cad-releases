// «Съедание» перекрытых комнат (docs/walls-v2-architecture.md, раздел 5).
// Чистый модуль без DOM.
//
// Комната A, поставленная, сдвинутая или растянутая поверх комнаты B,
// забирает у B площадь пересечения: форма B становится B \ (A + t), где t —
// толщина их общей стены (перегородка settings.partition или своя толщина
// пары wallOverrides[s|a|b]). Между A и B остаётся зазор ровно t, и движок
// стен выводит там обычную общую перегородку — без двойной толщины и без
// дыр. Правка деструктивная (в конце жеста, один шаг отмены): после неё в
// модели нет перекрытия, все потребители (ТЭП, экспликация, нормы, мебель,
// 3D, IFC, DXF) видят обычные состыкованные комнаты.
//
// Не получается (B целиком под A, A разрезает B на части, остаток меньше
// минимального размера, вложенные помещения B попадают под A) — B не
// трогается, перекрытие остаётся и показывается замечанием норм с причиной.

import { DEFAULT_PARTITION, isOpenRoom, isShaft } from './catalog.js';
import { captureOpeningAnchors, keepOpenings } from './opening-anchor.js';
import { rectsCycles } from './ortho-grid.js';
import { finalizeRoomOutline, roomRects } from './room-shape.js';
import { MIN_ROOM_SIZE, nestedOuterRect, rectInsideRoomShape } from './rooms.js';
import { sharedWallThickness } from './walls.js';

// Кусок остатка тоньше этого — волосок между стеной и краем, а не часть
// помещения: срезается вместе с зоной пересечения.
export const EAT_SLIVER = 250;

// Разность прямоугольников a \ b (до четырёх кусков).
export function rectMinus(a, b) {
  const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w); const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 - x0 <= 0.5 || y1 - y0 <= 0.5) return [a];
  const out = [];
  if (y0 > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: y0 - a.y });
  if (y1 < a.y + a.h) out.push({ x: a.x, y: y1, w: a.w, h: a.y + a.h - y1 });
  if (x0 > a.x) out.push({ x: a.x, y: y0, w: x0 - a.x, h: y1 - y0 });
  if (x1 < a.x + a.w) out.push({ x: x1, y: y0, w: a.x + a.w - x1, h: y1 - y0 });
  return out.filter((r) => r.w > 0.5 && r.h > 0.5);
}

const area = (rects) => rects.reduce((s, r) => s + r.w * r.h, 0);

function intersects(a, b, eps = 1) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > eps &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > eps;
}

// Пересекаются ли формы двух комнат (по площади, не касанием).
export function roomsIntersect(a, b) {
  const rb = roomRects(b);
  return roomRects(a).some((p) => rb.some((q) => intersects(p, q)));
}

// Может ли пара участвовать: обе верхнего уровня, не шахты, не открытые
// площадки (терраса всегда под домом — её площадь считает eatersOf).
export function eatablePair(lower, upper) {
  if (!lower || !upper || lower.id === upper.id) return false;
  if (lower.parentId || upper.parentId) return false;
  if (isShaft(lower) || isShaft(upper) || isOpenRoom(lower) || isOpenRoom(upper)) return false;
  return true;
}

// Новая форма нижней комнаты. gap — толщина перегородки между ними.
// → { ok: true, pts, rects, areaM2 } | { ok: false, why: 'whole'|'split'|'small'|'none' }.
export function eatShape(lower, upper, gap = 0, minSize = MIN_ROOM_SIZE) {
  const before = roomRects(lower);
  const cut = roomRects(upper).map((q) => ({ x: q.x - gap, y: q.y - gap, w: q.w + gap * 2, h: q.h + gap * 2 }));
  if (!before.some((p) => roomRects(upper).some((q) => intersects(p, q)))) return { ok: false, why: 'none' };
  let rest = before;
  for (const q of cut) rest = rest.flatMap((r) => rectMinus(r, q));
  rest = rest.filter((r) => Math.min(r.w, r.h) >= EAT_SLIVER);
  if (!rest.length) return { ok: false, why: 'whole' };
  if (!rest.some((r) => r.w >= minSize && r.h >= minSize)) return { ok: false, why: 'small' };
  const cycles = rectsCycles(rest);
  if (cycles.length !== 1 || cycles[0].area <= 0) return { ok: false, why: 'split' };
  return { ok: true, pts: cycles[0].pts, rects: rest, cut, areaM2: (area(before) - area(rest)) / 1e6 };
}

// Проверка пары с учётом вложенных помещений нижней комнаты.
// → { ok, why, shape }.
export function eatPlan(project, lower, upper) {
  if (!eatablePair(lower, upper)) return { ok: false, why: 'none' };
  const gap = sharedWallThickness(project, lower.id, upper.id);
  const shape = eatShape(lower, upper, gap);
  if (!shape.ok) return { ok: false, why: shape.why };
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const probe = { ...lower, outline: shape.pts.map((p) => ({ x: p.x - lower.x, y: p.y - lower.y })) };
  delete probe.notch;
  finalizeRoomOutline(probe);
  for (const child of project.rooms || []) {
    if (child.parentId !== lower.id) continue;
    if (!rectInsideRoomShape(nestedOuterRect(child, partition), probe)) return { ok: false, why: 'children', child };
  }
  return { ok: true, shape, gap };
}

// Текст замечания норм для несъедаемого перекрытия.
export function eatFailText(why, lower, upper, child = null) {
  const a = `«${upper.name}»`; const b = `«${lower.name}»`;
  if (why === 'whole') return `${b} целиком под ${a} — передвиньте или удалите одну из комнат`;
  if (why === 'split') return `${a} разрезает ${b} на части — сдвиньте ${a} к краю ${b}`;
  if (why === 'small') return `От ${b} под ${a} остаётся меньше ${MIN_ROOM_SIZE} мм — передвиньте ${a}`;
  if (why === 'children') return `${a} закрывает вложенное помещение «${child?.name || ''}» в ${b}`;
  return `${a} перекрывает ${b}`;
}

// Применить план: форма нижней комнаты меняется, её проёмы остаются на месте
// в мире; проёмы, чья стена ушла под верхнюю комнату, удаляются.
// → { lost: [openingId] }.
function applyEat(project, lower, shape) {
  // Центр проёма под верхней комнатой (с зазором перегородки) — его стены
  // больше нет; иначе reanchor прижал бы его к остатку той же линии.
  const under = new Set();
  for (const a of captureOpeningAnchors(project, lower).list) {
    const x = a.orient === 'h' ? a.abs : a.edge;
    const y = a.orient === 'h' ? a.edge : a.abs;
    if (shape.cut.some((q) => x > q.x + 0.5 && x < q.x + q.w - 0.5 && y > q.y + 0.5 && y < q.y + q.h - 0.5)) under.add(a.id);
  }
  const { lost } = keepOpenings(project, lower, () => {
    lower.outline = shape.pts.map((p) => ({ x: p.x - lower.x, y: p.y - lower.y }));
    delete lower.notch;
    finalizeRoomOutline(lower);
  });
  const drop = new Set([...under, ...lost]);
  if (drop.size) project.openings = project.openings.filter((o) => !drop.has(o.id));
  return { lost: [...drop] };
}

// Снимок формы комнаты: по нему «съеденная» комната возвращает исходную форму,
// когда съедающая уезжает (room.eatBase = { base, now, by }).
const snapShape = (r) => {
  const o = { x: r.x, y: r.y, w: r.w, h: r.h };
  if (r.outline) o.outline = r.outline.map((p) => ({ x: p.x, y: p.y }));
  if (r.notch) o.notch = { ...r.notch };
  return o;
};
const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(snapShape(b));

// Съесть одной комнатой другую. → { ok, why, lost }.
export function eatRoom(project, lower, upper) {
  const plan = eatPlan(project, lower, upper);
  if (!plan.ok) return { ok: false, why: plan.why, child: plan.child, lost: [] };
  // База — форма до первого съедания; если комнату после него правили руками
  // (форма не совпала со снимком), база начинается заново.
  const keep = lower.eatBase && sameShape(lower.eatBase.now, lower) ? lower.eatBase : null;
  const base = keep ? keep.base : snapShape(lower);
  const by = keep ? keep.by : [];
  const res = applyEat(project, lower, plan.shape);
  if (!by.includes(upper.id)) by.push(upper.id);
  lower.eatBase = { base, now: snapShape(lower), by };
  return { ok: true, ...res };
}

// Вернуть съеденным комнатам исходную форму там, где съедавшая ушла:
// комнаты, съеденные одной из upperIds, сбрасываются к базе и заново
// съедаются теми, кто всё ещё перекрывает (кроме upperIds — их обработает
// основной проход). Комната, которую двигали сами (она в upperIds), или
// правленная руками забывает базу. → [{ lower }] восстановленные.
function restoreEaten(project, ids) {
  const reset = [];
  for (const lower of project.rooms || []) {
    const eb = lower.eatBase;
    if (!eb) continue;
    if (ids.has(lower.id) || !sameShape(eb.now, lower)) { delete lower.eatBase; continue; }
    if (!eb.by.some((id) => ids.has(id))) continue;
    keepOpenings(project, lower, () => {
      lower.x = eb.base.x; lower.y = eb.base.y; lower.w = eb.base.w; lower.h = eb.base.h;
      if (eb.base.outline) lower.outline = eb.base.outline.map((p) => ({ ...p })); else delete lower.outline;
      if (eb.base.notch) lower.notch = { ...eb.base.notch }; else delete lower.notch;
      finalizeRoomOutline(lower);
    });
    delete lower.eatBase;
    reset.push({ lower, by: eb.by });
  }
  const restored = [];
  for (const { lower, by } of reset) {
    for (const id of by) {
      const upper = project.rooms.find((r) => r.id === id);
      if (!upper || ids.has(id) || !eatablePair(lower, upper) || !roomsIntersect(lower, upper)) continue;
      eatRoom(project, lower, upper);
    }
    restored.push({ lower });
  }
  return restored;
}

// Комнаты upperIds (поставленные/сдвинутые/растянутые последними) съедают
// все перекрытые ими комнаты верхнего уровня. Комнаты из upperIds друг друга
// не едят (их взаимное положение жест не менял). Несъеденные перекрытые
// комнаты уходят вниз по z (upper — в конец массива), как раньше.
// → { eaten: [{ lower, upper }], failed: [{ lower, upper, why, child }], lost: [openingId] }.
export function eatOverlaps(project, upperIds) {
  const ids = new Set(upperIds);
  const eaten = []; const failed = []; const lost = [];
  const restored = restoreEaten(project, ids);
  for (const id of ids) {
    const upper = (project.rooms || []).find((r) => r.id === id);
    if (!upper) continue;
    for (const lower of [...project.rooms]) {
      if (ids.has(lower.id) || !eatablePair(lower, upper) || !roomsIntersect(lower, upper)) continue;
      const res = eatRoom(project, lower, upper);
      if (res.ok) { eaten.push({ lower, upper }); lost.push(...res.lost); } else failed.push({ lower, upper, why: res.why, child: res.child });
    }
  }
  // Несъеденные: верхняя — поверх по z (она забирает площадь, eatersOf).
  for (const f of failed) {
    const i = project.rooms.indexOf(f.upper);
    if (i >= 0 && i < project.rooms.indexOf(f.lower)) {
      project.rooms.splice(i, 1);
      project.rooms.push(f.upper);
    }
  }
  return { eaten, failed, lost, restored };
}

// Короткий итог для тоста. null — нечего сказать.
export function eatSummary(res) {
  if (!res) return null;
  const parts = [];
  const back = (res.restored || []).filter((r) => !res.eaten.some((e) => e.lower === r.lower));
  if (back.length) parts.push(`Форма восстановлена: ${back.map((r) => `«${r.lower.name}»`).join(', ')}`);
  if (res.eaten.length === 1) parts.push(`Комната «${res.eaten[0].lower.name}» уменьшена: пересечение с «${res.eaten[0].upper.name}»`);
  else if (res.eaten.length > 1) parts.push(`Уменьшены по пересечению: ${res.eaten.map((e) => `«${e.lower.name}»`).join(', ')}`);
  if (res.lost.length) parts.push(`удалено проёмов под комнатой: ${res.lost.length}`);
  if (res.failed.length) parts.push(eatFailText(res.failed[0].why, res.failed[0].lower, res.failed[0].upper, res.failed[0].child));
  return parts.length ? parts.join('; ') : null;
}

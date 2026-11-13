// Проёмы в перекрытии (над лестницей). Чистый модуль без DOM и без импортов
// (его берут rooms.js, mesh3d.js и model.js — без циклов).
//
// Лестница (предмет kind 'stairs') ведёт на этаж: item.toLevel — id этажа
// выше; 'none' — никуда; нет поля — на ближайший этаж выше (как раньше: старые
// проекты сразу получают проём). Высота подъёма при явном toLevel — разница
// отметок этажей (syncStairLevels → core/stairs.js setStairRise).
//
// Авто-проём не хранится: он выводится из лестницы — прямоугольник габарита
// лестницы (марши и площадки, с поворотом — по описанному прямоугольнику) с
// зазором SLAB_OPENING_GAP — в перекрытии каждого этажа над лестницей до
// целевого включительно. Поэтому он следует за лестницей, удаляется и
// копируется вместе с ней.
//
// Ручной проём хранится в этаже, чей пол он режет: level.slabOpenings[] —
// { id, x, y, w, h } (левый верхний угол и размеры, оси дома) и необязательный
// stairId: правленный руками авто-проём этой лестницы (он заменяет авто-проём,
// за лестницей больше не следует; «Вернуть авто» — удалить запись). Если
// лестницы нет — обычный ручной проём. Пустой список не хранится.

export const SLAB_OPENING_GAP = 100; // мм — зазор от габарита лестницы до края проёма
export const SLAB_OPENING_MIN = 300; // мм — меньше проём не бывает
export const AUTO_PREFIX = 'auto:';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function levelsUp(project) {
  return [...(project.levels || [])].sort((a, b) => a.elevation - b.elevation);
}

function newId() {
  return `slab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Этаж, где стоит предмет.
export function itemLevel(project, itemId) {
  return (project.levels || []).find((l) => (l.items || []).some((i) => i.id === itemId)) || null;
}

// Этаж, на который ведёт лестница (или null). from — этаж лестницы.
export function stairTargetLevel(project, item, from = itemLevel(project, item?.id)) {
  if (!item || item.kind !== 'stairs' || !from || item.toLevel === 'none') return null;
  const list = levelsUp(project);
  if (item.toLevel) {
    const t = list.find((l) => l.id === item.toLevel);
    return t && t.elevation > from.elevation + 1 ? t : null;
  }
  return list.find((l) => l.elevation > from.elevation + 1) || null;
}

// Высота подъёма по этажам (мм) или null.
export function stairRiseByLevels(project, item, from = itemLevel(project, item?.id)) {
  const t = stairTargetLevel(project, item, from);
  return t ? t.elevation - from.elevation : null;
}

// Описанный прямоугольник лестницы (поворот вокруг центра) с зазором.
export function stairOpeningRect(item, gap = SLAB_OPENING_GAP) {
  const a = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const hw = (item.w * c + item.h * s) / 2 + gap;
  const hh = (item.w * s + item.h * c) / 2 + gap;
  const r = (v) => Math.round(v);
  return { x: r(item.x - hw), y: r(item.y - hh), w: r(2 * hw), h: r(2 * hh) };
}

// Нормализация хранимого списка (core/model.js): битые записи — прочь.
export function normalizeSlabOpenings(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const o of list) {
    if (!isObj(o)) continue;
    const x = fin(o.x); const y = fin(o.y); const w = fin(o.w); const h = fin(o.h);
    if (x == null || y == null || !(w > 0) || !(h > 0)) continue;
    let id = typeof o.id === 'string' && o.id && !o.id.startsWith(AUTO_PREFIX) ? o.id : newId();
    if (ids.has(id)) id = newId();
    ids.add(id);
    const next = { ...o, id, x, y, w, h };
    if (typeof next.stairId !== 'string' || !next.stairId) delete next.stairId;
    delete next.auto;
    out.push(next);
  }
  return out;
}

// Все проёмы в перекрытии под этажом levelId (в его полу): авто от лестниц
// этажей ниже + ручные. { id, x, y, w, h, auto, stairId?, fromLevelId? }.
export function slabOpenings(project, levelId = project?.activeLevel) {
  const list = levelsUp(project || {});
  const level = list.find((l) => l.id === levelId);
  if (!level) return [];
  const stored = Array.isArray(level.slabOpenings) ? level.slabOpenings : [];
  const overridden = new Set(stored.map((o) => o.stairId).filter(Boolean));
  const out = [];
  for (const below of list) {
    if (below.elevation >= level.elevation - 1) break;
    for (const item of below.items || []) {
      if (item.kind !== 'stairs' || overridden.has(item.id)) continue;
      const t = stairTargetLevel(project, item, below);
      if (!t || t.elevation < level.elevation - 1) continue;
      out.push({ id: AUTO_PREFIX + item.id, ...stairOpeningRect(item), auto: true, stairId: item.id, fromLevelId: below.id });
    }
  }
  for (const o of stored) out.push({ ...o, auto: false });
  return out;
}

export function findSlabOpening(project, levelId, id) {
  return slabOpenings(project, levelId).find((o) => o.id === id) || null;
}

// Лестница проёма (если есть в проекте).
export function slabOpeningStair(project, opening) {
  if (!opening?.stairId) return null;
  for (const l of project.levels || []) {
    const it = (l.items || []).find((i) => i.id === opening.stairId && i.kind === 'stairs');
    if (it) return it;
  }
  return null;
}

// Хранимая запись проёма (авто — превращается в ручной на месте). → запись.
export function materializeSlabOpening(project, levelId, id) {
  const level = (project.levels || []).find((l) => l.id === levelId);
  const o = findSlabOpening(project, levelId, id);
  if (!level || !o) return null;
  if (!o.auto) return level.slabOpenings.find((s) => s.id === id);
  const rec = { id: newId(), x: o.x, y: o.y, w: o.w, h: o.h, stairId: o.stairId };
  if (!Array.isArray(level.slabOpenings)) level.slabOpenings = [];
  level.slabOpenings.push(rec);
  return rec;
}

// Новый прямоугольник проёма (ручки, поля «Свойств»). Авто → ручной. → запись.
export function setSlabOpeningRect(project, levelId, id, rect) {
  const rec = materializeSlabOpening(project, levelId, id);
  if (!rec) return null;
  const w = Math.max(SLAB_OPENING_MIN, Math.round(rect.w));
  const h = Math.max(SLAB_OPENING_MIN, Math.round(rect.h));
  Object.assign(rec, { x: Math.round(rect.x), y: Math.round(rect.y), w, h });
  return rec;
}

// «Вернуть авто по лестнице»: ручная запись лестницы удаляется. → id авто-проёма или null.
export function resetSlabOpeningAuto(project, levelId, id) {
  const level = (project.levels || []).find((l) => l.id === levelId);
  const rec = level?.slabOpenings?.find((s) => s.id === id);
  if (!rec?.stairId || !slabOpeningStair(project, rec)) return null;
  removeStored(level, id);
  return AUTO_PREFIX + rec.stairId;
}

function removeStored(level, id) {
  level.slabOpenings = level.slabOpenings.filter((s) => s.id !== id);
  if (!level.slabOpenings.length) delete level.slabOpenings;
}

// Удаление ручного проёма (авто удаляется вместе с лестницей или «Ведёт на
// этаж: никуда»). → true, если удалён.
export function removeSlabOpening(project, levelId, id) {
  const level = (project.levels || []).find((l) => l.id === levelId);
  if (!level?.slabOpenings?.some((s) => s.id === id)) return false;
  removeStored(level, id);
  return true;
}

// Ручка проёма: сторона ('n','e','s','w') или угол ('nw','ne','se','sw') —
// новый прямоугольник по точке (оси дома), противоположная сторона на месте.
export function dragSlabRect(rect, handle, point, snap = 10) {
  const q = (v) => (snap > 1 ? Math.round(v / snap) * snap : Math.round(v));
  let x0 = rect.x; let y0 = rect.y; let x1 = rect.x + rect.w; let y1 = rect.y + rect.h;
  const M = SLAB_OPENING_MIN;
  if (handle.includes('w')) x0 = Math.min(q(point.x), x1 - M);
  if (handle.includes('e')) x1 = Math.max(q(point.x), x0 + M);
  if (handle.includes('n')) y0 = Math.min(q(point.y), y1 - M);
  if (handle.includes('s')) y1 = Math.max(q(point.y), y0 + M);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Точки ручек прямоугольника (оси дома).
export function slabHandlePoints(r) {
  const xm = r.x + r.w / 2; const ym = r.y + r.h / 2; const x1 = r.x + r.w; const y1 = r.y + r.h;
  return [
    { id: 'n', x: xm, y: r.y }, { id: 'e', x: x1, y: ym }, { id: 's', x: xm, y: y1 }, { id: 'w', x: r.x, y: ym },
    { id: 'nw', x: r.x, y: r.y }, { id: 'ne', x: x1, y: r.y }, { id: 'se', x: x1, y: y1 }, { id: 'sw', x: r.x, y: y1 },
  ];
}

// Лестницы с явным «Ведёт на этаж»: высота подъёма = разница отметок; этаж
// удалён или стал ниже — поле снимается (ведёт на ближайший выше). setRise —
// core/stairs.js setStairRise (передаётся, чтобы модуль остался без импортов).
// → число изменённых лестниц.
export function syncStairLevels(project, setRise) {
  let changed = 0;
  for (const level of project.levels || []) {
    for (const item of level.items || []) {
      if (item.kind !== 'stairs' || !item.toLevel || item.toLevel === 'none') continue;
      const t = (project.levels || []).find((l) => l.id === item.toLevel);
      if (!t || t.elevation <= level.elevation + 1) { delete item.toLevel; changed += 1; continue; }
      const rise = t.elevation - level.elevation;
      if (Math.abs((item.floorHeight || 0) - rise) > 0.5) { setRise(item, rise, level.height); changed += 1; }
    }
  }
  return changed;
}

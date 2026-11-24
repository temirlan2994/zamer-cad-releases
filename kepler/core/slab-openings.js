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
// { id, x, y, w, h, outline? } (габарит и необязательный локальный контур,
// как у помещений) и необязательный
// stairId: правленный руками авто-проём этой лестницы (он заменяет авто-проём,
// за лестницей больше не следует; «Вернуть авто» — удалить запись). Если
// лестницы нет — обычный ручной проём. Пустой список не хранится.

export const SLAB_OPENING_GAP = 100; // мм — зазор от габарита лестницы до края проёма
export const SLAB_OPENING_MIN = 300; // мм — меньше проём не бывает
export const AUTO_PREFIX = 'auto:';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

const samePoint = (a, b, eps = 0.5) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

function polygonArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, p, eps = 0.5) {
  return Math.abs(orient(a, b, p)) <= eps &&
    p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
}

function segmentsCross(a, b, c, d) {
  const abC = orient(a, b, c); const abD = orient(a, b, d);
  const cdA = orient(c, d, a); const cdB = orient(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function simplePolygon(points) {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i]; const b = points[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      if (segmentsCross(a, b, points[j], points[(j + 1) % n])) return false;
    }
  }
  return true;
}

function cleanPolygon(input) {
  if (!Array.isArray(input)) return null;
  let points = input.map((p) => ({ x: fin(p?.x), y: fin(p?.y) }))
    .filter((p) => p.x != null && p.y != null);
  points = points.filter((p, i) => !samePoint(p, points[(i - 1 + points.length) % points.length]));
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[(i - 1 + points.length) % points.length];
      const b = points[i]; const c = points[(i + 1) % points.length];
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      if (Math.abs(orient(a, b, c)) / len > 0.5) continue;
      points.splice(i, 1); changed = true; break;
    }
  }
  if (points.length < 3 || Math.abs(polygonArea(points)) < 1 || !simplePolygon(points)) return null;
  if (polygonArea(points) < 0) points.reverse();
  return points;
}

function polygonBounds(points) {
  const minX = Math.min(...points.map((p) => p.x)); const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)); const maxY = Math.max(...points.map((p) => p.y));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Абсолютный контур проёма. У старого прямоугольника он выводится из x/y/w/h.
export function slabOpeningPolygon(o) {
  if (Array.isArray(o?.outline) && o.outline.length >= 3) {
    const p = cleanPolygon(o.outline.map((q) => ({ x: Number(o.x) + Number(q.x), y: Number(o.y) + Number(q.y) })));
    if (p) return p;
  }
  return [
    { x: o.x, y: o.y }, { x: o.x + o.w, y: o.y },
    { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h },
  ];
}

export function slabOpeningArea(o) {
  return Math.abs(polygonArea(slabOpeningPolygon(o)));
}

// Контур → горизонтальные полосы. Для прямых рёбер площадь точна (правило
// средней точки), а шаг не более maxStep даёт аккуратный диагональный торец в
// существующем прямоугольном генераторе пола/перекрытия.
export function slabOpeningCutRects(o, maxStep = 100) {
  if (!o?.outline?.length) return [{ x: o.x, y: o.y, w: o.w, h: o.h }];
  const points = slabOpeningPolygon(o);
  const bounds = polygonBounds(points);
  const ys = new Set(points.map((p) => p.y));
  const steps = Math.max(1, Math.ceil(bounds.h / Math.max(10, maxStep)));
  for (let i = 1; i < steps; i += 1) ys.add(bounds.y + (bounds.h * i) / steps);
  const bands = [...ys].sort((a, b) => a - b);
  const rows = [];
  for (let k = 0; k + 1 < bands.length; k += 1) {
    const y0 = bands[k]; const y1 = bands[k + 1]; const y = (y0 + y1) / 2;
    if (y1 - y0 < 0.5) continue;
    const xs = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      if ((a.y > y) === (b.y > y)) continue;
      xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > 0.5) rows.push({ x: xs[i], y: y0, w: xs[i + 1] - xs[i], h: y1 - y0 });
    }
  }
  const merged = [];
  for (const r of rows) {
    const above = merged.find((q) => Math.abs(q.x - r.x) < 0.5 && Math.abs(q.w - r.w) < 0.5 && Math.abs(q.y + q.h - r.y) < 0.5);
    if (above) above.h += r.h; else merged.push({ ...r });
  }
  return merged;
}

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
    if (Array.isArray(o.outline)) {
      const outline = cleanPolygon(o.outline);
      if (outline) {
        const absolute = outline.map((p) => ({ x: x + p.x, y: y + p.y }));
        const b = polygonBounds(absolute);
        if (b.w >= SLAB_OPENING_MIN && b.h >= SLAB_OPENING_MIN) {
          Object.assign(next, b);
          next.outline = absolute.map((p) => ({ x: p.x - b.x, y: p.y - b.y }));
        } else delete next.outline;
      } else delete next.outline;
    } else delete next.outline;
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

// Этаж, который виден сквозь проём: у лестничного — этаж лестницы, у
// обычного ручного — ближайший ниже перекрытия.
export function slabOpeningSourceLevel(project, levelId, opening) {
  if (opening?.fromLevelId) return (project.levels || []).find((l) => l.id === opening.fromLevelId) || null;
  if (opening?.stairId) return itemLevel(project, opening.stairId);
  const level = (project.levels || []).find((l) => l.id === levelId);
  if (!level) return null;
  return levelsUp(project).filter((l) => l.elevation < level.elevation - 1).at(-1) || null;
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

// Новый ручной проём произвольной формы. points — абсолютные точки в осях дома.
export function createSlabOpening(project, levelId, points) {
  const level = (project.levels || []).find((l) => l.id === levelId);
  const polygon = cleanPolygon(points);
  if (!level || !polygon) return null;
  const b = polygonBounds(polygon);
  if (b.w < SLAB_OPENING_MIN || b.h < SLAB_OPENING_MIN) return null;
  const rec = {
    id: newId(), ...b,
    outline: polygon.map((p) => ({ x: Math.round(p.x - b.x), y: Math.round(p.y - b.y) })),
  };
  if (!Array.isArray(level.slabOpenings)) level.slabOpenings = [];
  level.slabOpenings.push(rec);
  return rec;
}

// Новый контур существующего проёма. Авто → ручной; stairId сохраняется.
export function setSlabOpeningPolygon(project, levelId, id, points) {
  const polygon = cleanPolygon(points);
  if (!polygon) return null;
  const b = polygonBounds(polygon);
  if (b.w < SLAB_OPENING_MIN || b.h < SLAB_OPENING_MIN) return null;
  const rec = materializeSlabOpening(project, levelId, id);
  if (!rec) return null;
  Object.assign(rec, {
    x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h),
    outline: polygon.map((p) => ({ x: Math.round(p.x - b.x), y: Math.round(p.y - b.y) })),
  });
  return rec;
}

// Новый прямоугольник проёма (ручки, поля «Свойств»). Авто → ручной. → запись.
export function setSlabOpeningRect(project, levelId, id, rect) {
  const rec = materializeSlabOpening(project, levelId, id);
  if (!rec) return null;
  const w = Math.max(SLAB_OPENING_MIN, Math.round(rect.w));
  const h = Math.max(SLAB_OPENING_MIN, Math.round(rect.h));
  const x = Math.round(rect.x); const y = Math.round(rect.y);
  if (rec.outline?.length) {
    const old = slabOpeningPolygon(rec);
    const sx = w / (rec.w || 1); const sy = h / (rec.h || 1);
    rec.outline = old.map((p) => ({ x: Math.round((p.x - rec.x) * sx), y: Math.round((p.y - rec.y) * sy) }));
  }
  Object.assign(rec, { x, y, w, h });
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
  const rec = level?.slabOpenings?.find((s) => s.id === id);
  if (!rec) return false;
  if (rec.atrium?.windowId) {
    const lower = project.levels.find((l) => l.id === rec.fromLevelId);
    const window = lower?.openings.find((o) => o.id === rec.atrium.windowId);
    if (window?.span?.levelId === levelId && window.span.topGap === 0) delete window.span;
  }
  removeStored(level, id);
  return true;
}

// При удалении комнаты (или всего этажа) связанный второй свет уходит
// вместе с ней, в том числе если сам проём хранится этажом выше.
export function removeOwnedAtriums(project, levelId, roomIds = null) {
  for (const level of project.levels || []) {
    for (const opening of level.slabOpenings || []) {
      if (!opening.atrium) continue;
      const { roomId, upperRoomId } = opening.atrium;
      if ((opening.fromLevelId === levelId && (!roomIds || roomIds.has(roomId))) ||
          (level.id === levelId && (!roomIds || roomIds.has(upperRoomId)))) {
        removeSlabOpening(project, level.id, opening.id);
      }
    }
  }
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

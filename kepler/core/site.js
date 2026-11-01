// Участок Kepler Plan: граница, красная линия, зона застройки, въезд, дороги,
// соседние дома, север и инсоляция (солнце/тени). Чистый модуль без DOM.
// Все размеры в миллиметрах, ось Y вниз. Углы — градусы по часовой стрелке.

import { pointInPolygon } from './zamer/geometry.js';

export const DEFAULT_SETBACK_BOUNDARY = 1500; // отступ от границы участка, мм
export const DEFAULT_SETBACK_NEIGHBOR = 6000; // отступ от соседнего дома, мм
export const DEFAULT_ROAD_WIDTH = 3500;

export function createSite() {
  return {
    north: 0, // направление севера: 0 = вверх экрана плана, по часовой
    location: { lat: 43.238, lon: 76.889, tz: 5 }, // широта/долгота/UTC-пояс
    sun: { date: '2026-06-21', time: 12 * 60, enabled: false }, // time — минуты от полуночи
    buildingHeight: 6000, // высота дома для теней, мм
    setbackBoundary: DEFAULT_SETBACK_BOUNDARY,
    setbackNeighbor: DEFAULT_SETBACK_NEIGHBOR,
    showBuildZone: true,
    boundary: null, // [{x,y}...] — замкнутый полигон границы участка
    redLine: null, // [{x,y}...] — красная линия (ломаная)
    roads: [], // [{id, points:[{x,y}...], width}]
    neighbors: [], // [{id, x, y, w, h, height}] — соседние дома (прямоугольники)
    entry: null, // {x, y, angle} — въезд на участок (на границе)
    underlay: null, // {srcId, x, y, mmPerPx, opacity, locked, widthPx, heightPx}
    norms: { day: null, hours: null }, // норма инсоляции: null — по широте (core/insolation.js)
  };
}

export function ensureSite(project) {
  if (!project.site) project.site = createSite();
  const d = createSite();
  project.site = {
    ...d,
    ...project.site,
    location: { ...d.location, ...(project.site.location || {}) },
    sun: { ...d.sun, ...(project.site.sun || {}) },
    norms: { ...d.norms, ...(project.site.norms || {}) },
  };
  return project.site;
}

// ---------------------------------------------------------------- Полигоны

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2; // знак: >0 — против часовой (в экранных координатах по часовой)
}

export function polygonAreaM2(points) {
  return Math.abs(polygonArea(points)) / 1_000_000;
}

// Внутренний офсет простого полигона: каждое ребро сдвигается внутрь на
// distance, вершины — пересечения соседних сдвинутых рёбер. Надёжно для
// выпуклых и слабо-вогнутых контуров участка.
export function insetPolygon(points, distance) {
  if (!points || points.length < 3 || distance <= 0) return points ? [...points] : null;
  const sign = polygonArea(points) > 0 ? 1 : -1; // куда «внутрь»
  const n = points.length;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Нормаль внутрь полигона (экранные координаты, ось Y вниз).
    const nx = (-dy / len) * sign;
    const ny = (dx / len) * sign;
    lines.push({
      ax: a.x + nx * distance, ay: a.y + ny * distance,
      bx: b.x + nx * distance, by: b.y + ny * distance,
    });
  }
  const result = [];
  for (let i = 0; i < n; i += 1) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const point = lineIntersection(l1, l2);
    if (!point) return null; // параллельные рёбра/вырожденный случай
    result.push(point);
  }
  // Офсет «схлопнулся» — зона застройки исчезла. Признаки: смена ориентации,
  // вершина вне исходного контура или ближе distance к исходной границе.
  if (polygonArea(result) * polygonArea(points) <= 0) return null;
  if (polygonAreaM2(result) < 0.5) return null;
  for (const p of result) {
    if (!pointInPolygon(p, points)) return null;
    if (distanceToPolyline(points, p, true) < distance - 1) return null;
  }
  return result;
}

function lineIntersection(l1, l2) {
  const d1x = l1.bx - l1.ax;
  const d1y = l1.by - l1.ay;
  const d2x = l2.bx - l2.ax;
  const d2y = l2.by - l2.ay;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) {
    // Почти параллельны (прямой угол офсета) — берём стык отрезков.
    return { x: (l1.bx + l2.ax) / 2, y: (l1.by + l2.ay) / 2 };
  }
  const t = ((l2.ax - l1.ax) * d2y - (l2.ay - l1.ay) * d2x) / denom;
  return { x: l1.ax + d1x * t, y: l1.ay + d1y * t };
}

export function nearestPointOnPolyline(points, p, closed = false) {
  let best = null;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (!best || dist < best.dist) {
      best = { x, y, dist, segment: i, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
    }
  }
  return best;
}

export function distanceToPolyline(points, p, closed = false) {
  const near = nearestPointOnPolyline(points, p, closed);
  return near ? near.dist : Infinity;
}

// ---------------------------------------------------------------- Зона застройки

// Углы соседнего дома (с учётом поворота rot в градусах).
export function neighborRectCorners(n) {
  const rot = ((n.rot || 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const hw = n.w / 2;
  const hh = n.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => ({
    x: n.x + lx * c - ly * s,
    y: n.y + lx * s + ly * c,
  }));
}

// Запретная зона вокруг соседнего дома (отступ). Это рамка дома, раздутая на
// отступ со всех сторон и ПОВЁРНУТАЯ вместе с домом — возвращается полигоном.
export function neighborBuffers(site) {
  const buffer = site.setbackNeighbor ?? DEFAULT_SETBACK_NEIGHBOR;
  return (site.neighbors || []).map((n) => {
    const rot = ((n.rot || 0) * Math.PI) / 180;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const hw = n.w / 2 + buffer;
    const hh = n.h / 2 + buffer;
    const poly = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => ({
      x: n.x + lx * c - ly * s,
      y: n.y + lx * s + ly * c,
    }));
    return { poly, neighbor: n };
  });
}

// Полигон тени от произвольного набора углов при сдвиге {dx,dy}.
export function shadowPolygonFromCorners(corners, vector) {
  const moved = corners.map((c) => ({ x: c.x + vector.dx, y: c.y + vector.dy }));
  return convexHull([...corners, ...moved]);
}

// Полигон зоны застройки (инсет границы участка) или null, если границы нет.
export function buildZonePolygon(site) {
  if (!site.boundary || site.boundary.length < 3) return null;
  return insetPolygon(site.boundary, site.setbackBoundary ?? DEFAULT_SETBACK_BOUNDARY);
}

// Проверка: прямоугольник (внешний габарит дома/комнаты) внутри зоны застройки
// и вне буферов соседей. corners — 4 мировых угла (дом повёрнут относительно
// участка, см. core/building.js); иначе берутся из rect. Возвращает { ok, reason }.
export function checkRectBuildable(site, rect, cornersOverride = null) {
  if (!site || !site.boundary || site.boundary.length < 3) return { ok: true };
  const zone = buildZonePolygon(site);
  const setbackM = ((site.setbackBoundary ?? DEFAULT_SETBACK_BOUNDARY) / 1000).toLocaleString('ru-RU');
  if (!zone) {
    return { ok: false, reason: `Отступ ${setbackM} м съедает весь участок — зоны застройки не остаётся` };
  }
  const corners = cornersOverride || [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  for (const corner of corners) {
    if (!pointInPolygon(corner, zone)) {
      return { ok: false, reason: `Выходит за границу застройки (отступ ${setbackM} м от границы участка)` };
    }
  }
  for (const buf of neighborBuffers(site)) {
    if (convexPolysOverlap(corners, buf.poly)) {
      const m = ((site.setbackNeighbor ?? DEFAULT_SETBACK_NEIGHBOR) / 1000).toLocaleString('ru-RU');
      return { ok: false, reason: `Ближе ${m} м к соседнему дому` };
    }
  }
  return { ok: true };
}

// Пересечение двух выпуклых многоугольников (теорема о разделяющей оси).
function convexPolysOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      let minA = Infinity; let maxA = -Infinity; let minB = Infinity; let maxB = -Infinity;
      for (const v of a) { const d = v.x * nx + v.y * ny; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const v of b) { const d = v.x * nx + v.y * ny; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- Солнце

// Положение солнца по упрощённому алгоритму NOAA.
// date: 'YYYY-MM-DD', minutes: локальные минуты от полуночи, tz: часы от UTC.
// Возвращает { altitude, azimuth } в градусах; азимут от севера по часовой.
export function sunPosition(lat, lon, tz, dateStr, minutes) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const start = Date.UTC(year, 0, 0);
  const current = Date.UTC(year, month - 1, day);
  const dayOfYear = Math.round((current - start) / 86400000);
  const hours = minutes / 60;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const timeOffset = eqtime + 4 * lon - 60 * tz;
  const tst = minutes + timeOffset;
  const haDeg = tst / 4 - 180;
  const ha = (haDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;

  const cosZenith = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const altitude = 90 - (zenith * 180) / Math.PI;

  let azimuth;
  const sinZenith = Math.sin(zenith);
  if (sinZenith < 1e-6) {
    azimuth = 180;
  } else {
    // Азимут от севера по часовой: утром (ha<0) — восточная половина 0..180.
    const cosAz = (Math.sin(decl) - Math.sin(latRad) * Math.cos(zenith)) / (Math.cos(latRad) * sinZenith);
    let az = (Math.acos(Math.min(1, Math.max(-1, cosAz))) * 180) / Math.PI;
    if (haDeg > 0) az = 360 - az; // после полудня солнце на западе
    azimuth = az;
  }
  return { altitude, azimuth };
}

// Вектор тени в мировых координатах плана для объекта высотой height (мм).
// north — направление севера на плане (градусы по часовой, 0 = вверх).
// Возвращает {dx, dy} (мм) или null, если солнце за горизонтом.
export function shadowVector(sun, north, height) {
  if (sun.altitude <= 0.5) return null;
  const length = height / Math.tan((sun.altitude * Math.PI) / 180);
  // Направление НА солнце в мире: север повёрнут на azimuth.
  const angle = ((north + sun.azimuth) * Math.PI) / 180;
  const sunDirX = Math.sin(angle);
  const sunDirY = -Math.cos(angle);
  // Тень падает от солнца.
  return { dx: -sunDirX * length, dy: -sunDirY * length };
}

// Полигон тени прямоугольника footprint при сдвиге {dx,dy}: выпуклая оболочка
// исходных и сдвинутых углов (для прямоугольника корректна и проста).
export function shadowPolygon(rect, vector) {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  const moved = corners.map((c) => ({ x: c.x + vector.dx, y: c.y + vector.dy }));
  return convexHull([...corners, ...moved]);
}

export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function formatSunInfo(sun) {
  if (sun.altitude <= 0.5) return 'Солнце за горизонтом';
  const compass = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const dir = compass[Math.round(sun.azimuth / 45) % 8];
  return `Высота ${sun.altitude.toFixed(0)}°, азимут ${sun.azimuth.toFixed(0)}° (${dir})`;
}

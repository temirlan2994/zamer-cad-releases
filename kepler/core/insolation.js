// Инсоляция помещений через окна. Чистый модуль без DOM.
//
// Упрощённая оценка по правилам СанПиН 1.2.3685-21 (РФ; в РК — те же зоны):
//   южнее 48° с.ш. — 1,5 ч в день на 22 февраля, не считаются 1,5 ч после
//     восхода и до захода солнца;
//   48–58° — 2 ч на 22 апреля, не считается 1 ч у восхода и захода;
//   севернее 58° — 2,5 ч на 22 апреля, 1 ч у восхода и захода.
// Прерывистая инсоляция допустима, если суммарно на 0,5 ч больше нормы и
// один из периодов не короче 1 ч. Норму должны выполнять жилые комнаты:
// хотя бы одна (при 1–3 жилых комнатах) или две (при 4 и больше).
//
// Солнце «видно» из окна, если оно над горизонтом, светит в фасад не
// круче 75° к нормали (лучи вдоль фасада не считаются) и луч от окна к
// солнцу не перекрыт соседним домом или другой частью этого же дома.
// Точка расчёта — середина окна снаружи на уровне подоконника.

import { isOpenRoom } from './catalog.js';
import { rectCornersWorld, toWorld } from './building.js';
import { levelProject, sortedLevels } from './model.js';
import { neighborRectCorners, sunPosition } from './site.js';
import { deriveWalls, openingRect } from './walls.js';
import { LIVING_TYPES } from './schedule.js';

export const STEP_MIN = 5;
const FACADE_LIMIT = Math.cos((75 * Math.PI) / 180);

// Зона и норма по широте.
export function insolationZone(lat) {
  if (lat < 48) return { zone: 'южная', hours: 1.5, day: '02-22', skip: 90 };
  if (lat <= 58) return { zone: 'центральная', hours: 2, day: '04-22', skip: 60 };
  return { zone: 'северная', hours: 2.5, day: '04-22', skip: 60 };
}

// Норма проекта: зона по широте участка, дата/часы можно переопределить
// (site.norms.day 'MM-DD', site.norms.hours).
export function insolationNorm(site) {
  const z = insolationZone(site.location?.lat ?? 43.238);
  const year = Number(String(site.sun?.date || '').slice(0, 4)) || new Date().getFullYear();
  const day = site.norms?.day || z.day;
  const hours = Number(site.norms?.hours) > 0 ? Number(site.norms.hours) : z.hours;
  return { ...z, day, hours, date: `${year}-${day}` };
}

// Положения солнца за день с шагом STEP_MIN, без часов у восхода и захода.
export function sunTable(site, norm) {
  const { lat, lon, tz } = site.location;
  const all = [];
  for (let m = 0; m < 1440; m += STEP_MIN) {
    const s = sunPosition(lat, lon, tz, norm.date, m + STEP_MIN / 2);
    all.push({ minute: m, ...s });
  }
  const up = all.filter((s) => s.altitude > 0);
  if (!up.length) return [];
  const rise = up[0].minute;
  const set = up[up.length - 1].minute + STEP_MIN;
  const north = ((site.north || 0) * Math.PI) / 180;
  return up
    .filter((s) => s.minute >= rise + norm.skip && s.minute + STEP_MIN <= set - norm.skip)
    .map((s) => {
      const a = north + (s.azimuth * Math.PI) / 180;
      return { ...s, dir: { x: Math.sin(a), y: -Math.cos(a) }, tanAlt: Math.tan((s.altitude * Math.PI) / 180) };
    });
}

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// Расстояние по лучу P + t·D (t ≥ 0) до входа в выпуклый многоугольник
// или null (алгоритм Цируса — Бека).
export function rayEnter(P, D, poly) {
  const sign = Math.sign(signedArea(poly)) || 1;
  let tIn = -Infinity;
  let tOut = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const nx = sign * (b.y - a.y);
    const ny = -sign * (b.x - a.x); // внешняя нормаль ребра
    const num = nx * (a.x - P.x) + ny * (a.y - P.y);
    const den = nx * D.x + ny * D.y;
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null; // параллельно и снаружи
      continue;
    }
    const t = num / den;
    if (den < 0) tIn = Math.max(tIn, t); else tOut = Math.min(tOut, t);
    if (tIn > tOut) return null;
  }
  if (tOut < 0) return null;
  return Math.max(tIn, 0);
}

// Препятствия: соседние дома и сам дом по этажам (верх = отметка + высота).
export function obstaclesOf(project) {
  const out = [];
  for (const n of project.site?.neighbors || []) {
    out.push({ poly: neighborRectCorners(n), top: n.height || 6000 });
  }
  const t = project.settings?.exterior || 250;
  for (const level of project.levels) {
    for (const r of level.rooms) {
      if (r.parentId || isOpenRoom(r)) continue;
      out.push({
        poly: rectCornersWorld(project.building, { x: r.x - t, y: r.y - t, w: r.w + t * 2, h: r.h + t * 2 }),
        top: level.elevation + level.height,
      });
    }
  }
  return out;
}

const NORMALS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

// Окна всех этажей: середина снаружи (мир), внешняя нормаль (мир), высота.
export function windowsOf(project) {
  const out = [];
  const rot = ((project.building?.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const level of project.levels) {
    const lp = levelProject(project, level.id);
    const walls = deriveWalls(lp);
    for (const o of lp.openings) {
      if (o.kind !== 'window') continue;
      const placed = openingRect(lp, o, walls);
      if (!placed) continue;
      const b = placed.wall.band;
      const at = [
        { x: placed.absCenter, y: b.y },
        { x: b.x + b.w, y: placed.absCenter },
        { x: placed.absCenter, y: b.y + b.h },
        { x: b.x, y: placed.absCenter },
      ][o.side];
      const n = NORMALS[o.side];
      const normal = { x: n.x * c - n.y * s, y: n.x * s + n.y * c };
      const p = toWorld(project.building, at);
      out.push({
        roomId: o.roomId,
        levelId: level.id,
        // Чуть наружу от фасада, чтобы не задеть собственную стену.
        at: { x: p.x + normal.x * 20, y: p.y + normal.y * 20 },
        normal,
        z: level.elevation + (o.sill ?? 900),
      });
    }
  }
  return out;
}

function visible(win, sun, obstacles) {
  const facing = sun.dir.x * win.normal.x + sun.dir.y * win.normal.y;
  if (facing < FACADE_LIMIT) return false;
  for (const ob of obstacles) {
    if (ob.top <= win.z) continue;
    const t = rayEnter(win.at, sun.dir, ob.poly);
    if (t !== null && ob.top - win.z > t * sun.tanAlt) return false;
  }
  return true;
}

// Периоды подряд из флагов по шагам: [[начало, конец] в минутах].
function periods(flags, table) {
  const out = [];
  let start = null;
  for (let i = 0; i <= flags.length; i += 1) {
    const on = i < flags.length && flags[i];
    const contiguous = i > 0 && i < flags.length && table[i].minute - table[i - 1].minute === STEP_MIN;
    if (on && start === null) start = i;
    else if (start !== null && (!on || !contiguous)) {
      out.push([table[start].minute, table[i - 1].minute + STEP_MIN]);
      start = on ? i : null;
    }
  }
  return out;
}

export function meetsNorm(result, hours) {
  const req = hours * 60;
  if (result.longest >= req) return true;
  return result.total >= req + 30 && result.longest >= 60;
}

// Отчёт: норма, результат по каждой комнате и вывод по дому.
export function insolationReport(project) {
  const site = project.site;
  const norm = insolationNorm(site);
  const table = sunTable(site, norm);
  const obstacles = obstaclesOf(project);
  const wins = windowsOf(project);
  const rooms = [];
  for (const level of sortedLevels(project)) {
    for (const room of level.rooms) {
      const own = wins.filter((w) => w.roomId === room.id);
      const flags = table.map((sun) => own.some((w) => visible(w, sun, obstacles)));
      const per = periods(flags, table);
      const total = per.reduce((s, [a, b]) => s + (b - a), 0);
      const longest = per.reduce((m, [a, b]) => Math.max(m, b - a), 0);
      const res = { id: room.id, levelId: level.id, name: room.name, type: room.type, windows: own.length, periods: per, total, longest };
      res.living = LIVING_TYPES.has(room.type);
      res.meets = meetsNorm(res, norm.hours);
      rooms.push(res);
    }
  }
  const living = rooms.filter((r) => r.living);
  const need = living.length >= 4 ? 2 : living.length ? 1 : 0;
  const met = living.filter((r) => r.meets).length;
  return { norm, rooms, need, met, ok: met >= need };
}

// «2 ч 35 мин» из минут.
export function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

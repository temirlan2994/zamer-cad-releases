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
import { castsShadow } from './landscape-shadow.js';
import {
  elevOf, landscapeDef, objectOutline, objectPath, PLANTER_KINDS,
} from './landscape.js';
import { massBox } from './masses.js';
import { levelProject, sortedLevels } from './model.js';
import { openingHeight } from './opening-preset.js';
import {
  roofIsSlanted, roofRects, roofSlabOutline, roofZ, triangulate,
} from './roofs.js';
import { roomRects } from './room-shape.js';
import { convexHull, neighborRectCorners, sunPosition } from './site.js';
import { deriveWalls, hostOpeningRoom, openingRect, sideEdge } from './walls.js';
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

// Интервал луча P + t·D (t ≥ 0) внутри выпуклого многоугольника
// или null (алгоритм Цируса — Бека). exit нужен, чтобы луч мог
// пройти под консольным этажом до того, как поднимется до его низа.
export function rayRange(P, D, poly) {
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
  return { enter: Math.max(tIn, 0), exit: tOut };
}

// Обратно совместимый вход в полигон.
export function rayEnter(P, D, poly) {
  return rayRange(P, D, poly)?.enter ?? null;
}

// Интервал параметра t, на котором луч одновременно находится внутри
// горизонтального контура и между отметками объёма. Нужен для CSG-вычитания
// полых масс: одного сравнения высоты на входе/выходе недостаточно, когда луч
// проходит через несколько cutter-объёмов подряд.
const RAY_VOLUME_EPS = 0.01;

function rayVolumeInterval(origin, z, sun, volume, horizontal = null) {
  const range = horizontal || rayRange(origin, sun.dir, volume.poly);
  if (!range) return null;
  const bottom = Number(volume.bottom);
  const top = Number(volume.top);
  if (!Number.isFinite(bottom) || !Number.isFinite(top) || top <= bottom + RAY_VOLUME_EPS * 2) return null;

  const tanAlt = Number.isFinite(Number(sun.tanAlt)) ? Number(sun.tanAlt) : 0;
  const low = bottom + RAY_VOLUME_EPS;
  const high = top - RAY_VOLUME_EPS;
  if (Math.abs(tanAlt) < 1e-12) return z > low && z < high ? range : null;

  const ta = (low - z) / tanAlt;
  const tb = (high - z) / tanAlt;
  const enter = Math.max(0, range.enter, Math.min(ta, tb));
  const exit = Math.min(range.exit, Math.max(ta, tb));
  return exit >= enter ? { enter, exit } : null;
}

// true, только если объединение cutter-объёмов закрывает ВЕСЬ участок луча
// внутри сплошной массы. Если после отверстия луч снова входит в массу, даже
// тонкий оставшийся участок по-прежнему корректно блокирует свет.
function raySegmentRemoved(origin, z, sun, obstacle, horizontal) {
  const cutouts = Array.isArray(obstacle.massCutouts) ? obstacle.massCutouts : [];
  if (!cutouts.length) return false;
  const solid = rayVolumeInterval(origin, z, sun, obstacle, horizontal);
  if (!solid) return false;

  const covered = [];
  for (const cutout of cutouts) {
    const interval = rayVolumeInterval(origin, z, sun, cutout);
    if (!interval) continue;
    const enter = Math.max(solid.enter, interval.enter);
    const exit = Math.min(solid.exit, interval.exit);
    if (exit >= enter) covered.push({ enter, exit });
  }
  covered.sort((a, b) => a.enter - b.enter || a.exit - b.exit);

  let cursor = solid.enter;
  for (const interval of covered) {
    if (interval.exit < cursor + RAY_VOLUME_EPS) continue;
    if (interval.enter > cursor + RAY_VOLUME_EPS) return false;
    cursor = Math.max(cursor, interval.exit);
    if (cursor >= solid.exit - RAY_VOLUME_EPS) return true;
  }
  return cursor >= solid.exit - RAY_VOLUME_EPS;
}

// Препятствия: соседние дома и сам дом по этажам. top сохранён
// для старого API; bottom и metadata дают точный высотный интервал и
// позволяют не считать собственную стену препятствием в точке окна.
export function obstaclesOf(project) {
  const out = [];
  for (const n of project.site?.neighbors || []) {
    const bottom = Number(n.elevation ?? n.base) || 0;
    out.push({
      poly: neighborRectCorners(n), bottom, top: bottom + (Number(n.height) || 6000),
      kind: 'neighbor', neighborId: n.id,
    });
  }
  const t = project.settings?.exterior || 250;
  for (const level of project.levels) {
    const bottom = Number(level.elevation) || 0;
    const top = bottom + (Number(level.height) || 3000);
    for (const r of level.rooms) {
      if (r.parentId || isOpenRoom(r)) continue;
      for (const part of roomRects(r)) {
        out.push({
          poly: rectCornersWorld(project.building, {
            x: part.x - t, y: part.y - t, w: part.w + t * 2, h: part.h + t * 2,
          }),
          bottom,
          top,
          kind: 'room', roomId: r.id, levelId: level.id,
        });
      }
    }
  }
  return out;
}

// Расширенный набор препятствий только для карты прямого солнца в комнате.
// Нормативная insolationReport намеренно продолжает использовать obstaclesOf:
// добавление эскизной массы или дерева не должно молча менять официальный
// отчёт. Все элементы ниже сведены к выпуклым вертикальным объёмам
// { poly, bottom, top }, которые умеет проверять sunRayBlocked.
//
// Аппроксимации консервативны (могут дать немного больше тени):
// - косой/вогнутый контур берётся выпуклой оболочкой либо прямоугольниками;
// - крыша — её плита, без точного выреза пятна следующего этажа;
// - пергола — сплошная верхняя решётка толщиной 180 мм;
// - крона — непрозрачная эллиптическая призма. Для метрики прямого солнца
//   это детерминированнее условного коэффициента листвы и безопаснее, чем
//   обещать случайные солнечные пятна. Рассеянный свет здесь не оценивается.
// Рельеф, как и в core/landscape-shadow.js, считается плоским; явная elev
// объекта и подъём посадки в коробе учитываются.
const CANOPY_LOOKS = new Set(['carport', 'gazebo', 'pergola']);
const CONIFER_LOOKS = new Set(['pine', 'spruce']);

function validConvex(points) {
  const clean = (points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  if (clean.length < 3) return null;
  const hull = convexHull(clean);
  return hull.length >= 3 ? hull : null;
}

function volume(out, poly, bottom, top, meta) {
  const shape = validConvex(poly);
  const z0 = Number(bottom);
  const z1 = Number(top);
  if (!shape || !Number.isFinite(z0) || !Number.isFinite(z1) || z1 <= z0 + 0.01) return;
  out.push({ poly: shape, bottom: z0, top: z1, ...meta });
}

function bandOutline(a, b, width) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0.5)) return null;
  const half = Math.max(1, width / 2);
  const nx = (-(b.y - a.y) / length) * half;
  const ny = ((b.x - a.x) / length) * half;
  return [
    { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
  ];
}

function treeVolumes(out, object, def, bottom, height) {
  const crown = validConvex(objectOutline(object, 16));
  if (!crown) return;
  const rx = Math.max(50, (Number(object.w) || def.w) / 2);
  const ry = Math.max(50, (Number(object.h) || Number(object.w) || def.h) / 2);
  const radius = Math.max(rx, ry);
  let crownBottom;
  if (CONIFER_LOOKS.has(def.look)) crownBottom = bottom + height * 0.12;
  else if (def.look === 'thuja') crownBottom = bottom + height * 0.1;
  else {
    const rz = Math.min(height * 0.32, Math.max(radius * 0.9, height * 0.2));
    crownBottom = bottom + Math.max(0, height - rz * 2);
  }
  volume(out, crown, crownBottom, bottom + height, {
    kind: 'tree-crown', landscapeId: object.id, approximation: 'opaque-conservative',
  });

  // Ствол нужен отдельно: под поднятой кроной луч не должен проходить сквозь
  // дерево ровно по центру. Восьмиугольник остаётся выпуклым и стабильным.
  const trunkRadius = Math.min(250, Math.max(60, radius * 0.05));
  const trunk = Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 8;
    return { x: object.x + Math.cos(angle) * trunkRadius, y: object.y + Math.sin(angle) * trunkRadius };
  });
  volume(out, trunk, bottom, Math.max(crownBottom, bottom + height * 0.38), {
    kind: 'tree-trunk', landscapeId: object.id,
  });
}

function landscapeVolumes(project, out) {
  const objects = project.site?.landscape?.objects || [];
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    const def = landscapeDef(object.kind);
    if (!def || !castsShadow(object)) continue;
    const height = Math.max(0, Number(object.height ?? def.height) || 0);
    if (!(height > 0)) continue;
    const parent = object.parent ? byId.get(object.parent) : null;
    const planterLift = parent && PLANTER_KINDS.has(parent.kind) ? Math.max(0, (Number(parent.height) || 0) - 60) : 0;
    const bottom = elevOf(object) + planterLift;

    if (def.group === 'Деревья') {
      treeVolumes(out, object, def, bottom, height);
      continue;
    }

    // Навесы открыты снизу: препятствием является кровля, а не весь объём до
    // земли. Стойки малы и намеренно не раздуваются до габарита навеса.
    if (CANOPY_LOOKS.has(def.look)) {
      let z0 = bottom + height;
      let z1 = z0 + 120;
      if (def.look === 'pergola') { z0 = bottom + Math.max(0, height - 180); z1 = bottom + height; }
      else if (def.look === 'gazebo' && object.variant !== 'flat') { z0 = bottom + height * 0.72; z1 = bottom + height; }
      volume(out, objectOutline(object, 16), z0, z1, {
        kind: 'landscape-canopy', landscapeId: object.id, approximation: def.look === 'pergola' ? 'solid-grid-conservative' : 'roof-envelope',
      });
      continue;
    }

    if (def.shape === 'line') {
      const path = objectPath(object);
      const width = Math.max(1, Number(object.width) || Number(def.h) || 150);
      for (let i = 0; i < path.length - 1; i += 1) {
        volume(out, bandOutline(path[i], path[i + 1], width), bottom, bottom + height, {
          kind: 'landscape-object', landscapeId: object.id,
        });
      }
      continue;
    }
    volume(out, objectOutline(object, 16), bottom, bottom + height, {
      kind: 'landscape-object', landscapeId: object.id,
      approximation: def.shape === 'poly' ? 'convex-hull-conservative' : 'vertical-envelope',
    });
  }
}

export function solarObstaclesOf(project) {
  const out = obstaclesOf(project);

  // Массы находятся в осях дома. Только project.masses являются телами:
  // massVoids — CSG-резаки, поэтому сами по себе тени не создают. Пересекающие
  // сплошную массу резаки прикрепляются к ней как ray-test cutouts: это даёт
  // точное вычитание ортогональных боксов для каждого солнечного луча без
  // разбиения одного тела на множество отдельных выпуклых объёмов.
  const cutouts = (project.massVoids || []).map((massVoid) => {
    const box = massBox(massVoid);
    const holder = [];
    volume(holder, rectCornersWorld(project.building, {
      x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0,
    }), box.z0, box.z1, { kind: 'mass-void', massVoidId: massVoid.id });
    return holder[0] ? { box, volume: holder[0] } : null;
  }).filter(Boolean);
  const overlaps = (a, b) => a.x0 < b.x1 - RAY_VOLUME_EPS && a.x1 > b.x0 + RAY_VOLUME_EPS &&
    a.y0 < b.y1 - RAY_VOLUME_EPS && a.y1 > b.y0 + RAY_VOLUME_EPS &&
    a.z0 < b.z1 - RAY_VOLUME_EPS && a.z1 > b.z0 + RAY_VOLUME_EPS;
  for (const mass of project.masses || []) {
    const box = massBox(mass);
    const massCutouts = cutouts.filter((cutout) => overlaps(box, cutout.box)).map((cutout) => cutout.volume);
    volume(out, rectCornersWorld(project.building, {
      x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0,
    }), box.z0, box.z1, {
      kind: 'mass', massId: mass.id,
      approximation: massCutouts.length ? 'solid-box-minus-voids' : 'solid-box',
      massCutouts,
    });
  }

  // Крыши также локальны дому. Ортогональная Г/П-форма раскладывается
  // roofRects на прямоугольники с выносами. Косой контур нельзя заменять его
  // bbox (у треугольника тот затенил бы половину несуществующей крыши),
  // поэтому реальное пятно с выносом триангулируется на выпуклые объёмы.
  for (const roof of project.roofs || []) {
    const z = roofZ(project, roof);
    if (!z) continue;
    if (roofIsSlanted(roof)) {
      for (const triangle of triangulate(roofSlabOutline(project, roof))) {
        volume(out, triangle.map((point) => toWorld(project.building, point)), z.z0, z.z1, {
          kind: 'roof', roofId: roof.id, levelId: roof.levelId, approximation: 'triangulated-slab',
        });
      }
      continue;
    }
    for (const rect of roofRects(project, roof)) {
      volume(out, rectCornersWorld(project.building, {
        x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0,
      }), z.z0, z.z1, { kind: 'roof', roofId: roof.id, levelId: roof.levelId, approximation: 'slab-envelope' });
    }
  }

  landscapeVolumes(project, out);
  return out;
}

// Пересекает ли восходящий к солнцу луч один из объёмов. Если луч
// начинается в грубом footprint своей же комнаты, это толщина стены,
// а не самозатенение. Другая часть Г-объёма по-прежнему может затенять.
export function sunRayBlocked(origin, z, sun, obstacles, source = {}) {
  for (const obstacle of obstacles) {
    const range = rayRange(origin, sun.dir, obstacle.poly);
    if (!range) continue;
    const own = source.roomId && obstacle.roomId === source.roomId &&
      (!source.levelId || !obstacle.levelId || obstacle.levelId === source.levelId);
    if (own && range.enter <= 0.01) continue;
    const bottom = Number.isFinite(Number(obstacle.bottom)) ? Number(obstacle.bottom) : -Infinity;
    const top = Number(obstacle.top);
    if (!Number.isFinite(top)) continue;
    const atEnter = z + range.enter * sun.tanAlt;
    const atExit = z + range.exit * sun.tanAlt;
    if (atEnter >= top - 0.01 || atExit <= bottom + 0.01) continue;
    if (raySegmentRemoved(origin, z, sun, obstacle, range)) continue;
    return true;
  }
  return false;
}

// Внешняя нормаль и точка на наружной грани стены проёма — в осях дома.
// Сторона может быть числом 0–3 или строкой стены выреза Г/контура
// ('notch-h', 'outline-N'): единый вид даёт sideEdge (orient + outward).
export function openingFacade(room, side, wall, absCenter) {
  if (!room) return null; // окно ручной стены (host) — см. hostOpeningFacade
  const edge = sideEdge(room, side);
  if (!edge) return null;
  const b = wall.band;
  if (edge.orient === 'h') {
    return { normal: { x: 0, y: edge.outward }, at: { x: absCenter, y: edge.outward < 0 ? b.y : b.y + b.h } };
  }
  return { normal: { x: edge.outward, y: 0 }, at: { x: edge.outward > 0 ? b.x + b.w : b.x, y: absCenter } };
}

// То же для проёма ручной стены: own — hostOpeningRoom (core/walls.js).
export function hostOpeningFacade(own) {
  const b = own.wall.band;
  if (own.wall.orient === 'h') {
    return { normal: { x: 0, y: own.outward }, at: { x: own.absCenter, y: own.outward < 0 ? b.y : b.y + b.h } };
  }
  return { normal: { x: own.outward, y: 0 }, at: { x: own.outward > 0 ? b.x + b.w : b.x, y: own.absCenter } };
}

// Окна всех этажей: середина снаружи (мир), внешняя нормаль (мир), высота.
export function windowsOf(project, options = {}) {
  const out = [];
  const wallsByLevel = options.wallsByLevel instanceof Map ? options.wallsByLevel : null;
  const rot = ((project.building?.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const level of project.levels) {
    const lp = levelProject(project, level.id);
    let walls = wallsByLevel?.get(level.id);
    if (!walls) {
      walls = deriveWalls(lp);
      wallsByLevel?.set(level.id, walls);
    }
    for (const o of lp.openings) {
      if (o.kind !== 'window') continue;
      const placed = openingRect(lp, o, walls);
      if (!placed) continue;
      let facade; let roomId = o.roomId;
      if (o.host) {
        // Окно ручной стены: помещение — со стороны дома, фасад — противоположная грань стены.
        const own = hostOpeningRoom(lp, o, walls);
        if (!own) continue;
        roomId = own.room.id;
        facade = hostOpeningFacade(own);
      } else {
        const room = lp.rooms.find((r) => r.id === o.roomId);
        facade = openingFacade(room, o.side, placed.wall, placed.absCenter);
      }
      if (!facade) continue;
      const { at, normal: n } = facade;
      const normal = { x: n.x * c - n.y * s, y: n.x * s + n.y * c };
      const tangentLocal = Math.abs(n.y) > 0.5 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const atLocal = { x: at.x + n.x * 20, y: at.y + n.y * 20 };
      const p = toWorld(project.building, atLocal);
      const wallSpan = Math.max(0, Number(placed.wall?.to) - Number(placed.wall?.from));
      const width = Math.max(0, Math.min(Number(o.width) || 0, wallSpan || Infinity));
      const sill = Math.max(0, Number(o.sill ?? 900) || 0);
      const wallHeight = Math.max(0, (Number(level.height) || 3000) - sill);
      const height = Math.max(0, Math.min(openingHeight(o, level), wallHeight));
      const elevation = Number(level.elevation) || 0;
      out.push({
        openingId: o.id,
        roomId,
        levelId: level.id,
        width,
        height,
        sill,
        elevation,
        wallThickness: Math.max(0, Number(placed.wall?.thickness) || 0),
        // Плоскость светового проёма и его ось вдоль фасада. atLocal/at
        // по-прежнему вынесены на 20 мм наружу для проверки препятствий.
        planeLocal: { ...at },
        tangentLocal,
        // Чуть наружу от фасада, чтобы не задеть собственную стену.
        at: p,
        normal,
        atLocal,
        normalLocal: { ...n },
        z: elevation + sill,
      });
    }
  }
  return out;
}

function visible(win, sun, obstacles) {
  const facing = sun.dir.x * win.normal.x + sun.dir.y * win.normal.y;
  if (facing < FACADE_LIMIT) return false;
  return !sunRayBlocked(win.at, win.z, sun, obstacles, win);
}

// Утреннее солнце по каждому окну на выбранную дату. Это отдельная мягкая
// метрика для планировочных предпочтений, не нормативный отчёт инсоляции:
// диапазон времени задаёт вызывающая сторона, ранние часы не отбрасываются.
// Без подтверждённого контекста участка и конечных координат возвращаем
// morningMinutes=null, чтобы значения проекта по умолчанию не выглядели как
// измеренные данные.
export function windowMorningExposure(project, options = {}) {
  const site = project?.site || {};
  const location = site.location || {};
  const finiteLocation = [location.lat, location.lon, location.tz].every(Number.isFinite);
  const known = site.solarVerified === true && finiteLocation;
  const date = String(options.date || site.sun?.date || '2026-06-21');
  const fromRaw = Number(options.from);
  const toRaw = Number(options.to);
  const stepRaw = Number(options.step);
  const from = Math.max(0, Math.min(1440, Number.isFinite(fromRaw) ? fromRaw : 6 * 60));
  const to = Math.max(from, Math.min(1440, Number.isFinite(toRaw) ? toRaw : 12 * 60));
  const step = Math.max(1, Math.min(60, Math.round(Number.isFinite(stepRaw) ? stepRaw : 10)));
  const source = windowsOf(project);
  const windows = source.map((win) => ({
    openingId: win.openingId,
    roomId: win.roomId,
    levelId: win.levelId,
    morningMinutes: known ? 0 : null,
  }));
  if (!known || to <= from || !windows.length) return { known, date, from, to, step, windows };

  const obstacles = obstaclesOf(project);
  const north = ((Number(site.north) || 0) * Math.PI) / 180;
  for (let minute = from; minute < to; minute += step) {
    const duration = Math.min(step, to - minute);
    const position = sunPosition(location.lat, location.lon, location.tz, date, minute + duration / 2);
    if (!(position.altitude > 0)) continue;
    const angle = north + (position.azimuth * Math.PI) / 180;
    const sun = {
      ...position,
      dir: { x: Math.sin(angle), y: -Math.cos(angle) },
      tanAlt: Math.tan((position.altitude * Math.PI) / 180),
    };
    for (let i = 0; i < source.length; i += 1) {
      if (visible(source[i], sun, obstacles)) windows[i].morningMinutes += duration;
    }
  }
  return { known, date, from, to, step, windows };
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
export function insolationReport(project, options = {}) {
  const site = project.site;
  const norm = insolationNorm(site);
  const table = sunTable(site, norm);
  const obstacles = obstaclesOf(project);
  const wins = windowsOf(project, options);
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
  return { norm, rooms, need, met, ok: met >= need, siteKnown: siteKnown(site) };
}

// Есть ли данные об участке для честной оценки инсоляции: граница участка
// или заданная вручную норма. Без них (стороны света по умолчанию, участок
// не начерчен) итог — справка, а не замечание.
export function siteKnown(site) {
  const norms = site?.norms || {};
  return Boolean((Array.isArray(site?.boundary) && site.boundary.length >= 3) || norms.hours != null || norms.day != null);
}

// «2 ч 35 мин» из минут.
export function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

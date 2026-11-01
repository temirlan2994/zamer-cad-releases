// Экспорт Kepler Plan.
//
// 1. buildStructuredExport — структурированная модель (помещения, стены,
//    проёмы, мебель, связи) для будущего плагина Autodesk Revit API.
//    Это НЕ BIM-модель, а концепт: плагин на C# превратит её в редактируемые
//    элементы Revit (Walls/Doors/Windows/Rooms) на следующем этапе.
// 2. buildProjectDxf — чертёж DXF через модуль Zamer CAD (buildDxf), включая
//    Revit-профиль слоёв (ZAMER_*). План — в осях дома (всегда прямой).
// 3. buildSitePlanDxf — генплан в координатах съёмки: дом повёрнут так, как
//    стоит на участке, плюс граница, красная линия, зона застройки, дороги,
//    соседи, въезд и север. Ложится поверх исходной топосъёмки в CAD.
//
// Системы координат (см. core/building.js): комнаты, стены, проёмы и мебель —
// в осях дома; участок — в координатах съёмки;
// world = origin + R(rotation) · local, Y вниз, угол по часовой.

import { buildDxf } from './zamer/dxf.js';
import { deriveWalls, doorLink, doorSymbol, openingRect } from './walls.js';
import { analyzeConnectivity, roomNetAreaM2 } from './rooms.js';
import { itemTitle } from './furnish.js';
import { buildZonePolygon, neighborBuffers, neighborRectCorners, polygonAreaM2 } from './site.js';
import { northInBuilding, toWorld } from './building.js';
import { groundLevel, levelProject, sortedLevels } from './model.js';

// Один этаж: помещения, стены, проёмы, мебель и связи (project — вид на этаже).
function buildLevelExport(project, level) {
  const walls = deriveWalls(project);
  const connectivity = analyzeConnectivity(project, walls);

  const rooms = project.rooms.map((room) => ({
    id: room.id,
    type: room.type,
    name: room.name,
    parent: room.parentId || null,
    polygon: [
      { x: room.x, y: room.y },
      { x: room.x + room.w, y: room.y },
      { x: room.x + room.w, y: room.y + room.h },
      { x: room.x, y: room.y + room.h },
    ],
    size: { w: room.w, h: room.h },
    area_m2: Number(((room.w * room.h) / 1_000_000).toFixed(3)),
    net_area_m2: Number(roomNetAreaM2(project, room).toFixed(3)),
  }));

  const wallsOut = walls.filter((w) => w.kind !== 'joint' && w.kind !== 'chamfer').map((wall, index) => ({
    id: `${wall.key}#${index}`,
    key: wall.key,
    shared: wall.kind === 'shared',
    from: { x: wall.center.x1, y: wall.center.y1 },
    to: { x: wall.center.x2, y: wall.center.y2 },
    thickness: wall.thickness,
    type: wall.wallType,
    rooms: wall.rooms,
  }));

  const openings = project.openings.map((opening) => {
    const placed = openingRect(project, opening, walls);
    return {
      id: opening.id,
      kind: opening.kind,
      room: opening.roomId,
      side: opening.side,
      width: opening.width,
      center: placed
        ? { x: placed.rect.x + placed.rect.w / 2, y: placed.rect.y + placed.rect.h / 2 }
        : null,
      wallKey: placed ? placed.wall.key : null,
      swingIn: opening.swingIn,
      hingeStart: opening.hingeStart,
    };
  });

  // Мебель свободна: комната определяется по фактическому положению
  // (сначала вложенные, затем родительские).
  const containingRoom = (item) => {
    const nested = project.rooms.filter((r) => r.parentId);
    const top = project.rooms.filter((r) => !r.parentId);
    for (const room of [...nested, ...top]) {
      if (item.x >= room.x && item.x <= room.x + room.w && item.y >= room.y && item.y <= room.y + room.h) return room.id;
    }
    return null;
  };
  const furniture = project.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: itemTitle(item.kind),
    room: containingRoom(item),
    center: { x: item.x, y: item.y },
    size: { w: item.w, h: item.h },
    rotation_deg: item.rotation || 0,
  }));

  const doors = [];
  for (const opening of project.openings) {
    const link = doorLink(project, opening, walls);
    if (link) doors.push(link);
  }

  return {
    id: level.id,
    name: level.name,
    elevation: level.elevation,
    height: level.height,
    rooms,
    walls: wallsOut,
    openings,
    furniture,
    connections: {
      doors,
      has_entrance: connectivity.hasEntrance,
      unreachable_rooms: connectivity.unreachable,
    },
  };
}

export function buildStructuredExport(project) {
  return {
    schema: 'kepler-export/2',
    units: 'mm',
    axes: 'x-right, y-down',
    // Помещения, стены, проёмы, мебель — в осях дома (frame: building);
    // участок (site) — в координатах съёмки (frame: world).
    building: {
      rotation_deg: project.building?.rotation || 0,
      origin: { ...(project.building?.origin || { x: 0, y: 0 }) },
      transform: 'world = origin + R(rotation_deg) * local; y down, clockwise',
      true_north_deg: northInBuilding(project.site?.north, project.building),
    },
    name: project.name,
    generated_at: new Date().toISOString(),
    // Этажи снизу вверх; отметка (elevation) и высота этажа — в мм.
    levels: sortedLevels(project).map((level) => buildLevelExport(levelProject(project, level.id), level)),
    site: buildSiteExport(project.site),
  };
}

function buildSiteExport(site) {
  if (!site || !site.boundary) return null;
  return {
    frame: 'world',
    north_deg: site.north,
    location: site.location,
    boundary: site.boundary,
    boundary_area_m2: Number(polygonAreaM2(site.boundary).toFixed(2)),
    build_zone: buildZonePolygon(site),
    setbacks: { boundary: site.setbackBoundary, neighbor: site.setbackNeighbor },
    red_line: site.redLine || null,
    entry: site.entry || null,
    roads: site.roads || [],
    neighbor_houses: site.neighbors || [],
  };
}

// Перевод модели Kepler в сущности Zamer CAD (в осях дома).
// dims: false — без размерных линий (для генплана).
export function planEntities(project, { dims = true } = {}) {
  const walls = deriveWalls(project);
  const entities = [];

  for (const wall of walls) {
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue; // заплатки/фаски в DXF не нужны
    entities.push({
      type: 'wall',
      layer: 'walls',
      width: wall.thickness,
      x1: wall.center.x1,
      y1: wall.center.y1,
      x2: wall.center.x2,
      y2: wall.center.y2,
    });
  }

  for (const opening of project.openings) {
    if (opening.kind === 'door') {
      const symbol = doorSymbol(project, opening, walls);
      if (!symbol) continue;
      entities.push({ type: 'line', layer: 'walls', x1: symbol.hinge.x, y1: symbol.hinge.y, x2: symbol.open.x, y2: symbol.open.y });
      entities.push({ type: 'arc', layer: 'walls', start: symbol.closed, through: symbol.through, end: symbol.open });
    } else {
      const placed = openingRect(project, opening, walls);
      if (!placed) continue;
      const { rect } = placed;
      if (rect.w >= rect.h) {
        const midY = rect.y + rect.h / 2;
        entities.push({ type: 'rectangle', layer: 'walls', x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h });
        entities.push({ type: 'line', layer: 'walls', x1: rect.x, y1: midY, x2: rect.x + rect.w, y2: midY });
      } else {
        const midX = rect.x + rect.w / 2;
        entities.push({ type: 'rectangle', layer: 'walls', x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h });
        entities.push({ type: 'line', layer: 'walls', x1: midX, y1: rect.y, x2: midX, y2: rect.y + rect.h });
      }
    }
  }

  for (const item of project.items) {
    entities.push({
      type: 'block',
      layer: 'furniture',
      kind: item.kind,
      x: item.x,
      y: item.y,
      rotation: item.rotation || 0,
      width: item.w,
      height: item.h,
    });
  }

  for (const room of project.rooms) {
    const area = roomNetAreaM2(project, room);
    entities.push({
      type: 'text',
      layer: 'dimensions',
      x: room.x + 150,
      y: room.y + 400,
      height: 260,
      text: room.name,
    });
    entities.push({
      type: 'text',
      layer: 'dimensions',
      x: room.x + 150,
      y: room.y + 750,
      height: 220,
      text: `${area.toFixed(1)} m2`,
    });
    // Габаритные размеры комнаты (сверху и слева).
    if (!dims) continue;
    entities.push({ type: 'line', layer: 'dimensions', x1: room.x, y1: room.y, x2: room.x + room.w, y2: room.y, offset: -600 });
    entities.push({ type: 'line', layer: 'dimensions', x1: room.x, y1: room.y + room.h, x2: room.x, y2: room.y, offset: -600 });
  }
  return entities;
}

// Чертёж плана: в осях дома, поэтому от поворота дома не зависит.
// Несколько этажей — рядом слева направо (снизу вверх) с подписями.
export function buildProjectDxf(project, { profile = 'default' } = {}) {
  const levels = project.levels ? sortedLevels(project) : [];
  if (levels.length <= 1) return buildDxf(planEntities(project), { profile });
  const entities = [];
  const gap = 6000;
  let cursor = 0;
  for (const level of levels) {
    const lp = levelProject(project, level.id);
    const ents = planEntities(lp);
    const t = (project.settings?.exterior || 250) + 1000;
    const box = lp.rooms.length ? {
      minX: Math.min(...lp.rooms.map((r) => r.x)) - t,
      maxX: Math.max(...lp.rooms.map((r) => r.x + r.w)) + t,
      minY: Math.min(...lp.rooms.map((r) => r.y)) - t,
    } : { minX: 0, maxX: 6000, minY: 0 };
    const shift = { rotation: 0, origin: { x: cursor - box.minX, y: 0 } };
    entities.push(...ents.flatMap((e) => entityToWorld(e, shift)));
    entities.push({ type: 'text', layer: 'dimensions', x: cursor, y: box.minY - 1200, height: 500, text: `${level.name} (${(level.elevation / 1000).toFixed(2)})` });
    cursor += box.maxX - box.minX + gap;
  }
  return buildDxf(entities, { profile });
}

// ---------------------------------------------------------------- Генплан

const SITE_LAYERS = [
  { key: 'site', name: 'site_boundary', color: 8 },
  { key: 'redline', name: 'red_line', color: 1 },
  { key: 'zone', name: 'build_zone', color: 6 },
  { key: 'roads', name: 'roads', color: 9 },
  { key: 'neighbors', name: 'neighbors', color: 8 },
];

// Сущность плана (оси дома) → сущности в координатах съёмки.
function entityToWorld(e, b) {
  const w = (x, y) => toWorld(b, { x, y });
  const rot = b?.rotation || 0;
  if (e.type === 'wall' || e.type === 'line') {
    const p = w(e.x1, e.y1);
    const q = w(e.x2, e.y2);
    return [{ ...e, x1: p.x, y1: p.y, x2: q.x, y2: q.y }];
  }
  if (e.type === 'rectangle') {
    const c = [w(e.x1, e.y1), w(e.x2, e.y1), w(e.x2, e.y2), w(e.x1, e.y2)];
    return c.map((p, i) => ({ type: 'line', layer: e.layer, x1: p.x, y1: p.y, x2: c[(i + 1) % 4].x, y2: c[(i + 1) % 4].y }));
  }
  if (e.type === 'arc') {
    return [{ ...e, start: w(e.start.x, e.start.y), through: w(e.through.x, e.through.y), end: w(e.end.x, e.end.y) }];
  }
  if (e.type === 'block' || e.type === 'text') {
    const p = w(e.x, e.y);
    return [{ ...e, x: p.x, y: p.y, rotation: (e.rotation || 0) + rot }];
  }
  if (e.type === 'circle') {
    const p = w(e.cx, e.cy);
    return [{ ...e, cx: p.x, cy: p.y }];
  }
  return [];
}

function polyLines(points, layer, closed) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return out;
}

function siteEntities(site) {
  if (!site) return [];
  const out = [];
  if (site.boundary?.length >= 3) {
    out.push(...polyLines(site.boundary, 'site', true));
    const zone = buildZonePolygon(site);
    if (zone) out.push(...polyLines(zone, 'zone', true));
    for (const buf of neighborBuffers(site)) out.push(...polyLines(buf.poly, 'zone', true));
  }
  if (site.redLine?.length >= 2) out.push(...polyLines(site.redLine, 'redline', Boolean(site.redLineClosed)));
  for (const road of site.roads || []) {
    if (road.points.length < 2) continue;
    out.push(...polyLines(road.points, 'roads', Boolean(road.closed)));
    // Кромки дороги: смещение каждого отрезка на ±ширина/2.
    const half = (road.width || 0) / 2;
    const n = road.points.length;
    for (let i = 0; i < (road.closed ? n : n - 1); i += 1) {
      const a = road.points[i];
      const c = road.points[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      const nx = (-(c.y - a.y) / len) * half;
      const ny = ((c.x - a.x) / len) * half;
      for (const sgn of [1, -1]) {
        out.push({ type: 'line', layer: 'roads', x1: a.x + nx * sgn, y1: a.y + ny * sgn, x2: c.x + nx * sgn, y2: c.y + ny * sgn });
      }
    }
  }
  for (const nb of site.neighbors || []) {
    const c = neighborRectCorners(nb);
    out.push(...polyLines(c, 'neighbors', true));
    out.push({ type: 'line', layer: 'neighbors', x1: c[0].x, y1: c[0].y, x2: c[2].x, y2: c[2].y });
    out.push({ type: 'line', layer: 'neighbors', x1: c[1].x, y1: c[1].y, x2: c[3].x, y2: c[3].y });
    out.push({ type: 'text', layer: 'neighbors', x: nb.x - 600, y: nb.y, height: 400, text: `${((nb.height || 6000) / 1000).toFixed(1)} m`, rotation: nb.rot || 0 });
  }
  if (site.entry) {
    const rad = ((site.entry.dir || 0) * Math.PI) / 180;
    const tip = { x: site.entry.x + Math.cos(rad) * 2200, y: site.entry.y + Math.sin(rad) * 2200 };
    out.push({ type: 'line', layer: 'site', x1: site.entry.x, y1: site.entry.y, x2: tip.x, y2: tip.y });
    for (const da of [-0.45, 0.45]) {
      out.push({ type: 'line', layer: 'site', x1: tip.x, y1: tip.y, x2: tip.x - Math.cos(rad + da) * 500, y2: tip.y - Math.sin(rad + da) * 500 });
    }
  }
  // Стрелка севера у правого верхнего угла участка.
  if (site.boundary?.length >= 3) {
    const maxX = Math.max(...site.boundary.map((p) => p.x));
    const minY = Math.min(...site.boundary.map((p) => p.y));
    const base = { x: maxX + 3000, y: minY + 3000 };
    const rad = ((site.north || 0) * Math.PI) / 180;
    const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
    const tip = { x: base.x + dir.x * 2500, y: base.y + dir.y * 2500 };
    out.push({ type: 'line', layer: 'site', x1: base.x, y1: base.y, x2: tip.x, y2: tip.y });
    out.push({ type: 'text', layer: 'site', x: tip.x + dir.x * 300 - 150, y: tip.y + dir.y * 300, height: 450, text: 'N' });
  }
  return out;
}

// Генплан: дом (нижний этаж) в координатах съёмки (повёрнут, как стоит) + участок.
export function buildSitePlanDxf(project) {
  const ground = project.levels ? levelProject(project, groundLevel(project).id) : project;
  const entities = planEntities(ground, { dims: false })
    .flatMap((e) => entityToWorld(e, project.building));
  entities.push(...siteEntities(project.site));
  return buildDxf(entities, { extraLayers: SITE_LAYERS });
}

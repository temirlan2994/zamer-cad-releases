// Экспорт Kepler Plan.
//
// 1. buildStructuredExport — структурированная модель (помещения, стены,
//    проёмы, мебель, связи) для будущего плагина Autodesk Revit API.
//    Это НЕ BIM-модель, а концепт: плагин на C# превратит её в редактируемые
//    элементы Revit (Walls/Doors/Windows/Rooms) на следующем этапе.
// 2. buildProjectDxf — чертёж DXF через модуль Zamer CAD (buildDxf), включая
//    Revit-профиль слоёв (ZAMER_*).

import { buildDxf, buildRevitDxf } from './zamer/dxf.js';
import { deriveWalls, doorLink, doorSymbol, openingRect } from './walls.js';
import { analyzeConnectivity, roomNetAreaM2 } from './rooms.js';
import { itemTitle } from './furnish.js';
import { buildZonePolygon, polygonAreaM2 } from './site.js';

export function buildStructuredExport(project) {
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

  const wallsOut = walls.map((wall, index) => ({
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
    schema: 'kepler-export/1',
    units: 'mm',
    axes: 'x-right, y-down',
    name: project.name,
    generated_at: new Date().toISOString(),
    levels: [
      { id: 'L1', name: 'Этаж 1', elevation: 0, rooms, walls: wallsOut, openings, furniture },
    ],
    connections: {
      doors,
      has_entrance: connectivity.hasEntrance,
      unreachable_rooms: connectivity.unreachable,
    },
    site: buildSiteExport(project.site),
  };
}

function buildSiteExport(site) {
  if (!site || !site.boundary) return null;
  return {
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

// Перевод модели Kepler в сущности Zamer CAD и сборка DXF.
export function buildProjectDxf(project, { profile = 'default' } = {}) {
  const walls = deriveWalls(project);
  const entities = [];

  for (const wall of walls) {
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
    entities.push({ type: 'line', layer: 'dimensions', x1: room.x, y1: room.y, x2: room.x + room.w, y2: room.y, offset: -600 });
    entities.push({ type: 'line', layer: 'dimensions', x1: room.x, y1: room.y + room.h, x2: room.x, y2: room.y, offset: -600 });
  }

  return profile === 'revit' ? buildRevitDxf(entities) : buildDxf(entities);
}

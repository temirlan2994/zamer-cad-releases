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

import { entryParts, siteEntries } from './site-entries.js';
import { levelWindowOpenings } from './spanning-windows.js';
import { exportRoofBodies } from './roof-export.js';
import { buildDxf } from './zamer/dxf.js';
import { openingHeight, openingSill } from './opening-preset.js';
import { deriveWalls, doorLeaves, doorLink, openingRect, wallOutline } from './walls.js';
import { analyzeConnectivity, roomNetAreaM2 } from './rooms.js';
import { itemTitle } from './furnish.js';
import { isOpenRoom, isRoundItem, isShaft, isStructural, isSummerRoom, roomType } from './catalog.js';
import { RAILING_INSET, roomRailings } from './railings.js';
import { isFixedSizeComp, partsInHouse } from './composite.js';
import { isPathShape, landscapeDef, objectAreaM2, objectLengthM, pathParams, retainingInfo, stairsInfo } from './landscape.js';
import { LANDSCAPE_DXF_LAYERS, landscapeDxfEntities } from './landscape-report.js';
import { plantSchedule, plantScheduleExport } from './landscape-plants.js';
import { structuralOutline } from './mesh3d.js';
import { slabOpeningArea, slabOpeningPolygon, slabOpenings, stairTargetLevel } from './slab-openings.js';
import { buildZonePolygon, neighborBuffers, neighborRectCorners, polygonAreaM2 } from './site.js';
import { northInBuilding, toWorld } from './building.js';
import {
  contours, formatElevation, houseTerrain, terrainModel, terrainSummary,
} from './terrain.js';
import { groundLevel, levelProject, roomCeiling, sortedLevels } from './model.js';
import { roomContainsPoint, roomPolygon, roomShapeArea } from './room-shape.js';
import { roomSchedule } from './schedule.js';
import { tepReport } from './tep.js';
import { envelopeOf, resolvedZeroAboveGround } from './envelope.js';
import { analyzeEarthworks } from './earthworks.js';
import { deriveFoundation } from './foundation-system.js';
import { deriveEntrances } from './entrance.js';

// Один этаж: помещения, стены, проёмы, мебель и связи (project — вид на этаже).
function buildLevelExport(project, level) {
  const walls = deriveWalls(project);
  const connectivity = analyzeConnectivity(project, walls);

  const numbers = new Map((roomSchedule(project).find((x) => x.level.id === level.id)?.rows || []).map((r) => [r.id, r.number]));
  const rooms = project.rooms.map((room) => ({
    id: room.id,
    number: numbers.get(room.id) || null, // как в экспликации и на листах
    type: room.type,
    category: roomType(room.type)?.cat || null, // категория типа (core/catalog.js ROOM_CATEGORIES)
    living: Boolean(roomType(room.type)?.living), // жилая комната (жилая площадь)
    summer: isSummerRoom(room), // летнее: в общую площадь не входит
    void: isShaft(room),
    name: room.name,
    parent: room.parentId || null,
    ...(room.linkedRoof === false ? { linked_roof: false } : {}),
    polygon: roomPolygon(room),
    size: { w: room.w, h: room.h },
    ceiling_height: roomCeiling(room, level), // чистая высота, мм
    area_m2: Number((roomShapeArea(room) / 1_000_000).toFixed(3)),
    net_area_m2: Number(roomNetAreaM2(project, room).toFixed(3)),
    // Перила открытого помещения (core/railings.js): отрезки в осях дома.
    ...(isOpenRoom(room) ? {
      railings: roomRailings(room, project.rooms, project.settings).map((s) => ({
        id: s.id, side: s.side, type: s.type, height: s.height, length: Math.round(s.b - s.a),
        from: s.orient === 'h' ? { x: s.a, y: s.edge } : { x: s.edge, y: s.a },
        to: s.orient === 'h' ? { x: s.b, y: s.edge } : { x: s.edge, y: s.b },
      })),
    } : {}),
  }));

  const wallsOut = walls.filter((w) => !w.hidden && w.kind !== 'joint' && w.kind !== 'chamfer').map((wall, index) => ({
    id: `${wall.key}#${index}`,
    key: wall.key,
    shared: wall.kind === 'shared',
    from: { x: wall.center.x1, y: wall.center.y1 },
    to: { x: wall.center.x2, y: wall.center.y2 },
    thickness: wall.thickness,
    type: wall.wallType,
    // Несущая: внутренняя несущая и наружная; перегородка — нет.
    load_bearing: wall.wallType !== 'partition',
    rooms: wall.rooms,
    // Ручная стена (схема 6): необязательные поля — ось, привязка, высота.
    ...(wall.kind === 'manual' ? {
      source: 'manual',
      wall_id: wall.wallId,
      axis: (() => { const w = project.walls?.find((x) => x.id === wall.wallId); return w ? { a: { ...w.axis.a }, b: { ...w.axis.b } } : null; })(),
      justify: wall.justify,
      z0: wall.z0,
      z1: wall.z1,
    } : {}),
  }));

  const openings = levelWindowOpenings(project, walls).map((opening) => {
    const placed = openingRect(project, opening, walls);
    return {
      id: opening.assemblyPart ? `${opening.id}-${opening.assemblyPart}` : opening.cornerWing === 'return' ? `${opening.id}-return` : opening.id,
      ...(opening.assemblyPart ? { assembly_id: opening.id } : {}),
      ...(opening.cornerWing ? { assembly_id: opening.id, wing: opening.cornerWing, joint: opening.corner.joint } : {}),
      kind: opening.kind,
      room: opening.roomId,
      side: opening.side,
      ...(opening.host ? { host: { wall_id: opening.host.wallId, t: opening.host.t } } : {}),
      width: opening.width,
      center: placed
        ? { x: placed.rect.x + placed.rect.w / 2, y: placed.rect.y + placed.rect.h / 2 }
        : null,
      wallKey: placed ? placed.wall.key : null,
      type: opening.type || (opening.kind === 'door' ? 'single' : 'standard'),
      height: openingHeight(opening, level),
      ...(opening.spanPart ? { owner_level: opening.spanOwnerLevelId, top_level: opening.span.levelId,
        part: opening.spanPart, top_from_owner_floor: opening.spanTop } : {}),
      sill: openingSill(opening, level),
      swingIn: opening.swingIn,
      hingeStart: opening.hingeStart,
      ...(opening.assemblyPart ? { assembly_part: opening.assemblyPart, assembly_type: opening.assemblyType } : {}),
      ...(opening.presetId ? { preset_id: opening.presetId } : {}),
      ...(opening.kind === 'door' && opening.entryRole ? { entry_role: opening.entryRole } : {}),
    };
  });

  // Мебель свободна: комната определяется по фактическому положению
  // (сначала вложенные, затем родительские).
  const containingRoom = (item) => {
    const nested = project.rooms.filter((r) => r.parentId);
    const top = project.rooms.filter((r) => !r.parentId);
    for (const room of [...nested, ...top]) {
      if (roomContainsPoint(room, item.x, item.y)) return room.id;
    }
    return null;
  };
  // Конструкции — отдельно от мебели.
  const structures = project.items.filter((i) => isStructural(i.kind));
  const freeWalls = structures.filter((i) => i.kind === 'wall-free').map((i) => {
    const [e] = structuralEntities(i);
    return { id: i.id, from: { x: e.x1, y: e.y1 }, to: { x: e.x2, y: e.y2 }, thickness: i.h };
  });
  const columns = structures.filter((i) => i.kind !== 'wall-free').map((i) => ({
    id: i.id, shape: isRoundItem(i.kind) ? 'round' : 'rect', center: { x: i.x, y: i.y }, size: { w: i.w, h: i.h }, rotation_deg: i.rotation || 0,
  }));
  const furniture = project.items.filter((i) => !isStructural(i.kind)).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: itemTitle(item.kind),
    room: containingRoom(item),
    center: { x: item.x, y: item.y },
    size: { w: item.w, h: item.h },
    rotation_deg: item.rotation || 0,
    mirrored: Boolean(item.mirrored || item.comp?.mirror),
    // Лестница: на какой этаж ведёт (core/slab-openings.js).
    ...(item.kind === 'stairs' ? { to_level: stairTargetLevel(project, item, level)?.id || null } : {}),
    // Составная мебель: параметры и готовые части (стулья у стола) в осях дома.
    ...(item.comp ? {
      comp: item.comp,
      parts: partsInHouse(item).map((p) => ({
        kind: p.kind, center: { x: p.x, y: p.y }, size: { w: p.w, h: p.h }, rotation_deg: p.rotation,
      })),
    } : {}),
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
    slab_thickness: Number.isFinite(Number(level.slabThickness)) ? Number(level.slabThickness) : 300,
    rooms,
    walls: wallsOut,
    openings,
    furniture,
    free_walls: freeWalls,
    columns,
    // Проёмы в перекрытии под этажом (core/slab-openings.js): авто — по лестнице.
    slab_openings: slabOpenings(project, level.id).map((o) => ({
      id: o.id, source: o.auto ? 'stair' : 'manual', stair: o.stairId || null,
      ...(o.atrium ? { atrium: { ...o.atrium, lowerLevelId: o.fromLevelId } } : {}),
      polygon: slabOpeningPolygon(o),
      size: { w: o.w, h: o.h }, area_m2: Number((slabOpeningArea(o) / 1_000_000).toFixed(3)),
    })),
    connections: {
      doors,
      has_entrance: connectivity.hasEntrance,
      unreachable_rooms: connectivity.unreachable,
    },
  };
}

export function buildStructuredExport(project) {
  const envelope = envelopeOf(project);
  const terrainHouse = project.site?.terrain?.points?.length >= 3 ? houseTerrain(project) : null;
  const zeroAboveGround = resolvedZeroAboveGround(project, terrainHouse);
  const foundationSystem = deriveFoundation(project);
  const entranceSystem = deriveEntrances(project);
  let earthworks = null;
  if (project.site?.terrain?.points?.length >= 3) {
    const grade = { mode: envelope.earthworks.mode };
    if (grade.mode === 'relative') grade.zMm = -(zeroAboveGround ?? 0) + envelope.earthworks.gradeOffset;
    if (grade.mode === 'absolute') grade.zMm = (terrainHouse?.groundReferenceZ ?? 0) + envelope.earthworks.gradeOffset;
    earthworks = analyzeEarthworks(project, { boundary: 'work-pad', marginMm: envelope.earthworks.margin, grade });
  }
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
    vertical_datum: {
      model_zero: '±0.000',
      zero_above_reference_ground: zeroAboveGround,
      source: project.envelope?.zeroAboveGround != null ? 'relative_ground'
        : (Number.isFinite(project.site?.terrain?.floorZ) ? 'absolute_survey' : 'unset'),
      reference_ground_z: project.envelope?.groundReferenceZ ?? terrainHouse?.groundReferenceZ ?? null,
      absolute_floor_z: terrainHouse?.floorZ ?? null,
    },
    envelope: {
      roof_mode: envelope.roofMode,
      auto_roof_thickness: envelope.roofThickness,
      roof: structuredClone(envelope.roof),
      foundation: structuredClone(envelope.foundation),
      entrance: structuredClone(envelope.entrance),
      slabs: structuredClone(envelope.slabs),
      earthworks: structuredClone(envelope.earthworks),
    },
    linked_roofs: exportRoofBodies(project),
    foundation_system: {
      type: foundationSystem.type,
      level_id: foundationSystem.levelId,
      preliminary: true,
      warnings: foundationSystem.warnings,
      components: foundationSystem.components.map((component) => ({
        id: component.id, kind: component.kind, role: component.role, shape: component.shape,
        z0: component.z0, z1: component.z1,
        ...(component.rects ? { rects: component.rects } : {}),
        ...(component.points ? { points: component.points } : {}),
        parameters: Object.fromEntries([
          'thickness', 'nominalThickness', 'width', 'nominalHeight', 'diameter', 'length',
          'center', 'sourceWallKeys', 'fallbackFor',
        ].filter((key) => component[key] != null).map((key) => [key, structuredClone(component[key])])),
      })),
    },
    entrances: entranceSystem,
    earthworks: earthworks ? {
      schema: earthworks.schema, status: earthworks.status, preliminary: true,
      boundary: earthworks.boundary ? { ...earthworks.boundary, geometryWorld: undefined } : null,
      grade: earthworks.grade, coverage: earthworks.coverage, areas: earthworks.areas,
      volumes: earthworks.volumes, extremes: earthworks.extremes, warnings: earthworks.warnings,
    } : null,
    // Этажи снизу вверх; отметка (elevation) и высота этажа — в мм.
    levels: sortedLevels(project).map((level) => buildLevelExport(levelProject(project, level.id), level)),
    site: buildSiteExport(project.site, project),
    indicators: tepReport(project), // ТЭП: площади, коэффициенты, объём (м², м³)
    // Массы (core/masses.js): боксы в осях дома — центр основания x, y, размеры
    // w, d, низ z0, высота h, поворот (кратно 90°). Необязательно.
    ...(project.masses?.length ? { masses: project.masses.map((m) => ({ ...m })) } : {}),
    ...(project.massVoids?.length ? { mass_voids: project.massVoids.map((m) => ({ ...m })) } : {}),
    // Координационные оси (core/grid-axes.js): { id, label, kind 'x'|'y', at,
    // from?, to?, hidden? } в осях дома, мм. Необязательно.
    ...(project.grids?.length ? { grids: project.grids.map((g) => ({ ...g })) } : {}),
    // Крыши-плиты (core/roofs.js): этаж, свой контур outline [{x, y}] в осях дома, вынос по
    // сторонам, толщина, край, парапет, материал. Необязательно.
    ...(project.roofs?.length ? { roofs: project.roofs.map((r) => structuredClone(r)) } : {}),
  };
}

// Рельеф: отметки (мм, абсолютные), шаг горизонталей, отметка пола и сводка.
function buildTerrainExport(project) {
  const terrain = project.site?.terrain;
  if (!terrain?.points?.length) return null;
  const model = terrainModel(terrain);
  const summary = terrainSummary(model);
  const house = houseTerrain(project, model);
  return {
    units: 'mm',
    points: terrain.points.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z })),
    contour_step: terrain.contourStep,
    floor_z: house ? house.floorZ : terrain.floorZ,
    floor_z_auto: terrain.floorZ == null && project.envelope?.zeroAboveGround == null,
    min_z: summary.minZ,
    max_z: summary.maxZ,
    mean_slope_percent: Number((summary.meanSlope * 100).toFixed(2)),
    house: house ? {
      corners: house.corners.map((c) => ({ name: c.name, x: c.x, y: c.y, z: Math.round(c.z) })),
      drop: Math.round(house.drop),
    } : null,
    error: summary.error,
  };
}

function buildSiteExport(site, project) {
  const terrain = project ? buildTerrainExport(project) : null;
  const landscape = buildLandscapeExport(site);
  if (!site || (!site.boundary && !terrain && !landscape)) return null;
  return {
    frame: 'world',
    north_deg: site.north,
    location: site.location,
    boundary: site.boundary,
    boundary_area_m2: site.boundary ? Number(polygonAreaM2(site.boundary).toFixed(2)) : null,
    build_zone: site.boundary ? buildZonePolygon(site) : null,
    setbacks: { boundary: site.setbackBoundary, neighbor: site.setbackNeighbor },
    red_line: site.redLine || null,
    entry: site.entry || null,
    entries: siteEntries(site),
    roads: site.roads || [],
    neighbor_houses: site.neighbors || [],
    terrain,
    landscape, // необязательно (версия схемы та же): благоустройство, мм в координатах участка
  };
}

function stairsExport(o) {
  const st = stairsInfo(o);
  return {
    steps: st.steps, riser_mm: Math.round(st.riser), tread_mm: st.tread, flight_mm: Math.round(st.flight),
    rise_mm: Math.round(st.rise), cheek_mm: st.cheek,
    ...(st.landing ? { landing_extra_mm: st.landing } : {}),
  };
}

function retainingExport(o) {
  const ri = retainingInfo(o);
  return {
    thickness_mm: Math.round(ri.thick), height_mm: Math.round(ri.height), drop_mm: Math.round(ri.drop), parapet_mm: Math.round(ri.parapet),
    upper_side: ri.upper, cap: ri.cap, ...(ri.cap ? { cap_mm: [Math.round(ri.capW), Math.round(ri.capH)] } : {}),
    length_m: Number((ri.length / 1000).toFixed(3)), volume_m3: Number(ri.volume.toFixed(3)),
  };
}

// Ландшафт (core/landscape.js): объекты с типом, размерами и признаками.
function buildLandscapeExport(site) {
  const objects = site?.landscape?.objects || [];
  const sections = site?.landscape?.sections || [];
  if (!objects.length && !sections.length) return null;
  // Справочник и ведомость растений (необязательные поля, версия та же).
  const book = site.landscape.plants;
  const plants = plantScheduleExport(plantSchedule(objects, book));
  return {
    ...(book && Object.keys(book).length ? { plant_book: book } : {}),
    ...(plants ? { plant_schedule: plants } : {}),
    // Разрезы участка (необязательное поле): ломаная, сторона взгляда, глубина, мм.
    ...(sections.length ? { sections: sections.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })) } : {}),
    objects: objects.map((o) => {
      const def = landscapeDef(o.kind);
      return {
        id: o.id, kind: o.kind, title: def?.title || o.kind, category: def?.cat || null,
        shape: def?.shape || 'rect', x: o.x, y: o.y, rotation_deg: o.rotation || 0,
        w: o.w, h: o.h, r: o.r ?? null, height: o.height ?? 0, variant: o.variant,
        tall: Boolean(def?.tall), cover: Boolean(def?.cover), surface: def?.surface || null,
        ...(o.points ? { points: o.points } : {}),
        ...(o.width ? { width: o.width } : {}),
        ...(o.smooth ? { smooth: true } : {}),
        // Углы и укладка линейного объекта (необязательные поля).
        ...(def?.shape === 'line' ? pathParams(o, o.points?.length || 0) : {}),
        ...(isPathShape(def) ? { length_m: Number(objectLengthM(o).toFixed(3)) } : {}),
        ...(def?.cover || isPathShape(def) ? { area_m2: Number(objectAreaM2(o).toFixed(3)) } : {}),
        ...(o.color ? { color: o.color } : {}),
        ...(o.locked ? { locked: true } : {}),
        // Необязательные поля (версия схемы та же): параметры вида, привязка
        // растения к коробу, бордюр по периметру, расчёт лестницы.
        ...(o.meta && Object.keys(o.meta).length ? { meta: o.meta } : {}),
        ...(o.parent ? { parent: o.parent } : {}),
        ...(o.curb ? { curb: { ...o.curb } } : {}),
        ...(o.kind === 'stairs-out' ? { stairs: stairsExport(o) } : {}),
        // Отметки уровня (мм от нуля участка) и подпорная стенка — тоже необязательные.
        ...(Number.isFinite(o.elev) ? { elev_mm: o.elev } : {}),
        ...(Number.isFinite(o.elevTo) ? { elev_to_mm: o.elevTo } : {}),
        ...(o.kind === 'retaining-wall' ? { retaining: retainingExport(o) } : {}),
      };
    }),
  };
}

// Перевод модели Kepler в сущности Zamer CAD (в осях дома).
// dims: false — без размерных линий (для генплана).
export function planEntities(project, { dims = true } = {}) {
  const walls = deriveWalls(project);
  const entities = [];

  // Движок v2 (у записей есть rects): стены — единый контур области W
  // (наружные циклы и дыры: дворы, помещения по стенам), без швов между
  // кусками; оси ручных стен — на слой осей.
  const v2 = walls.some((w) => w.rects);
  if (v2) {
    for (const c of wallOutline(walls)) entities.push(...polyLines(c.pts, 'walls', true));
    for (const w of walls) {
      if (w.hidden || w.kind !== 'manual' || !Number.isFinite(w.edge)) continue;
      // Ось ручной стены: edge — линия оси (с учётом привязки к грани), from…to — длина.
      entities.push(w.orient === 'h'
        ? { type: 'line', layer: 'axes', x1: w.from, y1: w.edge, x2: w.to, y2: w.edge }
        : { type: 'line', layer: 'axes', x1: w.edge, y1: w.from, x2: w.edge, y2: w.to });
    }
  }
  for (const wall of walls) {
    if (v2) break;
    if (wall.hidden || wall.kind === 'joint' || wall.kind === 'chamfer') continue; // заплатки/фаски в DXF не нужны
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

  for (const opening of levelWindowOpenings(project, walls)) {
    if (opening.kind === 'door') {
      const type = opening.type || 'single';
      if (type === 'sliding') {
        const placed = openingRect(project, opening, walls);
        if (!placed) continue;
        const { rect, wall } = placed;
        const horiz = wall.orient === 'h';
        const len = horiz ? rect.w : rect.h;
        const t = horiz ? rect.h : rect.w;
        for (const [from, to, at] of [[0, 0.6, 0.35], [0.4, 1, 0.65]]) {
          entities.push(horiz
            ? { type: 'line', layer: 'walls', x1: rect.x + len * from, y1: rect.y + t * at, x2: rect.x + len * to, y2: rect.y + t * at }
            : { type: 'line', layer: 'walls', x1: rect.x + t * at, y1: rect.y + len * from, x2: rect.x + t * at, y2: rect.y + len * to });
        }
        continue;
      }
      for (const symbol of doorLeaves(project, opening, walls)) {
        entities.push({ type: 'line', layer: 'walls', x1: symbol.hinge.x, y1: symbol.hinge.y, x2: symbol.open.x, y2: symbol.open.y });
        entities.push({ type: 'arc', layer: 'walls', start: symbol.closed, through: symbol.through, end: symbol.open });
      }
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

  // Перила открытых помещений: две линии (наружная и внутренняя) на сегмент.
  for (const room of project.rooms) {
    if (!isOpenRoom(room)) continue;
    for (const s of roomRailings(room, project.rooms, project.settings)) {
      for (const at of [s.edge, s.edge - s.outward * RAILING_INSET]) {
        entities.push(s.orient === 'h'
          ? { type: 'line', layer: 'walls', x1: s.a, y1: at, x2: s.b, y2: at }
          : { type: 'line', layer: 'walls', x1: at, y1: s.a, x2: at, y2: s.b });
      }
    }
  }

  for (const item of project.items) {
    if (isStructural(item.kind)) {
      entities.push(...structuralEntities(item));
      continue;
    }
    // Диван-конструктор — только модулями (габаритный блок их бы дублировал).
    if (!isFixedSizeComp(item)) {
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
    // Части составной мебели — отдельными блоками на том же слое.
    for (const p of partsInHouse(item)) {
      entities.push({
        type: 'block', layer: 'furniture', kind: p.kind, x: p.x, y: p.y, rotation: p.rotation, width: p.w, height: p.h,
      });
    }
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

// Свободная стена — стена по длинной оси (две грани и ось), колонна —
// контур (круглая — окружность). Слой стен.
function structuralEntities(item) {
  if (isRoundItem(item.kind)) return [{ type: 'circle', layer: 'walls', cx: item.x, cy: item.y, radius: item.w / 2 }];
  if (item.kind === 'wall-free') {
    const r = ((item.rotation || 0) * Math.PI) / 180;
    const dx = (Math.cos(r) * item.w) / 2;
    const dy = (Math.sin(r) * item.w) / 2;
    return [{ type: 'wall', layer: 'walls', width: item.h, x1: item.x - dx, y1: item.y - dy, x2: item.x + dx, y2: item.y + dy }];
  }
  const c = structuralOutline(item);
  return c.map((p, i) => ({ type: 'line', layer: 'walls', x1: p.x, y1: p.y, x2: c[(i + 1) % c.length].x, y2: c[(i + 1) % c.length].y }));
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
  { key: 'terrain', name: 'terrain_points', color: 3 },
  { key: 'contours', name: 'contours', color: 32 },
  { key: 'contoursMajor', name: 'contours_major', color: 30 },
];

// Рельеф для генплана: точки POINT с Z (мм) + подпись отметки, горизонтали —
// отрезками с Z на отдельных слоях (основные — каждая 5-я).
function terrainEntities(site) {
  const terrain = site?.terrain;
  if (!terrain?.points?.length) return [];
  const out = [];
  for (const p of terrain.points) {
    out.push({ type: 'point', layer: 'terrain', x: p.x, y: p.y, z: p.z });
    out.push({ type: 'text', layer: 'terrain', x: p.x + 150, y: p.y - 150, height: 250, text: formatElevation(p.z) });
  }
  const model = terrainModel(terrain);
  for (const level of contours(model, terrain.contourStep)) {
    const layer = level.major ? 'contoursMajor' : 'contours';
    for (const line of level.lines) {
      const n = line.pts.length;
      for (let i = 0; i < (line.closed ? n : n - 1); i += 1) {
        const a = line.pts[i];
        const b = line.pts[(i + 1) % n];
        out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y, z1: level.z, z2: level.z });
      }
    }
  }
  return out;
}

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
  for (const entry of siteEntries(site)) {
    const rad = ((entry.dir ?? entry.angle ?? 0) * Math.PI) / 180;
    for (const part of entryParts(entry)) {
      const at = (offset) => ({ x: entry.x + Math.sin(rad) * offset, y: entry.y - Math.cos(rad) * offset });
      const a = at(part.offset - part.width / 2); const b = at(part.offset + part.width / 2);
      out.push({ type: 'line', layer: 'site', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
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
  entities.push(...terrainEntities(project.site));
  entities.push(...landscapeDxfEntities(project.site));
  return buildDxf(entities, { extraLayers: [...SITE_LAYERS, ...LANDSCAPE_DXF_LAYERS] });
}

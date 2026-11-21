// Многовариантная автоматическая расстановка мебели.
//
// В отличие от старого последовательного arrangeRoom (core/furnish.js),
// этот модуль ничего не меняет во время поиска: он строит несколько полных
// кандидатов, отбрасывает недопустимые независимой проверкой и только затем
// позволяет применить выбранный вариант одной операцией истории.

import { furnitureDef, isStructural } from './catalog.js';
import { itemShapes } from './clearance.js';
import { analyzeRoomErgonomics, ergoContext, ERGO_NORMS } from './ergonomics.js';
import { itemsInRoom } from './furnish.js';
import { windowMorningExposure } from './insolation.js';
import { collectRoomDoorRouteEvidence, collectVerifiedRouteMetrics } from './layout-door-route.js';
import { collectLayoutEvaluatorMetrics } from './layout-evaluators.js';
import { collectKitchenLayoutMetrics } from './layout-kitchen-metrics.js';
import { collectBedroomBathroomMetrics } from './layout-room-metrics.js';
import { evaluateLayoutRules, layoutRuleCoverage, summarizeLayoutRuleResults } from './layout-rules.js';
import { nestedOuterRect } from './rooms.js';
import { roomBoundaryEdges, roomContainsPoint, roomRects } from './room-shape.js';
import { doorLink, doorSwingRect, openingOwnerId, openingRect, wallRects } from './walls.js';

const STEP = 250;
const ROUTE_STEP = 150;
const PERSON_RADIUS = 300;
const DEFAULT_RULES = Object.freeze({ wall: true, clearFront: 500, priority: 9 });
const EPS = 2;
const ALTERNATIVE_BED_SIDES = new Set(['bed-single', 'bed-double', 'bed-queen', 'bed-king']);
const DOUBLE_BED_KINDS = new Set(['bed-double', 'bed-queen', 'bed-king']);
const BED_KINDS = new Set([...DOUBLE_BED_KINDS, 'bed-single', 'bed-bunk', 'kids-bed', 'crib']);

const PROFILES = Object.freeze([
  { id: 'balanced', title: 'Сбалансированный', movement: 0.45, space: 0.55, door: 0.55, relation: 1.3 },
  { id: 'preserve', title: 'Бережный', movement: 1.35, space: 0.25, door: 0.35, relation: 1.1 },
  { id: 'spacious', title: 'Больше проходов', movement: 0.2, space: 1.1, door: 0.9, relation: 1.2 },
]);

const rectOverlap = (a, b, eps = EPS) => a.x + a.w > b.x + eps && b.x + b.w > a.x + eps &&
  a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 });
const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const pointInRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const distToRect = (p, r) => Math.hypot(
  Math.max(r.x - p.x, 0, p.x - r.x - r.w),
  Math.max(r.y - p.y, 0, p.y - r.y - r.h),
);
const distToSegment = (p, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v) => Math.round(v * 1000) / 1000;

function rulesOf(item) {
  return furnitureDef(item.kind)?.rules || DEFAULT_RULES;
}

function itemsForLayout(project, room, itemIds = null) {
  if (itemIds == null) return itemsInRoom(project, room);
  const wanted = new Set(itemIds);
  return project.items.filter((item) => wanted.has(item.id));
}

function poseItem(item, pose) {
  return { ...item, x: pose.x, y: pose.y, rotation: pose.rotation };
}

function shapesAt(item, pose) {
  return itemShapes(poseItem(item, pose));
}

function bboxOf(rects) {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function rectIntersectionArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

// roomRects() — неперекрывающиеся прямоугольники, точное объединение
// ортогонального контура комнаты. Сумма пересечений поэтому надёжно ловит и
// узкий вырез, который мог оказаться между прежними девятью точками-пробами.
function rectTouchesRoom(room, rect) {
  return roomRects(room).some((part) => rectIntersectionArea(part, rect) > EPS);
}

function rectInsideRoom(room, rect) {
  if (!(rect.w > 0 && rect.h > 0)) return false;
  const covered = roomRects(room).reduce((sum, part) => sum + rectIntersectionArea(part, rect), 0);
  const area = rect.w * rect.h;
  return area - covered <= Math.max(EPS, area * 1e-9);
}

function rotatedLocalRect(pose, localX, localY, w, h) {
  const a = ((pose.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(a); const s = Math.sin(a);
  const points = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => {
    const lx = localX + x; const ly = localY + y;
    return { x: pose.x + lx * c - ly * s, y: pose.y + lx * s + ly * c };
  });
  const x0 = Math.min(...points.map((p) => p.x)); const x1 = Math.max(...points.map((p) => p.x));
  const y0 = Math.min(...points.map((p) => p.y)); const y1 = Math.max(...points.map((p) => p.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function requiresTwoBedSides(item) {
  return DOUBLE_BED_KINDS.has(item?.kind) && explicitBedOccupancy(item) >= 2;
}

function explicitBedOccupancy(item) {
  const assigned = Array.isArray(item?.userActorIds)
    ? new Set(item.userActorIds
      .filter((id) => id !== null && id !== undefined && String(id).trim())
      .map((id) => String(id))).size
    : null;
  const rawOccupancy = item?.occupancyCount;
  const numeric = rawOccupancy === null || rawOccupancy === undefined || rawOccupancy === ''
    ? null
    : Number(rawOccupancy);
  const declared = Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
  if (assigned === null) return declared;
  if (declared === null) return assigned;
  // Назначенные пользователи и заявленная вместимость — независимые
  // доказательства. Двухместность нельзя потерять из-за пустого/частичного
  // массива userActorIds.
  return Math.max(assigned, declared);
}

// Зоны пользования объединены в логические группы. Обычно каждая зона
// обязательна. У взрослой кровати без явно назначенных двух спящих два
// боковых подхода — альтернативы: свободным должен остаться хотя бы один.
// Это не позволяет стене или одной тумбе ложно запретить хорошую позу, но
// агрегатная проверка ниже всё равно отклонит два предмета, перекрывшие обе
// стороны по отдельности.
function accessZoneGroupsAt(item, pose) {
  const rules = rulesOf(item);
  const groups = [];
  if (rules.clearFront > 0) {
    groups.push({
      id: 'front', mode: 'all',
      zones: [rotatedLocalRect(pose, 0, item.h / 2 + rules.clearFront / 2, item.w, rules.clearFront)],
    });
  }
  if (rules.clearAround > 0) {
    groups.push({ id: 'around', mode: 'all', zones: [grow(bboxOf(shapesAt(item, pose)), rules.clearAround)] });
  }
  if (rules.clearSides > 0) {
    const d = rules.clearSides;
    const left = rotatedLocalRect(pose, -item.w / 2 - d / 2, item.h * 0.15, d, item.h * 0.7);
    const right = rotatedLocalRect(pose, item.w / 2 + d / 2, item.h * 0.15, d, item.h * 0.7);
    if (ALTERNATIVE_BED_SIDES.has(item.kind) && !requiresTwoBedSides(item)) {
      groups.push({ id: 'bed-side', mode: 'any', zones: [left, right] });
    } else {
      groups.push(
        { id: 'side-left', mode: 'all', zones: [left] },
        { id: 'side-right', mode: 'all', zones: [right] },
      );
    }
  }
  return groups;
}

const groupsOf = (record) => (Array.isArray(record?.zoneGroups)
  ? record.zoneGroups
  : (record?.zones || []).map((zone, index) => ({ id: `legacy-${index}`, mode: 'all', zones: [zone] })));

const groupSatisfied = (group, test) => group.mode === 'any'
  ? group.zones.some(test)
  : group.zones.every(test);

function accessPairCompatible(a, b) {
  const chairs = new Set(['chair', 'chair-soft']);
  const tables = new Set(['dining-table', 'dining-table-6', 'table-round']);
  return (chairs.has(a.kind) && tables.has(b.kind)) || (chairs.has(b.kind) && tables.has(a.kind));
}

function subtractRect(base, cut) {
  const x0 = Math.max(base.x, cut.x); const y0 = Math.max(base.y, cut.y);
  const x1 = Math.min(base.x + base.w, cut.x + cut.w); const y1 = Math.min(base.y + base.h, cut.y + cut.h);
  if (x1 <= x0 || y1 <= y0) return [base];
  return [
    { x: base.x, y: base.y, w: base.w, h: y0 - base.y },
    { x: base.x, y: y1, w: base.w, h: base.y + base.h - y1 },
    { x: base.x, y: y0, w: x0 - base.x, h: y1 - y0 },
    { x: x1, y: y0, w: base.x + base.w - x1, h: y1 - y0 },
  ].filter((rect) => rect.w > EPS && rect.h > EPS);
}

// Критическая полоса непосредственно перед дверью. Полный анализатор ниже
// точно измеряет зазор и различает error/warn, а эта дешёвая осевая зона не
// даёт beam-search тратить лучшие кандидаты на заведомо красные позиции.
function doorFrontCriticalRect(room, children, placed) {
  const { rect } = placed;
  const horizontal = placed.wall?.orient === 'h'
    || (placed.wall?.orient !== 'v' && rect.w >= rect.h);
  const span = (horizontal ? rect.w : rect.h) - 60;
  if (span <= EPS) return null;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const inside = (x, y) => roomContainsPoint(room, x, y)
    && !children.some((child) => roomContainsPoint(child.room, x, y));
  const depth = ERGO_NORMS.doorFront.crit;
  if (horizontal) {
    if (inside(cx, rect.y + rect.h + 60)) {
      return { x: rect.x + 30, y: rect.y + rect.h, w: span, h: depth };
    }
    if (inside(cx, rect.y - 60)) {
      return { x: rect.x + 30, y: rect.y - depth, w: span, h: depth };
    }
    return null;
  }
  if (inside(rect.x + rect.w + 60, cy)) {
    return { x: rect.x + rect.w, y: rect.y + 30, w: depth, h: span };
  }
  if (inside(rect.x - 60, cy)) {
    return { x: rect.x - depth, y: rect.y + 30, w: depth, h: span };
  }
  return null;
}

function contextOf(project, room, walls, { hardDoorFront = false } = {}) {
  const partition = project.settings?.partition || 100;
  const children = project.rooms.filter((r) => r.parentId === room.id)
    .map((r) => ({ room: r, rect: nestedOuterRect(r, partition) }));
  const doorZones = [];
  const doorRects = [];
  const doorPortals = [];
  const doorFrontZones = [];
  const openingRects = [];
  const manualDoorCuts = [];
  const windowZones = [];
  const solar = windowMorningExposure(project);
  const solarByOpening = new Map(solar.windows.map((entry) => [entry.openingId, entry]));
  const windowSun = [];
  for (const opening of project.openings || []) {
    const placed = openingRect(project, opening, walls);
    if (!placed) continue;
    if (opening.kind === 'door') {
      const link = doorLink(project, opening, walls);
      if (!link?.includes(room.id)) continue;
      openingRects.push({ ...placed.rect });
      const portalRect = grow(placed.rect, 180);
      doorRects.push(portalRect);
      const declaredWidth = Number(opening.width);
      const activeLeafIndices = opening.type === 'double' && Array.isArray(opening.requiredLeafIndices)
        ? [...new Set(opening.requiredLeafIndices.filter((index) => index === 0 || index === 1))]
        : null;
      const effectiveWidth = activeLeafIndices
        ? activeLeafIndices.length === 1 ? declaredWidth / 2
          : activeLeafIndices.length === 2 ? declaredWidth : null
        : declaredWidth;
      doorPortals.push({
        openingId: opening.id,
        rect: portalRect,
        clearWidthMm: Number.isFinite(effectiveWidth) && effectiveWidth > 0 ? effectiveWidth : null,
      });
      if (placed.wall?.kind === 'manual' || placed.wall?.source === 'manual') {
        manualDoorCuts.push({ key: placed.wall.key, rect: grow(placed.rect, EPS) });
      }
      if (hardDoorFront) {
        const doorFront = doorFrontCriticalRect(room, children, placed);
        if (doorFront) doorFrontZones.push(doorFront);
      }
      const swing = doorSwingRect(project, opening, walls);
      if (swing && rectTouchesRoom(room, swing)) doorZones.push(swing);
    } else if (opening.kind === 'window' && openingOwnerId(project, opening, walls) === room.id) {
      openingRects.push({ ...placed.rect });
      const rect = grow(placed.rect, 250);
      windowZones.push(rect);
      windowSun.push({
        openingId: opening.id,
        rect,
        morningMinutes: solarByOpening.get(opening.id)?.morningMinutes ?? null,
      });
    }
  }
  const wallObstacleEntries = (walls || [])
    .filter((wall) => !wall.hidden && (wall.kind === 'manual' || wall.source === 'manual'))
    .flatMap((wall) => wallRects(wall).flatMap((rect) => {
      let parts = [{ ...rect }];
      for (const cut of manualDoorCuts) if (cut.key === wall.key) parts = parts.flatMap((part) => subtractRect(part, cut.rect));
      return parts.map((part) => ({ rect: part, wallId: wall.wallId || wall.key }));
    }))
    .filter((entry) => rectTouchesRoom(room, entry.rect));
  const wallObstacles = wallObstacleEntries.map((entry) => entry.rect);
  return {
    project, room, walls, children, doorZones, doorRects, doorPortals, doorFrontZones, openingRects, windowZones, windowSun,
    solarKnown: solar.known, wallObstacles, wallObstacleEntries, edges: roomBoundaryEdges(room),
  };
}

function fixedPlacedForScope(ctx, selectedItems) {
  const selectedIds = new Set(selectedItems.map((item) => item.id));
  const roomItemIds = new Set(itemsInRoom(ctx.project, ctx.room).map((item) => item.id));
  return (ctx.project.items || []).flatMap((item) => {
    if (selectedIds.has(item.id)) return [];
    // Мебель вложенного помещения уже целиком закрыта child obstacle и не
    // должна навязывать родителю собственные зоны пользования.
    if (!roomItemIds.has(item.id)
      && ctx.children.some((child) => roomContainsPoint(child.room, item.x, item.y))) return [];
    const record = poseRecord(item, item, 'fixed');
    if (!record.shapes.some((shape) => rectTouchesRoom(ctx.room, shape))) return [];
    return [{ item, record, inRoom: roomItemIds.has(item.id) }];
  });
}

function shapeBlocked(ctx, rect) {
  if (!rectInsideRoom(ctx.room, rect)) return 'outside';
  if (ctx.children.some((c) => rectOverlap(rect, c.rect))) return 'child';
  if (ctx.wallObstacles.some((wall) => rectOverlap(rect, wall))) return 'wall';
  if (ctx.doorZones.some((z) => rectOverlap(rect, z))) return 'door';
  if (ctx.doorFrontZones.some((z) => rectOverlap(rect, z))) return 'door-front';
  return null;
}

function poseRecord(item, pose, anchor = 'free') {
  const rawRotation = Number(pose.rotation) || 0;
  const normalizedRotation = ((rawRotation % 360) + 360) % 360;
  const zoneGroups = accessZoneGroupsAt(item, pose);
  return {
    itemId: item.id,
    kind: item.kind,
    x: round(pose.x), y: round(pose.y),
    // Закреплённому предмету оставляем исходное числовое значение угла: -90°
    // и 270° физически равны, но lock не должен незаметно переписывать данные.
    rotation: round(anchor === 'locked' ? rawRotation : normalizedRotation),
    shapes: shapesAt(item, pose),
    // zones сохраняется как плоское совместимое представление для внешних
    // потребителей, а валидатор и маршрут используют семантику zoneGroups.
    zones: zoneGroups.flatMap((group) => group.zones),
    zoneGroups,
    anchor,
  };
}

function angleDistance(a, b) {
  const d = Math.abs((((Number(a) || 0) - (Number(b) || 0)) % 360 + 360) % 360);
  return Math.min(d, 360 - d);
}

function staticAccessFailure(ctx, zone) {
  if (!rectInsideRoom(ctx.room, zone)) return 'access-outside';
  if (ctx.children.some((child) => rectOverlap(zone, child.rect))) return 'access-child';
  if (ctx.wallObstacles.some((wall) => rectOverlap(zone, wall))) return 'access-wall';
  return null;
}

function groupClearOfBodies(ctx, ownerItem, group, blockers) {
  return groupSatisfied(group, (zone) => (
    !staticAccessFailure(ctx, zone) && !blockers.some((other) => (
      !accessPairCompatible(ownerItem, other.item)
      && other.record.shapes.some((shape) => rectOverlap(zone, shape))
    ))
  ));
}

function groupsClearOfBodies(ctx, ownerItem, record, blockers) {
  return groupsOf(record).every((group) => groupClearOfBodies(ctx, ownerItem, group, blockers));
}

function recordHardFailure(ctx, item, record, placed) {
  for (const rect of record.shapes) {
    const blocked = shapeBlocked(ctx, rect);
    if (blocked) return blocked;
    if (rulesOf(item).tall && ctx.windowZones.some((z) => rectOverlap(rect, z))) return 'window';
  }
  for (const group of groupsOf(record)) {
    const failures = group.zones.map((zone) => staticAccessFailure(ctx, zone));
    const valid = group.mode === 'any' ? failures.some((failure) => !failure) : failures.every((failure) => !failure);
    if (!valid) return failures.find(Boolean) || 'access';
  }
  const fixedPlaced = Array.isArray(ctx.fixedPlaced) ? ctx.fixedPlaced : [];
  const bodyBlockers = [...fixedPlaced, ...placed];
  for (const other of bodyBlockers) {
    if (record.shapes.some((a) => other.record.shapes.some((b) => rectOverlap(a, b)))) return 'collision';
  }
  // Группы проверяются против совокупности тел, а не попарно. Иначе два
  // разных предмета могли занять по одной альтернативной стороне кровати.
  if (!groupsClearOfBodies(ctx, item, record, bodyBlockers)) return 'own-access';
  const candidate = { item, record };
  // Зоны пользования проверяем только у предметов текущей задачи. Внешний
  // предмет может лишь частично заходить проекцией в комнату; проверять его
  // собственную зону относительно чужой комнаты было бы ложным запретом.
  for (const other of placed) {
    const blockers = [...fixedPlaced, ...placed.filter((entry) => entry !== other), candidate];
    if (!groupsClearOfBodies(ctx, other.item, other.record, blockers)) return 'foreign-access';
  }
  for (const other of fixedPlaced.filter((entry) => entry.inRoom)) {
    const baseline = [
      ...fixedPlaced.filter((entry) => entry !== other),
      ...placed,
    ];
    // Partial layout не обязан чинить уже существовавшую ошибку вне scope,
    // но не может перекрыть последнюю свободную альтернативу фиксированного
    // предмета (например, вторую сторону исключённой кровати).
    if (groupsOf(other.record).some((group) => (
      groupClearOfBodies(ctx, other.item, group, baseline)
        && !groupClearOfBodies(ctx, other.item, group, [...baseline, candidate])
    ))) {
      return 'fixed-access';
    }
  }
  return null;
}

function inwardRotation(edge) {
  if (edge.orient === 'h') return edge.outward < 0 ? 0 : 180;
  return edge.outward > 0 ? 90 : 270;
}

function wallPoses(item, ctx) {
  const poses = [];
  for (const edge of ctx.edges) {
    const along = item.w; const depth = item.h;
    const length = edge.to - edge.from;
    if (length + EPS < along) continue;
    const rot = inwardRotation(edge);
    const inward = edge.orient === 'h' ? { x: 0, y: -edge.outward } : { x: -edge.outward, y: 0 };
    const max = length - along;
    const offsets = new Set([0, max, max / 2]);
    for (let d = 0; d <= max + EPS; d += STEP) offsets.add(Math.min(d, max));
    for (const d of offsets) {
      const alongCenter = edge.from + d + along / 2;
      const x = edge.orient === 'h' ? alongCenter : edge.edge + inward.x * depth / 2;
      const y = edge.orient === 'h' ? edge.edge + inward.y * depth / 2 : alongCenter;
      poses.push({ x, y, rotation: rot, anchor: `wall:${edge.index}` });
    }
  }
  return poses;
}

function gridPoses(item, ctx) {
  const poses = [];
  for (const rotation of [0, 90]) {
    const w = rotation % 180 ? item.h : item.w;
    const h = rotation % 180 ? item.w : item.h;
    for (let y = ctx.room.y + h / 2; y <= ctx.room.y + ctx.room.h - h / 2 + EPS; y += STEP) {
      for (let x = ctx.room.x + w / 2; x <= ctx.room.x + ctx.room.w - w / 2 + EPS; x += STEP) {
        poses.push({ x, y, rotation, anchor: 'grid' });
      }
    }
  }
  return poses;
}

function dedupePoses(poses) {
  const map = new Map();
  for (const p of poses) {
    const key = `${Math.round(p.x)}:${Math.round(p.y)}:${Math.round(p.rotation || 0) % 360}`;
    if (!map.has(key)) map.set(key, p);
  }
  return [...map.values()];
}

function basePoses(item, ctx) {
  const rules = rulesOf(item);
  const old = { x: item.x, y: item.y, rotation: item.rotation || 0, anchor: 'existing' };
  let poses;
  if (rules.pairWith?.length) poses = gridPoses(item, ctx);
  else if (rules.center || rules.wall === false) poses = gridPoses(item, ctx);
  else poses = wallPoses(item, ctx);
  return dedupePoses([old, ...poses]);
}

function pairedPoses(item, placed) {
  const pair = rulesOf(item).pairWith;
  if (!pair?.length) return [];
  const anchor = [...placed].reverse().find((p) => pair.includes(p.item.kind));
  if (!anchor) return [];
  if (item.kind === 'nightstand' && ['bed-double', 'bed-king', 'bed-single'].includes(anchor.item.kind)) {
    // Тумбы стоят сбоку именно у изголовья, а не занимают обязательные
    // проходы вдоль середины и ног кровати.
    const gap = 50;
    const y = -anchor.item.h / 2 + item.h / 2;
    const angle = (anchor.record.rotation * Math.PI) / 180;
    const c = Math.cos(angle); const s = Math.sin(angle);
    return [-1, 1].map((side) => {
      const x = side * (anchor.item.w / 2 + item.w / 2 + gap);
      return {
        x: anchor.record.x + x * c - y * s,
        y: anchor.record.y + x * s + y * c,
        rotation: anchor.record.rotation,
        anchor: `pair:${anchor.item.id}`,
      };
    });
  }
  const box = bboxOf(anchor.record.shapes);
  const gap = item.kind === 'nightstand' ? 50 : 90;
  const xs = [box.x + box.w * 0.25, box.x + box.w * 0.5, box.x + box.w * 0.75];
  const ys = [box.y + box.h * 0.25, box.y + box.h * 0.5, box.y + box.h * 0.75];
  return [
    ...xs.map((x) => ({ x, y: box.y - item.h / 2 - gap, rotation: 0, anchor: `pair:${anchor.item.id}` })),
    ...xs.map((x) => ({ x, y: box.y + box.h + item.h / 2 + gap, rotation: 180, anchor: `pair:${anchor.item.id}` })),
    ...ys.map((y) => ({ x: box.x - item.h / 2 - gap, y, rotation: 270, anchor: `pair:${anchor.item.id}` })),
    ...ys.map((y) => ({ x: box.x + box.w + item.h / 2 + gap, y, rotation: 90, anchor: `pair:${anchor.item.id}` })),
  ];
}

function distanceToDoors(ctx, record) {
  if (!ctx.doorZones.length && !ctx.doorRects.length) return 1800;
  const c = centerOf(bboxOf(record.shapes));
  return Math.min(...[...ctx.doorZones, ...ctx.doorRects].map((r) => distToRect(c, r)));
}

function relationBonus(item, record, placed) {
  const pair = rulesOf(item).pairWith;
  if (!pair?.length) return 0;
  const anchor = [...placed].reverse().find((p) => pair.includes(p.item.kind));
  if (!anchor) return -5;
  const a = centerOf(bboxOf(record.shapes)); const b = centerOf(bboxOf(anchor.record.shapes));
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return clamp(2.5 - d / 1000, -2, 2.5);
}

function scoreRecord(ctx, item, record, placed, profile) {
  const moved = Math.hypot(record.x - item.x, record.y - item.y) / 1000;
  const rot = Math.min(Math.abs(record.rotation - (item.rotation || 0)), 360 - Math.abs(record.rotation - (item.rotation || 0))) / 90;
  const nearest = placed.length ? Math.min(...placed.flatMap((p) => record.shapes.flatMap((a) => p.record.shapes.map((b) => {
    const ca = centerOf(a); const cb = centerOf(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y);
  })))) : 1500;
  const door = clamp(distanceToDoors(ctx, record) / 1800, 0, 1.5);
  const relation = relationBonus(item, record, placed);
  const wall = record.anchor.startsWith('wall') ? 0.35 : 0;
  const deskWindow = item.kind.includes('desk') && ctx.windowZones.some((w) => distToRect(centerOf(bboxOf(record.shapes)), w) < 1000) ? 0.5 : 0;
  const bedKinds = ['bed-double', 'bed-king', 'bed-queen', 'bed-single', 'kids-bed', 'crib'];
  const center = centerOf(bboxOf(record.shapes));
  const morningSun = ctx.solarKnown && bedKinds.includes(item.kind)
    ? Math.max(0, ...ctx.windowSun.map((entry) =>
      clamp((entry.morningMinutes || 0) / 120, 0, 1) * clamp(1 - distToRect(center, entry.rect) / 3500, 0, 1))) * 0.35
    : 0;
  return wall + deskWindow + morningSun + profile.space * clamp(nearest / 1800, 0, 1.2) + profile.door * door +
    profile.relation * relation - profile.movement * (moved + rot * 0.25);
}

function stateKey(placed) {
  return placed.map((p) => `${p.item.id}:${Math.round(p.record.x)}:${Math.round(p.record.y)}:${p.record.rotation}`).join('|');
}

function preselectBaseCandidates(ctx, item, poses, lockedPlaced, profile, opts, failures) {
  const ranked = [];
  for (const pose of poses) {
    const record = poseRecord(item, pose, pose.anchor);
    const failure = recordHardFailure(ctx, item, record, lockedPlaced);
    if (failure) { failures[failure] = (failures[failure] || 0) + 1; continue; }
    ranked.push({ record, score: scoreRecord(ctx, item, record, lockedPlaced, profile) });
  }
  ranked.sort((a, b) => b.score - a.score || a.record.x - b.record.x || a.record.y - b.record.y);

  // Один лучший кандидат из каждой пространственной ячейки сначала даёт
  // разнообразие, затем лимит добирается общим рейтингом. Так мы не
  // перебираем тысячи одинаковых grid-поз для каждого состояния beam search.
  const diverse = new Map();
  for (const entry of ranked) {
    const r = entry.record;
    const key = `${Math.round(r.x / 750)}:${Math.round(r.y / 750)}:${r.rotation}:${String(r.anchor).split(':')[0]}`;
    if (!diverse.has(key)) diverse.set(key, entry);
  }
  const selected = [];
  const seen = new Set();
  const take = (entry) => {
    const key = `${entry.record.x}:${entry.record.y}:${entry.record.rotation}`;
    if (seen.has(key) || selected.length >= opts.maxBasePoses) return;
    seen.add(key); selected.push(entry.record);
  };
  for (const entry of diverse.values()) take(entry);
  for (const entry of ranked) take(entry);
  return selected;
}

function searchProfile(ctx, movable, lockedPlaced, allBasePoses, profile, opts, failures) {
  const baseCandidates = new Map(movable.map((item) => [
    item.id,
    preselectBaseCandidates(ctx, item, allBasePoses.get(item.id), lockedPlaced, profile, opts, failures),
  ]));
  let beam = [{ placed: [...lockedPlaced], score: 0 }];
  for (const item of movable) {
    const next = [];
    for (const state of beam) {
      const candidates = new Map();
      for (const pose of pairedPoses(item, state.placed)) {
        const record = poseRecord(item, pose, pose.anchor);
        candidates.set(`${record.x}:${record.y}:${record.rotation}`, record);
      }
      for (const record of baseCandidates.get(item.id)) {
        const key = `${record.x}:${record.y}:${record.rotation}`;
        if (!candidates.has(key)) candidates.set(key, record);
      }
      const ranked = [];
      for (const record of candidates.values()) {
        const failure = recordHardFailure(ctx, item, record, state.placed);
        if (failure) { failures[failure] = (failures[failure] || 0) + 1; continue; }
        ranked.push({ item, record, add: scoreRecord(ctx, item, record, state.placed, profile) });
      }
      ranked.sort((a, b) => b.add - a.add || a.record.x - b.record.x || a.record.y - b.record.y);
      for (const candidate of ranked.slice(0, opts.candidatesPerItem)) {
        next.push({ placed: [...state.placed, candidate], score: state.score + candidate.add });
      }
    }
    if (!next.length) return [];
    next.sort((a, b) => b.score - a.score || stateKey(a.placed).localeCompare(stateKey(b.placed)));
    const unique = new Map();
    for (const state of next) {
      const key = stateKey(state.placed);
      if (!unique.has(key)) unique.set(key, state);
      if (unique.size >= opts.beamWidth) break;
    }
    beam = [...unique.values()];
  }
  return beam;
}

function routeCheck(ctx, records) {
  if (!ctx.doorPortals.length) return {
    ok: true, unknown: true, minWidth: null, reason: 'Нет двери: маршрут не проверяется',
  };
  const narrowPortal = ctx.doorPortals.find((portal) => (
    Number.isFinite(portal.clearWidthMm) && portal.clearWidthMm < PERSON_RADIUS * 2
  ));
  if (narrowPortal) return {
    ok: false,
    unknown: false,
    minWidth: narrowPortal.clearWidthMm,
    reason: `Ширина дверного портала ${Math.round(narrowPortal.clearWidthMm)} мм меньше 600 мм`,
  };
  if (ctx.doorPortals.some((portal) => !Number.isFinite(portal.clearWidthMm))) return {
    ok: true,
    unknown: true,
    minWidth: null,
    reason: 'Неизвестна чистая ширина дверного портала: маршрут 600 мм не доказан',
  };
  const { room } = ctx;
  const cols = Math.max(1, Math.ceil(room.w / ROUTE_STEP));
  const rows = Math.max(1, Math.ceil(room.h / ROUTE_STEP));
  const cells = [];
  const blocked = new Uint8Array(cols * rows);
  const obstacleRects = [
    ...ctx.children.map((c) => grow(c.rect, PERSON_RADIUS)),
    ...ctx.wallObstacles.map((wall) => grow(wall, PERSON_RADIUS)),
    ...records.flatMap((r) => r.shapes.map((s) => grow(s, PERSON_RADIUS))),
  ];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const p = { x: room.x + (x + 0.5) * ROUTE_STEP, y: room.y + (y + 0.5) * ROUTE_STEP };
      cells.push(p);
      // Проверяется тело диаметром 600 мм, а не только его центральная точка:
      // центр не должен подходить к реальной границе комнаты ближе радиуса.
      const nearWall = ctx.edges.some((edge) => {
        const a = edge.orient === 'h' ? { x: edge.from, y: edge.edge } : { x: edge.edge, y: edge.from };
        const b = edge.orient === 'h' ? { x: edge.to, y: edge.edge } : { x: edge.edge, y: edge.to };
        return distToSegment(p, a, b) < PERSON_RADIUS - EPS;
      });
      if (!roomContainsPoint(room, p.x, p.y) || nearWall || obstacleRects.some((r) => pointInRect(p, r))) blocked[y * cols + x] = 1;
    }
  }
  const visited = new Uint8Array(cols * rows);
  const queue = [];
  const portals = ctx.doorPortals.map((portal) => cells
    .map((point, index) => (!blocked[index] && distToRect(point, portal.rect) <= PERSON_RADIUS + ROUTE_STEP ? index : -1))
    .filter((index) => index >= 0));
  for (const index of portals[0] || []) {
    if (!visited[index]) { visited[index] = 1; queue.push(index); }
  }
  for (let qi = 0; qi < queue.length; qi += 1) {
    const i = queue[qi]; const x = i % cols; const y = Math.floor(i / cols);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (!blocked[ni] && !visited[ni]) { visited[ni] = 1; queue.push(ni); }
    }
  }
  const isReachable = (point) => Boolean(point && cells.some((cell, index) => (
    visited[index] && Math.hypot(cell.x - point.x, cell.y - point.y) <= ROUTE_STEP * 1.1
  )));
  const routeResult = (value) => {
    const result = { ...value, computedFromCurrentLayout: true };
    // Нужен только синхронной валидации двери; в Worker/result функция не
    // сериализуется и не попадает в публичный layout.
    Object.defineProperty(result, 'isReachable', { value: isReachable });
    return result;
  };
  if (!queue.length) return routeResult({
    ok: false, unknown: false, minWidth: 0, reason: 'От двери нет прохода шириной 600 мм',
  });
  if (portals.some((portal) => !portal.length || !portal.some((index) => visited[index]))) {
    return routeResult({
      ok: false, unknown: false, minWidth: 0, reason: 'Дверные порталы не связаны проходом шириной 600 мм',
    });
  }
  const zoneAccess = new Map(records.map((record) => [
    record.itemId,
    groupsOf(record).map((group) => groupSatisfied(group, (zone) => (
      cells.some((point, index) => visited[index] && pointInRect(point, zone))
    ))),
  ]));
  for (const record of records) {
    if (record.routeTarget === false || isStructural(record.kind)) continue;
    const reached = cells.some((p, i) => visited[i] && record.shapes.some((s) => distToRect(p, s) <= PERSON_RADIUS + ROUTE_STEP * 1.5));
    if (!reached) return routeResult({
      ok: false, unknown: false, minWidth: 0, zoneAccess,
      reason: `К предмету «${record.kind}» нет прохода шириной 600 мм`,
    });
  }
  return routeResult({ ok: true, unknown: false, minWidth: PERSON_RADIUS * 2, zoneAccess });
}

function layoutSignature(placements) {
  return [...placements].sort((a, b) => a.itemId.localeCompare(b.itemId))
    .map((p) => `${p.itemId}:${Math.round(p.x / 50)}:${Math.round(p.y / 50)}:${p.rotation}`).join('|');
}

function metricsOf(items, records, route) {
  let moved = 0;
  let minGap = Infinity;
  for (const record of records) {
    const item = items.find((x) => x.id === record.itemId);
    moved += Math.hypot(record.x - item.x, record.y - item.y);
  }
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const a = centerOf(bboxOf(records[i].shapes)); const b = centerOf(bboxOf(records[j].shapes));
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return {
    movedMm: Math.round(moved),
    averageMoveMm: Math.round(moved / Math.max(1, records.length)),
    minCenterDistanceMm: Number.isFinite(minGap) ? Math.round(minGap) : null,
    routeWidthMm: route.minWidth,
  };
}

function publicPlacements(records) {
  return records.map((r) => ({ itemId: r.itemId, x: r.x, y: r.y, rotation: r.rotation }));
}

// Hard/conditional-hard уже отбрасываются validateFurnitureLayout(). Здесь
// мягкие правила действительно влияют на порядок вариантов: подтверждённый
// pass слегка поощряется, fail получает заметный штраф, unknown нейтрален.
export function layoutRuleScoreAdjustment(results = []) {
  return results.reduce((score, result) => {
    if (result?.severity !== 'soft') return score;
    if (result.status === 'pass') return score + 0.25;
    if (result.status === 'fail') return score - 1;
    return score;
  }, 0);
}

const ERGO_SEVERITY_RANK = Object.freeze({ warn: 1, error: 2 });

function compactErgonomicFinding(finding) {
  return {
    id: finding.id,
    severity: finding.severity,
    rule: finding.rule,
    group: finding.group,
    itemIds: [...(finding.itemIds || [])],
    ...(finding.doorId ? { doorId: finding.doorId } : {}),
    text: finding.text,
    gap: Number.isFinite(finding.gap) ? finding.gap : null,
    need: Number.isFinite(finding.need) ? finding.need : null,
    crit: Number.isFinite(finding.crit) ? finding.crit : null,
  };
}

function projectWithCandidatePoses(project, records) {
  const poses = new Map(records.map((record) => [record.itemId, record]));
  return {
    ...project,
    // У активного этажа эти поля могут быть неперечисляемыми accessors, так
    // что одного spread недостаточно.
    rooms: project.rooms,
    openings: project.openings,
    items: (project.items || []).map((item) => {
      const pose = poses.get(item.id);
      return pose ? { ...item, x: pose.x, y: pose.y, rotation: pose.rotation } : item;
    }),
  };
}

function ergonomicPlacementSignature(records) {
  return [...records]
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
    .map((record) => `${record.itemId}:${round(record.x)}:${round(record.y)}:${round(record.rotation)}`)
    .join('|');
}

function findingIsNewOrWorse(finding, baselineById) {
  const baseline = baselineById.get(finding.id);
  if (!baseline) return true;
  const rank = ERGO_SEVERITY_RANK[finding.severity] || 0;
  const baselineRank = ERGO_SEVERITY_RANK[baseline.severity] || 0;
  if (rank > baselineRank) return true;
  return rank === baselineRank
    && Number.isFinite(finding.gap)
    && Number.isFinite(baseline.gap)
    && finding.gap < baseline.gap - 0.5;
}

function candidateErgonomics(project, room, walls, records, selectedItems, opts) {
  const selectedIds = new Set(selectedItems.map((item) => item.id));
  const fullRoomScope = itemsInRoom(project, room).every((item) => selectedIds.has(item.id));
  const sharedContext = opts.ergoContext || ergoContext(project, walls);
  const cacheKey = `${fullRoomScope ? 'full' : 'partial'}:${ergonomicPlacementSignature(records)}`;
  const cached = opts.ergoResultCache?.get(cacheKey);
  if (cached) return cached;

  const candidateProject = projectWithCandidatePoses(project, records);
  const result = analyzeRoomErgonomics(candidateProject, room, walls, sharedContext, { heat: false });
  let findings = result.findings || [];
  if (!fullRoomScope) {
    const baselineResult = opts.baselineErgonomics
      || analyzeRoomErgonomics(project, room, walls, sharedContext, { heat: false });
    const baselineById = new Map((baselineResult.findings || []).map((finding) => [finding.id, finding]));
    findings = findings.filter((finding) => (
      (finding.itemIds || []).some((itemId) => selectedIds.has(itemId))
      || findingIsNewOrWorse(finding, baselineById)
    ));
  }

  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warn');
  const summary = {
    analyzed: true,
    fullRoomScope,
    errorCount: errors.length,
    warningCount: warnings.length,
    // Старое имя оставлено как безвредный alias для потребителей черновика.
    warnCount: warnings.length,
    scoreAdjustment: warnings.length ? -Math.min(4, warnings.length * 0.5) : 0,
    findings: findings.map(compactErgonomicFinding),
  };
  opts.ergoResultCache?.set(cacheKey, summary);
  return summary;
}

function emptyErgonomics() {
  return {
    analyzed: false,
    fullRoomScope: false,
    errorCount: 0,
    warningCount: 0,
    warnCount: 0,
    scoreAdjustment: 0,
    findings: [],
  };
}

/**
 * Независимая проверка готового варианта. Поиск вызывает её для финалистов,
 * но функцию можно повторно запустить перед применением или после импорта.
 */
export function validateFurnitureLayout(project, room, walls, layout, opts = {}) {
  const ctx = contextOf(project, room, walls);
  const items = itemsForLayout(project, room, opts.itemIds);
  ctx.fixedPlaced = fixedPlacedForScope(ctx, items);
  const checks = [];
  const expectedIds = new Set(items.map((item) => item.id));
  const poses = new Map();
  for (const pose of layout?.placements || []) {
    if (!pose?.itemId || poses.has(pose.itemId)) {
      checks.push({
        id: 'AUTO-PLACEMENT-SET', status: 'fail', itemIds: pose?.itemId ? [pose.itemId] : [],
        text: pose?.itemId ? 'В варианте повторяется один предмет' : 'В варианте есть позиция без предмета',
      });
      continue;
    }
    if (!expectedIds.has(pose.itemId)) {
      checks.push({ id: 'AUTO-PLACEMENT-SET', status: 'fail', itemIds: [pose.itemId], text: 'В варианте есть посторонний предмет' });
    }
    poses.set(pose.itemId, pose);
  }
  const placed = [];
  const allPosedRecords = [];
  const locked = new Set([
    ...(opts.lockedIds || []),
    ...items.filter((item) => isStructural(item.kind) || item.autoLayoutLocked === true).map((item) => item.id),
  ]);
  for (const item of items) {
    const pose = poses.get(item.id);
    if (!pose) {
      checks.push({ id: 'AUTO-ITEM-PRESENT', status: 'fail', itemIds: [item.id], text: 'Предмет отсутствует в варианте' });
      continue;
    }
    // Сохраняем каждую заданную позу до lock/geometry-проверок. Невалидный
    // предмет остаётся реальным препятствием для маршрута и кинематики двери.
    const record = poseRecord(item, pose, 'validate');
    allPosedRecords.push(record);
    if (locked.has(item.id) && (Math.abs(pose.x - item.x) > 0.5 || Math.abs(pose.y - item.y) > 0.5 || angleDistance(pose.rotation, item.rotation) > 0.001)) {
      checks.push({ id: 'AUTO-LOCKED', status: 'fail', itemIds: [item.id], text: 'Закреплённый предмет был перемещён' });
      continue;
    }
    const failure = recordHardFailure(ctx, item, record, placed);
    checks.push({
      id: `AUTO-GEOMETRY-${item.id}`,
      status: failure ? 'fail' : 'pass', itemIds: [item.id],
      text: failure ? `Недопустимое положение: ${failure}` : 'Предмет и его зона пользования размещены допустимо',
    });
    if (!failure) placed.push({ item, record });
  }
  const records = placed.map((p) => p.record);
  const fixedRoomPlaced = ctx.fixedPlaced.filter((entry) => entry.inRoom);
  const externalFixedPlaced = ctx.fixedPlaced.filter((entry) => !entry.inRoom);
  const metricItems = [...items, ...fixedRoomPlaced.map((entry) => entry.item)];
  const metricRecords = [...records, ...fixedRoomPlaced.map((entry) => entry.record)];
  const placementGeometryValid = checks.every((entry) => entry.status !== 'fail')
    && records.length === items.length;
  const allPosedGeometryComplete = allPosedRecords.length === items.length
    && allPosedRecords.every((record) => record.shapes.length > 0 && record.shapes.every((shape) => (
      [shape.x, shape.y, shape.w, shape.h].every(Number.isFinite) && shape.w > 0 && shape.h > 0
    )));
  const routeRecords = [
    ...ctx.fixedPlaced.map((entry) => (entry.inRoom
      ? entry.record
      : { ...entry.record, routeTarget: false })),
    ...allPosedRecords,
  ];
  const route = routeCheck(ctx, routeRecords);
  checks.push({
    id: 'AUTO-ROUTE-600', status: route.unknown ? 'unknown' : route.ok ? 'pass' : 'fail',
    itemIds: [], text: route.unknown ? route.reason : route.ok ? 'Все предметы доступны по проходу 600 мм' : route.reason,
  });
  const geometryFails = checks.filter((entry) => entry.id.startsWith('AUTO-GEOMETRY-') && entry.status === 'fail');
  const capacity = project.layoutBrief?.capacity || {};
  const requestedSeats = [capacity.dailySeats, capacity.guestSeats]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const requiredSeatCount = requestedSeats.length ? Math.max(...requestedSeats) : null;
  const obstacleRects = [
    ...ctx.children.map((child) => child.rect),
    ...ctx.wallObstacles,
    ...externalFixedPlaced.flatMap((entry) => entry.record.shapes),
  ];
  const roomMetrics = collectBedroomBathroomMetrics({
    room,
    items: metricItems,
    records: metricRecords,
    extraObstacles: obstacleRects,
    // Наружная грань вложенного помещения — такая же реальная опора для
    // изголовья, как ручная перегородка; само помещение остаётся obstacle.
    supportObstacles: [...ctx.wallObstacles, ...ctx.children.map((child) => child.rect)],
    supportVoids: ctx.openingRects,
  });
  const kitchenMetrics = collectKitchenLayoutMetrics({
    room,
    items: metricItems,
    records: metricRecords,
    obstacleRects,
    obstacleItems: externalFixedPlaced.map((entry) => entry.item),
    simultaneousCooks: capacity.simultaneousCooks,
  });
  const actors = Array.isArray(project.layoutBrief?.actors) ? project.layoutBrief.actors : [];
  const routeActorModelVerified = actors.length > 0 && actors.every((actor) => {
    if (!['measured', 'declared'].includes(actor?.dataStatus)) return false;
    const width = Number(actor.bodyWidthMm);
    const depth = Number(actor.bodyDepthMm);
    const carriesNothing = !Array.isArray(actor.carriedObjectIds) || actor.carriedObjectIds.length === 0;
    return width > 0 && depth > 0 && Math.hypot(width, depth) <= PERSON_RADIUS * 2 && carriesNothing;
  });
  const routeMetrics = placementGeometryValid ? collectVerifiedRouteMetrics({ route, actors }) : {};
  const doorObstacleRects = [
    ...allPosedRecords.flatMap((record) => record.shapes),
    ...(project.items || [])
      .filter((item) => !expectedIds.has(item.id))
      .flatMap((item) => itemShapes(item))
      .filter((rect) => rectTouchesRoom(room, rect)),
    ...ctx.wallObstacleEntries.map((entry) => ({ ...entry, type: 'wall' })),
    ...ctx.children.map((child) => ({ rect: child.rect, type: 'child', roomId: child.room.id })),
  ];
  const doorObstacleGeometryComplete = doorObstacleRects.every((value) => {
    const rect = value?.rect || value;
    return [rect?.x, rect?.y, rect?.w, rect?.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0;
  });
  const doorEvidence = collectRoomDoorRouteEvidence({
    project,
    room,
    walls,
    obstacleRects: doorObstacleRects,
    isReachable: placementGeometryValid && routeActorModelVerified && typeof route.isReachable === 'function'
      ? route.isReachable : null,
    modeledScopeComplete: placementGeometryValid && allPosedGeometryComplete && doorObstacleGeometryComplete,
  });
  const routeForCanonicalMetrics = placementGeometryValid || route.ok === false ? route : null;
  const evaluatorMetrics = collectLayoutEvaluatorMetrics({
    project, room, items: metricItems, records: metricRecords, route: routeForCanonicalMetrics,
    context: {
      doorZones: ctx.doorZones,
      requiredSeatCount,
      requiredDiningSeatCount: requiredSeatCount,
    },
  });
  const geometryCollisionCount = geometryFails
    .filter((entry) => /collision|access|wall/.test(entry.text)).length;
  const metrics = {
    ...evaluatorMetrics,
    ...roomMetrics,
    ...kitchenMetrics,
    ...routeMetrics,
    ...doorEvidence.metrics,
    solid_collision_count: Math.max(
      Number(evaluatorMetrics.solid_collision_count) || 0,
      geometryCollisionCount,
    ),
    furniture_support_valid: evaluatorMetrics.furniture_support_valid === true
      && !geometryFails.some((entry) => /outside|child/.test(entry.text)),
  };
  // Грубый evaluator всегда возвращает 0, даже когда swept-геометрия двери
  // неизвестна. Каноническая метрика допускается только из доказательства
  // двери; найденная geometry-коллизия всегда остаётся положительным fail.
  const geometryDoorFailureCount = geometryFails.filter((entry) => entry.text.includes('door')).length;
  const evidencedDoorCollisionCount = Number(doorEvidence.metrics.door_swing_collision_count);
  delete metrics.door_swing_collision_count;
  if (geometryDoorFailureCount > 0 || (Number.isFinite(evidencedDoorCollisionCount) && evidencedDoorCollisionCount > 0)) {
    metrics.door_swing_collision_count = Math.max(
      geometryDoorFailureCount,
      Number.isFinite(evidencedDoorCollisionCount) ? evidencedDoorCollisionCount : 0,
    );
  } else if (allPosedGeometryComplete
    && Object.hasOwn(doorEvidence.metrics, 'door_swing_collision_count')
    && evidencedDoorCollisionCount === 0) {
    metrics.door_swing_collision_count = 0;
  }
  // Комнатный flood-fill остаётся обязательной внутренней проверкой, но не
  // подменяет PATH001/2: для них нужны явные OD-пары и подтверждённая модель
  // конкретного пользователя. Удаляем более грубые evaluator-метрики.
  delete metrics.required_routes_reachable;
  delete metrics.agent_body_route_valid;
  if (route.unknown || !placementGeometryValid) {
    // Номинальное количество иконок известно, пригодность мест без маршрута — нет.
    delete metrics.usable_seat_count;
    delete metrics.usable_dining_seat_count;
  }
  const doubleBeds = metricItems.filter((item) => ['bed-double', 'bed-king', 'bed-queen'].includes(item.kind));
  const twoOccupantDoubleBeds = doubleBeds.filter(requiresTwoBedSides);
  if (placementGeometryValid && twoOccupantDoubleBeds.length && !route.unknown) {
    metrics.independent_bed_access = twoOccupantDoubleBeds.every((bed) => {
      const record = metricRecords.find((entry) => entry.itemId === bed.id);
      const groupAccess = route.zoneAccess?.get(bed.id) || [];
      const sideIndices = groupsOf(record).flatMap((group, index) => (
        group.id === 'side-left' || group.id === 'side-right' ? [index] : []
      ));
      return sideIndices.length === 2 && sideIndices.every((index) => groupAccess[index] === true);
    });
  }
  const beds = metricItems.filter((item) => ['bed-double', 'bed-king', 'bed-queen', 'bed-single', 'kids-bed', 'crib'].includes(item.kind));
  if (ctx.solarKnown && beds.length) metrics.bed_morning_sun_preference_satisfied = beds.every((bed) => {
    const record = metricRecords.find((entry) => entry.itemId === bed.id);
    if (!record) return false;
    const center = centerOf(bboxOf(record.shapes));
    return ctx.windowSun.some((entry) => (entry.morningMinutes || 0) >= 30 && distToRect(center, entry.rect) <= 3500);
  });
  const brief = project.layoutBrief || {};
  const externalData = {
    north_and_solar_geometry: ctx.solarKnown,
    measurement_uncertainty: Array.isArray(brief.uncertainty)
      && brief.uncertainty.some((entry) => entry?.status === 'bounded' || entry?.status === 'resolved'),
    fixed_engineering: Array.isArray(brief.fixedEngineering)
      && brief.fixedEngineering.length > 0
      && brief.fixedEngineering.every((entry) => ['measured', 'declared'].includes(entry?.dataStatus)),
    catalog_geometry: metricItems.length > 0
      && metricItems.every((item) => ['verified_sku', 'parametric_custom'].includes(item.geometryStatus)),
    appliance_manuals: metricItems.length > 0
      && metricItems.every((item) => item.manualStatus === 'verified' || item.manualStatus === 'not_required'),
  };
  const adultBeds = metricItems.filter((item) => ['bed-double', 'bed-king', 'bed-queen', 'bed-single'].includes(item.kind));
  const sleepBeds = metricItems.filter((item) => BED_KINDS.has(item.kind));
  const occupancies = sleepBeds.map(explicitBedOccupancy);
  const doubleOccupancies = doubleBeds.map(explicitBedOccupancy);
  const knownOccupancyTotal = occupancies
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const knownRequiredBedsideSurfaces = sleepBeds.reduce((sum, bed, index) => {
    const occupancy = occupancies[index];
    if (occupancy === null || occupancy <= 0) return sum;
    return sum + (DOUBLE_BED_KINDS.has(bed.kind) ? Math.min(2, occupancy) : 1);
  }, 0);
  const unknownBedOccupancy = occupancies.some((value) => value === null);
  const knownBedsideCoverage = Number(metrics.bedside_surface_count);
  const bedsideSurfaceApplicability = !sleepBeds.length
    ? false
    : knownOccupancyTotal >= 1
      ? unknownBedOccupancy
        ? Number.isFinite(knownBedsideCoverage) && knownBedsideCoverage < knownRequiredBedsideSurfaces
          ? true : 'unknown'
        : true
      : unknownBedOccupancy ? 'unknown' : false;
  const independentBedApplicability = !doubleBeds.length
    ? false
    : doubleOccupancies.some((value) => value >= 2)
      ? metrics.independent_bed_access === false
        ? true
        : doubleOccupancies.some((value) => value === null) ? 'unknown' : true
      : doubleOccupancies.some((value) => value === null) ? 'unknown' : false;
  const footRouteFacts = adultBeds.map((bed) => (
    ['measured', 'declared'].includes(bed.routeToSecondSideDataStatus)
      && ['foot', 'side', 'not_required'].includes(bed.routeToSecondSide)
      ? bed.routeToSecondSide : null
  ));
  const footRouteApplicability = !adultBeds.length
    ? false
    : footRouteFacts.includes('foot')
      ? Number(metrics.bed_verified_foot_route_clearance_mm) < 800
        ? true
        : footRouteFacts.some((value) => value === null) ? 'unknown' : true
      : footRouteFacts.some((value) => value === null) ? 'unknown' : false;
  const hasStandardBathActor = actors.some((actor) => (
    ['measured', 'declared'].includes(actor?.dataStatus) && actor.mobilityProfile === 'standard'
  ));
  const hasUnknownBathActor = actors.some((actor) => (
    !['measured', 'declared'].includes(actor?.dataStatus)
      || !actor?.mobilityProfile || actor.mobilityProfile === 'unknown'
  ));
  const bathProfileApplicability = !actors.length
    ? 'unknown'
    : hasStandardBathActor ? true : hasUnknownBathActor ? 'unknown' : false;
  let kitchenAisleApplicability = 'unknown';
  if (kitchenMetrics.kitchen_front_geometry_complete === true
    && kitchenMetrics.kitchen_aisle_evidence_complete === true) {
    kitchenAisleApplicability = Number(kitchenMetrics.kitchen_opposing_front_pair_count) > 0;
  }
  const ruleApplicability = {
    ...doorEvidence.ruleApplicability,
    PATH001: 'unknown',
    PATH002: 'unknown',
    ...(adultBeds.length ? {
      BED003: independentBedApplicability,
      BED005: footRouteApplicability,
    } : {}),
    ...(sleepBeds.length ? { BED006: bedsideSurfaceApplicability } : {}),
    ...(metricItems.some((item) => item.kind === 'toilet') ? { BATH003: bathProfileApplicability } : {}),
    ...(Number(kitchenMetrics.kitchen_item_count) > 0 ? { KIT004: kitchenAisleApplicability } : {}),
  };
  const ruleResults = evaluateLayoutRules({
    roomType: room.type,
    itemKinds: metricItems.map((item) => item.kind),
    metrics,
    externalData,
    ruleApplicability,
  });
  const ruleSummary = summarizeLayoutRuleResults(ruleResults);
  const coreOk = checks.every((check) => check.status !== 'fail')
    && records.length === items.length
    && ruleSummary.feasible;
  let ergonomics = emptyErgonomics();
  // Полный эргономический анализ заметно дороже осевых проверок. Запускаем
  // его только для уже целостного финалиста, но всегда до публикации/apply.
  if (coreOk && allPosedGeometryComplete) {
    ergonomics = candidateErgonomics(project, room, walls, allPosedRecords, items, opts);
    const failedFindings = ergonomics.findings.filter((finding) => finding.severity === 'error');
    checks.push({
      id: 'AUTO-ERGONOMICS',
      status: ergonomics.errorCount > 0 ? 'fail' : 'pass',
      itemIds: [...new Set(failedFindings.flatMap((finding) => finding.itemIds || []))],
      text: ergonomics.errorCount > 0
        ? `Эргономика: критических нарушений — ${ergonomics.errorCount}. ${failedFindings[0]?.text || ''}`.trim()
        : ergonomics.warningCount > 0
          ? `Критических нарушений нет; предупреждений — ${ergonomics.warningCount}`
          : 'Критических нарушений эргономики нет',
    });
  }
  return {
    ok: checks.every((c) => c.status !== 'fail') && records.length === items.length && ruleSummary.feasible,
    checks,
    route: { ...route },
    records,
    allPosedRecords,
    ergonomics,
    ruleResults,
    ruleSummary,
    unsupported: ['точная фотометрия', 'акустика', 'паспортные ограничения конкретных SKU'],
  };
}

/**
 * Строит несколько вариантов без изменения project.
 * → { status, layouts, diagnostics, coverage }.
 */
export function generateFurnitureLayouts(project, room, walls, options = {}) {
  const opts = {
    count: clamp(Math.round(options.count || 3), 1, 6),
    beamWidth: clamp(Math.round(options.beamWidth || 64), 8, 240),
    candidatesPerItem: clamp(Math.round(options.candidatesPerItem || 24), 8, 80),
    maxBasePoses: clamp(Math.round(options.maxBasePoses || 96), 32, 320),
    lockedIds: options.lockedIds || [],
  };
  const ctx = contextOf(project, room, walls, { hardDoorFront: true });
  const items = itemsForLayout(project, room, options.itemIds);
  ctx.fixedPlaced = fixedPlacedForScope(ctx, items);
  const sharedErgoContext = ergoContext(project, walls);
  const selectedIds = new Set(items.map((item) => item.id));
  const fullRoomScope = itemsInRoom(project, room).every((item) => selectedIds.has(item.id));
  const baselineErgonomics = fullRoomScope
    ? null
    : analyzeRoomErgonomics(project, room, walls, sharedErgoContext, { heat: false });
  const ergoResultCache = new Map();
  const registryCoverage = layoutRuleCoverage();
  if (!items.length) {
    return { status: 'insufficient_data', layouts: [], diagnostics: ['В комнате нет мебели'], coverage: registryCoverage };
  }
  // Конструкции и предметы, явно закреплённые пользователем, решатель не
  // двигает даже если вызывающая сторона забыла включить их в lockedIds.
  const lockedSet = new Set([
    ...opts.lockedIds,
    ...items.filter((item) => isStructural(item.kind) || item.autoLayoutLocked === true).map((item) => item.id),
  ]);
  const lockedPlaced = [];
  const diagnostics = [];
  const failures = {};
  for (const item of items.filter((x) => lockedSet.has(x.id))) {
    const record = poseRecord(item, item, 'locked');
    const failure = recordHardFailure(ctx, item, record, lockedPlaced);
    if (failure) diagnostics.push(`Закреплённый предмет «${furnitureDef(item.kind)?.title || item.kind}»: ${failure}`);
    else lockedPlaced.push({ item, record, add: 0 });
  }
  if (diagnostics.length) {
    return { status: 'insufficient_data', layouts: [], diagnostics, coverage: registryCoverage };
  }
  const movable = items.filter((x) => !lockedSet.has(x.id))
    .sort((a, b) => (rulesOf(a).priority || 9) - (rulesOf(b).priority || 9) || b.w * b.h - a.w * a.h || a.id.localeCompare(b.id));
  const allBasePoses = new Map(movable.map((item) => [item.id, basePoses(item, ctx)]));
  const profiles = opts.count === 1 ? PROFILES.slice(0, 1) : PROFILES;
  const finalists = [];
  for (const profile of profiles) {
    const states = searchProfile(ctx, movable, lockedPlaced, allBasePoses, profile, opts, failures);
    for (const state of states.slice(0, 24)) finalists.push({ state, profile });
  }
  finalists.sort((a, b) => b.state.score - a.state.score || stateKey(a.state.placed).localeCompare(stateKey(b.state.placed)));
  // Для каждого замысла перепроверяем ограниченный top-K, затем ранжируем
  // уже с фактическими soft-правилами. Так хороший зазор влияет на выбор, но
  // стоимость валидации остаётся ограниченной. До 24 нужно потому, что
  // точная эргономика может законно отсеять несколько верхних кандидатов.
  const validated = [];
  const checkedByProfile = new Map(profiles.map((profile) => [profile.id, 0]));
  for (const { state, profile } of finalists) {
    const checked = checkedByProfile.get(profile.id) || 0;
    if (checked >= 24) continue;
    checkedByProfile.set(profile.id, checked + 1);
    const records = state.placed.map((p) => p.record);
    const placements = publicPlacements(records);
    const signature = layoutSignature(placements);
    const draft = { placements };
    const validation = validateFurnitureLayout(project, room, walls, draft, {
      lockedIds: opts.lockedIds,
      itemIds: options.itemIds,
      ergoContext: sharedErgoContext,
      baselineErgonomics,
      ergoResultCache,
    });
    if (!validation.ok) {
      if (validation.ergonomics?.errorCount) {
        failures['критическая эргономика'] = (failures['критическая эргономика'] || 0) + 1;
      }
      continue;
    }
    const ruleScoreAdjustment = layoutRuleScoreAdjustment(validation.ruleResults);
    const ergonomicsScoreAdjustment = validation.ergonomics?.scoreAdjustment || 0;
    validated.push({
      id: '',
      label: profile.title,
      profile: profile.id,
      score: Math.round((state.score + ruleScoreAdjustment + ergonomicsScoreAdjustment) * 100) / 100,
      baseScore: Math.round(state.score * 100) / 100,
      ruleScoreAdjustment: Math.round(ruleScoreAdjustment * 100) / 100,
      ergonomicsScoreAdjustment: Math.round(ergonomicsScoreAdjustment * 100) / 100,
      signature,
      placements,
      metrics: metricsOf(items, records, validation.route),
      checks: validation.checks,
      ergonomics: validation.ergonomics,
      ruleResults: validation.ruleResults,
      ruleSummary: validation.ruleSummary,
      unknowns: validation.unsupported,
    });
  }
  const groups = profiles.map((profile) => validated
    .filter((entry) => entry.profile === profile.id)
    .sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature)));
  // Варианты должны отличаться не только координатами, но и замыслом. Если
  // просто взять общий top-N, шкала «Больше проходов» обычно занимает все
  // места. Обходим профили по кругу, сохраняя их внутренний порядок.
  const ordered = [];
  for (let rank = 0; groups.some((entries) => rank < entries.length); rank += 1) {
    for (const entries of groups) if (entries[rank]) ordered.push(entries[rank]);
  }
  const layouts = [];
  const seen = new Set();
  for (const layout of ordered) {
    if (seen.has(layout.signature)) continue;
    seen.add(layout.signature);
    const { signature: _signature, ...publicLayout } = layout;
    layouts.push(publicLayout);
  }
  if (!layouts.length) {
    const top = Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 3);
    diagnostics.push(...top.map(([kind, count]) => `${kind}: отклонено ${count} позиций`));
    return {
      status: 'search_budget_exhausted', layouts: [], diagnostics: diagnostics.length ? diagnostics : ['Допустимая полная расстановка не найдена'],
      coverage: registryCoverage,
    };
  }
  const selected = [];
  for (const profile of profiles) {
    const layout = layouts.find((entry) => entry.profile === profile.id && !selected.includes(entry));
    if (layout) selected.push(layout);
    if (selected.length >= opts.count) break;
  }
  for (const layout of layouts) {
    if (selected.length >= opts.count) break;
    if (!selected.includes(layout)) selected.push(layout);
  }
  selected.forEach((layout, index) => { layout.id = `auto-${layout.profile}-${index + 1}`; });
  return { status: 'feasible', layouts: selected, diagnostics, coverage: registryCoverage };
}

// Вызывающая сторона должна оборачивать применение в ui/store.mutate(),
// чтобы вариант стал одним шагом Undo/Redo.
export function applyFurnitureLayout(project, layout) {
  const byId = new Map(project.items.map((item) => [item.id, item]));
  let applied = 0;
  for (const pose of layout?.placements || []) {
    const item = byId.get(pose.itemId);
    if (!item) continue;
    item.x = pose.x;
    item.y = pose.y;
    item.rotation = pose.rotation;
    applied += 1;
  }
  return applied;
}

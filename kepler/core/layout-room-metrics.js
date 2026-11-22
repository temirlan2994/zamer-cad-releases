// Проверяемые 2D-метрики спальни и санузла.
//
// Модуль не принимает решений о pass/fail и не подменяет паспортные размеры.
// Он возвращает только те расстояния, которые можно однозначно получить из
// ортогонального контура пола и прямоугольных поз мебели. Для произвольного
// угла, отсутствующей позы или разрыва пола соответствующая метрика просто не
// публикуется — правило останется unknown.

import { itemShapes } from './clearance.js';
import { roomRects } from './room-shape.js';

const EPS = 1e-6;
const ADULT_BEDS = new Set(['bed-double', 'bed-king', 'bed-queen', 'bed-single']);
const ALL_BEDS = new Set([...ADULT_BEDS, 'bed-bunk', 'kids-bed', 'crib']);
const DOUBLE_BEDS = new Set(['bed-double', 'bed-king', 'bed-queen']);
const BATH_FRONT_FIXTURES = new Set([
  'toilet', 'bidet', 'washbasin', 'washbasin-double', 'vanity-unit',
  'bath', 'bath-corner', 'jacuzzi', 'shower', 'urinal',
]);
const UNAMBIGUOUS_FRONT_FIXTURES = new Set([
  'toilet', 'bidet', 'washbasin', 'washbasin-double', 'vanity-unit', 'urinal',
]);
const BEDSIDE_SURFACES = new Set(['nightstand', 'side-table']);

const finite = (value) => Number.isFinite(Number(value));
const round = (value) => Math.round(value * 1000) / 1000;
const add = (a, b, scale = 1) => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });

function cardinalFrame(rotation) {
  const normalized = ((Number(rotation) || 0) % 360 + 360) % 360;
  const quarter = Math.round(normalized / 90) % 4;
  if (Math.abs(normalized - quarter * 90) > EPS && Math.abs(normalized - 360) > EPS) return null;
  return [
    { right: { x: 1, y: 0 }, front: { x: 0, y: 1 } },
    { right: { x: 0, y: 1 }, front: { x: -1, y: 0 } },
    { right: { x: -1, y: 0 }, front: { x: 0, y: -1 } },
    { right: { x: 0, y: -1 }, front: { x: 1, y: 0 } },
  ][quarter];
}

function asRect(value) {
  const rect = value?.rect || value;
  if (![rect?.x, rect?.y, rect?.w, rect?.h].every(finite) || !(rect.w > 0) || !(rect.h > 0)) return null;
  return { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) };
}

function entryOf(item, record) {
  const pose = record || item;
  if (!pose || !finite(pose.x) || !finite(pose.y) || !finite(item.w) || !finite(item.h)) return null;
  const frame = cardinalFrame(pose.rotation ?? item.rotation);
  const posed = {
    ...item,
    x: Number(pose.x), y: Number(pose.y), rotation: Number(pose.rotation ?? item.rotation) || 0,
  };
  const shapes = (Array.isArray(record?.shapes) && record.shapes.length ? record.shapes : itemShapes(posed))
    .map(asRect).filter(Boolean);
  if (!shapes.length) return null;
  return { item, pose: posed, frame, shapes };
}

function crossRange(segment, direction) {
  return Math.abs(direction.x) > 0
    ? [Math.min(segment[0].y, segment[1].y), Math.max(segment[0].y, segment[1].y)]
    : [Math.min(segment[0].x, segment[1].x), Math.max(segment[0].x, segment[1].x)];
}

function crossBounds(rect, direction) {
  return Math.abs(direction.x) > 0 ? [rect.y, rect.y + rect.h] : [rect.x, rect.x + rect.w];
}

function axisBounds(rect, direction) {
  return Math.abs(direction.x) > 0 ? [rect.x, rect.x + rect.w] : [rect.y, rect.y + rect.h];
}

function sampleCrossCoordinates(segment, direction, floors, obstacles) {
  const [lo, hi] = crossRange(segment, direction);
  if (hi - lo <= EPS) return [(lo + hi) / 2];
  const cuts = [lo, hi];
  for (const rect of [...floors, ...obstacles]) {
    const [a, b] = crossBounds(rect, direction);
    if (a > lo + EPS && a < hi - EPS) cuts.push(a);
    if (b > lo + EPS && b < hi - EPS) cuts.push(b);
  }
  cuts.sort((a, b) => a - b);
  const unique = cuts.filter((value, index) => index === 0 || Math.abs(value - cuts[index - 1]) > EPS);
  return unique.slice(1).map((value, index) => (value + unique[index]) / 2);
}

function mergedFloorIntervals(floors, cross, direction) {
  const intervals = floors
    .filter((rect) => {
      const [a, b] = crossBounds(rect, direction);
      return cross > a - EPS && cross < b + EPS;
    })
    .map((rect) => axisBounds(rect, direction))
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || interval[0] > previous[1] + EPS) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function floorDistance(face, cross, direction, floors) {
  const positive = direction.x > 0 || direction.y > 0;
  const interval = mergedFloorIntervals(floors, cross, direction)
    .find(([start, end]) => face >= start - EPS && face <= end + EPS);
  if (!interval) return null;
  return Math.max(0, positive ? interval[1] - face : face - interval[0]);
}

function obstacleDistance(face, cross, direction, obstacles) {
  const positive = direction.x > 0 || direction.y > 0;
  let nearest = Infinity;
  for (const rect of obstacles) {
    const [crossStart, crossEnd] = crossBounds(rect, direction);
    if (!(cross > crossStart + EPS && cross < crossEnd - EPS)) continue;
    const [start, end] = axisBounds(rect, direction);
    if (positive) {
      if (end <= face + EPS) continue;
      nearest = Math.min(nearest, Math.max(0, start - face));
    } else {
      if (start >= face - EPS) continue;
      nearest = Math.min(nearest, Math.max(0, face - end));
    }
  }
  return nearest;
}

function distancesAlongFace(segment, direction, floors, obstacles) {
  const face = Math.abs(direction.x) > 0 ? segment[0].x : segment[0].y;
  const samples = sampleCrossCoordinates(segment, direction, floors, obstacles);
  const distances = [];
  for (const cross of samples) {
    const floor = floorDistance(face, cross, direction, floors);
    if (floor === null) return null;
    distances.push(Math.min(floor, obstacleDistance(face, cross, direction, obstacles)));
  }
  return distances;
}

function faceSegment(entry, direction, tangent, offset, tangentStart, tangentEnd) {
  const origin = add({ x: entry.pose.x, y: entry.pose.y }, direction, offset);
  return [add(origin, tangent, tangentStart), add(origin, tangent, tangentEnd)];
}

function clearance(entry, direction, tangent, offset, tangentStart, tangentEnd, floors, obstacles) {
  const distances = distancesAlongFace(
    faceSegment(entry, direction, tangent, offset, tangentStart, tangentEnd),
    direction, floors, obstacles,
  );
  return distances?.length ? Math.min(...distances) : null;
}

function supportGap(entry, floors, supportObstacles) {
  const { front, right } = entry.frame;
  const back = { x: -front.x, y: -front.y };
  const segment = faceSegment(entry, back, right, entry.item.h / 2, -entry.item.w / 2, entry.item.w / 2);
  const distances = distancesAlongFace(segment, back, floors, supportObstacles);
  return distances?.length ? Math.max(...distances) : null;
}

function segmentHitsRect(segment, rect) {
  const horizontal = Math.abs(segment[0].y - segment[1].y) <= EPS;
  if (horizontal) {
    const y = segment[0].y;
    const x0 = Math.min(segment[0].x, segment[1].x);
    const x1 = Math.max(segment[0].x, segment[1].x);
    return y >= rect.y - EPS && y <= rect.y + rect.h + EPS
      && Math.min(x1, rect.x + rect.w) - Math.max(x0, rect.x) > EPS;
  }
  const x = segment[0].x;
  const y0 = Math.min(segment[0].y, segment[1].y);
  const y1 = Math.max(segment[0].y, segment[1].y);
  return x >= rect.x - EPS && x <= rect.x + rect.w + EPS
    && Math.min(y1, rect.y + rect.h) - Math.max(y0, rect.y) > EPS;
}

function headboardSegment(entry) {
  const { front, right } = entry.frame;
  const back = { x: -front.x, y: -front.y };
  return faceSegment(entry, back, right, entry.item.h / 2, -entry.item.w / 2, entry.item.w / 2);
}

function dot(point, axis) {
  return point.x * axis.x + point.y * axis.y;
}

function localProjection(entry, bed) {
  const corners = entry.shapes.flatMap((rect) => [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]).map((point) => ({ x: point.x - bed.pose.x, y: point.y - bed.pose.y }));
  const xs = corners.map((point) => dot(point, bed.frame.right));
  const ys = corners.map((point) => dot(point, bed.frame.front));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function bedsideSlots(beds) {
  return beds.flatMap((bed, bedIndex) => [-1, 1].map((side) => ({ bed, bedIndex, side })));
}

function bedsideCandidate(surface, slot) {
  const projection = localProjection(surface, slot.bed);
  const bedHalfWidth = slot.bed.item.w / 2;
  const bedHead = -slot.bed.item.h / 2;
  // Поверхность должна находиться именно снаружи левого/правого бока и
  // пересекать головную половину кровати. Близость к изножью не считается.
  if (Math.min(projection.y1, 0) - Math.max(projection.y0, bedHead) <= EPS) return null;
  const gap = slot.side < 0
    ? -bedHalfWidth - projection.x1
    : projection.x0 - bedHalfWidth;
  if (gap < -EPS) return null;
  return { slot, gap: Math.max(0, gap) };
}

function candidatesFor(surface, slots, predicate = () => true) {
  return slots.map((slot, slotIndex) => {
    const candidate = bedsideCandidate(surface, slot);
    return candidate && predicate(candidate) ? { ...candidate, slotIndex } : null;
  }).filter(Boolean);
}

function matchEverySurface(surfaces, slots, predicate) {
  const candidates = surfaces.map((surface) => candidatesFor(surface, slots, predicate));
  if (candidates.some((entries) => !entries.length)) return null;
  const slotOwners = Array(slots.length).fill(-1);
  const chosen = Array(surfaces.length).fill(null);
  function assign(surfaceIndex, seen) {
    for (const candidate of candidates[surfaceIndex]) {
      if (seen.has(candidate.slotIndex)) continue;
      seen.add(candidate.slotIndex);
      const previous = slotOwners[candidate.slotIndex];
      if (previous >= 0 && !assign(previous, seen)) continue;
      slotOwners[candidate.slotIndex] = surfaceIndex;
      chosen[surfaceIndex] = candidate;
      return true;
    }
    return false;
  }
  for (let index = 0; index < surfaces.length; index += 1) {
    if (!assign(index, new Set())) return null;
  }
  return chosen;
}

function requiredSideCount(bed) {
  const assigned = Array.isArray(bed.item.userActorIds)
    ? new Set(bed.item.userActorIds.filter((id) => typeof id === 'string' && id.trim())).size
    : null;
  const rawOccupancy = bed.item.occupancyCount;
  const numeric = rawOccupancy === null || rawOccupancy === undefined || rawOccupancy === ''
    ? null
    : Number(rawOccupancy);
  const occupancy = Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
  const explicit = assigned === null ? occupancy
    : occupancy === null ? assigned : Math.max(assigned, occupancy);
  if (explicit === 0) return 0;
  return DOUBLE_BEDS.has(bed.item.kind) && explicit >= 2 ? 2 : 1;
}

function maximumBedsideCoverage(surfaces, slots, bedCapacities) {
  // source → surface → physical side slot → bed capacity → sink.
  const surfaceOffset = 1;
  const slotOffset = surfaceOffset + surfaces.length;
  const bedOffset = slotOffset + slots.length;
  const sink = bedOffset + bedCapacities.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const edge = (from, to, capacity) => {
    const forward = { to, capacity, reverse: graph[to].length };
    const backward = { to: from, capacity: 0, reverse: graph[from].length };
    graph[from].push(forward); graph[to].push(backward);
  };
  surfaces.forEach((surface, surfaceIndex) => {
    edge(0, surfaceOffset + surfaceIndex, 1);
    for (const candidate of candidatesFor(surface, slots, ({ gap }) => gap <= 100 + EPS)) {
      edge(surfaceOffset + surfaceIndex, slotOffset + candidate.slotIndex, 1);
    }
  });
  slots.forEach((slot, slotIndex) => {
    edge(slotOffset + slotIndex, bedOffset + slot.bedIndex, 1);
  });
  bedCapacities.forEach((capacity, bedIndex) => edge(bedOffset + bedIndex, sink, capacity));
  let flow = 0;
  while (true) {
    const parent = Array(graph.length).fill(null);
    const queue = [0];
    for (let cursor = 0; cursor < queue.length && parent[sink] == null; cursor += 1) {
      const from = queue[cursor];
      graph[from].forEach((candidate, edgeIndex) => {
        if (candidate.capacity <= 0 || candidate.to === 0 || parent[candidate.to] != null) return;
        parent[candidate.to] = { from, edgeIndex };
        queue.push(candidate.to);
      });
    }
    if (parent[sink] == null) break;
    for (let node = sink; node !== 0;) {
      const { from, edgeIndex } = parent[node];
      const selected = graph[from][edgeIndex];
      selected.capacity -= 1;
      graph[node][selected.reverse].capacity += 1;
      node = from;
    }
    flow += 1;
  }
  return flow;
}

function dimensions(value) {
  if (!value || typeof value !== 'object') return null;
  const width = Number(value.width ?? value.w);
  const depth = Number(value.depth ?? value.h);
  return width > 0 && depth > 0 ? { width, depth } : null;
}

function sleepSurfaceResult(bed) {
  const required = dimensions(bed.item.requiredSleepSurfaceMm);
  const actual = dimensions(bed.item.sleepSurfaceMm);
  const provenance = bed.item.requiredSleepSurfaceProvenance
    ?? bed.item.requiredSleepSurfaceMm?.provenance;
  if (!required || !actual || typeof provenance !== 'string' || !provenance.trim()) return null;
  return actual.width + EPS >= required.width && actual.depth + EPS >= required.depth;
}

function approachFace(entry) {
  let side = entry.item.approachSide;
  if (UNAMBIGUOUS_FRONT_FIXTURES.has(entry.item.kind)) side = 'front';
  if (!['front', 'back', 'left', 'right'].includes(side)) return null;
  const { front, right } = entry.frame;
  if (side === 'front') return { direction: front, tangent: right, offset: entry.item.h / 2, span: entry.item.w / 2 };
  if (side === 'back') return {
    direction: { x: -front.x, y: -front.y }, tangent: right, offset: entry.item.h / 2, span: entry.item.w / 2,
  };
  if (side === 'right') return { direction: right, tangent: front, offset: entry.item.w / 2, span: entry.item.h / 2 };
  return {
    direction: { x: -right.x, y: -right.y }, tangent: front, offset: entry.item.w / 2, span: entry.item.h / 2,
  };
}

function otherObstacles(entries, entry, extraObstacles) {
  return [
    ...entries.filter((candidate) => candidate !== entry).flatMap((candidate) => candidate.shapes),
    ...extraObstacles,
  ];
}

/**
 * Собрать достоверные метрики BED/BATH для готовых поз.
 *
 * records — записи валидатора ({ itemId, x, y, rotation, shapes }). Если
 * массив передан, отсутствие записи для применимого предмета делает его
 * метрики unknown. extraObstacles участвуют в зазорах; supportObstacles —
 * только реальные стены/опоры для изголовья.
 */
export function collectBedroomBathroomMetrics({
  room, items = [], records = null, extraObstacles = [], supportObstacles = [], supportVoids = [],
} = {}) {
  if (!room || !Array.isArray(items)) return {};
  const floors = roomRects(room).map(asRect).filter(Boolean);
  if (!floors.length) return {};
  const recordById = records == null ? null : new Map(records.map((record) => [record.itemId, record]));
  const entries = [];
  let incomplete = false;
  for (const item of items) {
    const record = recordById?.get(item.id);
    if (recordById && !record) { incomplete = true; continue; }
    const entry = entryOf(item, record);
    if (!entry) { incomplete = true; continue; }
    entries.push(entry);
  }
  const extras = extraObstacles.map(asRect).filter(Boolean);
  const supports = supportObstacles.map(asRect).filter(Boolean);
  const voids = supportVoids.map(asRect).filter(Boolean);
  const metrics = {};

  const beds = entries.filter((entry) => ADULT_BEDS.has(entry.item.kind) && entry.frame);
  const expectedBeds = items.filter((item) => ADULT_BEDS.has(item.kind)).length;
  const allBeds = entries.filter((entry) => ALL_BEDS.has(entry.item.kind) && entry.frame);
  const expectedAllBeds = items.filter((item) => ALL_BEDS.has(item.kind)).length;
  if (beds.length && beds.length === expectedBeds && !incomplete) {
    const sideClearances = [];
    const footClearances = [];
    const verifiedFootRouteClearances = [];
    const footRouteBedIds = new Set(beds.filter((bed) => (
      ['measured', 'declared'].includes(bed.item.routeToSecondSideDataStatus)
        && bed.item.routeToSecondSide === 'foot'
    )).map((bed) => bed.item.id));
    const headGaps = [];
    for (const bed of beds) {
      const { right, front } = bed.frame;
      const obstacles = otherObstacles(entries, bed, extras);
      const sideStart = -bed.item.h * 0.2;
      const sideEnd = bed.item.h * 0.5;
      const bedSides = [];
      for (const sign of [-1, 1]) {
        const direction = { x: right.x * sign, y: right.y * sign };
        const value = clearance(
          bed, direction, front, bed.item.w / 2, sideStart, sideEnd, floors, obstacles,
        );
        if (value === null) { bedSides.length = 0; break; }
        bedSides.push(value);
      }
      if (bedSides.length === 2) sideClearances.push(requiredSideCount(bed) >= 2
        ? Math.min(...bedSides) : Math.max(...bedSides));
      const foot = clearance(
        bed, front, right, bed.item.h / 2, -bed.item.w / 2, bed.item.w / 2, floors, obstacles,
      );
      if (foot !== null) {
        footClearances.push(foot);
        if (footRouteBedIds.has(bed.item.id)) verifiedFootRouteClearances.push(foot);
      }
      const head = supportGap(bed, floors, supports);
      if (head !== null) headGaps.push(head);
    }
    if (sideClearances.length === beds.length) metrics.bed_side_clearance_mm = round(Math.min(...sideClearances));
    if (footClearances.length === beds.length) {
      metrics.bed_foot_clearance_mm = round(Math.min(...footClearances));
    }
    if (footRouteBedIds.size > 0 && verifiedFootRouteClearances.length === footRouteBedIds.size) {
      metrics.bed_verified_foot_route_clearance_mm = round(Math.min(...verifiedFootRouteClearances));
    }
    if (headGaps.length === beds.length) {
      metrics.bed_headboard_wall_gap_mm = round(Math.max(...headGaps));
      metrics.bed_headboard_supported = headGaps.every((gap, index) => (
        gap <= 100 + EPS && !voids.some((rect) => segmentHitsRect(headboardSegment(beds[index]), rect))
      ));
    }
    const sleepSurfaceResults = beds.map(sleepSurfaceResult);
    if (sleepSurfaceResults.every((result) => result !== null)) {
      metrics.required_sleep_surface_preserved = sleepSurfaceResults.every(Boolean);
    }
  }

  const nightstands = entries.filter((entry) => entry.item.kind === 'nightstand' && entry.frame);
  const expectedNightstands = items.filter((item) => item.kind === 'nightstand').length;
  if (nightstands.length && nightstands.length === expectedNightstands
    && beds.length && beds.length === expectedBeds && !incomplete) {
    const slots = bedsideSlots(beds);
    const validMatch = matchEverySurface(
      nightstands, slots, ({ gap }) => gap >= 50 - EPS && gap <= 100 + EPS,
    );
    const geometricMatch = validMatch || matchEverySurface(nightstands, slots, () => true);
    const gaps = geometricMatch?.map((candidate) => candidate.gap) || [];
    if (gaps.length === nightstands.length) {
      metrics.bed_nightstand_min_gap_mm = round(Math.min(...gaps));
      metrics.bed_nightstand_max_gap_mm = round(Math.max(...gaps));
    }
    metrics.bed_nightstand_gaps_valid = validMatch !== null;
    // Обратная совместимость с ранним binding: единственное значение
    // публикуется только когда оно действительно описывает все тумбы.
    if (gaps.length && Math.max(...gaps) - Math.min(...gaps) <= EPS) {
      metrics.bed_nightstand_gap_mm = round(gaps[0]);
    }
  }

  const bedsideSurfaces = entries.filter((entry) => BEDSIDE_SURFACES.has(entry.item.kind) && entry.frame);
  const expectedSurfaces = items.filter((item) => BEDSIDE_SURFACES.has(item.kind)).length;
  if (allBeds.length && allBeds.length === expectedAllBeds
    && bedsideSurfaces.length === expectedSurfaces && !incomplete) {
    const capacities = allBeds.map(requiredSideCount);
    metrics.required_bedside_surface_count = capacities.reduce((sum, value) => sum + value, 0);
    metrics.bedside_surface_count = maximumBedsideCoverage(
      bedsideSurfaces, bedsideSlots(allBeds), capacities,
    );
  }

  const fixtures = entries.filter((entry) => BATH_FRONT_FIXTURES.has(entry.item.kind) && entry.frame)
    .map((entry) => ({ entry, face: approachFace(entry) }))
    .filter(({ face }) => face);
  const expectedFixtures = items.filter((item) => BATH_FRONT_FIXTURES.has(item.kind)).length;
  if (fixtures.length && fixtures.length === expectedFixtures && !incomplete) {
    const frontClearances = fixtures.map(({ entry, face }) => clearance(
      entry,
      face.direction,
      face.tangent,
      face.offset,
      -face.span,
      face.span,
      floors,
      otherObstacles(entries, entry, extras),
    ));
    if (frontClearances.every((value) => value !== null)) {
      metrics.bath_fixture_front_clearance_mm = round(Math.min(...frontClearances));
    }
  }

  const toilets = entries.filter((entry) => entry.item.kind === 'toilet' && entry.frame);
  const expectedToilets = items.filter((item) => item.kind === 'toilet').length;
  if (toilets.length && toilets.length === expectedToilets && !incomplete) {
    const sideClearances = [];
    for (const toilet of toilets) {
      const { right, front } = toilet.frame;
      const obstacles = otherObstacles(entries, toilet, extras);
      for (const sign of [-1, 1]) {
        const direction = { x: right.x * sign, y: right.y * sign };
        const value = clearance(toilet, direction, front, 0, -1, 1, floors, obstacles);
        if (value !== null) sideClearances.push(value);
      }
    }
    if (sideClearances.length === toilets.length * 2) {
      metrics.toilet_axis_side_clearance_mm = round(Math.min(...sideClearances));
    }
  }

  return metrics;
}

export const BEDROOM_BATHROOM_METRIC_IDS = Object.freeze([
  'bed_side_clearance_mm',
  'bed_foot_clearance_mm',
  'bed_verified_foot_route_clearance_mm',
  'bed_headboard_wall_gap_mm',
  'bed_headboard_supported',
  'required_sleep_surface_preserved',
  'bedside_surface_count',
  'required_bedside_surface_count',
  'bed_nightstand_min_gap_mm',
  'bed_nightstand_max_gap_mm',
  'bed_nightstand_gaps_valid',
  'bed_nightstand_gap_mm',
  'bath_fixture_front_clearance_mm',
  'toilet_axis_side_clearance_mm',
]);

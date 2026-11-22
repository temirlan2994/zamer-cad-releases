// Conceptual cut/fill analysis over the surveyed terrain.
//
// The calculation deliberately uses the source Delaunay triangles rather than
// terrainHeightFn(): the latter clamps outside the survey hull and may apply a
// visual vertical scale.  Here every volume is integrated over the measured
// part of the pad only.  Coordinates and elevations are millimetres; returned
// areas and volumes are m² and m³.

import {
  DEFAULT_EXTERIOR, isOpenRoom, isShaft,
} from './catalog.js';
import {
  area, asMulti, bbox, buffer, intersection, rectRing, transform, union,
} from './geom/poly.js';
import { sortedLevels } from './model.js';
import { roomRects } from './room-shape.js';
import { houseTerrain, terrainModel } from './terrain.js';

const MM2_PER_M2 = 1_000_000;
const MM3_PER_M3 = 1_000_000_000;
const DEFAULT_WORK_MARGIN = 1500;
const PLANE_EPS = 1e-7;

const finite = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const warning = (code, message) => ({ code, message });

function baseResult(status, reason, warnings = []) {
  return {
    schema: 'kepler-earthworks/1',
    preliminary: true,
    normative: false,
    status,
    reason,
    source: null,
    boundary: null,
    grade: null,
    coverage: { ratio: 0, coveredM2: 0, outsideSurveyM2: 0 },
    areas: {
      padM2: 0, surveyedM2: 0, outsideSurveyM2: 0, outsideSiteM2: null,
      cutM2: 0, fillM2: 0,
    },
    volumes: {
      cutM3: 0, fillM3: 0, netM3: 0, balanceM3: 0, surplusM3: 0,
    },
    extremes: { maxCutMm: 0, maxFillMm: 0 },
    patches: [],
    warnings,
  };
}
// Signed area and first moments. geom/clip canonicalises outer rings to
// positive area and holes to negative area, so the same formula handles both.
function geometryMoments(geometry) {
  let area2 = 0;
  let mx6 = 0;
  let my6 = 0;
  for (const polygon of asMulti(geometry)) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const cross = a.x * b.y - b.x * a.y;
        area2 += cross;
        mx6 += (a.x + b.x) * cross;
        my6 += (a.y + b.y) * cross;
      }
    }
  }
  return { area: area2 / 2, mx: mx6 / 6, my: my6 / 6 };
}
function planeThrough(points, key = 'z') {
  const [p, q, r] = points;
  const d = p.x * (q.y - r.y) + q.x * (r.y - p.y) + r.x * (p.y - q.y);
  if (Math.abs(d) < 1e-12) return null;
  const pz = p[key]; const qz = q[key]; const rz = r[key];
  return {
    a: (pz * (q.y - r.y) + qz * (r.y - p.y) + rz * (p.y - q.y)) / d,
    b: (pz * (r.x - q.x) + qz * (p.x - r.x) + rz * (q.x - p.x)) / d,
    c: (pz * (q.x * r.y - r.x * q.y)
      + qz * (r.x * p.y - p.x * r.y)
      + rz * (p.x * q.y - q.x * p.y)) / d,
  };
}

const planeValue = (plane, point) => plane.a * point.x + plane.b * point.y + plane.c;
const planeIntegral = (plane, moments) => plane.a * moments.mx + plane.b * moments.my + plane.c * moments.area;

function lowestFootprint(project, marginMm) {
  const exteriorRaw = finite(project?.settings?.exterior);
  const exterior = Math.max(0, exteriorRaw == null ? DEFAULT_EXTERIOR : exteriorRaw);
  let level = null;
  let local = [];
  for (const candidate of sortedLevels(project || { levels: [] })) {
    const rooms = (candidate.rooms || []).filter((room) => (
      !room.parentId && !isOpenRoom(room) && !isShaft(room)
    ));
    const rings = rooms.flatMap((room) => roomRects(room)
      .filter((rect) => rect.w > 0.5 && rect.h > 0.5)
      .map((rect) => rectRing(rect.x, rect.y, rect.w, rect.h)));
    if (!rings.length) continue;
    level = candidate;
    local = union(...rings);
    break;
  }
  if (!level || !local.length) return null;
  if (exterior > 0) local = buffer(local, exterior);
  if (marginMm > 0) local = buffer(local, marginMm);
  const building = project.building || {};
  const world = union(transform(local, {
    x: finite(building.origin?.x) ?? 0,
    y: finite(building.origin?.y) ?? 0,
    rotation: finite(building.rotation) ?? 0,
  }));
  return { levelId: level.id, geometry: world, exteriorMm: exterior };
}

function makeTerrainTiles(model, boundary) {
  const boundaryBox = bbox(boundary);
  const candidates = model.tris.map((indices) => {
    const points = indices.map((index) => model.pts[index]);
    return {
      points,
      cx: points.reduce((sum, point) => sum + point.x, 0) / 3,
      cy: points.reduce((sum, point) => sum + point.y, 0) / 3,
      x0: Math.min(...points.map((point) => point.x)),
      x1: Math.max(...points.map((point) => point.x)),
      y0: Math.min(...points.map((point) => point.y)),
      y1: Math.max(...points.map((point) => point.y)),
    };
  }).filter((tile) => tile.x0 <= boundaryBox.x1 && boundaryBox.x0 <= tile.x1
    && tile.y0 <= boundaryBox.y1 && boundaryBox.y0 <= tile.y1)
    .sort((a, b) => a.cx - b.cx || a.cy - b.cy
    || a.points[0].x - b.points[0].x || a.points[0].y - b.points[0].y);

  const tiles = [];
  for (const candidate of candidates) {
    const geometry = intersection(boundary, candidate.points);
    const moments = geometryMoments(geometry);
    if (!(moments.area > 0.01)) continue;
    const terrainPlane = planeThrough(candidate.points);
    if (!terrainPlane) continue;
    tiles.push({ ...candidate, geometry, moments, terrainPlane });
  }
  return tiles;
}

function clipTriangle(points, plane, positive) {
  const vertices = points.map((point) => ({ ...point, d: planeValue(plane, point) }));
  const inside = (point) => (positive ? point.d >= -PLANE_EPS : point.d <= PLANE_EPS);
  const out = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const ai = inside(a); const bi = inside(b);
    if (ai) out.push({ x: a.x, y: a.y });
    if (ai === bi) continue;
    const t = a.d / (a.d - b.d);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  const clean = [];
  for (const point of out) {
    const previous = clean[clean.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-7) clean.push(point);
  }
  if (clean.length > 1 && Math.hypot(clean[0].x - clean.at(-1).x, clean[0].y - clean.at(-1).y) <= 1e-7) clean.pop();
  return clean.length >= 3 ? clean : [];
}

function signedGeometry(tile, difference, positive) {
  const values = tile.points.map((point) => planeValue(difference, point));
  if (values.every((value) => Math.abs(value) <= PLANE_EPS)) return [];
  if (positive && values.every((value) => value >= -PLANE_EPS)) return tile.geometry;
  if (!positive && values.every((value) => value <= PLANE_EPS)) return tile.geometry;
  if (positive && values.every((value) => value <= PLANE_EPS)) return [];
  if (!positive && values.every((value) => value >= -PLANE_EPS)) return [];
  const clipped = clipTriangle(tile.points, difference, positive);
  return clipped.length ? intersection(tile.geometry, clipped) : [];
}

function patchRecords(geometry, difference, kind, tileIndex, firstIndex) {
  const records = [];
  let index = firstIndex;
  for (const polygon of asMulti(geometry)) {
    const moments = geometryMoments([polygon]);
    if (!(moments.area > 0.01)) continue;
    const signedVolume = planeIntegral(difference, moments);
    const volumeMm3 = kind === 'fill' ? Math.max(0, signedVolume) : Math.max(0, -signedVolume);
    let maxDepthMm = 0;
    let minDepthMm = Infinity;
    for (const ring of polygon) {
      for (const point of ring) {
        const raw = planeValue(difference, point);
        const depth = kind === 'fill' ? Math.max(0, raw) : Math.max(0, -raw);
        maxDepthMm = Math.max(maxDepthMm, depth);
        minDepthMm = Math.min(minDepthMm, depth);
      }
    }
    records.push({
      id: `${kind}:${tileIndex}:${index}`,
      kind,
      polygonWorld: polygon,
      areaM2: moments.area / MM2_PER_M2,
      volumeM3: volumeMm3 / MM3_PER_M3,
      averageDepthMm: volumeMm3 / moments.area,
      minDepthMm: Number.isFinite(minDepthMm) ? minDepthMm : 0,
      maxDepthMm,
    });
    index += 1;
  }
  return records;
}

function gradeOptions(project, model, boundaryMoments, terrainIntegral, opts) {
  const input = opts.grade && typeof opts.grade === 'object' ? opts.grade : {};
  const mode = input.mode ?? 'balanced';
  if (!['balanced', 'absolute', 'relative'].includes(mode)) {
    return { error: warning('invalid_grade_mode', `Unknown grade mode: ${String(mode)}`) };
  }
  for (const key of ['slopeX', 'slopeY']) {
    if (input[key] != null && finite(input[key]) == null) {
      return { error: warning('invalid_grade_slope', `${key} must be a finite ratio`) };
    }
  }
  const slopeX = finite(input.slopeX) ?? 0;
  const slopeY = finite(input.slopeY) ?? 0;
  const anchor = {
    x: boundaryMoments.mx / boundaryMoments.area,
    y: boundaryMoments.my / boundaryMoments.area,
  };
  let absoluteZ;
  let floorZ = null;
  let targetNetM3 = null;

  if (mode === 'balanced') {
    if (input.targetNetM3 != null && finite(input.targetNetM3) == null) {
      return { error: warning('invalid_grade_target', 'targetNetM3 must be finite') };
    }
    targetNetM3 = finite(input.targetNetM3) ?? 0;
    const slopeIntegral = slopeX * (boundaryMoments.mx - anchor.x * boundaryMoments.area)
      + slopeY * (boundaryMoments.my - anchor.y * boundaryMoments.area);
    absoluteZ = ((targetNetM3 * MM3_PER_M3) + terrainIntegral - slopeIntegral) / boundaryMoments.area;
  } else {
    const z = finite(input.zMm);
    if (z == null) return { error: warning('missing_grade_z', 'grade.zMm is required') };
    if (mode === 'absolute') absoluteZ = z;
    else {
      const hasDatum = finite(project.envelope?.zeroAboveGround) != null
        || finite(project.site?.terrain?.floorZ) != null;
      const house = hasDatum ? houseTerrain(project, model) : null;
      floorZ = finite(house?.floorZ ?? project.site?.terrain?.floorZ);
      if (floorZ == null) return { error: warning('missing_datum', 'Relative grade needs project ±0.000') };
      absoluteZ = floorZ + z;
    }
  }
  if (floorZ == null) {
    const hasDatum = finite(project.envelope?.zeroAboveGround) != null
      || finite(project.site?.terrain?.floorZ) != null;
    if (hasDatum) floorZ = finite(houseTerrain(project, model)?.floorZ ?? project.site?.terrain?.floorZ);
  }
  return {
    mode, absoluteZ, relativeZ: floorZ == null ? null : absoluteZ - floorZ,
    anchor, slopeX, slopeY, targetNetM3,
    plane: {
      a: slopeX,
      b: slopeY,
      c: absoluteZ - slopeX * anchor.x - slopeY * anchor.y,
    },
  };
}

/**
 * Exact conceptual cut/fill analysis over the surveyed part of a building pad.
 *
 * opts.boundary: 'foundation' (default) | 'work-pad'.  The latter defaults to
 * a 1500 mm working margin. opts.marginMm overrides either default.
 * opts.grade:
 *   { mode:'balanced', targetNetM3?:0, slopeX?:0, slopeY?:0 }
 *   { mode:'absolute', zMm, slopeX?:0, slopeY?:0 }
 *   { mode:'relative', zMm, slopeX?:0, slopeY?:0 } // from finished floor
 *
 * Sign convention: d = design - existing; fill=max(d,0), cut=max(-d,0),
 * netM3 = fillM3 - cutM3 (positive means imported material).
 */
export function analyzeEarthworks(project, opts = {}) {
  const scope = opts.boundary ?? 'foundation';
  if (!['foundation', 'work-pad'].includes(scope)) {
    return baseResult('unknown', 'invalid_boundary', [warning('invalid_boundary', `Unknown boundary: ${String(scope)}`)]);
  }
  if (opts.marginMm != null && (finite(opts.marginMm) == null || finite(opts.marginMm) < 0)) {
    return baseResult('unknown', 'invalid_margin', [warning('invalid_margin', 'marginMm must be non-negative')]);
  }
  const marginMm = finite(opts.marginMm) ?? (scope === 'work-pad' ? DEFAULT_WORK_MARGIN : 0);
  const footprint = lowestFootprint(project, marginMm);
  if (!footprint) {
    return baseResult('unknown', 'no_footprint', [warning('no_footprint', 'No occupied ground-floor footprint')]);
  }
  const padAreaMm2 = area(footprint.geometry);
  if (!(padAreaMm2 > 0)) {
    return baseResult('unknown', 'no_footprint', [warning('no_footprint', 'Building footprint has no area')]);
  }

  const terrain = project?.site?.terrain;
  const model = terrainModel(terrain);
  if (!model?.tris?.length) {
    const result = baseResult('unknown', 'no_terrain', [warning('no_terrain', model?.error || 'At least three non-collinear terrain points are required')]);
    result.source = {
      terrain: 'missing', pointCount: model?.pts?.length || 0, triangleCount: 0,
      error: model?.error || null, clamped: false,
    };
    result.boundary = {
      kind: scope, levelId: footprint.levelId, marginMm, exteriorMm: footprint.exteriorMm,
      areaM2: padAreaMm2 / MM2_PER_M2, geometryWorld: footprint.geometry,
    };
    result.areas.padM2 = padAreaMm2 / MM2_PER_M2;
    return result;
  }

  const tiles = makeTerrainTiles(model, footprint.geometry);
  if (!tiles.length) {
    const result = baseResult('unknown', 'outside_survey', [warning('outside_survey', 'The pad is outside the surveyed terrain hull')]);
    result.source = {
      terrain: 'survey', pointCount: model.pts.length, triangleCount: model.tris.length,
      error: model.error, duplicates: model.duplicates, clamped: false,
    };
    result.boundary = {
      kind: scope, levelId: footprint.levelId, marginMm, exteriorMm: footprint.exteriorMm,
      areaM2: padAreaMm2 / MM2_PER_M2, geometryWorld: footprint.geometry,
    };
    result.coverage.outsideSurveyM2 = padAreaMm2 / MM2_PER_M2;
    result.areas.padM2 = padAreaMm2 / MM2_PER_M2;
    result.areas.outsideSurveyM2 = padAreaMm2 / MM2_PER_M2;
    return result;
  }

  const covered = tiles.reduce((sum, tile) => ({
    area: sum.area + tile.moments.area,
    mx: sum.mx + tile.moments.mx,
    my: sum.my + tile.moments.my,
  }), { area: 0, mx: 0, my: 0 });
  const terrainIntegral = tiles.reduce((sum, tile) => sum + planeIntegral(tile.terrainPlane, tile.moments), 0);
  if (!(covered.area > 0)) {
    return baseResult('unknown', 'outside_survey', [warning('outside_survey', 'The pad is outside the surveyed terrain hull')]);
  }

  const grade = gradeOptions(project, model, covered, terrainIntegral, opts);
  if (grade.error) {
    const result = baseResult('unknown', grade.error.code, [grade.error]);
    result.source = {
      terrain: 'survey', pointCount: model.pts.length, triangleCount: model.tris.length,
      error: model.error, duplicates: model.duplicates, clamped: false,
    };
    return result;
  }

  const patches = [];
  let cutAreaMm2 = 0; let fillAreaMm2 = 0;
  let cutMm3 = 0; let fillMm3 = 0;
  let maxCutMm = 0; let maxFillMm = 0;
  tiles.forEach((tile, tileIndex) => {
    const difference = {
      a: grade.plane.a - tile.terrainPlane.a,
      b: grade.plane.b - tile.terrainPlane.b,
      c: grade.plane.c - tile.terrainPlane.c,
    };
    for (const kind of ['fill', 'cut']) {
      const geometry = signedGeometry(tile, difference, kind === 'fill');
      const records = patchRecords(geometry, difference, kind, tileIndex, patches.length);
      for (const patch of records) {
        patches.push(patch);
        if (kind === 'fill') {
          fillAreaMm2 += patch.areaM2 * MM2_PER_M2;
          fillMm3 += patch.volumeM3 * MM3_PER_M3;
          maxFillMm = Math.max(maxFillMm, patch.maxDepthMm);
        } else {
          cutAreaMm2 += patch.areaM2 * MM2_PER_M2;
          cutMm3 += patch.volumeM3 * MM3_PER_M3;
          maxCutMm = Math.max(maxCutMm, patch.maxDepthMm);
        }
      }
    }
  });

  const outsideSurveyMm2 = Math.max(0, padAreaMm2 - covered.area);
  const coverageTolerance = Math.max(1, padAreaMm2 * 1e-9);
  const partial = outsideSurveyMm2 > coverageTolerance;
  const warnings = [];
  if (partial) warnings.push(warning('partial_survey', 'Part of the pad is outside the surveyed terrain hull; volumes cover measured terrain only'));
  if (model.duplicates) warnings.push(warning('duplicate_terrain_points', `${model.duplicates} duplicate terrain point(s) were ignored`));

  let outsideSiteM2 = null;
  if (Array.isArray(project.site?.boundary) && project.site.boundary.length >= 3) {
    const siteGeometry = union(project.site.boundary);
    const insideSite = area(intersection(footprint.geometry, siteGeometry));
    outsideSiteM2 = Math.max(0, padAreaMm2 - insideSite) / MM2_PER_M2;
    if (outsideSiteM2 > 1e-6) warnings.push(warning('outside_site', 'Part of the earthworks pad is outside the site boundary'));
  }

  const cutM3 = cutMm3 / MM3_PER_M3;
  const fillM3 = fillMm3 / MM3_PER_M3;
  const netM3 = fillM3 - cutM3;
  return {
    schema: 'kepler-earthworks/1',
    preliminary: true,
    normative: false,
    status: partial ? 'partial' : 'candidate',
    reason: partial ? 'partial_survey' : null,
    source: {
      terrain: 'survey', pointCount: model.pts.length, triangleCount: model.tris.length,
      error: model.error, duplicates: model.duplicates, clamped: false,
    },
    boundary: {
      kind: scope, levelId: footprint.levelId, marginMm, exteriorMm: footprint.exteriorMm,
      areaM2: padAreaMm2 / MM2_PER_M2, geometryWorld: footprint.geometry,
    },
    grade: {
      mode: grade.mode,
      absoluteZMm: grade.absoluteZ,
      relativeZMm: grade.relativeZ,
      anchorWorld: grade.anchor,
      slopeX: grade.slopeX,
      slopeY: grade.slopeY,
      targetNetM3: grade.targetNetM3,
    },
    coverage: {
      ratio: Math.min(1, covered.area / padAreaMm2),
      coveredM2: covered.area / MM2_PER_M2,
      outsideSurveyM2: outsideSurveyMm2 / MM2_PER_M2,
    },
    areas: {
      padM2: padAreaMm2 / MM2_PER_M2,
      surveyedM2: covered.area / MM2_PER_M2,
      outsideSurveyM2: outsideSurveyMm2 / MM2_PER_M2,
      outsideSiteM2,
      cutM2: cutAreaMm2 / MM2_PER_M2,
      fillM2: fillAreaMm2 / MM2_PER_M2,
    },
    volumes: {
      cutM3, fillM3, netM3, balanceM3: netM3, surplusM3: -netM3,
    },
    extremes: { maxCutMm, maxFillMm },
    patches,
    warnings,
  };
}

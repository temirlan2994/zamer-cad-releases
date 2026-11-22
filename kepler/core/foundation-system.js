// Производная концептуальная система фундамента.
//
// Модуль ничего не записывает в проект: он превращает пятно нижнего занятого
// этажа, отметку земли и тип основания в семантические компоненты. Геометрия
// компонентов уже пригодна для 3D/разрезов/экспорта:
//   shape: 'grid'  — объединение ортогональных прямоугольников;
//   shape: 'prism' — призма по произвольному контуру (косые ленты и сваи).
// Все отметки и размеры — миллиметры относительно проектного ±0.000.

import { isOpenRoom, isShaft } from './catalog.js';
import { toWorld } from './building.js';
import { envelopeOf, resolvedZeroAboveGround } from './envelope.js';
import { levelProject, sortedLevels } from './model.js';
import { roomRects } from './room-shape.js';
import { houseTerrain, interpolateZ, terrainModel } from './terrain.js';
import { deriveWalls } from './walls.js';

export const FOUNDATION_TYPES = Object.freeze(['slab', 'strip', 'piles', 'basement']);

export const FOUNDATION_DEFAULTS = Object.freeze({
  slabThickness: 300,
  stripWidth: 600,
  stripHeight: 600,
  pileDiameter: 300,
  pileLength: 2500,
  pileSpacing: 2500,
  grillageWidth: 500,
  grillageHeight: 500,
  basementSlabThickness: 300,
  retainingWallThickness: 300,
});

const TYPES = new Set(FOUNDATION_TYPES);
const EPS = 0.5;

const finite = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const bounded = (value, min, max, fallback) => {
  const n = finite(value);
  return n == null ? fallback : Math.min(max, Math.max(min, Math.round(n)));
};

const warning = (code, message) => ({ code, message });

function foundationType(value) {
  const aliases = { raft: 'slab', ribbon: 'strip', pile: 'piles', 'pile-grillage': 'piles' };
  const type = aliases[value] || value;
  return TYPES.has(type) ? type : 'slab';
}

function foundationOptions(project) {
  const normalized = envelopeOf(project).foundation;
  const raw = project?.envelope?.foundation && typeof project.envelope.foundation === 'object'
    ? project.envelope.foundation : {};
  const strip = raw.strip && typeof raw.strip === 'object' ? raw.strip : {};
  const piles = raw.piles && typeof raw.piles === 'object' ? raw.piles : {};
  const basement = raw.basement && typeof raw.basement === 'object' ? raw.basement : {};
  const slab = raw.slab && typeof raw.slab === 'object' ? raw.slab : {};
  return {
    enabled: normalized.enabled,
    sizingMode: normalized.sizingMode,
    depth: normalized.depth,
    requestedType: raw.type,
    type: foundationType(raw.type),
    slabThickness: bounded(raw.slabThickness ?? slab.thickness, 100, 2000, FOUNDATION_DEFAULTS.slabThickness),
    stripWidth: bounded(raw.stripWidth ?? strip.width, 200, 3000, FOUNDATION_DEFAULTS.stripWidth),
    stripHeight: bounded(raw.stripHeight ?? strip.height, 200, 3000, FOUNDATION_DEFAULTS.stripHeight),
    pileDiameter: bounded(raw.pileDiameter ?? piles.diameter, 150, 1500, FOUNDATION_DEFAULTS.pileDiameter),
    pileLength: bounded(raw.pileLength ?? piles.length, 500, 30000, FOUNDATION_DEFAULTS.pileLength),
    pileSpacing: bounded(raw.pileSpacing ?? piles.spacing, 600, 6000, FOUNDATION_DEFAULTS.pileSpacing),
    grillageWidth: bounded(raw.grillageWidth ?? piles.grillageWidth, 200, 3000, FOUNDATION_DEFAULTS.grillageWidth),
    grillageHeight: bounded(raw.grillageHeight ?? piles.grillageHeight, 200, 3000, FOUNDATION_DEFAULTS.grillageHeight),
    basementSlabThickness: bounded(
      raw.basementSlabThickness ?? basement.slabThickness,
      100, 2000, FOUNDATION_DEFAULTS.basementSlabThickness,
    ),
    retainingWallThickness: bounded(
      raw.retainingWallThickness ?? basement.wallThickness,
      150, 1500, FOUNDATION_DEFAULTS.retainingWallThickness,
    ),
  };
}

function occupiedLevel(project) {
  for (const level of sortedLevels(project)) {
    const lp = levelProject(project, level.id);
    if (levelFootprint(lp, project.settings?.exterior || 250).length) return { level, lp };
  }
  return null;
}

function levelFootprint(lp, offset) {
  return lp.rooms.filter((room) => !room.parentId && !isOpenRoom(room) && !isShaft(room))
    .flatMap(roomRects)
    .map((rect) => ({
      x0: rect.x - offset, y0: rect.y - offset,
      x1: rect.x + rect.w + offset, y1: rect.y + rect.h + offset,
    }));
}

const snapTenth = (value) => Math.round(value * 10) / 10;
const uniqueSorted = (values) => [...new Set(values.map(snapTenth))].sort((a, b) => a - b);

// Совместимый со slabFaces() формат сжатой сетки. Объединение не оставляет
// внутренних швов между соседними помещениями/лентами.
export function foundationGrid(rects) {
  const list = (rects || []).filter((rect) => rect && rect.x1 - rect.x0 > EPS && rect.y1 - rect.y0 > EPS);
  const xs = uniqueSorted(list.flatMap((rect) => [rect.x0, rect.x1]));
  const ys = uniqueSorted(list.flatMap((rect) => [rect.y0, rect.y1]));
  const nx = Math.max(0, xs.length - 1);
  const ny = Math.max(0, ys.length - 1);
  const mask = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const y = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i += 1) {
      if (xs[i + 1] - xs[i] < EPS || ys[j + 1] - ys[j] < EPS) continue;
      const x = (xs[i] + xs[i + 1]) / 2;
      if (list.some((rect) => x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1)) mask[j * nx + i] = 1;
    }
  }
  return { xs, ys, nx, ny, mask };
}

const gridHasArea = (grid) => grid.mask.some(Boolean);

function samplePoints(rects) {
  return rects.flatMap((rect) => [
    { x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 },
    { x: rect.x1, y: rect.y1 }, { x: rect.x0, y: rect.y1 },
    { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 },
  ]);
}

function relativeTerrain(project, model, house, zero) {
  if (!model?.tris?.length) return () => -zero;
  const avg = model.pts.reduce((sum, point) => sum + point.z, 0) / model.pts.length;
  const explicit = project.envelope?.zeroAboveGround != null;
  const reference = house?.groundReferenceZ ?? avg;
  const floorZ = house?.floorZ
    ?? (Number.isFinite(project.site?.terrain?.floorZ) ? project.site.terrain.floorZ : reference + zero);
  return (x, y) => {
    const world = toWorld(project.building, { x, y });
    const z = interpolateZ(model, world.x, world.y, { clamp: true }) ?? floorZ;
    return explicit ? z - reference - zero : z - floorZ;
  };
}

function foundationDatum(project, footprint, top, depth) {
  const model = terrainModel(project.site?.terrain);
  const house = model?.tris?.length ? houseTerrain(project, model) : null;
  const zero = resolvedZeroAboveGround(project, house);
  if (zero == null) return null;
  const referenceGrade = -zero;
  const at = relativeTerrain(project, model, house, zero);
  const ground = samplePoints(footprint).map((point) => at(point.x, point.y)).filter(Number.isFinite);
  const sampledGround = ground.length ? Math.min(...ground) : referenceGrade;
  const sampledGroundMax = ground.length ? Math.max(...ground) : referenceGrade;
  const grade = Math.min(referenceGrade, sampledGround);
  const base = Math.min(top, grade) - depth;
  return {
    zeroAboveGround: zero,
    referenceGrade,
    sampledGround,
    sampledGroundMax,
    grade,
    top,
    base,
    terrainOutside: Boolean(house?.outside),
  };
}

function gridComponent(id, kind, rects, z0, z1, extra = {}) {
  const grid = foundationGrid(rects);
  if (z1 - z0 <= EPS || !gridHasArea(grid)) return null;
  return {
    id, kind, role: kind === 'plinth' ? 'plinth' : 'foundation',
    shape: 'grid', rects: rects.map((rect) => ({ ...rect })), grid, z0, z1,
    material: 'concrete', renderKind: kind === 'plinth' ? 'plinth' : 'foundation',
    ...extra,
  };
}

function prismComponent(id, kind, points, z0, z1, extra = {}) {
  if (z1 - z0 <= EPS || !Array.isArray(points) || points.length < 3) return null;
  return {
    id, kind, role: kind === 'plinth' ? 'plinth' : 'foundation',
    shape: 'prism', points: points.map((point) => ({ x: point.x, y: point.y })), z0, z1,
    material: 'concrete', renderKind: kind === 'plinth' ? 'plinth' : 'foundation',
    ...extra,
  };
}

function wallCenterSegment(wall) {
  const center = wall.center;
  if (center && [center.x1, center.y1, center.x2, center.y2].every((value) => finite(value) != null)) {
    return { a: { x: center.x1, y: center.y1 }, b: { x: center.x2, y: center.y2 } };
  }
  const band = wall.band;
  if (!band) return null;
  if (wall.orient === 'h') {
    const y = band.y + band.h / 2;
    return { a: { x: band.x, y }, b: { x: band.x + band.w, y } };
  }
  if (wall.orient === 'v') {
    const x = band.x + band.w / 2;
    return { a: { x, y: band.y }, b: { x, y: band.y + band.h } };
  }
  return null;
}

const pointKey = (point) => `${Math.round(point.x * 2)}|${Math.round(point.y * 2)}`;

function canonicalSegment(segment) {
  const aKey = pointKey(segment.a);
  const bKey = pointKey(segment.b);
  return aKey <= bKey ? segment : { ...segment, a: segment.b, b: segment.a };
}

function bearingSegments(lp, wallTypes = new Set(['exterior', 'bearing'])) {
  const seen = new Set();
  const out = [];
  for (const wall of deriveWalls(lp)) {
    if (wall.hidden || !wallTypes.has(wall.wallType)) continue;
    const raw = wallCenterSegment(wall);
    if (!raw || Math.hypot(raw.b.x - raw.a.x, raw.b.y - raw.a.y) <= EPS) continue;
    const segment = canonicalSegment({ ...raw, wallKey: wall.key, wallType: wall.wallType });
    const key = `${pointKey(segment.a)}>${pointKey(segment.b)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(segment);
  }
  return out.sort((left, right) => {
    const a = `${pointKey(left.a)}>${pointKey(left.b)}`;
    const b = `${pointKey(right.a)}>${pointKey(right.b)}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function bandForSegment(segment, width) {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const h = width / 2;
  const a = { x: segment.a.x - ux * h, y: segment.a.y - uy * h };
  const b = { x: segment.b.x + ux * h, y: segment.b.y + uy * h };
  if (Math.abs(dy) <= 0.01) {
    return { rect: { x0: Math.min(a.x, b.x), y0: a.y - h, x1: Math.max(a.x, b.x), y1: a.y + h } };
  }
  if (Math.abs(dx) <= 0.01) {
    return { rect: { x0: a.x - h, y0: Math.min(a.y, b.y), x1: a.x + h, y1: Math.max(a.y, b.y) } };
  }
  return {
    points: [
      { x: a.x + nx * h, y: a.y + ny * h }, { x: b.x + nx * h, y: b.y + ny * h },
      { x: b.x - nx * h, y: b.y - ny * h }, { x: a.x - nx * h, y: a.y - ny * h },
    ],
  };
}

function stripGeometry(lp, width, wallTypes) {
  const segments = bearingSegments(lp, wallTypes);
  const rects = [];
  const prisms = [];
  for (const segment of segments) {
    const band = bandForSegment(segment, width);
    if (band.rect) rects.push(band.rect);
    else prisms.push({ points: band.points, wallKey: segment.wallKey });
  }
  return { segments, rects, prisms };
}

function addStripComponents(components, prefix, kind, geometry, z0, z1, extra = {}) {
  const keys = geometry.segments.map((segment) => segment.wallKey).filter(Boolean);
  const grid = gridComponent(`${prefix}:grid`, kind, geometry.rects, z0, z1, { sourceWallKeys: keys, ...extra });
  if (grid) components.push(grid);
  geometry.prisms.forEach((prism, index) => {
    const component = prismComponent(`${prefix}:prism:${index}`, kind, prism.points, z0, z1, {
      sourceWallKeys: prism.wallKey ? [prism.wallKey] : [], ...extra,
    });
    if (component) components.push(component);
  });
}

function segmentIntersection(left, right) {
  const ax = left.a.x; const ay = left.a.y;
  const bx = left.b.x; const by = left.b.y;
  const cx = right.a.x; const cy = right.a.y;
  const dx = right.b.x; const dy = right.b.y;
  const rx = bx - ax; const ry = by - ay;
  const sx = dx - cx; const sy = dy - cy;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-9) return null;
  const qx = cx - ax; const qy = cy - ay;
  const t = (qx * sy - qy * sx) / cross;
  const u = (qx * ry - qy * rx) / cross;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: ax + rx * t, y: ay + ry * t };
}

function pileCenters(segments, spacing) {
  const points = [];
  for (const segment of segments) {
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    const intervals = Math.max(1, Math.ceil(length / spacing));
    for (let i = 0; i <= intervals; i += 1) {
      const t = i / intervals;
      points.push({
        x: segment.a.x + (segment.b.x - segment.a.x) * t,
        y: segment.a.y + (segment.b.y - segment.a.y) * t,
      });
    }
  }
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const point = segmentIntersection(segments[i], segments[j]);
      if (point) points.push(point);
    }
  }
  const unique = new Map();
  for (const point of points) {
    const snapped = { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 };
    unique.set(pointKey(snapped), snapped);
  }
  return [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
}

function circle(center, diameter, sides = 12) {
  const radius = diameter / 2;
  return Array.from({ length: sides }, (_value, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

function addPlinth(components, footprint, strip, datum, prefix, bottom = datum.referenceGrade) {
  if (datum.top - bottom <= EPS) return;
  if (strip) addStripComponents(components, `${prefix}:plinth`, 'plinth', strip, bottom, datum.top);
  else {
    const component = gridComponent(`${prefix}:plinth`, 'plinth', footprint, bottom, datum.top);
    if (component) components.push(component);
  }
}

// До появления отдельных размеров основание строилось сплошным от отметки
// заглубления до опорной земли. Значения по умолчанию сохраняют этот вид у
// уже созданных проектов. Как только пользователь меняет толщину/высоту,
// `depth` задаёт низ тела, а размер — его настоящую высоту; оставшийся подъём
// до ±0.000 становится цоколем. Так оба поля имеют независимый и видимый
// геометрический смысл без разрыва в основании.
function sizedBodyTop(datum, size, sizingMode) {
  if (sizingMode === 'legacy-depth') return Math.min(datum.top, datum.referenceGrade);
  return Math.min(datum.top, datum.base + size);
}

function deriveSlab(components, footprint, datum, options, extra = {}) {
  const top = sizedBodyTop(datum, options.slabThickness, options.sizingMode);
  const component = gridComponent('foundation:slab', 'slab', footprint, datum.base, top, {
    thickness: top - datum.base, nominalThickness: options.slabThickness,
    verticalSizing: options.sizingMode,
    ...extra,
  });
  if (component) components.push(component);
  addPlinth(components, footprint, null, datum, 'foundation:slab', top);
}

function deriveStrip(components, lp, datum, options, warnings) {
  const geometry = stripGeometry(lp, options.stripWidth, new Set(['exterior', 'bearing']));
  if (!geometry.segments.length) {
    warnings.push(warning('bearing-layout-missing', 'Не найдены наружные или несущие стены; показано плитное основание.'));
    return false;
  }
  const top = sizedBodyTop(datum, options.stripHeight, options.sizingMode);
  addStripComponents(components, 'foundation:strip', 'strip', geometry, datum.base, top, {
    width: options.stripWidth, nominalHeight: options.stripHeight,
    verticalSizing: options.sizingMode,
  });
  addPlinth(components, null, geometry, datum, 'foundation:strip', top);
  if (geometry.prisms.length) warnings.push(warning(
    'angled-strip-joints-conceptual',
    'Узлы ленты под косыми стенами показаны концептуально и требуют проверки конструктора.',
  ));
  return true;
}

function derivePiles(components, lp, datum, options, warnings) {
  const geometry = stripGeometry(lp, options.grillageWidth, new Set(['exterior', 'bearing']));
  if (!geometry.segments.length) {
    warnings.push(warning('bearing-layout-missing', 'Не найдены наружные или несущие стены; свайное поле не построено.'));
    return false;
  }
  const grillageTop = Math.min(datum.top, datum.referenceGrade);
  // depth остаётся минимальным заглублением ростверка для совместимости с
  // существующей посадкой; grillageHeight может только увеличить его.
  const grillageBottom = Math.min(datum.base, grillageTop - options.grillageHeight);
  addStripComponents(components, 'foundation:grillage', 'grillage', geometry, grillageBottom, grillageTop, {
    width: options.grillageWidth, nominalHeight: options.grillageHeight,
  });
  const centers = pileCenters(geometry.segments, options.pileSpacing);
  centers.forEach((center, index) => {
    const component = prismComponent(
      `foundation:pile:${index}`, 'pile', circle(center, options.pileDiameter),
      grillageBottom - options.pileLength, grillageBottom,
      { center, diameter: options.pileDiameter, length: options.pileLength },
    );
    if (component) components.push(component);
  });
  addPlinth(components, null, geometry, datum, 'foundation:piles');
  if (geometry.prisms.length) warnings.push(warning(
    'angled-grillage-joints-conceptual',
    'Узлы ростверка под косыми стенами показаны концептуально и требуют проверки конструктора.',
  ));
  return true;
}

function deriveBasement(components, footprint, level, lp, datum, options, warnings) {
  if (!(level.elevation < -EPS)) {
    warnings.push(warning(
      'basement-level-missing',
      'Для подвала нужен занятый этаж с отрицательной отметкой; показано совместимое плитное основание.',
    ));
    deriveSlab(components, footprint, datum, options, { fallbackFor: 'basement' });
    return false;
  }
  const slab = gridComponent(
    'foundation:basement-slab', 'basement-slab', footprint,
    datum.top - options.basementSlabThickness, datum.top,
    { thickness: options.basementSlabThickness },
  );
  if (slab) components.push(slab);
  const shell = stripGeometry(lp, options.retainingWallThickness, new Set(['exterior']));
  const levelTop = level.elevation + level.height;
  const groundTop = Math.max(datum.referenceGrade, datum.sampledGroundMax);
  const retainingTop = Math.min(levelTop, groundTop);
  if (retainingTop - datum.top > EPS && shell.segments.length) {
    addStripComponents(components, 'foundation:basement-wall', 'basement-wall', shell, datum.top, retainingTop, {
      thickness: options.retainingWallThickness,
    });
  } else if (!shell.segments.length) {
    warnings.push(warning('basement-shell-missing', 'Не найдены наружные стены подвала для подпорной оболочки.'));
  } else {
    warnings.push(warning('basement-above-ground', 'Подвальный этаж не пересекает опорную землю; подпорная оболочка не требуется.'));
  }
  if (shell.prisms.length) warnings.push(warning(
    'angled-basement-joints-conceptual',
    'Узлы подпорной оболочки под косыми стенами показаны концептуально.',
  ));
  return true;
}

// → { type, levelId, datum, footprint, params, components, warnings }.
// Старый проект без foundation.type всегда получает type='slab' и тот же
// диапазон основания/цоколя, который строил foundationFaces().
export function deriveFoundation(project) {
  const options = foundationOptions(project);
  const warnings = [];
  const result = {
    type: options.type,
    enabled: options.enabled,
    levelId: null,
    datum: null,
    footprint: [],
    params: { ...options },
    components: [],
    warnings,
  };
  if (options.requestedType != null && foundationType(options.requestedType) === 'slab'
    && options.requestedType !== 'slab' && options.requestedType !== 'raft') {
    warnings.push(warning('foundation-type-unknown', 'Неизвестный тип фундамента заменён плитным.'));
  }
  if (!options.enabled) return result;
  const occupied = occupiedLevel(project);
  if (!occupied) {
    warnings.push(warning('building-footprint-missing', 'Сначала задайте замкнутое пятно дома.'));
    return result;
  }
  const { level, lp } = occupied;
  const footprint = levelFootprint(lp, project.settings?.exterior || 250);
  result.levelId = level.id;
  result.footprint = footprint.map((rect) => ({ ...rect }));
  const datum = foundationDatum(project, footprint, Number(level.elevation) || 0, options.depth);
  result.datum = datum;
  if (!datum) {
    warnings.push(warning('building-datum-missing', 'Задайте положение ±0.000 относительно земли.'));
    return result;
  }
  if (datum.terrainOutside) warnings.push(warning(
    'terrain-outside',
    'Часть пятна дома находится вне оболочки топосъёмки; земля продолжена по ближайшему краю.',
  ));
  if (datum.referenceGrade > datum.top + 20) warnings.push(warning(
    'ground-above-floor',
    'Опорная земля выше пола нижнего этажа; нужны выемка или корректировка посадки.',
  ));

  if (options.type === 'strip') {
    if (!deriveStrip(result.components, lp, datum, options, warnings)) deriveSlab(result.components, footprint, datum, options, { fallbackFor: 'strip' });
  } else if (options.type === 'piles') {
    if (!derivePiles(result.components, lp, datum, options, warnings)) deriveSlab(result.components, footprint, datum, options, { fallbackFor: 'piles' });
  } else if (options.type === 'basement') {
    deriveBasement(result.components, footprint, level, lp, datum, options, warnings);
  } else deriveSlab(result.components, footprint, datum, options);
  return result;
}

// Параметрическая оболочка дома: связанная с этажами автокровля и основание.
// Все отметки — в миллиметрах относительно проектного ±0.000.

export const DEFAULT_FOUNDATION_DEPTH = 800;
export const DEFAULT_AUTO_ROOF_THICKNESS = 250;
export const DEFAULT_SLAB_THICKNESS = 300;
export const MAX_ZERO_ABOVE_GROUND = 5000;
export const MIN_ZERO_ABOVE_GROUND = -5000;
export const MAX_FOUNDATION_DEPTH = 5000;

export const ROOF_TYPES = Object.freeze(['flat', 'shed', 'gable', 'hip']);
export const ROOF_DIRECTIONS = Object.freeze(['auto', 'n', 'e', 's', 'w']);
export const FOUNDATION_TYPES = Object.freeze(['slab', 'strip', 'piles', 'basement']);
export const ENTRANCE_MODES = Object.freeze(['steps', 'ramp', 'both', 'none']);

const finite = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max, fallback) => {
  const number = finite(value);
  return number == null ? fallback : Math.min(max, Math.max(min, Math.round(number)));
};

const enumValue = (value, values, fallback) => (values.includes(value) ? value : fallback);

export function createEnvelope() {
  return {
    // linked — производная кровля следует за пятном этажей; manual — только
    // явно нарисованные project.roofs.
    roofMode: 'linked',
    roofThickness: DEFAULT_AUTO_ROOF_THICKNESS,
    roof: {
      type: 'flat',
      pitchDeg: 15,
      direction: 'auto',
      overhang: 600,
      drainage: 'auto',
    },
    // null означает, что пользователь ещё не задал положение ±0.000.
    zeroAboveGround: null,
    // Абсолютная опорная земля по топосъёмке фиксируется в момент ввода
    // ±0.000. Поэтому изменение пятна дома не переносит дом по высоте.
    groundReferenceZ: null,
    foundation: {
      enabled: true,
      type: 'slab',
      // Старые файлы могли задавать всё тело одним depth. Новые проекты
      // используют настоящие размеры плиты и ленты.
      sizingMode: 'parametric',
      depth: DEFAULT_FOUNDATION_DEPTH,
      slabThickness: DEFAULT_SLAB_THICKNESS,
      stripWidth: 600,
      stripHeight: 600,
      pileDiameter: 300,
      pileLength: 2500,
      pileSpacing: 2500,
      grillageWidth: 500,
      grillageHeight: 500,
      basementSlabThickness: 300,
      retainingWallThickness: 300,
    },
    entrance: {
      enabled: true,
      mode: 'steps',
      landingDepth: 1500,
      landingExtraWidth: 600,
      maxRiser: 150,
      tread: 300,
      rampSlope: 0.08,
    },
    slabs: { enabled: true, thickness: DEFAULT_SLAB_THICKNESS, groundThickness: DEFAULT_SLAB_THICKNESS },
    earthworks: { mode: 'relative', margin: 1000, gradeOffset: 0 },
  };
}
export function normalizeEnvelope(raw) {
  const defaults = createEnvelope();
  const source = raw && typeof raw === 'object' ? raw : {};
  const roof = source.roof && typeof source.roof === 'object' ? source.roof : {};
  const foundation = source.foundation && typeof source.foundation === 'object' ? source.foundation : {};
  const entrance = source.entrance && typeof source.entrance === 'object' ? source.entrance : {};
  const slabs = source.slabs && typeof source.slabs === 'object' ? source.slabs : {};
  const earthworks = source.earthworks && typeof source.earthworks === 'object' ? source.earthworks : {};
  const zero = finite(source.zeroAboveGround);
  const groundReferenceZ = finite(source.groundReferenceZ);
  return {
    roofMode: source.roofMode === 'manual' ? 'manual' : 'linked',
    roofThickness: clamp(source.roofThickness, 120, 1000, defaults.roofThickness),
    roof: {
      type: enumValue(roof.type, ROOF_TYPES, defaults.roof.type),
      pitchDeg: clamp(roof.pitchDeg, 1, 60, defaults.roof.pitchDeg),
      direction: enumValue(roof.direction, ROOF_DIRECTIONS, defaults.roof.direction),
      // В файлах до появления свеса по умолчанию крыша шла по грани стены.
      overhang: clamp(roof.overhang, 0, 2000, 0),
      drainage: ['auto', 'internal', 'external', 'off'].includes(roof.drainage)
        ? roof.drainage : defaults.roof.drainage,
    },
    zeroAboveGround: zero == null ? null : clamp(zero, MIN_ZERO_ABOVE_GROUND, MAX_ZERO_ABOVE_GROUND, 0),
    groundReferenceZ: zero == null || groundReferenceZ == null ? null : Math.round(groundReferenceZ),
    foundation: {
      enabled: foundation.enabled !== false,
      type: enumValue(foundation.type, FOUNDATION_TYPES, defaults.foundation.type),
      sizingMode: foundation.sizingMode === 'legacy-depth'
        || (Object.keys(foundation).length > 0
          && !Object.hasOwn(foundation, 'type')
          && !Object.hasOwn(foundation, 'slabThickness')
          && !Object.hasOwn(foundation, 'stripHeight'))
        ? 'legacy-depth' : 'parametric',
      depth: clamp(foundation.depth, 0, MAX_FOUNDATION_DEPTH, defaults.foundation.depth),
      slabThickness: clamp(foundation.slabThickness, 100, 1500, defaults.foundation.slabThickness),
      stripWidth: clamp(foundation.stripWidth, 200, 2000, defaults.foundation.stripWidth),
      stripHeight: clamp(foundation.stripHeight, 200, 2000, defaults.foundation.stripHeight),
      pileDiameter: clamp(foundation.pileDiameter, 150, 1200, defaults.foundation.pileDiameter),
      pileLength: clamp(foundation.pileLength, 500, 12000, defaults.foundation.pileLength),
      pileSpacing: clamp(foundation.pileSpacing, 800, 6000, defaults.foundation.pileSpacing),
      grillageWidth: clamp(foundation.grillageWidth, 200, 2000, defaults.foundation.grillageWidth),
      grillageHeight: clamp(foundation.grillageHeight, 200, 2000, defaults.foundation.grillageHeight),
      basementSlabThickness: clamp(foundation.basementSlabThickness, 150, 1000, defaults.foundation.basementSlabThickness),
      retainingWallThickness: clamp(foundation.retainingWallThickness, 150, 1000, defaults.foundation.retainingWallThickness),
    },
    entrance: {
      enabled: entrance.enabled !== false,
      mode: enumValue(entrance.mode, ENTRANCE_MODES, defaults.entrance.mode),
      landingDepth: clamp(entrance.landingDepth, 900, 4000, defaults.entrance.landingDepth),
      landingExtraWidth: clamp(entrance.landingExtraWidth, 0, 2400, defaults.entrance.landingExtraWidth),
      maxRiser: clamp(entrance.maxRiser, 100, 200, defaults.entrance.maxRiser),
      tread: clamp(entrance.tread, 250, 600, defaults.entrance.tread),
      rampSlope: Math.min(0.2, Math.max(0.03, finite(entrance.rampSlope) ?? defaults.entrance.rampSlope)),
    },
    slabs: {
      enabled: slabs.enabled !== false,
      thickness: clamp(slabs.thickness, 120, 600, defaults.slabs.thickness),
      groundThickness: clamp(slabs.groundThickness, 120, 800, defaults.slabs.groundThickness),
    },
    earthworks: {
      mode: ['relative', 'absolute', 'balanced'].includes(earthworks.mode) ? earthworks.mode : defaults.earthworks.mode,
      margin: clamp(earthworks.margin, 0, 10000, defaults.earthworks.margin),
      gradeOffset: clamp(earthworks.gradeOffset, -5000, 5000, defaults.earthworks.gradeOffset),
    },
  };
}

export function envelopeOf(project) {
  return normalizeEnvelope(project?.envelope);
}

// Явная относительная отметка имеет приоритет. Для старых проектов с
// абсолютной отметкой рельефа считаем разницу от средней земли под домом.
export function resolvedZeroAboveGround(project, house = null) {
  const explicit = finite(project?.envelope?.zeroAboveGround);
  if (explicit != null) return clamp(explicit, MIN_ZERO_ABOVE_GROUND, MAX_ZERO_ABOVE_GROUND, 0);
  const floorZ = finite(project?.site?.terrain?.floorZ);
  const reference = finite(house?.groundReferenceZ ?? house?.avg);
  if (floorZ == null || reference == null) return null;
  // Старые проекты могли иметь любую разницу абсолютных отметок. Не
  // ограничиваем её диапазоном нового относительного поля.
  return floorZ - reference;
}

export function hasBuildingDatum(project, house = null) {
  return resolvedZeroAboveGround(project, house) != null;
}

export function envelopeHasUserInput(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const envelope = normalizeEnvelope(raw);
  const defaults = createEnvelope();
  // Пустой дом прежней версии (свес 0) также остаётся пустым после открытия.
  if (envelope.roof.overhang === 0) defaults.roof.overhang = 0;
  return envelope.zeroAboveGround != null
    || envelope.groundReferenceZ != null
    || envelope.roofMode !== 'linked'
    || envelope.roofThickness !== DEFAULT_AUTO_ROOF_THICKNESS
    || JSON.stringify(envelope.roof) !== JSON.stringify(defaults.roof)
    || envelope.foundation.enabled !== true
    || JSON.stringify(envelope.foundation) !== JSON.stringify(defaults.foundation)
    || JSON.stringify(envelope.entrance) !== JSON.stringify(defaults.entrance)
    || JSON.stringify(envelope.slabs) !== JSON.stringify(defaults.slabs)
    || JSON.stringify(envelope.earthworks) !== JSON.stringify(defaults.earthworks);
}

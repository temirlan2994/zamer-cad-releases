// Параметрическая оболочка дома: связанная с этажами автокровля и основание.
// Все отметки — в миллиметрах относительно проектного ±0.000.

export const DEFAULT_FOUNDATION_DEPTH = 800;
export const DEFAULT_AUTO_ROOF_THICKNESS = 250;
export const MAX_ZERO_ABOVE_GROUND = 5000;
export const MIN_ZERO_ABOVE_GROUND = -5000;
export const MAX_FOUNDATION_DEPTH = 5000;

const finite = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max, fallback) => {
  const number = finite(value);
  return number == null ? fallback : Math.min(max, Math.max(min, Math.round(number)));
};

export function createEnvelope() {
  return {
    // linked — производная кровля следует за пятном этажей; manual — только
    // явно нарисованные project.roofs.
    roofMode: 'linked',
    roofThickness: DEFAULT_AUTO_ROOF_THICKNESS,
    // null означает, что пользователь ещё не задал положение ±0.000.
    zeroAboveGround: null,
    // Абсолютная опорная земля по топосъёмке фиксируется в момент ввода
    // ±0.000. Поэтому изменение пятна дома не переносит дом по высоте.
    groundReferenceZ: null,
    foundation: { enabled: true, depth: DEFAULT_FOUNDATION_DEPTH },
  };
}
export function normalizeEnvelope(raw) {
  const defaults = createEnvelope();
  const source = raw && typeof raw === 'object' ? raw : {};
  const foundation = source.foundation && typeof source.foundation === 'object' ? source.foundation : {};
  const zero = finite(source.zeroAboveGround);
  const groundReferenceZ = finite(source.groundReferenceZ);
  return {
    roofMode: source.roofMode === 'manual' ? 'manual' : 'linked',
    roofThickness: clamp(source.roofThickness, 120, 1000, defaults.roofThickness),
    zeroAboveGround: zero == null ? null : clamp(zero, MIN_ZERO_ABOVE_GROUND, MAX_ZERO_ABOVE_GROUND, 0),
    groundReferenceZ: zero == null || groundReferenceZ == null ? null : Math.round(groundReferenceZ),
    foundation: {
      enabled: foundation.enabled !== false,
      depth: clamp(foundation.depth, 0, MAX_FOUNDATION_DEPTH, defaults.foundation.depth),
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
  return envelope.zeroAboveGround != null
    || envelope.groundReferenceZ != null
    || envelope.roofMode !== 'linked'
    || envelope.roofThickness !== DEFAULT_AUTO_ROOF_THICKNESS
    || envelope.foundation.enabled !== true
    || envelope.foundation.depth !== DEFAULT_FOUNDATION_DEPTH;
}

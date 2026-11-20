// Короткие производные статусы оболочки дома.
//
// Модуль ничего не записывает в проект и намеренно понимает несколько форм
// данных: текущую envelope.*, старые верхнеуровневые поля и планируемые
// параметрические блоки. Неизвестное не выдаётся за успешно проверенное.

import { levelProject } from './model.js';
import { deriveEntrances } from './entrance.js';
import { deriveWalls, doorLink } from './walls.js';

export const ENVELOPE_STATUS_KEYS = Object.freeze([
  'datum', 'foundation', 'roof', 'drainage', 'entrance',
]);

export const ENVELOPE_STATUSES = Object.freeze([
  'checked', 'attention', 'blocked', 'unknown',
]);

const BLOCKED = new Set(['blocked', 'conflict', 'error', 'failed', 'fail', 'invalid']);
const CHECKED = new Set(['checked', 'ready', 'done', 'ok', 'valid', 'linked', 'automatic', 'auto']);
const ATTENTION = new Set(['attention', 'warning', 'warn', 'partial', 'disabled', 'off']);
const UNKNOWN = new Set(['unknown', 'pending', 'missing', 'unset', 'not-set']);
const OFF = new Set(['off', 'none', 'disabled', 'false']);
const AUTO = new Set(['auto', 'automatic', 'linked']);
const ROOF_TYPES = new Set(['flat', 'shed', 'gable', 'hip']);
const FOUNDATION_TYPES = new Set(['slab', 'strip', 'piles', 'basement']);
const ROOF_DIRECTIONS = new Set(['auto', 'n', 'e', 's', 'w']);

const own = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const token = (value) => String(value ?? '').trim().toLowerCase();
const number = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};
const nonEmpty = (value) => Array.isArray(value) ? value.length > 0 : Boolean(value);

function firstOwn(candidates) {
  for (const [owner, key] of candidates) {
    if (own(owner, key)) return { present: true, value: owner[key], key };
  }
  return { present: false, value: undefined, key: '' };
}

function declaredStatus(value) {
  const source = record(value);
  const raw = source ? source.status : value;
  const status = token(raw);
  if (BLOCKED.has(status)) return 'blocked';
  if (CHECKED.has(status)) return 'checked';
  if (ATTENTION.has(status)) return 'attention';
  if (UNKNOWN.has(status)) return 'unknown';
  return null;
}

function hasFailure(value) {
  const source = record(value);
  if (!source) return false;
  if (source.valid === false || source.invalid === true || source.conflict === true || source.error === true) return true;
  if (nonEmpty(source.errors) || nonEmpty(source.conflicts)) return true;
  return declaredStatus(source) === 'blocked';
}

function isOff(value) {
  if (value === false) return true;
  const source = record(value);
  if (source?.enabled === false || source?.active === false) return true;
  return OFF.has(token(source?.mode ?? source?.type ?? value));
}

function allRooms(project) {
  if (Array.isArray(project?.levels)) return project.levels.flatMap((level) => list(level?.rooms));
  return list(project?.rooms);
}

function occupiedLevels(project) {
  if (!Array.isArray(project?.levels)) return [];
  return project.levels.filter((level) => list(level?.rooms).length > 0);
}

function datumStatus(project) {
  const envelope = record(project?.envelope);
  const building = record(project?.building);
  const datum = firstOwn([
    [envelope, 'zeroAboveGround'],
    [envelope, 'datum'],
    [building, 'datum'],
    [project, 'zeroAboveGround'],
    [project, 'buildingZeroAboveGround'],
    [project, 'datum'],
  ]);

  if (datum.present) {
    if (hasFailure(datum.value)) return 'blocked';
    const declared = declaredStatus(datum.value);
    if (declared === 'blocked' || declared === 'attention' || declared === 'unknown') return declared;
    const source = record(datum.value);
    const raw = source
      ? firstOwn([
        [source, 'zeroAboveGround'], [source, 'heightAboveGround'], [source, 'offset'],
        [source, 'value'], [source, 'elevation'],
      ])
      : { present: true, value: datum.value, key: datum.key };
    if (!raw.present || raw.value === null || raw.value === '') return declared || 'unknown';
    const value = number(raw.value);
    if (!Number.isFinite(value)) return 'blocked';
    const relative = datum.key !== 'datum'
      || ['zeroAboveGround', 'heightAboveGround', 'offset'].includes(raw.key);
    // Текущий диапазон относительной отметки ±5 м. Пол ниже опорной земли
    // более чем на допуск 20 мм уже конфликтует с посадкой.
    if (relative && (value < -5000 || value > 5000 || value < -20)) return 'blocked';
    return 'checked';
  }

  // В старых проектах абсолютная отметка чистого пола жила в рельефе.
  const legacy = firstOwn([
    [project?.site?.terrain, 'floorZ'], [project?.site, 'floorZ'], [project, 'floorZ'],
  ]);
  if (!legacy.present || legacy.value === null || legacy.value === '') return 'unknown';
  return Number.isFinite(number(legacy.value)) ? 'checked' : 'blocked';
}

function positiveFieldsValid(source, keys) {
  for (const key of keys) {
    if (!own(source, key)) continue;
    const value = number(source[key]);
    if (!Number.isFinite(value) || value <= 0) return false;
  }
  return true;
}

function foundationStatus(project, datum) {
  const envelope = record(project?.envelope);
  const building = record(project?.building);
  const found = firstOwn([
    [envelope, 'foundation'], [building, 'foundation'], [project, 'foundation'],
  ]);
  if (!found.present) return 'unknown';
  if (hasFailure(found.value)) return 'blocked';
  if (isOff(found.value)) return 'attention';

  const source = record(found.value) || {};
  const declared = declaredStatus(source);
  if (declared === 'blocked' || declared === 'attention') return declared;
  const type = token(typeof found.value === 'string' ? found.value : source.type || 'slab');
  if (type && !FOUNDATION_TYPES.has(type)) return 'blocked';

  if (own(source, 'depth')) {
    const depth = number(source.depth);
    if (!Number.isFinite(depth) || depth < 0 || depth > 5000) return 'blocked';
    if (depth === 0) return 'attention';
  }
  const dimensions = {
    slab: ['slabThickness'],
    strip: ['stripWidth', 'stripHeight'],
    piles: ['pileDiameter', 'pileLength', 'pileSpacing', 'grillageWidth', 'grillageHeight'],
    basement: ['basementSlabThickness', 'retainingWallThickness'],
  };
  if (!positiveFieldsValid(source, dimensions[type] || [])) return 'blocked';
  if (datum !== 'checked') return 'unknown';

  // Подвал без занятого уровня ниже ±0 — допустимый черновик, но ещё не
  // согласованная часть модели.
  if (type === 'basement' && !occupiedLevels(project)
    .some((level) => Number(level.elevation) < 0)) return 'attention';
  return declared === 'unknown' ? 'unknown' : 'checked';
}

function roofRecords(project, config) {
  if (Array.isArray(project?.roofs)) return project.roofs;
  if (Array.isArray(config?.roofs)) return config.roofs;
  if (Array.isArray(config?.items)) return config.items;
  if (record(project?.roof)?.outline) return [project.roof];
  return [];
}

function validPoint(point) {
  return Number.isFinite(number(point?.x)) && Number.isFinite(number(point?.y));
}

function roofRecordInvalid(roof, levelIds) {
  if (!record(roof) || hasFailure(roof)) return true;
  if (own(roof, 'outline') && (!Array.isArray(roof.outline)
    || roof.outline.length < 3 || !roof.outline.every(validPoint))) return true;
  if (roof.levelId != null && levelIds.size && !levelIds.has(roof.levelId)) return true;
  return false;
}

function roofConfigInvalid(source, envelope) {
  if (hasFailure(source)) return true;
  const typeEntry = firstOwn([[source, 'type'], [source, 'roofType'], [envelope, 'roofType']]);
  if (typeEntry.present && !ROOF_TYPES.has(token(typeEntry.value))) return true;
  const pitchEntry = firstOwn([[source, 'pitchDeg'], [source, 'roofPitchDeg'], [envelope, 'roofPitchDeg']]);
  if (pitchEntry.present) {
    const pitch = number(pitchEntry.value);
    if (!Number.isFinite(pitch) || pitch < 0 || pitch >= 90) return true;
  }
  const directionEntry = firstOwn([[source, 'direction'], [source, 'roofDirection'], [envelope, 'roofDirection']]);
  if (directionEntry.present && !ROOF_DIRECTIONS.has(token(directionEntry.value))) return true;
  const overhang = firstOwn([[source, 'overhang'], [source, 'roofOverhang'], [envelope, 'roofOverhang']]);
  if (overhang.present && record(overhang.value)) {
    for (const side of ['n', 'e', 's', 'w']) {
      if (!own(overhang.value, side)) continue;
      const value = number(overhang.value[side]);
      if (!Number.isFinite(value) || value < 0) return true;
    }
  }
  return false;
}

function roofStatus(project) {
  const envelope = record(project?.envelope) || {};
  const building = record(project?.building) || {};
  const configEntry = firstOwn([
    [envelope, 'roof'], [building, 'roof'], [project, 'roof'],
  ]);
  const config = record(configEntry.value) || {};
  const modeEntry = firstOwn([
    [envelope, 'roofMode'], [config, 'mode'], [config, 'roofMode'], [project, 'roofMode'],
  ]);
  const mode = token(modeEntry.value);
  const typePresent = firstOwn([[envelope, 'roofType'], [config, 'roofType'], [config, 'type']]).present;
  const records = roofRecords(project, config);
  const levelIds = new Set(list(project?.levels).map((level) => level?.id));

  if (roofConfigInvalid(config, envelope) || records.some((roof) => roofRecordInvalid(roof, levelIds))) return 'blocked';
  if (isOff(configEntry.value) || OFF.has(mode)) return 'attention';
  const declared = declaredStatus(config);
  if (declared === 'blocked' || declared === 'attention') return declared;

  const hasRooms = allRooms(project).length > 0;
  if (mode === 'manual') {
    if (records.length) return 'checked';
    return hasRooms ? 'blocked' : 'unknown';
  }
  if (AUTO.has(mode)) return hasRooms ? 'checked' : 'unknown';
  if (records.length) return 'checked';
  if ((typePresent || declared === 'checked') && hasRooms) return 'checked';
  return 'unknown';
}

function drainageItemStatus(value) {
  if (value === true) return 'checked';
  if (value === false) return 'attention';
  if (typeof value === 'string') {
    const direct = declaredStatus(value);
    if (direct) return direct;
    if (AUTO.has(token(value)) || ['external', 'internal'].includes(token(value))) return 'checked';
    if (OFF.has(token(value))) return 'attention';
    return 'unknown';
  }
  if (Array.isArray(value)) return value.length ? 'checked' : 'unknown';
  const source = record(value);
  if (!source) return 'unknown';
  if (hasFailure(source)) return 'blocked';
  if (isOff(source)) return 'attention';
  const direct = declaredStatus(source);
  if (direct === 'blocked' || direct === 'attention' || direct === 'unknown') return direct;
  const mode = token(source.mode || source.type);
  if (AUTO.has(mode) || ['external', 'internal'].includes(mode)) return 'checked';
  if (source.complete === true || source.configured === true) return 'checked';
  if (['outlets', 'downspouts', 'drains'].some((key) => nonEmpty(source[key]))) return 'checked';
  if (nonEmpty(source.gutters)) return 'attention';
  if (direct === 'checked' || source.enabled === true) return 'checked';
  if (own(source, 'drain')) return drainageItemStatus(source.drain);
  return 'unknown';
}

function drainageStatus(project, roof) {
  const envelope = record(project?.envelope);
  const building = record(project?.building);
  const sources = [];
  for (const [owner, key] of [
    [envelope, 'roofDrainage'], [envelope, 'drainage'],
    [envelope?.roof, 'drainage'], [envelope?.roof, 'roofDrainage'],
    [building, 'roofDrainage'], [building, 'drainage'],
    [project, 'roofDrainage'], [project, 'drainage'],
  ]) {
    if (own(owner, key)) sources.push(owner[key]);
  }
  for (const item of list(project?.roofs)) {
    if (own(item, 'drainage')) sources.push(item.drainage);
    else if (own(item, 'drain')) sources.push(item.drain);
  }
  if (!sources.length) return 'unknown';
  const statuses = sources.map(drainageItemStatus);
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('attention')) return 'attention';
  if (roof !== 'checked') return 'unknown';
  return statuses.includes('checked') ? 'checked' : 'unknown';
}

function openingLists(project) {
  if (Array.isArray(project?.levels)) {
    const occupied = occupiedLevels(project).sort((a, b) => Number(a.elevation) - Number(b.elevation));
    if (!occupied.length) return [];
    return occupied
      .filter((level) => Number(level.elevation) === Number(occupied[0].elevation))
      .map((level) => ({ level, project: levelProject(project, level.id) }));
  }
  return allRooms(project).length ? [{ level: null, project }] : [];
}

function currentExteriorDoor(project) {
  for (const item of openingLists(project)) {
    const local = item.project;
    const doors = list(local?.openings).filter((opening) => opening?.kind === 'door'
      && opening.type !== 'none' && opening.enabled !== false);
    if (!doors.length) continue;
    try {
      const walls = deriveWalls(local);
      if (doors.some((opening) => {
        const link = doorLink(local, opening, walls);
        return link?.includes('outside') && link.some((id) => id !== 'outside');
      })) return true;
    } catch { /* частично мигрированный проект проверим по явным признакам ниже */ }
    if (doors.some((opening) => opening.exterior === true || opening.outside === true
      || opening.role === 'main' || /^entry(?:-|$)/.test(token(opening.presetId)))) return true;
  }
  return false;
}

function futureEntrances(project) {
  const envelope = record(project?.envelope);
  const building = record(project?.building);
  const values = [];
  for (const [owner, key] of [
    [envelope, 'entrances'], [building, 'entrances'], [project, 'entrances'],
    [project, 'entryGroups'], [envelope, 'entrance'], [building, 'entrance'], [project, 'entrance'],
  ]) {
    if (!own(owner, key)) continue;
    if (Array.isArray(owner[key])) {
      values.push(...owner[key]);
      continue;
    }
    const value = owner[key];
    const source = record(value);
    // envelope.entrance — параметры будущего генератора (ступени/пандус),
    // а не доказательство готового входа. Учитываем одиночный объект лишь
    // когда в нём уже есть результат, состояние или явное отключение.
    if (!source || source.enabled === false || ['status', 'openingId', 'components', 'ready', 'valid', 'conflict', 'error']
      .some((field) => own(source, field))) values.push(value);
  }
  return values;
}

function entranceItemStatus(value) {
  if (value === false) return 'attention';
  if (value === true) return 'checked';
  const source = record(value);
  if (!source) return declaredStatus(value) || 'unknown';
  if (hasFailure(source)) return 'blocked';
  if (isOff(source)) return 'attention';
  const direct = declaredStatus(source);
  if (direct) return direct;
  if (source.ready === true || source.openingId || nonEmpty(source.components)) return 'checked';
  return 'unknown';
}

function entranceStatus(project, datum) {
  const hasRooms = allRooms(project).length > 0;
  if (!hasRooms) return 'unknown';
  const future = futureEntrances(project);
  if (future.length) {
    const statuses = future.map(entranceItemStatus);
    if (statuses.includes('blocked')) return 'blocked';
    if (statuses.includes('checked')) return datum === 'checked' ? 'checked' : 'unknown';
    if (statuses.includes('attention')) return datum === 'checked' ? 'attention' : 'unknown';
    // Производный вход уже найден, но ещё не может быть собран (обычно
    // требуется ±0.000). Не подменяем это ошибкой «нет двери».
    return 'unknown';
  }
  // Новый генератор входной группы даёт более точный результат (площадка,
  // ступени/пандус и конфликты рельефа), но повреждённый старый проект не
  // должен уронить всю строку статусов.
  try {
    const generated = deriveEntrances(project);
    if (generated.length) {
      const statuses = generated.map(entranceItemStatus);
      if (statuses.includes('blocked')) return 'blocked';
      if (statuses.includes('checked')) return datum === 'checked' ? 'checked' : 'unknown';
      if (statuses.includes('attention')) return datum === 'checked' ? 'attention' : 'unknown';
      // Старый абсолютный site.terrain.floorZ уже является заданным нулём,
      // хотя новый генератор не умеет восстановить его опорную землю.
      if (datum === 'checked' && currentExteriorDoor(project)) return 'checked';
      return 'unknown';
    }
  } catch { /* ниже остаётся дешёвая проверка наружной двери */ }
  if (!currentExteriorDoor(project)) return 'blocked';
  return datum === 'checked' ? 'checked' : 'unknown';
}

/**
 * Возвращает пять дешёвых статусов для компактной панели оболочки.
 * Результат полностью производный и не мутирует проект.
 */
export function deriveEnvelopeStatus(project) {
  if (!record(project)) {
    return { datum: 'unknown', foundation: 'unknown', roof: 'unknown', drainage: 'unknown', entrance: 'unknown' };
  }
  const datum = datumStatus(project);
  const foundation = foundationStatus(project, datum);
  const roof = roofStatus(project);
  return {
    datum,
    foundation,
    roof,
    drainage: drainageStatus(project, roof),
    entrance: entranceStatus(project, datum),
  };
}

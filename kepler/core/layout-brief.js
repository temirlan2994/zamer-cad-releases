// Сохраняемое задание для авторасстановки.
//
// Геометрия проекта остаётся в обычной модели Kepler. Здесь лежат только
// внешние факты, которых нельзя честно вывести из плана: пользователи,
// мобильность, вместимость, инженерные привязки, инвентарь хранения и явно
// зафиксированная неопределённость. Поле project.layoutBrief необязательно:
// старые проекты без него открываются как прежде, пустой brief не пишется.

import { isStructural } from './catalog.js';
import { LAYOUT_SCENARIOS } from './layout-knowledge.generated.js';

export const LAYOUT_BRIEF_VERSION = 1;

export const LAYOUT_DATA_STATUSES = Object.freeze(['measured', 'declared', 'assumed', 'unknown']);
export const LAYOUT_MOBILITY_PROFILES = Object.freeze([
  'standard', 'child', 'wheelchair', 'walker', 'crutches', 'custom', 'unknown',
]);
export const ENGINEERING_KINDS = Object.freeze([
  'cold_water', 'hot_water', 'drain', 'gas', 'power', 'outlet', 'switch',
  'vent_supply', 'vent_return', 'vent_extract', 'radiator', 'fireplace', 'other',
]);
export const STORAGE_FREQUENCIES = Object.freeze(['daily', 'weekly', 'seasonal', 'rare', 'unknown']);
export const UNCERTAINTY_STATUSES = Object.freeze(['unknown', 'assumed', 'bounded', 'resolved']);
export const CATALOG_GEOMETRY_STATUSES = Object.freeze(['verified_sku', 'parametric_custom', 'proxy']);
export const MANUAL_STATUSES = Object.freeze(['unknown', 'verified', 'not_required']);

const BRIEF_KEYS = new Set([
  'version', 'actors', 'capacity', 'fixedEngineering', 'storageInventory', 'uncertainty',
  'scenarioSelections',
]);
const SCENARIO_IDS = new Set(LAYOUT_SCENARIOS.map((scenario) => scenario.scenario_id));

const isObj = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const finite = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const nonNegative = (value) => {
  const number = finite(value);
  return number != null && number >= 0 ? number : null;
};
const positive = (value) => {
  const number = finite(value);
  return number != null && number > 0 ? number : null;
};
const integer = (value) => {
  const number = nonNegative(value);
  return number == null ? null : Math.round(number);
};
const positiveInteger = (value) => {
  const number = positive(value);
  return number == null ? null : Math.max(1, Math.round(number));
};
const enumValue = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const stringList = (value) => (Array.isArray(value)
  ? [...new Set(value.map(text).filter(Boolean))]
  : []);
const idSet = (value) => (value instanceof Set ? value : new Set(Array.isArray(value) ? value : []));

function reference(value, allowed) {
  const id = text(value);
  if (!id) return null;
  return allowed.size === 0 || allowed.has(id) ? id : null;
}

function uniqueId(value, prefix, index, used) {
  const base = text(value) || `${prefix}-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) { id = `${base}-${suffix}`; suffix += 1; }
  used.add(id);
  return id;
}

function normalizeFootprint(value) {
  if (!isObj(value) || !Array.isArray(value.outer)) return null;
  const ring = (points) => (Array.isArray(points)
    ? points.map((point) => (Array.isArray(point) && point.length >= 2
      ? [finite(point[0]), finite(point[1])] : null))
      .filter((point) => point && point[0] != null && point[1] != null)
    : []);
  const outer = ring(value.outer);
  if (outer.length < 4) return null;
  const holes = Array.isArray(value.holes)
    ? value.holes.map(ring).filter((candidate) => candidate.length >= 4)
    : [];
  return { outer, holes };
}

function normalizeActor(raw, index, used) {
  const source = isObj(raw) ? raw : {};
  const footprint = normalizeFootprint(source.bodyFootprintLocalMm);
  const out = {
    ...source,
    id: uniqueId(source.id, 'actor', index, used),
    alias: text(source.alias) || `Жилец ${index + 1}`,
    heightMm: positive(source.heightMm),
    mobilityProfile: enumValue(source.mobilityProfile, LAYOUT_MOBILITY_PROFILES, 'unknown'),
    bodyWidthMm: positive(source.bodyWidthMm),
    bodyDepthMm: positive(source.bodyDepthMm),
    carriedObjectIds: stringList(source.carriedObjectIds),
    dataStatus: enumValue(source.dataStatus, LAYOUT_DATA_STATUSES, 'unknown'),
    sourceRef: text(source.sourceRef),
  };
  if (footprint) out.bodyFootprintLocalMm = footprint; else delete out.bodyFootprintLocalMm;
  return out;
}

function normalizeEngineering(raw, index, used, refs) {
  const source = isObj(raw) ? raw : {};
  const kind = enumValue(source.kind, ENGINEERING_KINDS, 'other');
  const out = {
    ...source,
    id: uniqueId(source.id, 'engineering', index, used),
    kind,
    label: text(source.label),
    levelId: reference(source.levelId, refs.levelIds),
    roomId: reference(source.roomId, refs.roomIds),
    x: finite(source.x),
    y: finite(source.y),
    zMm: finite(source.zMm),
    fixed: source.fixed !== false,
    dataStatus: enumValue(source.dataStatus, LAYOUT_DATA_STATUSES, 'unknown'),
    sourceRef: text(source.sourceRef),
    clearanceMm: nonNegative(source.clearanceMm),
    equipmentItemIds: stringList(source.equipmentItemIds)
      .filter((id) => refs.itemIds.size === 0 || refs.itemIds.has(id)),
    notes: text(source.notes),
  };
  if (kind !== 'other') delete out.otherKind;
  else out.otherKind = text(source.otherKind);
  return out;
}

function normalizeDimensions(value) {
  if (!isObj(value)) return null;
  const out = {
    width: positive(value.width),
    depth: positive(value.depth),
    height: positive(value.height),
  };
  return Object.values(out).some((entry) => entry != null) ? out : null;
}

function normalizeStorage(raw, index, used, refs, actorIds) {
  const source = isObj(raw) ? raw : {};
  const dimensionsMm = normalizeDimensions(source.dimensionsMm);
  const out = {
    ...source,
    id: uniqueId(source.id, 'storage', index, used),
    label: text(source.label),
    category: text(source.category),
    count: integer(source.count),
    dimensionsMm,
    requiredVolumeLiters: nonNegative(source.requiredVolumeLiters),
    weightKg: nonNegative(source.weightKg),
    storageMode: text(source.storageMode),
    frequency: enumValue(source.frequency, STORAGE_FREQUENCIES, 'unknown'),
    seasonality: text(source.seasonality),
    preferredZone: text(source.preferredZone),
    ownerActorIds: stringList(source.ownerActorIds).filter((id) => actorIds.has(id)),
    roomIds: stringList(source.roomIds)
      .filter((id) => refs.roomIds.size === 0 || refs.roomIds.has(id)),
    dataStatus: enumValue(source.dataStatus, LAYOUT_DATA_STATUSES, 'unknown'),
    sourceRef: text(source.sourceRef),
    notes: text(source.notes),
  };
  if (!dimensionsMm) delete out.dimensionsMm;
  return out;
}

function normalizeUncertainty(raw, index, used, refs, actorIds) {
  const source = isObj(raw) ? raw : {};
  const targetId = text(source.targetId);
  const knownTarget = !targetId || actorIds.has(targetId) || refs.itemIds.has(targetId)
    || refs.roomIds.has(targetId) || refs.levelIds.has(targetId);
  return {
    ...source,
    id: uniqueId(source.id, 'uncertainty', index, used),
    scope: enumValue(source.scope, ['project', 'site', 'actor', 'engineering', 'item', 'storage', 'other'], 'other'),
    targetId: knownTarget ? targetId : null,
    fieldPath: text(source.fieldPath),
    status: enumValue(source.status, UNCERTAINTY_STATUSES, 'unknown'),
    lowerBound: finite(source.lowerBound),
    upperBound: finite(source.upperBound),
    unit: text(source.unit),
    sourceRef: text(source.sourceRef),
    note: text(source.note),
  };
}

function normalizeScenarioSelections(value, actorIds) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    if (!isObj(raw)) continue;
    const scenarioId = text(raw.scenarioId ?? raw.scenario_id ?? raw.templateId ?? raw.template_id);
    if (!scenarioId || !SCENARIO_IDS.has(scenarioId) || seen.has(scenarioId)) continue;
    seen.add(scenarioId);
    result.push({
      scenarioId,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : null,
      mandatory: typeof (raw.mandatory ?? raw.required) === 'boolean' ? (raw.mandatory ?? raw.required) : null,
      actorPersonIds: stringList(raw.actorPersonIds ?? raw.actor_person_ids ?? raw.actor_ids)
        .filter((id) => actorIds.has(id)),
      frequencyValue: nonNegative(raw.frequencyValue ?? raw.frequency_value),
      frequencyPeriod: text(raw.frequencyPeriod ?? raw.frequency_period),
      specificRequirements: text(raw.specificRequirements ?? raw.specific_requirements),
      sourceRef: text(raw.sourceRef ?? raw.source_id),
    });
  }
  return result;
}

export function createLayoutBrief() {
  return {
    version: LAYOUT_BRIEF_VERSION,
    actors: [],
    capacity: { dailySeats: null, guestSeats: null, simultaneousCooks: null },
    // null = не обследовано; [] = пользователь подтвердил отсутствие точек.
    fixedEngineering: null,
    // Та же семантика: null неизвестно, [] подтверждённо нечего хранить.
    storageInventory: null,
    uncertainty: [],
    scenarioSelections: [],
  };
}

export function normalizeLayoutBrief(raw, {
  levelIds = [], roomIds = [], itemIds = [],
} = {}) {
  const source = isObj(raw) ? raw : {};
  const refs = { levelIds: idSet(levelIds), roomIds: idSet(roomIds), itemIds: idSet(itemIds) };
  const actorUsed = new Set();
  const actors = (Array.isArray(source.actors) ? source.actors : [])
    .map((actor, index) => normalizeActor(actor, index, actorUsed));
  const actorIds = new Set(actors.map((actor) => actor.id));
  const engineeringUsed = new Set();
  const storageUsed = new Set();
  const uncertaintyUsed = new Set();
  const capacity = isObj(source.capacity) ? source.capacity : {};
  return {
    ...source,
    version: LAYOUT_BRIEF_VERSION,
    actors,
    capacity: {
      ...capacity,
      dailySeats: integer(capacity.dailySeats),
      guestSeats: integer(capacity.guestSeats),
      simultaneousCooks: positiveInteger(capacity.simultaneousCooks),
    },
    fixedEngineering: Array.isArray(source.fixedEngineering)
      ? source.fixedEngineering.map((point, index) => normalizeEngineering(point, index, engineeringUsed, refs))
      : null,
    storageInventory: Array.isArray(source.storageInventory)
      ? source.storageInventory.map((entry, index) => normalizeStorage(entry, index, storageUsed, refs, actorIds))
      : null,
    uncertainty: (Array.isArray(source.uncertainty) ? source.uncertainty : [])
      .map((entry, index) => normalizeUncertainty(entry, index, uncertaintyUsed, refs, actorIds)),
    scenarioSelections: normalizeScenarioSelections(
      source.scenarioSelections ?? source.scenario_selections,
      actorIds,
    ),
  };
}

export function layoutBriefIsEmpty(brief) {
  if (!isObj(brief)) return true;
  if (Object.keys(brief).some((key) => !BRIEF_KEYS.has(key))) return false;
  return !(brief.actors?.length)
    && brief.capacity?.dailySeats == null
    && brief.capacity?.guestSeats == null
    && brief.capacity?.simultaneousCooks == null
    && brief.fixedEngineering == null
    && brief.storageInventory == null
    && !(brief.uncertainty?.length)
    && !(brief.scenarioSelections?.length);
}

export function ensureLayoutBrief(project) {
  const levelIds = (project?.levels || []).map((level) => level.id);
  const rooms = (project?.levels || []).flatMap((level) => level.rooms || []);
  const items = (project?.levels || []).flatMap((level) => level.items || []);
  const brief = normalizeLayoutBrief(project?.layoutBrief, {
    levelIds,
    roomIds: rooms.map((room) => room.id),
    itemIds: items.map((item) => item.id),
  });
  if (project && typeof project === 'object') project.layoutBrief = brief;
  return brief;
}

function cleanOptionalTextField(out, key) {
  const value = text(out[key]);
  if (value) out[key] = value; else delete out[key];
}

function normalizeClearances(value) {
  if (!isObj(value)) return null;
  const out = { ...value };
  for (const key of ['frontMm', 'backMm', 'leftMm', 'rightMm', 'topMm']) {
    const number = nonNegative(value[key]);
    if (number == null) delete out[key]; else out[key] = number;
  }
  return Object.keys(out).length ? out : null;
}

// Не превращает наличие строки SKU в «проверенную геометрию»: такой статус
// может выставить только пользователь после сверки габаритов/источника.
export function normalizeCatalogItemMetadata(item) {
  const out = isObj(item) ? { ...item } : {};
  for (const key of ['manufacturer', 'sku', 'sourceUrl']) cleanOptionalTextField(out, key);
  // Отсутствие поля в старом файле остаётся отсутствием, но любое записанное
  // значение нормализуется в строгий boolean.
  if ('planProjectionVerified' in out) {
    out.planProjectionVerified = out.planProjectionVerified === true;
  }
  if (!CATALOG_GEOMETRY_STATUSES.includes(out.geometryStatus)) delete out.geometryStatus;
  if (!MANUAL_STATUSES.includes(out.manualStatus)) delete out.manualStatus;
  if (Array.isArray(out.manualConstraints)) {
    const used = new Set();
    out.manualConstraints = out.manualConstraints.filter(isObj).map((constraint, index) => {
      const normalized = {
        ...constraint,
        id: uniqueId(constraint.id, 'manual', index, used),
        status: constraint.status === 'verified' ? 'verified' : 'unknown',
        requirement: text(constraint.requirement) || 'Паспортные ограничения изделия',
      };
      const sourceRef = text(constraint.sourceRef ?? constraint.source_ref);
      if (sourceRef) normalized.sourceRef = sourceRef; else delete normalized.sourceRef;
      delete normalized.source_ref;
      const clearances = normalizeClearances(constraint.clearances);
      if (clearances) normalized.clearances = clearances; else delete normalized.clearances;
      return normalized;
    });
  } else delete out.manualConstraints;
  return out;
}

function readinessSection(id, label, status, summary, missing = [], required = true) {
  return { id, label, status, summary, missing, required };
}

function allFurniture(project, itemIds = null) {
  const wanted = itemIds == null ? null : idSet(itemIds);
  return (project?.levels || []).flatMap((level) => level.items || [])
    .filter((item) => !isStructural(item.kind) && (!wanted || wanted.has(item.id)));
}

export function layoutBriefReadiness(project, { itemIds = null } = {}) {
  const levels = project?.levels || [];
  const rooms = levels.flatMap((level) => level.rooms || []);
  const items = levels.flatMap((level) => level.items || []);
  const brief = normalizeLayoutBrief(project?.layoutBrief, {
    levelIds: levels.map((level) => level.id),
    roomIds: rooms.map((room) => room.id),
    itemIds: items.map((item) => item.id),
  });
  const sections = [];

  const location = project?.site?.location || {};
  const locationValid = Number.isFinite(Number(location.lat)) && Number(location.lat) >= -90 && Number(location.lat) <= 90
    && Number.isFinite(Number(location.lon)) && Number(location.lon) >= -180 && Number(location.lon) <= 180
    && Number.isFinite(Number(project?.site?.north));
  const solarReady = locationValid && project?.site?.solarVerified === true;
  sections.push(readinessSection(
    'solar', 'Север и солнце', solarReady ? 'ready' : (locationValid ? 'partial' : 'missing'),
    solarReady ? 'координаты и север подтверждены' : (locationValid ? 'координаты есть, но не подтверждены' : 'геолокация не задана'),
    solarReady ? [] : ['Подтвердить координаты и направление севера'],
  ));

  const actors = brief.actors;
  const actorsKnown = actors.length > 0
    && actors.every((actor) => actor.dataStatus !== 'unknown' && actor.heightMm != null);
  sections.push(readinessSection(
    'actors', 'Жильцы', actorsKnown ? 'ready' : (actors.length ? 'partial' : 'missing'),
    actors.length ? `${actors.length} чел.` : 'состав не задан',
    actorsKnown ? [] : [actors.length ? 'Уточнить рост и источник данных жильцов' : 'Добавить жильцов'],
  ));

  const mobilityKnown = actors.length > 0 && actors.every((actor) => {
    if (!actor.mobilityProfile || actor.mobilityProfile === 'unknown') return false;
    if (actor.mobilityProfile === 'standard') return true;
    if (actor.mobilityProfile === 'child') return actor.heightMm != null;
    return Boolean(actor.bodyFootprintLocalMm || (actor.bodyWidthMm && actor.bodyDepthMm));
  });
  const mobilitySome = actors.some((actor) => actor.mobilityProfile && actor.mobilityProfile !== 'unknown');
  sections.push(readinessSection(
    'accessibility', 'Мобильность', mobilityKnown ? 'ready' : (mobilitySome ? 'partial' : 'missing'),
    mobilityKnown ? 'профили и габариты заданы' : (mobilitySome ? 'часть профилей требует размеров' : 'профили не заданы'),
    mobilityKnown ? [] : ['Указать профиль мобильности и нужные габариты'],
  ));

  const capacityReady = brief.capacity.dailySeats != null && brief.capacity.guestSeats != null
    && brief.capacity.simultaneousCooks != null;
  const capacitySome = brief.capacity.dailySeats != null || brief.capacity.guestSeats != null
    || brief.capacity.simultaneousCooks != null;
  sections.push(readinessSection(
    'capacity', 'Места', capacityReady ? 'ready' : (capacitySome ? 'partial' : 'missing'),
    capacityReady
      ? `${brief.capacity.dailySeats} ежедневно · ${brief.capacity.guestSeats} гостевых · ${brief.capacity.simultaneousCooks} готовят`
      : (capacitySome ? 'заполнено частично' : 'не заданы'),
    capacityReady ? [] : ['Указать ежедневные и гостевые места, а также сколько человек готовят одновременно'],
  ));

  const scenarios = brief.scenarioSelections || [];
  const activeScenarios = scenarios.filter((entry) => entry.enabled === true);
  const unresolvedScenarios = scenarios.filter((entry) => entry.enabled == null
    || (entry.enabled === true && entry.mandatory == null));
  sections.push(readinessSection(
    'scenarios', 'Сценарии жизни', unresolvedScenarios.length ? 'partial' : (activeScenarios.length ? 'ready' : 'missing'),
    activeScenarios.length ? `${activeScenarios.length} активных` : 'не выбраны',
    unresolvedScenarios.length ? ['Уточнить включение и обязательность сценариев'] : [], false,
  ));

  const engineering = brief.fixedEngineering;
  const engineeringReady = engineering != null && engineering.every((point) => point.x != null && point.y != null
    && point.levelId && point.dataStatus !== 'unknown');
  sections.push(readinessSection(
    'engineering', 'Инженерные точки', engineeringReady ? 'ready' : (engineering?.length ? 'partial' : 'missing'),
    engineering == null ? 'не обследованы' : (engineering.length ? `${engineering.length} точек` : 'подтверждено отсутствие'),
    engineeringReady ? [] : [engineering?.length ? 'Уточнить координаты и источник точек' : 'Добавить точки или подтвердить отсутствие'],
  ));

  const inventory = brief.storageInventory;
  const storageReady = inventory != null && inventory.every((entry) => {
    const amountKnown = entry.count != null || entry.requiredVolumeLiters != null || entry.dimensionsMm;
    return entry.category && amountKnown && entry.dataStatus !== 'unknown';
  });
  sections.push(readinessSection(
    'storage', 'Хранение', storageReady ? 'ready' : (inventory?.length ? 'partial' : 'missing'),
    inventory == null ? 'инвентарь неизвестен' : (inventory.length ? `${inventory.length} групп` : 'подтверждено отсутствие'),
    storageReady ? [] : [inventory?.length ? 'Уточнить категории, количество и источник' : 'Добавить инвентарь или подтвердить отсутствие'],
  ));

  const furniture = allFurniture(project, itemIds);
  const catalogKnown = furniture.filter((item) => {
    const geometrySourceReady = item.geometryStatus === 'parametric_custom'
      || (item.geometryStatus === 'verified_sku' && text(item.sku) && text(item.sourceUrl));
    // Габарит корпуса недостаточен для производственных проверок: ручки и
    // свесы должны быть явно включены в подтверждённую плановую проекцию.
    const geometryReady = geometrySourceReady && item.planProjectionVerified === true;
    const manualReady = item.manualStatus === 'not_required'
      || (item.manualStatus === 'verified'
        && (item.manualConstraints || []).every((constraint) => constraint.status === 'verified'));
    return geometryReady && manualReady;
  }).length;
  const manualStatus = furniture.length === 0 ? 'not_applicable'
    : catalogKnown === furniture.length ? 'ready' : catalogKnown > 0 ? 'partial' : 'missing';
  sections.push(readinessSection(
    'manuals', 'Модели и паспорта', manualStatus,
    furniture.length ? `${catalogKnown} из ${furniture.length} изделий подтверждены` : 'в комнате нет мебели',
    manualStatus === 'ready' || manualStatus === 'not_applicable'
      ? []
      : ['Указать статус геометрии, SKU/источник, подтвердить полную проекцию с ручками/свесами и паспортные зазоры'],
  ));

  const unresolved = brief.uncertainty.filter((entry) => entry.status !== 'resolved').length;
  sections.push(readinessSection(
    'uncertainty', 'Неопределённости', unresolved ? 'partial' : 'ready',
    unresolved ? `${unresolved} требуют уточнения` : (brief.uncertainty.length ? 'все сняты' : 'явно не зафиксированы'),
    unresolved ? ['Разрешить или оставить отмеченными в отчёте'] : [], false,
  ));

  const required = sections.filter((section) => section.required && section.status !== 'not_applicable');
  const ready = required.filter((section) => section.status === 'ready').length;
  return {
    brief,
    sections,
    ready,
    total: required.length,
    complete: ready === required.length,
    missing: sections.filter((section) => section.required && !['ready', 'not_applicable'].includes(section.status)),
    unresolvedUncertainty: unresolved,
  };
}

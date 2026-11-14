// Детерминированный оркестратор авторасстановки для всего проекта.
//
// Комнатный решатель остаётся единственным источником позиций: этот модуль
// обходит этажи и помещения, при необходимости создаёт типовой набор мебели
// в рабочей копии, независимо перепроверяет каждый локальный вариант и
// собирает ограниченное число вариантов дома. Исходный project не меняется.

import {
  generateFurnitureLayouts as planRoomLayout,
  validateFurnitureLayout,
} from './autolayout.js';
import { isStructural } from './catalog.js';
import { defaultItemsFor, itemsInRoom } from './furnish.js';
import { evaluateLayoutScenarios } from './layout-scenarios.js';
import { cloneProject, levelProject } from './model.js';
import { deriveWalls } from './walls.js';

export const WHOLE_HOME_LAYOUT_VERSION = '1.0.0';

export class StaleWholeHomeLockError extends Error {
  constructor(itemIds) {
    super(`Закреплённые предметы изменились после расчёта: ${itemIds.join(', ')}`);
    this.name = 'StaleWholeHomeLockError';
    this.code = 'STALE_LAYOUT_LOCK';
    this.itemIds = [...itemIds];
  }
}

const DEFAULT_VARIANTS = 3;
const DEFAULT_MAX_EXPANSIONS = 10_000;
const MAX_LOCAL_VARIANTS = 6;

const textCompare = (a, b) => {
  const aa = String(a ?? '');
  const bb = String(b ?? '');
  return aa < bb ? -1 : aa > bb ? 1 : 0;
};

const clampInt = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
};

const finiteBudget = (value, fallback = Infinity) => {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
};

function valueSet(value) {
  if (value == null) return new Set();
  if (typeof value === 'string') return new Set([value]);
  try {
    return new Set(value);
  } catch {
    return new Set();
  }
}

function mappedValue(source, primaryKey, fallbackKey = null) {
  if (!source) return undefined;
  if (source instanceof Map) {
    if (source.has(primaryKey)) return source.get(primaryKey);
    return fallbackKey != null ? source.get(fallbackKey) : undefined;
  }
  if (Object.hasOwn(source, primaryKey)) return source[primaryKey];
  if (fallbackKey != null && Object.hasOwn(source, fallbackKey)) return source[fallbackKey];
  return undefined;
}

function cloneRecord(value) {
  return structuredClone(value);
}

function sortedLevels(project) {
  return [...(project.levels || [])].sort((a, b) => {
    const elevation = (Number(a.elevation) || 0) - (Number(b.elevation) || 0);
    return elevation || textCompare(a.id, b.id);
  });
}

function sortedRooms(level) {
  return [...(level.rooms || [])].sort((a, b) => textCompare(a.id, b.id));
}

function roomKey(levelId, roomId) {
  return `${levelId}:${roomId}`;
}

function collectRoomEntries(project) {
  const entries = [];
  for (const level of sortedLevels(project)) {
    const view = levelProject(project, level.id);
    for (const room of sortedRooms(level)) {
      entries.push({
        key: roomKey(level.id, room.id),
        level,
        levelId: level.id,
        levelName: level.name || level.id,
        project: view,
        room,
        roomId: room.id,
        itemIds: [],
        seedItems: [],
      });
    }
  }
  return entries;
}

// В старых проектах верхнеуровневые комнаты могут геометрически
// перекрываться. Один предмет всё равно должен попасть только в один запуск
// решателя: сначала выбираем вложенную/меньшую комнату, затем стабильный id.
function assignExistingItems(entries) {
  const claimed = new Set();
  const byLevel = new Map();
  for (const entry of entries) {
    if (!byLevel.has(entry.levelId)) byLevel.set(entry.levelId, []);
    byLevel.get(entry.levelId).push(entry);
  }
  for (const levelEntries of byLevel.values()) {
    const claimOrder = [...levelEntries].sort((a, b) => {
      const nested = Number(Boolean(b.room.parentId)) - Number(Boolean(a.room.parentId));
      const area = (Number(a.room.w) || 0) * (Number(a.room.h) || 0)
        - (Number(b.room.w) || 0) * (Number(b.room.h) || 0);
      return nested || area || textCompare(a.key, b.key);
    });
    for (const entry of claimOrder) {
      const members = itemsInRoom(entry.project, entry.room)
        .filter((item) => !claimed.has(item.id))
        .sort((a, b) => textCompare(a.id, b.id));
      for (const item of members) {
        claimed.add(item.id);
        entry.itemIds.push(item.id);
      }
    }
  }
  const allItemIds = new Set((entries[0]?.project.levels || [])
    .flatMap((level) => level.items || []).map((item) => item.id));
  return {
    claimed,
    unassignedItemIds: [...allItemIds].filter((id) => !claimed.has(id)).sort(textCompare),
  };
}

function uniqueSeedId(occupied, entry, index) {
  const base = `auto-seed:${entry.levelId}:${entry.roomId}:${index + 1}`;
  let id = base;
  let suffix = 2;
  while (occupied.has(id)) {
    id = `${base}:${suffix}`;
    suffix += 1;
  }
  occupied.add(id);
  return id;
}

function itemRecord(item, entry) {
  return { ...cloneRecord(item), levelId: entry.levelId, roomId: entry.roomId };
}

function seedEntry(entry, occupied, enabled) {
  if (!enabled) return;
  const byId = new Map((entry.level.items || []).map((item) => [item.id, item]));
  const assigned = entry.itemIds.map((id) => byId.get(id)).filter(Boolean);
  if (assigned.some((item) => !isStructural(item.kind))) return;
  const seeds = defaultItemsFor(entry.room, { layoutBrief: entry.project.layoutBrief });
  for (let index = 0; index < seeds.length; index += 1) {
    const item = seeds[index];
    item.id = uniqueSeedId(occupied, entry, index);
    entry.level.items.push(item);
    entry.itemIds.push(item.id);
    entry.seedItems.push(itemRecord(item, entry));
  }
  entry.itemIds.sort(textCompare);
}

function compactRoute(route) {
  if (!route) return null;
  return {
    ok: route.ok,
    unknown: route.unknown,
    minWidth: route.minWidth,
    ...(route.reason ? { reason: route.reason } : {}),
  };
}

function compactValidation(validation) {
  return {
    ok: validation.ok,
    checks: cloneRecord(validation.checks || []),
    route: compactRoute(validation.route),
    ruleSummary: cloneRecord(validation.ruleSummary || null),
    unsupported: [...(validation.unsupported || [])],
  };
}

function seedsAtPlacements(seedItems, placements) {
  const poses = new Map((placements || []).map((pose) => [pose.itemId, pose]));
  return seedItems.map((record) => {
    const pose = poses.get(record.id);
    if (!pose) return cloneRecord(record);
    return { ...cloneRecord(record), x: pose.x, y: pose.y, rotation: pose.rotation };
  });
}

function lockSnapshot(item, entry) {
  return {
    itemId: item.id,
    levelId: entry.levelId,
    roomId: entry.roomId,
    x: item.x,
    y: item.y,
    rotation: item.rotation || 0,
    ...(item.layoutState ? { state: item.layoutState } : {}),
  };
}

function emptyLayout(entry) {
  return {
    id: `empty:${entry.key}`,
    label: 'Без мебели',
    profile: 'empty',
    score: 0,
    placements: [],
    metrics: {},
    checks: [],
    ruleResults: [],
    ruleSummary: null,
    unknowns: [],
    seedItems: [],
    validation: {
      ok: true,
      checks: [],
      route: { ok: true, unknown: true, minWidth: null },
      ruleSummary: null,
      unsupported: [],
    },
  };
}

function localOptions(options, entry, itemIds, lockedIds, requestedVariants) {
  const common = options.roomOptions && typeof options.roomOptions === 'object'
    ? options.roomOptions : {};
  const specific = mappedValue(options.roomOptionsById, entry.key, entry.roomId);
  const merged = { ...common, ...(specific && typeof specific === 'object' ? specific : {}) };
  const count = clampInt(merged.count, Math.min(requestedVariants, MAX_LOCAL_VARIANTS), 1, MAX_LOCAL_VARIANTS);
  return { ...merged, count, itemIds, lockedIds };
}

function explicitRoomLocks(options, entry) {
  const locks = valueSet(options.lockedIds);
  const local = mappedValue(options.lockedIdsByRoom, entry.key, entry.roomId);
  for (const id of valueSet(local)) locks.add(id);
  return locks;
}

function planEntry(entry, options, requestedVariants) {
  const itemIds = [...entry.itemIds].sort(textCompare);
  if (!itemIds.length) {
    return {
      levelId: entry.levelId,
      levelName: entry.levelName,
      roomId: entry.roomId,
      roomName: entry.room.name || entry.room.type || entry.roomId,
      roomType: entry.room.type,
      status: 'empty',
      seeded: false,
      seedItems: [],
      itemIds: [],
      lockedIds: [],
      lockedPlacements: [],
      layouts: [emptyLayout(entry)],
      diagnostics: [],
      coverage: null,
    };
  }

  const byId = new Map((entry.level.items || []).map((item) => [item.id, item]));
  const explicit = explicitRoomLocks(options, entry);
  const lockedIds = itemIds.filter((id) => {
    const item = byId.get(id);
    return explicit.has(id) || item?.autoLayoutLocked === true || item?.layoutLocked === true
      || isStructural(item?.kind);
  });
  const lockedPlacements = lockedIds.map((id) => lockSnapshot(byId.get(id), entry));
  const walls = deriveWalls(entry.project);
  const result = planRoomLayout(
    entry.project,
    entry.room,
    walls,
    localOptions(options, entry, itemIds, lockedIds, requestedVariants),
  );
  const diagnostics = [...(result.diagnostics || [])];
  const layouts = [];

  for (const layout of result.layouts || []) {
    const validation = validateFurnitureLayout(entry.project, entry.room, walls, layout, { itemIds, lockedIds });
    if (!validation.ok) {
      diagnostics.push(`Вариант «${layout.label || layout.id}» отклонён повторной проверкой`);
      continue;
    }
    layouts.push({
      ...cloneRecord(layout),
      seedItems: seedsAtPlacements(entry.seedItems, layout.placements),
      validation: compactValidation(validation),
    });
  }

  return {
    levelId: entry.levelId,
    levelName: entry.levelName,
    roomId: entry.roomId,
    roomName: entry.room.name || entry.room.type || entry.roomId,
    roomType: entry.room.type,
    status: layouts.length ? 'feasible' : result.status === 'insufficient_data'
      ? 'insufficient_data' : 'search_budget_exhausted',
    seeded: entry.seedItems.length > 0,
    seedItems: cloneRecord(entry.seedItems),
    itemIds,
    lockedIds,
    lockedPlacements,
    layouts,
    diagnostics,
    coverage: cloneRecord(result.coverage || null),
  };
}

function layoutOrder(a, b) {
  const score = (Number(b.score) || 0) - (Number(a.score) || 0);
  return score || textCompare(a.profile, b.profile) || textCompare(a.id, b.id);
}

function stateOrder(a, b) {
  return b.scoreSum - a.scoreSum || textCompare(a.signature, b.signature);
}

function cancelled(options, budget, phase) {
  if (options.signal?.aborted) return true;
  return typeof options.shouldCancel === 'function' && options.shouldCancel({
    phase,
    roomsVisited: budget.roomsVisited,
    roomsTotal: budget.roomsTotal,
    expansions: budget.expansions,
  }) === true;
}

function progress(options, event) {
  if (typeof options.onProgress === 'function') options.onProgress(event);
}

function projectVariant(state, index) {
  const rooms = state.choices.map(({ room, layout }) => ({
    levelId: room.levelId,
    roomId: room.roomId,
    layoutId: layout.id,
    profile: layout.profile,
    score: Number(layout.score) || 0,
    placements: layout.placements.map((pose) => ({ ...pose, levelId: room.levelId, roomId: room.roomId })),
    seedItems: cloneRecord(layout.seedItems || []),
    validation: cloneRecord(layout.validation),
  }));
  const placements = rooms.flatMap((room) => room.placements);
  const seedItems = rooms.flatMap((room) => room.seedItems);
  const lockedPlacements = state.choices.flatMap(({ room }) => cloneRecord(room.lockedPlacements));
  const checks = rooms.flatMap((room) => room.validation?.checks || []);
  const checkedRooms = Math.max(1, rooms.length);
  return {
    id: `whole-home-${index + 1}`,
    label: `Вариант дома ${index + 1}`,
    score: Math.round((state.scoreSum / checkedRooms) * 100) / 100,
    complete: true,
    placements,
    seedItems,
    lockedPlacements,
    rooms,
    summary: {
      rooms: rooms.length,
      items: placements.length,
      seedItems: seedItems.length,
      lockedItems: lockedPlacements.length,
      passedChecks: checks.filter((check) => check.status === 'pass').length,
      failedChecks: checks.filter((check) => check.status === 'fail').length,
      unknownChecks: checks.filter((check) => check.status === 'unknown').length,
    },
  };
}

function composeVariants(roomResults, limit, maxExpansions, options, budget) {
  if (limit < 1) {
    return { variants: [], complete: false, exhausted: true, reason: 'max_variants' };
  }
  let states = [{ choices: [], scoreSum: 0, signature: '' }];
  for (let roomIndex = 0; roomIndex < roomResults.length; roomIndex += 1) {
    const room = roomResults[roomIndex];
    const layouts = [...room.layouts].sort(layoutOrder);
    const next = [];
    let stopped = false;
    for (const state of states) {
      for (const layout of layouts) {
        if (cancelled(options, budget, 'compose')) {
          return { variants: [], complete: false, cancelled: true, reason: 'cancelled' };
        }
        if (budget.expansions >= maxExpansions) {
          stopped = true;
          break;
        }
        budget.expansions += 1;
        const token = `${room.levelId}/${room.roomId}/${layout.id}`;
        next.push({
          choices: [...state.choices, { room, layout }],
          scoreSum: state.scoreSum + (Number(layout.score) || 0),
          signature: state.signature ? `${state.signature}|${token}` : token,
        });
      }
      if (stopped) break;
    }
    if (!next.length) return { variants: [], complete: false, exhausted: true, reason: 'max_expansions' };
    const unique = new Map();
    for (const state of next.sort(stateOrder)) if (!unique.has(state.signature)) unique.set(state.signature, state);
    states = [...unique.values()].slice(0, limit);
    const completedRooms = roomIndex + 1;
    progress(options, {
      phase: 'compose',
      completed: completedRooms,
      total: roomResults.length,
      variants: states.length,
      expansions: budget.expansions,
    });
    if (stopped) {
      const complete = completedRooms === roomResults.length;
      return {
        variants: complete ? states.map(projectVariant) : [],
        complete,
        exhausted: true,
        reason: 'max_expansions',
      };
    }
  }
  return { variants: states.map(projectVariant), complete: true, exhausted: false, reason: null };
}

function publicBudget(budget) {
  return {
    maxRooms: Number.isFinite(budget.maxRooms) ? budget.maxRooms : null,
    maxVariants: budget.maxVariants,
    maxExpansions: Number.isFinite(budget.maxExpansions) ? budget.maxExpansions : null,
    roomsTotal: budget.roomsTotal,
    roomsVisited: budget.roomsVisited,
    expansions: budget.expansions,
    exhausted: budget.exhausted,
    cancelled: budget.cancelled,
    reason: budget.reason,
  };
}

function makeSummary(project, targetRooms, rooms, variants, assignment, budget, status) {
  const counts = {};
  for (const room of rooms) counts[room.status] = (counts[room.status] || 0) + 1;
  const locked = new Set(rooms.flatMap((room) => room.lockedIds));
  const seedItems = rooms.reduce((sum, room) => sum + room.seedItems.length, 0);
  return {
    version: WHOLE_HOME_LAYOUT_VERSION,
    projectLevels: project.levels?.length || 0,
    projectRooms: (project.levels || []).reduce((sum, level) => sum + (level.rooms?.length || 0), 0),
    selectedRooms: targetRooms.length,
    processedRooms: rooms.length,
    unprocessedRooms: Math.max(0, targetRooms.length - rooms.length),
    roomStatusCounts: counts,
    seededRooms: rooms.filter((room) => room.seeded).length,
    seedItems,
    lockedItems: locked.size,
    unassignedItems: assignment.unassignedItemIds.length,
    variants: variants.length,
    bestScore: variants[0]?.score ?? null,
    complete: status === 'feasible' && rooms.length === targetRooms.length,
    budget: publicBudget(budget),
  };
}

function resultObject(project, targetRooms, rooms, variants, diagnostics, assignment, budget, status) {
  return {
    status,
    variants,
    rooms,
    summary: makeSummary(project, targetRooms, rooms, variants, assignment, budget, status),
    scenarioEvaluation: evaluateLayoutScenarios(project?.layoutBrief, project),
    diagnostics,
    budget: publicBudget(budget),
  };
}

const normalizedAngle = (value) => {
  const number = Number(value) || 0;
  return ((number % 360) + 360) % 360;
};

const angleDistance = (a, b) => {
  const delta = Math.abs(normalizedAngle(a) - normalizedAngle(b));
  return Math.min(delta, 360 - delta);
};

function staleLockedItems(project, variant) {
  const levels = new Map((project.levels || []).map((level) => [level.id, level]));
  const stale = [];
  for (const lock of variant?.lockedPlacements || []) {
    const level = levels.get(lock.levelId);
    const item = level?.items?.find((candidate) => candidate.id === lock.itemId);
    const state = item?.layoutState || 'default';
    const expectedState = lock.state || 'default';
    if (!item || Math.abs((Number(item.x) || 0) - (Number(lock.x) || 0)) > 0.5
      || Math.abs((Number(item.y) || 0) - (Number(lock.y) || 0)) > 0.5
      || angleDistance(item.rotation, lock.rotation) > 0.001 || state !== expectedState) {
      stale.push(String(lock.itemId));
    }
  }
  return [...new Set(stale)].sort(textCompare);
}

function seedProjectItem(record) {
  const { levelId: _levelId, roomId: _roomId, ...item } = cloneRecord(record);
  return item;
}

/**
 * Применяет уже выбранный вариант. UI должен обернуть один вызов в mutate(),
 * чтобы добавление seed-мебели и все перемещения стали одним шагом истории.
 * Locks проверяются до первой записи в project.
 */
export function applyWholeHomeLayout(project, variant) {
  const stale = staleLockedItems(project || {}, variant);
  if (stale.length) throw new StaleWholeHomeLockError(stale);

  const result = { added: [], moved: [], skipped: [] };
  if (!project || !Array.isArray(project.levels) || !variant) {
    result.skipped.push({ id: null, reason: 'invalid_input' });
    return result;
  }

  const levels = new Map(project.levels.map((level) => [level.id, level]));
  const existing = new Map();
  for (const level of project.levels) {
    for (const item of level.items || []) {
      if (!existing.has(item.id)) existing.set(item.id, level.id);
    }
  }

  for (const seed of variant.seedItems || []) {
    const id = seed?.id;
    const level = levels.get(seed?.levelId);
    if (!id || !level) {
      result.skipped.push({ id: id || null, reason: level ? 'invalid_seed' : 'level_not_found' });
      continue;
    }
    if (existing.has(id)) {
      result.skipped.push({ id, reason: existing.get(id) === seed.levelId ? 'seed_exists' : 'seed_exists_other_level' });
      continue;
    }
    if (!Array.isArray(level.items)) level.items = [];
    level.items.push(seedProjectItem(seed));
    existing.set(id, level.id);
    result.added.push(id);
  }

  const positioned = new Set();
  for (const pose of variant.placements || []) {
    const id = pose?.itemId;
    const level = levels.get(pose?.levelId);
    if (!id || !level) {
      result.skipped.push({ id: id || null, reason: level ? 'invalid_placement' : 'level_not_found' });
      continue;
    }
    if (positioned.has(id)) {
      result.skipped.push({ id, reason: 'duplicate_placement' });
      continue;
    }
    const item = (level.items || []).find((candidate) => candidate.id === id);
    if (!item) {
      result.skipped.push({ id, reason: existing.has(id) ? 'item_on_other_level' : 'item_not_found' });
      continue;
    }
    if (![pose.x, pose.y, pose.rotation].every((value) => Number.isFinite(Number(value)))) {
      result.skipped.push({ id, reason: 'invalid_placement' });
      continue;
    }
    item.x = Number(pose.x);
    item.y = Number(pose.y);
    item.rotation = Number(pose.rotation);
    positioned.add(id);
    result.moved.push(id);
  }
  return result;
}

/**
 * Строит несколько проверенных вариантов мебели для всех выбранных комнат.
 * Функция синхронная и не изменяет project. Отмена проверяется между
 * комнатными запусками и во время композиции вариантов.
 *
 * @returns {{status:string, variants:Array, rooms:Array, summary:object,
 *   diagnostics:Array<string>, budget:object}}
 */
export function planWholeHomeLayout(project, options = {}) {
  const requestedVariants = clampInt(options.count, DEFAULT_VARIANTS, 1, 24);
  const maxVariants = finiteBudget(options.maxVariants, requestedVariants);
  const maxRooms = finiteBudget(options.maxRooms);
  const maxExpansions = finiteBudget(options.maxExpansions, DEFAULT_MAX_EXPANSIONS);
  const budget = {
    maxRooms,
    maxVariants,
    maxExpansions,
    roomsTotal: 0,
    roomsVisited: 0,
    expansions: 0,
    exhausted: false,
    cancelled: false,
    reason: null,
  };
  const diagnostics = [];
  const emptyAssignment = { unassignedItemIds: [] };

  if (!project || !Array.isArray(project.levels)) {
    diagnostics.push('Проект не содержит этажей');
    return resultObject(project || {}, [], [], [], diagnostics, emptyAssignment, budget, 'insufficient_data');
  }

  const workProject = cloneProject(project);
  const allEntries = collectRoomEntries(workProject);
  const roomFilter = options.roomIds == null ? null : valueSet(options.roomIds);
  const targetRooms = allEntries.filter((entry) => !roomFilter || roomFilter.has(entry.roomId));
  budget.roomsTotal = targetRooms.length;
  if (roomFilter) {
    const found = new Set(targetRooms.map((entry) => entry.roomId));
    const missing = [...roomFilter].filter((id) => !found.has(id)).sort(textCompare);
    if (missing.length) {
      diagnostics.push(`Комнаты не найдены: ${missing.join(', ')}`);
      return resultObject(project, targetRooms, [], [], diagnostics, emptyAssignment, budget, 'insufficient_data');
    }
  }
  if (!targetRooms.length) {
    diagnostics.push('В проекте нет выбранных комнат');
    return resultObject(project, targetRooms, [], [], diagnostics, emptyAssignment, budget, 'insufficient_data');
  }

  const assignment = assignExistingItems(allEntries);
  const occupied = new Set(workProject.levels.flatMap((level) => level.items || []).map((item) => item.id));
  const rooms = [];
  progress(options, { phase: 'start', completed: 0, total: targetRooms.length });

  for (const entry of targetRooms) {
    if (cancelled(options, budget, 'rooms')) {
      budget.cancelled = true;
      budget.reason = 'cancelled';
      diagnostics.push('Расстановка отменена');
      return resultObject(project, targetRooms, rooms, [], diagnostics, assignment, budget, 'cancelled');
    }
    if (budget.roomsVisited >= maxRooms) {
      budget.exhausted = true;
      budget.reason = 'max_rooms';
      diagnostics.push(`Достигнут лимит комнат: ${maxRooms} из ${targetRooms.length}`);
      return resultObject(project, targetRooms, rooms, [], diagnostics, assignment, budget, 'search_budget_exhausted');
    }
    seedEntry(entry, occupied, options.seedEmptyRooms !== false);
    const roomResult = planEntry(entry, options, requestedVariants);
    rooms.push(roomResult);
    budget.roomsVisited += 1;
    diagnostics.push(...roomResult.diagnostics.map((message) => `${entry.levelName} / ${roomResult.roomName}: ${message}`));
    progress(options, {
      phase: 'rooms',
      completed: rooms.length,
      total: targetRooms.length,
      levelId: entry.levelId,
      roomId: entry.roomId,
      status: roomResult.status,
    });
  }

  if (cancelled(options, budget, 'compose')) {
    budget.cancelled = true;
    budget.reason = 'cancelled';
    diagnostics.push('Расстановка отменена');
    return resultObject(project, targetRooms, rooms, [], diagnostics, assignment, budget, 'cancelled');
  }

  const failed = rooms.filter((room) => !['feasible', 'empty'].includes(room.status));
  if (failed.length) {
    const localBudget = failed.some((room) => room.status === 'search_budget_exhausted');
    if (localBudget) {
      budget.exhausted = true;
      budget.reason = 'room_search';
    }
    const status = localBudget ? 'search_budget_exhausted' : 'insufficient_data';
    return resultObject(project, targetRooms, rooms, [], diagnostics, assignment, budget, status);
  }

  const variantLimit = Math.min(requestedVariants, maxVariants);
  const composed = composeVariants(rooms, variantLimit, maxExpansions, options, budget);
  if (composed.cancelled) {
    budget.cancelled = true;
    budget.reason = 'cancelled';
    diagnostics.push('Расстановка отменена');
    return resultObject(project, targetRooms, rooms, [], diagnostics, assignment, budget, 'cancelled');
  }
  if (composed.exhausted || maxVariants < requestedVariants) {
    budget.exhausted = true;
    budget.reason = composed.reason || 'max_variants';
    if (budget.reason === 'max_expansions') diagnostics.push(`Достигнут лимит комбинаций: ${maxExpansions}`);
    else if (budget.reason === 'max_variants') diagnostics.push(`Достигнут лимит вариантов: ${maxVariants}`);
  }
  const status = budget.exhausted ? 'search_budget_exhausted' : 'feasible';
  progress(options, {
    phase: 'done',
    completed: targetRooms.length,
    total: targetRooms.length,
    variants: composed.variants.length,
    status,
  });
  return resultObject(project, targetRooms, rooms, composed.variants, diagnostics, assignment, budget, status);
}

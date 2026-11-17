// «Программа дома»: объяснимые цели по помещениям и проверяемые связи.
// Модуль ничего не размещает и не мутирует. Неизвестное остаётся unknown:
// предварительная рекомендация не подменяет подтверждённое задание.

import { roomType } from './catalog.js';
import { HOME_PROGRAM_OPTION_KEYS, normalizeHomeProgram } from './layout-brief.js';
import { isUpperLevel, levelProject } from './model.js';
import { analyzeConnectivity, roomNetAreaM2 } from './rooms.js';
import { projectAdjacencies } from './walls.js';

export { normalizeHomeProgram };

const SOCIAL_MODES = new Set(['combined', 'separate']);
const BEDROOM_TYPES = Object.freeze(['bedroom', 'master-bedroom', 'kids-room']);
const BATHROOM_TYPES = Object.freeze(['bathroom', 'shower-room', 'tub-room']);
const BEDROOM_TARGETS = Object.freeze({
  main: Object.freeze({ id: 'bedrooms-main', title: 'Основные спальни', types: ['master-bedroom'], canonical: 'master-bedroom' }),
  adult: Object.freeze({ id: 'bedrooms-adult', title: 'Обычные спальни', types: ['bedroom'], canonical: 'bedroom' }),
  child: Object.freeze({ id: 'bedrooms-child', title: 'Детские спальни', types: ['kids-room'], canonical: 'kids-room' }),
  guest: Object.freeze({ id: 'bedrooms-guest', title: 'Гостевые спальни', types: ['guest-bedroom'], canonical: 'guest-bedroom' }),
});

const OPTION_TARGETS = Object.freeze({
  guestBedroom: Object.freeze({ id: 'guest-bedroom', title: 'Гостевая спальня', types: ['guest-bedroom'], canonical: 'guest-bedroom' }),
  office: Object.freeze({ id: 'office', title: 'Кабинет', types: ['cabinet'], canonical: 'cabinet' }),
  laundry: Object.freeze({ id: 'laundry', title: 'Постирочная', types: ['laundry'], canonical: 'laundry' }),
  pantry: Object.freeze({ id: 'pantry', title: 'Кладовая продуктов', types: ['pantry'], canonical: 'pantry' }),
  wardrobe: Object.freeze({ id: 'wardrobe', title: 'Гардеробная', types: ['wardrobe-room'], canonical: 'wardrobe-room' }),
  guestWc: Object.freeze({ id: 'guest-wc', title: 'Гостевой санузел', types: ['guest-wc'], canonical: 'guest-wc' }),
  garage: Object.freeze({ id: 'garage', title: 'Гараж', types: ['garage'], canonical: 'garage' }),
  terrace: Object.freeze({ id: 'terrace', title: 'Терраса', types: ['terrace'], canonical: 'terrace' }),
});

const ROLE_TYPES = Object.freeze({
  entrance: ['entrance'],
  public: ['living', 'dining', 'kitchen-living'],
  livingDining: ['living', 'dining', 'kitchen-living'],
  kitchen: ['kitchen', 'kitchen-living'],
  bedroom: BEDROOM_TYPES,
  bathroom: BATHROOM_TYPES,
  pantry: ['pantry'],
  wardrobe: ['wardrobe-room'],
  guestWc: ['guest-wc'],
  garage: ['garage'],
  terrace: ['terrace', 'veranda'],
  laundry: ['laundry'],
  entryHall: ['entrance', 'hall'],
  garageSupport: ['entrance', 'hall', 'boiler', 'laundry', 'storage', 'tech', 'workshop'],
});

const emptyOptions = () => Object.fromEntries(HOME_PROGRAM_OPTION_KEYS.map((key) => [key, null]));
const finiteInteger = (value) => value != null && value !== '' && Number.isFinite(Number(value))
  ? Math.round(Number(value)) : null;
const unique = (values) => [...new Set(values.filter(Boolean))];
const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

function defaultArea(type) {
  const definition = roomType(type);
  return definition ? (definition.w * definition.h) / 1_000_000 : 0;
}

function roomRecords(project) {
  const levels = Array.isArray(project?.levels) ? project.levels : [];
  const result = [];
  for (const level of levels) {
    const view = levelProject(project, level.id);
    for (const room of level.rooms || []) {
      const areaM2 = (() => {
        try { return roomNetAreaM2(view, room); } catch { return 0; }
      })();
      result.push({
        id: room.id,
        levelId: level.id,
        levelName: level.name,
        name: room.name,
        type: room.type,
        areaM2,
        room,
      });
    }
  }
  return result;
}

function explicitSource(value, fallback, confirmed) {
  if (value != null && value !== 'unknown') return confirmed ? 'confirmed' : 'draft';
  return fallback != null && fallback !== 'unknown' ? 'suggested' : 'unknown';
}

function mergeProgram(input, suggested) {
  const options = emptyOptions();
  for (const key of HOME_PROGRAM_OPTION_KEYS) {
    options[key] = input?.options?.[key] ?? suggested.options[key];
  }
  return {
    confirmed: input?.confirmed === true,
    socialMode: input?.socialMode && input.socialMode !== 'unknown'
      ? input.socialMode : suggested.socialMode,
    bedroomCount: input?.bedroomCount ?? suggested.bedroomCount,
    bedrooms: Array.isArray(input?.bedrooms) ? input.bedrooms : suggested.bedrooms,
    bathroomCount: input?.bathroomCount ?? suggested.bathroomCount,
    options,
  };
}

function suggestedBedrooms(count, childCount) {
  if (!(count > 0)) return null;
  const children = Math.min(Math.max(0, count - 1), Math.ceil(Math.max(0, childCount || 0) / 2));
  return Array.from({ length: count }, (_, index) => ({
    id: `bedroom-${index + 1}`,
    kind: index === 0 ? 'main' : index <= children ? 'child' : 'adult',
    ensuite: null,
    wardrobe: null,
  }));
}

/**
 * Предварительная, не сохраняемая рекомендация по известному составу семьи.
 * @returns {{status:'unknown'|'preliminary', program:object, facts:object, reasons:object, warnings:string[]}}
 */
export function suggestHomeProgram(project = {}) {
  const actors = Array.isArray(project?.layoutBrief?.actors) ? project.layoutBrief.actors : [];
  const capacity = project?.layoutBrief?.capacity || {};
  const adultCount = finiteInteger(capacity.adultCount);
  const childCount = finiteInteger(capacity.childCount);
  const householdCount = adultCount != null || childCount != null
    ? Math.max(0, adultCount || 0) + Math.max(0, childCount || 0) : null;
  const occupants = actors.length || householdCount || null;
  const dailySeats = finiteInteger(capacity.dailySeats);
  const guestSeats = finiteInteger(capacity.guestSeats);
  const storedGuestCount = finiteInteger(capacity.guestCount);
  const guestCount = storedGuestCount != null ? Math.max(0, storedGuestCount)
    : dailySeats != null && guestSeats != null ? Math.max(0, guestSeats - dailySeats) : null;
  const bedroomCount = occupants ? Math.max(1, Math.ceil(occupants / 2)) : null;
  const program = {
    confirmed: false,
    socialMode: occupants ? 'combined' : 'unknown',
    bedroomCount,
    bedrooms: suggestedBedrooms(bedroomCount, childCount),
    bathroomCount: occupants ? Math.max(1, Math.ceil(occupants / 4)) : null,
    options: emptyOptions(),
  };
  const reasons = {};
  if (occupants) {
    reasons.socialMode = 'Объединённая общественная зона предложена как компактная отправная точка — её можно изменить.';
    reasons.bedroomCount = `Предварительно по два жильца на спальню: ${occupants} чел. → ${program.bedroomCount}. Состав семей и режим сна нужно подтвердить.`;
    reasons.bathroomCount = `Предварительно один основной санузел на четыре жильца: ${occupants} чел. → ${program.bathroomCount}.`;
    if (occupants >= 3) {
      program.options.laundry = true;
      reasons.laundry = 'Для трёх и более жильцов предложена отдельная постирочная.';
    }
    if (occupants >= 4 || dailySeats >= 4) {
      program.options.pantry = true;
      reasons.pantry = 'Для большой семьи или четырёх ежедневных мест предложена кладовая продуктов.';
    }
    if (occupants >= 2) {
      program.options.wardrobe = true;
      reasons.wardrobe = 'Для двух и более жильцов предложена отдельная гардеробная.';
    }
  }
  if (guestCount >= 4) {
    program.options.guestWc = true;
    reasons.guestWc = 'Если одновременно приходят четыре и более гостей, предложен гостевой санузел.';
  }
  const warnings = [];
  if (!occupants) warnings.push('Состав семьи не задан — число спален и санузлов не предлагается.');
  warnings.push('Рекомендация предварительная: отношения жильцов, ночующие гости, автомобили и образ жизни из плана не выводятся.');
  return {
    status: occupants ? 'preliminary' : 'unknown',
    program,
    facts: {
      occupants, adultCount, childCount, dailySeats, guestSeats, guestCount,
    },
    reasons,
    warnings,
  };
}

function makeTarget({ id, title, types, canonical, count, source, requirements = null }, records) {
  const matched = records.filter((record) => types.includes(record.type));
  const presentCount = matched.length;
  const targetAreaM2 = defaultArea(canonical) * count;
  const actualAreaM2 = matched.reduce((sum, room) => sum + room.areaM2, 0);
  const missingCount = Math.max(0, count - presentCount);
  const target = {
    id,
    title,
    roomTypes: [...types],
    canonicalType: canonical,
    addType: canonical,
    count,
    source,
    targetAreaM2,
    presentCount,
    actualAreaM2,
    missingCount,
    status: missingCount ? (presentCount ? 'partial' : 'missing') : 'done',
    rooms: matched.map(({ room: _room, ...room }) => room),
  };
  if (requirements) target.requirements = requirements;
  return target;
}

function targetList(input, suggestion, effective, records) {
  const confirmed = input?.confirmed === true;
  const targets = [];
  const add = (definition) => targets.push(makeTarget(definition, records));
  if (confirmed) {
    add({ id: 'entrance', title: 'Прихожая', types: ['entrance'], canonical: 'entrance', count: 1, source: 'confirmed' });
  }
  if (SOCIAL_MODES.has(effective.socialMode)) {
    const source = explicitSource(input?.socialMode, suggestion.socialMode, confirmed);
    if (effective.socialMode === 'combined') {
      add({ id: 'social-combined', title: 'Кухня-гостиная', types: ['kitchen-living'], canonical: 'kitchen-living', count: 1, source });
    } else {
      add({ id: 'living', title: 'Гостиная', types: ['living'], canonical: 'living', count: 1, source });
      add({ id: 'kitchen', title: 'Кухня', types: ['kitchen'], canonical: 'kitchen', count: 1, source });
    }
  }
  const explicitBedrooms = Array.isArray(input?.bedrooms) ? input.bedrooms : null;
  if (explicitBedrooms?.length) {
    for (const [kind, definition] of Object.entries(BEDROOM_TARGETS)) {
      const rows = explicitBedrooms.filter((bedroom) => bedroom.kind === kind);
      if (!rows.length) continue;
      add({
        ...definition,
        count: rows.length,
        source: confirmed ? 'confirmed' : 'draft',
        requirements: {
          ensuite: {
            required: rows.filter((bedroom) => bedroom.ensuite === true).length,
            notRequired: rows.filter((bedroom) => bedroom.ensuite === false).length,
            unknown: rows.filter((bedroom) => bedroom.ensuite == null).length,
            status: rows.some((bedroom) => bedroom.ensuite === true || bedroom.ensuite == null) ? 'unknown' : 'not_required',
          },
          wardrobe: {
            required: rows.filter((bedroom) => bedroom.wardrobe === true).length,
            notRequired: rows.filter((bedroom) => bedroom.wardrobe === false).length,
            unknown: rows.filter((bedroom) => bedroom.wardrobe == null).length,
          },
        },
      });
    }
  } else if (effective.bedroomCount != null) {
    add({
      id: 'bedrooms', title: 'Спальни жильцов', types: BEDROOM_TYPES,
      canonical: 'bedroom', count: effective.bedroomCount,
      source: explicitSource(input?.bedroomCount, suggestion.bedroomCount, confirmed),
    });
  }
  const bedroomEnsuites = explicitBedrooms?.filter((bedroom) => bedroom.ensuite === true).length || 0;
  if (effective.bathroomCount != null || bedroomEnsuites) {
    const commonBathrooms = Math.max(0, effective.bathroomCount || 0);
    add({
      id: 'bathrooms', title: bedroomEnsuites ? 'Санузлы — общие и при спальнях' : 'Основные санузлы', types: BATHROOM_TYPES,
      canonical: 'bathroom', count: commonBathrooms + bedroomEnsuites,
      source: explicitSource(input?.bathroomCount, suggestion.bathroomCount, confirmed),
      requirements: bedroomEnsuites ? { common: commonBathrooms, ensuite: bedroomEnsuites } : null,
    });
  }
  const bedroomWardrobes = explicitBedrooms?.filter((bedroom) => bedroom.wardrobe === true).length || 0;
  const explicitGuestBedroom = explicitBedrooms?.some((bedroom) => bedroom.kind === 'guest') || false;
  for (const key of HOME_PROGRAM_OPTION_KEYS) {
    if (key === 'guestBedroom' && explicitGuestBedroom) continue;
    if (key === 'wardrobe' && explicitBedrooms) {
      const count = bedroomWardrobes + (effective.options.wardrobe === true ? 1 : 0);
      if (count) {
        add({
          ...OPTION_TARGETS.wardrobe,
          title: bedroomWardrobes ? 'Гардеробные' : OPTION_TARGETS.wardrobe.title,
          count,
          source: confirmed ? 'confirmed' : 'draft',
        });
      }
      continue;
    }
    if (effective.options[key] !== true) continue;
    const definition = OPTION_TARGETS[key];
    add({
      ...definition,
      count: 1,
      source: explicitSource(input?.options?.[key], suggestion.options[key], confirmed),
    });
  }
  return targets;
}

function levelAnalyses(project, records) {
  const byLevel = new Map();
  const output = [];
  for (const level of project?.levels || []) {
    const view = levelProject(project, level.id);
    const connectivity = analyzeConnectivity(view);
    const adjacency = new Set(projectAdjacencies(view).map(({ a, b }) => pairKey(a.id, b.id)));
    const roomIds = new Set((view.rooms || []).map((room) => room.id));
    const roomsById = new Map((view.rooms || []).map((room) => [room.id, room]));
    const hasExteriorEntryRoot = [...(connectivity.graph.get('outside') || [])]
      .some((roomId) => ['entrance', 'vestibule'].includes(roomsById.get(roomId)?.type));
    const hasStairEntryRoot = Boolean(connectivity.graph.get('stairs')?.size);
    // Наружная дверь на верхнем этаже (например, на террасу) не заменяет
    // доказанный вертикальный маршрут из дома. Нижний и верхние этажи имеют
    // разные корни графа доступа.
    const hasEntryRoot = isUpperLevel(view) ? hasStairEntryRoot : hasExteriorEntryRoot;
    const data = { view, connectivity, adjacency, roomIds };
    byLevel.set(level.id, data);
    output.push({
      id: level.id,
      name: level.name,
      roomCount: roomIds.size,
      areaM2: records.filter((room) => room.levelId === level.id).reduce((sum, room) => sum + room.areaM2, 0),
      hasEntrance: connectivity.hasEntrance,
      hasEntryRoot,
      unreachableRoomIds: [...connectivity.unreachable],
    });
  }
  return { byLevel, output };
}

function roleRooms(records, role) {
  const types = ROLE_TYPES[role] || [];
  return records.filter((record) => types.includes(record.type));
}

function shortestPath(graph, start, targetIds, allowed) {
  if (targetIds.has(start)) return [start];
  const queue = [start];
  const previous = new Map([[start, null]]);
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) || []) {
      if (!allowed.has(next) || previous.has(next)) continue;
      previous.set(next, current);
      if (targetIds.has(next)) {
        const path = [next];
        let node = current;
        while (node != null) { path.push(node); node = previous.get(node); }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function sourceCheck(source, targets, analyses) {
  const sameLevel = targets.filter((target) => target.levelId === source.levelId);
  if (!sameLevel.length) {
    return {
      status: targets.length ? 'unknown' : 'unknown',
      levelId: null,
      fromRoomId: null,
      toRoomId: null,
      pathRoomIds: [],
      sourceRoomId: source.id,
      reason: targets.length
        ? 'Целевое помещение есть только на другом этаже; межэтажный маршрут не доказан.'
        : 'Целевое помещение ещё не создано.',
    };
  }
  const data = analyses.get(source.levelId);
  if (!data) {
    return { status: 'unknown', levelId: null, fromRoomId: null, toRoomId: null, pathRoomIds: [], sourceRoomId: source.id, reason: 'Нет данных этажа.' };
  }
  const targetIds = new Set(sameLevel.map((target) => target.id));
  if (targetIds.has(source.id)) {
    return {
      status: 'direct', levelId: source.levelId, fromRoomId: source.id, toRoomId: source.id,
      pathRoomIds: [source.id], sourceRoomId: source.id, reason: 'Функции объединены в одном помещении.',
    };
  }
  const direct = sameLevel.find((target) => data.connectivity.graph.get(source.id)?.has(target.id));
  if (direct) {
    return {
      status: 'direct', levelId: source.levelId, fromRoomId: source.id, toRoomId: direct.id,
      pathRoomIds: [source.id, direct.id], sourceRoomId: source.id, reason: 'Есть прямой проход.',
    };
  }
  const path = shortestPath(data.connectivity.graph, source.id, targetIds, data.roomIds);
  if (path) {
    return {
      status: 'reachable', levelId: source.levelId, fromRoomId: source.id, toRoomId: path.at(-1),
      pathRoomIds: path, sourceRoomId: source.id, reason: `Маршрут существует через ${Math.max(0, path.length - 2)} промежуточных помещений.`,
    };
  }
  const adjacent = sameLevel.find((target) => data.adjacency.has(pairKey(source.id, target.id)));
  if (adjacent) {
    return {
      status: 'adjacent_without_door', levelId: source.levelId, fromRoomId: source.id, toRoomId: adjacent.id,
      pathRoomIds: [], sourceRoomId: source.id, reason: 'Помещения граничат, но проход между ними не задан.',
    };
  }
  return {
    status: 'missing', levelId: source.levelId, fromRoomId: source.id, toRoomId: sameLevel[0].id,
    pathRoomIds: [], sourceRoomId: source.id, reason: 'На этом этаже нет доказанного маршрута между помещениями.',
  };
}

const STATUS_PRIORITY = Object.freeze({ direct: 0, reachable: 1, adjacent_without_door: 2, unknown: 3, missing: 4 });

function connectionResult(definition, records, analyses, required) {
  const sources = roleRooms(records, definition.from);
  const targets = roleRooms(records, definition.to);
  let checks = [];
  if (sources.length && targets.length) checks = sources.map((source) => sourceCheck(source, targets, analyses));
  const representative = checks.slice().sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status])[0] || null;
  const status = representative?.status || 'missing';
  const acceptable = status === 'direct' || (!definition.directPreferred && status === 'reachable');
  let reason = representative?.reason || '';
  if (!sources.length) reason = `Не создано исходное помещение: ${definition.fromTitle}.`;
  else if (!targets.length) reason = `Не создано целевое помещение: ${definition.toTitle}.`;
  else {
    if (definition.directPreferred && status === 'reachable') {
      reason = `${reason} Для этой функциональной связи нужен прямой проход.`;
    }
    if (checks.length > 1) {
      const bad = checks.filter((check) => !(check.status === 'direct' || (!definition.directPreferred && check.status === 'reachable'))).length;
      if (bad) reason = `${bad} из ${checks.length} исходных помещений требуют исправления. ${reason}`;
    }
  }
  return {
    id: definition.id,
    title: definition.title,
    label: definition.title,
    status,
    acceptable,
    required,
    directPreferred: definition.directPreferred === true,
    fromRole: definition.from,
    toRole: definition.to,
    fromTitle: definition.fromTitle,
    toTitle: definition.toTitle,
    sourceRoomIds: sources.map((room) => room.id),
    targetRoomIds: targets.map((room) => room.id),
    levelId: representative?.levelId ?? null,
    fromRoomId: representative?.fromRoomId ?? null,
    toRoomId: representative?.toRoomId ?? null,
    pathRoomIds: representative?.pathRoomIds || [],
    reason,
    checks,
    paths: checks,
  };
}

function connectionDefinitions(effective) {
  const definitions = [];
  if (SOCIAL_MODES.has(effective.socialMode)) {
    definitions.push({
      id: 'entrance-public', title: 'Прихожая → общественная зона',
      from: 'entrance', to: 'public', fromTitle: 'прихожая', toTitle: 'гостиная или кухня-гостиная', directPreferred: false,
    });
    definitions.push({
      id: 'kitchen-public', title: 'Кухня → гостиная / столовая',
      from: 'kitchen', to: 'livingDining', fromTitle: 'кухня', toTitle: 'гостиная или столовая', directPreferred: true,
    });
  }
  if (effective.bedroomCount != null && effective.bathroomCount != null) {
    definitions.push({
      id: 'bedroom-bathroom', title: 'Спальни → основной санузел',
      from: 'bedroom', to: 'bathroom', fromTitle: 'спальня', toTitle: 'основной санузел', directPreferred: false,
    });
  }
  const optional = effective.options || {};
  if (optional.pantry === true) definitions.push({ id: 'pantry-kitchen', title: 'Кладовая → кухня', from: 'pantry', to: 'kitchen', fromTitle: 'кладовая продуктов', toTitle: 'кухня', directPreferred: true });
  if (optional.wardrobe === true) definitions.push({ id: 'wardrobe-bedroom', title: 'Гардеробная → спальня', from: 'wardrobe', to: 'bedroom', fromTitle: 'гардеробная', toTitle: 'спальня', directPreferred: true });
  if (optional.guestWc === true) definitions.push({ id: 'guest-wc-entry', title: 'Гостевой санузел → входная зона', from: 'guestWc', to: 'entryHall', fromTitle: 'гостевой санузел', toTitle: 'прихожая или холл', directPreferred: false });
  if (optional.garage === true) definitions.push({ id: 'garage-entry', title: 'Гараж → входная / хозяйственная зона', from: 'garage', to: 'garageSupport', fromTitle: 'гараж', toTitle: 'прихожая, холл или хозяйственное помещение', directPreferred: false });
  if (optional.terrace === true) definitions.push({ id: 'terrace-public', title: 'Терраса → общественная зона', from: 'terrace', to: 'public', fromTitle: 'терраса', toTitle: 'гостиная или кухня-гостиная', directPreferred: true });
  if (optional.laundry === true && effective.bathroomCount != null) definitions.push({ id: 'laundry-bathroom', title: 'Постирочная → мокрая зона', from: 'laundry', to: 'bathroom', fromTitle: 'постирочная', toTitle: 'санузел', directPreferred: true });
  return definitions;
}

/**
 * @typedef {'direct'|'reachable'|'adjacent_without_door'|'missing'|'unknown'} HomeProgramConnectionStatus
 *
 * @typedef {object} HomeProgramConnection
 * @property {string} id Стабильный идентификатор правила связи.
 * @property {string} title Понятное человеку название.
 * @property {HomeProgramConnectionStatus} status Худший статус среди исходных помещений.
 * @property {string|null} levelId Этаж только для доказанной одноэтажной пары.
 * @property {string|null} fromRoomId Выбранная исходная комната или null.
 * @property {string|null} toRoomId Выбранная целевая комната или null.
 * @property {string[]} pathRoomIds Доказанный маршрут; для direct — пара комнат.
 * @property {string[]} sourceRoomIds Все комнаты исходной роли.
 * @property {string[]} targetRoomIds Все комнаты целевой роли.
 * @property {string} reason Объяснение результата без скрытой эвристики.
 *
 * @typedef {object} HomeProgramAnalysis
 * @property {'unknown'|'draft'|'incomplete'|'ready'} status
 * @property {object|null} input Нормализованная сохранённая программа.
 * @property {object} suggested Предварительное, не сохранённое предложение.
 * @property {object} effective Объединение явных ответов и предварительных предложений.
 * @property {string[]} unresolvedFields Неизвестные обязательные ответы.
 * @property {object} summary Сводные количества, площади и связи.
 * @property {object[]} targets Цели помещений с count/presentCount/missingCount/targetAreaM2.
 * @property {HomeProgramConnection[]} connections Проверки по реальному графу проходов.
 * @property {object[]} levels Сводка фактических помещений по этажам.
 * @property {string[]} warnings Объяснения неопределённости и нехватки данных.
 */

/**
 * Чистый детерминированный анализ подтверждённой/черновой программы дома.
 * Геометрию проекта не изменяет, межэтажный маршрут без коннектора не выводит.
 *
 * @returns {HomeProgramAnalysis}
 */
export function analyzeHomeProgram(project = {}) {
  const input = normalizeHomeProgram(project?.layoutBrief?.homeProgram);
  const suggestion = suggestHomeProgram(project);
  const effective = mergeProgram(input, suggestion.program);
  const records = roomRecords(project);
  const targets = targetList(input, suggestion.program, effective, records);
  const levelData = levelAnalyses(project, records);
  const requiredConnections = input?.confirmed === true;
  const connections = connectionDefinitions(effective)
    .map((definition) => connectionResult(definition, records, levelData.byLevel, requiredConnections));

  const unresolvedFields = [];
  if (!input || input.socialMode === 'unknown') unresolvedFields.push('socialMode');
  if (!input || input.bedroomCount == null) unresolvedFields.push('bedroomCount');
  if (!input || input.bathroomCount == null) unresolvedFields.push('bathroomCount');
  const explicitBedrooms = Array.isArray(input?.bedrooms) ? input.bedrooms : null;
  for (const bedroom of explicitBedrooms || []) {
    if (bedroom.ensuite == null) unresolvedFields.push(`bedrooms.${bedroom.id}.ensuite`);
    if (bedroom.wardrobe == null) unresolvedFields.push(`bedrooms.${bedroom.id}.wardrobe`);
  }
  for (const key of HOME_PROGRAM_OPTION_KEYS) {
    // Явный список спален сам отвечает, нужна ли гостевая спальня.
    if (key === 'guestBedroom' && explicitBedrooms) continue;
    if (!input || input.options[key] == null) unresolvedFields.push(`options.${key}`);
  }

  const missingRooms = targets.reduce((sum, target) => sum + target.missingCount, 0);
  const requiredConnectionIssues = connections.filter((connection) => connection.required && !connection.acceptable);
  const occupiedLevels = levelData.output.filter((level) => level.roomCount > 0);
  const levelsWithoutEntrance = occupiedLevels
    .filter((level) => !level.hasEntryRoot)
    .map((level) => level.id);
  const unreachableRoomCount = occupiedLevels
    .reduce((sum, level) => sum + level.unreachableRoomIds.length, 0);
  const accessIssueCount = levelsWithoutEntrance.length + unreachableRoomCount;
  let status = 'unknown';
  if (input) status = input.confirmed ? 'incomplete' : 'draft';
  else if (suggestion.status === 'preliminary') status = 'draft';
  if (input?.confirmed && !unresolvedFields.length && missingRooms === 0
    && !requiredConnectionIssues.length && accessIssueCount === 0) status = 'ready';

  const warnings = [...suggestion.warnings];
  if (unresolvedFields.length) warnings.push(`Не решено полей программы: ${unresolvedFields.length}.`);
  if (explicitBedrooms?.some((bedroom) => bedroom.ensuite === true)) {
    warnings.push('Свой санузел сохранён как требование спальни, но его связь с конкретной комнатой пока не доказана планом.');
  }
  if (connections.some((connection) => connection.status === 'unknown' && connection.sourceRoomIds.length && connection.targetRoomIds.length)) {
    warnings.push('Часть связей проходит между этажами; без доказанного межэтажного коннектора они оставлены неизвестными.');
  }
  if (!records.length) warnings.push('Помещения ещё не начерчены — программа сравнивается с пустым планом.');
  if (levelsWithoutEntrance.length) {
    const names = occupiedLevels
      .filter((level) => levelsWithoutEntrance.includes(level.id))
      .map((level) => level.name || level.id)
      .join(', ');
    warnings.push(`Не доказан корень входа на этажи: ${names}. На нижнем этаже нужна наружная дверь в прихожей или тамбуре, на верхнем — лестница.`);
  }
  if (unreachableRoomCount) {
    warnings.push(`От точки входа недостижимо обязательных помещений: ${unreachableRoomCount}. Проверьте двери и проходы.`);
  }

  const targetCount = targets.reduce((sum, target) => sum + target.count, 0);
  const presentCount = targets.reduce((sum, target) => sum + Math.min(target.count, target.presentCount), 0);
  const summary = {
    occupants: suggestion.facts.occupants,
    targetCount,
    presentCount,
    missingRooms,
    // Короткие алиасы нужны представлению; канонические имена выше остаются
    // однозначными для экспорта и тестов.
    total: targetCount,
    present: presentCount,
    missing: missingRooms,
    targetAreaM2: targets.reduce((sum, target) => sum + target.targetAreaM2, 0),
    actualMatchedAreaM2: targets.reduce((sum, target) => sum + target.actualAreaM2, 0),
    connectionCount: connections.length,
    connectionsSatisfied: connections.filter((connection) => connection.acceptable).length,
    connectionIssues: requiredConnectionIssues.length,
    accessIssueCount,
    levelsWithoutEntrance,
    unreachableRoomCount,
  };
  const connectionIssueText = requiredConnectionIssues.length
    ? `; проблем функциональных связей ${requiredConnectionIssues.length}` : '';
  summary.text = targetCount
    ? `Помещений по программе: ${presentCount} из ${targetCount}; не хватает ${missingRooms}; проблем доступа ${accessIssueCount}${connectionIssueText}.`
    : 'Сначала подтвердите состав семьи и программу помещений.';
  return {
    status,
    input,
    suggested: suggestion,
    effective,
    unresolvedFields,
    summary,
    targets,
    connections,
    levels: levelData.output,
    warnings: unique(warnings),
  };
}

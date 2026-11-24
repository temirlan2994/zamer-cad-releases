// Предварительный обзор объёма и архитектурной оболочки дома.
//
// Модуль собирает только факты из текущей геометрии: ТЭП и этажи, явные
// крыши, четыре фасада, сохранённые архитектурные разрезы, лестницы и проёмы
// в перекрытиях. Он не меняет проект и намеренно не выдаёт наличие геометрии
// за конструктивный, теплотехнический или нормативный вывод.

import { buildElevation } from './elevation.js';
import { linkedRoofRegions } from './linked-roof-regions.js';
import { isOpenRoom, isShaft } from './catalog.js';
import { levelProject, sortedLevels } from './model.js';
import { buildingFootprintM2 } from './rooms.js';
import {
  roofLevel, roofStats, roofsOf, validOutline,
} from './roofs.js';
import { roomSchedule } from './schedule.js';
import { buildSection, validLine } from './section.js';
import {
  slabOpeningArea, slabOpeningPolygon, slabOpeningSourceLevel, slabOpeningStair,
  slabOpenings, stairRiseByLevels, stairTargetLevel,
} from './slab-openings.js';
import { tepReport } from './tep.js';
import { DIR_NAMES, ELEV_DIRS, sectionViews } from './views.js';
import { envelopeOf, resolvedZeroAboveGround } from './envelope.js';

const AUTO_ROOF_NAMES = Object.freeze({
  flat: 'плоская',
  shed: 'односкатная',
  gable: 'двускатная',
  hip: 'вальмовая',
});

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));
const numberOrNull = (value) => (finite(value) ? Number(value) : null);
const rounded = (value, digits = 3) => {
  const number = numberOrNull(value);
  if (number == null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
};

function safeCall(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function entry(id, area, title, text, extra = {}) {
  return { id, area, title, text, ...extra };
}

function safeLevels(project) {
  if (!array(project?.levels).length) return [];
  try { return sortedLevels(project); } catch { return [...array(project.levels)]; }
}

function safeSchedule(project) {
  if (!array(project?.levels).length) return [];
  try { return roomSchedule(project); } catch { return []; }
}

function rawTep(project) {
  if (!array(project?.levels).length) return null;
  try { return tepReport(project); } catch { return null; }
}

function levelRecords(project, levels, schedule) {
  const scheduleByLevel = new Map(schedule.map((record) => [record.level.id, record]));
  return levels.map((level) => {
    const lp = levelProject(project, level.id);
    const footprintM2 = safeCall(() => buildingFootprintM2(lp), 0);
    const rooms = array(level.rooms);
    const openings = array(level.openings);
    const totals = scheduleByLevel.get(level.id)?.totals || {};
    return {
      id: level.id,
      name: level.name || level.id,
      elevationMm: numberOrNull(level.elevation),
      heightMm: numberOrNull(level.height),
      footprintM2: rounded(footprintM2),
      totalAreaM2: rounded(totals.total || 0),
      livingAreaM2: rounded(totals.living || 0),
      summerAreaM2: rounded(totals.summer || 0),
      roomCount: rooms.length,
      enclosedRoomCount: rooms.filter((room) => !isOpenRoom(room) && !isShaft(room)).length,
      doorCount: openings.filter((opening) => opening.kind === 'door').length,
      windowCount: openings.filter((opening) => opening.kind === 'window').length,
      stairCount: array(level.items).filter((item) => item.kind === 'stairs').length,
      occupied: footprintM2 > 0,
    };
  });
}

function indicators(project, levels) {
  const source = rawTep(project);
  const hasBuilding = levels.some((level) => level.footprintM2 > 0);
  return {
    plotAreaM2: rounded(source?.plot),
    footprintM2: rounded(source?.footprint ?? 0),
    coverageRatio: rounded(source?.coverage, 6),
    densityRatio: rounded(source?.density, 6),
    grossFloorAreaM2: rounded(source?.floorArea ?? 0),
    totalAreaM2: rounded(source?.total ?? 0),
    livingAreaM2: rounded(source?.living ?? 0),
    summerAreaM2: rounded(source?.summer ?? 0),
    buildingVolumeM3: rounded(source?.volume ?? 0),
    storeys: hasBuilding ? Number(source?.storeys || levels.filter((level) => level.occupied).length) : null,
    heightM: hasBuilding ? rounded(source?.height) : null,
    volumeMethod: 'sum-level-footprint-x-level-height',
    volumeIncludesRoof: false,
  };
}

function roofRecords(project, hasBuilding, unknowns, conflicts, facts) {
  const envelope = envelopeOf(project);
  const autoType = envelope.roof.type;
  const manual = roofsOf(project).map((roof, index) => {
    const level = roofLevel(project, roof);
    const outlineValid = validOutline(array(roof?.outline));
    const stats = safeCall(() => (level && outlineValid ? roofStats(project, roof) : null), null);
    const areaM2 = rounded(stats?.area);
    const valid = Boolean(level && outlineValid && areaM2 != null && areaM2 > 0);
    if (!valid) {
      conflicts.push(entry(
        `roof:invalid:${roof?.id || index + 1}`,
        'roof',
        roof?.name || `Крыша ${index + 1}`,
        !level
          ? 'Явная крыша ссылается на отсутствующий этаж.'
          : 'Контур или площадь явной крыши не образуют пригодную геометрию.',
        { roofId: roof?.id || null, levelId: roof?.levelId || null },
      ));
    }
    return {
      id: roof?.id || `roof-${index + 1}`,
      name: roof?.name || `Крыша ${index + 1}`,
      levelId: roof?.levelId || null,
      levelName: level?.name || null,
      status: valid ? 'explicit' : 'invalid',
      outlineVertexCount: array(roof?.outline).length,
      areaM2,
      z0Mm: numberOrNull(stats?.z0),
      z1Mm: numberOrNull(stats?.z1),
      thicknessMm: numberOrNull(roof?.thickness),
      material: roof?.material || null,
      edgeType: roof?.edge?.type || null,
      parapetType: roof?.parapet?.type || null,
      drainMarker: roof?.drain === true,
    };
  });
  const regions = hasBuilding ? linkedRoofRegions(project) : [];
  const linked = regions.map((roof) => ({
    id: roof.id,
    levelId: roof.levelId,
    levelName: roofLevel(project, roof)?.name || roof.levelId,
    name: roof.name,
    status: 'linked',
    roofType: roof.roofType,
    pitchDeg: roof.pitchDeg,
    areaM2: rounded(roof.planArea / 1e6),
    z0Mm: roof.z,
    thicknessMm: roof.thickness,
  }));
  const autoLinked = linked.length > 0;
  const valid = manual.filter((record) => record.status === 'explicit');
  if (valid.length) {
    facts.push(entry(
      'roof:explicit', 'roof', 'Явные крыши',
      `В модели есть явных крыш: ${valid.length}. Их суммарная геометрическая площадь ${rounded(valid.reduce((sum, roof) => sum + (roof.areaM2 || 0), 0), 2)} м².`,
    ));
    if (autoLinked) {
      facts.push(entry(
        'roof:coverage-linked', 'roof', 'Контур кровли связан с этажами',
        'Связанные крыши занимают свободные участки рядом с ручными крышами.',
      ));
    } else if (envelope.roofMode === 'manual') {
      unknowns.push(entry(
        'roof:coverage', 'roof', 'Полнота кровли не проверена',
        'Автоматическая оболочка выключена; проверьте, что ручные крыши закрывают весь дом.',
      ));
    }
  } else if (autoLinked) {
    facts.push(entry(
      'roof:linked', 'roof', 'Автоматическая кровля',
      `Связанная ${AUTO_ROOF_NAMES[autoType] || 'автоматическая'} кровля следует за верхним контуром этажей и перестраивается вместе с помещениями.`,
    ));
  }
  return {
    status: manual.some((record) => record.status === 'invalid') ? 'conflict'
      : valid.length ? 'explicit' : (autoLinked ? 'linked' : 'unspecified'),
    autoLinked,
    autoThicknessMm: envelope.roofThickness,
    autoType,
    autoPitchDeg: envelope.roof.pitchDeg,
    autoDirection: envelope.roof.direction,
    autoOverhangMm: envelope.roof.overhang,
    autoDrainage: envelope.roof.drainage,
    explicitCount: valid.length,
    linkedCount: linked.length,
    invalidCount: manual.length - valid.length,
    totalAreaM2: rounded([...valid, ...linked].reduce((sum, roof) => sum + roof.areaM2, 0)),
    renderingFallback: autoLinked ? 'linked-roof-for-uncovered-parts' : 'none',
    records: [...manual, ...linked],
  };
}

function facadeRecords(project, hasBuilding, roofs, conflicts, facts, { inspectGeometry = true } = {}) {
  const representation = roofs.explicitCount
    ? (roofs.autoLinked ? 'explicit-plus-linked-automatic' : 'explicit')
    : (roofs.autoLinked ? 'linked-automatic' : 'unspecified');
  if (!inspectGeometry) {
    return {
      status: hasBuilding ? 'registered' : 'unknown',
      availableCount: 0,
      registeredCount: ELEV_DIRS.length,
      records: ELEV_DIRS.map((dir) => ({
        id: `elev-${dir}`,
        dir,
        title: `Фасад ${DIR_NAMES[dir] || dir}`,
        status: hasBuilding ? 'registered' : 'empty',
        widthMm: null,
        heightMm: null,
        polygonCount: null,
        visibleKinds: {},
        roofRepresentation: representation,
      })),
    };
  }
  const records = ELEV_DIRS.map((dir) => {
    try {
      const facade = buildElevation(project, dir);
      const visible = array(facade?.polys);
      const kinds = visible.reduce((result, polygon) => {
        const kind = polygon?.kind || 'other';
        result[kind] = (result[kind] || 0) + 1;
        return result;
      }, {});
      return {
        id: `elev-${dir}`,
        dir,
        title: `Фасад ${DIR_NAMES[dir] || dir}`,
        status: visible.length && facade.width > 0 && facade.height > 0 ? 'available' : 'empty',
        widthMm: rounded(facade?.width, 1),
        heightMm: rounded(facade?.height, 1),
        polygonCount: visible.length,
        visibleKinds: kinds,
        roofRepresentation: representation,
      };
    } catch (error) {
      conflicts.push(entry(
        `facade:error:${dir}`, 'facade', `Фасад ${DIR_NAMES[dir] || dir}`,
        'Фасад не удалось построить по текущей геометрии.',
        { viewId: `elev-${dir}`, reason: error instanceof Error ? error.message : String(error) },
      ));
      return {
        id: `elev-${dir}`, dir, title: `Фасад ${DIR_NAMES[dir] || dir}`,
        status: 'error', widthMm: null, heightMm: null, polygonCount: 0,
        visibleKinds: {},
        roofRepresentation: representation,
      };
    }
  });
  const available = records.filter((record) => record.status === 'available').length;
  if (hasBuilding && available === ELEV_DIRS.length) {
    facts.push(entry(
      'facade:four-views', 'facade', 'Фасады построены',
      'По текущей геометрии доступны четыре фасадных представления. Это факт отображения, а не оценка архитектурной композиции.',
    ));
  }
  return {
    status: available === ELEV_DIRS.length ? 'available' : available ? 'partial' : 'unknown',
    availableCount: available,
    records,
  };
}

function sectionRecords(project, unknowns, conflicts, facts, { inspectGeometry = true } = {}) {
  if (!inspectGeometry) {
    const records = sectionViews(project).map((view, index) => {
      const valid = validLine(view?.line);
      if (!valid) {
        conflicts.push(entry(
          `section:invalid:${view?.id || index + 1}`, 'section', view?.name || `Разрез ${index + 1}`,
          'Линия сохранённого разреза не образует корректный вид.',
          { viewId: view?.id || null },
        ));
      }
      return {
        id: view?.id || `section-${index + 1}`,
        name: view?.name || `Разрез ${index + 1}`,
        levelId: view?.levelId || null,
        status: valid ? 'registered' : 'invalid',
        widthMm: null,
        heightMm: null,
        cutCount: null,
        openingCount: null,
      };
    });
    if (!records.length) {
      unknowns.push(entry(
        'section:missing', 'section', 'Нет архитектурного разреза',
        'Фасады не показывают внутренние высоты и межэтажные узлы. Создайте хотя бы один разрез по линии плана.',
      ));
    }
    const registered = records.filter((record) => record.status === 'registered').length;
    return {
      status: registered ? (registered === records.length ? 'registered' : 'partial') : 'unknown',
      availableCount: 0,
      registeredCount: registered,
      records,
    };
  }
  const records = sectionViews(project).map((view, index) => {
    try {
      const section = buildSection(project, view);
      if (!section) {
        conflicts.push(entry(
          `section:invalid:${view?.id || index + 1}`, 'section', view?.name || `Разрез ${index + 1}`,
          'Линия сохранённого разреза не образует корректный вид.',
          { viewId: view?.id || null },
        ));
        return {
          id: view?.id || `section-${index + 1}`, name: view?.name || `Разрез ${index + 1}`,
          levelId: view?.levelId || null, status: 'invalid', widthMm: null, heightMm: null,
          cutCount: 0, openingCount: 0,
        };
      }
      const contentCount = array(section.polys).length + array(section.cuts).length;
      return {
        id: view.id,
        name: view.name || `Разрез ${index + 1}`,
        levelId: view.levelId || null,
        status: contentCount ? 'available' : 'empty',
        widthMm: rounded(section.width, 1),
        heightMm: rounded(section.height, 1),
        cutCount: array(section.cuts).length,
        openingCount: array(section.openings).length,
      };
    } catch (error) {
      conflicts.push(entry(
        `section:error:${view?.id || index + 1}`, 'section', view?.name || `Разрез ${index + 1}`,
        'Сохранённый разрез не удалось построить по текущей геометрии.',
        { viewId: view?.id || null, reason: error instanceof Error ? error.message : String(error) },
      ));
      return {
        id: view?.id || `section-${index + 1}`, name: view?.name || `Разрез ${index + 1}`,
        levelId: view?.levelId || null, status: 'error', widthMm: null, heightMm: null,
        cutCount: 0, openingCount: 0,
      };
    }
  });
  const available = records.filter((record) => record.status === 'available').length;
  if (available) {
    facts.push(entry(
      'section:available', 'section', 'Архитектурные разрезы',
      `Сохранённых разрезов с геометрией: ${available}.`,
    ));
  } else {
    unknowns.push(entry(
      'section:missing', 'section', 'Нет архитектурного разреза',
      'Фасады не показывают внутренние высоты и межэтажные узлы. Создайте хотя бы один разрез по линии плана.',
    ));
  }
  return {
    status: available ? (available === records.length ? 'available' : 'partial') : 'unknown',
    availableCount: available,
    records,
  };
}

function openingRecord(project, level, opening, index, unknowns) {
  const geometry = safeCall(() => ({
    polygon: slabOpeningPolygon(opening),
    areaM2: rounded(slabOpeningArea(opening) / 1_000_000),
    source: slabOpeningSourceLevel(project, level.id, opening),
  }), { polygon: [], areaM2: null, source: null });
  const stair = slabOpeningStair(project, opening);
  if (!opening.auto && opening.stairId && !stair) {
    unknowns.push(entry(
      `vertical:orphan-opening:${opening.id || `${level.id}-${index + 1}`}`,
      'vertical', 'Проём без связанной лестницы',
      'Ручной проём сохранился, но указанная для него лестница отсутствует. Сам проём остаётся геометрическим фактом.',
      { levelId: level.id, openingId: opening.id || null, stairId: opening.stairId },
    ));
  }
  return {
    id: opening.id || `opening-${level.id}-${index + 1}`,
    levelId: level.id,
    levelName: level.name || level.id,
    source: opening.auto ? 'automatic-from-stair' : 'manual',
    stairId: opening.stairId || null,
    sourceLevelId: geometry.source?.id || opening.fromLevelId || null,
    areaM2: geometry.areaM2,
    polygonVertexCount: geometry.polygon.length,
  };
}

function verticalRecords(project, levels, levelData, unknowns, conflicts, facts) {
  const allOpenings = levels.flatMap((level) => {
    const list = safeCall(() => slabOpenings(project, level.id), []);
    return list.map((opening, index) => openingRecord(project, level, opening, index, unknowns));
  });
  const stairRecords = [];
  for (const level of levels) {
    for (const item of array(level.items).filter((candidate) => candidate.kind === 'stairs')) {
      const explicitTarget = typeof item.toLevel === 'string' && item.toLevel !== '' && item.toLevel !== 'none';
      const intentionallyNone = item.toLevel === 'none';
      const target = intentionallyNone ? null : stairTargetLevel(project, item, level);
      const invalidExplicit = explicitTarget && !target;
      const related = allOpenings.filter((opening) => opening.stairId === item.id);
      const targetOpening = target && related.some((opening) => opening.levelId === target.id);
      let status = intentionallyNone ? 'not-connected'
        : invalidExplicit ? 'conflict'
          : target ? (explicitTarget ? 'explicit' : 'automatic') : 'unknown';
      if (target && !targetOpening) status = 'conflict';
      if (invalidExplicit) {
        conflicts.push(entry(
          `vertical:stair-target:${item.id}`, 'vertical', 'Некорректная цель лестницы',
          'Лестница явно ссылается на отсутствующий или не расположенный выше этаж.',
          { levelId: level.id, stairId: item.id, targetLevelId: item.toLevel },
        ));
      } else if (target && !targetOpening) {
        conflicts.push(entry(
          `vertical:stair-opening:${item.id}`, 'vertical', 'Нет проёма у цели лестницы',
          'Для лестницы с известным целевым этажом не найден связанный проём в его перекрытии.',
          { levelId: level.id, stairId: item.id, targetLevelId: target.id },
        ));
      } else if (target && !explicitTarget) {
        unknowns.push(entry(
          `vertical:stair-auto-target:${item.id}`, 'vertical', 'Цель лестницы выбрана автоматически',
          `Лестница геометрически ведёт на ближайший верхний этаж «${target.name || target.id}», но это не подтверждено явным выбором.`,
          { levelId: level.id, stairId: item.id, targetLevelId: target.id },
        ));
      }
      stairRecords.push({
        id: item.id,
        levelId: level.id,
        levelName: level.name || level.id,
        status,
        targetMode: intentionallyNone ? 'none' : explicitTarget ? 'explicit' : target ? 'automatic' : 'unknown',
        targetLevelId: target?.id || (explicitTarget ? item.toLevel : null),
        targetLevelName: target?.name || null,
        riseMm: target ? numberOrNull(stairRiseByLevels(project, item, level)) : null,
        openingIds: related.map((opening) => opening.id),
        openingLevelIds: [...new Set(related.map((opening) => opening.levelId))],
      });
    }
  }

  const connectedTargetIds = new Set(stairRecords
    .filter((stair) => stair.status === 'explicit' || stair.status === 'automatic')
    .map((stair) => stair.targetLevelId));
  const occupied = levelData.filter((level) => level.occupied)
    .sort((a, b) => (a.elevationMm || 0) - (b.elevationMm || 0));
  for (const level of occupied.slice(1)) {
    if (connectedTargetIds.has(level.id)) continue;
    unknowns.push(entry(
      `vertical:access:${level.id}`, 'vertical', `Не доказан подъём на «${level.name}»`,
      'В модели нет лестницы, явно или автоматически ведущей на этот занятый этаж. Лифт, наружный вход или иное решение также не подтверждены.',
      { levelId: level.id },
    ));
  }
  if (stairRecords.length || allOpenings.length) {
    facts.push(entry(
      'vertical:inventory', 'vertical', 'Вертикальная геометрия',
      `Лестниц: ${stairRecords.length}; проёмов в перекрытиях: ${allOpenings.length}. Наличие проёма не подтверждает конструктивную допустимость.`,
    ));
  }
  return {
    status: stairRecords.some((stair) => stair.status === 'conflict') ? 'conflict'
      : occupied.length <= 1 ? 'not-required'
        : occupied.slice(1).every((level) => connectedTargetIds.has(level.id)) ? 'candidate' : 'unknown',
    stairs: stairRecords,
    slabOpenings: allOpenings,
  };
}

const LIMITATIONS = Object.freeze([
  'Строительный объём — сумма площади пятна каждого этажа на его высоту; объём кровли, подземная часть и конструктивные слои в него не добавляются.',
  'Явная и автоматическая кровля — геометрия концепции. Уклоны, водоотвод, гидроизоляция, снеговые и ветровые нагрузки и узлы не рассчитаны.',
  'Фасады и разрезы построены из текущей модели. Их наличие не является оценкой композиции и не подтверждает соблюдение норм.',
  'Лестницы и проёмы показывают геометрическую связь. Несущая способность плит, ограждения, высота прохода, пожарная безопасность и эвакуация здесь не проверяются.',
  'Теплотехнические свойства стен, окон и кровли, теплопотери, перегрев и энергопотребление не рассчитаны.',
]);

/**
 * Собрать фактический, не нормативный обзор объёма дома.
 *
 * status:
 * - unknown — ещё нет геометрии дома;
 * - candidate — геометрия существует, но остаются не подтверждённые решения;
 * - conflict — в явных ссылках/представлениях найдена проверяемая ошибка.
 *
 * Результат намеренно не имеет ready/pass/score: даже полностью построенные
 * фасады и разрезы не являются конструктивным или теплотехническим расчётом.
 */
export function analyzeHomeEnvelope(project = {}, options = {}) {
  const unknowns = [];
  const conflicts = [];
  const facts = [];
  const levels = safeLevels(project);
  const levelData = levelRecords(project, levels, safeSchedule(project));
  const hasBuilding = levelData.some((level) => level.occupied);

  if (hasBuilding) {
    facts.push(entry(
      'envelope:levels', 'levels', 'Этажи и площади',
      `Этажей с замкнутым пятном: ${levelData.filter((level) => level.occupied).length}; помещений в модели: ${levelData.reduce((sum, level) => sum + level.roomCount, 0)}.`,
    ));
    const zero = resolvedZeroAboveGround(project);
    if (zero == null && !Number.isFinite(project.site?.terrain?.floorZ)) {
      unknowns.push(entry(
        'envelope:datum', 'levels', 'Не задан ±0.000',
        'Укажите положение чистого пола относительно земли, чтобы построить цоколь и фундамент.',
      ));
    } else {
      const envelope = envelopeOf(project);
      facts.push(entry(
        'envelope:datum', 'levels', 'Посадка дома задана',
        `${zero == null
          ? `Абсолютный ±0.000 по съёмке: ${(project.site.terrain.floorZ / 1000).toFixed(2)} м`
          : `±0.000 относительно опорной земли: ${(zero / 1000).toFixed(2)} м`}; заглубление основания: ${(envelope.foundation.depth / 1000).toFixed(2)} м.`,
      ));
    }
  } else {
    unknowns.push(entry(
      'envelope:empty', 'levels', 'Объём дома ещё не задан',
      'Нет этажа с замкнутым пятном помещений, поэтому объём, фасады и вертикальные связи нельзя считать определёнными.',
    ));
  }

  const roofs = roofRecords(project, hasBuilding, unknowns, conflicts, facts);
  if (hasBuilding && roofs.status === 'unspecified') {
    unknowns.push(entry(
      'roof:unspecified', 'roof', 'Форма кровли не задана',
      'В модели нет кровли. Проверьте настройки проекта и связь крыши с помещением.',
    ));
  }
  const inspectViewGeometry = options.inspectViewGeometry !== false;
  const facades = levels.length
    ? facadeRecords(project, hasBuilding, roofs, conflicts, facts, { inspectGeometry: inspectViewGeometry })
    : { status: 'unknown', availableCount: 0, records: [] };
  const sections = levels.length
    ? sectionRecords(project, unknowns, conflicts, facts, { inspectGeometry: inspectViewGeometry })
    : { status: 'unknown', availableCount: 0, records: [] };
  const vertical = verticalRecords(project, levels, levelData, unknowns, conflicts, facts);

  const status = conflicts.length ? 'conflict' : hasBuilding ? 'candidate' : 'unknown';
  return {
    schema: 'kepler-home-envelope/1',
    preliminary: true,
    normative: false,
    status,
    indicators: indicators(project, levelData),
    levels: levelData,
    roofs,
    facades,
    sections,
    vertical,
    facts,
    unknowns,
    conflicts,
    conclusions: {
      structural: { status: 'not-calculated', value: null },
      thermal: { status: 'not-calculated', value: null },
      normative: { status: 'not-evaluated', value: null },
    },
    summary: {
      levelCount: levelData.length,
      occupiedLevelCount: levelData.filter((level) => level.occupied).length,
      roomCount: levelData.reduce((sum, level) => sum + level.roomCount, 0),
      explicitRoofCount: roofs.explicitCount,
      linkedRoofCount: roofs.linkedCount,
      availableFacadeCount: facades.availableCount,
      availableSectionCount: sections.availableCount,
      stairCount: vertical.stairs.length,
      slabOpeningCount: vertical.slabOpenings.length,
      factCount: facts.length,
      unknownCount: unknowns.length,
      conflictCount: conflicts.length,
    },
    limitations: [...LIMITATIONS],
  };
}

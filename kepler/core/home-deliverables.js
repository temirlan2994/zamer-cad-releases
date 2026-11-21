// Этап 9 «Документы и выдача»: фактическая сводка доступных видов, листов
// и форматов экспорта. Модуль ничего не рисует и не запускает генераторы
// PDF/DXF/IFC — он только читает текущую модель.
//
// Важно: наличие вида или листа означает лишь, что из модели можно собрать
// концептуальный материал. Это не проверка комплекта рабочей документации.

import { isStructural } from './catalog.js';
import { validOutline } from './roofs.js';
import { roomPolygon } from './room-shape.js';
import { sectionFrame } from './section.js';
import { polygonAreaM2 } from './site.js';
import {
  DIR_NAMES, SHEET_FORMATS, allViews, facadeViews, viewById,
} from './views.js';

const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const finitePoint = (point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));

function levelsOf(project) {
  return array(project?.levels).filter((level) => level && typeof level === 'object')
    .slice().sort((a, b) => (Number(a.elevation) || 0) - (Number(b.elevation) || 0));
}

function cross(a, b, c) {
  return (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y))
    - (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
}

function pointOnSegment(point, a, b) {
  const eps = 1e-6;
  return Math.abs(cross(a, b, point)) <= eps
    && Number(point.x) >= Math.min(Number(a.x), Number(b.x)) - eps
    && Number(point.x) <= Math.max(Number(a.x), Number(b.x)) + eps
    && Number(point.y) >= Math.min(Number(a.y), Number(b.y)) - eps
    && Number(point.y) <= Math.max(Number(a.y), Number(b.y)) + eps;
}

function segmentsCross(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) <= 1e-6 && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= 1e-6 && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= 1e-6 && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= 1e-6 && pointOnSegment(b, c, d));
}

// Для гарантированного автолиста нужна конечная простая граница с ненулевой
// площадью. Зона застройки и нормативные отступы здесь намеренно не нужны.
function validBoundary(value) {
  const points = array(value);
  if (points.length < 3 || !points.every(finitePoint) || !(polygonAreaM2(points) > 0.01)) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y)) < 1) return false;
    for (let j = i + 1; j < points.length; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === points.length - 1);
      if (adjacent) continue;
      if (segmentsCross(a, b, points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return true;
}

function levelHasPlanContent(level) {
  return Boolean(array(level?.rooms).length || array(level?.walls).length
    || array(level?.openings).length || array(level?.items).length);
}

function facadeItem(item) {
  return item?.kind === 'stairs' || isStructural(item?.kind);
}

function validRoofCount(project, levels) {
  const levelIds = new Set(levels.map((level) => level.id));
  return array(project?.roofs).filter((roof) => levelIds.has(roof?.levelId)
    && validOutline(array(roof?.outline))).length;
}

function hasFacadeGeometry(project, levels) {
  return levels.some((level) => array(level.rooms).length || array(level.walls).length
    || array(level.items).some(facadeItem)) || validRoofCount(project, levels) > 0;
}

function hasThreeDGeometry(project, levels) {
  const landscape = array(project?.site?.landscape?.objects);
  const terrain = array(project?.site?.terrain?.points);
  const masses = array(project?.masses).filter((mass) => [mass?.x, mass?.y, mass?.w, mass?.d, mass?.h]
    .every((value) => Number.isFinite(Number(value))) && Number(mass.w) > 0 && Number(mass.d) > 0 && Number(mass.h) > 0);
  const landscapeGeometry = landscape.some((item) => typeof item?.kind === 'string'
    && (finitePoint(item) || array(item?.points).filter(finitePoint).length >= 2));
  const terrainGeometry = terrain.length >= 3 && terrain.every(finitePoint);
  return levels.some(levelHasPlanContent) || validRoofCount(project, levels) > 0
    || masses.length > 0 || landscapeGeometry || terrainGeometry;
}

function validBuildingSection(view) {
  const a = view?.line?.a;
  const b = view?.line?.b;
  return typeof view?.id === 'string' && view.id && finitePoint(a) && finitePoint(b)
    && Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y)) >= 1;
}

function sectionContentPoints(project, levels) {
  const points = [];
  for (const level of levels) {
    for (const room of array(level.rooms)) {
      try { points.push(...roomPolygon(room).filter(finitePoint)); } catch { /* битая комната не создаёт содержимое */ }
    }
    for (const wall of array(level.walls)) {
      if (finitePoint(wall?.axis?.a)) points.push(wall.axis.a);
      if (finitePoint(wall?.axis?.b)) points.push(wall.axis.b);
    }
    for (const item of array(level.items)) {
      if (!finitePoint(item)) continue;
      const halfW = Math.max(0, Number(item.w) || 0) / 2;
      const halfH = Math.max(0, Number(item.h) || 0) / 2;
      points.push(
        { x: Number(item.x) - halfW, y: Number(item.y) - halfH },
        { x: Number(item.x) + halfW, y: Number(item.y) + halfH },
      );
    }
  }
  for (const roof of array(project?.roofs)) points.push(...array(roof?.outline).filter(finitePoint));
  return points;
}

// Дешёвый gate содержимого разреза: точка геометрии должна попасть в
// призму вида (длина линии × направление взгляда × необязательная глубина).
// Это не строит mesh и не подменяет сам `buildSection`, но отсеивает линии,
// которые лежат далеко от дома и дают совершенно пустой вид.
function buildingSectionHasContent(project, view, levels) {
  const frame = sectionFrame(view);
  if (!frame) return false;
  const depth = Number(view.depth) > 0 ? Number(view.depth) : Infinity;
  const epsilon = 1;
  return sectionContentPoints(project, levels).some((point) => {
    const dx = Number(point.x) - frame.a.x;
    const dy = Number(point.y) - frame.a.y;
    const distance = dx * frame.view.x + dy * frame.view.y;
    const along = dx * frame.right.x + dy * frame.right.y;
    return distance >= -epsilon && distance <= depth + epsilon
      && along >= frame.u0 - epsilon && along <= frame.u1 + epsilon;
  });
}

function validLandscapeSection(section) {
  const points = array(section?.points);
  return typeof section?.id === 'string' && section.id && points.length >= 2
    && points.every(finitePoint);
}

function check(id, title, status, summary, extra = {}) {
  return { id, title, status, summary, ...extra };
}

function exportFact(kind, label, extension, available, reason, limitation = null) {
  return {
    kind, label, extension, available: Boolean(available), generated: false,
    ...(reason ? { reason } : {}),
    ...(limitation ? { limitation } : {}),
  };
}

function sheetFormatRows(sheets) {
  const counts = new Map();
  for (const sheet of sheets) {
    const format = SHEET_FORMATS[sheet.format] ? sheet.format : 'unknown';
    counts.set(format, (counts.get(format) || 0) + 1);
  }
  return [...counts].map(([id, count]) => ({ id, count }));
}

/**
 * Фактическая готовность концептуальных материалов этапа 9.
 *
 * status: ready — все шесть групп имеют содержимое; partial — готова часть;
 * missing — содержимого для групп ещё нет. Это не нормативный статус.
 */
export function analyzeHomeDeliverables(project = {}) {
  const source = object(project);
  const levels = levelsOf(source);
  const planViews = levels.map((level) => {
    const ready = levelHasPlanContent(level);
    return {
      id: `plan:${level.id}`,
      kind: 'plan',
      levelId: level.id,
      title: `План: ${level.name || level.id || 'этаж'}`,
      status: ready ? 'ready' : 'missing',
      hasContent: ready,
      autoSheet: array(level.rooms).length > 0,
    };
  });
  const readyPlans = planViews.filter((view) => view.hasContent);
  const autoPlanViews = planViews.filter((view) => view.autoSheet);

  const boundaryReady = validBoundary(source.site?.boundary);
  const siteView = {
    id: 'site', kind: 'site', title: 'Генплан',
    status: boundaryReady ? 'ready' : 'missing',
    hasContent: boundaryReady,
  };

  const facadeReady = hasFacadeGeometry(source, levels);
  const elevations = facadeViews(source).map((view) => ({
    id: view.id,
    kind: 'elevation',
    dir: view.dir,
    title: view.name || `Фасад ${DIR_NAMES[view.dir] || view.dir}`,
    status: facadeReady ? 'ready' : 'missing',
    computed: true,
    hasContent: facadeReady,
  }));

  const buildingSections = array(source.views).filter((view) => view?.kind === 'section' && validBuildingSection(view))
    .map((view) => {
      const hasContent = buildingSectionHasContent(source, view, levels);
      return {
      id: view.id, kind: 'section', title: view.name || 'Разрез',
        levelId: view.levelId || null, status: hasContent ? 'ready' : 'missing', hasContent,
      };
    });
  const landscapeSections = array(source.site?.landscape?.sections).filter(validLandscapeSection)
    .map((section) => ({
      id: `section:${section.id}`, kind: 'landscape-section', sectionId: section.id,
      title: `Разрез участка ${section.name || ''}`.trim(), status: 'ready',
    }));
  const sections = [...buildingSections, ...landscapeSections];
  const readySections = sections.filter((view) => view.status === 'ready');

  const threeDReady = hasThreeDGeometry(source, levels);
  const threeD = {
    id: '3d', kind: '3d', title: '3D-вид',
    status: threeDReady ? 'ready' : 'missing', hasContent: threeDReady,
  };

  const roomCount = levels.reduce((sum, level) => sum + array(level.rooms).length, 0);
  const roomLevelCount = levels.filter((level) => array(level.rooms).length).length;
  const landscapeCount = array(source.site?.landscape?.objects).length;
  const schedule = {
    id: 'schedule', title: 'Экспликация помещений',
    status: roomCount ? 'ready' : 'missing', roomCount, levelCount: roomLevelCount,
    exportKind: 'schedule-csv',
  };
  const tepStatus = roomCount && boundaryReady ? 'ready'
    : roomCount || boundaryReady ? 'partial' : 'missing';
  const tep = {
    id: 'tep', title: 'Технико-экономические показатели', status: tepStatus,
    houseIndicators: roomCount > 0,
    siteIndicators: boundaryReady,
    landscapeIndicators: boundaryReady && landscapeCount > 0,
    note: 'Геометрическая эскизная сводка; не смета и не нормативное заключение.',
  };

  // Гарантированные автолисты выводятся только из данных проекта. Разрезы
  // участка зависят от локальной UI-настройки и здесь не прибавляются.
  const autoItems = [
    ...(boundaryReady ? [{ id: 'auto:site', kind: 'site', viewId: 'site', title: 'Генплан' }] : []),
    ...autoPlanViews.map((view) => ({
      id: `auto:${view.id}`, kind: 'plan', viewId: view.id, levelId: view.levelId, title: view.title,
    })),
  ];
  const autoEnabled = source.sheetsAuto !== false;
  const potentialLandscapeSheets = {
    status: landscapeSections.length ? 'unknown' : 'missing',
    count: landscapeSections.length,
    viewIds: landscapeSections.map((view) => view.id),
    reason: landscapeSections.length
      ? 'Размещение разрезов участка на автолистах зависит от локального выбора в интерфейсе.'
      : 'Разрезы участка не созданы.',
  };

  const knownViewIds = new Set(allViews(source).map((view) => view.id));
  // Валидная ссылка на вид ещё не означает, что на листе есть что рисовать:
  // например, вычисляемые 3D и фасады существуют в дереве даже у пустого
  // проекта. Поэтому отдельно держим виды с фактическим содержимым.
  const contentViewIds = new Set([
    ...readyPlans.map((view) => view.id),
    ...(boundaryReady ? ['site'] : []),
    ...((boundaryReady || landscapeCount) ? ['landscape'] : []),
    ...(threeDReady ? ['3d'] : []),
    ...(facadeReady ? elevations.map((view) => view.id) : []),
    ...readySections.map((view) => view.id),
  ]);
  const rawUserSheets = array(source.sheets).filter((sheet) => sheet && typeof sheet === 'object');
  const userItems = rawUserSheets.map((sheet, index) => {
    const viewports = array(sheet.viewports);
    const valid = viewports.filter((viewport) => typeof viewport?.viewId === 'string'
      && (knownViewIds.has(viewport.viewId) || Boolean(viewById(source, viewport.viewId))));
    const content = valid.filter((viewport) => contentViewIds.has(viewport.viewId));
    const empty = valid.filter((viewport) => !contentViewIds.has(viewport.viewId));
    const invalid = viewports.filter((viewport) => !valid.includes(viewport));
    return {
      id: typeof sheet.id === 'string' && sheet.id ? sheet.id : `sheet-${index + 1}`,
      no: String(sheet.no ?? index + 1),
      title: typeof sheet.name === 'string' && sheet.name ? sheet.name : `Лист ${index + 1}`,
      format: SHEET_FORMATS[sheet.format] ? sheet.format : 'unknown',
      orient: sheet.orient === 'portrait' ? 'portrait' : 'landscape',
      viewportCount: viewports.length,
      validViewportCount: valid.length,
      contentViewportCount: content.length,
      emptyViewportCount: empty.length,
      invalidViewportCount: invalid.length,
      viewIds: valid.map((viewport) => viewport.viewId),
      contentViewIds: content.map((viewport) => viewport.viewId),
      emptyViewIds: empty.map((viewport) => viewport.viewId),
      invalidViewIds: invalid.map((viewport) => viewport?.viewId ?? null),
      status: content.length ? (invalid.length || empty.length ? 'partial' : 'ready') : 'missing',
    };
  });
  const userViewportCount = userItems.reduce((sum, sheet) => sum + sheet.viewportCount, 0);
  const validViewportCount = userItems.reduce((sum, sheet) => sum + sheet.validViewportCount, 0);
  const contentViewportCount = userItems.reduce((sum, sheet) => sum + sheet.contentViewportCount, 0);
  const emptyViewportCount = userItems.reduce((sum, sheet) => sum + sheet.emptyViewportCount, 0);
  const invalidViewportCount = userItems.reduce((sum, sheet) => sum + sheet.invalidViewportCount, 0);
  const populatedUserSheets = userItems.filter((sheet) => sheet.contentViewportCount > 0);
  const visibleAutoCount = autoEnabled ? autoItems.length : 0;
  const totalSheets = visibleAutoCount + userItems.length;
  const contentSheetCount = visibleAutoCount + populatedUserSheets.length;
  const sheetStatus = contentSheetCount > 0
    ? (invalidViewportCount ? 'partial' : 'ready')
    : totalSheets > 0 || (!autoEnabled && autoItems.length) ? 'partial' : 'missing';

  const sheets = {
    auto: {
      enabled: autoEnabled,
      count: visibleAutoCount,
      availableCount: autoItems.length,
      visibleCount: visibleAutoCount,
      items: autoItems,
      potential: potentialLandscapeSheets,
    },
    user: {
      count: userItems.length,
      populatedCount: populatedUserSheets.length,
      emptyCount: userItems.length - populatedUserSheets.length,
      viewportCount: userViewportCount,
      validViewportCount,
      contentViewportCount,
      emptyViewportCount,
      invalidViewportCount,
      items: userItems,
    },
    total: totalSheets,
    contentCount: contentSheetCount,
    formats: sheetFormatRows(rawUserSheets),
    emptyUserSheets: userItems.filter((sheet) => sheet.validViewportCount === 0).map((sheet) => sheet.id),
  };

  const checks = [
    check(
      'plans', 'Планы этажей', readyPlans.length ? 'ready' : 'missing',
      readyPlans.length
        ? `Содержимое есть на ${readyPlans.length} из ${planViews.length} планов.`
        : 'На планах пока нет помещений, стен, проёмов или объектов.',
      { count: readyPlans.length, total: planViews.length, required: true, viewIds: readyPlans.map((view) => view.id) },
    ),
    check(
      'site', 'Генплан', boundaryReady ? 'ready' : 'missing',
      boundaryReady ? 'Замкнутая граница участка позволяет сформировать генплан.' : 'Нужна корректная замкнутая граница участка.',
      { count: boundaryReady ? 1 : 0, required: false, viewId: 'site' },
    ),
    check(
      'facades', 'Фасады', facadeReady ? 'ready' : 'missing',
      facadeReady ? 'Четыре фасада вычисляются из текущей геометрии дома.' : 'Четыре вида созданы, но геометрии дома для фасадов пока нет.',
      { count: facadeReady ? elevations.length : 0, availableCount: elevations.length, required: false, viewIds: elevations.map((view) => view.id) },
    ),
    check(
      'sections', 'Разрезы', readySections.length ? (readySections.length === sections.length ? 'ready' : 'partial') : 'missing',
      readySections.length
        ? `Разрезов с содержимым: ${readySections.length} из ${sections.length} (дом — ${buildingSections.filter((view) => view.hasContent).length}, участок — ${landscapeSections.length}).`
        : sections.length ? 'Разрезы созданы, но их линии не захватывают геометрию дома или участка.'
          : 'Ни одного разреза дома или участка не создано.',
      { count: readySections.length, total: sections.length, required: false, viewIds: readySections.map((view) => view.id) },
    ),
    check(
      'three-d', '3D-вид', threeDReady ? 'ready' : 'missing',
      threeDReady ? 'В модели есть геометрия для 3D-вида.' : 'Модель пока не содержит геометрии для содержательного 3D-вида.',
      { count: threeDReady ? 1 : 0, required: false, viewId: '3d' },
    ),
    check(
      'sheets', 'Листы', sheetStatus,
      sheetStatus === 'ready'
        ? `Листов с содержимым: ${contentSheetCount}.`
        : sheetStatus === 'partial'
          ? 'Листы можно собрать, но сейчас они отключены, пусты или содержат удалённые виды.'
          : 'Нет доступных автолистов и пользовательских листов.',
      { count: contentSheetCount, total: totalSheets, required: true },
    ),
  ];
  const summary = {
    ready: checks.filter((item) => item.status === 'ready').length,
    partial: checks.filter((item) => item.status === 'partial').length,
    missing: checks.filter((item) => item.status === 'missing').length,
    total: checks.length,
  };
  const status = summary.ready === summary.total ? 'ready'
    : summary.ready || summary.partial ? 'partial' : 'missing';

  const planContent = readyPlans.length > 0;
  const modelReady = levels.length > 0;
  const exports = [
    exportFact('project', 'Файл проекта', '.kepler.json', modelReady,
      modelReady ? null : 'Проект не инициализирован.'),
    exportFact('json', 'Структурированный JSON', '.export.json', modelReady,
      modelReady ? null : 'Проект не инициализирован.', 'Схема обмена kepler-export/2, а не комплект чертежей.'),
    exportFact('dxf', 'Планы DXF', '.dxf', planContent,
      planContent ? null : 'На планах нет содержимого.', 'Этажи размещаются рядом; это концептуальная геометрия.'),
    exportFact('dxf-revit', 'Планы DXF для Revit', '-revit.dxf', planContent,
      planContent ? null : 'На планах нет содержимого.', 'Профиль слоёв для обмена, не нативная модель Revit.'),
    exportFact('dxf-site', 'Генплан DXF', '-genplan.dxf', boundaryReady,
      boundaryReady ? null : 'Нужна корректная граница участка.'),
    exportFact('ifc', 'Модель IFC4', '.ifc', facadeReady,
      facadeReady ? null : 'Нет геометрии дома для BIM-экспорта.', 'Концептуальный IFC: не содержит полного конструктивного и инженерного состава.'),
    exportFact('sheet-pdf', 'Альбом PDF', '-листы.pdf', totalSheets > 0,
      totalSheets ? (contentSheetCount ? null : 'Листы существуют, но могут быть пустыми.') : 'Нет листов.',
      'Страницы растрируются примерно в 150 dpi.'),
    exportFact('schedule-csv', 'Экспликация помещений', '-экспликация.csv', roomCount > 0,
      roomCount ? null : 'В проекте нет помещений.'),
    exportFact('landscape-csv', 'Ведомость ландшафта', '-ландшафт.csv', landscapeCount > 0,
      landscapeCount ? null : 'На участке нет объектов ландшафта.'),
    exportFact('zip', 'Архив обмена', '.zip', modelReady,
      modelReady ? null : 'Проект не инициализирован.', 'Архив содержит концептуальные исходники и не является выпуском рабочей документации.'),
  ];

  const warnings = [];
  if (!autoEnabled && autoItems.length) warnings.push('Автолисты отключены: доступные планы и генплан не входят в текущий альбом.');
  if (invalidViewportCount) warnings.push(`На пользовательских листах ссылок на удалённые виды: ${invalidViewportCount}.`);
  if (emptyViewportCount) warnings.push(`На пользовательских листах пустых видов: ${emptyViewportCount}.`);
  if (landscapeSections.length) warnings.push('Попадание разрезов участка на автолисты неизвестно ядру: выбор хранится в интерфейсе.');
  if (!roomCount) warnings.push('Экспликация и показатели дома пусты, пока нет помещений.');

  return {
    schema: 'kepler-home-deliverables/1',
    preliminary: true,
    normative: false,
    documentationLevel: 'concept',
    status,
    summary,
    checks,
    views: {
      plans: planViews,
      site: siteView,
      elevations,
      sections: { all: sections, building: buildingSections, landscape: landscapeSections },
      threeD,
      total: allViews(source).length,
    },
    documents: { schedule, tep },
    sheets,
    exports,
    warnings,
    limitations: [
      'Наличие вида или листа не означает готовность рабочей документации, экспертизы или разрешения на строительство.',
      'PDF-листы являются растровыми страницами примерно 150 dpi; это не векторный выпуск.',
      'DXF, IFC и структурированный JSON передают концептуальную модель и требуют проверки в целевой системе.',
      'ТЭП — геометрическая эскизная сводка; строительный объём считается упрощённо и не заменяет проектный расчёт.',
    ],
  };
}

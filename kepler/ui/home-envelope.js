// Этап 8 «Объём и фасады».
//
// Панель сводит уже существующую геометрию дома, но не подменяет ею
// конструктивный, теплотехнический или нормативный расчёт. Все действия
// только открывают рабочие виды и инструменты редактора.

import { analyzeHomeEnvelope } from '../core/home-envelope.js';
import { escapeHtml } from './dom.js';

const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

const STATUS_LABELS = Object.freeze({
  observed: 'Есть данные',
  attention: 'Нужно проверить',
  conflict: 'Есть несоответствие',
  unknown: 'Недостаточно данных',
});

const FACADE_VIEWS = Object.freeze([
  Object.freeze({ id: 'elev-N', name: 'Фасад Север' }),
  Object.freeze({ id: 'elev-S', name: 'Фасад Юг' }),
  Object.freeze({ id: 'elev-W', name: 'Фасад Запад' }),
  Object.freeze({ id: 'elev-E', name: 'Фасад Восток' }),
]);

function normalizedStatus(value) {
  const status = String(value || 'unknown').toLocaleLowerCase('ru-RU');
  if (['conflict', 'blocked', 'error', 'fail', 'invalid'].includes(status)) return 'conflict';
  if (['attention', 'warning', 'warn', 'partial', 'candidate', 'automatic'].includes(status)) return 'attention';
  if (['observed', 'fact', 'verified', 'checked', 'ready', 'ok', 'pass', 'done',
    'available', 'explicit', 'not-required'].includes(status)) return 'observed';
  return 'unknown';
}

function safeEnvelope(project) {
  try {
    // В панели нужны факты и переходы, а не четыре готовых растра фасадов.
    // Тяжёлая геометрия строится самим видом после явного нажатия.
    return analyzeHomeEnvelope(project, { inspectViewGeometry: false }) || {};
  } catch (error) {
    console.error('Обзор объёма и фасадов не рассчитался:', error);
    return {
      status: 'unknown',
      warnings: ['Не удалось собрать геометрическую сводку. Данные проекта не изменены.'],
    };
  }
}

function first(source, keys, fallback = null) {
  const record = object(source);
  for (const key of keys) {
    if (record[key] !== null && record[key] !== undefined) return record[key];
  }
  return fallback;
}

function analysisCard(report, ids) {
  const wanted = new Set(ids);
  return array(report?.cards || report?.sections).find((card) => wanted.has(String(card?.id || card?.kind || card?.type))) || null;
}

function reportSection(report, keys, cardIds = keys) {
  for (const key of keys) {
    if (report?.[key] !== null && report?.[key] !== undefined) return report[key];
  }
  return analysisCard(report, cardIds) || {};
}

function countOf(value, fallback = 0) {
  if (Array.isArray(value)) return value.length;
  if (finite(value)) return Math.max(0, Number(value));
  return fallback;
}

function number(value, digits = 1) {
  if (!finite(value)) return '—';
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function metresFromMm(value) {
  return finite(value) ? `${number(Number(value) / 1000, 2)} м` : '—';
}

function textOf(value, fallback = '') {
  if (typeof value === 'string') return value;
  return value?.text || value?.summary || value?.reason || value?.message
    || value?.description || fallback;
}

function summarySource(report) {
  const summary = object(report.summary);
  const card = analysisCard(report, ['tep', 'summary', 'metrics']);
  return object(report.indicators || report.tep || summary.tep || report.metrics
    || summary.metrics || card?.metrics || card || summary);
}

function summaryMetrics(report) {
  const source = summarySource(report);
  return [
    ['Площадь застройки', first(source, ['footprintM2', 'footprint', 'buildingFootprintM2']), 'м²', 1],
    ['Площадь этажей', first(source, ['floorAreaM2', 'floorArea', 'grossFloorAreaM2']), 'м²', 1],
    ['Общая площадь', first(source, ['totalAreaM2', 'total', 'areaM2']), 'м²', 1],
    ['Строительный объём', first(source, ['volumeM3', 'volume', 'buildingVolumeM3']), 'м³', 0],
    ['Этажность', first(source, ['storeys', 'storeyCount', 'levelCount']), '', 0],
    ['Высота по этажам', first(source, ['heightM', 'height', 'buildingHeightM']), 'м', 2],
  ].map(([label, value, unit, digits]) => ({ label, value, unit, digits }));
}

function metricHtml(metric) {
  const value = finite(metric.value) ? `${number(metric.value, metric.digits)}${metric.unit ? ` ${metric.unit}` : ''}` : '—';
  return `<div><dt>${escapeHtml(metric.label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function levelRows(report, project) {
  const section = reportSection(report, ['levels', 'floors'], ['levels', 'floors', 'storeys']);
  const rows = Array.isArray(section) ? section
    : array(section?.items || section?.rows || section?.levels);
  const source = rows.length ? rows : array(project?.levels);
  return source.map((level, index) => ({
    id: String(level?.id || `level-${index + 1}`),
    name: level?.name || level?.title || `Этаж ${index + 1}`,
    elevation: first(level, ['elevationMm', 'elevation']),
    height: first(level, ['heightMm', 'height']),
    rooms: countOf(first(level, ['roomCount', 'rooms']), array(level?.rooms).length),
    footprint: first(level, ['footprintM2', 'footprint', 'areaM2']),
    status: normalizedStatus(level?.status || (level?.occupied || Number(level?.roomCount) > 0
      || Number(level?.footprintM2) > 0 || array(level?.rooms).length ? 'observed' : 'unknown')),
    note: textOf(level?.note || level?.warning || level?.reason),
  }));
}

function levelsHtml(report, project) {
  const rows = levelRows(report, project);
  if (!rows.length) return '<p class="home-envelope-empty">Этажи ещё не заданы.</p>';
  return `<ul class="home-envelope-levels">${rows.map((level) => `<li data-status="${escapeHtml(level.status)}" data-home-envelope-level="${escapeHtml(level.id)}">
    <div><strong>${escapeHtml(level.name)}</strong><span>${escapeHtml(STATUS_LABELS[level.status])}</span></div>
    <dl>
      <div><dt>Отметка</dt><dd>${escapeHtml(metresFromMm(level.elevation))}</dd></div>
      <div><dt>Высота</dt><dd>${escapeHtml(metresFromMm(level.height))}</dd></div>
      <div><dt>Помещения</dt><dd>${number(level.rooms, 0)}</dd></div>
      <div><dt>Пятно</dt><dd>${finite(level.footprint) ? `${number(level.footprint, 1)} м²` : '—'}</dd></div>
    </dl>
    ${level.note ? `<p>${escapeHtml(level.note)}</p>` : ''}
  </li>`).join('')}</ul>`;
}

function roofRows(report, project) {
  const section = reportSection(report, ['roofs', 'roof'], ['roofs', 'roof']);
  const rows = Array.isArray(section) ? section
    : array(section?.records || section?.items || section?.rows || section?.roofs);
  const source = rows.length ? rows : array(project?.roofs);
  return source.map((roof, index) => ({
    id: String(roof?.id || `roof-${index + 1}`),
    name: roof?.name || roof?.title || `Кровля ${index + 1}`,
    level: roof?.levelName || roof?.levelTitle || roof?.levelId || 'этаж не указан',
    vertices: countOf(first(roof, ['outlineVertexCount', 'vertexCount', 'vertices', 'outline']), array(roof?.outline).length),
    thickness: first(roof, ['thicknessMm', 'thickness']),
    status: normalizedStatus(roof?.status || 'observed'),
    note: textOf(roof?.note || roof?.warning || roof?.reason),
  }));
}

function roofsHtml(report, project) {
  const rows = roofRows(report, project);
  if (!rows.length) {
    return '<p class="home-envelope-empty">Явная кровля не задана. Автоматическая крышка 3D не считается выбранным решением кровли.</p>';
  }
  return `<ul class="home-envelope-roofs">${rows.map((roof) => `<li data-status="${escapeHtml(roof.status)}" data-home-envelope-roof="${escapeHtml(roof.id)}">
    <div><strong>${escapeHtml(roof.name)}</strong><span>${escapeHtml(STATUS_LABELS[roof.status])}</span></div>
    <p>${escapeHtml(roof.level)} · ${roof.vertices ? `${number(roof.vertices, 0)} вершин` : 'контур не описан'}${finite(roof.thickness) ? ` · ${number(roof.thickness, 0)} мм` : ''}</p>
    ${roof.note ? `<small>${escapeHtml(roof.note)}</small>` : ''}
  </li>`).join('')}</ul>`;
}

function verticalFacts(report, project) {
  const section = object(reportSection(report,
    ['verticalElements', 'vertical', 'connections'], ['vertical', 'vertical-elements', 'connections']));
  const projectLevels = array(project?.levels);
  const projectStairs = projectLevels.flatMap((level) => array(level?.items).filter((item) => item?.kind === 'stairs'));
  const projectOpenings = projectLevels.flatMap((level) => array(level?.slabOpenings));
  const stairs = countOf(first(section, ['stairCount', 'stairs']), projectStairs.length);
  const openings = countOf(first(section, ['openingCount', 'slabOpeningCount', 'openings', 'slabOpenings']), projectOpenings.length);
  const linkedSource = first(section, ['linkedCount', 'linkedStairCount', 'linkedStairs', 'connections']);
  const linked = linkedSource ?? array(section.stairs)
    .filter((stair) => ['explicit', 'automatic'].includes(stair?.status)).length;
  const items = array(section.items || section.rows || section.elements || section.stairs);
  return {
    status: normalizedStatus(section.status || ((stairs || openings) ? 'attention' : 'unknown')),
    stairs,
    openings,
    linked: Array.isArray(linked) ? linked.length : linked,
    items,
    note: textOf(section.note || section.reason || section.summary),
  };
}

function verticalHtml(report, project) {
  const vertical = verticalFacts(report, project);
  return `<div class="home-envelope-vertical" data-status="${escapeHtml(vertical.status)}">
    <dl>
      <div><dt>Лестницы</dt><dd>${number(vertical.stairs, 0)}</dd></div>
      <div><dt>Проёмы в перекрытиях</dt><dd>${number(vertical.openings, 0)}</dd></div>
      <div><dt>Явно связанные</dt><dd>${finite(vertical.linked) ? number(vertical.linked, 0) : '—'}</dd></div>
    </dl>
    ${vertical.note ? `<p>${escapeHtml(vertical.note)}</p>` : ''}
    ${vertical.items.length ? `<ul>${vertical.items.map((item) => `<li data-status="${escapeHtml(normalizedStatus(item?.status))}"><strong>${escapeHtml(item?.name || item?.title || 'Вертикальный элемент')}</strong><span>${escapeHtml(textOf(item, STATUS_LABELS[normalizedStatus(item?.status)]))}</span></li>`).join('')}</ul>` : ''}
  </div>`;
}

function facadeRows(report) {
  const views = object(reportSection(report, ['views'], ['views', 'facades', 'sections']));
  const facadeSection = views.facades || report.facades;
  const facades = Array.isArray(facadeSection) ? facadeSection
    : array(facadeSection?.records || facadeSection?.items || facadeSection?.rows || facadeSection?.views);
  if (!facades.length) return FACADE_VIEWS;
  const normalized = facades.map((view, index) => ({
    id: typeof view === 'string' ? view : view?.id || view?.viewId,
    name: typeof view === 'string' ? FACADE_VIEWS.find((item) => item.id === view)?.name || view
      : view?.name || view?.title || `Фасад ${index + 1}`,
  })).filter((view) => view.id);
  return normalized.length ? normalized : FACADE_VIEWS;
}

function sectionRows(report, project) {
  const views = object(reportSection(report, ['views'], ['views', 'facades', 'sections']));
  const section = views.sections || report.sections;
  const rows = Array.isArray(section) ? section
    : array(section?.records || section?.items || section?.rows || section?.views);
  const source = rows.length ? rows : array(project?.views).filter((view) => view?.kind === 'section');
  return source.map((view, index) => ({
    id: typeof view === 'string' ? view : view?.id || view?.viewId,
    name: typeof view === 'string' ? view : view?.name || view?.title || `Разрез ${index + 1}`,
  })).filter((view) => view.id);
}

function viewsHtml(report, project) {
  const facades = facadeRows(report);
  const sections = sectionRows(report, project);
  return `<div class="home-envelope-views">
    <div class="home-envelope-primary-actions">
      <button type="button" class="primary" data-home-envelope-action="open-3d">Открыть 3D</button>
      <button type="button" data-home-envelope-action="open-roof-plan">План крыши</button>
    </div>
    <h3>Фасады</h3>
    <div class="home-envelope-view-actions">${facades.map((view) => `<button type="button" data-home-envelope-action="open-view" data-home-envelope-view="${escapeHtml(view.id)}">${escapeHtml(view.name)}</button>`).join('')}</div>
    <h3>Разрезы</h3>
    ${sections.length ? `<div class="home-envelope-view-actions">${sections.map((view) => `<button type="button" data-home-envelope-action="open-view" data-home-envelope-view="${escapeHtml(view.id)}">${escapeHtml(view.name)}</button>`).join('')}</div>` : '<p class="home-envelope-empty">Разрезы ещё не созданы.</p>'}
    <button type="button" data-home-envelope-action="start-section">+ Создать разрез на плане</button>
  </div>`;
}

function warningText(item) {
  return textOf(item, typeof item === 'string' ? item : 'Требуется проверить геометрию.');
}

function warningsOf(report) {
  const nested = [
    report.levels, report.roofs, report.roof, report.verticalElements, report.vertical, report.views,
    ...array(report.cards || report.sections),
  ]
    .flatMap((section) => array(section?.warnings));
  const items = [...array(report.conflicts), ...array(report.warnings), ...array(report.unknowns), ...nested]
    .map(warningText).filter(Boolean);
  return [...new Set(items)];
}

function warningsHtml(report) {
  const warnings = warningsOf(report);
  return `<section class="home-envelope-warnings" aria-labelledby="homeEnvelopeWarningsTitle">
    <h2 id="homeEnvelopeWarningsTitle">Что требует проверки</h2>
    ${warnings.length ? `<ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="home-envelope-empty">Отдельных предупреждений в геометрической сводке нет. Это не заменяет расчёты специалистов.</p>'}
  </section>`;
}

function limitationsHtml(report) {
  const limitations = [...new Set(array(report.limitations).map(warningText).filter(Boolean))];
  return `<details class="analysis-disclosure" data-analysis-fold="limitations">
    <summary>Границы проверки модели</summary>
    <p class="home-envelope-disclaimer">Модель не подтверждает несущую способность, теплотехнику или пожарную безопасность здания.</p>
    <ul>${limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </details>`;
}

/** Разметка этапа 8: факты модели и переходы к существующим рабочим видам. */
export function homeEnvelopeHtml(project, options = {}) {
  const report = options.analysis === undefined
    ? (typeof options.analyze === 'function' ? (() => {
      try { return options.analyze(project) || {}; } catch (error) {
        console.error('Обзор объёма и фасадов не рассчитался:', error);
        return { status: 'unknown', warnings: ['Не удалось собрать геометрическую сводку. Данные проекта не изменены.'] };
      }
    })() : safeEnvelope(project))
    : object(options.analysis);
  const status = normalizedStatus(report.status);
  const levels = levelRows(report, project);
  const roofs = roofRows(report, project);
  return `<div class="home-envelope" data-home-envelope>
    <section class="home-envelope-summary" data-status="${escapeHtml(status)}" aria-labelledby="homeEnvelopeSummaryTitle">
      <div><h2 id="homeEnvelopeSummaryTitle">Геометрия объёма</h2><p>${escapeHtml(STATUS_LABELS[status])}</p></div>
      <dl class="home-envelope-metrics">${summaryMetrics(report).map(metricHtml).join('')}</dl>
      <button type="button" data-analysis-open="tep">Таблица площадей</button>
    </section>
    <div class="home-envelope-cards">
      <section class="home-envelope-card" data-home-envelope-section="levels" data-status="${levels.length ? 'observed' : 'unknown'}" aria-labelledby="homeEnvelopeLevelsTitle">
        <header><div><h2 id="homeEnvelopeLevelsTitle">Этажи и отметки</h2><p>${levels.length ? `${levels.length} ${levels.length === 1 ? 'этаж' : 'этажа'}` : 'Нет данных'}</p></div><span>${levels.length ? 'По модели' : 'Не задано'}</span></header>
        ${levelsHtml(report, project)}
      </section>
      <section class="home-envelope-card" data-home-envelope-section="roofs" data-status="${roofs.length ? 'observed' : 'unknown'}" aria-labelledby="homeEnvelopeRoofsTitle">
        <header><div><h2 id="homeEnvelopeRoofsTitle">Явные кровли</h2><p>${roofs.length ? `${roofs.length} в модели` : 'Не заданы'}</p></div><span>${roofs.length ? 'По модели' : 'Не задано'}</span></header>
        ${roofsHtml(report, project)}
        <button type="button" data-home-envelope-action="open-roof-plan">Открыть план крыши</button>
      </section>
      <section class="home-envelope-card" data-home-envelope-section="vertical" aria-labelledby="homeEnvelopeVerticalTitle">
        <header><h2 id="homeEnvelopeVerticalTitle">Лестницы и проёмы</h2></header>
        ${verticalHtml(report, project)}
      </section>
      <section class="home-envelope-card" data-home-envelope-section="views" aria-labelledby="homeEnvelopeViewsTitle">
        <header><h2 id="homeEnvelopeViewsTitle">Открыть чертёж</h2></header>
        ${viewsHtml(report, project)}
      </section>
    </div>
    ${warningsHtml(report)}
    ${limitationsHtml(report)}
  </div>`;
}

/** Обрабатывает только команды этапа 8 и не меняет проект. */
export function handleHomeEnvelopeClick(event, deps = {}) {
  const button = event?.target?.closest?.('[data-home-envelope-action]');
  if (!button || !button.closest?.('[data-home-envelope]')) return false;
  const action = button.dataset.homeEnvelopeAction;
  const command = action === 'open-3d' ? deps.open3d
    : action === 'open-roof-plan' ? deps.openRoofPlan
      : action === 'start-section' ? deps.startSection : null;
  if (action === 'open-view') {
    const view = button.dataset.homeEnvelopeView;
    if (!view) return false;
    deps.closePanel?.({ restoreFocus: false });
    deps.openView?.(view);
    deps.announce?.(`Открыт вид «${button.textContent?.trim?.() || view}»`);
    return true;
  }
  if (!['open-3d', 'open-roof-plan', 'start-section'].includes(action)) return false;
  deps.closePanel?.({ restoreFocus: false });
  command?.();
  deps.announce?.(action === 'open-3d' ? 'Открыт 3D-вид'
    : action === 'open-roof-plan' ? 'Открыт план крыши'
      : 'Включён инструмент создания разреза');
  return true;
}

export const HOME_ENVELOPE_ACTION_IDS = Object.freeze([
  'open-3d', 'open-roof-plan', 'open-view', 'start-section',
]);

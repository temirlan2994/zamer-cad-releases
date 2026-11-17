// Этап 9 «Листы и выдача».
//
// Панель только показывает готовность уже существующих видов и листов.
// Она не строит чертежи и не запускает экспорт во время рендера: скачивание
// начинается исключительно после явного нажатия пользователя.

import { analyzeHomeDeliverables } from '../core/home-deliverables.js';
import { escapeHtml } from './dom.js';

const CHECKS = Object.freeze([
  { id: 'plans', title: 'Планы этажей' },
  { id: 'site', title: 'Генплан' },
  { id: 'facades', title: '4 фасада' },
  { id: 'sections', title: 'Разрезы' },
  { id: 'three-d', title: '3D-вид' },
  { id: 'sheets', title: 'Листы' },
]);

const STATUS = Object.freeze({
  ready: { label: 'Готово', css: 'ready' },
  partial: { label: 'Частично', css: 'partial' },
  missing: { label: 'Не готово', css: 'missing' },
});

const BASE_LIMITATIONS = Object.freeze([
  'Готовность означает наличие вида или листа в текущей модели, а не проверку проектного решения специалистом.',
  'PDF-листы растровые (150 dpi): текст и линии в них не являются редактируемыми CAD-объектами.',
  'IFC, DXF и структурированный JSON передают концептуальную модель; они не содержат полного расчёта конструкций и инженерных систем.',
  'Этот комплект не является рабочей документацией, экспертизой или разрешением на строительство.',
]);

const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

function normalizedStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['ready', 'checked', 'done', 'complete', 'available'].includes(status)) return 'ready';
  if (['partial', 'attention', 'incomplete'].includes(status)) return 'partial';
  return 'missing';
}

function safeAnalysis(project, analyze) {
  try {
    return object(analyze(project));
  } catch (error) {
    console.error('Готовность листов и выдачи не рассчиталась:', error);
    return {
      status: 'missing',
      summary: { ready: 0, total: CHECKS.length },
      checks: CHECKS.map(({ id, title }) => ({
        id, title, status: 'missing', summary: 'Не удалось проверить текущую модель.',
      })),
      sheets: { auto: { enabled: true, count: 0 }, user: { count: 0 }, total: 0, formats: [] },
      exports: [],
      limitations: [],
    };
  }
}

function checkIndex(analysis) {
  const source = array(analysis.checks).length ? analysis.checks : array(analysis.items);
  return new Map(source.map((entry) => [String(entry?.id || ''), object(entry)]));
}

function textOf(check) {
  return check.summary || check.detail || check.text || check.reason || 'Состояние ещё не определено.';
}

function countText(check) {
  const count = Number(check.count);
  const total = Number.isFinite(Number(check.total)) ? Number(check.total)
    : typeof check.required === 'number' && Number.isFinite(check.required) ? check.required : null;
  if (Number.isFinite(count) && total !== null) return `${count} из ${total}`;
  if (Number.isFinite(count)) return String(count);
  return '';
}

function firstViewId(check, fallback = null) {
  if (typeof check.viewId === 'string' && check.viewId) return check.viewId;
  const first = array(check.viewIds).find((id) => typeof id === 'string' && id);
  return first || fallback;
}

function checkAction(id, check, project) {
  if (id === 'sheets') {
    return '<button type="button" data-home-deliverables-action="open-sheets">Открыть листы</button>';
  }
  const fallback = id === 'plans' && project?.activeLevel ? `plan:${project.activeLevel}`
    : id === 'site' ? 'site'
      : id === 'facades' ? 'elev-N'
        : id === 'three-d' ? '3d' : null;
  const viewId = firstViewId(check, fallback);
  if (!viewId) return '';
  return `<button type="button" data-home-deliverables-action="open-view" data-home-deliverables-view="${escapeHtml(viewId)}">Открыть вид</button>`;
}

function checksHtml(project, analysis) {
  const byId = checkIndex(analysis);
  return `<ol class="home-deliverables-checks">${CHECKS.map((definition) => {
    const check = byId.get(definition.id) || {};
    const status = normalizedStatus(check.status);
    const count = countText(check);
    return `<li data-home-deliverables-check="${definition.id}" data-status="${status}">
      <div class="home-deliverables-check-mark" aria-hidden="true"></div>
      <div class="home-deliverables-check-copy">
        <h3>${escapeHtml(definition.title)}${count ? ` <small>${escapeHtml(count)}</small>` : ''}</h3>
        <p>${escapeHtml(textOf(check))}</p>
      </div>
      <span class="home-deliverables-check-status">${STATUS[status].label}</span>
      ${checkAction(definition.id, check, project)}
    </li>`;
  }).join('')}</ol>`;
}

function formatRows(formats) {
  if (Array.isArray(formats)) return formats.map((entry) => {
    if (typeof entry === 'string') return { id: entry, count: null };
    return { id: entry?.id || entry?.format || entry?.name, count: entry?.count };
  }).filter((entry) => entry.id);
  return Object.entries(object(formats)).map(([id, count]) => ({ id, count }));
}

function sheetsHtml(analysis) {
  const sheets = object(analysis.sheets);
  const auto = object(sheets.auto);
  const user = object(sheets.user);
  const autoCount = Number(auto.count) || 0;
  const userCount = Number(user.count) || 0;
  const total = Number.isFinite(Number(sheets.total)) ? Number(sheets.total) : autoCount + userCount;
  const formats = formatRows(sheets.formats);
  return `<dl class="home-deliverables-sheet-summary">
    <div><dt>Всего листов</dt><dd>${total}</dd></div>
    <div><dt>Автолисты</dt><dd>${auto.enabled === false ? 'выключены' : autoCount}</dd></div>
    <div><dt>Свои листы</dt><dd>${userCount}</dd></div>
    <div><dt>Форматы своих листов</dt><dd>${formats.length
    ? formats.map(({ id, count }) => `${escapeHtml(id)}${Number.isFinite(Number(count)) ? ` × ${Number(count)}` : ''}`).join(', ')
    : '—'}</dd></div>
  </dl>`;
}

function exportsHtml(analysis) {
  const exports = array(analysis.exports);
  if (!exports.length) return '<p class="home-deliverables-empty">Доступные форматы ещё не определены.</p>';
  return `<div class="home-deliverables-exports">${exports.map((entry) => {
    const item = object(entry);
    const kind = String(item.kind || '');
    const available = item.available !== false && Boolean(kind);
    const reason = [item.reason || item.detail, item.limitation].filter(Boolean).join(' ');
    return `<button type="button" data-home-deliverables-action="export" data-home-deliverables-kind="${escapeHtml(kind)}"${available ? '' : ' disabled aria-disabled="true"'}>
      <strong>${escapeHtml(item.label || item.title || kind || 'Формат')}</strong>
      ${reason ? `<span>${escapeHtml(reason)}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}

function limitationText(entry) {
  return typeof entry === 'string' ? entry : entry?.text || entry?.summary || entry?.reason || '';
}

function limitationsHtml(analysis) {
  const seen = new Set();
  const rows = [
    ...array(analysis.limitations).map(limitationText),
    ...BASE_LIMITATIONS,
  ]
    .map((text) => String(text || '').trim())
    .filter((text) => text && !seen.has(text) && seen.add(text));
  return `<ul class="home-deliverables-limitations">${rows.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`;
}

function warningsHtml(analysis) {
  const rows = array(analysis.warnings).map(limitationText).map((text) => String(text || '').trim()).filter(Boolean);
  if (!rows.length) return '';
  return `<section class="home-deliverables-warnings" aria-labelledby="homeDeliverablesWarningsTitle">
    <h2 id="homeDeliverablesWarningsTitle">Что нужно исправить или уточнить</h2>
    <ul>${rows.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
  </section>`;
}

/**
 * Чистая разметка этапа 9. `options.analysis` удобен для снимков и тестов;
 * в приложении используется analyzeHomeDeliverables(project).
 */
export function homeDeliverablesHtml(project, options = {}) {
  const analysis = options.analysis === undefined
    ? safeAnalysis(project, options.analyze || analyzeHomeDeliverables)
    : object(options.analysis);
  const status = normalizedStatus(analysis.status);
  const summary = object(analysis.summary);
  const ready = Number(summary.ready) || 0;
  const total = Number(summary.total) || CHECKS.length;
  return `<div class="home-deliverables" data-home-deliverables data-status="${status}">
    <section class="home-deliverables-summary" aria-labelledby="homeDeliverablesTitle">
      <div>
        <h2 id="homeDeliverablesTitle">Листы и выдача</h2>
        <p>Готово ${ready} из ${total}</p>
      </div>
      <strong>${STATUS[status].label}</strong>
    </section>
    <section aria-labelledby="homeDeliverablesChecksTitle">
      <h2 id="homeDeliverablesChecksTitle">Состав комплекта</h2>
      ${checksHtml(project, analysis)}
    </section>
    <section aria-labelledby="homeDeliverablesSheetsTitle">
      <h2 id="homeDeliverablesSheetsTitle">Состав листов</h2>
      ${sheetsHtml(analysis)}
      <button type="button" class="primary" data-home-deliverables-action="open-sheets">Настроить листы</button>
    </section>
    <section aria-labelledby="homeDeliverablesExportsTitle">
      <h2 id="homeDeliverablesExportsTitle">Экспорт</h2>
      ${exportsHtml(analysis)}
    </section>
    ${warningsHtml(analysis)}
    <details class="analysis-disclosure" data-analysis-fold="limitations">
      <summary>Границы проверки комплекта</summary>
      ${limitationsHtml(analysis)}
    </details>
  </div>`;
}

/** Делегированный обработчик CTA этапа 9. */
export function handleHomeDeliverablesClick(event, deps = {}) {
  const button = event?.target?.closest?.('[data-home-deliverables-action]');
  if (!button || button.disabled || button.getAttribute?.('aria-disabled') === 'true') return false;
  const action = button.dataset?.homeDeliverablesAction;
  if (action === 'open-view') {
    const viewId = button.dataset.homeDeliverablesView;
    if (!viewId) return false;
    deps.openView?.(viewId);
    deps.announce?.('Открыт вид комплекта');
    return true;
  }
  if (action === 'open-sheets') {
    deps.openSheets?.();
    deps.announce?.('Открыты листы проекта');
    return true;
  }
  if (action === 'export') {
    const kind = button.dataset.homeDeliverablesKind;
    if (!kind) return false;
    deps.handleExport?.(kind);
    deps.announce?.('Начат экспорт выбранного формата');
    return true;
  }
  return false;
}

export const HOME_DELIVERABLE_CHECK_IDS = Object.freeze(CHECKS.map(({ id }) => id));

// Диалог сезонной световой сводки. Тяжёлые расчёты остаются в core/:
// здесь только запуск, доступное представление и сохранение CSV/JSON.

import {
  buildSolarReportAsync, buildSolarReportCsv, buildSolarReportJson,
} from '../core/solar-report.js';
import { roomDaylightAnalysis } from '../core/daylight-analysis.js';
import { saveFile } from './cloud.js';
import { el, escapeHtml, roomCountLabel, toast } from './dom.js';
import { safeProjectFileName } from './project-name.js';
import { state } from './state.js';

let bound = false;
let buildToken = 0;
let currentReport = null;
let previousFocus = null;
let returnToClimate = false;

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

function number(value, digits = 1) {
  if (!finite(value)) return '—';
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function percent(value, digits = 0) {
  return finite(value) ? `${number(Number(value) * 100, digits)} %` : '—';
}

function hours(minutes) {
  return finite(minutes) ? `${number(Number(minutes) / 60, 1)} ч` : '—';
}

function glazingRatio(glazing) {
  const ratio = Number(glazing?.ratio);
  return ratio > 0 ? `1:${number(1 / ratio, 1)}` : '—';
}

function qualityLabel(quality) {
  if (quality === 'verified') return 'координаты подтверждены';
  if (quality === 'estimated') return 'расчётная оценка';
  return 'нет данных о солнце';
}

function generatedLabel(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

function monthRows(room) {
  return (room.months || []).map((month) => `
    <tr>
      <td>${escapeHtml(month.label)}</td>
      <td>${escapeHtml(month.date)}</td>
      <td data-report-metric="month-mean-sun">${month.available ? hours(month.meanMinutes) : '—'}</td>
      <td data-report-metric="month-max-sun">${month.available ? hours(month.maxMinutes) : '—'}</td>
      <td data-report-metric="month-coverage-2h">${month.available ? percent(month.coverage2h) : '—'}</td>
      <td data-report-metric="month-lit-share">${month.available ? percent(month.litShare) : '—'}</td>
    </tr>`).join('');
}

function roomDetails(room) {
  const confidence = room.daylight?.confidence;
  const confidenceLevel = confidence?.level === 'high' ? 'высокая'
    : confidence?.level === 'medium' ? 'средняя'
      : confidence?.level === 'low' ? 'низкая' : confidence?.level;
  const confidenceText = confidence?.level
    ? `${confidenceLevel}${finite(confidence.score) ? ` · ${number(confidence.score * 100, 0)} %` : ''}`
    : 'не указана';
  const daylightNote = room.daylight
    ? `Предварительный КЕО/DF: ${number(room.daylight.meanDaylightFactor, 2)} % · ` +
      `${number(room.daylight.meanLux, 0)} лк · охват ≥300 лк ${percent(room.daylight.coverage300)} · ` +
      `уверенность ${confidenceText}.`
    : 'Предварительная оценка КЕО и освещённости недоступна.';
  const assumptions = room.daylight?.assumptions || null;
  const transmission = assumptions?.transmission || null;
  const daylightAssumptions = assumptions
    ? `${assumptions.sky || 'CIE overcast'} · снаружи ${number(assumptions.externalLux, 0)} лк · ` +
      `плоскость ${number(assumptions.workplane, 0)} мм · ` +
      `стекло ${percent(transmission?.defaultGlass, 0)} · рама ${percent(transmission?.frameFactor, 0)} · ` +
      `запас ${percent(transmission?.maintenanceFactor, 0)} · отражение ${percent(assumptions.interiorReflectance, 0)}.`
    : '';
  return `
    <tr class="solar-report-details-row">
      <td colspan="10">
        <details class="solar-report-details">
          <summary>Помесячные значения</summary>
          <p class="hint">${escapeHtml(daylightNote)}</p>
          ${daylightAssumptions ? `<p class="hint">${escapeHtml(daylightAssumptions)}</p>` : ''}
          <div class="solar-report-scroll" role="region" aria-label="Помесячные показатели" tabindex="0">
            <table class="solar-report-table" aria-label="Помесячные показатели помещения">
              <thead><tr>
                <th scope="col">Месяц</th><th scope="col">Дата</th>
                <th scope="col">Среднее солнце</th><th scope="col">Максимум</th>
                <th scope="col">Охват ≥2 ч</th><th scope="col">Площадь с солнцем</th>
              </tr></thead>
              <tbody>${monthRows(room)}</tbody>
            </table>
          </div>
        </details>
      </td>
    </tr>`;
}

function roomRows(report) {
  if (!report.rooms?.length) {
    return '<tr><td colspan="10" class="hint">В проекте нет помещений для световой сводки.</td></tr>';
  }
  return report.rooms.map((room) => {
    const directAvailable = room.quality !== 'unavailable';
    const daylight = room.daylight;
    const title = [room.number, room.name].filter(Boolean).join(' · ') || 'Помещение';
    const row = `
      <tr data-solar-report-row="${escapeHtml(room.roomId)}">
        <th scope="row">${escapeHtml(title)}</th>
        <td>${escapeHtml(room.levelName)}</td>
        <td data-report-metric="area">${number(room.area, 1)} м²</td>
        <td data-report-metric="glazing">${glazingRatio(room.glazing)}${room.regulated ? (room.glazing?.meets ? ' · ориентир выполнен' : ' · ниже 1:8') : ''}</td>
        <td data-report-metric="daylight-factor">${daylight?.meanDaylightFactor == null ? '—' : `${number(daylight.meanDaylightFactor, 2)} %`}</td>
        <td data-report-metric="illuminance">${daylight?.meanLux == null ? '—' : `${number(daylight.meanLux, 0)} лк`}</td>
        <td data-report-metric="direct-sun">${directAvailable ? hours(room.annual?.averageMeanMinutes) : '—'}</td>
        <td data-report-metric="coverage-2h">${directAvailable ? percent(room.annual?.minimumCoverage2h) : '—'}</td>
        <td data-report-metric="season">${directAvailable ? `${escapeHtml(room.annual?.worstMonth?.label || '—')} → ${escapeHtml(room.annual?.bestMonth?.label || '—')}` : '—'}</td>
        <td data-report-metric="quality">${escapeHtml(qualityLabel(room.quality))}</td>
      </tr>`;
    return row + roomDetails(room);
  }).join('');
}

function renderReport(report) {
  const table = el('solarReportTable');
  table.innerHTML = `
    <thead><tr>
      <th scope="col">Помещение</th><th scope="col">Этаж</th><th scope="col">Площадь</th>
      <th scope="col">Остекление</th><th scope="col">КЕО / DF</th><th scope="col">Люксы</th>
      <th scope="col">Солнце / реп. день</th><th scope="col">Охват ≥2 ч</th>
      <th scope="col">Худший → лучший</th><th scope="col">Данные</th>
    </tr></thead>
    <tbody>${roomRows(report)}</tbody>`;

  const dates = report.representativeDates?.length || 0;
  const verified = report.site?.verified ? 'координаты и север подтверждены' : 'координаты или север не подтверждены';
  const daylightRooms = report.rooms.filter((room) => room.daylight).length;
  el('solarReportSummary').textContent =
    `${report.year} · ${roomCountLabel(report.summary.rooms)} · ${dates} реперных дат · ` +
    `КЕО/люксы: ${daylightRooms} · ${verified} · сформировано ${generatedLabel(report.generatedAt)}`;
  const direct = report.assumptions?.directSun || {};
  el('solarReportAssumptions').textContent =
    `${dates} реперных дат (по 21-му числу) · шаг ${direct.stepMin ?? '—'} мин · ` +
    `сетка от ${direct.requestedGridCell ?? '—'} мм, до ${direct.maxCells ?? '—'} ячеек/помещение. ` +
    'Кроны, перголы и прозрачные навесы консервативно непрозрачны круглый год; рельеф не затеняет. Пересекающая сплошную массу вычитающая масса вырезает отверстие в пределах своего 3D-объёма и сама тени не даёт. Это эскизная сводка, не экспертиза.';
}

function setLoading(loading) {
  const dialog = el('solarReportDialog');
  dialog.setAttribute('aria-busy', String(loading));
  el('solarReportSpinner').hidden = !loading;
  el('solarReportCsv').disabled = loading || !currentReport;
  el('solarReportJson').disabled = loading || !currentReport;
}

function visibleFocusTarget(node) {
  return node?.isConnected && !node.closest?.('[hidden]') && node.getClientRects?.().length ? node : null;
}

function reportReturnTarget(preferred = null) {
  return visibleFocusTarget(preferred) || visibleFocusTarget(el('exportBtn')) ||
    visibleFocusTarget(el('moreBtn')) || visibleFocusTarget(document.querySelector('#projectRouteSteps [data-route-view]'));
}

function showDialog() {
  const dialog = el('solarReportDialog');
  if (dialog.hidden) {
    const active = document.activeElement;
    // Пункт выпадающего меню уже скрыт handleExport(). Возвращать фокус на
    // скрытую кнопку нельзя, поэтому запасной адрес — видимая кнопка «Экспорт».
    previousFocus = reportReturnTarget(active);
  }
  dialog.hidden = false;
  requestAnimationFrame(() => el('solarReportClose').focus());
}

export function closeSolarReport() {
  buildToken += 1;
  const dialog = el('solarReportDialog');
  dialog.hidden = true;
  dialog.setAttribute('aria-busy', 'false');
  if (returnToClimate) {
    document.dispatchEvent(new CustomEvent('kepler:open-climate'));
    el('solarAnnualRun')?.focus();
    returnToClimate = false;
  } else {
    reportReturnTarget(previousFocus)?.focus();
  }
  previousFocus = null;
}

function nextPaint() {
  return new Promise((resolve) => {
    const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    schedule(() => setTimeout(resolve, 0));
  });
}

export async function openSolarReport(options = {}) {
  returnToClimate = options.returnToClimate === true;
  showDialog();
  const token = ++buildToken;
  currentReport = null;
  el('solarReportTable').innerHTML = '';
  el('solarReportSummary').textContent = '';
  el('solarReportAssumptions').textContent = '';
  el('solarReportStatus').textContent = 'Подготавливаем сезонный расчёт…';
  setLoading(true);
  await nextPaint();
  if (token !== buildToken) return null;

  try {
    const generatedAt = new Date().toISOString();
    // Сезонная сводка обязана использовать те же настройки стекла, что и
    // открытая карта КЕО/люксов, иначе две панели показывали бы разные числа.
    const daylightOptions = {
      transmittance: state.solarAnalysis?.transmittance,
      externalLux: state.solarAnalysis?.exteriorLux,
      frameFactor: state.solarAnalysis?.frameFactor,
      maintenanceFactor: state.solarAnalysis?.maintenanceFactor,
      interiorReflectance: state.solarAnalysis?.interiorReflectance,
    };
    const report = await buildSolarReportAsync(state.project, {
      generatedAt,
      daylightAnalyzer: (project, options) => roomDaylightAnalysis(project, {
        ...options,
        ...Object.fromEntries(Object.entries(daylightOptions).filter(([, value]) => value != null)),
      }),
      onProgress(progress) {
        if (token !== buildToken) return;
        el('solarReportStatus').textContent = progress.total
          ? `Расчёт: ${progress.done} из ${progress.total}`
          : 'Расчёт…';
      },
      shouldCancel: () => token !== buildToken,
    });
    if (token !== buildToken) return null;
    currentReport = report;
    renderReport(report);
    el('solarReportStatus').textContent = report.cancelled
      ? 'Расчёт остановлен.'
      : 'Сводка готова. Это предварительная оценка, не светотехническая экспертиза.';
    return report;
  } catch (error) {
    console.error('Не удалось построить сезонный световой отчёт:', error);
    el('solarReportStatus').textContent = `Не удалось построить отчёт: ${error?.message || 'ошибка'}`;
    el('solarReportTable').innerHTML =
      '<tbody><tr><td class="hint">Проверьте проект и повторите расчёт.</td></tr></tbody>';
    toast('Сезонный световой отчёт не построен', true);
    return null;
  } finally {
    if (token === buildToken) setLoading(false);
  }
}

export async function exportSolarReport(format) {
  const report = currentReport || await openSolarReport();
  if (!report || report.cancelled) return false;
  const base = `${safeProjectFileName(report.projectName)}-световой-отчёт-${report.year}`;
  if (format === 'csv') {
    const saved = await saveFile(`${base}.csv`, buildSolarReportCsv(report), 'text/csv;charset=utf-8');
    if (saved) toast('Сезонная световая сводка сохранена в CSV');
    return saved;
  }
  if (format === 'json') {
    const saved = await saveFile(`${base}.json`, buildSolarReportJson(report), 'application/json;charset=utf-8');
    if (saved) toast('Сезонный световой отчёт сохранён в JSON');
    return saved;
  }
  return false;
}

export function bindSolarReport() {
  if (bound) return;
  const dialog = el('solarReportDialog');
  if (!dialog) return;
  bound = true;
  el('solarReportClose').addEventListener('click', closeSolarReport);
  el('solarReportCsv').addEventListener('click', () => { exportSolarReport('csv'); });
  el('solarReportJson').addEventListener('click', () => { exportSolarReport('json'); });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeSolarReport();
  });
  document.addEventListener('keydown', (event) => {
    if (dialog.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSolarReport();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

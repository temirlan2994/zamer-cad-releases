// Фактическое солнце рассчитывается по дате и времени проекта.

import { state } from './state.js';
import {
  fmtClock, formatSunLabel, rumbOf, shadowPolys, shadowSignature, sunClass, sunForSite,
  sunHoursGrid, sunHoursSummary, sunRiseSet,
} from '../core/landscape-shadow.js';

// Не из dom.js: render.js подключает этот файл, а dom.js требует document
// (юнит-тесты рисования идут в Node).
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let redraw = () => {};
let bar = null;
let commit = null;
let renderedSite = null;
let barKey = '';

export function landscapeSunTime(site) {
  return state.lsSunPreviewTime ?? site.sun.time;
}

const visKey = () => {
  const v = state.lsVis || {};
  return Object.keys(v).sort().map((k) => `${k}:${v[k] !== false}`).join(',');
};

// ------------------------------------------------------------ Кеш теней

let frame = { key: null, value: null };

// Тени кадра: { sun, polys, label } или null (режим не «Солнце»).
// objects — видимые объекты ландшафта. Кеш — по (дата, время, подпись
// проекта, слои); пока тянут ползунок — упрощённые кроны.
export function landscapeSunFrame(project, objects) {
  const ls = state.lsSun;
  if (ls?.mode !== 'sun' || !project?.site) return null;
  const simple = Boolean(state.lsSunDragging);
  const { date } = project.site.sun;
  const time = landscapeSunTime(project.site);
  const key = `${date}|${time}|${shadowSignature(project)}|${visKey()}|${objects.length}|${simple ? 1 : 0}`;
  if (frame.key === key) return frame.value;
  const sun = sunForSite(project.site, date, time);
  const polys = shadowPolys(project, sun, { objects, simple });
  frame = { key, value: { sun, polys, simple, label: formatSunLabel(date, time) } };
  return frame.value;
}

// ------------------------------------------------------------ Освещённость

let grid = { key: null, value: null, pending: null, timer: 0 };

// Сетка «солнечных часов» (1 м): считается с задержкой, пока идёт правка
// показывается прежняя. Нет участка — null.
export function landscapeSunGrid(project, objects) {
  const ls = state.lsSun;
  if (ls?.mode !== 'sun' || !ls.analysis || !project?.site?.boundary?.length) return null;
  const { date } = project.site.sun;
  const key = `${date}|${shadowSignature(project)}|${visKey()}|${objects.length}`;
  if (grid.key !== key && grid.pending !== key) {
    grid.pending = key;
    clearTimeout(grid.timer);
    grid.timer = setTimeout(() => {
      try {
        const g = sunHoursGrid(project, date, { objects });
        grid = { key, value: g, pending: null, timer: 0, summary: sunHoursSummary(g, objects) };
      } catch {
        grid = { key, value: null, pending: null, timer: 0, summary: null };
      }
      renderSummary();
      redraw();
    }, grid.value ? 350 : 0);
  }
  return grid.value;
}

// ------------------------------------------------------------ Плашка

function sunInfo() {
  const site = state.project?.site;
  if (!site) return '';
  const s = sunForSite(site, site.sun.date, landscapeSunTime(site));
  if (!s.up) return 'Солнце за горизонтом — теней нет';
  return `Солнце: ${rumbOf(s.azimuth)}, азимут ${Math.round(s.azimuth)}°, высота ${Math.round(s.altitude)}°`;
}

function riseSetText() {
  const site = state.project?.site;
  if (!site) return '';
  const { rise, set } = sunRiseSet(site, site.sun.date);
  return rise === null ? 'Полярная ночь' : `Восход ${fmtClock(rise)}, заход ${fmtClock(set)}`;
}

const fmtH = (h) => `${(Math.round(h * 2) / 2).toFixed(1).replace('.', ',').replace(',0', '')} ч`;

function legendHtml() {
  if (!state.lsSun?.analysis || !state.project?.site?.boundary?.length || !grid.summary || grid.pending) return '';
  return `<span class="ls-sun-legend"><span>0 ч</span><i aria-hidden="true"></i><span>${fmtH(grid.summary.dayHours)}</span></span>`;
}

function summaryHtml() {
  const ls = state.lsSun;
  if (!ls.analysis) return '';
  if (!state.project?.site?.boundary?.length) return '<p class="hint">Для анализа нужна граница участка.</p>';
  const s = grid.summary;
  if (!s || grid.pending) return '<p class="hint">Считаем освещённость…</p>';
  const beds = [...s.beds].sort((a, b) => a.hours - b.hours).slice(0, 6);
  return `
    ${legendHtml()}
    <div class="prop-row"><span>Участок, в среднем</span><strong>${fmtH(s.mean)} солнца</strong></div>
    <div class="prop-row"><span>Тень больше полудня</span><strong>${Math.round(s.shadyM2)} м²</strong></div>
    ${beds.map((b) => `<div class="prop-row"><span>${escapeHtml(b.title)}</span><strong>${fmtH(b.hours)} · ${sunClass(b.hours)}</strong></div>`).join('')}`;
}

function renderSummary() {
  const box = bar?.querySelector('#lsSunSummary');
  if (box) box.innerHTML = summaryHtml();
  const key = bar?.querySelector('.ls-sun-fold-key');
  if (key) key.innerHTML = legendHtml();
}

function renderBar() {
  if (!bar) return;
  const site = state.project?.site;
  const key = [state.lsSun?.mode, state.lsSun?.analysis, site?.sun?.date, site?.sun?.time,
    site?.location?.lat, site?.location?.lon, site?.location?.tz, site?.north].join('|');
  if (key === barKey && site === renderedSite) return;
  const expanded = site === renderedSite && bar.querySelector('#lsSunFold')?.getAttribute('aria-expanded') === 'true';
  barKey = key;
  renderedSite = site;
  const focused = bar.contains(document.activeElement) ? document.activeElement.id : '';
  state.lsSunPreviewTime = null;
  state.lsSunDragging = false;
  const sun = state.lsSun?.mode === 'sun' && site;
  const time = sun ? landscapeSunTime(site) : 0;
  bar.dataset.mode = state.lsSun?.mode || 'default';
  bar.innerHTML = `${sun ? `<button type="button" id="lsSunFold" aria-expanded="${expanded}" aria-controls="lsSunControls">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></svg>
    <span class="sr-only">Солнце на участке</span><strong id="lsSunFoldClock">${fmtClock(time)}</strong>
    <span class="ls-sun-fold-key">${legendHtml()}</span><span class="ls-sun-caret" aria-hidden="true"></span>
  </button>` : ''}
  <div id="lsSunControls"><div class="ls-sun-row"><button type="button" data-landscape-climate>☀ Свет на участке →</button></div>
    ${sun ? `<div class="ls-sun-row">
      <input id="lsSunTime" type="range" min="0" max="1439" step="1" value="${time}" aria-label="Время суток">
      <strong id="lsSunClock">${fmtClock(time)}</strong>
    </div>
    <div class="ls-sun-info" id="lsSunInfo">${escapeHtml(sunInfo())}<br><span>${escapeHtml(riseSetText())}</span></div>
    <div id="lsSunSummary">${summaryHtml()}</div>` : ''}</div>`;
  const fold = bar.querySelector('#lsSunFold');
  fold?.addEventListener('click', () => {
    fold.setAttribute('aria-expanded', String(fold.getAttribute('aria-expanded') !== 'true'));
  });
  bar.querySelector('[data-landscape-climate]').addEventListener('click', (event) => {
    document.dispatchEvent(new CustomEvent('kepler:open-climate', { detail: { opener: event.currentTarget, location: true } }));
  });
  const slider = bar.querySelector('#lsSunTime');
  if (focused) bar.querySelector(`#${focused}`)?.focus({ preventScroll: true });
  slider?.addEventListener('input', () => {
    state.lsSunDragging = true;
    state.lsSunPreviewTime = Number(slider.value);
    bar.querySelector('#lsSunClock').textContent = fmtClock(state.lsSunPreviewTime);
    bar.querySelector('#lsSunFoldClock').textContent = fmtClock(state.lsSunPreviewTime);
    updateInfo();
    redraw();
  });
  slider?.addEventListener('change', () => {
    state.lsSunDragging = false;
    state.lsSunPreviewTime = null;
    const minutes = Number(slider.value);
    if (site.sun.time !== minutes) commit(() => { site.sun.time = minutes; });
    updateInfo();
    redraw();
  });
}

function updateInfo() {
  const info = bar?.querySelector('#lsSunInfo');
  if (info) info.innerHTML = `${escapeHtml(sunInfo())}<br><span>${escapeHtml(riseSetText())}</span>`;
}

// На телефоне раскрываем панель только при просмотре физических теней.
export function bindLandscapeSun(requestDraw, mutate) {
  commit = mutate;
  redraw = requestDraw || redraw;
  if (typeof document === 'undefined') return;
  bar = document.getElementById('lsSunBar'); // index.html, в .canvas-wrap
  if (!bar) return;
  // Колесо и клики по плашке не должны двигать план.
  for (const ev of ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'dblclick']) {
    bar.addEventListener(ev, (e) => e.stopPropagation());
  }
  bar.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const fold = bar.querySelector('#lsSunFold[aria-expanded="true"]');
    if (!fold?.offsetWidth) return;
    event.preventDefault();
    event.stopPropagation();
    fold.setAttribute('aria-expanded', 'false');
    fold.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!bar.contains(event.target)) bar.querySelector('#lsSunFold[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('kepler:project-change', renderBar);
  renderBar();
}

// Пересобрать плашку (после смены проекта — другой участок, широта).
export function refreshLandscapeSun() {
  renderBar();
}

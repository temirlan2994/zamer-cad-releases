// Тени по времени суток в «Ландшафте»: плашка «Солнце» поверх плана
// (режим теней, время, дата, анализ освещённости) и кеш расчёта
// (core/landscape-shadow.js). Настройки — только вид, в браузере.

import { state } from './state.js';
import { setLandscapeSun, SUN_TIME_MAX, SUN_TIME_MIN } from './landscape-style.js';
import {
  SUN_DATES, fmtClock, formatSunLabel, rumbOf, shadowPolys, shadowSignature, sunClass, sunForSite,
  sunHoursGrid, sunHoursSummary, sunRiseSet,
} from '../core/landscape-shadow.js';

const MODES = [
  { id: 'off', title: 'Выкл' },
  { id: 'default', title: 'Обычные' },
  { id: 'sun', title: 'Солнце' },
];

// Не из dom.js: render.js подключает этот файл, а dom.js требует document
// (юнит-тесты рисования идут в Node).
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let redraw = () => {};
let bar = null;

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
  const key = `${ls.date}|${ls.time}|${shadowSignature(project)}|${visKey()}|${objects.length}|${simple ? 1 : 0}`;
  if (frame.key === key) return frame.value;
  const sun = sunForSite(project.site, ls.date, ls.time);
  const polys = shadowPolys(project, sun, { objects, simple });
  frame = { key, value: { sun, polys, simple, label: formatSunLabel(ls.date, ls.time) } };
  return frame.value;
}

// ------------------------------------------------------------ Освещённость

let grid = { key: null, value: null, pending: null, timer: 0 };

// Сетка «солнечных часов» (1 м): считается с задержкой, пока идёт правка
// показывается прежняя. Нет участка — null.
export function landscapeSunGrid(project, objects) {
  const ls = state.lsSun;
  if (ls?.mode !== 'sun' || !ls.analysis || !project?.site?.boundary?.length) return null;
  const key = `${ls.date}|${shadowSignature(project)}|${visKey()}|${objects.length}`;
  if (grid.key !== key && grid.pending !== key) {
    grid.pending = key;
    clearTimeout(grid.timer);
    grid.timer = setTimeout(() => {
      try {
        const g = sunHoursGrid(project, ls.date, { objects });
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
  const ls = state.lsSun;
  const site = state.project?.site;
  if (!site) return '';
  const s = sunForSite(site, ls.date, ls.time);
  if (!s.up) return 'Солнце за горизонтом — теней нет';
  return `Солнце: ${rumbOf(s.azimuth)}, азимут ${Math.round(s.azimuth)}°, высота ${Math.round(s.altitude)}°`;
}

function riseSetText() {
  const site = state.project?.site;
  if (!site) return '';
  const { rise, set } = sunRiseSet(site, state.lsSun.date);
  return rise === null ? 'Полярная ночь' : `Восход ${fmtClock(rise)}, заход ${fmtClock(set)}`;
}

const fmtH = (h) => `${(Math.round(h * 2) / 2).toFixed(1).replace('.', ',').replace(',0', '')} ч`;

function summaryHtml() {
  const ls = state.lsSun;
  if (!ls.analysis) return '';
  if (!state.project?.site?.boundary?.length) return '<p class="hint">Для анализа нужна граница участка.</p>';
  const s = grid.summary;
  if (!s || grid.pending) return '<p class="hint">Считаем освещённость…</p>';
  const beds = [...s.beds].sort((a, b) => a.hours - b.hours).slice(0, 6);
  return `
    <div class="ls-sun-legend"><span>0 ч</span><i></i><span>${fmtH(s.dayHours)}</span></div>
    <div class="prop-row"><span>Участок, в среднем</span><strong>${fmtH(s.mean)} солнца</strong></div>
    <div class="prop-row"><span>Тень больше полудня</span><strong>${Math.round(s.shadyM2)} м²</strong></div>
    ${beds.map((b) => `<div class="prop-row"><span>${escapeHtml(b.title)}</span><strong>${fmtH(b.hours)} · ${sunClass(b.hours)}</strong></div>`).join('')}`;
}

function renderSummary() {
  const box = bar?.querySelector('#lsSunSummary');
  if (box) box.innerHTML = summaryHtml();
}

function renderBar() {
  if (!bar) return;
  const ls = state.lsSun;
  const sun = ls.mode === 'sun';
  const preset = SUN_DATES.find((d) => ls.date.slice(5) === d.id);
  bar.innerHTML = `
    <div class="ls-sun-row">
      <span class="ls-sun-title">Тени</span>
      <div class="seg" role="radiogroup" aria-label="Тени ландшафта">
        ${MODES.map((m) => `<label class="seg-opt${ls.mode === m.id ? ' active' : ''}"><input type="radio" name="lsSunMode" value="${m.id}" ${ls.mode === m.id ? 'checked' : ''}><span>${m.title}</span></label>`).join('')}
      </div>
    </div>
    ${sun ? `
    <div class="ls-sun-row">
      <input id="lsSunTime" type="range" min="${SUN_TIME_MIN}" max="${SUN_TIME_MAX}" step="15" value="${ls.time}" aria-label="Время суток">
      <strong id="lsSunClock">${fmtClock(ls.time)}</strong>
    </div>
    <div class="ls-sun-row">
      <select id="lsSunPreset" aria-label="Дата">
        ${SUN_DATES.map((d) => `<option value="${d.id}" ${preset?.id === d.id ? 'selected' : ''}>${d.title}</option>`).join('')}
        <option value="" ${preset ? '' : 'selected'}>Другая дата</option>
      </select>
      <input id="lsSunDate" type="date" value="${ls.date}" aria-label="Дата">
    </div>
    <div class="ls-sun-info" id="lsSunInfo">${escapeHtml(sunInfo())}<br><span>${escapeHtml(riseSetText())}</span></div>
    <label class="check-row"><input type="checkbox" id="lsSunAnalysis" ${ls.analysis ? 'checked' : ''}><span>Анализ освещённости (часы солнца)</span></label>
    <div id="lsSunSummary">${summaryHtml()}</div>` : ''}`;
  bar.querySelectorAll('input[name="lsSunMode"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    setLandscapeSun({ mode: r.value });
    renderBar();
    redraw();
  }));
  const time = bar.querySelector('#lsSunTime');
  if (time) {
    time.addEventListener('input', () => {
      state.lsSunDragging = true;
      setLandscapeSun({ time: Number(time.value) });
      bar.querySelector('#lsSunClock').textContent = fmtClock(state.lsSun.time);
      updateInfo();
      redraw();
    });
    time.addEventListener('change', () => {
      state.lsSunDragging = false;
      setLandscapeSun({ time: Number(time.value) });
      redraw();
    });
  }
  bar.querySelector('#lsSunPreset')?.addEventListener('change', (e) => {
    if (!e.target.value) { bar.querySelector('#lsSunDate')?.focus(); return; }
    setLandscapeSun({ date: `${state.lsSun.date.slice(0, 4)}-${e.target.value}` });
    renderBar();
    redraw();
  });
  bar.querySelector('#lsSunDate')?.addEventListener('change', (e) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
    setLandscapeSun({ date: e.target.value });
    renderBar();
    redraw();
  });
  bar.querySelector('#lsSunAnalysis')?.addEventListener('change', (e) => {
    setLandscapeSun({ analysis: e.target.checked });
    renderBar();
    redraw();
  });
}

function updateInfo() {
  const info = bar?.querySelector('#lsSunInfo');
  if (info) info.innerHTML = `${escapeHtml(sunInfo())}<br><span>${escapeHtml(riseSetText())}</span>`;
}

// Плашка — в углу холста, видна только в «Ландшафте» (CSS .mode-landscape).
export function bindLandscapeSun(requestDraw) {
  redraw = requestDraw || redraw;
  if (typeof document === 'undefined') return;
  bar = document.getElementById('lsSunBar'); // index.html, в .canvas-wrap
  if (!bar) return;
  // Колесо и клики по плашке не должны двигать план.
  for (const ev of ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'dblclick']) {
    bar.addEventListener(ev, (e) => e.stopPropagation());
  }
  renderBar();
}

// Пересобрать плашку (после смены проекта — другой участок, широта).
export function refreshLandscapeSun() {
  renderBar();
}

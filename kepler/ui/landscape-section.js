// Инструмент «Разрез» режима «Ландшафт»: линия по точкам (Enter/двойной
// клик — готово), разрез хранится в site.landscape.sections (необязательное
// поле), вид сбоку — в панели поверх плана: стиль «Эскиз»/«Чертёж», сторона
// взгляда, глубина вида, скачивание SVG и DXF (слой LANDSCAPE_SECTION).

import {
  SECTION_DEPTH, SECTION_DEPTH_MAX, SECTION_DEPTH_MIN, nextSectionName, normalizeSection, polylineLength,
} from '../core/landscape.js';
import { buildSectionDxf, sectionProfile } from '../core/landscape-section.js';
import { saveFile } from './cloud.js';
import { escapeHtml, toast } from './dom.js';
import { snapPoint } from './landscape.js';
import { SECTION_STYLES, sectionSvg } from './landscape-section-svg.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject, setTool } from './tools.js';
import { requestDraw, worldToScreen } from './view.js';

const HINT = 'Разрез: кликайте точки линии · Enter или двойной клик — готово · Backspace — убрать точку · Shift — без привязки · Esc — отмена';
let view = null; // { id } открытого разреза
let secStyle = null;

export const isSectionTool = () => state.tool?.kind === 'ls-section';

export function landscapeSections() {
  const ls = state.project.site.landscape;
  if (!Array.isArray(ls.sections)) ls.sections = [];
  return ls.sections;
}

// ------------------------------------------------------------ Инструмент

export function startSectionTool() {
  setTool({ kind: 'ls-section', points: [], cursor: null }, HINT);
  state.lsVertex = null;
  selectObject(state.selection); // панель «Разрез» справа
  return true;
}

export function sectionHover(world, canvas, event) {
  state.tool.cursor = snapPoint(world, event?.shiftKey);
  canvas.style.cursor = 'crosshair';
  requestDraw();
  return true;
}

export function sectionPointerDown(event, screen, world) {
  const tool = state.tool;
  const p = snapPoint(world, event.shiftKey);
  const last = tool.points[tool.points.length - 1];
  if (last) {
    const ls = worldToScreen(last.x, last.y);
    if (Math.hypot(ls.x - screen.x, ls.y - screen.y) < 4) return; // второй клик двойного
  }
  tool.points.push({ x: Math.round(p.x), y: Math.round(p.y) });
  updateInfo();
  requestDraw();
}

function updateInfo() {
  const box = document.querySelector('#lsSecPts');
  if (box) box.textContent = `${state.tool?.points.length || 0} · ${(polylineLength(state.tool?.points || []) / 1000).toFixed(1).replace('.', ',')} м`;
}

// Готово: новый разрез одной записью истории, сразу открывается вид.
export function finishSection() {
  const tool = state.tool;
  if (!isSectionTool()) return null;
  const sec = normalizeSection({ points: tool.points, side: 'left', depth: SECTION_DEPTH, name: nextSectionName(landscapeSections()) });
  if (!sec) { toast('Нужно минимум 2 точки линии разреза'); return null; }
  cancelTool();
  mutate(() => { landscapeSections().push(sec); });
  openSection(sec.id);
  return sec;
}

export function handleSectionKey(event) {
  if (event.key === 'Enter') { event.preventDefault(); finishSection(); return true; }
  if (event.key === 'Backspace') {
    event.preventDefault();
    state.tool.points.pop();
    updateInfo();
    requestDraw();
    return true;
  }
  if (event.key === 'Delete') return true;
  return false;
}

export function renderSectionToolProps(panel) {
  panel.innerHTML = `
    <h2>Разрез участка</h2>
    <div class="prop-block" id="lsSectionTool">
      <p class="hint">${escapeHtml(HINT)}</p>
      <div class="prop-row"><span>Точек · длина</span><strong id="lsSecPts">0 · 0 м</strong></div>
      <p class="hint">Сторону взгляда и глубину вида можно сменить в окне разреза.</p>
    </div>
    <div class="prop-actions">
      <button type="button" id="lsSecFinish">Готово (Enter)</button>
      <button type="button" id="lsSecCancel">Отмена (Esc)</button>
    </div>`;
  updateInfo();
  panel.querySelector('#lsSecFinish').addEventListener('click', finishSection);
  panel.querySelector('#lsSecCancel').addEventListener('click', () => { cancelTool(); selectObject(null); });
}

// Блок «Разрезы» в сводке ландшафта.
export function sectionsBlockHtml() {
  const list = landscapeSections();
  return `
    <h3>Разрезы</h3>
    <div class="prop-block" id="lsSections">
      ${list.map((s) => `<div class="prop-row ls-sec-row"><span>Разрез ${escapeHtml(s.name)}–${escapeHtml(s.name)} · ${(polylineLength(s.points) / 1000).toFixed(1).replace('.', ',')} м</span><button type="button" class="link" data-ls-sec="${escapeHtml(s.id)}">Открыть</button></div>`).join('')}
      ${list.length ? '' : '<p class="hint">Линия разреза — вид участка сбоку: земля и рельеф, площадки с отметками, стенки, лестницы, растения, дом.</p>'}
      <button type="button" id="lsSectionNew">Новый разрез</button>
    </div>`;
}

export function bindSectionsBlock(panel) {
  panel.querySelector('#lsSectionNew')?.addEventListener('click', startSectionTool);
  panel.querySelectorAll('[data-ls-sec]').forEach((b) => b.addEventListener('click', () => openSection(b.dataset.lsSec)));
}

// ------------------------------------------------------------ Окно разреза

export const isSectionOpen = () => Boolean(view);
const current = () => (view ? landscapeSections().find((s) => s.id === view.id) || null : null);

function host() {
  let box = document.getElementById('lsSectionView');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'lsSectionView';
  box.className = 'ls-section';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Разрез участка');
  box.hidden = true;
  (document.querySelector('.canvas-wrap') || document.body).appendChild(box);
  return box;
}

export function openSection(id) {
  if (!landscapeSections().some((s) => s.id === id)) return false;
  view = { id };
  state.lsSectionId = id; // подсветка линии на плане (render.js)
  if (!secStyle) secStyle = state.lsStyle === 'drawing' ? 'drawing' : 'sketch';
  renderSectionView();
  requestDraw();
  return true;
}

export function closeSection() {
  view = null;
  state.lsSectionId = null;
  const box = document.getElementById('lsSectionView');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  requestDraw();
}

export const openSectionId = () => view?.id || null;

// После правок (в т. ч. Ctrl+Z): перерисовать или закрыть, если разреза нет.
export function refreshSectionView() {
  if (!view) return;
  if (!current() || state.modeName !== 'landscape') { closeSection(); return; }
  renderSectionView();
}

function profileOf(sec) {
  return sectionProfile(state.project, sec, sec.side, { depth: sec.depth });
}

function renderSectionView() {
  const sec = current();
  const box = host();
  if (!sec) { closeSection(); return; }
  const prof = profileOf(sec);
  const svg = prof ? sectionSvg(prof, { style: secStyle }) : '<p class="hint">Линия слишком короткая</p>';
  box.hidden = false;
  box.innerHTML = `
    <div class="ls-section-bar">
      <strong class="ls-section-title">Разрез ${escapeHtml(sec.name)}–${escapeHtml(sec.name)}</strong>
      <div class="seg" role="radiogroup" aria-label="Стиль разреза">
        ${SECTION_STYLES.map((st) => `<label class="seg-opt${secStyle === st.id ? ' active' : ''}"><input type="radio" name="lsSecStyle" value="${st.id}" ${secStyle === st.id ? 'checked' : ''}><span>${st.title}</span></label>`).join('')}
      </div>
      <label class="ls-section-field"><span>Взгляд</span><select id="lsSecSide">
        <option value="left" ${sec.side === 'left' ? 'selected' : ''}>налево по ходу линии</option>
        <option value="right" ${sec.side === 'right' ? 'selected' : ''}>направо по ходу линии</option>
      </select></label>
      <label class="ls-section-field"><span>Глубина, м</span><input id="lsSecDepth" type="number" min="${SECTION_DEPTH_MIN / 1000}" max="${SECTION_DEPTH_MAX / 1000}" step="1" value="${Math.round(sec.depth / 1000)}"></label>
      <button type="button" id="lsSecSvg" title="Скачать разрез в SVG">SVG</button>
      <button type="button" id="lsSecDxf" title="Скачать разрез в DXF (слой LANDSCAPE_SECTION)">DXF</button>
      <button type="button" id="lsSecDel">Удалить</button>
      <button type="button" id="lsSecClose">✕ Закрыть</button>
    </div>
    <div class="ls-section-body" id="lsSecBody">${svg}</div>`;
  box.querySelectorAll('input[name="lsSecStyle"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    secStyle = r.value;
    renderSectionView();
  }));
  box.querySelector('#lsSecSide').addEventListener('change', (e) => mutate(() => { sec.side = e.target.value === 'right' ? 'right' : 'left'; }));
  box.querySelector('#lsSecDepth').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v <= 0) return;
    mutate(() => { sec.depth = Math.min(SECTION_DEPTH_MAX, Math.max(SECTION_DEPTH_MIN, Math.round(v * 1000))); });
  });
  box.querySelector('#lsSecSvg').addEventListener('click', () => downloadSectionSvg(sec));
  box.querySelector('#lsSecDxf').addEventListener('click', () => downloadSectionDxf(sec));
  box.querySelector('#lsSecDel').addEventListener('click', () => {
    mutate(() => {
      const list = landscapeSections();
      list.splice(list.indexOf(sec), 1);
    });
    closeSection();
    toast(`Разрез ${sec.name}–${sec.name} удалён · Ctrl+Z — вернуть`);
  });
  box.querySelector('#lsSecClose').addEventListener('click', closeSection);
}

function fileBase(sec) {
  const name = (state.project.name || 'kepler-plan').replace(/[^\wа-яА-ЯёЁ -]/g, '').trim().replace(/\s+/g, '-') || 'kepler-plan';
  return `${name}-разрез-${sec.name}`;
}

export function downloadSectionSvg(sec = current()) {
  const prof = sec && profileOf(sec);
  if (!prof) return;
  saveFile(`${fileBase(sec)}.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n${sectionSvg(prof, { style: secStyle || 'sketch' })}`, 'image/svg+xml');
  toast(`Разрез ${sec.name}–${sec.name} (SVG)`);
}

export function downloadSectionDxf(sec = current()) {
  const prof = sec && profileOf(sec);
  if (!prof) return;
  saveFile(`${fileBase(sec)}.dxf`, buildSectionDxf(prof), 'application/dxf');
  toast(`Разрез ${sec.name}–${sec.name} (DXF, слой LANDSCAPE_SECTION)`);
}

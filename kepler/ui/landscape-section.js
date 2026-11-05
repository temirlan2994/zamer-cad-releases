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
import { setSheetSectionsPref, sheetSectionsPref } from './landscape-style.js';
import { snapLs, snapPoint } from './landscape.js';
import { chainsWithout, dragPrev } from './draw-snap-ui.js';
import { hitSectionHandle } from './render-section.js';
import { SECTION_STYLES, sectionSvg } from './landscape-section-svg.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, snapshot } from './store.js';
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
// Переключатель «Разрезы на листе» и галочки «на лист» у каждого разреза
// (выбор хранится в браузере, схема проекта не меняется).
export function sectionsBlockHtml() {
  const list = landscapeSections();
  const pref = sheetSectionsPref();
  const off = new Set(pref.off);
  return `
    <h3>Разрезы</h3>
    <div class="prop-block" id="lsSections">
      ${list.map((s) => `<div class="prop-row ls-sec-row">
        <label class="ls-sec-sheet" title="Вывести на лист PDF"><input type="checkbox" data-ls-sec-sheet="${escapeHtml(s.id)}" ${off.has(s.id) ? '' : 'checked'} ${pref.on ? '' : 'disabled'}><span>Разрез ${escapeHtml(s.name)}–${escapeHtml(s.name)} · ${(polylineLength(s.points) / 1000).toFixed(1).replace('.', ',')} м</span></label>
        <button type="button" class="link" data-ls-sec="${escapeHtml(s.id)}">Открыть</button></div>`).join('')}
      ${list.length ? `<label class="check-row"><input type="checkbox" id="lsSecSheetOn" ${pref.on ? 'checked' : ''}><span>Разрезы на листе PDF (отмеченные выше)</span></label>` : '<p class="hint">Линия разреза — вид участка сбоку: земля и рельеф, площадки с отметками, стенки, лестницы, растения, дом.</p>'}
      <button type="button" id="lsSectionNew">Новый разрез</button>
    </div>`;
}

export function bindSectionsBlock(panel) {
  panel.querySelector('#lsSectionNew')?.addEventListener('click', startSectionTool);
  panel.querySelectorAll('[data-ls-sec]').forEach((b) => b.addEventListener('click', () => openSection(b.dataset.lsSec)));
  panel.querySelector('#lsSecSheetOn')?.addEventListener('change', (e) => {
    setSheetSectionsPref({ ...sheetSectionsPref(), on: e.target.checked });
    panel.querySelectorAll('[data-ls-sec-sheet]').forEach((c) => { c.disabled = !e.target.checked; });
  });
  panel.querySelectorAll('[data-ls-sec-sheet]').forEach((c) => c.addEventListener('change', () => {
    const pref = sheetSectionsPref();
    const off = new Set(pref.off);
    if (c.checked) off.delete(c.dataset.lsSecSheet); else off.add(c.dataset.lsSecSheet);
    // Удалённые разрезы из списка исключений — прочь.
    const ids = new Set(landscapeSections().map((s) => s.id));
    setSheetSectionsPref({ ...pref, off: [...off].filter((id) => ids.has(id)) });
  }));
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
  state.lsSecVertex = null;
  renderSectionView();
  revealLine(landscapeSections().find((s) => s.id === id));
  requestDraw();
  return true;
}

export function closeSection() {
  view = null;
  state.lsSectionId = null;
  state.lsSecVertex = null;
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
      <strong class="ls-section-title">Разрез <input id="lsSecName" class="ls-sec-name" maxlength="4" value="${escapeHtml(sec.name)}" aria-label="Буква разреза" title="Буква (обозначение) разреза">–<span id="lsSecName2">${escapeHtml(sec.name)}</span></strong>
      <div class="seg" role="radiogroup" aria-label="Стиль разреза">
        ${SECTION_STYLES.map((st) => `<label class="seg-opt${secStyle === st.id ? ' active' : ''}"><input type="radio" name="lsSecStyle" value="${st.id}" ${secStyle === st.id ? 'checked' : ''}><span>${st.title}</span></label>`).join('')}
      </div>
      <label class="ls-section-field"><span>Взгляд</span><select id="lsSecSide">
        <option value="left" ${sec.side === 'left' ? 'selected' : ''}>налево по ходу линии</option>
        <option value="right" ${sec.side === 'right' ? 'selected' : ''}>направо по ходу линии</option>
      </select></label>
      <label class="ls-section-field"><span>Глубина, м</span><input id="lsSecDepth" type="number" min="${SECTION_DEPTH_MIN / 1000}" max="${SECTION_DEPTH_MAX / 1000}" step="1" value="${Math.round(sec.depth / 1000)}"></label>
      <span class="hint ls-section-hint">На плане: тяните точки линии · «+» или двойной клик по линии — точка · двойной клик по точке — убрать · ⇄ — сторона взгляда</span>
      <button type="button" id="lsSecSvg" title="Скачать разрез в SVG">SVG</button>
      <button type="button" id="lsSecDxf" title="Скачать разрез в DXF (слой LANDSCAPE_SECTION)">DXF</button>
      <button type="button" id="lsSecDel">Удалить</button>
      <button type="button" id="lsSecClose">✕ Закрыть</button>
    </div>
    <div class="ls-section-body" id="lsSecBody" title="Разрез — как лист печати: белый фон в любой теме">${svg}</div>`;
  box.querySelectorAll('input[name="lsSecStyle"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    secStyle = r.value;
    renderSectionView();
  }));
  const nameInput = box.querySelector('#lsSecName');
  nameInput.addEventListener('input', () => { box.querySelector('#lsSecName2').textContent = nameInput.value.trim().toUpperCase() || sec.name; });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); e.stopPropagation(); });
  nameInput.addEventListener('change', () => renameSection(sec, nameInput.value));
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

// ------------------------------------------------------------ Правка линии

// Переименование: 1–4 символа, буквы — заглавные; буква, занятая другим
// разрезом, — отказ с подсказкой.
export function renameSection(sec, raw) {
  const name = String(raw || '').trim().toUpperCase().slice(0, 4);
  if (!name || name === sec.name) { if (view) renderSectionView(); return false; }
  if (landscapeSections().some((s) => s !== sec && s.name === name)) {
    toast(`Буква «${name}» уже занята другим разрезом`);
    if (view) renderSectionView();
    return false;
  }
  mutate(() => { sec.name = name; });
  return true;
}

export function flipSectionSide(sec = current()) {
  if (!sec) return;
  mutate(() => { sec.side = sec.side === 'right' ? 'left' : 'right'; });
}

const tol = () => (state.coarsePointer ? 20 : 9);

// Ручка открытого разреза под курсором (или null).
export function sectionHandleAt(screen) {
  if (!view || state.tool) return null;
  return hitSectionHandle(current(), screen, worldToScreen, state.view.scale, tol());
}

// Нажатие на ручку открытого разреза. undefined — ручки нет; null —
// действие выполнено сразу (сторона взгляда); иначе — описание жеста
// для input.js (kind 'ls-sec-vertex': вершина или вставка из «+»).
export function sectionHandlePointerDown(event, screen) {
  const h = sectionHandleAt(screen);
  if (!h) return undefined;
  const sec = current();
  if (h.mode === 'flip') { flipSectionSide(sec); return null; }
  state.lsSecVertex = h.mode === 'vertex' ? h.index : null;
  requestDraw();
  return { kind: 'ls-sec-vertex', id: sec.id, index: h.index, insert: h.mode === 'mid', before: snapshot(), points0: sec.points.map((p) => ({ ...p })), moved: false, screen };
}

let pending = 0;
function refreshSoon() {
  if (pending) return;
  pending = requestAnimationFrame(() => { pending = 0; if (view) renderSectionView(); });
}

// Перетаскивание вершины — с привязкой, как у линейных объектов ландшафта
// (Shift — без привязки); вид разреза обновляется на лету.
export function sectionDragMove(drag, world, screen, event) {
  const sec = landscapeSections().find((s) => s.id === drag.id);
  if (!sec) return;
  if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
  const pts = sec.points;
  if (drag.insert) {
    if (pts.length >= 50) return;
    const p = snapLs(world, event, { prev: pts[drag.index], extraShapes: [{ points: pts, closed: false }] });
    pts.splice(drag.index + 1, 0, { x: Math.round(p.x), y: Math.round(p.y) });
    drag.index += 1;
    drag.insert = false;
  } else {
    const p = snapLs(world, event, { prev: dragPrev(pts, drag.index, false), extraShapes: chainsWithout(pts, drag.index, false) });
    pts[drag.index] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  drag.moved = true;
  state.lsSecVertex = drag.index;
  refreshSoon();
  requestDraw();
}

// Конец жеста — одна запись истории; вырожденная линия (< 0,1 м) — откат.
export function sectionDragEnd(drag) {
  state.drawSnap = null;
  const sec = landscapeSections().find((s) => s.id === drag.id);
  if (!sec) return;
  if (!drag.moved) {
    if (drag.insert && sec.points.length < 50) {
      // Клик по «+» — точка в середине звена.
      const a = sec.points[drag.index]; const b = sec.points[drag.index + 1];
      mutate(() => { sec.points.splice(drag.index + 1, 0, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }); });
      state.lsSecVertex = drag.index + 1;
    }
    requestDraw();
    return;
  }
  if (polylineLength(sec.points) < 100) {
    sec.points = drag.points0;
    toast('Линия разреза слишком короткая');
    requestDraw();
    refreshSoon();
    return;
  }
  pushHistory(drag.before);
  afterChange();
}

function segmentAt(sec, screen) {
  const P = sec.points.map((p) => worldToScreen(p.x, p.y));
  let seg = -1; let best = tol();
  for (let i = 0; i < P.length - 1; i += 1) {
    const a = P[i]; const b = P[i + 1];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(a.x + dx * t - screen.x, a.y + dy * t - screen.y);
    if (d <= best) { best = d; seg = i; }
  }
  return seg;
}

// Двойной клик при открытом разрезе: по вершине — удалить, по звену — вставить.
export function sectionDblClick(world) {
  if (!view || state.tool) return false;
  const sec = current();
  if (!sec) return false;
  const screen = worldToScreen(world.x, world.y);
  const h = hitSectionHandle(sec, screen, worldToScreen, state.view.scale, tol());
  if (h?.mode === 'flip') return true;
  if (h?.mode === 'vertex') {
    if (sec.points.length <= 2) { toast('У разреза минимум 2 точки — удалите разрез целиком'); return true; }
    if (polylineLength(sec.points.filter((_, i) => i !== h.index)) < 100) { toast('Линия разреза слишком короткая'); return true; }
    mutate(() => { sec.points.splice(h.index, 1); });
    state.lsSecVertex = null;
    requestDraw();
    return true;
  }
  const seg = segmentAt(sec, screen);
  if (seg < 0) return false;
  if (sec.points.length >= 50) { toast('В линии разреза не больше 50 точек'); return true; }
  // Точка — на самой линии (проекция клика): форма линии не меняется.
  const A = sec.points[seg]; const B = sec.points[seg + 1];
  const dx = B.x - A.x; const dy = B.y - A.y;
  const t = Math.max(0.02, Math.min(0.98, ((world.x - A.x) * dx + (world.y - A.y) * dy) / (dx * dx + dy * dy || 1)));
  const p = { x: A.x + dx * t, y: A.y + dy * t };
  mutate(() => { sec.points.splice(seg + 1, 0, { x: Math.round(p.x), y: Math.round(p.y) }); });
  state.lsSecVertex = seg + 1;
  requestDraw();
  return true;
}

// Окно разреза занимает низ холста: линия на плане должна остаться видна —
// сдвинуть вид вверх, если она под окном (и помещается над ним).
function revealLine(sec) {
  const canvas = document.getElementById('canvas');
  const box = document.getElementById('lsSectionView');
  if (!sec || !canvas || !box || box.hidden) return;
  const free = canvas.clientHeight - box.offsetHeight;
  if (free < 120) return;
  const ys = sec.points.map((p) => worldToScreen(p.x, p.y).y);
  const lo = Math.min(...ys); const hi = Math.max(...ys);
  if (hi - lo > free - 80 || hi <= free - 40) return;
  state.view.panY -= Math.min(hi - (free - 40), lo - 40);
}

// Колонка инструментов слева (index.html, #toolStrip; на телефоне — строка
// над холстом): «Выбор» и наборы режимов — «План» (стена, помещение, дверь,
// окно, мебель, лестница, размеры), «Участок» (слои участка), «Ландшафт»
// (разрез, массив, выноска); переход в «Ландшафт»; внизу — поворот вида и
// «Вписать». Кнопки — только значки; подсказка .tb-tip (название · что
// делает · клавиша) — своя, CSS, сразу при наведении, без title. Активный
// инструмент подсвечен. Кнопки «Плана» и общие — в разметке (их id нужны
// старым обработчикам), наборы «Участка» и «Ландшафта» строятся здесь.

import { polygonAreaM2 } from '../core/site.js';
import { el, refs } from './dom.js';
import { labelLandscapeSelection, selectedIds } from './landscape.js';
import { startLandscapeArray } from './landscape-array.js';
import { startSectionTool } from './landscape-section.js';
import { applyLibraryTab, syncLibraryOpen } from './library.js';
import { closeSheets, isPhone, syncMobileBar, toggleSheet } from './mobile.js';
import { renderToolOptions } from './props.js';
import { state } from './state.js';
import { startTerrainTool } from './terrain.js';
import {
  activeSiteLayer, cancelTool, setTool, startDraw, startEditLayer, startPlaceFurniture, startPlaceOpening,
} from './tools.js';
import { finishWallChain } from './wall-tool.js';
import { togglePlanSectionTool } from './plan-section.js';
import { toggleMassTool } from './masses.js';
import { toggleRoofTool } from './roofs.js';
import { toggleGridTool } from './grids.js';

const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  underlay: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 15.5l5-4 4 3 3-2 6 4"/><circle cx="16" cy="9" r="1.5"/>',
  boundary: '<path d="M4 7.5l7-3.5 9 5-3 11H6z"/><circle cx="4" cy="7.5" r="1.3" fill="currentColor"/><circle cx="20" cy="9" r="1.3" fill="currentColor"/>',
  redline: '<path d="M3 18L21 6" stroke-dasharray="4 2.5"/><path d="M6 21l-2-3M12 17l-2-3M18 13l-2-3"/>',
  road: '<path d="M8 3L5 21M16 3l3 18"/><path d="M12 4v2.5M12 10.5v3M12 17.5V20"/>',
  entry: '<path d="M3 12h11"/><path d="M10 8l4 4-4 4"/><path d="M18 4v16"/>',
  neighbor: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  terrain: '<path d="M3 19l6-9 4 5 3-4 5 8z"/><circle cx="8.5" cy="4.5" r="1.5"/>',
  north: '<path d="M12 3l5.5 17L12 16l-5.5 4z"/>',
  calibrate: '<path d="M3 16L16 3l5 5L8 21z"/><path d="M7.5 11.5l2 2M10.5 8.5l2 2M13.5 5.5l2 2"/>',
  section: '<path d="M4 12h16" stroke-dasharray="3 2"/><path d="M4 6v12M20 6v12"/><path d="M4 6h4M20 6h-4"/>',
  array: '<circle cx="6" cy="7" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="15" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="15" r="2"/><path d="M4 20.5h16"/>',
  callout: '<circle cx="4.5" cy="19.5" r="1.3" fill="currentColor"/><path d="M5.5 18.5L10 14h10"/><path d="M11 10h8M11 6h6"/>',
};

const editHint = (name) => `Правка: ${name}. Тяните точки/объект. Esc — выйти`;

// Слои участка (раньше — карточки в библиотеке). Порядок сохранён.
const SITE_TOOLS = [
  { id: 'underlay', name: 'Топосъёмка', note: (s) => (s?.underlay ? 'двигать / масштаб' : 'импорт PDF/JPG/DXF'),
    action: (s) => setTool({ kind: 'underlay-edit' }, s?.underlay
      ? editHint('топосъёмка — двигайте, тяните углы')
      : 'Нажмите «Импортировать топосъёмку» в панели справа · PDF / JPG / PNG / DXF') },
  { id: 'boundary', name: 'Граница участка', note: (s) => (s?.boundary ? `${polygonAreaM2(s.boundary).toFixed(0)} м² · правка` : 'полигон по точкам'),
    action: (s) => (s?.boundary ? startEditLayer('boundary', { type: 'site', kind: 'boundary' }, editHint('граница — тяните вершины')) : startDraw('boundary')) },
  { id: 'redline', name: 'Красная линия', note: (s) => (s?.redLine ? 'правка' : 'линия застройки'),
    action: (s) => (s?.redLine ? startEditLayer('redline', { type: 'site', kind: 'redline' }, editHint('красная линия — тяните вершины')) : startDraw('redline')) },
  { id: 'road', name: 'Дорога', note: (s) => (s?.roads?.length ? 'правка / новая' : 'ось + ширина'),
    action: (s) => (s?.roads?.length ? startEditLayer('road', { type: 'site', kind: 'road', id: s.roads[s.roads.length - 1].id }, editHint('дорога — тяните вершины')) : startDraw('road')) },
  { id: 'entry', name: 'Въезд', note: () => 'точка на границе',
    action: () => setTool({ kind: 'entry' }, 'Кликните/тяните по границе участка — там будет въезд · Esc — выйти') },
  { id: 'neighbor', name: 'Соседний дом', note: () => 'зона 6 м вокруг',
    action: () => setTool({ kind: 'neighbor' }, 'Кликните — новый дом; тяните углы для размера и поворота · Esc — выйти') },
  { id: 'terrain', name: 'Отметка высоты', note: (s) => (s?.terrain?.points?.length ? `${s.terrain.points.length} отм. · правка` : 'рельеф по точкам'),
    action: () => startTerrainTool() },
  { id: 'north', name: 'Север по 2 точкам', note: (s) => `сейчас ${Math.round(s?.north || 0)}°`,
    active: () => state.tool?.kind === 'north',
    action: () => setTool({ kind: 'north', points: [] }, 'Кликните первую точку стрелки на север') },
  { id: 'calibrate', name: 'Калибровка', note: (s) => (s?.underlay ? 'масштаб топосъёмки по 2 точкам' : 'сначала импортируйте топосъёмку'),
    active: () => state.tool?.kind === 'calibrate', enabled: (s) => Boolean(s?.underlay),
    action: () => setTool({ kind: 'calibrate', points: [] }, 'Кликните две точки на топосъёмке с известным расстоянием (например, сторону участка)') },
];

const LANDSCAPE_TOOLS = [
  { id: 'section', name: 'Разрез', note: () => 'точки линии, Enter — вид сбоку',
    active: () => state.tool?.kind === 'ls-section', action: () => startSectionTool() },
  { id: 'array', name: 'Массив', note: () => 'выделенное вдоль линии, по кругу, сеткой (Shift+A)',
    active: () => state.tool?.kind === 'ls-array', enabled: () => selectedIds().length > 0, action: () => startLandscapeArray() },
  { id: 'callout', name: 'Выноска', note: () => 'подписать выделенное (T)',
    enabled: () => selectedIds().length > 0, action: () => labelLandscapeSelection() },
];

// Подписи под значками на телефоне (.tb-label; на компьютере скрыты — там подсказка .tb-tip).
const SHORT = {
  underlay: 'Съёмка', boundary: 'Граница', redline: 'Кр.линия', neighbor: 'Сосед', terrain: 'Отметка', north: 'Север',
};
const PLAN_LABELS = {
  selectToolBtn: 'Выбор', wallToolBtn: 'Стена', boundRoomBtn: 'Помещение', doorToolBtn: 'Дверь', windowToolBtn: 'Окно',
  furnitureToolBtn: 'Мебель', stairsToolBtn: 'Лестница', massToolBtn: 'Масса', roofToolBtn: 'Крыша', gridToolBtn: 'Ось',
  sectionToolBtn: 'Разрез', ergoToolBtn: 'Эргономика', viewBtn: 'Поворот', fitBtn: 'Вписать',
};
function ensurePlanLabels() {
  for (const [id, text] of Object.entries(PLAN_LABELS)) {
    const b = el(id);
    if (!b || b.querySelector('.tb-label')) continue;
    const span = document.createElement('span');
    span.className = 'tb-label';
    span.textContent = text;
    const tip = b.querySelector('.tb-tip, .tb-badge');
    b.insertBefore(span, tip || null);
  }
}

function buildGroup(box, defs, attr) {
  if (!box || box.childElementCount) return;
  for (const def of defs) def.short ||= SHORT[def.id];
  for (const def of defs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tb-btn';
    btn.dataset[attr] = def.id;
    btn.setAttribute('aria-label', def.name);
    btn.innerHTML = `${svg(ICONS[def.id] || '')}<span class="tb-label">${def.short || def.name}</span><span class="tb-tip" role="tooltip"></span>`;
    box.appendChild(btn);
  }
  box.addEventListener('click', (event) => {
    const btn = event.target.closest(`[data-${attr === 'siteTool' ? 'site-tool' : 'ls-tool'}]`);
    if (!btn || btn.disabled) return;
    const def = defs.find((d) => d.id === btn.dataset[attr]);
    if (!def) return;
    if (btn.classList.contains('active')) cancelTool();
    else { def.action(state.project?.site); closeSheets(); } // телефон: панели уезжают, план свободен для касаний
    renderToolstrip();
  });
}

function syncGroup(box, defs, attr, isActive) {
  if (!box) return;
  const site = state.project?.site;
  for (const btn of box.querySelectorAll('.tb-btn')) {
    const def = defs.find((d) => d.id === btn.dataset[attr]);
    if (!def) continue;
    const active = def.active ? def.active() : isActive(def.id);
    btn.classList.toggle('active', Boolean(active));
    btn.setAttribute('aria-pressed', String(Boolean(active)));
    btn.disabled = def.enabled ? !def.enabled(site) && !active : false;
    setTip(btn, def.name, def.note(site), def.keys);
  }
}

// Подсказка кнопки — как у привязок (ui/draw-snap-ui.js): название · что делает · клавиша.
export function setTip(btn, name, what, keys = '') {
  if (!btn) return;
  let tip = btn.querySelector('.tb-tip');
  if (!tip) {
    tip = document.createElement('span');
    tip.className = 'tb-tip';
    tip.setAttribute('role', 'tooltip');
    btn.appendChild(tip);
  }
  const html = `<b>${name}</b>${what ? ` · ${what}` : ''}${keys ? ` · <kbd>${keys}</kbd>` : ''}`;
  if (tip.innerHTML !== html) tip.innerHTML = html;
  btn.removeAttribute('title');
}

const toggle = (id, on) => {
  const b = el(id);
  if (!b) return;
  b.classList.toggle('active', Boolean(on));
};

// Состояние кнопок: режим, активный инструмент, выделение. Вызывается при
// смене инструмента (ui/library.js renderLibrary) и панели свойств.
export function renderToolstrip() {
  const strip = el('toolStrip');
  if (!strip || !state.project) return;
  const mode = state.modeName;
  const t = state.tool;
  const plan = el('planTools');
  if (plan) plan.hidden = mode !== 'plan';
  refs.siteTools.hidden = mode !== 'site';
  const ls = el('landscapeTools');
  if (ls) ls.hidden = mode !== 'landscape';
  ensurePlanLabels();
  buildGroup(refs.siteTools, SITE_TOOLS, 'siteTool');
  buildGroup(ls, LANDSCAPE_TOOLS, 'lsTool');
  if (mode === 'site') syncGroup(refs.siteTools, SITE_TOOLS, 'siteTool', (id) => activeSiteLayer() === id);
  if (mode === 'landscape') syncGroup(ls, LANDSCAPE_TOOLS, 'lsTool', () => false);
  syncLibraryOpen(); // библиотека — по активному инструменту
  const phone = isPhone();
  const stairs = t?.kind === 'place-furniture' && t.itemKind === 'stairs';
  const pinned = !phone && mode === 'plan' && !t && state.libraryPinned;
  toggle('selectToolBtn', !t && !pinned);
  toggle('wallToolBtn', t?.kind === 'wall');
  toggle('boundRoomBtn', t?.kind === 'bound-room' || t?.kind === 'place-room' || (pinned && state.libraryTab === 'rooms'));
  toggle('doorToolBtn', t?.kind === 'place-opening' && t.openKind === 'door');
  toggle('windowToolBtn', t?.kind === 'place-opening' && t.openKind === 'window');
  const furnOpen = mode === 'plan' && ((t?.kind === 'place-furniture' && !stairs)
    || (phone ? document.body.classList.contains('sheet-library') && state.libraryTab === 'furniture' : pinned && state.libraryTab === 'furniture'));
  toggle('furnitureToolBtn', furnOpen);
  toggle('stairsToolBtn', stairs);
  toggle('sectionToolBtn', t?.kind === 'psec');
  toggle('massToolBtn', t?.kind === 'mass');
  toggle('roofToolBtn', t?.kind === 'roof');
  toggle('gridToolBtn', t?.kind === 'grid');
  for (const id of ['selectToolBtn', 'wallToolBtn', 'boundRoomBtn', 'doorToolBtn', 'windowToolBtn', 'furnitureToolBtn', 'stairsToolBtn', 'sectionToolBtn', 'massToolBtn', 'roofToolBtn', 'gridToolBtn']) {
    const b = el(id);
    if (b) b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  }
  renderToolOptions(); // строка параметров — только при смене инструмента
  syncMobileBar(); // подпись каталога на нижней навигации — по инструменту
}

function placeOpening(kind) {
  const t = state.tool;
  if (t?.kind === 'place-opening' && t.openKind === kind) cancelTool();
  else { startPlaceOpening(kind); closeSheets(); }
  renderToolstrip();
}

// Компьютер: «Мебель» открывает каталог рядом с колонкой (другой инструмент
// выключается), повторный клик — закрывает.
function toggleFurniture() {
  if (isPhone()) toggleSheet('furniture');
  else {
    const open = document.body.classList.contains('lib-open') && state.libraryTab === 'furniture' && state.modeName === 'plan';
    if (open) {
      state.libraryPinned = false;
      if (state.tool?.kind === 'place-furniture') cancelTool();
    } else {
      if (state.tool && state.tool.kind !== 'place-furniture' && !finishWallChain()) cancelTool();
      state.libraryTab = 'furniture';
      state.libraryPinned = true;
    }
    applyLibraryTab();
  }
  renderToolstrip();
}

// Лестничный марш — размещение как у мебели (core/catalog.js «stairs»);
// повторный клик — выйти.
function toggleStairs() {
  const t = state.tool;
  if (t?.kind === 'place-furniture' && t.itemKind === 'stairs') cancelTool();
  else {
    if (t?.kind === 'wall') finishWallChain();
    startPlaceFurniture('stairs', 'Лестничный марш');
    closeSheets();
  }
  renderToolstrip();
}

export function bindToolstrip() {
  el('selectToolBtn')?.addEventListener('click', () => {
    if (!finishWallChain()) cancelTool();
    state.libraryPinned = false; // «Выбор» закрывает библиотеку
    applyLibraryTab();
  });
  el('stairsToolBtn')?.addEventListener('click', toggleStairs);
  el('doorToolBtn')?.addEventListener('click', () => placeOpening('door'));
  el('windowToolBtn')?.addEventListener('click', () => placeOpening('window'));
  el('furnitureToolBtn')?.addEventListener('click', toggleFurniture);
  el('massToolBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'wall') finishWallChain();
    toggleMassTool();
    if (state.tool) closeSheets();
    renderToolstrip();
  });
  // Инструмент «Крыша» включают/выключают и из 3D (K, Esc, смена этажа).
  document.addEventListener('kepler:roof-tool', () => renderToolstrip());
  el('roofToolBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'wall') finishWallChain();
    toggleRoofTool();
    if (state.tool) closeSheets();
    renderToolstrip();
  });
  el('gridToolBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'wall') finishWallChain();
    toggleGridTool();
    if (state.tool) closeSheets();
    renderToolstrip();
  });
  el('sectionToolBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'wall') finishWallChain();
    togglePlanSectionTool();
    if (state.tool) closeSheets();
    renderToolstrip();
  });
}

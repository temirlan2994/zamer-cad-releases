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
import { isSectionOpen, startSectionTool } from './landscape-section.js';
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
import { startSlabOpeningTool } from './slab-ui.js';

const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  underlay: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 15.5l5-4 4 3 3-2 6 4"/><circle cx="16" cy="9" r="1.5"/>',
  boundary: '<path d="M4 7.5l7-3.5 9 5-3 11H6z"/><circle cx="4" cy="7.5" r="1.3" fill="currentColor"/><circle cx="20" cy="9" r="1.3" fill="currentColor"/>',
  redline: '<path d="M3 18L21 6" stroke-dasharray="4 2.5"/><path d="M6 21l-2-3M12 17l-2-3M18 13l-2-3"/>',
  road: '<path d="M8 3L5 21M16 3l3 18"/><path d="M12 4v2.5M12 10.5v3M12 17.5V20"/>',
  entry: '<path d="M3 12h11"/><path d="M10 8l4 4-4 4"/><path d="M18 4v16"/>',
  wicket: '<path d="M5 4v16M19 4v16M5 6h11v13H5M13 12h1"/>',
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
    action: (s) => (s?.boundary ? startEditLayer('boundary', { type: 'site', kind: 'boundary' }, 'Правка границы: тяните квадратные вершины; нажмите круг с +, чтобы добавить угол · Esc — выйти') : startDraw('boundary')) },
  { id: 'redline', name: 'Красная линия', note: (s) => (s?.redLine ? 'правка' : 'линия застройки'),
    action: (s) => (s?.redLine ? startEditLayer('redline', { type: 'site', kind: 'redline' }, editHint('красная линия — тяните вершины')) : startDraw('redline')) },
  { id: 'road', name: 'Дорога', note: (s) => (s?.roads?.length ? 'правка / новая' : 'ось + ширина'),
    action: (s) => (s?.roads?.length ? startEditLayer('road', { type: 'site', kind: 'road', id: s.roads[s.roads.length - 1].id }, editHint('дорога — тяните вершины')) : startDraw('road')) },
  { id: 'entry', name: 'Ворота', note: () => 'несколько въездов · калитка по желанию',
    action: () => setTool({ kind: 'entry', entryKind: 'gate' }, 'Кликните по границе — новые ворота. Калитка включается в свойствах · Esc — выйти') },
  { id: 'wicket', name: 'Калитка', note: () => 'отдельная дверь в ограждении',
    action: () => setTool({ kind: 'entry', entryKind: 'wicket' }, 'Кликните по границе — отдельная калитка · Esc — выйти') },
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

// Запуск существующего инструмента участка из внешнего интерфейса
// («Маршрут проекта»). В отличие от клика по уже активной кнопке этот вызов
// всегда оставляет нужный инструмент включённым.
export function activateSiteTool(id) {
  const def = SITE_TOOLS.find((item) => item.id === id);
  const site = state.project?.site;
  if (!def || (def.enabled && !def.enabled(site))) return false;
  def.action(site);
  closeSheets();
  renderToolstrip();
  return true;
}

const LANDSCAPE_TOOLS = [
  { id: 'section', name: 'Разрез участка', note: () => 'линия профиля и отметки террас',
    active: () => state.tool?.kind === 'ls-section', action: () => startSectionTool() },
  { id: 'array', name: 'Массив', note: () => 'выделенное вдоль линии, по кругу, сеткой (Shift+A)',
    active: () => state.tool?.kind === 'ls-array', enabled: () => selectedIds().length > 0, action: () => startLandscapeArray() },
  { id: 'callout', name: 'Выноска', note: () => 'подписать выделенное (T)',
    enabled: () => selectedIds().length > 0, action: () => labelLandscapeSelection() },
];

// Семейства компактной панели «План». Дочерние кнопки сохраняют прежние
// id и обработчики: на компьютере они раскрываются справа от родителя, а
// мобильная панель использует тот же реестр для своего всплывающего ряда.
export const PLAN_TOOL_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'openings',
    parentId: 'openingsGroupBtn',
    flyoutId: 'openingsToolFlyout',
    label: 'Проёмы',
    note: 'дверь, окно или проём в перекрытии',
    childIds: Object.freeze(['doorToolBtn', 'windowToolBtn', 'slabOpeningToolBtn']),
  }),
  Object.freeze({
    id: 'mass',
    parentId: 'massGroupBtn',
    flyoutId: 'massToolFlyout',
    label: 'Масса',
    note: 'добавить или вычесть объём',
    childIds: Object.freeze(['massToolBtn', 'massVoidToolBtn']),
  }),
  Object.freeze({
    id: 'docs',
    parentId: 'docsGroupBtn',
    flyoutId: 'docsToolFlyout',
    label: 'Документация',
    note: 'оси, разрезы и размеры',
    childIds: Object.freeze(['gridToolBtn', 'sectionToolBtn', 'dimModeBtn']),
    activeChildIds: Object.freeze(['gridToolBtn', 'sectionToolBtn']),
  }),
]);

// Ленивый getter безопасен для существующего циклического импорта
// toolstrip.js <-> mobile.js: мобильный модуль вызывает его только после
// завершения инициализации модулей.
export const getPlanToolFamilies = () => PLAN_TOOL_FAMILIES;

const familyCloseTimers = new Map();
let familyStateObserver = null;

function familyNodes(def) {
  const parent = el(def.parentId);
  const flyout = el(def.flyoutId);
  const box = parent?.closest('.tb-family') || flyout?.parentElement || null;
  return { parent, flyout, box };
}

function clearFamilyTimer(def) {
  const timer = familyCloseTimers.get(def.id);
  if (timer) clearTimeout(timer);
  familyCloseTimers.delete(def.id);
}

function setFamilyExpanded(def, expanded) {
  const { parent, box } = familyNodes(def);
  if (!parent || !box) return;
  parent.setAttribute('aria-expanded', String(Boolean(expanded)));
}

function closeToolFamily(def, { dismiss = false, restoreFocus = false } = {}) {
  clearFamilyTimer(def);
  const { parent, box } = familyNodes(def);
  if (!parent || !box) return;
  box.classList.remove('open');
  delete box.dataset.familyPinned;
  box.classList.toggle('dismissed', Boolean(dismiss));
  setFamilyExpanded(def, false);
  if (restoreFocus) parent.focus({ preventScroll: true });
}

export function closePlanToolFamilies(exceptId = '') {
  for (const def of PLAN_TOOL_FAMILIES) {
    if (def.id !== exceptId) closeToolFamily(def, { dismiss: true });
  }
}

function openToolFamily(def, { pinned = false, focusFirst = false } = {}) {
  clearFamilyTimer(def);
  closePlanToolFamilies(def.id);
  const { parent, flyout, box } = familyNodes(def);
  if (!parent || !flyout || !box) return;
  box.classList.remove('dismissed');
  box.classList.toggle('open', Boolean(pinned));
  if (pinned) box.dataset.familyPinned = 'true';
  else delete box.dataset.familyPinned;
  setFamilyExpanded(def, true);
  if (focusFirst) {
    const first = def.childIds.map((id) => el(id)).find((btn) => btn && !btn.disabled && !btn.hidden);
    first?.focus({ preventScroll: true });
  }
}

function familyIsActive(def) {
  const ids = def.activeChildIds || def.childIds;
  return ids.some((id) => {
    const child = el(id);
    return child?.classList.contains('active') || child?.getAttribute('aria-pressed') === 'true';
  });
}

export function syncPlanToolFamilies() {
  for (const def of PLAN_TOOL_FAMILIES) {
    const { parent } = familyNodes(def);
    if (!parent) continue;
    const active = familyIsActive(def);
    parent.classList.toggle('active', active);
    parent.setAttribute('aria-pressed', String(active));
  }
}

function bindPlanToolFamilies() {
  const observedChildIds = new Set(PLAN_TOOL_FAMILIES.flatMap((def) => def.childIds));
  for (const def of PLAN_TOOL_FAMILIES) {
    const { parent, flyout, box } = familyNodes(def);
    if (!parent || !flyout || !box || parent.dataset.familyBound === 'true') continue;
    parent.dataset.familyBound = 'true';
    parent.removeAttribute('aria-haspopup');
    parent.setAttribute('aria-controls', def.flyoutId);
    parent.setAttribute('aria-expanded', 'false');
    flyout.setAttribute('role', 'toolbar');
    flyout.setAttribute('aria-label', def.label);
    setTip(parent, def.label, def.note);

    box.addEventListener('pointerenter', () => {
      clearFamilyTimer(def);
      box.classList.remove('dismissed');
      setFamilyExpanded(def, true);
    });
    box.addEventListener('pointerleave', () => {
      clearFamilyTimer(def);
      const timer = setTimeout(() => {
        familyCloseTimers.delete(def.id);
        if (box.dataset.familyPinned === 'true' || box.contains(document.activeElement)) return;
        setFamilyExpanded(def, false);
      }, 90);
      familyCloseTimers.set(def.id, timer);
    });
    box.addEventListener('focusin', (event) => {
      if (!box.contains(event.relatedTarget)) box.classList.remove('dismissed');
      if (!box.classList.contains('dismissed')) setFamilyExpanded(def, true);
    });
    box.addEventListener('focusout', () => {
      setTimeout(() => {
        if (box.contains(document.activeElement)) return;
        box.classList.remove('dismissed');
        if (box.dataset.familyPinned !== 'true' && !box.matches(':hover')) setFamilyExpanded(def, false);
      }, 0);
    });

    parent.addEventListener('click', () => {
      parent.focus({ preventScroll: true });
      const wasPinned = box.dataset.familyPinned === 'true';
      if (wasPinned) closeToolFamily(def, { dismiss: true });
      else openToolFamily(def, { pinned: true });
    });
    parent.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        closeToolFamily(def, { dismiss: true });
        return;
      }
      if (!['Enter', ' ', 'ArrowRight', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      openToolFamily(def, { pinned: true, focusFirst: true });
    });

    flyout.addEventListener('keydown', (event) => {
      const children = def.childIds.map((id) => el(id)).filter((btn) => btn && !btn.disabled && !btn.hidden);
      const index = children.indexOf(document.activeElement);
      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        closeToolFamily(def, { dismiss: true, restoreFocus: true });
        return;
      }
      if (!children.length || index < 0) return;
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = children[(index + 1) % children.length];
      else if (event.key === 'ArrowUp') next = children[(index - 1 + children.length) % children.length];
      else if (event.key === 'Home') next = children[0];
      else if (event.key === 'End') next = children[children.length - 1];
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
    });
    flyout.addEventListener('click', (event) => {
      const child = event.target.closest('button');
      if (!child || !def.childIds.includes(child.id)) return;
      // Выбор не держит меню зафиксированным. Пока указатель остаётся над
      // семейством, обычный hover продолжает показывать варианты.
      box.classList.remove('open');
      delete box.dataset.familyPinned;
      setFamilyExpanded(def, box.matches(':hover') || box.contains(document.activeElement));
    });
  }

  if (!familyStateObserver) {
    const strip = el('toolStrip');
    if (strip) {
      familyStateObserver = new MutationObserver((records) => {
        if (records.some(({ target }) => observedChildIds.has(target.id))) syncPlanToolFamilies();
      });
      familyStateObserver.observe(strip, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
    }
  }

  if (document.documentElement.dataset.planFamiliesOutsideBound !== 'true') {
    document.documentElement.dataset.planFamiliesOutsideBound = 'true';
    document.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.tb-family')) return;
      closePlanToolFamilies();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = PLAN_TOOL_FAMILIES.some((def) => familyNodes(def).box?.classList.contains('open'));
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      closePlanToolFamilies();
    });
  }
  syncPlanToolFamilies();
}

// Подписи под значками на телефоне (.tb-label; на компьютере скрыты — там подсказка .tb-tip).
const SHORT = {
  underlay: 'Съёмка', boundary: 'Граница', redline: 'Кр.линия', neighbor: 'Сосед', terrain: 'Отметка', north: 'Север',
};
const PLAN_LABELS = {
  selectToolBtn: 'Выбор', wallToolBtn: 'Стена', boundRoomBtn: 'Помещение', doorToolBtn: 'Дверь', windowToolBtn: 'Окно',
  furnitureToolBtn: 'Мебель', stairsToolBtn: 'Лестница', slabOpeningToolBtn: 'Проём', massToolBtn: 'Масса', massVoidToolBtn: 'Пустота', roofToolBtn: 'Крыша', gridToolBtn: 'Ось',
  sectionToolBtn: 'Разрез', viewBtn: 'Поворот', fitBtn: 'Вписать',
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
const MODEL_TOOLS = new Set([
  'selectToolBtn', 'openingsGroupBtn', 'doorToolBtn', 'windowToolBtn',
  'furnitureToolBtn', 'stairsToolBtn', 'massGroupBtn', 'massToolBtn', 'massVoidToolBtn', 'roofToolBtn',
]);

export function toolContext() {
  if (state.sheetOpen || state.elevationOpen || isSectionOpen()) return 'drawing';
  return document.body.classList.contains('v3-open') ? 'model' : state.modeName;
}
export const availableModelTool = (id) => MODEL_TOOLS.has(id);

function syncContextTools() {
  const context = toolContext();
  if (document.body.dataset.toolContext === context) return;
  const strip = el('toolStrip');
  const model = context === 'model';
  document.body.dataset.toolContext = context;
  strip.hidden = context === 'drawing';
  const plan = el('planTools');
  if (plan) {
    for (const entry of plan.children) {
      const button = entry.matches('.tb-family') ? entry.firstElementChild : entry;
      entry.hidden = model && !availableModelTool(button.id);
    }
    for (const child of plan.querySelectorAll('.tb-family-flyout > button')) {
      child.hidden = model && !availableModelTool(child.id);
    }
  }
  el('viewTools').hidden = model;
}

export function renderToolstrip() {
  const strip = el('toolStrip');
  if (!strip || !state.project) return;
  const context = toolContext();
  const planTools = context === 'plan' || context === 'model';
  const t = state.tool;
  syncContextTools();
  el('planTools').hidden = !planTools;
  if (!planTools) closePlanToolFamilies();
  refs.siteTools.hidden = context !== 'site';
  const ls = el('landscapeTools');
  if (ls) ls.hidden = context !== 'landscape';
  ensurePlanLabels();
  buildGroup(refs.siteTools, SITE_TOOLS, 'siteTool');
  buildGroup(ls, LANDSCAPE_TOOLS, 'lsTool');
  if (context === 'site') syncGroup(refs.siteTools, SITE_TOOLS, 'siteTool', (id) => activeSiteLayer() === id);
  if (context === 'landscape') syncGroup(ls, LANDSCAPE_TOOLS, 'lsTool', () => false);
  syncLibraryOpen(); // библиотека — по активному инструменту
  const phone = isPhone();
  const stairs = t?.kind === 'place-furniture' && t.itemKind === 'stairs';
  const pinned = !phone && planTools && !t && state.libraryPinned;
  toggle('selectToolBtn', !t && !pinned);
  toggle('wallToolBtn', t?.kind === 'wall');
  toggle('boundRoomBtn', t?.kind === 'bound-room' || t?.kind === 'place-room' || (pinned && state.libraryTab === 'rooms'));
  toggle('doorToolBtn', t?.kind === 'place-opening' && t.openKind === 'door');
  toggle('windowToolBtn', t?.kind === 'place-opening' && t.openKind === 'window');
  const furnOpen = planTools && ((t?.kind === 'place-furniture' && !stairs)
    || (phone ? document.body.classList.contains('sheet-library') && state.libraryTab === 'furniture' : pinned && state.libraryTab === 'furniture'));
  toggle('furnitureToolBtn', furnOpen);
  toggle('stairsToolBtn', stairs);
  toggle('slabOpeningToolBtn', t?.kind === 'slab-opening');
  toggle('sectionToolBtn', t?.kind === 'psec');
  toggle('massToolBtn', t?.kind === 'mass' && !t.void);
  toggle('massVoidToolBtn', t?.kind === 'mass' && Boolean(t.void));
  toggle('roofToolBtn', t?.kind === 'roof');
  toggle('gridToolBtn', t?.kind === 'grid');
  for (const id of ['selectToolBtn', 'wallToolBtn', 'boundRoomBtn', 'doorToolBtn', 'windowToolBtn', 'furnitureToolBtn', 'stairsToolBtn', 'slabOpeningToolBtn', 'sectionToolBtn', 'massToolBtn', 'massVoidToolBtn', 'roofToolBtn', 'gridToolBtn']) {
    const b = el(id);
    if (b) b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  }
  syncPlanToolFamilies();
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
    const open = document.body.classList.contains('lib-open') && !refs.furnitureBar.hidden;
    if (state.tool && !finishWallChain()) cancelTool();
    if (!open) state.libraryTab = 'furniture';
    state.libraryPinned = !open;
    applyLibraryTab();
  }
  renderToolstrip();
}

// Лестничный марш — размещение как у мебели (core/catalog.js «stairs»);
// повторный клик — выйти.
function toggleStairs() {
  const t = state.tool;
  if (t?.kind === 'place-furniture' && t.itemKind === 'stairs') {
    state.libraryPinned = false;
    cancelTool();
  }
  else {
    if (t?.kind === 'wall') finishWallChain();
    state.libraryPinned = false;
    startPlaceFurniture('stairs', 'Деревянная открытая', { stairPreset: 'interior-wood', stairShape: 'straight' });
    closeSheets();
  }
  renderToolstrip();
}

export function bindToolstrip() {
  document.addEventListener('kepler:view', syncContextTools);
  bindPlanToolFamilies();
  el('selectToolBtn')?.addEventListener('click', () => {
    if (!finishWallChain()) cancelTool();
    state.libraryPinned = false; // «Выбор» закрывает библиотеку
    applyLibraryTab();
  });
  el('stairsToolBtn')?.addEventListener('click', toggleStairs);
  el('slabOpeningToolBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'wall') finishWallChain();
    startSlabOpeningTool();
    closeSheets();
    renderToolstrip();
  });
  el('doorToolBtn')?.addEventListener('click', () => placeOpening('door'));
  el('windowToolBtn')?.addEventListener('click', () => placeOpening('window'));
  el('furnitureToolBtn')?.addEventListener('click', toggleFurniture);
  el('massToolBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'wall') finishWallChain();
    toggleMassTool(false);
    if (state.tool) closeSheets();
    renderToolstrip();
  });
  el('massVoidToolBtn')?.addEventListener('click', () => {
    if (state.tool?.kind === 'wall') finishWallChain();
    toggleMassTool(true);
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

// Библиотека (выезжает слева у колонки инструментов): вкладки, карточки
// помещений, каталог мебели.

import {
  FURNITURE_CATEGORIES, allFurniture, furnitureByCategory, roomColors, roomType, roomTypesByCategory,
} from '../core/catalog.js';
import { analyzeHomeProgram } from '../core/home-program.js';
import { drawGlyphPreview } from '../render.js';
import { el, refs } from './dom.js';
import { state } from './state.js';
import { bindLandscapeLibrary, renderLandscapeLibrary } from './landscape.js';
import { bindOpeningLibrary, renderOpeningLibrary } from './opening-library.js';
import { renderStairLibrary } from './stair-library.js';
import { renderToolstrip } from './toolstrip.js';
import { cancelTool, startPlaceFurniture, startPlaceRoom } from './tools.js';
import { PROJECT_CHANGE_EVENT } from './store.js';

let furnitureCat = FURNITURE_CATEGORIES[0].id;
let projectLibraryBound = false;

// Вкладки библиотеки: в режиме «План» переключают «Помещения» / «Мебель»
// (как вкладки обозревателя в Revit). В режиме «Участок» каталога нет —
// инструменты участка на панели инструментов (ui/toolstrip.js), левая
// панель скрыта.
export function bindFurnitureSearch() {
  if (!projectLibraryBound) {
    projectLibraryBound = true;
    el('roomSearch').addEventListener('input', filterRooms);
    el('furnSearch').addEventListener('input', renderFurnitureItems);
    refs.furnitureCats.addEventListener('change', () => {
      furnitureCat = refs.furnitureCats.value;
      el('furnSearch').value = '';
      renderFurnitureItems();
    });
    document.addEventListener(PROJECT_CHANGE_EVENT, () => renderLibrary());
  }
  bindLandscapeLibrary();
  bindOpeningLibrary();
}

const ROOM_TOOLS = new Set(['bound-room', 'place-room']);

// Компьютер: библиотека выезжает рядом с колонкой инструментов только когда
// нужна — «Помещение» (типы комнат), «Мебель» (каталог; кнопкой или во время
// размещения), «Дверь» / «Окно» (каталог проёмов, ui/opening-library.js),
// «Ландшафт» (каталог участка). Иначе холст свободен.
// Телефон: та же панель — нижний лист по кнопкам #mobileBar (ui/mobile.js).
export function libraryWanted() {
  if (state.modeName === 'landscape') return true;
  if (state.modeName !== 'plan') return false;
  const t = state.tool;
  if (!t) return state.libraryPinned;
  if (ROOM_TOOLS.has(t.kind) || t.kind === 'place-opening') return true;
  if (t.kind === 'place-furniture') return true;
  return false;
}

// Без перерисовки панели инструментов (её зовёт renderToolstrip): другой
// инструмент закрывает библиотеку, размещение задаёт вкладку.
export function syncLibraryOpen() {
  const t = state.tool;
  if (t && !ROOM_TOOLS.has(t.kind) && t.kind !== 'place-furniture') state.libraryPinned = false;
  if (state.modeName !== 'plan') state.libraryPinned = false;
  if (t && ROOM_TOOLS.has(t.kind)) state.libraryTab = 'rooms';
  else if (t?.kind === 'place-furniture') state.libraryTab = t.itemKind === 'stairs' ? 'stairs' : 'furniture';
  document.body.classList.toggle('lib-open', libraryWanted());
  const plan = state.modeName === 'plan';
  const landscape = state.modeName === 'landscape';
  refs.libraryTabs.hidden = !plan;
  const bar = el('landscapeBar');
  if (bar) bar.hidden = !landscape;
  const openings = el('openingsBar');
  const stairsBar = el('stairsBar');
  if (stairsBar) stairsBar.hidden = true;
  const opening = plan && t?.kind === 'place-opening';
  if (openings) openings.hidden = !opening;
  if (!plan) {
    refs.libraryTop.hidden = landscape; // «Ландшафт» — свой каталог (ui/landscape.js)
    refs.furnitureBar.hidden = true;
    return;
  }
  if (opening) {
    // Дверь / окно: только каталог проёмов, без вкладок помещений и мебели.
    refs.libraryTabs.hidden = true;
    refs.libraryTop.hidden = true;
    refs.furnitureBar.hidden = true;
    renderOpeningLibrary();
    return;
  }
  const stairs = t?.kind === 'place-furniture' && t.itemKind === 'stairs';
  if (stairs) {
    refs.libraryTabs.hidden = true;
    refs.libraryTop.hidden = true;
    refs.furnitureBar.hidden = true;
    if (stairsBar) stairsBar.hidden = false;
    renderStairLibrary();
    return;
  }
  const furn = state.libraryTab === 'furniture';
  refs.libTabRooms.classList.toggle('active', !furn);
  refs.libTabFurniture.classList.toggle('active', furn);
  refs.libraryTop.hidden = furn;
  refs.furnitureBar.hidden = !furn;
  if (furn) {
    for (const card of refs.furnitureItems.children) {
      if (!card.dataset.kind) continue;
      const active = t?.kind === 'place-furniture' && t.itemKind === card.dataset.kind;
      card.classList.toggle('active', active);
      card.setAttribute('aria-pressed', String(active));
    }
  }
}

export function applyLibraryTab() {
  syncLibraryOpen();
  renderToolstrip(); // кнопка «Мебель» подсвечена, пока открыт каталог
}

export function renderLibrary() {
  renderLandscapeLibrary(); // активная карточка ландшафта
  // План: помещения по категориям (заголовок группы + чипы); у чипа —
  // точка цвета типа, как пол на плане. Без размеров.
  refs.roomCards.innerHTML = '';
  const needs = programRoomNeeds();
  if (needs.length) {
    const box = document.createElement('section');
    box.className = 'room-group room-group-program';
    box.dataset.cat = 'program';
    box.innerHTML = '<h3 class="room-group-title">По программе</h3>';
    const chips = document.createElement('div');
    chips.className = 'room-group-chips';
    for (const need of needs) chips.appendChild(roomCard(need.def, { count: need.count, program: true }));
    box.appendChild(chips);
    refs.roomCards.appendChild(box);
  }
  for (const group of roomTypesByCategory()) {
    if (!group.types.length) continue;
    const box = document.createElement('section');
    box.className = 'room-group';
    box.dataset.cat = group.id;
    box.innerHTML = `<h3 class="room-group-title">${group.title}</h3>`;
    const chips = document.createElement('div');
    chips.className = 'room-group-chips';
    for (const def of group.types) chips.appendChild(roomCard(def));
    box.appendChild(chips);
    refs.roomCards.appendChild(box);
  }

  filterRooms();
  renderToolstrip(); // инструменты участка и подсветка активного — на панели инструментов
}

function filterRooms() {
  const normalize = (s) => s.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const query = normalize(el('roomSearch').value.trim());
  let found = false;
  for (const group of refs.roomCards.children) {
    const matchesGroup = normalize(group.querySelector('h3').textContent).includes(query);
    let visible = false;
    for (const card of group.querySelectorAll('.room-card')) {
      card.hidden = !matchesGroup && !normalize(card.textContent).includes(query);
      if (!card.hidden) visible = true;
    }
    group.hidden = !visible;
    if (visible) found = true;
  }
  el('roomSearchEmpty').hidden = found || !query;
}

function programRoomNeeds() {
  let targets;
  try { targets = analyzeHomeProgram(state.project).targets || []; } catch { return []; }
  const byType = new Map();
  for (const target of targets) {
    const type = target.canonicalType || target.addType;
    const count = Math.max(0, Number(target.missingCount) || 0);
    if (!type || !count) continue;
    const def = roomType(type);
    if (!def) continue;
    const existing = byType.get(type);
    if (existing) existing.count += count;
    else byType.set(type, { def, count });
  }
  return [...byType.values()];
}

function roomCard(def, { count = 0, program = false } = {}) {
  const card = document.createElement('button');
  card.className = 'room-card names-only';
  if (program) card.classList.add('program-room-card');
  card.draggable = true;
  card.dataset.type = def.type;
  card.title = `${def.title} · ${def.w}×${def.h} мм`;
  const active = state.tool?.kind === 'place-room' && state.tool.type === def.type;
  card.setAttribute('aria-pressed', String(active));
  card.classList.toggle('active', active);
  card.innerHTML = `<span class="room-dot" style="--dot:${roomColors(def.type).swatch}"></span><span class="room-card-name">${def.title}</span>${count > 0 ? `<span class="program-room-count">×${count}</span>` : ''}`;
  card.addEventListener('click', () => {
    if (state.tool?.kind === 'place-room' && state.tool.type === def.type) cancelTool();
    else startPlaceRoom(def.type);
  });
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-kepler-room', def.type);
    e.dataTransfer.setData('text/plain', def.type);
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

// Смена темы: миниатюры на canvas (мебель — цвет --muted, ландшафт — тёмная
// палитра) сами не перерисуются — пересобрать карточки.
export function refreshLibraryTheme() {
  try { renderLandscapeLibrary(); } catch { /* каталога ещё нет */ }
  if (refs.furnitureItems?.childElementCount) renderFurnitureItems();
  renderOpeningLibrary();
  renderStairLibrary();
}

export function renderFurnitureBar() {
  // Содержимое строится только в режиме «План»; видимость задаёт вкладка
  // (applyLibraryTab).
  if (state.modeName !== 'plan') return;

  if (!refs.furnitureCats.options.length) {
    refs.furnitureCats.add(new Option('Все категории', ''));
    for (const cat of FURNITURE_CATEGORIES) refs.furnitureCats.add(new Option(cat.title, cat.id));
  }
  renderFurnitureItems();
}

// Поиск по всему каталогу (название или код), иначе — выбранная категория.
function furnitureList() {
  const q = (el('furnSearch')?.value || '').trim().toLowerCase();
  if (!q) return furnitureCat ? furnitureByCategory(furnitureCat) : allFurniture();
  return allFurniture().filter((f) => f.title.toLowerCase().includes(q) || f.kind.includes(q));
}

function renderFurnitureItems() {
  const searching = Boolean((el('furnSearch')?.value || '').trim());
  refs.furnitureCats.value = searching ? '' : furnitureCat;
  el('furnitureCatIcon').innerHTML = CATEGORY_ICONS[refs.furnitureCats.value || 'misc'];
  const stroke = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#7f90a5';
  refs.furnitureItems.innerHTML = '';
  const list = furnitureList();
  if (!list.length) refs.furnitureItems.innerHTML = '<p class="empty-hint">Ничего не нашлось</p>';
  for (const item of list) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'furniture-chip';
    chip.dataset.kind = item.kind;
    const active = state.tool?.kind === 'place-furniture' && state.tool.itemKind === item.kind;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
    chip.draggable = true;
    chip.title = `${item.title} · ${item.w} × ${item.h} мм`;
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 132;
    chip.appendChild(preview);
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = item.title;
    chip.appendChild(name);
    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = `${item.w} × ${item.h} мм`;
    chip.appendChild(size);
    try { drawGlyphPreview(preview, item.kind, item.w, item.h, stroke); } catch { /* превью не критично */ }
    chip.addEventListener('dragstart', (e) => {
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-kepler-furn', item.kind);
      e.dataTransfer.setData('text/plain', item.kind);
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('click', () => {
      if (state.tool?.kind === 'place-furniture' && state.tool.itemKind === item.kind) cancelTool();
      else startPlaceFurniture(item.kind, item.title);
    });
    refs.furnitureItems.appendChild(chip);
  }
}

// Чёткие контурные иконки категорий мебели (монохром, наследуют цвет).
const svgIcon = (inner) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const CATEGORY_ICONS = {
  seating: svgIcon('<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M4 11.5A1.5 1.5 0 0 1 5.5 13v3h13v-3A1.5 1.5 0 0 1 20 11.5"/><path d="M6.5 16v2M17.5 16v2"/>'),
  beds: svgIcon('<path d="M3 18V7h13a4 4 0 0 1 4 4v7"/><path d="M3 13h17"/><path d="M6.5 10.5h3"/>'),
  tables: svgIcon('<rect x="3" y="7" width="18" height="3.5" rx="1"/><path d="M5.5 10.5V17M18.5 10.5V17"/>'),
  chairs: svgIcon('<path d="M8 3v9M16 3v9M7 12h10l-1 9M8 21l-.7-9M7 12l-.5-9"/><path d="M8.5 16h7"/>'),
  storage: svgIcon('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 9h14M5 15h14"/><path d="M11 6h1M11 12h1M11 18h1"/>'),
  kitchen: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.8"/><circle cx="15" cy="9" r="1.8"/><path d="M5 14.5h14"/>'),
  bath: svgIcon('<path d="M4 12h16v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M6 12V7.5A2.2 2.2 0 0 1 8.2 5.3a2.2 2.2 0 0 1 2.1 1.5"/><path d="M7 18l-.8 2M17 18l.8 2"/>'),
  appliance: svgIcon('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8.5 6h0M11 6h0"/>'),
  decor: svgIcon('<path d="M8.5 3h7l2 7h-11z"/><path d="M12 10v8M9 21h6"/>'),
  office: svgIcon('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/>'),
  kids: svgIcon('<circle cx="12" cy="13.5" r="5.5"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="7" r="2.3"/><path d="M10 13h0M14 13h0"/>'),
  gym: svgIcon('<path d="M6.5 8.5v7M4 10v4M17.5 8.5v7M20 10v4M8 12h8"/>'),
  hall: svgIcon('<rect x="6" y="3" width="12" height="18" rx="1.5"/><circle cx="14.5" cy="12" r="1"/>'),
  outdoor: svgIcon('<path d="M12 21v-6"/><path d="M12 15a5 5 0 1 0-4.6-7A4 4 0 0 0 7 15z"/>'),
  structure: svgIcon('<rect x="3" y="9" width="12" height="4" rx="0.5" fill="currentColor"/><rect x="16" y="5" width="5" height="5" rx="0.5"/><circle cx="18.5" cy="16.5" r="2.5"/>'),
  misc: svgIcon('<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>'),
};

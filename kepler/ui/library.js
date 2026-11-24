// Библиотека (выезжает слева у колонки инструментов): вкладки, карточки
// помещений, каталог мебели.

import {
  FURNITURE_CATEGORIES, allFurniture, furnitureByCategory, normalizeCatalogText, roomColors, roomType, roomTypesByCategory,
} from '../core/catalog.js';
import { analyzeHomeProgram } from '../core/home-program.js';
import { drawGlyphPreview } from '../render.js';
import { el, refs } from './dom.js';
import { state } from './state.js';
import { bindLandscapeLibrary, renderLandscapeLibrary } from './landscape.js';
import { bindOpeningLibrary, renderOpeningLibrary } from './opening-library.js';
import { renderStairLibrary } from './stair-library.js';
import { bindFurnitureTouch } from './furniture-touch.js';
import { renderToolstrip } from './toolstrip.js';
import { cancelTool, startPlaceFurniture, startPlaceOpening, startPlaceRoom } from './tools.js';
import { PROJECT_CHANGE_EVENT } from './store.js';

let furnitureCat = FURNITURE_CATEGORIES[0].id;
let projectLibraryBound = false;
// Карточки помещений зависят от программы дома, поэтому после правки проекта
// их нужно обновить. Но закрытый каталог не должен ради этого заново запускать
// analyzeHomeProgram и пересобирать DOM: помечаем содержимое устаревшим и
// обновляем его только при следующем открытии каталога помещений.
let projectLibraryDirty = true;
const categorySections = { kitchen: 'kitchen', appliance: 'kitchen', bath: 'bath', decor: 'decor' };
const subcategories = {
  bathing: { section: 'bath', title: 'Ванны и душ', kinds: ['bath', 'bath-corner', 'shower', 'jacuzzi'] },
  basins: { section: 'bath', title: 'Раковины', kinds: ['washbasin', 'washbasin-double', 'vanity-unit'] },
  toilets: {
    section: 'bath',
    title: 'Унитазы и биде',
    kinds: ['toilet', 'toilet-wall', 'toilet-smart', 'bidet', 'urinal'],
  },
  bathExtras: { section: 'bath', title: 'Аксессуары', kinds: ['towel-rail'] },
  lighting: { section: 'decor', title: 'Свет', kinds: ['floor-lamp', 'chandelier'] },
  textiles: { section: 'decor', title: 'Текстиль', kinds: ['rug', 'rug-round', 'curtain'] },
  interior: { section: 'decor', title: 'Для интерьера', kinds: ['coffee-table-2', 'plant', 'piano', 'fireplace', 'aquarium'] },
};
const sectionForCategory = (id) => subcategories[id]?.section || categorySections[id] || 'furniture';
const lastCategory = new Map();

function catalogActuallyOpen() {
  const phone = globalThis.matchMedia?.('(max-width: 640px)')?.matches === true;
  return phone
    ? document.body.classList.contains('sheet-library')
    : document.body.classList.contains('lib-open');
}

function projectLibraryVisible() {
  if (!catalogActuallyOpen()) return false;
  const model = document.body.classList.contains('v3-open');
  const plan = state.modeName === 'plan' || model;
  return plan && state.libraryTab === 'rooms' && state.tool?.kind !== 'place-opening';
}

function catalogSection() {
  return state.tool?.kind === 'place-opening' ? state.tool.openKind : sectionForCategory(furnitureCat);
}

function syncCatalogTabs() {
  const section = catalogSection();
  const search = el(section === 'door' || section === 'window' ? 'openSearch' : 'furnSearch');
  const tabs = el('objectCatalogTabs');
  if (tabs.dataset.section !== section) {
    tabs.dataset.section = section;
    tabs.classList.toggle('search-open', Boolean(search.value));
  }
  const toggle = el('catalogSearchToggle');
  toggle.setAttribute('aria-expanded', String(tabs.classList.contains('search-open')));
  toggle.setAttribute('aria-controls', search.id);
  toggle.setAttribute('aria-label', search.getAttribute('aria-label'));
  for (const button of el('objectSections').children) {
    button.setAttribute('aria-pressed', String(button.dataset.objectSection === section));
  }
}

function chooseCategory(id) {
  furnitureCat = id;
  lastCategory.set(sectionForCategory(id), id);
  el('furnSearch').value = '';
  el('objectCatalogTabs').classList.remove('search-open');
  refs.furnitureItems.scrollTop = 0;
  renderFurnitureItems();
}

function chooseCatalogSection(section) {
  if (section === catalogSection()) return;
  if (section === 'window' || section === 'door') {
    el('openSearch').value = '';
    startPlaceOpening(section);
    return;
  }
  if (state.tool) cancelTool();
  state.libraryTab = 'furniture';
  state.libraryPinned = true;
  const category = lastCategory.get(section) ?? FURNITURE_CATEGORIES.find((cat) => sectionForCategory(cat.id) === section).id;
  chooseCategory(category);
  applyLibraryTab();
}

function bindCatalogNavigation() {
  const sections = [
    ['furniture', 'Мебель', 'seating'], ['door', 'Двери', 'door'], ['window', 'Окна', 'window'],
    ['kitchen', 'Кухня', 'kitchen'], ['bath', 'Санузел', 'bath'], ['decor', 'Декор', 'decor'],
  ];
  for (const [id, title, icon] of sections) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.objectSection = id;
    button.innerHTML = CATEGORY_ICONS[icon];
    button.append(title);
    button.addEventListener('click', () => chooseCatalogSection(id));
    el('objectSections').append(button);
  }
  const filters = [
    ...FURNITURE_CATEGORIES,
    ...Object.entries(subcategories).map(([id, group]) => ({ id, title: group.title })),
    { id: '', title: 'Все предметы' },
  ];
  for (const cat of filters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.category = cat.id;
    if (subcategories[cat.id]) button.dataset.subcategory = '';
    button.textContent = cat.id === 'bath' || cat.id === 'decor' ? 'Все' : cat.title;
    button.addEventListener('click', () => chooseCategory(cat.id));
    el('furnitureCategoryList').append(button);
  }
  const tabs = el('objectCatalogTabs');
  const toggle = el('catalogSearchToggle');
  toggle.addEventListener('click', () => {
    const field = el(toggle.getAttribute('aria-controls'));
    const open = tabs.classList.toggle('search-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) field.focus();
    else {
      field.value = '';
      field.dispatchEvent(new Event('input'));
    }
  });
  for (const field of [el('furnSearch'), el('openSearch')]) {
    field.addEventListener('input', () => {
      if (field.value) {
        tabs.classList.add('search-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !toggle.offsetWidth || !tabs.classList.contains('search-open')) return;
      event.preventDefault();
      event.stopPropagation();
      toggle.click();
      toggle.focus();
    });
  }
  syncCatalogTabs();
}

// Вкладки библиотеки: в режиме «План» переключают «Помещения» / «Мебель»
// (как вкладки обозревателя в Revit). В режиме «Участок» каталога нет —
// инструменты участка на панели инструментов (ui/toolstrip.js), левая
// панель скрыта.
export function bindFurnitureSearch() {
  if (!projectLibraryBound) {
    projectLibraryBound = true;
    bindCatalogNavigation();
    bindFurnitureTouch(refs.furnitureItems);
    el('roomSearch').addEventListener('input', filterRooms);
    el('furnSearch').addEventListener('input', () => {
      refs.furnitureItems.scrollTop = 0;
      renderFurnitureItems();
    });
    document.addEventListener(PROJECT_CHANGE_EVENT, () => {
      projectLibraryDirty = true;
      if (projectLibraryVisible()) renderLibrary();
    });
    // На телефоне нижний лист получает класс уже после выбора вкладки. Следим
    // только за открытием/закрытием листа, чтобы первый показ тоже получил
    // свежие карточки, но закрытый каталог оставался полностью ленивым.
    if (globalThis.MutationObserver) {
      const observer = new MutationObserver(() => {
        if (projectLibraryDirty && projectLibraryVisible()) renderLibrary();
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
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
  const model = document.body.classList.contains('v3-open');
  // На телефоне каталог — нижний лист, а не pinned-панель. После открытия
  // листа syncLibraryOpen должен увидеть его и подготовить отложенные карточки.
  if (document.body.classList.contains('sheet-library')) return true;
  if (state.modeName === 'landscape' && !model) return true;
  if (state.modeName !== 'plan' && !model) return false;
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
  const model = document.body.classList.contains('v3-open');
  if (t && !ROOM_TOOLS.has(t.kind) && t.kind !== 'place-furniture') state.libraryPinned = false;
  if (state.modeName !== 'plan' && !model) state.libraryPinned = false;
  if (t && ROOM_TOOLS.has(t.kind)) state.libraryTab = 'rooms';
  else if (t?.kind === 'place-furniture') state.libraryTab = t.itemKind === 'stairs' ? 'stairs' : 'furniture';
  document.body.classList.toggle('lib-open', libraryWanted());
  const plan = state.modeName === 'plan' || model;
  const landscape = state.modeName === 'landscape' && !model;
  refs.libraryTabs.hidden = !plan || model;
  const bar = el('landscapeBar');
  if (bar) bar.hidden = !landscape;
  const openings = el('openingsBar');
  const stairsBar = el('stairsBar');
  if (stairsBar) stairsBar.hidden = true;
  const opening = plan && t?.kind === 'place-opening';
  el('modelAddRoom').hidden = !model || opening || state.libraryTab !== 'furniture';
  const tabs = el('objectCatalogTabs');
  tabs.hidden = !(opening || (plan && state.libraryTab === 'furniture'));
  if (!tabs.hidden) syncCatalogTabs();
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
  if (state.libraryTab === 'stairs') {
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
  } else if (projectLibraryDirty && projectLibraryVisible()) {
    // Каталог мог быть закрыт во время десятков правок. Один свежий расчёт
    // при открытии заменяет десятки бесполезных скрытых пересчётов.
    renderLibrary();
  }
}

export function applyLibraryTab() {
  syncLibraryOpen();
  renderToolstrip(); // кнопка «Мебель» подсвечена, пока открыт каталог
}

export function renderLibrary() {
  // У каталога ландшафта свои активные инструменты и собственная видимость.
  // Его нужно синхронизировать даже когда каталог помещений закрыт: иначе
  // карточка сохраняет старый обработчик active=true и следующий клик лишь
  // отменяет уже завершённую постановку вместо запуска новой.
  renderLandscapeLibrary();
  // renderLibrary вызывается и общими действиями инструментов. Если нужная
  // часть каталога сейчас закрыта, оставляем только dirty-флаг: даже первый
  // DOM карточек можно безопасно построить непосредственно перед показом.
  if (!projectLibraryVisible()) {
    projectLibraryDirty = true;
    // У renderLibrary исторически есть и лёгкая обязанность синхронизировать
    // инструменты/видимость панели. Сохраняем её, не запуская анализ программы.
    renderToolstrip();
    return;
  }
  projectLibraryDirty = false;
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
  // В самостоятельном 3D используется тот же каталог и те же объекты,
  // что на плане. Видимость задаёт вкладка (applyLibraryTab).
  if (state.modeName !== 'plan' && !document.body.classList.contains('v3-open')) return;

  renderFurnitureItems();
}

// Поиск охватывает весь каталог, в том числе размеры в миллиметрах.
function furnitureList() {
  const q = normalizeCatalogText(el('furnSearch').value);
  if (!q) {
    const group = subcategories[furnitureCat];
    if (group) return furnitureByCategory(group.section).filter((item) => group.kinds.includes(item.kind));
    return furnitureCat ? furnitureByCategory(furnitureCat) : allFurniture();
  }
  const terms = q.split(/\s+/);
  return allFurniture().filter((f) => {
    const label = normalizeCatalogText(`${f.title} ${f.kind} ${f.w}×${f.h} мм`);
    return terms.every((term) => label.includes(term));
  });
}

function renderFurnitureItems() {
  const searching = Boolean((el('furnSearch')?.value || '').trim());
  const rail = el('furnitureCategoryList');
  const group = sectionForCategory(furnitureCat);
  for (const button of rail.children) {
    button.hidden = sectionForCategory(button.dataset.category) !== group;
    button.setAttribute('aria-pressed', String(button.dataset.category === furnitureCat));
  }
  rail.hidden = searching;
  syncCatalogTabs();
  const stroke = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#33443b';
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
const svgIcon = (inner) => `<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const CATEGORY_ICONS = {
  door: svgIcon('<path d="M4 20h16M6 20V4h11v16M9 19V7l5-1v13M12 13h.3"/>'),
  window: svgIcon('<rect x="4" y="4" width="16" height="15" rx="1"/><path d="M12 4v15M4 10h16M3 21h18"/>'),
  seating: svgIcon('<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M4 11.5A1.5 1.5 0 0 1 5.5 13v3h13v-3A1.5 1.5 0 0 1 20 11.5"/><path d="M6.5 16v2M17.5 16v2"/>'),
  kitchen: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.8"/><circle cx="15" cy="9" r="1.8"/><path d="M5 14.5h14"/>'),
  bath: svgIcon('<path d="M4 12h16v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M6 12V7.5A2.2 2.2 0 0 1 8.2 5.3a2.2 2.2 0 0 1 2.1 1.5"/><path d="M7 18l-.8 2M17 18l.8 2"/>'),
  decor: svgIcon('<path d="M8.5 3h7l2 7h-11z"/><path d="M12 10v8M9 21h6"/>'),
};

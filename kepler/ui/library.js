// Левая панель: вкладки, карточки помещений, каталог мебели.

import { FURNITURE_CATEGORIES, ROOM_TYPES, furnitureByCategory } from '../core/catalog.js';
import { polygonAreaM2 } from '../core/site.js';
import { drawGlyphPreview } from '../render.js';
import { refs } from './dom.js';
import { addFurnitureToSelection } from './plan-actions.js';
import { state } from './state.js';
import {
  activeSiteLayer, cancelTool, setTool, startDraw, startEditLayer, startPlaceRoom,
} from './tools.js';

let furnitureCat = FURNITURE_CATEGORIES[0].id;

// Вкладки левой панели: в режиме «План» переключают «Помещения» / «Мебель»
// (как вкладки обозревателя в Revit). В режиме «Участок» вкладок нет — там
// только инструменты участка.
export function applyLibraryTab() {
  const plan = state.modeName === 'plan';
  refs.libraryTabs.hidden = !plan;
  if (!plan) {
    refs.libraryTop.hidden = false;
    refs.furnitureBar.hidden = true;
    return;
  }
  const furn = state.libraryTab === 'furniture';
  refs.libTabRooms.classList.toggle('active', !furn);
  refs.libTabFurniture.classList.toggle('active', furn);
  refs.libraryTop.hidden = furn;
  refs.furnitureBar.hidden = !furn;
}

export function renderLibrary() {
  // План: карточки помещений — только названия, без размеров.
  refs.roomCards.innerHTML = '';
  for (const def of ROOM_TYPES) {
    const card = document.createElement('button');
    card.className = 'room-card names-only';
    card.draggable = true;
    if (state.tool?.kind === 'place-room' && state.tool.type === def.type) card.classList.add('active');
    card.innerHTML = `<span class="room-card-name">${def.title}</span>`;
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
    refs.roomCards.appendChild(card);
  }

  // Участок: инструменты-слои. Правка слоя доступна, только пока его кнопка
  // активна (подсвечена). Повторный клик по активной — выключает.
  const site = state.project?.site;
  const layer = activeSiteLayer();
  const editHint = (name) => `Правка: ${name}. Тяните точки/объект. Esc — выйти`;
  const tools = [
    { id: 'underlay', title: 'Топосъёмка', note: site?.underlay ? 'двигать / масштаб' : 'импорт PDF/JPG/DXF',
      action: () => setTool({ kind: 'underlay-edit' }, site?.underlay
        ? editHint('топосъёмка — двигайте, тяните углы')
        : 'Нажмите «Импортировать топосъёмку» в панели справа · PDF / JPG / PNG / DXF') },
    { id: 'boundary', title: 'Граница участка', note: site?.boundary ? `${polygonAreaM2(site.boundary).toFixed(0)} м² · правка` : 'полигон по точкам',
      action: () => (site?.boundary ? startEditLayer('boundary', { type: 'site', kind: 'boundary' }, editHint('граница — тяните вершины')) : startDraw('boundary')) },
    { id: 'redline', title: 'Красная линия', note: site?.redLine ? 'правка' : 'линия застройки',
      action: () => (site?.redLine ? startEditLayer('redline', { type: 'site', kind: 'redline' }, editHint('красная линия — тяните вершины')) : startDraw('redline')) },
    { id: 'road', title: 'Дорога', note: site?.roads?.length ? 'правка / новая' : 'ось + ширина',
      action: () => (site?.roads?.length ? startEditLayer('road', { type: 'site', kind: 'road', id: site.roads[site.roads.length - 1].id }, editHint('дорога — тяните вершины')) : startDraw('road')) },
    { id: 'entry', title: 'Въезд', note: 'точка на границе', action: () => setTool({ kind: 'entry' }, 'Кликните/тяните по границе участка — там будет въезд · Esc — выйти') },
    { id: 'neighbor', title: 'Соседний дом', note: 'зона 6 м вокруг', action: () => setTool({ kind: 'neighbor' }, 'Кликните — новый дом; тяните углы для размера и поворота · Esc — выйти') },
    { id: 'north', title: 'Север по 2 точкам', note: `сейчас ${Math.round(site?.north || 0)}°`, action: () => setTool({ kind: 'north', points: [] }, 'Кликните первую точку стрелки на север') },
  ];
  refs.siteTools.innerHTML = '';
  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'room-card';
    const active = layer === tool.id || (tool.id === 'north' && state.tool?.kind === 'north');
    if (active) btn.classList.add('active');
    btn.innerHTML = `<span class="room-card-name">${tool.title}</span><span class="room-card-size">${tool.note}</span>`;
    btn.addEventListener('click', () => { if (active) cancelTool(); else tool.action(); });
    refs.siteTools.appendChild(btn);
  }
}

export function renderFurnitureBar() {
  // Содержимое строится только в режиме «План»; видимость задаёт вкладка
  // (applyLibraryTab).
  if (state.modeName !== 'plan') return;

  refs.furnitureCats.innerHTML = '';
  for (const cat of FURNITURE_CATEGORIES) {
    const btn = document.createElement('button');
    btn.innerHTML = CATEGORY_ICONS[cat.id] || '';
    btn.title = cat.title;
    btn.setAttribute('aria-label', cat.title);
    if (cat.id === furnitureCat) btn.classList.add('active');
    btn.addEventListener('click', () => { furnitureCat = cat.id; renderFurnitureBar(); });
    refs.furnitureCats.appendChild(btn);
  }

  const stroke = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#7f90a5';
  refs.furnitureItems.innerHTML = '';
  for (const item of furnitureByCategory(furnitureCat)) {
    const chip = document.createElement('div');
    chip.className = 'furniture-chip';
    chip.draggable = true;
    chip.title = `Перетащите «${item.title}» на план (${item.w}×${item.h} мм)`;
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
    size.textContent = `${item.w}×${item.h}`;
    chip.appendChild(size);
    try { drawGlyphPreview(preview, item.kind, item.w, item.h, stroke); } catch { /* превью не критично */ }
    chip.addEventListener('dragstart', (e) => {
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-kepler-furn', item.kind);
      e.dataTransfer.setData('text/plain', item.kind);
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('click', () => addFurnitureToSelection(item.kind));
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
  misc: svgIcon('<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>'),
};

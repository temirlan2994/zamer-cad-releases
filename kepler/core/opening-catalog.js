// Каталог дверей и окон для библиотеки: готовые пресеты размеров поверх
// типов, которые знает модель и рисует план (core/walls.js DOOR_TYPES,
// WINDOW_TYPES). Новых типов здесь нет — только тип + ширина/высота/подоконник.
// Чистый модуль без DOM.

import { DOOR_TYPES, WINDOW_TYPES } from './walls.js';
import { normalizeCatalogText } from './catalog.js';

export const OPENING_CATEGORIES = {
  door: [
    { id: 'interior', title: 'Межкомнатные' },
    { id: 'entrance', title: 'Входные' },
    { id: 'double', title: 'Двустворчатые' },
    { id: 'sliding', title: 'Раздвижные' },
    { id: 'passage', title: 'Проёмы без двери' },
  ],
  window: [
    { id: 'standard', title: 'Обычные' },
    { id: 'wide', title: 'Широкие' },
    { id: 'panoramic', title: 'Панорамные и французские' },
  ],
};

const D = (cat, id, title, type, width, height, keywords = '') => ({ id, kind: 'door', cat, title, type, width, height, sill: 0, keywords });
const W = (cat, id, title, type, width, height, sill, keywords = '') => ({ id, kind: 'window', cat, title, type, width, height, sill, keywords });

export const OPENING_PRESETS = [
  D('interior', 'door-600', 'Дверь 600', 'single', 600, 2000, 'санузел ванная туалет кладовая'),
  D('interior', 'door-700', 'Дверь 700', 'single', 700, 2000, 'санузел ванная кухня'),
  D('interior', 'door-800', 'Дверь 800', 'single', 800, 2100, 'комната спальня межкомнатная'),
  D('interior', 'door-900', 'Дверь 900', 'single', 900, 2100, 'комната гостиная межкомнатная'),
  D('entrance', 'entry-900', 'Входная 900', 'single', 900, 2100, 'входная уличная металлическая'),
  D('entrance', 'entry-1000', 'Входная 1000', 'single', 1000, 2100, 'входная уличная металлическая'),
  D('entrance', 'entry-1100', 'Входная 1100', 'single', 1100, 2200, 'входная уличная широкая'),
  D('double', 'double-1200', 'Двустворчатая 1200', 'double', 1200, 2100, 'распашная две створки'),
  D('double', 'double-1400', 'Двустворчатая 1400', 'double', 1400, 2100, 'распашная две створки гостиная'),
  D('double', 'double-1600', 'Двустворчатая 1600', 'double', 1600, 2200, 'распашная две створки входная'),
  D('sliding', 'slide-800', 'Раздвижная 800', 'sliding', 800, 2100, 'купе откатная'),
  D('sliding', 'slide-1200', 'Раздвижная 1200', 'sliding', 1200, 2100, 'купе откатная гардероб'),
  D('sliding', 'slide-1800', 'Раздвижная 1800', 'sliding', 1800, 2200, 'купе откатная терраса'),
  D('passage', 'open-800', 'Проём 800', 'none', 800, 2100, 'арка без двери'),
  D('passage', 'open-1200', 'Проём 1200', 'none', 1200, 2100, 'арка без двери'),
  D('passage', 'open-1800', 'Проём 1800', 'none', 1800, 2200, 'арка без двери широкий'),
  W('standard', 'win-600x600', 'Окно 600×600', 'standard', 600, 600, 1400, 'санузел ванная маленькое'),
  W('standard', 'win-900x1200', 'Окно 900×1200', 'standard', 900, 1200, 900, 'одностворчатое узкое'),
  W('standard', 'win-1200x1400', 'Окно 1200×1400', 'standard', 1200, 1400, 900, 'двустворчатое спальня'),
  W('standard', 'win-1500x1400', 'Окно 1500×1400', 'standard', 1500, 1400, 900, 'двустворчатое комната'),
  W('wide', 'win-1800x1500', 'Окно 1800×1500', 'standard', 1800, 1500, 900, 'трёхстворчатое гостиная'),
  W('wide', 'win-2100x1500', 'Окно 2100×1500', 'standard', 2100, 1500, 900, 'трёхстворчатое гостиная'),
  W('wide', 'win-2400x1500', 'Окно 2400×1500', 'standard', 2400, 1500, 900, 'ленточное широкое'),
  W('panoramic', 'french-900', 'Французское 900×2300', 'panoramic', 900, 2300, 100, 'французское балконное в пол'),
  W('panoramic', 'pano-1800', 'Панорамное 1800×2100', 'panoramic', 1800, 2100, 100, 'в пол витраж'),
  W('panoramic', 'pano-2400', 'Панорамное 2400×2100', 'panoramic', 2400, 2100, 100, 'в пол витраж гостиная'),
  W('panoramic', 'pano-3000', 'Панорамное 3000×2400', 'panoramic', 3000, 2400, 100, 'в пол витраж терраса'),
];

export function openingTypeTitle(kind, type) {
  return (kind === 'door' ? DOOR_TYPES : WINDOW_TYPES)[type] || type;
}

export function openingPresets(kind, cat = null) {
  return OPENING_PRESETS.filter((p) => p.kind === kind && (!cat || p.cat === cat));
}

// Поиск по названию, типу, размеру и ключевым словам («санузел», «1200», «в пол»).
export function searchOpeningPresets(kind, query) {
  const q = normalizeCatalogText(String(query || ''));
  if (!q) return openingPresets(kind);
  const words = q.split(/\s+/);
  return openingPresets(kind).filter((p) => {
    const category = OPENING_CATEGORIES[kind].find((c) => c.id === p.cat).title;
    const text = normalizeCatalogText(`${p.title} ${openingTypeTitle(kind, p.type)} ${category} ${p.width}×${p.height} мм ${p.keywords}`);
    return words.every((w) => text.includes(w));
  });
}

// Параметры инструмента из пресета; окно не выше этажа (над проёмом ≥ 400 мм).
export function presetToOpening(preset, levelHeight = 3000) {
  const out = { type: preset.type, width: preset.width, height: preset.height, sill: preset.kind === 'door' ? 0 : preset.sill };
  const top = Math.max(600, levelHeight - 400);
  if (out.sill + out.height > top) out.height = Math.max(300, top - out.sill);
  return out;
}

// Пресет совпадает с текущими параметрами инструмента (активная карточка).
export function presetMatches(preset, params, levelHeight = 3000) {
  if (!params) return false;
  const p = presetToOpening(preset, levelHeight);
  return p.type === (params.type || (preset.kind === 'door' ? 'single' : 'standard'))
    && p.width === params.width && p.height === params.height
    && (preset.kind === 'door' || p.sill === params.sill);
}

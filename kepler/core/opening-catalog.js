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
    { id: 'opening', title: 'Открывающиеся' },
    { id: 'fixed', title: 'Глухие и широкие' },
    { id: 'wide', title: 'Широкие' },
    { id: 'panoramic', title: 'Витражи и порталы' },
    { id: 'special', title: 'Фрамуги' },
  ],
};

const D = (cat, id, title, type, width, height, keywords = '') => ({ id, kind: 'door', cat, title, type, width, height, sill: 0, keywords });
const W = (cat, id, title, type, width, height, sill, keywords = '') => ({
  id, kind: 'window', cat, title, type, width, height, sill, keywords,
  heightMode: ['panoramic', 'lift-slide', 'french'].includes(type) ? 'level' : 'custom',
  frameMaterial: 'aluminum', frameColor: 'anthracite',
});

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
  W('opening', 'turn-700', 'Одностворчатое', 'tilt-turn', 700, 1400, 900, 'поворотно откидное узкое спальня кабинет'),
  W('opening', 'turn-1400', 'Двустворчатое', 'tilt-turn', 1400, 1500, 900, 'поворотно откидное спальня детская'),
  W('opening', 'turn-2100', 'Трёхстворчатое', 'tilt-turn', 2100, 1500, 900, 'гостиная открывающееся'),
  W('opening', 'win-slide-1800', 'Раздвижное', 'sliding', 1800, 1500, 900, 'раздвижное кухня гостиная'),
  W('opening', 'win-1200x1400', 'Окно 1200×1400', 'tilt-turn', 1200, 1400, 900, 'двустворчатое спальня'),
  W('opening', 'win-1500x1400', 'Окно 1500×1400', 'tilt-turn', 1500, 1400, 900, 'двустворчатое комната'),
  W('fixed', 'fixed-600', 'Глухое узкое', 'fixed', 600, 1400, 900, 'санузел лестница'),
  W('fixed', 'fixed-900', 'Глухое компактное', 'fixed', 900, 1400, 900, 'спальня кабинет'),
  W('fixed', 'fixed-1200', 'Глухое', 'fixed', 1200, 1500, 900, 'картина окно'),
  W('fixed', 'fixed-1800', 'Широкое глухое', 'fixed', 1800, 1500, 900, 'гостиная картина'),
  W('fixed', 'ribbon-2400', 'Ленточное', 'fixed', 2400, 900, 1200, 'кухня кабинет широкое'),
  W('wide', 'win-2100x1500', 'Окно 2100×1500', 'fixed', 2100, 1500, 900, 'трёхстворчатое гостиная'),
  W('wide', 'win-2400x1500', 'Окно 2400×1500', 'fixed', 2400, 1500, 900, 'трёхстворчатое гостиная ленточное'),
  W('panoramic', 'french-900', 'Французское', 'french', 900, 2300, 50, 'балконное высокое'),
  W('panoramic', 'pano-1800', 'Витраж 1800', 'panoramic', 1800, 2400, 100, 'в пол глухой'),
  W('panoramic', 'pano-2400', 'Панорамное 2400×2100', 'panoramic', 2400, 2100, 100, 'в пол гостиная'),
  W('panoramic', 'pano-3000', 'Панорамное 3000×2400', 'panoramic', 3000, 2400, 100, 'в пол витраж терраса'),
  W('panoramic', 'portal-3000', 'Портал HS 3000', 'lift-slide', 3000, 2400, 100, 'подъемно раздвижной hs терраса'),
  W('panoramic', 'portal-4200', 'Портал HS 4200', 'lift-slide', 4200, 2400, 100, 'подъемно раздвижной hs терраса большой'),
  W('special', 'awning-900', 'Фрамуга', 'awning', 900, 600, 1700, 'верхнеподвесная проветривание санузел'),
  W('special', 'clerestory-1800', 'Высокая фрамуга', 'clerestory', 1800, 600, 1700, 'под потолком приватность'),
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
  const out = {
    ...(preset.kind === 'door' ? { presetId: preset.id } : {}),
    type: preset.type, width: preset.width, height: preset.height,
    sill: preset.kind === 'door' ? 0 : preset.sill,
    ...(preset.kind === 'door' && preset.cat === 'entrance' ? { entryRole: 'main' } : {}),
  };
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

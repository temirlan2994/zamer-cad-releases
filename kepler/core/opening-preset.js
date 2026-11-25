// Параметры двери/окна, заданные ДО вставки (панель «Свойства» при активном
// инструменте): тип, ширина, высота, подоконник. Чистый модуль без DOM.

import { DOOR_WIDTH, WINDOW_WIDTH } from './catalog.js';
import { isGlazedAssembly } from './glazed-openings.js';
import {
  DEFAULT_TALL_WINDOW_HEIGHT, levelTallWindowOffsets,
} from './model.js';

export const HIGH_WINDOW_TYPES = new Set(['panoramic', 'lift-slide', 'sliding-tall', 'french']);

export function levelTallWindowHeight(level) {
  return level ? levelTallWindowOffsets(level).height : DEFAULT_TALL_WINDOW_HEIGHT;
}

// Фактическая отметка низа. У связанного витража сохранённый sill служит
// только совместимостью со старыми файлами: весь этаж следует одному отступу.
export function openingSill(opening, level) {
  if (isGlazedAssembly(opening)) return 0;
  if (opening?.kind === 'door') return 0;
  if (opening?.kind === 'window' && opening.heightMode === 'level') {
    return levelTallWindowOffsets(level).bottom;
  }
  const value = Number(opening?.sill);
  return Number.isFinite(value) && value >= 0 ? value : 900;
}

// Фактическая высота проёма. Связанный витраж хранит лишь режим, поэтому
// изменение параметра этажа сразу обновляет 2D, 3D, расчёты и экспорт.
export function openingHeight(opening, level) {
  if (opening?.kind === 'window' && opening.heightMode === 'level') {
    return levelTallWindowOffsets(level).height;
  }
  return Math.max(0, Number(opening?.height) || (opening?.kind === 'door' ? 2100 : 1500));
}

export function defaultOpeningPreset(kind) {
  return kind === 'door'
    ? { type: 'single', width: DOOR_WIDTH, height: 2100, sill: 0 }
    : {
      type: 'tilt-turn', width: WINDOW_WIDTH, height: 1500, sill: 900,
      heightMode: 'custom', frameMaterial: 'aluminum', frameColor: 'anthracite',
    };
}

// Параметры из заготовки накладываются на новый проём (до подгонки по стене).
export function applyOpeningPreset(opening, preset) {
  if (!preset) return opening;
  if (preset.presetId) opening.presetId = preset.presetId;
  else delete opening.presetId;
  if (opening.kind === 'door' && preset.entryRole) opening.entryRole = preset.entryRole;
  else if (opening.kind === 'door') delete opening.entryRole;
  opening.type = preset.type;
  if (isGlazedAssembly(preset)) {
    opening.assembly = { ...preset.assembly };
    delete opening.span;
  } else delete opening.assembly;
  opening.width = preset.width;
  opening.height = preset.height;
  if (opening.kind === 'window') {
    opening.heightMode = preset.heightMode === 'custom' ? 'custom'
      : preset.heightMode === 'level' || HIGH_WINDOW_TYPES.has(preset.type) ? 'level' : 'custom';
    opening.frameMaterial = preset.frameMaterial || 'aluminum';
    opening.frameColor = preset.frameColor || 'anthracite';
  }
  opening.sill = opening.kind === 'door' ? 0 : preset.sill;
  return opening;
}

// Смена типа: панорамное окно — почти от пола, обычное — подоконник 900;
// двустворчатой двери нужна ширина от 1200. levelHeight — высота этажа.
export function presetWithType(kind, preset, type, levelHeight = 3000) {
  const next = { ...preset, type };
  if (kind === 'window') {
    const top = levelHeight - 400;
    if (isGlazedAssembly(next)) {
      next.sill = 0;
      next.height = Math.min(2300, top);
      next.heightMode = 'custom';
      next.width = Math.max(type.endsWith('sliding') ? 1800 : type.startsWith('balcony-') ? 1600 : 900, next.width);
      next.assembly = {};
    } else if (HIGH_WINDOW_TYPES.has(type)) {
      next.sill = type === 'french' ? 50 : 100;
      next.height = Math.min(DEFAULT_TALL_WINDOW_HEIGHT, top - next.sill);
      next.heightMode = 'level';
    } else {
      next.sill = type === 'clerestory' ? 1700 : 900;
      next.height = type === 'clerestory' ? 600 : Math.min(1500, top - 900);
      next.heightMode = 'custom';
    }
  } else if (type === 'double' && next.width < 1200) {
    next.width = 1200;
  }
  return next;
}

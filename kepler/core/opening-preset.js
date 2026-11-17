// Параметры двери/окна, заданные ДО вставки (панель «Свойства» при активном
// инструменте): тип, ширина, высота, подоконник. Чистый модуль без DOM.

import { DOOR_WIDTH, WINDOW_WIDTH } from './catalog.js';

export function defaultOpeningPreset(kind) {
  return kind === 'door'
    ? { type: 'single', width: DOOR_WIDTH, height: 2100, sill: 0 }
    : { type: 'standard', width: WINDOW_WIDTH, height: 1500, sill: 900 };
}

// Параметры из заготовки накладываются на новый проём (до подгонки по стене).
export function applyOpeningPreset(opening, preset) {
  if (!preset) return opening;
  opening.type = preset.type;
  opening.width = preset.width;
  opening.height = preset.height;
  opening.sill = opening.kind === 'door' ? 0 : preset.sill;
  return opening;
}

// Смена типа: панорамное окно — почти от пола, обычное — подоконник 900;
// двустворчатой двери нужна ширина от 1200. levelHeight — высота этажа.
export function presetWithType(kind, preset, type, levelHeight = 3000) {
  const next = { ...preset, type };
  if (kind === 'window') {
    const top = levelHeight - 400;
    if (type === 'panoramic') { next.sill = 100; next.height = Math.min(2400, top - 100); }
    else { next.sill = 900; next.height = Math.min(1500, top - 900); }
  } else if (type === 'double' && next.width < 1200) {
    next.width = 1200;
  }
  return next;
}

// Стиль графики ландшафта: «Эскиз» (акварель + графика) или «Чертёж»
// (монохром для печати). Выбор хранится в браузере (localStorage); лист
// генплана по умолчанию — «Чертёж», либо «как на экране».

import { state } from './state.js';

const KEY = 'kepler-ls-style';
const SHEET_KEY = 'kepler-ls-sheet-style';

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* нет доступа — только на сессию */ }
}

export function loadLandscapeStyle() {
  state.lsStyle = read(KEY) === 'drawing' ? 'drawing' : 'sketch';
  return state.lsStyle;
}

export function setLandscapeStyle(style) {
  state.lsStyle = style === 'drawing' ? 'drawing' : 'sketch';
  write(KEY, state.lsStyle);
  return state.lsStyle;
}

// Лист генплана: 'drawing' (по умолчанию) или 'screen' — как на экране.
export function sheetStylePref() {
  return read(SHEET_KEY) === 'screen' ? 'screen' : 'drawing';
}
export function setSheetStylePref(pref) {
  write(SHEET_KEY, pref === 'screen' ? 'screen' : 'drawing');
}
export function sheetLandscapeStyle() {
  return sheetStylePref() === 'screen' ? (state.lsStyle || 'sketch') : 'drawing';
}

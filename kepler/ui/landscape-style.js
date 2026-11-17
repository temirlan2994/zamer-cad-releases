// Стиль графики ландшафта: «Эскиз» (акварель + графика) или «Чертёж»
// (монохром для печати). Выбор хранится в браузере (localStorage); лист
// генплана по умолчанию — «Чертёж», либо «как на экране».

import { state } from './state.js';
import { clearLandscapeSprites } from './render-landscape-kit.js';

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
  const next = style === 'drawing' ? 'drawing' : 'sketch';
  // Спрайты прежнего стиля больше не нужны — освободить память.
  if (state.lsStyle && state.lsStyle !== next) clearLandscapeSprites();
  state.lsStyle = next;
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

// Разрезы на листе: { on, off: [id исключённых] } — по умолчанию все.
const SEC_KEY = 'kepler-ls-sheet-sections';
export function sheetSectionsPref() {
  try {
    const v = JSON.parse(read(SEC_KEY) || 'null');
    return { on: v?.on !== false, off: Array.isArray(v?.off) ? v.off.filter((id) => typeof id === 'string') : [] };
  } catch { return { on: true, off: [] }; }
}
export function setSheetSectionsPref(pref) {
  write(SEC_KEY, JSON.stringify({ on: pref.on !== false, off: [...new Set(pref.off || [])] }));
}

// Тени ландшафта (ui/landscape-sun.js): режим 'off' | 'default' (условные,
// как раньше) | 'sun' (по солнцу), дата 'YYYY-MM-DD', время (мин от полуночи),
// анализ освещённости. Только вид — в браузере, не в проекте.
const SUN_KEY = 'kepler-ls-sun';
export const SUN_MODES = ['off', 'default', 'sun'];
export const SUN_TIME_MIN = 5 * 60;
export const SUN_TIME_MAX = 21 * 60;
export function defaultLandscapeSun() {
  return { mode: 'default', date: `${new Date().getFullYear()}-06-21`, time: 15 * 60, analysis: false };
}
export function loadLandscapeSun() {
  const d = defaultLandscapeSun();
  let v;
  try { v = JSON.parse(read(SUN_KEY) || 'null'); } catch { v = null; }
  const t = Math.round(Number(v?.time) / 15) * 15;
  state.lsSun = {
    mode: SUN_MODES.includes(v?.mode) ? v.mode : d.mode,
    date: /^\d{4}-\d{2}-\d{2}$/.test(v?.date || '') ? v.date : d.date,
    time: Number.isFinite(t) ? Math.min(SUN_TIME_MAX, Math.max(SUN_TIME_MIN, t)) : d.time,
    analysis: v?.analysis === true,
  };
  return state.lsSun;
}
export function setLandscapeSun(patch) {
  state.lsSun = { ...(state.lsSun || defaultLandscapeSun()), ...patch };
  const { mode, date, time, analysis } = state.lsSun;
  write(SUN_KEY, JSON.stringify({ mode, date, time, analysis }));
  return state.lsSun;
}

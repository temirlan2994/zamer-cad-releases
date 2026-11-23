// UI двух световых оценок: прямое солнце и предварительные КЕО/люксы.
// Расчёты и кэш живут в core/daylight-analysis.js и ui/render-solar.js.

import { el, escapeHtml } from './dom.js';
import {
  bindLightAnalysisRedraw,
  cancelPendingLightAnalysis,
  currentDaylightAnalysis as cachedDaylight,
  currentSolarAnalysis as cachedDirect,
  levelLightAnalysisProgress,
  prepareLevelLightAnalysis,
} from './render-solar.js';
import { state } from './state.js';

const MODES = new Set(['direct', 'daylight']);
let uiChange = null;
let progressChange = null;
let legendKey = '';

function pref() {
  if (!state.solarAnalysis || typeof state.solarAnalysis !== 'object') {
    state.solarAnalysis = {
      on: false, roomId: null, mode: 'direct', scope: 'room', levelId: null,
    };
  }
  if (!MODES.has(state.solarAnalysis.mode)) state.solarAnalysis.mode = 'direct';
  return state.solarAnalysis;
}

function selectedRoomId() {
  if (state.selection?.type === 'room') return state.selection.id;
  if (state.selection?.type === 'opening') {
    return state.project?.openings?.find((o) => o.id === state.selection.id)?.roomId || null;
  }
  return null;
}

function notify(local = null) { (uiChange || local)?.(); }
const num = (value, digits = 1) => Number.isFinite(Number(value))
  ? Number(value).toFixed(digits).replace('.', ',') : '—';
function statusDirect(a) {
  if (!a?.available) return { text: 'Недостаточно данных', cls: 'unknown' };
  if (a.verified) return { text: 'Координаты и север подтверждены', cls: 'ok' };
  return { text: 'Ориентировочно: проверьте координаты и север', cls: 'estimated' };
}

function statusDaylight(a) {
  if (!a) return { text: 'Недостаточно данных', cls: 'unknown' };
  const medium = a.confidence?.level === 'medium';
  return {
    text: `Предварительно · ${medium ? 'средняя' : 'низкая'} уверенность`,
    cls: medium ? 'estimated' : 'unknown',
  };
}

function activeAnalysis(roomId) {
  return pref().mode === 'daylight' ? cachedDaylight(roomId) : cachedDirect(roomId);
}

function syncLegend(a = null) {
  const box = el('solarLegend');
  if (!box) return;
  const p = pref();
  if (!p.on) { box.hidden = true; legendKey = 'off'; return; }
  box.hidden = false;
  const level = p.scope === 'level'
    ? state.project?.levels?.find((item) => item.id === p.levelId) : null;
  const levelRooms = level?.rooms?.filter((room) => room.type !== 'shaft') || [];
  const progress = p.scope === 'level'
    ? levelLightAnalysisProgress(p.levelId, p.mode) : null;
  const key = `${p.scope || 'room'}|${p.levelId || ''}|${p.mode}|${a?.key || 'none'}|${levelRooms.length}`
    + `|${progress?.ready ?? ''}|${progress?.pending ?? ''}`;
  if (legendKey === key) return;
  legendKey = key;
  if (p.scope === 'level') {
    const levelLabel = level?.name || 'Этаж';
    const countLabel = `${levelRooms.length} ${levelRooms.length === 1 ? 'помещение' : 'помещений'}`;
    const progressLabel = progress.total > 0 && progress.ready < progress.total
      ? `Расчёт ${progress.ready}/${progress.total}`
      : `Готово · ${countLabel}`;
    if (p.mode === 'daylight') {
      box.className = 'solar-legend daylight estimated';
      box.innerHTML = `<span class="solar-legend-title">Освещённость · все помещения</span>
        <span class="solar-legend-scale daylight" aria-hidden="true"></span>
        <span class="solar-legend-tick">0</span><span class="solar-legend-tick">100</span>
        <span class="solar-legend-tick">300</span><span class="solar-legend-tick">500+ лк</span>
        <span class="solar-legend-note">${escapeHtml(levelLabel)} · ${escapeHtml(progressLabel)} · предварительно</span>`;
      box.setAttribute('aria-label', `Освещённость всех помещений этажа ${levelLabel}: ${progressLabel}; шкала 0, 100, 300, 500 и более люкс`);
    } else {
      box.className = 'solar-legend estimated';
      box.innerHTML = `<span class="solar-legend-title">Прямое солнце · все помещения</span>
        <span class="solar-legend-scale" aria-hidden="true"></span>
        <span class="solar-legend-tick">0</span><span class="solar-legend-tick">2</span>
        <span class="solar-legend-tick">4</span><span class="solar-legend-tick">6+ ч</span>
        <span class="solar-legend-note">${escapeHtml(levelLabel)} · ${escapeHtml(progressLabel)}</span>`;
      box.setAttribute('aria-label', `Прямое солнце во всех помещениях этажа ${levelLabel}: ${progressLabel}; шкала от 0 до 6 и более часов`);
    }
    return;
  }
  if (!a) {
    box.className = 'solar-legend unknown';
    box.innerHTML = '<span class="solar-legend-title">Выберите помещение</span>';
    box.setAttribute('aria-label', 'Световой анализ: выберите помещение');
    return;
  }
  if (p.mode === 'daylight') {
    box.className = `solar-legend daylight ${statusDaylight(a).cls}`;
    box.innerHTML = `<span class="solar-legend-title">Освещённость · пасмурное небо</span>
      <span class="solar-legend-scale daylight" aria-hidden="true"></span>
      <span class="solar-legend-tick">0</span><span class="solar-legend-tick">100</span>
      <span class="solar-legend-tick">300</span><span class="solar-legend-tick">500+ лк</span>
      <span class="solar-legend-note">Среднее ${num(a.meanLux, 0)} лк · предварительно</span>`;
    box.setAttribute('aria-label', `Предварительная освещённость: шкала 0, 100, 300, 500 и более люкс; среднее ${num(a.meanLux, 0)} люкс`);
    return;
  }
  const s = statusDirect(a);
  box.className = `solar-legend ${s.cls}`;
  if (!a.available) {
    box.innerHTML = `<span class="solar-legend-title">Прямое солнце</span><span class="solar-legend-note">${s.text}</span>`;
    box.setAttribute('aria-label', `Прямое солнце: ${s.text}`);
    return;
  }
  box.innerHTML = `<span class="solar-legend-title">Прямое солнце</span>
    <span class="solar-legend-scale" aria-hidden="true"></span>
    <span class="solar-legend-tick">0</span><span class="solar-legend-tick">2</span>
    <span class="solar-legend-tick">4</span><span class="solar-legend-tick">6+ ч</span>
    ${a.estimated ? '<span class="solar-legend-note">Ориентировочно</span>' : ''}`;
  box.setAttribute('aria-label', `Прямое солнце: шкала от 0 до 6 и более часов; ${s.text}`);
}

function applyState(on, roomId, local = null) {
  const p = pref();
  const nextId = roomId === undefined ? (p.roomId || selectedRoomId()) : (roomId || null);
  const changed = p.on !== Boolean(on) || p.roomId !== nextId;
  p.on = Boolean(on); p.roomId = nextId;
  if (!p.on) cancelPendingLightAnalysis();
  const keepLevelScope = p.scope === 'level'
    && state.analyticalView?.analysis === 'light'
    && state.analyticalView.levelId === state.project?.activeLevel;
  if (p.on && !keepLevelScope) { p.scope = 'room'; p.levelId = null; }
  syncLegend(p.on ? activeAnalysis(nextId) : null);
  if (changed) notify(local);
  return p;
}

export const setSolarAnalysis = (on, roomId) => applyState(on, roomId);

export function setSolarLevelAnalysis(levelId, mode = 'daylight', local = null) {
  const p = pref();
  if (!MODES.has(mode)) mode = 'daylight';
  const changed = !p.on || p.scope !== 'level' || p.levelId !== levelId || p.mode !== mode;
  p.on = true;
  p.scope = 'level';
  p.levelId = levelId || null;
  p.roomId = null;
  p.mode = mode;
  syncLegend(null);
  // Вид этажа сам запускает все помещения; выбирать их по одному не нужно.
  // Расчёт идёт короткими фоновыми задачами и перерисовывает готовые карты.
  void prepareLevelLightAnalysis(p.levelId, p.mode);
  if (changed) notify(local);
  return p;
}

export function setSolarMode(mode, local = null) {
  const p = pref();
  if (!MODES.has(mode) || p.mode === mode) return p;
  p.mode = mode;
  syncLegend(p.on ? activeAnalysis(p.roomId || selectedRoomId()) : null);
  if (p.on && p.scope === 'level' && p.levelId) void prepareLevelLightAnalysis(p.levelId, p.mode);
  notify(local);
  return p;
}

export function refreshSolarLevelAnalysis(local = null) {
  const p = pref();
  if (!p.on || p.scope !== 'level' || !p.levelId) return p;
  void prepareLevelLightAnalysis(p.levelId, p.mode);
  syncLegend(null);
  notify(local);
  return p;
}

export function focusSolarRoom(roomId) {
  const p = pref();
  if (p.roomId !== (roomId || null)) {
    p.roomId = roomId || null;
    syncLegend(p.on ? activeAnalysis(p.roomId) : null);
  }
  return p;
}

export function currentSolarAnalysis(roomId = pref().roomId || selectedRoomId()) {
  const a = cachedDirect(roomId);
  if (pref().mode === 'direct') syncLegend(a);
  return a;
}

export function currentDaylightAnalysis(roomId = pref().roomId || selectedRoomId()) {
  const a = cachedDaylight(roomId);
  if (pref().mode === 'daylight') syncLegend(a);
  return a;
}

export function bindSolarAnalysis(onChange, onProgress = onChange) {
  uiChange = typeof onChange === 'function' ? onChange : null;
  progressChange = typeof onProgress === 'function' ? onProgress : null;
  bindLightAnalysisRedraw(() => {
    syncLegend(null);
    // Готовность очередной комнаты меняет только canvas и легенду. Полную
    // панель свойств нельзя пересоздавать N раз: пользователь терял фокус
    // поля после каждого фонового результата.
    progressChange?.();
  });
  syncLegend(pref().on ? activeAnalysis(pref().roomId || selectedRoomId()) : null);
}

// Ссылки из инспектора открывают общий раздел, сохраняя контекст комнаты.
export function openClimatePanel(opener, { room, location = false } = {}) {
  if (room) {
    state._homeClimateUI = { ...state._homeClimateUI, roomKey: `${state.project.activeLevel}:${room.id}` };
  }
  document.dispatchEvent(new CustomEvent('kepler:open-climate', { detail: { opener, location } }));
}

export function solarAnalysisHtml(room) {
  return room ? '<div class="prop-actions"><button type="button" data-open-climate>☀ Свет в помещении →</button></div>' : '';
}

export function bindSolarAnalysisPanel(panel, room) {
  panel.querySelector('[data-open-climate]')?.addEventListener('click', (event) => {
    openClimatePanel(event.currentTarget, { room });
  });
}

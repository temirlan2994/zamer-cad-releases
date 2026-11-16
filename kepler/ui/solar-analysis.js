// UI двух световых оценок: прямое солнце и предварительные КЕО/люксы.
// Расчёты и кэш живут в core/daylight-analysis.js и ui/render-solar.js.

import { el, escapeHtml } from './dom.js';
import {
  currentDaylightAnalysis as cachedDaylight,
  currentSolarAnalysis as cachedDirect,
} from './render-solar.js';
import { openSolarReport } from './solar-report-ui.js';
import { state } from './state.js';

const MODES = new Set(['direct', 'daylight']);
let uiChange = null;
let legendKey = '';

function pref() {
  if (!state.solarAnalysis || typeof state.solarAnalysis !== 'object') {
    state.solarAnalysis = { on: false, roomId: null, mode: 'direct' };
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
const pct = (value, digits = 0) => Number.isFinite(Number(value)) ? `${num(Number(value) * 100, digits)}%` : '—';

function minutes(value) {
  if (!Number.isFinite(value)) return '—';
  const m = Math.max(0, Math.round(value));
  const h = Math.floor(m / 60); const rest = m % 60;
  return h ? `${h} ч${rest ? ` ${rest} мин` : ''}` : `${rest} мин`;
}

function dateRu(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
}

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

function syncButton() {
  const b = el('sunAnalysisBtn');
  if (!b) return;
  const p = pref();
  b.classList.toggle('active', Boolean(p.on));
  b.setAttribute('aria-pressed', String(Boolean(p.on)));
  b.setAttribute('aria-label', p.mode === 'daylight' ? 'Карта освещённости' : 'Карта прямого солнца');
}

function syncLegend(a = null) {
  const box = el('solarLegend');
  if (!box) return;
  const p = pref();
  if (!p.on) { box.hidden = true; legendKey = 'off'; return; }
  box.hidden = false;
  const key = a ? `${p.mode}|${a.key}` : `${p.mode}|none`;
  if (legendKey === key) return;
  legendKey = key;
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
  syncButton(); syncLegend(p.on ? activeAnalysis(nextId) : null);
  if (changed) notify(local);
  return p;
}

export const setSolarAnalysis = (on, roomId) => applyState(on, roomId);

export function setSolarMode(mode, local = null) {
  const p = pref();
  if (!MODES.has(mode) || p.mode === mode) return p;
  p.mode = mode;
  syncButton(); syncLegend(p.on ? activeAnalysis(p.roomId || selectedRoomId()) : null);
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

export function bindSolarAnalysis(onChange) {
  uiChange = typeof onChange === 'function' ? onChange : null;
  const b = el('sunAnalysisBtn');
  if (b && b.dataset.solarBound !== 'true') {
    b.dataset.solarBound = 'true';
    b.addEventListener('click', () => applyState(!pref().on, selectedRoomId() || pref().roomId));
  }
  syncButton();
  syncLegend(pref().on ? activeAnalysis(pref().roomId || selectedRoomId()) : null);
}

function tabs(prefix) {
  const mode = pref().mode;
  return `<div class="seg solar-analysis-tabs" role="tablist" aria-label="Вид светового анализа">
    <button type="button" class="seg-opt${mode === 'direct' ? ' active' : ''}" id="${prefix}DirectTab" role="tab"
      tabindex="${mode === 'direct' ? '0' : '-1'}" aria-selected="${mode === 'direct'}" aria-controls="${prefix}DirectPanel" data-solar-mode="direct">Прямое солнце</button>
    <button type="button" class="seg-opt${mode === 'daylight' ? ' active' : ''}" id="${prefix}DaylightTab" role="tab"
      tabindex="${mode === 'daylight' ? '0' : '-1'}" aria-selected="${mode === 'daylight'}" aria-controls="${prefix}DaylightPanel" data-solar-mode="daylight">КЕО и люксы</button>
  </div>`;
}

function glazing(a) {
  if (!a?.glazing?.ratio) return 'нет окон';
  return `${num(a.glazing.area, 2)} м² · 1:${num(1 / a.glazing.ratio, 1)}`;
}

function directPanel(a, prefix) {
  const s = statusDirect(a); const ok = Boolean(a?.available);
  return `<section role="tabpanel" id="${prefix}DirectPanel" aria-labelledby="${prefix}DirectTab" data-solar-panel="direct">
    <div class="solar-analysis-status ${s.cls}" data-solar-status="${s.cls}">${s.text}</div>
    <label class="prop-field"><span>Расчётный день</span><input id="solarAnalysisDate" type="date" value="${escapeHtml(a?.date || '')}"></label>
    <div class="prop-row"><span>Максимум в комнате</span><strong data-solar-metric="max">${ok ? minutes(a.maxMinutes) : '—'}</strong></div>
    <div class="prop-row"><span>В среднем по площади</span><strong data-solar-metric="mean">${ok ? minutes(a.meanMinutes) : '—'}</strong></div>
    <div class="prop-row"><span>Солнце попадает</span><strong data-solar-metric="lit">${ok ? pct(a.litShare) : '—'}</strong></div>
    <div class="prop-row"><span>Не менее 2 ч</span><strong data-solar-metric="coverage-2h">${ok ? pct(a.coverage2h) : '—'}</strong></div>
    <div class="prop-row"><span>Остекление</span><strong class="${a?.glazing?.meets ? 'ok' : 'bad'}" data-solar-metric="glazing">${glazing(a)}</strong></div>
    <p class="hint">${ok ? `Расчёт на ${dateRu(a.date)}, рабочая плоскость ${Math.round(a.workplane)} мм.` : 'Укажите координаты участка и север.'} Карта комнаты и сезонная сводка учитывают здания, крыши, массы, навесы и кроны как непрозрачные приближения. Пересекающая сплошную массу вычитающая масса вырезает отверстие в пределах своего 3D-объёма и сама тени не даёт.</p>
    <p class="hint"><b>«Фасад · N ч»</b> — старая нормативная метка: длительность видимости солнца через окно. Размер окна её не меняет; эскизные крыши, массы и ландшафт в неё не входят. Зелёный — жилая норма выполнена, красный — нет, серый — справочно для нежилого.</p>
  </section>`;
}

function daylightPanel(a, prefix) {
  const s = statusDaylight(a); const as = a?.assumptions || {};
  const transmission = Number(as.transmission?.defaultGlass ?? as.transmittance ?? pref().transmittance ?? 0.7);
  const recs = (a?.recommendations || []).map((r) => `<li>${escapeHtml(r.text)}</li>`).join('');
  const reasons = (a?.confidence?.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  return `<section role="tabpanel" id="${prefix}DaylightPanel" aria-labelledby="${prefix}DaylightTab" data-solar-panel="daylight">
    <div class="solar-analysis-status ${s.cls}" data-daylight-status="${s.cls}">${s.text}</div>
    <label class="prop-field"><span>Светопропускание стекла, %</span><input id="daylightTransmittance" type="number" min="10" max="100" step="5" value="${Math.round(transmission * 100)}"></label>
    <div class="prop-row"><span>Средний КЕО (DF)</span><strong data-daylight-metric="df-mean">${a ? `${num(a.meanDaylightFactor, 2)}%` : '—'}</strong></div>
    <div class="prop-row"><span>Минимальный КЕО (DF)</span><strong data-daylight-metric="df-min">${a ? `${num(a.minDaylightFactor, 2)}%` : '—'}</strong></div>
    <div class="prop-row"><span>Средняя освещённость</span><strong data-daylight-metric="lux-mean">${a ? `${num(a.meanLux, 0)} лк` : '—'}</strong></div>
    <div class="prop-row"><span>Площадь ≥ ${num(a?.thresholds?.daylightFactor ?? 2, 1)}% КЕО</span><strong data-daylight-metric="coverage-df">${a ? pct(a.coverageDaylightFactor) : '—'}</strong></div>
    <div class="prop-row"><span>Площадь ≥ 300 лк</span><strong data-daylight-metric="coverage-300">${a ? pct(a.coverage300) : '—'}</strong></div>
    <div class="prop-row"><span>Видимость неба через окно</span><strong data-daylight-metric="window-sky">${a ? pct(a.meanWindowSkyVisibility) : '—'}</strong></div>
    <details><summary>Допущения и точность</summary><p class="hint">Пасмурное небо CIE · ${num(a?.externalLux ?? 10000, 0)} лк снаружи · плоскость ${Math.round(a?.workplane ?? 800)} мм. Кроны и навесы консервативно непрозрачны круглый год.</p>${reasons ? `<ul>${reasons}</ul>` : ''}</details>
    ${recs ? `<ul class="solar-analysis-recommendations">${recs}</ul>` : ''}
    <p class="hint"><b>Предварительная оценка, не нормативный расчёт и не экспертиза.</b> Размер окна меняет КЕО, люксы и освещённую площадь, но не «Фасад · N ч».</p>
  </section>`;
}

export function solarAnalysisHtml(room) {
  if (!room) return '';
  const p = pref(); const a = activeAnalysis(room.id);
  if (!a) return '';
  return `<h3>Световой анализ</h3><div class="prop-block solar-analysis-panel" id="solarAnalysisPanel">
    ${tabs('solar')}
    <label class="check-row"><input type="checkbox" id="solarAnalysisOn" ${p.on && p.roomId === room.id ? 'checked' : ''}><span>${p.mode === 'daylight' ? 'Карта освещённости' : 'Карта прямого солнца'}</span></label>
    ${p.mode === 'daylight' ? daylightPanel(a, 'solar') : directPanel(a, 'solar')}
    <button type="button" id="solarAnnualRun" data-solar-report-open>Сезонная световая сводка…</button>
  </div>`;
}

function bindTabs(panel, rerender) {
  const buttons = [...panel.querySelectorAll('[data-solar-mode]')];
  const activate = (button) => {
    const focusId = button.id;
    setSolarMode(button.dataset.solarMode, rerender);
    requestAnimationFrame(() => el(focusId)?.focus());
  };
  buttons.forEach((button) => {
    button.addEventListener('click', () => activate(button));
    button.addEventListener('keydown', (event) => {
      let index = buttons.indexOf(button);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else return;
      event.preventDefault();
      activate(buttons[index]);
    });
  });
  panel.querySelector('[data-solar-report-open]')?.addEventListener('click', () => openSolarReport());
}

export function bindSolarAnalysisPanel(panel, room, rerender) {
  if (!panel || !room) return;
  bindTabs(panel, rerender);
  panel.querySelector('#solarAnalysisOn')?.addEventListener('change', (e) => applyState(e.target.checked, room.id, rerender));
  panel.querySelector('#solarAnalysisDate')?.addEventListener('change', (e) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { pref().date = e.target.value; notify(rerender); }
  });
  panel.querySelector('#daylightTransmittance')?.addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (Number.isFinite(v)) { pref().transmittance = Math.max(0.1, Math.min(1, v / 100)); notify(rerender); }
  });
}

function focusedRoom() {
  const id = pref().roomId || selectedRoomId();
  return id ? state.project?.rooms?.find((r) => r.id === id) || null : null;
}

export function solarViewBlock() {
  const p = pref(); const room = focusedRoom();
  const date = p.date || state.project?.site?.sun?.date || '2026-06-21';
  return `<h3>Световой анализ</h3><div class="prop-block solar-analysis-panel" id="viewsSolar">
    ${tabs('viewsSolar')}
    <label class="check-row"><input type="checkbox" id="viewsSolarOn" ${p.on ? 'checked' : ''}><span>${p.mode === 'daylight' ? 'Карта освещённости' : 'Карта прямого солнца'}</span></label>
    ${p.mode === 'direct' ? `<label class="prop-field"><span>Расчётный день</span><input id="viewsSolarDate" type="date" value="${escapeHtml(date)}"></label>` : ''}
    ${room ? `<div class="prop-row"><span>Помещение</span><strong>${escapeHtml(room.name || 'Без названия')}</strong></div>` : '<p class="hint">Выберите помещение для карты.</p>'}
    <p class="hint">${p.mode === 'daylight' ? 'Пасмурное небо; предварительно, не экспертиза.' : '«Фасад · N ч»: зелёный — жилая норма выполнена, красный — нет, серый — справочно; размер окна длительность не меняет.'}</p>
    <button type="button" id="solarAnnualRun" data-solar-report-open>Сезонная световая сводка…</button>
  </div>`;
}

export function bindSolarViewBlock(panel, rerender) {
  if (!panel) return;
  bindTabs(panel, rerender);
  panel.querySelector('#viewsSolarOn')?.addEventListener('change', (e) => applyState(e.target.checked, selectedRoomId() || pref().roomId, rerender));
  panel.querySelector('#viewsSolarDate')?.addEventListener('change', (e) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { pref().date = e.target.value; notify(rerender); }
  });
}

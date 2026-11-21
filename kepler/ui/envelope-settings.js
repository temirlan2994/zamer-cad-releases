// Компактный центр автоматических систем дома. Параметры хранятся в
// project.envelope, а геометрия всегда выводится из актуального плана.

import {
  MAX_FOUNDATION_DEPTH, MAX_ZERO_ABOVE_GROUND, MIN_ZERO_ABOVE_GROUND,
  envelopeOf, resolvedZeroAboveGround,
} from '../core/envelope.js';
import { activeLevel } from '../core/model.js';
import { houseTerrain } from '../core/terrain.js';
import { deriveEnvelopeStatus } from '../core/envelope-status.js';
import { analyzeEarthworks } from '../core/earthworks.js';
import { escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';

const meters = (millimeters) => (millimeters / 1000).toFixed(2);
const inputNumber = (value) => String(value).trim().replace(',', '.');
let activeSystem = null;

const ICONS = { datum: '±', foundation: '▰', roof: '⌂', drainage: '↘', entrance: '↗', slabs: '═', earthworks: '≋' };
const LABELS = { datum: 'Ноль', foundation: 'Основа', roof: 'Крыша', drainage: 'Вода', entrance: 'Вход', slabs: 'Плиты', earthworks: 'Земля' };
const MARK = { ready: '✓', attention: '!', conflict: '×', pending: '?' };

function datumInfo(project = state.project) {
  const hasTerrain = Boolean(project.site?.terrain?.points?.length >= 3);
  let house = null;
  if (hasTerrain) {
    try { house = houseTerrain(project); } catch { /* повреждённая съёмка не должна уронить панель */ }
  }
  return { house, zero: resolvedZeroAboveGround(project, house) };
}

function systemStatuses(project, envelope, info) {
  const rooms = (project.levels || []).reduce((sum, level) => sum + (level.rooms?.length || 0), 0);
  const doors = (project.levels || []).reduce((sum, level) => sum + (level.openings || []).filter((o) => o.kind === 'door').length, 0);
  const pending = info.zero == null;
  const absolute = info.house && info.zero != null ? info.house.groundReferenceZ + info.zero : null;
  const groundAbove = pending ? 0 : Math.max(0, info.house && absolute != null ? info.house.max - absolute : -info.zero);
  const core = deriveEnvelopeStatus(project);
  const status = (value) => ({ checked: 'ready', blocked: 'conflict', attention: 'attention', unknown: 'pending' })[value] || 'pending';
  return {
    datum: groundAbove > 20 ? 'conflict' : status(core.datum),
    foundation: status(core.foundation),
    roof: status(core.roof),
    drainage: status(core.drainage),
    entrance: doors ? status(core.entrance) : (rooms ? 'attention' : 'pending'),
    slabs: rooms && envelope.slabs.enabled ? 'ready' : (rooms ? 'attention' : 'pending'),
    earthworks: project.site?.terrain?.points?.length >= 3 && !pending ? 'ready' : 'pending',
  };
}

function earthworksResult(project, envelope, info) {
  if (!project.site?.terrain?.points?.length) return null;
  const mode = envelope.earthworks.mode;
  const grade = { mode };
  if (mode === 'relative') grade.zMm = -(info.zero ?? 0) + envelope.earthworks.gradeOffset;
  if (mode === 'absolute') grade.zMm = (info.house?.groundReferenceZ ?? 0) + envelope.earthworks.gradeOffset;
  try {
    return analyzeEarthworks(project, { boundary: 'work-pad', marginMm: envelope.earthworks.margin, grade });
  } catch { return null; }
}

function statusBar(statuses) {
  return `<nav class="envelope-status" data-envelope-status-bar aria-label="Автоматические системы дома">
    ${Object.keys(LABELS).map((id) => {
    const status = statuses[id];
    const result = status === 'ready' ? 'готово' : status === 'conflict' ? 'конфликт' : status === 'attention' ? 'проверьте' : 'нужно задать';
    const title = `${LABELS[id]}: ${result}`;
    return `<button type="button" data-envelope-tab="${id}" data-envelope-status="${id}" data-status="${status}"
      aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}" aria-expanded="${activeSystem === id}">
      <span aria-hidden="true">${ICONS[id]}</span><b>${escapeHtml(LABELS[id])}</b><i aria-hidden="true">${MARK[status]}</i></button>`;
  }).join('')}
  </nav>`;
}

const roofTypes = [['flat', 'Плоская', '▱'], ['shed', 'Односкатная', '◩'], ['gable', 'Двускатная', '⌃'], ['hip', 'Вальмовая', '◇']];
const foundationTypes = [['slab', 'Плита'], ['strip', 'Лента'], ['piles', 'Сваи'], ['basement', 'Подвал']];

function panel(id, title, body) {
  return `<section class="envelope-system" data-envelope-panel="${id}" ${activeSystem === id ? '' : 'hidden'}>
    <header><strong>${ICONS[id]} ${escapeHtml(title)}</strong><button type="button" data-envelope-close aria-label="Свернуть">×</button></header>${body}</section>`;
}

function foundationFields(foundation) {
  if (foundation.type === 'strip') return `<div class="prop-grid">
    <label class="prop-field"><span>Ширина, м</span><input id="foundationStripWidth" type="number" step="0.05" min="0.2" max="2" value="${meters(foundation.stripWidth)}"></label>
    <label class="prop-field"><span>Высота, м</span><input id="foundationStripHeight" type="number" step="0.05" min="0.2" max="2" value="${meters(foundation.stripHeight)}"></label></div>`;
  if (foundation.type === 'piles') return `<div class="prop-grid">
    <label class="prop-field"><span>Диаметр, м</span><input id="foundationPileDiameter" type="number" step="0.05" min="0.15" max="1.2" value="${meters(foundation.pileDiameter)}"></label>
    <label class="prop-field"><span>Шаг до, м</span><input id="foundationPileSpacing" type="number" step="0.1" min="0.8" max="6" value="${meters(foundation.pileSpacing)}"></label>
    <label class="prop-field"><span>Длина, м</span><input id="foundationPileLength" type="number" step="0.1" min="0.5" max="12" value="${meters(foundation.pileLength)}"></label>
    <label class="prop-field"><span>Ростверк, м</span><input id="foundationGrillageWidth" type="number" step="0.05" min="0.2" max="2" value="${meters(foundation.grillageWidth)}"></label></div>`;
  if (foundation.type === 'basement') return `<div class="prop-grid">
    <label class="prop-field"><span>Плита, м</span><input id="foundationBasementSlab" type="number" step="0.05" min="0.15" max="1" value="${meters(foundation.basementSlabThickness)}"></label>
    <label class="prop-field"><span>Стена, м</span><input id="foundationRetainingWall" type="number" step="0.05" min="0.15" max="1" value="${meters(foundation.retainingWallThickness)}"></label></div>`;
  return `<label class="prop-field"><span>Толщина плиты, м</span><input id="foundationSlabThickness" type="number" step="0.05" min="0.1" max="1.5" value="${meters(foundation.slabThickness)}"></label>`;
}

export function envelopeSettingsHtml(project = state.project) {
  const envelope = envelopeOf(project);
  const info = datumInfo(project);
  const level = activeLevel(project);
  const statuses = systemStatuses(project, envelope, info);
  const earthworks = earthworksResult(project, envelope, info);
  if (earthworks?.status === 'candidate') statuses.earthworks = 'ready';
  else if (earthworks?.status === 'partial') statuses.earthworks = 'attention';
  else if (earthworks?.status === 'conflict') statuses.earthworks = 'conflict';
  const pending = info.zero == null;
  const grade = pending ? null : -info.zero;
  const absolute = info.house && info.zero != null ? info.house.groundReferenceZ + info.zero : null;
  const groundAbove = pending ? 0 : Math.max(0, info.house && absolute != null ? info.house.max - absolute : grade);
  const conflict = groundAbove > 20;
  if (!activeSystem) activeSystem = pending ? 'datum' : null;
  const title = pending ? 'Укажите ±0.000' : (conflict ? 'Посадка конфликтует с землёй' : 'Дом собирается автоматически');
  const cardStatus = pending ? 'pending' : (conflict ? 'conflict' : 'ready');
  const route = pending ? 'Сначала задайте высоту пола над землёй.' : `Земля ${meters(grade)} м → пол ±0.000${absolute == null ? '' : ` · абс. ${meters(absolute)} м`}`;
  return `<section class="envelope-card" data-status="${cardStatus}" aria-labelledby="envelopeTitle">
    <header><span class="envelope-icon" aria-hidden="true">⌂</span><div><strong id="envelopeTitle">${escapeHtml(title)}</strong><small>${escapeHtml(route)}</small></div><b>АВТО</b></header>
    ${statusBar(statuses)}
    ${panel('datum', 'Проектный ноль', `<label class="prop-field envelope-zero"><span>Пол ±0.000 над землёй, м</span>
      <input id="buildingZeroAboveGround" type="text" inputmode="decimal" placeholder="например 1,00" value="${info.zero == null ? '' : meters(info.zero)}" ${pending ? 'aria-invalid="true"' : ''} required></label>
      <p class="envelope-flow">Фиксирует дом по высоте. Рельеф и пятно можно менять — ноль не «прыгает».</p>`)}
    ${panel('foundation', 'Основание', `<label class="check-row"><input id="foundationEnabled" type="checkbox" ${envelope.foundation.enabled ? 'checked' : ''}><span>Создавать автоматически</span></label>
      <div class="envelope-choice">${foundationTypes.map(([id, label]) => `<button type="button" data-foundation-type="${id}" class="${envelope.foundation.type === id ? 'active' : ''}">${label}</button>`).join('')}</div>
      <label class="prop-field"><span>Заглубление от земли, м</span><input id="foundationDepth" type="number" step="0.1" min="0" max="${MAX_FOUNDATION_DEPTH / 1000}" value="${meters(envelope.foundation.depth)}"></label>
      ${foundationFields(envelope.foundation)}<p class="envelope-flow">Концептуальная геометрия. Тип и размеры подтвердит конструктор по геологии.</p>`)}
    ${panel('roof', 'Крыша', `<label class="check-row"><input id="autoRoofMode" type="checkbox" ${envelope.roofMode === 'linked' ? 'checked' : ''}><span>Следует за этажами</span></label>
      <div class="envelope-roof-types">${roofTypes.map(([id, label, icon]) => `<button type="button" data-roof-type="${id}" class="${envelope.roof.type === id ? 'active' : ''}"><span>${icon}</span>${label}</button>`).join('')}</div>
      <div class="prop-grid"><label class="prop-field"><span>Уклон, °</span><input id="roofPitch" type="number" min="1" max="60" step="1" value="${envelope.roof.pitchDeg}" ${envelope.roof.type === 'flat' ? 'disabled' : ''}></label>
      <label class="prop-field"><span>Вынос, м</span><input id="roofOverhang" type="number" min="0" max="2" step="0.05" value="${meters(envelope.roof.overhang)}"></label></div>
      <label class="prop-field"><span>Направление ската</span><select id="roofDirection"><option value="auto" ${envelope.roof.direction === 'auto' ? 'selected' : ''}>Авто по форме дома</option><option value="n" ${envelope.roof.direction === 'n' ? 'selected' : ''}>На север</option><option value="e" ${envelope.roof.direction === 'e' ? 'selected' : ''}>На восток</option><option value="s" ${envelope.roof.direction === 's' ? 'selected' : ''}>На юг</option><option value="w" ${envelope.roof.direction === 'w' ? 'selected' : ''}>На запад</option></select></label>`)}
    ${panel('drainage', 'Водоотвод', `<label class="prop-field"><span>Система</span><select id="roofDrainage"><option value="auto" ${envelope.roof.drainage === 'auto' ? 'selected' : ''}>Авто по низким краям</option><option value="external" ${envelope.roof.drainage === 'external' ? 'selected' : ''}>Наружная</option><option value="internal" ${envelope.roof.drainage === 'internal' ? 'selected' : ''}>Внутренняя</option><option value="off" ${envelope.roof.drainage === 'off' ? 'selected' : ''}>Не показывать</option></select></label>
      <p class="envelope-flow">Жёлоб и стояки следуют за формой и уклоном крыши.</p>`)}
    ${panel('entrance', 'Вход', `<label class="check-row"><input id="entranceEnabled" type="checkbox" ${envelope.entrance.enabled ? 'checked' : ''}><span>Крыльцо от входной двери</span></label>
      <label class="prop-field"><span>Подъём</span><select id="entranceMode"><option value="steps" ${envelope.entrance.mode === 'steps' ? 'selected' : ''}>Ступени</option><option value="ramp" ${envelope.entrance.mode === 'ramp' ? 'selected' : ''}>Пандус</option><option value="both" ${envelope.entrance.mode === 'both' ? 'selected' : ''}>Ступени + пандус</option><option value="none" ${envelope.entrance.mode === 'none' ? 'selected' : ''}>Без подъёма</option></select></label>
      <div class="prop-grid"><label class="prop-field"><span>Площадка, м</span><input id="entranceLanding" type="number" min="0.9" max="4" step="0.1" value="${meters(envelope.entrance.landingDepth)}"></label><label class="prop-field"><span>Ступень до, м</span><input id="entranceRiser" type="number" min="0.1" max="0.2" step="0.01" value="${meters(envelope.entrance.maxRiser)}"></label></div>`)}
    ${panel('slabs', 'Перекрытия', `<label class="check-row"><input id="slabsEnabled" type="checkbox" ${envelope.slabs.enabled ? 'checked' : ''}><span>Автоматические плиты</span></label>
      <label class="prop-field"><span>${escapeHtml(level.name)} · толщина, м</span><input id="levelSlabThickness" type="number" min="0.12" max="0.6" step="0.05" value="${meters(level.slabThickness || envelope.slabs.thickness)}"></label>
      <p class="envelope-flow">Проёмы следуют за лестницами и шахтами. Плита остаётся у консольного этажа.</p>`)}
    ${panel('earthworks', 'Земляные работы', `${earthworks?.volumes ? `<dl class="earthworks-summary"><div><dt>Выемка</dt><dd>${earthworks.volumes.cutM3.toFixed(1)} м³</dd></div><div><dt>Насыпь</dt><dd>${earthworks.volumes.fillM3.toFixed(1)} м³</dd></div><div><dt>Баланс</dt><dd>${earthworks.volumes.netM3 >= 0 ? '+' : ''}${earthworks.volumes.netM3.toFixed(1)} м³</dd></div><div><dt>Съёмка</dt><dd>${Math.round((earthworks.coverage?.ratio || 0) * 100)}%</dd></div></dl>` : '<p class="envelope-flow">Импортируйте отметки топосъёмки — появятся объёмы.</p>'}<label class="prop-field"><span>Расчётная отметка</span><select id="earthworksMode"><option value="relative" ${envelope.earthworks.mode === 'relative' ? 'selected' : ''}>По проектному нулю</option><option value="balanced" ${envelope.earthworks.mode === 'balanced' ? 'selected' : ''}>Баланс выемки/насыпи</option><option value="absolute" ${envelope.earthworks.mode === 'absolute' ? 'selected' : ''}>Абсолютная</option></select></label>
      <div class="prop-grid"><label class="prop-field"><span>Рабочий отступ, м</span><input id="earthworksMargin" type="number" min="0" max="10" step="0.25" value="${meters(envelope.earthworks.margin)}"></label><label class="prop-field"><span>Смещение, м</span><input id="earthworksOffset" type="number" min="-5" max="5" step="0.05" value="${meters(envelope.earthworks.gradeOffset)}"></label></div>
      <p class="envelope-flow">Предварительно по точкам топосъёмки; вне её границ объём не додумывается.</p>`)}
  </section>`;
}

function metersValue(event, min, max, label) {
  const value = Number(inputNumber(event.target.value));
  if (!Number.isFinite(value) || value < min || value > max) { toast(`${label}: от ${min} до ${max} м`); return null; }
  return Math.round(value * 1000);
}

export function bindEnvelopeSettings(panel, project = state.project) {
  const q = (id) => panel.querySelector(`#${id}`);
  const set = (fn) => mutate(() => fn(project.envelope));
  panel.querySelectorAll('[data-envelope-tab]').forEach((button) => button.addEventListener('click', () => {
    activeSystem = activeSystem === button.dataset.envelopeTab ? null : button.dataset.envelopeTab;
    panel.querySelectorAll('[data-envelope-panel]').forEach((item) => { item.hidden = item.dataset.envelopePanel !== activeSystem; });
    panel.querySelectorAll('[data-envelope-tab]').forEach((item) => item.setAttribute('aria-expanded', String(item.dataset.envelopeTab === activeSystem)));
  }));
  panel.querySelectorAll('[data-envelope-close]').forEach((button) => button.addEventListener('click', () => {
    activeSystem = null; button.closest('[data-envelope-panel]').hidden = true;
    panel.querySelectorAll('[data-envelope-tab]').forEach((item) => item.setAttribute('aria-expanded', 'false'));
  }));
  q('buildingZeroAboveGround')?.addEventListener('change', (event) => {
    const raw = inputNumber(event.target.value);
    if (!raw) { set((envelope) => { envelope.zeroAboveGround = null; envelope.groundReferenceZ = null; }); return; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < MIN_ZERO_ABOVE_GROUND / 1000 || value > MAX_ZERO_ABOVE_GROUND / 1000) { toast(`Положение ±0.000 — от ${MIN_ZERO_ABOVE_GROUND / 1000} до +${MAX_ZERO_ABOVE_GROUND / 1000} м`); return; }
    set((envelope) => { envelope.zeroAboveGround = Math.round(value * 1000); if (project.site?.terrain) project.site.terrain.floorZ = null; });
  });
  q('foundationEnabled')?.addEventListener('change', (e) => set((x) => { x.foundation.enabled = e.target.checked; }));
  q('foundationDepth')?.addEventListener('change', (e) => { const v = metersValue(e, 0, MAX_FOUNDATION_DEPTH / 1000, 'Заглубление'); if (v != null) set((x) => { x.foundation.depth = v; }); });
  panel.querySelectorAll('[data-foundation-type]').forEach((button) => button.addEventListener('click', () => set((x) => {
    x.foundation.type = button.dataset.foundationType; x.foundation.sizingMode = 'parametric';
  })));
  const foundationMeters = {
    foundationSlabThickness: ['slabThickness', 0.1, 1.5], foundationStripWidth: ['stripWidth', 0.2, 2], foundationStripHeight: ['stripHeight', 0.2, 2],
    foundationPileDiameter: ['pileDiameter', 0.15, 1.2], foundationPileSpacing: ['pileSpacing', 0.8, 6], foundationPileLength: ['pileLength', 0.5, 12],
    foundationGrillageWidth: ['grillageWidth', 0.2, 2], foundationBasementSlab: ['basementSlabThickness', 0.15, 1], foundationRetainingWall: ['retainingWallThickness', 0.15, 1],
  };
  Object.entries(foundationMeters).forEach(([id, [key, min, max]]) => q(id)?.addEventListener('change', (e) => { const v = metersValue(e, min, max, LABELS.foundation); if (v != null) set((x) => { x.foundation[key] = v; x.foundation.sizingMode = 'parametric'; }); }));
  q('autoRoofMode')?.addEventListener('change', (e) => set((x) => { x.roofMode = e.target.checked ? 'linked' : 'manual'; }));
  panel.querySelectorAll('[data-roof-type]').forEach((button) => button.addEventListener('click', () => set((x) => { x.roof.type = button.dataset.roofType; })));
  q('roofPitch')?.addEventListener('change', (e) => set((x) => { x.roof.pitchDeg = Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 15))); }));
  q('roofOverhang')?.addEventListener('change', (e) => { const v = metersValue(e, 0, 2, 'Вынос'); if (v != null) set((x) => { x.roof.overhang = v; }); });
  q('roofDirection')?.addEventListener('change', (e) => set((x) => { x.roof.direction = e.target.value; }));
  q('roofDrainage')?.addEventListener('change', (e) => set((x) => { x.roof.drainage = e.target.value; }));
  q('entranceEnabled')?.addEventListener('change', (e) => set((x) => { x.entrance.enabled = e.target.checked; }));
  q('entranceMode')?.addEventListener('change', (e) => set((x) => { x.entrance.mode = e.target.value; }));
  q('entranceLanding')?.addEventListener('change', (e) => { const v = metersValue(e, 0.9, 4, 'Площадка'); if (v != null) set((x) => { x.entrance.landingDepth = v; }); });
  q('entranceRiser')?.addEventListener('change', (e) => { const v = metersValue(e, 0.1, 0.2, 'Ступень'); if (v != null) set((x) => { x.entrance.maxRiser = v; }); });
  q('slabsEnabled')?.addEventListener('change', (e) => set((x) => { x.slabs.enabled = e.target.checked; }));
  q('levelSlabThickness')?.addEventListener('change', (e) => { const v = metersValue(e, 0.12, 0.6, 'Перекрытие'); if (v != null) mutate(() => { activeLevel(project).slabThickness = v; project.envelope.slabs.thickness = v; }); });
  q('earthworksMode')?.addEventListener('change', (e) => set((x) => { x.earthworks.mode = e.target.value; }));
  q('earthworksMargin')?.addEventListener('change', (e) => { const v = metersValue(e, 0, 10, 'Рабочий отступ'); if (v != null) set((x) => { x.earthworks.margin = v; }); });
  q('earthworksOffset')?.addEventListener('change', (e) => { const v = metersValue(e, -5, 5, 'Смещение'); if (v != null) set((x) => { x.earthworks.gradeOffset = v; }); });
}

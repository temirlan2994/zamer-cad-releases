// Единый блок «Посадка и оболочка» для плана и участка.

import {
  MAX_FOUNDATION_DEPTH, MAX_ZERO_ABOVE_GROUND, MIN_ZERO_ABOVE_GROUND,
  envelopeOf, resolvedZeroAboveGround,
} from '../core/envelope.js';
import { houseTerrain } from '../core/terrain.js';
import { escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';

const meters = (millimeters) => (millimeters / 1000).toFixed(2);
const inputNumber = (value) => String(value).trim().replace(',', '.');

function datumInfo(project = state.project) {
  const hasTerrain = Boolean(project.site?.terrain?.points?.length >= 3);
  let house = null;
  if (hasTerrain) {
    try { house = houseTerrain(project); } catch { /* битая съёмка не должна уронить панель */ }
  }
  return { house, zero: resolvedZeroAboveGround(project, house) };
}
export function envelopeSettingsHtml(project = state.project) {
  const envelope = envelopeOf(project);
  const { house, zero } = datumInfo(project);
  const rooms = (project.levels || []).reduce((sum, level) => sum + (level.rooms?.length || 0), 0);
  const pending = zero == null;
  const grade = pending ? null : -zero;
  const absolute = house && zero != null ? house.groundReferenceZ + zero : null;
  const groundLow = pending ? null : (house && absolute != null ? house.min - absolute : grade);
  const base = pending ? null : Math.min(0, groundLow) - envelope.foundation.depth;
  const groundAbove = pending ? 0 : Math.max(0, house ? house.max - absolute : grade);
  const conflict = groundAbove > 20;
  const status = pending ? (rooms ? 'Нужно задать ноль' : 'Задайте до 3D')
    : (conflict ? `Земля выше пола на ${meters(groundAbove)} м` : 'Оболочка готова');
  const cardStatus = pending ? 'pending' : (conflict ? 'conflict' : 'ready');
  return `
    <section class="envelope-card" data-status="${cardStatus}" aria-labelledby="envelopeTitle">
      <header>
        <span class="envelope-icon" aria-hidden="true">⌂</span>
        <div><strong id="envelopeTitle">Посадка и оболочка</strong><small>${escapeHtml(status)}</small></div>
        <b>${envelope.roofMode === 'linked' ? 'АВТО' : 'РУЧНАЯ'}</b>
      </header>
      <label class="prop-field envelope-zero"><span>±0.000 относительно земли, м</span>
        <input id="buildingZeroAboveGround" type="text" inputmode="decimal" placeholder="например 1,00"
          value="${zero == null ? '' : meters(zero)}" ${pending ? 'aria-invalid="true"' : ''} required></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Заглубление, м</span>
          <input id="foundationDepth" type="number" inputmode="decimal" step="0.1" min="0" max="${MAX_FOUNDATION_DEPTH / 1000}"
            value="${meters(envelope.foundation.depth)}" ${envelope.foundation.enabled ? '' : 'disabled'}></label>
        <label class="prop-field"><span>Основание</span><input value="До земли" disabled></label>
      </div>
      <div class="envelope-toggles">
        <label class="check-row"><input id="autoRoofMode" type="checkbox" ${envelope.roofMode === 'linked' ? 'checked' : ''}><span>Крыша по этажам</span></label>
        <label class="check-row"><input id="foundationEnabled" type="checkbox" ${envelope.foundation.enabled ? 'checked' : ''}><span>Фундамент</span></label>
      </div>
      ${pending
    ? '<p class="envelope-flow">Укажите положение пола: появятся цоколь, фундамент и корректная линия земли.</p>'
    : conflict
      ? `<p class="envelope-flow envelope-conflict">Нужны выемка, подпорная конструкция или более высокая посадка дома.</p>`
      : `<p class="envelope-flow">Земля ${meters(grade)} м → основание ${meters(base)} м → пол ±0.000${absolute == null ? '' : ` · абс. ${meters(absolute)} м`}</p>`}
    </section>`;
}

export function bindEnvelopeSettings(panel, project = state.project) {
  const q = (id) => panel.querySelector(`#${id}`);
  q('buildingZeroAboveGround')?.addEventListener('change', (event) => {
    const raw = inputNumber(event.target.value);
    if (!raw) {
      mutate(() => {
        project.envelope.zeroAboveGround = null;
        project.envelope.groundReferenceZ = null;
      });
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < MIN_ZERO_ABOVE_GROUND / 1000 || value > MAX_ZERO_ABOVE_GROUND / 1000) {
      toast(`Положение ±0.000 — от ${MIN_ZERO_ABOVE_GROUND / 1000} до +${MAX_ZERO_ABOVE_GROUND / 1000} м`);
      return;
    }
    mutate(() => {
      project.envelope.zeroAboveGround = Math.round(value * 1000);
      // Относительная посадка становится главным источником; абсолютная
      // отметка фиксируется относительно опорной земли в момент ввода.
      if (project.site?.terrain) project.site.terrain.floorZ = null;
    });
  });
  q('foundationDepth')?.addEventListener('change', (event) => {
    const value = Number(inputNumber(event.target.value));
    if (!Number.isFinite(value) || value < 0 || value > MAX_FOUNDATION_DEPTH / 1000) {
      toast(`Заглубление — от 0 до ${MAX_FOUNDATION_DEPTH / 1000} м`);
      return;
    }
    mutate(() => { project.envelope.foundation.depth = Math.round(value * 1000); });
  });
  q('foundationEnabled')?.addEventListener('change', (event) => {
    mutate(() => { project.envelope.foundation.enabled = event.target.checked; });
  });
  q('autoRoofMode')?.addEventListener('change', (event) => {
    mutate(() => { project.envelope.roofMode = event.target.checked ? 'linked' : 'manual'; });
  });
}

// Библиотека готовых лестниц: назначение, материал, конструкция и ограждение.
// Форма остаётся параметрической и после вставки меняется в «Свойствах».

import {
  STAIR_ENVIRONMENTS, STAIR_RAILINGS, STAIR_STYLE_PRESETS, applyStairPreset,
} from '../core/stairs.js';
import { drawGlyphPreview } from '../render.js';
import { el, escapeHtml } from './dom.js';
import { state } from './state.js';
import { startPlaceFurniture } from './tools.js';

let environment = 'interior';

const byId = (list, id) => list.find((entry) => entry.id === id);
const MATERIAL_COLOR = { wood: '#b9895f', concrete: '#b9bab8', metal: '#73808a' };

function choose(preset) {
  environment = preset.environment;
  startPlaceFurniture('stairs', preset.title, { stairPreset: preset.id, stairShape: preset.shape });
}

export function stairPresetCard(preset, active) {
  const railing = byId(STAIR_RAILINGS, preset.railing)?.title || preset.railing;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `stair-preset-card${preset.id === active ? ' active' : ''}`;
  button.dataset.stairPreset = preset.id;
  if (active !== undefined) button.setAttribute('aria-pressed', String(preset.id === active));
  button.innerHTML = `<canvas class="stair-preset-preview" aria-hidden="true" width="156" height="124"></canvas>
    <strong>${escapeHtml(preset.title)}</strong>
    <small>${escapeHtml(preset.railing === 'none' ? railing : railing + ' перила')}</small>`;
  const sample = applyStairPreset({}, preset.shape);
  drawGlyphPreview(button.querySelector('canvas'), 'stairs', sample.w, sample.h, MATERIAL_COLOR[preset.material], sample);
  return button;
}

export function renderStairLibrary() {
  const cats = el('stairCats');
  const items = el('stairItems');
  if (!cats || !items) return;
  const active = state.tool?.kind === 'place-furniture' && state.tool.itemKind === 'stairs'
    ? state.tool.stairPreset : null;

  cats.innerHTML = '';
  for (const group of STAIR_ENVIRONMENTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = group.id === environment ? 'active' : '';
    button.dataset.stairEnvironment = group.id;
    button.textContent = group.id === 'interior' ? 'В доме' : 'На улице';
    button.title = group.title;
    button.setAttribute('aria-pressed', String(group.id === environment));
    button.addEventListener('click', () => { environment = group.id; renderStairLibrary(); });
    cats.appendChild(button);
  }

  items.innerHTML = '';
  for (const preset of STAIR_STYLE_PRESETS.filter((entry) => entry.environment === environment)) {
    const button = stairPresetCard(preset, active);
    button.addEventListener('click', () => choose(preset));
    items.appendChild(button);
  }
}


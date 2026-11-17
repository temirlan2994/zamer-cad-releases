// Библиотека готовых лестниц: назначение, материал, конструкция и ограждение.
// Форма остаётся параметрической и после вставки меняется в «Свойствах».

import {
  STAIR_ENVIRONMENTS, STAIR_MATERIALS, STAIR_RAILINGS, STAIR_STYLE_PRESETS,
} from '../core/stairs.js';
import { el, escapeHtml } from './dom.js';
import { state } from './state.js';
import { startPlaceFurniture } from './tools.js';

let environment = 'interior';

const byId = (list, id) => list.find((entry) => entry.id === id);
const MATERIAL_COLOR = { wood: '#b9895f', concrete: '#b9bab8', metal: '#73808a' };
const RAIL_ICON = { none: '—', wood: '╫', metal: '┆', glass: '▥' };

function choose(preset) {
  environment = preset.environment;
  startPlaceFurniture('stairs', preset.title, { stairPreset: preset.id, stairShape: preset.shape });
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
    button.textContent = group.id === 'interior' ? '⌂' : '☀';
    button.title = group.title;
    button.setAttribute('aria-label', group.title);
    button.addEventListener('click', () => { environment = group.id; renderStairLibrary(); });
    cats.appendChild(button);
  }

  items.innerHTML = '';
  for (const preset of STAIR_STYLE_PRESETS.filter((entry) => entry.environment === environment)) {
    const material = byId(STAIR_MATERIALS, preset.material)?.title || preset.material;
    const railing = byId(STAIR_RAILINGS, preset.railing)?.title || preset.railing;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `stair-preset-card${preset.id === active ? ' active' : ''}`;
    button.dataset.stairPreset = preset.id;
    button.innerHTML = `<span class="stair-preset-preview" style="--stair-material:${MATERIAL_COLOR[preset.material] || '#888'}">
        <i></i><i></i><i></i><i></i><b>${RAIL_ICON[preset.railing] || '┆'}</b>
      </span>
      <strong>${escapeHtml(preset.title)}</strong>
      <small>${escapeHtml(material)} · ${escapeHtml(railing)}</small>`;
    button.title = `Поставить: ${preset.title}. Форму и размеры можно изменить после установки.`;
    button.addEventListener('click', () => choose(preset));
    items.appendChild(button);
  }
}


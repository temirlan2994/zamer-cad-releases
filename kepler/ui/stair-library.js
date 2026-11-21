// Готовые лестницы и выбор формы — общий каталог для компьютера и телефона.
import {
  STAIR_RAILINGS, STAIR_SHAPES, STAIR_STYLE_PRESETS, applyStairPreset,
} from '../core/stairs.js';
import { drawGlyphPreview } from '../render.js';
import { el } from './dom.js';
import { state } from './state.js';
import { startPlaceFurniture } from './tools.js';

const categories = [['interior', 'В доме'], ['exterior', 'На улице'], ['shape', 'По форме']];
const materialColor = { wood: '#b9895f', concrete: '#b9bab8', metal: '#73808a' };
let category = 'interior';

function stairCard(title, preset, shape, showRailing) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'furniture-chip stair-chip';
  button.dataset.stair = shape;
  button.dataset.stairPreset = preset.id;

  const preview = document.createElement('canvas');
  preview.setAttribute('aria-hidden', 'true');
  preview.width = 240;
  preview.height = 132;
  const name = document.createElement('span');
  name.className = 'chip-name';
  name.textContent = title;
  button.append(preview, name);
  if (showRailing) {
    const railing = STAIR_RAILINGS.find((entry) => entry.id === preset.railing);
    const detail = document.createElement('span');
    detail.className = 'chip-size';
    detail.textContent = preset.railing === 'none' ? railing.title : railing.title + ' перила';
    button.appendChild(detail);
  }
  const sample = applyStairPreset({}, shape);
  drawGlyphPreview(preview, 'stairs', sample.w, sample.h, materialColor[preset.material], sample);
  button.addEventListener('click', () => startPlaceFurniture('stairs', title, { stairPreset: preset.id, stairShape: shape }));
  return button;
}

export function renderStairLibrary() {
  const cats = el('stairCats');
  const items = el('stairItems');
  if (!cats.childElementCount) {
    for (const [id, label] of categories) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.stairEnvironment = id;
      button.textContent = label;
      button.addEventListener('click', () => {
        category = id;
        items.scrollTop = 0;
        renderStairLibrary();
      });
      cats.appendChild(button);
    }
  }
  for (const button of cats.children) {
    button.setAttribute('aria-pressed', String(button.dataset.stairEnvironment === category));
  }
  if (items.dataset.category !== category) {
    items.dataset.category = category;
    items.replaceChildren();
    if (category === 'shape') {
      const preset = STAIR_STYLE_PRESETS.find((entry) => entry.id === 'interior-wood');
      for (const shape of STAIR_SHAPES) items.appendChild(stairCard(shape.title, preset, shape.id, false));
    } else {
      for (const preset of STAIR_STYLE_PRESETS.filter((entry) => entry.environment === category)) {
        items.appendChild(stairCard(preset.title, preset, preset.shape, true));
      }
    }
  }
  const tool = state.tool;
  for (const button of items.children) {
    const active = tool?.stairPreset === button.dataset.stairPreset && tool?.stairShape === button.dataset.stair;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

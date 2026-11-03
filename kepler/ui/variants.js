// Варианты планировки в свойствах проекта: сохранить текущий, сгенерировать,
// сравнить с текущим (миниатюры планов + показатели), открыть, удалить.
// Вариант хранит только дом, участок общий (core/variants.js).

import { generateLayouts } from '../core/generator.js';
import { levelProject } from '../core/model.js';
import {
  compareRows, createVariant, nextVariantName, projectWithHouse, variantSummary,
} from '../core/variants.js';
import { deriveWalls } from '../core/walls.js';
import { createRenderer, projectPoint } from '../render.js';
import { el, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { fitView } from './view.js';

// Сводки вариантов неизменны — считаются один раз.
const summaries = new Map();
function summaryOf(variant) {
  if (!summaries.has(variant.id)) summaries.set(variant.id, variantSummary(projectWithHouse(state.project, variant.house)));
  return summaries.get(variant.id);
}

const fmt = (v) => v.toFixed(1).replace('.', ',');

export function variantsSection() {
  const list = state.project.variants || [];
  const rows = list.map((v) => {
    const s = summaryOf(v);
    const ok = s.insolationOk && !s.problems;
    return `<li data-variant="${v.id}">
        <div class="variant-head"><b>${escapeHtml(v.name)}</b>
          <span class="badge ${ok ? 'ok' : 'warn'}">${ok ? 'нормы ✓' : `замечаний: ${s.problems + (s.insolationOk ? 0 : 1)}`}</span></div>
        <div class="variant-meta">${fmt(s.total)} м² · ${s.rooms} пом.${v.notes ? ` · ${escapeHtml(v.notes)}` : ''}</div>
        <div class="variant-actions">
          <button data-v-compare>Сравнить</button><button data-v-open>Открыть</button>
          <button data-v-del class="danger" title="Удалить вариант">✕</button>
        </div>
      </li>`;
  }).join('');
  return `
    <h3>Варианты <span class="count-badge">${list.length}</span></h3>
    <div class="prop-block">
      <div class="prop-actions">
        <button id="variantSave">＋ Сохранить как вариант</button>
        <button id="variantGenerate" title="Те же помещения этажа — двумя рядами вдоль коридора, жилые на солнечную сторону">⚙ Сгенерировать 3 варианта</button>
      </div>
      ${rows ? `<ul class="variant-list">${rows}</ul>` : ''}
      <p class="empty-hint">Вариант хранит дом (этажи, комнаты, проёмы, мебель); участок общий. «Открыть» — Ctrl+Z вернёт текущий.</p>
    </div>`;
}

export function bindVariants(panel) {
  panel.querySelector('#variantSave')?.addEventListener('click', () => {
    const name = nextVariantName(state.project.variants);
    mutate(() => { state.project.variants.push(createVariant(state.project, name)); });
    toast(`Сохранён «${name}»`);
  });
  panel.querySelector('#variantGenerate')?.addEventListener('click', () => {
    let out;
    try {
      out = generateLayouts(state.project, { count: 3 });
    } catch (error) {
      toast(error.message, true);
      return;
    }
    mutate(() => {
      for (const g of out) {
        const v = createVariant(state.project, nextVariantName(state.project.variants), g.house);
        v.notes = g.notes;
        state.project.variants.push(v);
      }
    });
    toast(`Сгенерировано вариантов: ${out.length} — сравните и откройте лучший`, true);
  });
  panel.querySelectorAll('[data-variant]').forEach((li) => {
    const variant = state.project.variants.find((v) => v.id === li.dataset.variant);
    if (!variant) return;
    li.querySelector('[data-v-open]').addEventListener('click', () => {
      mutate(() => { state.project = projectWithHouse(state.project, variant.house); });
      fitView();
      toast(`Открыт «${variant.name}» — Ctrl+Z вернёт прежний дом`);
    });
    li.querySelector('[data-v-del]').addEventListener('click', () => {
      mutate(() => { state.project.variants = state.project.variants.filter((v) => v.id !== variant.id); });
      summaries.delete(variant.id);
    });
    li.querySelector('[data-v-compare]').addEventListener('click', () => openCompare(variant));
  });
}

// Миниатюра плана активного этажа (печатная палитра, по габариту комнат).
function thumbnail(project, width = 330, height = 220) {
  const canvas = document.createElement('canvas');
  canvas.className = 'compare-thumb';
  const lp = levelProject(project, project.activeLevel);
  const rooms = lp.rooms;
  if (!rooms.length) return canvas;
  const pad = 600;
  const minX = Math.min(...rooms.map((r) => r.x)) - pad;
  const maxX = Math.max(...rooms.map((r) => r.x + r.w)) + pad;
  const minY = Math.min(...rooms.map((r) => r.y)) - pad;
  const maxY = Math.max(...rooms.map((r) => r.y + r.h)) + pad;
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  // Нужен вид дома без поворота с центром габарита в центре холста. Рендерер
  // получает вид мира и сам доворачивает его на дом (composeView), поэтому
  // вид мира повёрнут на −поворот дома и сдвинут на начало координат дома.
  const b = project.building || { rotation: 0, origin: { x: 0, y: 0 } };
  const rotation = -((b.rotation || 0) * Math.PI) / 180;
  const origin = projectPoint({ scale, rotation, panX: 0, panY: 0 }, b.origin.x, b.origin.y);
  const view = {
    scale,
    rotation,
    panX: width / 2 - scale * ((minX + maxX) / 2) - origin.x,
    panY: height / 2 - scale * ((minY + maxY) / 2) - origin.y,
  };
  createRenderer(canvas).draw({
    project: lp, walls: deriveWalls(lp), belowWalls: null, view, modeName: 'plan', selection: null, hover: null, guides: [],
  }, { width, height, dpr: window.devicePixelRatio || 1, print: true, site: false });
  return canvas;
}

export function openCompare(variant) {
  const box = el('compareScreen');
  const other = projectWithHouse(state.project, variant.house);
  const rows = compareRows(variantSummary(state.project), summaryOf(variant));
  el('compareTitle').textContent = `Сравнение: текущий дом и «${variant.name}»`;
  const thumbs = el('compareThumbs');
  thumbs.innerHTML = '';
  for (const [label, project] of [['Текущий', state.project], [variant.name, other]]) {
    const fig = document.createElement('figure');
    fig.appendChild(thumbnail(project));
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    fig.appendChild(cap);
    thumbs.appendChild(fig);
  }
  el('compareTable').innerHTML = `<tr><th>Показатель</th><th>Текущий</th><th>${escapeHtml(variant.name)}</th><th>Разница</th></tr>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? '' : ' class="k"'}>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}`;
  el('compareOpen').onclick = () => {
    box.hidden = true;
    mutate(() => { state.project = projectWithHouse(state.project, variant.house); });
    fitView();
    toast(`Открыт «${variant.name}» — Ctrl+Z вернёт прежний дом`);
  };
  box.hidden = false;
}

export const isCompareOpen = () => !el('compareScreen').hidden;

export function closeCompare() {
  el('compareScreen').hidden = true;
}

export function bindCompare() {
  el('compareClose').addEventListener('click', closeCompare);
  el('compareScreen').addEventListener('click', (e) => { if (e.target.id === 'compareScreen') closeCompare(); });
}

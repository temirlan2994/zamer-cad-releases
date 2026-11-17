// Библиотека дверей и окон: выезжает слева при инструменте «Дверь» / «Окно»
// (как каталог мебели): категории, поиск, карточки с превью. Клик по карточке
// задаёт пресет инструмента (state.tool.preset: тип и размеры) — инструмент
// остаётся активным для серии, строка параметров сверху синхронна.

import { OPENING_CATEGORIES, openingPresets, openingTypeTitle, presetMatches, presetToOpening, searchOpeningPresets } from '../core/opening-catalog.js';
import { activeLevel } from '../core/model.js';
import { el } from './dom.js';
import { closeLibrarySheet } from './mobile.js';
import { renderToolOptions } from './props.js';
import { requestDraw } from './view.js';
import { state } from './state.js';

const openCat = { door: OPENING_CATEGORIES.door[0].id, window: OPENING_CATEGORIES.window[0].id };
let syncedKey = null;
const levelHeight = () => activeLevel(state.project)?.height || 3000;
const toolKind = () => (state.tool?.kind === 'place-opening' ? state.tool.openKind : null);

export function bindOpeningLibrary() {
  el('openSearch')?.addEventListener('input', () => renderOpeningItems());
}

// Выбрать пресет: тип и размеры инструмента; карточка подсвечена.
export function chooseOpeningPreset(preset) {
  const t = state.tool;
  if (t?.kind !== 'place-opening' || t.openKind !== preset.kind) return;
  Object.assign(t.preset, presetToOpening(preset, levelHeight()));
  renderToolOptions(true);
  renderOpeningLibrary();
  closeLibrarySheet(); // телефон: план свободен для касания
  requestDraw();
}

export function renderOpeningLibrary() {
  const kind = toolKind();
  const cats = el('openingCats');
  if (!kind || !cats) return;
  const title = el('openingsTitle');
  if (title) title.textContent = kind === 'door' ? 'Двери' : 'Окна';
  // Новые параметры инструмента (запуск, поле строки) — категория той
  // карточки, что им соответствует; клик по категории дальше не сбивается.
  const key = `${kind}:${JSON.stringify(state.tool.preset)}`;
  if (!syncedKey?.startsWith(`${kind}:`) && el('openSearch')) el('openSearch').value = ''; // дверь ↔ окно — поиск заново
  if (key !== syncedKey) {
    syncedKey = key;
    const current = openingPresets(kind).find((p) => presetMatches(p, state.tool.preset, levelHeight()));
    if (current && !el('openSearch')?.value) openCat[kind] = current.cat;
  }
  cats.innerHTML = '';
  for (const cat of OPENING_CATEGORIES[kind]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = CATEGORY_ICONS[cat.id] || '';
    btn.append(cat.title);
    btn.title = cat.title;
    btn.dataset.cat = cat.id;
    btn.setAttribute('aria-label', cat.title);
    if (cat.id === openCat[kind]) btn.classList.add('active');
    btn.addEventListener('click', () => {
      openCat[kind] = cat.id;
      if (el('openSearch')) el('openSearch').value = '';
      renderOpeningLibrary();
    });
    cats.appendChild(btn);
  }
  renderOpeningItems();
}

function renderOpeningItems() {
  const kind = toolKind();
  const box = el('openingItems');
  if (!kind || !box) return;
  const query = (el('openSearch')?.value || '').trim();
  for (const button of el('openingCats').children) {
    const active = !query && button.dataset.cat === openCat[kind];
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const list = query ? searchOpeningPresets(kind, query) : openingPresets(kind, openCat[kind]);
  const css = getComputedStyle(document.documentElement);
  const colors = {
    stroke: css.getPropertyValue('--muted').trim() || '#7f90a5',
    accent: css.getPropertyValue('--accent').trim() || '#1f75ff',
    wall: css.getPropertyValue('--text').trim() || '#1f2937',
  };
  box.innerHTML = '';
  if (!list.length) box.innerHTML = '<p class="empty-hint">Ничего не нашлось</p>';
  for (const preset of list) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'furniture-chip opening-chip';
    chip.dataset.preset = preset.id;
    chip.title = `${preset.title} · ${openingTypeTitle(kind, preset.type)} · ${preset.width}×${preset.height} мм${kind === 'window' ? ` · подоконник ${preset.sill}` : ''}`;
    const active = presetMatches(preset, state.tool.preset, levelHeight());
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 132;
    chip.appendChild(preview);
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = preset.title;
    chip.appendChild(name);
    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = `${preset.width} × ${preset.height} мм`;
    chip.appendChild(size);
    try { drawOpeningPreview(preview, preset, colors); } catch { /* превью не критично */ }
    chip.addEventListener('click', () => chooseOpeningPreset(preset));
    box.appendChild(chip);
  }
}

// --- Превью: дверь — план (стена, створка, дуга открывания), окно — фасад
// (рама, стекло, импосты, пол).
export function drawOpeningPreview(canvas, preset, colors) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (preset.kind === 'door') drawDoorPlan(ctx, W, H, preset, colors);
  else drawWindowFront(ctx, W, H, preset, colors);
}

function drawDoorPlan(ctx, W, H, p, c) {
  // Свой масштаб у карточки: створка и дуга крупно (ширина — в подписи).
  const s = Math.min((W - 40) / (p.width + 700), (H - 16) / (p.width + 250));
  const wallT = 200 * s;
  const open = p.width * s;
  const cx = W / 2;
  const x0 = cx - open / 2;
  const x1 = cx + open / 2;
  const yWall = H - 10 - wallT; // верх стены (сторона комнаты)
  // Стена по обе стороны проёма.
  ctx.fillStyle = c.stroke;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(10, yWall, x0 - 10, wallT);
  ctx.fillRect(x1, yWall, W - 10 - x1, wallT);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  const leaf = (hx, dir, len) => {
    // Створка — от петли перпендикулярно стене, дуга — до проёма.
    ctx.beginPath(); ctx.moveTo(hx, yWall); ctx.lineTo(hx, yWall - len); ctx.stroke();
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (dir > 0) ctx.arc(hx, yWall, len, -Math.PI / 2, 0);
    else ctx.arc(hx, yWall, len, Math.PI, Math.PI * 1.5);
    ctx.stroke();
    ctx.restore();
  };
  if (p.type === 'single') leaf(x0, 1, open);
  else if (p.type === 'double') { leaf(x0, 1, open / 2); leaf(x1, -1, open / 2); }
  else if (p.type === 'sliding') {
    // Два полотна вдоль стены со сдвигом и стрелка откатывания.
    const t = Math.max(3, wallT * 0.28);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x0, yWall + wallT * 0.18, open * 0.55, t);
    ctx.strokeRect(x1 - open * 0.55, yWall + wallT * 0.55, open * 0.55, t);
    const ay = yWall - 10;
    ctx.beginPath(); ctx.moveTo(x0 + open * 0.2, ay); ctx.lineTo(x1 - open * 0.2, ay);
    ctx.moveTo(x1 - open * 0.2 - 5, ay - 4); ctx.lineTo(x1 - open * 0.2, ay); ctx.lineTo(x1 - open * 0.2 - 5, ay + 4);
    ctx.stroke();
  } else {
    // Проём без двери — откосы пунктиром.
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x0, yWall); ctx.lineTo(x1, yWall); ctx.moveTo(x0, yWall + wallT); ctx.lineTo(x1, yWall + wallT); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawWindowFront(ctx, W, H, p, c) {
  // Масштаб от крупного окна: соседние размеры сравниваются на глаз.
  const s = Math.min((W - 30) / Math.max(p.width, 1800), (H - 16) / Math.max(p.sill + p.height, 2500));
  const floor = H - 8;
  const w = p.width * s;
  const h = p.height * s;
  const x = W / 2 - w / 2;
  const y = floor - (p.sill + p.height) * s;
  // Пол.
  ctx.strokeStyle = c.stroke;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(8, floor); ctx.lineTo(W - 8, floor); ctx.stroke();
  // Стекло.
  ctx.fillStyle = c.accent;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  // Рама и импосты: створки по ~0,7–1 м.
  ctx.strokeStyle = c.wall;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(x, y, w, h);
  const sashes = Math.max(1, Math.round(p.width / (p.type === 'panoramic' ? 1000 : 750)));
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 1; i < sashes; i += 1) { const sx = x + (w * i) / sashes; ctx.moveTo(sx, y); ctx.lineTo(sx, y + h); }
  ctx.stroke();
  // Блик на стекле.
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.4;
  const g = Math.min(w / sashes, h) * 0.3;
  ctx.beginPath(); ctx.moveTo(x + 4, y + 4 + g); ctx.lineTo(x + 4 + g, y + 4); ctx.stroke();
  ctx.globalAlpha = 1;
  // Подоконник у обычного окна.
  if (p.type !== 'panoramic') {
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 4, y + h + 2); ctx.lineTo(x + w + 4, y + h + 2); ctx.stroke();
  }
}

const svgIcon = (inner) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const CATEGORY_ICONS = {
  interior: svgIcon('<path d="M3 20h18"/><path d="M6 20V6"/><path d="M6 6a14 14 0 0 1 14 14" stroke-dasharray="2.5 2"/>'),
  entrance: svgIcon('<rect x="6" y="3" width="12" height="17" rx="1"/><circle cx="15" cy="12" r="1"/><path d="M3 21h18"/>'),
  double: svgIcon('<path d="M2 20h20"/><path d="M4 20V11M20 20V11"/><path d="M4 11a9 9 0 0 1 8 9M20 11a9 9 0 0 0-8 9" stroke-dasharray="2.5 2"/>'),
  sliding: svgIcon('<rect x="3" y="7" width="10" height="13" rx="0.5"/><rect x="11" y="4" width="10" height="13" rx="0.5"/><path d="M14 21h6M18 19l2 2-2 2"/>'),
  passage: svgIcon('<path d="M5 21V10a7 7 0 0 1 14 0v11"/><path d="M3 21h18"/>'),
  standard: svgIcon('<rect x="5" y="4" width="14" height="13" rx="1"/><path d="M12 4v13M5 10.5h14"/><path d="M4 19h16"/>'),
  wide: svgIcon('<rect x="2" y="6" width="20" height="10" rx="1"/><path d="M8.7 6v10M15.3 6v10"/><path d="M2 18.5h20"/>'),
  panoramic: svgIcon('<rect x="4" y="2" width="16" height="18" rx="1"/><path d="M12 2v18"/><path d="M2 21h20"/>'),
};

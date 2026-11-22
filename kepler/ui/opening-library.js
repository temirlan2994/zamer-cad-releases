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
let selectedPresetId = null;
const shortLabels = {
  interior: 'Для комнат', double: 'Две створки', sliding: 'Сдвижные',
  passage: 'Без двери', opening: 'Открываются', fixed: 'Глухие',
  wide: 'Широкие', panoramic: 'В пол', special: 'Фрамуги',
};
const levelHeight = () => activeLevel(state.project)?.height || 3000;
const toolKind = () => (state.tool?.kind === 'place-opening' ? state.tool.openKind : null);

export function bindOpeningLibrary() {
  el('openSearch').addEventListener('input', () => {
    el('openingItems').scrollTop = 0;
    renderOpeningItems();
  });
}

// Выбрать пресет: тип и размеры инструмента; карточка подсвечена.
export function chooseOpeningPreset(preset) {
  const t = state.tool;
  if (t?.kind !== 'place-opening' || t.openKind !== preset.kind) return;
  // Роль входа и id заготовки задаёт только сама карточка: без сброса
  // «Главный вход» от входной двери переходил на следующую выбранную карточку.
  delete t.preset.presetId;
  delete t.preset.entryRole;
  Object.assign(t.preset, presetToOpening(preset, levelHeight()));
  if (preset.kind === 'window') Object.assign(t.preset, {
    heightMode: preset.heightMode === 'level' ? 'level' : 'custom',
    frameMaterial: 'aluminum', frameColor: 'anthracite',
  });
  selectedPresetId = preset.id;
  openCat[preset.kind] = preset.cat;
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
  const height = levelHeight();
  const key = `${kind}:${height}:${JSON.stringify(state.tool.preset)}`;
  if (!syncedKey?.startsWith(`${kind}:`) && el('openSearch')) el('openSearch').value = ''; // дверь ↔ окно — поиск заново
  if (key !== syncedKey) {
    syncedKey = key;
    // У входной и межкомнатной двери могут совпадать и размеры, и тип створки.
    const matches = openingPresets(kind).filter((p) => presetMatches(p, state.tool.preset, height));
    const current = matches.find((p) => p.id === selectedPresetId)
      || matches.find((p) => p.cat === openCat[kind]) || matches[0];
    selectedPresetId = current?.id ?? null;
    if (current && !el('openSearch')?.value) openCat[kind] = current.cat;
  }
  if (cats.dataset.kind !== kind) {
    cats.dataset.kind = kind;
    cats.replaceChildren(...OPENING_CATEGORIES[kind].map(({ id, title }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = shortLabels[id] || title;
      btn.title = title;
      btn.dataset.cat = id;
      btn.addEventListener('click', () => {
        openCat[kind] = id;
        el('openSearch').value = '';
        el('openingItems').scrollTop = 0;
        renderOpeningItems();
      });
      return btn;
    }));
    el('openingItems').scrollTop = 0;
  }
  renderOpeningItems();
}

function renderOpeningItems() {
  const kind = toolKind();
  const box = el('openingItems');
  if (!kind || !box) return;
  const query = (el('openSearch')?.value || '').trim();
  const rail = el('openingCats');
  rail.hidden = Boolean(query);
  for (const button of rail.children) {
    const active = !query && button.dataset.cat === openCat[kind];
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const list = query ? searchOpeningPresets(kind, query) : openingPresets(kind, openCat[kind]);
  const css = getComputedStyle(box);
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
    const active = preset.id === selectedPresetId;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 132;
    chip.appendChild(preview);
    const sizeLabel = `${preset.width} × ${preset.height} мм`;
    const bareTitle = preset.title.replace(/\s+\d+(?:×\d+)?$/, '');
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = ['Окно', 'Дверь'].includes(bareTitle) ? sizeLabel : bareTitle;
    chip.appendChild(name);
    if (name.textContent !== sizeLabel) {
      const size = document.createElement('span');
      size.className = 'chip-size';
      size.textContent = sizeLabel;
      chip.appendChild(size);
    }
    chip.setAttribute('aria-label', `${bareTitle} ${sizeLabel}`);
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
  ctx.lineWidth = 3;
  const leaf = (hx, dir, len) => {
    // Створка — от петли перпендикулярно стене, дуга — до проёма.
    ctx.beginPath(); ctx.moveTo(hx, yWall); ctx.lineTo(hx, yWall - len); ctx.stroke();
    ctx.save();
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 3]);
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
  const panoramic = ['panoramic', 'lift-slide', 'french'].includes(p.type);
  const sashes = Math.max(1, Math.round(p.width / (panoramic ? 1200 : 800)));
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

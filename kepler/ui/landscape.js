// Режим «Ландшафт»: каталог слева, постановка, выделение, ручки, правка
// с историей, панель свойств. Данные — project.site.landscape.objects
// (core/landscape.js), координаты участка (съёмки).

import {
  LANDSCAPE_CATEGORIES, TREE_HOUSE_MIN, createLandscapeObject, hitLandscape, landscapeByCategory,
  landscapeDef, landscapeHandles, landscapeSummary, landscapeWarnings, objectCorners, objectsInPolygon, resizeObject,
  searchLandscape,
} from '../core/landscape.js';
import { buildingSiteCheck } from '../core/site-check.js';
import { drawLandscapePreview } from './render-landscape.js';
import { el, escapeHtml, toast } from './dom.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, snapshot } from './store.js';
import { cancelTool, selectObject, setTool } from './tools.js';
import { requestDraw, screenToWorld, worldToScreen } from './view.js';

export const LANDSCAPE_MIME = 'application/x-kepler-landscape';

let category = LANDSCAPE_CATEGORIES[0].id;
let clipboard = null;

// ------------------------------------------------------------ Данные

export function landscapeObjects() {
  const site = state.project.site;
  if (!site.landscape || !Array.isArray(site.landscape.objects)) site.landscape = { objects: [] };
  return site.landscape.objects;
}

export function selectedIds() {
  return state.selection?.type === 'landscape' ? state.selection.ids : [];
}

function selectedObjects() {
  const ids = new Set(selectedIds());
  return landscapeObjects().filter((o) => ids.has(o.id));
}

export function selectLandscape(ids) {
  selectObject(ids.length ? { type: 'landscape', ids: [...ids] } : null);
}

const snapStep = () => Math.max(gridStep(), 1);
const snap = (val) => Math.round(val / snapStep()) * snapStep();

// ------------------------------------------------------------ Постановка

export function startPlaceLandscape(kind) {
  const def = landscapeDef(kind);
  if (!def) return;
  setTool({ kind: 'place-landscape', lsKind: kind, rotation: 0 },
    `Кликните на участке — «${def.title}»; повторные клики — ещё · Пробел — повернуть · Esc — выйти`);
  state.selection = null;
  renderLandscapeLibrary();
  requestDraw();
}

export function placeLandscapeAt(kind, world, rotation = 0) {
  const def = landscapeDef(kind);
  if (!def || def.stage !== 1) return null;
  const obj = createLandscapeObject(kind, snap(world.x), snap(world.y), { rotation });
  mutate(() => {
    landscapeObjects().push(obj);
    state.selection = { type: 'landscape', ids: [obj.id] };
  });
  return obj;
}

function ghostAt(world) {
  const tool = state.tool;
  state.ghostLandscape = createLandscapeObject(tool.lsKind, snap(world.x), snap(world.y), { id: '__ghost-ls__', rotation: tool.rotation || 0 });
}

// Пробел во время постановки — поворот призрака на 90°.
export function rotateLandscapeGhost() {
  const tool = state.tool;
  if (tool?.kind !== 'place-landscape') return false;
  tool.rotation = ((tool.rotation || 0) + 90) % 360;
  if (state.ghostLandscape) state.ghostLandscape.rotation = tool.rotation;
  requestDraw();
  return true;
}

// ------------------------------------------------------------ Мышь

// Наведение/призрак. Возвращает true — событие обработано.
export function landscapeHover(world, canvas) {
  if (state.tool?.kind === 'place-landscape') {
    ghostAt(world);
    canvas.style.cursor = 'copy';
    requestDraw();
    return true;
  }
  if (state.tool) return false;
  const screen = worldToScreen(world.x, world.y);
  const handle = hitLandscapeHandle(screen);
  const hit = handle ? null : hitLandscape(landscapeObjects(), world, 4 / state.view.scale);
  const next = hit ? { type: 'landscape', id: hit.id } : null;
  canvas.style.cursor = handle ? (handle.mode === 'rotate' ? 'grab' : 'nwse-resize') : hit ? 'move' : 'default';
  if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
  return true;
}

const HANDLE_TOL = () => (state.coarsePointer ? 22 : 9);

export function hitLandscapeHandle(screen) {
  const objs = selectedObjects();
  if (objs.length !== 1) return null;
  const o = objs[0];
  const { corners, rotators } = landscapeHandles(o, 20, state.view.scale);
  for (const c of corners) {
    const p = worldToScreen(c.x, c.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_TOL() && Math.abs(p.y - screen.y) <= HANDLE_TOL()) return { mode: 'resize', corner: c.id, obj: o };
  }
  for (const r of rotators) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_TOL() + 1) return { mode: 'rotate', corner: r.id, obj: o };
  }
  return null;
}

// Нажатие в «Ландшафте». Возвращает описание перетаскивания для input.js
// (kind 'ls-*', 'marquee', 'pan') или null.
export function landscapePointerDown(event, screen, world) {
  const tool = state.tool;
  if (tool?.kind === 'place-landscape') {
    placeLandscapeAt(tool.lsKind, world, tool.rotation || 0);
    return null;
  }
  if (tool) return null;
  const handle = hitLandscapeHandle(screen);
  if (handle) {
    const o = handle.obj;
    if (handle.mode === 'rotate') {
      return {
        kind: 'ls-rotate', id: o.id, startRot: o.rotation || 0, center: { x: o.x, y: o.y },
        startAngle: Math.atan2(world.y - o.y, world.x - o.x), before: snapshot(), moved: false,
      };
    }
    const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[handle.corner];
    const anchor = objectCorners(o).find((c) => c.id === opp);
    const sign = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[handle.corner];
    return { kind: 'ls-resize', id: o.id, anchor: { x: anchor.x, y: anchor.y }, sign, before: snapshot(), moved: false };
  }
  const hit = hitLandscape(landscapeObjects(), world, 4 / state.view.scale);
  if (hit) {
    let ids = selectedIds();
    if (event.shiftKey) {
      ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id];
      selectLandscape(ids);
      if (!ids.includes(hit.id)) return null;
    } else if (!ids.includes(hit.id)) {
      ids = [hit.id];
      selectLandscape(ids);
    }
    const starts = new Map(selectedObjects().map((o) => [o.id, { x: o.x, y: o.y }]));
    return { kind: 'ls-move', primary: hit.id, starts, world, screen, before: snapshot(), moved: false };
  }
  if (!event.shiftKey) selectLandscape([]);
  if (event.pointerType === 'touch') return { kind: 'pan', start: screen, view: { ...state.view } };
  state.marquee = { x1: screen.x, y1: screen.y, x2: screen.x, y2: screen.y, add: event.shiftKey };
  return { kind: 'marquee', start: screen };
}

const rotate = (x, y, deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
};

export function landscapeDragMove(drag, world, screen, event) {
  const objects = landscapeObjects();
  if (drag.kind === 'ls-move') {
    if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
    drag.moved = true;
    const p0 = drag.starts.get(drag.primary);
    const dx = snap(p0.x + world.x - drag.world.x) - p0.x;
    const dy = snap(p0.y + world.y - drag.world.y) - p0.y;
    for (const o of objects) {
      const s = drag.starts.get(o.id);
      if (s) { o.x = s.x + dx; o.y = s.y + dy; }
    }
  } else if (drag.kind === 'ls-rotate') {
    const o = objects.find((x) => x.id === drag.id);
    if (!o) return;
    drag.moved = true;
    const ang = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
    const raw = drag.startRot + ((ang - drag.startAngle) * 180) / Math.PI;
    const step = event?.shiftKey ? 1 : 15;
    o.rotation = ((Math.round(raw / step) * step) % 360 + 360) % 360;
  } else if (drag.kind === 'ls-resize') {
    const o = objects.find((x) => x.id === drag.id);
    if (!o) return;
    const def = landscapeDef(o.kind);
    drag.moved = true;
    const d = rotate(world.x - drag.anchor.x, world.y - drag.anchor.y, -(o.rotation || 0));
    let w = Math.max(1, drag.sign[0] * d.x);
    let h = Math.max(1, drag.sign[1] * d.y);
    if (def.lockAspect) { w = Math.max(w, h); h = w; }
    resizeObject(o, snap(w), snap(h));
    const c = rotate((drag.sign[0] * o.w) / 2, (drag.sign[1] * o.h) / 2, o.rotation || 0);
    o.x = drag.anchor.x + c.x;
    o.y = drag.anchor.y + c.y;
  }
  requestDraw();
}

export function landscapeDragEnd(drag) {
  if (!drag.moved) { requestDraw(); return; }
  pushHistory(drag.before);
  afterChange();
}

// Рамка: объекты, центр которых внутри (Shift — добавить к выделению).
export function applyLandscapeMarquee(m) {
  if (Math.abs(m.x2 - m.x1) < 6 && Math.abs(m.y2 - m.y1) < 6) return;
  const poly = [screenToWorld(m.x1, m.y1), screenToWorld(m.x2, m.y1), screenToWorld(m.x2, m.y2), screenToWorld(m.x1, m.y2)];
  const found = objectsInPolygon(landscapeObjects(), poly).map((o) => o.id);
  selectLandscape(m.add ? [...new Set([...selectedIds(), ...found])] : found);
}

// Перетаскивание карточки на холст.
export function dropLandscape(kind, world) {
  if (!landscapeDef(kind)) return false;
  cancelTool();
  placeLandscapeAt(kind, world);
  return true;
}

// ------------------------------------------------------------ Действия

export function deleteLandscapeSelection() {
  const ids = new Set(selectedIds());
  if (!ids.size) return;
  mutate(() => {
    const site = state.project.site;
    site.landscape.objects = landscapeObjects().filter((o) => !ids.has(o.id));
  });
  selectLandscape([]);
}

export function nudgeLandscape(dx, dy) {
  const objs = selectedObjects();
  if (!objs.length) return;
  mutate(() => { for (const o of objs) { o.x += dx; o.y += dy; } });
}

// R — поворот на 90°: одиночный — вокруг центра, группа — вокруг центра группы.
export function rotateLandscape90() {
  const objs = selectedObjects();
  if (!objs.length) return;
  const cx = objs.reduce((s, o) => s + o.x, 0) / objs.length;
  const cy = objs.reduce((s, o) => s + o.y, 0) / objs.length;
  mutate(() => {
    for (const o of objs) {
      const p = rotate(o.x - cx, o.y - cy, 90);
      o.x = Math.round(cx + p.x);
      o.y = Math.round(cy + p.y);
      o.rotation = ((o.rotation || 0) + 90) % 360;
    }
  });
}

export function copyLandscapeSelection() {
  const objs = selectedObjects();
  if (!objs.length) return false;
  clipboard = { objects: JSON.parse(JSON.stringify(objs)), pastes: 0 };
  toast(objs.length > 1 ? `Скопировано объектов: ${objs.length}` : 'Скопировано — Ctrl+V вставит рядом');
  return true;
}

function pasteObjects(list, offset) {
  const copies = list.map((o) => createLandscapeObject(o.kind, o.x + offset, o.y + offset, {
    rotation: o.rotation, w: o.w, h: o.h, height: o.height, variant: o.variant, color: o.color, meta: o.meta,
  }));
  mutate(() => { landscapeObjects().push(...copies); });
  selectLandscape(copies.map((o) => o.id));
}

export function pasteLandscape() {
  if (!clipboard) { toast('Сначала выберите объект и нажмите Ctrl+C'); return false; }
  clipboard.pastes += 1;
  pasteObjects(clipboard.objects, 1000 * clipboard.pastes);
  return true;
}

export function duplicateLandscapeSelection() {
  const objs = selectedObjects();
  if (objs.length) pasteObjects(objs, 1000);
}

// Клавиши режима; true — нажатие обработано.
export function handleLandscapeKey(event) {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.code === 'KeyC') { event.preventDefault(); copyLandscapeSelection(); return true; }
  if (mod && event.code === 'KeyV') { event.preventDefault(); pasteLandscape(); return true; }
  if (mod && event.code === 'KeyD') { event.preventDefault(); duplicateLandscapeSelection(); return true; }
  if (mod) return false;
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteLandscapeSelection(); return true; }
  if (event.code === 'KeyR') { rotateLandscape90(); return true; }
  if (event.code === 'KeyM') return true; // зеркало ландшафту не нужно
  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (nudge && selectedIds().length) {
    event.preventDefault();
    const step = event.shiftKey ? snapStep() * 10 : snapStep();
    nudgeLandscape(nudge[0] * step, nudge[1] * step);
    return true;
  }
  return false;
}

// ------------------------------------------------------------ Каталог слева

export function bindLandscapeLibrary() {
  el('lsSearch')?.addEventListener('input', () => renderLandscapeItems());
}

export function renderLandscapeLibrary() {
  const tabs = el('lsTabs');
  if (!tabs || state.modeName !== 'landscape') return;
  tabs.innerHTML = '';
  for (const cat of LANDSCAPE_CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lib-tab';
    btn.dataset.lsCat = cat.id;
    btn.textContent = cat.title;
    btn.classList.toggle('active', cat.id === category);
    btn.addEventListener('click', () => {
      category = cat.id;
      if (el('lsSearch')) el('lsSearch').value = '';
      renderLandscapeLibrary();
    });
    tabs.appendChild(btn);
  }
  renderLandscapeItems();
}

function renderLandscapeItems() {
  const box = el('lsItems');
  if (!box) return;
  const q = (el('lsSearch')?.value || '').trim();
  const list = q ? searchLandscape(q) : landscapeByCategory(category);
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="empty-hint">Ничего не нашлось</p>'; return; }
  let group = null;
  for (const def of list) {
    if (!q && def.group !== group) {
      group = def.group;
      const h = document.createElement('div');
      h.className = 'ls-group';
      h.textContent = group;
      box.appendChild(h);
    }
    const chip = document.createElement('div');
    chip.className = 'furniture-chip ls-chip';
    chip.draggable = true;
    chip.dataset.lsKind = def.kind;
    chip.title = `«${def.title}»: клик — ставить курсором, или перетащите на участок`;
    if (state.tool?.kind === 'place-landscape' && state.tool.lsKind === def.kind) chip.classList.add('active');
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 132;
    chip.appendChild(preview);
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = def.title;
    chip.appendChild(name);
    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = def.lockAspect ? `⌀ ${(def.w / 1000).toFixed(1)} м` : `${(def.w / 1000).toFixed(1)}×${(def.h / 1000).toFixed(1)} м`;
    chip.appendChild(size);
    try { drawLandscapePreview(preview, def.kind); } catch { /* превью не критично */ }
    chip.addEventListener('dragstart', (e) => {
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(LANDSCAPE_MIME, def.kind);
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('click', () => {
      if (state.tool?.kind === 'place-landscape' && state.tool.lsKind === def.kind) cancelTool();
      else startPlaceLandscape(def.kind);
    });
    box.appendChild(chip);
  }
}

// ------------------------------------------------------------ Свойства

const m = (mm) => (mm / 1000).toFixed(2);

// Замечания по текущим данным (рисунок считает их сам, на каждом кадре).
function currentWarnings() {
  const footprints = buildingSiteCheck(state.project).footprint.map((f) => f.corners);
  return landscapeWarnings(landscapeObjects(), { boundary: state.project.site.boundary, footprints });
}

export function renderLandscapeProps(panel) {
  const objs = selectedObjects();
  if (!objs.length) { renderLandscapeSummary(panel); return; }
  if (objs.length > 1) {
    panel.innerHTML = `
      <h2>Ландшафт</h2>
      <div class="prop-block">
        <div class="prop-row"><span>Выбрано объектов</span><strong>${objs.length}</strong></div>
        <p class="hint">Тяните мышью или стрелками · R — повернуть группу · Ctrl+D — копия</p>
      </div>
      <div class="prop-actions">
        <button type="button" id="lsDup">Копировать</button>
        <button type="button" class="danger" id="lsDel">Удалить</button>
      </div>`;
    bindCommon(panel);
    return;
  }
  const o = objs[0];
  const def = landscapeDef(o.kind);
  const notes = currentWarnings().get(o.id) || [];
  const variants = def.variants.length > 1
    ? `<label class="prop-field"><span>Вариант</span><select id="lsVariant">${def.variants.map((v) => `<option value="${v.id}" ${v.id === o.variant ? 'selected' : ''}>${escapeHtml(v.title)}</option>`).join('')}</select></label>`
    : '';
  const size = def.lockAspect
    ? `<label class="prop-field"><span>${def.shape === 'point' && def.group === 'Деревья' ? 'Диаметр кроны, м' : 'Диаметр, м'}</span>
        <input id="lsW" type="number" step="0.1" min="${m(def.min.w)}" max="${m(def.max.w)}" value="${m(o.w)}"></label>`
    : `<div class="prop-grid">
        <label class="prop-field"><span>Длина, м</span><input id="lsW" type="number" step="0.1" min="${m(def.min.w)}" max="${m(def.max.w)}" value="${m(o.w)}"></label>
        <label class="prop-field"><span>Ширина, м</span><input id="lsH" type="number" step="0.1" min="${m(def.min.h)}" max="${m(def.max.h)}" value="${m(o.h)}"></label>
      </div>`;
  panel.innerHTML = `
    <h2>${escapeHtml(def.title)}</h2>
    <div class="prop-block">
      <div class="prop-row"><span>${escapeHtml(def.group)}</span><span>${def.tall ? 'высокий' : def.cover ? 'покрытие' : ''}</span></div>
      ${variants}
      ${size}
      <label class="prop-field"><span>Высота, м</span><input id="lsHeight" type="number" step="0.1" min="0" max="40" value="${m(o.height || 0)}"></label>
      <label class="prop-field"><span>Поворот, °</span><input id="lsRot" type="number" step="5" value="${Math.round(o.rotation || 0)}"></label>
      ${notes.map((t) => `<p class="ls-note">${escapeHtml(t)}</p>`).join('')}
    </div>
    <div class="prop-actions">
      <button type="button" id="lsDup" title="Ctrl+D">Копировать</button>
      <button type="button" id="lsRot90" title="R">↻ 90°</button>
      <button type="button" class="danger" id="lsDel" title="Del">Удалить</button>
    </div>`;
  bindCommon(panel);
  const num = (id) => Number(panel.querySelector(id)?.value);
  panel.querySelector('#lsVariant')?.addEventListener('change', (e) => mutate(() => { o.variant = e.target.value; }));
  const applySize = () => {
    const w = Math.round(num('#lsW') * 1000);
    const h = def.lockAspect ? w : Math.round(num('#lsH') * 1000);
    if (!(w > 0) || !(h > 0)) return;
    mutate(() => { resizeObject(o, w, h); });
  };
  panel.querySelector('#lsW')?.addEventListener('change', applySize);
  panel.querySelector('#lsH')?.addEventListener('change', applySize);
  panel.querySelector('#lsHeight')?.addEventListener('change', () => {
    const v = num('#lsHeight');
    if (Number.isFinite(v) && v >= 0) mutate(() => { o.height = Math.round(v * 1000); });
  });
  panel.querySelector('#lsRot')?.addEventListener('change', () => {
    const v = num('#lsRot');
    if (Number.isFinite(v)) mutate(() => { o.rotation = ((Math.round(v) % 360) + 360) % 360; });
  });
  panel.querySelector('#lsRot90')?.addEventListener('click', rotateLandscape90);
}

function bindCommon(panel) {
  panel.querySelector('#lsDup')?.addEventListener('click', duplicateLandscapeSelection);
  panel.querySelector('#lsDel')?.addEventListener('click', deleteLandscapeSelection);
}

function renderLandscapeSummary(panel) {
  const objs = landscapeObjects();
  const sum = landscapeSummary(objs);
  const warn = [...currentWarnings().values()].flat();
  const outside = warn.filter((t) => t.startsWith('За границей')).length;
  const near = warn.length - outside;
  const site = state.project.site;
  panel.innerHTML = `
    <h2>Ландшафт</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Объектов</span><strong>${sum.count}</strong></div>
      <div class="prop-row"><span>Деревьев</span><strong>${sum.trees}</strong></div>
      <div class="prop-row"><span>Покрытия и площадки</span><strong>${sum.coverM2.toFixed(1)} м²</strong></div>
      ${outside ? `<p class="ls-note">За границей участка: ${outside}</p>` : ''}
      ${near ? `<p class="ls-note">Деревья ближе ${TREE_HOUSE_MIN / 1000} м к дому: ${near}</p>` : ''}
      ${site.boundary?.length ? '' : '<p class="hint">Границу участка можно начертить в режиме «Участок».</p>'}
      <p class="hint">Выберите объект слева: клик — ставить курсором (Esc — выйти), или перетащите на участок. Shift — несколько, рамка — выделить группу.</p>
    </div>`;
}

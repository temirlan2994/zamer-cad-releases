// «Массив» и «Засадить» в режиме «Ландшафт». Массив — инструмент ls-array:
// вдоль линии (точки кликами), по кругу/дуге (клик — центр), прямоугольный;
// предпросмотр призраками (render-landscape.js), Enter/«Применить» — одной
// записью истории, Esc — отмена. «Засадить» — растения в контуре газона,
// клумбы или короба (core/landscape-array.js), тоже одной записью истории.

import {
  ARRAY_MAX, FILL_PLANTS, buildArray, canFill, groupBase, groupExtent, plantFillObject,
} from '../core/landscape-array.js';
import { settleMoved, withChildren } from '../core/landscape-build.js';
import { houseFootprints } from '../core/landscape-tools.js';
import { landscapeDef } from '../core/landscape.js';
import { escapeHtml, toast } from './dom.js';
import { landscapeObjects, selectLandscape, selectedIds, snapPoint } from './landscape.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw, worldToScreen } from './view.js';

// Параметры — запоминаются между вызовами.
const arr = {
  mode: 'rect', step: 1000, count: 5, byCount: false, align: true,
  pCount: 6, pAngle: 360, pRadius: 0, pAlign: true,
  rows: 2, cols: 3, dx: 2000, dy: 2000,
};
export const arrayOptions = arr;

const MODES = [
  { id: 'path', title: 'Вдоль линии' },
  { id: 'polar', title: 'По кругу' },
  { id: 'rect', title: 'Прямоугольный' },
];
const HINT = {
  path: 'Массив вдоль линии: кликайте точки линии · Backspace — убрать точку · Enter или двойной клик — применить · Esc — отмена',
  polar: 'Массив по кругу: кликните центр · радиус, количество и угол — в панели · Enter — применить · Esc — отмена',
  rect: 'Прямоугольный массив: ряды, столбцы и шаги — в панели · Enter — применить · Esc — отмена',
};

const isArrayTool = () => state.tool?.kind === 'ls-array';
const round100 = (v) => Math.ceil(v / 100) * 100;

function topObjects(ids) {
  const set = new Set(ids);
  return landscapeObjects().filter((o) => set.has(o.id));
}

// Копируемая группа: выбранные + растения выбранных коробов.
function sourceObjects(ids) {
  const set = withChildren(landscapeObjects(), ids);
  return landscapeObjects().filter((o) => set.has(o.id));
}

// Shift+A / кнопка «Массив» — начать с выделенными объектами.
export function startLandscapeArray(mode = arr.mode) {
  const set = new Set(selectedIds());
  const objs = landscapeObjects().filter((o) => set.has(o.id) && !o.locked);
  // Растения короба, выбранные вместе с коробом, — едут с ним.
  const top = objs.filter((o) => !o.parent || !set.has(o.parent));
  if (!top.length) { toast(set.size ? 'Объект закреплён — снимите замок в свойствах' : 'Сначала выберите объект(ы) ландшафта'); return false; }
  const ext = groupExtent(top);
  arr.dx = round100(ext.w + 300);
  arr.dy = round100(ext.h + 300);
  arr.mode = MODES.some((m) => m.id === mode) ? mode : 'rect';
  setTool({ kind: 'ls-array', mode: arr.mode, ids: top.map((o) => o.id), points: [], cursor: null, center: null, preview: null }, HINT[arr.mode]);
  state.lsVertex = null;
  recompute();
  selectObject(state.selection); // панель «Массив» справа
  return true;
}

function paramsFor(tool, { live = true } = {}) {
  if (tool.mode === 'path') {
    const points = [...tool.points, ...(live && tool.cursor ? [tool.cursor] : [])];
    if (points.length < 2) return null;
    return { mode: 'path', points, step: arr.step, count: arr.byCount ? arr.count : 0, align: arr.align };
  }
  if (tool.mode === 'polar') {
    const center = tool.center || (live ? tool.cursor : null);
    if (!center) return null;
    return { mode: 'polar', center, radius: tool.center ? arr.pRadius : 0, count: arr.pCount, angle: arr.pAngle, align: arr.pAlign };
  }
  return { mode: 'rect', rows: arr.rows, cols: arr.cols, dx: arr.dx, dy: arr.dy };
}

function compute(tool, live) {
  const params = paramsFor(tool, { live });
  if (!params) return null;
  return buildArray(sourceObjects(tool.ids), topObjects(tool.ids), params);
}

function recompute() {
  const tool = state.tool;
  if (!isArrayTool()) return;
  tool.preview = compute(tool, true);
  const info = document.querySelector('#lsArInfo');
  if (info) info.textContent = infoText(tool.preview);
  const pts = document.querySelector('#lsArPts');
  if (pts) pts.textContent = String(tool.points.length);
  requestDraw();
}

// Копий = объектов результата / объектов группы (короб с растениями — одна копия).
const copiesOf = (res, ids) => Math.round((res?.objects.length || 0) / Math.max(1, sourceObjects(ids).length));

function infoText(res) {
  if (!res) return '—';
  return `${copiesOf(res, state.tool.ids)} копий · ${res.objects.length} объектов${res.positions.length >= ARRAY_MAX ? ' (предел)' : ''}`;
}

// Применить: копии одной записью истории, выделяется вся группа.
export function applyLandscapeArray() {
  const tool = state.tool;
  if (!isArrayTool()) return [];
  if (tool.mode === 'path' && tool.points.length < 2) { toast('Нарисуйте линию: минимум 2 точки'); return []; }
  if (tool.mode === 'polar' && !tool.center) { toast('Кликните центр круга на плане'); return []; }
  const res = compute(tool, false);
  const list = res?.objects || [];
  if (!list.length) { toast('Нет копий — проверьте шаг и количество'); return []; }
  const ids = tool.ids;
  const copies = copiesOf(res, ids);
  cancelTool();
  mutate(() => {
    landscapeObjects().push(...list);
    // Растения без своего короба в группе — пересадить/отвязать по месту.
    settleMoved(landscapeObjects(), list.map((o) => o.id));
  });
  const added = new Set(list.map((o) => o.id));
  selectLandscape([...ids, ...list.filter((o) => !o.parent || !added.has(o.parent)).map((o) => o.id)]);
  toast(`Массив: ${copies} копий · Ctrl+Z — отменить`);
  return list;
}

// Esc — выйти без изменений, выделение остаётся.
export function cancelLandscapeArray() {
  if (!isArrayTool()) return;
  const ids = state.tool.ids;
  cancelTool();
  selectLandscape(ids);
}

function setMode(mode) {
  const tool = state.tool;
  if (!isArrayTool() || tool.mode === mode) return;
  arr.mode = mode;
  tool.mode = mode;
  tool.points = [];
  tool.center = null;
  setHint(HINT[mode]);
  recompute();
  selectObject(state.selection);
}

// ------------------------------------------------------------ Мышь и клавиши

export function arrayHover(world, canvas, event) {
  const tool = state.tool;
  canvas.style.cursor = tool.mode === 'rect' ? 'default' : 'crosshair';
  if (tool.mode === 'rect' || (tool.mode === 'polar' && tool.center)) return true;
  tool.cursor = snapPoint(world, event?.shiftKey);
  recompute();
  return true;
}

export function arrayPointerDown(event, screen, world) {
  const tool = state.tool;
  let p = snapPoint(world, event.shiftKey);
  if (tool.mode === 'path') {
    // Первая точка рядом с опорной (≤ 16 px) — ровно в неё: копия на
    // оригинале не нужна (позиция оригинала пропускается).
    const base = groupBase(topObjects(tool.ids));
    const bs = worldToScreen(base.x, base.y);
    if (!tool.points.length && Math.hypot(bs.x - screen.x, bs.y - screen.y) <= 16) p = base;
    const last = tool.points[tool.points.length - 1];
    if (last) {
      const ls = worldToScreen(last.x, last.y);
      if (Math.hypot(ls.x - screen.x, ls.y - screen.y) < 4) return; // двойной клик
    }
    tool.points.push({ x: Math.round(p.x), y: Math.round(p.y) });
  } else if (tool.mode === 'polar') {
    tool.center = { x: Math.round(p.x), y: Math.round(p.y) };
    const base = groupBase(topObjects(tool.ids));
    arr.pRadius = Math.round(Math.hypot(base.x - tool.center.x, base.y - tool.center.y));
    tool.cursor = null;
    selectObject(state.selection); // радиус в панели
  }
  recompute();
}

export function arrayDblClick() {
  if (state.tool?.mode === 'path') applyLandscapeArray();
  return true;
}

export function handleArrayKey(event) {
  if (event.key === 'Enter') { event.preventDefault(); applyLandscapeArray(); return true; }
  if (event.key === 'Escape') { event.preventDefault(); cancelLandscapeArray(); return true; }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    const tool = state.tool;
    if (tool.mode === 'path') tool.points.pop();
    else if (tool.mode === 'polar') { tool.center = null; selectObject(state.selection); }
    recompute();
    return true;
  }
  // Прочие команды выделения (R, X, стрелки) — не во время массива.
  return ['KeyR', 'KeyX', 'KeyM'].includes(event.code) || event.key.startsWith('Arrow');
}

// ------------------------------------------------------------ Панель «Массив»

const num = (id, title, value, min, max, step = 1) => `<label class="prop-field"><span>${title}</span><input id="${id}" type="number" step="${step}" min="${min}" max="${max}" value="${value}"></label>`;

export function renderArrayProps(panel) {
  const tool = state.tool;
  const n = tool.ids.length;
  let fields;
  if (tool.mode === 'path') {
    fields = `
      <label class="check-row"><input type="checkbox" id="lsArByCount" ${arr.byCount ? 'checked' : ''}><span>По количеству (иначе — по шагу)</span></label>
      <div class="prop-grid">
        ${num('lsArStep', 'Шаг, мм', arr.step, 10, 100000, 100)}
        ${num('lsArCount', 'Количество', arr.count, 1, ARRAY_MAX)}
      </div>
      <label class="check-row"><input type="checkbox" id="lsArAlign" ${arr.align ? 'checked' : ''}><span>Поворачивать по направлению</span></label>
      <div class="prop-row"><span>Точек линии</span><strong id="lsArPts">${tool.points.length}</strong></div>
      <p class="hint">Кликайте точки линии на плане (Shift — без привязки). Копии ставятся опорной точкой (центр выделения, синяя точка) на линию, начиная с первой точки; первая точка рядом с ней прилипает к ней — оригинал не дублируется.</p>`;
  } else if (tool.mode === 'polar') {
    fields = `
      <div class="prop-row"><span>Центр</span><strong>${tool.center ? `${(tool.center.x / 1000).toFixed(2)}; ${(tool.center.y / 1000).toFixed(2)} м` : 'кликните на плане'}</strong></div>
      <div class="prop-grid">
        ${num('lsArRadius', 'Радиус, мм', arr.pRadius, 0, 200000, 100)}
        ${num('lsArPCount', 'Количество', arr.pCount, 1, ARRAY_MAX)}
      </div>
      ${num('lsArAngle', 'Угол дуги, ° (360 — круг)', arr.pAngle, -360, 360, 15)}
      <label class="check-row"><input type="checkbox" id="lsArPAlign" ${arr.pAlign ? 'checked' : ''}><span>Поворачивать вокруг центра</span></label>
      <p class="hint">Количество — вместе с оригиналом, если он на окружности. Угол + — по часовой.</p>`;
  } else {
    fields = `
      <div class="prop-grid">
        ${num('lsArRows', 'Рядов', arr.rows, 1, ARRAY_MAX)}
        ${num('lsArCols', 'Столбцов', arr.cols, 1, ARRAY_MAX)}
      </div>
      <div class="prop-grid">
        ${num('lsArDx', 'Шаг по X, мм', arr.dx, -100000, 100000, 100)}
        ${num('lsArDy', 'Шаг по Y, мм (вниз)', arr.dy, -100000, 100000, 100)}
      </div>
      <p class="hint">Оригинал — в левом верхнем углу; отрицательный шаг — в другую сторону.</p>`;
  }
  panel.innerHTML = `
    <h2>Массив</h2>
    <div class="prop-block" id="lsArray">
      <div class="prop-row"><span>Исходных объектов</span><strong>${n}</strong></div>
      <div class="seg" role="radiogroup" aria-label="Тип массива">
        ${MODES.map((m) => `<label class="seg-opt${m.id === tool.mode ? ' active' : ''}"><input type="radio" name="lsArMode" value="${m.id}" ${m.id === tool.mode ? 'checked' : ''}><span>${escapeHtml(m.title)}</span></label>`).join('')}
      </div>
      ${fields}
      <div class="prop-row"><span>Результат</span><strong id="lsArInfo">${infoText(tool.preview)}</strong></div>
      <div class="prop-grid">
        <button type="button" id="lsArApply" class="primary">Применить (Enter)</button>
        <button type="button" id="lsArCancel">Отмена (Esc)</button>
      </div>
    </div>`;
  panel.querySelectorAll('input[name="lsArMode"]').forEach((input) => input.addEventListener('change', (e) => setMode(e.target.value)));
  const bindNum = (id, key, lo, hi, int = true) => panel.querySelector(id)?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (e.target.value.trim() === '' || !Number.isFinite(v)) return;
    arr[key] = Math.min(hi, Math.max(lo, int ? Math.round(v) : v));
    recompute();
  });
  bindNum('#lsArStep', 'step', 10, 100000);
  bindNum('#lsArCount', 'count', 1, ARRAY_MAX);
  bindNum('#lsArRadius', 'pRadius', 0, 200000);
  bindNum('#lsArPCount', 'pCount', 1, ARRAY_MAX);
  bindNum('#lsArAngle', 'pAngle', -360, 360, false);
  bindNum('#lsArRows', 'rows', 1, ARRAY_MAX);
  bindNum('#lsArCols', 'cols', 1, ARRAY_MAX);
  bindNum('#lsArDx', 'dx', -100000, 100000);
  bindNum('#lsArDy', 'dy', -100000, 100000);
  const bindCheck = (id, key) => panel.querySelector(id)?.addEventListener('change', (e) => { arr[key] = e.target.checked; recompute(); });
  bindCheck('#lsArByCount', 'byCount');
  bindCheck('#lsArAlign', 'align');
  bindCheck('#lsArPAlign', 'pAlign');
  // Enter/Esc в поле панели (общий обработчик клавиш поля пропускает).
  panel.querySelector('#lsArray')?.addEventListener('keydown', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('input')); applyLandscapeArray(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelLandscapeArray(); }
  });
  panel.querySelector('#lsArApply')?.addEventListener('click', () => applyLandscapeArray());
  panel.querySelector('#lsArCancel')?.addEventListener('click', () => cancelLandscapeArray());
}

// ------------------------------------------------------------ Засадить

// Параметры засадки: до 4 видов с долями (%), шаг (0 — по кроне), разброс,
// отступ от края, seed (тот же — тот же рисунок).
const fill = {
  mix: [{ kind: 'flowers-clump', share: 100 }, { kind: '', share: 0 }, { kind: '', share: 0 }, { kind: '', share: 0 }],
  step: 0, jitter: 0.6, margin: 200, seed: 1,
};
export const fillOptions = fill;

const plantOpts = (value, empty) => `${empty ? `<option value="" ${value ? '' : 'selected'}>— нет —</option>` : ''}${FILL_PLANTS
  .map((k) => `<option value="${k}" ${k === value ? 'selected' : ''}>${escapeHtml(landscapeDef(k).title)}</option>`).join('')}`;

export function plantFillHtml(o) {
  if (!canFill(o) || o.locked) return '';
  const rows = fill.mix.map((m, i) => `
      <div class="prop-grid">
        <label class="prop-field"><span>${i ? `Вид ${i + 1}` : 'Растение'}</span><select id="lsPfKind${i}">${plantOpts(m.kind, i > 0)}</select></label>
        <label class="prop-field"><span>Доля, %</span><input id="lsPfShare${i}" type="number" min="0" max="100" step="5" value="${m.kind ? m.share : 0}"></label>
      </div>`).join('');
  return `
    <h3>Засадить</h3>
    <div class="prop-block" id="lsPlantFill">
      ${rows}
      <div class="prop-grid">
        ${num('lsPfStep', 'Шаг, мм (0 — по кроне)', fill.step, 0, 20000, 50)}
        ${num('lsPfMargin', 'Отступ от края, мм', fill.margin, 0, 5000, 50)}
      </div>
      <label class="prop-field"><span>Разброс (0 — ровно, 1 — естественно)</span><input id="lsPfJitter" type="range" min="0" max="1" step="0.05" value="${fill.jitter}"></label>
      <div class="prop-grid">
        ${num('lsPfSeed', 'Вариант (seed)', fill.seed, 1, 99999)}
        <button type="button" class="link" id="lsPfReseed">Другой вариант</button>
      </div>
      <button type="button" id="lsPfGo">Засадить</button>
      <p class="hint">Кроны не пересекаются и не выходят за контур; уже стоящие растения, дорожки и дом обходятся. Тот же вариант — тот же рисунок.${o.kind.startsWith('planter') ? ' В коробе — от внутренней грани борта (отступ не нужен), растения привязаны к коробу.' : ''}</p>
    </div>`;
}

function readFill(panel) {
  const q = (id) => panel.querySelector(id);
  fill.mix = fill.mix.map((m, i) => {
    const kind = q(`#lsPfKind${i}`)?.value ?? m.kind;
    const share = Number(q(`#lsPfShare${i}`)?.value);
    return { kind, share: Number.isFinite(share) ? Math.max(0, share) : m.share };
  });
  if (fill.mix[0].kind && !(fill.mix[0].share > 0) && !fill.mix.slice(1).some((m) => m.kind && m.share > 0)) fill.mix[0].share = 100;
  const n = (id, lo, hi, def) => {
    const v = Number(q(id)?.value);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  };
  fill.step = Math.round(n('#lsPfStep', 0, 20000, fill.step));
  fill.margin = Math.round(n('#lsPfMargin', 0, 5000, fill.margin));
  fill.jitter = n('#lsPfJitter', 0, 1, fill.jitter);
  fill.seed = Math.round(n('#lsPfSeed', 1, 99999, fill.seed));
}

export function bindPlantFill(panel, o) {
  if (!panel.querySelector('#lsPlantFill')) return;
  panel.querySelector('#lsPfGo')?.addEventListener('click', () => { readFill(panel); plantFillHost(o); });
  panel.querySelector('#lsPfReseed')?.addEventListener('click', () => {
    readFill(panel);
    fill.seed = (fill.seed % 99999) + 1;
    const seed = panel.querySelector('#lsPfSeed');
    if (seed) seed.value = fill.seed;
  });
}

// Засадить объект host: результат — отдельные растения, одна запись истории.
export function plantFillHost(host) {
  if (!canFill(host)) { toast('Засадить можно газон, клумбу или короб'); return []; }
  if (host.locked) { toast('Объект закреплён — снимите замок в свойствах'); return []; }
  const mix = fill.mix.filter((m) => m.kind && m.share > 0);
  if (!mix.length) { toast('Выберите растение'); return []; }
  const list = plantFillObject(landscapeObjects(), host, { mix, step: fill.step, jitter: fill.jitter, margin: fill.margin, seed: `${host.id}:${fill.seed}` }, houseFootprints(state.project));
  if (!list.length) { toast('Не помещается — уменьшите шаг, отступ или выберите растение мельче'); return []; }
  mutate(() => { landscapeObjects().push(...list); });
  selectLandscape([host.id]);
  toast(`Посажено: ${list.length} · Ctrl+Z — отменить`);
  return list;
}

// Кнопка «Засадить» панели выделения — с последними параметрами.
export function plantFillSelection() {
  const ids = selectedIds();
  const host = ids.length === 1 ? landscapeObjects().find((o) => o.id === ids[0]) : null;
  return plantFillHost(host);
}

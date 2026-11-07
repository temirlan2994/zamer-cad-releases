// Привязки черчения в интерфейсе: настройки (Орто, Полярка, Объекты,
// Выравнивание, Магнит, Направляющие — значки внизу холста, localStorage), сбор
// окружения для core/draw-snap.js (участок, дом, ландшафт), задержка
// наведения для «Параллели», динамический ввод длины/угла с клавиатуры.

import { DEFAULT_SNAP_OPTS, POLAR_STEPS, dynamicPoint, parseDynamicLength, snapDrawPoint } from '../core/draw-snap.js';
import { isPathShape, landscapeDef } from '../core/landscape.js';
import { houseFootprints } from '../core/landscape-tools.js';
import { state } from './state.js';
import { requestDraw } from './view.js';

const STORE_KEY = 'kepler-draw-snap';
const DWELL_MS = 700;

// ------------------------------------------------------------ Настройки

export function loadSnapSettings() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
  const s = { ...DEFAULT_SNAP_OPTS };
  if (saved && typeof saved === 'object') {
    for (const k of ['ortho', 'polar', 'objects', 'tracking', 'guides', 'magnet']) if (typeof saved[k] === 'boolean') s[k] = saved[k];
    if (POLAR_STEPS.includes(Number(saved.polarStep))) s.polarStep = Number(saved.polarStep);
  }
  state.snapSettings = s;
  return s;
}

function saveSnapSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.snapSettings)); } catch { /* хранилище недоступно */ }
}

export function snapSettings() {
  return state.snapSettings || loadSnapSettings();
}

export function setSnapSetting(key, value) {
  snapSettings()[key] = value;
  saveSnapSettings();
  renderSnapBar();
  rehoverSnap();
}

export function toggleOrtho() {
  setSnapSetting('ortho', !snapSettings().ortho);
}

// Панель привязок (#snapBar) — в строке состояния справа, слева от масштаба
// (как статус-бар AutoCAD): только значки; подсказка (.snap-tip) — своя, CSS,
// появляется сразу при наведении.
const svg = (body) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const BUTTONS = [
  {
    key: 'ortho', name: 'Орто', what: 'строго 0/90° от последней точки', keys: 'F8 · Ctrl — временно',
    icon: svg('<path d="M6 4v14h14"/><path d="M6 13h5v5"/>'),
  },
  {
    key: 'polar', name: 'Полярка', what: 'лучи от последней точки с шагом угла', keys: 'Shift — временно без привязок',
    icon: svg('<path d="M4 20h16"/><path d="M4 20L18 6"/><path d="M4 20l6-15"/><path d="M12 20a8 8 0 0 0-2.3-5.7"/>'),
  },
  {
    key: 'objects', name: 'Объекты', what: 'конец, середина, пересечение, центр, перпендикуляр, параллель', keys: 'Shift — временно без привязок',
    icon: svg('<rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>'),
  },
  {
    key: 'tracking', name: 'Выравнивание', what: 'линии по X/Y от вершин', keys: 'Shift — временно без привязок',
    icon: svg('<path d="M3 12h18" stroke-dasharray="2 3"/><path d="M12 3v18" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="2.2"/>'),
  },
  {
    key: 'magnet', name: 'Магнит блоков', what: 'прижимает помещение к соседу с зазором перегородки или по его грани (300 мм)', keys: 'Alt или Shift — временно выкл',
    icon: svg('<path d="M6 3h4v8a2 2 0 0 0 4 0V3h4v8a6 6 0 0 1-12 0z"/><path d="M6 7h4M14 7h4"/>'),
  },
  {
    key: 'guides', name: 'Направляющие', what: 'края и центры объектов липнут к соседям, стенам, дому и границе', keys: 'Shift — временно выкл',
    icon: svg('<rect x="3" y="7" width="7" height="7" rx="1"/><rect x="14" y="7" width="7" height="11" rx="1"/><path d="M1.5 4h21" stroke-dasharray="2 2.5"/>'),
  },
];

const tipHtml = (name, what, keys) => `<b>${name}</b> · ${what}${keys ? ` · <kbd>${keys}</kbd>` : ''}`;

function buildSnapBar(bar) {
  const n = BUTTONS.length + 1; // + шаг полярки после «Полярки»
  let i = 0;
  const edge = () => { i += 1; return i <= 2 ? ' tip-start' : (i > n - 2 ? ' tip-end' : ''); };
  bar.innerHTML = BUTTONS.map((b) => `<button type="button" class="snap-btn${edge()}" data-snap="${b.key}" aria-label="${b.name}" aria-pressed="false" aria-describedby="snapTip-${b.key}">${b.icon}<span class="snap-tip" role="tooltip" id="snapTip-${b.key}">${tipHtml(b.name, b.what, b.keys)}</span></button>`
    + (b.key === 'polar'
      ? `<button type="button" class="snap-btn snap-step${edge()}" id="snapPolarStep" data-snap-step aria-label="Шаг полярки" aria-describedby="snapTip-step"><span class="snap-step-val"></span><span class="snap-tip" role="tooltip" id="snapTip-step">${tipHtml('Шаг полярки', `угол между лучами: ${POLAR_STEPS.join(' / ')}°`, 'клик — следующий')}</span></button>`
      : '')).join('');
}

export function renderSnapBar() {
  const s = snapSettings();
  const bar = document.getElementById('snapBar');
  if (!bar) return;
  if (!bar.querySelector('[data-snap]')) buildSnapBar(bar);
  // Только классы и атрибуты: кнопка под курсором не пересоздаётся — подсказка не мигает.
  for (const btn of bar.querySelectorAll('[data-snap]')) {
    const on = Boolean(s[btn.dataset.snap]);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  const step = bar.querySelector('[data-snap-step]');
  if (step) {
    step.querySelector('.snap-step-val').textContent = `${s.polarStep}°`;
    step.classList.toggle('dim', !s.polar);
  }
}

export function bindSnapBar() {
  loadSnapSettings();
  const bar = document.getElementById('snapBar');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const stepBtn = e.target.closest('[data-snap-step]');
    if (stepBtn) {
      const k = POLAR_STEPS.indexOf(snapSettings().polarStep);
      setSnapSetting('polarStep', POLAR_STEPS[(k + 1) % POLAR_STEPS.length]);
      if (e.detail) stepBtn.blur(); // мышь: Enter/цифры дальше идут черчению
      return;
    }
    const btn = e.target.closest('[data-snap]');
    if (!btn) return;
    const key = btn.dataset.snap;
    setSnapSetting(key, !snapSettings()[key]);
    if (e.detail) btn.blur(); // мышь: Enter/цифры дальше идут черчению, а не кнопке
  });
  renderSnapBar();
}

// ------------------------------------------------------------ Окружение

// Линии, контуры, углы дома, граница, центры деревьев — для привязок.
// exclude: { landscapeId } или { siteKind, siteId } — правимый объект.
export function snapContext(exclude = {}) {
  const site = state.project?.site || {};
  const shapes = [];
  const circles = [];
  const skip = (kind, id) => exclude.siteKind === kind && (id === undefined || exclude.siteId === id);
  if (site.redLine?.length >= 2 && !skip('redline')) shapes.push({ points: site.redLine, closed: Boolean(site.redLineClosed) });
  for (const r of site.roads || []) if (r.points?.length >= 2 && !skip('road', r.id)) shapes.push({ points: r.points, closed: Boolean(r.closed) });
  for (const o of site.landscape?.objects || []) {
    if (o.id === exclude.landscapeId) continue;
    const def = landscapeDef(o.kind);
    if (isPathShape(def)) { if (o.points?.length) shapes.push({ points: o.points, closed: def.shape === 'poly' }); }
    else circles.push({ x: o.x, y: o.y });
  }
  let house;
  try { house = houseFootprints(state.project); } catch { house = []; }
  const boundary = site.boundary?.length >= 3 && !skip('boundary') ? site.boundary : null;
  return { shapes, circles, house, boundary };
}

// Вершина index тянется: оставшиеся части той же линии (без её рёбер).
export function chainsWithout(points, index, closed) {
  const n = points.length;
  if (closed) {
    const chain = [];
    for (let k = 1; k < n; k += 1) chain.push(points[(index + k) % n]);
    return chain.length ? [{ points: chain, closed: false }] : [];
  }
  return [points.slice(0, index), points.slice(index + 1)].filter((c) => c.length).map((c) => ({ points: c, closed: false }));
}

// Соседняя вершина — «последняя точка» для лучей при перетаскивании вершины.
export function dragPrev(points, index, closed) {
  const n = points.length;
  if (index > 0) return points[index - 1];
  if (closed && n > 2) return points[n - 1];
  return points[1] || null;
}

// ------------------------------------------------------------ Привязка

let dwell = null; // { key, since, seg } — отрезок под курсором
let parallelSeg = null; // выбранный задержкой отрезок для «Параллели»
let parallelPrev = null;
let dwellTimer = null;
let rehoverFn = null;
let lastMods = { shiftKey: false, ctrlKey: false };

export function setSnapRehover(fn) { rehoverFn = fn; }

// Пересчитать привязку на месте (смена Shift/Ctrl, настроек, задержка).
export function rehoverSnap(mods = null) {
  if (mods) lastMods = { ...lastMods, ...mods };
  if (rehoverFn) rehoverFn(lastMods);
}

const segKey = (s) => (s ? `${s.a.x},${s.a.y},${s.b.x},${s.b.y}` : '');

/**
 * Привязать точку инструмента. opts: prev, points, closed, exclude, extraShapes,
 * grid (мм, 0 — без сетки), objects (false — без объектных привязок).
 * Результат кладётся в state.drawSnap для отрисовки направляющих.
 */
export function snapAt(world, event, opts = {}) {
  const { prev = null, points = [], closed = false, exclude = {}, extraShapes = [], grid = 0, objects = true } = opts;
  if (event) lastMods = { shiftKey: Boolean(event.shiftKey), ctrlKey: Boolean(event.ctrlKey) };
  const s = snapSettings();
  const prevKey = prev ? `${prev.x},${prev.y}` : '';
  if (prevKey !== parallelPrev) { parallelSeg = null; parallelPrev = prevKey; }
  const ctx = snapContext(exclude);
  const res = snapDrawPoint({
    cursor: world, prev, points, closed,
    otherShapes: [...ctx.shapes, ...extraShapes], houseCorners: ctx.house, boundary: ctx.boundary, circles: ctx.circles,
    scale: state.view.scale, grid, axis: -(state.view.rotation || 0), hoverSeg: parallelSeg,
    opts: {
      ortho: s.ortho, polar: s.polar, polarStep: s.polarStep, objects: s.objects && objects, tracking: s.tracking,
      free: lastMods.shiftKey, tempOrtho: lastMods.ctrlKey,
    },
  });
  // «Параллель»: курсор задержался над отрезком — он запоминается.
  if (prev && res.nearSeg && s.objects) {
    const key = segKey(res.nearSeg);
    const now = Date.now();
    if (dwell?.key !== key) {
      dwell = { key, since: now, seg: res.nearSeg };
      clearTimeout(dwellTimer);
      dwellTimer = setTimeout(() => { if (dwell?.key === key) rehoverSnap(); }, DWELL_MS + 30);
    } else if (now - dwell.since >= DWELL_MS && segKey(parallelSeg) !== key) {
      parallelSeg = dwell.seg;
    }
  } else if (!res.nearSeg) {
    dwell = null;
  }
  state.drawSnap = { ...res, prev };
  return res;
}

export function clearDrawSnap() {
  state.drawSnap = null;
  state.dynInput = null;
  dwell = null;
  parallelSeg = null;
  clearTimeout(dwellTimer);
}

// ------------------------------------------------------------ Динамический ввод

const DIGIT = /^[0-9.,]$/;

// Ввод с клавиатуры во время черчения. prev — последняя точка (null — ввод
// недоступен). commit(point) ставит точку. true — клавиша обработана.
export function handleDynamicKey(event, prev, commit) {
  if (!prev || event.ctrlKey || event.metaKey || event.altKey) return false;
  const d = state.dynInput;
  const field = d?.field || 'length';
  if (DIGIT.test(event.key) || (event.key === '-' && field === 'angle')) {
    event.preventDefault();
    const next = d || { field: 'length', length: '', angle: '' };
    next[next.field] += event.key;
    state.dynInput = next;
    requestDraw();
    return true;
  }
  if (!d) {
    if (event.key === 'Tab') {
      event.preventDefault();
      state.dynInput = { field: 'angle', length: '', angle: '' };
      requestDraw();
      return true;
    }
    return false;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    d.field = d.field === 'length' ? 'angle' : 'length';
    requestDraw();
    return true;
  }
  if (event.key === 'Backspace') {
    event.preventDefault();
    d[d.field] = d[d.field].slice(0, -1);
    if (!d.length && !d.angle) state.dynInput = null;
    requestDraw();
    return true;
  }
  if (event.key === 'Escape') {
    state.dynInput = null;
    requestDraw();
    return true;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const units = state.project?.settings?.units === 'm' ? 'm' : 'mm';
    const length = parseDynamicLength(d.length, units);
    if (!length) { requestDraw(); return true; }
    const angle = d.angle.trim() ? Number(d.angle.replace(',', '.')) : null;
    const point = dynamicPoint({
      prev, toward: state.drawSnap?.point || null, length, angle, axis: -(state.view.rotation || 0),
    });
    state.dynInput = null;
    if (point) commit({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 });
    rehoverSnap();
    requestDraw();
    return true;
  }
  return false;
}

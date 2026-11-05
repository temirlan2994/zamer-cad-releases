// Привязки черчения в интерфейсе: настройки (Орто, Полярка, Объекты,
// Выравнивание — мини-панель в строке состояния, localStorage), сбор
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
    for (const k of ['ortho', 'polar', 'objects', 'tracking']) if (typeof saved[k] === 'boolean') s[k] = saved[k];
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

const BUTTONS = [
  { key: 'ortho', text: 'Орто', title: 'Орто: строго 0/90° от последней точки (F8; удерживать Ctrl — временно)' },
  { key: 'polar', text: 'Полярка', title: 'Полярное отслеживание: лучи от последней точки с шагом угла' },
  { key: 'objects', text: 'Объекты', title: 'Объектная привязка: конец, середина, пересечение, центр, перпендикуляр, параллель' },
  { key: 'tracking', text: 'Выравнивание', title: 'Отслеживание: линии выравнивания по X/Y от вершин' },
];

export function renderSnapBar() {
  const bar = document.getElementById('snapBar');
  if (!bar) return;
  const s = snapSettings();
  bar.title = 'Привязки при черчении линий · Shift — временно без привязок · во время черчения наберите число и Enter — длина, Tab — угол';
  bar.innerHTML = BUTTONS.map((b) => `<button type="button" class="snap-btn${s[b.key] ? ' on' : ''}" data-snap="${b.key}" aria-pressed="${s[b.key]}" title="${b.title}">${b.text}</button>`
    + (b.key === 'polar'
      ? `<select class="snap-step" id="snapPolarStep" title="Шаг полярных лучей">${POLAR_STEPS.map((v) => `<option value="${v}"${v === s.polarStep ? ' selected' : ''}>${v}°</option>`).join('')}</select>`
      : '')).join('');
}

export function bindSnapBar() {
  loadSnapSettings();
  const bar = document.getElementById('snapBar');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-snap]');
    if (!btn) return;
    const key = btn.dataset.snap;
    setSnapSetting(key, !snapSettings()[key]);
    btn.blur(); // Enter/цифры дальше идут черчению, а не кнопке
  });
  bar.addEventListener('change', (e) => {
    if (e.target.id !== 'snapPolarStep') return;
    setSnapSetting('polarStep', Number(e.target.value));
    e.target.blur();
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

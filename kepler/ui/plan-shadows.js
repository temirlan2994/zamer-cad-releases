// Тени на плане этажа (геометрия — core/plan-shadows.js). Слой рисуется один
// раз в отдельный холст в осях дома — в уменьшенном разрешении (тень мягкая,
// резкость не нужна), с размытием — и в кадре кладётся одной картинкой:
// чёрное с прозрачностью (то же, что умножение на серый, но заметно дешевле),
// без сглаживания, пока точка слоя не крупнее трёх точек экрана. Места стен в
// слое прозрачные — сами стены не темнеют.
//
// Слой перестраивается, когда меняются стены, мебель, этаж, тема или свет, или
// масштаб — заметно (в 1,7 раза). Пока палец или мышь нажаты (тянут комнату,
// щипок), — не перестраивается: старый слой, новый — когда отпустили. Без
// нажатия (отмена, клавиши) — не чаще раза в 140 мс. Сдвиг плана слой не
// перестраивает.
//
// Включает тени настройка вида «Освещение» (core/view-display.js: тени, свет,
// длина — у каждого плана этажа свои); только на экране: листы и экспорт —
// без теней. Пока тянут комнату или мебель, тени нет (старая отставала бы),
// новая — когда отпустили. planShadowPref — общий выключатель этого браузера
// (тесты выключают тени, чтобы проверки цвета пикселей от них не зависели).

import { planShadowDir, shadowBounds, shadowCasters, shadowKey, shadowStrips } from '../core/plan-shadows.js';
import { FIXED_SHADOW_DIR, SHADOW_LENGTH_K } from '../core/view-display.js';
import { activeLevel } from '../core/model.js';
import { landscapeShadow } from './render-landscape.js';
import { state } from './state.js';

const KEY = 'kepler-plan-shadows';
export const PLAN_SHADOW_DEFAULT = Object.freeze({ on: true });

export function normalizePlanShadow(v) {
  return { on: typeof v?.on === 'boolean' ? v.on : PLAN_SHADOW_DEFAULT.on };
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* только на сессию */ }
}

export function planShadowPref() {
  if (!state.planShadow) state.planShadow = normalizePlanShadow(read());
  return state.planShadow;
}

export function setPlanShadowPref(patch) {
  state.planShadow = normalizePlanShadow({ ...planShadowPref(), ...patch });
  write(state.planShadow);
  return state.planShadow;
}

const QUALITY = 0.6; // плотность слоя: точек на CSS-пиксель (плотность экрана — не больше 2)
const MAX_SIDE = 1400; // предел стороны слоя, px
const MIN_GAP = 140; // мс между перестройками, пока план меняется
const ZOOM_SLACK = 1.7; // во сколько раз может разойтись масштаб, пока слой годится

let cache = null; // { canvas, x, y, w, h, ppm, want, key, level, builtAt }
let layer = null;
let scratch = null;
let tiny = null;
let timer = 0;
const pointers = new Set(); // нажатые пальцы и кнопки мыши
let pending = false; // слой устарел, пока было нажатие

function trackPointers() {
  if (trackPointers.done || typeof window === 'undefined') return;
  trackPointers.done = true;
  window.addEventListener('pointerdown', (e) => pointers.add(e.pointerId), true);
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size && pending) { pending = false; later(0); }
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', () => { pointers.clear(); if (pending) { pending = false; later(0); } });
}

const canvasOf = (cv, w, h) => {
  const c = cv || document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
};
const gray = (v) => {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${g},${g},${g})`;
};

function later(ms) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = 0;
    import('./view.js').then((m) => m.requestDraw());
  }, Math.max(16, ms));
}

// Серый слой (белый — без тени) → чёрное с прозрачностью 1 − серый.
function toAlphaMask(cv) {
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = 255 - d[i];
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
  }
  g.putImageData(img, 0, 0);
}

// Размытие слоя: filter у холста, где он есть; иначе — уменьшить и растянуть
// обратно со сглаживанием (грубее, но везде и дёшево).
function blur(cv, r) {
  if (r < 0.6) return;
  const { width: w, height: h } = cv;
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  const probe = canvasOf(scratch, w, h).getContext('2d');
  scratch = probe.canvas;
  if ('filter' in probe) {
    probe.setTransform(1, 0, 0, 1, 0, 0);
    probe.globalCompositeOperation = 'copy';
    probe.filter = `blur(${r.toFixed(1)}px)`;
    probe.drawImage(cv, 0, 0);
    probe.filter = 'none';
    g.globalCompositeOperation = 'copy';
    g.drawImage(scratch, 0, 0);
  } else {
    const s = Math.max(2, Math.round(r / 1.5));
    tiny = canvasOf(tiny, Math.max(1, Math.ceil(w / s)), Math.max(1, Math.ceil(h / s)));
    const q = tiny.getContext('2d');
    q.imageSmoothingEnabled = true;
    q.globalCompositeOperation = 'copy';
    q.drawImage(cv, 0, 0, tiny.width, tiny.height);
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'copy';
    g.drawImage(tiny, 0, 0, w, h);
  }
  g.globalCompositeOperation = 'source-over';
}

function build({ casters, dir, want, dark, key, level }) {
  const b = shadowBounds(casters, dir);
  const longest = Math.max(...casters.map((c) => c.len));
  const blurMm = 40 + longest * 0.14;
  const pad = blurMm * 2.5;
  const x0 = b.minX - pad;
  const y0 = b.minY - pad;
  const wMm = b.maxX - b.minX + pad * 2;
  const hMm = b.maxY - b.minY + pad * 2;
  const ppm = Math.min(want, MAX_SIDE / Math.max(wMm, hMm));
  const W = Math.max(1, Math.ceil(wMm * ppm));
  const H = Math.max(1, Math.ceil(hMm * ppm));
  layer = canvasOf(layer, W, H);
  const g = layer.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff'; // белый при умножении ничего не меняет
  g.fillRect(0, 0, W, H);
  g.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -y0 * ppm);
  g.globalCompositeOperation = 'darken'; // перекрытия — по самой тёмной, не вдвойне
  const path = (pts) => {
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
  };
  // Мебель «стоит» на полу: мягкая тень вокруг (после размытия — ореол у краёв).
  const halo = gray(dark ? 0.72 : 0.82);
  g.fillStyle = halo;
  g.beginPath();
  for (const c of casters) if (c.halo) path(c.halo);
  g.fill();
  for (const c of casters) {
    const v0 = c.kind === 'wall' ? (dark ? 0.5 : 0.6) : (dark ? 0.55 : 0.64);
    const near = gray(v0);
    const mid = gray(v0 + (1 - v0) * 0.55);
    for (const s of shadowStrips(c.poly, dir, c.len)) {
      const grad = g.createLinearGradient(s.from.x, s.from.y, s.to.x, s.to.y);
      grad.addColorStop(0, near);
      grad.addColorStop(0.4, mid);
      grad.addColorStop(1, '#fff');
      g.fillStyle = grad;
      g.beginPath();
      path(s.quad);
      g.fill();
    }
  }
  blur(layer, blurMm * ppm);
  // Места стен — белые: сами стены (и выбранная) не темнеют.
  g.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -y0 * ppm);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff';
  g.beginPath();
  for (const c of casters) if (c.kind === 'wall') path(c.poly);
  g.fill();
  toAlphaMask(layer);
  const stats = state._planShadow || (state._planShadow = { builds: 0, ms: 0 });
  stats.builds += 1;
  return { canvas: layer, x: x0, y: y0, w: W / ppm, h: H / ppm, ppm, want, key, level, builtAt: performance.now() };
}

// Рисует тени на плане: ctx — в осях дома (как стены). items — мебель, если
// она на плане видна. dark — тёмная тема холста. display — настройки вида
// (core/view-display.js): light ('sun' | 'fixed'), length.
export function drawPlanShadows(ctx, { walls, items = [], dpr = 1, scale, dark = false, display = {} }) {
  if (!planShadowPref().on || !state.project) return;
  trackPointers();
  const t0 = performance.now();
  const project = state.project;
  const fixed = display.light === 'fixed';
  const light = fixed ? { ...FIXED_SHADOW_DIR, k: 0.3 } : landscapeShadow(project.site);
  const dir = fixed ? { ...FIXED_SHADOW_DIR } : planShadowDir(light, project.building);
  const casters = shadowCasters(walls, items, {
    wallHeight: activeLevel(project)?.height || 3000, k: light.k ?? 0.3, lengthK: SHADOW_LENGTH_K[display.length] || 1,
  });
  if (!casters.length) return;
  const level = project.activeLevel;
  const key = shadowKey(casters, `${level}|${dark ? 1 : 0}|${Math.round(dir.x * 1000)},${Math.round(dir.y * 1000)}`);
  const want = Math.max(1e-4, scale * Math.min(dpr, 2) * QUALITY);
  // Слой годится, пока масштаб разошёлся не больше чем в ZOOM_SLACK раз (сравниваем
  // с запрошенным при построении: слой, урезанный по MAX_SIDE, не перестраивается зря).
  const fits = cache && cache.want <= want * ZOOM_SLACK && cache.want * ZOOM_SLACK >= want;
  if (!cache || cache.key !== key || !fits) {
    const since = cache ? performance.now() - cache.builtAt : Infinity;
    // Другой этаж — сразу; нажатие — после него, а пока тянут — без тени (старая
    // отстаёт); иначе — не чаще MIN_GAP, последний раз — по таймеру.
    if (!cache || cache.level !== level) cache = build({ casters, dir, want, dark, key, level });
    else if (pointers.size) {
      pending = true;
      if (cache.key !== key) { // геометрия меняется под пальцем — тень спрятана
        (state._planShadow || (state._planShadow = { builds: 0, ms: 0 })).hidden = true;
        return;
      }
    } else if (since >= MIN_GAP) cache = build({ casters, dir, want, dark, key, level });
    else later(MIN_GAP - since);
  }
  ctx.save();
  // Точка слоя ≤ 3 точек экрана — без сглаживания (тень и так размыта; растяжение со
  // сглаживанием в разы дороже). Сильно приблизили — со сглаживанием, без ступенек.
  ctx.imageSmoothingEnabled = (scale * dpr) / cache.ppm > 3;
  ctx.drawImage(cache.canvas, cache.x, cache.y, cache.w, cache.h);
  ctx.restore();
  const stats = state._planShadow || (state._planShadow = { builds: 0, ms: 0 });
  stats.ms = performance.now() - t0;
  stats.hidden = false;
}

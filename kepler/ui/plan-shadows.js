// Тени на плане этажа (геометрия — core/plan-shadows.js: стены, колонны и
// объёмы мебели, длина — по высоте). Слой рисуется один раз в отдельный холст
// в осях дома — в уменьшенном разрешении, двумя слоями (длинная мягкая тень и
// тёмная тень касания у основания) — и в кадре кладётся одной картинкой:
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

import {
  castShadow, contactLength, planShadowDir, shadowBounds, shadowCasters, shadowKey, shadowScale, shadowStrips,
} from '../core/plan-shadows.js';
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

// Карточка может рисоваться между двумя кадрами перетаскивания.
const caches = { plan: null, thumbnail: null };
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

// Тени двумя слоями: длинная — мягкая, светлеет к концу; касания — короткая,
// тёмная, почти резкая, у основания стоящих на полу объёмов; итог — темнее из
// двух. Основания залиты тенью до размытия, поэтому самая тёмная тень — прямо
// у стены, а не отступив от неё (иначе стены будто парят над полом).
const TONES = {
  light: { wall: [0.6, 0.38], item: [0.7, 0.52], lifted: 0.8 },
  dark: { wall: [0.48, 0.28], item: [0.58, 0.4], lifted: 0.7 },
};
const SOFT_MM = (longest) => 20 + Math.min(longest, 5000) * 0.07; // размытие длинной тени
const SHARP_MM = 12; // размытие тени касания

function trace(g, pts) {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}

function paint(g, { casters, dir, s, ppm, x0, y0, W, H, tones, contact }) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff'; // белый — без тени
  g.fillRect(0, 0, W, H);
  g.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -y0 * ppm);
  g.globalCompositeOperation = 'darken'; // перекрытия — по самой тёмной, не вдвойне
  for (const c of casters) {
    const lifted = c.z0 > 0;
    if (contact && lifted) continue; // у поднятого (спинка, столешница) касания нет
    const [main, touch] = tones[c.kind === 'wall' ? 'wall' : 'item'];
    const v = contact ? touch : lifted ? tones.lifted : main;
    const shadow = contact ? { base: c.poly, len: contactLength(c, s) } : castShadow(c, dir, s);
    if (!(shadow.len > 0)) continue;
    const near = gray(v);
    if (!lifted && c.kind !== 'wall') { // тело стены маскируется ниже; его единый контур не нужно заливать как комнату
      g.fillStyle = near;
      g.beginPath();
      trace(g, c.poly);
      g.fill();
    }
    const mid = gray(v + (1 - v) * (contact ? 0.6 : 0.5));
    for (const st of shadowStrips(shadow.base, dir, shadow.len)) {
      const grad = g.createLinearGradient(st.from.x, st.from.y, st.to.x, st.to.y);
      grad.addColorStop(0, near);
      grad.addColorStop(contact ? 0.5 : 0.35, mid);
      grad.addColorStop(1, '#fff');
      g.fillStyle = grad;
      g.beginPath();
      trace(g, st.quad);
      g.fill();
    }
  }
}

let contactLayer = null;

function build({ casters, dir, s, want, dark, key, level }, previousLayer) {
  const b = shadowBounds(casters, dir, s);
  const longest = Math.max(...casters.map((c) => c.z1 * s));
  const softMm = SOFT_MM(longest);
  const pad = softMm * 2.5 + 20;
  const x0 = b.minX - pad;
  const y0 = b.minY - pad;
  const wMm = b.maxX - b.minX + pad * 2;
  const hMm = b.maxY - b.minY + pad * 2;
  const ppm = Math.min(want, MAX_SIDE / Math.max(wMm, hMm));
  const W = Math.max(1, Math.ceil(wMm * ppm));
  const H = Math.max(1, Math.ceil(hMm * ppm));
  const layer = canvasOf(previousLayer, W, H);
  contactLayer = canvasOf(contactLayer, W, H);
  const g = layer.getContext('2d');
  const q = contactLayer.getContext('2d');
  const opts = { casters, dir, s, ppm, x0, y0, W, H, tones: dark ? TONES.dark : TONES.light };
  paint(g, { ...opts, contact: false });
  blur(layer, softMm * ppm);
  paint(q, { ...opts, contact: true });
  blur(contactLayer, SHARP_MM * ppm);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'darken';
  g.drawImage(contactLayer, 0, 0);
  // Места стен — белые: сами стены (и выбранная) не темнеют.
  g.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -y0 * ppm);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff';
  g.beginPath();
  for (const c of casters) if (c.kind === 'wall' && c.unionKind !== 'poly') trace(g, c.poly);
  // Контуры объединённых стен включают внутренние дворы. evenodd вырезает
  // их из маски и не превращает пол комнаты в белое «слепое» пятно.
  g.fill('evenodd');
  // Косые стены могут пересекать ортогональный контур. Их добавляем к маске
  // отдельно, иначе evenodd вырезал бы отверстие в месте нахлёста.
  for (const c of casters) if (c.kind === 'wall' && c.unionKind === 'poly') {
    g.beginPath(); trace(g, c.poly); g.fill();
  }
  toAlphaMask(layer);
  return { canvas: layer, x: x0, y: y0, w: W / ppm, h: H / ppm, ppm, want, key, level, builtAt: performance.now() };
}

// Рисует тени на плане: ctx — в осях дома (как стены). items — мебель, если
// она на плане видна. dark — тёмная тема холста. display — настройки вида
// (core/view-display.js): light ('sun' | 'fixed'), length. Для фоновой
// миниатюры project передаётся явно, а force обходит локальный выключатель и
// задержки во время жеста: карточка должна сразу получить законченный кадр.
export function drawPlanShadows(ctx, {
  walls, items = [], dpr = 1, scale, dark = false, display = {},
  project = state.project, force = false,
}) {
  if ((!force && !planShadowPref().on) || !project) return;
  if (!force) trackPointers();
  const t0 = performance.now();
  const fixed = display.light === 'fixed';
  const light = fixed ? { ...FIXED_SHADOW_DIR, k: 0.3 } : landscapeShadow(project.site);
  const dir = fixed ? { ...FIXED_SHADOW_DIR } : planShadowDir(light, project.building);
  const s = shadowScale(light.k ?? 0.3, SHADOW_LENGTH_K[display.length] || 1);
  const casters = shadowCasters(walls, items, { wallHeight: activeLevel(project)?.height || 3000 });
  if (!casters.length) return;
  const level = project.activeLevel;
  const key = shadowKey(casters, `${level}|${dark ? 1 : 0}|${Math.round(dir.x * 1000)},${Math.round(dir.y * 1000)}|${Math.round(s * 1000)}`);
  const want = Math.max(1e-4, scale * Math.min(dpr, 2) * QUALITY);
  const target = force ? 'thumbnail' : 'plan';
  let cache = caches[target];
  // Слой годится, пока масштаб разошёлся не больше чем в ZOOM_SLACK раз (сравниваем
  // с запрошенным при построении: слой, урезанный по MAX_SIDE, не перестраивается зря).
  const fits = cache && cache.want <= want * ZOOM_SLACK && cache.want * ZOOM_SLACK >= want;
  if (!cache || cache.key !== key || !fits) {
    const since = cache ? performance.now() - cache.builtAt : Infinity;
    // Другой этаж — сразу; нажатие — после него, а пока тянут — без тени (старая
    // отстаёт); иначе — не чаще MIN_GAP, последний раз — по таймеру.
    const waitForGesture = !force && cache?.level === level;
    if (waitForGesture && pointers.size) {
      pending = true;
      if (cache.key !== key) { // геометрия меняется под пальцем — тень спрятана
        (state._planShadow || (state._planShadow = { builds: 0, ms: 0 })).hidden = true;
        return;
      }
    } else if (waitForGesture && since < MIN_GAP) later(MIN_GAP - since);
    else {
      cache = build({ casters, dir, s, want, dark, key, level }, cache?.canvas);
      caches[target] = cache;
      if (!force) {
        const stats = state._planShadow || (state._planShadow = { builds: 0, ms: 0 });
        stats.builds += 1;
      }
    }
  }
  ctx.save();
  // Точка слоя ≤ 3 точек экрана — без сглаживания (тень и так размыта; растяжение со
  // сглаживанием в разы дороже). Сильно приблизили — со сглаживанием, без ступенек.
  ctx.imageSmoothingEnabled = (scale * dpr) / cache.ppm > 3;
  ctx.drawImage(cache.canvas, cache.x, cache.y, cache.w, cache.h);
  ctx.restore();
  if (force) return;
  const stats = state._planShadow || (state._planShadow = { builds: 0, ms: 0 });
  stats.ms = performance.now() - t0;
  stats.hidden = false;
}

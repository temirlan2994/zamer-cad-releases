// Инструменты эскизной графики ландшафта: палитры стилей, кеш спрайтов
// (кроны, тени) и текстур-узоров (газон, гравий, цветник, вода).
//
// Стили: 'sketch' — «маркер/акварель» (приглушённые краски, тонкая чёрная
// графика), 'drawing' — монохромный чертёж для печати. Тема: светлая/тёмная.
// Сложная графика рисуется один раз в offscreen-canvas по ключу и потом
// ставится drawImage — случайности не пересчитываются каждый кадр.

import { LS_COLORS, seededRandom } from '../core/landscape.js';

export const TAU = Math.PI * 2;

export const LS_STYLES = [
  { id: 'sketch', title: 'Эскиз' },
  { id: 'drawing', title: 'Чертёж' },
];

// ------------------------------------------------------------ Цвет

const rgbCache = new Map();
export function rgbOf(c) {
  let v = rgbCache.get(c);
  if (v) return v;
  const s = String(c).trim();
  if (s[0] === '#') {
    const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  } else {
    const m = s.match(/[\d.]+/g);
    v = m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  }
  if (v.some((x) => !Number.isFinite(x))) v = [128, 128, 128];
  rgbCache.set(c, v);
  return v;
}
const hex2 = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
export const hexOf = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export function mix(a, b, t) {
  const p = rgbOf(a); const q = rgbOf(b);
  return hexOf([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}
export function rgba(c, alpha) {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r},${g},${b},${alpha})`;
}
export function luminance(c) {
  const [r, g, b] = rgbOf(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Палитра стиля: c(color) — краска в этом стиле/теме, P — LS_COLORS в нём же,
// ink — цвет графики (контуры, ветви), paper — «белое» (дом, бумага).
const palettes = new Map();
export function lsPalette(style = 'sketch', dark = false) {
  const key = `${style}:${dark ? 1 : 0}`;
  let pal = palettes.get(key);
  if (pal) return pal;
  const memo = new Map();
  let map;
  if (style === 'drawing') {
    map = (c) => {
      const L = luminance(c);
      const v = dark ? 34 + L * 40 : 206 + L * 46;
      return hexOf([v, v, v]);
    };
  } else if (dark) {
    // Тёмная тема: те же краски, притушенные к тёмному холсту.
    map = (c) => mix(c, '#1e2427', 0.4);
  } else {
    map = (c) => c;
  }
  const c = (color) => {
    if (!color) return color;
    let v = memo.get(color);
    if (!v) { v = map(color); memo.set(color, v); }
    return v;
  };
  const P = {};
  for (const [k, list] of Object.entries(LS_COLORS)) P[k] = list.map(c);
  const mono = style === 'drawing';
  pal = {
    style, dark, mono, c, P,
    ink: mono ? (dark ? '#d9ddd6' : '#1c1d1d') : (dark ? '#0d1110' : '#262a26'),
    paper: dark ? (mono ? '#23282b' : '#e4e2dc') : '#fbfaf7',
    shadow: dark ? '#050807' : '#4c5a4e',
    // Газон-основа участка.
    ground: mono ? (dark ? '#262b2e' : '#ffffff') : c(LS_COLORS.lawn[0]),
  };
  palettes.set(key, pal);
  return pal;
}

// ------------------------------------------------------------ Хеш и случайность

export function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ------------------------------------------------------------ Кеш

// Бюджет — по суммарной площади (пикселях), а не по числу спрайтов: при
// активном зуме число спрайтов мало что значит, а память canvas (4 байта на
// пиксель, вне JS-кучи) на телефоне роняет вкладку. Вытеснение — LRU.
// 60 Мпикс ≈ 240 МБ на компьютере, на телефоне/планшете — 24 Мпикс ≈ 96 МБ.
const SPRITE_MAX_SIDE = 1400;
const SPRITE_MAX_AREA = 1_300_000;
const DESKTOP_BUDGET = 60_000_000;
const MOBILE_BUDGET = 24_000_000;
const PATTERN_BUDGET = 16_000_000; // узоры физического размера (до 1024² каждый)

function defaultBudget() {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const lowMem = typeof navigator !== 'undefined' && navigator.deviceMemory > 0 && navigator.deviceMemory <= 4;
    return coarse || lowMem ? MOBILE_BUDGET : DESKTOP_BUDGET;
  } catch {
    return DESKTOP_BUDGET;
  }
}

let budget = null; // вычисляется при первом обращении (в Node нет matchMedia)
const sprites = new Map(); // key → canvas; порядок вставки = порядок LRU
let spritePixels = 0;
const stats = { hits: 0, misses: 0, evicted: 0 };
export const spriteStats = () => ({ ...stats, size: sprites.size, pixels: spritePixels, budget: spriteBudget() });

export function spriteBudget() {
  if (budget === null) budget = defaultBudget();
  return budget;
}

// Для тестов и отладки: задать бюджет (пикс.) и сразу ужаться под него.
export function setSpriteBudget(px) {
  budget = px > 0 ? px : defaultBudget();
  trimSprites();
}

const areaOf = (cv) => (cv?.width || 0) * (cv?.height || 0);

// reserve — сколько пикселей нужно освободить под будущий спрайт.
function trimSprites(reserve = 0) {
  const max = spriteBudget();
  while (spritePixels + reserve > max && sprites.size) {
    const [oldKey, oldCv] = sprites.entries().next().value;
    sprites.delete(oldKey);
    spritePixels -= areaOf(oldCv);
    stats.evicted += 1;
    // Холст не обнуляем: вызывающий мог получить его в этом же кадре и ещё
    // не нарисовать (drawImage холста 0×0 бросает исключение).
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return null;
}

// Спрайт по ключу: draw(ctx) рисует в пиксельных координатах w×h.
export function cachedSprite(key, w, h, draw) {
  let s = sprites.get(key);
  if (s) {
    stats.hits += 1;
    sprites.delete(key); sprites.set(key, s); // LRU
    return s;
  }
  stats.misses += 1;
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  // Огромный спрайт (сильное приближение) дороже прямой отрисовки и съедает
  // память: вызывающий рисует вектором или пропускает.
  if (cw > SPRITE_MAX_SIDE || ch > SPRITE_MAX_SIDE || cw * ch > SPRITE_MAX_AREA) return null;
  s = makeCanvas(cw, ch);
  if (!s) return null;
  const g = s.getContext('2d');
  draw(g, cw, ch);
  // Место под новый — вытеснением самых давних; новый встаёт последним.
  trimSprites(cw * ch);
  sprites.set(key, s);
  spritePixels += cw * ch;
  return s;
}

// Сброс кешей: смена темы или стиля графики (ключи старых спрайтов больше
// не запрашиваются, а память держат).
export function clearLandscapeSprites() {
  sprites.clear();
  spritePixels = 0;
  patterns.clear();
  patternPixels = 0;
}

// Квант размера: спрайты отличаются шагом ~9 % (незаметно при растяжении).
export function sizeBucket(px) {
  const b = Math.round(Math.log(Math.max(px, 2)) / Math.log(1.09));
  return { b, px: 1.09 ** b };
}

// ------------------------------------------------------------ Узоры (текстуры)

const patterns = new Map();
let patternPixels = 0;
const hasMatrix = typeof DOMMatrix !== 'undefined';

// Узор, привязанный к миру: тайл в экранных пикселях (одинаковое зерно при
// любом масштабе), но сдвигается вместе с участком. k — device px на мм.
export function grainPattern(ctx, name, pal, k, draw, tile = 128) {
  const key = `${name}:${pal.style}:${pal.dark ? 1 : 0}`;
  let p = patterns.get(key);
  if (!p) {
    const cv = makeCanvas(tile, tile);
    if (!cv) return null;
    draw(cv.getContext('2d'), tile, seededRandom(key));
    p = { cv, pat: null };
    patterns.set(key, p);
    patternPixels += tile * tile;
  }
  const pat = ctx.createPattern(p.cv, 'repeat');
  if (pat && hasMatrix && pat.setTransform) pat.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]));
  return pat;
}

// Узор с физическим размером тайла (мм): перерисовывается по шагам масштаба ×2.
export function physicalPattern(ctx, name, pal, k, tileMM, draw) {
  const level = Math.round(Math.log2(Math.max(k * tileMM, 16)));
  const px = Math.min(1024, 2 ** level);
  const key = `${name}:${pal.style}:${pal.dark ? 1 : 0}:${px}`;
  let p = patterns.get(key);
  if (!p) {
    const cv = makeCanvas(px, px);
    if (!cv) return null;
    const g = cv.getContext('2d');
    g.scale(px / tileMM, px / tileMM);
    draw(g, tileMM, seededRandom(name), px / tileMM);
    p = { cv };
    // Тот же бюджет по площади (LRU по порядку вставки), что у спрайтов.
    while (patternPixels + px * px > PATTERN_BUDGET && patterns.size) {
      const [k0, p0] = patterns.entries().next().value;
      patterns.delete(k0);
      patternPixels -= areaOf(p0.cv);
    }
    patterns.set(key, p);
    patternPixels += px * px;
  } else {
    patterns.delete(key); patterns.set(key, p); // LRU
  }
  const pat = ctx.createPattern(p.cv, 'repeat');
  if (pat && hasMatrix && pat.setTransform) {
    const s = tileMM / px;
    pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
  }
  return pat;
}

// ------------------------------------------------------------ Контуры

// «Облачный» скалопированный контур: дуги наружу между точками эллипса.
export function scallopPath(ctx, cx, cy, rx, ry, n, depth, rand, jitter = 0.08) {
  const pts = [];
  const phase = rand() * TAU;
  for (let i = 0; i < n; i += 1) {
    const t = phase + ((i + (rand() - 0.5) * 0.35) / n) * TAU;
    const k = 1 - depth - jitter / 2 + rand() * jitter;
    pts.push({ t, k });
  }
  const P = (t, k) => ({ x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k });
  const p0 = P(pts[0].t, pts[0].k);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const tb = i === n - 1 ? b.t + TAU : b.t;
    const tm = (a.t + tb) / 2;
    const bulge = 1 + depth * (1.1 + rand() * 0.5);
    const cpt = P(tm, bulge);
    const end = P(tb, b.k);
    ctx.quadraticCurveTo(cpt.x, cpt.y, end.x, end.y);
  }
  ctx.closePath();
}

// Зубчатый контур (хвоя): короткие зубцы с разбросом.
export function needlePath(ctx, rx, ry, n, depth, rand) {
  for (let i = 0; i < n * 2; i += 1) {
    const t = (i / (n * 2)) * TAU + (rand() - 0.5) * (TAU / n) * 0.25;
    const k = i % 2 ? 1 - depth * (0.7 + rand() * 0.6) : 1 - rand() * depth * 0.25;
    const x = Math.cos(t) * rx * k; const y = Math.sin(t) * ry * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// Ветви «вид сверху»: от ствола лучи с ветвлением. swirl — закрутка.
export function branches(ctx, r, rand, { mains = 6, depth = 3, swirl = 0, width = 1.6, spread = 0.55, reach = 0.86 } = {}) {
  const seg = (x, y, ang, len, w, d) => {
    const bend = swirl + (rand() - 0.5) * 0.5;
    const ex = x + Math.cos(ang + bend * 0.5) * len;
    const ey = y + Math.sin(ang + bend * 0.5) * len;
    const cx = x + Math.cos(ang) * len * 0.55;
    const cy = y + Math.sin(ang) * len * 0.55;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    if (d <= 1) return;
    const kids = d >= 3 ? 2 : 2 + (rand() > 0.5 ? 1 : 0);
    const na = ang + bend * 0.5;
    for (let i = 0; i < kids; i += 1) {
      const off = (i - (kids - 1) / 2) * spread + (rand() - 0.5) * 0.25;
      seg(ex, ey, na + off, len * (0.5 + rand() * 0.18), w * 0.62, d - 1);
    }
  };
  const phase = rand() * TAU;
  let total = 0;
  for (let i = 0; i < depth; i += 1) total += 0.59 ** i;
  for (let i = 0; i < mains; i += 1) {
    const ang = phase + (i / mains) * TAU + (rand() - 0.5) * 0.4;
    seg(0, 0, ang, (r * reach / total) * (0.85 + rand() * 0.3), width, depth);
  }
}

// Мягкая тень-«мазок»: силуэт, протянутый вдоль вектора, с размытием.
// fill(ctx) рисует силуэт в начале координат.
export function shadowSprite(key, wPx, hPx, offPx, color, fill) {
  const pad = Math.ceil(Math.max(wPx, hPx) * 0.18) + 4;
  const W = Math.abs(offPx.x) + wPx + pad * 2;
  const H = Math.abs(offPx.y) + hPx + pad * 2;
  const ox = pad + wPx / 2 + Math.max(0, -offPx.x);
  const oy = pad + hPx / 2 + Math.max(0, -offPx.y);
  const cv = cachedSprite(key, W, H, (g) => {
    const blur = Math.max(1.5, Math.min(wPx, hPx) * 0.09);
    if ('filter' in g) g.filter = `blur(${blur.toFixed(1)}px)`;
    g.fillStyle = color;
    const steps = Math.max(2, Math.min(14, Math.ceil(Math.hypot(offPx.x, offPx.y) / Math.max(3, Math.min(wPx, hPx) * 0.18))));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      g.save();
      g.translate(ox + offPx.x * t, oy + offPx.y * t);
      const s = 1 - t * 0.12;
      g.scale(s, s);
      g.beginPath();
      fill(g);
      g.fill();
      g.restore();
    }
  });
  return cv ? { cv, ox, oy } : null;
}

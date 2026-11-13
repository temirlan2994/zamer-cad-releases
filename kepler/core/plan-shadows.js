// Тени на плане этажа, как на презентационных планах: стены (на высоту этажа)
// и мебель (на свою высоту) отбрасывают мягкую тень по направлению света.
// Здесь — геометрия без холста: кто отбрасывает тень, полосы тени по рёбрам,
// границы слоя и подпись для кеша. Рисование и кеш — ui/plan-shadows.js.
//
// Тень фигуры — её след при сдвиге на v = dir·len: от каждого ребра, которое
// смотрит по направлению тени, — четырёхугольник «ребро → ребро + v». Темнота
// падает от ребра (t = 0) к дальнему краю (t = 1); t растёт по нормали ребра,
// поэтому полоса — линейный градиент от a к a + n·(n·v). Перекрытия полос не
// темнеют дважды (на холсте — режим «darken»).

import { wallRects } from './walls.js';
import { furniture3d } from './furniture3d.js';

const RAD = Math.PI / 180;

// Направление тени в осях дома: мировое (участок, ui/render-landscape.js
// landscapeShadow) повёрнуто на −поворот дома (дом: мир = начало + R(поворот)·свои оси).
export function planShadowDir(world, building) {
  const a = -((building?.rotation || 0) * RAD);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = world.x * c - world.y * s;
  const y = world.x * s + world.y * c;
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
}

// Длина тени по высоте предмета: k — из направления света (0,3 условно,
// при солнце — по его высоте), множитель 1,6 — «презентационная» длина; k не
// меньше 0,25 — и в полдень (солнце высоко) тень читается.
export function shadowLength(height, k = 0.3) {
  return Math.min(4000, Math.max(250, height * Math.max(k, 0.25) * 1.6));
}

const rectPoly = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

function itemPoly(it) {
  const a = (it.rotation || 0) * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = (sx * it.w) / 2;
    const ly = (sy * it.h) / 2;
    return { x: it.x + lx * c - ly * s, y: it.y + lx * s + ly * c };
  });
}

// Кто отбрасывает тень: видимые стены и мебель. { poly, len, kind: 'wall'|'item' };
// у мебели ещё halo — контур чуть шире: мягкая тень вокруг (предмет «стоит» на полу).
// lengthK — множитель длины (настройка вида «Длина теней»).
export function shadowCasters(walls, items = [], { wallHeight = 3000, k = 0.3, lengthK = 1 } = {}) {
  const out = [];
  const len = (h) => Math.min(5000, Math.max(150, shadowLength(h, k) * lengthK));
  const wallLen = len(wallHeight);
  for (const w of walls || []) {
    if (w.hidden) continue;
    const polys = w.polys?.length ? w.polys : w.poly ? [w.poly] : wallRects(w).map(rectPoly);
    for (const poly of polys) if (poly?.length >= 3) out.push({ poly, len: wallLen, kind: 'wall' });
  }
  for (const it of items || []) {
    if (!(it.w > 0 && it.h > 0)) continue;
    const h = Math.min(2200, furniture3d(it.kind)?.h || 600);
    out.push({ poly: itemPoly(it), halo: itemPoly({ ...it, w: it.w + 120, h: it.h + 120 }), len: len(h), kind: 'item' });
  }
  return out;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Полосы тени фигуры: { quad: [a, b, b+v, a+v], from: a, to: a + n·(n·v) }.
export function shadowStrips(poly, dir, len) {
  const area = signedArea(poly);
  if (Math.abs(area) < 1e-6) return [];
  const vx = dir.x * len;
  const vy = dir.y * len;
  const strips = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const el = Math.hypot(ex, ey);
    if (el < 1e-6) continue;
    // Внешняя нормаль — по знаку площади (обход по или против часовой).
    const nx = (area > 0 ? ey : -ey) / el;
    const ny = (area > 0 ? -ex : ex) / el;
    const nv = nx * vx + ny * vy;
    if (nv <= 1e-6) continue; // ребро смотрит на свет или идёт вдоль луча
    strips.push({
      quad: [a, b, { x: b.x + vx, y: b.y + vy }, { x: a.x + vx, y: a.y + vy }],
      from: a,
      to: { x: a.x + nx * nv, y: a.y + ny * nv },
    });
  }
  return strips;
}

// Границы слоя: фигуры и их сдвинутые копии.
export function shadowBounds(casters, dir) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const c of casters) {
    for (const p of c.poly) {
      for (const t of [0, c.len]) {
        const x = p.x + dir.x * t;
        const y = p.y + dir.y * t;
        if (x < b.minX) b.minX = x;
        if (y < b.minY) b.minY = y;
        if (x > b.maxX) b.maxX = x;
        if (y > b.maxY) b.maxY = y;
      }
    }
  }
  return b;
}

// Подпись для кеша: геометрия (до мм), длины и прочее (этаж, тема, направление).
export function shadowKey(casters, extra = '') {
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ (Math.round(v) | 0), 16777619) >>> 0; };
  for (const c of casters) {
    mix(c.len);
    mix(c.kind === 'wall' ? 1 : 2);
    for (const p of c.poly) { mix(p.x); mix(p.y); }
  }
  for (let i = 0; i < extra.length; i += 1) mix(extra.charCodeAt(i));
  return `${casters.length}:${h}`;
}

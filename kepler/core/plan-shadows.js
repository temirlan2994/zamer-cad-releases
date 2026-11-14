// Тени на плане этажа, как на презентационных планах: стены, колонны и объёмы
// мебели отбрасывают тень по направлению света. Длина — по высоте: у всех
// предметов один масштаб s (мм тени на мм высоты), поэтому что ниже, у того и
// тень короче; у дивана спинка и подлокотники дают тень длиннее сиденья, а
// поднятая столешница — тень, отделённую от стола. Здесь — геометрия без
// холста; рисование и кеш — ui/plan-shadows.js.
//
// Объём { poly, z0, z1 } (низ и верх, мм от пола) даёт на полу след фигуры при
// сдвиге от z0·s до z1·s: от каждого ребра, которое смотрит по направлению
// тени, — четырёхугольник «ребро → ребро + v». Темнота падает от ребра (t = 0)
// к дальнему краю (t = 1); t растёт по нормали ребра — линейный градиент от a
// к a + n·(n·v). Перекрытия не темнеют дважды (на холсте — режим «darken»).
// У основания стоящих на полу объёмов — ещё короткая тёмная тень касания:
// тень прижата к стене, а не «парит» рядом.

import { wallRects } from './walls.js';
import { furnitureVolumes, structuralOutline } from './mesh3d.js';
import { isStructural } from './catalog.js';

const RAD = Math.PI / 180;
const MAX_LEN = 5000; // мм, самая длинная тень
const CONTACT_LEN = 240; // мм, тень касания у основания — не длиннее

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

// Масштаб тени s — мм тени на мм высоты. k — из направления света (0,3
// условно, при солнце — по его высоте; не меньше 0,25 — и в полдень тень
// читается), 1,6 — «презентационная» длина, lengthK — «Длина теней» вида.
// Стена 3000 мм при средней длине — тень 1200 мм.
export function shadowScale(k = 0.3, lengthK = 1) {
  return Math.max(k ?? 0.3, 0.25) * 1.6 * lengthK;
}

const rectPoly = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

// Кто отбрасывает тень: видимые стены и свободные стены/колонны — на высоту
// этажа, мебель — объёмами, как в 3D (core/mesh3d.js furnitureVolumes).
// { poly, z0, z1, kind: 'wall' | 'item' }.
export function shadowCasters(walls, items = [], { wallHeight = 3000 } = {}) {
  const out = [];
  for (const w of walls || []) {
    if (w.hidden) continue;
    const polys = w.polys?.length ? w.polys : w.poly ? [w.poly] : wallRects(w).map(rectPoly);
    for (const poly of polys) if (poly?.length >= 3) out.push({ poly, z0: 0, z1: wallHeight, kind: 'wall' });
  }
  for (const it of items || []) {
    if (isStructural(it.kind) && it.w > 0 && it.h > 0) out.push({ poly: structuralOutline(it), z0: 0, z1: wallHeight, kind: 'item' });
  }
  for (const v of furnitureVolumes(items, Math.max(1, wallHeight - 10))) {
    if (v.poly?.length >= 3) out.push({ poly: v.poly, z0: v.z0, z1: v.z1, kind: 'item' });
  }
  return out;
}

const shift = (poly, dir, d) => (d ? poly.map((p) => ({ x: p.x + dir.x * d, y: p.y + dir.y * d })) : poly);

// Тень объёма: начало следа (фигура, сдвинутая на z0·s) и его длина.
export function castShadow(caster, dir, s) {
  const from = Math.min(MAX_LEN, caster.z0 * s);
  const len = Math.max(0, Math.min(MAX_LEN, caster.z1 * s) - from);
  return { base: shift(caster.poly, dir, from), len };
}

// Тень касания: только у стоящих на полу объёмов, короткая.
export function contactLength(caster, s) {
  return caster.z0 > 0 ? 0 : Math.min(CONTACT_LEN, caster.z1 * s * 0.22);
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
  if (Math.abs(area) < 1e-6 || !(len > 0)) return [];
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

// Границы слоя: фигуры и их тени.
export function shadowBounds(casters, dir, s) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const c of casters) {
    const tip = Math.min(MAX_LEN, c.z1 * s);
    for (const p of c.poly) {
      for (const t of [0, tip]) {
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

// Подпись для кеша: геометрия (до мм), высоты и прочее (этаж, тема, свет).
export function shadowKey(casters, extra = '') {
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ (Math.round(v) | 0), 16777619) >>> 0; };
  for (const c of casters) {
    mix(c.z0);
    mix(c.z1);
    mix(c.kind === 'wall' ? 1 : 2);
    for (const p of c.poly) { mix(p.x); mix(p.y); }
  }
  for (let i = 0; i < extra.length; i += 1) mix(extra.charCodeAt(i));
  return `${casters.length}:${h}`;
}

// Массив копий и засадка контура растениями (без DOM). Мир — координаты
// участка, мм, ось Y вниз (угол + — по часовой на экране). Результат —
// новые объекты; запись в проект и история — в ui/landscape-array.js.

import { pointInPolygon } from './zamer/geometry.js';
import { PLANT_KINDS } from './landscape-tools.js';
import { childrenOf, cloneGroup, isPlanter } from './landscape-build.js';
import {
  createLandscapeObject, distanceToPolygon, isPathShape, landscapeDef, objectOutline, objectPath, planterInner,
  pointAlong, polylineLength, rotateObjectAbout, seededRandom,
} from './landscape.js';

// Предел копий одной операции (позиций) и объектов результата.
export const ARRAY_MAX = 500;
export const ARRAY_MAX_OBJECTS = 3000;

const deg = (rad) => (rad * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

// Опорная точка группы — центр рамки центров верхних объектов.
export function groupBase(objs) {
  if (!objs.length) return { x: 0, y: 0 };
  const xs = objs.map((o) => o.x); const ys = objs.map((o) => o.y);
  return { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) };
}

// Габарит группы (по контурам) — шаги прямоугольного массива по умолчанию.
export function groupExtent(objs) {
  const pts = objs.flatMap((o) => objectOutline(o));
  if (!pts.length) return { w: 1000, h: 1000 };
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { w: Math.max(1, Math.max(...xs) - Math.min(...xs)), h: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
}

// ------------------------------------------------------------ Позиции

// Вдоль ломаной: шаг step (мм) или количество count (по всей длине, концы
// включены). align — поворот по касательной относительно первого отрезка.
export function linePositions(points, { step = 1000, count = 0, align = false } = {}) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const total = polylineLength(points);
  if (total < 1) return [];
  const list = [];
  if (count > 0) {
    const n = clampInt(count, 1, ARRAY_MAX);
    for (let i = 0; i < n; i += 1) list.push(n === 1 ? 0 : (total * i) / (n - 1));
  } else {
    const st = Math.max(10, Number(step) || 0);
    for (let s = 0; s <= total + 0.5 && list.length < ARRAY_MAX; s += st) list.push(Math.min(s, total));
  }
  const a0 = pointAlong(points, 0).angle;
  return list.map((s) => {
    const p = pointAlong(points, s);
    return { x: Math.round(p.x), y: Math.round(p.y), rot: align ? deg(p.angle - a0) : 0 };
  });
}

// По кругу/дуге вокруг center: радиус (0 — расстояние от опорной точки),
// количество, угол дуги (360 — полный круг, шаг 360/n; иначе концы дуги
// включены). Первая позиция — на луче центр→опорная точка.
export function polarPositions(base, { center, radius = 0, count = 6, angle = 360, align = true } = {}) {
  if (!center) return [];
  const n = clampInt(count, 1, ARRAY_MAX);
  const dist = Math.hypot(base.x - center.x, base.y - center.y);
  const r = radius > 0 ? radius : dist;
  const a0 = dist > 1 ? Math.atan2(base.y - center.y, base.x - center.x) : -Math.PI / 2;
  const span = Math.max(-360, Math.min(360, Number(angle) || 0));
  const full = Math.abs(span) >= 360;
  const stepDeg = n === 1 ? 0 : full ? 360 / n : span / (n - 1);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = a0 + rad(stepDeg * i);
    out.push({ x: Math.round(center.x + Math.cos(a) * r) + 0, y: Math.round(center.y + Math.sin(a) * r) + 0, rot: align ? stepDeg * i : 0 });
  }
  return out;
}

// Прямоугольный: рядов × столбцов, шаги dx (по X), dy (по Y, вниз).
export function rectPositions(base, { rows = 2, cols = 2, dx = 1000, dy = 1000 } = {}) {
  const r = clampInt(rows, 1, ARRAY_MAX); const c = clampInt(cols, 1, ARRAY_MAX);
  const out = [];
  for (let i = 0; i < r; i += 1) {
    for (let j = 0; j < c; j += 1) {
      if (out.length >= ARRAY_MAX) return out;
      out.push({ x: Math.round(base.x + j * dx), y: Math.round(base.y + i * dy), rot: 0 });
    }
  }
  return out;
}

// ------------------------------------------------------------ Копии

// Копии группы sources (с растениями коробов) в позициях: опорная точка
// base → позиция, поворот rot вокруг неё. Позиция на месте оригинала
// (совпадает с base и без поворота) пропускается. Новые id, parent копий
// растений переназначен на копию короба.
export function arrayCopies(sources, base, positions, { tol = 1 } = {}) {
  const out = [];
  for (const p of positions) {
    if (Math.hypot(p.x - base.x, p.y - base.y) <= tol && Math.abs(p.rot || 0) < 0.01) continue;
    if (out.length + sources.length > ARRAY_MAX_OBJECTS) break;
    const copies = cloneGroup(sources, Math.round(p.x - base.x), Math.round(p.y - base.y));
    if (p.rot) for (const c of copies) rotateObjectAbout(c, p.x, p.y, p.rot);
    out.push(...copies);
  }
  return out;
}

// Массив по параметрам: mode 'path' | 'polar' | 'rect'.
export function buildArray(sources, top, opts) {
  const base = opts.base || groupBase(top);
  const positions = opts.mode === 'path' ? linePositions(opts.points, opts)
    : opts.mode === 'polar' ? polarPositions(base, opts) : rectPositions(base, opts);
  return { base, positions, objects: arrayCopies(sources, base, positions) };
}

// ------------------------------------------------------------ Засадить

// Контурные объекты, которые можно засадить: газоны, клумбы, короба.
export const FILL_HOSTS = new Set(['lawn-area', 'lawn-patch', 'bed-round', 'bed-rect', 'bed-strip', 'planter-area', 'planter-box']);
export const canFill = (o) => Boolean(o && FILL_HOSTS.has(o.kind));
// Растения для засадки (порядок — как в каталоге помощников).
export const FILL_PLANTS = ['flowers-clump', 'grass-clump', ...PLANT_KINDS.filter((k) => k !== 'grass-clump')];

// Радиус кроны (полудиагональ не нужна: крона — круг по большему размеру).
export const crownR = (kind, w) => {
  const def = landscapeDef(kind);
  return (w || Math.max(def.w, def.h || def.w)) / 2;
};

function edgeDistance(p, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

// Нормированный набор видов: [{ kind, share (0…1), variant }], до 4.
export function normalizeMix(mix) {
  const list = (Array.isArray(mix) ? mix : [mix]).filter((m) => m && landscapeDef(m.kind) && !isPathShape(landscapeDef(m.kind))).slice(0, 4);
  const sum = list.reduce((s, m) => s + Math.max(0, Number(m.share ?? 1) || 0), 0);
  return list.map((m) => ({ kind: m.kind, variant: m.variant, share: sum > 0 ? Math.max(0, Number(m.share ?? 1) || 0) / sum : 1 / list.length }))
    .filter((m) => m.share > 0);
}

// Засадка многоугольника: Poisson-disk с переменным радиусом. step — шаг
// между центрами (0 — по кроне), jitter 0…1 (0 — ровная шахматка, 1 —
// естественный разброс), margin — отступ кроны от границы, seed — для
// повторяемости. Кроны не пересекаются друг с другом и с circles
// ({x, y, r} — уже стоящие), не заходят на avoid (многоугольники) и целиком
// внутри контура с отступом. Возвращает новые объекты.
export function plantFill(polygon, { mix, step = 0, jitter = 0.6, margin = 200, seed = 1, circles = [], avoid = [], max = 2000 } = {}) {
  const species = normalizeMix(mix);
  if (!species.length || !Array.isArray(polygon) || polygon.length < 3) return [];
  const sp = species.map((m) => {
    const r = crownR(m.kind);
    return { ...m, r, s: Math.max(2 * r, Number(step) || 0) };
  });
  // +4 мм: допуск на округление до целых мм (решётка без отказов при jitter 0).
  const lattice = sp.reduce((s, m) => s + m.s * m.share, 0) + 4;
  const maxGap = Math.max(...sp.map((m) => Math.max(m.s, 2 * m.r)));
  const rand = seededRandom(`plant-fill:${seed}`);
  const jit = Math.min(1, Math.max(0, Number(jitter) || 0));
  const xs = polygon.map((p) => p.x); const ys = polygon.map((p) => p.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  // Пространственная сетка: ячейка — наибольшее требуемое расстояние.
  const cell = Math.max(50, maxGap, ...circles.map((c) => c.r * 2));
  const grid = new Map();
  const key = (i, j) => `${i}:${j}`;
  const put = (c) => {
    const k = key(Math.floor(c.x / cell), Math.floor(c.y / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  };
  for (const c of circles) put({ x: c.x, y: c.y, r: c.r, s: 2 * c.r });
  const free = (p, m) => {
    const i0 = Math.floor(p.x / cell); const j0 = Math.floor(p.y / cell);
    const reach = Math.ceil((m.r + cell) / cell);
    for (let i = i0 - reach; i <= i0 + reach; i += 1) {
      for (let j = j0 - reach; j <= j0 + reach; j += 1) {
        for (const c of grid.get(key(i, j)) || []) {
          // Кроны не пересекаются (+2 мм на округление); шаг — между центрами.
          const need = Math.max(c.r + m.r + 2, (c.s + m.s) / 2 - 3);
          if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < need * need) return false;
        }
      }
    }
    return true;
  };
  const fits = (p, m) => pointInPolygon(p, polygon) && edgeDistance(p, polygon) >= m.r + margin
    && !avoid.some((poly) => distanceToPolygon(p, poly) < m.r);
  const counts = sp.map(() => 0);
  let total = 0;
  // Вид для следующего растения: недобор доли, со случайностью по весу.
  const pickSpecies = () => {
    if (sp.length === 1) return 0;
    const need = sp.map((m, i) => Math.max(0, m.share * (total + 1) - counts[i]));
    const sum = need.reduce((s, v) => s + v, 0);
    if (sum <= 0) return 0;
    let t = rand() * sum;
    for (let i = 0; i < need.length; i += 1) { t -= need[i]; if (t <= 0) return i; }
    return need.length - 1;
  };
  const out = [];
  const accepted = [];
  const tryAt = (x, y, order = null) => {
    if (out.length >= max) return false;
    const first = order ?? pickSpecies();
    // Не влез выбранный вид — пробуем меньшие (заполнить узкие места).
    const tries = [first, ...sp.map((_, i) => i).filter((i) => i !== first && sp[i].r < sp[first].r).sort((a, b) => sp[b].r - sp[a].r)];
    for (const k of tries) {
      const m = sp[k];
      const p = { x: Math.round(x), y: Math.round(y) };
      if (!fits(p, m) || !free(p, m)) continue;
      const c = { x: p.x, y: p.y, r: m.r, s: m.s };
      put(c);
      accepted.push(c);
      counts[k] += 1;
      total += 1;
      out.push(createLandscapeObject(m.kind, p.x, p.y, { variant: m.variant, rotation: jit > 0 && !landscapeDef(m.kind).lockAspect ? Math.round(rand() * 360) : 0 }));
      return true;
    }
    return false;
  };
  // 1) Шахматная решётка с разбросом jitter: ряды вдоль самого длинного
  // ребра контура, по центру полосы, доступной центрам (рамка минус крона
  // и отступ) — узкая гряда/короб получает ровный ряд по оси.
  let ang = 0; let longest = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > longest + 1) { longest = len; ang = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  const cos = Math.cos(ang); const sin = Math.sin(ang);
  const local = polygon.map((p) => ({ u: p.x * cos + p.y * sin, v: -p.x * sin + p.y * cos }));
  const lb = { u0: Math.min(...local.map((p) => p.u)), u1: Math.max(...local.map((p) => p.u)), v0: Math.min(...local.map((p) => p.v)), v1: Math.max(...local.map((p) => p.v)) };
  const inset = Math.min(...sp.map((m) => m.r)) + margin;
  const rowH = lattice * Math.sqrt(3) / 2;
  const span = (lo, hi, st) => {
    const len = hi - lo - 2 * inset;
    if (len < 0) return { start: (lo + hi) / 2, n: 1 };
    const n = Math.floor(len / st) + 1;
    return { start: lo + inset + (len - (n - 1) * st) / 2, n };
  };
  const rows = span(lb.v0, lb.v1, rowH);
  const cols = span(lb.u0, lb.u1, lattice);
  for (let r = 0; r < rows.n; r += 1) {
    const v = rows.start + r * rowH;
    // Нечётный ряд — со сдвигом на полшага (шахматка), лишняя точка с края.
    const shift = r % 2 ? lattice / 2 : 0;
    for (let c = shift ? -1 : 0; c < cols.n; c += 1) {
      const u = cols.start + c * lattice + shift;
      const du = (rand() - 0.5) * lattice * jit; const dv = (rand() - 0.5) * lattice * jit;
      // Сдвинутая точка не влезла (узкое место) — узел решётки без сдвига.
      if (!tryAt((u + du) * cos - (v + dv) * sin, (u + du) * sin + (v + dv) * cos) && jit > 0) tryAt(u * cos - v * sin, u * sin + v * cos);
    }
  }
  // Узкий контур (решётка не попала) — от центра рамки.
  const seeded = !out.length && tryAt((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
  // 2) Дозаполнение пустот (Bridson: кольцо d…2d вокруг стоящих) — при
  // разбросе > 0 или когда решётка не попала в узкий контур.
  if (jit > 0 || seeded) {
    const active = [...accepted];
    let guard = 0;
    while (active.length && out.length < max && guard < 200000) {
      const idx = Math.floor(rand() * active.length);
      const c = active[idx];
      let placed = false;
      for (let k = 0; k < 12; k += 1, guard += 1) {
        const a = rand() * Math.PI * 2;
        const d = Math.max(c.s, 2 * c.r) * (1 + rand());
        if (tryAt(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d)) { active.push(accepted[accepted.length - 1]); placed = true; break; }
      }
      if (!placed) active.splice(idx, 1);
    }
  }
  return out;
}

function bounds(pts) {
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// Контур засадки объекта: короб — засыпка, прочие — наружный контур.
export function fillPolygonOf(o) {
  if (isPlanter(o)) return planterInner(o);
  const def = landscapeDef(o.kind);
  if (def?.shape === 'poly') return objectPath(o).map(({ x, y }) => ({ x, y }));
  return objectOutline(o, 48);
}

// Засадить объект host: растения внутри контура, не на соседях. Для коробов
// растения привязаны полем parent (как «Посадить в короб»). objects — все
// объекты ландшафта, footprints — контуры дома.
export function plantFillObject(objects, host, opts = {}, footprints = []) {
  const polygon = fillPolygonOf(host);
  const planter = isPlanter(host);
  const plantLike = (x) => !isPathShape(landscapeDef(x.kind)) && !landscapeDef(x.kind)?.cover;
  const inside = (x) => pointInPolygon(x, polygon) || distanceToPolygon(x, polygon) < crownR(x.kind, Math.max(x.w, x.h));
  // Уже стоящие растения/малые формы рядом с контуром — обходим по кроне.
  const circles = (planter ? childrenOf(objects, host.id) : objects.filter((x) => x.id !== host.id && plantLike(x) && inside(x)))
    .map((x) => ({ x: x.x, y: x.y, r: Math.max(x.w, x.h) / 2 }));
  // Покрытия поверх (дорожки, площадки, клумбы на газоне) — обходим контуром.
  const avoid = [...footprints];
  if (!planter) {
    const lawn = new Set(['lawn-area', 'lawn-patch']);
    const hb = bounds(polygon);
    for (const x of objects) {
      const d = landscapeDef(x.kind);
      if (x.id === host.id || !d?.cover || lawn.has(x.kind) || x.parent) continue;
      const out = objectOutline(x);
      if (out.length < 3 && d.shape !== 'line') continue;
      if (polygon.every((p) => pointInPolygon(p, out))) continue; // хост целиком лежит на этом покрытии
      const ob = bounds(out);
      if (ob.x0 > hb.x1 || ob.x1 < hb.x0 || ob.y0 > hb.y1 || ob.y1 < hb.y0) continue; // далеко
      avoid.push(out);
    }
  }
  // Короб: граница — уже внутренняя грань борта, отступ не добавляем.
  const list = plantFill(polygon, { ...opts, ...(planter ? { margin: 0 } : {}), circles, avoid });
  if (planter) for (const o of list) o.parent = host.id;
  return list;
}

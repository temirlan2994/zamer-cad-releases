// Массы (концептуальная форма, как «Масса» в Revit / «Тяни-толкай» в
// SketchUp): прямоугольные боксы, из которых в 3D собирается объём дома, а на
// плане этажа виден их «эскиз» — объединённый контур сечения. Чистый модуль
// без DOM.
//
// project.masses[] (необязательно) — { id, name, x, y, w, d, z0, h, rotation,
// color? }: x, y — центр основания в осях ДОМА (как комнаты), мм; w, d —
// размеры по локальным осям x и y массы; z0 — отметка низа (0 — земля или
// верх другой массы); h — высота; rotation — 0/90/180/270 (кратно 90°: при
// 90/270 ширина идёт вдоль y дома). Всё — в мм.
//
// Вычитания (пустот) и скошенных граней в этом шаге нет; объединение — только
// для контура эскиза на плане (core/geom: целые 0,5 мм).

import { union } from './geom/poly.js';

export const MASS_MIN = 100; // мм — меньше бокс не делаем
export const MASS_MAX = 300000;
export const MASS_H_DEFAULT = 3000;
export const MASS_COLOR = '#9cc3e6';

let counter = 0;
const newId = () => {
  counter += 1;
  return `mass-${Date.now().toString(36)}-${counter.toString(36)}`;
};

const num = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const clampSize = (v) => Math.min(MASS_MAX, Math.max(MASS_MIN, Math.round(v)));
const normRot = (r) => ((Math.round((Number(r) || 0) / 90) * 90) % 360 + 360) % 360;

// Следующее свободное имя «Масса N».
export function nextMassName(masses = []) {
  let n = 1;
  const names = new Set((masses || []).map((m) => m.name));
  while (names.has(`Масса ${n}`)) n += 1;
  return `Масса ${n}`;
}

// Новая масса (размеры приводятся к допустимым).
export function createMass({
  x = 0, y = 0, w = 6000, d = 6000, z0 = 0, h = MASS_H_DEFAULT, rotation = 0, name = null, color = null,
} = {}, existing = []) {
  const m = {
    id: newId(),
    name: name || nextMassName(existing),
    x: Math.round(x), y: Math.round(y),
    w: clampSize(w), d: clampSize(d),
    z0: Math.max(0, Math.round(z0)), h: clampSize(h),
    rotation: normRot(rotation),
  };
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) m.color = color;
  return m;
}

// Чистка одной массы из файла: битая — null.
export function normalizeMass(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const x = num(raw.x); const y = num(raw.y);
  const w = num(raw.w); const d = num(raw.d); const h = num(raw.h);
  if (x == null || y == null || !(w > 0) || !(d > 0) || !(h > 0)) return null;
  const m = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'Масса',
    x, y, w: clampSize(w), d: clampSize(d),
    z0: Math.max(0, num(raw.z0) ?? 0), h: clampSize(h),
    rotation: normRot(raw.rotation),
  };
  if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)) m.color = raw.color;
  return m;
}

// Список масс проекта: битые отброшены, id уникальны. Пустой — [].
export function normalizeMasses(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const m = normalizeMass(raw);
    if (!m) continue;
    if (seen.has(m.id)) m.id = newId();
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

// Размеры основания по осям дома (поворот 90/270 меняет местами).
export function massExtent(m) {
  const turned = m.rotation === 90 || m.rotation === 270;
  return { ex: turned ? m.d : m.w, ey: turned ? m.w : m.d };
}

// Габарит в осях дома: { x0, y0, x1, y1, z0, z1 }.
export function massBox(m) {
  const { ex, ey } = massExtent(m);
  return { x0: m.x - ex / 2, y0: m.y - ey / 2, x1: m.x + ex / 2, y1: m.y + ey / 2, z0: m.z0, z1: m.z0 + m.h };
}

// Основание прямоугольником { x, y, w, h } (как комната).
export function massRect(m) {
  const b = massBox(m);
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

// Габарит → масса с тем же id/именем/поворотом (размеры — по поворотy).
export function massFromBox(m, b) {
  const ex = clampSize(b.x1 - b.x0);
  const ey = clampSize(b.y1 - b.y0);
  const turned = m.rotation === 90 || m.rotation === 270;
  return {
    ...m,
    x: Math.round(((b.x0 + b.x1) / 2) * 2) / 2,
    y: Math.round(((b.y0 + b.y1) / 2) * 2) / 2,
    w: turned ? ey : ex, d: turned ? ex : ey,
    z0: Math.max(0, Math.round(b.z0)), h: clampSize(b.z1 - b.z0),
  };
}

// Масса по двум противоположным углам основания (оси дома), низу и высоте.
export function massFromCorners(a, b, z0, h, existing = [], extra = {}) {
  return createMass({
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    w: Math.abs(b.x - a.x), d: Math.abs(b.y - a.y), z0, h, ...extra,
  }, existing);
}

export function moveMass(m, dx = 0, dy = 0, dz = 0) {
  return { ...m, x: m.x + dx, y: m.y + dy, z0: Math.max(0, m.z0 + dz) };
}

// Новые размеры (любые из w, d, h, z0); центр основания на месте.
export function resizeMass(m, { w, d, h, z0 } = {}) {
  const out = { ...m };
  if (num(w) > 0) out.w = clampSize(w);
  if (num(d) > 0) out.d = clampSize(d);
  if (num(h) > 0) out.h = clampSize(h);
  if (num(z0) != null) out.z0 = Math.max(0, Math.round(num(z0)));
  return out;
}

// Грани бокса (оси дома): 'top' | 'bottom' | 'px' | 'nx' | 'py' | 'ny'.
export const MASS_FACES = ['top', 'bottom', 'px', 'nx', 'py', 'ny'];
export const FACE_NORMAL = {
  top: { x: 0, y: 0, z: 1 }, bottom: { x: 0, y: 0, z: -1 },
  px: { x: 1, y: 0, z: 0 }, nx: { x: -1, y: 0, z: 0 },
  py: { x: 0, y: 1, z: 0 }, ny: { x: 0, y: -1, z: 0 },
};

// Грань по нормали попадания ({ axis, sign } из rayBox).
export function faceOf(axis, sign) {
  if (axis === 'z') return sign > 0 ? 'top' : 'bottom';
  return `${sign > 0 ? 'p' : 'n'}${axis}`;
}

// «Тяни-толкай»: грань face сдвигается на delta мм наружу (отрицательное —
// внутрь), противоположная стоит. Меньше MASS_MIN не сжимается.
export function resizeFace(m, face, delta) {
  const b = massBox(m);
  const dd = Number(delta) || 0;
  if (face === 'top') b.z1 = Math.max(b.z0 + MASS_MIN, b.z1 + dd);
  else if (face === 'bottom') b.z0 = Math.max(0, Math.min(b.z1 - MASS_MIN, b.z0 - dd));
  else if (face === 'px') b.x1 = Math.max(b.x0 + MASS_MIN, b.x1 + dd);
  else if (face === 'nx') b.x0 = Math.min(b.x1 - MASS_MIN, b.x0 - dd);
  else if (face === 'py') b.y1 = Math.max(b.y0 + MASS_MIN, b.y1 + dd);
  else if (face === 'ny') b.y0 = Math.min(b.y1 - MASS_MIN, b.y0 - dd);
  else return { ...m };
  return massFromBox(m, b);
}

// Размер грани: верх — высота, бока по x — ширина основания по x дома, по y — по y.
export function faceSize(m, face) {
  const b = massBox(m);
  if (face === 'top' || face === 'bottom') return b.z1 - b.z0;
  if (face === 'px' || face === 'nx') return b.x1 - b.x0;
  return b.y1 - b.y0;
}

// Точное значение размера грани: противоположная грань стоит.
export function setFaceSize(m, face, value) {
  const v = num(value);
  if (!(v > 0)) return null;
  return resizeFace(m, face, clampSize(v) - faceSize(m, face));
}

// Поворот на 90° по часовой вокруг центра основания.
export function rotateMass90(m) {
  return { ...m, rotation: (m.rotation + 90) % 360 };
}

const inRect = (b, p, e = 0.5) => p.x > b.x0 - e && p.x < b.x1 + e && p.y > b.y0 - e && p.y < b.y1 + e;

const overlap2d = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;

// Верх, на который встаёт точка p (оси дома): наибольший верх масс под ней
// (кроме skip), не выше maxZ; иначе 0 (земля).
export function supportAt(masses, p, { skip = null, maxZ = Infinity } = {}) {
  let z = 0;
  for (const m of masses || []) {
    if (m.id === skip) continue;
    const b = massBox(m);
    if (b.z1 <= maxZ + 0.5 && inRect(b, p, -0.5) && b.z1 > z) z = b.z1;
  }
  return z;
}

// «Поставить на массу»: низ — на верх самой высокой массы, на которую
// опирается основание (перекрытие оснований), иначе на землю.
export function stackMass(m, masses) {
  const box = massBox(m);
  let z = 0;
  for (const o of masses || []) {
    if (o.id === m.id) continue;
    const b = massBox(o);
    if (overlap2d(box, b) && b.z1 > z) z = b.z1;
  }
  return { ...m, z0: z };
}

// Стоит ли масса на чём-то: на земле или на верхе другой массы.
export function isSupported(m, masses) {
  if (Math.abs(m.z0) < 0.5) return true;
  const box = massBox(m);
  return (masses || []).some((o) => o.id !== m.id && overlap2d(box, massBox(o)) && Math.abs(massBox(o).z1 - m.z0) < 0.5);
}

// Сечение масс на отметке z: прямоугольники оснований тех, что её пересекают.
export function sectionRects(masses, z) {
  const out = [];
  for (const m of masses || []) {
    const b = massBox(m);
    if (b.z0 <= z + 1e-6 && b.z1 > z + 1e-6) out.push({ id: m.id, name: m.name, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
  }
  return out;
}

// Массы этажа: пересекают диапазон [elevation, elevation + height) этажа.
export function levelMasses(masses, level) {
  const z0 = Number(level?.elevation) || 0;
  const z1 = z0 + (Number(level?.height) > 0 ? Number(level.height) : MASS_H_DEFAULT);
  return (masses || []).filter((m) => {
    const b = massBox(m);
    return b.z0 < z1 - 0.5 && b.z1 > z0 + 0.5;
  });
}

const rectRing = (r) => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];

// Объединённый контур прямоугольников (MultiPolygon: [[outer, ...holes], ...]).
export function unionOutline(rects) {
  if (!rects?.length) return [];
  if (rects.length === 1) return [[rectRing(rects[0])]];
  return union(...rects.map((r) => [rectRing(r)]));
}

// Эскиз этажа: { rects, outline, segments, points, labels } — rects —
// основания масс этажа, outline — объединённый контур, segments — рёбра
// контура (для привязок), points — его вершины, labels — подписи (имя у
// верхнего левого угла каждой массы).
export function massSketch(masses, level) {
  const list = levelMasses(masses, level);
  const rects = list.map((m) => { const b = massBox(m); return { id: m.id, name: m.name, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }; });
  const outline = unionOutline(rects);
  const segments = [];
  const points = [];
  for (const poly of outline) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        points.push({ x: a.x, y: a.y });
        segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
      }
    }
  }
  return { rects, outline, segments, points };
}

// Линии привязки эскиза: вертикальные (x = const) и горизонтальные рёбра с
// их протяжённостью.
export function sketchLines(sketch) {
  const xs = []; const ys = [];
  for (const s of sketch?.segments || []) {
    if (Math.abs(s.a.x - s.b.x) < 0.5) xs.push({ at: s.a.x, from: Math.min(s.a.y, s.b.y), to: Math.max(s.a.y, s.b.y) });
    else if (Math.abs(s.a.y - s.b.y) < 0.5) ys.push({ at: s.a.y, from: Math.min(s.a.x, s.b.x), to: Math.max(s.a.x, s.b.x) });
  }
  return { xs, ys };
}

// Магнит прямоугольника { x, y, w, h } к рёбрам эскиза: грань прямоугольника
// встаёт на ребро (inset = 0) или на расстояние inset внутрь от него
// (наружная стена помещения — внутри контура массы). Только рёбра, чья
// протяжённость перекрывает прямоугольник (с запасом distance). Оси — по
// отдельности. edges — какие грани подвижны (по умолчанию все — перенос).
// → { x, y, w, h, snappedX, snappedY, guides: [{ axis: 'v'|'h', at, from, to }] }.
export function snapRectToSketch(rect, lines, { distance = 300, inset = 0, edges = null, skipX = false, skipY = false } = {}) {
  const out = { ...rect, snappedX: false, snappedY: false, guides: [] };
  if (!lines || !(distance > 0)) return out;
  const move = !edges;
  const can = (e) => move || edges.includes(e);
  const pick = (axis) => {
    const list = axis === 'x' ? lines.xs : lines.ys;
    const [p, s, q, t] = axis === 'x' ? ['x', 'w', 'y', 'h'] : ['y', 'h', 'x', 'w'];
    const lo = rect[p]; const hi = rect[p] + rect[s];
    let best = null;
    for (const L of list) {
      if (L.to < rect[q] - distance || L.from > rect[q] + rect[t] + distance) continue;
      const offs = inset > 0 ? [0, inset, -inset] : [0];
      for (const o of offs) {
        const at = L.at + o;
        for (const [edge, cur] of [[axis === 'x' ? 'w' : 'n', lo], [axis === 'x' ? 'e' : 's', hi]]) {
          if (!can(edge)) continue;
          const dd = Math.abs(at - cur);
          if (dd > distance) continue;
          const score = dd + (o ? 0.01 : 0);
          if (!best || score < best.score) best = { score, edge, at, line: L };
        }
      }
    }
    return best;
  };
  for (const axis of ['x', 'y']) {
    if ((axis === 'x' && skipX) || (axis === 'y' && skipY)) continue;
    const best = pick(axis);
    if (!best) continue;
    const [p, s] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
    const hiSide = best.edge === 'e' || best.edge === 's';
    if (move) out[p] = hiSide ? best.at - out[s] : best.at;
    else if (hiSide) out[s] = Math.max(1, best.at - out[p]);
    else { out[s] = Math.max(1, out[p] + out[s] - best.at); out[p] = best.at; }
    if (axis === 'x') out.snappedX = true; else out.snappedY = true;
    const [q, t] = axis === 'x' ? ['y', 'h'] : ['x', 'w'];
    out.guides.push({
      type: 'magnet', kind: 'align', axis: axis === 'x' ? 'v' : 'h', at: best.at,
      from: Math.min(out[q], best.line.from), to: Math.max(out[q] + out[t], best.line.to),
    });
  }
  return out;
}

// Привязка значения: к ближайшей линии из list в пределах tol, иначе к шагу.
// → { value, line } (line — координата линии привязки или null).
export function snapValue(v, list, tol, step) {
  let best = null; let d = tol;
  for (const c of list || []) {
    const dd = Math.abs(c - v);
    if (dd <= d) { d = dd; best = c; }
  }
  if (best != null) return { value: best, line: best };
  return { value: step > 0 ? Math.round(v / step) * step : v, line: null };
}

// Шаг привязки масс по масштабу (пикселей на мм): самый мелкий из ряда,
// который на экране не меньше 10 px. Крупный — 1000 мм.
export function massStep(scale) {
  if (!(scale > 0)) return 100;
  for (const step of [10, 50, 100, 250, 500]) if (step * scale >= 10) return step;
  return 1000;
}

// Линии привязки основания: грани других масс (xs, ys) и отметки их верха.
export function massSnapCoords(masses, skip = null) {
  const xs = []; const ys = []; const zs = [];
  for (const m of masses || []) {
    if (m.id === skip) continue;
    const b = massBox(m);
    xs.push(b.x0, b.x1); ys.push(b.y0, b.y1); zs.push(b.z0, b.z1);
  }
  return { xs, ys, zs };
}

// Сводка массы: объём (м³), площадь основания (м²), этажей ≈ N (по высоте этажа).
export function massStats(m, levelHeight = 3000) {
  const area = (m.w * m.d) / 1e6;
  const lh = levelHeight > 0 ? levelHeight : 3000;
  return { area, volume: area * (m.h / 1000), floors: Math.max(1, Math.round(m.h / lh)) };
}

// Подпись «≈ N этаж(а/ей)».
export function floorsLabel(h, levelHeight = 3000) {
  const n = Math.max(1, Math.round(h / (levelHeight > 0 ? levelHeight : 3000)));
  const mod10 = n % 10; const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'этаж' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'этажа' : 'этажей';
  return `≈ ${n} ${word}`;
}

// Копия со смещением (по x на ширину + 1000 мм, если не задано).
export function copyMass(m, masses, offset = null) {
  const { ex } = massExtent(m);
  const o = offset || { x: ex + 1000, y: 0 };
  return { ...m, id: newId(), name: nextMassName(masses), x: m.x + o.x, y: m.y + o.y };
}

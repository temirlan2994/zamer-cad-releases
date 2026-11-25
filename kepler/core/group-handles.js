// Ручки группы мебели (множественный выбор только из предметов): те же
// режимы, что у одного предмета (core/item-handles.js), но вокруг общей
// рамки группы — описывающего прямоугольника в осях дома.
// Чистая логика без DOM: на вход — снимки предметов в начале жеста,
// на выход — новые { id, x, y, w, h, rotation } без мутаций.

import { itemBounds } from './clearance.js';
import { isFixedSizeComp } from './composite.js';

export const GROUP_HANDLE_TITLES = {
  select: 'Группа выбрана',
  rotate: 'Поворот группы — тяните круг у угла',
  stretch: 'Растяжение группы — тяните квадрат на стороне, противоположная остаётся на месте',
  scale: 'Масштаб группы — тяните угол, противоположный остаётся на месте',
};

export const GROUP_ITEM_MIN = 100; // минимальная сторона предмета при растяжении/масштабе, мм

// Группа мебели: множественный выбор без комнат, не меньше двух предметов.
export function isItemGroup(selection) {
  return selection?.type === 'multi' && !(selection.roomIds || []).length && !(selection.wallIds || []).length && (selection.itemIds || []).length >= 2;
}

// Ключ режима ручек группы (state.itemHandle.id) — по составу выбора.
export function groupHandleId(selection) {
  return isItemGroup(selection) ? `group:${[...selection.itemIds].sort().join(',')}` : null;
}

export function groupItems(project, selection) {
  if (!isItemGroup(selection)) return [];
  const ids = new Set(selection.itemIds);
  return project.items.filter((i) => ids.has(i.id));
}

// Общая рамка: объединение габаритов предметов (у стола — со стульями).
export function groupBounds(items) {
  if (!items.length) return null;
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const item of items) {
    const b = itemBounds(item);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function groupCenter(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

export function groupCorners(box) {
  return [
    { id: 'nw', x: box.x, y: box.y }, { id: 'ne', x: box.x + box.w, y: box.y },
    { id: 'se', x: box.x + box.w, y: box.y + box.h }, { id: 'sw', x: box.x, y: box.y + box.h },
  ];
}

export function groupEdgeHandles(box) {
  const c = groupCenter(box);
  return [
    { id: 'n', x: c.x, y: box.y }, { id: 'e', x: box.x + box.w, y: c.y },
    { id: 's', x: c.x, y: box.y + box.h }, { id: 'w', x: box.x, y: c.y },
  ];
}

// Круги поворота — снаружи углов на outPx экранных пикселей.
export function groupRotators(box, outPx, scale) {
  const out = outPx / scale;
  const c = groupCenter(box);
  return groupCorners(box).map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return { id: p.id, x: p.x + (dx / len) * out, y: p.y + (dy / len) * out };
  });
}

// Снимок предметов в начале жеста.
export function groupStarts(items) {
  return items.map((i) => ({
    id: i.id, x: i.x, y: i.y, w: i.w, h: i.h, rotation: i.rotation || 0,
    fixed: isFixedSizeComp(i), comp: i.comp, kind: i.kind,
  }));
}

const norm = (deg) => {
  const d = ((deg % 360) + 360) % 360;
  return Math.abs(d - 360) < 1e-9 ? 0 : d;
};
const round = (v) => Math.round(v * 1000) / 1000;

// Поворот группы целиком вокруг center на deg (по часовой при оси Y вниз):
// позиции центров поворачиваются, к rotation каждого прибавляется deg.
export function rotateGroup(starts, center, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e12) / 1e12;
  const s = Math.round(Math.sin(r) * 1e12) / 1e12;
  return starts.map((it) => {
    const dx = it.x - center.x;
    const dy = it.y - center.y;
    return {
      id: it.id, w: it.w, h: it.h,
      x: round(center.x + dx * c - dy * s),
      y: round(center.y + dx * s + dy * c),
      rotation: norm(it.rotation + deg),
    };
  });
}

// Угол жеста поворота: от начального направления на курсор, с шагом step°.
export function groupRotateDeg(center, startPoint, point, step = 5) {
  const a0 = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
  const a1 = Math.atan2(point.y - center.y, point.x - center.x);
  let deg = ((a1 - a0) * 180) / Math.PI;
  deg = Math.round(deg / step) * step;
  return norm(deg);
}

// Какая локальная сторона предмета лежит вдоль оси дома: 'w' | 'h' | null
// (null — предмет повёрнут не кратно 90°, растягивать его нельзя без перекоса).
function sideAlong(rotation, axis) {
  const d = norm(Math.round(rotation * 1e6) / 1e6) % 180;
  if (Math.abs(d) < 1e-6 || Math.abs(d - 180) < 1e-6) return axis === 'x' ? 'w' : 'h';
  if (Math.abs(d - 90) < 1e-6) return axis === 'x' ? 'h' : 'w';
  return null;
}

// Растяжение группы со стороны edge ('n'|'e'|'s'|'w'): противоположная
// сторона рамки неподвижна, центры предметов и их размеры вдоль оси
// меняются пропорционально. Повёрнутые не кратно 90° и диваны/кухни-
// конструкторы (фиксированный размер) только сдвигаются, без деформации.
// box — рамка в начале жеста; point — курсор (оси дома).
export function stretchGroup(starts, box, edge, point, { snap = 50, min = GROUP_ITEM_MIN } = {}) {
  const axis = edge === 'e' || edge === 'w' ? 'x' : 'y';
  const sign = edge === 'e' || edge === 's' ? 1 : -1;
  const len0 = axis === 'x' ? box.w : box.h;
  const fixed = axis === 'x' ? (sign > 0 ? box.x : box.x + box.w) : (sign > 0 ? box.y : box.y + box.h);
  const cur = axis === 'x' ? point.x : point.y;
  // Минимум: деформируемые предметы не тоньше min (или своего размера, если он уже меньше).
  let kMin = 0;
  for (const it of starts) {
    const side = it.fixed ? null : sideAlong(it.rotation, axis);
    if (side && it[side] > 0) kMin = Math.max(kMin, Math.min(1, min / it[side]));
  }
  const lenMin = Math.max(snap, len0 * kMin);
  const raw = (cur - fixed) * sign; // без зеркального переворота
  const len = Math.max(lenMin, Math.round(raw / snap) * snap);
  const k = len0 > 0 ? len / len0 : 1;
  const out = starts.map((it) => {
    const res = { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, rotation: it.rotation };
    if (axis === 'x') res.x = round(fixed + (it.x - fixed) * k);
    else res.y = round(fixed + (it.y - fixed) * k);
    const side = it.fixed ? null : sideAlong(it.rotation, axis);
    if (side) res[side] = Math.round(it[side] * k);
    return res;
  });
  const newBox = axis === 'x'
    ? { ...box, x: sign > 0 ? fixed : fixed - len, w: len }
    : { ...box, y: sign > 0 ? fixed : fixed - len, h: len };
  return { items: out, k, box: newBox };
}

// Масштаб группы за угол corner: противоположный угол неподвижен, всё —
// пропорционально с одним коэффициентом (по проекции курсора на диагональ).
// Шаг — по ширине рамки. Диваны/кухни-конструкторы только сдвигаются.
export function scaleGroup(starts, box, corner, point, { snap = 50, min = GROUP_ITEM_MIN } = {}) {
  const opposite = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[corner];
  const corners = groupCorners(box);
  const a = corners.find((c) => c.id === opposite);
  const c0 = corners.find((c) => c.id === corner);
  const dx = c0.x - a.x;
  const dy = c0.y - a.y;
  const d2 = dx * dx + dy * dy || 1;
  let k = ((point.x - a.x) * dx + (point.y - a.y) * dy) / d2;
  let kMin = 0;
  for (const it of starts) {
    if (it.fixed) continue;
    const side = Math.min(it.w, it.h);
    if (side > 0) kMin = Math.max(kMin, Math.min(1, min / side));
  }
  if (box.w > 0 && snap > 0) k = (Math.round((box.w * k) / snap) * snap) / box.w;
  kMin = Math.max(kMin, box.w > 0 ? Math.min(1, snap / box.w) : 0);
  k = Math.max(kMin, k);
  const items = starts.map((it) => ({
    id: it.id,
    x: round(a.x + (it.x - a.x) * k),
    y: round(a.y + (it.y - a.y) * k),
    w: it.fixed ? it.w : Math.round(it.w * k),
    h: it.fixed ? it.h : Math.round(it.h * k),
    rotation: it.rotation,
  }));
  const nx = [a.x, a.x + dx * k];
  const ny = [a.y, a.y + dy * k];
  return {
    items, k,
    box: { x: Math.min(...nx), y: Math.min(...ny), w: Math.abs(dx * k), h: Math.abs(dy * k) },
  };
}

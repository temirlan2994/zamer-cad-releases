// Режимы ручек выбранной мебели: повторный клик по уже выбранному предмету
// переключает «выбор → поворот → растяжение с одной стороны → масштаб».
// Чистая логика без DOM (состояние — state.itemHandle = { id, mode }).

export const ITEM_HANDLE_MODES = ['select', 'rotate', 'stretch', 'scale'];
export const ITEM_HANDLE_TITLES = {
  select: 'Выбрано',
  rotate: 'Поворот — тяните круг у угла',
  stretch: 'Растяжение — тяните квадрат на стороне, противоположная остаётся на месте',
  scale: 'Масштаб — тяните угол',
};

export function itemHandleMode(handle, id) {
  return handle && handle.id === id && ITEM_HANDLE_MODES.includes(handle.mode) ? handle.mode : 'select';
}

export function nextItemHandle(handle, id) {
  const cur = itemHandleMode(handle, id);
  const next = ITEM_HANDLE_MODES[(ITEM_HANDLE_MODES.indexOf(cur) + 1) % ITEM_HANDLE_MODES.length];
  return { id, mode: next };
}

// Середины сторон (локальные оси предмета → мир): n, e, s, w.
export function itemEdgeHandles(item) {
  const rot = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const hw = item.w / 2;
  const hh = item.h / 2;
  return [['n', 0, -hh], ['e', hw, 0], ['s', 0, hh], ['w', -hw, 0]].map(([id, lx, ly]) => ({
    id, x: item.x + lx * c - ly * s, y: item.y + lx * s + ly * c,
  }));
}

// Растяжение с одной стороны: противоположная сторона неподвижна.
// edge — 'n'|'e'|'s'|'w'; point — положение курсора в мире; snap — шаг (мм), min — минимум.
export function stretchItem(item, edge, point, { snap = 50, min = 200 } = {}) {
  const rot = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Курсор в локальных осях предмета относительно его центра.
  const dx = point.x - item.x;
  const dy = point.y - item.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const horizontal = edge === 'e' || edge === 'w';
  const sign = edge === 'e' || edge === 's' ? 1 : -1;
  const fixed = horizontal ? -sign * (item.w / 2) : -sign * (item.h / 2); // положение неподвижной стороны
  const cur = horizontal ? lx : ly;
  const len = Math.max(min, Math.round(Math.abs(cur - fixed) / snap) * snap);
  const dir = cur - fixed >= 0 ? 1 : -1;
  const center = fixed + (dir * len) / 2;
  const out = { w: item.w, h: item.h, x: item.x, y: item.y };
  if (horizontal) {
    out.w = len;
    out.x = item.x + center * c;
    out.y = item.y + center * s;
  } else {
    out.h = len;
    out.x = item.x - center * s;
    out.y = item.y + center * c;
  }
  return out;
}

// Система координат дома. Чистый модуль без DOM.
//
// Комнаты, стены, проёмы и мебель хранятся в ЛОКАЛЬНЫХ координатах дома:
// оси дома = оси X/Y, поэтому вся логика плана (стыковка, стены, проёмы,
// расстановка) работает с прямоугольниками без поворотов. Участок, соседи,
// дороги и топосъёмка — в МИРОВЫХ координатах (координаты съёмки).
//
//   world = origin + R(rotation) · local
//
// rotation — градусы по часовой стрелке на экране (ось Y вниз), origin — где
// в мире лежит локальная точка (0, 0). Тот же знак угла, что у мебели и
// соседних домов (rotateVec).

export function createBuilding() {
  return { rotation: 0, origin: { x: 0, y: 0 } };
}

const RAD = Math.PI / 180;

export function normDeg(deg) {
  const n = Number(deg);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
}

function rotate(x, y, deg) {
  if (!deg) return { x, y };
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: x * c - y * s, y: x * s + y * c };
}

const isIdentity = (b) => !b || (!b.rotation && !b.origin?.x && !b.origin?.y);

// Локальная точка дома → мировая.
export function toWorld(b, p) {
  if (isIdentity(b)) return { x: p.x, y: p.y };
  const r = rotate(p.x, p.y, b.rotation);
  return { x: b.origin.x + r.x, y: b.origin.y + r.y };
}

// Мировая точка → локальная точка дома.
export function toLocal(b, p) {
  if (isIdentity(b)) return { x: p.x, y: p.y };
  return rotate(p.x - b.origin.x, p.y - b.origin.y, -b.rotation);
}

// Четыре мировых угла локального прямоугольника (по часовой от левого верхнего).
export function rectCornersWorld(b, rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ].map((p) => toWorld(b, p));
}

// Новый дом, повёрнутый до newRotation вокруг локальной точки pivot так,
// что pivot остаётся на месте в мире (поворот «на месте»).
export function rotateBuildingAbout(b, pivot, newRotation) {
  const base = b || createBuilding();
  const fixed = toWorld(base, pivot);
  const rotation = normDeg(newRotation);
  const r = rotate(pivot.x, pivot.y, rotation);
  return { rotation, origin: { x: fixed.x - r.x, y: fixed.y - r.y } };
}

// Вид «экран ↔ локальные координаты дома» из вида «экран ↔ мир»
// ({ scale, rotation (рад), panX, panY }): это тот же вид, только повёрнутый
// и сдвинутый — поворот дома жёсткий.
export function composeView(view, b) {
  if (isIdentity(b)) return view;
  const phi = view.rotation || 0;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const o = b.origin;
  return {
    scale: view.scale,
    rotation: phi + b.rotation * RAD,
    panX: view.panX + (o.x * c - o.y * s) * view.scale,
    panY: view.panY + (o.x * s + o.y * c) * view.scale,
  };
}

// Поворот дома, при котором его оси параллельны линии под углом lineDeg:
// из вариантов lineDeg + k·90° выбирается ближайший к текущему повороту,
// чтобы дом не «перекидывало» на 90°.
export function rotationAlongLine(currentDeg, lineDeg) {
  const cur = normDeg(currentDeg);
  let best = null;
  for (let k = 0; k < 4; k += 1) {
    const cand = normDeg(lineDeg + k * 90);
    let diff = Math.abs(cand - cur) % 360;
    if (diff > 180) diff = 360 - diff;
    if (!best || diff < best.diff - 1e-9) best = { cand, diff };
  }
  return best.cand;
}

// Центр габарита комнат верхнего уровня (локально) или null, если комнат нет.
export function buildingCenter(project) {
  const rooms = project.rooms.filter((r) => !r.parentId);
  if (!rooms.length) return null;
  const minX = Math.min(...rooms.map((r) => r.x));
  const minY = Math.min(...rooms.map((r) => r.y));
  const maxX = Math.max(...rooms.map((r) => r.x + r.w));
  const maxY = Math.max(...rooms.map((r) => r.y + r.h));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// Направление на север в осях дома: градусы по часовой от «вверх» плана.
export function northInBuilding(north, b) {
  return normDeg((north || 0) - (b?.rotation || 0));
}

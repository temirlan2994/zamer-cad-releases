// Параметрическая лестница: быстрые пресеты и расчёт удобства.

export const STAIR_SHAPES = [
  { id: 'straight', title: 'Прямая' },
  { id: 'l', title: 'Г-образная' },
  { id: 'u', title: 'П-образная' },
];

export function stairShape(item) {
  return STAIR_SHAPES.some((shape) => shape.id === item?.stairShape) ? item.stairShape : 'straight';
}

const round50 = (value) => Math.max(200, Math.round(value / 50) * 50);

export function stairPreset(shape = 'u', floorHeight = 3000) {
  const risers = Math.max(2, Math.round(floorHeight / 175));
  const treads = risers - 1;
  const flightWidth = 1000;
  const going = 280;
  if (shape === 'straight') return { w: flightWidth, h: round50(treads * going) };
  const first = Math.floor(treads / 2);
  const second = treads - first;
  if (shape === 'l') {
    return { w: round50(flightWidth + second * going), h: round50(flightWidth + first * going) };
  }
  return { w: 2200, h: round50(flightWidth + Math.max(first, second) * going) };
}

export function applyStairPreset(item, shape = stairShape(item), floorHeight = item.floorHeight || 3000) {
  const size = stairPreset(shape, floorHeight);
  item.stairShape = shape;
  item.floorHeight = floorHeight;
  item.w = size.w;
  item.h = size.h;
  return item;
}

export function stairCalculation(item, fallbackHeight = 3000) {
  const shape = stairShape(item);
  const floorH = item.floorHeight || fallbackHeight;
  const risers = Math.max(2, Math.round(floorH / 175));
  const riserH = floorH / risers;
  const treads = risers - 1;
  const firstTreads = shape === 'straight' ? treads : Math.floor(treads / 2);
  const secondTreads = shape === 'straight' ? 0 : treads - firstTreads;
  let treadD;
  if (shape === 'straight') {
    treadD = item.h / Math.max(1, treads);
  } else if (shape === 'l') {
    const flightWidth = Math.min(1000, item.w * 0.42, item.h * 0.42);
    const d1 = (item.h - flightWidth) / Math.max(1, firstTreads);
    const d2 = (item.w - flightWidth) / Math.max(1, secondTreads);
    treadD = Math.min(d1, d2);
  } else {
    const gap = Math.min(200, item.w * 0.1);
    const flightWidth = (item.w - gap) / 2;
    treadD = (item.h - flightWidth) / Math.max(1, firstTreads, secondTreads);
  }
  const comfort = 2 * riserH + treadD;
  const okRiser = riserH >= 150 && riserH <= 190;
  const okTread = treadD >= 230 && treadD <= 340;
  const okComfort = comfort >= 600 && comfort <= 640;
  return {
    shape, floorH, risers, riserH, treads, firstTreads, secondTreads,
    treadD, comfort, okRiser, okTread, okComfort,
  };
}

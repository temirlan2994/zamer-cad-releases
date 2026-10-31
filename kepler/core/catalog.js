// Каталог типов помещений и наборов мебели Kepler Plan.
// Все размеры в миллиметрах. Идентификаторы стабильны — на них завязан
// формат файла проекта и экспорт.

export const DEFAULT_PARTITION = 100; // перегородка между помещениями
export const DEFAULT_EXTERIOR = 250; // наружная стена
export const DOOR_WIDTH = 800;
export const WINDOW_WIDTH = 1200;
export const MIN_PASSAGE = 700; // минимальный проход, мм
export const GRID_STEP = 50; // шаг привязки, мм

// Мебель: rules управляют авторасстановкой.
//   wall        — ставится спинкой к стене
//   center      — ставится в свободном центре комнаты
//   clearFront  — обязательная зона доступа перед предметом, мм
//   clearSides  — зона доступа по бокам (кровати), мм
//   tall        — высокий предмет: не ставить на окно
//   pairWith    — парный предмет (тумбочки к кровати)
//   priority    — порядок расстановки (меньше — раньше)
export const FURNITURE = {
  'bed-double': { title: 'Двуспальная кровать', w: 1600, h: 2000, rules: { wall: true, clearFront: 0, clearSides: 700, tall: false, priority: 1 } },
  'bed-single': { title: 'Односпальная кровать', w: 900, h: 2000, rules: { wall: true, clearSides: 700, priority: 1 } },
  nightstand: { title: 'Прикроватная тумбочка', w: 450, h: 400, rules: { pairWith: ['bed-double', 'bed-single'], priority: 2 } },
  wardrobe: { title: 'Шкаф', w: 1800, h: 600, rules: { wall: true, clearFront: 600, tall: true, priority: 3 } },
  'dressing-table': { title: 'Туалетный столик', w: 1000, h: 450, rules: { wall: true, clearFront: 700, priority: 4 } },
  desk: { title: 'Рабочий стол', w: 1200, h: 600, rules: { wall: true, clearFront: 700, priority: 5 } },
  armchair: { title: 'Кресло', w: 750, h: 800, rules: { wall: true, clearFront: 400, priority: 6 } },
  sofa: { title: 'Диван', w: 2200, h: 950, rules: { wall: true, clearFront: 700, priority: 1 } },
  'sofa-corner': { title: 'Угловой диван', w: 2600, h: 1600, rules: { wall: true, clearFront: 700, priority: 1 } },
  'tv-stand': { title: 'ТВ-тумба', w: 1600, h: 420, rules: { wall: true, clearFront: 1500, priority: 2 } },
  'coffee-table': { title: 'Журнальный столик', w: 900, h: 600, rules: { center: true, priority: 7 } },
  bookcase: { title: 'Стеллаж', w: 1200, h: 350, rules: { wall: true, clearFront: 600, tall: true, priority: 5 } },
  'dining-table': { title: 'Обеденный стол', w: 1600, h: 900, rules: { center: true, clearAround: 750, priority: 1 } },
  chair: { title: 'Стул', w: 450, h: 450, rules: { pairWith: ['dining-table'], priority: 2 } },
  'kitchen-row': { title: 'Кухонный гарнитур', w: 2400, h: 600, rules: { wall: true, clearFront: 1000, tall: true, priority: 1 } },
  stove: { title: 'Плита', w: 600, h: 600, rules: { wall: true, clearFront: 1000, priority: 2 } },
  sink: { title: 'Мойка', w: 600, h: 500, rules: { wall: true, clearFront: 800, priority: 3 } },
  fridge: { title: 'Холодильник', w: 650, h: 650, rules: { wall: true, clearFront: 900, tall: true, priority: 4 } },
  bath: { title: 'Ванна', w: 1700, h: 750, rules: { wall: true, clearFront: 700, priority: 1 } },
  shower: { title: 'Душевая кабина', w: 900, h: 900, rules: { wall: true, clearFront: 700, priority: 1 } },
  toilet: { title: 'Унитаз', w: 400, h: 650, rules: { wall: true, clearFront: 600, priority: 2 } },
  washbasin: { title: 'Раковина', w: 550, h: 450, rules: { wall: true, clearFront: 600, priority: 3 } },
  washer: { title: 'Стиральная машина', w: 600, h: 600, rules: { wall: true, clearFront: 600, priority: 4 } },
  'coat-rack': { title: 'Вешалка/шкаф прихожей', w: 1200, h: 500, rules: { wall: true, clearFront: 700, priority: 1 } },
  'shoe-bench': { title: 'Обувница', w: 900, h: 350, rules: { wall: true, clearFront: 600, priority: 2 } },
  'wardrobe-rack': { title: 'Стеллаж гардеробной', w: 1800, h: 500, rules: { wall: true, clearFront: 600, tall: true, priority: 1 } },
  car: { title: 'Автомобиль', w: 1900, h: 4800, rules: { center: true, clearAround: 600, priority: 1 } },
  workbench: { title: 'Верстак', w: 1800, h: 650, rules: { wall: true, clearFront: 900, priority: 2 } },
  'garden-set': { title: 'Садовая мебель', w: 1800, h: 1800, rules: { center: true, priority: 1 } },
  stairs: { title: 'Лестничный марш', w: 1000, h: 3000, rules: { wall: true, clearFront: 1000, priority: 1 } },
};

// Типы помещений. furniture — набор доступных галочек (default: включены по умолчанию).
export const ROOM_TYPES = [
  { type: 'living', title: 'Гостиная', w: 5000, h: 4200, tint: 'warm', furniture: [
    { kind: 'sofa', default: true }, { kind: 'tv-stand', default: true }, { kind: 'coffee-table', default: true },
    { kind: 'armchair', default: false }, { kind: 'bookcase', default: false }, { kind: 'sofa-corner', default: false },
  ] },
  { type: 'kitchen', title: 'Кухня', w: 3600, h: 3000, tint: 'wet', furniture: [
    { kind: 'kitchen-row', default: true }, { kind: 'stove', default: true }, { kind: 'sink', default: true },
    { kind: 'fridge', default: true }, { kind: 'dining-table', default: false }, { kind: 'chair', default: false },
  ] },
  { type: 'dining', title: 'Столовая', w: 3600, h: 3200, tint: 'warm', furniture: [
    { kind: 'dining-table', default: true }, { kind: 'chair', default: true }, { kind: 'bookcase', default: false },
  ] },
  { type: 'bedroom', title: 'Спальня', w: 4000, h: 3500, tint: 'calm', furniture: [
    { kind: 'bed-double', default: true }, { kind: 'nightstand', default: true }, { kind: 'wardrobe', default: true },
    { kind: 'dressing-table', default: false }, { kind: 'desk', default: false }, { kind: 'armchair', default: false },
  ] },
  { type: 'master-bedroom', title: 'Мастер-спальня', w: 4800, h: 4200, tint: 'calm', furniture: [
    { kind: 'bed-double', default: true }, { kind: 'nightstand', default: true }, { kind: 'wardrobe', default: true },
    { kind: 'dressing-table', default: true }, { kind: 'armchair', default: false }, { kind: 'desk', default: false },
  ] },
  { type: 'bathroom', title: 'Санузел', w: 2200, h: 2000, tint: 'wet', furniture: [
    { kind: 'bath', default: true }, { kind: 'toilet', default: true }, { kind: 'washbasin', default: true },
    { kind: 'shower', default: false }, { kind: 'washer', default: false },
  ] },
  { type: 'wardrobe-room', title: 'Гардеробная', w: 2000, h: 1800, tint: 'calm', furniture: [
    { kind: 'wardrobe-rack', default: true },
  ] },
  { type: 'cabinet', title: 'Кабинет', w: 3200, h: 2800, tint: 'warm', furniture: [
    { kind: 'desk', default: true }, { kind: 'armchair', default: true }, { kind: 'bookcase', default: true },
  ] },
  { type: 'hall', title: 'Холл', w: 3000, h: 2400, tint: 'neutral', furniture: [
    { kind: 'coat-rack', default: true }, { kind: 'shoe-bench', default: true },
  ] },
  { type: 'corridor', title: 'Коридор', w: 3000, h: 1200, tint: 'neutral', furniture: [] },
  { type: 'stairs-room', title: 'Лестница', w: 2400, h: 3200, tint: 'neutral', furniture: [
    { kind: 'stairs', default: true },
  ] },
  { type: 'garage', title: 'Гараж', w: 3600, h: 6000, tint: 'cool', furniture: [
    { kind: 'car', default: true }, { kind: 'workbench', default: false },
  ] },
  { type: 'terrace', title: 'Терраса', w: 4000, h: 2500, tint: 'green', furniture: [
    { kind: 'garden-set', default: false },
  ] },
];

const roomTypeMap = new Map(ROOM_TYPES.map((t) => [t.type, t]));

export function roomType(type) {
  return roomTypeMap.get(type) || null;
}

export function furnitureDef(kind) {
  return FURNITURE[kind] || null;
}

// Галочки мебели по умолчанию для нового помещения.
export function defaultChecklist(type) {
  const def = roomTypeMap.get(type);
  const checklist = {};
  if (!def) return checklist;
  for (const entry of def.furniture) checklist[entry.kind] = Boolean(entry.default);
  return checklist;
}

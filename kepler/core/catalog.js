// Каталог типов помещений и наборов мебели Kepler Plan.
// Все размеры в миллиметрах. Идентификаторы стабильны — на них завязан
// формат файла проекта и экспорт.

export const DEFAULT_PARTITION = 100; // перегородка между помещениями
export const DEFAULT_EXTERIOR = 250; // наружная стена
export const DEFAULT_BEARING = 200; // внутренняя несущая стена
export const DOOR_WIDTH = 800;
export const WINDOW_WIDTH = 1200;
export const MIN_PASSAGE = 700; // минимальный проход, мм
export const GRID_STEP = 50; // шаг привязки, мм (крупный масштаб экрана — см. gridStepForScale)

// Шаг привязки зависит от приближения камеры: чем крупнее план на экране, тем
// мельче шаг — объекты двигаются точнее. scale — пикселей на мм (по умолчанию
// 0,08: шаг 50 мм). Берётся самый мелкий шаг, который на экране не меньше 8 px.
export function gridStepForScale(scale) {
  if (!(scale > 0)) return GRID_STEP;
  for (const step of [1, 5, 10, 25, 50]) if (step * scale >= 8) return step;
  return GRID_STEP;
}

// В поиске размер с карточки можно ввести с латинской x, русской х или знаком ×.
export function normalizeCatalogText(text) {
  return text.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/(\d)\s*[xх×]\s*(?=\d)/g, '$1×');
}

// Категории мебели для нижней панели (порядок = порядок вкладок).
export const FURNITURE_CATEGORIES = [
  { id: 'seating', title: 'Диваны и кресла' },
  { id: 'beds', title: 'Кровати' },
  { id: 'tables', title: 'Столы' },
  { id: 'chairs', title: 'Стулья' },
  { id: 'storage', title: 'Хранение' },
  { id: 'kitchen', title: 'Кухня' },
  { id: 'bath', title: 'Санузел' },
  { id: 'appliance', title: 'Техника' },
  { id: 'decor', title: 'Декор и свет' },
  { id: 'office', title: 'Кабинет' },
  { id: 'kids', title: 'Детская' },
  { id: 'gym', title: 'Спорт' },
  { id: 'hall', title: 'Прихожая' },
  { id: 'outdoor', title: 'Улица и гараж' },
  { id: 'misc', title: 'Разное' },
  { id: 'structure', title: 'Стены и колонны' },
];

// Мебель — все предметы параметрические (w/h свободно меняются, поворот).
//   cat         — категория для панели
//   wall        — ставится спинкой к стене при авторасстановке
//   center      — ставится в свободном центре комнаты
//   clearFront  — обязательная зона доступа перед предметом, мм
//   clearSides  — зона доступа по бокам (кровати), мм
//   tall        — высокий предмет: не ставить на окно
//   pairWith    — парный предмет (тумбочки к кровати)
//   priority    — порядок авторасстановки (меньше — раньше)
export const FURNITURE = {
  // --- Диваны и кресла ---
  sofa: { title: 'Диван 3-местный', cat: 'seating', w: 2200, h: 950, rules: { wall: true, clearFront: 700, priority: 1 } },
  'sofa-2': { title: 'Диван 2-местный', cat: 'seating', w: 1600, h: 900, rules: { wall: true, clearFront: 700, priority: 1 } },
  'sofa-corner': { title: 'Угловой диван', cat: 'seating', w: 2600, h: 1600, rules: { wall: true, clearFront: 700, priority: 1 } },
  'sofa-u': { title: 'П-образный диван', cat: 'seating', w: 3000, h: 2400, rules: { wall: true, clearFront: 700, priority: 1 } },
  loveseat: { title: 'Кушетка', cat: 'seating', w: 1800, h: 800, rules: { wall: true, clearFront: 500, priority: 2 } },
  armchair: { title: 'Кресло', cat: 'seating', w: 750, h: 800, rules: { wall: true, clearFront: 400, priority: 6 } },
  'armchair-lounge': { title: 'Кресло-лаунж', cat: 'seating', w: 850, h: 950, rules: { wall: false, clearFront: 400, priority: 6 } },
  pouf: { title: 'Пуф', cat: 'seating', w: 500, h: 500, rules: { center: true, priority: 8 } },
  bench: { title: 'Банкетка', cat: 'seating', w: 1200, h: 400, rules: { wall: true, clearFront: 400, priority: 6 } },

  // --- Кровати ---
  'bed-double': { title: 'Кровать двуспальная', cat: 'beds', w: 1600, h: 2000, rules: { wall: true, clearSides: 700, tall: false, priority: 1 } },
  'bed-king': { title: 'Кровать King 1800', cat: 'beds', w: 1800, h: 2000, rules: { wall: true, clearSides: 700, priority: 1 } },
  'bed-single': { title: 'Кровать односпальная', cat: 'beds', w: 900, h: 2000, rules: { wall: true, clearSides: 700, priority: 1 } },
  'bed-bunk': { title: 'Кровать двухъярусная', cat: 'beds', w: 950, h: 2000, rules: { wall: true, clearSides: 600, tall: true, priority: 1 } },
  crib: { title: 'Детская кроватка', cat: 'beds', w: 700, h: 1300, rules: { wall: true, clearFront: 500, priority: 2 } },
  nightstand: { title: 'Прикроватная тумбочка', cat: 'beds', w: 450, h: 400, rules: { pairWith: ['bed-double', 'bed-king', 'bed-single'], priority: 2 } },
  'dressing-table': { title: 'Туалетный столик', cat: 'beds', w: 1000, h: 450, rules: { wall: true, clearFront: 700, priority: 4 } },

  // --- Столы ---
  'dining-table': { title: 'Обеденный стол', cat: 'tables', w: 1600, h: 900, rules: { center: true, clearAround: 750, priority: 1 } },
  'dining-table-6': { title: 'Стол на 6 персон', cat: 'tables', w: 1800, h: 900, rules: { center: true, clearAround: 750, priority: 1 } },
  'table-round': { title: 'Стол круглый', cat: 'tables', w: 1100, h: 1100, rules: { center: true, clearAround: 750, priority: 1 } },
  'coffee-table': { title: 'Журнальный столик', cat: 'tables', w: 900, h: 600, rules: { center: true, priority: 7 } },
  'side-table': { title: 'Приставной столик', cat: 'tables', w: 500, h: 500, rules: { center: true, priority: 8 } },
  desk: { title: 'Рабочий стол', cat: 'tables', w: 1200, h: 600, rules: { wall: true, clearFront: 700, priority: 5 } },
  'desk-corner': { title: 'Угловой стол', cat: 'tables', w: 1500, h: 1500, rules: { wall: true, clearFront: 700, priority: 5 } },
  'console-table': { title: 'Консоль', cat: 'tables', w: 1100, h: 350, rules: { wall: true, clearFront: 400, priority: 6 } },

  // --- Стулья ---
  chair: { title: 'Стул', cat: 'chairs', w: 450, h: 450, rules: { pairWith: ['dining-table', 'dining-table-6', 'table-round'], priority: 2 } },
  'chair-soft': { title: 'Стул мягкий', cat: 'chairs', w: 500, h: 520, rules: { pairWith: ['dining-table', 'dining-table-6'], priority: 2 } },
  'office-chair': { title: 'Офисное кресло', cat: 'chairs', w: 600, h: 600, rules: { center: false, priority: 6 } },
  stool: { title: 'Табурет', cat: 'chairs', w: 400, h: 400, rules: { center: true, priority: 8 } },
  'bar-stool': { title: 'Барный стул', cat: 'chairs', w: 420, h: 420, rules: { center: true, priority: 8 } },

  // --- Хранение ---
  wardrobe: { title: 'Шкаф', cat: 'storage', w: 1800, h: 600, rules: { wall: true, clearFront: 600, tall: true, priority: 3 } },
  'wardrobe-sliding': { title: 'Шкаф-купе', cat: 'storage', w: 2400, h: 650, rules: { wall: true, clearFront: 600, tall: true, priority: 3 } },
  'wardrobe-corner': { title: 'Угловой шкаф', cat: 'storage', w: 1000, h: 1000, rules: { wall: true, clearFront: 600, tall: true, priority: 3 } },
  dresser: { title: 'Комод', cat: 'storage', w: 1000, h: 450, rules: { wall: true, clearFront: 600, priority: 4 } },
  bookcase: { title: 'Стеллаж', cat: 'storage', w: 1200, h: 350, rules: { wall: true, clearFront: 600, tall: true, priority: 5 } },
  'wardrobe-rack': { title: 'Стеллаж гардеробной', cat: 'storage', w: 1800, h: 500, rules: { wall: true, clearFront: 600, tall: true, priority: 1 } },
  sideboard: { title: 'Сервант', cat: 'storage', w: 1600, h: 450, rules: { wall: true, clearFront: 600, priority: 4 } },
  'tv-stand': { title: 'ТВ-тумба', cat: 'storage', w: 1600, h: 420, rules: { wall: true, clearFront: 1500, priority: 2 } },

  // --- Кухня ---
  'kitchen-row': { title: 'Кухня линейная', cat: 'kitchen', w: 2400, h: 600, rules: { wall: true, clearFront: 1000, tall: true, priority: 1 } },
  'kitchen-island': { title: 'Кухонный остров', cat: 'kitchen', w: 1800, h: 900, rules: { center: true, clearAround: 900, priority: 2 } },
  stove: { title: 'Плита', cat: 'kitchen', w: 600, h: 600, rules: { wall: true, clearFront: 1000, priority: 2 } },
  'cooktop-hood': { title: 'Варочная с вытяжкой', cat: 'kitchen', w: 900, h: 600, rules: { wall: true, clearFront: 1000, priority: 2 } },
  sink: { title: 'Мойка', cat: 'kitchen', w: 600, h: 500, rules: { wall: true, clearFront: 800, priority: 3 } },
  'bar-counter': { title: 'Барная стойка', cat: 'kitchen', w: 1600, h: 500, rules: { wall: true, clearFront: 900, priority: 3 } },

  // --- Санузел ---
  bath: { title: 'Ванна', cat: 'bath', w: 1700, h: 750, rules: { wall: true, clearFront: 700, priority: 1 } },
  'bath-corner': { title: 'Ванна угловая', cat: 'bath', w: 1500, h: 1500, rules: { wall: true, clearFront: 700, priority: 1 } },
  shower: { title: 'Душевая кабина', cat: 'bath', w: 900, h: 900, rules: { wall: true, clearFront: 700, priority: 1 } },
  toilet: { title: 'Унитаз', cat: 'bath', w: 400, h: 650, rules: { wall: true, clearFront: 600, priority: 2 } },
  bidet: { title: 'Биде', cat: 'bath', w: 400, h: 600, rules: { wall: true, clearFront: 600, priority: 2 } },
  washbasin: { title: 'Раковина', cat: 'bath', w: 550, h: 450, rules: { wall: true, clearFront: 600, priority: 3 } },
  'vanity-unit': { title: 'Тумба с раковиной', cat: 'bath', w: 800, h: 480, rules: { wall: true, clearFront: 700, priority: 3 } },
  'towel-rail': { title: 'Полотенцесушитель', cat: 'bath', w: 600, h: 120, rules: { wall: true, clearFront: 300, priority: 5 } },

  // --- Техника ---
  fridge: { title: 'Холодильник', cat: 'appliance', w: 650, h: 650, rules: { wall: true, clearFront: 900, tall: true, priority: 4 } },
  'fridge-side': { title: 'Холодильник Side-by-Side', cat: 'appliance', w: 900, h: 700, rules: { wall: true, clearFront: 900, tall: true, priority: 4 } },
  washer: { title: 'Стиральная машина', cat: 'appliance', w: 600, h: 600, rules: { wall: true, clearFront: 600, priority: 4 } },
  dryer: { title: 'Сушильная машина', cat: 'appliance', w: 600, h: 600, rules: { wall: true, clearFront: 600, priority: 4 } },
  dishwasher: { title: 'Посудомоечная машина', cat: 'appliance', w: 600, h: 600, rules: { wall: true, clearFront: 700, priority: 4 } },
  tv: { title: 'Телевизор', cat: 'appliance', w: 1300, h: 80, rules: { wall: true, clearFront: 0, priority: 7 } },
  boiler: { title: 'Котёл/бойлер', cat: 'appliance', w: 600, h: 400, rules: { wall: true, clearFront: 500, tall: true, priority: 5 } },

  // --- Декор и свет ---
  'coffee-table-2': { title: 'Пуф-столик', cat: 'decor', w: 600, h: 600, rules: { center: true, priority: 8 } },
  plant: { title: 'Растение', cat: 'decor', w: 500, h: 500, rules: { center: false, priority: 9 } },
  'floor-lamp': { title: 'Торшер', cat: 'decor', w: 400, h: 400, rules: { center: false, priority: 9 } },
  rug: { title: 'Ковёр', cat: 'decor', w: 2000, h: 1400, rules: { center: true, priority: 10 } },
  piano: { title: 'Пианино', cat: 'decor', w: 1500, h: 600, rules: { wall: true, clearFront: 800, tall: true, priority: 3 } },
  fireplace: { title: 'Камин', cat: 'decor', w: 1200, h: 500, rules: { wall: true, clearFront: 900, tall: true, priority: 2 } },
  aquarium: { title: 'Аквариум', cat: 'decor', w: 1200, h: 450, rules: { wall: true, clearFront: 500, priority: 5 } },

  // --- Прихожая ---
  'coat-rack': { title: 'Вешалка/шкаф прихожей', cat: 'hall', w: 1200, h: 500, rules: { wall: true, clearFront: 700, priority: 1 } },
  'shoe-bench': { title: 'Обувница', cat: 'hall', w: 900, h: 350, rules: { wall: true, clearFront: 600, priority: 2 } },
  mirror: { title: 'Зеркало', cat: 'hall', w: 600, h: 120, rules: { wall: true, clearFront: 300, priority: 5 } },
  stairs: { title: 'Лестничный марш', cat: 'hall', w: 1000, h: 3000, rules: { wall: true, clearFront: 1000, priority: 1 } },

  // --- Улица и гараж ---
  car: { title: 'Автомобиль', cat: 'outdoor', w: 1900, h: 4800, rules: { center: true, clearAround: 600, priority: 1 } },
  'car-suv': { title: 'Внедорожник', cat: 'outdoor', w: 2000, h: 5000, rules: { center: true, clearAround: 600, priority: 1 } },
  motorcycle: { title: 'Мотоцикл', cat: 'outdoor', w: 800, h: 2100, rules: { center: true, clearAround: 400, priority: 2 } },
  workbench: { title: 'Верстак', cat: 'outdoor', w: 1800, h: 650, rules: { wall: true, clearFront: 900, priority: 2 } },
  'garden-set': { title: 'Садовая мебель', cat: 'outdoor', w: 1800, h: 1800, rules: { center: true, priority: 1 } },
  'garden-lounger': { title: 'Шезлонг', cat: 'outdoor', w: 700, h: 1900, rules: { center: true, priority: 3 } },
  bbq: { title: 'Мангал/гриль', cat: 'outdoor', w: 700, h: 600, rules: { wall: false, clearFront: 800, priority: 3 } },
  pool: { title: 'Бассейн', cat: 'outdoor', w: 4000, h: 2500, rules: { center: true, priority: 1 } },

  // --- Разное ---
  box: { title: 'Прямоугольный блок', cat: 'misc', w: 1000, h: 1000, rules: { center: false, priority: 9 } },
  // --- Конструкции (structural): рисуются как стены, в 3D — на высоту
  // этажа, в DXF — слой стен; это не мебель, к ним не нужен проход.
  'wall-free': { title: 'Стена', cat: 'structure', w: 3000, h: 120, structural: true, rules: { center: false, priority: 9 } },
  column: { title: 'Колонна', cat: 'structure', w: 400, h: 400, structural: true, rules: { center: false, priority: 9 } },
  'column-round': { title: 'Колонна круглая', cat: 'structure', w: 400, h: 400, structural: true, round: true, rules: { center: false, priority: 9 } },

  // --- Дополнительно: диваны/кресла ---
  daybed: { title: 'Кушетка-лежанка', cat: 'seating', w: 1900, h: 900, rules: { wall: true, clearFront: 600, priority: 2 } },
  recliner: { title: 'Кресло-реклайнер', cat: 'seating', w: 900, h: 1000, rules: { wall: true, clearFront: 600, priority: 6 } },
  'bean-bag': { title: 'Кресло-мешок', cat: 'seating', w: 800, h: 800, rules: { center: false, priority: 8 } },
  'sofa-bed': { title: 'Диван-кровать', cat: 'seating', w: 2000, h: 1000, rules: { wall: true, clearFront: 700, priority: 1 } },

  // --- Кровати ---
  'bed-queen': { title: 'Кровать Queen 1400', cat: 'beds', w: 1400, h: 2000, rules: { wall: true, clearSides: 700, priority: 1 } },

  // --- Столы ---
  'desk-l': { title: 'Угловой письменный стол', cat: 'tables', w: 1600, h: 1400, rules: { wall: true, clearFront: 700, priority: 5 } },
  'bar-table': { title: 'Барный стол', cat: 'tables', w: 600, h: 600, rules: { center: true, priority: 6 } },

  // --- Стулья ---
  'folding-chair': { title: 'Складной стул', cat: 'chairs', w: 450, h: 450, rules: { center: false, priority: 8 } },
  'gaming-chair': { title: 'Игровое кресло', cat: 'chairs', w: 650, h: 650, rules: { center: false, priority: 6 } },

  // --- Хранение ---
  'shelf-open': { title: 'Открытая полка', cat: 'storage', w: 900, h: 300, rules: { wall: true, clearFront: 400, priority: 5 } },
  'display-cabinet': { title: 'Витрина', cat: 'storage', w: 1000, h: 450, rules: { wall: true, clearFront: 500, tall: true, priority: 4 } },
  chest: { title: 'Сундук', cat: 'storage', w: 1000, h: 500, rules: { wall: true, clearFront: 400, priority: 6 } },

  // --- Кухня ---
  oven: { title: 'Духовой шкаф', cat: 'kitchen', w: 600, h: 600, rules: { wall: true, clearFront: 900, priority: 3 } },
  microwave: { title: 'СВЧ-печь', cat: 'kitchen', w: 500, h: 350, rules: { wall: true, clearFront: 300, priority: 5 } },
  // Кухни-конструкторы (core/kitchen.js): размер — габарит частей по умолчанию.
  'kitchen-corner': { title: 'Кухня Г-образная', cat: 'kitchen', w: 2400, h: 1800, rules: { wall: true, clearFront: 1000, tall: true, priority: 1 } },
  'kitchen-u': { title: 'Кухня П-образная', cat: 'kitchen', w: 3000, h: 1800, rules: { wall: true, clearFront: 1000, tall: true, priority: 1 } },
  pantry: { title: 'Пенал/кладовка', cat: 'kitchen', w: 600, h: 600, rules: { wall: true, clearFront: 700, tall: true, priority: 2 } },

  // --- Санузел ---
  'washbasin-double': { title: 'Двойная раковина', cat: 'bath', w: 1200, h: 500, rules: { wall: true, clearFront: 700, priority: 3 } },
  jacuzzi: { title: 'Джакузи', cat: 'bath', w: 2000, h: 2000, rules: { wall: true, clearFront: 700, priority: 1 } },
  urinal: { title: 'Писсуар', cat: 'bath', w: 400, h: 350, rules: { wall: true, clearFront: 500, priority: 3 } },

  // --- Техника ---
  hood: { title: 'Вытяжка', cat: 'appliance', w: 600, h: 500, rules: { wall: true, clearFront: 0, priority: 6 } },
  'ac-unit': { title: 'Кондиционер', cat: 'appliance', w: 900, h: 250, rules: { wall: true, clearFront: 0, priority: 7 } },

  // --- Декор и свет ---
  chandelier: { title: 'Люстра', cat: 'decor', w: 700, h: 700, rules: { center: false, priority: 9 } },
  curtain: { title: 'Штора', cat: 'decor', w: 1800, h: 150, rules: { wall: true, clearFront: 0, priority: 9 } },
  'rug-round': { title: 'Круглый ковёр', cat: 'decor', w: 1800, h: 1800, rules: { center: true, priority: 10 } },

  // --- Кабинет (офис) ---
  'office-desk': { title: 'Офисный стол', cat: 'office', w: 1400, h: 700, rules: { wall: true, clearFront: 800, priority: 2 } },
  'conference-table': { title: 'Стол переговоров', cat: 'office', w: 2400, h: 1200, rules: { center: true, clearAround: 800, priority: 1 } },
  'filing-cabinet': { title: 'Картотека', cat: 'office', w: 500, h: 600, rules: { wall: true, clearFront: 600, priority: 4 } },
  safe: { title: 'Сейф', cat: 'office', w: 600, h: 600, rules: { wall: true, clearFront: 500, priority: 5 } },
  printer: { title: 'Принтер/МФУ', cat: 'office', w: 500, h: 450, rules: { center: false, priority: 6 } },

  // --- Детская ---
  'kids-bed': { title: 'Детская кровать', cat: 'kids', w: 900, h: 1700, rules: { wall: true, clearSides: 600, priority: 1 } },
  'changing-table': { title: 'Пеленальный столик', cat: 'kids', w: 800, h: 600, rules: { wall: true, clearFront: 600, priority: 3 } },
  'toy-box': { title: 'Ящик для игрушек', cat: 'kids', w: 800, h: 450, rules: { wall: true, clearFront: 400, priority: 5 } },
  'kids-desk': { title: 'Парта', cat: 'kids', w: 1000, h: 550, rules: { wall: true, clearFront: 700, priority: 4 } },

  // --- Спорт ---
  treadmill: { title: 'Беговая дорожка', cat: 'gym', w: 900, h: 2000, rules: { wall: true, clearFront: 700, priority: 2 } },
  'exercise-bike': { title: 'Велотренажёр', cat: 'gym', w: 600, h: 1200, rules: { center: false, priority: 3 } },
  'weight-bench': { title: 'Силовая скамья', cat: 'gym', w: 700, h: 1400, rules: { center: false, priority: 3 } },
  'yoga-mat': { title: 'Коврик для йоги', cat: 'gym', w: 600, h: 1800, rules: { center: true, priority: 6 } },
  'ping-pong': { title: 'Теннисный стол', cat: 'gym', w: 1525, h: 2740, rules: { center: true, clearAround: 1000, priority: 1 } },

  // --- Прихожая ---
  'umbrella-stand': { title: 'Стойка для зонтов', cat: 'hall', w: 300, h: 300, rules: { wall: true, clearFront: 300, priority: 5 } },

  // --- Улица и гараж ---
  bicycle: { title: 'Велосипед', cat: 'outdoor', w: 600, h: 1800, rules: { wall: true, clearFront: 300, priority: 3 } },
  trampoline: { title: 'Батут', cat: 'outdoor', w: 3000, h: 3000, rules: { center: true, priority: 2 } },
  'hot-tub': { title: 'СПА / джакузи', cat: 'outdoor', w: 2200, h: 2200, rules: { center: true, priority: 2 } },
  gazebo: { title: 'Беседка', cat: 'outdoor', w: 3000, h: 3000, rules: { center: true, priority: 1 } },
  sandbox: { title: 'Песочница', cat: 'outdoor', w: 1500, h: 1500, rules: { center: true, priority: 3 } },
};

// Категории помещений: порядок = порядок групп в библиотеке и в списке типа
// в «Свойствах». hue/sat — оттенок категории (HSL); тип внутри категории
// сдвигается на shade (−2…2) — чуть другой тон и светлота.
export const ROOM_CATEGORIES = [
  { id: 'living', title: 'Жилые', hue: 36, sat: 58 },
  { id: 'kitchen', title: 'Кухня и столовая', hue: 14, sat: 62 },
  { id: 'wet', title: 'Санузлы и гигиена', hue: 190, sat: 48 },
  { id: 'utility', title: 'Хозяйственные', hue: 262, sat: 34 },
  { id: 'circulation', title: 'Вход и проходы', hue: 214, sat: 20 },
  { id: 'outdoor', title: 'Гараж и улица', hue: 108, sat: 32 },
];

// Типы помещений. Идентификаторы type стабильны (формат файла, экспорт).
//   cat       — категория (ROOM_CATEGORIES), shade — оттенок внутри неё
//   living    — жилая комната: жилая площадь в ТЭП, нормы света и высоты
//   wc        — санузел: ширина по СП (с ванной 1,5 м, без ванны 0,8 м)
//   summer    — летнее помещение (в общую площадь не входит)
//   open      — открытое (без стен, с ограждением); тоже летнее
//   ifc       — PredefinedType IfcSpace (по умолчанию SPACE), ifcName — ObjectType
//   furniture — набор доступных галочек (default: включены по умолчанию)
export const ROOM_TYPES = [
  // --- Жилые ---
  { type: 'living', title: 'Гостиная', cat: 'living', shade: 0, living: true, ifcName: 'Living room', w: 5000, h: 4200, furniture: [
    { kind: 'sofa', default: true }, { kind: 'tv-stand', default: true }, { kind: 'coffee-table', default: true },
    { kind: 'armchair', default: false }, { kind: 'bookcase', default: false }, { kind: 'sofa-corner', default: false },
  ] },
  { type: 'bedroom', title: 'Спальня', cat: 'living', shade: 1, living: true, ifcName: 'Bedroom', w: 4000, h: 3500, furniture: [
    { kind: 'bed-double', default: true }, { kind: 'nightstand', default: true }, { kind: 'wardrobe', default: true },
    { kind: 'dressing-table', default: false }, { kind: 'desk', default: false }, { kind: 'armchair', default: false },
  ] },
  { type: 'master-bedroom', title: 'Мастер-спальня', cat: 'living', shade: 2, living: true, ifcName: 'Master bedroom', w: 4800, h: 4200, furniture: [
    { kind: 'bed-double', default: true }, { kind: 'nightstand', default: true }, { kind: 'wardrobe', default: true },
    { kind: 'dressing-table', default: true }, { kind: 'armchair', default: false }, { kind: 'desk', default: false },
  ] },
  { type: 'kids-room', title: 'Детская', cat: 'living', shade: 1, living: true, ifcName: 'Children room', w: 3600, h: 3400, furniture: [
    { kind: 'kids-bed', default: true }, { kind: 'wardrobe', default: true }, { kind: 'kids-desk', default: true },
    { kind: 'toy-box', default: false }, { kind: 'crib', default: false }, { kind: 'changing-table', default: false },
  ] },
  { type: 'guest-bedroom', title: 'Гостевая спальня', cat: 'living', shade: 1, living: true, ifcName: 'Guest bedroom', w: 3400, h: 3200, furniture: [
    { kind: 'bed-double', default: true }, { kind: 'nightstand', default: true }, { kind: 'wardrobe', default: false },
  ] },
  { type: 'cabinet', title: 'Кабинет', cat: 'living', shade: -1, living: true, ifcName: 'Study', w: 3200, h: 2800, furniture: [
    { kind: 'desk', default: true }, { kind: 'armchair', default: true }, { kind: 'bookcase', default: true },
  ] },
  { type: 'library', title: 'Библиотека', cat: 'living', shade: -1, living: true, ifcName: 'Library', w: 3600, h: 3200, furniture: [
    { kind: 'bookcase', default: true }, { kind: 'armchair', default: true }, { kind: 'side-table', default: false },
  ] },
  { type: 'gym', title: 'Спортзал', cat: 'living', shade: -2, ifcName: 'Gym', w: 4000, h: 3600, furniture: [
    { kind: 'treadmill', default: true }, { kind: 'weight-bench', default: false }, { kind: 'exercise-bike', default: false },
  ] },
  // --- Кухня и столовая ---
  { type: 'kitchen', title: 'Кухня', cat: 'kitchen', shade: 0, ifcName: 'Kitchen', w: 3600, h: 3000, furniture: [
    { kind: 'kitchen-row', default: true }, { kind: 'stove', default: true }, { kind: 'sink', default: true },
    { kind: 'fridge', default: true }, { kind: 'dining-table', default: false }, { kind: 'chair', default: false },
  ] },
  // Кухня-гостиная — гостиная с кухонной зоной: жилая комната.
  { type: 'kitchen-living', title: 'Кухня-гостиная', cat: 'kitchen', shade: 1, living: true, ifcName: 'Kitchen-living room', w: 6500, h: 4500, furniture: [
    { kind: 'kitchen-row', default: true }, { kind: 'fridge', default: true }, { kind: 'sofa', default: true },
    { kind: 'dining-table', default: true }, { kind: 'tv-stand', default: false }, { kind: 'kitchen-island', default: false },
  ] },
  { type: 'dining', title: 'Столовая', cat: 'kitchen', shade: -1, ifcName: 'Dining room', w: 3600, h: 3200, furniture: [
    { kind: 'dining-table', default: true }, { kind: 'chair', default: true }, { kind: 'bookcase', default: false },
  ] },
  { type: 'pantry', title: 'Кладовая продуктов', cat: 'kitchen', shade: -2, ifcName: 'Pantry', w: 1800, h: 1500, furniture: [
    { kind: 'shelf-open', default: true }, { kind: 'fridge', default: false },
  ] },
  // --- Санузлы и гигиена ---
  { type: 'bathroom', title: 'Санузел', cat: 'wet', shade: 0, wc: true, ifcName: 'Bathroom', w: 2200, h: 2000, furniture: [
    { kind: 'bath', default: true }, { kind: 'toilet', default: true }, { kind: 'washbasin', default: true },
    { kind: 'shower', default: false }, { kind: 'washer', default: false },
  ] },
  { type: 'guest-wc', title: 'Гостевой санузел', cat: 'wet', shade: 1, wc: true, ifcName: 'Guest WC', w: 1500, h: 1300, furniture: [
    { kind: 'toilet', default: true }, { kind: 'washbasin', default: true },
  ] },
  { type: 'shower-room', title: 'Душевая', cat: 'wet', shade: -1, wc: true, ifcName: 'Shower room', w: 1800, h: 1500, furniture: [
    { kind: 'shower', default: true }, { kind: 'washbasin', default: true }, { kind: 'toilet', default: false },
  ] },
  { type: 'tub-room', title: 'Ванная', cat: 'wet', shade: 2, wc: true, ifcName: 'Bath room', w: 2400, h: 1900, furniture: [
    { kind: 'bath', default: true }, { kind: 'washbasin', default: true }, { kind: 'towel-rail', default: false },
  ] },
  { type: 'sauna', title: 'Сауна', cat: 'wet', shade: -2, ifcName: 'Sauna', w: 2400, h: 2000, furniture: [] },
  { type: 'hammam', title: 'Хаммам', cat: 'wet', shade: -1, ifcName: 'Hammam', w: 2400, h: 2200, furniture: [] },
  // --- Хозяйственные ---
  { type: 'boiler', title: 'Котельная', cat: 'utility', shade: 0, ifcName: 'Boiler room', w: 2500, h: 2200, furniture: [
    { kind: 'boiler', default: true },
  ] },
  { type: 'laundry', title: 'Постирочная', cat: 'utility', shade: 1, ifcName: 'Laundry', w: 2200, h: 1800, furniture: [
    { kind: 'washer', default: true }, { kind: 'dryer', default: true }, { kind: 'sink', default: false },
  ] },
  { type: 'wardrobe-room', title: 'Гардеробная', cat: 'utility', shade: 2, ifcName: 'Walk-in closet', w: 2000, h: 1800, furniture: [
    { kind: 'wardrobe-rack', default: true },
  ] },
  { type: 'storage', title: 'Кладовая', cat: 'utility', shade: -1, ifcName: 'Storage', w: 1800, h: 1500, furniture: [
    { kind: 'shelf-open', default: true },
  ] },
  { type: 'tech', title: 'Техническое помещение', cat: 'utility', shade: -2, ifcName: 'Technical room', w: 2400, h: 2000, furniture: [] },
  { type: 'workshop', title: 'Мастерская', cat: 'utility', shade: 1, ifcName: 'Workshop', w: 3600, h: 3000, furniture: [
    { kind: 'workbench', default: true }, { kind: 'shelf-open', default: false },
  ] },
  // --- Вход и проходы ---
  { type: 'entrance', title: 'Прихожая', cat: 'circulation', shade: 1, ifcName: 'Entrance hall', w: 2800, h: 2200, furniture: [
    { kind: 'coat-rack', default: true }, { kind: 'shoe-bench', default: true }, { kind: 'mirror', default: false },
  ] },
  { type: 'vestibule', title: 'Тамбур', cat: 'circulation', shade: 2, ifcName: 'Vestibule', w: 1600, h: 1400, furniture: [] },
  { type: 'hall', title: 'Холл', cat: 'circulation', shade: 0, ifcName: 'Hall', w: 3000, h: 2400, furniture: [
    { kind: 'coat-rack', default: true }, { kind: 'shoe-bench', default: true },
  ] },
  { type: 'corridor', title: 'Коридор', cat: 'circulation', shade: -1, ifcName: 'Corridor', w: 3000, h: 1200, furniture: [] },
  { type: 'stairs-room', title: 'Лестница', cat: 'circulation', shade: -2, ifcName: 'Stair', w: 2600, h: 3650, furniture: [
    { kind: 'stairs', default: true },
  ] },
  { type: 'elevator', title: 'Лифт', cat: 'circulation', shade: -2, ifcName: 'Elevator', w: 1800, h: 1800, furniture: [] },
  // Вертикальный проём через перекрытие. Размещается только внутри помещения,
  // не имеет пола и не входит в полезную площадь.
  { type: 'shaft', title: 'Шахта', cat: 'circulation', shade: 0, shaft: true, ifcName: 'Shaft', w: 1200, h: 1200, furniture: [] },
  // --- Гараж и улица ---
  { type: 'garage', title: 'Гараж', cat: 'outdoor', shade: -2, ifc: 'PARKING', ifcName: 'Garage', w: 3600, h: 6000, furniture: [
    { kind: 'car', default: true }, { kind: 'workbench', default: false },
  ] },
  { type: 'terrace', title: 'Терраса', cat: 'outdoor', shade: 0, open: true, ifc: 'EXTERNAL', ifcName: 'Terrace', w: 4000, h: 2500, furniture: [
    { kind: 'garden-set', default: false },
  ] },
  { type: 'balcony', title: 'Балкон', cat: 'outdoor', shade: 1, open: true, ifc: 'EXTERNAL', ifcName: 'Balcony', w: 3000, h: 1200, furniture: [] },
  // Веранда — застеклённая неотапливаемая: со стенами, но летняя.
  { type: 'veranda', title: 'Веранда', cat: 'outdoor', shade: 2, summer: true, ifcName: 'Veranda', w: 4000, h: 3000, furniture: [
    { kind: 'garden-set', default: true }, { kind: 'garden-lounger', default: false },
  ] },
  { type: 'porch', title: 'Крыльцо', cat: 'outdoor', shade: -1, open: true, ifc: 'EXTERNAL', ifcName: 'Porch', w: 2000, h: 1500, furniture: [] },
  { type: 'carport', title: 'Навес для машины', cat: 'outdoor', shade: -1, open: true, ifc: 'PARKING', ifcName: 'Carport', w: 3500, h: 6000, furniture: [
    { kind: 'car', default: true },
  ] },
];

const roomTypeMap = new Map(ROOM_TYPES.map((t) => [t.type, t]));
const roomCategoryMap = new Map(ROOM_CATEGORIES.map((c) => [c.id, c]));

export function roomType(type) {
  return roomTypeMap.get(type) || null;
}

export function roomCategory(id) {
  return roomCategoryMap.get(id) || null;
}

// Типы, сгруппированные по категориям (для библиотеки и списка типа).
export function roomTypesByCategory() {
  return ROOM_CATEGORIES.map((cat) => ({ ...cat, types: ROOM_TYPES.filter((t) => t.cat === cat.id) }));
}

// Цвета помещения по типу: оттенок категории, сдвиг по shade.
//   light — пол на плане (светлая тема, печать), dark — пол в тёмной теме,
//   swatch — метка типа (точка в библиотеке), floor3d — пол в 3D.
// Неизвестный тип — нейтральный серо-голубой (как «Вход и проходы»).
const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v * 255))).toString(16).padStart(2, '0');
function hslHex(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}`;
}
const colorCache = new Map();
export function roomColors(type) {
  if (colorCache.has(type)) return colorCache.get(type);
  const def = roomType(type);
  const cat = roomCategory(def?.cat) || roomCategory('circulation');
  const shade = def ? def.shade || 0 : 0;
  const h = (cat.hue + shade * 6 + 360) % 360;
  const s = cat.sat;
  const out = {
    light: hslHex(h, s, 92.5 - shade * 0.8),
    dark: hslHex(h, s * 0.42, 13 + shade * 1.1),
    swatch: hslHex(h, Math.min(72, s + 14), 58 - shade * 3),
    floor3d: hslHex(h, s * 0.8, 85 - shade * 1.5),
  };
  colorCache.set(type, out);
  return out;
}

// Жилая комната (жилая площадь, нормы света и высоты).
export function isLivingType(type) {
  return Boolean(roomType(type)?.living);
}

// Летнее помещение: открытое (терраса, балкон) или веранда.
export function isSummerRoom(room) {
  return isOpenRoom(room) || Boolean(roomType(room?.type)?.summer);
}

// Открытое помещение (терраса, балкон): без стен, с ограждением. Задаётся
// типом помещения; room.open, если есть, имеет приоритет.
export function isOpenRoom(room) {
  return Boolean(room.open ?? roomType(room.type)?.open);
}

export function isShaft(room) {
  return Boolean(room?.shaft ?? roomType(room?.type)?.shaft);
}

export function furnitureDef(kind) {
  return FURNITURE[kind] || null;
}

// Предметы одной категории (для нижней панели).
export function furnitureByCategory(catId) {
  return Object.entries(FURNITURE)
    .filter(([, def]) => def.cat === catId)
    .map(([kind, def]) => ({ kind, ...def }));
}

// Конструкция (свободная стена, колонна), а не мебель.
export function isStructural(kind) {
  return Boolean(FURNITURE[kind]?.structural);
}

export function isRoundItem(kind) {
  return Boolean(FURNITURE[kind]?.round);
}

// Весь каталог мебели (для поиска).
export function allFurniture() {
  return Object.entries(FURNITURE).map(([kind, def]) => ({ kind, ...def }));
}

// Галочки мебели по умолчанию для нового помещения.
export function defaultChecklist(type) {
  const def = roomTypeMap.get(type);
  const checklist = {};
  if (!def) return checklist;
  for (const entry of def.furniture) checklist[entry.kind] = Boolean(entry.default);
  return checklist;
}

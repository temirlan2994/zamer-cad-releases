// Каталог типов помещений и наборов мебели Kepler Plan.
// Все размеры в миллиметрах. Идентификаторы стабильны — на них завязан
// формат файла проекта и экспорт.

export const DEFAULT_PARTITION = 100; // перегородка между помещениями
export const DEFAULT_EXTERIOR = 250; // наружная стена
export const DOOR_WIDTH = 800;
export const WINDOW_WIDTH = 1200;
export const MIN_PASSAGE = 700; // минимальный проход, мм
export const GRID_STEP = 50; // шаг привязки, мм

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
  'kitchen-row': { title: 'Кухонный гарнитур', cat: 'kitchen', w: 2400, h: 600, rules: { wall: true, clearFront: 1000, tall: true, priority: 1 } },
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
  column: { title: 'Колонна', cat: 'misc', w: 400, h: 400, rules: { center: false, priority: 9 } },

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
  'kitchen-corner': { title: 'Угловая кухня', cat: 'kitchen', w: 1800, h: 1800, rules: { wall: true, clearFront: 1000, tall: true, priority: 1 } },
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
  { type: 'terrace', title: 'Терраса', w: 4000, h: 2500, tint: 'green', open: true, furniture: [
    { kind: 'garden-set', default: false },
  ] },
  { type: 'balcony', title: 'Балкон', w: 3000, h: 1200, tint: 'green', open: true, furniture: [] },
];

const roomTypeMap = new Map(ROOM_TYPES.map((t) => [t.type, t]));

export function roomType(type) {
  return roomTypeMap.get(type) || null;
}

// Открытое помещение (терраса, балкон): без стен, с ограждением. Задаётся
// типом помещения; room.open, если есть, имеет приоритет.
export function isOpenRoom(room) {
  return Boolean(room.open ?? roomType(room.type)?.open);
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

// Галочки мебели по умолчанию для нового помещения.
export function defaultChecklist(type) {
  const def = roomTypeMap.get(type);
  const checklist = {};
  if (!def) return checklist;
  for (const entry of def.furniture) checklist[entry.kind] = Boolean(entry.default);
  return checklist;
}

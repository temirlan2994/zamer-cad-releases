// Проектные габариты современной мебели для жилых интерьеров высокого класса.
// Это не размеры конкретных моделей и не копии изделий брендов. Значения —
// округлённая «огибающая», которой пользуется планировщик: в неё входят корпус,
// мягкие борта, подлокотники и изголовье, а не только матрас или место сидения.

export const PREMIUM_FURNITURE_SIZES = Object.freeze({
  sofa: { w: 2800, h: 1050 },
  'sofa-2': { w: 2200, h: 1000 },
  'sofa-corner': { w: 3400, h: 2400 },
  'sofa-u': { w: 4000, h: 3000 },
  loveseat: { w: 2100, h: 1000 },
  armchair: { w: 950, h: 950 },
  'armchair-lounge': { w: 1000, h: 1050 },
  pouf: { w: 650, h: 650 },
  bench: { w: 1600, h: 500 },
  daybed: { w: 2100, h: 1000 },
  recliner: { w: 1000, h: 1100 },
  'sofa-bed': { w: 2400, h: 1050 },

  'bed-double': { w: 1900, h: 2300 },
  'bed-king': { w: 2100, h: 2300 },
  'bed-queen': { w: 1700, h: 2300 },
  'bed-single': { w: 1150, h: 2200 },
  'bed-bunk': { w: 1100, h: 2150 },
  'kids-bed': { w: 1100, h: 1900 },
  nightstand: { w: 600, h: 500 },
  'dressing-table': { w: 1400, h: 550 },

  'dining-table': { w: 2000, h: 1000 },
  'dining-table-6': { w: 2200, h: 1000 },
  'table-round': { w: 1400, h: 1400 },
  'coffee-table': { w: 1250, h: 850 },
  'coffee-table-2': { w: 1200, h: 800 },
  'side-table': { w: 550, h: 550 },
  desk: { w: 1600, h: 750 },
  'desk-corner': { w: 1800, h: 1600 },
  'console-table': { w: 1400, h: 400 },

  chair: { w: 500, h: 560 },
  'chair-soft': { w: 560, h: 600 },
  'office-chair': { w: 700, h: 700 },

  wardrobe: { w: 2400, h: 650 },
  'wardrobe-sliding': { w: 3000, h: 650 },
  'wardrobe-corner': { w: 1200, h: 1200 },
  dresser: { w: 1400, h: 500 },
  bookcase: { w: 1800, h: 400 },
  'wardrobe-rack': { w: 2400, h: 600 },
  sideboard: { w: 2000, h: 500 },
  'tv-stand': { w: 2400, h: 500 },
  'coat-rack': { w: 1800, h: 600 },
  'shoe-bench': { w: 1200, h: 450 },
});

// Внутренний матрас и детали мягкой кровати. Внешний size берётся выше.
export const BED_DESIGNS = Object.freeze({
  'bed-double': { mattressW: 1600, mattressH: 2000, baseH: 300, mattressZ: 260, mattressT: 240, headboardH: 1150 },
  'bed-king': { mattressW: 1800, mattressH: 2000, baseH: 300, mattressZ: 260, mattressT: 240, headboardH: 1150 },
  'bed-queen': { mattressW: 1400, mattressH: 2000, baseH: 300, mattressZ: 260, mattressT: 240, headboardH: 1100 },
  'bed-single': { mattressW: 900, mattressH: 2000, baseH: 300, mattressZ: 260, mattressT: 220, headboardH: 1050 },
  'kids-bed': { mattressW: 900, mattressH: 1700, baseH: 300, mattressZ: 250, mattressT: 200, headboardH: 900 },
});

// Композиция из двух столиков: большой низкий и меньший более высокий.
// Координаты и радиусы заданы долями внешней огибающей предмета.
export const COFFEE_TABLE_DUO = Object.freeze({
  large: { cx: -0.13, cy: 0.05, rx: 0.36, ry: 0.42, z: 350 },
  small: { cx: 0.25, cy: -0.16, rx: 0.25, ry: 0.32, z: 430 },
});

export function premiumFurnitureSize(kind) {
  const size = PREMIUM_FURNITURE_SIZES[kind];
  return size ? { ...size } : null;
}

export function bedDesign(kind) {
  const design = BED_DESIGNS[kind];
  const size = PREMIUM_FURNITURE_SIZES[kind];
  return design && size ? { ...design, ...size } : null;
}

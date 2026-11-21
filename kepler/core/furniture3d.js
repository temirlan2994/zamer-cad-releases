// Мебель в 3D: высота, отметка низа и цвет упрощённой коробки предмета.
// Чистый модуль без DOM; сетку строит core/mesh3d.js (furnitureFaces).
//
// Высота — по виду предмета (FURNITURE_3D), иначе — по категории каталога
// (CAT_3D). Подвесные предметы (вытяжка, полка, люстра, кондиционер…) — с
// отметкой низа z0 от пола. Части составной мебели: модули дивана и части
// кухни — свои таблицы (верхний ряд кухни висит под 2100).

import { FURNITURE } from './catalog.js';
import { bedDesign } from './furniture-design.js';
import { KITCHEN_PART_HEIGHT } from './kitchen.js';

// Категория → высота (мм) и тон коробки: нейтральные, темнее пола.
export const CAT_3D = Object.freeze({
  seating: { h: 850, color: '#8f8a84' },
  beds: { h: 500, color: '#b3a795' },
  tables: { h: 750, color: '#9c7e60' },
  chairs: { h: 900, color: '#8c7660' },
  storage: { h: 2100, color: '#b09d84' },
  kitchen: { h: 900, color: '#c9c2b6' },
  bath: { h: 600, color: '#e4e9ec' },
  appliance: { h: 900, color: '#c8ccd1' },
  decor: { h: 400, color: '#9fae93' },
  office: { h: 750, color: '#9a8470' },
  kids: { h: 800, color: '#bda58b' },
  gym: { h: 1000, color: '#868d95' },
  hall: { h: 1000, color: '#a8957d' },
  outdoor: { h: 800, color: '#949d94' },
  misc: { h: 1000, color: '#aaa49c' },
});
const DEFAULT_3D = { h: 800, color: '#a59f97' };

// Вид предмета → { h, z0? } (мм), если отличается от категории.
export const FURNITURE_3D = Object.freeze({
  loveseat: { h: 800 }, armchair: { h: 850 }, 'armchair-lounge': { h: 800 }, pouf: { h: 450 }, bench: { h: 450 },
  daybed: { h: 600 }, recliner: { h: 1000 }, 'bean-bag': { h: 600 },
  'bed-bunk': { h: 1700 }, crib: { h: 900 }, nightstand: { h: 550 }, 'dressing-table': { h: 750 },
  'coffee-table': { h: 450 }, 'side-table': { h: 550 }, 'console-table': { h: 800 }, 'bar-table': { h: 1050 },
  stool: { h: 450 }, 'bar-stool': { h: 750 }, 'office-chair': { h: 1100 }, 'gaming-chair': { h: 1300 }, 'folding-chair': { h: 850 },
  dresser: { h: 850 }, bookcase: { h: 2000 }, sideboard: { h: 850 }, 'tv-stand': { h: 500 }, chest: { h: 500 },
  'shelf-open': { h: 300, z0: 1400 }, 'display-cabinet': { h: 1900 },
  'kitchen-island': { h: 900 }, 'bar-counter': { h: 1100 }, pantry: { h: 2100 }, microwave: { h: 350, z0: 900 },
  bath: { h: 550 }, 'bath-corner': { h: 550 }, shower: { h: 2100 }, toilet: { h: 420 }, 'toilet-wall': { h: 430 }, 'toilet-smart': { h: 470 }, bidet: { h: 400 },
  washbasin: { h: 850 }, 'washbasin-double': { h: 850 }, 'vanity-unit': { h: 850 },
  'towel-rail': { h: 800, z0: 900 }, jacuzzi: { h: 600 }, urinal: { h: 600, z0: 400 },
  fridge: { h: 1900 }, 'fridge-side': { h: 1800 }, washer: { h: 850 }, dryer: { h: 850 }, dishwasher: { h: 850 },
  tv: { h: 750, z0: 700 }, boiler: { h: 800, z0: 1000 }, hood: { h: 400, z0: 1700 }, 'ac-unit': { h: 300, z0: 2200 },
  'coffee-table-2': { h: 450 }, plant: { h: 1000 }, 'floor-lamp': { h: 1600 }, rug: { h: 10 }, 'rug-round': { h: 10 },
  piano: { h: 1250 }, fireplace: { h: 1100 }, aquarium: { h: 1300 }, chandelier: { h: 400, z0: 2000 }, curtain: { h: 2500 },
  'coat-rack': { h: 2000 }, 'shoe-bench': { h: 500 }, mirror: { h: 900, z0: 900 }, 'umbrella-stand': { h: 600 },
  car: { h: 1500 }, 'car-suv': { h: 1800 }, motorcycle: { h: 1100 }, workbench: { h: 900 }, 'garden-set': { h: 750 },
  'garden-lounger': { h: 400 }, bbq: { h: 900 }, pool: { h: 30 }, gazebo: { h: 2700 }, trampoline: { h: 900 },
  'hot-tub': { h: 900 }, sandbox: { h: 300 }, bicycle: { h: 1000 },
  treadmill: { h: 1400 }, 'exercise-bike': { h: 1200 }, 'weight-bench': { h: 500 }, 'yoga-mat': { h: 10 }, 'ping-pong': { h: 760 },
  'filing-cabinet': { h: 1300 }, safe: { h: 1000 }, printer: { h: 500 },
  'kids-bed': { h: 600 }, 'changing-table': { h: 900 }, 'toy-box': { h: 500 }, 'kids-desk': { h: 650 },
});

// Модули дивана-конструктора (как в IFC): сиденье со спинкой, подлокотник, пуф.
export const SOFA_PART_3D = Object.freeze({ seat: 850, corner: 850, chaise: 850, arm: 650, ottoman: 450 });
const SEAT_H = 450; // мм, высота сиденья

// Сиденье со спинкой: коробка сиденья seat + спинка толщиной back вдоль
// задней кромки (локальная −Y предмета: спинкой к стене, стул — от стола).
const SEATED = Object.freeze({
  chair: { seat: SEAT_H, back: 60 }, 'chair-soft': { seat: SEAT_H, back: 80 }, 'folding-chair': { seat: SEAT_H, back: 50 },
  'office-chair': { seat: 500, back: 80 }, 'gaming-chair': { seat: 500, back: 120 },
  armchair: { seat: SEAT_H, back: 200 }, 'armchair-lounge': { seat: 400, back: 220 }, recliner: { seat: SEAT_H, back: 250 },
  loveseat: { seat: SEAT_H, back: 200 }, 'sofa-bed': { seat: SEAT_H, back: 220 }, sofa: { seat: SEAT_H, back: 220 },
  'sofa-2': { seat: SEAT_H, back: 220 },
});
const SOFA_COLOR = CAT_3D.seating.color;
const SOFA_ARM_COLOR = '#7f7a74';

// Части кухни: корпуса светлые, техника серая, верхний ряд висит до 2100.
const KITCHEN_TOP = 2100;
const KITCHEN_COLOR = { base: '#cfc8bc', upper: '#ddd7cc', appliance: '#b9bec4', hob: '#8a8f96' };
const KITCHEN_APPLIANCES = new Set(['fridge', 'dishwasher', 'oven-column', 'hood']);

// Высота, низ и цвет предмета (или части) по виду. layer — ряд части кухни.
// seat/back — сиденье и спинка (back: мм или 'part' — из части дивана),
// corner — у углового модуля спинка ещё и вдоль +X.
export function furniture3d(kind, layer) {
  if (typeof kind === 'string' && kind.startsWith('sofa:')) {
    const m = kind.slice(5);
    const spec = {
      h: SOFA_PART_3D[m] || 850, z0: 0,
      color: m === 'arm' ? SOFA_ARM_COLOR : SOFA_COLOR,
      model: m === 'arm' ? 'sofa-arm' : 'premium-seat',
    };
    // Спинка — толщина из раскладки дивана (part.back), у угла — с двух сторон.
    if (m === 'seat' || m === 'chaise' || m === 'corner') Object.assign(spec, { seat: SEAT_H, back: 'part', corner: m === 'corner' });
    return spec;
  }
  if (typeof kind === 'string' && kind.startsWith('kitchen:')) {
    const p = kind.slice(8);
    const h = KITCHEN_PART_HEIGHT[p] || 900;
    const upper = layer === 'upper';
    const color = p === 'hob' ? KITCHEN_COLOR.hob : KITCHEN_APPLIANCES.has(p) ? KITCHEN_COLOR.appliance
      : upper ? KITCHEN_COLOR.upper : KITCHEN_COLOR.base;
    return { h, z0: upper ? KITCHEN_TOP - h : 0, color };
  }
  const cat = CAT_3D[FURNITURE[kind]?.cat] || DEFAULT_3D;
  const own = FURNITURE_3D[kind];
  const bed = bedDesign(kind);
  if (bed) return { h: bed.headboardH, z0: 0, color: cat.color, model: 'upholstered-bed', design: bed };
  if (kind === 'coffee-table' || kind === 'coffee-table-2') {
    return { h: own?.h ?? cat.h, z0: 0, color: cat.color, model: 'coffee-duo' };
  }
  const seated = SEATED[kind];
  if (seated) return {
    h: own?.h ?? cat.h, z0: own?.z0 ?? 0, color: cat.color,
    model: 'premium-seat', ...seated,
  };
  const category = FURNITURE[kind]?.cat;
  if (['tables', 'office'].includes(category) && !['printer', 'filing-cabinet', 'safe'].includes(kind)) {
    return { h: own?.h ?? cat.h, z0: own?.z0 ?? 0, color: cat.color, model: 'table' };
  }
  if (['storage', 'hall'].includes(category) && !['mirror', 'umbrella-stand'].includes(kind)) {
    return { h: own?.h ?? cat.h, z0: own?.z0 ?? 0, color: cat.color, model: 'cabinet' };
  }
  if (['toilet', 'toilet-wall', 'toilet-smart', 'bidet'].includes(kind)) {
    return { h: own?.h ?? cat.h, z0: own?.z0 ?? 0, color: cat.color, model: 'toilet' };
  }
  if (['washbasin', 'washbasin-double', 'vanity-unit'].includes(kind)) {
    return { h: own?.h ?? cat.h, z0: own?.z0 ?? 0, color: cat.color, model: 'vanity' };
  }
  return { h: own?.h ?? cat.h, z0: own?.z0 ?? 0, color: cat.color };
}

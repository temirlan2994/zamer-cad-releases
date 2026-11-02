// Генератор вариантов планировки. Чистый модуль.
//
// Берутся помещения активного этажа (без вложенных, коридоров, террас и
// балконов) и раскладываются двумя рядами вдоль коридора: жилые — на
// солнечную сторону (по северу участка и повороту дома), служебные — на
// теневую. Перебираются распределение по рядам, порядок и зеркало; каждый
// вариант получает двери в коридор, вход и окна, затем проверяется нормами
// (инсоляция, площади, ширины, свет) и ранжируется. Площади помещений
// сохраняются приблизительно: ширина = площадь / глубина ряда.

import { DEFAULT_PARTITION, isOpenRoom } from './catalog.js';
import { northInBuilding } from './building.js';
import { createOpening, createRoom, levelProject } from './model.js';
import { normsReport } from './norms.js';
import { LIVING_TYPES } from './schedule.js';
import { projectWithHouse, snapshotHouse } from './variants.js';

const GAP = DEFAULT_PARTITION;
const CORRIDOR = 1400;
const SUNNY_DEPTH = 4200;
const SHADE_DEPTH = 3400;
const MIN_W = { kitchen: 1800, bathroom: 1600, hall: 1500, 'wardrobe-room': 1200, 'stairs-room': 2800 };
const NO_WINDOW = new Set(['hall', 'wardrobe-room', 'stairs-room', 'corridor', 'garage']);
const round100 = (v) => Math.round(v / 100) * 100;

// Программа: что раскладывать.
export function roomProgram(lp) {
  return lp.rooms
    .filter((r) => !r.parentId && r.type !== 'corridor' && !isOpenRoom(r))
    .map((r) => ({ type: r.type, name: r.name, area: r.w * r.h }));
}

// Солнечная сторона плана: «top» — если юг ближе к верху плана.
export function sunnySide(project) {
  const north = northInBuilding(project.site?.north || 0, project.building);
  return Math.cos(((north + 180) * Math.PI) / 180) > 0 ? 'top' : 'bottom';
}

const rowLength = (row) => row.reduce((s, r) => s + r.w, 0) + GAP * Math.max(0, row.length - 1);

function sized(row, depth) {
  return row.map((r) => ({ ...r, h: depth, w: Math.max(MIN_W[r.type] || 2400, round100(r.area / depth)) }));
}

// Дом из двух рядов и коридора на месте активного этажа.
function buildHouse(project, rowSun, rowShade, sunTop, mirror) {
  const sun = sized(rowSun, SUNNY_DEPTH);
  const shade = sized(rowShade, SHADE_DEPTH);
  const L = Math.max(rowLength(sun), rowLength(shade));
  for (const row of [sun, shade]) if (row.length) row[row.length - 1].w += L - rowLength(row);
  const top = sunTop ? sun : shade;
  const bottom = sunTop ? shade : sun;
  const topDepth = sunTop ? SUNNY_DEPTH : SHADE_DEPTH;
  const yCorr = topDepth + GAP;
  const yBottom = yCorr + CORRIDOR + GAP;

  const house = snapshotHouse(project);
  const level = house.levels.find((l) => l.id === house.activeLevel) || house.levels[0];
  level.rooms = [];
  level.openings = [];
  level.items = [];
  level.wallOverrides = {};
  const place = (row, y) => {
    const order = mirror ? [...row].reverse() : row;
    let x = 0;
    return order.map((r) => {
      const room = createRoom(r.type, x, y, r.w, r.h);
      room.name = r.name;
      level.rooms.push(room);
      x += r.w + GAP;
      return room;
    });
  };
  const topRooms = place(top, 0);
  const bottomRooms = place(bottom, yBottom);
  const corridor = createRoom('corridor', 0, yCorr, L, CORRIDOR);
  level.rooms.push(corridor);

  const openings = [];
  const addRow = (rooms, toCorridorSide, outsideSide) => {
    rooms.forEach((room, i) => {
      openings.push(createOpening('door', room.id, toCorridorSide, room.w / 2, 800)); // внутрь комнаты
      if (NO_WINDOW.has(room.type)) return;
      const small = room.type === 'bathroom';
      if (room.w >= 4800 && !small) {
        openings.push(createOpening('window', room.id, outsideSide, room.w * 0.3, 1500));
        openings.push(createOpening('window', room.id, outsideSide, room.w * 0.7, 1500));
      } else {
        openings.push(createOpening('window', room.id, outsideSide, room.w / 2, small ? 600 : Math.min(1500, room.w - 600)));
      }
      // Угловые комнаты — ещё окно в торце.
      if (!small && (i === 0 || i === rooms.length - 1)) {
        openings.push(createOpening('window', room.id, i === 0 ? 3 : 1, room.h / 2, 1500));
      }
    });
  };
  addRow(topRooms, 2, 0);
  addRow(bottomRooms, 0, 2);
  // Вход: наружная дверь холла, иначе — торец коридора.
  const hall = [...topRooms, ...bottomRooms].find((r) => r.type === 'hall');
  if (hall) openings.push(createOpening('door', hall.id, topRooms.includes(hall) ? 0 : 2, hall.w / 2, 900));
  else openings.push(createOpening('door', corridor.id, 1, CORRIDOR / 2, 900));
  level.openings = openings;
  return house;
}

// Распределение по рядам: жилые — на солнце (с выравниванием длин) или
// просто поровну по площади.
function splits(prog) {
  const bySun = { sun: prog.filter((r) => LIVING_TYPES.has(r.type)), shade: prog.filter((r) => !LIVING_TYPES.has(r.type)) };
  const len = (row, depth) => row.reduce((s, r) => s + r.area / depth, 0);
  for (let guard = 0; guard < prog.length; guard += 1) {
    const d = len(bySun.sun, SUNNY_DEPTH) - len(bySun.shade, SHADE_DEPTH);
    if (d > 3000 && bySun.sun.length > 1) {
      const smallest = [...bySun.sun].sort((a, b) => a.area - b.area)[0];
      bySun.sun = bySun.sun.filter((r) => r !== smallest);
      bySun.shade.push(smallest);
    } else if (d < -3000 && bySun.shade.some((r) => r.type === 'kitchen' || r.type === 'dining')) {
      const move = bySun.shade.find((r) => r.type === 'kitchen' || r.type === 'dining');
      bySun.shade = bySun.shade.filter((r) => r !== move);
      bySun.sun.push(move);
    } else break;
  }
  const balanced = { sun: [], shade: [] };
  for (const r of [...prog].sort((a, b) => b.area - a.area)) {
    (len(balanced.sun, SUNNY_DEPTH) <= len(balanced.shade, SHADE_DEPTH) ? balanced.sun : balanced.shade).push(r);
  }
  return [{ id: 'sun', ...bySun }, { id: 'balanced', ...balanced }];
}

const ORDERS = {
  'area-desc': (row) => [...row].sort((a, b) => b.area - a.area),
  'area-asc': (row) => [...row].sort((a, b) => a.area - b.area),
  original: (row) => row,
};

// Варианты: [{ name, house, score, notes, summary }], лучшие сначала.
export function generateLayouts(project, { count = 3 } = {}) {
  if (project.levels.length > 1) {
    throw new Error('Генератор пока для одноэтажного дома: лестница должна совпадать на этажах');
  }
  const lp = levelProject(project, project.activeLevel);
  const prog = roomProgram(lp);
  if (prog.length < 2) throw new Error('Нужно хотя бы два помещения');
  const sunTop = sunnySide(project) === 'top';
  const seen = new Set();
  const results = [];
  for (const split of splits(prog)) {
    if (!split.sun.length || !split.shade.length) continue;
    for (const [orderId, order] of Object.entries(ORDERS)) {
      for (const mirror of [false, true]) {
        const sun = order(split.sun);
        const shade = order(split.shade);
        const key = `${sun.map((r) => r.name).join('|')}#${shade.map((r) => r.name).join('|')}#${mirror}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const house = buildHouse(project, sun, shade, sunTop, mirror);
        const report = normsReport(projectWithHouse(project, house));
        const lengths = [rowLength(sized(sun, SUNNY_DEPTH)), rowLength(sized(shade, SHADE_DEPTH))];
        const score = (report.insolation.ok ? 0 : 1000) + report.problems.length * 100
          + Math.abs(lengths[0] - lengths[1]) / 100;
        results.push({
          house,
          score,
          notes: `${split.id === 'sun' ? 'жилые на солнечной стороне' : 'ряды поровну'}, ${orderId === 'area-desc' ? 'крупные к краю' : orderId === 'area-asc' ? 'мелкие к краю' : 'исходный порядок'}${mirror ? ', зеркально' : ''}`,
          insolationOk: report.insolation.ok,
          problems: report.problems.length,
        });
      }
    }
  }
  return results.sort((a, b) => a.score - b.score).slice(0, count);
}

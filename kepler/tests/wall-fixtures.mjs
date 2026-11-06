// «Тяжёлые» стыки стен — фикстуры для инвариантов (tests/wall-invariants.test.mjs)
// и для сравнения старой deriveWalls с будущей геометрической deriveWallsV2
// (см. docs/walls-geometry-design.md). Все координаты кратны 10 мм, чтобы
// растеризация с шагом 10 мм была точной.
//
// Толщины по умолчанию: наружная 250, несущая 200, перегородка 100.
// Общая стена возникает только при зазоре, равном её толщине (100 или override).

import { createProject, createRoom } from '../core/model.js';
import { ownKey, sharedKey } from '../core/walls.js';

let seq = 0;
function room(type, x, y, w, h, extra = {}) {
  const r = createRoom(type, x, y, w, h);
  seq += 1;
  r.id = `${type}${seq}`; // стабильные id — читаемые сообщения тестов
  return Object.assign(r, extra);
}

function project(name, rooms, overrides = {}) {
  const p = createProject(name);
  p.rooms.push(...rooms);
  Object.assign(p.wallOverrides, overrides);
  return p;
}

// 1. Две комнаты встык через перегородку 100.
export function twoRooms() {
  const a = room('hall', 0, 0, 4000, 3000);
  const b = room('bedroom', 4100, 0, 4000, 3000);
  return project('две комнаты', [a, b]);
}

// 2. Т-стык: две комнаты сверху, одна длинная снизу.
export function teeJoint() {
  const a = room('bedroom', 0, 0, 4000, 3000);
  const b = room('bedroom', 4100, 0, 3900, 3000);
  const c = room('living', 0, 3100, 8000, 3000);
  return project('Т-стык', [a, b, c]);
}

// 3. Крест: четыре комнаты 2×2, узел в центре.
export function crossJoint() {
  const a = room('bedroom', 0, 0, 4000, 3000);
  const b = room('bedroom', 4100, 0, 4000, 3000);
  const c = room('kitchen', 0, 3100, 4000, 3000);
  const d = room('living', 4100, 3100, 4000, 3000);
  return project('крест', [a, b, c, d]);
}

// 4. Г-комната (вырез ne) и прямоугольная комната справа от её нижней части:
// верх соседа коллинеарен грани выреза (y = 3000), обе — наружные.
export function lRoomWithNeighbour() {
  const l = room('living', 0, 0, 6000, 6000, { notch: { corner: 'ne', w: 3000, h: 3000 } });
  const r = room('bedroom', 6100, 3000, 3000, 3000);
  return project('Г + прямоугольник', [l, r]);
}

// 5. Ступенчатая комната (контур, две ступени) с кухней в вырезе: у кухни
// общие стены с обеими гранями ступени и наружная стена слева сверху.
// Плюс шахта, пересекающая наружную стену гостиной (случай «Гостиная 3»).
export function steppedWithKitchenAndShaft() {
  const living = room('living', 0, 0, 6000, 6000, {
    outline: [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 6000 }, { x: 4000, y: 6000 },
      { x: 4000, y: 4000 }, { x: 2000, y: 4000 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 },
    ],
  });
  const kitchen = room('kitchen', 0, 4100, 3900, 1900);
  const shaft = room('shaft', 5600, 1000, 800, 800);
  return project('ступени + кухня + шахта', [living, kitchen, shaft]);
}

// 6. Ступенчатая комната (вырез sw) с соседом, заполняющим вырез через
// перегородки 100; левая и нижняя грани соседа коллинеарны граням гостиной.
export function notchFilledByNeighbour() {
  const living = room('living', 0, 0, 6000, 6000, { notch: { corner: 'sw', w: 3000, h: 3000 } });
  const kitchen = room('kitchen', 0, 3100, 2900, 2900);
  return project('вырез + сосед', [living, kitchen]);
}

// 7. Шахта внутри комнаты у её стены (колонна/шахта «в стене»).
export function shaftInWall() {
  const a = room('living', 0, 0, 6000, 4000);
  const b = room('bedroom', 6100, 0, 3000, 4000);
  const shaft = room('shaft', 5700, 1500, 700, 700); // перекрывает общую стену
  return project('шахта в общей стене', [a, b, shaft]);
}

// 8. Разные толщины в одном узле: несущая 200 (A|B), перегородки 100 (C|D,
// A|C, B|D), наружная 250 и своя толщина 300 у верхней стены A.
// Вертикальная стена смещается в узле (A|B 200 против C|D 100).
export function mixedThicknessNode() {
  const a = room('living', 0, 0, 4000, 3000);
  const b = room('bedroom', 4200, 0, 3800, 3000);
  const c = room('kitchen', 0, 3100, 4100, 3000);
  const d = room('bedroom', 4200, 3100, 3800, 3000);
  return project('разные толщины', [a, b, c, d], {
    [sharedKey(a.id, b.id)]: { kind: 'bearing', thickness: 200 },
    [ownKey(a.id, 0)]: { thickness: 300 },
  });
}

// 9. Терраса вплотную к наружной стене (зазор = 250) — без стен и перил там.
export function terraceNextTo() {
  const a = room('living', 0, 0, 5000, 4000);
  const t = room('terrace', 0, 4250, 5000, 2500);
  return project('терраса', [a, t]);
}

// 10. Вложенная комната (санузел в углу спальни) — внутренние перегородки
// к спальне, две грани совпадают с гранями родителя.
export function nestedRoom() {
  const bed = room('bedroom', 0, 0, 5000, 4000);
  const bath = room('bathroom', 0, 0, 2000, 1800, { parentId: bed.id });
  return project('вложенная', [bed, bath]);
}

// 11. Две комнаты со сдвигом по фасаду: общая стена короче сторон, у торцов
// общей стены встречаются наружные стены обеих комнат.
export function offsetPair() {
  const a = room('living', 0, 0, 4000, 3000);
  const b = room('bedroom', 4100, 1000, 4000, 3000);
  return project('сдвиг по фасаду', [a, b]);
}

// 12. Сосед в вырезе выступает за грань Г-комнаты: верх соседа частично
// общий с гранью выреза, частично наружный; угол Г-комнаты упирается в него.
export function notchNeighbourOverhang() {
  const living = room('living', 0, 0, 6000, 6000, { notch: { corner: 'sw', w: 3000, h: 3000 } });
  const kitchen = room('kitchen', -1500, 3100, 4400, 2900);
  return project('сосед выступает из выреза', [living, kitchen]);
}

// 13. Две Г-комнаты, сцепленные вырезами (ступенчатая перегородка).
export function interlockedL() {
  const a = room('living', 0, 0, 6000, 5000, { notch: { corner: 'se', w: 3000, h: 2000 } });
  const b = room('bedroom', 0, 3100, 6000, 4900, { notch: { corner: 'nw', w: 3100, h: 2000 } });
  return project('сцепленные Г', [a, b]);
}

// 14. Шахта на наружном углу дома (перекрывает оба угла стен).
export function shaftAtCorner() {
  const a = room('living', 0, 0, 5000, 4000);
  const shaft = room('shaft', -400, -400, 800, 800);
  return project('шахта на углу', [a, shaft]);
}

// 15. Вложенная комната у общей стены родителя с соседом.
export function nestedAtSharedWall() {
  const bed = room('bedroom', 0, 0, 5000, 4000);
  const hall = room('hall', 5100, 0, 3000, 4000);
  const bath = room('bathroom', 3000, 1000, 2000, 2000, { parentId: bed.id });
  return project('вложенная у общей', [bed, hall, bath]);
}

// 16. Узкая комната по центру длинной стороны большой (два Т-узла) и Г-сосед.
export function centeredNeighbourAndL() {
  const big = room('living', 0, 0, 8000, 5000);
  const small = room('bathroom', 3000, 5100, 2000, 2000);
  const l = room('bedroom', 5100, 5100, 4000, 4000, { notch: { corner: 'se', w: 1500, h: 1500 } });
  return project('Т-узлы + Г', [big, small, l]);
}

// 17. Две Г-комнаты образуют замкнутый двор (световой карман 2,0 × 1,9 м):
// общая стена кончается у внутреннего угла Г-соседа.
export function courtyardBetweenL() {
  const a = room('living', 0, 0, 6000, 5000, { notch: { corner: 'se', w: 3000, h: 2000 } });
  const b = room('bedroom', 3100, 3100, 5000, 4000, { notch: { corner: 'nw', w: 2000, h: 2000 } });
  return project('двор между Г', [a, b]);
}

// 18. Две комнаты касаются углами по диагонали (зазор 100 по обеим осям):
// наружные стены углов перекрываются, но не должны заходить в комнаты.
export function diagonalCorners() {
  const a = room('bedroom', 0, 0, 3000, 3000);
  const b = room('bedroom', 3100, 3100, 3000, 3000);
  return project('углы по диагонали', [a, b]);
}

// 19. Терраса в 100 от наружной стены, короче её (из проекта пользователя):
// стена напротив террасы сужается до зазора, не заходит на террасу.
export function terraceAtPartitionGap() {
  const a = room('living', 0, 0, 5000, 4000);
  const t = room('terrace', 1000, 4100, 3000, 2000);
  return project('терраса на зазоре 100', [a, t]);
}

// 20. Две комнаты на нестандартном зазоре 50 (не общая стена) и спина к
// спине на зазоре 480 (две наружные стены почти сходятся) — «Гостиная 3».
export function nearGapRooms() {
  const a = room('living', 0, 0, 4000, 3000);
  const b = room('stairs-room', 1000, 3050, 4000, 3000);
  const c = room('bedroom', 5480, 3050, 3000, 3000);
  return project('зазоры 50 и 480', [a, b, c]);
}

// Скрытая стена («линия разделения»): Т-стык, где стена между левой верхней
// и нижней комнатами скрыта. Её клетки остаются в W (дыры нет), узел Т ведёт
// видимая стена a|b, скрытая не забирает углы (инвариант g).
export function hiddenWallTee() {
  const a = room('kitchen', 0, 0, 4000, 3000);
  const b = room('bedroom', 4100, 0, 3900, 3000);
  const c = room('living', 0, 3100, 8000, 3000);
  return project('скрытая стена в Т-стыке', [a, b, c], { [sharedKey(a.id, c.id)]: { hidden: true } });
}

// ---------------------------------------------------------------- Ручные стены (этап B)
// project.walls — ручные стены активного этажа; проект с ними всегда идёт
// на движок v2 (wallsEngine). Ось — в осях дома, толщина 200/100.

function manualProject(name, rooms, walls) {
  const p = project(name, rooms);
  p.walls.push(...walls.map(([ax, ay, bx, by, thickness = 200, extra = {}], i) => ({
    id: `mw${i + 1}`, axis: { kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } },
    justify: 'center', thickness, typeId: null, wallType: 'partition',
    base: { offset: 0 }, top: { level: null, offset: 0, height: null }, hidden: false, roomBounding: true,
    ...extra,
  })));
  return p;
}

// Одна стена без комнат.
export function manualWallAlone() {
  return manualProject('ручная стена одна', [], [[0, 0, 4000, 0]]);
}

// Две ручные стены углом: торцы сходятся в точке осей — угол без щели.
export function manualCorner() {
  return manualProject('ручной угол', [], [[0, 0, 3000, 0], [3000, 0, 3000, 2000, 100]]);
}

// Ручная стена Т-образно упирается снаружи в наружную стену комнаты.
export function manualTeeIntoRoom() {
  const a = room('living', 0, 0, 5000, 4000);
  return manualProject('ручная стена в Т', [a], [[2500, 4250, 2500, 7000]]);
}

// Ручная стена пересекает наружную стену комнаты и кончается внутри неё.
export function manualCrossesRoomWall() {
  const a = room('living', 0, 0, 5000, 4000);
  return manualProject('ручная стена крестом', [a], [[-2000, 2000, 3000, 2000, 100]]);
}

// Ручная перегородка делит комнату от грани до грани (торцы на внутренних
// гранях наружных стен; привязка — по левой грани).
export function manualThroughRoom() {
  const a = room('living', 0, 0, 6000, 4000);
  return manualProject('ручная стена через комнату', [a], [[3000, 0, 3000, 4000, 100, { justify: 'left' }]]);
}

// Две отдельные комнаты, проход между ними закрыт двумя ручными стенами по
// осям наружных стен: внутри — замкнутый карман 1,5 × 3 м (двор).
export function manualClosesCorridor() {
  const a = room('living', 0, 0, 4000, 3000);
  const b = room('bedroom', 5500, 0, 4000, 3000);
  return manualProject('ручные стены закрывают проход', [a, b], [
    [4250, 3125, 5250, 3125, 250], [4250, -125, 5250, -125, 250],
  ]);
}

export const MANUAL_WALL_FIXTURES = {
  manualWallAlone,
  manualCorner,
  manualTeeIntoRoom,
  manualCrossesRoomWall,
  manualThroughRoom,
  manualClosesCorridor,
};

export const WALL_FIXTURES = {
  hiddenWallTee,
  twoRooms,
  teeJoint,
  crossJoint,
  lRoomWithNeighbour,
  steppedWithKitchenAndShaft,
  notchFilledByNeighbour,
  shaftInWall,
  mixedThicknessNode,
  terraceNextTo,
  nestedRoom,
  offsetPair,
  notchNeighbourOverhang,
  interlockedL,
  shaftAtCorner,
  nestedAtSharedWall,
  centeredNeighbourAndL,
  courtyardBetweenL,
  diagonalCorners,
  terraceAtPartitionGap,
  nearGapRooms,
};

// Блокер Б4 аудита 2026-11: Г-образные и контурные комнаты ядро считает по
// форме, а не по габариту x/y/w/h (площадь, удаление, нормы, IFC/JSON,
// растяжение при смене толщины общей стены).
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStructuredExport } from '../core/export.js';
import { buildIfc } from '../core/ifc.js';
import { windowsOf } from '../core/insolation.js';
import { createItem, createOpening, createProject, createRoom, removeRoom } from '../core/model.js';
import { normsReport, roomChecks } from '../core/norms.js';
import { determineParent, roomNetAreaM2, totalAreaM2 } from '../core/rooms.js';
import { roomPolygon, roomShapeArea } from '../core/room-shape.js';
import { tepReport } from '../core/tep.js';
import { roomSchedule } from '../core/schedule.js';
import { setSharedWallThickness } from '../core/wall-thickness.js';
import { deriveWalls } from '../core/walls.js';

// Г-гостиная 6×6 м без северо-восточного угла 3×3 (27 м²) и спальня в вырезе.
function lWithNeighbour({ outline = false, neighbourFirst = false } = {}) {
  const project = createProject('Б4');
  const living = createRoom('living', 0, 0, 6000, 6000);
  if (outline) {
    living.outline = [
      { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 },
      { x: 6000, y: 3000 }, { x: 6000, y: 6000 }, { x: 0, y: 6000 },
    ];
  } else living.notch = { corner: 'ne', w: 3000, h: 3000 };
  const bed = createRoom('bedroom', 3100, 0, 2900, 2900);
  project.rooms.push(...(neighbourFirst ? [bed, living] : [living, bed]));
  return { project, living, bed };
}

for (const outline of [false, true]) {
  const kind = outline ? 'outline' : 'notch';

  test(`Б4.1 (${kind}): площадь Г-комнаты — по контуру, сосед в вырезе её не съедает`, () => {
    for (const neighbourFirst of [false, true]) {
      const { project, living, bed } = lWithNeighbour({ outline, neighbourFirst });
      assert.equal(roomShapeArea(living), 27_000_000);
      assert.equal(roomNetAreaM2(project, living), 27);
      assert.equal(roomNetAreaM2(project, bed), 8.41);
      assert.equal(Number(totalAreaM2(project).toFixed(2)), 35.41);
      const rows = roomSchedule(project)[0].rows;
      assert.equal(rows.find((r) => r.id === living.id).area, 27);
      assert.equal(Number(tepReport(project).total.toFixed(2)), 35.41);
      const area = roomChecks(project, living, project.levels[0]).find((c) => c.kind === 'area');
      assert.match(area.text, /27,0 м²/);
    }
  });

  test(`Б4.1 (${kind}): вложенное помещение нельзя поставить в вырез Г-комнаты`, () => {
    const { project, living } = lWithNeighbour({ outline });
    project.rooms.pop();
    assert.equal(determineParent(project, { x: 3500, y: 500, w: 2000, h: 2000 }), null, 'в вырезе');
    assert.equal(determineParent(project, { x: 500, y: 3500, w: 2000, h: 2000 }), living.id, 'внутри');
  });

  test(`Б4.2 (${kind}): removeRoom не трогает мебель соседа в вырезе`, () => {
    const { project, living } = lWithNeighbour({ outline });
    const bedItem = createItem('bed', 4500, 1500, 1600, 2000);
    const sofa = createItem('sofa', 1500, 4500, 2000, 900);
    project.items.push(bedItem, sofa);
    removeRoom(project, living.id);
    assert.deepEqual(project.items.map((i) => i.id), [bedItem.id]);
  });

  test(`Б4.3 (${kind}): окно на стене выреза не роняет нормы и смотрит наружу`, () => {
    const { project, living } = lWithNeighbour({ outline });
    project.rooms.pop(); // вырез — снаружи дома
    // Горизонтальная стена выреза: y = 3000, наружу — на север (−y).
    const side = outline
      ? `outline-${roomPolygon(living).findIndex((p, i, a) => p.y === 3000 && a[(i + 1) % a.length].y === 3000)}`
      : 'notch-h';
    project.openings.push(createOpening('window', living.id, side, 4500, 1500));
    const wins = windowsOf(project);
    assert.equal(wins.length, 1);
    assert.ok(Math.abs(wins[0].normal.x) < 1e-9 && Math.abs(wins[0].normal.y + 1) < 1e-9);
    const report = normsReport(project);
    assert.ok(report && Array.isArray(report.rooms));
  });

  test(`Б4.4 (${kind}): IFC и JSON получают контур, а не прямоугольник`, () => {
    const { project, living } = lWithNeighbour({ outline });
    const ifc = buildIfc(project, { timestamp: new Date(0) }).text;
    assert.match(ifc, /IFCARBITRARYCLOSEDPROFILEDEF/);
    assert.equal((ifc.match(/IFCPOLYLINE\(/g) || []).length, 1, 'одна Г-комната — один полилинейный профиль');
    const json = buildStructuredExport(project);
    const room = (json.levels?.[0]?.rooms || json.rooms).find((r) => r.id === living.id);
    assert.equal(room.polygon.length, 6);
    assert.equal(room.area_m2, 27);
    assert.equal(room.net_area_m2, 27);
  });
}

// Остаток Б2: Г-коридор пересекает линию сдвига — растягивается по форме.
for (const outline of [false, true]) {
  test(`Б2/Б4.5 (${outline ? 'outline' : 'notch'}): Г-комната через линию сдвига растягивается`, () => {
    const project = createProject('Б2');
    const hall = createRoom('hall', 0, 0, 4000, 3000);
    const bed = createRoom('bedroom', 4100, 0, 4000, 3000);
    const corridor = createRoom('corridor', 0, 3100, 8100, 3000);
    corridor.notch = { corner: 'sw', w: 3000, h: 1500 };
    if (outline) {
      corridor.outline = roomPolygon(corridor).map((p) => ({ x: p.x - corridor.x, y: p.y - corridor.y }));
      delete corridor.notch;
    }
    const store = createRoom('storage', 8200, 3100, 1500, 1500);
    project.rooms.push(hall, bed, corridor, store);
    const door = createOpening('door', corridor.id, 0, 6000, 900);
    project.openings.push(door);
    const areaBefore = roomShapeArea(corridor);
    const wall = deriveWalls(project).find((w) => w.kind === 'shared' && w.orient === 'v' &&
      w.rooms.includes(hall.id) && w.rooms.includes(bed.id));
    const result = setSharedWallThickness(project, wall, 300);
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual(result.stretched, [corridor.id]);
    assert.deepEqual(result.broken, []);
    assert.equal(corridor.w, 8300);
    assert.equal(store.x, 8400);
    assert.equal(bed.x, 4300);
    assert.equal(door.offset, 6200);
    // Вырез у западного края не меняется; площадь растёт на 200 × 3000.
    assert.equal(roomShapeArea(corridor), areaBefore + 200 * 3000);
    if (!outline) assert.deepEqual(corridor.notch, { corner: 'sw', w: 3000, h: 1500 });
  });
}

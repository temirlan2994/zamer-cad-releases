// Контракт авторасстановки: точная геометрия Kepler переводится из Y-вниз
// в правую систему Y-вверх и placements результата применяются обратно.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createItem, createOpening, createProject, createRoom } from '../core/model.js';
import {
  applyLayoutCandidate, contractPointToKepler, contractYawToKepler,
  keplerPointToContract, keplerYawToContract, OUTSIDE_ROOM, projectToLayoutInput,
} from '../core/layout-contract.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('координаты и углы переводятся туда и обратно без потерь', () => {
  assert.deepEqual(keplerPointToContract({ x: 125, y: 340 }), [125, -340]);
  assert.deepEqual(contractPointToKepler([125, -340]), { x: 125, y: 340 });
  assert.equal(keplerYawToContract(90), 270);
  assert.equal(contractYawToKepler(270), 90);
  assert.equal(keplerYawToContract(-45), 45);
});

function projectFixture() {
  const project = createProject('Контракт');
  const room = createRoom('bedroom', 100, 200, 5000, 4000);
  room.id = 'R-main';
  room.outline = [
    { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 },
    { x: 1800, y: 4000 }, { x: 1800, y: 3000 }, { x: 0, y: 3000 },
  ];
  const child = createRoom('bathroom', 3200, 2100, 1200, 1400);
  child.id = 'R-bath';
  child.parentId = room.id;
  project.rooms.push(room, child);
  const door = createOpening('door', room.id, 0, 1100, 900);
  door.id = 'D-main';
  project.openings.push(door);
  const window = createOpening('window', room.id, 1, 1500, 1200);
  window.id = 'W-main';
  project.openings.push(window);
  const bed = createItem('bed-double', 2100, 1800, 1600, 2000, 90);
  bed.id = 'I-bed';
  project.items.push(bed);
  project.site.north = 0;
  project.site.location = { lat: 43.2, lon: 76.9, tz: 5 };
  return { project, room, child, bed };
}

test('проект превращается в полный вход: контуры, отверстия, проёмы, каталог и замки', () => {
  const { project, room, child, bed } = projectFixture();
  const input = projectToLayoutInput(project, {
    projectId: 'P1', lockedItemIds: [bed.id], country: 'KG', locationVerified: true,
    actors: [{ id: 'A1', height_mm: 1780, data_status: 'declared' }],
  });

  assert.equal(input.project_id, 'P1');
  assert.equal(input.coordinate_convention, 'right_handed_z_up_yaw_ccw_local_origin_xy_center_at_support');
  assert.deepEqual(input.location, { country: 'KG', latitude: 43.2, longitude: 76.9, north_yaw_deg: 90 });
  assert.equal(input.floors.length, 1);
  const parent = input.rooms.find((entry) => entry.id === room.id);
  assert.equal(parent.geometry.footprint_mm.outer.length, 7, 'сложный контур замкнут');
  assert.deepEqual(parent.geometry.footprint_mm.outer[0], parent.geometry.footprint_mm.outer.at(-1));
  assert.equal(parent.geometry.footprint_mm.holes.length, 1, 'вложенная комната — отверстие пола родителя');
  assert.equal(parent.geometry.footprint_mm.holes[0].length, 5);
  assert.ok(input.rooms.some((entry) => entry.id === child.id), 'вложенная комната остаётся самостоятельной');

  const door = input.openings.find((entry) => entry.id === 'D-main');
  assert.equal(door.kind, 'hinged_door');
  assert.ok(door.room_ids.includes(room.id));
  assert.ok(door.room_ids.includes(OUTSIDE_ROOM));
  assert.equal(door.segment_mm.length, 2);
  assert.equal(door.zones[0].type, 'opening_zone');
  assert.ok(['cw', 'ccw'].includes(door.swing_direction));
  const win = input.openings.find((entry) => entry.id === 'W-main');
  assert.equal(win.kind, 'window');
  assert.deepEqual(win.room_ids, [room.id, OUTSIDE_ROOM]);

  assert.equal(input.catalog.length, 1);
  assert.equal(input.catalog[0].kind, 'bed-double');
  assert.deepEqual(input.catalog[0].local_front_direction, [0, -1]);
  assert.deepEqual(input.locked_placements[0].pose, { position_mm: [2100, -1800, 0], yaw_deg: 270 });
  assert.equal(input.locked_placements[0].room_id, room.id);
  assert.equal(input.actors[0].mobility_profile, null);
  assert.ok(input.functional_brief.mandatory_functions.includes('sleep_two'));
  assert.ok(!input.unknown_inputs.some((text) => text.includes('Координаты')));
});

test('север учитывает поворот дома', () => {
  const { project } = projectFixture();
  project.site.north = 40;
  project.building.rotation = 10;
  const input = projectToLayoutInput(project, { locationVerified: true });
  assert.equal(input.location.north_yaw_deg, 60, 'north в осях дома 30° → yaw от +X равен 60°');
});

test('результат двигает существующие и создаёт новые предметы, сохраняя замки', () => {
  const { project, bed } = projectFixture();
  const input = projectToLayoutInput(project, { lockedItemIds: [bed.id] });
  const chairCatalog = {
    id: 'catalog-chair', kind: 'chair', outer_dimensions_mm: [450, 450, 900],
  };
  input.catalog.push(chairCatalog);
  const placements = [
    {
      instance_id: bed.id, catalog_id: input.catalog[0].id, floor_id: 'L1', room_id: 'R-main',
      pose: { position_mm: [4000, -3000, 0], yaw_deg: 180 }, state_id: 'default',
    },
    {
      instance_id: 'I-chair-new', catalog_id: chairCatalog.id, floor_id: 'L1', room_id: 'R-main',
      pose: { position_mm: [3500, -2250, 0], yaw_deg: 315 }, state_id: 'default',
    },
  ];
  const result = applyLayoutCandidate(project, placements, input);
  assert.deepEqual(result.skipped, [{ id: bed.id, reason: 'locked' }]);
  assert.equal(bed.x, 2100, 'закреплённая кровать не сдвинута');
  const chair = project.items.find((item) => item.id === 'I-chair-new');
  assert.ok(chair);
  assert.equal(chair.x, 3500);
  assert.equal(chair.y, 2250);
  assert.ok(close(chair.rotation, 45));
  assert.deepEqual(result.created, ['I-chair-new']);

  const moved = applyLayoutCandidate(project, [placements[0]], input, { respectLocks: false });
  assert.deepEqual(moved.updated, [bed.id]);
  assert.equal(bed.x, 4000);
  assert.equal(bed.y, 3000);
  assert.equal(bed.rotation, 180);
});

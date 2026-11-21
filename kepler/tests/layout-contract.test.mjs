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

test('сохраняемый layoutBrief и паспорт мебели попадают в контракт', () => {
  const { project, bed } = projectFixture();
  project.site.solarVerified = true;
  project.layoutBrief = {
    actors: [{
      id: 'A1', alias: 'Жилец 1', heightMm: 1760, mobilityProfile: 'wheelchair',
      bodyWidthMm: 720, bodyDepthMm: 1100, dataStatus: 'measured', sourceRef: 'обмер',
    }],
    capacity: { dailySeats: 2, guestSeats: 4, simultaneousCooks: 1 },
    fixedEngineering: [{
      id: 'E1', kind: 'outlet', levelId: 'L1', roomId: 'R-main',
      x: 700, y: 900, zMm: 300, dataStatus: 'measured', sourceRef: 'план ЭОМ', clearanceMm: 200,
    }],
    storageInventory: [{
      id: 'S1', label: 'Сезонная одежда', category: 'clothes', count: 8,
      frequency: 'seasonal', dataStatus: 'declared', ownerActorIds: ['A1'], roomIds: ['R-main'],
    }],
    uncertainty: [{
      id: 'U1', scope: 'site', fieldPath: 'site.neighbors', status: 'resolved', note: 'Съёмка получена',
    }],
    scenarioSelections: [{
      scenarioId: 'SCN014', enabled: true, mandatory: true, actorPersonIds: ['A1'],
      frequencyValue: 2, frequencyPeriod: 'week', specificRequirements: 'Ночник у кровати',
    }],
  };
  Object.assign(bed, {
    manufacturer: 'Factory', sku: 'BED-160', sourceUrl: 'https://example.test/bed-160',
    geometryStatus: 'verified_sku', planProjectionVerified: true, manualStatus: 'verified',
    manualConstraints: [{
      id: 'M1', status: 'verified', requirement: 'Зазор для обслуживания',
      sourceRef: 'паспорт, стр. 6', clearances: { frontMm: 600 },
    }],
  });

  const input = projectToLayoutInput(project);
  assert.equal(input.actors[0].height_mm, 1760);
  assert.equal(input.actors[0].mobility_profile, 'wheelchair');
  assert.equal(input.actors[0].body_footprint_local_mm.outer.length, 5);
  assert.deepEqual(input.fixed_engineering[0].position_xyz_mm, [700, -900, 300]);
  assert.equal(input.fixed_engineering[0].source_id, 'план ЭОМ');
  assert.equal(input.functional_brief.daily_seats, 2);
  assert.equal(input.functional_brief.guest_seats, 4);
  assert.equal(input.functional_brief.simultaneous_cooks, 1);
  assert.equal(input.functional_brief.storage_inventory[0].item_group_id, 'S1');
  assert.equal(input.functional_brief.uncertainty_records[0].field_path, 'site.neighbors');
  assert.equal(input.catalog[0].geometry_status, 'verified_sku');
  assert.equal(input.catalog[0].plan_projection_verified, true);
  assert.equal(input.catalog[0].manual_status, 'verified');
  assert.equal(input.catalog[0].manual_constraints[0].source_ref, 'паспорт, стр. 6');
  assert.equal(input.scenarios[0].template_id, 'SCN014');
  assert.equal(input.scenarios[0].required, true);
  assert.deepEqual(input.scenarios[0].actor_ids, ['A1']);
  assert.equal(input.scenarios[0].frequency_per_week, 2);
  assert.ok(!input.unknown_inputs.some((text) => /пользовател|модел|север|инженер|хранен|вместимост/.test(text)));
});

test('SKU и непроверенные внешние данные не снимают unknown_inputs', () => {
  const { project, bed } = projectFixture();
  bed.sku = 'BED-160';
  project.layoutBrief = {
    actors: [{ id: 'A1', heightMm: null, mobilityProfile: 'unknown', dataStatus: 'unknown' }],
    capacity: { dailySeats: 2, guestSeats: null },
    fixedEngineering: [{
      id: 'E1', kind: 'outlet', levelId: 'L1', roomId: 'R-main', x: 700, y: 900, dataStatus: 'unknown',
    }],
    storageInventory: [{ id: 'S1', category: 'clothes', count: null, dataStatus: 'unknown' }],
    uncertainty: [{ id: 'U1', scope: 'site', fieldPath: 'site.neighbors', status: 'unknown', note: 'Нет съёмки' }],
  };

  const input = projectToLayoutInput(project);
  assert.equal(input.catalog[0].geometry_status, 'parametric_custom');
  assert.ok(input.unknown_inputs.some((text) => text.includes('мобильность')));
  assert.ok(input.unknown_inputs.some((text) => text.includes('паспортные')));
  assert.ok(input.unknown_inputs.some((text) => text.includes('инженерные')));
  assert.ok(input.unknown_inputs.some((text) => text.includes('хранения')));
  assert.ok(input.unknown_inputs.some((text) => text.includes('вместимость')));
  assert.ok(input.unknown_inputs.some((text) => text.includes('Нет съёмки')));
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

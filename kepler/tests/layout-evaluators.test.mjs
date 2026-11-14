// Контракты низкоуровневых evaluator-ов полного пакета правил.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYOUT_EVALUATORS, collectLayoutEvaluatorMetrics, evaluate, evaluateLayoutEvaluator, layoutEvaluatorById,
} from '../core/layout-evaluators.js';
import { createItem, createProject, createRoom } from '../core/model.js';

test('реестр содержит ровно 23 стабильных контракта пакета', () => {
  assert.equal(LAYOUT_EVALUATORS.length, 23);
  assert.equal(new Set(LAYOUT_EVALUATORS.map((entry) => entry.id)).size, 23);
  assert.deepEqual(LAYOUT_EVALUATORS.map((entry) => entry.id), [
    'polygon_validity', 'support_and_containment', 'solid_collision_3d', 'swept_opening', 'activity_space',
    'navmesh_connectivity', 'bottleneck', 'time_expanded_access', 'occupied_seating', 'reachability',
    'visibility_rays', 'solar_and_glare', 'photometric_adapter', 'acoustic_adapter',
    'manufacturer_clearances', 'capacity', 'storage_capacity', 'delivery_path', 'load_and_fixing',
    'profile_lookup', 'robust_threshold', 'scenario_coordinator', 'score_composer',
  ]);
  for (const entry of LAYOUT_EVALUATORS) {
    assert.ok(entry.requiredInputs.length > 0, entry.id);
    assert.ok(entry.returns.length > 0, entry.id);
    assert.ok(entry.algorithmContract.length > 20, entry.id);
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.equal(layoutEvaluatorById('capacity')?.returns[0], 'usable_count');
  assert.equal(layoutEvaluatorById('absent'), null);
  assert.throws(() => evaluate('absent', {}), /Неизвестный evaluator/);
});

test('отсутствующие и внешние данные остаются unknown', () => {
  const missing = evaluateLayoutEvaluator('solar_and_glare', { geolocation: {} });
  assert.equal(missing.status, 'unknown');
  assert.ok(missing.missingInputs.includes('north'));

  const external = evaluate('photometric_adapter', {
    IES_LDT: 'fixture.ies', luminaire_flux: 1000, geometry: {}, reflectances: {}, task_planes: [],
  });
  assert.equal(external.status, 'unknown');
  assert.equal(external.source, 'not_implemented');
  assert.equal(external.known, false);
});

test('polygon_validity проверяет замыкание и самопересечение', () => {
  const valid = evaluate('polygon_validity', {
    rings: [[[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]],
    coordinate_units: 'mm',
  });
  assert.equal(valid.status, 'pass');
  assert.equal(valid.output.validity, true);

  const bow = evaluate('polygon_validity', {
    rings: [[[0, 0], [4000, 3000], [0, 3000], [4000, 0], [0, 0]]],
    coordinate_units: 'mm',
  });
  assert.equal(bow.status, 'fail');
  assert.ok(bow.output.invalid_edges.some((entry) => entry.reason === 'self_intersection'));

  const open = evaluate('polygon_validity', {
    rings: [[[0, 0], [1000, 0], [1000, 1000], [0, 1000]]], coordinate_units: 'mm',
  });
  assert.equal(open.status, 'fail');
  assert.ok(open.output.invalid_edges.some((entry) => entry.reason === 'ring_open'));
});

test('solid_collision_3d выполняет AABB broad phase по состояниям', () => {
  const clear = evaluate('solid_collision_3d', {
    physical_volumes_per_state: {
      closed: [
        { id: 'a', min: [0, 0, 0], max: [100, 100, 100] },
        { id: 'b', min: [100, 0, 0], max: [200, 100, 100] },
      ],
    },
    transforms: {},
  });
  assert.equal(clear.status, 'pass', 'касание граней не является пересечением объёмов');

  const hit = evaluate('solid_collision_3d', {
    physical_volumes_per_state: {
      open: [
        { id: 'a', min: [0, 0, 0], max: [100, 100, 100] },
        { id: 'b', min: [50, 20, 10], max: [150, 80, 90] },
      ],
    },
    transforms: {},
  });
  assert.equal(hit.status, 'fail');
  assert.deepEqual(hit.output.collision_pairs, [{ state: 'open', a: 'a', b: 'b' }]);
  assert.equal(hit.output.intersection_geometry[0].x0, 50);
});

test('support_and_containment проверяет контакты пола и вычитает voids', () => {
  const base = {
    room_floor_mesh: [{ x: 0, y: 0, w: 100, h: 100 }],
    voids: [{ x: 40, y: 40, w: 20, h: 20 }],
  };
  const supported = evaluate('support_and_containment', {
    ...base, object_support_contacts: [
      { id: 'cabinet', rect: { x: 10, y: 10, w: 20, h: 20 } },
      { id: 'leg', point: [90, 90] },
    ],
  });
  assert.equal(supported.status, 'pass');
  assert.equal(supported.output.support_status.valid, true);

  const overVoid = evaluate('support_and_containment', {
    ...base, object_support_contacts: [{ id: 'table', rect: { x: 35, y: 35, w: 30, h: 30 } }],
  });
  assert.equal(overVoid.status, 'fail');
  assert.equal(overVoid.output.outside_parts[0].id, 'table');

  const insufficient = evaluate('support_and_containment', { ...base, object_support_contacts: [] });
  assert.equal(insufficient.status, 'unknown');
});

test('swept_opening проверяет supplied poses и не додумывает неполный ход', () => {
  const input = {
    kinematic_model: {
      poses: [
        { angle: 0, zone: { x: 0, y: 0, w: 10, h: 2 } },
        { angle: 45, zone: { x: 40, y: 0, w: 10, h: 2 } },
        { angle: 90, zone: { x: 80, y: 0, w: 10, h: 2 } },
      ],
    },
    required_angle_or_extension: 90,
  };
  const clear = evaluate('swept_opening', {
    ...input, obstacles: [{ id: 'wall', x: 120, y: 0, w: 10, h: 10 }],
  });
  assert.equal(clear.status, 'pass');
  assert.equal(clear.output.reachable_open_fraction, 1);

  const blocked = evaluate('swept_opening', {
    ...input, obstacles: [{ id: 'chair', x: 42, y: 0, w: 4, h: 2 }],
  });
  assert.equal(blocked.status, 'fail');
  assert.equal(blocked.output.reachable_open_fraction, 0);
  assert.deepEqual(blocked.output.collision_intervals[0].obstacle_ids, ['chair']);

  const partial = evaluate('swept_opening', {
    ...input,
    kinematic_model: { poses: input.kinematic_model.poses.slice(0, 2) },
    obstacles: [{ id: 'wall', x: 120, y: 0, w: 10, h: 10 }],
  });
  assert.equal(partial.status, 'unknown');
});

test('activity_space совмещает footprint, позы, подход и препятствия', () => {
  const base = {
    actor_footprint: { x: -250, y: -200, w: 500, h: 400 },
    posture: { poses: [{ id: 'standing', x: 1000, y: 1000 }] },
    approach_zones: [{ x: 500, y: 500, w: 1000, h: 1000 }],
  };
  const clear = evaluate('activity_space', { ...base, item_state: { obstacles: [] } });
  assert.equal(clear.status, 'pass');
  assert.deepEqual(clear.output, { reachable: true, collision: false, clearance: null });

  const blocked = evaluate('activity_space', {
    ...base, item_state: { obstacles: [{ x: 900, y: 900, w: 200, h: 200 }] },
  });
  assert.equal(blocked.status, 'fail');
  assert.equal(blocked.output.collision, true);
});

test('navmesh_connectivity принимает supplied graph и supplied free cells', () => {
  const graph = evaluate('navmesh_connectivity', {
    free_space: { graph: { entrance: ['middle'], middle: ['exit'], exit: [] }, start: 'entrance', goal: 'exit' },
    agent_geometry: { kind: 'circle', diameter: 600 },
    doors: [],
    level_connectors: [],
  });
  assert.equal(graph.status, 'pass');
  assert.deepEqual(graph.output.path, ['entrance', 'middle', 'exit']);
  assert.equal(graph.output.path_length, 2);

  const cells = evaluate('navmesh_connectivity', {
    free_space: { cols: 3, rows: 1, free: new Uint8Array([1, 0, 1]), start: 0, goal: 2, cell: 100 },
    agent_geometry: { configuration_space_applied: true },
    doors: [],
    level_connectors: [],
  });
  assert.equal(cells.status, 'fail');
  assert.equal(cells.output.path_exists, false);
});

test('time_expanded_access ищет разрешённую последовательность состояний', () => {
  const base = {
    states: { nodes: [{ id: 'closed', initial: true }, { id: 'open' }, { id: 'outside', exit_reachable: true }] },
    transitions: [
      { id: 'open-door', from: 'closed', to: 'open', actors: ['adult'] },
      { id: 'leave', from: 'open', to: 'outside', actors: ['adult'] },
    ],
    actors: [{ id: 'adult' }],
    concurrency: {},
  };
  const pass = evaluate('time_expanded_access', { ...base, profile_exclusions: { states: [], transitions: [] } });
  assert.equal(pass.status, 'pass');
  assert.deepEqual(pass.output.state_sequence, ['closed', 'open', 'outside']);

  const blocked = evaluate('time_expanded_access', {
    ...base, profile_exclusions: { states: [], transitions: ['open-door'] },
  });
  assert.equal(blocked.status, 'fail');
  assert.equal(blocked.output.exit_reachable, false);
  assert.deepEqual(blocked.output.conflicts, [{ transition: 'open-door', reason: 'excluded' }]);
});

test('reachability использует переданные позы, дальность и препятствия', () => {
  const base = {
    body_model: { max_reach: 800 },
    working_pose: { poses: [{ id: 'normal', hand: [0, 0, 1000], posture_cost: 1.5 }] },
    control_location: [600, 0, 1000],
  };
  const reached = evaluate('reachability', { ...base, obstacles: [] });
  assert.equal(reached.status, 'pass');
  assert.deepEqual(reached.output, { reachable: true, posture_cost: 1.5 });

  const blocked = evaluate('reachability', {
    ...base, obstacles: [{ x: 250, y: -100, w: 100, h: 200 }],
  });
  assert.equal(blocked.status, 'fail');
  assert.equal(blocked.output.reachable, false);
});

test('visibility_rays агрегирует только явно переданные результаты лучей', () => {
  const result = evaluate('visibility_rays', {
    eye_poses: [{
      id: 'seat-1',
      rays: [
        { target_id: 'screen', visible: true, view_angle: 32 },
        { target_id: 'screen', visible: false, occluder_id: 'column', view_angle: 28 },
      ],
    }],
    targets: [{ id: 'screen' }],
    '3D_occluders': [{ id: 'column' }],
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.output.visible_fraction, 0.5);
  assert.deepEqual(result.output.occluders, ['column']);
  assert.equal(result.output.view_angle, 30);

  const unknown = evaluate('visibility_rays', { eye_poses: [], targets: [], '3D_occluders': [] });
  assert.equal(unknown.status, 'unknown');
});

test('storage_capacity не удваивает общий объём и сохраняет unknown доступа', () => {
  const base = {
    inventory: [{ category: 'clothes', volume: 10 }, { category: 'linen', volume: 5 }],
    door_kinematics: {},
  };
  const enough = evaluate('storage_capacity', {
    ...base,
    usable_shelf_volumes: [
      { id: 'wardrobe', category: 'clothes', usable_volume: 10, reachable: true },
      { id: 'common', category: 'all', usable_volume: 5, reachable: true },
    ],
  });
  assert.equal(enough.status, 'pass');
  assert.equal(enough.output.required_provided.linen.provided, 5);

  const short = evaluate('storage_capacity', {
    ...base, usable_shelf_volumes: [{ id: 'common', category: 'all', usable_volume: 10, reachable: true }],
  });
  assert.equal(short.status, 'fail');
  assert.equal(short.output.required_provided.linen.provided, 0, 'общий объём уже отдан первой категории');

  const unresolved = evaluate('storage_capacity', {
    ...base, usable_shelf_volumes: [{ id: 'unknown-door', category: 'all', usable_volume: 20 }],
  });
  assert.equal(unresolved.status, 'unknown');
  assert.deepEqual(unresolved.output.unresolved_storage, ['unknown-door']);
});

test('delivery_path требует полный sampled 3D route и учитывает approved disassembly', () => {
  const direct = evaluate('delivery_path', {
    package_geometry: { id: 'sofa-box' },
    approved_disassembly: { approved: false, sequence: [] },
    route_3D: { complete: true, samples: [{ fits: true }, { fits: true }] },
  });
  assert.equal(direct.status, 'pass');
  assert.equal(direct.output.transport_feasible, true);

  const partial = evaluate('delivery_path', {
    package_geometry: { id: 'sofa-box' },
    approved_disassembly: { approved: false },
    route_3D: { complete: false, samples: [{ fits: true }] },
  });
  assert.equal(partial.status, 'unknown');

  const parts = evaluate('delivery_path', {
    package_geometry: { id: 'wardrobe' },
    approved_disassembly: { approved: true, sequence: ['remove-doors', 'carry', 'assemble'] },
    route_3D: {
      complete: true,
      samples: [{ collision: true }],
      part_routes: {
        carcass: { complete: true, samples: [{ fits: true }] },
        doors: { complete: true, samples: [{ fits: true }] },
      },
    },
  });
  assert.equal(parts.status, 'pass');
  assert.deepEqual(parts.output.assembly_sequence, ['remove-doors', 'carry', 'assemble']);
});

test('robust_threshold сохраняет пограничную область unknown', () => {
  assert.equal(evaluate('robust_threshold', {
    measurement: 630, uncertainty_bound: 20, threshold: 600,
  }).status, 'pass');
  assert.equal(evaluate('robust_threshold', {
    measurement: 570, uncertainty_bound: 20, threshold: 600,
  }).status, 'fail');
  const edge = evaluate('robust_threshold', {
    measurement: 600, uncertainty_bound: 20, threshold: 600,
  });
  assert.equal(edge.status, 'unknown');
  assert.deepEqual(edge.output, { status: 'unknown', lower_bound: 580, upper_bound: 620 });
});

test('capacity считает только пригодные и достижимые места', () => {
  const result = evaluate('capacity', {
    seat_geometry: [
      { id: 's1', usable: true, reachable: true },
      { id: 's2', usable: true, reachable: false },
      { id: 's3', usable: true, collision: false },
    ],
    actor_profiles: [{ id: 'adult' }],
    mandatory_counts: 3,
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.output.usable_count, 2);
  assert.deepEqual(result.output.unusable_seats, ['s2']);
});

test('collector возвращает сырые AABB/route/capacity метрики и не мутирует модель', () => {
  const project = createProject('Метрики');
  const room = createRoom('living', 0, 0, 5000, 4000);
  const sofa = createItem('sofa', 1400, 1800, 2200, 950);
  const chair = createItem('armchair', 1700, 1800, 750, 800);
  project.rooms.push(room);
  project.items.push(sofa, chair);
  const before = JSON.stringify(project.items);
  const metrics = collectLayoutEvaluatorMetrics({
    project,
    room,
    items: project.items,
    route: { ok: true, unknown: false, minWidth: 600, zoneAccess: new Map([[sofa.id, [true]]]) },
    context: { doorZones: [{ x: 1000, y: 1400, w: 500, h: 500 }], requiredSeatCount: 4 },
  });
  assert.equal(metrics.room_polygon_valid, true);
  assert.equal(metrics.aabb_solid_collision_count, 1);
  assert.deepEqual(metrics.aabb_collision_pairs, [[sofa.id, chair.id]]);
  assert.equal(metrics.door_swing_aabb_collision_count, 2);
  assert.equal(metrics.aabb_support_valid, true);
  assert.equal(metrics.required_routes_reachable, true);
  assert.equal(metrics.route_min_width_mm, 600);
  assert.equal(metrics.nominal_usable_seat_count, 4);
  assert.equal(metrics.required_seat_count, 4);
  assert.deepEqual(metrics.route_zone_access[sofa.id], [true]);
  assert.equal(JSON.stringify(project.items), before);
});

test('collector помечает вышедшую за пол часть без ложной 3D-точности', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 3000, 3000);
  const bed = createItem('bed-double', 2900, 1500, 1600, 2000);
  project.rooms.push(room); project.items.push(bed);
  const metrics = collectLayoutEvaluatorMetrics({ project, room, route: { ok: true, unknown: true, minWidth: null } });
  assert.equal(metrics.aabb_support_valid, false);
  assert.equal(metrics.furniture_support_valid, false);
  assert.equal(metrics.aabb_outside_parts[0].itemId, bed.id);
  assert.equal(Object.hasOwn(metrics, 'route_min_width_mm'), false);
  assert.equal(Object.hasOwn(metrics, 'required_seat_count'), false);
});

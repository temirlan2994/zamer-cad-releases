import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import {
  collectRoomDoorRouteEvidence,
  collectVerifiedRouteMetrics,
  DOOR_ROUTE_RULE_BINDINGS,
  ENHANCED_DOOR_ROUTE_BINDINGS,
} from '../core/layout-door-route.js';

function projectWithDoor(type = 'single', { verified = true } = {}) {
  const project = createProject();
  const room = { id: 'r1', type: 'hall', x: 0, y: 0, w: 4000, h: 4000, name: 'Холл' };
  project.rooms.push(room);
  const opening = {
    id: 'd1', kind: 'door', roomId: room.id, side: 0, offset: 2000,
    width: type === 'double' ? 1400 : 900, height: 2100, type,
    swingIn: true, hingeStart: true,
  };
  if (verified) Object.assign(opening, {
    swingGeometryStatus: 'verified',
    leafThicknessMm: 40,
    handleProjectionMm: 60,
    handleInsetMm: 100,
  });
  project.openings.push(opening);
  return { project, room, walls: deriveWalls(project) };
}

test('реестр добавляет три route binding и усиливает GEO008/PATH020', () => {
  assert.deepEqual(DOOR_ROUTE_RULE_BINDINGS.map((entry) => entry.id), ['PATH003', 'PATH005', 'PATH006']);
  assert.deepEqual(ENHANCED_DOOR_ROUTE_BINDINGS.map((entry) => entry.id), ['GEO008', 'PATH020']);
  assert.deepEqual(
    ENHANCED_DOOR_ROUTE_BINDINGS[0].checks.map((entry) => entry.key),
    ['door_swing_collision_count', 'door_handle_approach_reachable'],
  );
});

test('распашная дверь даёт collision и reachability только по реальной геометрии и route callback', () => {
  const fixture = projectWithDoor();
  const clear = collectRoomDoorRouteEvidence({
    ...fixture, modeledScopeComplete: true, isReachable: () => true,
  });
  assert.equal(clear.ruleApplicability.GEO008, true);
  assert.equal(clear.ruleApplicability.GEO009, false);
  assert.equal(clear.metrics.door_swing_collision_count, 0);
  assert.equal(clear.metrics.door_handle_approach_reachable, true);
  assert.ok(clear.doors[0].approachPoints.length > 0);

  const envelope = clear.doors[0].envelopes[0];
  const blocked = collectRoomDoorRouteEvidence({
    ...fixture,
    obstacleRects: [{ ...envelope }],
    modeledScopeComplete: true,
    isReachable: () => false,
  });
  assert.equal(blocked.metrics.door_swing_collision_count, 1);
  assert.equal(blocked.metrics.door_handle_approach_reachable, false);
});

test('без route callback подход к ручке остаётся unknown, а не pass', () => {
  const evidence = collectRoomDoorRouteEvidence({ ...projectWithDoor(), modeledScopeComplete: true });
  assert.equal(evidence.metrics.door_swing_collision_count, 0);
  assert.equal(Object.hasOwn(evidence.metrics, 'door_handle_approach_reachable'), false);
});

test('нулевая collision публикуется только с паспортной swing geometry и полным modeled scope', () => {
  const noScope = collectRoomDoorRouteEvidence({
    ...projectWithDoor(), isReachable: () => true,
  });
  assert.equal(Object.hasOwn(noScope.metrics, 'door_swing_collision_count'), false);

  const noPassport = collectRoomDoorRouteEvidence({
    ...projectWithDoor('single', { verified: false }), modeledScopeComplete: true, isReachable: () => true,
  });
  assert.equal(Object.hasOwn(noPassport.metrics, 'door_swing_collision_count'), false);
  assert.equal(Object.hasOwn(noPassport.metrics, 'door_handle_approach_reachable'), false);
});

test('найденная collision остаётся fail evidence без паспортных метаданных', () => {
  const fixture = projectWithDoor('single', { verified: false });
  const probe = collectRoomDoorRouteEvidence({ ...fixture });
  const envelope = probe.doors[0].leaves[0].baseEnvelope;
  const blocked = collectRoomDoorRouteEvidence({
    ...fixture,
    obstacleRects: [{ rect: envelope, type: 'wall', roomId: null }],
  });
  assert.equal(blocked.metrics.door_swing_collision_count, 1);
});

test('паспортная толщина и выступ ручки консервативно расширяют swept envelope', () => {
  const fixture = projectWithDoor();
  const probe = collectRoomDoorRouteEvidence({ ...fixture, modeledScopeComplete: true });
  const leaf = probe.doors[0].leaves[0];
  const obstacle = {
    x: leaf.baseEnvelope.x - 30,
    y: leaf.baseEnvelope.y + leaf.baseEnvelope.h / 2,
    w: 20,
    h: 20,
  };
  assert.equal(obstacle.x + obstacle.w < leaf.baseEnvelope.x, true);
  const padded = collectRoomDoorRouteEvidence({
    ...fixture, modeledScopeComplete: true, obstacleRects: [obstacle],
  });
  assert.equal(padded.metrics.door_swing_collision_count, 1);
});

test('раздвижная дверь не получает вымышленную распашную зону или pass кинематики', () => {
  const evidence = collectRoomDoorRouteEvidence(projectWithDoor('sliding'));
  assert.equal(evidence.ruleApplicability.GEO008, false);
  assert.equal(evidence.ruleApplicability.GEO009, 'unknown');
  assert.deepEqual(evidence.metrics, {});
  assert.equal(evidence.doors[0].reason, 'sliding_hardware_geometry_missing');
});

test('двустворчатая дверь анализируется двумя створками, не единым квадратом полной ширины', () => {
  const evidence = collectRoomDoorRouteEvidence({
    ...projectWithDoor('double'), modeledScopeComplete: true, isReachable: () => true,
  });
  assert.equal(evidence.doors[0].envelopes.length, 2);
  assert.ok(evidence.doors[0].leaves.every((leaf) => leaf.baseEnvelope.w <= 700 && leaf.baseEnvelope.h <= 700));
});

test('доступ к одной створке не доказывает доступ ко всем required leaves', () => {
  const evidence = collectRoomDoorRouteEvidence({
    ...projectWithDoor('double'),
    modeledScopeComplete: true,
    isReachable: (_point, _opening, leafIndex) => leafIndex === 0,
  });
  assert.equal(evidence.metrics.door_handle_approach_reachable, false);
});

test('створка проверяется только в помещении, содержащем midpoint открытого полотна', () => {
  const fixture = projectWithDoor();
  fixture.project.openings[0].swingIn = false;
  fixture.walls = deriveWalls(fixture.project);
  const evidence = collectRoomDoorRouteEvidence({
    ...fixture,
    modeledScopeComplete: true,
    obstacleRects: [{ x: 1550, y: -900, w: 900, h: 900 }],
    isReachable: () => true,
  });
  assert.equal(evidence.doors[0].scopeLeafCount, 0);
  assert.equal(Object.hasOwn(evidence.metrics, 'door_swing_collision_count'), false);
  assert.equal(evidence.ruleApplicability.GEO008, 'unknown', 'наружный scope не смоделирован');
});

test('child obstacle пропускается, если дверь действительно связывает его roomId', () => {
  const fixture = projectWithDoor();
  const probe = collectRoomDoorRouteEvidence({ ...fixture, modeledScopeComplete: true });
  const evidence = collectRoomDoorRouteEvidence({
    ...fixture,
    modeledScopeComplete: true,
    obstacleRects: [{ rect: probe.doors[0].envelopes[0], type: 'child', roomId: 'r1' }],
  });
  assert.equal(evidence.metrics.door_swing_collision_count, 0);
});

test('orphan и неподдержанный linked door дают unknown applicability, не ложный NA', () => {
  const orphan = projectWithDoor();
  orphan.project.openings[0].orphan = true;
  orphan.walls = deriveWalls(orphan.project);
  const orphanEvidence = collectRoomDoorRouteEvidence(orphan);
  assert.equal(orphanEvidence.doors.length, 1);
  assert.equal(orphanEvidence.ruleApplicability.GEO008, 'unknown');

  const unsupported = projectWithDoor('folding');
  const unsupportedEvidence = collectRoomDoorRouteEvidence(unsupported);
  assert.equal(unsupportedEvidence.ruleApplicability.GEO008, 'unknown');
  assert.equal(unsupportedEvidence.ruleApplicability.GEO009, 'unknown');
});

test('неподдержанная дверь не маскирует доказанную collision другой распашной двери', () => {
  const fixture = projectWithDoor();
  const probe = collectRoomDoorRouteEvidence({ ...fixture, modeledScopeComplete: true });
  fixture.project.openings.push({
    id: 'folding', kind: 'door', roomId: fixture.room.id, side: 0, offset: 800,
    width: 700, height: 2100, type: 'folding', swingIn: true, hingeStart: true,
  });
  fixture.walls = deriveWalls(fixture.project);
  const evidence = collectRoomDoorRouteEvidence({
    ...fixture,
    obstacleRects: [probe.doors[0].leaves[0].baseEnvelope],
  });

  assert.equal(evidence.metrics.door_swing_collision_count, 1);
  assert.equal(evidence.ruleApplicability.GEO008, true);
});

test('чистая распашная дверь не даёт pass при другой неподдержанной кинематике', () => {
  const fixture = projectWithDoor();
  fixture.project.openings.push({
    id: 'accordion', kind: 'door', roomId: fixture.room.id, side: 0, offset: 800,
    width: 700, height: 2100, type: 'accordion-unknown', swingIn: true, hingeStart: true,
  });
  fixture.walls = deriveWalls(fixture.project);
  const evidence = collectRoomDoorRouteEvidence({
    ...fixture, modeledScopeComplete: true, isReachable: () => true,
  });
  assert.equal(evidence.ruleApplicability.GEO008, 'unknown');
});

test('route.minWidth без определения измерения не считается шириной прохода', () => {
  const metrics = collectVerifiedRouteMetrics({
    route: { ok: true, minWidth: 600, computedFromCurrentLayout: true },
  });
  assert.deepEqual(metrics, { main_route_graph_fresh: true });
});

test('полный bottleneck публикует ширину и доказательство PATH020', () => {
  const metrics = collectVerifiedRouteMetrics({
    route: {
      ok: true,
      inputSignature: 'current',
      bottleneck: {
        minWidthMm: 1120, x: 1500, y: 900, lengthMm: 700, state: 'daily',
        measurementDefinition: 'configuration_space_cross_section',
      },
    },
    currentInputSignature: 'current',
  });
  assert.deepEqual(metrics, {
    main_route_graph_fresh: true,
    main_route_min_width_mm: 1120,
    route_bottleneck_evidence_complete: true,
  });
});

test('встречное движение требует два подтверждённых actor profile', () => {
  const route = {
    twoWay: { minWidthMm: 1500, measurementDefinition: 'clearance_map_cross_section' },
  };
  assert.equal(Object.hasOwn(collectVerifiedRouteMetrics({ route }), 'two_way_route_min_width_mm'), false);
  const actors = [
    { id: 'a', mobilityProfile: 'standard', dataStatus: 'declared' },
    { id: 'b', mobilityProfile: 'wheelchair', bodyWidthMm: 700, bodyDepthMm: 1100, dataStatus: 'measured' },
  ];
  assert.equal(collectVerifiedRouteMetrics({ route, actors }).two_way_route_min_width_mm, 1500);
});

test('второстепенные подходы агрегируются только с подтверждённым профилем', () => {
  const partial = collectVerifiedRouteMetrics({
    route: { secondaryApproaches: [{ reachable: true, profileVerified: false }] },
  });
  assert.deepEqual(partial, {});
  const failed = collectVerifiedRouteMetrics({
    route: { secondaryApproaches: [
      { reachable: true, profileVerified: true },
      { reachable: false, profileVerified: true },
    ] },
  });
  assert.equal(failed.secondary_approaches_valid, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCENARIO_ACTIVATION,
  activateLayoutScenarios,
  evaluateLayoutScenarios,
} from '../core/layout-scenarios.js';

function activeSelection(scenarioId = 'SCN001') {
  return [{ scenario_id: scenarioId, enabled: true, mandatory: false }];
}

function completeScn001Context() {
  let adapterCalls = 0;
  const count = (result) => () => { adapterCalls += 1; return result; };
  const context = {
    inputValues: {
      'brief.daily_life.entrance': { usual_arriving_group_size: 2 },
      'brief.building.openings': [{ id: 'door-1' }],
      'brief.household.members': [{ id: 'person-1' }, { id: 'person-2' }],
    },
    scenarioContexts: {
      SCN001: {
        states: { ENTRY_USE: { verified: true } },
        concurrency: { parallelGroups: [{ applicable: true, verified: true }] },
      },
    },
    scenarioEvaluatorBindings: {
      SCN001: {
        'SCN001-R01': {
          evaluator: 'solid_collision_3d',
          evidenceType: 'computed',
          evidenceReference: 'layout:rev-1/collisions',
          input: {
            physical_volumes_per_state: {
              entry: [
                { id: 'person', min: [0, 0, 0], max: [500, 500, 1800] },
                { id: 'bench', min: [700, 0, 0], max: [1400, 500, 500] },
              ],
            },
            transforms: {},
          },
        },
        'SCN001-R02': {
          evaluator: 'navmesh_connectivity',
          evidenceType: 'computed',
          evidenceReference: 'layout:rev-1/routes',
          input: { free_space: {}, agent_geometry: {}, doors: [], level_connectors: [] },
        },
        'SCN001-R03': {
          evaluator: 'profile_lookup',
          evidenceType: 'source_lookup',
          evidenceReference: 'profile:project@1',
          input: { jurisdiction: 'KG', building_scope: {}, selected_profile: 'project', source_version: '1' },
        },
        'SCN001-R04': {
          evaluator: 'activity_space',
          evidenceType: 'computed',
          evidenceReference: 'layout:rev-1/entry-use',
          input: { actor_footprint: {}, posture: 'standing', item_state: {}, approach_zones: [] },
        },
      },
    },
    evaluatorAdapters: {
      navmesh_connectivity: count({ status: 'pass', output: { path_exists: true, path: [], path_length: 1000 } }),
      profile_lookup: count({ status: 'pass', output: { active_constraints: [], missing_tables: [] } }),
      activity_space: count({ status: 'pass', output: { reachable: true, collision: false, clearance: 800 } }),
    },
  };
  return { context, adapterCalls: () => adapterCalls };
}

test('активация использует только explicit selections и сохраняет порядок 20 сценариев', () => {
  const brief = {
    daily_life: { entrance: { usual_arriving_group_size: 2 } },
    scenario_selections: [
      { scenario_id: 'SCN002', enabled: false, mandatory: false },
      { scenario_id: 'SCN001', enabled: true, mandatory: true },
      { scenario_id: 'SCN003', enabled: null, mandatory: null },
      { scenario_id: 'SCN999', enabled: true, mandatory: true },
    ],
  };
  const activation = activateLayoutScenarios(brief);
  assert.equal(activation.scenarios.length, 20);
  assert.deepEqual(activation.scenarios.slice(0, 4).map((entry) => entry.scenarioId), ['SCN001', 'SCN002', 'SCN003', 'SCN004']);
  assert.deepEqual(activation.active.map((entry) => entry.scenarioId), ['SCN001']);
  assert.deepEqual(activation.disabled.map((entry) => entry.scenarioId), ['SCN002']);
  assert.deepEqual(activation.unknown.map((entry) => entry.scenarioId), ['SCN003']);
  assert.ok(activation.unresolvedInputs.some((entry) => entry.scenarioId === 'SCN999'));

  const noSelection = activateLayoutScenarios({ daily_life: { entrance: { usual_arriving_group_size: 2 } } });
  assert.equal(noSelection.active.length, 0, 'данные брифа сами не включают сценарий');
  assert.ok(noSelection.scenarios.every((entry) => entry.activation === SCENARIO_ACTIVATION.UNSELECTED));
});

test('дубликат выбора и неявный enabled остаются unknown', () => {
  const duplicate = activateLayoutScenarios({
    scenarioSelections: [
      { scenarioId: 'SCN001', enabled: true },
      { scenarioId: 'SCN001', enabled: false },
    ],
  });
  assert.equal(duplicate.scenarios[0].activation, 'unknown');
  assert.equal(duplicate.active.length, 0);
  assert.match(duplicate.unresolvedInputs[0].reason, /несколько/);

  const implicit = activateLayoutScenarios({ scenarioSelections: { SCN001: null } });
  assert.equal(implicit.scenarios[0].activation, 'unknown');
  assert.match(implicit.unresolvedInputs[0].reason, /enabled/);

  const conflict = activateLayoutScenarios({
    scenarioSelections: [{ scenarioId: 'SCN001', enabled: false, mandatory: true }],
  });
  assert.equal(conflict.scenarios[0].activation, 'unknown');
  assert.match(conflict.unresolvedInputs[0].reason, /конфликтует/);
});

test('без required inputs, states, concurrency и bindings сценарий честно unknown', () => {
  const result = evaluateLayoutScenarios({ scenario_selections: activeSelection() }, null, {
    // Готовые числа без явной evaluator-привязки не исполняются.
    metrics: { solid_collisions_count: 0, required_route_reachable: true, task_success: true },
    // metric_id повторяется между checks, поэтому binding по нему также запрещён.
    evaluatorBindings: {
      solid_collisions_count: {
        evaluator: 'solid_collision_3d',
        evidenceType: 'computed',
        evidenceReference: 'layout:rev-1/collisions',
        input: { physical_volumes_per_state: { default: [] }, transforms: {} },
      },
    },
  });
  const scenario = result.activeScenarios[0];
  assert.equal(scenario.scenarioId, 'SCN001');
  assert.equal(scenario.status, 'unknown');
  assert.equal(scenario.dependencyResult.status, 'pass');
  assert.equal(scenario.requiredResults.length, 4);
  assert.ok(scenario.requiredResults.every((entry) => entry.status === 'unknown'));
  assert.ok(scenario.unresolvedInputs.some((entry) => entry.kind === 'required_input'));
  assert.ok(scenario.unresolvedInputs.some((entry) => entry.kind === 'state'));
  assert.ok(scenario.unresolvedInputs.some((entry) => entry.kind === 'concurrency'));
  assert.ok(scenario.unresolvedInputs.some((entry) => entry.kind === 'evaluator_binding'));
  assert.equal(result.summary.verified, false);
  assert.equal(result.summary.feasible, true, 'unknown не доказывает невозможность');
});

test('полностью явные inputs/state/concurrency/bindings дают pass только вызванным evaluator', () => {
  const { context, adapterCalls } = completeScn001Context();
  const result = evaluateLayoutScenarios({ scenarioSelections: activeSelection() }, null, context);
  const scenario = result.activeScenarios[0];
  assert.equal(scenario.status, 'pass');
  assert.deepEqual(scenario.taskOrder, ['enter', 'stage_bags', 'remove_shoes', 'store_clothes', 'pass_inside']);
  assert.deepEqual(scenario.requiredResults.map((entry) => entry.status), ['pass', 'pass', 'pass', 'pass']);
  assert.equal(adapterCalls(), 3, 'локальный solid_collision_3d не вызывает adapter');
  assert.equal(scenario.comfortStatus, 'unknown', 'непривязанные soft-проверки остаются unknown');
  assert.ok(scenario.unresolvedInputs.every((entry) => entry.scope === 'comfort'));
  assert.equal(result.summary.verified, true);
  assert.equal(result.summary.feasible, true);
});

test('pass/fail без разрешенного evidenceReference понижается до unknown', () => {
  const { context } = completeScn001Context();
  delete context.scenarioEvaluatorBindings.SCN001['SCN001-R02'].evidenceReference;
  const result = evaluateLayoutScenarios({ scenarioSelections: activeSelection() }, null, context);
  const route = result.activeScenarios[0].requiredResults.find((entry) => entry.checkId === 'SCN001-R02');
  assert.equal(route.originalStatus, 'pass');
  assert.equal(route.status, 'unknown');
  assert.equal(route.source, 'missing_evidence');
  assert.ok(result.activeScenarios[0].unresolvedInputs.some((entry) => entry.kind === 'evidence'));
  assert.equal(result.activeScenarios[0].status, 'unknown');

  context.scenarioEvaluatorBindings.SCN001['SCN001-R02'].evidenceReference = 'layout:rev-1/routes';
  context.scenarioEvaluatorBindings.SCN001['SCN001-R02'].evidenceType = 'invented';
  const invalidType = evaluateLayoutScenarios({ scenarioSelections: activeSelection() }, null, context);
  assert.equal(invalidType.activeScenarios[0].requiredResults[1].status, 'unknown');
});

test('непроверенное или проваленное состояние не маскируется успешными evaluator', () => {
  const { context } = completeScn001Context();
  context.scenarioContexts.SCN001.states.ENTRY_USE = { verified: false };
  const result = evaluateLayoutScenarios({ scenarioSelections: activeSelection() }, null, context);
  assert.equal(result.activeScenarios[0].stateResults[0].status, 'fail');
  assert.equal(result.activeScenarios[0].status, 'fail');
  assert.deepEqual(result.summary.failed, ['SCN001']);
  assert.equal(result.summary.feasible, false);
});

test('mutex состояний проверяется только по явному activeStateIds', () => {
  const passAdapter = () => ({ status: 'pass', output: {} });
  const bindings = Object.fromEntries(['R01', 'R02', 'R03', 'R04', 'R05'].map((suffix) => [
    `SCN017-${suffix}`,
    {
      evaluator: 'profile_lookup',
      evidenceType: 'source_lookup',
      evidenceReference: `profile:project@1/${suffix}`,
      input: { jurisdiction: 'KG', building_scope: {}, selected_profile: 'project', source_version: '1' },
    },
  ]));
  const context = {
    inputValues: {
      'brief.daily_life.seasons': { winter_configuration: true, summer_configuration: true },
      'brief.storage_inventory.items': [],
      'brief.engineering': { confirmed: true },
    },
    scenarioContexts: {
      SCN017: {
        states: { WINTER: true, SUMMER: true },
        concurrency: { activeStateIds: ['WINTER', 'SUMMER'] },
      },
    },
    scenarioEvaluatorBindings: { SCN017: bindings },
    evaluatorAdapters: { profile_lookup: passAdapter },
  };
  const result = evaluateLayoutScenarios({ scenarioSelections: activeSelection('SCN017') }, null, context);
  const mutex = result.activeScenarios[0].concurrencyResults.find((entry) => entry.kind === 'mutually_exclusive_states');
  assert.equal(mutex.status, 'fail');
  assert.equal(result.activeScenarios[0].status, 'fail');

  context.scenarioContexts.SCN017.concurrency.activeStateIds = ['WINTER'];
  const oneSeason = evaluateLayoutScenarios({ scenarioSelections: activeSelection('SCN017') }, null, context);
  assert.equal(oneSeason.activeScenarios[0].concurrencyResults[0].status, 'pass');
  assert.equal(oneSeason.activeScenarios[0].status, 'pass');
});

test('binding с отсутствующими входами evaluator возвращает unknown и missingInputs', () => {
  const { context } = completeScn001Context();
  context.scenarioEvaluatorBindings.SCN001['SCN001-R02'] = {
    evaluator: 'navmesh_connectivity', input: { free_space: {} },
  };
  const result = evaluateLayoutScenarios({ scenarioSelections: activeSelection() }, null, context);
  const route = result.activeScenarios[0].requiredResults.find((entry) => entry.checkId === 'SCN001-R02');
  assert.equal(route.status, 'unknown');
  assert.deepEqual(route.missingInputs, ['agent_geometry', 'doors', 'level_connectors']);
  assert.ok(result.activeScenarios[0].unresolvedInputs.some((entry) => entry.kind === 'evaluator_input'));
  assert.equal(result.activeScenarios[0].status, 'unknown');
});

test('disabled и unselected сценарии не вызывают adapters', () => {
  let calls = 0;
  const result = evaluateLayoutScenarios({
    scenarioSelections: [{ scenarioId: 'SCN001', enabled: false, mandatory: false }],
  }, null, {
    evaluatorBindings: { 'SCN001-R01': { evaluator: 'solid_collision_3d', input: {} } },
    evaluatorAdapters: { solid_collision_3d: () => { calls += 1; return { status: 'pass', output: {} }; } },
  });
  assert.equal(calls, 0);
  assert.equal(result.scenarios[0].status, 'not_applicable');
  assert.equal(result.summary.active, 0);
  assert.equal(result.summary.verified, false);
  assert.equal(result.summary.overallStatus, 'unknown', 'пустой active report не становится pass');
  assert.equal(result.summary.readiness, 'pending');
});

test('unselected и mandatory unknown отражаются отдельно в readiness aggregate', () => {
  const empty = evaluateLayoutScenarios({});
  assert.equal(empty.scenarios[0].status, 'unknown');
  assert.equal(empty.summary.overallStatus, 'unknown');
  assert.equal(empty.summary.mandatory.status, 'unknown');
  assert.equal(empty.summary.verified, false);

  const mandatory = evaluateLayoutScenarios({
    scenarioSelections: [{ scenarioId: 'SCN001', enabled: true, mandatory: true }],
  });
  assert.equal(mandatory.activeScenarios[0].readiness, 'pending');
  assert.equal(mandatory.activeScenarios[0].blocking, false);
  assert.deepEqual(mandatory.summary.mandatory.unknown, ['SCN001']);
  assert.equal(mandatory.summary.mandatory.status, 'unknown');
  assert.equal(mandatory.summary.overallStatus, 'unknown');
});

test('project aliases читают rooms/items/openings со всех levels, а не root accessors активного этажа', () => {
  const project = {
    levels: [
      { id: 'L1', rooms: [], items: [], openings: [] },
      {
        id: 'L2',
        rooms: [{ id: 'room-L2' }],
        items: [{ id: 'item-L2' }],
        openings: [{ id: 'door-L2' }],
      },
    ],
    // В реальной модели эти accessors показывают только active level.
    rooms: [],
    items: [],
    openings: [],
  };
  const brief = {
    scenarioSelections: ['SCN001', 'SCN005', 'SCN012'].map((scenarioId) => ({
      scenarioId, enabled: true, mandatory: false,
    })),
  };
  const context = {
    inputValues: {
      'brief.daily_life.entrance': { confirmed: true },
      'brief.household.members': [{ id: 'person-1' }],
      'brief.daily_life.guest_events': { confirmed: true },
      'brief.daily_life.wellness': { pool_used: true },
      'brief.engineering.external_validation_records': [{ id: 'report-1' }],
    },
  };
  const result = evaluateLayoutScenarios(brief, project, context);
  for (const scenarioId of ['SCN001', 'SCN005', 'SCN012']) {
    const scenario = result.activeScenarios.find((entry) => entry.scenarioId === scenarioId);
    assert.ok(scenario, scenarioId);
    assert.equal(
      scenario.unresolvedInputs.filter((entry) => entry.kind === 'required_input').length,
      0,
      `${scenarioId}: project alias должен найти данные второго этажа`,
    );
  }
});

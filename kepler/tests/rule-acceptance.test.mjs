// Численные fixtures ACCEPT-001…020 из FURNITURE_RULES_PACKAGE_RU v1.0.0.
// Проверяется только указанная метрика, а не «правильность всего дома».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACCEPTANCE_RESULT_SCOPE,
  PROVEN_INFEASIBLE_CASE_IDS,
  RULE_ACCEPTANCE_CASES,
  evaluateRuleAcceptance,
  evaluateRuleAcceptanceBatch,
} from '../core/rule-acceptance.js';

const canonicalCases = JSON.parse(readFileSync(
  new URL('../data/furniture-rules/v1/ACCEPTANCE_CASES_RU.json', import.meta.url),
  'utf8',
)).cases;

const canonicalGiven = (id) => canonicalCases.find((entry) => entry.id === id)?.given;

const fixtures = [
  {
    id: 'ACCEPT-001',
    given: {
      source_segment: { value: 4.2, unit: 'm' }, stored_unit: 'mm', reported_segment_length: 4200,
    },
    expectedStatus: 'pass',
    expectedMeasurements: { conversionFactor: 1000, convertedValueMm: 4200, reportedValueMm: 4200 },
  },
  {
    id: 'ACCEPT-002',
    given: {
      source_segment: { value: 4.2, unit: 'm' }, canonical_segment_mm: 4200,
      erroneous_export_mm: 4200000, conversion_already_applied: true,
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      canonicalValueMm: 4200, exportedValueMm: 4200000, scaleRatio: 1000, correctedValueMm: 4200,
    },
  },
  {
    id: 'ACCEPT-003',
    given: {
      parallel_walls_y: [0, 1000], agent_disk_diameter: 900, agent_disk_radius: 450,
      already_buffered: false, extra_margin: 0,
    },
    expectedStatus: 'pass',
    expectedMeasurements: {
      radiusMm: 450, declaredRadiusMm: 450, radiusConsistent: true, bufferPerSideMm: 450,
      centerRangeMm: [450, 550], centerRangeWidthMm: 100,
    },
  },
  {
    id: 'ACCEPT-004',
    given: {
      portal_clear_width: 850, rigid_disk_diameter: 900, portal_is_only_connection: true,
      geometry_locked: true, profile_allows_body_deformation: false,
      proof_scope: 'только прохождение этого диска через этот неизменяемый проем',
    },
    expectedStatus: 'fail',
    expectedMeasurements: { portalWidthMm: 850, bodyDiameterMm: 900, deficitMm: 50 },
    proofScope: 'только прохождение этого диска через этот неизменяемый проем',
  },
  {
    id: 'ACCEPT-005',
    given: {
      table_edge_to_obstruction: 1300, occupied_seat_projection_from_table_edge: 650,
      occupied_depth_includes_person_and_backrest: true, residual_walkway_soft_target: 900,
      nkba_traffic_mode: 'walk_past', nkba_reference_from_table_edge: 1118,
    },
    expectedStatus: 'mixed',
    expectedMeasurements: {
      tableEdgeToObstructionMm: 1300, occupiedProjectionMm: 650, residualWalkwayMm: 650,
      tableEdgeReferenceMm: 1118, residualTargetMm: 900, residualDeficitMm: 250,
    },
    expectedChecks: [['table_edge_recommendation', 'pass'], ['residual_walkway_target', 'fail']],
  },
  {
    id: 'ACCEPT-006',
    given: {
      room_inner_width: 3400, mattress_width: 1800, frame_outer_width: 2000,
      bed_centered: true, side_clearance_soft_target: 800,
    },
    expectedStatus: 'mixed',
    expectedMeasurements: {
      roomWidthMm: 3400, mattressWidthMm: 1800, frameWidthMm: 2000,
      leftClearanceMm: 700, rightClearanceMm: 700, mattressBasedClearanceMm: 800,
      targetMm: 800, deficitPerSideMm: 100,
    },
    expectedChecks: [
      ['outer_frame_geometry_used', 'pass'],
      ['left_side_soft_target', 'fail'],
      ['right_side_soft_target', 'fail'],
    ],
  },
  {
    id: 'ACCEPT-007',
    given: {
      room_inner_width: 3000, bed_outer_width: 2000, left_access_required: 600,
      right_access_required: 600, clearances_are_explicit_brief_constraints: true,
      bed_orientation_locked: true, all_three_strips_parallel_and_nonoverlapping: true,
      no_replacement_or_resize: true,
      proof_scope: 'выбранная кровать в зафиксированной ориентации с двумя явно обязательными боковыми полосами',
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      roomWidthMm: 3000, bedWidthMm: 2000, leftAccessMm: 600, rightAccessMm: 600,
      requiredWidthMm: 3200, deficitMm: 200,
    },
    proofScope: 'выбранная кровать в зафиксированной ориентации с двумя явно обязательными боковыми полосами',
  },
  {
    id: 'ACCEPT-008',
    given: {
      a_box: { x: [0, 1000], y: [0, 500], z: [0, 800] },
      b_box: { x: [900, 1500], y: [400, 900], z: [0, 800] },
      allowed_contact_tolerance: 0,
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      collision: true, toleranceMm: 0, rawOverlapMm: { x: 100, y: 100, z: 800 },
      intersectionSizeMm: { x: 100, y: 100, z: 800 }, intersectionVolumeMm3: 8000000,
      zSeparationMm: 0,
    },
  },
  {
    id: 'ACCEPT-009',
    given: {
      seat_box: { x: [200, 600], y: [200, 600], z: [400, 450] },
      tabletop_box: { x: [0, 1000], y: [0, 1000], z: [750, 800] },
      other_support_geometries_verified_disjoint: true,
    },
    expectedStatus: 'pass',
    expectedMeasurements: {
      collision: false, toleranceMm: 0, rawOverlapMm: { x: 400, y: 400, z: -300 },
      intersectionSizeMm: { x: 400, y: 400, z: 0 }, intersectionVolumeMm3: 0,
      zSeparationMm: 300,
    },
  },
  {
    id: 'ACCEPT-010',
    given: {
      armrest_top_z: 700, apron_bottom_z: 680, armrest_bottom_z: 650, apron_top_z: 740,
      horizontal_overlap_in_required_tuck_state: true, tuck_in_required_by_brief: true,
    },
    expectedStatus: 'fail',
    expectedMeasurements: { verticalOverlapMm: 20, collision: true },
  },
  {
    id: 'ACCEPT-011',
    given: {
      front_to_opposite_wall: 900, drawer_extension: 600,
      operator_required_depth_after_drawer_front: 500, operator_must_stand_in_front: true,
      drawer_cannot_be_partially_used_in_this_task: true,
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      frontToWallMm: 900, extensionMm: 600, remainingDepthMm: 300,
      requiredOperatorDepthMm: 500, deficitMm: 200,
    },
  },
  {
    id: 'ACCEPT-012',
    given: {
      aisle_width_closed: 1000, door_projection_open: 600, agent_disk_diameter: 600,
      agent_can_reach_handle_without_collision: true, safe_closing_motion_verified: true,
      active_profile_allows_closure_before_operational_exit: true,
      route_is_not_a_required_clear_egress_strip: true, no_other_obstacles: true,
    },
    expectedStatus: 'pass',
    expectedMeasurements: {
      closedAisleMm: 1000, openProjectionMm: 600, bodyDiameterMm: 600, openGapMm: 400,
      openStateStatus: 'fail', closedStateStatus: 'pass', transitionVerified: true,
      acceptedSequence: ['close', 'pass'],
    },
  },
  {
    id: 'ACCEPT-013',
    given: {
      measured_gap_g: 920, combined_error_bound_e: 10, required_threshold: 900,
      threshold_is_explicit_project_constraint: true,
    },
    expectedStatus: 'pass',
    expectedMeasurements: {
      measuredGapMm: 920, errorBoundMm: 10, thresholdMm: 900,
      intervalMm: [910, 930], worstCaseMarginMm: 10,
    },
  },
  {
    id: 'ACCEPT-014',
    given: {
      measured_gap_g: 880, combined_error_bound_e: 10, required_threshold: 900,
      threshold_is_explicit_project_constraint: true,
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      measuredGapMm: 880, errorBoundMm: 10, thresholdMm: 900,
      intervalMm: [870, 890], worstCaseMarginMm: -30,
    },
  },
  {
    id: 'ACCEPT-015',
    given: {
      measured_gap_g: 905, combined_error_bound_e: 10, required_threshold: 900,
      threshold_is_explicit_project_constraint: true,
    },
    expectedStatus: 'unknown',
    expectedMeasurements: {
      measuredGapMm: 905, errorBoundMm: 10, thresholdMm: 900,
      intervalMm: [895, 915], worstCaseMarginMm: -5,
    },
  },
  {
    id: 'ACCEPT-016',
    given: {
      available_straight_edge_length: 2400, required_seat_count_on_this_edge: 4,
      explicit_brief_frontage_per_seat: 700, overlap_between_intervals_allowed: false,
      end_seats_or_other_edges_allowed: false, table_resize_allowed: false,
      proof_scope: 'четыре заданных непересекающихся посадочных интервала только на этом краю',
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      availableLengthMm: 2400, seatCount: 4, frontagePerSeatMm: 700,
      requiredLengthMm: 2800, deficitMm: 400,
    },
    proofScope: 'четыре заданных непересекающихся посадочных интервала только на этом краю',
  },
  {
    id: 'ACCEPT-017',
    given: {
      niche_clear_width: 1900, cabinet_outer_widths: [1000, 1000], single_row_required: true,
      overlap_allowed: false, rotation_resize_replacement_allowed: false,
      proof_scope: 'два этих корпуса в одном фиксированном ряду',
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      nicheWidthMm: 1900, cabinetWidthsMm: [1000, 1000], requiredWidthMm: 2000, deficitMm: 100,
    },
    proofScope: 'два этих корпуса в одном фиксированном ряду',
  },
  {
    id: 'ACCEPT-018',
    given: {
      finished_floor_z: 0, ceiling_z: 2400, rigid_cabinet_outer_height: 2500,
      upright_orientation_required: true, floor_and_ceiling_locked: true,
      resize_or_recess_allowed: false,
      proof_scope: 'конечное вертикальное положение этого шкафа в этом объеме',
    },
    expectedStatus: 'fail',
    expectedMeasurements: {
      floorZMm: 0, ceilingZMm: 2400, availableHeightMm: 2400,
      cabinetHeightMm: 2500, deficitMm: 100,
    },
    proofScope: 'конечное вертикальное положение этого шкафа в этом объеме',
  },
  {
    id: 'ACCEPT-019',
    given: {
      walkable_union_rectangles: [[0, 0, 3000, 1000], [2000, 0, 3000, 3000]],
      agent_disk_diameter: 800, start: [500, 500], goal: [2500, 2500],
      invalid_shortcut: [[500, 500], [2500, 2500]],
      valid_polyline: [[500, 500], [2500, 500], [2500, 2500]], additional_obstacles: [],
    },
    expectedStatus: 'mixed',
    expectedMeasurements: {
      radiusMm: 400,
      erodedRectangles: [[400, 400, 2600, 600], [2400, 400, 2600, 2600]],
      shortcutValid: false, polylineValid: true, shortcutMidpointMm: [1500, 1500],
      shortcutMidpointOnWalkableFloor: false,
    },
    expectedChecks: [['shortcut_candidate', 'fail'], ['polyline_candidate', 'pass']],
  },
  {
    id: 'ACCEPT-020',
    given: {
      bunk_model_manual_verified: true, manufacturer_max_mattress_thickness: 160,
      selected_mattress_thickness: 220, guardrail_configuration_unchanged: true,
    },
    expectedStatus: 'fail',
    expectedMeasurements: { maximumThicknessMm: 160, selectedThicknessMm: 220, excessMm: 60 },
  },
];

const scenarioExpected = {
  'ACCEPT-021': {
    measurements: { solarGlareVerified: false, missingInputs: ['north'], assumedPlanNorth: false },
  },
  'ACCEPT-022': {
    measurements: {
      profileEnabled: false, localRegulatoryProfile: 'pending_external_validation', geometryChecksRemainEnabled: true,
    },
  },
  'ACCEPT-023': {
    measurements: {
      profileEnabled: true, scopeVerified: true, belowMinimum: true,
      exceptionConditionsMet: false, noOtherException: true,
    },
  },
  'ACCEPT-024': {
    measurements: {
      projectCountry: 'KG', textVerified: false, scopeVerified: false,
      profileStatus: 'pending_external_validation',
    },
  },
  'ACCEPT-025': {
    measurements: {
      reason: 'needs_model_data', readiness: 'preliminary_only',
      missingInputs: ['model_id', 'installation_manual'],
    },
  },
  'ACCEPT-026': {
    measurements: { verifiedNoClimbZone: true, chairClimbable: true, intersectsZone: true },
  },
  'ACCEPT-027': {
    measurements: {
      floorId: 'upper_floor', supportInsideVoid: true, supportSurfacePresent: false,
      lowerFloorDoesNotProvideSupport: true,
    },
  },
  'ACCEPT-028': {
    measurements: {
      zonesOverlap: true, useMode: 'sequential', exitAvailable: true, profileProhibitsOverlap: false,
    },
  },
  'ACCEPT-029': {
    measurements: {
      reachZonesOverlap: true, trajectoriesDisjoint: true, resourcesAvailable: true,
      reservedZoneViolation: false,
    },
  },
  'ACCEPT-030': {
    measurements: {
      planDimensionsStatus: 'pass',
      missingInputs: ['manufacturer_mattress_limits', 'guardrail_configuration'],
    },
  },
  'ACCEPT-031': {
    measurements: { eligible: null, missingInputs: ['child_age'] },
  },
  'ACCEPT-032': {
    solverStatus: 'search_budget_exhausted',
    measurements: {
      conclusionSupported: false, infeasibilityCertificatePresent: false, completeEnumerationDone: false,
    },
  },
  'ACCEPT-033': {
    measurements: {
      sourceKind: 'professional_guideline', declaredBasis: 'mandatory_Kyrgyzstan_law',
      correctedBasis: 'published_guideline', localAdoptionVerified: false,
    },
  },
  'ACCEPT-034': {
    measurements: { kitchenTopology: 'single_wall', workflowVerified: true, physicalChecksPass: true },
  },
  'ACCEPT-035': {
    measurements: {
      invalidGain: true, claimedGainReason: 'furniture_coverage_ratio_increased',
      usefulFunctionAdded: false, routeQualityReduced: true,
    },
  },
  'ACCEPT-036': {
    measurements: {
      orientationHeuristicStatus: 'pass', glareVerified: false,
      missingInputs: ['sun_orientation', 'screen_reflection_model', 'shading_state'],
    },
  },
  'ACCEPT-037': {
    measurements: {
      lightingVerified: false, reason: 'insufficient_photometry',
      missingInputs: ['luminous_flux', 'photometric_distribution', 'surface_reflectance'],
    },
  },
  'ACCEPT-038': {
    measurements: {
      soundIsolationVerified: false, decorOnlyClaimRejected: true,
      missingInputs: ['wall_construction', 'junctions', 'source_noise_spectrum'],
    },
  },
  'ACCEPT-039': {
    measurements: {
      egressEdgeStatus: 'unverified', mayBeUsedAsConfirmedExit: false, onlyBackupExitAssumed: true,
      missingInputs: ['clear_opening', 'opening_mode', 'external_escape_continuation'],
    },
  },
  'ACCEPT-040': {
    measurements: {
      geometryVerified: true, openStateStatus: 'pass', closedStateStatus: 'fail', collision: true,
    },
  },
  'ACCEPT-041': {
    measurements: { geometryStatus: 'pass', activeLegalLightRequirement: false, selectedPriority: 'privacy' },
    checks: [['privacy_soft_target', 'pass'], ['daylight_soft_target', 'fail']],
  },
  'ACCEPT-042': {
    measurements: {
      tablePoseRevision: 'new', checkedPoseRevision: 'old', cacheFresh: false,
      dependentMetricsStatus: 'unknown_until_recalculated',
    },
  },
  'ACCEPT-043': {
    measurements: {
      sequenceVerified: true, destructiveDemolitionRequired: false,
      acceptedSequence: ['remove_panel', 'service', 'replace_panel'],
    },
  },
  'ACCEPT-044': {
    measurements: { insideScenarioRequired: false, outsideScenarioVerified: true },
  },
  'ACCEPT-045': {
    measurements: {
      rackBlocksOperatorZone: true, useMode: 'sequential', sequenceVerified: true, exitClear: true,
    },
  },
  'ACCEPT-046': {
    measurements: {
      requiredFunctions: ['sleeping', 'clothes_storage'], providedFunctions: [],
      missingFunctions: ['sleeping', 'clothes_storage'], routeScoreIgnoredForCoverage: true,
    },
  },
  'ACCEPT-047': {
    measurements: {
      independentAccessRequired: true, firstSleeperPathStatus: 'pass',
      secondSleeperPathStatus: 'fail', occupiedMattressIsNotRoute: true,
    },
  },
  'ACCEPT-048': {
    measurements: { geometryVerified: true, gasAndVentilationStatus: 'unknown', constructionApproved: false },
    checks: [
      ['furniture_geometry', 'pass'],
      ['fixed_connection_regions', 'pass'],
      ['gas_installation', 'unknown'],
      ['hood_combustion_interaction', 'unknown'],
      ['local_regulatory_profile', 'unknown'],
    ],
  },
};

test('реестр содержит все канонические ACCEPT-001…048 без дубликатов', () => {
  assert.equal(RULE_ACCEPTANCE_CASES.length, 48);
  assert.equal(new Set(RULE_ACCEPTANCE_CASES.map((entry) => entry.id)).size, 48);
  assert.deepEqual(
    RULE_ACCEPTANCE_CASES.map((entry) => [entry.id, entry.evaluatedMetric, entry.expectedStatus]),
    canonicalCases.map((entry) => [entry.id, entry.given.evaluated_metric, entry.expected_status]),
  );
});

test('точные fixtures воспроизводят статусы и промежуточные формулы пакета', async (t) => {
  for (const fixture of fixtures) {
    await t.test(fixture.id, () => {
      const result = evaluateRuleAcceptance(fixture.id, fixture.given);
      assert.equal(result.caseId, fixture.id);
      assert.equal(result.scope, ACCEPTANCE_RESULT_SCOPE);
      assert.equal(result.status, fixture.expectedStatus);
      assert.deepEqual(result.measurements, fixture.expectedMeasurements);
      if (fixture.expectedChecks) {
        assert.deepEqual(result.checks.map(({ id, status }) => [id, status]), fixture.expectedChecks);
      } else {
        assert.equal(result.checks, undefined);
      }
      if (fixture.proofScope) {
        assert.equal(result.solverStatus, 'proven_infeasible');
        assert.equal(result.proofScope, fixture.proofScope);
      } else {
        assert.equal(result.solverStatus, undefined);
        assert.equal(result.proofScope, undefined);
      }
    });
  }
});

test('сценарные fixtures ACCEPT-021…048 воспроизводят канонические truth-table результаты', async (t) => {
  for (const fixture of canonicalCases.slice(20)) {
    await t.test(fixture.id, () => {
      const result = evaluateRuleAcceptance(fixture.id, fixture.given);
      const expected = scenarioExpected[fixture.id];
      assert.ok(expected, `нет ожидаемых деталей для ${fixture.id}`);
      assert.equal(result.caseId, fixture.id);
      assert.equal(result.evaluatedMetric, fixture.given.evaluated_metric);
      assert.equal(result.scope, ACCEPTANCE_RESULT_SCOPE);
      assert.equal(result.status, fixture.expected_status);
      assert.deepEqual(result.measurements, expected.measurements);
      if (expected.checks) {
        assert.deepEqual(result.checks.map(({ id, status }) => [id, status]), expected.checks);
      } else {
        assert.equal(result.checks, undefined);
      }
      assert.equal(result.solverStatus, expected.solverStatus);
      assert.equal(result.proofScope, undefined);
    });
  }
});

test('внешние и недостающие данные остаются unknown без скрытых допущений', () => {
  const externalUnknownIds = [
    'ACCEPT-021', 'ACCEPT-024', 'ACCEPT-025', 'ACCEPT-030', 'ACCEPT-031',
    'ACCEPT-036', 'ACCEPT-037', 'ACCEPT-038', 'ACCEPT-039',
  ];
  for (const id of externalUnknownIds) {
    const result = evaluateRuleAcceptance(id, canonicalGiven(id));
    assert.equal(result.status, 'unknown', id);
    assert.notEqual(result.solverStatus, 'proven_infeasible', id);
    assert.equal(result.proofScope, undefined, id);
  }
  const timeout = evaluateRuleAcceptance('ACCEPT-032', canonicalGiven('ACCEPT-032'));
  assert.equal(timeout.status, 'unknown');
  assert.equal(timeout.solverStatus, 'search_budget_exhausted');
  assert.equal(timeout.proofScope, undefined);
});

test('mixed сохраняет результаты независимых компонентов', () => {
  const preferences = evaluateRuleAcceptance('ACCEPT-041', canonicalGiven('ACCEPT-041'));
  assert.equal(preferences.status, 'mixed');
  assert.deepEqual(preferences.checks.map(({ status }) => status), ['pass', 'fail']);

  const readiness = evaluateRuleAcceptance('ACCEPT-048', canonicalGiven('ACCEPT-048'));
  assert.equal(readiness.status, 'mixed');
  assert.deepEqual(readiness.checks.map(({ status }) => status), ['pass', 'pass', 'unknown', 'unknown', 'unknown']);
  assert.equal(readiness.measurements.geometryVerified, true);
  assert.equal(readiness.measurements.constructionApproved, false);
});

test('сценарные truth tables меняют статус только по явно заданным фактам', () => {
  assert.equal(evaluateRuleAcceptance('ACCEPT-028', {
    ...canonicalGiven('ACCEPT-028'), profile_prohibits_overlap: true,
  }).status, 'fail');
  assert.equal(evaluateRuleAcceptance('ACCEPT-029', {
    ...canonicalGiven('ACCEPT-029'), actual_body_and_hand_trajectories_verified_disjoint: false,
  }).status, 'fail');
  assert.equal(evaluateRuleAcceptance('ACCEPT-040', {
    ...canonicalGiven('ACCEPT-040'), curtain_closed_swept_volume_intersects_bed_frame: false,
  }).status, 'pass');
  assert.equal(evaluateRuleAcceptance('ACCEPT-042', {
    ...canonicalGiven('ACCEPT-042'), lighting_check_table_pose_revision: 'new',
  }).status, 'pass');
  assert.equal(evaluateRuleAcceptance('ACCEPT-043', {
    ...canonicalGiven('ACCEPT-043'), manufacturer_service_sequence_verified: false,
  }).status, 'fail');
  assert.equal(evaluateRuleAcceptance('ACCEPT-045', {
    ...canonicalGiven('ACCEPT-045'), required_exit_remains_clear: false,
  }).status, 'fail');
  assert.equal(evaluateRuleAcceptance('ACCEPT-046', {
    ...canonicalGiven('ACCEPT-046'),
    placed_objects: [{ functions: ['sleeping', 'clothes_storage'] }],
  }).status, 'pass');
  assert.equal(evaluateRuleAcceptance('ACCEPT-047', {
    ...canonicalGiven('ACCEPT-047'), alternative_path_verified_absent_in_this_layout: false,
  }).status, 'pass');
  assert.equal(evaluateRuleAcceptance('ACCEPT-048', {
    ...canonicalGiven('ACCEPT-048'),
    gas_installation_project_missing: false,
    gas_installation_verified: true,
    hood_and_combustion_interaction_unverified: false,
    hood_combustion_verified: true,
    local_regulatory_profile_pending: false,
    local_regulatory_profile_verified: true,
  }).status, 'pass');
});

test('proven_infeasible ограничен пятью арифметически доказанными подзадачами', () => {
  const results = fixtures.map((fixture) => evaluateRuleAcceptance(fixture.id, fixture.given));
  assert.deepEqual(
    results.filter((result) => result.solverStatus === 'proven_infeasible').map((result) => result.caseId),
    PROVEN_INFEASIBLE_CASE_IDS,
  );
  for (const result of results.filter((entry) => entry.solverStatus === 'proven_infeasible')) {
    assert.equal(typeof result.proofScope, 'string');
    assert.ok(result.proofScope.length > 0);
    assert.ok(result.measurements.deficitMm > 0);
  }
});

test('робастный порог использует строгие границы pass/fail/unknown', () => {
  const base = { combined_error_bound_e: 10, required_threshold: 900 };
  assert.equal(evaluateRuleAcceptance('ACCEPT-013', { ...base, measured_gap_g: 910 }).status, 'pass');
  assert.equal(evaluateRuleAcceptance('ACCEPT-014', { ...base, measured_gap_g: 889 }).status, 'fail');
  assert.equal(evaluateRuleAcceptance('ACCEPT-015', { ...base, measured_gap_g: 890 }).status, 'unknown');
});

test('без полного proof_scope локальный fail не повышается до proven_infeasible', () => {
  const fixture = fixtures.find((entry) => entry.id === 'ACCEPT-004');
  const result = evaluateRuleAcceptance(fixture.id, { ...fixture.given, portal_is_only_connection: false });
  assert.equal(result.status, 'fail');
  assert.equal(result.solverStatus, undefined);
  assert.equal(result.proofScope, undefined);
});

test('непроверенный паспорт кровати дает unknown, а не ложный pass', () => {
  const fixture = fixtures.find((entry) => entry.id === 'ACCEPT-020');
  const result = evaluateRuleAcceptance(fixture.id, { ...fixture.given, bunk_model_manual_verified: false });
  assert.equal(result.status, 'unknown');
  assert.equal(result.measurements.excessMm, 60);
});

test('пакетный API сохраняет порядок и область результатов', () => {
  const selected = [fixtures[0], fixtures[14], fixtures[18]];
  const results = evaluateRuleAcceptanceBatch(selected);
  assert.deepEqual(results.map((entry) => entry.caseId), ['ACCEPT-001', 'ACCEPT-015', 'ACCEPT-019']);
  assert.deepEqual(results.map((entry) => entry.status), ['pass', 'unknown', 'mixed']);
  assert.ok(results.every((entry) => entry.scope === 'evaluated_metric_only'));
});

test('неизвестный case ID и поврежденный численный fixture отвергаются явно', () => {
  assert.throws(() => evaluateRuleAcceptance('ACCEPT-999', {}), /Неизвестный численный acceptance-кейс/);
  assert.throws(
    () => evaluateRuleAcceptance('ACCEPT-011', { front_to_opposite_wall: 'нет данных' }),
    /должен быть конечным числом/,
  );
  assert.throws(() => evaluateRuleAcceptanceBatch({}), /cases должен быть массивом/);
});

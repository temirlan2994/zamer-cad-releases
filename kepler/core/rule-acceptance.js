// Исполняемый первый слой численных acceptance-спецификаций
// FURNITURE_RULES_PACKAGE_RU v1.0.0.
//
// Результат каждого вычисления относится только к указанной метрике. Он не
// подтверждает весь проект, соблюдение закона или полноту базы правил.

export const ACCEPTANCE_RESULT_SCOPE = 'evaluated_metric_only';

export const PROVEN_INFEASIBLE_CASE_IDS = Object.freeze([
  'ACCEPT-004', 'ACCEPT-007', 'ACCEPT-016', 'ACCEPT-017', 'ACCEPT-018',
]);

const specs = [
  ['ACCEPT-001', 'unit_conversion', 'pass'],
  ['ACCEPT-002', 'unit_conversion', 'fail'],
  ['ACCEPT-003', 'disk_configuration_space', 'pass'],
  ['ACCEPT-004', 'fixed_portal_traversability', 'fail'],
  ['ACCEPT-005', 'seating_clearance_and_residual_walkway', 'mixed'],
  ['ACCEPT-006', 'bed_side_clearances', 'mixed'],
  ['ACCEPT-007', 'fixed_bed_and_two_required_access_strips', 'fail'],
  ['ACCEPT-008', 'solid_collision', 'fail'],
  ['ACCEPT-009', 'solid_collision', 'pass'],
  ['ACCEPT-010', 'required_chair_tuck_in_state', 'fail'],
  ['ACCEPT-011', 'operator_fit_in_fixed_open_state', 'fail'],
  ['ACCEPT-012', 'time_expanded_operational_exit', 'pass'],
  ['ACCEPT-013', 'robust_clearance', 'pass'],
  ['ACCEPT-014', 'robust_clearance', 'fail'],
  ['ACCEPT-015', 'robust_clearance', 'unknown'],
  ['ACCEPT-016', 'fixed_edge_seat_assignment', 'fail'],
  ['ACCEPT-017', 'two_cabinets_in_locked_single_row', 'fail'],
  ['ACCEPT-018', 'final_upright_height_fit', 'fail'],
  ['ACCEPT-019', 'candidate_path_validity', 'mixed'],
  ['ACCEPT-020', 'bunk_mattress_model_compatibility', 'fail'],
  ['ACCEPT-021', 'solar_glare_at_task', 'unknown'],
  ['ACCEPT-022', 'ada_route_width', 'not_applicable'],
  ['ACCEPT-023', 'ada_continuous_width_exception', 'fail'],
  ['ACCEPT-024', 'local_regulatory_applicability', 'unknown'],
  ['ACCEPT-025', 'sauna_heater_thermal_keepout', 'unknown'],
  ['ACCEPT-026', 'verified_pool_barrier_no_climb_zone', 'fail'],
  ['ACCEPT-027', 'furniture_support_on_assigned_floor', 'fail'],
  ['ACCEPT-028', 'sequential_use_zone_overlap', 'pass'],
  ['ACCEPT-029', 'simultaneous_reach_zone_overlap', 'pass'],
  ['ACCEPT-030', 'bunk_model_and_mattress_compatibility', 'unknown'],
  ['ACCEPT-031', 'upper_bunk_user_eligibility', 'unknown'],
  ['ACCEPT-032', 'solver_conclusion_validity', 'unknown'],
  ['ACCEPT-033', 'evidence_classification', 'fail'],
  ['ACCEPT-034', 'mandatory_work_triangle', 'not_applicable'],
  ['ACCEPT-035', 'scoring_semantics', 'fail'],
  ['ACCEPT-036', 'screen_glare_verified', 'unknown'],
  ['ACCEPT-037', 'task_illuminance_verified', 'unknown'],
  ['ACCEPT-038', 'sound_isolation_verified', 'unknown'],
  ['ACCEPT-039', 'window_egress_eligibility', 'unknown'],
  ['ACCEPT-040', 'curtain_closed_state_collision', 'fail'],
  ['ACCEPT-041', 'soft_preference_tradeoff', 'mixed'],
  ['ACCEPT-042', 'validation_cache_freshness', 'fail'],
  ['ACCEPT-043', 'service_access_sequence', 'pass'],
  ['ACCEPT-044', 'inside_garage_tailgate_unloading', 'not_applicable'],
  ['ACCEPT-045', 'laundry_temporal_overlap', 'pass'],
  ['ACCEPT-046', 'mandatory_function_coverage', 'fail'],
  ['ACCEPT-047', 'independent_bed_access', 'fail'],
  ['ACCEPT-048', 'installation_readiness_components', 'mixed'],
];

export const RULE_ACCEPTANCE_CASES = Object.freeze(specs.map(([id, evaluatedMetric, expectedStatus]) => Object.freeze({
  id, evaluatedMetric, expectedStatus,
})));

const SPEC_BY_ID = new Map(RULE_ACCEPTANCE_CASES.map((entry) => [entry.id, entry]));
const EPSILON = 1e-9;

function finite(given, key) {
  const value = Number(given?.[key]);
  if (!Number.isFinite(value)) throw new TypeError(`${key} должен быть конечным числом`);
  return value;
}

function finitePair(value, key) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => !Number.isFinite(Number(item)))) {
    throw new TypeError(`${key} должен быть парой конечных чисел`);
  }
  return value.map(Number);
}

function same(a, b) {
  return Math.abs(a - b) <= EPSILON;
}

function mixedStatus(checks) {
  const statuses = new Set(checks.map((entry) => entry.status));
  return statuses.size === 1 ? checks[0]?.status || 'unknown' : 'mixed';
}

function proofResult(status, proofScope, deficitMm, measurements = {}) {
  const result = { status, measurements: { ...measurements, deficitMm } };
  if (status === 'fail' && typeof proofScope === 'string' && proofScope.length > 0) {
    result.solverStatus = 'proven_infeasible';
    result.proofScope = proofScope;
  }
  return result;
}

function unitConversion(given) {
  const factors = { 'm:mm': 1000, 'cm:mm': 10, 'mm:mm': 1 };
  const source = given?.source_segment || {};
  const factor = factors[`${source.unit}:${given?.stored_unit}`];
  if (!factor) {
    return { status: 'unknown', measurements: { conversionFactor: null } };
  }
  const convertedValueMm = Number(source.value) * factor;
  const reportedValueMm = finite(given, 'reported_segment_length');
  return {
    status: same(convertedValueMm, reportedValueMm) ? 'pass' : 'fail',
    measurements: { conversionFactor: factor, convertedValueMm, reportedValueMm },
  };
}

function duplicateUnitConversion(given) {
  const canonicalValueMm = finite(given, 'canonical_segment_mm');
  const exportedValueMm = finite(given, 'erroneous_export_mm');
  const scaleRatio = canonicalValueMm === 0 ? null : exportedValueMm / canonicalValueMm;
  const duplicated = given?.conversion_already_applied === true && !same(exportedValueMm, canonicalValueMm);
  return {
    status: duplicated ? 'fail' : 'pass',
    measurements: {
      canonicalValueMm,
      exportedValueMm,
      scaleRatio,
      correctedValueMm: canonicalValueMm,
    },
  };
}

function diskConfigurationSpace(given) {
  const [wallA, wallB] = finitePair(given?.parallel_walls_y, 'parallel_walls_y').sort((a, b) => a - b);
  const diameterMm = finite(given, 'agent_disk_diameter');
  const radiusMm = diameterMm / 2;
  const declaredRadiusMm = finite(given, 'agent_disk_radius');
  const extraMarginMm = finite(given, 'extra_margin');
  const bufferPerSideMm = given?.already_buffered === true ? 0 : radiusMm + extraMarginMm;
  const centerRangeMm = [wallA + bufferPerSideMm, wallB - bufferPerSideMm];
  const centerRangeWidthMm = centerRangeMm[1] - centerRangeMm[0];
  const radiusConsistent = same(radiusMm, declaredRadiusMm);
  return {
    status: radiusConsistent && centerRangeWidthMm >= -EPSILON ? 'pass' : 'fail',
    measurements: {
      radiusMm,
      declaredRadiusMm,
      radiusConsistent,
      bufferPerSideMm,
      centerRangeMm,
      centerRangeWidthMm,
    },
  };
}

function fixedPortal(given) {
  const portalWidthMm = finite(given, 'portal_clear_width');
  const bodyDiameterMm = finite(given, 'rigid_disk_diameter');
  const deficitMm = Math.max(0, bodyDiameterMm - portalWidthMm);
  const fixedSubproblem = given?.portal_is_only_connection === true
    && given?.geometry_locked === true
    && given?.profile_allows_body_deformation === false;
  const status = deficitMm > 0 ? 'fail' : 'pass';
  return proofResult(status, fixedSubproblem ? given?.proof_scope : null, deficitMm, {
    portalWidthMm, bodyDiameterMm,
  });
}

function seatingClearance(given) {
  const tableEdgeToObstructionMm = finite(given, 'table_edge_to_obstruction');
  const occupiedProjectionMm = finite(given, 'occupied_seat_projection_from_table_edge');
  const residualTargetMm = finite(given, 'residual_walkway_soft_target');
  const tableEdgeReferenceMm = finite(given, 'nkba_reference_from_table_edge');
  const residualWalkwayMm = tableEdgeToObstructionMm - occupiedProjectionMm;
  const checks = [
    {
      id: 'table_edge_recommendation',
      severity: 'soft',
      status: tableEdgeToObstructionMm >= tableEdgeReferenceMm ? 'pass' : 'fail',
    },
    {
      id: 'residual_walkway_target',
      severity: 'soft',
      status: residualWalkwayMm >= residualTargetMm ? 'pass' : 'fail',
    },
  ];
  return {
    status: mixedStatus(checks),
    measurements: {
      tableEdgeToObstructionMm,
      occupiedProjectionMm,
      residualWalkwayMm,
      tableEdgeReferenceMm,
      residualTargetMm,
      residualDeficitMm: Math.max(0, residualTargetMm - residualWalkwayMm),
    },
    checks,
  };
}

function bedSideClearances(given) {
  const roomWidthMm = finite(given, 'room_inner_width');
  const mattressWidthMm = finite(given, 'mattress_width');
  const frameWidthMm = finite(given, 'frame_outer_width');
  const targetMm = finite(given, 'side_clearance_soft_target');
  if (given?.bed_centered !== true) {
    return { status: 'unknown', measurements: { roomWidthMm, frameWidthMm } };
  }
  const sideClearanceMm = (roomWidthMm - frameWidthMm) / 2;
  const mattressBasedClearanceMm = (roomWidthMm - mattressWidthMm) / 2;
  const sideStatus = sideClearanceMm >= targetMm ? 'pass' : 'fail';
  const checks = [
    { id: 'outer_frame_geometry_used', severity: 'hard', status: 'pass' },
    { id: 'left_side_soft_target', severity: 'soft', status: sideStatus },
    { id: 'right_side_soft_target', severity: 'soft', status: sideStatus },
  ];
  return {
    status: mixedStatus(checks),
    measurements: {
      roomWidthMm,
      mattressWidthMm,
      frameWidthMm,
      leftClearanceMm: sideClearanceMm,
      rightClearanceMm: sideClearanceMm,
      mattressBasedClearanceMm,
      targetMm,
      deficitPerSideMm: Math.max(0, targetMm - sideClearanceMm),
    },
    checks,
  };
}

function fixedBedAccess(given) {
  const roomWidthMm = finite(given, 'room_inner_width');
  const bedWidthMm = finite(given, 'bed_outer_width');
  const leftAccessMm = finite(given, 'left_access_required');
  const rightAccessMm = finite(given, 'right_access_required');
  const requiredWidthMm = bedWidthMm + leftAccessMm + rightAccessMm;
  const deficitMm = Math.max(0, requiredWidthMm - roomWidthMm);
  const fixedSubproblem = given?.clearances_are_explicit_brief_constraints === true
    && given?.bed_orientation_locked === true
    && given?.all_three_strips_parallel_and_nonoverlapping === true
    && given?.no_replacement_or_resize === true;
  const status = deficitMm > 0 ? 'fail' : 'pass';
  return proofResult(status, fixedSubproblem ? given?.proof_scope : null, deficitMm, {
    roomWidthMm, bedWidthMm, leftAccessMm, rightAccessMm, requiredWidthMm,
  });
}

function interval(box, axis, name) {
  return finitePair(box?.[axis], `${name}.${axis}`).sort((a, b) => a - b);
}

function boxIntersection(a, b, aName, bName) {
  const rawOverlapMm = {};
  const intersectionSizeMm = {};
  for (const axis of ['x', 'y', 'z']) {
    const [a0, a1] = interval(a, axis, aName);
    const [b0, b1] = interval(b, axis, bName);
    rawOverlapMm[axis] = Math.min(a1, b1) - Math.max(a0, b0);
    intersectionSizeMm[axis] = Math.max(0, rawOverlapMm[axis]);
  }
  return { rawOverlapMm, intersectionSizeMm };
}

function solidCollision(given, aKey, bKey) {
  const toleranceMm = Number(given?.allowed_contact_tolerance) || 0;
  const { rawOverlapMm, intersectionSizeMm } = boxIntersection(given?.[aKey], given?.[bKey], aKey, bKey);
  const collision = ['x', 'y', 'z'].every((axis) => rawOverlapMm[axis] > toleranceMm + EPSILON);
  const intersectionVolumeMm3 = collision
    ? intersectionSizeMm.x * intersectionSizeMm.y * intersectionSizeMm.z
    : 0;
  return {
    status: collision ? 'fail' : 'pass',
    measurements: {
      collision,
      toleranceMm,
      rawOverlapMm,
      intersectionSizeMm,
      intersectionVolumeMm3,
      zSeparationMm: Math.max(0, -rawOverlapMm.z),
    },
  };
}

function chairTuck(given) {
  const armrestBottomMm = finite(given, 'armrest_bottom_z');
  const armrestTopMm = finite(given, 'armrest_top_z');
  const apronBottomMm = finite(given, 'apron_bottom_z');
  const apronTopMm = finite(given, 'apron_top_z');
  const verticalOverlapMm = Math.max(0, Math.min(armrestTopMm, apronTopMm) - Math.max(armrestBottomMm, apronBottomMm));
  const collision = given?.horizontal_overlap_in_required_tuck_state === true && verticalOverlapMm > 0;
  return {
    status: given?.tuck_in_required_by_brief === true && collision ? 'fail' : 'pass',
    measurements: { verticalOverlapMm, collision },
  };
}

function operatorFit(given) {
  const frontToWallMm = finite(given, 'front_to_opposite_wall');
  const extensionMm = finite(given, 'drawer_extension');
  const requiredOperatorDepthMm = finite(given, 'operator_required_depth_after_drawer_front');
  const remainingDepthMm = frontToWallMm - extensionMm;
  const deficitMm = Math.max(0, requiredOperatorDepthMm - remainingDepthMm);
  return {
    status: deficitMm > 0 ? 'fail' : 'pass',
    measurements: { frontToWallMm, extensionMm, remainingDepthMm, requiredOperatorDepthMm, deficitMm },
  };
}

function timeExpandedExit(given) {
  const closedAisleMm = finite(given, 'aisle_width_closed');
  const openProjectionMm = finite(given, 'door_projection_open');
  const bodyDiameterMm = finite(given, 'agent_disk_diameter');
  const openGapMm = closedAisleMm - openProjectionMm;
  const openStateStatus = openGapMm >= bodyDiameterMm ? 'pass' : 'fail';
  const closedStateStatus = closedAisleMm >= bodyDiameterMm ? 'pass' : 'fail';
  const transitionVerified = given?.agent_can_reach_handle_without_collision === true
    && given?.safe_closing_motion_verified === true
    && given?.active_profile_allows_closure_before_operational_exit === true
    && given?.route_is_not_a_required_clear_egress_strip === true
    && given?.no_other_obstacles === true;
  let status = 'unknown';
  if (closedStateStatus === 'fail') status = 'fail';
  else if (openStateStatus === 'pass' || transitionVerified) status = 'pass';
  return {
    status,
    measurements: {
      closedAisleMm,
      openProjectionMm,
      bodyDiameterMm,
      openGapMm,
      openStateStatus,
      closedStateStatus,
      transitionVerified,
      acceptedSequence: status === 'pass' && openStateStatus === 'fail' ? ['close', 'pass'] : ['pass'],
    },
  };
}

function robustClearance(given) {
  const measuredGapMm = finite(given, 'measured_gap_g');
  const errorBoundMm = finite(given, 'combined_error_bound_e');
  const thresholdMm = finite(given, 'required_threshold');
  const lowerMm = measuredGapMm - errorBoundMm;
  const upperMm = measuredGapMm + errorBoundMm;
  let status = 'unknown';
  if (lowerMm >= thresholdMm) status = 'pass';
  else if (upperMm < thresholdMm) status = 'fail';
  return {
    status,
    measurements: {
      measuredGapMm,
      errorBoundMm,
      thresholdMm,
      intervalMm: [lowerMm, upperMm],
      worstCaseMarginMm: lowerMm - thresholdMm,
    },
  };
}

function fixedEdgeSeats(given) {
  const availableLengthMm = finite(given, 'available_straight_edge_length');
  const seatCount = finite(given, 'required_seat_count_on_this_edge');
  const frontagePerSeatMm = finite(given, 'explicit_brief_frontage_per_seat');
  const requiredLengthMm = seatCount * frontagePerSeatMm;
  const deficitMm = Math.max(0, requiredLengthMm - availableLengthMm);
  const fixedSubproblem = given?.overlap_between_intervals_allowed === false
    && given?.end_seats_or_other_edges_allowed === false
    && given?.table_resize_allowed === false;
  return proofResult(deficitMm > 0 ? 'fail' : 'pass', fixedSubproblem ? given?.proof_scope : null, deficitMm, {
    availableLengthMm, seatCount, frontagePerSeatMm, requiredLengthMm,
  });
}

function twoCabinets(given) {
  const nicheWidthMm = finite(given, 'niche_clear_width');
  if (!Array.isArray(given?.cabinet_outer_widths) || given.cabinet_outer_widths.length !== 2) {
    throw new TypeError('cabinet_outer_widths должен содержать две ширины');
  }
  const cabinetWidthsMm = given.cabinet_outer_widths.map((value, index) => {
    const width = Number(value);
    if (!Number.isFinite(width)) throw new TypeError(`cabinet_outer_widths[${index}] должен быть числом`);
    return width;
  });
  const requiredWidthMm = cabinetWidthsMm.reduce((sum, value) => sum + value, 0);
  const deficitMm = Math.max(0, requiredWidthMm - nicheWidthMm);
  const fixedSubproblem = given?.single_row_required === true
    && given?.overlap_allowed === false
    && given?.rotation_resize_replacement_allowed === false;
  return proofResult(deficitMm > 0 ? 'fail' : 'pass', fixedSubproblem ? given?.proof_scope : null, deficitMm, {
    nicheWidthMm, cabinetWidthsMm, requiredWidthMm,
  });
}

function uprightHeight(given) {
  const floorZMm = finite(given, 'finished_floor_z');
  const ceilingZMm = finite(given, 'ceiling_z');
  const cabinetHeightMm = finite(given, 'rigid_cabinet_outer_height');
  const availableHeightMm = ceilingZMm - floorZMm;
  const deficitMm = Math.max(0, cabinetHeightMm - availableHeightMm);
  const fixedSubproblem = given?.upright_orientation_required === true
    && given?.floor_and_ceiling_locked === true
    && given?.resize_or_recess_allowed === false;
  return proofResult(deficitMm > 0 ? 'fail' : 'pass', fixedSubproblem ? given?.proof_scope : null, deficitMm, {
    floorZMm, ceilingZMm, availableHeightMm, cabinetHeightMm,
  });
}

function erodeRectangle(rectangle, radiusMm) {
  if (!Array.isArray(rectangle) || rectangle.length !== 4) throw new TypeError('Прямоугольник должен иметь четыре координаты');
  const [x0, y0, x1, y1] = rectangle.map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite)) throw new TypeError('Координаты прямоугольника должны быть числами');
  const eroded = [Math.min(x0, x1) + radiusMm, Math.min(y0, y1) + radiusMm,
    Math.max(x0, x1) - radiusMm, Math.max(y0, y1) - radiusMm];
  return eroded[0] <= eroded[2] && eroded[1] <= eroded[3] ? eroded : null;
}

function segmentIntervalInRectangle(start, end, rectangle) {
  let lower = 0;
  let upper = 1;
  for (const [axis, minIndex, maxIndex] of [[0, 0, 2], [1, 1, 3]]) {
    const origin = start[axis];
    const delta = end[axis] - origin;
    const min = rectangle[minIndex];
    const max = rectangle[maxIndex];
    if (Math.abs(delta) <= EPSILON) {
      if (origin < min - EPSILON || origin > max + EPSILON) return null;
      continue;
    }
    const a = (min - origin) / delta;
    const b = (max - origin) / delta;
    lower = Math.max(lower, Math.min(a, b));
    upper = Math.min(upper, Math.max(a, b));
    if (lower > upper + EPSILON) return null;
  }
  return [Math.max(0, lower), Math.min(1, upper)];
}

function segmentCoveredByUnion(start, end, rectangles) {
  const intervals = rectangles
    .map((rectangle) => segmentIntervalInRectangle(start, end, rectangle))
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  if (!intervals.length || intervals[0][0] > EPSILON) return false;
  let coveredUntil = intervals[0][1];
  for (const [from, to] of intervals.slice(1)) {
    if (from > coveredUntil + EPSILON) return false;
    coveredUntil = Math.max(coveredUntil, to);
  }
  return coveredUntil >= 1 - EPSILON;
}

function polylineCoveredByUnion(polyline, rectangles) {
  if (!Array.isArray(polyline) || polyline.length < 2) return false;
  const points = polyline.map((point, index) => finitePair(point, `polyline[${index}]`));
  for (let index = 1; index < points.length; index += 1) {
    if (!segmentCoveredByUnion(points[index - 1], points[index], rectangles)) return false;
  }
  return true;
}

function pointInUnion(point, rectangles) {
  return rectangles.some(([x0, y0, x1, y1]) => point[0] >= Math.min(x0, x1) - EPSILON
    && point[0] <= Math.max(x0, x1) + EPSILON
    && point[1] >= Math.min(y0, y1) - EPSILON
    && point[1] <= Math.max(y0, y1) + EPSILON);
}

function candidatePath(given) {
  const radiusMm = finite(given, 'agent_disk_diameter') / 2;
  if (!Array.isArray(given?.walkable_union_rectangles)) throw new TypeError('walkable_union_rectangles должен быть массивом');
  const erodedRectangles = given.walkable_union_rectangles.map((rectangle) => erodeRectangle(rectangle, radiusMm)).filter(Boolean);
  const shortcut = given?.invalid_shortcut;
  const polyline = given?.valid_polyline;
  const shortcutValid = polylineCoveredByUnion(shortcut, erodedRectangles);
  const polylineValid = polylineCoveredByUnion(polyline, erodedRectangles);
  const shortcutStart = finitePair(shortcut?.[0], 'invalid_shortcut[0]');
  const shortcutEnd = finitePair(shortcut?.[shortcut.length - 1], 'invalid_shortcut[last]');
  const shortcutMidpointMm = [
    (shortcutStart[0] + shortcutEnd[0]) / 2,
    (shortcutStart[1] + shortcutEnd[1]) / 2,
  ];
  const checks = [
    { id: 'shortcut_candidate', severity: 'hard', status: shortcutValid ? 'pass' : 'fail' },
    { id: 'polyline_candidate', severity: 'hard', status: polylineValid ? 'pass' : 'fail' },
  ];
  return {
    status: mixedStatus(checks),
    measurements: {
      radiusMm,
      erodedRectangles,
      shortcutValid,
      polylineValid,
      shortcutMidpointMm,
      shortcutMidpointOnWalkableFloor: pointInUnion(shortcutMidpointMm, given.walkable_union_rectangles),
    },
    checks,
  };
}

function bunkMattress(given) {
  const maximumThicknessMm = finite(given, 'manufacturer_max_mattress_thickness');
  const selectedThicknessMm = finite(given, 'selected_mattress_thickness');
  const excessMm = Math.max(0, selectedThicknessMm - maximumThicknessMm);
  if (given?.bunk_model_manual_verified !== true) {
    return { status: 'unknown', measurements: { maximumThicknessMm, selectedThicknessMm, excessMm } };
  }
  return {
    status: excessMm > 0 ? 'fail' : 'pass',
    measurements: { maximumThicknessMm, selectedThicknessMm, excessMm },
  };
}

function explicitBooleans(given, keys) {
  return keys.every((key) => typeof given?.[key] === 'boolean');
}

function solarGlare(given) {
  const missingInputs = [];
  if (given?.north == null) missingInputs.push('north');
  if (given?.location_known !== true) missingInputs.push('location');
  if (given?.window_geometry_known !== true) missingInputs.push('window_geometry');
  if (missingInputs.length > 0) {
    return {
      status: 'unknown',
      measurements: {
        solarGlareVerified: false,
        missingInputs,
        assumedPlanNorth: given?.plan_top_is_assumed_north === true,
      },
    };
  }
  if (typeof given?.solar_glare_clear === 'boolean') {
    return {
      status: given.solar_glare_clear ? 'pass' : 'fail',
      measurements: { solarGlareVerified: true, missingInputs },
    };
  }
  return { status: 'unknown', measurements: { solarGlareVerified: false, missingInputs: ['solar_glare_result'] } };
}

function adaRouteWidth(given) {
  const enabled = given?.accessibility_ada_reference?.enabled;
  if (enabled === false) {
    return {
      status: 'not_applicable',
      measurements: {
        profileEnabled: false,
        localRegulatoryProfile: given?.local_regulatory_profile ?? null,
        geometryChecksRemainEnabled: given?.geometry_checks_enabled === true,
      },
    };
  }
  if (enabled !== true || typeof given?.ada_route_width_valid !== 'boolean') {
    return { status: 'unknown', measurements: { profileEnabled: enabled ?? null } };
  }
  return { status: given.ada_route_width_valid ? 'pass' : 'fail', measurements: { profileEnabled: true } };
}

function adaWidthException(given) {
  const profile = given?.accessibility_ada_reference || {};
  if (profile.enabled === false) return { status: 'not_applicable', measurements: { profileEnabled: false } };
  if (profile.enabled !== true || profile.scope_verified !== true) {
    return { status: 'unknown', measurements: { profileEnabled: profile.enabled ?? null, scopeVerified: false } };
  }
  const belowMinimum = given?.route_width_relation === 'below_ACC002_minimum';
  const exceptionConditionsMet = given?.all_ACC004_short_narrowing_conditions_met;
  const noOtherException = given?.no_other_applicable_exception_verified;
  let status = 'unknown';
  if (!belowMinimum) status = 'pass';
  else if (exceptionConditionsMet === true) status = 'pass';
  else if (exceptionConditionsMet === false && noOtherException === true) status = 'fail';
  return {
    status,
    measurements: { profileEnabled: true, scopeVerified: true, belowMinimum, exceptionConditionsMet, noOtherException },
  };
}

function regulatoryApplicability(given) {
  const textVerified = given?.regulatory_text_verified === true;
  const scopeVerified = given?.building_scope_verified === true;
  const status = textVerified && scopeVerified ? 'pass' : 'unknown';
  return {
    status,
    measurements: {
      projectCountry: given?.project_country ?? null,
      textVerified,
      scopeVerified,
      profileStatus: status === 'pass' ? 'verified' : 'pending_external_validation',
    },
  };
}

function saunaKeepout(given) {
  if (given?.heater_present === false) return { status: 'not_applicable', measurements: { heaterPresent: false } };
  const missingInputs = [];
  if (given?.model_id == null) missingInputs.push('model_id');
  if (given?.installation_manual == null) missingInputs.push('installation_manual');
  if (given?.proposed_bench_geometry_known !== true) missingInputs.push('bench_geometry');
  if (missingInputs.length > 0) {
    return {
      status: 'unknown',
      measurements: { reason: 'needs_model_data', readiness: 'preliminary_only', missingInputs },
    };
  }
  if (typeof given?.thermal_keepout_verified === 'boolean') {
    return { status: given.thermal_keepout_verified ? 'pass' : 'fail', measurements: { missingInputs } };
  }
  return { status: 'unknown', measurements: { reason: 'missing_keepout_result', missingInputs: ['thermal_keepout_result'] } };
}

function poolBarrier(given) {
  if (given?.pool_barrier_design_verified !== true || given?.active_barrier_profile_has_no_climb_zone !== true) {
    return { status: 'unknown', measurements: { verifiedNoClimbZone: false } };
  }
  if (!explicitBooleans(given, ['chair_is_climbable', 'chair_intersects_verified_no_climb_zone'])) {
    return { status: 'unknown', measurements: { verifiedNoClimbZone: true } };
  }
  const violation = given.chair_is_climbable && given.chair_intersects_verified_no_climb_zone;
  return {
    status: violation ? 'fail' : 'pass',
    measurements: { verifiedNoClimbZone: true, chairClimbable: given.chair_is_climbable, intersectsZone: given.chair_intersects_verified_no_climb_zone },
  };
}

function floorSupport(given) {
  if (given?.object_type !== 'floor_standing_armchair') {
    return { status: 'unknown', measurements: { supportedObjectType: false } };
  }
  if (!explicitBooleans(given, ['object_support_polygon_inside_void', 'bridge_or_slab_present'])) {
    return { status: 'unknown', measurements: { floorId: given?.floor_id ?? null } };
  }
  const unsupported = given.object_support_polygon_inside_void && !given.bridge_or_slab_present;
  return {
    status: unsupported ? 'fail' : 'pass',
    measurements: {
      floorId: given.floor_id,
      supportInsideVoid: given.object_support_polygon_inside_void,
      supportSurfacePresent: given.bridge_or_slab_present,
      lowerFloorDoesNotProvideSupport: given?.lower_floor_visible_below === true,
    },
  };
}

function sequentialOverlap(given) {
  const keys = [
    'two_cabinet_operator_zones_overlap', 'same_person_uses_one_cabinet_at_a_time',
    'door_sweeps_do_not_hit_fixed_objects', 'required_exit_remains_available', 'profile_prohibits_overlap',
  ];
  if (!explicitBooleans(given, keys)) return { status: 'unknown', measurements: { concurrencyVerified: false } };
  const pass = !given.two_cabinet_operator_zones_overlap || (
    given.same_person_uses_one_cabinet_at_a_time
    && given.door_sweeps_do_not_hit_fixed_objects
    && given.required_exit_remains_available
    && !given.profile_prohibits_overlap
  );
  return {
    status: pass ? 'pass' : 'fail',
    measurements: {
      zonesOverlap: given.two_cabinet_operator_zones_overlap,
      useMode: given.same_person_uses_one_cabinet_at_a_time ? 'sequential' : 'concurrent_or_unknown',
      exitAvailable: given.required_exit_remains_available,
      profileProhibitsOverlap: given.profile_prohibits_overlap,
    },
  };
}

function simultaneousReachOverlap(given) {
  const keys = [
    'abstract_reach_zones_overlap', 'actual_body_and_hand_trajectories_verified_disjoint',
    'both_actors_have_required_resources', 'normative_reserved_zones_violated',
  ];
  if (!explicitBooleans(given, keys)) return { status: 'unknown', measurements: { kinematicsVerified: false } };
  const pass = (!given.abstract_reach_zones_overlap || given.actual_body_and_hand_trajectories_verified_disjoint)
    && given.both_actors_have_required_resources
    && !given.normative_reserved_zones_violated;
  return {
    status: pass ? 'pass' : 'fail',
    measurements: {
      reachZonesOverlap: given.abstract_reach_zones_overlap,
      trajectoriesDisjoint: given.actual_body_and_hand_trajectories_verified_disjoint,
      resourcesAvailable: given.both_actors_have_required_resources,
      reservedZoneViolation: given.normative_reserved_zones_violated,
    },
  };
}

function bunkCompatibility(given) {
  if (given?.bunk_present === false) return { status: 'not_applicable', measurements: { bunkPresent: false } };
  const planDimensionsStatus = given?.mattress_plan_dimensions_match === true ? 'pass'
    : given?.mattress_plan_dimensions_match === false ? 'fail' : 'unknown';
  const missingInputs = [];
  if (given?.manufacturer_mattress_limits == null) missingInputs.push('manufacturer_mattress_limits');
  if (given?.guardrail_configuration_verified !== true) missingInputs.push('guardrail_configuration');
  if (given?.mattress_thickness_known !== true) missingInputs.push('mattress_thickness');
  if (planDimensionsStatus === 'fail') {
    return { status: 'fail', measurements: { planDimensionsStatus, missingInputs } };
  }
  if (missingInputs.length > 0 || typeof given?.model_compatibility_verified !== 'boolean') {
    return { status: 'unknown', measurements: { planDimensionsStatus, missingInputs } };
  }
  return {
    status: given.model_compatibility_verified ? 'pass' : 'fail',
    measurements: { planDimensionsStatus, missingInputs },
  };
}

function upperBunkEligibility(given) {
  if (given?.upper_bunk_proposed === false) return { status: 'not_applicable', measurements: { upperBunkProposed: false } };
  const missingInputs = [];
  if (given?.child_age == null || !Number.isFinite(Number(given.child_age))) missingInputs.push('child_age');
  if (given?.manufacturer_age_limit_known !== true) missingInputs.push('manufacturer_age_limit');
  if (missingInputs.length > 0 || typeof given?.age_requirement_met !== 'boolean') {
    return { status: 'unknown', measurements: { eligible: null, missingInputs } };
  }
  return {
    status: given.age_requirement_met ? 'pass' : 'fail',
    measurements: { eligible: given.age_requirement_met, missingInputs },
  };
}

function solverConclusion(given) {
  if (given?.feasible_candidate_found === true) {
    return { status: 'pass', solverStatus: 'feasible', measurements: { conclusionSupported: true } };
  }
  if (given?.search_budget_exhausted === true) {
    return {
      status: 'unknown',
      solverStatus: 'search_budget_exhausted',
      measurements: {
        conclusionSupported: false,
        infeasibilityCertificatePresent: given?.mathematical_infeasibility_certificate != null,
        completeEnumerationDone: given?.complete_enumeration_done === true,
      },
    };
  }
  return { status: 'unknown', solverStatus: 'not_run', measurements: { conclusionSupported: false } };
}

function evidenceClassification(given) {
  const promotesGuidelineToLaw = given?.source_kind === 'professional_guideline'
    && given?.declared_output_basis === 'mandatory_Kyrgyzstan_law';
  if (!promotesGuidelineToLaw) {
    return { status: 'pass', measurements: { correctedBasis: given?.declared_output_basis ?? null } };
  }
  if (given?.local_adoption_verified == null) {
    return { status: 'unknown', measurements: { correctedBasis: 'published_guideline', localAdoptionVerified: null } };
  }
  return {
    status: given.local_adoption_verified ? 'pass' : 'fail',
    measurements: {
      sourceKind: given.source_kind,
      declaredBasis: given.declared_output_basis,
      correctedBasis: given.local_adoption_verified ? given.declared_output_basis : 'published_guideline',
      localAdoptionVerified: given.local_adoption_verified,
    },
  };
}

function mandatoryWorkTriangle(given) {
  if (given?.triangle_is_explicit_requirement === false) {
    return {
      status: 'not_applicable',
      measurements: {
        kitchenTopology: given?.kitchen_topology ?? null,
        workflowVerified: given?.workflow_scenarios_verified === true,
        physicalChecksPass: given?.physical_and_appliance_checks_pass === true,
      },
    };
  }
  if (given?.triangle_is_explicit_requirement !== true || typeof given?.work_triangle_verified !== 'boolean') {
    return { status: 'unknown', measurements: { kitchenTopology: given?.kitchen_topology ?? null } };
  }
  return { status: given.work_triangle_verified ? 'pass' : 'fail', measurements: { kitchenTopology: given.kitchen_topology } };
}

function scoringSemantics(given) {
  const keys = ['added_objects_have_no_requested_function', 'added_objects_reduce_route_quality', 'universal_coverage_target_has_no_source_or_brief'];
  if (!explicitBooleans(given, keys)) return { status: 'unknown', measurements: { scoringEvidenceComplete: false } };
  const invalidGain = given.added_objects_have_no_requested_function
    && given.added_objects_reduce_route_quality
    && given.claimed_quality_gain_reason === 'furniture_coverage_ratio_increased'
    && given.universal_coverage_target_has_no_source_or_brief;
  return {
    status: invalidGain ? 'fail' : 'pass',
    measurements: {
      invalidGain,
      claimedGainReason: given?.claimed_quality_gain_reason ?? null,
      usefulFunctionAdded: !given.added_objects_have_no_requested_function,
      routeQualityReduced: given.added_objects_reduce_route_quality,
    },
  };
}

function screenGlare(given) {
  const missingInputs = [];
  if (given?.sun_orientation_unknown === true) missingInputs.push('sun_orientation');
  if (given?.screen_reflection_model_missing === true) missingInputs.push('screen_reflection_model');
  if (given?.shading_state_unknown === true) missingInputs.push('shading_state');
  if (missingInputs.length > 0 || typeof given?.glare_simulation_pass !== 'boolean') {
    return {
      status: 'unknown',
      measurements: {
        orientationHeuristicStatus: given?.screen_plane_perpendicular_to_window === true ? 'pass' : 'unknown',
        glareVerified: false,
        missingInputs,
      },
    };
  }
  return { status: given.glare_simulation_pass ? 'pass' : 'fail', measurements: { glareVerified: true, missingInputs } };
}

function taskIlluminance(given) {
  const missingInputs = [];
  if (given?.luminous_flux_unknown === true) missingInputs.push('luminous_flux');
  if (given?.photometric_distribution_unknown === true) missingInputs.push('photometric_distribution');
  if (given?.surface_reflectance_unknown === true) missingInputs.push('surface_reflectance');
  if (missingInputs.length > 0 || typeof given?.task_illuminance_meets_target !== 'boolean') {
    return {
      status: 'unknown',
      measurements: { lightingVerified: false, reason: 'insufficient_photometry', missingInputs },
    };
  }
  return {
    status: given.task_illuminance_meets_target ? 'pass' : 'fail',
    measurements: { lightingVerified: true, missingInputs },
  };
}

function soundIsolation(given) {
  const missingInputs = [];
  if (given?.wall_construction_unknown === true) missingInputs.push('wall_construction');
  if (given?.junctions_unknown === true) missingInputs.push('junctions');
  if (given?.source_noise_spectrum_unknown === true) missingInputs.push('source_noise_spectrum');
  if (missingInputs.length > 0 || typeof given?.sound_isolation_meets_target !== 'boolean') {
    return {
      status: 'unknown',
      measurements: {
        soundIsolationVerified: false,
        decorOnlyClaimRejected: given?.claimed_stc_or_rw_from_decor_only === true,
        missingInputs,
      },
    };
  }
  return {
    status: given.sound_isolation_meets_target ? 'pass' : 'fail',
    measurements: { soundIsolationVerified: true, missingInputs },
  };
}

function windowEgress(given) {
  if (given?.window_exists === false) return { status: 'not_applicable', measurements: { windowExists: false } };
  const missingInputs = [];
  if (given?.clear_opening_known !== true) missingInputs.push('clear_opening');
  if (given?.opening_mode_known !== true) missingInputs.push('opening_mode');
  if (given?.external_escape_continuation_known !== true) missingInputs.push('external_escape_continuation');
  if (missingInputs.length > 0 || typeof given?.egress_profile_pass !== 'boolean') {
    return {
      status: 'unknown',
      measurements: {
        egressEdgeStatus: 'unverified',
        mayBeUsedAsConfirmedExit: false,
        onlyBackupExitAssumed: given?.solver_uses_window_as_only_backup_exit === true,
        missingInputs,
      },
    };
  }
  return {
    status: given.egress_profile_pass ? 'pass' : 'fail',
    measurements: { egressEdgeStatus: 'verified', mayBeUsedAsConfirmedExit: given.egress_profile_pass, missingInputs },
  };
}

function curtainCollision(given) {
  if (given?.curtain_closing_is_required === false) return { status: 'not_applicable', measurements: { closingRequired: false } };
  if (given?.validated_curtain_and_bed_geometry !== true
      || typeof given?.curtain_closed_swept_volume_intersects_bed_frame !== 'boolean') {
    return { status: 'unknown', measurements: { geometryVerified: false } };
  }
  const collision = given.curtain_closed_swept_volume_intersects_bed_frame;
  return {
    status: collision ? 'fail' : 'pass',
    measurements: {
      geometryVerified: true,
      openStateStatus: given?.curtain_open_state_clear === true ? 'pass' : 'unknown',
      closedStateStatus: collision ? 'fail' : 'pass',
      collision,
    },
  };
}

function softPreferenceTradeoff(given) {
  if (!explicitBooleans(given, ['privacy_soft_target_met', 'daylight_soft_target_met', 'geometry_constraints_pass'])) {
    return { status: 'unknown', measurements: { preferenceResultsComplete: false } };
  }
  if (!given.geometry_constraints_pass) {
    return { status: 'fail', measurements: { geometryStatus: 'fail' } };
  }
  const checks = [
    { id: 'privacy_soft_target', severity: 'soft', status: given.privacy_soft_target_met ? 'pass' : 'fail' },
    { id: 'daylight_soft_target', severity: 'soft', status: given.daylight_soft_target_met ? 'pass' : 'fail' },
  ];
  return {
    status: mixedStatus(checks),
    measurements: {
      geometryStatus: 'pass',
      activeLegalLightRequirement: given?.no_active_legal_light_requirement_evaluated_here === false,
      selectedPriority: given?.user_selected_priority ?? null,
    },
    checks,
  };
}

function validationCache(given) {
  if (given?.pendant_serves_table === false) return { status: 'not_applicable', measurements: { dependencyActive: false } };
  if (given?.table_pose_revision == null || given?.lighting_check_table_pose_revision == null
      || given?.dependency_tracking_enabled !== true) {
    return { status: 'unknown', measurements: { dependencyActive: true, cacheFresh: null } };
  }
  const cacheFresh = given.table_pose_revision === given.lighting_check_table_pose_revision;
  return {
    status: cacheFresh ? 'pass' : 'fail',
    measurements: {
      tablePoseRevision: given.table_pose_revision,
      checkedPoseRevision: given.lighting_check_table_pose_revision,
      cacheFresh,
      dependentMetricsStatus: cacheFresh ? 'current' : 'unknown_until_recalculated',
    },
  };
}

function serviceAccess(given) {
  const keys = [
    'panel_is_designed_removable', 'manufacturer_service_sequence_verified',
    'removal_tool_and_operator_volume_clear', 'removed_panel_has_safe_temporary_location',
    'destructive_demolition_required',
  ];
  if (!explicitBooleans(given, keys)) return { status: 'unknown', measurements: { sequenceVerified: false } };
  const pass = given.panel_is_designed_removable
    && given.manufacturer_service_sequence_verified
    && given.removal_tool_and_operator_volume_clear
    && given.removed_panel_has_safe_temporary_location
    && !given.destructive_demolition_required;
  return {
    status: pass ? 'pass' : 'fail',
    measurements: {
      sequenceVerified: pass,
      destructiveDemolitionRequired: given.destructive_demolition_required,
      acceptedSequence: pass ? ['remove_panel', 'service', 'replace_panel'] : null,
    },
  };
}

function garageTailgate(given) {
  if (given?.brief_requires_inside_unloading === false) {
    const outsideScenarioVerified = given?.confirmed_unloading_location === 'driveway'
      && given?.outdoor_tailgate_and_carry_route_verified === true
      && given?.inside_garage_parked_state_does_not_require_open_tailgate === true;
    return {
      status: outsideScenarioVerified ? 'not_applicable' : 'unknown',
      measurements: { insideScenarioRequired: false, outsideScenarioVerified },
    };
  }
  if (given?.brief_requires_inside_unloading !== true || typeof given?.inside_tailgate_sequence_verified !== 'boolean') {
    return { status: 'unknown', measurements: { insideScenarioRequired: given?.brief_requires_inside_unloading ?? null } };
  }
  return { status: given.inside_tailgate_sequence_verified ? 'pass' : 'fail', measurements: { insideScenarioRequired: true } };
}

function laundryTemporalOverlap(given) {
  const keys = [
    'drying_rack_deployed_blocks_machine_operator_zone', 'drying_and_machine_loading_are_explicitly_nonconcurrent',
    'safe_rack_fold_and_storage_sequence_verified', 'required_exit_remains_clear',
    'simultaneous_loading_not_required_by_brief',
  ];
  if (!explicitBooleans(given, keys)) return { status: 'unknown', measurements: { sequenceVerified: false } };
  const pass = (!given.drying_rack_deployed_blocks_machine_operator_zone || (
    given.drying_and_machine_loading_are_explicitly_nonconcurrent
    && given.safe_rack_fold_and_storage_sequence_verified
    && given.simultaneous_loading_not_required_by_brief
  )) && given.required_exit_remains_clear;
  return {
    status: pass ? 'pass' : 'fail',
    measurements: {
      rackBlocksOperatorZone: given.drying_rack_deployed_blocks_machine_operator_zone,
      useMode: given.drying_and_machine_loading_are_explicitly_nonconcurrent ? 'sequential' : 'concurrent',
      sequenceVerified: given.safe_rack_fold_and_storage_sequence_verified,
      exitClear: given.required_exit_remains_clear,
    },
  };
}

function mandatoryFunctionCoverage(given) {
  if (given?.required_functions_may_be_dropped === true) {
    return { status: 'not_applicable', measurements: { mandatory: false } };
  }
  if (!Array.isArray(given?.required_functions) || !Array.isArray(given?.placed_objects)) {
    return { status: 'unknown', measurements: { mandatory: true } };
  }
  const provided = new Set(given.placed_objects.flatMap((object) => Array.isArray(object?.functions) ? object.functions : []));
  const missingFunctions = given.required_functions.filter((functionId) => !provided.has(functionId));
  return {
    status: missingFunctions.length > 0 ? 'fail' : 'pass',
    measurements: {
      requiredFunctions: [...given.required_functions],
      providedFunctions: [...provided],
      missingFunctions,
      routeScoreIgnoredForCoverage: given?.route_score_is_high === true,
    },
  };
}

function independentBedAccess(given) {
  if (given?.two_sleepers === false || given?.independent_access_required_by_brief === false) {
    return { status: 'not_applicable', measurements: { independentAccessRequired: false } };
  }
  const keys = ['two_sleepers', 'independent_access_required_by_brief', 'first_sleeper_has_valid_path',
    'second_sleeper_only_path_crosses_occupied_mattress', 'alternative_path_verified_absent_in_this_layout'];
  if (!explicitBooleans(given, keys)) return { status: 'unknown', measurements: { independentAccessRequired: true } };
  const secondPathInvalid = given.second_sleeper_only_path_crosses_occupied_mattress
    && given.alternative_path_verified_absent_in_this_layout;
  const pass = given.first_sleeper_has_valid_path && !secondPathInvalid;
  return {
    status: pass ? 'pass' : 'fail',
    measurements: {
      independentAccessRequired: true,
      firstSleeperPathStatus: given.first_sleeper_has_valid_path ? 'pass' : 'fail',
      secondSleeperPathStatus: secondPathInvalid ? 'fail' : 'pass',
      occupiedMattressIsNotRoute: true,
    },
  };
}

function installationReadiness(given) {
  const geometryStatus = typeof given?.furniture_collision_checks_pass === 'boolean'
    ? (given.furniture_collision_checks_pass ? 'pass' : 'fail') : 'unknown';
  const connectionsStatus = typeof given?.fixed_connection_regions_respected === 'boolean'
    ? (given.fixed_connection_regions_respected ? 'pass' : 'fail') : 'unknown';
  const gasStatus = given?.gas_installation_project_missing === true ? 'unknown'
    : typeof given?.gas_installation_verified === 'boolean' ? (given.gas_installation_verified ? 'pass' : 'fail') : 'unknown';
  const hoodStatus = given?.hood_and_combustion_interaction_unverified === true ? 'unknown'
    : typeof given?.hood_combustion_verified === 'boolean' ? (given.hood_combustion_verified ? 'pass' : 'fail') : 'unknown';
  const profileStatus = given?.local_regulatory_profile_pending === true ? 'unknown'
    : typeof given?.local_regulatory_profile_verified === 'boolean' ? (given.local_regulatory_profile_verified ? 'pass' : 'fail') : 'unknown';
  const checks = [
    { id: 'furniture_geometry', severity: 'hard', status: geometryStatus },
    { id: 'fixed_connection_regions', severity: 'hard', status: connectionsStatus },
    { id: 'gas_installation', severity: 'hard', status: gasStatus },
    { id: 'hood_combustion_interaction', severity: 'hard', status: hoodStatus },
    { id: 'local_regulatory_profile', severity: 'hard', status: profileStatus },
  ];
  return {
    status: mixedStatus(checks),
    measurements: {
      geometryVerified: geometryStatus === 'pass' && connectionsStatus === 'pass',
      gasAndVentilationStatus: gasStatus === 'pass' && hoodStatus === 'pass' ? 'verified' : 'unknown',
      constructionApproved: checks.every((entry) => entry.status === 'pass'),
    },
    checks,
  };
}

const EVALUATORS = Object.freeze({
  'ACCEPT-001': unitConversion,
  'ACCEPT-002': duplicateUnitConversion,
  'ACCEPT-003': diskConfigurationSpace,
  'ACCEPT-004': fixedPortal,
  'ACCEPT-005': seatingClearance,
  'ACCEPT-006': bedSideClearances,
  'ACCEPT-007': fixedBedAccess,
  'ACCEPT-008': (given) => solidCollision(given, 'a_box', 'b_box'),
  'ACCEPT-009': (given) => solidCollision(given, 'seat_box', 'tabletop_box'),
  'ACCEPT-010': chairTuck,
  'ACCEPT-011': operatorFit,
  'ACCEPT-012': timeExpandedExit,
  'ACCEPT-013': robustClearance,
  'ACCEPT-014': robustClearance,
  'ACCEPT-015': robustClearance,
  'ACCEPT-016': fixedEdgeSeats,
  'ACCEPT-017': twoCabinets,
  'ACCEPT-018': uprightHeight,
  'ACCEPT-019': candidatePath,
  'ACCEPT-020': bunkMattress,
  'ACCEPT-021': solarGlare,
  'ACCEPT-022': adaRouteWidth,
  'ACCEPT-023': adaWidthException,
  'ACCEPT-024': regulatoryApplicability,
  'ACCEPT-025': saunaKeepout,
  'ACCEPT-026': poolBarrier,
  'ACCEPT-027': floorSupport,
  'ACCEPT-028': sequentialOverlap,
  'ACCEPT-029': simultaneousReachOverlap,
  'ACCEPT-030': bunkCompatibility,
  'ACCEPT-031': upperBunkEligibility,
  'ACCEPT-032': solverConclusion,
  'ACCEPT-033': evidenceClassification,
  'ACCEPT-034': mandatoryWorkTriangle,
  'ACCEPT-035': scoringSemantics,
  'ACCEPT-036': screenGlare,
  'ACCEPT-037': taskIlluminance,
  'ACCEPT-038': soundIsolation,
  'ACCEPT-039': windowEgress,
  'ACCEPT-040': curtainCollision,
  'ACCEPT-041': softPreferenceTradeoff,
  'ACCEPT-042': validationCache,
  'ACCEPT-043': serviceAccess,
  'ACCEPT-044': garageTailgate,
  'ACCEPT-045': laundryTemporalOverlap,
  'ACCEPT-046': mandatoryFunctionCoverage,
  'ACCEPT-047': independentBedAccess,
  'ACCEPT-048': installationReadiness,
});

// Вход: ID ACCEPT-001…048 и объект given из ACCEPTANCE_CASES_RU.json.
// Выход: статус проверяемой метрики и воспроизводимые промежуточные значения.
export function evaluateRuleAcceptance(caseId, given) {
  const spec = SPEC_BY_ID.get(caseId);
  if (!spec) throw new Error(`Неизвестный численный acceptance-кейс: ${caseId}`);
  const evaluated = EVALUATORS[caseId](given);
  return {
    caseId,
    evaluatedMetric: spec.evaluatedMetric,
    scope: ACCEPTANCE_RESULT_SCOPE,
    ...evaluated,
  };
}

export function evaluateRuleAcceptanceBatch(cases) {
  if (!Array.isArray(cases)) throw new TypeError('cases должен быть массивом');
  return cases.map((entry) => evaluateRuleAcceptance(entry.id, entry.given));
}

// Детерминированная оркестрация сценариев пакета правил.
//
// Сценарий запускается только при explicit selection `enabled: true`.
// Декларативные description/condition/check не исполняются и не могут сами
// дать pass. Проверка метрики выполняется только через явную привязку:
//
//   context.scenarioEvaluatorBindings[scenarioId][checkId] = {
//     evaluator: 'polygon_validity', input: { ... }
//   }
//
// Более общие bindings можно положить в context.evaluatorBindings. Внешние
// реализации передаются штатно через context.evaluatorAdapters evaluator API.
// Для states/concurrency ожидаются явные runtime-данные в
// context.scenarioContexts[scenarioId].

import {
  LAYOUT_SCENARIOS,
} from './layout-knowledge.generated.js';
import {
  evaluateLayoutEvaluator,
  layoutEvaluatorById,
} from './layout-evaluators.js';

export const SCENARIO_ACTIVATION = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
  UNSELECTED: 'unselected',
  UNKNOWN: 'unknown',
});

export const SCENARIO_RESULT_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNKNOWN: 'unknown',
  NOT_APPLICABLE: 'not_applicable',
});

export const SCENARIO_EVIDENCE_TYPES = Object.freeze([
  'computed',
  'source_lookup',
  'external_report',
  'manual_verified',
]);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Boolean(object) && Object.hasOwn(object, key);
const stringValue = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const snakeToCamel = (value) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

function issue(kind, scenarioId, fieldPath, reason, scope = 'required') {
  return { kind, scenarioId, fieldPath, reason, scope };
}

function normalizedArguments(brief, project, context) {
  if (project == null && isObject(brief) && (own(brief, 'brief') || own(brief, 'context'))) {
    return {
      brief: brief.brief ?? brief.project?.layoutBrief ?? null,
      project: brief.project ?? null,
      context: isObject(brief.context) ? brief.context : {},
    };
  }
  return {
    brief: brief ?? project?.layoutBrief ?? null,
    project: project ?? null,
    context: isObject(context) ? context : {},
  };
}

function selectionSource(brief, project, context) {
  const candidates = [
    [context, 'scenarioSelections', 'context.scenarioSelections'],
    [context, 'scenario_selections', 'context.scenario_selections'],
    [brief, 'scenarioSelections', 'brief.scenarioSelections'],
    [brief, 'scenario_selections', 'brief.scenario_selections'],
    [project?.layoutBrief, 'scenarioSelections', 'project.layoutBrief.scenarioSelections'],
    [project?.layoutBrief, 'scenario_selections', 'project.layoutBrief.scenario_selections'],
    [project, 'scenarioSelections', 'project.scenarioSelections'],
    [project, 'scenario_selections', 'project.scenario_selections'],
  ];
  for (const [object, key, source] of candidates) {
    if (own(object, key)) return { raw: object[key], source };
  }
  return { raw: [], source: 'none' };
}

function selectionEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return [];
  return Object.entries(raw).map(([scenarioId, value]) => {
    if (typeof value === 'boolean' || value == null) return { scenarioId, enabled: value };
    return isObject(value) ? { ...value, scenarioId: value.scenarioId ?? value.scenario_id ?? scenarioId } : { scenarioId, enabled: null };
  });
}

function normalizeSelection(raw, index) {
  const source = isObject(raw) ? raw : {};
  return {
    index,
    scenarioId: stringValue(source.scenarioId ?? source.scenario_id ?? source.templateId ?? source.template_id ?? source.id),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : null,
    mandatory: typeof source.mandatory === 'boolean' ? source.mandatory : null,
    actorPersonIds: Array.isArray(source.actorPersonIds ?? source.actor_person_ids)
      ? [...new Set((source.actorPersonIds ?? source.actor_person_ids).map(stringValue).filter(Boolean))]
      : null,
    frequencyValue: source.frequencyValue ?? source.frequency_value ?? null,
    frequencyPeriod: source.frequencyPeriod ?? source.frequency_period ?? null,
    sourceId: stringValue(source.sourceId ?? source.source_id),
    raw: source,
  };
}

/**
 * Нормализовать только явные scenario selections.
 *
 * Возвращает все 20 сценариев в стабильном порядке. Наличие данных в доме не
 * включает сценарий автоматически. Дубликат выбора считается неоднозначным.
 */
export function activateLayoutScenarios(brief = null, project = null, context = {}) {
  const args = normalizedArguments(brief, project, context);
  const selected = selectionSource(args.brief, args.project, args.context);
  const entries = selectionEntries(selected.raw).map(normalizeSelection);
  const knownIds = new Set(LAYOUT_SCENARIOS.map((scenario) => scenario.scenario_id));
  const byId = new Map();
  const unresolvedInputs = [];

  for (const entry of entries) {
    if (!entry.scenarioId || !knownIds.has(entry.scenarioId)) {
      unresolvedInputs.push(issue(
        'scenario_selection', entry.scenarioId, `${selected.source}[${entry.index}]`,
        entry.scenarioId ? `Неизвестный scenario_id: ${entry.scenarioId}` : 'В выборе нет scenario_id',
      ));
      continue;
    }
    const list = byId.get(entry.scenarioId) || [];
    list.push(entry);
    byId.set(entry.scenarioId, list);
  }

  const scenarios = LAYOUT_SCENARIOS.map((definition) => {
    const choices = byId.get(definition.scenario_id) || [];
    if (!choices.length) return {
      scenarioId: definition.scenario_id,
      coreRuleId: definition.core_rule_id,
      title: definition.title,
      activation: SCENARIO_ACTIVATION.UNSELECTED,
      mandatory: null,
      selection: null,
      definition,
    };
    if (choices.length > 1) {
      unresolvedInputs.push(issue(
        'scenario_selection', definition.scenario_id, selected.source,
        `Для ${definition.scenario_id} задано несколько выборов`,
      ));
      return {
        scenarioId: definition.scenario_id,
        coreRuleId: definition.core_rule_id,
        title: definition.title,
        activation: SCENARIO_ACTIVATION.UNKNOWN,
        mandatory: null,
        selection: null,
        definition,
      };
    }
    const selection = choices[0];
    let activation = selection.enabled === true
      ? SCENARIO_ACTIVATION.ACTIVE
      : selection.enabled === false ? SCENARIO_ACTIVATION.DISABLED : SCENARIO_ACTIVATION.UNKNOWN;
    if (selection.enabled === false && selection.mandatory === true) {
      activation = SCENARIO_ACTIVATION.UNKNOWN;
      unresolvedInputs.push(issue(
        'scenario_selection', definition.scenario_id, selected.source,
        'mandatory=true конфликтует с enabled=false',
      ));
    }
    if (selection.enabled == null) unresolvedInputs.push(issue(
      'scenario_selection', definition.scenario_id, `${selected.source}.enabled`,
      'enabled должен быть явно true или false',
    ));
    if (activation === SCENARIO_ACTIVATION.ACTIVE && selection.mandatory == null) unresolvedInputs.push(issue(
      'scenario_selection', definition.scenario_id, `${selected.source}.mandatory`,
      'mandatory не подтвержден для включенного сценария',
    ));
    return {
      scenarioId: definition.scenario_id,
      coreRuleId: definition.core_rule_id,
      title: definition.title,
      activation,
      mandatory: selection.mandatory,
      selection,
      definition,
    };
  });

  return {
    source: selected.source,
    scenarios,
    active: scenarios.filter((entry) => entry.activation === SCENARIO_ACTIVATION.ACTIVE),
    disabled: scenarios.filter((entry) => entry.activation === SCENARIO_ACTIVATION.DISABLED),
    unknown: scenarios.filter((entry) => entry.activation === SCENARIO_ACTIVATION.UNKNOWN),
    unresolvedInputs,
  };
}

function hasKnownValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return true; // [] означает подтверждённое отсутствие, не unknown.
  if (isObject(value)) return Object.values(value).some(hasKnownValue);
  return true;
}

function pathValue(root, segments) {
  let value = root;
  for (const segment of segments) {
    if (!isObject(value) && !Array.isArray(value)) return undefined;
    if (own(value, segment)) value = value[segment];
    else {
      const camel = snakeToCamel(segment);
      if (!own(value, camel)) return undefined;
      value = value[camel];
    }
  }
  return value;
}

function projectLevels(project) {
  return Array.isArray(project?.levels) ? project.levels : [];
}

function projectRooms(project) {
  const levels = projectLevels(project);
  if (levels.length) return levels.flatMap((level) => level.rooms || []);
  return Array.isArray(project?.rooms) ? project.rooms : [];
}

function projectItems(project) {
  const levels = projectLevels(project);
  if (levels.length) return levels.flatMap((level) => level.items || []);
  return Array.isArray(project?.items) ? project.items : [];
}

function projectOpenings(project) {
  const levels = projectLevels(project);
  if (levels.length) return levels.flatMap((level) => level.openings || []);
  return Array.isArray(project?.openings) ? project.openings : [];
}

function aliasValue(fieldPath, brief, project) {
  const aliases = {
    'brief.household.members': () => brief?.actors,
    'brief.storage_inventory.items': () => brief?.storageInventory,
    'brief.engineering.points_and_equipment': () => brief?.fixedEngineering,
    'brief.engineering': () => brief?.fixedEngineering,
    'brief.capacity_targets.daily_dining_seats': () => brief?.capacity?.dailySeats,
    'brief.furniture_and_procurement.existing_items': () => projectItems(project),
    'brief.building.openings': () => projectOpenings(project),
    'brief.building.rooms': () => projectRooms(project),
    'brief.building': () => (projectLevels(project).length || projectRooms(project).length ? project : undefined),
    'brief.site_and_light': () => project?.site,
  };
  return aliases[fieldPath]?.();
}

function resolveRequiredInput(fieldPath, brief, project, context) {
  for (const source of [context.inputValues, context.requiredInputs]) {
    if (own(source, fieldPath)) return { known: hasKnownValue(source[fieldPath]), value: source[fieldPath], source: 'context' };
  }
  const segments = fieldPath.split('.');
  const direct = segments[0] === 'brief'
    ? pathValue(brief, segments.slice(1))
    : pathValue({ brief, project, context }, segments);
  if (hasKnownValue(direct)) return { known: true, value: direct, source: 'brief' };
  const aliased = aliasValue(fieldPath, brief, project);
  return { known: hasKnownValue(aliased), value: aliased, source: hasKnownValue(aliased) ? 'model_alias' : 'missing' };
}

function taskDependencies(scenario) {
  const tasks = scenario.tasks || [];
  const taskById = new Map(tasks.map((task) => [task.task_id, task]));
  const issues = [];
  if (taskById.size !== tasks.length) issues.push('Повторяются task_id');
  for (const task of tasks) for (const dependency of task.depends_on || []) {
    if (!taskById.has(dependency)) issues.push(`${task.task_id}: неизвестная зависимость ${dependency}`);
  }
  for (const group of scenario.concurrency?.required_parallel_task_groups || []) {
    for (const taskId of group.task_ids || []) if (!taskById.has(taskId)) issues.push(`Concurrency: неизвестная задача ${taskId}`);
  }

  const order = [];
  const permanent = new Set();
  const temporary = new Set();
  const visit = (id) => {
    if (permanent.has(id)) return;
    if (temporary.has(id)) { issues.push(`Циклическая зависимость у ${id}`); return; }
    temporary.add(id);
    for (const dependency of taskById.get(id)?.depends_on || []) if (taskById.has(dependency)) visit(dependency);
    temporary.delete(id);
    permanent.add(id);
    order.push(id);
  };
  for (const task of tasks) visit(task.task_id);

  const states = new Set((scenario.required_states || []).map((state) => state.state_id));
  for (const route of scenario.route_pairs || []) for (const stateId of route.state_ids || []) {
    if (!states.has(stateId)) issues.push(`${route.route_id}: неизвестное состояние ${stateId}`);
  }
  for (const group of scenario.concurrency?.mutually_exclusive_state_groups || []) for (const stateId of group) {
    if (!states.has(stateId)) issues.push(`Mutex: неизвестное состояние ${stateId}`);
  }
  return { status: issues.length ? 'fail' : 'pass', order, issues };
}

function scenarioRuntime(context, scenarioId) {
  return context.scenarioContexts?.[scenarioId]
    || context.scenarioRuntime?.[scenarioId]
    || context.scenarios?.[scenarioId]
    || {};
}

function statusOfVerification(binding) {
  if (binding === true) return 'pass';
  if (binding === false) return 'fail';
  if (!isObject(binding)) return 'unknown';
  if (['pass', 'fail', 'unknown', 'not_applicable'].includes(binding.status)) return binding.status;
  if (binding.verified === true) return 'pass';
  if (binding.verified === false) return 'fail';
  return 'unknown';
}

function stateChecks(scenario, runtime, context) {
  const stateBindings = runtime.states || context.scenarioStates?.[scenario.scenario_id]
    || context.stateBindings?.[scenario.scenario_id] || {};
  return (scenario.required_states || []).map((state) => {
    const binding = own(stateBindings, state.state_id) ? stateBindings[state.state_id] : null;
    const status = statusOfVerification(binding);
    return {
      stateId: state.state_id,
      status,
      binding,
      reason: status === 'unknown' ? 'Нет явной проверенной привязки состояния' : '',
    };
  });
}

function parallelBinding(bindings, group, index) {
  if (Array.isArray(bindings)) return bindings[index];
  if (!isObject(bindings)) return undefined;
  for (const key of [`parallel-${index + 1}`, String(index), (group.task_ids || []).join('+')]) {
    if (own(bindings, key)) return bindings[key];
  }
  return undefined;
}

function concurrencyChecks(scenario, runtime, context) {
  const concurrency = runtime.concurrency || context.scenarioConcurrency?.[scenario.scenario_id] || {};
  const parallelBindings = concurrency.parallelGroups ?? runtime.parallelGroups;
  const results = (scenario.concurrency?.required_parallel_task_groups || []).map((group, index) => {
    const binding = parallelBinding(parallelBindings, group, index);
    if (isObject(binding) && binding.applicable === false) return {
      kind: 'parallel', index, taskIds: [...group.task_ids], status: 'not_applicable', binding, reason: '',
    };
    const status = statusOfVerification(binding);
    return {
      kind: 'parallel', index, taskIds: [...group.task_ids], status, binding,
      reason: status === 'unknown' ? 'Условие одновременности не подтверждено явно' : '',
    };
  });

  const activeStateIds = concurrency.activeStateIds ?? runtime.activeStateIds;
  for (const [index, group] of (scenario.concurrency?.mutually_exclusive_state_groups || []).entries()) {
    let status = 'unknown';
    if (Array.isArray(activeStateIds)) status = group.filter((stateId) => activeStateIds.includes(stateId)).length <= 1 ? 'pass' : 'fail';
    results.push({
      kind: 'mutually_exclusive_states', index, stateIds: [...group], status,
      reason: status === 'unknown' ? 'Не задан явный набор активных состояний' : '',
    });
  }
  return results;
}

function bindingFromMap(map, check) {
  if (!isObject(map)) return undefined;
  if (own(map, check.check_id)) return map[check.check_id];
  return undefined;
}

function evaluatorBinding(context, runtime, scenarioId, check) {
  const maps = [
    runtime.evaluatorBindings,
    context.scenarioEvaluatorBindings?.[scenarioId],
    context.evaluatorBindings?.[scenarioId],
    context.evaluatorBindings,
  ];
  for (const map of maps) {
    const binding = bindingFromMap(map, check);
    if (binding !== undefined) return binding;
  }
  return undefined;
}

function unknownCheck(check, reason, source = 'unbound_metric', evaluatorId = null, missingInputs = []) {
  return {
    checkId: check.check_id,
    metricId: check.metric_id,
    ruleRefs: [...(check.rule_refs || [])],
    status: 'unknown',
    evaluatorId,
    source,
    output: {},
    missingInputs,
    evidenceType: null,
    evidenceReference: null,
    reason,
  };
}

function checkEvidence(binding, result) {
  const evidence = isObject(binding.evidence) ? binding.evidence : {};
  const output = isObject(result.output) ? result.output : {};
  const evidenceType = stringValue(
    binding.evidenceType ?? binding.evidence_type ?? binding.source
      ?? evidence.type ?? output.evidenceType ?? output.evidence_type
      ?? (SCENARIO_EVIDENCE_TYPES.includes(result.source) ? result.source : null),
  );
  const evidenceReference = stringValue(
    binding.evidenceReference ?? binding.evidence_reference
      ?? evidence.reference ?? output.evidenceReference ?? output.evidence_reference,
  );
  return {
    evidenceType,
    evidenceReference,
    valid: SCENARIO_EVIDENCE_TYPES.includes(evidenceType) && Boolean(evidenceReference),
  };
}

function evaluateCheck(check, scenarioId, runtime, context) {
  const rawBinding = evaluatorBinding(context, runtime, scenarioId, check);
  if (rawBinding === undefined) return unknownCheck(check, `Нет evaluator binding для ${check.metric_id}`);
  const binding = typeof rawBinding === 'string' ? { evaluator: rawBinding } : rawBinding;
  if (!isObject(binding)) return unknownCheck(check, 'Некорректный evaluator binding', 'invalid_binding');
  const evaluatorId = stringValue(binding.evaluator ?? binding.evaluatorId);
  if (!evaluatorId || !layoutEvaluatorById(evaluatorId)) {
    return unknownCheck(check, evaluatorId ? `Неизвестный evaluator: ${evaluatorId}` : 'В binding нет evaluator', 'invalid_binding', evaluatorId);
  }
  const scenarioInputs = context.scenarioEvaluatorInputs?.[scenarioId];
  const input = isObject(binding.input ?? binding.inputs)
    ? (binding.input ?? binding.inputs)
    : scenarioInputs?.[evaluatorId] ?? context.evaluatorInputs?.[evaluatorId] ?? {};
  try {
    const result = evaluateLayoutEvaluator(evaluatorId, input, context);
    const evidence = checkEvidence(binding, result);
    const evaluated = {
      checkId: check.check_id,
      metricId: check.metric_id,
      ruleRefs: [...(check.rule_refs || [])],
      status: result.status,
      evaluatorId,
      source: result.source,
      output: result.output,
      missingInputs: [...result.missingInputs],
      evidenceType: evidence.evidenceType,
      evidenceReference: evidence.evidenceReference,
      reason: result.reason,
    };
    if ((result.status === 'pass' || result.status === 'fail') && !evidence.valid) return {
      ...evaluated,
      status: 'unknown',
      originalStatus: result.status,
      source: 'missing_evidence',
      reason: 'Результат evaluator не имеет разрешённого evidence type и непустой evidenceReference',
    };
    return evaluated;
  } catch (error) {
    return unknownCheck(check, `Ошибка evaluator «${evaluatorId}»: ${error.message}`, 'evaluator_error', evaluatorId);
  }
}

function aggregateStatus(statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('unknown')) return 'unknown';
  const applicable = statuses.filter((status) => status !== 'not_applicable');
  return applicable.length ? 'pass' : 'not_applicable';
}

function inactiveScenario(entry, activationIssues) {
  const status = entry.activation === SCENARIO_ACTIVATION.DISABLED ? 'not_applicable' : 'unknown';
  return {
    scenarioId: entry.scenarioId,
    coreRuleId: entry.coreRuleId,
    title: entry.title,
    activation: entry.activation,
    mandatory: entry.mandatory,
    status,
    readiness: status === 'not_applicable' ? 'not_applicable' : 'pending',
    blocking: false,
    comfortStatus: 'not_applicable',
    taskOrder: [],
    dependencyResult: { status: 'not_applicable', order: [], issues: [] },
    stateResults: [],
    concurrencyResults: [],
    requiredResults: [],
    comfortResults: [],
    unresolvedInputs: activationIssues,
  };
}

function evaluateActiveScenario(entry, brief, project, context, activationIssues) {
  const scenario = entry.definition;
  const runtime = scenarioRuntime(context, entry.scenarioId);
  const unresolvedInputs = [...activationIssues];
  const dependencyResult = taskDependencies(scenario);
  if (dependencyResult.status === 'fail') for (const reason of dependencyResult.issues) unresolvedInputs.push(issue(
    'task_dependency', entry.scenarioId, 'tasks', reason,
  ));

  for (const required of scenario.missing_inputs || []) {
    const resolved = resolveRequiredInput(required.field_path, brief, project, context);
    if (!resolved.known) unresolvedInputs.push(issue(
      'required_input', entry.scenarioId, required.field_path, required.reason, required.blocking_scope || 'required',
    ));
  }

  const stateResults = stateChecks(scenario, runtime, context);
  for (const state of stateResults) if (state.status === 'unknown') unresolvedInputs.push(issue(
    'state', entry.scenarioId, `states.${state.stateId}`, state.reason,
  ));
  const concurrencyResults = concurrencyChecks(scenario, runtime, context);
  for (const result of concurrencyResults) if (result.status === 'unknown') unresolvedInputs.push(issue(
    'concurrency', entry.scenarioId,
    result.kind === 'parallel' ? `concurrency.parallel-${result.index + 1}` : `concurrency.mutex-${result.index + 1}`,
    result.reason,
  ));

  const requiredResults = (scenario.required_checks || []).map((check) => evaluateCheck(check, entry.scenarioId, runtime, context));
  const comfortResults = (scenario.comfort_checks || []).map((check) => evaluateCheck(check, entry.scenarioId, runtime, context));
  for (const result of requiredResults) {
    if (result.status !== 'unknown') continue;
    unresolvedInputs.push(issue(
      result.source === 'missing_evidence' ? 'evidence' : result.missingInputs.length ? 'evaluator_input' : 'evaluator_binding',
      entry.scenarioId, `checks.${result.checkId}`,
      result.reason || `Проверка ${result.metricId} не вычислена`,
    ));
  }
  for (const result of comfortResults) {
    if (result.status !== 'unknown') continue;
    unresolvedInputs.push(issue(
      result.missingInputs.length ? 'evaluator_input' : 'evaluator_binding',
      entry.scenarioId, `checks.${result.checkId}`,
      result.reason || `Проверка ${result.metricId} не вычислена`, 'comfort',
    ));
  }

  const requiredStatuses = [
    dependencyResult.status,
    ...stateResults.map((result) => result.status),
    ...concurrencyResults.map((result) => result.status),
    ...requiredResults.map((result) => result.status),
  ];
  if (!requiredResults.length) {
    requiredStatuses.push('unknown');
    unresolvedInputs.push(issue(
      'required_checks', entry.scenarioId, 'required_checks',
      'Пустой required report не может считаться pass',
    ));
  }
  if (unresolvedInputs.some((entryIssue) => entryIssue.scope !== 'comfort')) requiredStatuses.push('unknown');
  const status = aggregateStatus(requiredStatuses);
  return {
    scenarioId: entry.scenarioId,
    coreRuleId: entry.coreRuleId,
    title: entry.title,
    activation: entry.activation,
    mandatory: entry.mandatory,
    status,
    readiness: status === 'pass' ? 'ready' : status === 'fail' ? 'failed' : 'pending',
    blocking: entry.mandatory === true && status === 'fail',
    comfortStatus: aggregateStatus(comfortResults.map((result) => result.status)),
    taskOrder: dependencyResult.order,
    dependencyResult,
    stateResults,
    concurrencyResults,
    requiredResults,
    comfortResults,
    unresolvedInputs,
  };
}

/**
 * Оценить явно активированные сценарии.
 *
 * Результат содержит все 20 сценариев: disabled имеет not_applicable,
 * unselected и неоднозначная активация — unknown. Ни одна строка из
 * declarative specification не используется как исполняемая проверка.
 */
export function evaluateLayoutScenarios(brief = null, project = null, context = {}) {
  const args = normalizedArguments(brief, project, context);
  const activation = activateLayoutScenarios(args.brief, args.project, args.context);
  const activationIssuesById = new Map();
  for (const entry of activation.unresolvedInputs) {
    const list = activationIssuesById.get(entry.scenarioId) || [];
    list.push(entry);
    activationIssuesById.set(entry.scenarioId, list);
  }
  const scenarios = activation.scenarios.map((entry) => {
    const activationIssues = activationIssuesById.get(entry.scenarioId) || [];
    return entry.activation === SCENARIO_ACTIVATION.ACTIVE
      ? evaluateActiveScenario(entry, args.brief, args.project, args.context, activationIssues)
      : inactiveScenario(entry, activationIssues);
  });
  const activeScenarios = scenarios.filter((entry) => entry.activation === SCENARIO_ACTIVATION.ACTIVE);
  const unresolvedInputs = [
    ...activation.unresolvedInputs.filter((entry) => !entry.scenarioId || !activation.scenarios.some((scenario) => scenario.scenarioId === entry.scenarioId)),
    ...scenarios.flatMap((entry) => entry.unresolvedInputs),
  ];
  const byStatus = {};
  for (const scenario of scenarios) byStatus[scenario.status] = (byStatus[scenario.status] || 0) + 1;
  const activeByStatus = {};
  for (const scenario of activeScenarios) activeByStatus[scenario.status] = (activeByStatus[scenario.status] || 0) + 1;
  const mandatoryScenarios = activeScenarios.filter((entry) => entry.mandatory === true);
  const mandatoryFailed = mandatoryScenarios.filter((entry) => entry.status === 'fail').map((entry) => entry.scenarioId);
  const mandatoryUnknown = mandatoryScenarios.filter((entry) => entry.status === 'unknown').map((entry) => entry.scenarioId);
  const mandatoryUndetermined = activeScenarios.filter((entry) => entry.mandatory == null).map((entry) => entry.scenarioId);
  const mandatoryStatus = !activeScenarios.length || !mandatoryScenarios.length
    ? 'unknown'
    : mandatoryFailed.length ? 'fail'
      : mandatoryUndetermined.length || mandatoryUnknown.length ? 'unknown' : 'pass';
  const overallStatus = !activeScenarios.length
    ? 'unknown'
    : mandatoryFailed.length ? 'fail'
      : mandatoryUnknown.length || mandatoryUndetermined.length || activeScenarios.some((entry) => entry.status === 'unknown')
        ? 'unknown'
        : activeScenarios.every((entry) => entry.status === 'pass') ? 'pass' : 'unknown';
  return {
    activation,
    scenarios,
    activeScenarios,
    unresolvedInputs,
    summary: {
      total: scenarios.length,
      active: activeScenarios.length,
      byStatus,
      activeByStatus,
      failed: activeScenarios.filter((entry) => entry.status === 'fail').map((entry) => entry.scenarioId),
      unknown: activeScenarios.filter((entry) => entry.status === 'unknown').map((entry) => entry.scenarioId),
      overallStatus,
      readiness: overallStatus === 'pass' ? 'ready' : overallStatus === 'fail' ? 'failed' : 'pending',
      mandatory: {
        total: mandatoryScenarios.length,
        status: mandatoryStatus,
        failed: mandatoryFailed,
        unknown: mandatoryUnknown,
        undetermined: mandatoryUndetermined,
      },
      feasible: activeScenarios.every((entry) => entry.status !== 'fail'),
      verified: activeScenarios.length > 0 && activeScenarios.every((entry) => entry.status === 'pass'),
    },
  };
}

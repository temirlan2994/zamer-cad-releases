// Детерминированный импорт сценариев, профилей и evaluator-контрактов.
//
//   node scripts/import-layout-knowledge.mjs
//   node scripts/import-layout-knowledge.mjs /path/to/v1 [output.js]
//
// Исходные документы входят в runtime-модуль без смысловой интерпретации:
// specification_only не превращается в реализованный evaluator.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_KNOWLEDGE_INPUT_DIR = resolve(ROOT, 'data/furniture-rules/v1');
export const DEFAULT_KNOWLEDGE_OUTPUT = resolve(ROOT, 'core/layout-knowledge.generated.js');

export const KNOWLEDGE_FILES = Object.freeze({
  scenarios: 'SCENARIO_LIBRARY_RU.json',
  profiles: 'PROFILES_RU.json',
  evaluators: 'EVALUATORS_RU.json',
});

export const EXPECTED_KNOWLEDGE_COUNTS = Object.freeze({
  scenarios: 20,
  profiles: 6,
  evaluators: 23,
});

export const EXPECTED_EVALUATOR_KIND_COUNTS = Object.freeze({
  deterministic_geometry: 15,
  simulation: 1,
  external_calculation: 2,
  catalog_and_geometry: 1,
  manufacturer_or_external: 1,
  profile_engine: 1,
  orchestration: 1,
  optimisation: 1,
});

function countBy(values, keyOf) {
  const result = {};
  for (const value of values) {
    const key = keyOf(value);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function assertUnique(values, keyOf, label) {
  const keys = values.map(keyOf);
  if (new Set(keys).size !== keys.length) throw new Error(`${label}: повторяющиеся ID`);
}

function assertExactCounts(actual, expected, label) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label}: набор ключей ${actualKeys.join(', ')} вместо ${expectedKeys.join(', ')}`);
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) throw new Error(`${label}.${key}: ${actual[key]} вместо ${expected[key]}`);
  }
}

function validateScenarios(document) {
  const scenarios = document?.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length !== EXPECTED_KNOWLEDGE_COUNTS.scenarios) {
    throw new Error(`scenarios: ${scenarios?.length ?? 'нет'} вместо 20`);
  }
  if (document.scenario_count !== scenarios.length) throw new Error('scenario_count не совпадает с массивом scenarios');
  assertUnique(scenarios, (scenario) => scenario.scenario_id, 'scenarios');
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    const expectedId = `SCN${String(index + 1).padStart(3, '0')}`;
    if (scenario.scenario_id !== expectedId || scenario.core_rule_id !== expectedId) {
      throw new Error(`scenarios[${index}]: ожидался ${expectedId}`);
    }
    if (scenario.status !== 'specification_only') throw new Error(`${expectedId}: неожиданный status`);
    if (scenario.enabled !== null || scenario.mandatory !== null) {
      throw new Error(`${expectedId}: шаблон не должен придумывать активацию`);
    }
    const tasks = new Set((scenario.tasks || []).map((task) => task.task_id));
    const states = new Set((scenario.required_states || []).map((state) => state.state_id));
    if (tasks.size !== (scenario.tasks || []).length) throw new Error(`${expectedId}: повтор task_id`);
    if (states.size !== (scenario.required_states || []).length) throw new Error(`${expectedId}: повтор state_id`);
    for (const task of scenario.tasks || []) {
      for (const dependency of task.depends_on || []) {
        if (!tasks.has(dependency)) throw new Error(`${expectedId}: неизвестная задача ${dependency}`);
      }
    }
    for (const route of scenario.route_pairs || []) {
      for (const stateId of route.state_ids || []) {
        if (!states.has(stateId)) throw new Error(`${expectedId}: неизвестное состояние ${stateId}`);
      }
    }
  }
}

function validateProfiles(document) {
  const profiles = document?.profiles;
  if (!Array.isArray(profiles) || profiles.length !== EXPECTED_KNOWLEDGE_COUNTS.profiles) {
    throw new Error(`profiles: ${profiles?.length ?? 'нет'} вместо 6`);
  }
  assertUnique(profiles, (profile) => profile.id, 'profiles');
  const ids = new Set(profiles.map((profile) => profile.id));
  for (const id of document.active_by_default || []) {
    if (!ids.has(id)) throw new Error(`active_by_default: неизвестный профиль ${id}`);
  }
  const weights = Object.values(document.initial_score_weights || {});
  const sum = weights.reduce((total, value) => total + value, 0);
  if (!weights.length || Math.abs(sum - 1) > 1e-9) throw new Error(`initial_score_weights: сумма ${sum} вместо 1`);
  if (!Array.isArray(document.overlap_policy) || document.overlap_policy.length !== 7) {
    throw new Error('overlap_policy: ожидалось 7 записей');
  }
  if (!Array.isArray(document.six_object_envelopes) || document.six_object_envelopes.length !== 6) {
    throw new Error('six_object_envelopes: ожидалось 6 записей');
  }
}

function validateEvaluators(document) {
  const evaluators = document?.evaluators;
  if (!Array.isArray(evaluators) || evaluators.length !== EXPECTED_KNOWLEDGE_COUNTS.evaluators) {
    throw new Error(`evaluators: ${evaluators?.length ?? 'нет'} вместо 23`);
  }
  if (document.metadata?.count !== evaluators.length) throw new Error('metadata.count не совпадает с evaluators');
  assertUnique(evaluators, (evaluator) => evaluator.id, 'evaluators');
  for (const evaluator of evaluators) {
    if (evaluator.status !== 'specification_only') throw new Error(`${evaluator.id}: неожиданный status`);
    if (!Array.isArray(evaluator.required_inputs) || !Array.isArray(evaluator.returns)) {
      throw new Error(`${evaluator.id}: required_inputs/returns должны быть массивами`);
    }
  }
  assertExactCounts(
    countBy(evaluators, (evaluator) => evaluator.implementation_kind),
    EXPECTED_EVALUATOR_KIND_COUNTS,
    'evaluator implementation kinds',
  );
}

export function validateKnowledgeDocuments(documents) {
  validateScenarios(documents.scenarios);
  validateProfiles(documents.profiles);
  validateEvaluators(documents.evaluators);
  return true;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function readKnowledgeDocuments(inputDir = DEFAULT_KNOWLEDGE_INPUT_DIR) {
  const sourceTexts = {};
  const documents = {};
  for (const [key, fileName] of Object.entries(KNOWLEDGE_FILES)) {
    const text = readFileSync(join(inputDir, fileName), 'utf8');
    sourceTexts[key] = text;
    documents[key] = JSON.parse(text);
  }
  return { documents, sourceTexts };
}

export function generateKnowledgeModule(documents, sourceTexts) {
  validateKnowledgeDocuments(documents);
  const provenance = {
    version: '1.0.0',
    sources: Object.fromEntries(Object.entries(KNOWLEDGE_FILES).map(([key, fileName]) => [key, {
      file: `data/furniture-rules/v1/${fileName}`,
      sha256: sha256(sourceTexts[key]),
    }])),
  };
  const evaluatorKinds = countBy(documents.evaluators.evaluators, (entry) => entry.implementation_kind);
  const body = `// GENERATED FILE. DO NOT EDIT.\n// Sources: data/furniture-rules/v1/{SCENARIO_LIBRARY_RU,PROFILES_RU,EVALUATORS_RU}.json\n// Rebuild: node scripts/import-layout-knowledge.mjs\n\nfunction deepFreeze(value) {\n  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;\n  for (const child of Object.values(value)) deepFreeze(child);\n  return Object.freeze(value);\n}\n\nexport const LAYOUT_KNOWLEDGE_PROVENANCE = deepFreeze(${JSON.stringify(provenance, null, 2)});\n\nexport const LAYOUT_SCENARIO_LIBRARY = deepFreeze(${JSON.stringify(documents.scenarios, null, 2)});\nexport const LAYOUT_SCENARIOS = LAYOUT_SCENARIO_LIBRARY.scenarios;\n\nexport const LAYOUT_PROFILE_SETTINGS = deepFreeze(${JSON.stringify(documents.profiles, null, 2)});\nexport const LAYOUT_PROFILES = LAYOUT_PROFILE_SETTINGS.profiles;\n\nexport const LAYOUT_EVALUATOR_LIBRARY = deepFreeze(${JSON.stringify(documents.evaluators, null, 2)});\nexport const LAYOUT_EVALUATOR_SPECS = LAYOUT_EVALUATOR_LIBRARY.evaluators;\n\nexport const LAYOUT_KNOWLEDGE_STATS = deepFreeze(${JSON.stringify({
    scenarios: documents.scenarios.scenarios.length,
    profiles: documents.profiles.profiles.length,
    evaluators: documents.evaluators.evaluators.length,
    evaluatorKinds,
  }, null, 2)});\n\nconst SCENARIO_INDEX = new Map(LAYOUT_SCENARIOS.map((entry) => [entry.scenario_id, entry]));\nconst PROFILE_INDEX = new Map(LAYOUT_PROFILES.map((entry) => [entry.id, entry]));\nconst EVALUATOR_INDEX = new Map(LAYOUT_EVALUATOR_SPECS.map((entry) => [entry.id, entry]));\n\nexport function layoutScenarioById(id) {\n  return SCENARIO_INDEX.get(id) || null;\n}\n\nexport function layoutProfileById(id) {\n  return PROFILE_INDEX.get(id) || null;\n}\n\nexport function layoutEvaluatorById(id) {\n  return EVALUATOR_INDEX.get(id) || null;\n}\n`;
  return { body, provenance };
}

export function importLayoutKnowledge(
  inputDir = DEFAULT_KNOWLEDGE_INPUT_DIR,
  outputPath = DEFAULT_KNOWLEDGE_OUTPUT,
) {
  const { documents, sourceTexts } = readKnowledgeDocuments(inputDir);
  const generated = generateKnowledgeModule(documents, sourceTexts);
  writeFileSync(outputPath, generated.body, 'utf8');
  return {
    inputDir: resolve(inputDir),
    outputPath: resolve(outputPath),
    provenance: generated.provenance,
    counts: {
      scenarios: documents.scenarios.scenarios.length,
      profiles: documents.profiles.profiles.length,
      evaluators: documents.evaluators.evaluators.length,
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = importLayoutKnowledge(
    process.argv[2] ? resolve(process.argv[2]) : DEFAULT_KNOWLEDGE_INPUT_DIR,
    process.argv[3] ? resolve(process.argv[3]) : DEFAULT_KNOWLEDGE_OUTPUT,
  );
  console.log(`Сценарии: ${result.counts.scenarios}`);
  console.log(`Профили: ${result.counts.profiles}`);
  console.log(`Evaluator specs: ${result.counts.evaluators}`);
  console.log(`Файл: ${result.outputPath}`);
}

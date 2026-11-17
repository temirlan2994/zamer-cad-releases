import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FURNITURE_RULE_CATALOG } from '../core/layout-rule-catalog.generated.js';
import {
  LAYOUT_EVALUATOR_LIBRARY,
  LAYOUT_EVALUATOR_SPECS,
  LAYOUT_KNOWLEDGE_PROVENANCE,
  LAYOUT_KNOWLEDGE_STATS,
  LAYOUT_PROFILES,
  LAYOUT_PROFILE_SETTINGS,
  LAYOUT_SCENARIOS,
  LAYOUT_SCENARIO_LIBRARY,
  layoutEvaluatorById,
  layoutProfileById,
  layoutScenarioById,
} from '../core/layout-knowledge.generated.js';
import {
  generateKnowledgeModule,
  readKnowledgeDocuments,
  validateKnowledgeDocuments,
} from '../scripts/import-layout-knowledge.mjs';

const DATA_DIR = fileURLToPath(new URL('../data/furniture-rules/v1/', import.meta.url));
const GENERATED_PATH = fileURLToPath(new URL('../core/layout-knowledge.generated.js', import.meta.url));

const EXPECTED_HASHES = {
  scenarios: '5887dc161e947ace3ea363e71642c6bc130a88a8a49344ee652c54a256f60f7d',
  profiles: 'd18e83349735a5beb4aa4c6bc389fdf2ee34effd70213aa8cf0aec849ed10e3d',
  evaluators: '57015f43c1cbedeed2dc3423cfc74e2653a5da372bf65bdc1d99473ad126139a',
};

const EVALUATOR_KIND_COUNTS = {
  deterministic_geometry: 15,
  simulation: 1,
  external_calculation: 2,
  catalog_and_geometry: 1,
  manufacturer_or_external: 1,
  profile_engine: 1,
  orchestration: 1,
  optimisation: 1,
};

function countBy(values, keyOf) {
  const result = {};
  for (const value of values) {
    const key = keyOf(value);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

test('knowledge sources имеют фиксированные provenance checksums', () => {
  const { sourceTexts, documents } = readKnowledgeDocuments(DATA_DIR);
  for (const [key, expected] of Object.entries(EXPECTED_HASHES)) {
    assert.equal(createHash('sha256').update(sourceTexts[key]).digest('hex'), expected);
    assert.equal(LAYOUT_KNOWLEDGE_PROVENANCE.sources[key].sha256, expected);
  }
  assert.equal(LAYOUT_KNOWLEDGE_PROVENANCE.version, '1.0.0');
  assert.equal(validateKnowledgeDocuments(documents), true);
});

test('layout knowledge воспроизводится байт-в-байт', () => {
  const { documents, sourceTexts } = readKnowledgeDocuments(DATA_DIR);
  const regenerated = generateKnowledgeModule(documents, sourceTexts);
  assert.equal(regenerated.body, readFileSync(GENERATED_PATH, 'utf8'));
});

test('runtime-модуль сохраняет документы без смысловых изменений', () => {
  const { documents } = readKnowledgeDocuments(DATA_DIR);
  assert.deepEqual(LAYOUT_SCENARIO_LIBRARY, documents.scenarios);
  assert.deepEqual(LAYOUT_PROFILE_SETTINGS, documents.profiles);
  assert.deepEqual(LAYOUT_EVALUATOR_LIBRARY, documents.evaluators);
  assert.strictEqual(LAYOUT_SCENARIOS, LAYOUT_SCENARIO_LIBRARY.scenarios);
  assert.strictEqual(LAYOUT_PROFILES, LAYOUT_PROFILE_SETTINGS.profiles);
  assert.strictEqual(LAYOUT_EVALUATOR_SPECS, LAYOUT_EVALUATOR_LIBRARY.evaluators);
});

test('экспортированы 20 сценариев, 6 профилей и 23 specification-only evaluator', () => {
  assert.equal(LAYOUT_SCENARIOS.length, 20);
  assert.equal(LAYOUT_PROFILES.length, 6);
  assert.equal(LAYOUT_EVALUATOR_SPECS.length, 23);
  assert.equal(new Set(LAYOUT_SCENARIOS.map((entry) => entry.scenario_id)).size, 20);
  assert.equal(new Set(LAYOUT_PROFILES.map((entry) => entry.id)).size, 6);
  assert.equal(new Set(LAYOUT_EVALUATOR_SPECS.map((entry) => entry.id)).size, 23);
  assert.ok(LAYOUT_SCENARIOS.every((entry) => entry.status === 'specification_only'));
  assert.ok(LAYOUT_EVALUATOR_SPECS.every((entry) => entry.status === 'specification_only'));
  assert.deepEqual(countBy(LAYOUT_EVALUATOR_SPECS, (entry) => entry.implementation_kind), EVALUATOR_KIND_COUNTS);
  assert.deepEqual(LAYOUT_KNOWLEDGE_STATS, {
    scenarios: 20,
    profiles: 6,
    evaluators: 23,
    evaluatorKinds: EVALUATOR_KIND_COUNTS,
  });
});

test('lookup-функции возвращают стабильные объекты либо null', () => {
  assert.strictEqual(layoutScenarioById('SCN001'), LAYOUT_SCENARIOS[0]);
  assert.strictEqual(layoutScenarioById('SCN020'), LAYOUT_SCENARIOS[19]);
  assert.strictEqual(layoutProfileById('geometry_and_states'), LAYOUT_PROFILES[0]);
  assert.equal(layoutEvaluatorById('polygon_validity')?.implementation_kind, 'deterministic_geometry');
  assert.equal(layoutScenarioById('SCN999'), null);
  assert.equal(layoutProfileById('missing'), null);
  assert.equal(layoutEvaluatorById('missing'), null);
});

test('профильные настройки и rule references внутренне согласованы', () => {
  const profileIds = new Set(LAYOUT_PROFILES.map((entry) => entry.id));
  for (const id of LAYOUT_PROFILE_SETTINGS.active_by_default) assert.ok(profileIds.has(id), id);
  const weightSum = Object.values(LAYOUT_PROFILE_SETTINGS.initial_score_weights)
    .reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-9);

  const ruleIds = new Set(FURNITURE_RULE_CATALOG.map((rule) => rule.id));
  for (const evaluator of LAYOUT_EVALUATOR_SPECS) {
    for (const ruleId of evaluator.example_rule_ids) assert.ok(ruleIds.has(ruleId), `${evaluator.id}: ${ruleId}`);
  }
  for (const scenario of LAYOUT_SCENARIOS) {
    assert.ok(ruleIds.has(scenario.core_rule_id), `${scenario.scenario_id}: ${scenario.core_rule_id}`);
    for (const check of [...scenario.required_checks, ...scenario.comfort_checks]) {
      for (const ruleId of check.rule_refs) assert.ok(ruleIds.has(ruleId), `${check.check_id}: ${ruleId}`);
    }
  }
});

test('все экспортированные runtime-структуры глубоко заморожены', () => {
  assert.ok(Object.isFrozen(LAYOUT_SCENARIO_LIBRARY));
  assert.ok(Object.isFrozen(LAYOUT_SCENARIOS));
  assert.ok(Object.isFrozen(LAYOUT_SCENARIOS[0]));
  assert.ok(Object.isFrozen(LAYOUT_SCENARIOS[0].tasks));
  assert.ok(Object.isFrozen(LAYOUT_SCENARIOS[0].tasks[0]));
  assert.ok(Object.isFrozen(LAYOUT_PROFILE_SETTINGS));
  assert.ok(Object.isFrozen(LAYOUT_PROFILES[0]));
  assert.ok(Object.isFrozen(LAYOUT_PROFILE_SETTINGS.initial_score_weights));
  assert.ok(Object.isFrozen(LAYOUT_EVALUATOR_LIBRARY));
  assert.ok(Object.isFrozen(LAYOUT_EVALUATOR_SPECS[0].required_inputs));
});

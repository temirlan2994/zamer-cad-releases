import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FURNITURE_RULE_CATALOG,
  FURNITURE_RULE_CATALOG_METADATA,
  FURNITURE_RULE_CATALOG_STATS,
  FURNITURE_RULE_SECTIONS,
  furnitureRuleById,
} from '../core/layout-rule-catalog.generated.js';
import {
  generateCatalogModule,
  validateRulesDocument,
} from '../scripts/import-furniture-rules.mjs';

const SOURCE_PATH = fileURLToPath(new URL('../data/furniture-rules/v1/FURNITURE_RULES_RU.json', import.meta.url));
const GENERATED_PATH = fileURLToPath(new URL('../core/layout-rule-catalog.generated.js', import.meta.url));
const SOURCE_SHA256 = '9dc7b0caad47de5dedd661fcc598001d94381e212d950a1b101d3760665eda5a';

const SECTION_COUNTS = {
  IN: 22, GEO: 24, PATH: 22, ZONE: 12, SCN: 20, OPT: 18, QA: 14,
  BED: 20, WARD: 14, LIV: 18, DIN: 16, OFF: 17, CHILD: 16, GUEST: 9,
  ENTRY: 10, STORE: 10, KIT: 38, BATH: 22, LAUN: 14, SPA: 18, GAR: 10,
  TERR: 10, SERV: 8, LGT: 24, ACOU: 10, CLIM: 12, VIS: 12, PRIV: 8,
  ACC: 17, SAFE: 14, CHVOL: 8,
};

const REQUIRED_CAMEL_FIELDS = [
  'id', 'category', 'categoryCode', 'title', 'requirement', 'appliesWhen',
  'severity', 'basis', 'parameters', 'checkText', 'exceptions', 'sourceIds',
  'confidence', 'relatedRuleIds', 'version', 'missingDataResult',
];

function countBy(values, keyOf) {
  const result = {};
  for (const value of values) {
    const key = keyOf(value);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

test('канонический источник сохранен с проверенной provenance', () => {
  const sourceText = readFileSync(SOURCE_PATH, 'utf8');
  const hash = createHash('sha256').update(sourceText).digest('hex');
  assert.equal(hash, SOURCE_SHA256);
  assert.equal(FURNITURE_RULE_CATALOG_METADATA.sourceSha256, SOURCE_SHA256);
  assert.equal(FURNITURE_RULE_CATALOG_METADATA.version, '1.0.0');
  assert.equal(FURNITURE_RULE_CATALOG_METADATA.rule_count, 487);
  assert.equal(validateRulesDocument(JSON.parse(sourceText)), true);
});

test('сгенерированный каталог воспроизводится байт-в-байт', () => {
  const sourceText = readFileSync(SOURCE_PATH, 'utf8');
  const document = JSON.parse(sourceText);
  const regenerated = generateCatalogModule(document, sourceText);
  assert.equal(regenerated.body, readFileSync(GENERATED_PATH, 'utf8'));
});

test('каталог содержит 487 уникальных canonical camelCase-записей', () => {
  assert.equal(FURNITURE_RULE_CATALOG.length, 487);
  assert.equal(new Set(FURNITURE_RULE_CATALOG.map((rule) => rule.id)).size, 487);
  for (const rule of FURNITURE_RULE_CATALOG) {
    for (const field of REQUIRED_CAMEL_FIELDS) assert.ok(Object.hasOwn(rule, field), `${rule.id}: ${field}`);
    assert.match(rule.id, /^[A-Z]+[0-9]{3}$/);
    assert.equal(rule.checkFormat, 'declarative_specification');
    assert.equal(rule.implementationStatus, 'requires_evaluator_implementation');
    assert.equal(rule.missingDataResult, 'unknown');
    assert.equal(typeof rule.checkText, 'string');
    assert.ok(rule.checkText.length > 0);
    assert.ok(Object.isFrozen(rule));
    assert.ok(Object.isFrozen(rule.parameters));
  }
  assert.ok(Object.isFrozen(FURNITURE_RULE_CATALOG));
  assert.equal(furnitureRuleById('GEO001')?.categoryCode, 'GEO');
  assert.equal(furnitureRuleById('CHVOL008')?.categoryCode, 'CHVOL');
  assert.equal(furnitureRuleById('NOPE999'), null);
});

test('разделы, severity и basis совпадают с пакетом v1.0.0', () => {
  assert.equal(FURNITURE_RULE_SECTIONS.length, 31);
  assert.deepEqual(countBy(FURNITURE_RULE_CATALOG, (rule) => rule.categoryCode), SECTION_COUNTS);
  assert.deepEqual(countBy(FURNITURE_RULE_CATALOG, (rule) => rule.severity), {
    hard: 115,
    soft: 231,
    conditional_hard: 141,
  });
  assert.deepEqual(countBy(FURNITURE_RULE_CATALOG, (rule) => rule.basis), {
    derived_constraint: 207,
    design_heuristic: 186,
    manufacturer: 29,
    published_guideline: 47,
    regulation_profile: 18,
  });
  assert.deepEqual(FURNITURE_RULE_CATALOG_STATS.byCategoryCode, SECTION_COUNTS);
  assert.deepEqual(FURNITURE_RULE_CATALOG_STATS.bySeverity, {
    hard: 115,
    conditional_hard: 141,
    soft: 231,
  });
  assert.deepEqual(FURNITURE_RULE_CATALOG_STATS.byBasis, {
    derived_constraint: 207,
    design_heuristic: 186,
    manufacturer: 29,
    published_guideline: 47,
    regulation_profile: 18,
  });
});

test('все sourceIds и relatedRuleIds ссылаются на канонический пакет', () => {
  const source = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  const sourceIds = new Set(source.sources.map((entry) => entry.id));
  const ruleIds = new Set(FURNITURE_RULE_CATALOG.map((rule) => rule.id));
  for (const rule of FURNITURE_RULE_CATALOG) {
    for (const sourceId of rule.sourceIds) assert.ok(sourceIds.has(sourceId), `${rule.id}: ${sourceId}`);
    for (const relatedId of rule.relatedRuleIds) assert.ok(ruleIds.has(relatedId), `${rule.id}: ${relatedId}`);
  }
});

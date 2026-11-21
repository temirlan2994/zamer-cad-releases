// Детерминированный импорт канонического FURNITURE_RULES_RU.json в ESM-каталог.
//
//   node scripts/import-furniture-rules.mjs
//   node scripts/import-furniture-rules.mjs /path/to/FURNITURE_RULES_RU.json [output.js]
//
// Русское поле `check` остается текстом: импорт не превращает декларативную
// спецификацию в исполняемый код.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_RULE_COUNT = 487;

export const EXPECTED_SECTION_COUNTS = Object.freeze({
  IN: 22, GEO: 24, PATH: 22, ZONE: 12, SCN: 20, OPT: 18, QA: 14,
  BED: 20, WARD: 14, LIV: 18, DIN: 16, OFF: 17, CHILD: 16, GUEST: 9,
  ENTRY: 10, STORE: 10, KIT: 38, BATH: 22, LAUN: 14, SPA: 18, GAR: 10,
  TERR: 10, SERV: 8, LGT: 24, ACOU: 10, CLIM: 12, VIS: 12, PRIV: 8,
  ACC: 17, SAFE: 14, CHVOL: 8,
});

export const EXPECTED_SEVERITY_COUNTS = Object.freeze({
  hard: 115,
  conditional_hard: 141,
  soft: 231,
});

export const EXPECTED_BASIS_COUNTS = Object.freeze({
  derived_constraint: 207,
  design_heuristic: 186,
  manufacturer: 29,
  published_guideline: 47,
  regulation_profile: 18,
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_INPUT = resolve(ROOT, 'data/furniture-rules/v1/FURNITURE_RULES_RU.json');
export const DEFAULT_OUTPUT = resolve(ROOT, 'core/layout-rule-catalog.generated.js');

const REQUIRED_FIELDS = Object.freeze([
  'id', 'category', 'category_code', 'title', 'requirement', 'applies_when',
  'severity', 'basis', 'parameters', 'check', 'exceptions', 'source_ids',
  'confidence', 'related_rule_ids', 'version', 'check_format',
  'implementation_status', 'missing_data_result',
]);

function countBy(values, keyOf) {
  const result = {};
  for (const value of values) {
    const key = keyOf(value);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function assertExactCounts(actual, expected, label) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label}: набор ключей ${actualKeys.join(', ')} вместо ${expectedKeys.join(', ')}`);
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) {
      throw new Error(`${label}.${key}: ${actual[key] || 0} вместо ${expected[key]}`);
    }
  }
}

export function validateRulesDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Корень FURNITURE_RULES_RU.json должен быть объектом');
  }
  const rules = document.rules;
  if (!Array.isArray(rules) || rules.length !== EXPECTED_RULE_COUNT) {
    throw new Error(`rules: ${rules?.length ?? 'нет'} вместо ${EXPECTED_RULE_COUNT}`);
  }
  if (document.metadata?.rule_count !== EXPECTED_RULE_COUNT) {
    throw new Error(`metadata.rule_count: ${document.metadata?.rule_count ?? 'нет'}`);
  }

  const ids = new Set();
  for (const rule of rules) {
    for (const field of REQUIRED_FIELDS) {
      if (!Object.hasOwn(rule, field)) throw new Error(`${rule.id || '<без id>'}: нет поля ${field}`);
    }
    if (!/^[A-Z]+[0-9]{3}$/.test(rule.id)) throw new Error(`Некорректный ID: ${rule.id}`);
    if (ids.has(rule.id)) throw new Error(`Повтор ID: ${rule.id}`);
    ids.add(rule.id);
    for (const field of ['title', 'requirement', 'applies_when', 'check']) {
      if (typeof rule[field] !== 'string' || !rule[field].trim()) {
        throw new Error(`${rule.id}: пустое поле ${field}`);
      }
    }
    if (rule.check_format !== 'declarative_specification') {
      throw new Error(`${rule.id}: check_format должен быть declarative_specification`);
    }
    if (rule.implementation_status !== 'requires_evaluator_implementation') {
      throw new Error(`${rule.id}: неожиданный implementation_status`);
    }
    if (rule.missing_data_result !== 'unknown') {
      throw new Error(`${rule.id}: missing_data_result должен быть unknown`);
    }
  }

  assertExactCounts(countBy(rules, (rule) => rule.category_code), EXPECTED_SECTION_COUNTS, 'sections');
  assertExactCounts(countBy(rules, (rule) => rule.severity), EXPECTED_SEVERITY_COUNTS, 'severity');
  assertExactCounts(countBy(rules, (rule) => rule.basis), EXPECTED_BASIS_COUNTS, 'basis');

  if (!Array.isArray(document.sections) || document.sections.length !== Object.keys(EXPECTED_SECTION_COUNTS).length) {
    throw new Error(`sections: ${document.sections?.length ?? 'нет'} вместо 31`);
  }
  for (const section of document.sections) {
    if (EXPECTED_SECTION_COUNTS[section.code] !== section.rule_count) {
      throw new Error(`sections.${section.code}: ${section.rule_count} вместо ${EXPECTED_SECTION_COUNTS[section.code]}`);
    }
  }

  const sourceIds = new Set((document.sources || []).map((source) => source.id));
  for (const rule of rules) {
    for (const relatedId of rule.related_rule_ids) {
      if (!ids.has(relatedId)) throw new Error(`${rule.id}: неизвестное связанное правило ${relatedId}`);
    }
    for (const sourceId of rule.source_ids) {
      if (!sourceIds.has(sourceId)) throw new Error(`${rule.id}: неизвестный источник ${sourceId}`);
    }
  }
  return true;
}

function canonicalRule(rule) {
  const result = {
    id: rule.id,
    category: rule.category,
    categoryCode: rule.category_code,
    title: rule.title,
    requirement: rule.requirement,
    appliesWhen: rule.applies_when,
    severity: rule.severity,
    basis: rule.basis,
    parameters: rule.parameters,
    checkText: rule.check,
    exceptions: rule.exceptions,
    sourceIds: rule.source_ids,
    confidence: rule.confidence,
    relatedRuleIds: rule.related_rule_ids,
    version: rule.version,
    checkFormat: rule.check_format,
    implementationStatus: rule.implementation_status,
    missingDataResult: rule.missing_data_result,
  };
  if (Object.hasOwn(rule, 'severity_scope')) result.severityScope = rule.severity_scope;
  if (Object.hasOwn(rule, 'evidence_note')) result.evidenceNote = rule.evidence_note;
  return result;
}

function catalogStats(rules) {
  return {
    total: rules.length,
    sections: Object.keys(countBy(rules, (rule) => rule.categoryCode)).length,
    byCategoryCode: countBy(rules, (rule) => rule.categoryCode),
    bySeverity: countBy(rules, (rule) => rule.severity),
    byBasis: countBy(rules, (rule) => rule.basis),
    byConfidence: countBy(rules, (rule) => rule.confidence),
  };
}

export function generateCatalogModule(document, sourceText) {
  validateRulesDocument(document);
  const catalog = document.rules.map(canonicalRule);
  const hash = createHash('sha256').update(sourceText).digest('hex');
  const metadata = { ...document.metadata, sourceSha256: hash };
  const body = `// GENERATED FILE. DO NOT EDIT.\n// Source: data/furniture-rules/v1/FURNITURE_RULES_RU.json (sha256 ${hash})\n// Rebuild: node scripts/import-furniture-rules.mjs\n\nfunction deepFreeze(value) {\n  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;\n  for (const child of Object.values(value)) deepFreeze(child);\n  return Object.freeze(value);\n}\n\nexport const FURNITURE_RULE_CATALOG_METADATA = deepFreeze(${JSON.stringify(metadata, null, 2)});\n\nexport const FURNITURE_RULE_SECTIONS = deepFreeze(${JSON.stringify(document.sections, null, 2)});\n\nexport const FURNITURE_RULE_CATALOG_STATS = deepFreeze(${JSON.stringify(catalogStats(catalog), null, 2)});\n\nexport const FURNITURE_RULE_CATALOG = deepFreeze(${JSON.stringify(catalog, null, 2)});\n\nconst RULE_INDEX = new Map(FURNITURE_RULE_CATALOG.map((rule) => [rule.id, rule]));\n\nexport function furnitureRuleById(id) {\n  return RULE_INDEX.get(id) || null;\n}\n`;
  return { body, hash, catalog, metadata };
}

export function importFurnitureRules(inputPath = DEFAULT_INPUT, outputPath = DEFAULT_OUTPUT) {
  const sourceText = readFileSync(inputPath, 'utf8');
  const document = JSON.parse(sourceText);
  const generated = generateCatalogModule(document, sourceText);
  writeFileSync(outputPath, generated.body, 'utf8');
  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    hash: generated.hash,
    rules: generated.catalog.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = importFurnitureRules(
    process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT,
    process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT,
  );
  console.log(`Каталог: ${result.rules} правил`);
  console.log(`SHA-256: ${result.hash}`);
  console.log(`Файл: ${result.outputPath}`);
}

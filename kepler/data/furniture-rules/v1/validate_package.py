"""Validate this knowledge package, not furniture geometry or legal compliance.

Run: python3 validate_package.py
Optional dependency jsonschema enables full JSON Schema validation.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    errors = []
    loaded = {}
    for path in sorted(root.glob('*.json')):
        try:
            loaded[path.name] = json.loads(path.read_text(encoding='utf-8'))
        except Exception as exc:
            errors.append(f'{path.name}: JSON parse: {exc}')
    kb = loaded.get('FURNITURE_RULES_RU.json', {})
    rules = kb.get('rules', [])
    ids = [r.get('id') for r in rules]
    known = set(ids)
    source_ids = {s.get('id') for s in kb.get('sources', [])}
    if len(known) != len(ids):
        errors.append('Duplicate rule IDs.')
    if len(rules) != kb.get('metadata', {}).get('rule_count'):
        errors.append('Rule count does not match metadata.')
    for r in rules:
        if not re.fullmatch(r'[A-Z]+[0-9]{3}', r.get('id', '')):
            errors.append(f'Invalid rule ID: {r.get("id")}')
        for name in ['title', 'requirement', 'applies_when', 'check']:
            if not isinstance(r.get(name), str) or not r[name].strip():
                errors.append(f'{r.get("id")}: missing {name}')
        for src in r.get('source_ids', []):
            if src not in source_ids:
                errors.append(f'{r["id"]}: missing source {src}')
        for rid in r.get('related_rule_ids', []):
            if rid not in known:
                errors.append(f'{r["id"]}: missing related rule {rid}')
        if r.get('missing_data_result') != 'unknown':
            errors.append(f'{r["id"]}: missing-data policy must be explicit.')
    counts = Counter(r.get('category_code') for r in rules)
    for section in kb.get('sections', []):
        if counts[section['code']] != section['rule_count']:
            errors.append(f'Wrong section count: {section["code"]}')

    # Validate rule references in all supplemental artifacts.
    def walk(value, path):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ('rule_refs', 'related_rule_ids', 'example_rule_ids', 'rationale_rule_ids', 'allowed_exception_rule_ids') and isinstance(child, list):
                    for rid in child:
                        if rid not in known:
                            errors.append(f'{path}.{key}: unknown rule {rid}')
                elif key in ('rule_id', 'core_rule_id') and isinstance(child, str):
                    if child not in known:
                        errors.append(f'{path}.{key}: unknown rule {child}')
                walk(child, path + '.' + key)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk(child, f'{path}[{i}]')
    for name, data in loaded.items():
        walk(data, name)

    cases = loaded.get('ACCEPTANCE_CASES_RU.json', {}).get('cases', [])
    if len({x.get('id') for x in cases}) != len(cases):
        errors.append('Duplicate acceptance-case IDs.')
    for case in cases:
        if case.get('expected_status') not in {'pass', 'fail', 'unknown', 'not_applicable', 'mixed'}:
            errors.append(f'Invalid expected status: {case.get("id")}')

    scenarios_doc = loaded.get('SCENARIO_LIBRARY_RU.json', {})
    scenarios = scenarios_doc.get('scenarios', [])
    if len(scenarios) != scenarios_doc.get('scenario_count'):
        errors.append('Scenario count mismatch.')
    for scenario in scenarios:
        if scenario.get('enabled') is not None or scenario.get('mandatory') is not None:
            errors.append(f'{scenario.get("scenario_id")}: template must not invent activation.')
        tasks = {t['task_id'] for t in scenario.get('tasks', [])}
        states = {s['state_id'] for s in scenario.get('required_states', [])}
        for task in scenario.get('tasks', []):
            for dep in task.get('depends_on', []):
                if dep not in tasks:
                    errors.append(f'{scenario["scenario_id"]}: missing task {dep}')
        for route in scenario.get('route_pairs', []):
            for sid in route.get('state_ids', []):
                if sid not in states:
                    errors.append(f'{scenario["scenario_id"]}: missing state {sid}')

    schema_checks = 0
    schema_mode = 'skipped_missing_optional_jsonschema'
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        pass
    else:
        schema_mode = 'completed'
        for name in ['rule.schema.json', 'project_input.schema.json', 'layout_output.schema.json']:
            try:
                Draft202012Validator.check_schema(loaded[name])
            except Exception as exc:
                errors.append(f'{name}: invalid schema: {exc}')
        validator = Draft202012Validator(loaded['rule.schema.json'])
        for rule in rules:
            for error in validator.iter_errors(rule):
                errors.append(f'{rule["id"]}: {error.message}')
            schema_checks += 1
        for schema_name, data_name in [('project_input.schema.json', 'project_input.example.json'), ('layout_output.schema.json', 'layout_output.example.json')]:
            for error in Draft202012Validator(loaded[schema_name]).iter_errors(loaded[data_name]):
                errors.append(f'{data_name}: {error.message}')
            schema_checks += 1

    weights = loaded.get('PROFILES_RU.json', {}).get('initial_score_weights', {})
    if abs(sum(weights.values()) - 1.0) > 1e-9:
        errors.append('Score weights do not sum to 1.')
    result = {
        'package_integrity': 'pass' if not errors else 'fail',
        'rules': len(rules), 'sections': len(counts),
        'unique_web_sources': len({s['url'] for s in kb.get('sources', []) if s.get('url')}),
        'acceptance_specifications': len(cases), 'scenario_templates': len(scenarios),
        'schema_mode': schema_mode, 'instances_schema_checked': schema_checks,
        'geometry_solver_executed': False, 'acceptance_engine_tests_executed': False,
        'errors': errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())

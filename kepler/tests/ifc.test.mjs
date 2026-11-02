// IFC4: устойчивые GUID, строки STEP, целостность ссылок, состав модели.
// Полная проверка схемой и геометрией — scripts/check-ifc.py (IfcOpenShell).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIfc, ifcGuid, stepString } from '../core/ifc.js';
import { buildTemplate } from '../core/templates.js';

test('GUID IFC: 22 символа, набор IFC, устойчивый и разный', () => {
  const a = ifcGuid('проект|wall-1');
  assert.match(a, /^[0-3][0-9A-Za-z_$]{21}$/);
  assert.equal(ifcGuid('проект|wall-1'), a);
  assert.notEqual(ifcGuid('проект|wall-2'), a);
});

test('строки STEP: кириллица в \\X2\\, кавычки удваиваются', () => {
  assert.equal(stepString('Дом'), "'\\X2\\0414043E043C\\X0\\'");
  assert.equal(stepString("O'Neil 1"), "'O''Neil 1'");
  // К у х н я → 041A 0443 0445 043D 044F; пробел и цифра — как есть.
  assert.equal(stepString('Кухня 2'), "'\\X2\\041A04430445043D044F\\X0\\ 2'");
});

test('модель двухэтажного шаблона: состав и целостность ссылок', () => {
  const p = buildTemplate('two-storey');
  p.levels[0].items.push({ id: 'c1', kind: 'column', x: 2500, y: 2200, w: 400, h: 400, rotation: 15 });
  const { text, counts } = buildIfc(p, { timestamp: new Date('2026-11-02T00:00:00Z') });
  assert.ok(text.startsWith('ISO-10303-21;\nHEADER;'));
  assert.match(text, /FILE_SCHEMA\(\('IFC4'\)\);/);
  assert.ok(text.trimEnd().endsWith('END-ISO-10303-21;'));
  const count = (t) => (text.match(new RegExp(`=${t}\\(`, 'g')) || []).length;
  assert.equal(count('IFCBUILDINGSTOREY'), 2);
  assert.equal(count('IFCSPACE'), 11);
  assert.equal(count('IFCDOOR'), counts.doors);
  assert.equal(count('IFCWINDOW'), counts.windows);
  assert.equal(count('IFCOPENINGELEMENT'), counts.doors + counts.windows);
  assert.equal(count('IFCRELVOIDSELEMENT'), counts.doors + counts.windows);
  assert.equal(count('IFCCOLUMN'), 1);
  // Каждая ссылка #n определена; GlobalId уникальны.
  const defined = new Set([...text.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  for (const m of text.matchAll(/#(\d+)(?!=)/g)) assert.ok(defined.has(m[1]), `#${m[1]} не определена`);
  const guids = [...text.matchAll(/=IFC[A-Z]+\('([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]);
  assert.equal(new Set(guids).size, guids.length);
  // Повторный экспорт — те же GUID (устойчивость для BIM).
  assert.equal(buildIfc(p, { timestamp: new Date('2026-11-02T00:00:00Z') }).text, text);
});

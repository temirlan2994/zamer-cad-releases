import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { activateDesignVariant, createDesignVariant, deleteDesignVariant, projectForVariant, renameDesignVariant } from '../core/design-variants.js';
import { conceptQuantities, estimateConceptBudget } from '../core/concept-budget.js';

test('варианты сохраняют текущие правки, общий участок/задание и независимую геометрию после файла', () => {
  const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  p.layoutBrief = { version: 1, homeProgram: { bedroomCount: 2 }, fixedEngineering: [] };
  const b = createDesignVariant(p, 'Б'); const a = p.variants[0];
  p.rooms[0].w = 7000; p.site.north = 25; p.layoutBrief.homeProgram.bedroomCount = 3;
  activateDesignVariant(p, a.id); assert.equal(p.rooms[0].w, 5000);
  assert.equal(p.site.north, 25); assert.equal(p.layoutBrief.homeProgram.bedroomCount, 3);
  const copy = deserializeProject(serializeProject(p));
  activateDesignVariant(copy, b.id); assert.equal(copy.rooms[0].w, 7000);
  assert.equal(projectForVariant(copy, a.id).rooms[0].w, 5000);
  assert.throws(() => deleteDesignVariant(copy, b.id));
  renameDesignVariant(copy, a.id, 'А'); deleteDesignVariant(copy, a.id); assert.equal(copy.variants.length, 1);
});

test('неизвестная цена/объём не даёт ложного соответствия бюджету; нулевая введённая цена допустима', () => {
  const p = createProject(); p.concept = { budget: { target: 10000, currency: 'KGS', region: 'Бишкек', date: '2026-11-27', source: 'Предложение подрядчика', rates: { walls: 0, finish: 500 } } };
  const quantities = { foundation: null, walls: 10, slabs: 0, roof: 0, glazing: 0, doors: 0, finish: 20, engineering: 0, landscape: 0 };
  let report = estimateConceptBudget(p, { quantities });
  assert.equal(report.subtotal, 10000); assert.equal(report.targetStatus, 'unknown');
  quantities.foundation = 0; report = estimateConceptBudget(p, { quantities });
  assert.equal(report.complete, true); assert.equal(report.targetStatus, 'over');
  assert.equal(report.rows.find((r) => r.id === 'walls').status, 'priced');
});

test('геометрический объём объединённых стен и цена меняются при расширении дома', () => {
  const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const before = conceptQuantities(p);
  assert.ok(Math.abs(before.walls-14.25) < .01, JSON.stringify(before));
  assert.equal(before.finish, 20); assert.equal(before.foundation, null);
  p.rooms[0].w = 7000; const after = conceptQuantities(p);
  assert.equal(after.finish, 28); assert.ok(after.walls > before.walls); assert.ok(after.roof > before.roof);
});

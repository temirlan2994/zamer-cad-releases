// Варианты планировки, сравнение и генератор.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplate } from '../core/templates.js';
import { levelProject } from '../core/model.js';
import {
  snapshotHouse, projectWithHouse, nextVariantName, variantSummary, compareRows, createVariant,
} from '../core/variants.js';
import { generateLayouts, sunnySide } from '../core/generator.js';
import { analyzeConnectivity, validateRoomPlacement } from '../core/rooms.js';
import { deriveWalls, openingRect } from '../core/walls.js';

test('снимок дома и возврат: участок общий, дом — из варианта', () => {
  const p = buildTemplate('compact');
  p.site.boundary = [{ x: -9000, y: -9000 }, { x: 18000, y: -9000 }, { x: 18000, y: 20000 }, { x: -9000, y: 20000 }];
  const house = snapshotHouse(p);
  house.levels[0].rooms.pop();
  const q = projectWithHouse(p, house);
  assert.equal(q.rooms.length, p.rooms.length - 1);
  assert.deepEqual(q.site.boundary, p.site.boundary);
  assert.equal(p.rooms.length, 6, 'исходный проект не тронут');
  assert.equal(createVariant(p, 'X').house.levels[0].rooms.length, 6);
});

test('имена вариантов и таблица сравнения', () => {
  assert.equal(nextVariantName([]), 'Вариант A');
  assert.equal(nextVariantName([{ name: 'Вариант A' }, { name: 'Вариант B' }]), 'Вариант C');
  const a = variantSummary(buildTemplate('compact'));
  const b = variantSummary(buildTemplate('one-storey'));
  const rows = compareRows(a, b);
  const total = rows.find((r) => r[0] === 'Общая площадь');
  assert.match(total[3], /^\+\d/);
  assert.equal(rows.length, 8);
});

test('генератор: три корректных варианта, жилые на солнечной стороне', () => {
  const p = buildTemplate('one-storey'); // север вверх → солнце снизу плана
  assert.equal(sunnySide(p), 'bottom');
  const out = generateLayouts(p, { count: 3 });
  assert.equal(out.length, 3);
  for (const v of out) {
    const q = projectWithHouse(p, v.house);
    const lp = levelProject(q, q.activeLevel);
    const walls = deriveWalls(lp);
    for (const room of lp.rooms) assert.ok(validateRoomPlacement(lp, room, room.id).ok, room.name);
    const c = analyzeConnectivity(lp, walls);
    assert.ok(c.hasEntrance && !c.unreachable.length, v.notes);
    for (const o of lp.openings) {
      const placed = openingRect(lp, o, walls);
      assert.ok(placed);
      if (o.kind === 'window') assert.equal(placed.wall.kind, 'own');
    }
  }
  const best = projectWithHouse(p, out[0].house);
  assert.equal(out[0].insolationOk, true);
  // Гостиная и большинство жилых — на солнечной (нижней) стороне; самую
  // маленькую спальню генератор может перенести для равной длины рядов.
  const corridor = best.rooms.find((r) => r.type === 'corridor');
  const living = best.rooms.filter((x) => ['living', 'bedroom', 'master-bedroom'].includes(x.type));
  assert.ok(best.rooms.find((r) => r.type === 'living').y > corridor.y);
  assert.ok(living.filter((r) => r.y > corridor.y).length >= living.length - 1);
});

test('генератор: только одноэтажный дом', () => {
  assert.throws(() => generateLayouts(buildTemplate('two-storey')), /одноэтажного/);
});

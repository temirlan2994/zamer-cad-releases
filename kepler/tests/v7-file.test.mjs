// Файл kepler-plan/7 при модели приложения v6 (core/v7/file.js,
// docs/v7-stage2-plan.md, срез 2): сохранение пишет v7, открытие
// возвращает тот же проект; круг сохранить → открыть устойчив.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createOpening, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { TEMPLATES } from '../core/templates.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { MANUAL_WALL_FIXTURES, WALL_FIXTURES, eatChain } from './wall-fixtures.mjs';

function cases() {
  const out = [];
  for (const [n, f] of Object.entries({ ...WALL_FIXTURES, ...MANUAL_WALL_FIXTURES, eatChain })) out.push([n, f()]);
  for (const t of TEMPLATES) out.push([t.id, t.build()]);
  for (const f of readdirSync(new URL('./fixtures/', import.meta.url))) {
    out.push([f, deserializeProject(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))]);
  }
  return out;
}

const ids = (list) => (list || []).map((x) => x.id).sort();
// Все проёмы этажа, включая «сирот» под съевшей комнатой.
const allOpenings = (l) => [...l.openings, ...l.rooms.flatMap((r) => r.eatBase?.openings || [])];

test('сохранение — kepler-plan/7 без производного (eatBase, rooms)', () => {
  const p = eatChain();
  const data = JSON.parse(serializeProject(p));
  assert.equal(data.schema, 'kepler-plan/7');
  for (const l of data.levels) {
    assert.ok(Array.isArray(l.blocks));
    assert.equal(l.rooms, undefined);
    for (const b of l.blocks) assert.equal(b.eatBase, undefined);
  }
});

test('круг сохранить → открыть на всех фикстурах, шаблонах и файлах v1–v5', () => {
  for (const [name, p0] of cases()) {
    const t1 = serializeProject(p0);
    const p1 = deserializeProject(t1);
    assert.deepEqual(p1.levels.map((l) => l.id), p0.levels.map((l) => l.id), `${name}: этажи`);
    p0.levels.forEach((l0, i) => {
      const l1 = p1.levels[i];
      assert.deepEqual(ids(l1.rooms), ids(l0.rooms), `${name}: комнаты`);
      assert.deepEqual(ids(allOpenings(l1)), ids(allOpenings(l0)), `${name}: проёмы`);
      assert.deepEqual(ids(l1.walls), ids(l0.walls), `${name}: стены`);
      assert.deepEqual(ids(l1.items), ids(l0.items), `${name}: мебель`);
      for (const r0 of l0.rooms) {
        const r1 = l1.rooms.find((r) => r.id === r0.id);
        assert.equal(r1.name, r0.name);
        assert.equal(r1.type, r0.type);
        const nom = (r) => r.eatBase?.base || r;
        if (!r0.eatBase) continue;
        assert.deepEqual([nom(r1).x, nom(r1).y], [nom(r0).x, nom(r0).y], `${name}/${r0.id}: номинал на месте`);
      }
    });
    assert.equal(p1.site === null, p0.site === null, `${name}: участок`);
    // Второй круг ничего не меняет.
    const t2 = serializeProject(deserializeProject(serializeProject(p1)));
    assert.equal(serializeProject(p1), t2, `${name}: круг устойчив`);
  }
});

test('проёмы на всех сторонах комнаты и петли дверей переживают круг', () => {
  const p = createProject('проёмы');
  const a = createRoom('living', 1000, 2000, 4000, 3000);
  p.rooms.push(a);
  const ops = [0, 1, 2, 3].map((side) => {
    const o = createOpening('door', a.id, side, 1200, 800);
    o.hingeStart = side % 2 === 0;
    p.openings.push(o);
    return o;
  });
  const q = deserializeProject(serializeProject(p));
  for (const o of ops) {
    const back = q.openings.find((x) => x.id === o.id);
    assert.deepEqual([back.roomId, back.side, back.offset, back.hingeStart], [o.roomId, o.side, o.offset, o.hingeStart]);
  }
});

test('открытие v7 пересчитывает съедание по номиналам', () => {
  const p = createProject('съедание');
  const a = createRoom('living', 0, 0, 4000, 4000);
  const b = createRoom('bedroom', 3000, 3000, 3000, 3000);
  p.rooms.push(a, b);
  reconcileEats(p, { touched: [b.id] });
  const data = JSON.parse(serializeProject(p));
  const blockA = data.levels[0].blocks.find((x) => x.id === a.id);
  assert.deepEqual(blockA.shape, { kind: 'rect', w: 4000, h: 4000 }, 'в файле — номинал');
  const q = deserializeProject(JSON.stringify(data));
  const qa = q.rooms.find((r) => r.id === a.id);
  assert.ok(qa.outline && qa.eatBase, 'видимая — съеденная');
  assert.deepEqual(qa.outline, a.outline);
});

test('неизвестные ключи проекта и этажа переносятся', () => {
  const p = createProject('ключи');
  p.someFuture = { a: 1 };
  p.levels[0].note = 'этаж';
  const q = deserializeProject(serializeProject(p));
  assert.deepEqual(q.someFuture, { a: 1 });
  assert.equal(q.levels[0].note, 'этаж');
});

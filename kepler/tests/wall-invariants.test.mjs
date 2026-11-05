// Инварианты стен, которым обязана удовлетворять ЛЮБАЯ реализация deriveWalls
// (см. docs/walls-geometry-design.md). Фикстуры — tests/wall-fixtures.mjs,
// проверки — tests/wall-invariants-lib.mjs (растеризация 10 мм).
//
// По умолчанию проверяется текущая deriveWalls; известные дефекты старой
// схемы помечены { todo } — `npm test` зелёный, а список виден в выводе.
// KEPLER_WALLS=v2 — проверить deriveWallsV2 (когда появится) без поблажек.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as wallsModule from '../core/walls.js';
import { buildTemplate, TEMPLATES } from '../core/templates.js';
import { levelProject } from '../core/model.js';
import { WALL_FIXTURES } from './wall-fixtures.mjs';
import { checkWallInvariants } from './wall-invariants-lib.mjs';

const V2 = process.env.KEPLER_WALLS === 'v2';
const derive = V2 ? wallsModule.deriveWallsV2 : wallsModule.deriveWalls;

const INVARIANTS = {
  holes: 'a: нет щелей и дыр',
  coverage: 'b: граница комнаты покрыта стеной',
  intrusion: 'c: стены не заходят в комнаты',
  thickness: 'd: постоянная толщина (нет бугров и уступов)',
  area: 'e: площадь кусков = площадь объединения (нет наложений)',
  fragments: 'f: нет обломков',
};

// Дефекты старой схемы (полосы + заплатки), замерено 2026-11-05.
const ALL = '*';
const KNOWN_OLD_FAILURES = {
  area: ALL, // углы удлиняются, заплатки-стыки кладутся поверх полос
  intrusion: ['courtyardBetweenL', 'diagonalCorners'], // удлинение угла заходит в соседа по диагонали
};

function isKnown(fixture, inv) {
  if (V2) return false;
  const list = KNOWN_OLD_FAILURES[inv];
  return list === ALL || (Array.isArray(list) && list.includes(fixture));
}

const cases = Object.entries(WALL_FIXTURES).map(([name, build]) => [name, build()]);
for (const t of TEMPLATES) {
  const p = buildTemplate(t.id);
  for (const lv of p.levels) cases.push([`шаблон ${t.id}/${lv.name}`, levelProject(p, lv.id)]);
}

test('реализация стен доступна', { skip: !derive && 'deriveWallsV2 ещё нет' }, () => {
  assert.equal(typeof derive, 'function');
});

for (const [name, project] of cases) {
  if (!derive) break;
  const result = checkWallInvariants(project, derive(project));
  for (const [inv, title] of Object.entries(INVARIANTS)) {
    const known = isKnown(name, inv);
    test(`${name} — ${title}`, known ? { todo: 'дефект старой схемы стен' } : {}, () => {
      const r = result[inv];
      assert.ok(r.ok, `${inv}: ${r.count} — ${r.sample.join('; ')}`);
    });
  }
}

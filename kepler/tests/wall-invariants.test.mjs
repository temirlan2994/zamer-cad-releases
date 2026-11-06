// Инварианты стен, которым обязана удовлетворять ЛЮБАЯ реализация deriveWalls
// (см. docs/walls-geometry-design.md). Фикстуры — tests/wall-fixtures.mjs,
// проверки — tests/wall-invariants-lib.mjs (растеризация 10 мм).
//
// Проверяется текущая deriveWalls: по умолчанию движок v2 — без поблажек.
// KEPLER_WALLS=v1 — устаревший движок; его известные дефекты помечены { todo }.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as wallsModule from '../core/walls.js';
import { buildTemplate, TEMPLATES } from '../core/templates.js';
import { readFileSync } from 'node:fs';
import { deserializeProject, levelProject } from '../core/model.js';
import { MANUAL_WALL_FIXTURES, WALL_FIXTURES } from './wall-fixtures.mjs';
import { checkWallInvariants } from './wall-invariants-lib.mjs';

const V2 = wallsModule.wallsEngine({ settings: {} }) === 'v2';
const derive = V2 ? wallsModule.deriveWallsV2 : wallsModule.deriveWallsV1;

const INVARIANTS = {
  holes: 'a: нет щелей и дыр',
  coverage: 'b: граница комнаты покрыта стеной',
  intrusion: 'c: стены не заходят в комнаты',
  thickness: 'd: постоянная толщина (нет бугров и уступов)',
  area: 'e: площадь кусков = площадь объединения (нет наложений)',
  fragments: 'f: нет обломков',
  hidden: 'g: скрытая стена не забирает углы видимых',
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
// Ручные стены (этап B): такой проект всегда идёт на v2 — инварианты без поблажек.
const manualCases = Object.entries(MANUAL_WALL_FIXTURES).map(([name, build]) => [name, build()]);
for (const t of TEMPLATES) {
  const p = buildTemplate(t.id);
  for (const lv of p.levels) cases.push([`шаблон ${t.id}/${lv.name}`, levelProject(p, lv.id)]);
}
// Реальный проект пользователя (подложка, рельеф и варианты вырезаны):
// «Гостиная 3» над Лестницей на зазоре 50, стены спина к спине (483/500),
// балкон и терраса в 100 от наружных стен.
{
  const p = deserializeProject(readFileSync(new URL('./fixtures/user-house-2026-11.json', import.meta.url), 'utf8'));
  for (const lv of p.levels) cases.push([`проект user-house-2026-11/${lv.name}`, levelProject(p, lv.id)]);
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

for (const [name, project] of manualCases) {
  const walls = wallsModule.deriveWalls(project);
  const result = checkWallInvariants(project, walls);
  test(`${name} — движок v2 принудительно, ручные стены в результате`, () => {
    // Петля, целиком ставшая комнатой, ручных стен не оставляет — движок любой.
    if (project.walls.length) assert.equal(wallsModule.wallsEngine(project), 'v2');
    const manual = walls.filter((w) => w.source === 'manual');
    assert.equal(manual.length, project.walls.length);
    // Тело каждой ручной стены целиком покрыто областью W (без щелей).
    for (const w of manual) {
      const area = wallsModule.wallRects(w).reduce((s, r) => s + r.w * r.h, 0);
      assert.ok(area > 0, `${w.key}: пустая`);
      const b = w.band;
      for (let x = b.x + 5; x < b.x + b.w; x += 10) {
        for (let y = b.y + 5; y < b.y + b.h; y += 10) {
          assert.ok(walls.some((o) => wallsModule.wallContains(o, { x, y })), `${w.key}: щель в (${x}, ${y})`);
        }
      }
    }
  });
  for (const [inv, title] of Object.entries(INVARIANTS)) {
    // Без ручных стен (петля целиком стала комнатой) KEPLER_WALLS=v1 — старый движок.
    const known = !project.walls.length && isKnown(name, inv);
    test(`${name} — ${title}`, known ? { todo: 'дефект старой схемы стен' } : {}, () => {
      const r = result[inv];
      assert.ok(r.ok, `${inv}: ${r.count} — ${r.sample.join('; ')}`);
    });
  }
}

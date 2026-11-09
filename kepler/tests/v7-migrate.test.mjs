// Миграция kepler-plan/6 → 7 и сверка площадей с текущим движком.
//
// Сверка: сумма чистых площадей помещений derive v7 (без шахт и безымянных
// пустот) против totalAreaM2 старого движка (core/rooms.js: roomShapeArea
// минус вложенные, шахты и «съевшие»). Съеденные комнаты v6 хранят форму
// ПОСЛЕ съедания, v7 берёт номинальную (eatBase.base) и съедает на лету —
// площади совпадают точно.
//
// Известные расхождения (допуск — в MAX_DIFF):
//  • шахта (shaftInWall, steppedWithKitchenAndShaft, shaftAtCorner): в v7 у
//    шахты свои стены, они отнимают площадь у помещения, через которое
//    шахта проходит; v6 вычитает только саму шахту;
//  • открытые площадки (terraceAtPartitionGap, балкон/терраса проекта
//    пользователя): v7 вычитает из площадки и тела стен дома, стоящие на ней
//    (наружная 250 при зазоре 100 заходит на 150), v6 — только комнаты;
//  • диагональное соседство углами (diagonalCorners, courtyardBetweenL) и
//    косой контур проекта пользователя: наружные стены 250 двух комнат в
//    100 мм по диагонали перекрываются, угол миттера заходит в соседнюю
//    комнату на 150×150 мм (0,0225 м²) — в v7 это честная геометрия;
//  • ручная стена через комнату (manualThroughRoom, manualCrossesRoomWall):
//    v7 делит помещение стеной и вычитает её тело, v6 оставлял площадь;
//  • nearGapRooms и лестница проекта пользователя: блоки ближе перегородки
//    (зазор 50) или неразрешённое перекрытие v6 — v7 съедает с зазором
//    перегородки (нижний теряет полосу), v6 вычитал без зазора;
//  • courtyardBetweenL, manualClosesCorridor: замкнутый двор — в v7
//    безымянная пустота (source = null), в сумму не входит, как и в v6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { deserializeProject, levelProject } from '../core/model.js';
import { totalAreaM2 } from '../core/rooms.js';
import { TEMPLATES } from '../core/templates.js';
import { derive, totalArea } from '../core/v7/derive.js';
import { fromV6, fromAny } from '../core/v7/migrate.js';
import { MANUAL_WALL_FIXTURES, WALL_FIXTURES, eatChain } from './wall-fixtures.mjs';

const EXACT = 0.005; // м² — округление до 0,5 мм
const MAX_DIFF = { // относительное расхождение, см. шапку
  steppedWithKitchenAndShaft: 0.02, shaftInWall: 0.03, shaftAtCorner: 0.015,
  terraceAtPartitionGap: 0.02, diagonalCorners: 0.003, courtyardBetweenL: 0.002, nearGapRooms: 0.006,
  manualCrossesRoomWall: 0.016, manualThroughRoom: 0.017,
  // derive v7 ставит стену полной толщины и на 10-мм ребро ступеньки (выступ
  // в зоне скрытой стены съедает площадь) — микроступеньки v7 ещё не
  // выравнивает (JOG_TOL есть только в core/walls-v2.js).
  jogCornerHidden: 0.002, jogStepFace: 0.003, 'user-house-joints-2026-11.kepler.json': 0.001,
  'user-house-2026-11.json': 0.005, 'v5-project.kepler.json': 0.005,
};

function cases() {
  const out = [];
  for (const [n, f] of Object.entries({ ...WALL_FIXTURES, ...MANUAL_WALL_FIXTURES })) out.push([n, f()]);
  for (const t of TEMPLATES) out.push([t.id, t.build()]);
  for (const f of readdirSync(new URL('./fixtures/', import.meta.url))) {
    out.push([f, deserializeProject(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))]);
  }
  return out;
}

test('сверка площадей v7 со старым движком по всем фикстурам и шаблонам', () => {
  for (const [name, p] of cases()) {
    const warnings = [];
    const v7 = fromV6(p, { warnings });
    assert.equal(v7.schema, 'kepler-plan/7');
    assert.deepEqual(warnings, [], `${name}: все проёмы перенесены`);
    for (const level of p.levels) {
      const old = totalAreaM2(levelProject(p, level.id));
      const res = derive(v7, { levelId: level.id, cache: false });
      const diff = Math.abs(totalArea(res) - old);
      const allowed = Math.max(EXACT, (MAX_DIFF[name] || 0) * old);
      assert.ok(diff <= allowed, `${name}/${level.id}: v6 ${old.toFixed(3)} м², v7 ${totalArea(res).toFixed(3)} м²`);
      const v6Openings = level.openings.length;
      assert.equal(res.openings.length, v6Openings, `${name}/${level.id}: проёмы встали на стены`);
    }
  }
});

test('съеденная комната: в v7 номинальная форма, eatBase не переносится, кто съел — выше', () => {
  const p = eatChain();
  const v7 = fromV6(p);
  const blocks = v7.levels[0].blocks;
  for (const b of blocks) assert.equal(b.eatBase, undefined);
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  for (const r of p.rooms) {
    if (!r.eatBase) continue;
    assert.deepEqual(byId[r.id].shape, { kind: 'rect', w: r.eatBase.base.w, h: r.eatBase.base.h });
    for (const up of r.eatBase.by) assert.ok(byId[up].z > byId[r.id].z, `${up} выше ${r.id}`);
  }
});

test('старые версии (v1–v5) открываются в v7 через fromAny; ручные стены и пары переносятся', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/v1-project.kepler.json', import.meta.url), 'utf8'));
  const v7 = fromAny(raw);
  assert.equal(v7.levels.length, 1);
  assert.ok(v7.levels[0].blocks.length > 0);
  const manual = fromV6(MANUAL_WALL_FIXTURES.manualThroughRoom());
  assert.deepEqual(manual.levels[0].walls[0].from, { x: 3000, y: 0 });
  assert.equal(manual.levels[0].walls[0].justify, 'left');
  const tee = fromV6(WALL_FIXTURES.hiddenWallTee());
  const [key] = Object.keys(tee.levels[0].pairs);
  assert.equal(tee.levels[0].pairs[key].hidden, true);
  const res = derive(tee, { cache: false });
  assert.ok(res.walls.some((w) => w.hidden && w.pair), 'скрытая общая стена — линия разделения');
  assert.equal(res.rooms.length, 3, 'скрытая стена всё равно делит помещения');
});

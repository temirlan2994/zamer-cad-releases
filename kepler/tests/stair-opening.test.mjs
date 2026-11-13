import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHouseMesh } from '../core/mesh3d.js';
import { buildStructuredExport } from '../core/export.js';
import {
  createItem, createLevel, createProject, createRoom, deserializeProject, levelProject, serializeProject,
} from '../core/model.js';
import { roomNetAreaM2 } from '../core/rooms.js';
import {
  SLAB_OPENING_GAP, dragSlabRect, removeSlabOpening, resetSlabOpeningAuto, setSlabOpeningRect, slabOpenings,
  stairRiseByLevels, stairTargetLevel, syncStairLevels,
} from '../core/slab-openings.js';
import { applyStairPreset, setStairRise, stairCalculation } from '../core/stairs.js';

// Два этажа: на первом — лестница П (центр 2000, 2000), на втором — комната над ней.
function twoStorey({ secondElevation = 3000 } = {}) {
  const project = createProject('Проём');
  project.rooms.push(createRoom('living', 0, 0, 6000, 6000));
  const stair = createItem('stairs', 2000, 2000, 1000, 3000);
  applyStairPreset(stair, 'u', 3000);
  project.items.push(stair);
  const l2 = createLevel('2 этаж', secondElevation, 3000, 'L2');
  l2.rooms.push(createRoom('hall', 0, 0, 6000, 6000));
  project.levels.push(l2);
  return { project, stair, l2 };
}

test('авто-проём: на этаже выше, по габариту лестницы с зазором', () => {
  const { project, stair, l2 } = twoStorey();
  assert.equal(stairTargetLevel(project, stair)?.id, 'L2', 'по умолчанию — ближайший этаж выше');
  assert.deepEqual(slabOpenings(project, 'L1'), [], 'в полу первого этажа проёма нет');
  const [o] = slabOpenings(project, l2.id);
  assert.ok(o.auto);
  assert.equal(o.stairId, stair.id);
  assert.equal(o.w, Math.round(stair.w + 2 * SLAB_OPENING_GAP));
  assert.equal(o.h, Math.round(stair.h + 2 * SLAB_OPENING_GAP));
  assert.equal(o.x, Math.round(stair.x - stair.w / 2 - SLAB_OPENING_GAP));
  // Лестница сдвинулась — авто-проём следует; повернулась — габарит повёрнут.
  stair.x += 500;
  stair.rotation = 90;
  const [moved] = slabOpenings(project, l2.id);
  assert.equal(moved.x, Math.round(stair.x - stair.h / 2 - SLAB_OPENING_GAP));
  assert.equal(moved.w, Math.round(stair.h + 2 * SLAB_OPENING_GAP));
  // «Никуда» — проёма нет.
  stair.toLevel = 'none';
  assert.deepEqual(slabOpenings(project, l2.id), []);
  delete stair.toLevel;
  // Удалили лестницу — авто-проём исчез.
  project.items.length = 0;
  assert.deepEqual(slabOpenings(project, l2.id), []);
});

test('ручная правка: проём не следует за лестницей; «Вернуть авто» — снова по лестнице', () => {
  const { project, stair, l2 } = twoStorey();
  const [auto] = slabOpenings(project, l2.id);
  const rect = dragSlabRect(auto, 'e', { x: auto.x + auto.w + 600, y: 0 }, 10);
  assert.equal(rect.w, auto.w + 600);
  assert.equal(rect.x, auto.x);
  const rec = setSlabOpeningRect(project, l2.id, auto.id, rect);
  assert.notEqual(rec.id, auto.id);
  assert.equal(l2.slabOpenings.length, 1);
  let list = slabOpenings(project, l2.id);
  assert.equal(list.length, 1, 'ручной заменяет авто этой лестницы');
  assert.equal(list[0].auto, false);
  assert.equal(list[0].w, auto.w + 600);
  stair.x += 1000;
  list = slabOpenings(project, l2.id);
  assert.equal(list[0].x, auto.x, 'ручной за лестницей не едет');
  // Минимальный размер.
  assert.equal(dragSlabRect(list[0], 'w', { x: list[0].x + 99999, y: 0 }).w, 300);
  // Вернуть авто.
  const id = resetSlabOpeningAuto(project, l2.id, rec.id);
  assert.equal(id, `auto:${stair.id}`);
  assert.equal(l2.slabOpenings, undefined, 'пустой список не хранится');
  list = slabOpenings(project, l2.id);
  assert.ok(list[0].auto);
  assert.equal(list[0].x, Math.round(stair.x - stair.w / 2 - SLAB_OPENING_GAP));
  // Ручной остаётся после удаления лестницы и удаляется отдельно.
  const manual = setSlabOpeningRect(project, l2.id, list[0].id, { ...list[0], w: list[0].w + 200 });
  project.items.length = 0;
  list = slabOpenings(project, l2.id);
  assert.equal(list.length, 1);
  assert.equal(resetSlabOpeningAuto(project, l2.id, manual.id), null, 'без лестницы вернуть авто нельзя');
  assert.ok(removeSlabOpening(project, l2.id, manual.id));
  assert.deepEqual(slabOpenings(project, l2.id), []);
});

test('высота подъёма — по отметкам этажей, ступени пересчитываются', () => {
  const { project, stair, l2 } = twoStorey({ secondElevation: 3300 });
  assert.equal(stairRiseByLevels(project, stair), 3300);
  const before = stairCalculation(stair).risers;
  stair.toLevel = l2.id;
  assert.equal(syncStairLevels(project, setStairRise), 1);
  assert.equal(stair.floorHeight, 3300);
  const calc = stairCalculation(stair);
  assert.equal(calc.floorH, 3300);
  assert.equal(calc.risers, Math.round(3300 / 175));
  assert.ok(calc.risers > before);
  assert.equal(calc.treads, calc.risers - 2, 'П: проступей = подъёмов − 1 − площадка');
  assert.equal(syncStairLevels(project, setStairRise), 0, 'повторно — без изменений');
  // Этаж подняли — подъём следует.
  l2.elevation = 3500;
  syncStairLevels(project, setStairRise);
  assert.equal(stairCalculation(stair).floorH, 3500);
  // Целевой этаж удалили — поле снято, лестница ведёт на ближайший выше (нет — без проёма).
  project.levels = project.levels.filter((l) => l.id !== 'L2');
  syncStairLevels(project, setStairRise);
  assert.equal(stair.toLevel, undefined);
});

test('проём через этаж: вырез в перекрытиях обоих этажей выше', () => {
  const { project, stair } = twoStorey();
  project.levels.push(createLevel('3 этаж', 6000, 3000, 'L3'));
  stair.toLevel = 'L3';
  assert.equal(slabOpenings(project, 'L2').length, 1);
  assert.equal(slabOpenings(project, 'L3').length, 1);
  stair.toLevel = 'L2';
  assert.equal(slabOpenings(project, 'L3').length, 0);
});

test('площадь помещения над проёмом уменьшена; 3D: перекрытие и пол вырезаны', () => {
  const { project, l2 } = twoStorey();
  const lp = levelProject(project, l2.id);
  const [o] = slabOpenings(project, l2.id);
  const hall = l2.rooms[0];
  assert.ok(Math.abs(roomNetAreaM2(lp, hall) - (36 - (o.w * o.h) / 1e6)) < 1e-6);
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const inside = (f) => {
    const xs = f.pts.map((p) => p.x); const ys = f.pts.map((p) => p.y);
    return Math.min(...xs) < cx && Math.max(...xs) > cx && Math.min(...ys) < cy && Math.max(...ys) > cy;
  };
  const faces = buildHouseMesh(project);
  const slabTop = faces.filter((f) => f.kind === 'slab' && f.normal.z > 0.5);
  assert.ok(slabTop.length > 0);
  assert.ok(!slabTop.some(inside), 'над лестницей перекрытия нет');
  const floors2 = faces.filter((f) => f.kind === 'floor' && f.level === l2.id);
  assert.ok(floors2.length > 1);
  assert.ok(!floors2.some(inside), 'пола второго этажа в проёме нет');
  // Ручной расширенный проём — тоже вырезан.
  setSlabOpeningRect(project, l2.id, o.id, { ...o, w: o.w + 1000 });
  const wide = buildHouseMesh(project).filter((f) => f.kind === 'slab' && f.normal.z > 0.5);
  const px = o.x + o.w + 500;
  assert.ok(!wide.some((f) => {
    const xs = f.pts.map((p) => p.x); const ys = f.pts.map((p) => p.y);
    return Math.min(...xs) < px && Math.max(...xs) > px && Math.min(...ys) < cy && Math.max(...ys) > cy;
  }));
});

test('сериализация: ручной проём и «ведёт на этаж» сохраняются, экспорт JSON', () => {
  const { project, stair, l2 } = twoStorey();
  stair.toLevel = l2.id;
  const [o] = slabOpenings(project, l2.id);
  setSlabOpeningRect(project, l2.id, o.id, { ...o, h: o.h + 400 });
  const back = deserializeProject(serializeProject(project));
  const b2 = back.levels.find((l) => l.id === l2.id);
  assert.equal(b2.slabOpenings.length, 1);
  assert.equal(b2.slabOpenings[0].h, o.h + 400);
  assert.equal(b2.slabOpenings[0].stairId, stair.id);
  assert.equal(back.levels.find((l) => l.id === 'L1').items[0].toLevel, l2.id);
  // Битые записи отбрасываются, авто-id не хранится.
  const raw = JSON.parse(serializeProject(project));
  raw.levels.find((l) => l.id === l2.id).slabOpenings.push({ id: 'auto:x', x: 0, y: 0, w: 500, h: 500 }, { x: 'a' });
  const fixed = deserializeProject(JSON.stringify(raw)).levels.find((l) => l.id === l2.id).slabOpenings;
  assert.equal(fixed.length, 2);
  assert.ok(fixed.every((s) => !s.id.startsWith('auto:')));
  const exp = buildStructuredExport(back);
  const e2 = exp.levels.find((l) => l.id === l2.id);
  assert.equal(e2.slab_openings.length, 1);
  assert.equal(e2.slab_openings[0].source, 'manual');
  assert.equal(exp.levels.find((l) => l.id === 'L1').furniture[0].to_level, l2.id);
});

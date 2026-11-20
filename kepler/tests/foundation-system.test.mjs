import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveFoundation } from '../core/foundation-system.js';
import { createLevel, createProject, createRoom } from '../core/model.js';
import { sharedKey } from '../core/walls.js';

function oneRoom() {
  const project = createProject();
  project.settings.exterior = 250;
  project.rooms.push(createRoom('living', 0, 0, 6000, 4000));
  project.envelope.zeroAboveGround = 1000;
  project.envelope.foundation.depth = 800;
  return project;
}

function twoRooms() {
  const project = createProject();
  project.settings.exterior = 250;
  project.settings.partition = 150;
  const left = createRoom('living', 0, 0, 4000, 4000);
  const right = createRoom('kitchen', 4150, 0, 3000, 4000);
  project.rooms.push(left, right);
  project.envelope.zeroAboveGround = 1000;
  project.envelope.foundation.depth = 800;
  return { project, left, right };
}

function gridContains(grid, x, y) {
  const i = grid.xs.findIndex((value, index) => index < grid.nx && x > value && x < grid.xs[index + 1]);
  const j = grid.ys.findIndex((value, index) => index < grid.ny && y > value && y < grid.ys[index + 1]);
  return i >= 0 && j >= 0 && Boolean(grid.mask[j * grid.nx + i]);
}

test('старый проект без типа получает совместимое плитное основание и цоколь', () => {
  const { project } = twoRooms();
  project.envelope.foundation.sizingMode = 'legacy-depth';
  const system = deriveFoundation(project);

  assert.equal(system.type, 'slab');
  assert.equal(system.levelId, 'L1');
  assert.deepEqual(system.warnings, []);
  const slab = system.components.find((component) => component.kind === 'slab');
  const plinth = system.components.find((component) => component.kind === 'plinth');
  assert.ok(slab);
  assert.ok(plinth);
  assert.deepEqual([slab.z0, slab.z1], [-1800, -1000]);
  assert.deepEqual([plinth.z0, plinth.z1], [-1000, 0]);
  assert.equal(slab.shape, 'grid');
  assert.equal(gridContains(slab.grid, 4075, 2000), true, 'между соседними комнатами нет шва');
});

test('явная толщина плиты меняет её тело, а цоколь без разрыва доходит до ±0.000', () => {
  const project = oneRoom();
  project.envelope.foundation.slabThickness = 450;

  const system = deriveFoundation(project);
  const slab = system.components.find((component) => component.kind === 'slab');
  const plinth = system.components.find((component) => component.kind === 'plinth');

  assert.deepEqual([slab.z0, slab.z1], [-1800, -1350]);
  assert.equal(slab.thickness, 450);
  assert.equal(slab.verticalSizing, 'parametric');
  assert.deepEqual([plinth.z0, plinth.z1], [-1350, 0]);

  project.envelope.foundation.slabThickness = 700;
  const thicker = deriveFoundation(project).components.find((component) => component.kind === 'slab');
  assert.deepEqual([thicker.z0, thicker.z1], [-1800, -1100]);
});

test('лента идёт под наружными и несущими стенами, но не под перегородкой', () => {
  const { project, left, right } = twoRooms();
  project.envelope.foundation.type = 'strip';
  project.envelope.foundation.stripWidth = 600;

  const partition = deriveFoundation(project);
  const partitionStrip = partition.components.find((component) => component.kind === 'strip' && component.shape === 'grid');
  assert.ok(partitionStrip);
  assert.equal(gridContains(partitionStrip.grid, 4075, 2000), false);

  project.wallOverrides[sharedKey(left.id, right.id)] = { kind: 'bearing', thickness: 150 };
  const bearing = deriveFoundation(project);
  const bearingStrip = bearing.components.find((component) => component.kind === 'strip' && component.shape === 'grid');
  assert.equal(gridContains(bearingStrip.grid, 4075, 2000), true);
  assert.ok(bearingStrip.sourceWallKeys.includes(sharedKey(left.id, right.id)));
});

test('высота ленты задаёт настоящую высоту тела от отметки заглубления', () => {
  const project = oneRoom();
  project.envelope.foundation.type = 'strip';
  project.envelope.foundation.stripHeight = 450;

  const system = deriveFoundation(project);
  const strips = system.components.filter((component) => component.kind === 'strip');
  const plinths = system.components.filter((component) => component.kind === 'plinth');

  assert.ok(strips.length > 0);
  assert.ok(strips.every((component) => component.z0 === -1800 && component.z1 === -1350));
  assert.ok(strips.every((component) => component.verticalSizing === 'parametric'));
  assert.ok(plinths.length > 0);
  assert.ok(plinths.every((component) => component.z0 === -1350 && component.z1 === 0));
});

test('свайное поле детерминировано, без дублей, с ростверком', () => {
  const project = oneRoom();
  project.envelope.foundation.type = 'piles';
  project.envelope.foundation.pileSpacing = 1800;
  project.envelope.foundation.pileDiameter = 400;
  project.envelope.foundation.pileLength = 3500;

  const first = deriveFoundation(project);
  const second = deriveFoundation(project);
  const piles = first.components.filter((component) => component.kind === 'pile');
  const again = second.components.filter((component) => component.kind === 'pile');
  assert.ok(first.components.some((component) => component.kind === 'grillage'));
  assert.ok(piles.length > 4);
  assert.deepEqual(
    piles.map(({ id, center, z0, z1 }) => ({ id, center, z0, z1 })),
    again.map(({ id, center, z0, z1 }) => ({ id, center, z0, z1 })),
  );
  assert.equal(new Set(piles.map((pile) => `${pile.center.x}|${pile.center.y}`)).size, piles.length);
  assert.ok(piles.every((pile) => pile.shape === 'prism' && pile.points.length === 12));
  assert.ok(piles.every((pile) => pile.z1 - pile.z0 === 3500));
});

test('подвал использует нижний отрицательный этаж и даёт плиту с подпорной оболочкой', () => {
  const project = oneRoom();
  const basement = createLevel('Подвал', -3000, 3000, 'B1');
  basement.rooms.push(createRoom('hall', 500, 500, 4000, 3000));
  project.levels.push(basement);
  project.envelope.foundation.type = 'basement';
  project.envelope.foundation.basementSlabThickness = 350;

  const system = deriveFoundation(project);
  assert.equal(system.levelId, 'B1');
  assert.equal(system.warnings.some(({ code }) => code === 'basement-level-missing'), false);
  const slab = system.components.find((component) => component.kind === 'basement-slab');
  const walls = system.components.find((component) => component.kind === 'basement-wall');
  assert.deepEqual([slab.z0, slab.z1], [-3350, -3000]);
  assert.deepEqual([walls.z0, walls.z1], [-3000, -1000]);
  assert.equal(walls.shape, 'grid');
});

test('подвал без отрицательного этажа предупреждает и безопасно оставляет плиту', () => {
  const project = oneRoom();
  project.envelope.foundation.type = 'basement';
  const system = deriveFoundation(project);

  assert.ok(system.warnings.some(({ code }) => code === 'basement-level-missing'));
  assert.ok(system.components.some((component) => component.kind === 'slab' && component.fallbackFor === 'basement'));
});

test('отключённое основание и незаданный ±0 не создают геометрию', () => {
  const disabled = oneRoom();
  disabled.envelope.foundation.enabled = false;
  assert.deepEqual(deriveFoundation(disabled).components, []);

  const pending = oneRoom();
  pending.envelope.zeroAboveGround = null;
  const system = deriveFoundation(pending);
  assert.deepEqual(system.components, []);
  assert.ok(system.warnings.some(({ code }) => code === 'building-datum-missing'));
});

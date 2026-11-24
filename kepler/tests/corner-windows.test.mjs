import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, serializeProject, deserializeProject } from '../core/model.js';
import { deriveWalls, openingRect } from '../core/walls.js';
import { cornerWindowGeometry } from '../core/corner-windows.js';
import { levelWindowOpenings } from '../core/spanning-windows.js';
import { fitOpeningOffset, resizeCornerWing } from '../core/opening-spacing.js';
import { buildLevelWalls } from '../core/mesh3d.js';
import { pickBoxes } from '../core/pick3d.js';
import { planHitStack } from '../core/hit-stack.js';

function fixture() {
  const project = createProject('Угол');
  const room = createRoom('living', 0, 0, 6000, 5000);
  project.rooms.push(room);
  const opening = createOpening('window', room.id, 0, 1000, 2400);
  Object.assign(opening, { type: 'panoramic', heightMode: 'level', corner: { returnWidth: 1800, joint: 'post', end: 'from' } });
  const walls = deriveWalls(project);
  opening.offset = fitOpeningOffset(project, opening, walls, opening.offset);
  project.openings.push(opening);
  return { project, room, opening, walls };
}

test('обе стороны выбирают один витраж и следуют за углом после изменения помещения и открытия v7', () => {
  const { project, room, opening } = fixture();
  opening.corner.end = 'to';
  room.x += 800;
  room.y += 1200;
  room.w += 600;
  const walls = deriveWalls(project);
  opening.offset = fitOpeningOffset(project, opening, walls, 0);
  const copy = deserializeProject(serializeProject(project));
  assert.equal(copy.openings.length, 1);
  const derived = deriveWalls(copy);
  const projections = levelWindowOpenings(copy, derived);
  assert.deepEqual(projections.map((o) => [o.side, o.width]), [[0, 2400], [1, 1800]]);
  const geometry = cornerWindowGeometry(copy, copy.openings[0], derived);
  assert.deepEqual([geometry[0].start, geometry[1].start], [room.x + room.w + geometry[1].wall.band.w / 2, room.y - geometry[0].wall.band.h / 2]);
  for (const wing of projections) {
    const r = openingRect(copy, wing, derived).rect;
    const hit = planHitStack(copy, derived, 0.15, { x: r.x + r.w / 2, y: r.y + r.h / 2 })[0];
    assert.deepEqual([hit.type, hit.id], ['opening', opening.id]);
  }
});

test('тонкая стойка освобождает тело угла, простенок сохраняет его, оба крыла имеют общую раму и отметки', () => {
  const { project, opening, walls } = fixture();
  project.levels[0].tallWindowBottomOffset = 80;
  opening.frameColor = 'bronze';
  const z = 1100;
  for (const joint of ['post', 'pier']) {
    opening.corner.joint = joint;
    const boxes = pickBoxes(project);
    assert.equal(boxes.openings.filter((b) => b.id === opening.id).length, 2);
    assert.ok(boxes.openings.every((b) => b.z0 === 80));
    const cornerIsSolid = boxes.walls.some((b) => b.x0 <= -85 && b.x1 > -85 && b.y0 <= -85 && b.y1 > -85 && b.z0 < z && b.z1 > z);
    assert.equal(cornerIsSolid, joint === 'pier');
    const faces = buildLevelWalls(project, project.activeLevel, walls);
    assert.equal(faces.filter((f) => f.kind === 'glass' && f.openingId === opening.id).length, 2);
    assert.ok(faces.some((f) => f.kind === 'window-frame' && f.color === '#5a4a3c'));
  }
});

test('соседи обеих стен ограничивают установку и изменение длины, свободный конец второго крыла меняется независимо', () => {
  const { project, opening, walls, room } = fixture();
  const door = createOpening('door', room.id, 3, 3100, 900);
  project.openings.push(door);
  assert.equal(resizeCornerWing(project, opening, walls, 'return', 3100), false);
  assert.equal(opening.corner.returnWidth, 1800);
  assert.equal(resizeCornerWing(project, opening, walls, 'return', 2450), true);
  assert.deepEqual([opening.width, opening.corner.returnWidth], [2400, 2450]);
  const pos = fitOpeningOffset(project, door, walls, 500);
  assert.ok(pos >= 2450 - 125 + 100 + door.width / 2);
  door.offset = 1200;
  assert.equal(fitOpeningOffset(project, opening, walls, 0), null);
});

test('v7 сохраняет исходную сторону и угол для всех восьми ориентаций, включая устаревший центр', () => {
  const { project, opening, walls } = fixture();
  for (const side of [0, 1, 2, 3]) for (const end of ['from', 'to']) {
    opening.side = side;
    opening.corner.end = end;
    const offset = fitOpeningOffset(project, opening, walls, 0);
    for (const stored of [offset, 30000]) {
      opening.offset = stored;
      const copy = deserializeProject(serializeProject(project));
      assert.equal(copy.openings[0].side, side);
      assert.equal(copy.openings[0].corner.end, end);
      const wings = cornerWindowGeometry(copy, copy.openings[0], deriveWalls(copy));
      assert.equal(wings[0].opening.offset, offset);
      if (stored === offset) assert.equal(copy.openings[0].offset, offset);
    }
  }
});

test('витраж на строковом ребре ступенчатого контура сохраняет обе грани и настройки после импорта', () => {
  const { project, room, opening } = fixture();
  Object.assign(room, { x: 1850, y: -750, outline: [
    { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 2500 },
    { x: 3500, y: 2500 }, { x: 3500, y: 5000 }, { x: 0, y: 5000 },
  ] });
  Object.assign(opening, { side: 'outline-2', width: 1400, height: 2020, sill: 170,
    frameColor: 'bronze', heightMode: 'custom', corner: { end: 'to', returnWidth: 900, joint: 'pier' } });
  const walls = deriveWalls(project);
  opening.offset = fitOpeningOffset(project, opening, walls, 0);
  assert.ok(Number.isFinite(opening.offset));
  const shapes = (p) => {
    const w = deriveWalls(p);
    return levelWindowOpenings(p, w).map((o) => ({ rect: openingRect(p, o, w).rect, side: o.side, width: o.width }));
  };
  const before = shapes(project);
  assert.equal(before.length, 2);
  const copy = deserializeProject(serializeProject(project));
  assert.deepEqual(copy.openings[0], opening);
  assert.deepEqual(shapes(copy), before);
});

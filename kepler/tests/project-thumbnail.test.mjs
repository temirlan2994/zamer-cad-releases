import test from 'node:test';
import assert from 'node:assert/strict';
import { projectThumbnailLevel } from '../ui/project-thumbnail.js';

const level = (id, elevation, content = true) => ({
  id,
  elevation,
  rooms: content ? [{ id: `room-${id}`, x: 0, y: 0, w: 3000, h: 3000 }] : [],
  walls: [], items: [], openings: [], slabOpenings: [],
});

test('миниатюра берёт первый надземный этаж, а не подвал', () => {
  const basement = level('B1', -3000);
  const ground = level('L1', 0);
  const upper = level('L2', 3000);
  assert.equal(projectThumbnailLevel({ levels: [basement, upper, ground] }), ground);
});

test('без нулевой отметки выбирается ближайший непустой этаж выше земли', () => {
  const basement = level('B1', -2500);
  const mezzanine = level('L1', 450);
  const upper = level('L2', 3400);
  assert.equal(projectThumbnailLevel({ levels: [upper, basement, mezzanine] }), mezzanine);
});

test('если надземных этажей нет, берётся ближайший к нулю подвал', () => {
  const deep = level('B2', -6000);
  const near = level('B1', -2800);
  assert.equal(projectThumbnailLevel({ levels: [deep, near] }), near);
  assert.equal(projectThumbnailLevel({ levels: [level('L1', 0, false)] }), null);
});

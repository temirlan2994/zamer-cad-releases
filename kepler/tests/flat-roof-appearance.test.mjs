import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLevel, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { linkedRoofFaces } from '../core/mesh3d.js';
import { pointInPolygon } from '../core/zamer/geometry.js';

const capAt = (faces, kind, x, y) => faces.some((f) =>
  f.kind === kind && f.normal.z > 0.9 && pointInPolygon({ x, y }, f.pts));

test('Плоская крыша сохраняет открытый край, оставляя чистое примыкание к верхнему этажу', () => {
  const project = createProject();
  const lower = project.activeLevel;
  const main = createRoom('living', 0, 0, 8000, 4800);
  project.rooms.push(main);
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  upper.rooms.push(createRoom('bedroom', 0, 0, 4000, 4800));
  project.levels.push(upper);
  const underside = () => linkedRoofFaces(project).filter((f) => f.level === lower);
  const exterior = project.settings.exterior;
  const besideWall = 4000 + exterior + 60;
  const openEdge = 8000 + exterior + project.envelope.roof.overhang - 90;
  const lowFaces = underside();
  for (const [x, covered, parapet] of [[3800, false, false], [besideWall, true, false], [openEdge, true, true]]) {
    assert.equal(capAt(lowFaces, 'roof', x, 2000), covered, 'настил на x=' + x);
    assert.equal(capAt(lowFaces, 'parapet', x, 2000), parapet, 'парапет на x=' + x);
    assert.equal(capAt(lowFaces, 'fascia', x, 2000), false, 'лишняя полоска у стены');
  }
  upper.rooms[0].linkedRoof = false;
  assert.ok(underside().some((f) => f.kind === 'parapet'));
  assert.equal(linkedRoofFaces(project).some((f) => f.level === upper.id), false);
  assert.equal(capAt(underside(), 'roof', 3800, 2000), false, 'верхнее помещение по-прежнему вырезает низ');
  const reopened = deserializeProject(serializeProject(project));
  assert.equal(linkedRoofFaces(reopened).some((f) => f.level === upper.id), false);
  upper.rooms.length = 0;
  assert.ok(capAt(underside(), 'roof', 3800, 2000));
  assert.equal(capAt(underside(), 'parapet', besideWall, 2000), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createProject, createRoom } from '../core/model.js';
import { buildHouseMesh, linkedRoofFaces, linkedRoofRegions } from '../core/mesh3d.js';
import { pointInPolygon, ringArea } from '../core/geom/poly.js';
import { normalizeRoof } from '../core/roofs.js';

const house = () => {
  const p = createProject();
  p.envelope.roof.overhang = 600;
  p.levels[0].rooms.push(createRoom('living', 0, 0, 8000, 6000));
  p.levels.push(createLevel('2 этаж', 3000, 3000, 'L2'));
  return p;
};
const at = (regions, id) => regions.find((r) => r.levelId === id);
const covers = (outline, x, y) => pointInPolygon(outline, { x, y });

test('Связанная крыша отступает под надстройкой, восстанавливается и не оставляет свес без опоры', () => {
  const p = house();
  p.envelope.roof.type = 'gable';
  const [lower, upper] = p.levels;
  const slopeBefore = linkedRoofFaces(p).find((f) => f.roofSurface === 'top' && f.normal.y > 0).normal;
  const original = at(linkedRoofRegions(p), lower.id);
  const topRoom = createRoom('bedroom', 0, 0, 4000, 6000);
  upper.rooms.push(topRoom);
  const regions = linkedRoofRegions(p);
  const low = at(regions, lower.id);
  assert.equal(low.id, original.id);
  assert.ok(covers(low.outline, 8200, -750), 'свес у свободной части сохранён');
  assert.ok(!covers(low.outline, 3800, 2000), 'крыши под полом нет');
  assert.ok(!covers(low.outline, 2000, -750), 'карниз под перекрытым крылом не висит в воздухе');
  assert.equal(low.roofType, 'gable');
  const retained = linkedRoofFaces(p).filter((f) => f.roofId === low.id && f.roofSurface === 'top');
  assert.ok(retained.every((f) => f.normal.x === slopeBefore.x && Math.abs(f.normal.y) === Math.abs(slopeBefore.y)),
    'обрезка крыла не повернула конёк вдоль оставшейся части');
  assert.ok(linkedRoofFaces(p).some((f) => f.roofId === low.id && f.roofSurface === 'top' && f.normal.z < 0.99));
  assert.ok(buildHouseMesh(p, { roof: true, levels: 'only' }).some((f) => f.roofId === low.id));
  topRoom.w = 8000;
  assert.equal(at(linkedRoofRegions(p), lower.id), undefined);
  topRoom.linkedRoof = false;
  assert.equal(linkedRoofRegions(p).length, 0, 'удалённая верхняя крыша не открывает нижнюю сквозь этаж');
  upper.rooms.pop();
  assert.deepEqual(at(linkedRoofRegions(p), lower.id).outline, original.outline);
});

test('Открытый балкон занимает только собственный пол, а независимый объём сохраняет скат и карниз', () => {
  const p = house();
  p.envelope.roof.type = 'hip';
  const [lower, upper] = p.levels;
  upper.rooms.push(createRoom('balcony', 0, 0, 4000, 6000));
  let regions = linkedRoofRegions(p);
  assert.equal(at(regions, upper.id), undefined);
  const low = at(regions, lower.id);
  assert.ok(!covers(low.outline, 3990, 2000));
  assert.ok(covers(low.outline, 4010, 2000));
  upper.rooms.splice(0, 1, createRoom('living', 40000, 0, 4000, 3000));
  regions = linkedRoofRegions(p);
  assert.equal(at(regions, lower.id).planArea, 9700 * 7700);
  assert.equal(at(regions, lower.id).roofType, 'hip');
  assert.equal(at(regions, upper.id).roofType, 'hip');
});

test('Косая ручная кровля вырезает треугольник из связанной; площади плана и 3D совпадают', () => {
  const p = house();
  const outline = [{x:1500,y:1000},{x:4500,y:1000},{x:1500,y:4000}];
  const manual = normalizeRoof({ id:'manual',levelId:'L1',outline,overhang:{n:0,e:0,s:0,w:0} });
  p.roofs = [manual];
  for (const type of ['flat','gable']) {
    p.envelope.roof.type = type;
    const regions = linkedRoofRegions(p);
    const [r] = regions;
    assert.equal(r.planArea, 9700 * 7700 - 4500000);
    assert.ok(covers(r.outline, 4400, 3600), 'за диагональю остаётся кровля');
    assert.ok(!covers(r.outline, 1800, 2000));
    const surfaces = linkedRoofFaces(p, regions).filter((f) => f.roofSurface === 'top');
    assert.ok(surfaces.every((f) => f.roofId === r.id));
    assert.ok(Math.abs(surfaces.reduce((sum, f) => sum + Math.abs(ringArea(f.pts)), 0) - r.planArea) < 1);
  }
});

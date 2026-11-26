import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createProject, createRoom } from '../core/model.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { buildSection } from '../core/section.js';

function balconyHouse() {
  const p = createProject(); p.settings.exterior = 250;
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const upper = createLevel('2 этаж', 3000);
  upper.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000), createRoom('balcony', 5000, 1000, 2200, 1800));
  p.levels.push(upper); p.activeLevel = upper.id;
  return { p, upper, balcony: upper.rooms[1] };
}

const slab = (p, options) => buildHouseMesh(p, options).filter((f) => f.slabRole === 'interfloor');
const at = (f, x, y) => x >= Math.min(...f.pts.map((p) => p.x)) && x <= Math.max(...f.pts.map((p) => p.x))
  && y >= Math.min(...f.pts.map((p) => p.y)) && y <= Math.max(...f.pts.map((p) => p.y));

test('консоль балкона имеет нижнюю грань и торец толщиной перекрытия без выступа за ограждение', () => {
  const { p, upper, balcony } = balconyHouse();
  for (const thickness of [300, 450]) {
    upper.slabThickness = thickness;
    const faces = slab(p);
    assert.ok(faces.some((f) => f.normal.z > .5 && at(f, 6500, 1900) && f.pts.every((q) => q.z === 2999)));
    assert.ok(faces.some((f) => f.normal.z < -.5 && at(f, 6500, 1900) && f.pts.every((q) => q.z === 3000-thickness)));
    const end = faces.filter((f) => f.normal.x === 1 && f.pts.every((q) => q.x === 7200));
    assert.ok(end.length);
    assert.equal(Math.min(...end.flatMap((f) => f.pts.map((q) => q.z))), 3000-thickness);
    assert.equal(Math.max(...faces.flatMap((f) => f.pts.map((q) => q.x))), 7200);
    assert.equal(faces.filter((f) => f.normal.x !== 0 && f.pts.every((q) => q.x === 5270) && at(f, 5270, 1900)).length, 0, 'в стыке с домом нет внутреннего торца');
    const floor = buildHouseMesh(p).find((f) => f.kind === 'floor' && f.roomId === balcony.id);
    assert.ok(floor.pts.every((q) => q.z === 3000));
  }
});

test('плита балкона учитывает выбранный этаж, проёмы и выключение перекрытий', () => {
  const { p, upper } = balconyHouse();
  upper.slabOpenings = [{ id: 'hole', x: 6200, y: 1500, w: 400, h: 400 }];
  let faces = slab(p, { levels: 'only' });
  assert.ok(faces.some((f) => f.normal.z > .5 && at(f, 6900, 2400)));
  assert.ok(!faces.some((f) => f.normal.z > .5 && at(f, 6400, 1700)));
  p.activeLevel = p.levels[0].id;
  assert.equal(slab(p, { levels: 'only' }).length, 0);
  p.envelope.slabs.enabled = false;
  assert.equal(slab(p).length, 0);
});

test('толщина балкона совпадает на разрезе и в 3D', () => {
  const { p, upper } = balconyHouse(); upper.slabThickness = 450;
  const section = buildSection(p, { id: 's', kind: 'section', name: 'Балкон', line: { a: { x: 6500, y: 0 }, b: { x: 6500, y: 4000 } }, side: 1 });
  assert.ok(section.cuts.some((cut) => cut.kind === 'slab' && cut.z0 === 2550 && cut.z1 === 2999));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createProject, createRoom } from '../core/model.js';
import { roofFromRooms, setLinkedRoofEnabled } from '../core/roofs.js';
import { buildStructuredExport } from '../core/export.js';
import { buildIfc, ifcGuid } from '../core/ifc.js';
import { buildElevation } from '../core/elevation.js';
import { buildSection } from '../core/section.js';
import { sectionProfile } from '../core/landscape-section.js';
import { toWorld } from '../core/building.js';

function house() {
  const p = createProject('Дом');
  p.rooms.push(createRoom('living', 0, 0, 8000, 4000));
  const upper = createLevel('2 этаж', 3000, 3300, 'L2');
  upper.rooms.push(createRoom('bedroom', 4000, 0, 4000, 4000));
  p.levels.push(upper);
  Object.assign(p.envelope.roof, { type: 'shed', overhang: 0, pitchDeg: 15, direction: 'e', drainage: 'off' });
  return p;
}

test('JSON и IFC передают отдельную крышу каждого занятого уровня, точный вырез и устойчивую идентичность', () => {
  const p = house();
  const [bottom, upper] = buildStructuredExport(p).linked_roofs;
  assert.equal(bottom.level_id, 'L1');
  assert.equal(upper.level_id, 'L2');
  const xs = bottom.mesh.vertices.map(([x]) => x);
  assert.equal(Math.max(...xs), 4000 - p.settings.exterior);
  assert.equal(bottom.plan_area_m2, 18);
  assert.deepEqual(bottom.room_ids, [p.rooms[0].id]);
  assert.deepEqual(upper.room_ids, [p.levels[1].rooms[0].id]);
  const { text, counts } = buildIfc(p);
  assert.equal(counts.roofs, 2);
  assert.equal((text.match(/=IFCROOF\(/g) || []).length, 2);
  assert.match(text, /IFCTRIANGULATEDFACESET\(/);
  assert.match(text, /\.SHED_ROOF\.\)/);
  assert.ok(text.includes(ifcGuid(p.name + '|roof-linked-' + upper.id)));
  setLinkedRoofEnabled(p, 'L1', bottom.room_ids, false);
  const saved = buildStructuredExport(p);
  assert.equal(saved.levels[0].rooms[0].linked_roof, false);
  assert.deepEqual(saved.linked_roofs.map((r) => r.id), [upper.id]);
  assert.equal(buildIfc(p).counts.roofs, 1);
  p.roofs = [roofFromRooms(p, 'L2', upper.room_ids)];
  const manual = buildIfc(p);
  assert.equal(manual.counts.roofs, 1);
  assert.ok(manual.text.includes(ifcGuid(p.name + '|roof-manual-' + p.roofs[0].id)));
  assert.equal(buildStructuredExport(p).linked_roofs.length, 0);
});

test('крыша на фасаде и двух разрезах удаляется независимо от межэтажной плиты', () => {
  const p = house();
  p.building = { rotation: 29, origin: { x: -30000, y: 18000 } };
  const a = { x: -2000, y: 1700 }; const b = { x: 9500, y: 1700 };
  const view = { kind: 'section', side: 1, line: { a, b } };
  const path = [a, b].map((point) => toWorld(p.building, point));
  const caps = () => sectionProfile(p, path, 'left').prims.filter((part) => part.kind === 'house-roof' && part.cut);
  const initial = caps().flatMap((part) => part.pts.map((pt) => pt.z));
  assert.ok(Math.min(...initial) < 5000 && Math.max(...initial) > 6300);
  for (const level of p.levels) setLinkedRoofEnabled(p, level.id, [level.rooms[0].id], false);
  assert.equal(caps().length, 0);
  const section = buildSection(p, view);
  assert.ok(!section.cuts.some((cut) => cut.kind === 'roof'));
  assert.ok(section.cuts.some((cut) => cut.kind === 'slab'));
  const slab = sectionProfile(p, path, 'left').prims.filter((part) => part.kind === 'house-slab'
    && part.pts.some((pt) => pt.z > 2000));
  const lowerEdge = Math.min(...slab.flatMap((part) => part.pts.map((pt) => pt.x)));
  assert.ok(lowerEdge > 5000, 'нижняя крыша исчезла; плита сохранилась только под верхним этажом');
  assert.ok(!buildElevation(p, 'N').polys.some((poly) => poly.kind === 'roof'));
});

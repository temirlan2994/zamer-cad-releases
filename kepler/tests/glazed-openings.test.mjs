import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, serializeProject, deserializeProject } from '../core/model.js';
import { glazedOpeningParts, glazedAssemblySpec, resizeGlazedOpening, setGlazedPartSize, setGlazedWindow } from '../core/glazed-openings.js';
import { applyOpeningPreset } from '../core/opening-preset.js';
import { OPENING_PRESETS, presetToOpening } from '../core/opening-catalog.js';
import { deriveWalls, doorLeaves, doorLink } from '../core/walls.js';
import { levelWindowOpenings } from '../core/spanning-windows.js';
import { analyzeConnectivity } from '../core/rooms.js';
import { buildHouseMesh, levelWallSolids } from '../core/mesh3d.js';
import { buildIfc } from '../core/ifc.js';
import { buildStructuredExport } from '../core/export.js';
import { projectToLayoutInput } from '../core/layout-contract.js';
import { buildRoomContext } from '../core/furnish.js';
import { windowsOf } from '../core/insolation.js';

function fixture(type = 'balcony-swing', width = 2200) {
  const p = createProject();
  const room = createRoom('living', 0, 0, 6000, 4000);
  const opening = createOpening('window', room.id, 0, 3000, width);
  Object.assign(opening, { type, height: 2300, sill: 0, heightMode: 'custom', assembly: {} });
  p.rooms.push(room); p.openings.push(opening);
  return { p, room, opening };
}

test('балконный блок: дверь от пола, окно с подоконником, простенок и один исходный объект', () => {
  const { p, opening } = fixture();
  const before = JSON.stringify(opening);
  const parts = levelWindowOpenings(p, deriveWalls(p));
  assert.equal(p.openings.length, 1);
  assert.deepEqual(parts.map(({ kind, type, width, sill, height, offset }) => ({ kind, type, width, sill, height, offset })), [
    { kind: 'door', type: 'single', width: 900, sill: 0, height: 2300, offset: 2350 },
    { kind: 'window', type: 'fixed', width: 1200, sill: 900, height: 1400, offset: 3500 },
  ]);
  assert.equal(JSON.stringify(opening), before, 'проекции не меняют исходный блок');
  opening.assembly = { doorSide: 'end', doorWidth: 800, windowSill: 1100 };
  const [door, window] = glazedOpeningParts(opening);
  assert.equal(door.offset, 3700);
  assert.equal(window.offset, 2550);
  assert.equal(window.sill, 1100);
  assert.equal(window.height, 1200);
});

test('остекление: распашная створка, две створки и раздвижной портал действительно соединяют пространства', () => {
  for (const [type, width, count] of [['glazed-swing', 2400, 1], ['glazed-double', 1800, 2], ['glazed-sliding', 3000, 0]]) {
    const { p, room, opening } = fixture(type, width);
    const walls = deriveWalls(p);
    assert.deepEqual(doorLink(p, opening, walls), [room.id, 'outside']);
    assert.equal(doorLeaves(p, opening, walls).length, count);
    assert.ok(analyzeConnectivity(p, walls).reachable.has(room.id));
    assert.ok(buildRoomContext(p, room, walls).doorCells.length, 'расстановка оставляет проход к двери');
    assert.ok(windowsOf(p).length, 'стеклянные двери участвуют в освещении');
  }
});

test('3D: под окном остаётся стена, дверная часть вырезается до пола, обе части остеклены', () => {
  const { p, opening } = fixture();
  const walls = deriveWalls(p);
  const { voids } = levelWallSolids(p, walls, 3000);
  assert.deepEqual(voids.map(({ bottom, top }) => [bottom, top]), [[0, 2300], [900, 2300]]);
  const glass = buildHouseMesh(p, { roof: false, site: false }).filter((face) => face.kind === 'glass' && face.openingId === opening.id);
  assert.equal(glass.length, 2);
  assert.deepEqual(glass.map((face) => Math.min(...face.pts.map((p) => p.z))).sort((a, b) => a - b), [0, 900]);
});

test('ручная стена: обе проекции следуют общей точке привязки', () => {
  const { opening } = fixture();
  opening.roomId = null; delete opening.offset; delete opening.side;
  opening.host = { wallId: 'manual-wall', t: 4000 };
  const [door, window] = glazedOpeningParts(opening);
  assert.deepEqual(door.host, { wallId: 'manual-wall', t: 3350 });
  assert.deepEqual(window.host, { wallId: 'manual-wall', t: 4500 });
  assert.deepEqual(opening.host, { wallId: 'manual-wall', t: 4000 });
});

test('пресеты и файл сохраняют единый блок и его настройки', () => {
  for (const preset of OPENING_PRESETS.filter((p) => p.cat === 'with-door')) {
    const { p, opening } = fixture();
    applyOpeningPreset(opening, presetToOpening(preset));
    opening.assembly = { doorWidth: 800, doorSide: 'end', windowSill: 1000 };
    const restored = deserializeProject(serializeProject(p)).openings[0];
    assert.equal(restored.type, preset.type);
    assert.deepEqual(restored.assembly, opening.assembly);
    assert.equal(restored.heightMode, 'custom');
    assert.ok(glazedAssemblySpec(restored));
  }
});

test('экспорт и решатель получают дверь и окно с разными id внутри общего блока', () => {
  const { p, opening } = fixture();
  const { text, counts } = buildIfc(p);
  assert.equal(counts.doors, 1); assert.equal(counts.windows, 1);
  const guids = [...text.matchAll(/=IFC(?:OPENINGELEMENT|DOOR|WINDOW)\('([^']+)'/g)].map((m) => m[1]);
  assert.equal(guids.length, 4); assert.equal(new Set(guids).size, 4);
  const exported = buildStructuredExport(p).levels[0].openings;
  assert.equal(new Set(exported.map((o) => o.id)).size, 2);
  assert.ok(exported.every((o) => o.assembly_id === opening.id));
  const contract = projectToLayoutInput(p);
  assert.equal(new Set(contract.openings.map((o) => o.id)).size, 2);
  assert.ok(contract.openings.some((o) => o.kind === 'hinged_door'));
});

test('окна независимо добавляются слева и справа, дверь сохраняет ширину, удалённая секция помнит свой размер', () => {
  for (const type of ['glazed-swing', 'balcony-swing']) {
    const { opening } = fixture(type, type.startsWith('balcony') ? 2200 : 2400);
    const initial = structuredClone(opening);
    const doorWidth = glazedAssemblySpec(opening).doorWidth;
    const rightWidth = glazedAssemblySpec(opening).rightWidth;
    const update = setGlazedWindow(opening, 'left', true, 700);
    assert.deepEqual(opening, initial, 'расчёт не меняет исходный объект');
    Object.assign(opening, update);
    let parts = glazedOpeningParts(opening);
    assert.deepEqual(parts.map((p) => p.assemblyPart), ['door', 'window-left', 'window-right']);
    assert.deepEqual(parts.map((p) => p.width), [doorWidth, 700, rightWidth]);
    const centers = parts.map((p) => p.offset);
    assert.ok(centers[1] < centers[0] && centers[0] < centers[2]);
    Object.assign(opening, setGlazedWindow(opening, 'right', false));
    parts = glazedOpeningParts(opening);
    assert.deepEqual(parts.map((p) => p.assemblyPart), ['door', 'window-left']);
    Object.assign(opening, setGlazedWindow(opening, 'left', false));
    assert.equal(opening.width, doorWidth);
    assert.deepEqual(glazedOpeningParts(opening).map((p) => p.kind), ['door']);
    Object.assign(opening, setGlazedWindow(opening, 'right', true));
    assert.equal(glazedAssemblySpec(opening).rightWidth, rightWidth);
    assert.equal(glazedAssemblySpec(opening).doorWidth, doorWidth);
    Object.assign(opening, setGlazedWindow(opening, 'left', true));
    assert.equal(glazedAssemblySpec(opening).leftWidth, 700);
  }
});

test('двусторонний блок сохраняет обе секции в файле, 3D и экспорте с уникальными id', () => {
  const { p, opening } = fixture();
  Object.assign(opening, setGlazedWindow(opening, 'left', true, 600));
  const restored = deserializeProject(serializeProject(p));
  assert.deepEqual(restored.openings[0].assembly, opening.assembly);
  const parts = levelWindowOpenings(restored, deriveWalls(restored));
  assert.equal(parts.length, 3);
  const glass = buildHouseMesh(restored, { roof: false, site: false }).filter((f) => f.kind === 'glass' && f.openingId === opening.id);
  assert.equal(glass.length, 3);
  const { text, counts } = buildIfc(restored);
  assert.equal(counts.doors, 1); assert.equal(counts.windows, 2);
  const guids = [...text.matchAll(/=IFC(?:OPENINGELEMENT|DOOR|WINDOW)\('([^']+)'/g)].map((m) => m[1]);
  assert.equal(guids.length, 6); assert.equal(new Set(guids).size, 6);
  const exported = buildStructuredExport(restored).levels[0].openings;
  assert.equal(new Set(exported.map((o) => o.id)).size, 3);
});

test('ширина и высота окна не меняют дверь или соседнее окно, в том числе при несовпадающем верхе', () => {
  const { p, opening } = fixture('balcony-sliding', 3000);
  Object.assign(opening, setGlazedWindow(opening, 'left', true, 600));
  const doorBefore = glazedOpeningParts(opening)[0];
  const leftBefore = glazedOpeningParts(opening)[1];
  Object.assign(opening, setGlazedPartSize(opening, 'right', 'width', 1000));
  Object.assign(opening, setGlazedPartSize(opening, 'right', 'height', 1800));
  let [door, left, right] = glazedOpeningParts(opening);
  assert.deepEqual([door.width, door.height], [doorBefore.width, doorBefore.height]);
  assert.deepEqual([left.width, left.height], [leftBefore.width, leftBefore.height]);
  assert.deepEqual([right.width, right.height, right.sill], [1000, 1800, 900]);
  assert.equal(opening.height, 2700);
  Object.assign(opening, setGlazedPartSize(opening, 'windows', 'sill', 1100));
  [door, , right] = glazedOpeningParts(opening);
  assert.equal(door.height, 2300);
  assert.equal(right.height, 1800);
  assert.equal(opening.height, 2900);
  const glass = buildHouseMesh(p, { site: false, roof: false }).filter((f) => f.kind === 'glass' && f.openingId === opening.id);
  assert.deepEqual(glass.map((f) => Math.max(...f.pts.map((p) => p.z))).sort((a, b) => a - b), [2300, 2500, 2900]);
  const restored = deserializeProject(serializeProject(p));
  assert.deepEqual(glazedOpeningParts(restored.openings[0]).map((p) => [p.width, p.height]), [[1800, 2300], [600, 1400], [1000, 1800]]);
});

test('общая рамка старого блока с неявной шириной двери меняет только окна', () => {
  const { opening } = fixture('balcony-sliding', 3000);
  assert.deepEqual(opening.assembly, {});
  Object.assign(opening, resizeGlazedOpening(opening, { width: 3500, height: 2600 }));
  let parts = glazedOpeningParts(opening);
  assert.deepEqual(parts.map((p) => [p.width, p.height]), [[1800, 2300], [1600, 1700]]);
  Object.assign(opening, resizeGlazedOpening(opening, { width: 2400, height: 1900 }));
  parts = glazedOpeningParts(opening);
  assert.deepEqual(parts.map((p) => [p.width, p.height]), [[1800, 2300], [500, 1000]]);
  assert.equal(opening.height, 2300, 'дверь определяет габарит, если окно ниже неё');
});

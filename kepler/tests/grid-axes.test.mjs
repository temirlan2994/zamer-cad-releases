// Координационные оси (core/grid-axes.js): марки (русские буквы по ГОСТ),
// создание и нормализация, сортировка и перенумерация, пределы линии,
// привязка (ближайшая ось, прямоугольник к осям), «Оси по стенам» на доме-
// примере и на файле пользователя, цепочка размеров, сохранение v7/v6,
// JSON-экспорт; магнит комнат к осям (ui/block-gesture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRID_LETTERS, autoGrids, createGrid, gridChain, gridExtent, gridLabelAt, gridLabelIndex, gridLinesByWalls,
  gridOffsets, gridWallPoints, houseBox, moveGrid, nearestGrid, nextGridLabel, normalizeGrid, normalizeGrids,
  outerFaces, renumberGrids, resetGridExtent, setGridExtent, snapGridValue, snapRectToGrids, sortGrids,
} from '../core/grid-axes.js';
import {
  createProject, createRoom, deserializeProject, fileDataV6, hasContent, levelProject, serializeProject,
} from '../core/model.js';
import { buildStructuredExport } from '../core/export.js';
import { deriveWalls } from '../core/walls.js';
import { snapWallPoint } from '../core/wall-manual.js';

const USER = new URL('./fixtures/user-house-joints-2026-11.kepler.json', import.meta.url);

// Дом-пример (как ui/sample.js, без DOM): 4 комнаты + вложенный санузел.
function sampleHouse() {
  const p = createProject('Пример');
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  const bath = createRoom('bathroom', 2900, 1900, 2000, 2000);
  bath.parentId = bedroom.id;
  p.rooms.push(bedroom, bath, createRoom('living', 5100, 0, 5000, 4200), createRoom('kitchen', 5100, 4300, 3600, 3000),
    createRoom('hall', 0, 4100, 3000, 2400));
  return p;
}

test('марки: 1, 2, 3… и русские буквы без Ё, З, Й, О, Ч, Ы, Ь, Ъ; дальше А1, Б1', () => {
  assert.equal(GRID_LETTERS.length, 25);
  for (const bad of 'ЁЗЙОЧЫЬЪ') assert.equal(GRID_LETTERS.includes(bad), false, bad);
  assert.deepEqual([0, 1, 2].map((i) => gridLabelAt('x', i)), ['1', '2', '3']);
  assert.deepEqual([0, 1, 2, 6, 7].map((i) => gridLabelAt('y', i)), ['А', 'Б', 'В', 'Ж', 'И']);
  assert.equal(gridLabelAt('y', 24), 'Я');
  assert.equal(gridLabelAt('y', 25), 'А1');
  assert.equal(gridLabelAt('y', 26), 'Б1');
  for (const i of [0, 5, 24, 25, 60]) assert.equal(gridLabelIndex('y', gridLabelAt('y', i)), i);
  assert.equal(gridLabelIndex('x', '12'), 11);
  assert.equal(gridLabelIndex('y', 'З'), -1);
  assert.equal(nextGridLabel([{ kind: 'x', label: '1' }, { kind: 'x', label: '3' }, { kind: 'y', label: '2' }], 'x'), '2');
  assert.equal(nextGridLabel([{ kind: 'y', label: 'А' }], 'y'), 'Б');
});

test('создание и нормализация: битые отброшены, дубли id, пустые марки, from/to', () => {
  const a = createGrid({ kind: 'x', at: 1234.6 });
  assert.deepEqual([a.kind, a.at, a.label], ['x', 1235, '1']);
  const b = createGrid({ kind: 'y', at: 0, from: 5000, to: -1000 }, [a]);
  assert.deepEqual([b.label, b.from, b.to], ['А', -1000, 5000]);
  assert.equal(normalizeGrid(null), null);
  assert.equal(normalizeGrid({ kind: 'z', at: 1 }), null);
  assert.equal(normalizeGrid({ kind: 'x', at: 'a' }), null);
  const g = normalizeGrid({ id: 'g1', kind: 'h', at: '250', label: ' Б ', from: 3, to: 3, hidden: 'yes' });
  assert.deepEqual(g, { id: 'g1', label: 'Б', kind: 'y', at: 250 });
  const list = normalizeGrids([{ id: 'a', kind: 'x', at: 0 }, 'мусор', { id: 'a', kind: 'x', at: 6000, label: '' }, { kind: 'y', at: 0, hidden: true }]);
  assert.equal(list.length, 3);
  assert.notEqual(list[0].id, list[1].id);
  assert.deepEqual(list.map((x) => x.label), ['1', '2', 'А']);
  assert.equal(list[2].hidden, true);
  assert.deepEqual(normalizeGrids('x'), []);
});

test('сортировка, перенумерация, сдвиг, пределы', () => {
  const gs = [
    { id: 'c', kind: 'x', at: 6000, label: '?' }, { id: 'a', kind: 'x', at: 0, label: '?' },
    { id: 'y1', kind: 'y', at: 0, label: '?' }, { id: 'y2', kind: 'y', at: 4000, label: '?' },
  ];
  assert.deepEqual(sortGrids(gs).map((g) => g.id), ['a', 'c', 'y2', 'y1']);
  const r = renumberGrids(gs);
  assert.deepEqual(Object.fromEntries(r.map((g) => [g.id, g.label])), { a: '1', c: '2', y2: 'А', y1: 'Б' });
  assert.equal(gs[0].label, '?', 'исходный список не меняется');
  assert.equal(moveGrid(gs[0], 6100.4).at, 6100);
  const e = setGridExtent(gs[0], 5000, -2000);
  assert.deepEqual([e.from, e.to], [-2000, 5000]);
  assert.equal(setGridExtent(gs[0], 0, 100).from, undefined, 'короче 300 мм — без изменений');
  assert.equal('from' in resetGridExtent(e), false);
});

test('пределы линии: габарит дома (по наружной грани) + 1500 мм или свои from/to', () => {
  const p = sampleHouse();
  const box = houseBox(p);
  assert.deepEqual(box, { minX: -250, minY: -250, maxX: 10350, maxY: 7550 });
  const gx = createGrid({ kind: 'x', at: 0 });
  assert.deepEqual(gridExtent(p, gx), { from: -1750, to: 9050 });
  assert.deepEqual(gridExtent(p, { ...gx, from: 0, to: 100 }), { from: 0, to: 100 });
  const empty = createProject('пусто');
  assert.deepEqual(gridExtent(empty, gx), { from: -4500, to: 4500 });
  empty.grids = [{ id: 'y', kind: 'y', at: 2000, label: 'А' }];
  assert.deepEqual(gridExtent(empty, gx), { from: 500, to: 3500 });
});

test('привязка: ближайшая ось, значение к линии или шагу, точки для стен', () => {
  const gs = [{ id: '1', kind: 'x', at: 0, label: '1' }, { id: '2', kind: 'x', at: 6000, label: '2' }, { id: 'h', kind: 'x', at: 3000, label: '3', hidden: true }];
  assert.equal(nearestGrid(gs, 'x', 5800).grid.id, '2');
  assert.equal(nearestGrid(gs, 'x', 3000, 500), null, 'скрытая ось не притягивает');
  assert.equal(nearestGrid(gs, 'y', 0), null);
  assert.deepEqual(snapGridValue(5930, [6000], 100, 50), { value: 6000, line: 6000 });
  assert.deepEqual(snapGridValue(5730, [6000], 100, 50), { value: 5750, line: null });
  const pts = gridWallPoints(gs);
  assert.equal(pts.length, 2);
  const s = snapWallPoint({ p: { x: 5950, y: 1234 }, points: pts, tol: 100, grid: 100 });
  assert.deepEqual(s.point, { x: 6000, y: 1200 }, 'у вертикальной оси привязка только по x');
});

test('прямоугольник к осям: грань комнаты, наружная грань стены, ось стены; растяжение', () => {
  const gs = [{ id: 'g1', kind: 'x', at: 0, label: '1' }, { id: 'gA', kind: 'y', at: 6000, label: 'А' }];
  const rect = { x: 200, y: 1000, w: 4000, h: 4900 };
  const face = snapRectToGrids(rect, gs, { offsets: gridOffsets('face', 250) });
  assert.equal(face.x, 250, 'левая грань комнаты — на толщину стены от оси (наружная грань на оси)');
  assert.equal(face.y, 6000 - 4900 - 0, 'нижняя грань — на оси (ближе всего)');
  assert.deepEqual([face.snappedX, face.snappedY], [true, true]);
  assert.equal(face.guides[0].gridId, 'g1');
  assert.equal(face.guides[0].at, 0, 'направляющая идёт по оси');
  const axis = snapRectToGrids(rect, gs, { offsets: gridOffsets('axis', 250) });
  assert.equal(axis.x, 125, 'ось стены (125 мм от грани) — на оси');
  const far = snapRectToGrids({ ...rect, x: 700 }, gs, { offsets: [0] });
  assert.equal(far.snappedX, false, 'дальше 300 мм — не тянет');
  const rs = snapRectToGrids({ x: 1000, y: 0, w: 4800, h: 1000 }, [{ id: 'g', kind: 'x', at: 6000, label: '2' }], { edges: ['e'], offsets: [0] });
  assert.deepEqual([rs.x, rs.w], [1000, 5000], 'растяжение: двигается только правая грань');
});

test('«Оси по стенам» на доме-примере: наружные грани, нумерация, цепочка до габарита', () => {
  const p = sampleHouse();
  const walls = deriveWalls(p);
  const lines = gridLinesByWalls(p, { walls });
  // Наружные грани (с выемкой между прихожей и кухней); перегородки короче 2 м осей не дают.
  assert.deepEqual(lines.x, [-250, 3250, 4850, 8950, 10350]);
  const fresh = autoGrids(p, { walls });
  const xs = fresh.filter((g) => g.kind === 'x');
  const ys = fresh.filter((g) => g.kind === 'y');
  assert.deepEqual(xs.map((g) => [g.label, g.at]), [['1', -250], ['2', 3250], ['3', 4850], ['4', 8950], ['5', 10350]]);
  // А — внизу (ось Y плана вниз): у самого большого y.
  const a = ys.find((g) => g.label === 'А');
  assert.equal(a.at, Math.max(...ys.map((g) => g.at)));
  const box = houseBox(p);
  const sum = gridChain(fresh, 'x').reduce((s, c) => s + c.distance, 0);
  assert.equal(sum, box.maxX - box.minX);
  const sumY = gridChain(fresh, 'y').reduce((s, c) => s + c.distance, 0);
  assert.equal(sumY, box.maxY - box.minY);
  // Повторно — только недостающие: ничего.
  p.grids = fresh;
  assert.equal(autoGrids(p, { walls }).length, 0);
  // Без одной оси — добавится только она, со свободной маркой.
  p.grids = fresh.filter((g) => g.label !== '2');
  const again = autoGrids(p, { walls });
  assert.deepEqual(again.map((g) => [g.label, g.at]), [['2', 3250]]);
  // По оси стен — на полтолщины ближе.
  assert.deepEqual(gridLinesByWalls(p, { walls, mode: 'axis' }).x, [-125, 3125, 4975, 8825, 10225]);
  // Несущая стена даёт ось.
  const bearing = [{ kind: 'shared', wallType: 'bearing', orient: 'v', band: { x: 6400, y: 0, w: 200, h: 4200 } }];
  assert.ok(gridLinesByWalls(p, { walls: bearing }).x.includes(6500));
});

test('«Оси по стенам» на файле пользователя (13 комнат): ≤ 12 на направление, наружные грани покрыты', () => {
  const p = deserializeProject(readFileSync(USER, 'utf8'));
  assert.equal(p.rooms.length, 13);
  const walls = deriveWalls(levelProject(p, p.levels[0].id));
  const fresh = autoGrids(p, { walls });
  const xs = fresh.filter((g) => g.kind === 'x').sort((a, b) => a.at - b.at);
  const ys = fresh.filter((g) => g.kind === 'y').sort((a, b) => a.at - b.at);
  assert.ok(xs.length >= 2 && xs.length <= 12, `x: ${xs.length}`);
  assert.ok(ys.length >= 2 && ys.length <= 12, `y: ${ys.length}`);
  assert.deepEqual(xs.map((g) => g.label), xs.map((_, i) => String(i + 1)), 'слева направо');
  assert.equal(ys[ys.length - 1].label, 'А', 'А — внизу');
  // Каждая наружная грань стен дома (длиннее 1 м) — у оси в пределах 300 мм.
  const faces = outerFaces(p, 250);
  for (const f of faces.v.filter((e) => e.len >= 1000)) assert.ok(xs.some((g) => Math.abs(g.at - f.at) <= 300), `x=${f.at}`);
  for (const f of faces.h.filter((e) => e.len >= 1000)) assert.ok(ys.some((g) => Math.abs(g.at - f.at) <= 300), `y=${f.at}`);
  // Соседние оси не ближе 300 мм; цепочка — от крайней до крайней.
  for (const c of [...gridChain(fresh, 'x'), ...gridChain(fresh, 'y')]) assert.ok(c.distance >= 300);
  const box = houseBox(p);
  assert.equal(gridChain(fresh, 'x').reduce((s, c) => s + c.distance, 0), xs[xs.length - 1].at - xs[0].at);
  assert.ok(Math.abs(xs[0].at - box.minX) <= 300 && Math.abs(xs[xs.length - 1].at - box.maxX) <= 300);
});

test('сохранение: kepler-plan/7 и v6 хранят оси, экспорт JSON, старый проект без поля', () => {
  const p = sampleHouse();
  p.grids = autoGrids(p, { walls: deriveWalls(p) });
  p.grids[0] = { ...p.grids[0], from: -3000, to: 9000, hidden: true };
  assert.equal(hasContent({ levels: [{ rooms: [] }], grids: p.grids }), true);
  const text = serializeProject(p);
  assert.match(text, /"grids"/);
  const back = deserializeProject(text);
  assert.deepEqual(back.grids, p.grids);
  const v6 = deserializeProject(JSON.stringify(fileDataV6(p)));
  assert.deepEqual(v6.grids, p.grids);
  const old = deserializeProject(serializeProject(createProject('old')));
  assert.equal('grids' in old, false);
  const broken = deserializeProject(JSON.stringify({ ...JSON.parse(text), grids: [{ kind: 'q' }, 5, { kind: 'x', at: 10 }] }));
  assert.equal(broken.grids.length, 1);
  assert.equal(broken.grids[0].label, '1');
  const exp = buildStructuredExport(back);
  assert.equal(exp.grids.length, p.grids.length);
  assert.equal('grids' in buildStructuredExport(old), false);
});

test('чистота: функции не меняют входные данные', () => {
  const p = sampleHouse();
  const walls = deriveWalls(p);
  p.grids = [{ id: 'a', kind: 'x', at: 0, label: '1' }];
  const before = JSON.stringify({ rooms: p.rooms, grids: p.grids });
  autoGrids(p, { walls });
  gridLinesByWalls(p, { walls });
  snapRectToGrids({ x: 10, y: 0, w: 100, h: 100 }, p.grids, {});
  renumberGrids(p.grids);
  sortGrids(p.grids);
  assert.equal(JSON.stringify({ rooms: p.rooms, grids: p.grids }), before);
});

test('магнит: комната у оси примагничивается; без оси — как раньше; Shift/Alt и тумблер отключают', async () => {
  const { state } = await import('../ui/state.js');
  const { magnetMove, magnetResize } = await import('../ui/block-gesture.js');
  const p = createProject('магнит');
  const room = createRoom('living', 0, 0, 4000, 3000);
  p.rooms.push(room);
  state.project = p;
  state.modeName = 'plan';
  state.planGrid = { on: true, dims: false, sheets: true, snap: 'face' };
  state.snapSettings = { magnet: true };
  const rect = { x: 9870, y: 5000, w: 4000, h: 3000 };
  const plain = magnetMove({}, room.id, rect, null, {});
  assert.equal(plain.x, 9870, 'без осей — как раньше');
  p.grids = [{ id: 'g2', kind: 'x', at: 10000, label: '2' }];
  const snapped = magnetMove({}, room.id, rect, null, {});
  assert.equal(snapped.x, 10000, 'грань комнаты на оси');
  assert.equal(snapped.snappedX, true);
  assert.ok(snapped.guides.some((g) => g.gridId === 'g2' && g.at === 10000));
  const outer = magnetMove({}, room.id, { ...rect, x: 10200 }, null, {});
  assert.equal(outer.x, 10250, 'наружная грань стены на оси');
  state.planGrid = { ...state.planGrid, snap: 'axis' };
  assert.equal(magnetMove({}, room.id, { ...rect, x: 10200 }, null, {}).x, 10125, 'ось стены на оси');
  state.planGrid = { ...state.planGrid, snap: 'face' };
  assert.equal(magnetMove({}, room.id, rect, null, { shiftKey: true }).x, 9870, 'Shift — без привязки');
  assert.equal(magnetMove({}, room.id, rect, null, { altKey: true }).x, 9870, 'Alt — без привязки');
  state.snapSettings = { magnet: false };
  assert.equal(magnetMove({}, room.id, rect, null, {}).x, 9870, 'тумблер магнита выключен');
  state.snapSettings = { magnet: true };
  state.planGrid = { ...state.planGrid, on: false };
  assert.equal(magnetMove({}, room.id, rect, null, {}).x, 9870, 'оси скрыты — не тянут');
  state.planGrid = { ...state.planGrid, on: true };
  p.grids = [{ id: 'g3', kind: 'x', at: 14000, label: '3' }];
  const rs = magnetResize({}, room.id, { x: 10000, y: 5000, w: 3950, h: 3000 }, 'e', {});
  assert.equal(rs.rect.x + rs.rect.w, 14000, 'растяжение: правая грань на оси');
  state.project = null;
});

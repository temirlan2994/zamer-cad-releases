// Листы пользователя и видовые экраны (core/views.js): ключи видов,
// нормализация, один вид — один лист, правка видовых экранов, подбор
// масштаба, совместимость с автолистами sheetPlan() и сохранение v7/v6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createProject, createRoom, deserializeProject, fileDataV6, projectFromData, serializeProject } from '../core/model.js';
import {
  addSheet, allViews, findViewport, fitViewportScale, moveViewport, nextSheetNo, normalizeViewsAndSheets, placeView,
  planExtent, removeSheet, removeViewport, setViewportScale, sheetFrame, sheetOfView, sheetSize, updateSheet, viewById,
  viewKey, viewportTitle, addSectionView,
} from '../core/views.js';
import { sheetKey, sheetList, sheetPlan } from '../ui/sheet.js';

function house() {
  const p = createProject('Дом');
  p.rooms.push(createRoom('living', 0, 0, 12000, 8000));
  p.levels.push(createLevel('Мансарда', 3000, 2700, 'L2'));
  return p;
}

test('viewKey/viewById: ключи вычисляемых и сохранённых видов', () => {
  const p = house();
  assert.equal(viewKey({ kind: 'plan', levelId: 'L1' }), 'plan:L1');
  assert.equal(viewKey({ kind: 'lsection', sectionId: 'a' }), 'section:a');
  assert.equal(viewKey({ kind: 'elevation', id: 'elev-N' }), 'elev-N');
  assert.equal(viewKey({ kind: '3d' }), '3d');
  assert.equal(viewKey('site'), 'site');
  assert.equal(viewById(p, 'plan:L1').name, 'План: 1 этаж');
  assert.equal(viewById(p, 'plan:нет'), null);
  assert.equal(viewById(p, 'elev-S').name, 'Фасад Юг');
  assert.equal(viewById(p, '3d').kind, '3d');
  assert.equal(viewById(p, 'sec-1'), null);
  const sec = addSectionView(p, { levelId: 'L1', a: { x: 0, y: 4000 }, b: { x: 12000, y: 4000 } });
  assert.equal(viewById(p, sec.id).kind, 'section');
  const ids = allViews(p).map((v) => v.id);
  assert.deepEqual(ids, ['plan:L1', 'plan:L2', 'site', 'landscape', '3d', 'sec-1', 'elev-N', 'elev-S', 'elev-W', 'elev-E']);
  for (const v of allViews(p)) assert.equal(viewKey(v), v.id);
});

test('лист: размеры форматов, рамка A3 как у автолистов', () => {
  assert.deepEqual(sheetSize({ format: 'A3', orient: 'landscape' }), { w: 420, h: 297 });
  assert.deepEqual(sheetSize({ format: 'A4', orient: 'portrait' }), { w: 210, h: 297 });
  assert.deepEqual(sheetSize({ format: 'A1' }), { w: 841, h: 594 });
  const f = sheetFrame({ w: 420, h: 297 });
  assert.deepEqual(f.frame, { x0: 20, y0: 5, x1: 415, y1: 292 });
  assert.deepEqual(f.stamp, { x0: 230, y0: 237 });
  assert.deepEqual(f.area, { x0: 25, y0: 10, x1: 410, y1: 232 });
});

test('подбор масштаба: план дома 12×8 м на A3 альбомном — 1:100', () => {
  const p = house();
  const e = planExtent(p);
  assert.deepEqual(e, { w: 12000 + 3700, h: 8000 + 3700 }); // поле под стены и размеры
  const a3 = { format: 'A3', orient: 'landscape' };
  assert.equal(fitViewportScale(e.w, e.h, a3), 100);
  assert.equal(fitViewportScale(6000, 4000, a3), 50);
  assert.equal(fitViewportScale(80000, 50000, a3), 500);
  assert.equal(fitViewportScale(e.w, e.h, { format: 'A1' }), 50);
  assert.equal(planExtent({ rooms: [] }), null);
});

test('листы: добавить, вид на лист, один вид — один лист, сдвиг, масштаб, удалить', () => {
  const p = house();
  assert.equal(nextSheetNo(p, 3), '4');
  const s1 = addSheet(p, { no: nextSheetNo(p, 3) });
  assert.deepEqual({ ...s1, viewports: s1.viewports.length }, { id: 'sh-1', no: '4', name: 'Лист 4', format: 'A3', orient: 'landscape', viewports: 0 });
  const s2 = addSheet(p, { no: nextSheetNo(p, 3), format: 'A2', orient: 'portrait' });
  assert.equal(s2.no, '5');
  assert.equal(s2.id, 'sh-2');
  const r = placeView(p, s1.id, 'elev-N', { x: 100, y: 80, scale: 100 });
  assert.ok(r.viewport);
  assert.deepEqual(r.viewport, { id: 'vp-1', viewId: 'elev-N', x: 100, y: 80, scale: 100 });
  assert.equal(sheetOfView(p, 'elev-N'), s1);
  // Повторно — на другой лист нельзя (как в Revit).
  const again = placeView(p, s2.id, 'elev-N', { x: 10, y: 10 });
  assert.equal(again.error, 'placed');
  assert.equal(again.sheet, s1);
  assert.equal(placeView(p, s2.id, 'plan:нет').error, 'missing');
  // Без точки — в центр поля чертежа.
  const c = placeView(p, s1.id, 'plan:L1').viewport;
  assert.deepEqual([c.x, c.y, c.id], [217.5, 121, 'vp-2']);
  // Сдвиг: шаг 5 мм, Shift — свободно, не за край листа.
  moveViewport(p, 'vp-1', 123.4, 77.6);
  assert.deepEqual([r.viewport.x, r.viewport.y], [125, 80]);
  moveViewport(p, 'vp-1', 123.4, 77.6, { snap: 0 });
  assert.deepEqual([r.viewport.x, r.viewport.y], [123.4, 77.6]);
  moveViewport(p, 'vp-1', -50, 900);
  assert.deepEqual([r.viewport.x, r.viewport.y], [0, 297]);
  setViewportScale(p, 'vp-1', 200);
  assert.equal(r.viewport.scale, 200);
  assert.equal(viewportTitle(p, r.viewport), 'Фасад Север');
  // Перенос на другой лист: снять и положить.
  assert.equal(removeViewport(p, 'vp-1'), true);
  assert.equal(findViewport(p, 'vp-1'), null);
  assert.ok(placeView(p, s2.id, 'elev-N', { scale: 50 }).viewport);
  assert.equal(sheetOfView(p, 'elev-N'), s2);
  // Правка листа: формат меньше — виды остаются на листе.
  updateSheet(p, s2.id, { name: 'Фасады', no: '7', format: 'A4', orient: 'landscape' });
  assert.deepEqual([s2.name, s2.no, s2.format], ['Фасады', '7', 'A4']);
  assert.ok(s2.viewports.every((vp) => vp.x <= 297 && vp.y <= 210));
  updateSheet(p, s2.id, { format: 'B5', name: '  ' });
  assert.deepEqual([s2.name, s2.format], ['Фасады', 'A4']);
  assert.equal(nextSheetNo(p, 3), '8');
  assert.equal(removeSheet(p, s1.id), true);
  assert.equal(removeSheet(p, s2.id), true);
  assert.equal(p.sheets, undefined, 'последний лист — поля нет');
});

test('нормализация: битые виды отбрасываются, дубли id, вид — только на первом листе', () => {
  const data = {
    sheetsAuto: true,
    sheets: [
      { id: 'a', no: 1, name: '', format: 'B2', orient: 'x', viewports: [
        { id: 'v', viewId: 'elev-N', x: 10, y: 20, scale: 100 },
        { id: 'v', viewId: 'plan:L1', x: '30', y: 40, scale: 50 },
        { viewId: 'site', x: 1, y: 2, scale: 500, title: 'Генплан' },
        { viewId: '', x: 1, y: 1, scale: 1 }, { viewId: 'site', x: NaN, y: 1, scale: 1 }, { viewId: 'x', x: 1, y: 1, scale: 0 }, null,
      ] },
      { id: 'a', name: 'дубль' },
      { id: 'b', viewports: [{ id: 'v', viewId: 'elev-N', x: 1, y: 1, scale: 100 }, { id: 'v', viewId: '3d', x: 5, y: 5, scale: 100 }] },
      'мусор',
    ],
  };
  normalizeViewsAndSheets(data);
  assert.equal(data.sheetsAuto, undefined);
  assert.deepEqual(data.sheets.map((s) => s.id), ['a', 'b']);
  const [a, b] = data.sheets;
  assert.deepEqual([a.no, a.name, a.format, a.orient], ['1', 'Лист 1', 'A3', 'landscape']);
  assert.deepEqual(a.viewports.map((v) => [v.id, v.viewId]), [['v', 'elev-N'], ['vp-1', 'plan:L1'], ['vp-2', 'site']]);
  assert.equal(a.viewports[1].x, 30);
  assert.equal(a.viewports[2].title, 'Генплан');
  assert.deepEqual(b.viewports.map((v) => v.viewId), ['3d'], 'фасад Север уже на листе a');
  assert.notEqual(b.viewports[0].id, 'v', 'id видовых экранов уникальны по проекту');
  const off = { sheetsAuto: false };
  normalizeViewsAndSheets(off);
  assert.equal(off.sheetsAuto, false);
});

test('сохранение: листы и виды переживают файл v7 и v6', () => {
  const p = house();
  const s = addSheet(p, { no: '3', format: 'A2' });
  placeView(p, s.id, 'elev-N', { x: 150, y: 100, scale: 100 });
  placeView(p, s.id, 'plan:L1', { x: 300, y: 200, scale: 50, title: 'План первого' });
  p.sheetsAuto = false;
  const back = deserializeProject(serializeProject(p));
  assert.equal(JSON.parse(serializeProject(p)).schema, 'kepler-plan/7');
  assert.deepEqual(back.sheets, p.sheets);
  assert.equal(back.sheetsAuto, false);
  const v6 = projectFromData(JSON.parse(JSON.stringify(fileDataV6(p))));
  assert.deepEqual(v6.sheets, p.sheets);
  assert.equal(v6.sheetsAuto, false);
  const plain = deserializeProject(serializeProject(house()));
  assert.equal(plain.sheets, undefined);
  assert.equal(plain.sheetsAuto, undefined);
});

test('совместимость: проект без sheets — ровно автолисты sheetPlan()', () => {
  const p = house();
  p.levels[1].rooms = [createRoom('bedroom', 0, 0, 4000, 3500)];
  const plan = sheetPlan(p, { sectionsPref: { on: false } });
  const list = sheetList(p, { sectionsPref: { on: false } });
  assert.deepEqual(list, plan);
  assert.deepEqual(list.map(sheetKey), ['level:L1', 'level:L2']);
  // Листы пользователя — после автолистов; автолисты можно скрыть.
  const s = addSheet(p, { no: '3' });
  assert.deepEqual(sheetList(p, { sectionsPref: { on: false } }).map(sheetKey), ['level:L1', 'level:L2', `user:${s.id}`]);
  p.sheetsAuto = false;
  assert.deepEqual(sheetList(p, { sectionsPref: { on: false } }).map(sheetKey), [`user:${s.id}`]);
});

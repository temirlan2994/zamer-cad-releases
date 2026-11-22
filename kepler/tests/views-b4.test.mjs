// Шаг B4 (core/views.js, ui/sheet-viewports.js): обрезка вида на листе
// (viewport.crop в мм модели), номера видов и маркеры «Л3-1», снимок камеры
// 3D (viewport.cam), сохранение v7/v6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, deserializeProject, fileDataV6, projectFromData, serializeProject } from '../core/model.js';
import {
  addSheet, cropFromPaper, cropHandlePoints, cropPaperRect, dragCropHandle, normalizeCam, normalizeCrop,
  normalizeViewsAndSheets, placeView, removeViewport, viewPlacement, viewportNo, viewportNumbers,
} from '../core/views.js';
import { axoProjection, viewportBox, viewportFrame } from '../ui/sheet-viewports.js';

function house() {
  const p = createProject('Дом');
  p.rooms.push(createRoom('living', 0, 0, 12000, 8000));
  return p;
}

test('normalizeCrop: числа, порядок углов, пустая рамка, off', () => {
  assert.deepEqual(normalizeCrop({ x0: 900.4, y0: '50', x1: 100, y1: 700 }), { x0: 100, y0: 50, x1: 900, y1: 700 });
  assert.deepEqual(normalizeCrop({ x0: 0, y0: 0, x1: 10, y1: 10, off: true }), { x0: 0, y0: 0, x1: 10, y1: 10, off: true });
  assert.equal(normalizeCrop({ x0: 0, y0: 0, x1: 0.2, y1: 10 }), null, 'нулевая ширина');
  assert.equal(normalizeCrop({ x0: 0, y0: NaN, x1: 10, y1: 10 }), null);
  assert.equal(normalizeCrop('рамка'), null);
  assert.equal(normalizeCrop({ x0: 0, y0: 0, x1: 10, y1: 10, off: 'да' }).off, undefined);
});

test('cropPaperRect/cropFromPaper: мм модели ↔ мм бумаги растра, поля, обрезка по растру', () => {
  const frame = { w: 160, h: 90, padL: 4, padT: 6, d: 100 };
  const crop = { x0: 1000, y0: 500, x1: 6000, y1: 4000 };
  assert.deepEqual(cropPaperRect(crop, frame), { x0: 14, y0: 11, x1: 64, y1: 46 });
  assert.deepEqual(cropFromPaper({ x0: 14, y0: 11, x1: 64, y1: 46 }, frame), crop);
  // Тот же вид 1:200 — рамка вдвое меньше на бумаге (привязана к виду).
  assert.deepEqual(cropPaperRect(crop, { ...frame, d: 200 }), { x0: 9, y0: 8.5, x1: 34, y1: 26 });
  // За краем растра — по краю; выключенная — нет.
  assert.deepEqual(cropPaperRect({ x0: -99999, y0: 0, x1: 99999, y1: 2000 }, frame), { x0: 0, y0: 6, x1: 160, y1: 26 });
  assert.equal(cropPaperRect({ ...crop, off: true }, frame), null);
  assert.equal(cropPaperRect(null, frame), null);
});

test('dragCropHandle: край по ручке, шаг по сетке листа, Shift, пределы растра и мин. размер', () => {
  const rect = { x0: 0, y0: 0, x1: 100, y1: 60 };
  const bounds = { w: 100, h: 60 };
  assert.deepEqual(cropHandlePoints(rect).map((h) => h.id), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  assert.deepEqual(cropHandlePoints(rect).find((h) => h.id === 'e'), { id: 'e', x: 100, y: 30 });
  // Растр начинается в 32,7 мм листа: край — на сетке листа 5 мм.
  const origin = { x: 32.7, y: 10 };
  const e = dragCropHandle(rect, 'e', -31, 0, { origin, step: 5, bounds });
  assert.equal(Math.round((e.x1 + origin.x) * 1000) % 5000, 0, 'край на сетке 5 мм');
  assert.deepEqual([e.x0, e.y0, e.y1], [0, 0, 60]);
  assert.deepEqual(dragCropHandle(rect, 'e', -31.3, 0, { origin, step: 0, bounds }).x1, 68.7, 'Shift — свободно');
  const nw = dragCropHandle(rect, 'nw', 20, 15, { bounds });
  assert.deepEqual(nw, { x0: 20, y0: 15, x1: 100, y1: 60 });
  assert.equal(dragCropHandle(rect, 'w', -50, 0, { bounds }).x0, 0, 'не за растр');
  assert.equal(dragCropHandle(rect, 's', 0, 500, { bounds }).y1, 60);
  assert.equal(dragCropHandle(rect, 'n', 0, 500, { bounds, min: 5 }).y0, 55, 'не меньше 5 мм');
});

test('видовой экран: рамка обрезки в осях вида, центр растра на месте, масштаб тянет рамку', () => {
  const p = house();
  const s = addSheet(p, { no: '3' });
  const vp = placeView(p, s.id, 'elev-S', { x: 200, y: 120, scale: 100 }).viewport;
  const frame = viewportFrame(p, vp);
  assert.ok(frame.w > 100 && frame.padL === 4 && frame.padT === 6, `растр фасада ${frame.w}×${frame.h}`);
  const whole = viewportBox(p, vp);
  assert.equal(whole.crop, null);
  assert.deepEqual([whole.x0, whole.x1], [whole.full.x0, whole.full.x1]);
  // Обрезать до левой половины чертежа фасада.
  vp.crop = cropFromPaper({ x0: 0, y0: 0, x1: frame.w / 2, y1: frame.h }, frame);
  const half = viewportBox(p, vp);
  assert.ok(Math.abs(half.x1 - (whole.x0 + frame.w / 2)) < 0.02, 'правый край — середина');
  assert.deepEqual(half.full, whole.full, 'вид на листе не уехал');
  assert.equal(half.cap.y0, half.y1, 'подпись — под видимой частью');
  // 1:200 — рамка в мм модели та же, на бумаге — вдвое уже (без полей).
  vp.scale = 200;
  const f2 = viewportFrame(p, vp);
  const r2 = cropPaperRect(vp.crop, f2);
  assert.ok(Math.abs((r2.x1 - f2.padL) * 2 - (frame.w / 2 - frame.padL)) < 0.05);
  // Нормализация и файл v7/v6.
  vp.crop.off = true;
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back.sheets[0].viewports[0].crop, vp.crop);
  const v6 = projectFromData(JSON.parse(JSON.stringify(fileDataV6(p))));
  assert.deepEqual(v6.sheets[0].viewports[0].crop, vp.crop);
  const data = { sheets: [{ id: 'a', viewports: [{ id: 'v', viewId: 'elev-N', x: 1, y: 1, scale: 100, crop: { x0: 5, y0: 5, x1: 5, y1: 9 } }] }] };
  normalizeViewsAndSheets(data);
  assert.equal(data.sheets[0].viewports[0].crop, undefined, 'пустая рамка отброшена');
});

test('номера видов: по порядку размещения, свой номер, перенумерация при удалении, метки', () => {
  const p = house();
  const s = addSheet(p, { no: '3' });
  const a = placeView(p, s.id, 'elev-N').viewport;
  const b = placeView(p, s.id, 'elev-S').viewport;
  const c = placeView(p, s.id, 'plan:L1').viewport;
  assert.deepEqual([...viewportNumbers(s).values()], ['1', '2', '3']);
  assert.deepEqual(viewPlacement(p, 'elev-S'), { sheet: s, vp: b, no: '2', mark: 'Л3-2', text: 'Лист 3, вид 2' });
  assert.equal(viewPlacement(p, 'elev-W'), null);
  // Свой номер «2» у третьего — второй получает следующий свободный.
  c.no = '2';
  assert.deepEqual([viewportNo(s, a), viewportNo(s, b), viewportNo(s, c)], ['1', '3', '2']);
  delete c.no;
  removeViewport(p, a.id);
  assert.deepEqual([viewportNo(s, b), viewportNo(s, c)], ['1', '2'], 'после удаления — 1, 2');
  assert.equal(viewPlacement(p, 'plan:L1').mark, 'Л3-2');
  // Номер переживает файл; пустой — отброшен.
  c.no = ' A1 ';
  normalizeViewsAndSheets(p); // нормализация — копии видовых экранов
  assert.equal(p.sheets[0].viewports[1].no, 'A1', 'пробелы срезаны');
  const back = deserializeProject(serializeProject(p));
  assert.equal(back.sheets[0].viewports[1].no, 'A1');
});

test('камера 3D: нормализация, проекция по углам, видимость граней, файл', () => {
  assert.equal(normalizeCam(null), null);
  assert.equal(normalizeCam({ yaw: 'x', pitch: 1 }), null);
  assert.deepEqual(normalizeCam({ yaw: -2.2, pitch: 9, dist: 25000.4, roof: true, extra: 1 }), { yaw: -2.2, pitch: 1.55, dist: 25000, roof: true });
  assert.equal(normalizeCam({ yaw: 0, pitch: 0 }).roof, true, 'готовый 3D-вид по умолчанию с крышей');
  assert.equal(normalizeCam({ yaw: 0, pitch: 0, roof: false }).roof, false, 'интерьерный вид сохраняет скрытую крышу');
  // Вид сверху-спереди с юга (yaw = −π/2: глаз на −Y правой системы, т. е.
  // на +y осей дома — внизу плана): x вправо, верх стены (z) — вверх листа.
  const cam = normalizeCam({ yaw: -Math.PI / 2, pitch: 0.3 });
  const { P, facing } = axoProjection(cam);
  const o = P({ x: 0, y: 0, z: 0 });
  const right = P({ x: 1000, y: 0, z: 0 });
  const up = P({ x: 0, y: 0, z: 1000 });
  assert.ok(right.u - o.u > 999, 'x — вправо');
  assert.ok(up.v < o.v - 900, 'z — вверх (v вниз)');
  assert.ok(facing({ x: 0, y: 1, z: 0 }) > 0, 'южная грань (+y дома) к глазу');
  assert.ok(facing({ x: 0, y: -1, z: 0 }) < 0, 'северная — спиной');
  assert.ok(P({ x: 0, y: 1000, z: 0 }).depth > o.depth, 'юг ближе');
  // Без камеры — прежняя аксонометрия.
  const axo = axoProjection(null);
  assert.ok(Number.isFinite(axo.P({ x: 1, y: 2, z: 3 }).u));
  // Снимок камеры у видового экрана: геометрия 3D строится, файл хранит cam.
  const p = house();
  const s = addSheet(p, { no: '3' });
  const vp = placeView(p, s.id, '3d', { scale: 100 }).viewport;
  const w0 = viewportFrame(p, vp).w;
  vp.cam = cam;
  const w1 = viewportFrame(p, vp).w;
  assert.ok(w0 > 0 && w1 > 0 && Math.abs(w0 - w1) > 1, `камера меняет габарит: ${w0} → ${w1}`);
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back.sheets[0].viewports[0].cam, cam);
});

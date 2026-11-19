import test from "node:test";
import assert from "node:assert/strict";
import { describeSurveyRecord, measureSurveyContour, normalizeSurvey, normalizeSurveyRecord, surveyMarkers } from "./survey.js";
import { decodeSurveyLaserDistance } from "./survey-laser.js";

const contour = (coordinates, closed = true) => ({ type: "polyline", closed, points: coordinates.map(([x, y]) => ({ x, y })) });

const foremanPlan = contour([[0, 0], [5300, 0], [5300, 2800], [4100, 2800], [4100, 3900], [0, 3900]]);

test("two vertices and a semicircle produce the exact area and perimeter of a closed D", () => {
  const d = { ...contour([[0, 0], [1000, 0]]), bulges: [1, 0] };
  const result = measureSurveyContour(d);
  assert.ok(Math.abs(result.areaM2 - Math.PI / 8) < 1e-12);
  assert.ok(Math.abs(result.perimeterM - (1 + Math.PI / 2)) < 1e-12);
  assert.ok(measureSurveyContour(contour([[0, 0], [1000, 0]])).error);
});

test("uses exact area and outer perimeter, and subtracts interior holes", () => {
  assert.deepEqual(measureSurveyContour(foremanPlan), { areaM2: 19.35, excludedM2: 0, perimeterM: 18.4, boundaryM: 18.4 });
  const hole = contour([[100, 100], [500, 100], [500, 500], [100, 500]]);
  assert.deepEqual(measureSurveyContour(foremanPlan, [hole]), { areaM2: 19.19, excludedM2: 0.16, perimeterM: 18.4, boundaryM: 20 });
  assert.ok(measureSurveyContour(foremanPlan, [hole, hole]).error);
});

test("validates an open or self-intersecting perimeter and holes that touch its edge", () => {
  assert.ok(measureSurveyContour(contour([[0, 0], [100, 100], [100, 0], [0, 100]])).error);
  assert.ok(measureSurveyContour(contour([[0, 0], [100, 0], [100, 100]], false)).error);
  assert.ok(measureSurveyContour(foremanPlan, [contour([[0, 0], [100, 0], [100, 100]])]).error);
});

test("survey contour measures signed semicircles exactly and allows a hole within the curved boundary", () => {
  const box = contour([[0, 0], [2000, 0], [2000, 2000], [0, 2000]]);
  const outsideBow = { ...box, bulges: [1, 0, 0, 0] };
  const insideBow = { ...box, bulges: [-1, 0, 0, 0] };
  const hole = contour([[900, -700], [1100, -700], [1100, -450], [900, -450]]);
  const result = measureSurveyContour(outsideBow, [hole]);
  assert.ok(Math.abs(result.areaM2 - (4 + Math.PI / 2 - 0.05)) < 1e-10);
  assert.equal(result.excludedM2, 0.05);
  assert.ok(Math.abs(result.perimeterM - (6 + Math.PI)) < 1e-10);
  assert.ok(Math.abs(result.boundaryM - (6 + Math.PI + 0.9)) < 1e-10);
  assert.ok(Math.abs(measureSurveyContour(insideBow).areaM2 - (4 - Math.PI / 2)) < 1e-10);
  assert.ok(measureSurveyContour(insideBow, [hole]).error);
});

test("keeps measured and drawn diagonals separate and computes the threshold", () => {
  const record = normalizeSurveyRecord({ kind: "control", point: { x: 0, y: 0 }, end: { x: 4100, y: 3900 }, values: { measured: "5666", tolerance: "5" } });
  const description = describeSurveyRecord(record);
  assert.match(description.detail, /факт 5666 мм.*расчёт 5658,6 мм.*разница 7,4 мм/);
  assert.equal(description.issue, "Повторить замер");
  assert.equal(describeSurveyRecord({ ...record, decision: "verified" }).issue, "Перепроверено");
  assert.deepEqual(record.end, { x: 4100, y: 3900 });
});

test("reports minimum niche dimensions with the measured level and side", () => {
  const record = normalizeSurveyRecord({ kind: "niche", values: { level1: 0, level2: 1200, level3: 2250,
    width1: 2474, width2: 2467, width3: 2460, height1: 2510, height2: 2504, height3: 2498 } });
  assert.match(describeSurveyRecord(record).detail, /мин. ширина 2460 мм на уровне 2250 мм.*мин. высота 2498 мм справа/);
});

test("reports both correct opening chains and mismatches without overwriting entered values", () => {
  const record = normalizeSurveyRecord({ kind: "opening", values: {offset: 820, width: 900, remaining: 3580, total: 5300, sill: 0} });
  assert.match(describeSurveyRecord(record).detail, /820 \+ 900 \+ 3580 = 5300 мм/);
  assert.equal(describeSurveyRecord(record).issue, "");
  assert.equal(describeSurveyRecord({ ...record, values: { ...record.values, total: 5294 } }).issue, "Расхождение цепочки 6 мм");
});

test("projects the opening onto its measured run in either point order and checks an actual total", () => {
  const record = normalizeSurveyRecord({kind: "opening", openingType: "Окно",
    point: {x: 600, y: 1720}, end: {x: 600, y: 820}, runStart: {x: 600, y: 0}, runEnd: {x: 600, y: 5300},
    values: {total: 5294, height: 1440},
  });
  const result = describeSurveyRecord(record);
  assert.match(result.detail, /Окно.*ширина 900 мм.*820 \+ 900 \+ 3580 = 5300 мм/);
  assert.equal(result.issue, "Расхождение цепочки 6 мм");
  assert.match(describeSurveyRecord({...record, end: {x: 620, y: 820}}).issue, /должны лежать/);
});

test("retains issued reading numbers when earlier readings are deleted or an old room is imported", () => {
  const point = {x: 1, y: 2};
  const legacy = normalizeSurvey({rooms: [{id: "room-1", records: [{kind: "point", point}, {kind: "point", point}]}]});
  const room = legacy.rooms[0];
  assert.deepEqual(room.records.map((record) => record.number), [1, 2]);
  assert.equal(room.nextRecordNumber, 3);
  room.records.shift();
  const recovered = normalizeSurvey(legacy).rooms[0];
  assert.equal(recovered.nextRecordNumber, 3);
  assert.equal(surveyMarkers(recovered.records)[0].label, "№2");
});

test("restores survey rooms, photos and inactive drawings without creating duplicates", () => {
  const photo = "data:image/jpeg;base64,YQ==";
  const first = {id: "a", name: "Прихожая", records: [{id: "p-1", kind: "point", values: {height: 0}, photo}], drawing: {entities: [foremanPlan]}};
  const second = {id: "b", name: "Кухня", preset: "furniture"};
  const survey = normalizeSurvey({version: 1, activeRoomId: second.id, rooms: [first, first, second]});
  assert.equal(survey.activeRoomId, "b");
  assert.equal(survey.rooms.length, 2);
  assert.equal(survey.rooms[0].records[0].values.height, 0);
  assert.equal(survey.rooms[0].records[0].photo, photo);
  assert.deepEqual(survey.rooms[0].drawing.entities, [foremanPlan]);
  assert.equal(normalizeSurvey(null).rooms[0].id, "room-1");
});

test("decodes D2 little-endian distances in millimetres and rejects invalid packets", () => {
  const data = new DataView(new ArrayBuffer(4));
  data.setFloat32(0, 2.474, true);
  assert.equal(decodeSurveyLaserDistance(data), 2474);
  data.setFloat32(0, Number.NaN, true);
  assert.equal(decodeSurveyLaserDistance(data), null);
  data.setFloat32(0, 0, true);
  assert.equal(decodeSurveyLaserDistance(data), null);
  data.setFloat32(0, 101, true);
  assert.equal(decodeSurveyLaserDistance(data), null);
  assert.equal(decodeSurveyLaserDistance(new DataView(new ArrayBuffer(3))), null);
});

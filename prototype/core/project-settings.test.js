import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MEASUREMENT_SETTINGS, normalizeMeasurementSettings, fromProjectLength,
  formatProjectLength, formatProjectAngle, formatProjectArea } from "./project-settings.js";

test("legacy settings default to millimetres and reject invalid selections", () => {
  assert.deepEqual(normalizeMeasurementSettings(), DEFAULT_MEASUREMENT_SETTINGS);
  assert.deepEqual(normalizeMeasurementSettings({unit:"in", precision:5, anglePrecision:"", areaPrecision:-1, printScale:"0"}), DEFAULT_MEASUREMENT_SETTINGS);
});

test("settings affect display and typed values without changing millimetre model", () => {
  const settings = {unit:"m", precision:3, anglePrecision:1, areaPrecision:3};
  assert.equal(formatProjectLength(1250.4, settings), "1,25 м");
  assert.ok(Math.abs(fromProjectLength(1.2504, settings) - 1250.4) < 1e-9);
  assert.equal(formatProjectLength(-150, settings), "-0,15 м");
  assert.equal(formatProjectAngle(359.98, settings, {wrap:true}), "0°");
  assert.equal(formatProjectAngle(90.13, settings), "90,1°");
  assert.equal(formatProjectArea(0.00012, settings), "<0,001 м²");
  assert.equal(formatProjectArea(4.12345, settings), "4,123 м²");
});

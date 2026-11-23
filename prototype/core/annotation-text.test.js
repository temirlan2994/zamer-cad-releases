import test from "node:test";
import assert from "node:assert/strict";
import { ANNOTATION_SCALE_PRESETS, annotationTextLines, textBlockLayout } from "./annotation-text.js";

test("annotation presets cover furniture, plans, and sites", () => {
  assert.deepEqual(ANNOTATION_SCALE_PRESETS.map(({ denominator }) => denominator),
    [10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000, 2000]);
});

test("text wrapping respects explicit lines, words, and long tokens", () => {
  assert.deepEqual(annotationTextLines("Первая строка\nВторая", 40, 10),
    ["Первая", "строка", "Вторая"]);
  assert.deepEqual(annotationTextLines("123456789", 4 * 10 * 0.64, 10), ["1234", "5678", "9"]);
});

test("text block layout preserves a chosen width and frame", () => {
  assert.deepEqual(textBlockLayout({ text: "Один два три", height: 100, textWidth: 320, textFrame: true }), {
    height: 100,
    lines: ["Один", "два", "три"],
    width: 320,
    frame: true,
  });
});

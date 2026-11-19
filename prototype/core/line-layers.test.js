import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LINE_LAYER, MAX_CUSTOM_LINE_LAYERS, MAX_LINE_LAYER_NAME_LENGTH, isCustomLineLayerId,
  normalizeLineLayerName, normalizeLineLayerColor, normalizeCustomLineLayers, normalizeActiveLineLayer,
  normalizeLineLayerSettings } from "./line-layers.js";

const custom = { id: "line-layer-windows_01", name: "  Окна на плане ", color: "#12ABcd" };

test("line layer settings fall back for legacy projects and stale active ids", () => {
  assert.deepEqual(normalizeLineLayerSettings({ entities: [] }), { customLineLayers: [], activeLineLayer: DEFAULT_LINE_LAYER });
  assert.equal(normalizeActiveLineLayer("walls", [custom]), DEFAULT_LINE_LAYER);
  assert.equal(normalizeActiveLineLayer(custom.id, null), DEFAULT_LINE_LAYER);
  const normalized = { id: custom.id, name: "Окна на плане", color: "#12abcd" };
  const settings = normalizeLineLayerSettings({ customLineLayers: [custom], activeLineLayer: custom.id });
  assert.deepEqual(settings, { customLineLayers: [normalized], activeLineLayer: custom.id });
  assert.notEqual(settings.customLineLayers[0], custom);
  assert.equal(normalizeActiveLineLayer("line-layer-removed", settings.customLineLayers), DEFAULT_LINE_LAYER);
});

test("accepts trimmed printable titles, reserved safe ids and canonical hex colors", () => {
  assert.equal(normalizeLineLayerName("  План / фасад & окна 🪟 "), "План / фасад & окна 🪟");
  assert.equal(normalizeLineLayerName("А".repeat(MAX_LINE_LAYER_NAME_LENGTH + 1)), null);
  for (const invalid of ["", "  ", "a\nb", "<слой>", "Слой\u202e", "Слой\ud800", null]) {
    assert.equal(normalizeLineLayerName(invalid), null);
  }
  assert.equal(normalizeLineLayerColor("#AABB00"), "#aabb00");
  for (const invalid of ["#abc", "red", " #00ff00", "#00ff00\n", "url(a)", 123]) {
    assert.equal(normalizeLineLayerColor(invalid), null);
  }
  assert.equal(isCustomLineLayerId(custom.id), true);
  for (const invalid of ["measure", "line-layer-", "line-layer-сеть", "line-layer-a/b", "line-layer-test\n", null]) {
    assert.equal(isCustomLineLayerId(invalid), false);
  }
});

test("storage normalization drops malformed and duplicate entries and bounds the input list", () => {
  assert.deepEqual(normalizeCustomLineLayers([null, custom, { ...custom, name: "Копия" },
    { id: "line-layer-bad", name: "Ошибочный", color: "magenta" }]),
  [{ id: custom.id, name: "Окна на плане", color: "#12abcd" }]);
  const layers = Array.from({ length: MAX_CUSTOM_LINE_LAYERS + 1 }, (_, index) => ({ ...custom, id: `line-layer-${index}` }));
  assert.equal(normalizeCustomLineLayers(layers).length, MAX_CUSTOM_LINE_LAYERS);
});

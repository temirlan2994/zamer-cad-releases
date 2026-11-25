import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPEN_SETTINGS, nativeSpenClientPoint, normalizeSpenSettings, shouldRejectSpenPalmTouch, spenBarrelButtonPressed, spenModeActive } from "./spen.js";

test("S Pen settings keep safe defaults and accept explicit switches", () => {
  assert.deepEqual(normalizeSpenSettings(null), DEFAULT_SPEN_SETTINGS);
  assert.deepEqual(normalizeSpenSettings({ hoverCursor: false, compactUi: false, sideButton: "no" }), {
    ...DEFAULT_SPEN_SETTINGS,
    hoverCursor: false,
    compactUi: false,
  });
});

test("manual input mode overrides pen detection and migrates the previous enabled switch", () => {
  assert.equal(normalizeSpenSettings({ enabled: false }).mode, "finger");
  assert.equal(normalizeSpenSettings({ enabled: true }).mode, "auto");
  assert.equal(normalizeSpenSettings({ mode: "broken" }).mode, "auto");
  const finger = normalizeSpenSettings({ mode: "finger" });
  const pen = normalizeSpenSettings({ mode: "pen", enabled: false });
  assert.equal(spenModeActive(finger, { active: true, hovering: true }), false);
  assert.equal(spenModeActive(pen, { active: false, hovering: false }), true);
  assert.equal(spenModeActive(DEFAULT_SPEN_SETTINGS, { active: false }), false);
  assert.equal(spenModeActive(DEFAULT_SPEN_SETTINGS, { active: true, hovering: false }), true);
  assert.equal(spenModeActive(normalizeSpenSettings(JSON.parse(JSON.stringify(pen))), { active: false }), true);
});

test("recognizes Android and browser barrel-button bitmasks", () => {
  assert.equal(spenBarrelButtonPressed({ button: 2 }), true);
  assert.equal(spenBarrelButtonPressed({ buttons: 32 }), true);
  assert.equal(spenBarrelButtonPressed({ button: 0, buttons: 1 }), false);
});

test("native pen hover maps physical WebView coordinates to the current CSS viewport without a touch", () => {
  assert.deepEqual(nativeSpenClientPoint({ x: 540, y: 1200, width: 1080, height: 2340 }, { width: 360, height: 780 }),
    { x: 180, y: 400 });
  assert.deepEqual(nativeSpenClientPoint({ x: 540, y: 900, width: 1080, height: 1500 }, { width: 360, height: 500 }),
    { x: 180, y: 300 });
  assert.equal(nativeSpenClientPoint({ x: NaN, y: 10, width: 1080, height: 2340 }, { width: 360, height: 780 }), null);
  assert.equal(nativeSpenClientPoint({ x: 1, y: 1, width: 0, height: 0 }, { width: 360, height: 780 }), null);
});

test("palm rejection allows a fingertip to pan beside a hovering pen and rejects broad palm contact", () => {
  const settings = normalizeSpenSettings();
  const finger = { width: 9, height: 12 };
  const palm = { width: 52, height: 65 };
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: true }, 5000, finger), false);
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: true }, 5000), false);
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: true }, 5000, palm), true);
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: false, lastHover: 4500 }, 5000, palm), true);
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: false, lastHover: 3000 }, 5000, palm), false);
  assert.equal(shouldRejectSpenPalmTouch({ ...settings, palmRejection: false }, { active: true, hovering: true }, 5000, palm), false);
});

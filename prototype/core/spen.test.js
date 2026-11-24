import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPEN_SETTINGS, normalizeSpenSettings, shouldRejectSpenPalmTouch, spenBarrelButtonPressed } from "./spen.js";

test("S Pen settings keep safe defaults and accept explicit switches", () => {
  assert.deepEqual(normalizeSpenSettings(null), DEFAULT_SPEN_SETTINGS);
  assert.deepEqual(normalizeSpenSettings({ hoverCursor: false, compactUi: false, sideButton: "no" }), {
    ...DEFAULT_SPEN_SETTINGS,
    hoverCursor: false,
    compactUi: false,
  });
});

test("recognizes Android and browser barrel-button bitmasks", () => {
  assert.equal(spenBarrelButtonPressed({ button: 2 }), true);
  assert.equal(spenBarrelButtonPressed({ buttons: 32 }), true);
  assert.equal(spenBarrelButtonPressed({ button: 0, buttons: 1 }), false);
});

test("palm rejection is limited to an active and recently hovering pen", () => {
  const settings = normalizeSpenSettings();
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: true, lastHover: 0 }, 5000), true);
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: false, lastHover: 4500 }, 5000), true);
  assert.equal(shouldRejectSpenPalmTouch(settings, { active: true, hovering: false, lastHover: 3000 }, 5000), false);
  assert.equal(shouldRejectSpenPalmTouch({ ...settings, palmRejection: false }, { active: true, hovering: true }, 5000), false);
});

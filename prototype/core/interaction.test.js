import test from "node:test";
import assert from "node:assert/strict";
import { requiresActivation, canStartGeometryDrag, activationGestureMode, canDragEntityDirectly } from "./interaction.js";

test("only furniture and text can be moved directly with a finger", () => {
  for (const type of ["block", "text"]) assert.equal(canDragEntityDirectly({type}), true);
  for (const type of ["wall", "line", "circle", "arc", "rectangle"]) assert.equal(canDragEntityDirectly({type}), false);
  assert.equal(canDragEntityDirectly({type:"line", layer:"dimensions", dimensionKind:"leader"}), false);
  assert.equal(canDragEntityDirectly(null), false);
});

test("touching an inactive object permits panning and never starts an object move", () => {
  assert.equal(activationGestureMode(false), "select-only");
  assert.equal(activationGestureMode(true), "pan");
});

test("new, automatically selected and previously deselected objects require a tap", () => {
  assert.equal(requiresActivation("wall", [], new Set()), true);
  assert.equal(requiresActivation("wall", ["wall"], new Set()), true);
  assert.equal(requiresActivation("wall", [], new Set(["wall"])), true);
  assert.equal(requiresActivation("wall", ["wall"], new Set(["wall"])), false);
  assert.equal(requiresActivation(null, [], new Set()), false);
});
test("every geometry gesture waits for deliberate travel; pan and commands remain available", () => {
  for (const mode of ["move", "furniture-resize", "furniture-rotate", "leader-move", "leader-arrow", "leader-elbow", "circle-radius", "line-endpoint", "dimension-offset", "dimension-start", "dimension-end"]) {
    assert.equal(canStartGeometryDrag(mode, false), false, mode);
    assert.equal(canStartGeometryDrag(mode, true), true, mode);
  }
  assert.equal(canStartGeometryDrag("pan", false), true);
  assert.equal(canStartGeometryDrag("move-command", false), true);
});

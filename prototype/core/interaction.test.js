import test from "node:test";
import assert from "node:assert/strict";
import { requiresActivation, canStartGeometryDrag, activationGestureMode, canDragEntityDirectly, nearestCompoundGuideIntersection, normalizeDirectionalSnapModes, preferredSnapCandidate,
  snapCandidateKind, tapZoomMoveIntent } from "./interaction.js";

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

test("double-tap drag starts one-finger zoom without a hold delay", () => {
  assert.equal(tapZoomMoveIntent(0, 8), "wait");
  assert.equal(tapZoomMoveIntent(0, 9), "zoom");
  assert.equal(tapZoomMoveIntent(4, -9), "zoom");
  assert.equal(tapZoomMoveIntent(9, 4), "gesture");
});

test("Ortho and polar tracking are mutually exclusive like in AutoCAD", () => {
  assert.deepEqual([...normalizeDirectionalSnapModes(["end", "polar", "ortho"])], ["end", "ortho"]);
  assert.deepEqual([...normalizeDirectionalSnapModes(["end", "ortho", "polar"], "polar")], ["end", "polar"]);
  assert.deepEqual([...normalizeDirectionalSnapModes(["end", "polar"])], ["end", "polar"]);
});

test("CAD snap priority prefers precise object points without ignoring a much closer crossing", () => {
  const point = { x: 0, y: 0 };
  assert.equal(snapCandidateKind({ snapRole: "corner" }), "end");
  assert.equal(snapCandidateKind({ type: "intersection" }), "intersection");
  assert.equal(preferredSnapCandidate(point, [
    { x: 5, y: 0, snapRole: "end", id: "end" },
    { x: 4, y: 0, type: "intersection", id: "cross" },
  ]).id, "end");
  assert.equal(preferredSnapCandidate(point, [
    { x: 8, y: 0, snapRole: "end", id: "end" },
    { x: 1, y: 0, type: "intersection", id: "cross" },
  ]).id, "cross");
  assert.equal(preferredSnapCandidate(point, [
    { x: 3, y: 0, type: "extension", id: "extension" },
    { x: 3, y: 0, type: "nearest", id: "nearest" },
  ]).id, "extension");
});

test("polar and tracking paths meet a line continuation at one exact CAD point", () => {
  const polar = { point: { x: 0, y: 0 }, ux: 1, uy: 0, isPolar: true };
  const extension = {
    point: { x: 10, y: 10 }, ux: 0, uy: 1, isExtension: true, length: 10,
    boundary: { x1: 10, y1: 10, x2: 10, y2: 20 },
  };
  assert.deepEqual(nearestCompoundGuideIntersection({ x: 10.5, y: 0.5 }, [[polar, extension]], 2), {
    x: 10, y: 0, guides: [polar, extension],
  });
  assert.equal(nearestCompoundGuideIntersection({ x: -10, y: 0 }, [[polar, {
    ...extension, point: { x: -10, y: 10 }, boundary: { x1: -10, y1: 10, x2: -10, y2: 20 },
  }]], 2), null, "polar tracking is a forward ray");
  assert.equal(nearestCompoundGuideIntersection({ x: 10, y: 15 }, [[{ ...polar, point: { x: 0, y: 15 } }, extension]], 2), null,
    "a continuation cannot claim a point inside the original segment");
});

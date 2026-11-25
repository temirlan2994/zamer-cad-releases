import test from "node:test";
import assert from "node:assert/strict";
import { requiresActivation, canStartGeometryDrag, activationGestureMode, canDragEntityDirectly, guideDirectionsParallel, nearestCompoundGuideIntersection,
  nonOverlappingPanelTop, normalizeDirectionalSnapModes, polarRayGuides, preferredSnapCandidate, resolvePolarSnap, selectionFilterForProject, shouldDelayTapZoom, snapCandidateKind, tapZoomMoveIntent, tapZoomScale } from "./interaction.js";

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
  assert.equal(tapZoomScale(1, 110), 2, "moving down zooms in after inversion");
  assert.equal(tapZoomScale(1, -110), 0.5, "moving up zooms out after inversion");
});

test("double-tap zoom reserves the first touch even over a selectable object", () => {
  const tap = { enabled: true, secondTap: false, pointerType: "touch", button: 0, moved: false,
    mode: "select-only", duration: 90, distance: 1 };
  assert.equal(shouldDelayTapZoom({ ...tap, selectable: true }), true);
  assert.equal(shouldDelayTapZoom({ ...tap, selectable: false }), true);
  assert.equal(shouldDelayTapZoom({ ...tap, selectable: false, moved: true }), false);
  assert.equal(shouldDelayTapZoom({ ...tap, selectable: false, duration: 500 }), false);
});

test("old hidden selection filters are reset after the filter control was removed", () => {
  for (const saved of [undefined, "all", "lines", "dimensions", "invalid"]) {
    assert.equal(selectionFilterForProject(saved), "all");
  }
});

test("Ortho and polar tracking are mutually exclusive like in AutoCAD", () => {
  assert.deepEqual([...normalizeDirectionalSnapModes(["end", "polar", "ortho"])], ["end", "ortho"]);
  assert.deepEqual([...normalizeDirectionalSnapModes(["end", "ortho", "polar"], "polar")], ["end", "polar"]);
  assert.deepEqual([...normalizeDirectionalSnapModes(["end", "polar"])], ["end", "polar"]);
});

test("polar tracking captures wider angles, holds through small jitter, and releases for intentional movement", () => {
  const start = { x: 0, y: 0 };
  const at = degrees => ({ x: 1000 * Math.cos(degrees * Math.PI / 180), y: 1000 * Math.sin(degrees * Math.PI / 180) });
  assert.equal(resolvePolarSnap(at(1.9), start, 5).degrees, 0);
  assert.equal(resolvePolarSnap(at(2.2), start, 5).snapped, false);
  assert.equal(resolvePolarSnap(at(3.8), start, 15).degrees, 0);
  assert.equal(resolvePolarSnap(at(4.2), start, 15).snapped, false);
  assert.equal(resolvePolarSnap(at(5.8), start, 15, 0).degrees, 0);
  assert.equal(resolvePolarSnap(at(6.2), start, 15, 0).snapped, false);
  assert.equal(resolvePolarSnap(at(2.8), start, 5, 0).degrees, 0);
  assert.equal(resolvePolarSnap(at(3.2), start, 5, 0).degrees, 355);
  assert.equal(resolvePolarSnap(at(179), start, 15, -Math.PI).degrees, 180);
  const result = resolvePolarSnap(at(93), start, 15);
  assert.equal(result.degrees, 270);
  assert.ok(Math.abs(Math.hypot(result.point.x, result.point.y) - 1000) < 1e-9);
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

test("a continuation intersects every configured polar ray before either guide can pull the cursor away", () => {
  const polarGuides = polarRayGuides({ x: 0, y: 0 }, 15);
  assert.equal(polarGuides.length, 24);
  const horizontal = polarGuides[0];
  const extension = {
    point: { x: 10, y: 10 }, ux: 0, uy: 1, isExtension: true, length: 10,
    boundary: { x1: 10, y1: 10, x2: 10, y2: 20 },
  };
  assert.deepEqual(nearestCompoundGuideIntersection({ x: 10, y: 1.5 }, [[horizontal, extension]], 2), {
    x: 10, y: 0, guides: [horizontal, extension],
  });
  assert.equal(guideDirectionsParallel(horizontal, { ux: -1, uy: 0 }), true);
  assert.equal(guideDirectionsParallel(horizontal, { ux: Math.SQRT1_2, uy: Math.SQRT1_2 }), false);
});

test("top metric fields move below every horizontally overlapping tool panel", () => {
  const metrics = { left: 310, right: 580 };
  const panels = [
    { left: 8, right: 250, bottom: 96 },
    { left: 420, right: 582, bottom: 92 },
    { left: 300, right: 590, bottom: 148 },
  ];
  assert.equal(nonOverlappingPanelTop(metrics, panels, 20), 134,
    "the tallest overlapping panel wins after converting from screen to workspace coordinates");
  assert.equal(nonOverlappingPanelTop(metrics, [panels[0]], 20), 38,
    "a panel on the other side of the canvas must not move the fields");
});

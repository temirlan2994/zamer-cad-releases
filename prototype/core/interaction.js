export function requiresActivation(id, selectedIds, activatedIds) {
  return Boolean(id && (!selectedIds.includes(id) || !activatedIds.has(id)));
}

export function activationGestureMode(moved) {
  return moved ? "pan" : "select-only";
}

export function canDragEntityDirectly(entity) {
  return entity?.type === "block" || entity?.type === "text";
}

export function tapZoomMoveIntent(dx, dy, tolerance = 8) {
  if (Math.hypot(dx, dy) <= tolerance) return "wait";
  return Math.abs(dy) >= Math.abs(dx) ? "zoom" : "gesture";
}

export function normalizeDirectionalSnapModes(modes, preferred = "ortho") {
  const normalized = new Set(Array.from(modes || []).filter(Boolean));
  if (normalized.has("ortho") && normalized.has("polar")) {
    normalized.delete(preferred === "polar" ? "ortho" : "polar");
  }
  return normalized;
}

const SNAP_PRIORITY_BIAS_PX = Object.freeze({
  end: 0,
  intersection: 1,
  mid: 2,
  center: 3,
  perpendicular: 4,
  tracking: 5,
  extension: 6,
  nearest: 10,
  polar: 14,
  ortho: 16,
  grid: 20,
});

export function snapCandidateKind(candidate) {
  const kind = candidate?.type || candidate?.snapRole || candidate?.pointKey || "nearest";
  if (["start", "corner", "quadrant", "arc-point"].includes(kind)) return "end";
  return kind;
}

export function snapCandidateScore(point, candidate, viewScale = 1) {
  if (![candidate?.x, candidate?.y].every(Number.isFinite)) return Infinity;
  const priority = SNAP_PRIORITY_BIAS_PX[snapCandidateKind(candidate)] ?? SNAP_PRIORITY_BIAS_PX.nearest;
  const distancePx = Math.hypot(point.x - candidate.x, point.y - candidate.y) * viewScale;
  return distancePx + priority;
}

export function preferredSnapCandidate(point, candidates, viewScale = 1) {
  let best = null;
  let bestScore = Infinity;
  let bestPriority = Infinity;
  for (const candidate of candidates || []) {
    if (![candidate?.x, candidate?.y].every(Number.isFinite)) continue;
    const priority = SNAP_PRIORITY_BIAS_PX[snapCandidateKind(candidate)] ?? SNAP_PRIORITY_BIAS_PX.nearest;
    const score = snapCandidateScore(point, candidate, viewScale);
    if (score < bestScore || (score === bestScore && priority < bestPriority)) {
      best = candidate;
      bestScore = score;
      bestPriority = priority;
    }
  }
  return best;
}

export function nonOverlappingPanelTop(metricRect, panelRects, workspaceTop = 0, defaultTop = 38, gap = 6) {
  if (![metricRect?.left, metricRect?.right, workspaceTop, defaultTop, gap].every(Number.isFinite)) return defaultTop;
  let top = defaultTop;
  for (const rect of panelRects || []) {
    if (![rect?.left, rect?.right, rect?.bottom].every(Number.isFinite) || rect.right <= rect.left) continue;
    const overlapsHorizontally = rect.right + gap > metricRect.left && rect.left - gap < metricRect.right;
    if (overlapsHorizontally) top = Math.max(top, rect.bottom - workspaceTop + gap);
  }
  return Math.ceil(top);
}

export function polarRayGuides(start, stepDegrees) {
  if (![start?.x, start?.y, stepDegrees].every(Number.isFinite) || stepDegrees <= 0 || stepDegrees > 180) return [];
  const count = Math.round(360 / stepDegrees);
  if (count < 2 || Math.abs(count * stepDegrees - 360) > 0.000001) return [];
  return Array.from({ length: count }, (_, index) => {
    const angle = index * stepDegrees * Math.PI / 180;
    return {
      point: start,
      angle,
      ux: Math.cos(angle),
      uy: Math.sin(angle),
      isPolar: true,
    };
  });
}

export function guideDirectionsParallel(first, second, toleranceRadians = Math.PI / 180) {
  if (![first?.ux, first?.uy, second?.ux, second?.uy, toleranceRadians].every(Number.isFinite) || toleranceRadians < 0) return false;
  return Math.abs(first.ux * second.uy - first.uy * second.ux) <= Math.sin(toleranceRadians);
}

function guideAcceptsPoint(guide, point, epsilon = 0.000001) {
  if (guide.isPolar) {
    const forward = (point.x - guide.point.x) * guide.ux + (point.y - guide.point.y) * guide.uy;
    if (forward < -epsilon) return false;
  }
  if (guide.isExtension) {
    const along = (point.x - guide.boundary.x1) * guide.ux + (point.y - guide.boundary.y1) * guide.uy;
    if (along >= -epsilon && along <= guide.length + epsilon) return false;
  }
  return true;
}

export function nearestCompoundGuideIntersection(point, pairs, threshold) {
  let best = null;
  let bestDistance = threshold;
  for (const [first, second] of pairs || []) {
    if (!first?.point || !second?.point || first.point.key && first.point.key === second.point.key) continue;
    const cross = first.ux * second.uy - first.uy * second.ux;
    if (Math.abs(cross) < 0.0001) continue;
    const dx = second.point.x - first.point.x;
    const dy = second.point.y - first.point.y;
    const along = (dx * second.uy - dy * second.ux) / cross;
    const candidate = { x: first.point.x + first.ux * along, y: first.point.y + first.uy * along };
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance > bestDistance || !guideAcceptsPoint(first, candidate) || !guideAcceptsPoint(second, candidate)) continue;
    bestDistance = distance;
    best = { ...candidate, guides: [first, second] };
  }
  return best;
}

export function canStartGeometryDrag(mode, moved) {
  const modes = new Set(["move", "furniture-resize", "furniture-rotate", "leader-move", "leader-arrow", "leader-elbow", "circle-radius", "line-endpoint", "dimension-offset", "dimension-start", "dimension-end"]);
  return !modes.has(mode) || moved;
}

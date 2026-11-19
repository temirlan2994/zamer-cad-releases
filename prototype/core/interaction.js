export function requiresActivation(id, selectedIds, activatedIds) {
  return Boolean(id && (!selectedIds.includes(id) || !activatedIds.has(id)));
}

export function activationGestureMode(moved) {
  return moved ? "pan" : "select-only";
}

export function canDragEntityDirectly(entity) {
  return entity?.type === "block" || entity?.type === "text";
}

export function canStartGeometryDrag(mode, moved) {
  const modes = new Set(["move", "furniture-resize", "furniture-rotate", "leader-move", "leader-arrow", "leader-elbow", "circle-radius", "line-endpoint", "dimension-offset", "dimension-start", "dimension-end"]);
  return !modes.has(mode) || moved;
}

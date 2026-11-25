export const DEFAULT_SPEN_SETTINGS = Object.freeze({
  enabled: true,
  hoverCursor: true,
  sideButton: true,
  palmRejection: true,
  compactUi: true,
});

export function normalizeSpenSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_SPEN_SETTINGS).map(([key, fallback]) => [
    key,
    typeof source[key] === "boolean" ? source[key] : fallback,
  ]));
}

export function spenBarrelButtonPressed({ button = -1, buttons = 0 } = {}) {
  return button === 2 || button === 5 || Boolean(buttons & 2) || Boolean(buttons & 32);
}

// Native MotionEvent coordinates use physical WebView pixels. Map them to the
// CSS viewport before subtracting the canvas offset (toolbars/system insets).
export function nativeSpenClientPoint(detail, viewport) {
  if (![detail?.x, detail?.y, detail?.width, detail?.height, viewport?.width, viewport?.height].every(Number.isFinite) ||
      detail.width <= 0 || detail.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  return { x: detail.x * viewport.width / detail.width, y: detail.y * viewport.height / detail.height };
}

export function shouldRejectSpenPalmTouch(settings, runtime, now, contact = {}, graceMs = 850) {
  if (!settings?.enabled || !settings.palmRejection || !runtime?.active) return false;
  // A fingertip must remain available for navigation while the pen hovers.
  // Reject broad palm contacts near the pen, not every touch on the screen.
  const penNearby = runtime.hovering || (Number.isFinite(runtime.lastHover) && now - runtime.lastHover <= graceMs);
  return Boolean(penNearby && Math.max(contact.width || 0, contact.height || 0) >= 40);
}

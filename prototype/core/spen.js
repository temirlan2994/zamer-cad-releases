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

export function shouldRejectSpenPalmTouch(settings, runtime, now, graceMs = 850) {
  if (!settings?.enabled || !settings.palmRejection || !runtime?.active) return false;
  return Boolean(runtime.hovering || (Number.isFinite(runtime.lastHover) && now - runtime.lastHover <= graceMs));
}

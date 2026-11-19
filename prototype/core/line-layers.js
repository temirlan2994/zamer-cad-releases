export const DEFAULT_LINE_LAYER = "measure";
export const MAX_CUSTOM_LINE_LAYERS = 128;
export const MAX_LINE_LAYER_NAME_LENGTH = 48;
export const CUSTOM_LINE_LAYER_PREFIX = "line-layer-";

const customLayerId = /^line-layer-[A-Za-z0-9_-]{1,64}$/;
const layerNameCharacters = /[<>\p{Cc}\p{Cs}\p{Bidi_Control}\u2028\u2029]/u;
const layerColor = /^#[0-9a-f]{6}$/i;

export function isCustomLineLayerId(value) {
  return typeof value === "string" && customLayerId.test(value);
}

export function normalizeLineLayerName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= MAX_LINE_LAYER_NAME_LENGTH && !layerNameCharacters.test(name) ? name : null;
}

export function normalizeLineLayerColor(value) {
  return typeof value === "string" && layerColor.test(value) ? value.toLowerCase() : null;
}

export function normalizeCustomLineLayers(value) {
  if (!Array.isArray(value)) return [];
  const layers = [];
  const ids = new Set();
  for (const layer of value.slice(0, MAX_CUSTOM_LINE_LAYERS)) {
    if (!isCustomLineLayerId(layer?.id) || ids.has(layer.id)) continue;
    const name = normalizeLineLayerName(layer.name);
    const color = normalizeLineLayerColor(layer.color);
    if (!name || !color) continue;
    layers.push({ id: layer.id, name, color });
    ids.add(layer.id);
  }
  return layers;
}

export function normalizeActiveLineLayer(value, layers = []) {
  return value === DEFAULT_LINE_LAYER || (isCustomLineLayerId(value) && Array.isArray(layers) && layers.some((layer) => layer?.id === value))
    ? value : DEFAULT_LINE_LAYER;
}

export function normalizeLineLayerSettings(source) {
  const customLineLayers = normalizeCustomLineLayers(source?.customLineLayers);
  const activeLineLayer = normalizeActiveLineLayer(source?.activeLineLayer, customLineLayers);
  return { customLineLayers, activeLineLayer };
}

export const DEFAULT_LINE_LAYER = "measure";
export const MAX_CUSTOM_LINE_LAYERS = 128;
export const MAX_LINE_LAYER_NAME_LENGTH = 48;
export const CUSTOM_LINE_LAYER_PREFIX = "line-layer-";
export const DEFAULT_LINE_WEIGHT = 0.25;
export const LINE_WEIGHT_VALUES = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2];
export const DEFAULT_LINE_TYPE = "solid";
export const LINE_TYPE_VALUES = ["solid", "dashed", "dotted"];

const customLayerId = /^line-layer-[A-Za-z0-9_-]{1,64}$/;
const layerNameCharacters = /[<>\p{Cc}\p{Cs}\p{Bidi_Control}\u2028\u2029]/u;
const layerColor = /^#[0-9a-f]{6}$/i;
const builtInLayers = [DEFAULT_LINE_LAYER, "walls", "dimensions", "text", "areas", "elevations", "furniture"];

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

export function normalizeLineWeight(value) {
  if (value === "" || value == null || typeof value === "boolean") return null;
  const weight = Number(value);
  return Number.isFinite(weight) && weight >= 0.05 && weight <= 2
    ? Math.round(weight * 100) / 100 : null;
}

export function normalizeLineType(value) {
  return typeof value === "string" && LINE_TYPE_VALUES.includes(value) ? value : null;
}

export function normalizeLayerStyles(value, availableLayers = builtInLayers) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const available = availableLayers instanceof Set ? availableLayers : new Set(availableLayers);
  const styles = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (!available.has(id) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const color = normalizeLineLayerColor(candidate.color);
    const lineWeight = normalizeLineWeight(candidate.lineWeight);
    const lineType = normalizeLineType(candidate.lineType);
    const style = {};
    if (color) style.color = color;
    if (lineWeight !== null) style.lineWeight = lineWeight;
    if (lineType) style.lineType = lineType;
    if (Object.keys(style).length) styles[id] = style;
  }
  return styles;
}

export function resolveLineStyle(entity, layer, fallbackColor = "#26313d") {
  return {
    color: normalizeLineLayerColor(entity?.color) || normalizeLineLayerColor(layer?.color) || fallbackColor,
    lineWeight: normalizeLineWeight(entity?.lineWeight) ?? normalizeLineWeight(layer?.lineWeight) ?? DEFAULT_LINE_WEIGHT,
    lineType: normalizeLineType(entity?.lineType) || normalizeLineType(layer?.lineType) || DEFAULT_LINE_TYPE,
  };
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
  const available = new Set([...builtInLayers, ...customLineLayers.map(({ id }) => id)]);
  const lockedLayers = Array.isArray(source?.lockedLayers)
    ? [...new Set(source.lockedLayers.filter((id) => available.has(id)))] : [];
  const layerStyles = normalizeLayerStyles(source?.layerStyles, available);
  return { customLineLayers, activeLineLayer, lockedLayers, layerStyles };
}

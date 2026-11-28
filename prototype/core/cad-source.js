export const MAX_CAD_SOURCE_BYTES = 24 * 1024 * 1024;
const drawingKeys = ["entities", "customLineLayers", "layerStyles", "lockedLayers"];
const ignoredEntityKeys = new Set(["id", "groupId", "startLink", "endLink", "startAnchor", "endAnchor"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function cadEntityState(entity) {
  return JSON.stringify(canonical(Object.fromEntries(Object.entries(entity).filter(([key]) => !ignoredEntityKeys.has(key)))));
}

export function cadDrawingState(drawing) {
  return JSON.stringify(canonical({
    entities: drawing.entities.map(entity => [entity.id, cadEntityState(entity)]).sort(([a], [b]) => a.localeCompare(b)),
    customLineLayers: drawing.customLineLayers || [], layerStyles: drawing.layerStyles || {}, lockedLayers: drawing.lockedLayers || [],
  }));
}

export function cadSourceBytes(source) {
  const text = atob(source.data);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

export function validateCadSource(source, validEntity) {
  if (!source || source.version !== 1 || source.format !== "dwg" || typeof source.name !== "string" || source.name.length > 180 ||
      !/\.dwg$/i.test(source.name) || /[<>:"/\\|?*\p{Cc}]/u.test(source.name) ||
      typeof source.data !== "string" || source.data.length > MAX_CAD_SOURCE_BYTES * 4 / 3 ||
      source.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.data) ||
      !/^AC10\d{2}$/.test(atob(source.data.slice(0, 8))) ||
      !Number.isFinite(source.unitScale) || source.unitScale <= 0 ||
      !source.baseline || !Array.isArray(source.baseline.entities) || source.baseline.entities.length > 12000 ||
      !Array.isArray(source.bindings) || source.bindings.length !== source.baseline.entities.length) {
    throw new Error("Повреждены исходные данные DWG");
  }
  const ids = new Set();
  for (const entity of source.baseline.entities) {
    if (!validEntity(entity) || ids.has(entity.id)) throw new Error("Повреждена исходная геометрия DWG");
    ids.add(entity.id);
  }
  const bound = new Set();
  const handles = new Set();
  for (const binding of source.bindings) {
    if (!binding || !ids.has(binding.id) || bound.has(binding.id) || typeof binding.handle !== "string" ||
        !/^[0-9A-F]{1,13}$/.test(binding.handle) || parseInt(binding.handle, 16) === 0 ||
        !Number.isSafeInteger(parseInt(binding.handle, 16)) || handles.has(binding.handle) ||
        typeof binding.type !== "string" || typeof binding.layer !== "string") throw new Error("Повреждены связи объектов DWG");
    bound.add(binding.id); handles.add(binding.handle);
  }
  if (source.layerNames !== undefined && (!Array.isArray(source.layerNames) || source.layerNames.length > 300 ||
      source.layerNames.some(entry => !Array.isArray(entry) || entry.length !== 2 || entry.some(value => typeof value !== "string" || value.length > 300)))) {
    throw new Error("Повреждены связи слоёв исходного DWG");
  }
}

export function createCadSource(bytes, name, imported) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (array.length > MAX_CAD_SOURCE_BYTES) throw new Error("Исходный DWG слишком большой для включения в проект");
  const chunks = [];
  for (let index = 0; index < array.length; index += 32768) chunks.push(String.fromCharCode(...array.subarray(index, index + 32768)));
  const baseline = Object.fromEntries(drawingKeys.filter(key => imported.project[key] !== undefined).map(key => [key, imported.project[key]]));
  return {
    version: 1, format: "dwg", name: String(name).replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").replace(/\.dwg$/i, "").slice(0, 176) + ".dwg",
    data: btoa(chunks.join("")), unitScale: imported.unitScale, bindings: imported.bindings, layerNames: imported.sourceLayers,
    baseline: JSON.parse(JSON.stringify(baseline)),
  };
}

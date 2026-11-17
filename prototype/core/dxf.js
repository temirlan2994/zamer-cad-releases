import { writeDxf } from "./dxf-writer.js";

export * from "./dxf-writer.js";

export function buildDxf(entities, options = {}) {
  return writeDxf(entities, { profile: options.profile });
}

export function buildRevitDxf(entities) {
  return buildDxf(entities, { profile: "revit" });
}

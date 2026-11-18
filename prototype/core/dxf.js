import { writeModernDxf } from "./dxf-modern.js";

export * from "./dxf-writer.js";

export function buildDxf(entities, options = {}) {
  return writeModernDxf(entities, options.profile);
}

export function buildRevitDxf(entities) {
  return buildDxf(entities, { profile: "revit" });
}

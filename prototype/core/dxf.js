import { writeModernDxf } from "./dxf-modern.js";

export * from "./dxf-writer.js";

export function buildDxf(entities, options = {}) {
  return writeModernDxf(entities, options);
}

export function buildRevitDxf(entities, options = {}) {
  return buildDxf(entities, { ...options, profile: "revit" });
}

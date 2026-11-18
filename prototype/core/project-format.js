import { arcGeometry } from "./geometry.js";
import { isLinePoint, isValidLine } from "./line-edits.js";
import { validPolylinePoints } from "./polyline.js";

export const MAX_ZAMER_FILE_BYTES = 32 * 1024 * 1024;

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasXY(entity, x = "x", y = "y") {
  return isLinePoint({ x: entity[x], y: entity[y] });
}

function hasOptionalNumbers(entity, fields) {
  return fields.every((field) => entity[field] == null || Number.isFinite(entity[field]));
}

function validDimension(entity) {
  if (entity.dimensionKind === "angular") {
    const { vertex, arm1, arm2 } = entity;
    return [vertex, arm1, arm2].every(isLinePoint) &&
      Math.hypot(arm1.x - vertex.x, arm1.y - vertex.y) > 0 &&
      Math.hypot(arm2.x - vertex.x, arm2.y - vertex.y) > 0;
  }
  return isValidLine(entity) && hasOptionalNumbers(entity, ["offset", "dimX1", "dimY1", "dimX2", "dimY2", "height", "textHeight"]) &&
    (entity.text == null || typeof entity.text === "string");
}

export function validStoredEntity(entity) {
  if (!plainObject(entity) || typeof entity.id !== "string" || !entity.id.trim() ||
      (entity.layer != null && typeof entity.layer !== "string")) return false;
  switch (entity.type) {
    case "line": return entity.layer === "dimensions" ? validDimension(entity) : isValidLine(entity);
    case "wall": return isValidLine(entity) && (entity.width == null || (Number.isFinite(entity.width) && entity.width > 0));
    case "polyline": return validPolylinePoints(entity.points, entity.closed) && entity.points.every(isLinePoint);
    case "rectangle": return hasXY(entity, "x1", "y1") && hasXY(entity, "x2", "y2") && entity.x1 !== entity.x2 && entity.y1 !== entity.y2;
    case "circle": return hasXY(entity, "cx", "cy") && Number.isFinite(entity.radius) && entity.radius > 0;
    case "arc": {
      const { start, through, end } = entity;
      if (![start, through, end].every(isLinePoint)) return false;
      const arc = arcGeometry(start, through, end);
      return Boolean(arc && isLinePoint(arc.center) && Number.isFinite(arc.radius) && arc.radius > 0);
    }
    case "text": return hasXY(entity) && typeof entity.text === "string" && hasOptionalNumbers(entity, ["height", "rotation"]);
    case "block": return hasXY(entity) && (entity.kind == null || typeof entity.kind === "string") &&
      hasOptionalNumbers(entity, ["width", "height", "rotation", "scale"]);
    default: return false;
  }
}

function validateDrawing(drawing, label) {
  if (!plainObject(drawing) || !Array.isArray(drawing.entities)) throw new Error(`${label}: отсутствует список объектов`);
  const ids = new Set();
  for (const [index, entity] of drawing.entities.entries()) {
    if (!validStoredEntity(entity) || ids.has(entity.id)) throw new Error(`${label}: повреждён объект ${index + 1}`);
    ids.add(entity.id);
  }
  if (drawing.view != null && (!plainObject(drawing.view) ||
      !hasOptionalNumbers(drawing.view, ["scale", "panX", "panY"]))) throw new Error(`${label}: повреждены параметры вида`);
  const draft = drawing.draft;
  if (draft != null && (!plainObject(draft) || draft.tool !== "polyline" || !Array.isArray(draft.points) ||
      !draft.points.length || !draft.points.every(isLinePoint) || (draft.points.length > 1 && !validPolylinePoints(draft.points)))) {
    throw new Error(`${label}: повреждён черновик полилинии`);
  }
}

export function validateZamerProject(project) {
  if (!plainObject(project) || (project.version != null && ![1, 2].includes(project.version))) {
    throw new Error("Неизвестная версия файла .zamer");
  }
  if (project.name != null && typeof project.name !== "string") throw new Error("Повреждено название проекта");
  validateDrawing(project, "Чертёж");
  const survey = project.survey;
  if (survey != null) {
    if (!plainObject(survey) || survey.version !== 1 || (survey.rooms != null && !Array.isArray(survey.rooms))) {
      throw new Error("Неизвестная версия обмера");
    }
    for (const [index, room] of (survey.rooms || []).entries()) {
      if (!plainObject(room)) throw new Error(`Повреждено помещение ${index + 1}`);
      if (room.drawing != null) validateDrawing(room.drawing, `Помещение ${index + 1}`);
    }
  }
  return project;
}

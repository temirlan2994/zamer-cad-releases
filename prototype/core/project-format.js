import { additionalDimensionKinds, additionalDimensionArtwork } from "./dimension-artwork.js";
import { arcGeometry } from "./geometry.js";
import { isLinePoint, isValidLine, MAX_LINE_COORDINATE } from "./line-edits.js";
import { validPolylinePoints } from "./polyline.js";
import { normalizePlanAnnotation } from "./plan-annotations.js";
import { CUSTOM_LINE_LAYER_PREFIX, DEFAULT_LINE_LAYER, normalizeLineLayerColor, normalizeLineLayerSettings, normalizeLineType, normalizeLineWeight } from "./line-layers.js";
import { expandReusableBlock, isReusableBlock, normalizeReusableBlocks } from "./reusable-blocks.js";

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
  if (additionalDimensionKinds.includes(entity.dimensionKind)) {
    if (!hasXY(entity, "x1", "y1") || !hasXY(entity, "x2", "y2")) return false;
    const points = {
      "arc-length": [entity.arcStart, entity.arcThrough, entity.arcEnd],
      "jogged-radius": [entity.jogCenter, entity.jogRim],
      rotated: [entity.measureEnd],
      ordinate: [],
    };
    return points[entity.dimensionKind].every(isLinePoint) &&
      (entity.dimensionKind !== "ordinate" || ["x", "y"].includes(entity.ordinateAxis)) &&
      Boolean(additionalDimensionArtwork(entity, 1));
  }
  if (entity.dimensionKind === "radius" || entity.dimensionKind === "diameter") {
    return hasXY(entity, "x1", "y1") && hasXY(entity, "x2", "y2") &&
      Number.isFinite(entity.circleRadius) && entity.circleRadius > 0 && entity.circleRadius <= MAX_LINE_COORDINATE &&
      (entity.radialRim == null || isLinePoint(entity.radialRim));
  }
  if (entity.dimensionKind === "angular") {
    const { vertex, arm1, arm2, arcRadius } = entity;
    return [vertex, arm1, arm2].every(isLinePoint) &&
      (arcRadius == null || (Number.isFinite(arcRadius) && arcRadius > 1e-6 && arcRadius <= MAX_LINE_COORDINATE)) &&
      Math.hypot(arm1.x - vertex.x, arm1.y - vertex.y) > 0 &&
      Math.hypot(arm2.x - vertex.x, arm2.y - vertex.y) > 0;
  }
  return isValidLine(entity) && hasOptionalNumbers(entity, ["offset", "dimX1", "dimY1", "dimX2", "dimY2", "height", "textHeight"]) &&
    (entity.text == null || typeof entity.text === "string");
}

export function validStoredEntity(entity) {
  if (!plainObject(entity) || typeof entity.id !== "string" || !entity.id.trim() ||
      (entity.layer != null && typeof entity.layer !== "string") ||
      (entity.color != null && (typeof entity.color !== "string" || normalizeLineLayerColor(entity.color) !== entity.color.toLowerCase())) ||
      (entity.lineWeight != null && normalizeLineWeight(entity.lineWeight) !== entity.lineWeight) ||
      (entity.lineType != null && normalizeLineType(entity.lineType) !== entity.lineType) ||
      (entity.groupId != null && (typeof entity.groupId !== "string" || !entity.groupId.trim()))) return false;
  switch (entity.type) {
    case "line": {
      if (entity.dimensionKind === "leader" && entity.leaderElbow != null && !isLinePoint(entity.leaderElbow)) return false;
      return entity.layer === "dimensions" ? validDimension(entity) : isValidLine(entity);
    }
    case "wall": return isValidLine(entity) && (entity.width == null || (Number.isFinite(entity.width) && entity.width > 0));
    case "polyline": return validPolylinePoints(entity.points, entity.closed, entity.bulges) && entity.points.every(isLinePoint);
    case "rectangle": return hasXY(entity, "x1", "y1") && hasXY(entity, "x2", "y2") && entity.x1 !== entity.x2 && entity.y1 !== entity.y2;
    case "circle": return hasXY(entity, "cx", "cy") && Number.isFinite(entity.radius) && entity.radius > 0;
    case "area":
    case "elevation": return Boolean(normalizePlanAnnotation(entity));
    case "arc": {
      const { start, through, end } = entity;
      if (![start, through, end].every(isLinePoint)) return false;
      const arc = arcGeometry(start, through, end);
      return Boolean(arc && isLinePoint(arc.center) && Number.isFinite(arc.radius) && arc.radius > 0);
    }
    case "text": return hasXY(entity) && typeof entity.text === "string" &&
      hasOptionalNumbers(entity, ["height", "rotation", "textWidth"]) &&
      (entity.textWidth == null || (entity.textWidth > 0 && entity.textWidth <= MAX_LINE_COORDINATE)) &&
      (entity.textFrame == null || typeof entity.textFrame === "boolean");
    case "block": return hasXY(entity) && (entity.kind == null || typeof entity.kind === "string") &&
      hasOptionalNumbers(entity, ["width", "height", "rotation", "scale"]) &&
      (!isReusableBlock(entity) || Boolean(expandReusableBlock(entity)));
    default: return false;
  }
}

function validPolylineDraft(draft) {
  if (!plainObject(draft) || draft.tool !== "polyline" || !Array.isArray(draft.points) ||
      !draft.points.length || !draft.points.every(isLinePoint)) return false;
  if (draft.points.length === 1) {
    return isLinePoint(draft.points[0]) && (draft.bulges === undefined || (Array.isArray(draft.bulges) && draft.bulges.length === 0));
  }
  return validPolylinePoints(draft.points, false, draft.bulges);
}

function validateDrawing(drawing, label, customLayerIds) {
  if (!plainObject(drawing) || !Array.isArray(drawing.entities)) throw new Error(`${label}: отсутствует список объектов`);
  const ids = new Set();
  for (const [index, entity] of drawing.entities.entries()) {
    if (!validStoredEntity(entity) || ids.has(entity.id)) throw new Error(`${label}: повреждён объект ${index + 1}`);
    const layers = [entity.layer, ...(isReusableBlock(entity) ? entity.parts.map(part => part.layer) : [])];
    if (layers.some(layer => layer?.startsWith(CUSTOM_LINE_LAYER_PREFIX) && !customLayerIds.has(layer))) {
      throw new Error(`${label}: неизвестный слой у объекта ${index + 1}`);
    }
    ids.add(entity.id);
  }
  if (drawing.view != null && (!plainObject(drawing.view) ||
      !hasOptionalNumbers(drawing.view, ["scale", "panX", "panY"]))) throw new Error(`${label}: повреждены параметры вида`);
  const draft = drawing.draft;
  if (draft != null && (!validPolylineDraft(draft) || (draft.layer !== undefined &&
      draft.layer !== DEFAULT_LINE_LAYER && !customLayerIds.has(draft.layer)))) {
    throw new Error(`${label}: повреждён черновик полилинии`);
  }
}

export function validateZamerProject(project) {
  if (!plainObject(project) || (project.version != null && ![1, 2].includes(project.version))) {
    throw new Error("Неизвестная версия файла .zamer");
  }
  if (project.name != null && typeof project.name !== "string") throw new Error("Повреждено название проекта");
  const { customLineLayers, activeLineLayer, lockedLayers, layerStyles } = normalizeLineLayerSettings(project);
  if (project.customLineLayers !== undefined && (!Array.isArray(project.customLineLayers) ||
      project.customLineLayers.length !== customLineLayers.length)) throw new Error("Повреждены слои линий");
  if (project.activeLineLayer !== undefined && project.activeLineLayer !== activeLineLayer) {
    throw new Error("Неизвестный активный слой линий");
  }
  if (project.lockedLayers !== undefined && (!Array.isArray(project.lockedLayers) ||
      project.lockedLayers.length !== lockedLayers.length)) throw new Error("Повреждён список заблокированных слоёв");
  if (project.layerStyles !== undefined && (!plainObject(project.layerStyles) ||
      Object.keys(project.layerStyles).length !== Object.keys(layerStyles).length ||
      Object.entries(project.layerStyles).some(([id, style]) => !plainObject(style) || !layerStyles[id] ||
        Object.keys(style).some((key) => !["color", "lineWeight", "lineType"].includes(key)) ||
        (style.color !== undefined && (typeof style.color !== "string" || normalizeLineLayerColor(style.color) !== style.color.toLowerCase())) ||
        (style.lineWeight !== undefined && normalizeLineWeight(style.lineWeight) !== style.lineWeight) ||
        (style.lineType !== undefined && normalizeLineType(style.lineType) !== style.lineType)))) {
    throw new Error("Повреждено оформление слоёв");
  }
  const customLayerIds = new Set(customLineLayers.map(({ id }) => id));
  if (project.reusableBlocks !== undefined) {
    const blocks = normalizeReusableBlocks(project.reusableBlocks);
    if (!Array.isArray(project.reusableBlocks) || project.reusableBlocks.length !== blocks.length) throw new Error("Повреждена библиотека блоков");
    if (blocks.some(block => block.parts.some(({ layer }) => layer?.startsWith(CUSTOM_LINE_LAYER_PREFIX) && !customLayerIds.has(layer)))) {
      throw new Error("Неизвестный слой в библиотеке блоков");
    }
  }
  validateDrawing(project, "Чертёж", customLayerIds);
  const survey = project.survey;
  if (survey != null) {
    if (!plainObject(survey) || survey.version !== 1 || (survey.rooms != null && !Array.isArray(survey.rooms))) {
      throw new Error("Неизвестная версия обмера");
    }
    for (const [index, room] of (survey.rooms || []).entries()) {
      if (!plainObject(room)) throw new Error(`Повреждено помещение ${index + 1}`);
      if (room.drawing != null) validateDrawing(room.drawing, `Помещение ${index + 1}`, customLayerIds);
    }
  }
  return project;
}

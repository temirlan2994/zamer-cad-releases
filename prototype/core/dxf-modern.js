import { annotationTextLines, annotationTextWidth, annotationWorldSize, leaderAppearance, leaderElbowPoint, leaderFrameSize, leaderPlanPath, leaderTextHeight } from "./annotation-text.js";
import { angularDimensionGeometry, dimensionGeometry } from "./dimensions.js";
import { angularDimensionArtwork, linearDimensionArtwork } from "./dimension-artwork.js";
import { appendDxfEntityRecords, appendDxfPolyline, dxfArc, dxfLayers, dxfLine, dxfText } from "./dxf-writer.js";
import { pointInPolygon } from "./geometry.js";
import {
  planAnnotationAnchors, planAnnotationGeometry, planZoneLabelHeight, planZoneLabelLines, planZoneLabelRing,
  PLAN_ANNOTATION_LAYERS, PLAN_AREA_COLOR, PLAN_ELEVATION_STYLES,
} from "./plan-annotations.js";
import { formatProjectAngle, formatProjectLength, normalizeMeasurementSettings, projectUnit } from "./project-settings.js";

const POINT_EPSILON = 1e-6;
const MAX_LAYER_NAME = 255;
const STYLE = "STANDARD";
const DXF_LINE_SPACING = 1.4; // DXF uses cap height. Extra space keeps descenders clear of the next line.
const ANNOTATION_LAYERS = [
  { key: PLAN_ANNOTATION_LAYERS.area, revit: "ZAMER_AREA", color: 4, trueColor: Number.parseInt(PLAN_AREA_COLOR.slice(1), 16) },
  { key: PLAN_ANNOTATION_LAYERS.elevation, revit: "ZAMER_Z", color: 3, trueColor: Number.parseInt(PLAN_ELEVATION_STYLES.ceiling.color.slice(1), 16) },
  { key: "text", revit: "ZAMER_TEXT", color: 6, trueColor: 0x754997 },
];
const SUBCLASSES = {
  LINE: "AcDbLine",
  LWPOLYLINE: "AcDbPolyline",
  CIRCLE: "AcDbCircle",
  POINT: "AcDbPoint",
  TEXT: "AcDbText",
};

function limitLayerName(value, length) {
  return value.slice(0, length).replace(/[\uD800-\uDBFF]$/u, "").trimEnd();
}

function customDxfLayers(definitions, builtInLayers, profile) {
  if (!Array.isArray(definitions)) return [];
  const usedKeys = new Set(["0", "axes", ...builtInLayers.map(({ key }) => key)]);
  const usedNames = new Set(["0", "DEFPOINTS", "BYLAYER", "BYBLOCK", ...builtInLayers.map(({ name }) => name.toUpperCase())]);
  const nextNumber = new Map();
  const prefix = profile === "revit" ? "ZAMER_" : "";
  const layers = [];
  for (const definition of definitions) {
    const { id, name, color } = definition ?? {};
    if (typeof id !== "string" || !id.trim() || usedKeys.has(id)) continue;
    const sanitized = typeof name === "string"
      ? name.normalize("NFC").replace(/[<>/\\":;?*|=`\p{Cc}\p{Cs}\u2028\u2029]+/gu, "_").trim() : "";
    const base = limitLayerName(`${prefix}${sanitized || "Слой"}`, MAX_LAYER_NAME);
    const key = base.toUpperCase();
    let number = nextNumber.get(key) ?? 1;
    let unique = base;
    if (number > 1 || usedNames.has(key)) {
      number = Math.max(number, 2);
      do {
        const suffix = ` (${number++})`;
        unique = `${limitLayerName(base, MAX_LAYER_NAME - suffix.length)}${suffix}`;
      } while (usedNames.has(unique.toUpperCase()));
    }
    nextNumber.set(key, number);
    usedKeys.add(id);
    usedNames.add(unique.toUpperCase());
    const hex = typeof color === "string" && /^#[\da-f]{6}$/iu.test(color) ? color.slice(1) : null;
    layers.push({ key: id, name: unique, color: 7, trueColor: hex ? Number.parseInt(hex, 16) : undefined });
  }
  return layers;
}

function pointFields(code, point) {
  return [code, point.x, code + 10, -point.y, code + 20, 0];
}

function offsetPoint(point, dx, dy) {
  return { x: point.x + dx, y: point.y + dy };
}

function appendLine(out, start, end, layer) {
  out.push(...dxfLine(start.x, start.y, end.x, end.y, layer, 0, 0, true));
}

function appendArrow(out, point, ux, uy, size, layer) {
  const base = offsetPoint(point, ux * size, uy * size);
  const wing = size * 0.48;
  appendLine(out, point, offsetPoint(base, -uy * wing, ux * wing), layer);
  appendLine(out, point, offsetPoint(base, uy * wing, -ux * wing), layer);
}

function appendCenteredText(out, point, text, height, rotation, layer) {
  const record = dxfText({ ...point, text, height, rotation }, layer, true);
  if (record.length) out.push(...record, 72, 1, ...pointFields(11, point), 100, "AcDbText", 73, 2);
}

function appendCenteredTextLines(out, center, lines, height, layer) {
  const step = height * DXF_LINE_SPACING;
  const topOffset = (lines.length - 1) * step / 2;
  for (const [index, line] of lines.entries()) {
    if (line.trim()) appendCenteredText(out, offsetPoint(center, 0, index * step - topOffset), line, height, 0, layer);
  }
}

function appendPlanText(out, entity, layer) {
  const height = Math.abs(entity.height || 260);
  const rotation = entity.rotation || 0;
  const radians = rotation * Math.PI / 180;
  for (const [index, text] of annotationTextLines(entity.text).entries()) {
    const dy = index * height * DXF_LINE_SPACING;
    const point = offsetPoint(entity, -Math.sin(radians) * dy, Math.cos(radians) * dy);
    if (text.trim()) out.push(...dxfText({ ...point, text, height, rotation }, layer, true));
  }
}

function appendPlanLeader(out, entity, layer) {
  const { x1, y1, x2, y2 } = entity;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return;
  const arrow = { x: x1, y: y1 };
  const center = { x: x2, y: y2 };
  const lines = annotationTextLines(entity.text);
  const height = leaderTextHeight(entity);
  const { line, frame } = leaderAppearance(entity);
  const { width, height: labelHeight } = leaderFrameSize(height, annotationTextWidth(lines, height), lines.length, frame, DXF_LINE_SPACING);
  const rect = { x: x2 - width / 2, y: y2 - labelHeight / 2, width, height: labelHeight };
  const path = leaderPlanPath(arrow, rect, line, 1.1 * height, leaderElbowPoint(entity));
  for (let i = 1; i < path.length; i += 1) appendLine(out, path[i - 1], path[i], layer);
  const direction = path.find((point) => Math.hypot(point.x - x1, point.y - y1) > POINT_EPSILON);
  if (direction) {
    const length = Math.hypot(direction.x - x1, direction.y - y1);
    const size = Math.min(height * 0.66, length * 0.28);
    appendArrow(out, arrow, (direction.x - x1) / length, (direction.y - y1) / length, size, layer);
  }
  if (frame) {
    const corner = { x: rect.x, y: rect.y };
    appendDxfPolyline(out, { closed: true, points: [corner, offsetPoint(corner, width, 0),
      offsetPoint(corner, width, labelHeight), offsetPoint(corner, 0, labelHeight)] }, layer, true);
  }
  appendCenteredTextLines(out, center, lines, height, layer);
}

function placeZoneLabel(geometry, anchor, width, height, occupied) {
  const { bounds, points } = geometry;
  function candidate(point) {
    const minX = point.x - width / 2;
    const maxX = point.x + width / 2;
    const minY = point.y - height / 2;
    const maxY = point.y + height / 2;
    if (minX < bounds.minX || maxX > bounds.maxX || minY < bounds.minY || maxY > bounds.maxY) return null;
    if (occupied.some((other) => minX < other.maxX && maxX > other.minX && minY < other.maxY && maxY > other.minY)) return null;
    if (!pointInPolygon(point, points)) return null;
    return { minX, maxX, minY, maxY };
  }
  let position = anchor;
  let box = candidate(position);
  if (!box) {
    let closest = Infinity;
    for (let row = 1; row < 8; row += 1) {
      for (let column = 1; column < 8; column += 1) {
        const x = bounds.minX + (bounds.maxX - bounds.minX) * column / 8;
        const y = bounds.minY + (bounds.maxY - bounds.minY) * row / 8;
        const distance = Math.hypot(x - anchor.x, y - anchor.y);
        if (distance >= closest) continue;
        const next = candidate({ x, y });
        if (!next) continue;
        closest = distance;
        position = { x, y };
        box = next;
      }
    }
  }
  occupied.push(box || { minX: position.x - width / 2, maxX: position.x + width / 2,
    minY: position.y - height / 2, maxY: position.y + height / 2 });
  return position;
}

function planZoneRecords({ entity, geometry, layer, anchor = geometry.anchor }, occupied, scaleFactor, measurementSettings) {
  const styleKey = Object.hasOwn(PLAN_ELEVATION_STYLES, entity.zoneStyle) ? entity.zoneStyle : "ceiling";
  const style = entity.type === "elevation" ? PLAN_ELEVATION_STYLES[styleKey] : null;
  const lines = planZoneLabelLines(entity, geometry, measurementSettings);
  const labelWidth = annotationTextWidth(lines, 1) * 1.2 + 1.2;
  const labelHeight = (lines.length - 1) * DXF_LINE_SPACING + 1.7;
  const ring = planZoneLabelRing(geometry, anchor);
  const height = planZoneLabelHeight(lines, ring.bounds, scaleFactor);
  const records = [];
  for (const points of geometry.contours) appendDxfPolyline(records, { points, closed: true }, layer, true);
  if (height >= 0.001) {
    const center = placeZoneLabel(ring, anchor, labelWidth * height, labelHeight * height, occupied);
    appendCenteredTextLines(records, center, lines, height, layer);
  }
  return { records, trueColor: style ? Number.parseInt(style.color.slice(1), 16) : null };
}

function linearDimension(entity, layer, scaleFactor, measurementSettings) {
  const geometry = dimensionGeometry(entity);
  const art = linearDimensionArtwork(geometry, scaleFactor);
  if (!art || geometry.measurement <= POINT_EPSILON) return null;
  const { start, end, lineStart, lineEnd, measurement, mode } = geometry;
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const { ux, uy, label, arrowSize, textHeight, rotation } = art;
  const text = formatProjectLength(measurement, measurementSettings);
  const degrees = Math.atan2(dy, dx) * 180 / Math.PI;
  const graphics = [];
  appendLine(graphics, art.start, art.extensionStart, layer);
  appendLine(graphics, art.end, art.extensionEnd, layer);
  appendLine(graphics, art.lineStart, art.lineEnd, layer);
  appendArrow(graphics, art.lineStart, ux, uy, arrowSize, layer);
  appendArrow(graphics, art.lineEnd, -ux, -uy, arrowSize, layer);
  appendCenteredText(graphics, label, text, textHeight, rotation * 180 / Math.PI, layer);
  const nativeMeasurement = Math.abs((end.x - start.x) * ux + (end.y - start.y) * uy);
  const aligned = mode === "aligned";
  const textOverride = Math.abs(nativeMeasurement - measurement) <= POINT_EPSILON ? `<> ${projectUnit(measurementSettings).label}` : text;
  return {
    layer, label, graphics, textOverride, measurement, type: aligned ? 1 : 0, base: lineEnd,
    fields: [
      100, "AcDbAlignedDimension", ...pointFields(13, start), ...pointFields(14, end), 50, -degrees,
      ...(aligned ? [] : [100, "AcDbRotatedDimension"]),
    ],
  };
}

function angularDimension(entity, layer, scaleFactor, measurementSettings) {
  const geometry = angularDimensionGeometry(entity);
  const artwork = angularDimensionArtwork(geometry, scaleFactor, entity.arcRadius);
  if (!artwork) return null;
  const { vertex, arm1, arm2, startAngle, sweep, measurement } = geometry;
  const { radius, textHeight, base, label } = artwork;
  const text = formatProjectAngle(measurement, measurementSettings);
  const graphics = [];
  appendLine(graphics, vertex, artwork.firstLegEnd, layer);
  appendLine(graphics, vertex, artwork.secondLegEnd, layer);
  if (Math.abs(sweep) > Number.EPSILON) {
    graphics.push(...dxfArc({ center: vertex, radius, startAngle, endAngle: startAngle + sweep, counterClockwise: sweep > 0 }, layer, true));
  }
  appendCenteredText(graphics, label, text, textHeight, 0, layer);
  const [first, second] = sweep > 0 ? [arm2, arm1] : [arm1, arm2];
  return {
    layer, label, graphics, textOverride: "<>°", measurement: Math.abs(sweep), type: 5, base,
    fields: [100, "AcDb3PointAngularDimension", ...pointFields(13, first), ...pointFields(14, second), ...pointFields(15, vertex)],
  };
}

function appendEntityStart(out, kind, handle, owner, layer) {
  out.push(0, kind, 5, handle, 330, owner, 100, "AcDbEntity", 8, layer);
}

function appendPrimitiveEntities(out, primitives, owner, nextHandle, trueColor = null) {
  for (let start = 0; start < primitives.length;) {
    const kind = primitives[start + 1];
    const layer = primitives[start + 3];
    let end = start + 4;
    while (end < primitives.length && primitives[end] !== "0") end += 2;
    appendEntityStart(out, kind, nextHandle(), owner, layer);
    if (trueColor !== null) out.push(420, trueColor);
    out.push(100, kind === "ARC" ? "AcDbCircle" : SUBCLASSES[kind]);
    for (let index = start + 4; index < end; index += 2) {
      if (kind === "ARC" && primitives[index] === "50") out.push(100, "AcDbArc");
      out.push(primitives[index], primitives[index + 1]);
    }
    if (kind === "TEXT" && primitives[end - 2] !== 73) out.push(100, "AcDbText");
    start = end;
  }
}

function appendDimension(out, dimension, owner, nextHandle) {
  appendEntityStart(out, "DIMENSION", nextHandle(), owner, dimension.layer);
  out.push(
    100, "AcDbDimension", 2, dimension.block.name, 3, STYLE,
    ...pointFields(10, dimension.base), ...pointFields(11, dimension.label),
    70, 32 | dimension.type, 71, 5, 42, dimension.measurement, 1, dimension.textOverride,
    ...dimension.fields,
  );
}

function appendTable(out, nextHandle, table, subclass, entries) {
  const handle = nextHandle();
  out.push(0, "TABLE", 2, table, 5, handle, 330, 0, 100, "AcDbSymbolTable", 70, entries.length);
  if (table === "DIMSTYLE") out.push(100, "AcDbDimStyleTable", 71, entries.length);
  for (const [id, ...fields] of entries) {
    out.push(0, table, table === "DIMSTYLE" ? 105 : 5, id, 330, handle,
      100, "AcDbSymbolTableRecord", 100, subclass, ...fields);
  }
  out.push(0, "ENDTAB");
}

function appendBlock(out, nextHandle, block) {
  appendEntityStart(out, "BLOCK", nextHandle(), block.handle, "0");
  out.push(100, "AcDbBlockBegin", 2, block.name, 70, block.graphics ? 1 : 0, 10, 0, 20, 0, 30, 0, 3, block.name, 1, "");
  if (block.graphics) appendPrimitiveEntities(out, block.graphics, block.handle, nextHandle);
  appendEntityStart(out, "ENDBLK", nextHandle(), block.handle, "0");
  out.push(100, "AcDbBlockEnd");
}

function appendLayouts(out, nextHandle, modelSpace, paperSpace) {
  const dictionary = nextHandle();
  const layouts = nextHandle();
  out.push(0, "SECTION", 2, "OBJECTS",
    0, "DICTIONARY", 5, dictionary, 330, 0, 100, "AcDbDictionary", 281, 1, 3, "ACAD_LAYOUT", 350, layouts,
    0, "DICTIONARY", 5, layouts, 330, dictionary, 100, "AcDbDictionary", 281, 1,
    3, "Model", 350, modelSpace.layout, 3, "Layout1", 350, paperSpace.layout,
  );
  for (const [name, block, order] of [["Model", modelSpace, 0], ["Layout1", paperSpace, 1]]) {
    out.push(0, "LAYOUT", 5, block.layout, 330, layouts,
      100, "AcDbPlotSettings", 1, "", 4, "A4", 44, 297, 45, 210, 72, 1,
      100, "AcDbLayout", 1, name, 70, 1, 71, order, 330, block.handle);
  }
  out.push(0, "ENDSEC");
}

export function writeModernDxf(entities, { profile, annotationScale, measurementSettings, customLineLayers } = {}) {
  const display = normalizeMeasurementSettings(measurementSettings);
  const model = [];
  const dimensions = [];
  const annotations = [];
  const zones = [];
  const options = { profile, preserveLinePrecision: true, modern: true };
  const builtInLayers = dxfLayers(options).concat(ANNOTATION_LAYERS.map((layer) => ({
    ...layer, name: profile === "revit" ? layer.revit : layer.key,
  })));
  const customLayers = customDxfLayers(customLineLayers, builtInLayers, profile);
  const layerNames = new Map([...builtInLayers, ...customLayers].map(({ key, name }) => [key, name]));
  const dimensionLayer = layerNames.get("dimensions");
  const textLayer = layerNames.get("text");
  const anchors = planAnnotationAnchors(entities.filter(Boolean));
  for (const entity of entities) {
    if (entity?.type === "line" && entity.dimensionKind === "angular") {
      const dimension = angularDimension(entity, dimensionLayer, annotationScale, display);
      if (dimension) dimensions.push(dimension);
    } else if (entity?.type === "line" && entity.dimensionKind === "leader") {
      const records = [];
      appendPlanLeader(records, entity, textLayer);
      annotations.push({ records });
    } else if (entity?.type === "line" && entity.layer === "dimensions") {
      const dimension = linearDimension(entity, dimensionLayer, annotationScale, display);
      if (dimension) dimensions.push(dimension);
    } else if (entity?.type === "text") {
      const records = [];
      appendPlanText(records, entity, layerNames.get(entity.layer) || textLayer);
      annotations.push({ records });
    } else if (Object.hasOwn(PLAN_ANNOTATION_LAYERS, entity?.type)) {
      const layer = layerNames.get(PLAN_ANNOTATION_LAYERS[entity.type]);
      const geometry = planAnnotationGeometry(entity);
      if (geometry) zones.push({ entity, geometry, layer, anchor: anchors.get(entity.id) });
    } else if (entity) {
      model.push(entity.type === "block" && entity.rotation == null ? { ...entity, rotation: 0 } : entity);
    }
  }

  const records = [];
  appendDxfEntityRecords(records, model, { ...options, extraLayers: customLayers });
  const emittedLayers = new Set();
  for (const primitives of [records, ...annotations.map((annotation) => annotation.records)]) {
    for (let index = 0; index < primitives.length; index += 2) {
      if (primitives[index] === "8") emittedLayers.add(primitives[index + 1]);
    }
  }
  const drawingLayers = builtInLayers.filter(({ key, name }) =>
    (key !== "walls" && key !== "furniture") || emittedLayers.has(name))
    .concat(customLayers.filter(({ name }) => emittedLayers.has(name)));

  let handleIndex = 1;
  const nextHandle = () => (handleIndex++).toString(16).toUpperCase();
  const modelSpace = { name: "*Model_Space", handle: nextHandle(), layout: nextHandle() };
  const paperSpace = { name: "*Paper_Space", handle: nextHandle(), layout: nextHandle() };
  const styleHandle = nextHandle();
  const blocks = [modelSpace, paperSpace];
  for (const dimension of dimensions) {
    dimension.block = { name: `*D${blocks.length - 1}`, handle: nextHandle(), graphics: dimension.graphics };
    blocks.push(dimension.block);
  }

  const out = [0, "SECTION", 2, "TABLES"];
  appendTable(out, nextHandle, "LTYPE", "AcDbLinetypeTableRecord", ["ByBlock", "ByLayer", "Continuous"].map((name) =>
    [nextHandle(), 2, name, 70, 0, 3, "", 72, 65, 73, 0, 40, 0]));
  appendTable(out, nextHandle, "LAYER", "AcDbLayerTableRecord", [{ name: "0", color: 7 }, ...drawingLayers].map(({ name, color, trueColor }) =>
    [nextHandle(), 2, name, 70, 0, 62, color, 6, "Continuous", ...(trueColor === undefined ? [] : [420, trueColor])]));
  appendTable(out, nextHandle, "STYLE", "AcDbTextStyleTableRecord", [
    [styleHandle, 2, STYLE, 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 120, 3, "arial.ttf", 4, ""],
  ]);
  appendTable(out, nextHandle, "DIMSTYLE", "AcDbDimStyleTableRecord", [
    [nextHandle(), 2, STYLE, 70, 0, 40, 1, 41, annotationWorldSize(9, annotationScale),
      78, 8, 79, 2, 140, annotationWorldSize(12, annotationScale), 144, 1 / projectUnit(display).factor,
      179, display.anglePrecision, 271, display.precision, 275, 0, 277, 2, 278, 44, 340, styleHandle],
  ]);
  appendTable(out, nextHandle, "BLOCK_RECORD", "AcDbBlockTableRecord", blocks.map(({ handle, name, layout }) =>
    [handle, 2, name, 340, layout ?? 0, 70, 0, 280, 1, 281, 0]));
  out.push(0, "ENDSEC", 0, "SECTION", 2, "BLOCKS");
  for (const block of blocks) appendBlock(out, nextHandle, block);
  out.push(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  appendPrimitiveEntities(out, records, modelSpace.handle, nextHandle);
  const occupied = [];
  // Small zones have fewer places for a readable label, so reserve their space first.
  const zoneRecords = new Map([...zones].sort((a, b) => a.geometry.areaMm2 - b.geometry.areaMm2)
    .map((zone) => [zone, planZoneRecords(zone, occupied, annotationScale, display)]));
  for (const zone of zones) {
    const annotation = zoneRecords.get(zone);
    appendPrimitiveEntities(out, annotation.records, modelSpace.handle, nextHandle, annotation.trueColor);
  }
  for (const annotation of annotations) appendPrimitiveEntities(out, annotation.records, modelSpace.handle, nextHandle, annotation.trueColor);
  for (const dimension of dimensions) appendDimension(out, dimension, modelSpace.handle, nextHandle);
  out.push(0, "ENDSEC");
  appendLayouts(out, nextHandle, modelSpace, paperSpace);
  out.push(0, "EOF");

  const header = [
    0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021",
    9, "$INSUNITS", 70, 4, 9, "$MEASUREMENT", 70, 1, 9, "$LUNITS", 70, 2, 9, "$AUNITS", 70, 0,
    9, "$HANDSEED", 5, nextHandle(), 0, "ENDSEC",
  ];
  return `${header.concat(out).join("\n")}\n`;
}

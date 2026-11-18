import { angularDimensionGeometry, dimensionGeometry, formatDimensionLength } from "./dimensions.js";
import { appendDxfEntityRecords, dxfArc, dxfLayers, dxfLine, dxfText } from "./dxf-writer.js";

const POINT_EPSILON = 1e-6;
const STYLE = "STANDARD";
const SUBCLASSES = {
  LINE: "AcDbLine",
  LWPOLYLINE: "AcDbPolyline",
  CIRCLE: "AcDbCircle",
  POINT: "AcDbPoint",
  TEXT: "AcDbText",
};

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

function linearDimension(entity, layer) {
  const geometry = dimensionGeometry(entity);
  if (!geometry || geometry.measurement <= POINT_EPSILON) return null;
  const { start, end, lineStart, lineEnd, measurement, mode, offset } = geometry;
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= POINT_EPSILON) return null;
  const ux = dx / length;
  const uy = dy / length;
  const text = `${formatDimensionLength(geometry)} мм`;
  const arrowSize = Math.min(180, length * 0.07);
  const textHeight = Math.min(260, Math.max(120, length * 0.045));
  const midpoint = offsetPoint(lineStart, dx / 2, dy / 2);
  const reverse = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
  const side = (offset < 0 ? -1 : 1) * (reverse ? -1 : 1);
  const label = offsetPoint(midpoint, -uy * side * textHeight, ux * side * textHeight);
  const degrees = Math.atan2(dy, dx) * 180 / Math.PI;
  const rotation = degrees > 90 ? degrees - 180 : degrees <= -90 ? degrees + 180 : degrees;
  const graphics = [];
  appendLine(graphics, start, lineStart, layer);
  appendLine(graphics, end, lineEnd, layer);
  appendLine(graphics, lineStart, lineEnd, layer);
  appendArrow(graphics, lineStart, ux, uy, arrowSize, layer);
  appendArrow(graphics, lineEnd, -ux, -uy, arrowSize, layer);
  appendCenteredText(graphics, label, text, textHeight, rotation, layer);
  const nativeMeasurement = Math.abs((end.x - start.x) * ux + (end.y - start.y) * uy);
  const aligned = mode === "aligned";
  const textOverride = Math.abs(nativeMeasurement - measurement) <= POINT_EPSILON ? "<> мм" : text;
  return {
    layer, label, graphics, textOverride, measurement, type: aligned ? 1 : 0, base: lineEnd,
    fields: [
      100, "AcDbAlignedDimension", ...pointFields(13, start), ...pointFields(14, end), 50, -degrees,
      ...(aligned ? [] : [100, "AcDbRotatedDimension"]),
    ],
  };
}

function angularDimension(entity, layer) {
  const geometry = angularDimensionGeometry(entity);
  if (!geometry) return null;
  const { vertex, arm1, arm2, startAngle, sweep, measurement } = geometry;
  const radius = Math.min(1000, Math.min(Math.hypot(arm1.x - vertex.x, arm1.y - vertex.y),
    Math.hypot(arm2.x - vertex.x, arm2.y - vertex.y)) * 0.52);
  if (!Number.isFinite(radius) || radius <= POINT_EPSILON) return null;
  const textHeight = Math.min(260, Math.max(120, radius * 0.25));
  const middleAngle = startAngle + sweep / 2;
  const atMiddle = (distance) => offsetPoint(vertex, Math.cos(middleAngle) * distance, Math.sin(middleAngle) * distance);
  const base = atMiddle(radius);
  const label = atMiddle(radius + textHeight);
  const text = `${Math.round(measurement)}°`;
  const graphics = [];
  appendLine(graphics, vertex, arm1, layer);
  appendLine(graphics, vertex, arm2, layer);
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

function appendPrimitiveEntities(out, primitives, owner, nextHandle) {
  for (let start = 0; start < primitives.length;) {
    const kind = primitives[start + 1];
    const layer = primitives[start + 3];
    let end = start + 4;
    while (end < primitives.length && primitives[end] !== "0") end += 2;
    appendEntityStart(out, kind, nextHandle(), owner, layer);
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

export function writeModernDxf(entities, profile) {
  const model = [];
  const dimensions = [];
  const options = { profile, preserveLinePrecision: true, modern: true };
  const layers = dxfLayers(options);
  const dimensionLayer = layers.find(({ key }) => key === "dimensions").name;
  for (const entity of entities) {
    if (entity?.type === "line" && entity.dimensionKind === "angular") {
      const dimension = angularDimension(entity, dimensionLayer);
      if (dimension) dimensions.push(dimension);
    } else if (entity?.type === "line" && entity.layer === "dimensions" && entity.dimensionKind !== "leader") {
      const dimension = linearDimension(entity, dimensionLayer);
      if (dimension) dimensions.push(dimension);
    } else if (entity) {
      model.push(entity);
    }
  }

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
  appendTable(out, nextHandle, "LAYER", "AcDbLayerTableRecord", [{ name: "0", color: 7 }, ...layers].map(({ name, color }) =>
    [nextHandle(), 2, name, 70, 0, 62, color, 6, "Continuous"]));
  appendTable(out, nextHandle, "STYLE", "AcDbTextStyleTableRecord", [
    [styleHandle, 2, STYLE, 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 120, 3, "arial.ttf", 4, ""],
  ]);
  appendTable(out, nextHandle, "DIMSTYLE", "AcDbDimStyleTableRecord", [
    [nextHandle(), 2, STYLE, 70, 0, 40, 1, 41, 80, 140, 120, 179, 0, 271, 0, 275, 0, 277, 2, 340, styleHandle],
  ]);
  appendTable(out, nextHandle, "BLOCK_RECORD", "AcDbBlockTableRecord", blocks.map(({ handle, name, layout }) =>
    [handle, 2, name, 340, layout ?? 0, 70, 0, 280, 1, 281, 0]));
  out.push(0, "ENDSEC", 0, "SECTION", 2, "BLOCKS");
  for (const block of blocks) appendBlock(out, nextHandle, block);
  out.push(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  const records = [];
  appendDxfEntityRecords(records, model, options);
  appendPrimitiveEntities(out, records, modelSpace.handle, nextHandle);
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

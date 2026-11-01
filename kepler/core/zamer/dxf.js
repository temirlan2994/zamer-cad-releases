// DXF (R12-style ASCII) serialization. Pure: takes plain entity objects,
// returns a DXF string. World Y is flipped to DXF's Y-up convention.

import { offsetWall, radToDeg, normalizeDegrees, arcGeometry } from "./geometry.js";
import { blockSegments } from "./blocks.js";

const DEFAULT_LAYER_DEFS = [
  { key: "walls", name: "walls", color: 7 },
  { key: "dimensions", name: "dimensions", color: 5 },
  { key: "furniture", name: "furniture", color: 3 },
  { key: "measure", name: "measure", color: 4 },
];

const REVIT_LAYER_DEFS = [
  { key: "walls", name: "ZAMER_WALLS", color: 7 },
  { key: "dimensions", name: "ZAMER_DIMENSIONS", color: 7 },
  { key: "furniture", name: "ZAMER_FURNITURE", color: 7 },
  { key: "measure", name: "ZAMER_MEASURE", color: 7 },
];

export function roundDxf(value) {
  return String(Math.round(value * 1000) / 1000);
}

export function dxfString(value) {
  const source = String(value ?? "").replace(/[\r\n]+/g, " ");
  let encoded = "";
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 32 && codePoint <= 126) {
      encoded += character;
    } else if (codePoint < 32) {
      encoded += " ";
    } else {
      const width = codePoint <= 0xffff ? 4 : 8;
      encoded += `\\U+${codePoint.toString(16).toUpperCase().padStart(width, "0")}`;
    }
  }
  return encoded;
}

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function finitePoint(point) {
  return finiteNumber(point?.x) && finiteNumber(point?.y);
}

export function dxfLayer(name, color) {
  return ["0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS"];
}

export function dxfContinuousLineType() {
  return ["0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0"];
}

export function dxfLine(x1, y1, x2, y2, layer) {
  if (![x1, y1, x2, y2].every(finiteNumber)) return [];
  return [
    "0", "LINE",
    "8", layer || "measure",
    "10", roundDxf(x1),
    "20", roundDxf(-y1),
    "30", "0",
    "11", roundDxf(x2),
    "21", roundDxf(-y2),
    "31", "0",
  ];
}

export function dxfCircle(cx, cy, radius, layer) {
  if (![cx, cy, radius].every(finiteNumber) || Math.abs(Number(radius)) < 0.0001) return [];
  return ["0", "CIRCLE", "8", layer || "measure", "10", roundDxf(cx), "20", roundDxf(-cy), "30", "0", "40", roundDxf(Math.abs(radius))];
}

export function dxfArc(arc, layer) {
  let startDeg = normalizeDegrees(radToDeg(-arc.startAngle));
  let endDeg = normalizeDegrees(radToDeg(-arc.endAngle));
  if (arc.counterClockwise) [startDeg, endDeg] = [endDeg, startDeg];
  return ["0", "ARC", "8", layer || "measure", "10", roundDxf(arc.center.x), "20", roundDxf(-arc.center.y), "30", "0", "40", roundDxf(arc.radius), "50", roundDxf(startDeg), "51", roundDxf(endDeg)];
}

export function dxfText(entity, layer) {
  if (![entity?.x, entity?.y].every(finiteNumber)) return [];
  return [
    "0", "TEXT",
    "8", layer || "dimensions",
    "10", roundDxf(entity.x || 0),
    "20", roundDxf(-(entity.y || 0)),
    "30", "0",
    "40", roundDxf(Math.abs(entity.height || 260)),
    "1", dxfString(entity.text || ""),
    "50", roundDxf(normalizeDegrees(-(entity.rotation || 0))),
    "7", "STANDARD",
  ];
}

function dimensionLineGeometry(entity) {
  const start = { x: Number(entity.x1), y: Number(entity.y1) };
  const end = { x: Number(entity.x2), y: Number(entity.y2) };
  if (!finitePoint(start) || !finitePoint(end)) return null;

  if ([entity.dimX1, entity.dimY1, entity.dimX2, entity.dimY2].every(finiteNumber)) {
    return {
      start,
      end,
      lineStart: { x: Number(entity.dimX1), y: Number(entity.dimY1) },
      lineEnd: { x: Number(entity.dimX2), y: Number(entity.dimY2) },
    };
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return null;
  const offset = finiteNumber(entity.offset) ? Number(entity.offset) : 360;
  const nx = -dy / length;
  const ny = dx / length;
  return {
    start,
    end,
    lineStart: { x: start.x + nx * offset, y: start.y + ny * offset },
    lineEnd: { x: end.x + nx * offset, y: end.y + ny * offset },
  };
}

function dxfArrow(point, ux, uy, size, layer) {
  const wing = size * 0.48;
  const nx = -uy;
  const ny = ux;
  return [
    ...dxfLine(point.x, point.y, point.x + ux * size + nx * wing, point.y + uy * size + ny * wing, layer),
    ...dxfLine(point.x, point.y, point.x + ux * size - nx * wing, point.y + uy * size - ny * wing, layer),
  ];
}

export function dxfLinearDimension(entity, layer) {
  const geometry = dimensionLineGeometry(entity);
  if (!geometry) return [];
  const { start, end, lineStart, lineEnd } = geometry;
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return [];
  const ux = dx / length;
  const uy = dy / length;
  const arrowSize = Math.max(70, Math.min(180, length * 0.035));
  const textHeight = Math.max(120, Math.min(260, length * 0.045));
  const textRotation = radToDeg(Math.atan2(dy, dx));
  const text = String(Math.round(Math.hypot(end.x - start.x, end.y - start.y)));
  return [
    ...dxfLine(start.x, start.y, lineStart.x, lineStart.y, layer),
    ...dxfLine(end.x, end.y, lineEnd.x, lineEnd.y, layer),
    ...dxfLine(lineStart.x, lineStart.y, lineEnd.x, lineEnd.y, layer),
    ...dxfArrow(lineStart, ux, uy, arrowSize, layer),
    ...dxfArrow(lineEnd, -ux, -uy, arrowSize, layer),
    ...dxfText({ x: (lineStart.x + lineEnd.x) / 2, y: (lineStart.y + lineEnd.y) / 2, text, height: textHeight, rotation: textRotation }, layer),
  ];
}

export function dxfLeader(entity, layer) {
  const start = { x: Number(entity.x1), y: Number(entity.y1) };
  const end = { x: Number(entity.x2), y: Number(entity.y2) };
  if (!finitePoint(start) || !finitePoint(end)) return [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return [];
  const ux = dx / length;
  const uy = dy / length;
  return [
    ...dxfLine(start.x, start.y, end.x, end.y, layer),
    ...dxfArrow(start, ux, uy, Math.max(70, Math.min(150, length * 0.08)), layer),
    ...dxfText({ x: end.x, y: end.y, text: entity.text || "Текст", height: entity.height || 220, rotation: 0 }, layer),
  ];
}

function dxfLayerName(layer, layerMap) {
  return layerMap.get(layer || "measure") || layerMap.get("measure") || layer || "measure";
}

// options.extraLayers — дополнительные слои [{ key, name, color }]
// (например, генплан: участок, красная линия, зона застройки).
export function buildDxf(entities, options = {}) {
  const baseLayers = options.profile === "revit" ? REVIT_LAYER_DEFS : DEFAULT_LAYER_DEFS;
  const layerDefs = [...baseLayers, ...(options.extraLayers || [])];
  const layerMap = new Map(layerDefs.map((layer) => [layer.key, layer.name]));
  const lines = [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "9", "$INSUNITS",
    "70", "4",
    "9", "$MEASUREMENT",
    "70", "1",
    "9", "$LUNITS",
    "70", "2",
    "9", "$AUNITS",
    "70", "0",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "TABLES",
    "0", "TABLE",
    "2", "LTYPE",
    "70", "1",
    ...dxfContinuousLineType(),
    "0", "ENDTAB",
    "0", "TABLE",
    "2", "LAYER",
    "70", String(layerDefs.length),
    ...layerDefs.flatMap((layer) => dxfLayer(layer.name, layer.color)),
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "ENTITIES",
  ];

  for (const entity of entities) {
    if (entity.type === "wall") {
      const offset = offsetWall(entity, entity.width / 2);
      const layer = dxfLayerName("walls", layerMap);
      lines.push(...dxfLine(offset.a.x1, offset.a.y1, offset.a.x2, offset.a.y2, layer));
      lines.push(...dxfLine(offset.b.x1, offset.b.y1, offset.b.x2, offset.b.y2, layer));
      lines.push(...dxfLine(entity.x1, entity.y1, entity.x2, entity.y2, layer));
    } else if (entity.type === "line" && entity.dimensionKind === "angular") {
      // Angular dimensions are intentionally omitted until their CAD representation is finalized.
    } else if (entity.type === "line" && entity.dimensionKind === "leader") {
      lines.push(...dxfLeader(entity, dxfLayerName("dimensions", layerMap)));
    } else if (entity.type === "line" && entity.layer === "dimensions" && (finiteNumber(entity.offset) || finiteNumber(entity.dimX1))) {
      lines.push(...dxfLinearDimension(entity, dxfLayerName("dimensions", layerMap)));
    } else if (entity.type === "line") {
      lines.push(...dxfLine(entity.x1, entity.y1, entity.x2, entity.y2, dxfLayerName(entity.layer, layerMap)));
    } else if (entity.type === "block") {
      const layer = dxfLayerName("furniture", layerMap);
      for (const segment of blockSegments(entity)) {
        lines.push(...dxfLine(segment.x1, segment.y1, segment.x2, segment.y2, layer));
      }
    } else if (entity.type === "circle") {
      lines.push(...dxfCircle(entity.cx, entity.cy, entity.radius, dxfLayerName(entity.layer, layerMap)));
    } else if (entity.type === "rectangle") {
      const corners = [
        { x: entity.x1, y: entity.y1 },
        { x: entity.x2, y: entity.y1 },
        { x: entity.x2, y: entity.y2 },
        { x: entity.x1, y: entity.y2 },
      ];
      for (let i = 0; i < 4; i += 1) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        lines.push(...dxfLine(a.x, a.y, b.x, b.y, dxfLayerName(entity.layer, layerMap)));
      }
    } else if (entity.type === "arc") {
      const arc = arcGeometry(entity.start, entity.through, entity.end);
      if (arc) lines.push(...dxfArc(arc, dxfLayerName(entity.layer, layerMap)));
    } else if (entity.type === "text") {
      lines.push(...dxfText(entity, dxfLayerName(entity.layer || "dimensions", layerMap)));
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

export function buildRevitDxf(entities) {
  return buildDxf(entities, { profile: "revit" });
}

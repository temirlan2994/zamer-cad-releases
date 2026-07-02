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

export function dxfLayer(name, color) {
  return ["0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS"];
}

export function dxfContinuousLineType() {
  return ["0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0"];
}

export function dxfLine(x1, y1, x2, y2, layer) {
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
  return ["0", "CIRCLE", "8", layer || "measure", "10", roundDxf(cx), "20", roundDxf(-cy), "30", "0", "40", roundDxf(Math.abs(radius))];
}

export function dxfArc(arc, layer) {
  let startDeg = normalizeDegrees(radToDeg(-arc.startAngle));
  let endDeg = normalizeDegrees(radToDeg(-arc.endAngle));
  if (arc.counterClockwise) [startDeg, endDeg] = [endDeg, startDeg];
  return ["0", "ARC", "8", layer || "measure", "10", roundDxf(arc.center.x), "20", roundDxf(-arc.center.y), "30", "0", "40", roundDxf(arc.radius), "50", roundDxf(startDeg), "51", roundDxf(endDeg)];
}

export function dxfText(entity, layer) {
  return [
    "0", "TEXT",
    "8", layer || "dimensions",
    "10", roundDxf(entity.x || 0),
    "20", roundDxf(-(entity.y || 0)),
    "30", "0",
    "40", roundDxf(Math.abs(entity.height || 260)),
    "1", String(entity.text || ""),
    "50", roundDxf(normalizeDegrees(-(entity.rotation || 0))),
    "7", "STANDARD",
  ];
}

function dxfLayerName(layer, layerMap) {
  return layerMap.get(layer || "measure") || layerMap.get("measure") || layer || "measure";
}

export function buildDxf(entities, options = {}) {
  const layerDefs = options.profile === "revit" ? REVIT_LAYER_DEFS : DEFAULT_LAYER_DEFS;
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

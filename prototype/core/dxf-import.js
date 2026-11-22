import { normalizeAnglePositive } from "./geometry.js";
import { DEFAULT_LINE_LAYER, MAX_CUSTOM_LINE_LAYERS, MAX_LINE_LAYER_NAME_LENGTH } from "./line-layers.js";
import { isLinePoint, MAX_LINE_COORDINATE } from "./line-edits.js";
import { validStoredEntity } from "./project-format.js";
import {
  createReusableBlockInstance, expandReusableBlock, MAX_REUSABLE_BLOCKS, normalizeBlockName,
} from "./reusable-blocks.js";

const unitMillimeters = [1, 25.4, 304.8, 1609344, 1, 10, 1000, 1e6, 0.0000254, 0.0254, 914.4,
  1e-7, 1e-6, 0.001, 100, 10000, 100000, 1e12, 1.495978707e14, 9.4607304725808e18, 3.08567758149137e19,
  1200000 / 3937, 100000 / 3937, 3600000 / 3937, 6336000000 / 3937];
const maxImportedEntities = 12000;
const maxPolylineVertices = 12000;
const basicColors = ["#a8bac9", "#ff4e4e", "#ffff00", "#00dc51", "#00ccff", "#5f85ff", "#db62dc", "#a8bac9", "#808080", "#bfbfbf"];
const encodingNames = { ANSI_1250: "windows-1250", ANSI_1251: "windows-1251", ANSI_1252: "windows-1252",
  ANSI_1253: "windows-1253", ANSI_1254: "windows-1254", ANSI_1255: "windows-1255", ANSI_1256: "windows-1256",
  ANSI_1257: "windows-1257", ANSI_1258: "windows-1258", ANSI_932: "shift_jis", ANSI_936: "gbk",
  ANSI_949: "euc-kr", ANSI_950: "big5", DOS866: "ibm866" };

function readText(bytes) {
  if (typeof bytes === "string") return bytes;
  const text = new TextDecoder().decode(bytes);
  if (!text.includes("\ufffd")) return text;
  const codepage = /^\s*9\s*\r?\n\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n([^\r\n]+)/mi.exec(text.slice(0, 65536));
  return new TextDecoder(encodingNames[codepage?.[1].trim().toUpperCase()] || "windows-1252").decode(bytes);
}

function parseRecords(text) {
  if (text.startsWith("AutoCAD Binary DXF")) throw new Error("Откройте текстовый DXF. Этот файл сохранён в двоичном формате.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.at(-1) === "") lines.pop();
  if (lines.length % 2) throw new Error("Файл DXF повреждён");
  const sections = new Map();
  let section;
  let record;
  for (let index = 0; index < lines.length; index += 2) {
    const codeText = lines[index].trim();
    if (!/^\d+$/.test(codeText)) throw new Error("Файл DXF повреждён");
    const code = Number(codeText);
    const value = lines[index + 1];
    if (code === 0) {
      const type = value.trim().toUpperCase();
      if (type === "ENDSEC" || type === "EOF") {
        section = record = undefined;
      } else {
        record = { type, fields: [] };
        if (type === "SECTION") section = undefined;
        else section?.push(record);
      }
    } else if (record?.type === "SECTION" && code === 2) {
      const name = value.trim().toUpperCase();
      if (!sections.has(name)) sections.set(name, []);
      section = sections.get(name);
      section.push(record);
    } else if (code !== 999) {
      record?.fields.push([code, value]);
    }
  }
  if (!sections.has("ENTITIES")) throw new Error("В файле DXF отсутствует раздел объектов");
  return sections;
}

function valueOf(record, code, fallback = "") {
  return record?.fields.find(([field]) => field === code)?.[1].trim() || fallback;
}

function numberOf(record, code, fallback = NaN) {
  const value = valueOf(record, code);
  return value ? Number(value) : fallback;
}

function flagOf(record, code, mask) {
  return (numberOf(record, code, 0) & mask) !== 0;
}

function dxfColor(record) {
  const rgb = numberOf(record, 420);
  if (Number.isInteger(rgb) && rgb >= 0 && rgb <= 0xffffff) return "#" + rgb.toString(16).padStart(6, "0");
  const indexed = Math.abs(numberOf(record, 62, 7));
  if (indexed < 10) return basicColors[indexed];
  if (indexed >= 250 && indexed <= 255) {
    const gray = [51, 80, 105, 130, 190, 255][indexed - 250].toString(16);
    return "#" + gray.repeat(3);
  }
  if (indexed >= 10 && indexed < 250) {
    const hue = Math.floor((indexed - 10) / 10) / 4;
    const high = [1, 0.65, 0.5, 0.3, 0.15][Math.floor(indexed % 10 / 2)];
    const low = indexed % 2 ? high / 2 : 0;
    const channel = offset => {
      const phase = (hue + offset) % 6;
      return Math.round(255 * (low + (high - low) * Math.max(0, Math.min(1, phase, 4 - phase)))).toString(16).padStart(2, "0");
    };
    return "#" + channel(5) + channel(3) + channel(1);
  }
  return basicColors[7];
}

function cleanName(value) {
  return value.replace(/[<>\p{Cc}\p{Cs}\p{Bidi_Control}\u2028\u2029]/gu, " ")
    .trim().slice(0, MAX_LINE_LAYER_NAME_LENGTH).replace(/[\uD800-\uDBFF]$/u, "").trim() || "Слой";
}

function dxfLayerState(records) {
  const layers = [];
  const visibleLayers = new Set([DEFAULT_LINE_LAYER, "dimensions", "text", "areas", "elevations"]);
  const lockedLayers = [];
  const names = new Map([["0", DEFAULT_LINE_LAYER]]);
  function getLayer(name, record = null) {
    const key = name.toUpperCase();
    if (names.has(key)) return names.get(key);
    if (layers.length >= MAX_CUSTOM_LINE_LAYERS) return DEFAULT_LINE_LAYER;
    const id = `line-layer-dxf-${layers.length + 1}`;
    layers.push({ id, name: cleanName(name), color: dxfColor(record) });
    names.set(key, id);
    if (numberOf(record, 62, 7) >= 0 && !flagOf(record, 70, 1)) visibleLayers.add(id);
    if (flagOf(record, 70, 4)) lockedLayers.push(id);
    return id;
  }
  for (const record of records) {
    if (record.type === "LAYER") getLayer(valueOf(record, 2, "0"), record);
  }
  return { layers, visibleLayers, lockedLayers, getLayer };
}

function pointOf(record, scale, code = 10) {
  return { x: numberOf(record, code) * scale, y: -numberOf(record, code + 10) * scale };
}

function samePoint(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6;
}

function importPolyline(vertices, closed) {
  if (vertices.length > maxPolylineVertices || vertices.some(({ point }) => !isLinePoint(point))) return null;
  const cleaned = [];
  for (const vertex of vertices) {
    if (cleaned.length && samePoint(cleaned.at(-1).point, vertex.point)) cleaned[cleaned.length - 1] = vertex;
    else cleaned.push(vertex);
  }
  if (closed && cleaned.length > 1 && samePoint(cleaned[0].point, cleaned.at(-1).point)) cleaned.pop();
  const bulges = cleaned.slice(0, closed ? cleaned.length : -1).map(({ bulge }) => -bulge);
  return { type: "polyline", closed, points: cleaned.map(({ point }) => point), ...(bulges.some(Boolean) && { bulges }) };
}

function lightweightVertices(record, scale) {
  const vertices = [];
  let vertex;
  for (const [code, raw] of record.fields) {
    if (code === 10) {
      vertex = { point: { x: Number(raw) * scale, y: NaN }, bulge: 0 };
      vertices.push(vertex);
    } else if (vertex && code === 20) {
      vertex.point.y = -Number(raw) * scale;
    } else if (vertex && code === 42) {
      vertex.bulge = Number(raw);
    }
  }
  return vertices;
}

function importArc(record, scale) {
  const center = pointOf(record, scale);
  const radius = numberOf(record, 40) * scale;
  const angle = numberOf(record, 50) * Math.PI / 180;
  const sweep = normalizeAnglePositive(numberOf(record, 51) * Math.PI / 180 - angle);
  if (!(radius > 0 && radius <= MAX_LINE_COORDINATE && sweep > 1e-9)) return null;
  const point = (fraction) => ({
    x: center.x + radius * Math.cos(angle + fraction * sweep),
    y: center.y - radius * Math.sin(angle + fraction * sweep),
  });
  return { type: "arc", start: point(0), through: point(0.5), end: point(1) };
}

function importText(record, scale) {
  const multiLine = record.type === "MTEXT";
  const text = record.fields.filter(([code]) => code === 1 || (multiLine && code === 3)).map(([, value]) => value).join("")
    .replace(/\\U\+([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/%%([dpc])/gi, (_, glyph) => ({ d: "°", p: "±", c: "⌀" })[glyph.toLowerCase()])
    .replace(multiLine ? /\\P/g : /\r?\n/g, "\n").replace(multiLine ? /\\[ACFHQTW][^;]*;|[{}]/gi : /$^/, "")
    .trim().slice(0, 4096);
  const aligned = !multiLine && (numberOf(record, 72, 0) || numberOf(record, 73, 0));
  const point = pointOf(record, scale, aligned ? 11 : 10);
  const height = numberOf(record, 40) * scale;
  const rotation = -numberOf(record, 50, 0);
  return text && height > 0 && height <= MAX_LINE_COORDINATE ? { type: "text", ...point, text, height, rotation } : null;
}

function lineBetween(start, end) {
  return { type: "line", x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

function importDimension(record, scale) {
  const kind = numberOf(record, 70, 0) & 31;
  const base = pointOf(record, scale);
  const label = pointOf(record, scale, 11);
  const first = pointOf(record, scale, 13);
  const second = pointOf(record, scale, 14);
  const last = pointOf(record, scale, 15);
  const separation = Math.hypot(second.x - first.x, second.y - first.y);
  if (kind === 0 || kind === 1) {
    if (separation <= 1e-6) return null;
    const angle = kind === 1 ? Math.atan2(second.y - first.y, second.x - first.x) : -numberOf(record, 50, 0) * Math.PI / 180;
    const vx = Math.cos(angle);
    const vy = Math.sin(angle);
    const projection = (second.x - first.x) * vx + (second.y - first.y) * vy;
    if (Math.abs(projection) <= 1e-6) return null;
    return { ...lineBetween(first, second), offset: (base.y - first.y) * vx - (base.x - first.x) * vy,
      dimX1: base.x - projection * vx, dimY1: base.y - projection * vy, dimX2: base.x, dimY2: base.y };
  }
  if (kind === 5) return { type: "line", dimensionKind: "angular", vertex: last, arm1: first, arm2: second,
    arcRadius: Math.hypot(last.x - base.x, last.y - base.y) };
  if (kind === 3 || kind === 4) {
    const center = kind === 3 ? { x: (base.x + last.x) / 2, y: (base.y + last.y) / 2 } : base;
    return { ...lineBetween(center, isLinePoint(label) ? label : last), dimensionKind: kind === 3 ? "diameter" : "radius",
      circleRadius: Math.hypot(center.x - last.x, center.y - last.y), radialRim: last };
  }
  return null;
}

function importEntity(record, scale, vertices) {
  if (numberOf(record, 210, 0) || numberOf(record, 220, 0) || numberOf(record, 230, 1) !== 1) return null;
  const { x, y } = pointOf(record, scale);
  switch (record.type) {
    case "LINE": {
      return lineBetween({ x, y }, pointOf(record, scale, 11));
    }
    case "LWPOLYLINE": return importPolyline(lightweightVertices(record, scale), flagOf(record, 70, 1));
    case "POLYLINE": return flagOf(record, 70, 8 | 16 | 64) ? null : importPolyline(vertices, flagOf(record, 70, 1));
    case "CIRCLE": {
      const radius = numberOf(record, 40) * scale;
      if (!(radius > 0 && radius <= MAX_LINE_COORDINATE && isLinePoint({ x: x + radius, y: y + radius }) &&
          isLinePoint({ x: x - radius, y: y - radius }))) return null;
      return { type: "circle", cx: x, cy: y, radius };
    }
    case "ARC": return importArc(record, scale);
    case "TEXT":
    case "MTEXT": return importText(record, scale);
    case "DIMENSION": return importDimension(record, scale);
    default: return null;
  }
}

function* drawingRecords(records, scale) {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (["SECTION", "VERTEX", "SEQEND"].includes(record.type)) continue;
    const vertices = [];
    if (record.type === "POLYLINE") {
      while (records[index + 1]?.type === "VERTEX") {
        const vertex = records[++index];
        if (vertices.length <= maxPolylineVertices) vertices.push({ point: pointOf(vertex, scale), bulge: numberOf(vertex, 42, 0) });
      }
    }
    yield { record, vertices };
  }
}

function blockRecords(records, scale, getLayer) {
  const blocks = new Map();
  let current;
  for (const { record, vertices } of drawingRecords(records, scale)) {
    if (record.type === "BLOCK") {
      const blockName = valueOf(record, 2) || valueOf(record, 3);
      const base = pointOf(record, scale);
      if (!blockName || blockName.startsWith("*") || !isLinePoint(base)) {
        current = null;
        continue;
      }
      current = { name: normalizeBlockName(blockName), base, parts: [], unsupported: 0 };
      blocks.set(blockName.toUpperCase(), current);
    } else if (record.type === "ENDBLK") {
      current = null;
    } else if (current) {
      const entity = importEntity(record, scale, vertices);
      if (!entity || !["line", "polyline", "circle", "arc"].includes(entity.type) || record.type === "DIMENSION") {
        current.unsupported += 1;
        continue;
      }
      const layerName = valueOf(record, 8, "0");
      current.parts.push({ ...entity, ...(layerName !== "0" && { layer: getLayer(layerName) }) });
    }
  }
  return blocks;
}

function importBlock(record, blocks, scale, id, layer) {
  const blockName = valueOf(record, 2).toUpperCase();
  const source = blocks.get(blockName);
  const xScale = numberOf(record, 41, 1);
  const yScale = numberOf(record, 42, 1);
  if (!source || xScale === 0 || Math.abs(xScale) !== Math.abs(yScale) ||
      numberOf(record, 70, 1) !== 1 || numberOf(record, 71, 1) !== 1) return null;
  const rotation = -numberOf(record, 50, 0) + (yScale < 0 ? 180 : 0);
  const origin = pointOf(record, scale);
  const definitionId = source.id ||= `dxf-block-${blocks.size}-${id}`;
  source.localParts ??= expandReusableBlock({
    type: "block", kind: "reusable", x: -source.base.x, y: -source.base.y, parts: source.parts,
  });
  if (!source.localParts) return null;
  const parts = source.localParts.map(part => ({ ...part, layer: part.layer || layer }));
  const local = createReusableBlockInstance({ id: definitionId, name: source.name, parts }, id, origin, layer);
  if (!local) return null;
  const reflect = Math.sign(xScale) !== Math.sign(yScale);
  const entity = { ...local, rotation, flipX: reflect, scale: Math.abs(xScale) };
  if (!expandReusableBlock(entity)) return null;
  return { entity, source };
}

export function importDxf(bytes, name = "Импорт") {
  const sections = parseRecords(readText(bytes));
  const header = sections.get("HEADER")?.[0].fields || [];
  const unitIndex = header.findIndex(([code, value]) => code === 9 && value.trim().toUpperCase() === "$INSUNITS");
  const unit = unitIndex >= 0 && header[unitIndex + 1]?.[0] === 70 ? Number(header[unitIndex + 1][1]) : 0;
  const scale = unitMillimeters[unit] || 1;
  const { layers, visibleLayers, lockedLayers, getLayer } = dxfLayerState(sections.get("TABLES") || []);
  const blocks = blockRecords(sections.get("BLOCKS") || [], scale, getLayer);
  const entities = [];
  const reusableBlocks = [];
  const usedBlockNames = new Set();
  let skipped = 0;
  let index = 0;
  for (const { record, vertices } of drawingRecords(sections.get("ENTITIES"), scale)) {
    if (numberOf(record, 67, 0) === 1 || valueOf(record, 410, "Model").toUpperCase() !== "MODEL") continue;
    const id = `dxf-${index++}`;
    const layerName = valueOf(record, 8, "0");
    if (record.type === "INSERT" && entities.length < maxImportedEntities) {
      const layer = getLayer(layerName);
      const insert = importBlock(record, blocks, scale, id, layer);
      if (insert && validStoredEntity(insert.entity)) {
        entities.push(insert.entity);
        skipped += insert.source.unsupported;
        const key = insert.source.name.toUpperCase();
        if (reusableBlocks.length < MAX_REUSABLE_BLOCKS && !usedBlockNames.has(key)) {
          reusableBlocks.push({ id: insert.source.id, name: insert.source.name, parts: insert.entity.parts });
          usedBlockNames.add(key);
        }
        continue;
      }
    }
    const converted = importEntity(record, scale, vertices);
    if (!converted || entities.length >= maxImportedEntities) {
      skipped += 1;
      continue;
    }
    const layer = record.type === "DIMENSION" ? "dimensions" :
      converted.type === "text" && layerName === "0" ? "text" : getLayer(layerName);
    const entity = { ...converted, id, layer };
    if (validStoredEntity(entity)) entities.push(entity);
    else skipped += 1;
  }
  if (!entities.length) throw new Error("В файле нет поддерживаемых объектов модели");
  return {
    project: { version: 2, name, theme: "dark", entities, customLineLayers: layers, reusableBlocks,
      visibleLayers: [...visibleLayers], lockedLayers, annotationLayers: 1 },
    skipped,
  };
}

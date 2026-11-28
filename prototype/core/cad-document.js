import {
  DwgReader, DwgReaderConfiguration, DwgWriterConfiguration, DxfReader, DxfWriter, DxfWriterConfiguration,
  Dimension, Leader, Insert, MText, TextEntity, LwPolyline, Polyline2D, XYZ, Transform, Layer, Color,
} from "./vendor/acad-ts-3.9.0/index.js";
import { writeDwgDocument } from "./dwg-compat.js";
import { buildDxf } from "./dxf.js";
import { scaleStoredEntity } from "./entity-transform.js";
import { cadEntityState, cadDrawingState } from "./cad-source.js";
import { encodeMText } from "./cad-text.js";
import { validStoredEntity } from "./project-format.js";

const unsafe = cause => new Error("Не удалось сохранить все исходные данные DWG. Исходник доступен без изменений. Можно выгрузить отдельную копию объектов Замера.", { cause });

function noticeGuard(_, event) {
  if (event.notificationType !== 0) throw unsafe(event.message);
}

function strictRead(bytes) {
  const configuration = new DwgReaderConfiguration();
  configuration.failsafe = false;
  configuration.keepUnknownEntities = true;
  configuration.keepUnknownNonGraphicalObjects = true;
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const document = DwgReader.readFromStreamWithConfig(input, configuration, noticeGuard);
  for (const object of document.getCadObjects()) {
    if (/UNKNOWN|PROXY/i.test(object.objectName || object.constructor.name)) throw unsafe();
  }
  return document;
}

function recordSnapshot(document) {
  const chunks = [];
  const configuration = new DxfWriterConfiguration();
  configuration.writeDynamicBlockData = true;
  DxfWriter.writeToStream({ write: text => chunks.push(text) }, document, false, configuration, noticeGuard);
  const lines = chunks.join("").split(/\r?\n/);
  const records = new Map();
  let record = [];
  function commit() {
    if (["SECTION", "ENDSEC", "EOF"].includes(record[0]?.[1])) return;
    const handle = record.find(([code]) => code === 5 || code === 105)?.[1];
    if (handle && handle !== "0") records.set(handle.toUpperCase(), record);
  }
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]);
    const value = lines[index + 1].trim();
    if (code === 0) { commit(); record = []; }
    record.push([code, value]);
  }
  commit();
  return records;
}

function requireRetainedRecords(before, after, changed) {
  for (const [handle, record] of before) {
    if (changed.has(handle)) continue;
    const actual = after.get(handle);
    if (!actual) throw unsafe();
    const type = record[0]?.[1];
    // Collection membership may grow, but existing entries must remain.
    if (type === "TABLE") {
      if (record.find(([code]) => code === 2)?.[1] !== actual.find(([code]) => code === 2)?.[1]) throw unsafe();
    } else if (type === "DICTIONARY") {
      const entries = fields => new Map(fields.flatMap(([code, value], index) => code === 3 ? [[value, fields[index + 1]?.[1]]] : []));
      const current = entries(actual);
      for (const [name, value] of entries(record)) if (current.get(name) !== value) throw unsafe();
    } else if (JSON.stringify(record) !== JSON.stringify(actual)) throw unsafe({ handle, record, actual });
  }
}

function template(entity, drawing, unitScale) {
  const scaled = scaleStoredEntity(entity, { x: 0, y: 0 }, 1 / unitScale);
  if (!scaled) throw unsafe();
  const bytes = new TextEncoder().encode(buildDxf([scaled], {
    ...drawing, nativeAnnotations: true,
  }));
  const document = DxfReader.readFromStream(bytes);
  const entities = [...document.entities];
  const main = entities.find(object => object instanceof Leader) || entities[0];
  if (!main) throw unsafe();
  return { main, entities };
}

function patchText(target, before, entity, scale) {
  if (target instanceof TextEntity && (entity.text.includes("\n") || entity.textWidth !== before.textWidth)) throw unsafe();
  const old = new XYZ(before.x / scale, -before.y / scale, 0);
  const next = new XYZ(entity.x / scale, -entity.y / scale, 0);
  const radians = -((entity.rotation || 0) - (before.rotation || 0)) * Math.PI / 180;
  const ratio = (entity.height || 260) / (before.height || 260);
  const widthRatio = entity.textWidth && before.textWidth ? entity.textWidth / before.textWidth : ratio;
  const transform = point => {
    const x = (point.x - old.x) * widthRatio;
    const y = (point.y - old.y) * ratio;
    return new XYZ(next.x + Math.cos(radians) * x - Math.sin(radians) * y,
      next.y + Math.sin(radians) * x + Math.cos(radians) * y, point.z);
  };
  target.insertPoint = transform(target.insertPoint);
  if (target instanceof TextEntity) target.alignmentPoint = transform(target.alignmentPoint);
  target.rotation += radians;
  target.height = (entity.height || 260) / scale;
  if (entity.text !== before.text) target.value = target instanceof MText ? encodeMText(entity.text) : entity.text;
  if (target instanceof MText) {
    if (entity.textWidth !== before.textWidth) target.rectangleWidth = (entity.textWidth || 0) / scale;
    if (Boolean(entity.textFrame) !== Boolean(before.textFrame)) target.backgroundFillFlags =
      entity.textFrame ? target.backgroundFillFlags | 16 : target.backgroundFillFlags & ~16;
  }
}

function patchObject(target, before, entity, drawing, scale, changed) {
  if (before.type !== entity.type || before.layer !== entity.layer ||
      entity.lineType !== before.lineType) throw unsafe();
  if (entity.color !== before.color) target.color = entity.color ? Color.fromTrueColor(parseInt(entity.color.slice(1), 16)) : Color.byLayer;
  if (entity.lineWeight !== before.lineWeight) target.lineWeight = entity.lineWeight == null ? -1 : Math.round(entity.lineWeight * 100);
  if (cadEntityState({ ...entity, color: undefined, lineWeight: undefined }) ===
      cadEntityState({ ...before, color: undefined, lineWeight: undefined })) return;
  if (target instanceof TextEntity || target instanceof MText) {
    patchText(target, before, entity, scale);
    return;
  }
  if (target instanceof Insert) {
    if (JSON.stringify(before.parts) !== JSON.stringify(entity.parts)) throw unsafe();
    const ratio = (entity.scale || 1) / (before.scale || 1);
    const origin = new XYZ(target.insertPoint.x, target.insertPoint.y, target.insertPoint.z);
    const reflected = Boolean(before.flipX) !== Boolean(entity.flipX);
    const angle = target.rotation - ((entity.rotation || 0) - (before.rotation || 0)) * Math.PI / 180;
    const next = new XYZ(entity.x / scale, -entity.y / scale, origin.z);
    const attributeAngle = reflected ? angle + target.rotation : angle - target.rotation;
    const transform = new Transform(undefined, new XYZ(reflected ? -ratio : ratio, ratio, ratio), new XYZ(0, 0, attributeAngle));
    const mapped = transform.applyTransform(origin);
    transform.translation = new XYZ(next.x - mapped.x, next.y - mapped.y, next.z - mapped.z);
    for (const attribute of target.attributes) attribute.applyTransform(transform);
    // Insert.applyTransform in this library takes absolute axis scales and
    // drops reflections. Set the native scale signs explicitly instead.
    target.insertPoint = next;
    target.xScale *= reflected ? -ratio : ratio;
    target.yScale *= ratio;
    target.zScale *= ratio;
    target.rotation = angle;
    for (const attribute of target.attributes) changed.add(attribute.handle.toString(16).toUpperCase());
    return;
  }
  const candidate = template(entity, drawing, scale).main;
  if (target instanceof Leader) {
    if (!(candidate instanceof Leader)) throw unsafe();
    target.vertices = candidate.vertices;
    target.textHeight = candidate.textHeight;
    target.textWidth = candidate.textWidth;
    const keys = ["x2", "y2", "text", "textHeight", "leaderFrame"];
    if (keys.some(key => entity[key] !== before[key])) {
      const label = target.associatedAnnotation;
      if (!(label instanceof MText) || !(candidate.associatedAnnotation instanceof MText)) throw unsafe();
      const generated = candidate.associatedAnnotation;
      changed.add(label.handle.toString(16).toUpperCase());
      for (const key of ["insertPoint", "height", "rectangleWidth", "attachmentPoint", "backgroundFillFlags"]) label[key] = generated[key];
      if (entity.text !== before.text) label.value = generated.value;
    }
    return;
  }
  if (target instanceof Polyline2D && candidate instanceof LwPolyline) {
    const vertices = [...target.vertices];
    if (vertices.length !== candidate.vertices.length) throw unsafe();
    vertices.forEach((vertex, index) => {
      const next = candidate.vertices[index];
      vertex.location = new XYZ(next.location.x, next.location.y, vertex.location.z);
      vertex.bulge = next.bulge;
      changed.add(vertex.handle.toString(16).toUpperCase());
    });
    target.isClosed = candidate.isClosed;
    return;
  }
  if (target.constructor !== candidate.constructor) throw unsafe();
  if (target instanceof LwPolyline) {
    target.vertices = candidate.vertices.map((vertex, index) => {
      const original = target.vertices[index];
      if (original) for (const key of ["id", "startWidth", "endWidth", "flags"]) vertex[key] = original[key];
      return vertex;
    });
    target.isClosed = candidate.isClosed;
  } else {
    for (const key of ["startPoint", "endPoint", "center", "radius", "startAngle", "endAngle", "firstPoint", "secondPoint",
      "definitionPoint", "textMiddlePoint", "angleVertex", "chordPoint", "leaderLength", "rotation"]) {
      if (key in candidate) target[key] = candidate[key];
    }
  }
  if (target instanceof Dimension) {
    // Keep the original style and leave its old anonymous block intact. A new
    // cache belongs only to the changed dimension, including shared-block cases.
    target.block = null;
    if (!target.document.layers.contains("defpoints")) target.document.layers.add(new Layer("defpoints"));
    target.updateBlock();
  }
}

function addObject(document, object) {
  const copy = object.clone();
  if (copy.block) {
    let index = 1;
    while (document.blockRecords.contains(`ZAMER_Block_${index}`)) index += 1;
    copy.block.name = `ZAMER_Block_${index}`;
  }
  if (copy instanceof Leader) {
    copy.associatedAnnotation = object.associatedAnnotation?.clone() || null;
    if (copy.associatedAnnotation) document.entities.add(copy.associatedAnnotation);
  }
  document.entities.add(copy);
}

function save(bytes, { source, drawing }) {
  if (!source || source.version !== 1 || !Array.isArray(source.bindings) ||
      !Array.isArray(drawing?.entities) || !drawing.entities.every(validStoredEntity)) throw unsafe();
  if (cadDrawingState(drawing) === cadDrawingState(source.baseline)) return bytes.slice();
  for (const key of ["customLineLayers", "layerStyles", "lockedLayers"]) {
    if (JSON.stringify(drawing[key] || (key === "layerStyles" ? {} : [])) !==
        JSON.stringify(source.baseline[key] || (key === "layerStyles" ? {} : []))) throw unsafe();
  }
  const document = strictRead(bytes);
  const before = recordSnapshot(document);
  const model = new Map([...document.entities].map(object => [object.handle.toString(16).toUpperCase(), object]));
  const live = new Map(drawing.entities.map(entity => [entity.id, entity]));
  const baseline = new Map(source.baseline.entities.map(entity => [entity.id, entity]));
  const changed = new Set();
  const removedLabels = new Set();
  for (const binding of source.bindings) {
    const entity = live.get(binding.id);
    const original = baseline.get(binding.id);
    if (entity && cadEntityState(entity) === cadEntityState(original)) continue;
    const target = model.get(binding.handle);
    if (!target || target.objectName !== binding.type) throw unsafe();
    changed.add(binding.handle);
    if (!entity) {
      for (const child of [...(target.attributes || []), ...(target instanceof Polyline2D ? target.vertices : [])]) {
        changed.add(child.handle.toString(16).toUpperCase());
      }
      for (const collection of [target.attributes, target instanceof Polyline2D ? target.vertices : null]) {
        if (collection?.seqend) changed.add(collection.seqend.handle.toString(16).toUpperCase());
      }
      if (target instanceof Leader && target.associatedAnnotation) removedLabels.add(target.associatedAnnotation);
      document.entities.remove(target);
    } else patchObject(target, original, entity, drawing, source.unitScale, changed);
  }
  for (const label of removedLabels) {
    if (![...document.entities].some(object => object instanceof Leader && object.associatedAnnotation === label)) {
      changed.add(label.handle.toString(16).toUpperCase());
      document.entities.remove(label);
    }
  }
  for (const entity of drawing.entities) {
    if (baseline.has(entity.id)) continue;
    const generated = template(entity, drawing, source.unitScale);
    if (generated.entities.length > 1 && !(generated.main instanceof Leader)) throw unsafe();
    const layerName = source.layerNames?.find(([id]) => id === entity.layer)?.[1] ||
      source.bindings.find(binding => baseline.get(binding.id).layer === entity.layer)?.layer;
    const layer = layerName && document.layers.tryGetValue(layerName);
    if (layer) {
      generated.main.layer = layer;
      if (generated.main instanceof Leader && generated.main.associatedAnnotation) generated.main.associatedAnnotation.layer = layer;
    }
    addObject(document, generated.main);
  }
  const configuration = new DwgWriterConfiguration();
  configuration.writeDynamicBlockData = true;
  const output = writeDwgDocument(document, configuration, noticeGuard);
  requireRetainedRecords(before, recordSnapshot(strictRead(output)), changed);
  return output;
}

export function saveCadDocument(bytes, options) {
  try { return save(bytes, options); }
  catch (error) { throw unsafe(error); }
}

import { DwgObjectWriter, DwgReferenceType, DwgWriter } from "./vendor/acad-ts-3.9.0/index.js";

// acad-ts 3.9.0 writes a null annotation handle for LEADER even when its
// associatedAnnotation is resolved. Repair only that pointer during a write;
// keep the vendored bundle unchanged and restore its methods afterwards.
export function writeDwgDocument(document) {
  const prototype = DwgObjectWriter.prototype;
  const writeLeader = prototype._writeLeader;
  prototype._writeLeader = function(entity) {
    const stream = this._writer;
    const reference = stream.handleReferenceTyped;
    let annotationWritten = false;
    stream.handleReferenceTyped = function(type, value) {
      if (!annotationWritten && type === DwgReferenceType.HardPointer && value == null) {
        annotationWritten = true;
        value = entity.associatedAnnotation;
      }
      return reference.call(this, type, value);
    };
    try { return writeLeader.call(this, entity); }
    finally { stream.handleReferenceTyped = reference; }
  };
  try { return DwgWriter.writeToBuffer(document); }
  finally { prototype._writeLeader = writeLeader; }
}

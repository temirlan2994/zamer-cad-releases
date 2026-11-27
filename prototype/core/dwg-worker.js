// Unmodified npm @node-projects/acad-ts@3.9.0 ESM bundle (MIT).
// Source: https://github.com/node-projects/acad-ts
// SHA-256: a4356a398d3b8a90cbfc84aa6a513266507dd6896e567ba7652a6e8a3de74c54
import { ACadVersion, DwgReader, DxfReader, DxfWriter } from "./vendor/acad-ts-3.9.0/index.js";
import { writeDwgDocument } from "./dwg-compat.js";

function repairCurrentTableEntries(document) {
  const { header, layers, lineTypes, textStyles, dimensionStyles } = document;
  for (const [field, table, fallback] of [
    ["currentLayerName", layers, "0"],
    ["currentLineTypeName", lineTypes, "ByLayer"],
    ["currentTextStyleName", textStyles, "Standard"],
    ["currentDimensionStyleName", dimensionStyles, "Standard"],
  ]) {
    if (table.contains(header[field])) continue;
    const existing = table.tryGetValue(fallback) || table[Symbol.iterator]().next().value;
    if (existing) header[field] = existing.name;
  }
}

export function convertDwg(operation, bytes) {
  if (operation === "dxf-to-dwg") {
    const document = DxfReader.readFromStream(bytes);
    document.header.version = ACadVersion.AC1032;
    repairCurrentTableEntries(document);
    return writeDwgDocument(document);
  }

  if (operation !== "dwg-to-dxf") throw new Error("Неизвестная операция DWG");
  if (!/^AC10\d{2}$/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) {
    throw new Error("Файл DWG повреждён или имеет неизвестный формат");
  }
  const { buffer, byteOffset, byteLength } = bytes;
  const input = byteOffset === 0 && byteLength === buffer.byteLength ? buffer : buffer.slice(byteOffset, byteOffset + byteLength);
  const document = DwgReader.readFromStream(input);
  document.header.version = ACadVersion.AC1032;
  repairCurrentTableEntries(document);
  const parts = [];
  DxfWriter.writeToStream({ write: (part) => parts.push(part) }, document);
  return new TextEncoder().encode(parts.join(""));
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = ({ data: { operation, bytes } }) => {
    try {
      const result = convertDwg(operation, bytes);
      globalThis.postMessage({ bytes: result }, [result.buffer]);
    } catch (error) {
      globalThis.postMessage({ error: error?.message || "Не удалось преобразовать файл чертежа" });
    }
  };
}

import { cadSourceBytes, validateCadSource } from "./cad-source.js";
import { validStoredEntity } from "./project-format.js";

function inputBytes(input) {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Uint8Array) return input;
  throw new TypeError("Не удалось прочитать данные чертежа");
}

async function convert(operation, input, options) {
  const bytes = inputBytes(input);
  if (!bytes.length) throw new Error("Файл чертежа пуст");
  if (typeof Worker === "undefined") {
    const { convertDwg } = await import("./dwg-worker.js");
    return convertDwg(operation, bytes, options);
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./dwg-worker.js", import.meta.url), { type: "module" });
    const data = Uint8Array.from(bytes);
    const timeout = setTimeout(() => fail("Обработка DWG заняла слишком много времени"), 60_000);
    function stop() {
      clearTimeout(timeout);
      worker.terminate();
    }
    function fail(message) {
      stop();
      reject(new Error(message));
    }
    worker.onmessage = ({ data: result }) => {
      if (result.error) return fail(result.error);
      stop();
      resolve(result.bytes);
    };
    worker.onerror = () => fail("Не удалось запустить обработку DWG");
    worker.onmessageerror = () => fail("Не удалось прочитать результат обработки DWG");
    worker.postMessage({ operation, bytes: data, options }, [data.buffer]);
  });
}

export function dxfToDwg(input) {
  return convert("dxf-to-dwg", input);
}

export function dwgToDxf(input) {
  return convert("dwg-to-dxf", input);
}

export async function saveSourceDwg(source, drawing) {
  validateCadSource(source, validStoredEntity);
  const fields = ["entities", "customLineLayers", "layerStyles", "lockedLayers", "annotationScale", "measurementSettings"];
  const current = Object.fromEntries(fields.filter(key => drawing[key] !== undefined).map(key => [key, drawing[key]]));
  return convert("save-source-dwg", cadSourceBytes(source), { source: { ...source, data: undefined }, drawing: current });
}

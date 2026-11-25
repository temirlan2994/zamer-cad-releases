import { MAX_ZAMER_FILE_BYTES } from "./project-format.js";

export async function readNativeImportFile(message, { origin = globalThis.location?.origin, fetchFile = globalThis.fetch } = {}) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(message?.id || "") ||
      typeof message?.name !== "string" || /[/\\\p{Cc}]/u.test(message.name) || !/\.(dwg|dxf|zamer|json)$/i.test(message.name) ||
      message.url !== `${origin}/assets/_imports/${message.id}`) {
    throw new Error("Не удалось получить файл от Android");
  }
  const response = await fetchFile(message.url, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось прочитать файл. Откройте его ещё раз из файлового менеджера.");
  const size = response.headers.get("Content-Length");
  if (size !== null && Number(size) > MAX_ZAMER_FILE_BYTES) throw new Error("Выберите чертёж размером до 32 МБ");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_ZAMER_FILE_BYTES) throw new Error("Выберите непустой чертёж размером до 32 МБ");
  return new File([bytes], message.name, { type: "application/octet-stream" });
}

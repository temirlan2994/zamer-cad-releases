import test from "node:test";
import assert from "node:assert/strict";
import { readNativeImportFile } from "./native-file-import.js";
import { MAX_ZAMER_FILE_BYTES } from "./project-format.js";

const origin = "https://appassets.androidplatform.net";
const id = "dec2b5b7-d7a7-4d32-943c-89f5c7a11a95";
const message = { id, name: "Замер.DWG", url: `${origin}/assets/_imports/${id}` };

test("an Android file retains its binary bytes and display name", async () => {
  const data = new Uint8Array([65, 67, 49, 48, 51, 50, 0, 255]);
  const file = await readNativeImportFile(message, { origin, fetchFile: async (url, options) => {
    assert.equal(url, message.url);
    assert.equal(options.cache, "no-store");
    return new Response(data);
  } });
  assert.equal(file.name, message.name);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), data);
});

test("native import rejects foreign URLs and unsupported names before fetching", async () => {
  const fetchFile = () => assert.fail("Invalid metadata must not fetch a URL");
  for (const changed of [
    { url: "https://example.org/private.dwg" }, { url: `${message.url}?other=1` },
    { id: "../../private" }, { name: "document.html" }, { name: "../secret.dwg" }, { name: "bad\nname.dxf" },
  ]) await assert.rejects(readNativeImportFile({ ...message, ...changed }, { origin, fetchFile }), /Android/);
});

test("a revoked grant, empty file and oversized stream cannot create an imported File", async () => {
  await assert.rejects(readNativeImportFile(message, { origin, fetchFile: async () => new Response("", { status: 400 }) }), /прочитать/);
  await assert.rejects(readNativeImportFile(message, { origin, fetchFile: async () => new Response(new Uint8Array()) }), /непустой/);
  await assert.rejects(readNativeImportFile(message, { origin, fetchFile: async () => new Response("x", { headers: { "Content-Length": String(MAX_ZAMER_FILE_BYTES + 1) } }) }), /32 МБ/);
  await assert.rejects(readNativeImportFile(message, { origin, fetchFile: async () => new Response(new ArrayBuffer(MAX_ZAMER_FILE_BYTES + 1)) }), /32 МБ/);
});

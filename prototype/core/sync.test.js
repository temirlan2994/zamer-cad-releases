import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseProjectSource, projectRevision } from "./sync.js";

test("projectRevision normalizes missing and invalid revisions", () => {
  assert.equal(projectRevision(null), 0);
  assert.equal(projectRevision({ revision: "4" }), 4);
  assert.equal(projectRevision({ revision: -2 }), 0);
});

test("server wins when it has a newer confirmed revision", () => {
  const local = { revision: 2, savedAt: "2026-07-20T12:00:00Z" };
  const server = { revision: 3, savedAt: "2026-07-20T11:00:00Z" };
  assert.deepEqual(chooseProjectSource(local, server), { project: server, source: "server", shouldPush: false });
});

test("pending local work is never replaced by a newer server copy", () => {
  const local = { revision: 2, syncPending: true, entities: [{ id: "local" }] };
  const server = { revision: 3, entities: [{ id: "server" }] };
  assert.deepEqual(chooseProjectSource(local, server), { project: local, source: "local-pending", shouldPush: true });
});

test("legacy local copy wins by timestamp and is scheduled for upload", () => {
  const local = { savedAt: "2026-07-20T12:00:00Z" };
  const server = { savedAt: "2026-07-20T11:00:00Z" };
  assert.deepEqual(chooseProjectSource(local, server), { project: local, source: "local", shouldPush: true });
});

test("local copy can open while the server is unavailable", () => {
  const local = { revision: 2, syncPending: true };
  assert.deepEqual(chooseProjectSource(local, null), { project: local, source: "local", shouldPush: true });
});

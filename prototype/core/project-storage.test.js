import test from "node:test";
import assert from "node:assert/strict";
import { projectStorageInfo } from "./project-storage.js";

const project = { id: "plan-1", revision: 3, updatedAt: "2026-11-26T12:00:00Z" };
const owner = "google-123";
const state = { owner, id: project.id, fileId: "drive-file-1", stamp: "3:2026-11-26T12:00:00Z", pending: null };

test("a Google account alone never claims a cloud copy", () => {
  assert.equal(projectStorageInfo(project, { owner: "offline" }).kind, "phone");
  assert.equal(projectStorageInfo(project, { owner }).kind, "phone");
  assert.equal(projectStorageInfo(project, { owner, state: { ...state, fileId: undefined } }).kind, "phone");
  assert.equal(projectStorageInfo(project, { owner, state: { ...state, pending: { id: "reserved-file" } } }).kind, "phone");
});

test("only the confirmed current version is shown as saved in Google Drive", () => {
  assert.equal(projectStorageInfo(project, { owner, state }).kind, "drive");
  assert.equal(projectStorageInfo({ ...project, revision: 4 }, { owner, state }).kind, "phone");
  assert.equal(projectStorageInfo({ ...project, updatedAt: "2026-11-26T13:00:00Z" }, { owner, state }).kind, "phone");
  assert.equal(projectStorageInfo({ id: project.id }, { owner, state }).kind, "phone");
  assert.equal(projectStorageInfo(project, { owner, state: { ...state, stamp: "deleted" } }).kind, "phone");
});

test("confirmation belongs to the same project and account", () => {
  assert.equal(projectStorageInfo(project, { owner: "google-456", state }).kind, "phone");
  assert.equal(projectStorageInfo(project, { owner, state: { ...state, id: "other-plan" } }).kind, "phone");
  assert.equal(projectStorageInfo(project, { owner: "offline", state }).kind, "phone");
});

test("local trash is distinct from a restored and confirmed cloud version", () => {
  const archived = projectStorageInfo(project, { owner, state, archived: true });
  assert.equal(archived.kind, "phone");
  assert.match(archived.description, /корзине/);
  // The synchronizer retains `remove` after restoration and uses the stamp
  // to distinguish the current live version from its earlier tombstone.
  assert.equal(projectStorageInfo(project, { owner, state: { ...state, remove: true } }).kind, "drive");
  assert.match(projectStorageInfo(project, { owner, state }).description, /также есть на телефоне/);
});

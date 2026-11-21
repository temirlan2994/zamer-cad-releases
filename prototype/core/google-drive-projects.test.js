import test from "node:test";
import assert from "node:assert/strict";
import { driveProjectStamp, googleDriveProjects, syncDriveProjects } from "./google-drive-projects.js";

function fakeDrive() {
  const records = new Map();
  let sequence = 0;
  return {
    records,
    async list() { return [...records.values()]; },
    async reserve() { return `file-${++sequence}`; },
    async write(record) {
      const saved = { ...record, createdTime: new Date(sequence).toISOString() };
      records.set(record.id, saved);
      return saved;
    },
    async read(record) { return records.get(record.id).project; },
    async discard(id) { records.delete(id); },
  };
}

function device() {
  const entries = Object.create(null);
  const projects = new Map();
  return {
    projects,
    active: () => true,
    canReceive: () => true,
    async list() { return [...projects.values()]; },
    async load(id) {
      const data = projects.get(id);
      return data ? { meta: data, data } : null;
    },
    states: () => entries,
    async writeState(id, change) { entries[id] = { ...entries[id], ...change }; },
    async receive({ id, record, conflict }, data) {
      const copy = data ? { ...data, id, name: data.name + (conflict ? " · копия" : "") } : null;
      if (copy) projects.set(id, copy);
      else projects.delete(id);
      await this.writeState(id, { fileId: record.id, groupId: record.projectId, stamp: copy ? driveProjectStamp(copy) : "deleted" });
    },
  };
}

function drawing(name, revision) {
  return { id: "plan", name, revision, updatedAt: `2026-01-0${revision}` };
}

test("a saved drawing appears on a second device and deletion stays in this account", async () => {
  const a = device(), b = device(), other = device();
  const drive = fakeDrive();
  const project = drawing("Кухня", 1);
  a.projects.set("plan", project);
  await syncDriveProjects(a, drive);
  await syncDriveProjects(b, drive);
  await syncDriveProjects(other, fakeDrive());
  assert.deepEqual(b.projects.get("plan"), project);
  assert.equal(other.projects.size, 0);
  a.projects.delete("plan");
  await a.writeState("plan", { remove: true });
  await syncDriveProjects(a, drive);
  await syncDriveProjects(b, drive);
  assert.equal(b.projects.size, 0);
  assert.deepEqual([...drive.records.values()].map(({ deleted }) => deleted), [true]);
});

test("changes made independently on two devices survive as separate copies", async () => {
  const a = device(), b = device(), fresh = device();
  const drive = fakeDrive();
  a.projects.set("plan", drawing("Исходный", 1));
  await syncDriveProjects(a, drive);
  await syncDriveProjects(b, drive);
  a.projects.set("plan", drawing("Первый", 2));
  b.projects.set("plan", drawing("Второй", 3));
  await syncDriveProjects(a, drive);
  await syncDriveProjects(b, drive);
  await syncDriveProjects(fresh, drive);
  assert.deepEqual([...fresh.projects.values()].map(({ name }) => name).sort(), ["Второй", "Первый · копия"]);
  assert.equal(drive.records.size, 2);
  await syncDriveProjects(fresh, drive);
  assert.equal(drive.records.size, 2);
});

test("an upload with a lost acknowledgement is recognized after reconnecting", async () => {
  const phone = device();
  const drive = fakeDrive();
  phone.projects.set("plan", drawing("Чертёж", 1));
  const write = drive.write;
  drive.write = async (record) => {
    await write(record);
    throw new Error("interrupted");
  };
  await assert.rejects(syncDriveProjects(phone, drive), /interrupted/);
  assert.equal(phone.states().plan.pending.id, "file-1");
  drive.write = write;
  await syncDriveProjects(phone, drive);
  assert.equal(drive.records.size, 1);
  assert.equal(phone.states().plan.pending, null);
});

test("the Drive adapter uses the private app folder and retries a reserved file by id", async () => {
  const paths = [];
  const file = { id: "google-file", appProperties: { kind: "zamer-cad-v1", project: "plan", deleted: "0" } };
  const api = googleDriveProjects("test-token", async (url, options) => {
    paths.push(String(url));
    assert.equal(options.headers.Authorization, "Bearer test-token");
    if (url.includes("generateIds")) return Response.json({ ids: [file.id] });
    if (url.includes("uploadType")) {
      assert.match(await options.body.text(), /"parents":\["appDataFolder"\]/);
      return new Response(null, { status: 409 });
    }
    if (url.includes(file.id)) return Response.json(file);
    return Response.json({ files: [file] });
  });
  const [fromList] = await api.list();
  const id = await api.reserve();
  const saved = await api.write({ id, projectId: "plan", previous: null, deleted: false, project: drawing("Кухня", 1) });
  assert.deepEqual(saved, fromList);
  assert.match(paths[0], /spaces=appDataFolder/);
  assert.match(paths[1], /space=appDataFolder/);
});

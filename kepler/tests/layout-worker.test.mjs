// Worker-протокол авторасстановки: снимок этажей, guard устаревших ответов,
// немедленная отмена и безопасный fallback одной комнаты.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutWorkerHandler } from '../core/layout-worker-handler.js';
import {
  createLayoutSolveRequest, LAYOUT_MESSAGE, LAYOUT_PROTOCOL_VERSION,
  normalizeSearchBudget,
} from '../core/layout-protocol.js';
import { createLevel, createProject, createRoom } from '../core/model.js';
import {
  createSolverSnapshot, restoreSolverSnapshot, solverInputSignature,
} from '../core/solver-snapshot.js';
import {
  LayoutSolveCancelledError, LayoutWorkerClient, LayoutWorkerUnavailableError, StaleLayoutResultError,
} from '../ui/layout-worker-client.js';

function twoLevelProject() {
  const project = createProject('Worker');
  const groundRoom = createRoom('bedroom', 0, 0, 4000, 4000);
  groundRoom.id = 'room-ground';
  project.rooms.push(groundRoom);
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  const upperRoom = createRoom('cabinet', 0, 0, 3000, 3000);
  upperRoom.id = 'room-upper';
  upper.rooms.push(upperRoom);
  project.levels.push(upper);
  return project;
}

test('снимок хранит все levels и восстанавливает non-enumerable accessors', () => {
  const project = twoLevelProject();
  const snapshot = createSolverSnapshot(project);
  assert.equal(snapshot.project.levels.length, 2);
  assert.equal(Object.hasOwn(snapshot.project, 'rooms'), false);
  const restored = restoreSolverSnapshot(snapshot);
  assert.equal(restored.rooms[0].id, 'room-ground');
  restored.activeLevel = 'L2';
  assert.equal(restored.rooms[0].id, 'room-upper');
  assert.equal(Object.getOwnPropertyDescriptor(restored, 'rooms').enumerable, false);
  assert.deepEqual(snapshot.project.levels.map((level) => level.id), ['L1', 'L2']);
});

test('сигнатура стабильна для порядка ключей, бюджет ограничен детерминированно', () => {
  const a = solverInputSignature({ version: 1, project: { b: 2, a: 1 } }, { roomId: 'r' }, { count: 3 });
  const b = solverInputSignature({ project: { a: 1, b: 2 }, version: 1 }, { roomId: 'r' }, { count: 3 });
  assert.equal(a, b);
  assert.notEqual(a, solverInputSignature({ version: 1, project: { b: 3, a: 1 } }, { roomId: 'r' }, { count: 3 }));
  assert.deepEqual(
    { ...normalizeSearchBudget({ searchBudget: 500, count: 20 }) },
    { searchBudget: 100, count: 6, beamWidth: 200, candidatesPerItem: 80, maxBasePoses: 240 },
  );
});

test('handler публикует progress и result с теми же requestId/signature', async () => {
  const project = twoLevelProject();
  const snapshot = createSolverSnapshot(project);
  const scope = { kind: 'room', levelId: 'L2', roomId: 'room-upper' };
  const options = normalizeSearchBudget({ count: 2, searchBudget: 12 });
  const signature = solverInputSignature(snapshot, scope, options);
  const request = createLayoutSolveRequest({ requestId: 'req-1', inputSignature: signature, scope, snapshot, options });
  const sent = [];
  const handler = createLayoutWorkerHandler({
    postMessage: (message) => sent.push(message),
    roomSolver: (levelProject, room, walls, received) => ({
      status: 'feasible', roomId: room.id, levelId: levelProject.activeLevel,
      wallCount: walls.length, count: received.count,
    }),
  });
  assert.equal(await handler(request), true);
  assert.ok(sent.some((message) => message.type === LAYOUT_MESSAGE.PROGRESS));
  const response = sent.find((message) => message.type === LAYOUT_MESSAGE.RESULT);
  assert.equal(response.protocol, LAYOUT_PROTOCOL_VERSION);
  assert.equal(response.requestId, 'req-1');
  assert.equal(response.inputSignature, signature);
  assert.deepEqual(response.result, {
    status: 'feasible', roomId: 'room-upper', levelId: 'L2', wallCount: 4, count: 2,
  });
});

class FakeWorker {
  constructor(reply) {
    this.reply = reply;
    this.listeners = { message: [], error: [] };
    this.terminated = 0;
  }

  addEventListener(type, listener) { this.listeners[type].push(listener); }

  postMessage(request) {
    this.request = request;
    this.reply?.(request, (data) => {
      for (const listener of this.listeners.message) listener({ data });
    });
  }

  terminate() { this.terminated += 1; }
}

function response(request, type, payload = {}) {
  return {
    protocol: LAYOUT_PROTOCOL_VERSION,
    type,
    requestId: request.requestId,
    inputSignature: request.inputSignature,
    ...payload,
  };
}

test('клиент игнорирует чужой ответ и отклоняет результат устаревшего проекта', async () => {
  let worker;
  const client = new LayoutWorkerClient({
    workerFactory: () => {
      worker = new FakeWorker((request, send) => queueMicrotask(() => {
        send({ ...response(request, LAYOUT_MESSAGE.RESULT, { result: { wrong: true } }), requestId: 'other' });
        send(response(request, LAYOUT_MESSAGE.RESULT, { result: { status: 'feasible' } }));
      }));
      return worker;
    },
  });
  const project = twoLevelProject();
  const task = client.startSolve({
    project,
    scope: { kind: 'room', roomId: 'room-ground' },
    getCurrentInputSignature: () => 'project-changed',
  });
  await assert.rejects(task.promise, StaleLayoutResultError);
  assert.ok(worker.terminated >= 1);
  assert.equal(client.tasks.size, 0);
});

test('cancel немедленно завершает Worker и promise', async () => {
  let worker;
  const client = new LayoutWorkerClient({
    workerFactory: () => {
      worker = new FakeWorker();
      return worker;
    },
  });
  const task = client.startSolve({
    project: twoLevelProject(),
    scope: { kind: 'room', roomId: 'room-ground' },
  });
  assert.equal(task.cancel(), true);
  await assert.rejects(task.promise, LayoutSolveCancelledError);
  assert.ok(worker.terminated >= 1);
  assert.equal(task.cancel(), false);
});

test('без Worker одна комната использует fallback, весь дом — явная ошибка', async () => {
  const unavailable = () => { throw new Error('Worker disabled'); };
  const client = new LayoutWorkerClient({ workerFactory: unavailable });
  const roomResult = await client.solve({
    project: twoLevelProject(),
    scope: { kind: 'room', roomId: 'room-ground' },
    options: { count: 1 },
  });
  assert.equal(roomResult.status, 'insufficient_data');

  await assert.rejects(client.solve({
    project: twoLevelProject(), scope: { kind: 'project' },
  }), LayoutWorkerUnavailableError);
});

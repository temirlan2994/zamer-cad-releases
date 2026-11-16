import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../core/memdb.js';
import {
  acquireEditLease, cancelEditLeaseRequest, classifyObservedEditLease, grantRequestedEditLease,
  heartbeatEditLease, leaseFence, leaseHeldBy, readEditLease,
  rejectEditLeaseRequest, releaseEditLease, requestEditLease, takeoverEditLease, watchEditLease,
} from '../core/edit-lease.js';

const ROOT = 'data/users/user1';
const PID = 'project1';
const A = { sessionId: 'session-a', deviceId: 'device-a', deviceName: 'Телефон A' };
const A_REOPENED = { sessionId: 'session-a-reopened', deviceId: 'device-a', deviceName: 'Телефон A' };
const B = { sessionId: 'session-b', deviceId: 'device-b', deviceName: 'Телефон B' };

test('lease атомарно допускает только одного редактора', async () => {
  const db = createMemoryDb();
  const [first, second] = await Promise.all([
    acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 1_000 }),
    acquireEditLease(db, ROOT, PID, B, { now: 1_000, ttlMs: 1_000 }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), ['acquired', 'occupied']);
  const active = await readEditLease(db, ROOT, PID);
  assert.equal(active.epoch, 1);
  assert.ok(leaseHeldBy(active, first.status === 'acquired' ? A : B));
});

test('новый сеанс того же устройства автоматически возобновляет редактирование', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 5_000 });
  const reopened = await acquireEditLease(db, ROOT, PID, A_REOPENED, { now: 1_100, ttlMs: 5_000 });

  assert.equal(reopened.status, 'acquired');
  assert.equal(reopened.lease.sessionId, A_REOPENED.sessionId);
  assert.equal(reopened.lease.deviceId, A.deviceId);
  assert.equal(reopened.lease.epoch, first.lease.epoch + 1, 'новый sessionId получает новый fencing epoch');
  assert.equal((await heartbeatEditLease(db, ROOT, PID, first.lease, { now: 1_200 })).status, 'lost');
  const renewed = await heartbeatEditLease(db, ROOT, PID, reopened.lease, { now: 1_200, ttlMs: 5_000 });
  assert.equal(renewed.status, 'renewed');

  const otherDevice = await acquireEditLease(db, ROOT, PID, B, { now: 1_300, ttlMs: 5_000 });
  assert.equal(otherDevice.status, 'occupied', 'другое устройство по-прежнему не может забрать активный lease');
  assert.ok(leaseHeldBy(otherDevice.lease, renewed.lease));
});

test('повторная кнопка в открытом окне конфликта сразу возвращает lease тому же устройству', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 5_000 });
  const reopened = await requestEditLease(db, ROOT, PID, A_REOPENED, { now: 1_100, ttlMs: 5_000 });

  assert.equal(reopened.status, 'acquired');
  assert.equal(reopened.lease.sessionId, A_REOPENED.sessionId);
  assert.equal(reopened.lease.epoch, first.lease.epoch + 1);
  assert.equal(reopened.lease.requestedSessionId, null);
});

test('запрос передачи можно отменить, не меняя владельца', async () => {
  const db = createMemoryDb();
  const owner = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 5_000 });
  const requested = await requestEditLease(db, ROOT, PID, B, { now: 1_100, ttlMs: 5_000 });
  assert.equal(requested.status, 'requested');
  assert.equal(requested.lease.requestedSessionId, B.sessionId);
  assert.ok(leaseHeldBy(requested.lease, owner.lease));

  const cancelled = await cancelEditLeaseRequest(db, ROOT, PID, B);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.lease.requestedSessionId, null);
  assert.ok(leaseHeldBy(cancelled.lease, owner.lease));
  assert.equal((await cancelEditLeaseRequest(db, ROOT, PID, B)).status, 'not-requested');
});

test('владелец передаёт lease запросившему устройству с новым epoch', async () => {
  const db = createMemoryDb();
  const owner = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 5_000 });
  await requestEditLease(db, ROOT, PID, B, { now: 1_100, ttlMs: 5_000 });
  const granted = await grantRequestedEditLease(db, ROOT, PID, owner.lease, { now: 1_200, ttlMs: 5_000 });
  assert.equal(granted.status, 'granted');
  assert.equal(granted.lease.sessionId, B.sessionId);
  assert.equal(granted.lease.epoch, owner.lease.epoch + 1);
  assert.deepEqual(leaseFence(granted.lease), { editorSession: B.sessionId, editorEpoch: 2 });

  assert.equal((await heartbeatEditLease(db, ROOT, PID, owner.lease, { now: 1_300 })).status, 'lost');
  assert.equal((await heartbeatEditLease(db, ROOT, PID, granted.lease, { now: 1_300 })).status, 'renewed');
});

test('владелец может отклонить запрос, чужая старая сессия — нет', async () => {
  const db = createMemoryDb();
  const owner = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 5_000 });
  await requestEditLease(db, ROOT, PID, B, { now: 1_100, ttlMs: 5_000 });
  assert.equal((await rejectEditLeaseRequest(db, ROOT, PID, { sessionId: 'old', epoch: 1 })).status, 'lost');
  const rejected = await rejectEditLeaseRequest(db, ROOT, PID, owner.lease);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.lease.requestedSessionId, null);
  assert.ok(leaseHeldBy(rejected.lease, owner.lease));
});

test('активный lease нельзя забрать без force, истёкший — можно', async () => {
  const db = createMemoryDb();
  const owner = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 1_000 });
  const occupied = await takeoverEditLease(db, ROOT, PID, B, { now: 1_500, ttlMs: 1_000 });
  assert.equal(occupied.status, 'occupied');
  assert.ok(leaseHeldBy(occupied.lease, owner.lease));

  const afterExpiry = await takeoverEditLease(db, ROOT, PID, B, { now: 2_001, ttlMs: 1_000 });
  assert.equal(afterExpiry.status, 'acquired');
  assert.equal(afterExpiry.lease.epoch, 2);
  assert.equal(afterExpiry.lease.sessionId, B.sessionId);
});

test('локальный тайм-аут и кэш не выдаются за подтверждённое другое устройство', async () => {
  const ownExpired = {
    ...A, epoch: 1, acquiredAt: 1_000, heartbeatAt: 1_000, expiresAt: 2_000,
    requestedSessionId: null, requestedDeviceId: null, requestedDeviceName: null, requestedAt: null,
  };
  const foreignActive = { ...ownExpired, ...B, epoch: 2, expiresAt: 10_000 };
  assert.equal(classifyObservedEditLease(ownExpired, A, { fromCache: false }, 5_000), 'available');
  assert.equal(classifyObservedEditLease(ownExpired, A, { fromCache: true }, 5_000), 'unconfirmed');
  assert.equal(classifyObservedEditLease(foreignActive, A, { fromCache: true }, 5_000), 'unconfirmed');
  assert.equal(classifyObservedEditLease(foreignActive, A, { fromCache: false }, 5_000), 'occupied');
  assert.equal(classifyObservedEditLease(null, A, { fromCache: false }, 5_000), 'available');
  assert.equal(classifyObservedEditLease({ ...foreignActive, expiresAt: 4_000 }, A, { fromCache: false }, 5_000), 'available');
});

test('после сна тот же сеанс продлевает истёкший lease без ложного конфликта', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 1_000 });
  const resumed = await acquireEditLease(db, ROOT, PID, A, { now: 5_000, ttlMs: 1_000 });
  assert.equal(resumed.status, 'acquired');
  assert.equal(resumed.renewed, true);
  assert.equal(resumed.lease.sessionId, first.lease.sessionId);
  assert.equal(resumed.lease.epoch, first.lease.epoch);
});

test('release не удаляет fencing history и разрешает следующий epoch', async () => {
  const db = createMemoryDb();
  const owner = await acquireEditLease(db, ROOT, PID, A, { now: 1_000, ttlMs: 5_000 });
  const released = await releaseEditLease(db, ROOT, PID, owner.lease, { now: 1_100 });
  assert.equal(released.status, 'released');
  const next = await acquireEditLease(db, ROOT, PID, B, { now: 1_101, ttlMs: 5_000 });
  assert.equal(next.status, 'acquired');
  assert.equal(next.lease.epoch, 2);
  assert.equal((await releaseEditLease(db, ROOT, PID, owner.lease, { now: 1_200 })).status, 'lost');
});

test('watchEditLease получает смену владельца', async () => {
  const db = createMemoryDb();
  const seen = [];
  const changed = new Promise((resolve, reject) => {
    const unsubscribe = watchEditLease(db, ROOT, PID, (lease) => {
      seen.push(lease?.sessionId || null);
      if (seen.includes(A.sessionId)) {
        unsubscribe();
        resolve();
      }
    }, reject);
  });
  await acquireEditLease(db, ROOT, PID, A, { now: 1_000 });
  await changed;
  assert.ok(seen.includes(A.sessionId));
});

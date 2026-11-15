// Единственный редактор облачного проекта. Lease живёт отдельным документом
// и меняется только транзакциями; epoch служит fencing token для saveDraft:
// запоздавшая запись старой вкладки не может заменить новый черновик.

import { newId } from './storage.js';

export const EDIT_LEASE_MS = 90_000;
export const EDIT_HEARTBEAT_MS = 25_000;

const SAFE_ID = /^[A-Za-z0-9._:@+~-]{1,128}$/;
const leaseRef = (db, root, pid) => db.doc(`${root}/${pid}/lease/editor`);

function nowMs(value = Date.now()) {
  const resolved = typeof value === 'function' ? value() : value;
  if (resolved instanceof Date) return resolved.getTime();
  const number = Number(resolved);
  return Number.isFinite(number) ? number : Date.now();
}

export function timestampMs(value) {
  if (value == null) return NaN;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1e6;
  }
  if (typeof value === 'number') return value;
  return Date.parse(String(value));
}

function timestamp(db, ms) {
  return typeof db.timestampFromMillis === 'function' ? db.timestampFromMillis(ms) : new Date(ms).toISOString();
}

function serverNow(db, ms) {
  return typeof db.serverTimestamp === 'function' ? db.serverTimestamp() : timestamp(db, ms);
}

function cleanIdentity(identity) {
  const sessionId = String(identity?.sessionId || '');
  const deviceId = String(identity?.deviceId || '');
  if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(deviceId)) throw new TypeError('Некорректный идентификатор редактора');
  return {
    sessionId,
    deviceId,
    deviceName: String(identity?.deviceName || 'Другое устройство').trim().slice(0, 120) || 'Другое устройство',
  };
}

export function normalizeEditLease(data) {
  if (!data || typeof data !== 'object') return null;
  const sessionId = String(data.sessionId || '');
  const deviceId = String(data.deviceId || '');
  const epoch = Number(data.epoch);
  if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(deviceId) || !Number.isInteger(epoch) || epoch < 1) return null;
  const requestedSessionId = data.requestedSessionId == null ? null : String(data.requestedSessionId);
  const requestedDeviceId = data.requestedDeviceId == null ? null : String(data.requestedDeviceId);
  if (requestedSessionId !== null && !SAFE_ID.test(requestedSessionId)) return null;
  if (requestedDeviceId !== null && !SAFE_ID.test(requestedDeviceId)) return null;
  return {
    sessionId,
    deviceId,
    deviceName: String(data.deviceName || 'Другое устройство').slice(0, 120),
    epoch,
    acquiredAt: data.acquiredAt ?? null,
    heartbeatAt: data.heartbeatAt ?? null,
    expiresAt: data.expiresAt ?? null,
    requestedSessionId,
    requestedDeviceId,
    requestedDeviceName: requestedSessionId ? String(data.requestedDeviceName || 'Другое устройство').slice(0, 120) : null,
    requestedAt: requestedSessionId ? data.requestedAt ?? null : null,
  };
}

export function newEditSessionId() { return newId('edit'); }

export function leaseHeldBy(lease, identityOrLease) {
  return Boolean(lease && identityOrLease
    && lease.sessionId === identityOrLease.sessionId
    && (identityOrLease.epoch == null || lease.epoch === Number(identityOrLease.epoch)));
}

export function leaseExpired(lease, at = Date.now()) {
  const expiry = timestampMs(lease?.expiresAt);
  return !Number.isFinite(expiry) || expiry <= nowMs(at);
}

// Snapshot из локального Firestore-кэша не доказывает, что проект уже
// редактирует другой сеанс. UI может блокировать редактор только по свежему
// серверному snapshot; отсутствие/истечение lease означает попытку получить
// его заново, а не «другое устройство».
export function classifyObservedEditLease(lease, identity, metadata = null, at = Date.now()) {
  if (metadata?.fromCache !== false || metadata?.hasPendingWrites === true) return 'unconfirmed';
  if (!lease || leaseExpired(lease, at)) return 'available';
  if (leaseHeldBy(lease, identity)) return 'owned';
  return 'occupied';
}

export function leaseFence(lease) {
  return lease ? { editorSession: lease.sessionId, editorEpoch: lease.epoch } : null;
}

function requireTransactions(db) {
  if (typeof db?.runTransaction !== 'function') {
    const error = new Error('Хранилище не поддерживает безопасную блокировку проекта');
    error.code = 'lease-unsupported';
    throw error;
  }
}

function emptyRequest() {
  return {
    requestedSessionId: null, requestedDeviceId: null,
    requestedDeviceName: null, requestedAt: null,
  };
}

function ownedLease(db, identity, epoch, at, ttlMs, acquiredAt = null) {
  const instant = serverNow(db, at);
  return {
    ...identity,
    epoch,
    acquiredAt: acquiredAt || instant,
    heartbeatAt: instant,
    expiresAt: timestamp(db, at + ttlMs),
    ...emptyRequest(),
  };
}

function renewedLease(db, lease, at, ttlMs) {
  return { ...lease, heartbeatAt: serverNow(db, at), expiresAt: timestamp(db, at + ttlMs) };
}

export async function readEditLease(db, root, pid) {
  const snapshot = await leaseRef(db, root, pid).get();
  return snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
}

export function watchEditLease(db, root, pid, next, error = undefined) {
  return leaseRef(db, root, pid).onSnapshot((snapshot) => {
    next(snapshot.exists ? normalizeEditLease(snapshot.data()) : null, snapshot.metadata || null);
  }, error);
}

export async function acquireEditLease(db, root, pid, editor, {
  now = Date.now(), ttlMs = EDIT_LEASE_MS,
} = {}) {
  requireTransactions(db);
  const identity = cleanIdentity(editor);
  const at = nowMs(now);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (current && !leaseExpired(current, at) && !leaseHeldBy(current, identity)) {
      return { status: 'occupied', lease: current };
    }
    const same = leaseHeldBy(current, identity);
    const lease = same
      ? renewedLease(db, current, at, ttlMs)
      : ownedLease(db, identity, (current?.epoch || 0) + 1, at, ttlMs);
    transaction.set(ref, lease);
    return { status: 'acquired', lease: normalizeEditLease(lease), renewed: same };
  });
}

export async function requestEditLease(db, root, pid, editor, {
  now = Date.now(), ttlMs = EDIT_LEASE_MS,
} = {}) {
  requireTransactions(db);
  const identity = cleanIdentity(editor);
  const at = nowMs(now);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (!current || leaseExpired(current, at)) {
      const lease = ownedLease(db, identity, (current?.epoch || 0) + 1, at, ttlMs);
      transaction.set(ref, lease);
      return { status: 'acquired', lease: normalizeEditLease(lease) };
    }
    if (leaseHeldBy(current, identity)) {
      const lease = renewedLease(db, current, at, ttlMs);
      transaction.set(ref, lease);
      return { status: 'owned', lease: normalizeEditLease(lease) };
    }
    if (current.requestedSessionId === identity.sessionId) return { status: 'requested', lease: current };
    const lease = {
      ...current,
      requestedSessionId: identity.sessionId,
      requestedDeviceId: identity.deviceId,
      requestedDeviceName: identity.deviceName,
      requestedAt: serverNow(db, at),
    };
    transaction.set(ref, lease);
    return { status: 'requested', lease: normalizeEditLease(lease) };
  });
}

export async function cancelEditLeaseRequest(db, root, pid, editor) {
  requireTransactions(db);
  const identity = cleanIdentity(editor);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (!current || current.requestedSessionId !== identity.sessionId) {
      return { status: 'not-requested', lease: current };
    }
    const lease = { ...current, ...emptyRequest() };
    transaction.set(ref, lease);
    return { status: 'cancelled', lease: normalizeEditLease(lease) };
  });
}

export async function rejectEditLeaseRequest(db, root, pid, ownerLease) {
  requireTransactions(db);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (!leaseHeldBy(current, ownerLease)) return { status: 'lost', lease: current };
    if (!current.requestedSessionId) return { status: 'no-request', lease: current };
    const lease = { ...current, ...emptyRequest() };
    transaction.set(ref, lease);
    return { status: 'rejected', lease: normalizeEditLease(lease) };
  });
}

export async function grantRequestedEditLease(db, root, pid, ownerLease, {
  now = Date.now(), ttlMs = EDIT_LEASE_MS,
} = {}) {
  requireTransactions(db);
  const at = nowMs(now);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (!leaseHeldBy(current, ownerLease)) return { status: 'lost', lease: current };
    if (!current.requestedSessionId || !current.requestedDeviceId) return { status: 'no-request', lease: current };
    const requested = cleanIdentity({
      sessionId: current.requestedSessionId,
      deviceId: current.requestedDeviceId,
      deviceName: current.requestedDeviceName,
    });
    const lease = ownedLease(db, requested, current.epoch + 1, at, ttlMs);
    transaction.set(ref, lease);
    return { status: 'granted', lease: normalizeEditLease(lease) };
  });
}

export async function heartbeatEditLease(db, root, pid, heldLease, {
  now = Date.now(), ttlMs = EDIT_LEASE_MS,
} = {}) {
  requireTransactions(db);
  const at = nowMs(now);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (!leaseHeldBy(current, heldLease)) return { status: 'lost', lease: current };
    const lease = renewedLease(db, current, at, ttlMs);
    transaction.set(ref, lease);
    return { status: 'renewed', lease: normalizeEditLease(lease) };
  });
}

export async function takeoverEditLease(db, root, pid, editor, {
  force = false, now = Date.now(), ttlMs = EDIT_LEASE_MS,
} = {}) {
  requireTransactions(db);
  const identity = cleanIdentity(editor);
  const at = nowMs(now);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (current && !leaseExpired(current, at) && !force && !leaseHeldBy(current, identity)) {
      return { status: 'occupied', lease: current };
    }
    const same = leaseHeldBy(current, identity);
    const lease = same
      ? renewedLease(db, current, at, ttlMs)
      : ownedLease(db, identity, (current?.epoch || 0) + 1, at, ttlMs);
    transaction.set(ref, lease);
    return { status: 'acquired', lease: normalizeEditLease(lease), forced: Boolean(current && !same) };
  });
}

export async function releaseEditLease(db, root, pid, heldLease, { now = Date.now() } = {}) {
  requireTransactions(db);
  const at = nowMs(now);
  const ref = leaseRef(db, root, pid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeEditLease(snapshot.data()) : null;
    if (!leaseHeldBy(current, heldLease)) return { status: 'lost', lease: current };
    const lease = {
      ...current,
      heartbeatAt: serverNow(db, at),
      expiresAt: timestamp(db, at - 1),
      ...emptyRequest(),
    };
    transaction.set(ref, lease);
    return { status: 'released', lease: normalizeEditLease(lease) };
  });
}

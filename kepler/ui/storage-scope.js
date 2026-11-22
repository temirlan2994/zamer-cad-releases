// Пространство локального хранения для текущей учётной записи.
// Firebase/Claude UID не является секретом, но отделяет черновики людей,
// которые пользуются одним браузером. Старые ключи без суффикса относятся
// только к гостю и переносятся при первом чтении.

export const GUEST_STORAGE_SCOPE = 'guest';
export const STORAGE_SCOPE_KEY = 'kepler-plan-storage-scope';

let currentScope = null;

const storage = () => globalThis.localStorage;

function normalizeScope(uid) {
  const value = String(uid || '').trim();
  return value ? value.slice(0, 256) : GUEST_STORAGE_SCOPE;
}

function storedScope() {
  if (currentScope) return currentScope;
  try { currentScope = normalizeScope(storage()?.getItem(STORAGE_SCOPE_KEY)); }
  catch { currentScope = GUEST_STORAGE_SCOPE; }
  return currentScope;
}

export function getStorageScope() {
  return storedScope();
}

export function setStorageScope(uid) {
  currentScope = normalizeScope(uid);
  try { storage()?.setItem(STORAGE_SCOPE_KEY, currentScope); } catch { /* локальное хранилище недоступно */ }
  return currentScope;
}

export function scopedKey(base, scope = storedScope()) {
  return `${String(base)}:${encodeURIComponent(normalizeScope(scope))}`;
}

// Старый Kepler писал гостевой черновик без namespace. Переносим значение
// атомарно насколько позволяет localStorage: сначала копия, затем удаление.
function migrateGuestValue(base) {
  const target = scopedKey(base, GUEST_STORAGE_SCOPE);
  const db = storage();
  const scoped = db.getItem(target);
  const legacy = db.getItem(base);
  if (scoped !== null) {
    if (legacy !== null) db.removeItem(base);
    return scoped;
  }
  if (legacy === null) return null;
  try {
    db.setItem(target, legacy);
    db.removeItem(base);
  } catch {
    // При переполненной квоте старое значение всё равно остаётся доступным.
  }
  return legacy;
}

export function getScopedItem(base) {
  if (storedScope() === GUEST_STORAGE_SCOPE) return migrateGuestValue(String(base));
  return storage().getItem(scopedKey(base));
}

export function setScopedItem(base, value) {
  const db = storage();
  db.setItem(scopedKey(base), String(value));
  if (storedScope() === GUEST_STORAGE_SCOPE) db.removeItem(String(base));
}

export function removeScopedItem(base) {
  const db = storage();
  db.removeItem(scopedKey(base));
  if (storedScope() === GUEST_STORAGE_SCOPE) db.removeItem(String(base));
}

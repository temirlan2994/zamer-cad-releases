import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getScopedItem, getStorageScope, removeScopedItem, scopedKey, setScopedItem, setStorageScope,
} from '../ui/storage-scope.js';

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

beforeEach(() => {
  globalThis.localStorage = new FakeStorage();
  setStorageScope('guest');
  localStorage.clear();
});

test('гостевой scope один раз переносит старые ключи автосохранения', () => {
  const keys = ['kepler-plan-autosave', 'kepler-plan-pid', 'kepler-plan-autosave-broken'];
  keys.forEach((key, i) => localStorage.setItem(key, `legacy-${i}`));

  keys.forEach((key, i) => {
    assert.equal(getScopedItem(key), `legacy-${i}`);
    assert.equal(localStorage.getItem(key), null);
    assert.equal(localStorage.getItem(scopedKey(key)), `legacy-${i}`);
  });

  localStorage.setItem(keys[0], 'устаревшая вкладка');
  assert.equal(getScopedItem(keys[0]), 'legacy-0', 'готовая миграция не перезаписывается');
  assert.equal(localStorage.getItem(keys[0]), null);
});

test('аккаунты не видят локальные значения друг друга', () => {
  setStorageScope('google-user-a');
  setScopedItem('kepler-plan-autosave', 'проект A');
  setScopedItem('kepler-plan-pid', 'p-a');

  setStorageScope('google-user-b');
  assert.equal(getScopedItem('kepler-plan-autosave'), null);
  assert.equal(getScopedItem('kepler-plan-pid'), null);
  setScopedItem('kepler-plan-autosave', 'проект B');

  setStorageScope('google-user-a');
  assert.equal(getStorageScope(), 'google-user-a');
  assert.equal(getScopedItem('kepler-plan-autosave'), 'проект A');
  assert.equal(getScopedItem('kepler-plan-pid'), 'p-a');
});

test('UID кодируется в ключе, удаление затрагивает только текущий аккаунт', () => {
  setStorageScope('user/name with space');
  assert.equal(scopedKey('draft'), 'draft:user%2Fname%20with%20space');
  setScopedItem('draft', 'one');

  setStorageScope('other');
  setScopedItem('draft', 'two');
  removeScopedItem('draft');
  assert.equal(getScopedItem('draft'), null);

  setStorageScope('user/name with space');
  assert.equal(getScopedItem('draft'), 'one');
});

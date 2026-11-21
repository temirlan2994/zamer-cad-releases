import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldOpenRecentCloudProject, shouldUseRemoteProject,
} from '../ui/startup-cloud.js';

test('новый локальный проект без PID не привязывается к последнему облачному', () => {
  assert.equal(shouldOpenRecentCloudProject(null, { name: 'Новый' }), false);
  assert.equal(shouldOpenRecentCloudProject(null, null), true);
  assert.equal(shouldOpenRecentCloudProject('p1', null), false);
});

test('облачный проект выбирается только когда локальной копии нет или она старее', () => {
  const local = { name: 'Дом' };
  assert.equal(shouldUseRemoteProject(null, null, '2026-11-15T10:00:00.000Z'), true);
  assert.equal(shouldUseRemoteProject(local, null, '2026-11-15T10:00:00.000Z'), false);
  assert.equal(shouldUseRemoteProject(local, '2026-11-15T10:01:00.000Z', '2026-11-15T10:00:00.000Z'), false);
  assert.equal(shouldUseRemoteProject(local, '2026-11-15T09:00:00.000Z', '2026-11-15T10:00:00.000Z'), true);
});

// Окно передачи проекта должно действительно блокировать редактор, а не
// быть закрываемым уведомлением, после которого старое устройство пишет снова.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../scripts/build-artifact.mjs';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const source = readFileSync(join(ROOT, 'ui/edit-lock-ui.js'), 'utf8');

test('блокировка редактирования — не закрываемый alertdialog с двумя явными действиями', () => {
  const block = html.match(/<div class="start-screen edit-lock-screen"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.match(block, /role="alertdialog"/);
  assert.match(block, /aria-modal="true"/);
  assert.match(block, /id="editLockContinue"/);
  assert.match(block, /id="editLockProjects"/);
  assert.doesNotMatch(block, /editLockClose|title="Закрыть/);
});

test('открытая блокировка выключает остальные слои и перехватывает Escape', () => {
  assert.match(source, /node\.inert\s*=\s*true/);
  assert.match(source, /event\.key\s*!==\s*['"]Escape['"]/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

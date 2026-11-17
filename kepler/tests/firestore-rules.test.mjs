import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

test('Firestore разрешает владельцу список проектов без фильтра по pid', () => {
  assert.match(rules, /allow list:\s*if isOwner\(uid\)/);
  assert.match(rules, /allow get:\s*if isOwner\(uid\) && validId\(pid\)/);
  assert.match(rules, /allow delete:[\s\S]*validProjectDeleteFence\(uid, pid\)/);
  assert.doesNotMatch(rules, /allow read, delete:\s*if isOwner\(uid\) && validId\(pid\)/);
});

test('Firestore принимает компактный preview в карточке и черновике', () => {
  assert.match(rules, /function validPreview\(value\)/);
  assert.equal((rules.match(/'preview'/g) || []).length >= 3, true);
  assert.equal((rules.match(/validPreview\(data\.preview\)/g) || []).length, 2);
  assert.match(rules, /value\.keys\(\)\.hasOnly\(\['v', 'image'\]\)/);
  assert.match(rules, /value\.v == 2/);
  assert.match(rules, /value\.image\.size\(\) <= 180000/);
  assert.match(rules, /data:image\/webp;base64/);
  assert.match(rules, /data:image\/jpeg;base64/);
  assert.doesNotMatch(rules, /data:image\/png;base64/);
});

test('Firestore разрешает владельцу только короткую аренду редактора', () => {
  assert.match(rules, /match \/lease\/\{leaseId\}/);
  assert.match(rules, /allow read:\s*if isOwner\(uid\) && leaseId == 'editor'/);
  assert.match(rules, /allow create:[\s\S]*validEditorLease\(\)[\s\S]*epoch == 1/);
  assert.match(rules, /allow update:[\s\S]*sameEditorLease\(\)[\s\S]*epoch == resource\.data\.epoch \+ 1/);
  assert.match(rules, /data\.expiresAt <= request\.time \+ duration\.value\(2, 'm'\)/);
  assert.match(rules, /allow delete:\s*if false/);
});

test('draft current принимает запись только от действующего editor lease', () => {
  assert.match(rules, /'editorSession', 'editorEpoch'/);
  assert.match(rules, /validDraftFence\(uid, pid, request\.resource\.data\)/);
  assert.match(rules, /lease\.data\.sessionId == data\.editorSession/);
  assert.match(rules, /lease\.data\.epoch == data\.editorEpoch/);
  assert.match(rules, /lease\.data\.expiresAt > request\.time/);
});

test('карточка и head проекта принимаются только от действующего editor lease', () => {
  assert.match(rules, /function validProjectMetaFence\(uid, pid, data\)/);
  assert.match(rules, /'preview',\s*'editorSession', 'editorEpoch'/);
  assert.match(rules, /validProjectMetaFence\(uid, pid, request\.resource\.data\)/);
  assert.match(rules, /function validProjectMetaFence[\s\S]*lease\.data\.sessionId == data\.editorSession/);
  assert.match(rules, /function validProjectMetaFence[\s\S]*lease\.data\.epoch == data\.editorEpoch/);
});

test('удаление карточки разрешено только владельцу действующего lease', () => {
  assert.match(rules, /function validProjectDeleteFence\(uid, pid\)/);
  assert.match(rules, /function validProjectDeleteFence[\s\S]*resource\.data\.editorSession/);
  assert.match(rules, /function validProjectDeleteFence[\s\S]*lease\.data\.epoch == resource\.data\.editorEpoch/);
  assert.match(rules, /function validProjectDeleteFence[\s\S]*lease\.data\.expiresAt > request\.time/);
});

test('chunks живого fenced-проекта не удаляются, а после parent cleanup разрешён', () => {
  assert.match(rules, /function projectPath\(uid, pid\)/);
  assert.match(
    rules,
    /function validProjectCleanup\(uid, pid\) \{\s*return !exists\(editorLeasePath\(uid, pid\)\)\s*\|\| !exists\(projectPath\(uid, pid\)\);\s*\}/,
  );
  const guardedChildren = rules.match(
    /allow delete:\s*if isOwner\(uid\) && validId\([^)]+\) && validProjectCleanup\(uid, pid\);/g,
  ) || [];
  assert.equal(guardedChildren.length, 6);
  assert.equal((rules.match(/allow list:\s*if isOwner\(uid\);/g) || []).length, 7);
  assert.doesNotMatch(rules, /deletionMarker|deletionLease|getAfter/);
});

test('старый клиент совместим только пока проект ещё не получил lease', () => {
  assert.match(rules, /!exists\(editorLeasePath\(uid, pid\)\)[\s\S]*!\('editorSession' in data\)[\s\S]*!\('editorEpoch' in data\)/);
  assert.match(rules, /function validProjectCleanup\(uid, pid\)[\s\S]*return !exists\(editorLeasePath\(uid, pid\)\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

test('Firestore разрешает владельцу список проектов без фильтра по pid', () => {
  assert.match(rules, /allow list:\s*if isOwner\(uid\)/);
  assert.match(rules, /allow get, delete:\s*if isOwner\(uid\) && validId\(pid\)/);
  assert.doesNotMatch(rules, /allow read, delete:\s*if isOwner\(uid\) && validId\(pid\)/);
});

test('Firestore принимает компактный preview в карточке и черновике', () => {
  assert.match(rules, /function validPreview\(value\)/);
  assert.equal((rules.match(/'preview'/g) || []).length >= 3, true);
  assert.equal((rules.match(/validPreview\(data\.preview\)/g) || []).length, 2);
});

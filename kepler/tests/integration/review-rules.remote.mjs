// Серверная проверка правил без записи документов и без развёртывания.
// KEPLER_FIREBASE_TEST_ROOT — каталог с установленным firebase-tools.
// FIREBASE_TOKEN или авторизация firebase-tools требуются только для API тестирования.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(`${process.env.KEPLER_FIREBASE_TEST_ROOT || process.cwd()}/package.json`);
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
const project = process.env.GCLOUD_PROJECT || 'kepler-plan';
await requireAuth({ nonInteractive: true, project, token: process.env.FIREBASE_TOKEN });
const path = `/databases/(default)/documents/conceptReviews/${'a'.repeat(64)}`;
const resource = { data: { ownerUid: 'owner', ready: false, revoked: true } };
const cases = [
  ['ALLOW', 'get', path, 'owner', resource],
  ['DENY', 'get', path, 'other', resource],
  ['DENY', 'get', path, null, resource],
  ['DENY', 'list', '/databases/(default)/documents/conceptReviews', 'owner', resource],
  ['DENY', 'delete', path, 'other', resource],
  ['ALLOW', 'delete', path, 'owner', resource],
  ['DENY', 'update', `${path}/parts/0`, 'owner', { data: { index: 0, text: 'исходное' } }],
  ['DENY', 'update', `${path}/responses/response123`, 'owner', { data: {} }],
];
const response = await new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' }).post(`/projects/${project}:test`, {
  source: { files: [{ name: 'firestore.rules', content: await readFile(new URL('../../../firestore.rules', import.meta.url), 'utf8') }] },
  testSuite: { testCases: cases.map(([expectation, method, path, uid, resource]) => ({ expectation, request: { method, path, ...(uid ? { auth: { uid } } : {}) }, resource })) },
}, { skipLog: { body: true, resBody: true } });
const results = response.body.testResults || [];
assert.equal(results.length, cases.length);
results.forEach((result, index) => {
  assert.equal(result.state, 'SUCCESS', `Проверка ${index+1}: ${JSON.stringify(result.errors || [])}`);
  console.log(`${index+1}. ${cases[index][1]} ${cases[index][3] || 'anonymous'}: ${cases[index][0]}`);
});
console.log('Правила проверены на сервере. Документы и действующие правила не изменены.');

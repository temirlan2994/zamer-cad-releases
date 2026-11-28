import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createLevel, deserializeProject, serializeProject } from '../core/model.js';
import { createReviewSnapshot, validateReviewSnapshot, designDigest, rememberReviewSnapshot, makeReviewResponse, importReviewResponse, reviewApproval, sha256, reviewChanges } from '../core/concept-review.js';
import { buildConceptHandoff, buildConceptJson } from '../core/concept-handoff.js';

test('согласование привязано к неизменяемому снимку; изменения дома делают решение устаревшим', async () => {
  const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 6000, 5000));
  const snapshot = await createReviewSnapshot(p); rememberReviewSnapshot(p, snapshot);
  const response = makeReviewResponse(snapshot, { author: 'Заказчик', action: 'approve' });
  assert.equal(importReviewResponse(p, response), true); assert.equal(importReviewResponse(p, response), false);
  const copy = deserializeProject(serializeProject(p));
  assert.equal(reviewApproval(copy, await designDigest(copy)).status, 'approved');
  copy.rooms[0].w += 100; const state = reviewApproval(copy, await designDigest(copy));
  assert.equal(state.status, 'pending'); assert.equal(state.stale, true);
  const changed = structuredClone(snapshot); changed.project.name = 'Подмена'; await assert.rejects(() => validateReviewSnapshot(changed));
  await validateReviewSnapshot(snapshot);
  assert.throws(() => importReviewResponse(p, { ...response, message: 'Иное решение' }));
});

test('комплект содержит проверяемые хеши файлов и честные состояния внешней приёмки', async () => {
  const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 6000, 5000));
  const { files, manifest } = await buildConceptHandoff(p);
  for (const entry of manifest.files) {
    const file = files.find((file) => file.name === entry.name); assert.equal(await sha256(file.data), entry.sha256);
  }
  assert.equal(manifest.checks.revitRuntime, 'external_verification_required');
  assert.equal(manifest.checks.budgetComplete, false); assert.equal(manifest.approval.status, 'pending');
  assert.ok(files.some((file) => file.name === 'model.export.json'));
  const json = JSON.parse(files.find((file) => file.name === 'model.export.json').data);
  assert.ok(json.concept_geometry.some((entry) => entry.category === 'roof'));
  assert.ok(json.concept_geometry.some((entry) => entry.category === 'floor'));
  assert.equal(json.concept.geometry_complete, true);
  await assert.rejects(() => buildConceptHandoff(createProject()));
});

test('асинхронный экспорт использует один снимок; добавление другой стены не меняет ID прежних', async () => {
  const p = createProject(); p.rooms.push(createRoom('living',0,0,5000,4000));
  const pending = buildConceptJson(p); p.rooms[0].w = 7000;
  const first = await pending; assert.equal(first.levels[0].rooms[0].size.w,5000);
  const ids = first.levels[0].walls.map((wall)=>wall.id);
  p.rooms[0].w = 5000; p.rooms.unshift(createRoom('bedroom',20000,0,5000,4000));
  const next = await buildConceptJson(p);
  assert.ok(ids.every((id)=>next.levels[0].walls.some((wall)=>wall.id===id)));
});

 test('ответ на старый снимок принимается после вытеснения его геометрии из локального списка', async () => {
  const p = createProject(); p.rooms.push(createRoom('living',0,0,5000,4000));
  const first = await createReviewSnapshot(p); rememberReviewSnapshot(p,first);
  for (let i=0;i<11;i++) { p.rooms[0].w += 100; rememberReviewSnapshot(p,await createReviewSnapshot(p)); }
  assert.equal(p.concept.reviewSnapshots.length,10);
  const restored = deserializeProject(serializeProject(p));
  assert.equal(importReviewResponse(restored,makeReviewResponse(first,{author:'Заказчик',action:'comment',message:'Старое замечание'})),true);
  assert.equal(restored.concept.decisions[0].digest,first.digest);
 });

 test('переключение просматриваемого этажа не снимает согласование дома', async () => {
  const p=createProject();p.rooms.push(createRoom('living',0,0,5000,4000));
  p.levels.push(createLevel('2 этаж',3000,3000,'L2'));
  const first=await createReviewSnapshot(p);rememberReviewSnapshot(p,first);
  importReviewResponse(p,makeReviewResponse(first,{author:'Заказчик',action:'approve'}));
  p.activeLevel='L2';assert.deepEqual(reviewChanges(p,first),[]);assert.equal(reviewApproval(p,await designDigest(p)).status,'approved');
  p.levels[1].height=3200;assert.ok(reviewChanges(p,first).includes('Этажи, планировка, проёмы и мебель'));assert.equal(reviewApproval(p,await designDigest(p)).status,'pending');
 });

 test('повреждённые необязательные поля концепции не ломают открытие проекта и не создают согласование', async () => {
  const p=createProject();p.rooms.push(createRoom('living',0,0,5000,4000));
  p.concept={projectId:{},reviewSnapshots:[null,{}, {id:'review123',digest:'a'.repeat(64),schema:'kepler-review/1'}],reviewSnapshotRefs:{},shares:[null,{}],decisions:[null,{},'подмена'],integrationVerifications:{}};
  const restored=deserializeProject(serializeProject(p));
  for(const field of ['reviewSnapshots','reviewSnapshotRefs','shares','decisions','integrationVerifications'])assert.deepEqual(restored.concept[field],[]);
  assert.equal(restored.concept.projectId,null);assert.equal(reviewApproval(restored,await designDigest(restored)).status,'pending');
 });

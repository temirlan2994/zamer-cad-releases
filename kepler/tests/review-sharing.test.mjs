import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom } from '../core/model.js';
import { createReviewSnapshot, makeReviewResponse } from '../core/concept-review.js';
import { publishReviewSnapshot, loadSharedReview, revokeSharedReview, sendSharedReviewResponse, sharedReviewResponses } from '../core/review-sharing.js';

function memoryDatabase() {
  const data = new Map(); let failPart = false;
  const doc = (path) => ({
    set: async (value) => { if (failPart && path.includes('/parts/')) throw new Error('Обрыв сети'); data.set(path, structuredClone(value)); },
    update: async (value) => { Object.assign(data.get(path), structuredClone(value)); },
    get: async () => ({ exists: data.has(path), data: () => structuredClone(data.get(path)) }),
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({ doc: (id) => doc(`${path}/${id}`), orderBy: () => ({ get: async () => ({ docs: [...data].filter(([key])=>key.startsWith(path+'/')).map(([,value])=>({data:()=>structuredClone(value)})) }) }) });
  return { data, db: { doc, collection }, fail: () => { failPart=true; } };
}

async function fixture() {
  const p=createProject(); p.rooms.push(createRoom('living',0,0,5000,4000));
  p.layoutBrief={ notes:'😀я'.repeat(90000) };
  const snapshot=await createReviewSnapshot(p), memory=memoryDatabase();
  return { ...memory, snapshot, owner:{provider:'firebase',mode:'cloud',uid:'owner',db:memory.db} };
}

test('облачный протокол: UTF-8 части, контрольная сумма, ответ, истечение и отзыв',async()=>{
  const {data,db,snapshot,owner}=await fixture();
  const share=await publishReviewSnapshot(snapshot,owner,{baseUrl:'https://host.example/editor/'});
  assert.match(share.url,/https:\/\/host.example\/editor\/review.html#review=[a-f0-9]{64}/);
  assert.ok([...data.keys()].filter((key)=>key.includes('/parts/')).length >= 3, 'проверяется многобайтный снимок в нескольких частях');
  for(const [key,value] of data) if(key.includes('/parts/')) assert.ok(new TextEncoder().encode(value.text).length<=180000);
  assert.equal((await loadSharedReview(db,share.id)).snapshot.digest,snapshot.digest);
  const response=makeReviewResponse(snapshot,{author:'Заказчик',action:'approve'});
  await assert.rejects(()=>sendSharedReviewResponse(db,share.id,response,null));
  await sendSharedReviewResponse(db,share.id,response,{uid:'client'});
  assert.equal((await sharedReviewResponses(share,owner))[0].authorUid,'client');
  await assert.rejects(()=>loadSharedReview(db,share.id,{now:Date.parse(share.expiresAt)+1}));
  const part=[...data.keys()].find((key)=>key.includes('/parts/'));
  const original=data.get(part).text;data.get(part).text='x'+original.slice(1);
  await assert.rejects(()=>loadSharedReview(db,share.id));data.get(part).text=original;
  await revokeSharedReview(share,owner);await assert.rejects(()=>loadSharedReview(db,share.id));
  await assert.rejects(()=>sendSharedReviewResponse(db,share.id,response,{uid:'client'}));
});

test('оборванная публикация остаётся недоступной; неверный срок не публикуется',async()=>{
  const {data,snapshot,owner,fail,db}=await fixture();
  await assert.rejects(()=>publishReviewSnapshot(snapshot,owner,{durationDays:NaN}));assert.equal(data.size,0);
  fail();await assert.rejects(()=>publishReviewSnapshot(snapshot,owner));
  const [path,root]=[...data][0];assert.equal(root.ready,false);assert.equal(root.revoked,true);
  await assert.rejects(()=>loadSharedReview(db,path.split('/')[1]));
});

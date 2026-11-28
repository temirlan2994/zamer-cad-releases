import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createProject, createRoom } from '../../core/model.js';
import { createReviewSnapshot, makeReviewResponse } from '../../core/concept-review.js';
import { publishReviewSnapshot, loadSharedReview, sendSharedReviewResponse, sharedReviewResponses, revokeSharedReview } from '../../core/review-sharing.js';

test('Firestore: неизменяемый снимок, отсутствие списка, чужие права, ответы и отзыв', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const require = createRequire(`${process.env.KEPLER_FIREBASE_TEST_ROOT || process.cwd()}/package.json`);
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import(require.resolve('@firebase/rules-unit-testing'));
  const { serverTimestamp, Timestamp } = await import(require.resolve('firebase/firestore'));
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-kepler-concept', firestore: { host, port: Number(port), rules: await readFile(new URL('../../../firestore.rules', import.meta.url), 'utf8') } });
  const dbFor = (context) => {
    const native = context.firestore();
    return { doc: (path) => native.doc(path), collection: (path) => native.collection(path), serverTimestamp, timestampFromMillis: Timestamp.fromMillis };
  };
  try {
    await env.clearFirestore();
    const owner = { provider: 'firebase', mode: 'cloud', uid: 'owner', db: dbFor(env.authenticatedContext('owner')) };
    const other = { provider: 'firebase', mode: 'cloud', uid: 'other', db: dbFor(env.authenticatedContext('other')) };
    const visitor = dbFor(env.unauthenticatedContext());
    const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
    const snapshot = await createReviewSnapshot(p), share = await publishReviewSnapshot(snapshot, owner);
    assert.equal((await loadSharedReview(visitor, share.id)).snapshot.digest, snapshot.digest);
    await assertFails(visitor.collection('conceptReviews').get());
    await assertFails(other.db.doc(`conceptReviews/${share.id}`).update({ revoked: true }));
    await assertFails(owner.db.doc(`conceptReviews/${share.id}/parts/0`).update({ text: '{}' }));
    const response = makeReviewResponse(snapshot, { author: 'Заказчик', action: 'approve' });
    await assert.rejects(() => sendSharedReviewResponse(visitor, share.id, response, null));
    await sendSharedReviewResponse(other.db, share.id, response, { uid: 'other' });
    await assertFails(other.db.collection(`conceptReviews/${share.id}/responses`).get());
    const replies = await sharedReviewResponses(share, owner); assert.equal(replies.length, 1); assert.equal(replies[0].authorUid, 'other');
    const malicious = makeReviewResponse(snapshot, { author: 'X', message: 'Подмена' });
    await assertFails(other.db.doc(`conceptReviews/${share.id}/responses/${malicious.id}`).set({ response: malicious, authorUid: 'owner', receivedAt: serverTimestamp() }));
    await assertSucceeds(owner.db.doc(`conceptReviews/${share.id}`).get());
    await revokeSharedReview(share, owner);
    await assertFails(visitor.doc(`conceptReviews/${share.id}`).get());
    await assertFails(visitor.doc(`conceptReviews/${share.id}/parts/0`).get());
    await assertFails(owner.db.doc(`conceptReviews/${share.id}`).update({ revoked: false }));
    await assert.rejects(() => sendSharedReviewResponse(other.db, share.id, makeReviewResponse(snapshot, { author: 'X', message: 'После отзыва' }), { uid: 'other' }));
    assert.equal((await sharedReviewResponses(share, owner)).length, 1);
  } finally { await env.cleanup(); }
});

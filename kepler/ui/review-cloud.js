import { publishReviewSnapshot, revokeSharedReview, sharedReviewResponses } from '../core/review-sharing.js';

function readable(error) {
  if (String(error?.code || '').includes('permission-denied')) return new Error('Облако запретило действие. Для ссылок нужны обновлённые правила Firestore; клиентский файл HTML работает без облака.');
  return error;
}
export async function publishReview(snapshot, backend) {
  try { return await publishReviewSnapshot(snapshot, backend, { baseUrl: location.href }); } catch (error) { throw readable(error); }
}
export async function revokeReview(share, backend) {
  try { return await revokeSharedReview(share, backend); } catch (error) { throw readable(error); }
}
export async function loadReviewResponses(share, backend) {
  try { return await sharedReviewResponses(share, backend); } catch (error) { throw readable(error); }
}

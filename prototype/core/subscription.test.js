import test from "node:test";
import assert from "node:assert/strict";
import {
  BILLING, PRO_FEATURES, canUseFeature, checkoutUrl, licenseFromResponse, needsLicenseCheck, normalizeLicenseKey,
  normalizeSubscription, subscriptionStatus, touchSubscription,
} from "./subscription.js";

const DAY = 86400000;
const off = { ...BILLING, enabled: false };
const on = { ...BILLING, enabled: true };
const start = Date.parse("2026-12-01T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("subscription stays out of the way until payments are switched on", () => {
  const record = touchSubscription({}, start, off);
  assert.equal(record.trialStartedAt, null);
  const status = subscriptionStatus(record, start + 100 * DAY, off);
  assert.deepEqual(status, { kind: "free" });
  for (const feature of Object.keys(PRO_FEATURES)) assert.ok(canUseFeature(status, feature));
});

test("trial starts on the first launch with payments on and lasts 14 days", () => {
  const record = touchSubscription(touchSubscription({}, start, off), start, on);
  assert.equal(record.trialStartedAt, iso(start));
  assert.deepEqual(subscriptionStatus(record, start, on), { kind: "trial", daysLeft: 14 });
  assert.deepEqual(subscriptionStatus(record, start + 13.5 * DAY, on), { kind: "trial", daysLeft: 1 });
  const expired = subscriptionStatus(record, start + 14 * DAY, on);
  assert.deepEqual(expired, { kind: "expired", hadLicense: false });
  for (const feature of Object.keys(PRO_FEATURES)) assert.equal(canUseFeature(expired, feature), false);
  for (const feature of ["open", "edit", "exportBackup", "toString"]) assert.ok(canUseFeature(expired, feature));
  assert.equal(touchSubscription(record, start + 5 * DAY, on).trialStartedAt, iso(start));
});

test("turning the phone clock back does not extend the trial", () => {
  const record = touchSubscription(touchSubscription({}, start, on), start + 20 * DAY, on);
  const back = touchSubscription(record, start + DAY, on);
  assert.equal(back.lastSeenAt, iso(start + 20 * DAY));
  assert.equal(subscriptionStatus(back, start + DAY, on).kind, "expired");
});

test("an active license gives Pro until its end plus a short grace period", () => {
  const license = { key: "ZC-2026-ABCD-EFGH", plan: "year", active: true, expiresAt: iso(start + 30 * DAY), checkedAt: iso(start) };
  const record = { trialStartedAt: iso(start - 40 * DAY), lastSeenAt: iso(start), license };
  assert.deepEqual(subscriptionStatus(record, start, on), { kind: "pro", plan: "year", expiresAt: iso(start + 30 * DAY) });
  assert.equal(subscriptionStatus(record, start + 32 * DAY, on).kind, "pro");
  assert.deepEqual(subscriptionStatus(record, start + 34 * DAY, on), { kind: "expired", hadLicense: true });
  assert.equal(subscriptionStatus({ ...record, license: { ...license, active: false } }, start, on).kind, "expired");
  assert.equal(needsLicenseCheck(record, start + DAY), false);
  assert.equal(needsLicenseCheck(record, start + 3 * DAY), true);
  assert.equal(needsLicenseCheck({ ...record, license: { ...license, checkedAt: iso(start + 29 * DAY) } }, start + 29.5 * DAY), true);
  assert.equal(needsLicenseCheck({ trialStartedAt: iso(start) }, start + 100 * DAY), false);
});

test("license service replies and keys are validated", () => {
  assert.equal(normalizeLicenseKey("  zc-2026 abcd-efgh "), "ZC-2026ABCD-EFGH");
  for (const bad of ["", "short", "-ZC-2026-ABCD", "ZC_2026_ABCD", "ZC-2026-ABCD-", "Я-2026-ABCD-EFGH", null]) {
    assert.equal(normalizeLicenseKey(bad), "");
  }
  const license = licenseFromResponse({ active: true, plan: "month", expiresAt: "2027-01-01T00:00:00Z" }, "ZC-2026-ABCD-EFGH", start);
  assert.deepEqual(license, { key: "ZC-2026-ABCD-EFGH", plan: "month", active: true, expiresAt: "2027-01-01T00:00:00.000Z", checkedAt: iso(start) });
  for (const payload of [null, {}, { active: "yes", plan: "month", expiresAt: "2027-01-01T00:00:00Z" },
    { active: true, plan: "week", expiresAt: "2027-01-01T00:00:00Z" }, { active: true, plan: "year", expiresAt: "soon" }]) {
    assert.throws(() => licenseFromResponse(payload, "ZC-2026-ABCD-EFGH", start), /Сервис подписки/);
  }
  assert.throws(() => licenseFromResponse({ active: true, plan: "year", expiresAt: "2027-01-01T00:00:00Z" }, "bad", start));
});

test("stored subscription data is cleaned before use", () => {
  for (const value of [null, "text", 42, [], { trialStartedAt: "never", lastSeenAt: 5, license: { key: "x" } }]) {
    assert.deepEqual(normalizeSubscription(value), { trialStartedAt: null, lastSeenAt: null, license: null });
  }
});

test("checkout opens the website with the chosen plan", () => {
  assert.equal(checkoutUrl("month"), "https://zamer-cad.netlify.app/?buy=month");
  assert.equal(checkoutUrl("year"), "https://zamer-cad.netlify.app/?buy=year");
  assert.equal(checkoutUrl("javascript:alert(1)"), "https://zamer-cad.netlify.app/?buy=year");
});

// Zamer CAD Pro: 14 days free, then a paid subscription. Pure helpers, no DOM.
//
// Payments are not connected yet, so BILLING.enabled is false: the app works
// as before and the trial does not start. Switch it on once a payment service
// and the license service behind licenseUrl are live. Checkout always opens
// the website (siteUrl + ?buy=month|year), so changing the payment service
// does not need an app update.

export const BILLING = Object.freeze({
  enabled: false,
  trialDays: 14,
  siteUrl: "https://zamer-cad.netlify.app/",
  licenseUrl: "https://zamer-cad.netlify.app/api/license",
  plans: Object.freeze([
    Object.freeze({ id: "year", title: "Год", price: "$59", note: "≈ $4,92 в месяц · экономия 30%" }),
    Object.freeze({ id: "month", title: "Месяц", price: "$7", note: "Отменить можно в любой момент" }),
  ]),
});

// What needs Pro after the trial. Opening and editing drawings and the .zamer
// backup stay free, so nobody loses access to their own work.
export const PRO_FEATURES = Object.freeze({
  export: "Экспорт в PDF, DWG и DXF",
  newProject: "Новые проекты",
  importCad: "Открытие DWG и DXF",
});

const DAY = 86400000;
const LICENSE_RECHECK_MS = 3 * DAY;
// A paid period stays open this long after its end while the renewal reaches
// the license service, and while the phone is offline.
const LICENSE_GRACE_MS = 3 * DAY;
const PLANS = new Set(["month", "year"]);

function time(value) {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

function isoOrNull(value) {
  const ms = time(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function normalizeLicenseKey(value) {
  const key = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9][A-Z0-9-]{6,62}[A-Z0-9]$/.test(key) ? key : "";
}

function normalizeLicense(value) {
  if (!value || typeof value !== "object") return null;
  const key = normalizeLicenseKey(value.key);
  const expiresAt = isoOrNull(value.expiresAt);
  const checkedAt = isoOrNull(value.checkedAt);
  if (!key || !PLANS.has(value.plan) || !expiresAt || !checkedAt) return null;
  return { key, plan: value.plan, active: value.active === true, expiresAt, checkedAt };
}

export function normalizeSubscription(value) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    trialStartedAt: isoOrNull(record.trialStartedAt),
    lastSeenAt: isoOrNull(record.lastSeenAt),
    license: normalizeLicense(record.license),
  };
}

// Starts the trial on the first launch after payments are switched on and
// keeps the latest time seen, so turning the phone clock back does not extend it.
export function touchSubscription(value, now, config = BILLING) {
  const record = normalizeSubscription(value);
  const seen = Math.max(now, time(record.lastSeenAt) || 0);
  return {
    ...record,
    trialStartedAt: record.trialStartedAt || (config.enabled ? new Date(now).toISOString() : null),
    lastSeenAt: new Date(seen).toISOString(),
  };
}

// free — payments are off; trial — days left; pro — paid; expired — trial or
// subscription is over.
export function subscriptionStatus(value, now, config = BILLING) {
  if (!config.enabled) return { kind: "free" };
  const record = normalizeSubscription(value);
  const at = Math.max(now, time(record.lastSeenAt) || 0);
  const { license } = record;
  if (license?.active && time(license.expiresAt) + LICENSE_GRACE_MS > at) {
    return { kind: "pro", plan: license.plan, expiresAt: license.expiresAt };
  }
  const started = time(record.trialStartedAt);
  const daysLeft = Math.ceil(((Number.isFinite(started) ? started : at) + config.trialDays * DAY - at) / DAY);
  if (daysLeft > 0) return { kind: "trial", daysLeft: Math.min(daysLeft, config.trialDays) };
  return { kind: "expired", hadLicense: Boolean(license) };
}

export function canUseFeature(status, feature) {
  return status.kind !== "expired" || !Object.prototype.hasOwnProperty.call(PRO_FEATURES, feature);
}

export function needsLicenseCheck(value, now) {
  const { license } = normalizeSubscription(value);
  if (!license) return false;
  return now - time(license.checkedAt) >= LICENSE_RECHECK_MS || time(license.expiresAt) <= now + DAY;
}

// The license service answers { active, plan, expiresAt }.
export function licenseFromResponse(payload, key, now) {
  const license = normalizeLicense({ ...payload, key, checkedAt: new Date(now).toISOString() });
  if (!license || typeof payload?.active !== "boolean") {
    throw new Error("Сервис подписки ответил непонятно. Попробуйте позже.");
  }
  return license;
}

export function checkoutUrl(plan, config = BILLING) {
  return `${config.siteUrl}?buy=${plan === "month" ? "month" : "year"}`;
}

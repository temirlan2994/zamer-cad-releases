// Необязательные пользовательские решения. Геометрия остаётся в обычной модели.
export const CONCEPT_VERSION = 1;
export const COST_CATEGORIES = Object.freeze([
  ['foundation', 'Фундамент', 'м³'], ['walls', 'Стены', 'м³'],
  ['slabs', 'Перекрытия', 'м³'], ['roof', 'Кровля', 'м²'],
  ['glazing', 'Остекление', 'м²'], ['doors', 'Двери', 'шт'],
  ['finish', 'Отделка', 'м²'], ['engineering', 'Инженерные системы', 'м²'],
  ['landscape', 'Благоустройство', 'компл.'],
]);
export const CONSTRUCTION_SYSTEMS = Object.freeze({
  unknown: 'Не выбрана', masonry: 'Каменные стены', frame: 'Каркас', concrete: 'Железобетонный каркас', timber: 'Деревянные стены',
});
export const CONCEPT_STAGES = Object.freeze([
  ['overview', 'Готовность'], ['variants', 'Варианты'], ['budget', 'Бюджет'],
  ['construction', 'Конструкции'], ['rules', 'Правила'], ['review', 'Согласование'], ['handoff', 'Передача'],
]);
export const finite = (value) => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
export const cleanText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const nonnegative = (value) => { const n = finite(value); return n != null && n >= 0 ? n : null; };

export function normalizeBudget(raw) {
  const source = object(raw), rates = object(source.rates);
  return {
    region: cleanText(source.region, 120), currency: /^[A-Z]{3}$/.test(source.currency) ? source.currency : 'KGS',
    date: /^\d{4}-\d{2}-\d{2}$/.test(source.date) && Number.isFinite(Date.parse(source.date)) && new Date(source.date).toISOString().slice(0,10) === source.date ? source.date : '',
    source: cleanText(source.source, 1000), target: nonnegative(source.target),
    lowPercent: Math.min(100, nonnegative(source.lowPercent) ?? 10),
    highPercent: Math.min(200, nonnegative(source.highPercent) ?? 25),
    rates: Object.fromEntries(COST_CATEGORIES.map(([id]) => [id, nonnegative(rates[id])])),
    notes: cleanText(source.notes, 2000),
  };
}

export function normalizeConstruction(raw) {
  const source = object(raw);
  return {
    system: Object.hasOwn(CONSTRUCTION_SYSTEMS, source.system) ? source.system : 'unknown',
    layers: (Array.isArray(source.layers) ? source.layers : []).slice(0, 20).map((layer) => ({
      material: cleanText(layer?.material, 120), thickness: Math.min(2000, nonnegative(layer?.thickness) ?? 0),
      bearing: layer?.bearing === true,
    })).filter((layer) => layer.material && layer.thickness > 0),
    soil: cleanText(source.soil, 500), engineer: cleanText(source.engineer, 120),
    source: cleanText(source.source, 1000), notes: cleanText(source.notes, 2000),
    maxSpan: nonnegative(source.maxSpan), minHeadroom: nonnegative(source.minHeadroom) ?? 2000,
  };
}

const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reviewRef = (entry) => entry && typeof entry.id === 'string' && /^review[a-z0-9_-]+$/i.test(entry.id) && validDigest(entry.digest);
const boundedList = (value, limit, valid) => (Array.isArray(value) ? value : []).filter(valid).slice(-limit);

export function normalizeConcept(raw) {
  const source = object(raw);
  return { ...source, version: CONCEPT_VERSION,
    projectId: typeof source.projectId === 'string' ? cleanText(source.projectId, 120) : null,
    selectedVariantId: typeof source.selectedVariantId === 'string' ? cleanText(source.selectedVariantId, 100) : null,
    reviewSnapshots: boundedList(source.reviewSnapshots, 10, (entry) => reviewRef(entry) && entry.schema === 'kepler-review/1' && entry.project && typeof entry.project === 'object' && !Array.isArray(entry.project)),
    reviewSnapshotRefs: boundedList(source.reviewSnapshotRefs, 500, reviewRef),
    integrationVerifications: boundedList(source.integrationVerifications, 20, (entry) => entry && entry.schema === 'kepler-revit-report/1' && validDigest(entry.digest) && typeof entry.revitVersion === 'string' && Array.isArray(entry.warnings)),
    activeVariantId: cleanText(source.activeVariantId, 100) || null,
    budget: normalizeBudget(source.budget), construction: normalizeConstruction(source.construction),
    regulations: object(source.regulations),
    decisions: boundedList(source.decisions, 500, (entry) => entry && typeof entry.id === 'string' && typeof entry.snapshotId === 'string' && validDigest(entry.digest) && ['comment','approve','revise'].includes(entry.action) && typeof entry.author === 'string' && typeof entry.message === 'string'),
    shares: boundedList(source.shares, 100, (entry) => entry && /^[a-f0-9]{64}$/.test(entry.id || '') && typeof entry.ownerUid === 'string' && typeof entry.url === 'string' && validDigest(entry.digest)),
  };
}

export function ensureConcept(project) {
  project.concept = normalizeConcept(project.concept);
  project.concept.projectId ||= `concept-${globalThis.crypto.randomUUID()}`;
  return project.concept;
}

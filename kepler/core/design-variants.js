import { attachLevelAccessors, makeId, projectFromData } from './model.js';
import { cleanText, ensureConcept } from './concept-data.js';

const HOUSE_KEYS = Object.freeze(['levels', 'activeLevel', 'building', 'envelope', 'settings', 'masses', 'massVoids', 'roofs', 'grids', 'views', 'sheets']);
const SHARED_BRIEF = new Set(['version', 'actors', 'capacity', 'homeProgram', 'storageInventory', 'scenarioSelections']);

export function captureHouse(project) {
  const house = {};
  for (const key of HOUSE_KEYS) if (project[key] !== undefined) house[key] = structuredClone(project[key]);
  house.layoutBindings = Object.fromEntries(Object.entries(project.layoutBrief || {}).filter(([key]) => !SHARED_BRIEF.has(key)).map(([key, value]) => [key, structuredClone(value)]));
  house.conceptDesign = { budget: structuredClone(project.concept?.budget || {}), construction: structuredClone(project.concept?.construction || {}) };
  return house;
}

export function designVariants(project) {
  return (project.variants || []).filter((variant) => variant?.id && Array.isArray(variant.house?.levels));
}

export function saveActiveVariant(project) {
  const variant = designVariants(project).find((entry) => entry.id === project.concept?.activeVariantId);
  if (variant) variant.house = captureHouse(project);
}

export function createDesignVariant(project, name, { now = new Date().toISOString() } = {}) {
  const concept = ensureConcept(project);
  saveActiveVariant(project);
  if (!Array.isArray(project.variants)) project.variants = [];
  if (!designVariants(project).length) {
    const original = { id: makeId('variant'), name: 'Исходный вариант', createdAt: now, house: captureHouse(project) };
    project.variants.push(original); concept.activeVariantId = original.id;
  }
  const variant = { id: makeId('variant'), name: cleanText(name, 120) || `Вариант ${designVariants(project).length+1}`, createdAt: now, house: captureHouse(project) };
  project.variants.push(variant); concept.activeVariantId = variant.id;
  return variant;
}

export function projectForVariant(project, id) {
  const variant = designVariants(project).find((entry) => entry.id === id);
  if (!variant) throw new Error('Вариант не найден');
  const house = id === project.concept?.activeVariantId ? captureHouse(project) : variant.house;
  const raw = { schema: project.schema, name: project.name, site: structuredClone(project.site), variants: [], ...structuredClone(house),
    layoutBrief: { ...Object.fromEntries(Object.entries(project.layoutBrief || {}).filter(([key]) => SHARED_BRIEF.has(key))), ...structuredClone(house.layoutBindings || {}) },
    concept: { projectId: project.concept?.projectId, regulations: structuredClone(project.concept?.regulations || {}), activeVariantId: null, ...structuredClone(house.conceptDesign || {}) },
  };
  delete raw.layoutBindings; delete raw.conceptDesign;
  return projectFromData(raw);
}

export function activateDesignVariant(project, id) {
  if (id === project.concept?.activeVariantId) return false;
  const target = projectForVariant(project, id); // Проверить до изменения исходного проекта.
  saveActiveVariant(project);
  for (const key of HOUSE_KEYS) {
    if (target[key] === undefined) delete project[key]; else project[key] = target[key];
  }
  if (target.layoutBrief) project.layoutBrief = target.layoutBrief; else delete project.layoutBrief;
  Object.assign(ensureConcept(project), { activeVariantId: id, budget: target.concept?.budget, construction: target.concept?.construction });
  attachLevelAccessors(project);
  return true;
}

export function renameDesignVariant(project, id, name) {
  const variant = designVariants(project).find((entry) => entry.id === id);
  const value = cleanText(name, 120);
  if (!variant || !value) throw new Error('Укажите название существующего варианта');
  variant.name = value;
}

export function deleteDesignVariant(project, id) {
  if (project.concept?.activeVariantId === id) throw new Error('Сначала переключитесь на другой вариант');
  if (!designVariants(project).some((entry) => entry.id === id)) throw new Error('Вариант не найден');
  project.variants = project.variants.filter((entry) => entry.id !== id);
  if (project.concept?.selectedVariantId === id) project.concept.selectedVariantId = null;
}

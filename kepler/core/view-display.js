// Отображение и освещение вида — у каждого вида свои (как «Свойства вида» в
// Revit): план каждого этажа, «Участок», «Ландшафт». Хранятся в проекте,
// project.viewDisplay[viewId], — только отличия от умолчаний; нет записи —
// умолчания (старые проекты без миграции).
//
//   rooms   — помещения: 'color' (цвет по типу) | 'gray' (серые, как на
//             презентационном плане);
//   shadows — тени от стен и мебели (план этажа);
//   light   — откуда свет для этих теней: 'sun' — солнце или север участка
//             (как тени ландшафта), 'fixed' — условный, тени вверх-влево;
//   length  — длина теней: 'short' | 'medium' | 'long';
//   sunShadow — тень дома по солнцу (инсоляция), когда на участке включено солнце.

export const VIEW_DISPLAY_DEFAULT = Object.freeze({
  rooms: 'color', shadows: true, light: 'sun', length: 'medium', sunShadow: true,
});

const CHOICES = {
  rooms: ['color', 'gray'],
  light: ['sun', 'fixed'],
  length: ['short', 'medium', 'long'],
};
const FLAGS = ['shadows', 'sunShadow'];

// Множитель длины теней.
export const SHADOW_LENGTH_K = Object.freeze({ short: 0.6, medium: 1, long: 1.6 });

// Условный свет: тени вверх-влево (в осях дома).
export const FIXED_SHADOW_DIR = Object.freeze({ x: -0.6, y: -0.8 });

export function normalizeViewDisplay(v) {
  const out = { ...VIEW_DISPLAY_DEFAULT };
  for (const [key, list] of Object.entries(CHOICES)) if (list.includes(v?.[key])) out[key] = v[key];
  for (const key of FLAGS) if (typeof v?.[key] === 'boolean') out[key] = v[key];
  return out;
}

// Вид режима: «План» — план активного этажа; «Участок», «Ландшафт» — свои.
export function viewIdOf(project, modeName = 'plan') {
  if (modeName === 'site' || modeName === 'landscape') return modeName;
  return `plan:${project?.activeLevel}`;
}

export function viewDisplay(project, viewId) {
  return normalizeViewDisplay(project?.viewDisplay?.[viewId]);
}

// Меняет настройки вида: в проекте остаются только отличия от умолчаний.
export function setViewDisplay(project, viewId, patch) {
  const next = normalizeViewDisplay({ ...viewDisplay(project, viewId), ...patch });
  const diff = {};
  for (const key of Object.keys(VIEW_DISPLAY_DEFAULT)) if (next[key] !== VIEW_DISPLAY_DEFAULT[key]) diff[key] = next[key];
  const all = { ...(project.viewDisplay || {}) };
  if (Object.keys(diff).length) all[viewId] = diff;
  else delete all[viewId];
  if (Object.keys(all).length) project.viewDisplay = all;
  else delete project.viewDisplay;
  return next;
}

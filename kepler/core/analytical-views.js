// Производные аналитические виды плана. Они не записываются в файл проекта:
// набор всегда заново строится по существующим этажам, как планы этажей.

export const FLOOR_ANALYTICAL_DEFS = Object.freeze([
  Object.freeze({ analysis: 'layout', title: 'Планировка', icon: 'plan' }),
  Object.freeze({ analysis: 'ergonomics', title: 'Эргономика', icon: 'ergonomics' }),
  Object.freeze({ analysis: 'circulation', title: 'Движение', icon: 'circulation' }),
  Object.freeze({ analysis: 'light', title: 'Освещение', icon: 'light' }),
  Object.freeze({ analysis: 'engineering', title: 'Инженерия', icon: 'engineering' }),
]);

const DEFINITION_BY_KIND = new Map(FLOOR_ANALYTICAL_DEFS.map((item) => [item.analysis, item]));

export function floorAnalyticalViewId(analysis, levelId) {
  if (!DEFINITION_BY_KIND.has(analysis) || !String(levelId || '')) return null;
  return `analysis:${analysis}:${encodeURIComponent(String(levelId))}`;
}

export function parseFloorAnalyticalViewId(value) {
  const match = /^analysis:([^:]+):(.+)$/.exec(String(value || ''));
  if (!match || !DEFINITION_BY_KIND.has(match[1])) return null;
  try {
    const levelId = decodeURIComponent(match[2]);
    return levelId ? { analysis: match[1], levelId } : null;
  } catch {
    return null;
  }
}

export function floorAnalyticalViews(project, levels = project?.levels || []) {
  const available = new Set((project?.levels || []).map((level) => String(level.id)));
  return FLOOR_ANALYTICAL_DEFS.flatMap((definition) => levels
    .filter((level) => available.has(String(level.id)))
    .map((level) => ({
      ...definition,
      id: floorAnalyticalViewId(definition.analysis, level.id),
      levelId: String(level.id),
      levelName: level.name || 'Этаж',
      title: `${definition.title} · ${level.name || 'Этаж'}`,
    })));
}

export function floorAnalyticalViewById(project, id) {
  const parsed = parseFloorAnalyticalViewId(id);
  if (!parsed) return null;
  const level = (project?.levels || []).find((item) => String(item.id) === parsed.levelId);
  const definition = DEFINITION_BY_KIND.get(parsed.analysis);
  if (!level || !definition) return null;
  return {
    ...definition,
    id: floorAnalyticalViewId(parsed.analysis, parsed.levelId),
    levelId: parsed.levelId,
    levelName: level.name || 'Этаж',
    title: `${definition.title} · ${level.name || 'Этаж'}`,
  };
}

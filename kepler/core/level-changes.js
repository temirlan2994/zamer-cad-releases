import { setLevelTallWindowOffsets, sortedLevels } from './model.js';
import { syncStairLevels } from './slab-openings.js';
import { setStairRise } from './stairs.js';
import { syncFacadeHosts } from './facade.js';

// Одна атомарная операция для отметок: высота этажа не оставляет верхние
// этажи, связанные лестницы и фасадные элементы на прежних отметках.
export function changeLevelGeometry(project, id, patch, { moveAbove = project.settings?.linkLevelElevations !== false } = {}) {
  const levels = sortedLevels(project), index = levels.findIndex((level) => level.id === id);
  if (index < 0) throw new Error('Этаж не найден');
  const level = levels[index];
  const next = { elevation: level.elevation, height: level.height, slabThickness: level.slabThickness, ...patch };
  for (const key of ['elevation', 'height', 'slabThickness']) {
    if (!Number.isFinite(next[key])) throw new Error('Размер этажа должен быть конечным числом');
  }
  if (next.height < 2000 || next.height > 20000 || next.slabThickness < 120 || next.slabThickness > 600) throw new Error('Высота этажа: 2000–20000 мм; перекрытие: 120–600 мм');
  const shift = next.elevation-level.elevation+next.height-level.height;
  const plan = levels.map((entry, i) => ({ level: entry, elevation: i === index ? next.elevation : entry.elevation+(moveAbove && i > index ? shift : 0) }));
  if (plan.some((entry, i) => Math.abs(entry.elevation) > 1e6 || (i && entry.elevation <= plan[i-1].elevation))) throw new Error('Отметки этажей должны возрастать');
  Object.assign(level, next);
  for (const entry of plan) entry.level.elevation = entry.elevation;
  setLevelTallWindowOffsets(level, { top: level.tallWindowTopOffset, bottom: level.tallWindowBottomOffset });
  const stairs = syncStairLevels(project, setStairRise);
  const detached = syncFacadeHosts(project);
  return { moved: plan.filter((entry) => entry.level.id !== id && moveAbove && levels.indexOf(entry.level) > index && shift).map((entry) => entry.level.id), stairs, detached: [...detached] };
}

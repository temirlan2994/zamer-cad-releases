import { cleanText, finite } from './concept-data.js';
import { levelProject, roomCeiling } from './model.js';
import { roomNetAreaM2 } from './rooms.js';
import { roomRects } from './room-shape.js';
import { roomType } from './catalog.js';
import { levelWindowOpenings } from './spanning-windows.js';
import { openingHeight } from './opening-preset.js';
import { isGlazing } from './glazed-openings.js';
import { deriveWalls, openingOwnerId } from './walls.js';

export const REGULATION_PROFILES = Object.freeze({
  concept: 'Эскизные ориентиры', 'RU-SP55': 'РФ · СП 55.13330.2016 (справочный)',
  KG: 'Кыргызстан · требуется подтверждённый профиль', custom: 'Пользовательский профиль',
});
export const REGULATION_LIMITS = Object.freeze([
  ['livingArea', 'Минимум гостиной, м²', 12], ['bedroomArea', 'Минимум спальни, м²', 8],
  ['kitchenArea', 'Минимум кухни, м²', 6], ['ceiling', 'Чистая высота, мм', 2500],
  ['corridorWidth', 'Ширина коридора, мм', 850], ['daylightRatio', 'Окна / площадь пола', .125],
]);

export function normalizeRegulations(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const profile = Object.hasOwn(REGULATION_PROFILES, source.profile) ? source.profile : 'concept';
  const limits = {};
  for (const [key, _label, fallback] of REGULATION_LIMITS) {
    const value = finite(source.limits?.[key]);
    limits[key] = value != null && value > 0 ? value : profile === 'concept' || profile === 'RU-SP55' ? fallback : null;
  }
  return { profile, region: cleanText(source.region, 120), title: cleanText(source.title, 200),
    source: cleanText(source.source, 1500), revision: cleanText(source.revision, 120),
    scope: cleanText(source.scope, 1000), confirmedBy: cleanText(source.confirmedBy, 120),
    confirmedAt: cleanText(source.confirmedAt, 30), limits };
}

export function regulationContext(project) {
  const config = normalizeRegulations(project.concept?.regulations);
  const reference = ['concept', 'RU-SP55'].includes(config.profile);
  const missing = config.profile === 'custom' ? ['region','title','source','revision','scope','confirmedBy','confirmedAt'].filter((key) => !config[key]) : [];
  return { config, reference, missing, applicable: config.profile === 'custom' && !missing.length };
}

export function analyzeRegulations(project) {
  const { config, reference, missing, applicable } = regulationContext(project);
  const checks = [];
  for (const level of project.levels || []) {
    const lp = levelProject(project, level.id), walls = deriveWalls(lp), openings = levelWindowOpenings(lp, walls);
    for (const room of level.rooms) {
      const living = roomType(room.type)?.living === true, kitchen = ['kitchen', 'kitchen-living'].includes(room.type);
      const area = roomNetAreaM2(lp, room), rects = roomRects(room);
      const areaKey = ['living', 'kitchen-living'].includes(room.type) ? 'livingArea' : living ? 'bedroomArea' : kitchen ? 'kitchenArea' : null;
      const values = [];
      if (areaKey) values.push([areaKey, area, 'м²']);
      if (living || kitchen) {
        values.push(['ceiling', roomCeiling(room, level), 'мм']);
        const glass = openings.filter((opening) => isGlazing(opening) && openingOwnerId(lp, opening, walls) === room.id)
          .reduce((sum, opening) => sum+opening.width*openingHeight(opening, level)/1e6, 0);
        values.push(['daylightRatio', area > 0 ? glass/area : null, 'доля']);
      }
      if (room.type === 'corridor') values.push(['corridorWidth', Math.max(...rects.map((rect) => Math.min(rect.w, rect.h))), 'мм']);
      for (const [key, actual, unit] of values) {
        const limit = config.limits[key], known = actual != null && limit != null;
        const satisfies = known && actual+1e-9 >= limit;
        checks.push({ id: `${level.id}/${room.id}/${key}`, key, roomId: room.id, roomName: room.name, levelId: level.id, actual, limit, unit,
          status: !known || (!reference && !applicable) ? 'unknown' : reference ? satisfies ? 'reference_pass' : 'reference_fail' : satisfies ? 'pass' : 'fail' });
      }
    }
  }
  const failed = checks.filter((check) => check.status === 'fail'), unknown = checks.filter((check) => check.status === 'unknown');
  return { config, checks, applicable, missing, reference,
    status: failed.length ? 'blocked' : !checks.length || unknown.length || !applicable ? 'unknown' : 'checked',
    scope: reference ? 'Справочные ориентиры. Они не подтверждают соответствие местным нормам.'
      : config.profile === 'KG' ? 'Применимость нормативов Кыргызстана не подтверждена. Подключите проверенный пользовательский профиль.'
        : applicable ? `Проверка только по введённым порогам профиля «${config.title}», подтверждённого пользователем ${config.confirmedBy}.`
          : 'Не хватает источника, редакции, области применения или подтверждения профиля.',
  };
}

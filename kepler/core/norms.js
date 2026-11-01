// Проверка норм для одноквартирного дома. Чистый модуль без DOM.
//
// Ориентир — СП 55.13330.2016 «Дома жилые одноквартирные» (РФ):
//   площадь не менее: гостиная 12 м², спальня 8 м², кухня 6 м²;
//   ширина не менее: кухня 1,7 м, передняя (холл) 1,4 м, коридор 0,85 м,
//     ванная (санузел) 1,5 м;
//   естественный свет: окна жилых комнат и кухни — не меньше 1:8 площади пола;
//   высота жилых комнат и кухни от пола до потолка — не менее 2,5 м
//     (своя высота комнаты или высота этажа минус перекрытие 0,3 м).
// Плюс инсоляция (core/insolation.js) и проходы у мебели (core/clearance.js).
// Это подсказка для концепции, а не экспертиза проекта.

import { roomType } from './catalog.js';
import { furnitureIssues } from './clearance.js';
import { insolationReport } from './insolation.js';
import { DEFAULT_SLAB, levelProject, roomCeiling, sortedLevels } from './model.js';
import { roomNetAreaM2 } from './rooms.js';
import { LIVING_TYPES } from './schedule.js';
import { deriveWalls } from './walls.js';

export const SP55 = {
  minArea: { living: 12, bedroom: 8, 'master-bedroom': 8, kitchen: 6 },
  minWidth: { kitchen: 1700, hall: 1400, corridor: 850, bathroom: 1500 },
  lightTypes: new Set([...LIVING_TYPES, 'kitchen']),
  lightRatio: 1 / 8,
  minClearHeight: 2500,
  slab: DEFAULT_SLAB,
};

const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');

// Проверки одной комнаты: [{ kind, ok, text }].
export function roomChecks(project, room, level) {
  const out = [];
  const title = roomType(room.type)?.title || room.name;
  const area = roomNetAreaM2(project, room);
  const minArea = SP55.minArea[room.type];
  if (minArea) {
    out.push({
      kind: 'area', ok: area >= minArea - 1e-9,
      text: `Площадь ${fmt(area)} м² ${area >= minArea - 1e-9 ? '≥' : '<'} ${minArea} м² (${title.toLowerCase()})`,
    });
  }
  const minWidth = SP55.minWidth[room.type];
  if (minWidth) {
    const width = Math.min(room.w, room.h);
    out.push({
      kind: 'width', ok: width >= minWidth,
      text: `Ширина ${fmt(width / 1000, 2)} м ${width >= minWidth ? '≥' : '<'} ${fmt(minWidth / 1000, 2)} м`,
    });
  }
  if (SP55.lightTypes.has(room.type) && area > 0) {
    const glass = project.openings
      .filter((o) => o.kind === 'window' && o.roomId === room.id)
      .reduce((s, o) => s + (o.width * (o.height ?? 1500)) / 1e6, 0);
    const ok = glass / area >= SP55.lightRatio - 1e-9;
    out.push({
      kind: 'light', ok,
      text: glass
        ? `Окна ${fmt(glass, 2)} м² = 1:${fmt(area / glass)} пола ${ok ? '(норма 1:8)' : '— меньше 1:8'}`
        : 'Нет окон — нужен естественный свет (окна ≥ 1:8 площади пола)',
    });
  }
  if (SP55.lightTypes.has(room.type) && level) {
    const clear = roomCeiling(room, level);
    out.push({
      kind: 'height', ok: clear >= SP55.minClearHeight,
      text: `Высота ≈ ${fmt(clear / 1000, 2)} м ${clear >= SP55.minClearHeight ? '≥' : '<'} 2,5 м`,
    });
  }
  return out;
}

// Полный отчёт: инсоляция + проверки всех комнат по этажам.
export function normsReport(project) {
  const insolation = insolationReport(project);
  const rooms = [];
  const flagged = new Set(); // мебель с замечаниями — подсветка на плане
  for (const level of sortedLevels(project)) {
    const lp = levelProject(project, level.id);
    const walls = deriveWalls(lp);
    for (const room of lp.rooms) {
      const checks = roomChecks(lp, room, level);
      for (const f of furnitureIssues(lp, room, walls)) {
        checks.push({ kind: 'furniture', ok: false, text: f.text, itemIds: f.itemIds });
        for (const id of f.itemIds) flagged.add(id);
      }
      rooms.push({ id: room.id, levelId: level.id, name: room.name, checks });
    }
  }
  const problems = rooms.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => ({ ...c, room: r })));
  return { insolation, rooms, problems, flagged, ok: insolation.ok && !problems.length };
}

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

import { isOpenRoom, isShaft, roomType } from './catalog.js';
import { furnitureIssues } from './clearance.js';
import { insolationReport } from './insolation.js';
import { DEFAULT_SLAB, levelProject, roomCeiling, sortedLevels } from './model.js';
import { rectsCycles } from './ortho-grid.js';
import { finalizeRoomOutline, roomRects } from './room-shape.js';
import { MIN_ROOM_SIZE, roomNetAreaM2 } from './rooms.js';
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

// Благоустройство участка: ориентир минимальной доли озеленения (0…1).
// Настраиваемое значение (project.settings.minGreenShare перекрывает), а не
// юридическая норма: требования зависят от ПЗЗ и местных правил.
export const LANDSCAPE_NORMS = {
  minGreenShare: 0.4,
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
    // Г/контур: ширина основной части (самый широкий из прямоугольников формы),
    // а не габарит — иначе узкий рукав маскируется широким габаритом.
    const width = Math.max(...roomRects(room).map((r) => Math.min(r.w, r.h)));
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

// Перекрывающиеся помещения — ошибка планировки (docs/walls-v2-architecture.md,
// раздел 5): в движке стен v2 стена внутри чужой комнаты не рисуется. Пары
// комнат верхнего уровня; вложенные (parentId), шахты и открытые площадки
// (терраса всегда под домом) — не перекрытие. Нижняя (раньше в массиве)
// «съедена» верхней. → [{ lower, upper, rects, areaM2 }].
export function roomOverlaps(project) {
  const list = (project.rooms || []).filter((r) => !r.parentId && !isShaft(r) && !isOpenRoom(r));
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    const ra = roomRects(a);
    for (let k = i + 1; k < list.length; k += 1) {
      const b = list[k];
      const rects = [];
      for (const p of ra) {
        for (const q of roomRects(b)) {
          const x0 = Math.max(p.x, q.x); const y0 = Math.max(p.y, q.y);
          const x1 = Math.min(p.x + p.w, q.x + q.w); const y1 = Math.min(p.y + p.h, q.y + q.h);
          if (x1 - x0 > 1 && y1 - y0 > 1) rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
      if (!rects.length) continue;
      // Нижняя — та, что раньше в массиве (её площадь «съедает» верхняя).
      const [lower, upper] = project.rooms.indexOf(a) < project.rooms.indexOf(b) ? [a, b] : [b, a];
      out.push({ lower, upper, rects, areaM2: rects.reduce((s, r) => s + r.w * r.h, 0) / 1e6 });
    }
  }
  return out;
}

// Разность прямоугольников a \ b (до четырёх кусков).
function rectMinus(a, b) {
  const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w); const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 - x0 <= 0.5 || y1 - y0 <= 0.5) return [a];
  const out = [];
  if (y0 > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: y0 - a.y });
  if (y1 < a.y + a.h) out.push({ x: a.x, y: y1, w: a.w, h: a.y + a.h - y1 });
  if (x0 > a.x) out.push({ x: a.x, y: y0, w: x0 - a.x, h: y1 - y0 });
  if (x1 < a.x + a.w) out.push({ x: x1, y: y0, w: a.x + a.w - x1, h: y1 - y0 });
  return out.filter((r) => r.w > 0.5 && r.h > 0.5);
}

// Действие «Обрезать»: нижняя комната теряет зону перекрытия (её чистая
// площадь не меняется — эта зона и так «съедена»). Получается, только если
// остаток — одна связная область без дыр и не меньше минимального размера;
// иначе false и комната не тронута.
export function trimRoomBy(room, by) {
  let rest = roomRects(room);
  for (const q of roomRects(by)) rest = rest.flatMap((r) => rectMinus(r, q));
  if (!rest.length || !rest.some((r) => r.w >= MIN_ROOM_SIZE && r.h >= MIN_ROOM_SIZE)) return false;
  const cycles = rectsCycles(rest);
  if (cycles.length !== 1 || cycles[0].area <= 0) return false;
  const pts = cycles[0].pts;
  room.outline = pts.map((p) => ({ x: p.x - room.x, y: p.y - room.y }));
  finalizeRoomOutline(room);
  return true;
}

// Полный отчёт: инсоляция + проверки всех комнат по этажам.
export function normsReport(project) {
  const insolation = insolationReport(project);
  const rooms = [];
  const overlaps = [];
  const flagged = new Set(); // мебель с замечаниями — подсветка на плане
  for (const level of sortedLevels(project)) {
    const lp = levelProject(project, level.id);
    const walls = deriveWalls(lp);
    const levelOverlaps = roomOverlaps(lp);
    for (const room of lp.rooms) {
      const checks = roomChecks(lp, room, level);
      for (const f of furnitureIssues(lp, room, walls)) {
        checks.push({ kind: 'furniture', ok: false, text: f.text, itemIds: f.itemIds });
        for (const id of f.itemIds) flagged.add(id);
      }
      // Перекрытие — одно замечание на пару, у верхней комнаты.
      for (const o of levelOverlaps.filter((q) => q.upper === room)) {
        const canTrim = trimRoomBy(structuredClone(o.lower), o.upper);
        checks.push({
          kind: 'overlap', ok: false,
          text: `Помещения «${o.lower.name}» и «${o.upper.name}» перекрываются (${fmt(o.areaM2, 2)} м²)`,
          otherId: o.lower.id, rects: o.rects,
          trim: canTrim ? { roomId: o.lower.id, byId: o.upper.id, label: `Обрезать «${o.lower.name}» по «${o.upper.name}»` } : null,
        });
      }
      rooms.push({ id: room.id, levelId: level.id, name: room.name, checks });
    }
    for (const o of levelOverlaps) overlaps.push({ levelId: level.id, lowerId: o.lower.id, upperId: o.upper.id, rects: o.rects, areaM2: o.areaM2 });
  }
  const problems = rooms.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => ({ ...c, room: r })));
  return { insolation, rooms, problems, overlaps, flagged, ok: insolation.ok && !problems.length };
}

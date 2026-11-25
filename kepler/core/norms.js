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
import { levelWindowOpenings } from './spanning-windows.js';
import { isGlazing } from './glazed-openings.js';
import { openingHeight } from './opening-preset.js';
import { roomContainsPoint, roomRects } from './room-shape.js';
import { roomNetAreaM2 } from './rooms.js';
import { eatFailText, overlapVerdicts, trimByBridge } from './v7/eat-bridge.js';
import { LIVING_TYPES } from './schedule.js';
import { deriveWalls, openingOwnerId } from './walls.js';
import { wallsInsideRooms } from './bound-rooms.js';

export const SP55 = {
  // Спальни (в т. ч. детская и гостевая) — 8 м², общая комната — 12 м²,
  // кухня — 6 м². Остальные типы — без нормы площади.
  minArea: { living: 12, bedroom: 8, 'master-bedroom': 8, 'kids-room': 8, 'guest-bedroom': 8, kitchen: 6 },
  // Санузлы (тип с wc в core/catalog.js) — по bathroomMinWidth.
  minWidth: { kitchen: 1700, hall: 1400, entrance: 1400, corridor: 850, bathroom: 1500 },
  minWidthToilet: 800, // санузел без ванны (туалет, душевая)
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

// Открытая планировка: помещения, связанные с room скрытыми общими стенами
// (кухня-гостиная, кухня-ниша). Свет и площадь кухни проверяются по зоне.
export function openPlanZone(project, room, walls) {
  const links = (walls || []).filter((w) => w.hidden && w.kind === 'shared' && w.rooms?.length === 2);
  if (!links.length) return [room];
  const ids = new Set([room.id]);
  const queue = [room.id];
  while (queue.length) {
    const id = queue.shift();
    for (const w of links) {
      const other = w.rooms[0] === id ? w.rooms[1] : w.rooms[1] === id ? w.rooms[0] : null;
      if (other && !ids.has(other)) { ids.add(other); queue.push(other); }
    }
  }
  return project.rooms.filter((r) => ids.has(r.id));
}

// Ширина санузла: с ванной — 1,5 м (ванная), без ванны — 0,8 м (туалет,
// душевая). СП 55.13330, п. 5.3 (по аналогии с СП 54).
function bathroomMinWidth(project, room) {
  const hasBath = (project.items || []).some((it) => it.kind === 'bath' && roomContainsPoint(room, it.x, it.y));
  return hasBath ? SP55.minWidth.bathroom : SP55.minWidthToilet;
}

const windowGlass = (project, roomId, walls, openings) => {
  const hosted = openings.some((o) => isGlazing(o) && o.host);
  const w = hosted ? (walls || deriveWalls(project)) : null;
  return openings
    .filter((o) => isGlazing(o) && (o.host ? openingOwnerId(project, o, w) : o.roomId) === roomId)
    .reduce((s, o) => s + (o.width * openingHeight(o, project.levels?.find((l) => l.id === project.activeLevel))) / 1e6, 0);
};

// Проверки одной комнаты: [{ kind, ok, text }].
// Свет и высота — только жилые комнаты и кухня (SP55.lightTypes); площадь
// и ширина — только типы из SP55.minArea / minWidth: служебные помещения
// (санузел без ванны, гардеробная, кладовая, лестница, шахта, терраса) —
// без ложных замечаний.
export function roomChecks(project, room, level, walls = null, options = {}) {
  const out = [];
  const kinds = options.kinds instanceof Set ? options.kinds : null;
  const wants = (kind) => !kinds || kinds.has(kind);
  const title = roomType(room.type)?.title || room.name;
  const area = roomNetAreaM2(project, room);
  const needWalls = wants('light') && !walls && (room.type === 'kitchen' || SP55.lightTypes.has(room.type));
  const zone = room.parentId || isShaft(room) ? [room] : openPlanZone(project, room, walls || (needWalls ? deriveWalls(project) : null));
  // Кухня в открытой планировке с гостиной (кухня-ниша) — площадь по зоне.
  const kitchenNiche = room.type === 'kitchen' && zone.some((r) => r.type === 'living' || r.type === 'kitchen-living');
  const minArea = kitchenNiche ? 0 : SP55.minArea[room.type];
  if (wants('area') && minArea) {
    out.push({
      kind: 'area', ok: area >= minArea - 1e-9,
      text: `Площадь ${fmt(area)} м² ${area >= minArea - 1e-9 ? '≥' : '<'} ${minArea} м² (${title.toLowerCase()})`,
    });
  }
  const minWidth = roomType(room.type)?.wc ? bathroomMinWidth(project, room) : SP55.minWidth[room.type];
  if (wants('width') && minWidth) {
    // Г/контур: ширина основной части (самый широкий из прямоугольников формы),
    // а не габарит — иначе узкий рукав маскируется широким габаритом.
    const width = Math.max(...roomRects(room).map((r) => Math.min(r.w, r.h)));
    out.push({
      kind: 'width', ok: width >= minWidth,
      text: `Ширина ${fmt(width / 1000, 2)} м ${width >= minWidth ? '≥' : '<'} ${fmt(minWidth / 1000, 2)} м`,
    });
  }
  if (wants('light') && SP55.lightTypes.has(room.type) && area > 0) {
    // Окна ручных стен (host) — по помещению со стороны дома (hostOpeningRoom).
    // Открытая планировка (скрытые общие стены) — свет общий: окна и
    // площадь всей зоны (кухня-ниша без своего окна у гостиной с окнами).
    const openings = options.openings || levelWindowOpenings(project, walls);
    const own = windowGlass(project, room.id, walls, openings);
    const shared = zone.length > 1;
    const glass = shared ? zone.reduce((s, r) => s + (r.id === room.id ? own : windowGlass(project, r.id, walls, openings)), 0) : own;
    const zoneArea = shared ? zone.reduce((s, r) => s + (r.id === room.id ? area : roomNetAreaM2(project, r)), 0) : area;
    const ok = zoneArea > 0 && glass / zoneArea >= SP55.lightRatio - 1e-9;
    out.push({
      kind: 'light', ok,
      text: glass
        ? `Окна ${fmt(glass, 2)} м² = 1:${fmt(zoneArea / glass)} пола${shared ? ' (общая зона)' : ''} ${ok ? '(норма 1:8)' : '— меньше 1:8'}`
        : 'Нет окон — нужен естественный свет (окна ≥ 1:8 площади пола)',
    });
  }
  if (wants('height') && SP55.lightTypes.has(room.type) && level) {
    const clear = roomCeiling(room, level);
    out.push({
      kind: 'height', ok: clear >= SP55.minClearHeight,
      text: `Высота ≈ ${fmt(clear / 1000, 2)} м ${clear >= SP55.minClearHeight ? '≥' : '<'} 2,5 м`,
    });
  }
  return out;
}

// Оставшиеся перекрытия помещений (docs/walls-v2-architecture.md, раздел 5).
// Обычно перекрытия в модели нет: комната, поставленная поверх другой,
// «съедает» её (мост v7, core/v7/eat-bridge.js) — между ними перегородка.
// Остаются только несъедаемые (нижняя целиком под верхней, распалась бы на
// части, слишком мала) и перекрытия из старых файлов. Пары комнат верхнего
// уровня; вложенные (parentId), шахты и открытые площадки (терраса всегда под
// домом) — не перекрытие. Нижняя (раньше в массиве) «съедена» верхней.
// → [{ lower, upper, rects, areaM2 }].
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

// Действие «Обрезать» (старые перекрытия): верхняя by поднимается наверх и
// съедает нижнюю room через мост v7 (зазор — толщина общей стены пары,
// проёмы на месте). Получается, только если остаток — одна связная область
// без дыр и не меньше минимального размера; иначе false, форма не тронута.
export function trimRoomBy(room, by, project) {
  return trimByBridge(project, room, by);
}

// Отчёт по этажам. Без options.enabled — полный; редактор передаёт только
// реально включённые аналитические слои, чтобы черчение оставалось быстрым.
export function normsReport(project, options = {}) {
  // Один и тот же набор стен используют окна/инсоляция и проверки комнат.
  // Раньше deriveWalls повторялся дважды на каждом этаже за один отчёт.
  const enabled = options.enabled ? new Set(options.enabled) : null;
  const on = (group) => !enabled || enabled.has(group);
  const wallsByLevel = options.wallsByLevel instanceof Map ? options.wallsByLevel : new Map();
  const requested = ['insolation', 'geometry', 'norms', 'light', 'furniture'].some(on);
  if (!requested) {
    return {
      insolation: { norm: null, rooms: [], need: 0, met: 0, ok: true, siteKnown: false, computed: false },
      rooms: [], problems: [], overlaps: [], flagged: new Set(), ok: true,
    };
  }
  const insolation = on('insolation')
    ? insolationReport(project, { ...options, wallsByLevel })
    : { norm: null, rooms: [], need: 0, met: 0, ok: true, siteKnown: false, computed: false };
  const rooms = [];
  const overlaps = [];
  const flagged = new Set(); // мебель с замечаниями — подсветка на плане
  for (const level of sortedLevels(project)) {
    const lp = levelProject(project, level.id);
    let walls = wallsByLevel.get(level.id);
    if (!walls) {
      walls = deriveWalls(lp);
      wallsByLevel.set(level.id, walls);
    }
    const levelOverlaps = on('geometry') ? roomOverlaps(lp) : [];
    const verdicts = levelOverlaps.length ? overlapVerdicts(lp, levelOverlaps) : new Map();
    // Короткая перегородка внутри комнаты допустима. Подсказка разделения
    // нужна, когда стена действительно разбивает блок на два помещения.
    const crossed = on('geometry') ? wallsInsideRooms(lp).filter((wall) => wall.divides) : [];
    // Не фильтруем два общих массива заново для каждой комнаты. На плане с
    // множеством пересечений прежний цикл мог снова вырасти почти до O(n³).
    const crossedByRoom = new Map();
    for (const entry of crossed) {
      const list = crossedByRoom.get(entry.roomId) || [];
      list.push(entry);
      crossedByRoom.set(entry.roomId, list);
    }
    const overlapsByUpper = new Map();
    for (const overlap of levelOverlaps) {
      const list = overlapsByUpper.get(overlap.upper.id) || [];
      list.push(overlap);
      overlapsByUpper.set(overlap.upper.id, list);
    }
    const normKinds = new Set();
    if (on('norms')) for (const kind of ['area', 'width', 'height']) normKinds.add(kind);
    if (on('light')) normKinds.add('light');
    const openings = normKinds.has('light') ? levelWindowOpenings(lp, walls) : null;
    for (const room of lp.rooms) {
      const checks = normKinds.size ? roomChecks(lp, room, level, walls, { kinds: normKinds, openings }) : [];
      // Ручная стена через блок-комнату (раздел 2.5): «Разделить на два».
      for (const c of crossedByRoom.get(room.id) || []) {
        checks.push({
          kind: 'wall-divides', ok: false, wallId: c.wallId,
          text: `Стена делит помещение «${room.name}»`,
          split: { roomId: room.id, wallId: c.wallId, label: `Разделить «${room.name}» на два` },
        });
      }
      for (const f of on('furniture') ? furnitureIssues(lp, room, walls) : []) {
        checks.push({ kind: 'furniture', sub: f.kind, ok: false, text: f.text, itemIds: f.itemIds });
        for (const id of f.itemIds) flagged.add(id);
      }
      // Перекрытие — одно замечание на пару, у верхней комнаты.
      for (const o of overlapsByUpper.get(room.id) || []) {
        const plan = verdicts.get(o.lower.id)?.get(o.upper.id) || { ok: false, why: 'none' };
        checks.push({
          kind: 'overlap', ok: false,
          text: plan.ok
            ? `«${o.upper.name}» лежит на «${o.lower.name}» (${fmt(o.areaM2, 2)} м²) — обрежьте «${o.lower.name}», между ними встанет перегородка`
            : eatFailText(plan.why, o.lower, o.upper, plan.child),
          otherId: o.lower.id, rects: o.rects,
          trim: plan.ok ? { roomId: o.lower.id, byId: o.upper.id, label: `Обрезать «${o.lower.name}» по «${o.upper.name}»` } : null,
        });
      }
      rooms.push({ id: room.id, levelId: level.id, name: room.name, checks });
    }
    for (const o of levelOverlaps) overlaps.push({ levelId: level.id, lowerId: o.lower.id, upperId: o.upper.id, rects: o.rects, areaM2: o.areaM2 });
  }
  const problems = rooms.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => ({ ...c, room: r })));
  return { insolation, rooms, problems, overlaps, flagged, ok: insolation.ok && !problems.length };
}

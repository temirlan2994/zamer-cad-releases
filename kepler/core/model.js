// Модель проекта Kepler Plan: создание, сериализация, идентификаторы.
// Чистый модуль без DOM. Все размеры в миллиметрах, ось Y вниз.

import { DEFAULT_PARTITION, DEFAULT_EXTERIOR, roomType } from './catalog.js';
import { SCHEMA, migrateProject, normDeg } from './migrate.js';
import { createSite, ensureSite } from './site.js';

export { SCHEMA };

let idCounter = 0;
export function makeId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createProject(name = 'Новый дом') {
  return {
    schema: SCHEMA,
    revision: 0,
    name,
    settings: {
      partition: DEFAULT_PARTITION,
      exterior: DEFAULT_EXTERIOR,
      dimOuter: true, // наружные размеры по внешней грани стен (иначе — по оси)
    },
    rooms: [],
    openings: [],
    items: [],
    wallOverrides: {}, // ключ стены -> { thickness, kind }
    viewRotation: 0, // поворот вида «Выровнять» (°, по часовой): камера, не данные
    site: createSite(),
  };
}

// Комната хранит ВНУТРЕННИЙ прямоугольник (чистые размеры помещения).
export function createRoom(type, x, y, w, h) {
  const def = roomType(type);
  return {
    id: makeId('room'),
    type,
    name: def ? def.title : type,
    x, y,
    w: w || (def ? def.w : 3000),
    h: h || (def ? def.h : 3000),
    parentId: null, // вложенное помещение (санузел внутри спальни)
  };
}

// Дверь или окно. Привязка: комната + сторона (0 верх, 1 право, 2 низ, 3 лево)
// + offset центра проёма от начала стороны (мм, вдоль канонической оси:
// горизонтальные стороны — слева направо, вертикальные — сверху вниз).
export function createOpening(kind, roomId, side, offset, width) {
  return {
    id: makeId(kind),
    kind, // 'door' | 'window'
    roomId,
    side,
    offset,
    width,
    height: kind === 'door' ? 2100 : 1500, // высота проёма, мм
    sill: kind === 'door' ? 0 : 900, // высота от пола до низа проёма, мм
    swingIn: true, // дверь открывается внутрь комнаты roomId
    hingeStart: true, // петли со стороны начала стены
  };
}

// Мебель — свободный объект: ни к какой комнате не привязана, двигается куда
// угодно. При перемещении комнаты едет всё, что фактически стоит внутри неё.
export function createItem(kind, x, y, w, h, rotation = 0) {
  return { id: makeId('item'), kind, x, y, w, h, rotation };
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

// Открытие файла любой поддерживаемой версии: разбор → миграции до текущей
// схемы (core/migrate.js) → проверка → значения по умолчанию.
export function deserializeProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Файл не является JSON-проектом Kepler Plan');
  }
  const data = migrateProject(raw);
  if (!Array.isArray(data.rooms) || !Array.isArray(data.openings) || !Array.isArray(data.items)) {
    throw new Error('Файл повреждён: нет списков rooms/openings/items');
  }
  return normalizeProject(data);
}

// Заполняет необязательные поля текущей схемы значениями по умолчанию.
export function normalizeProject(data) {
  data.name = typeof data.name === 'string' && data.name ? data.name : 'Без названия';
  data.revision = Number(data.revision) || 0;
  data.wallOverrides = data.wallOverrides || {};
  data.viewRotation = normDeg(data.viewRotation);
  data.settings = { partition: DEFAULT_PARTITION, exterior: DEFAULT_EXTERIOR, dimOuter: true, ...(data.settings || {}) };
  ensureSite(data);
  return data;
}

export function roomById(project, id) {
  return project.rooms.find((r) => r.id === id) || null;
}

export function roomChildren(project, roomId) {
  return project.rooms.filter((r) => r.parentId === roomId);
}

export function roomOpenings(project, roomId) {
  return project.openings.filter((o) => o.roomId === roomId);
}

export function removeRoom(project, roomId) {
  const doomed = new Set([roomId]);
  // Вложенные помещения удаляются вместе с родителем.
  for (const r of project.rooms) if (r.parentId === roomId) doomed.add(r.id);
  const rects = project.rooms
    .filter((r) => doomed.has(r.id))
    .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  project.rooms = project.rooms.filter((r) => !doomed.has(r.id));
  project.openings = project.openings.filter((o) => !doomed.has(o.roomId));
  // Мебель, стоявшая внутри удалённых помещений, удаляется вместе с ними.
  project.items = project.items.filter((i) => !rects.some(
    (r) => i.x >= r.x && i.x <= r.x + r.w && i.y >= r.y && i.y <= r.y + r.h,
  ));
}

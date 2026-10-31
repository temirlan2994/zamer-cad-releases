// Модель проекта Kepler Plan: создание, сериализация, идентификаторы.
// Чистый модуль без DOM. Все размеры в миллиметрах, ось Y вниз.

import { DEFAULT_PARTITION, DEFAULT_EXTERIOR, defaultChecklist, roomType } from './catalog.js';

export const SCHEMA = 'kepler-plan/1';

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
    },
    rooms: [],
    openings: [],
    items: [],
    wallOverrides: {}, // ключ стены -> { thickness, kind }
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
    checklist: defaultChecklist(type),
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
    swingIn: true, // дверь открывается внутрь комнаты roomId
    hingeStart: true, // петли со стороны начала стены
  };
}

export function createItem(kind, roomId, x, y, w, h, rotation = 0, auto = true) {
  return { id: makeId('item'), kind, roomId, x, y, w, h, rotation, auto };
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(text) {
  const data = JSON.parse(text);
  if (!data || data.schema !== SCHEMA) {
    throw new Error(`Неизвестный формат файла (ожидался ${SCHEMA})`);
  }
  if (!Array.isArray(data.rooms) || !Array.isArray(data.openings) || !Array.isArray(data.items)) {
    throw new Error('Файл повреждён: нет списков rooms/openings/items');
  }
  data.wallOverrides = data.wallOverrides || {};
  data.settings = { partition: DEFAULT_PARTITION, exterior: DEFAULT_EXTERIOR, ...(data.settings || {}) };
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

export function roomItems(project, roomId) {
  return project.items.filter((i) => i.roomId === roomId);
}

export function removeRoom(project, roomId) {
  const doomed = new Set([roomId]);
  // Вложенные помещения удаляются вместе с родителем.
  for (const r of project.rooms) if (r.parentId === roomId) doomed.add(r.id);
  project.rooms = project.rooms.filter((r) => !doomed.has(r.id));
  project.openings = project.openings.filter((o) => !doomed.has(o.roomId));
  project.items = project.items.filter((i) => !doomed.has(i.roomId));
}

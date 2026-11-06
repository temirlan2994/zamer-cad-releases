// Модель проекта Kepler Plan: создание, сериализация, идентификаторы.
// Чистый модуль без DOM. Все размеры в миллиметрах, ось Y вниз.

import { DEFAULT_BEARING, DEFAULT_PARTITION, DEFAULT_EXTERIOR, roomType } from './catalog.js';
import { SCHEMA, migrateProject, normDeg } from './migrate.js';
import { DEFAULT_ROAD_WIDTH, createSite, ensureSite } from './site.js';
import { createBuilding } from './building.js';
import { normalizeItemsComp } from './composite.js';
import { roomContainsPoint } from './room-shape.js';

export { SCHEMA };

let idCounter = 0;
export function makeId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------- Этажи
//
// Файл хранит этажи в levels[]: у каждого свои rooms, openings, items и
// wallOverrides. Редактор и вся логика плана работают с одним АКТИВНЫМ
// этажом через project.rooms / openings / items / wallOverrides — это
// скрытые свойства-аксессоры (attachLevelAccessors): в JSON их нет.

export const DEFAULT_LEVEL_HEIGHT = 3000; // от пола до пола следующего этажа, мм
export const DEFAULT_SLAB = 300; // перекрытие: чистая высота = высота этажа − плита

// Чистая высота помещения (от пола до потолка): своя или по этажу.
export function roomCeiling(room, level) {
  return room.ceiling || (level?.height ?? DEFAULT_LEVEL_HEIGHT) - DEFAULT_SLAB;
}
export const LEVEL_KEYS = ['rooms', 'openings', 'items', 'wallOverrides'];

export function createLevel(name, elevation = 0, height = DEFAULT_LEVEL_HEIGHT, id = makeId('level')) {
  return { id, name, elevation, height, rooms: [], openings: [], items: [], wallOverrides: {} };
}

export function activeLevel(project) {
  return project.levels.find((l) => l.id === project.activeLevel) || project.levels[0];
}

export function attachLevelAccessors(project) {
  for (const key of LEVEL_KEYS) {
    Object.defineProperty(project, key, {
      configurable: true,
      enumerable: false,
      get() { return activeLevel(this)[key]; },
      set(value) { activeLevel(this)[key] = value; },
    });
  }
  return project;
}

// Тот же проект «на этаже levelId»: данные общие (без копий), меняется
// только активный этаж — для экспорта и подложки соседнего этажа.
export function levelProject(project, levelId) {
  return attachLevelAccessors({ ...project, activeLevel: levelId });
}

// Этажи снизу вверх по отметке.
export function sortedLevels(project) {
  return [...project.levels].sort((a, b) => a.elevation - b.elevation);
}

export function groundLevel(project) {
  return sortedLevels(project)[0];
}

// Ближайший этаж ниже данного (или null).
export function levelBelow(project, levelId = project.activeLevel) {
  const list = sortedLevels(project);
  const i = list.findIndex((l) => l.id === levelId);
  return i > 0 ? list[i - 1] : null;
}

export function isUpperLevel(project, levelId = project.activeLevel) {
  return Boolean(project.levels?.length > 1 && groundLevel(project).id !== levelId);
}

export function createProject(name = 'Новый дом') {
  const level = createLevel('1 этаж', 0, DEFAULT_LEVEL_HEIGHT, 'L1');
  return attachLevelAccessors({
    schema: SCHEMA,
    revision: 0,
    name,
    settings: {
      partition: DEFAULT_PARTITION,
      exterior: DEFAULT_EXTERIOR,
      bearing: DEFAULT_BEARING, // внутренняя несущая стена по умолчанию
      dimOuter: true, // наружные размеры по внешней грани стен (иначе — по оси)
      units: 'mm', // подписи размеров на плане: 'mm' (5000) или 'm' (5,00)
    },
    levels: [level], // этажи: rooms, openings, items, wallOverrides (ключ стены → { thickness, kind })
    activeLevel: level.id,
    building: createBuilding(), // оси дома относительно съёмки (core/building.js)
    site: createSite(),
    variants: [], // сохранённые варианты планировки (core/variants.js)
  });
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
// Необязательное поле comp — параметры составной мебели (core/composite.js).
export function createItem(kind, x, y, w, h, rotation = 0) {
  return { id: makeId('item'), kind, x, y, w, h, rotation };
}

export function cloneProject(project) {
  return attachLevelAccessors(JSON.parse(JSON.stringify(project)));
}

// pretty: false — без отступов (автосохранение, снимки истории): в 2–3 раза короче.
export function serializeProject(project, { pretty = true } = {}) {
  return pretty ? JSON.stringify(project, null, 2) : JSON.stringify(project);
}

// Есть ли в проекте что терять: комнаты, мебель, проёмы, этажи, участок,
// ландшафт, рельеф, подложка, варианты. Пустой «Новый дом» — false.
export function hasContent(project) {
  if (!project || typeof project !== 'object') return false;
  const levels = Array.isArray(project.levels) ? project.levels : [];
  if (levels.length > 1) return true;
  if (levels.some((l) => l?.rooms?.length || l?.items?.length || l?.openings?.length)) return true;
  if (Array.isArray(project.variants) && project.variants.length) return true;
  const s = project.site;
  if (!s || typeof s !== 'object') return false;
  return Boolean(s.boundary?.length || s.redLine?.length || s.roads?.length || s.neighbors?.length
    || s.entry || s.underlay || s.terrain?.points?.length || s.landscape?.objects?.length);
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
  return projectFromData(raw);
}

// То же для уже разобранного JSON (снимки истории собираются с reviver).
export function projectFromData(raw) {
  const data = migrateProject(raw);
  const levelOk = (l) => isObj(l) && Array.isArray(l.rooms) && Array.isArray(l.openings) && Array.isArray(l.items);
  if (!Array.isArray(data.levels) || !data.levels.some(levelOk)) {
    throw new Error('Файл повреждён: нет этажей со списками rooms/openings/items');
  }
  data.levels = data.levels.filter(levelOk);
  return normalizeProject(data);
}

// ---------------------------------------------------------------- Чистка
//
// Битые элементы (null, строки, NaN-координаты) отбрасываются, числа-строки
// приводятся к числам: дальше по коду (стены, нормы, экспорт) данные
// считаются правильными, и один мусорный элемент ронял бы весь проект.

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
const str = (v) => (typeof v === 'string' && v ? v : null);

function cleanPoint(p) {
  if (!isObj(p)) return null;
  const x = num(p.x);
  const y = num(p.y);
  return x == null || y == null ? null : { ...p, x, y };
}

// Список точек; меньше min правильных — null.
function cleanPoints(list, min) {
  if (!Array.isArray(list)) return null;
  const out = list.map(cleanPoint).filter(Boolean);
  return out.length >= min ? out : null;
}

export function normalizeRoom(r) {
  if (!isObj(r)) return null;
  const x = num(r.x);
  const y = num(r.y);
  const w = pos(r.w);
  const h = pos(r.h);
  if (x == null || y == null || w == null || h == null) return null;
  const type = str(r.type) || 'living';
  const room = { ...r, id: str(r.id) || makeId('room'), type, x, y, w, h };
  if (typeof room.name !== 'string') room.name = roomType(type)?.title || type;
  if ('parentId' in room) room.parentId = str(room.parentId);
  if ('outline' in room) {
    const outline = cleanPoints(room.outline, 4);
    if (outline) room.outline = outline; else delete room.outline;
  }
  if ('notch' in room && !isObj(room.notch)) delete room.notch;
  if ('ceiling' in room) {
    const c = pos(room.ceiling);
    if (c) room.ceiling = c; else delete room.ceiling;
  }
  return room;
}

export function normalizeOpening(o) {
  if (!isObj(o) || !str(o.kind) || !str(o.roomId)) return null;
  const side = num(o.side);
  const offset = num(o.offset);
  const width = pos(o.width);
  if (side == null || !Number.isInteger(side) || side < 0 || side > 3 || offset == null || width == null) return null;
  const out = { ...o, id: str(o.id) || makeId(o.kind), side, offset, width };
  for (const key of ['height', 'sill']) {
    if (key in out) { const n = num(out[key]); if (n == null || n < 0) delete out[key]; else out[key] = n; }
  }
  return out;
}

export function normalizeItem(it) {
  if (!isObj(it) || !str(it.kind)) return null;
  const x = num(it.x);
  const y = num(it.y);
  const w = pos(it.w);
  const h = pos(it.h);
  if (x == null || y == null || w == null || h == null) return null;
  return { ...it, id: str(it.id) || makeId('item'), x, y, w, h, rotation: num(it.rotation) ?? 0 };
}

const cleanList = (list, fn) => (Array.isArray(list) ? list.map(fn).filter(Boolean) : []);

function normalizeLevelContent(l) {
  const rooms = cleanList(l.rooms, normalizeRoom);
  const ids = new Set(rooms.map((r) => r.id));
  for (const r of rooms) if (r.parentId && !ids.has(r.parentId)) r.parentId = null;
  return {
    ...l,
    rooms,
    openings: cleanList(l.openings, normalizeOpening),
    items: normalizeItemsComp(cleanList(l.items, normalizeItem)),
    wallOverrides: isObj(l.wallOverrides) ? l.wallOverrides : {},
  };
}

function cleanSite(site) {
  if (!isObj(site)) return null;
  const s = { ...site };
  s.boundary = cleanPoints(site.boundary, 3);
  s.redLine = cleanPoints(site.redLine, 2);
  s.roads = cleanList(site.roads, (r) => {
    const points = isObj(r) ? cleanPoints(r.points, 2) : null;
    return points ? { ...r, points, width: pos(r.width) ?? DEFAULT_ROAD_WIDTH } : null;
  });
  s.neighbors = cleanList(site.neighbors, (n) => {
    if (!isObj(n)) return null;
    const x = num(n.x); const y = num(n.y); const w = pos(n.w); const h = pos(n.h);
    if (x == null || y == null || w == null || h == null) return null;
    return { ...n, x, y, w, h };
  });
  const entry = cleanPoint(site.entry);
  s.entry = entry ? { ...entry, angle: num(entry.angle) ?? 0 } : null;
  s.underlay = isObj(site.underlay) ? site.underlay : null;
  for (const key of ['location', 'sun', 'norms']) if (!isObj(s[key])) delete s[key];
  for (const key of ['north', 'buildingHeight', 'setbackBoundary', 'setbackNeighbor']) {
    const n = num(s[key]);
    if (n == null) delete s[key]; else s[key] = n;
  }
  return s;
}

// Заполняет необязательные поля текущей схемы значениями по умолчанию и
// чистит содержимое этажей и участка от битых элементов.
export function normalizeProject(data) {
  data.name = typeof data.name === 'string' && data.name ? data.name : 'Без названия';
  data.revision = Number(data.revision) || 0;
  const levels = Array.isArray(data.levels) ? data.levels.filter(isObj) : [];
  data.levels = levels.map((l, i) => ({
    ...normalizeLevelContent(l),
    id: typeof l.id === 'string' && l.id ? l.id : makeId('level'),
    name: typeof l.name === 'string' && l.name ? l.name : `${i + 1} этаж`,
    elevation: Number(l.elevation) || 0,
    height: Number(l.height) > 0 ? Number(l.height) : DEFAULT_LEVEL_HEIGHT,
  }));
  if (!data.levels.length) data.levels = [createLevel('1 этаж', 0, DEFAULT_LEVEL_HEIGHT, 'L1')];
  if (!data.levels.some((l) => l.id === data.activeLevel)) data.activeLevel = data.levels[0].id;
  data.variants = Array.isArray(data.variants)
    ? data.variants.filter((v) => Array.isArray(v?.house?.levels)).map((v) => ({
      ...v, house: { ...v.house, levels: v.house.levels.filter(isObj).map(normalizeLevelContent) },
    }))
    : [];
  data.site = cleanSite(data.site);
  const b = data.building || {};
  data.building = {
    rotation: normDeg(b.rotation),
    origin: { x: Number(b.origin?.x) || 0, y: Number(b.origin?.y) || 0 },
  };
  data.settings = {
    partition: DEFAULT_PARTITION, exterior: DEFAULT_EXTERIOR, bearing: DEFAULT_BEARING,
    dimOuter: true, units: 'mm', ...(isObj(data.settings) ? data.settings : {}),
  };
  // Движок стен (core/walls.js → wallsEngine): только 'v1' | 'v2'.
  if (data.settings.wallsEngine !== 'v1' && data.settings.wallsEngine !== 'v2') delete data.settings.wallsEngine;
  ensureSite(data);
  return attachLevelAccessors(data);
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
  // Копии форм (с outline/notch): мебель соседа в вырезе Г-комнаты не трогаем.
  const shapes = project.rooms.filter((r) => doomed.has(r.id)).map((r) => ({ ...r }));
  project.rooms = project.rooms.filter((r) => !doomed.has(r.id));
  project.openings = project.openings.filter((o) => !doomed.has(o.roomId));
  // Мебель, центр которой внутри контура удалённых помещений, удаляется с ними.
  project.items = project.items.filter((i) => !shapes.some((r) => roomContainsPoint(r, i.x, i.y)));
}

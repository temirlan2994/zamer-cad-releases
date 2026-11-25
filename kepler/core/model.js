// Модель проекта Kepler Plan: создание, сериализация, идентификаторы.
// Чистый модуль без DOM. Все размеры в миллиметрах, ось Y вниз.

import { DEFAULT_BEARING, DEFAULT_PARTITION, DEFAULT_EXTERIOR, roomType } from './catalog.js';
import { SCHEMA, migrateProject, normDeg, schemaVersion } from './migrate.js';
import { DEFAULT_ROAD_WIDTH, createSite, ensureSite } from './site.js';
import { createBuilding } from './building.js';
import { normalizeItemsComp } from './composite.js';
import { roomContainsPoint } from './room-shape.js';
import { WALL_T_MAX, WALL_T_MIN } from './walls.js';
import { normalizeRailingList } from './railings.js';
import { cleanViewAngles } from './view-angles.js';
import { fileV7, isV7Data, toV6Data } from './v7/file.js';
import { reconcileEats } from './v7/eat-bridge.js';
import { SCHEMA7 } from './v7/model.js';
import { convertBoundRooms } from './bound-rooms.js';
import { normalizeViewsAndSheets } from './views.js';
import { normalizeMasses, normalizeMassVoids } from './masses.js';
import { normalizeRoofs } from './roofs.js';
import { normalizeGrids } from './grid-axes.js';
import { cleanRoomPins, cleanWallPins } from './grid-pins-model.js';
import { normalizeSlabOpenings, removeOwnedAtriums } from './slab-openings.js';
import {
  layoutBriefIsEmpty, normalizeCatalogItemMetadata, normalizeLayoutBrief,
} from './layout-brief.js';
import { createEnvelope, envelopeHasUserInput, normalizeEnvelope } from './envelope.js';

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
export const DEFAULT_TALL_WINDOW_HEIGHT = 2400; // единая высота витражей этажа
export const DEFAULT_TALL_WINDOW_TOP_OFFSET = 500; // от верха стены до витража
export const DEFAULT_TALL_WINDOW_BOTTOM_OFFSET = 100; // от пола до витража
export const MIN_TALL_WINDOW_HEIGHT = 300;

function legacyTallWindowBottom(level) {
  const opening = (level?.openings || []).find((entry) => entry?.kind === 'window'
    && entry.heightMode === 'level' && Number(entry.sill) >= 0);
  return opening ? Number(opening.sill) : DEFAULT_TALL_WINDOW_BOTTOM_OFFSET;
}

// Единый вертикальный стандарт высоких окон этажа. В старых проектах был
// только tallWindowHeight: восстанавливаем верхний отступ из прежней высоты,
// а нижний — из уже поставленного связанного витража (или из дефолта).
export function levelTallWindowOffsets(level) {
  const levelHeight = Number(level?.height) > 0 ? Number(level.height) : DEFAULT_LEVEL_HEIGHT;
  const maxOffsets = Math.max(0, levelHeight - MIN_TALL_WINDOW_HEIGHT);
  const rawBottom = Number(level?.tallWindowBottomOffset);
  const bottomDefault = legacyTallWindowBottom(level);
  const bottom = Math.min(maxOffsets, Math.max(0,
    Number.isFinite(rawBottom) && rawBottom >= 0 ? rawBottom : bottomDefault));
  const rawTop = Number(level?.tallWindowTopOffset);
  const legacyHeight = Number(level?.tallWindowHeight);
  const topDefault = Number.isFinite(legacyHeight) && legacyHeight >= MIN_TALL_WINDOW_HEIGHT
    ? levelHeight - bottom - legacyHeight : DEFAULT_TALL_WINDOW_TOP_OFFSET;
  const top = Math.min(Math.max(0, maxOffsets - bottom), Math.max(0,
    Number.isFinite(rawTop) && rawTop >= 0 ? rawTop : topDefault));
  return { top, bottom, height: Math.max(MIN_TALL_WINDOW_HEIGHT, levelHeight - top - bottom) };
}

// Записывает оба отступа как источник истины и поддерживает прежнее поле
// tallWindowHeight для старых копий приложения и старых экспортов.
export function setLevelTallWindowOffsets(level, { top, bottom } = {}) {
  if (!level || typeof level !== 'object') return null;
  const current = levelTallWindowOffsets(level);
  const levelHeight = Number(level.height) > 0 ? Number(level.height) : DEFAULT_LEVEL_HEIGHT;
  const maxOffsets = Math.max(0, levelHeight - MIN_TALL_WINDOW_HEIGHT);
  let nextTop = current.top;
  let nextBottom = current.bottom;
  // Ограничиваем именно редактируемое поле: изменение низа не должно
  // неожиданно сбрасывать уже заданный верх, и наоборот.
  if (Number.isFinite(Number(top)) && Number.isFinite(Number(bottom))) nextBottom = Math.min(maxOffsets, Math.max(0, Number(bottom)));
  if (Number.isFinite(Number(top))) nextTop = Math.min(maxOffsets - nextBottom, Math.max(0, Number(top)));
  if (Number.isFinite(Number(bottom))) nextBottom = Math.min(maxOffsets - nextTop, Math.max(0, Number(bottom)));
  const next = { top: nextTop, bottom: nextBottom, height: levelHeight - nextTop - nextBottom };
  level.tallWindowTopOffset = next.top;
  level.tallWindowBottomOffset = next.bottom;
  level.tallWindowHeight = next.height;
  return next;
}

// Чистая высота помещения (от пола до потолка): своя или по этажу.
export function roomCeiling(room, level) {
  return room.ceiling || (level?.height ?? DEFAULT_LEVEL_HEIGHT) - (level?.slabThickness ?? DEFAULT_SLAB);
}
// walls — ручные стены этажа (схема 6, core/wall-manual.js); стены комнат
// не хранятся, а выводятся (core/walls.js).
export const LEVEL_KEYS = ['rooms', 'openings', 'items', 'wallOverrides', 'walls'];

export function createLevel(name, elevation = 0, height = DEFAULT_LEVEL_HEIGHT, id = makeId('level')) {
  const tallWindowHeight = Math.max(
    MIN_TALL_WINDOW_HEIGHT,
    height - DEFAULT_TALL_WINDOW_TOP_OFFSET - DEFAULT_TALL_WINDOW_BOTTOM_OFFSET,
  );
  return {
    id, name, elevation, height, slabThickness: DEFAULT_SLAB,
    tallWindowHeight,
    tallWindowTopOffset: DEFAULT_TALL_WINDOW_TOP_OFFSET,
    tallWindowBottomOffset: DEFAULT_TALL_WINDOW_BOTTOM_OFFSET,
    rooms: [], openings: [], items: [], wallOverrides: {}, walls: [],
  };
}

// Есть ли в проекте ручные стены (на любом этаже, в т. ч. в вариантах).
export function hasManualWalls(project) {
  const inLevels = (levels) => Array.isArray(levels) && levels.some((l) => Array.isArray(l?.walls) && l.walls.length > 0);
  return inLevels(project?.levels)
    || (Array.isArray(project?.variants) && project.variants.some((v) => inLevels(v?.house?.levels)));
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

export function normalizeProjectName(value, fallback = 'Без названия') {
  const name = typeof value === 'string' ? value.trim() : '';
  return Array.from(name || fallback).slice(0, 200).join('');
}

export function createProject(name = 'Новый дом') {
  const level = createLevel('1 этаж', 0, DEFAULT_LEVEL_HEIGHT, 'L1');
  return attachLevelAccessors({
    schema: SCHEMA,
    revision: 0,
    name: normalizeProjectName(name),
    settings: {
      partition: DEFAULT_PARTITION,
      exterior: DEFAULT_EXTERIOR,
      bearing: DEFAULT_BEARING, // внутренняя несущая стена по умолчанию
      dimOuter: true, // наружные размеры по внешней грани стен (иначе — по оси)
      units: 'mm', // подписи размеров на плане: 'mm' (5000) или 'm' (5,00)
      linkTallWindowsAcrossLevels: true,
    },
    levels: [level], // этажи: rooms, openings, items, wallOverrides (ключ стены → { thickness, kind })
    activeLevel: level.id,
    building: createBuilding(), // оси дома относительно съёмки (core/building.js)
    envelope: createEnvelope(), // ±0.000, фундамент и связанная автокровля
    site: createSite(),
    variants: [], // варианты планировки из старых файлов: хранятся как есть, интерфейса нет
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
    // Обычные окна сохраняют размер пресета. Высокие/панорамные пресеты
    // переключают режим на 'level' и следуют единой высоте окон этажа.
    heightMode: kind === 'window' ? 'custom' : undefined,
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
// Пока в проекте нет ручных стен, файл пишется в формате 5 (без walls[]):
// его открывают и прежние копии приложения; v6 он эквивалентен.
export function serializeProject(project, { pretty = true } = {}) {
  const data = fileData(project);
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

export const LEGACY_SCHEMA = 'kepler-plan/5';

// Формат файла проекта — kepler-plan/7 (ядро v7, docs/v7-stage2-plan.md,
// срез 2): номинальные блоки, стены осями, проёмы на рёбрах блоков; съедание
// в файле не хранится. Старые v1–v6 открываются как раньше.
export function fileSchema() {
  return SCHEMA7;
}

function fileData(project) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.levels)) return project;
  return fileV7(project);
}

// Прежний формат (5/6) — для проверки миграций и старых копий.
export function fileDataV6(project) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.levels)) return project;
  if (hasManualWalls(project)) return { ...project, schema: SCHEMA };
  const strip = (l) => {
    if (!l || typeof l !== 'object') return l;
    const { walls: _walls, ...rest } = l;
    return rest;
  };
  const out = { ...project, schema: LEGACY_SCHEMA, levels: project.levels.map(strip) };
  if (Array.isArray(project.variants)) {
    out.variants = project.variants.map((v) => (Array.isArray(v?.house?.levels)
      ? { ...v, house: { ...v.house, levels: v.house.levels.map(strip) } } : v));
  }
  return out;
}

// Есть ли в проекте что терять: комнаты, мебель, проёмы, этажи, участок,
// ландшафт, рельеф, подложка, варианты. Пустой «Новый дом» — false.
export function hasContent(project) {
  if (!project || typeof project !== 'object') return false;
  if (project.fileHistoryId) return true;
  const levels = Array.isArray(project.levels) ? project.levels : [];
  if (levels.length > 1) return true;
  if (levels.some((l) => l?.rooms?.length || l?.walls?.length || l?.items?.length || l?.openings?.length || l?.slabOpenings?.length)) return true;
  if (Array.isArray(project.variants) && project.variants.length) return true;
  if (Array.isArray(project.masses) && project.masses.length) return true;
  if (Array.isArray(project.massVoids) && project.massVoids.length) return true;
  if (Array.isArray(project.roofs) && project.roofs.length) return true;
  if (Array.isArray(project.grids) && project.grids.length) return true;
  if (envelopeHasUserInput(project.envelope)) return true;
  // Задание и программа дома — самостоятельная работа пользователя: проект
  // должен автосохраняться ещё до появления первого помещения на плане.
  if (!layoutBriefIsEmpty(project.layoutBrief)) return true;
  const s = project.site;
  if (!s || typeof s !== 'object') return false;
  return Boolean(s.boundary?.length || s.redLine?.length || s.roads?.length || s.neighbors?.length
    || s.entry || s.entries?.length || s.underlay || s.terrain?.points?.length || s.landscape?.objects?.length
    // Явные решения в маршруте участка — тоже пользовательские данные. Даже
    // до первой линии их нельзя терять после перезапуска приложения.
    || s.planning?.withoutUnderlay || s.planning?.contextReviewed || s.planning?.flatTerrain
    || s.planning?.constraintsConfirmed || s.planning?.referenceFootprint);
}

// Открытие файла любой поддерживаемой версии: разбор → миграции до текущей
// схемы (core/migrate.js) → проверка → значения по умолчанию.
export function deserializeProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Файл не является JSON-проектом kep•ler 3D');
  }
  return projectFromData(raw, { copy: false });
}

// copy: false только для свежеразобранного JSON, которым владеет вызывающий код.
export function projectFromData(raw, { copy = true } = {}) {
  const v7 = isV7Data(raw);
  const ver = schemaVersion(raw?.schema);
  if (ver != null && ver > 7) {
    throw new Error(`Файл создан более новой версией kep•ler 3D (формат ${ver}, `
      + 'здесь поддерживается до 7). Обновите приложение.');
  }
  const data = v7
    ? migrateProject(toV6Data(raw, { copy }), { copy: false })
    : migrateProject(raw, { copy });
  const levelOk = (l) => isObj(l) && Array.isArray(l.rooms) && Array.isArray(l.openings) && Array.isArray(l.items);
  if (!Array.isArray(data.levels) || !data.levels.some(levelOk)) {
    throw new Error('Файл повреждён: нет этажей со списками rooms/openings/items');
  }
  data.levels = data.levels.filter(levelOk);
  const project = normalizeProject(data);
  // Файл v7 хранит номиналы: видимые формы съеденных — пересчётом.
  if (v7) for (const l of project.levels) reconcileEats(levelProject(project, l.id));
  return project;
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
  if (room.linkedRoof !== false) delete room.linkedRoof;
  if ('parentId' in room) room.parentId = str(room.parentId);
  if ('outline' in room) {
    const outline = cleanPoints(room.outline, 4);
    if (outline) room.outline = outline; else delete room.outline;
  }
  if ('notch' in room && !isObj(room.notch)) delete room.notch;
  // Старое «помещение по стенам»: bound { mode: 'walls', seed } + кеш контура
  // poly/holes — только вход для convertBoundRooms (normalizeProject), после
  // него таких комнат нет. Битый bound — обычная комната.
  if ('bound' in room) {
    const seed = isObj(room.bound) && room.bound.mode === 'walls' ? cleanPoint(room.bound.seed) : null;
    if (seed) {
      room.bound = { mode: 'walls', seed: { x: seed.x, y: seed.y } };
      delete room.outline;
      delete room.notch;
      const poly = cleanPoints(room.poly, 4);
      if (poly) room.poly = poly.map((p) => ({ x: p.x, y: p.y })); else delete room.poly;
      const holes = Array.isArray(room.holes) ? room.holes.map((h) => cleanPoints(h, 4)).filter(Boolean) : [];
      if (holes.length && room.poly) room.holes = holes; else delete room.holes;
    } else {
      delete room.bound; delete room.poly; delete room.holes;
    }
    if (typeof room.boundIssue !== 'string') delete room.boundIssue;
  }
  if ('ceiling' in room) {
    const c = pos(room.ceiling);
    if (c) room.ceiling = c; else delete room.ceiling;
  }
  // Перила открытого помещения (core/railings.js): битое поле — по умолчанию.
  if ('railings' in room) {
    const list = normalizeRailingList(room.railings);
    if (list) room.railings = list; else delete room.railings;
  }
  cleanRoomPins(room); // привязки граней к осям (core/grid-pins-model.js)
  return room;
}

const JUSTIFY = new Set(['center', 'left', 'right']);
const WALL_CLASSES = new Set(['exterior', 'bearing', 'partition']);

// Ручная стена (схема 6): ось — отрезок в осях дома; нулевая/битая ось —
// стена отбрасывается, толщина зажимается в [WALL_T_MIN, WALL_T_MAX].
export function normalizeWall(w) {
  if (!isObj(w) || !isObj(w.axis)) return null;
  if (w.axis.kind !== undefined && w.axis.kind !== 'line') return null; // дуги — этап F
  const a = cleanPoint(w.axis.a);
  const b = cleanPoint(w.axis.b);
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 1) return null;
  const t = num(w.thickness);
  const thickness = t != null && t > 0 ? Math.min(WALL_T_MAX, Math.max(WALL_T_MIN, Math.round(t))) : DEFAULT_PARTITION;
  const base = isObj(w.base) ? w.base : {};
  const top = isObj(w.top) ? w.top : {};
  return cleanWallPins({ // привязки к осям — core/grid-pins-model.js
    ...w,
    id: str(w.id) || makeId('wall'),
    axis: { kind: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } },
    justify: JUSTIFY.has(w.justify) ? w.justify : 'center',
    thickness,
    typeId: str(w.typeId),
    wallType: WALL_CLASSES.has(w.wallType) ? w.wallType : 'partition',
    base: { offset: num(base.offset) ?? 0 },
    top: { level: str(top.level), offset: num(top.offset) ?? 0, height: pos(top.height) },
    hidden: Boolean(w.hidden),
    roomBounding: w.roomBounding !== false,
    ...(str(w.ownerRoomId) ? { ownerRoomId: str(w.ownerRoomId) } : {}),
  });
}

// Проём на ручной стене: host { wallId, t } — t: центр проёма от axis.a, мм.
// roomId у такого проёма — null (сторона открывания — от направления оси).
function normalizeHostOpening(o) {
  const wallId = str(o.host.wallId);
  const t = num(o.host.t);
  const width = pos(o.width);
  if (!wallId || t == null || width == null) return null;
  const out = { ...o, id: str(o.id) || makeId(o.kind), roomId: null, host: { wallId, t }, width };
  delete out.side;
  delete out.offset;
  for (const key of ['height', 'sill']) {
    if (key in out) { const n = num(out[key]); if (n == null || n < 0) delete out[key]; else out[key] = n; }
  }
  normalizeOpeningHeightMode(out);
  return out;
}

const LEGACY_LINKED_WINDOW_TYPES = new Set(['panoramic', 'lift-slide', 'sliding-tall', 'french']);

function normalizeOpeningHeightMode(opening) {
  if ('corner' in opening) {
    const spec = opening.corner;
    const width = pos(spec?.returnWidth);
    if (opening.kind === 'window' && !opening.host && ['from', 'to'].includes(spec?.end) && width >= 600 && opening.width >= 600) {
      opening.corner = { end: spec.end, returnWidth: Math.round(width), joint: spec.joint === 'pier' ? 'pier' : 'post' };
      delete opening.span;
    } else delete opening.corner;
  }
  if (opening.kind !== 'window') { delete opening.heightMode; delete opening.span; return; }
  if ('span' in opening) {
    const levelId = str(opening.span?.levelId);
    const topGap = num(opening.span?.topGap);
    if (levelId && topGap != null && topGap >= 0) opening.span = { levelId, topGap };
    else delete opening.span;
  }
  // Современное custom — осознанное индивидуальное исключение. Только в
  // старых файлах, где режима ещё не было, высокие типы подключаем к общему
  // стандарту этажа автоматически.
  if ('heightMode' in opening) opening.heightMode = opening.heightMode === 'level' ? 'level' : 'custom';
  else if (LEGACY_LINKED_WINDOW_TYPES.has(opening.type)) opening.heightMode = 'level';
}

export function normalizeOpening(o) {
  if (isObj(o) && str(o.kind) && isObj(o.host)) return normalizeHostOpening(o);
  if (!isObj(o) || !str(o.kind) || !str(o.roomId)) return null;
  // Сторона: 0–3 у прямоугольника или строковый id ребра контура/выреза
  // ('outline-5', 'notch-…', см. roomBoundaryEdges).
  const side = typeof o.side === 'string' && !/^\s*\d+\s*$/.test(o.side) ? str(o.side) : num(o.side);
  const offset = num(o.offset);
  const width = pos(o.width);
  const sideOk = typeof side === 'string' || (side != null && Number.isInteger(side) && side >= 0 && side <= 3);
  if (!sideOk || offset == null || width == null) return null;
  const out = { ...o, id: str(o.id) || makeId(o.kind), side, offset, width };
  for (const key of ['height', 'sill']) {
    if (key in out) { const n = num(out[key]); if (n == null || n < 0) delete out[key]; else out[key] = n; }
  }
  normalizeOpeningHeightMode(out);
  return out;
}

export function normalizeItem(it) {
  if (!isObj(it) || !str(it.kind)) return null;
  const x = num(it.x);
  const y = num(it.y);
  const w = pos(it.w);
  const h = pos(it.h);
  if (x == null || y == null || w == null || h == null) return null;
  return normalizeCatalogItemMetadata({
    ...it, id: str(it.id) || makeId('item'), x, y, w, h, rotation: num(it.rotation) ?? 0,
  });
}

const cleanList = (list, fn) => (Array.isArray(list) ? list.map(fn).filter(Boolean) : []);

function normalizeLevelContent(l) {
  const rooms = cleanList(l.rooms, normalizeRoom);
  const ids = new Set(rooms.map((r) => r.id));
  for (const r of rooms) if (r.parentId && !ids.has(r.parentId)) r.parentId = null;
  const walls = cleanList(l.walls, normalizeWall);
  const wallIds = new Set(walls.map((w) => w.id));
  // Проёмы в перекрытии (core/slab-openings.js): необязательно, без смены схемы.
  const slabOpenings = normalizeSlabOpenings(l.slabOpenings);
  const out = {
    ...l,
    rooms,
    // Проём на несуществующей ручной стене удаляется (как проём без комнаты).
    openings: cleanList(l.openings, normalizeOpening).filter((o) => !o.host || wallIds.has(o.host.wallId)),
    items: normalizeItemsComp(cleanList(l.items, normalizeItem)),
    wallOverrides: isObj(l.wallOverrides) ? l.wallOverrides : {},
    walls,
  };
  if (slabOpenings.length) out.slabOpenings = slabOpenings; else delete out.slabOpenings;
  return out;
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
  data.name = normalizeProjectName(data.name);
  data.revision = Number(data.revision) || 0;
  delete data.projectHistory;
  if (typeof data.fileHistoryId !== 'string' || !/^fh[a-z0-9]{6,32}$/.test(data.fileHistoryId)) delete data.fileHistoryId;
  const levels = Array.isArray(data.levels) ? data.levels.filter(isObj) : [];
  data.levels = levels.map((l, i) => {
    const content = normalizeLevelContent(l);
    const height = Number(l.height) > 0 ? Number(l.height) : DEFAULT_LEVEL_HEIGHT;
    const tall = levelTallWindowOffsets({ ...l, ...content, height });
    return {
      ...content,
      id: typeof l.id === 'string' && l.id ? l.id : makeId('level'),
      name: typeof l.name === 'string' && l.name ? l.name : `${i + 1} этаж`,
      elevation: Number(l.elevation) || 0,
      height,
      slabThickness: Number(l.slabThickness) >= 120 && Number(l.slabThickness) <= 600
        ? Number(l.slabThickness) : DEFAULT_SLAB,
      tallWindowHeight: tall.height,
      tallWindowTopOffset: tall.top,
      tallWindowBottomOffset: tall.bottom,
    };
  });
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
  // Оболочка необязательна в старых файлах; после открытия всегда полная.
  data.envelope = normalizeEnvelope(data.envelope);
  // Движок стен (core/walls.js → wallsEngine): только 'v1' | 'v2'.
  if (data.settings.wallsEngine !== 'v1' && data.settings.wallsEngine !== 'v2') delete data.settings.wallsEngine;
  // Углы вида по режимам (core/view-angles.js): необязательно, без смены схемы.
  const viewAngles = cleanViewAngles(data.settings.viewAngles);
  if (viewAngles) data.settings.viewAngles = viewAngles; else delete data.settings.viewAngles;
  // Скрытые замечания (core/issues.js): необязательно, без смены схемы —
  // уникальные непустые строки, пустой список не хранится.
  const dismissed = Array.isArray(data.settings.dismissedIssues)
    ? [...new Set(data.settings.dismissedIssues.filter((x) => typeof x === 'string' && x))]
    : [];
  if (dismissed.length) data.settings.dismissedIssues = dismissed; else delete data.settings.dismissedIssues;
  // Старые помещения по стенам (room.bound) → обычные комнаты (core/bound-rooms.js).
  for (const levels of [data.levels, ...data.variants.map((v) => v.house.levels)]) {
    for (const level of levels) convertLevelBoundRooms(level, levels, data.settings);
  }
  // Виды и листы (core/views.js): необязательно, без смены схемы.
  normalizeViewsAndSheets(data);
  // Массы (core/masses.js): необязательно, без смены схемы; пустой список не хранится.
  const masses = normalizeMasses(data.masses);
  if (masses.length) data.masses = masses; else delete data.masses;
  const massVoids = normalizeMassVoids(data.massVoids);
  if (massVoids.length) data.massVoids = massVoids; else delete data.massVoids;
  // Крыши-плиты (core/roofs.js): необязательно, без смены схемы; у крыши свой
  // контур, старые крыши над помещениями (roomIds) получают контур по ним;
  // пустой список не хранится.
  const roofs = normalizeRoofs(data.roofs, data.levels, data.settings);
  if (roofs.length) data.roofs = roofs; else delete data.roofs;
  // Координационные оси (core/grid-axes.js): необязательно, без смены схемы.
  const grids = normalizeGrids(data.grids);
  if (grids.length) data.grids = grids; else delete data.grids;
  // Привязки стен к осям (core/grid-pins.js): к несуществующим осям — снимаются.
  const gridIds = new Set(grids.map((g) => g.id));
  for (const level of data.levels) {
    for (const r of level.rooms || []) {
      if (!r.axisPins) continue;
      r.axisPins = r.axisPins.filter((p) => gridIds.has(p.gridId));
      if (!r.axisPins.length) delete r.axisPins;
    }
    for (const w of level.walls || []) {
      if (!w.axisPins) continue;
      for (const k of Object.keys(w.axisPins)) if (!gridIds.has(w.axisPins[k].gridId)) delete w.axisPins[k];
      if (!Object.keys(w.axisPins).length) delete w.axisPins;
    }
  }
  // Внешние факты для авторасстановки: необязательный корневой объект.
  // null и [] различаются для инженерии/хранения, поэтому пустые подтверждённые
  // списки сохраняются; полностью незаполненное задание в файл не попадает.
  const layoutBrief = normalizeLayoutBrief(data.layoutBrief, {
    levelIds: data.levels.map((level) => level.id),
    roomIds: data.levels.flatMap((level) => level.rooms.map((room) => room.id)),
    itemIds: data.levels.flatMap((level) => level.items.map((item) => item.id)),
    openingIds: data.levels.flatMap((level) => level.openings.map((opening) => opening.id)),
  });
  if (layoutBriefIsEmpty(layoutBrief)) delete data.layoutBrief; else data.layoutBrief = layoutBrief;
  ensureSite(data);
  return attachLevelAccessors(data);
}

function convertLevelBoundRooms(level, levels, settings) {
  if (!level.rooms.some((r) => r.bound)) return;
  const lp = {
    rooms: level.rooms, walls: level.walls, openings: level.openings, items: level.items,
    wallOverrides: level.wallOverrides, settings, levels, activeLevel: level.id,
  };
  convertBoundRooms(lp);
  for (const key of LEVEL_KEYS) level[key] = lp[key];
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
  removeOwnedAtriums(project, project.activeLevel, doomed);
  project.rooms = project.rooms.filter((r) => !doomed.has(r.id));
  project.openings = project.openings.filter((o) => !doomed.has(o.roomId));
  // Мебель, центр которой внутри контура удалённых помещений, удаляется с ними.
  project.items = project.items.filter((i) => !shapes.some((r) => roomContainsPoint(r, i.x, i.y)));
}

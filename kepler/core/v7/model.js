// Модель v7 (схема 'kepler-plan/7'): хранится только то, что нарисовал
// пользователь; стены блоков, видимые формы и помещения — производные
// (core/v7/derive.js). Чистые функции без DOM. Проект — docs/architecture-v7.md.
//
// Единицы — мм, ось Y вниз, всё в осях дома (кроме site — координаты съёмки).
//
// project = {
//   schema: 'kepler-plan/7', name, revision, settings, building {rotation, origin},
//   site (как в kepler-plan/6), variants (как в v6, хранятся как есть),
//   levels: [Level], activeLevel,
// }
// Level = { id, name, elevation, height,
//   blocks:   [Block]    — блоки-генераторы помещений,
//   walls:    [Wall]     — ручные стены (любой угол),
//   openings: [Opening]  — двери/окна на стене или на ребре блока,
//   items:    [Item]     — мебель (мировая или с blockId),
//   seeds:    [Seed]     — «семена» помещений по стенам: имя/тип в точке,
//   pairs:    { 'a|b': { thickness?, hidden? } } — общая стена пары блоков,
// }
// Block = { id, name, type, x, y, rotation (0|90|180|270), z,
//   shape: { kind: 'rect', w, h } | { kind: 'poly', pts: [{x,y}] } — НОМИНАЛЬНАЯ
//          форма в локальных осях, хранится всегда целиком (съедание — на лету),
//   parentId, walls?: { exterior?, partition? }, edges?: { [i]: { thickness?, hidden?, kind? } },
//   open?, shaft?, ...прочие поля комнаты v6 (ceiling, takesArea, …) }
// Wall = { id, from {x,y}, to {x,y}, thickness, justify ('center'|'left'|'right' —
//   какая грань лежит на оси, как в v6), wallType, typeId, base {offset},
//   top {level, offset, height}, hidden, roomBounding }
// Opening = { id, kind ('door'|'window'), width, height, sill, type?, swingIn,
//   hingeStart, host: { wallId, t } | { blockId, edge, offset } }
//   t — центр от wall.from, мм; edge — индекс ребра номинальной формы блока,
//   offset — центр от начала ребра, мм.
// Seed = { id, x, y, name, type }

import { DEFAULT_BEARING, DEFAULT_EXTERIOR, DEFAULT_PARTITION, isOpenRoom, isShaft, roomType } from '../catalog.js';
import { transformPoint } from '../geom/poly.js';

export const SCHEMA7 = 'kepler-plan/7';
export const DEFAULT_LEVEL_HEIGHT = 3000;
export const MAX_SHARED_GAP = 450; // как core/walls.js: дальше — не общая стена

let seq = 0;
export function makeId(prefix) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createLevel7(name = '1 этаж', elevation = 0, height = DEFAULT_LEVEL_HEIGHT, id = makeId('level')) {
  return { id, name, elevation, height, blocks: [], walls: [], openings: [], items: [], seeds: [], pairs: {} };
}

export function createProject7(name = 'Новый дом') {
  const level = createLevel7('1 этаж', 0, DEFAULT_LEVEL_HEIGHT, 'L1');
  return {
    schema: SCHEMA7,
    revision: 0,
    name,
    settings: {
      partition: DEFAULT_PARTITION, exterior: DEFAULT_EXTERIOR, bearing: DEFAULT_BEARING, dimOuter: true, units: 'mm',
    },
    building: { rotation: 0, origin: { x: 0, y: 0 } },
    site: null,
    variants: [],
    levels: [level],
    activeLevel: level.id,
  };
}

export function activeLevel7(project, levelId = project.activeLevel) {
  return project.levels.find((l) => l.id === levelId) || project.levels[0];
}

export function createBlock(type, x, y, w, h, extra = {}) {
  const def = roomType(type);
  return {
    id: makeId('block'),
    name: def ? def.title : type,
    type,
    x, y,
    rotation: 0,
    shape: { kind: 'rect', w: w || def?.w || 3000, h: h || def?.h || 3000 },
    z: 0,
    parentId: null,
    ...extra,
  };
}

// Номинальная форма в локальных осях (контур с площадью > 0 по шнурованию:
// на экране с осью Y вниз — по часовой; ребро 0 у прямоугольника — верх,
// 1 — право, 2 — низ, 3 — лево, как стороны комнаты v6).
export function blockLocalRing(block) {
  const s = block.shape || {};
  if (s.kind === 'poly' && Array.isArray(s.pts) && s.pts.length >= 3) return s.pts.map((p) => ({ x: p.x, y: p.y }));
  const w = Number(s.w) || 0; const h = Number(s.h) || 0;
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

export function blockTransform(block) {
  return { x: Number(block.x) || 0, y: Number(block.y) || 0, rotation: Number(block.rotation) || 0 };
}

// Номинальный контур в осях дома.
export function blockRing(block) {
  const t = blockTransform(block);
  return blockLocalRing(block).map((p) => transformPoint(p, t));
}

// Дыры номинальной формы (shape.holes у poly — после «запекания» при
// разборе вложенного/съедающего блока на стены), в осях дома.
export function blockHoles(block) {
  const holes = block.shape?.kind === 'poly' && Array.isArray(block.shape.holes) ? block.shape.holes : [];
  const t = blockTransform(block);
  return holes.filter((h) => Array.isArray(h) && h.length >= 3).map((h) => h.map((p) => transformPoint(p, t)));
}

// Номинальная форма как Polygon [outer, ...holes] в осях дома.
export function blockGeom(block) {
  return [blockRing(block), ...blockHoles(block)];
}

// Номинальные рёбра в осях дома: [{ a, b, index }] — внешний контур, затем
// дыры (индексы продолжаются).
export function blockEdges(block) {
  const out = [];
  for (const ring of blockGeom(block)) {
    ring.forEach((a, i) => out.push({ a, b: ring[(i + 1) % ring.length], index: out.length }));
  }
  return out;
}

export function blockBox(block) {
  const ring = blockRing(block);
  const xs = ring.map((p) => p.x); const ys = ring.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export const blockIsOpen = (b) => isOpenRoom(b);
export const blockIsShaft = (b) => isShaft(b);
export const blockHasWalls = (b) => !isOpenRoom(b);

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Толщина общей перегородки пары блоков = зазор, который держит съедание:
// своя толщина пары → большая из перегородок блоков → settings.partition.
export function pairGap(level, settings, a, b) {
  const own = Number(level?.pairs?.[pairKey(a.id, b.id)]?.thickness);
  if (own > 0) return own;
  const pa = Number(a.walls?.partition) || 0; const pb = Number(b.walls?.partition) || 0;
  if (pa || pb) return Math.max(pa, pb);
  return Number(settings?.partition) || DEFAULT_PARTITION;
}

// Порядок «кто выше»: z, затем id — от порядка в массиве не зависит.
export const blockOrder = (a, b) => ((Number(a.z) || 0) - (Number(b.z) || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function maxZ(level) {
  return level.blocks.reduce((m, b) => Math.max(m, Number(b.z) || 0), 0);
}

export function blockById(level, id) {
  return level.blocks.find((b) => b.id === id) || null;
}

// ---------------------------------------------------------------- операции
// Все операции меняют проект на месте и ничего не помнят: результат derive
// зависит только от итогового состояния.

export function addBlock(project, block, { levelId, top = true } = {}) {
  const level = activeLevel7(project, levelId);
  if (top) block.z = maxZ(level) + 1;
  level.blocks.push(block);
  return block;
}

// Последний тронутый — сверху (raise).
export function raiseBlock(project, id, { levelId } = {}) {
  const level = activeLevel7(project, levelId);
  const b = blockById(level, id);
  if (b) b.z = maxZ(level) + 1;
  return b;
}

const descendants = (level, id) => level.blocks.filter((b) => b.parentId === id);

export function moveBlock(project, id, dx, dy, { levelId, raise = true } = {}) {
  const level = activeLevel7(project, levelId);
  const b = blockById(level, id);
  if (!b) return null;
  const moved = [b, ...descendants(level, id)];
  for (const m of moved) { m.x += dx; m.y += dy; }
  const ids = new Set(moved.map((m) => m.id));
  for (const it of level.items) if (it.blockId && ids.has(it.blockId)) { it.x += dx; it.y += dy; }
  if (raise) raiseBlock(project, id, { levelId });
  return b;
}

// Новый габарит прямоугольного блока (в локальных осях: w, h; x/y — новое начало).
export function resizeBlock(project, id, { x, y, w, h }, { levelId, raise = true } = {}) {
  const level = activeLevel7(project, levelId);
  const b = blockById(level, id);
  if (!b) return null;
  if (x != null) b.x = x;
  if (y != null) b.y = y;
  if (b.shape.kind === 'rect') {
    if (w != null) b.shape.w = w;
    if (h != null) b.shape.h = h;
  }
  if (raise) raiseBlock(project, id, { levelId });
  return b;
}

export function setBlockRotation(project, id, rotation, { levelId } = {}) {
  const b = blockById(activeLevel7(project, levelId), id);
  if (b) b.rotation = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return b;
}

// Удаление блока: вложенные удаляются, проёмы на его рёбрах — тоже,
// мебель остаётся на месте (мировая).
export function removeBlock(project, id, { levelId } = {}) {
  const level = activeLevel7(project, levelId);
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of level.blocks) if (b.parentId && gone.has(b.parentId) && !gone.has(b.id)) { gone.add(b.id); grew = true; }
  }
  level.blocks = level.blocks.filter((b) => !gone.has(b.id));
  level.openings = level.openings.filter((o) => !(o.host?.blockId && gone.has(o.host.blockId)));
  for (const it of level.items) if (it.blockId && gone.has(it.blockId)) it.blockId = null;
  for (const key of Object.keys(level.pairs || {})) if (key.split('|').some((k) => gone.has(k))) delete level.pairs[key];
  return [...gone];
}

export function createWall(from, to, { thickness = DEFAULT_PARTITION, justify = 'center', wallType = 'partition', ...rest } = {}) {
  return {
    id: makeId('wall'),
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    thickness,
    justify,
    wallType,
    typeId: null,
    base: { offset: 0 },
    top: { level: null, offset: 0, height: null },
    hidden: false,
    roomBounding: true,
    ...rest,
  };
}

export function addWall(project, wall, { levelId } = {}) {
  activeLevel7(project, levelId).walls.push(wall);
  return wall;
}

export function createOpening7(kind, host, width, extra = {}) {
  return {
    id: makeId(kind),
    kind,
    host,
    width,
    height: kind === 'door' ? 2100 : 1500,
    sill: kind === 'door' ? 0 : 900,
    swingIn: true,
    hingeStart: true,
    ...extra,
  };
}

export function addOpening(project, opening, { levelId } = {}) {
  activeLevel7(project, levelId).openings.push(opening);
  return opening;
}

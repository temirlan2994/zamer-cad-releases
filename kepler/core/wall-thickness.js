// Толщина и тип стен: три класса (наружная / внутренняя несущая / перегородка)
// и смена толщины общей стены без разрыва стыковки. Чистый модуль без DOM.
//
// Общая стена — это зазор между двумя комнатами. Её толщина хранится в
// wallOverrides[s|a|b].thickness, и findAdjacencies признаёт стыковку только
// при зазоре, равном этой толщине (sharedWallThickness в core/walls.js).
// Поэтому толщину общей стены нельзя поменять без сдвига комнат: сторона
// второй комнаты пары сдвигается целиком (все комнаты того же уровня
// вложенности за линией стены), чтобы её другие стыковки тоже сохранились.

import { DEFAULT_PARTITION, isOpenRoom } from './catalog.js';
import { levelProject, roomById } from './model.js';
import { captureOpeningAnchors, reanchorOpenings } from './opening-anchor.js';
import { roomContainsPoint, roomNotchInnerPoint } from './room-shape.js';
import { validateRoomPlacement } from './rooms.js';
import { setManualWallKind } from './wall-manual.js';
import {
  WALL_T_MAX, WALL_T_MIN, findAdjacencies, projectAdjacencies, sharedKey, sideEdge, wallClassThickness,
} from './walls.js';

export function clampWallThickness(value, fallback = DEFAULT_PARTITION) {
  const t = Math.round(Number(value));
  if (!Number.isFinite(t) || t <= 0) return fallback;
  return Math.min(WALL_T_MAX, Math.max(WALL_T_MIN, t));
}

function setOverride(project, key, patch) {
  project.wallOverrides[key] = { ...(project.wallOverrides[key] || {}), ...patch };
}

// Снимок данных активного этажа — для отката неудачной операции.
function levelSnapshot(project) {
  return {
    rooms: structuredClone(project.rooms),
    openings: structuredClone(project.openings),
    items: structuredClone(project.items),
    wallOverrides: structuredClone(project.wallOverrides),
  };
}

function restoreLevel(project, snap) {
  project.rooms = snap.rooms;
  project.openings = snap.openings;
  project.items = snap.items;
  project.wallOverrides = snap.wallOverrides;
}

// Растягивает комнату вдоль оси axis: всё, что дальше линии line по
// направлению dir, едет на shift. Прямоугольник, Г-вырез (notch) и
// произвольный контур (outline) — одной функцией. Возвращает функцию
// пересчёта абсолютной координаты (для проёмов).
export function stretchRoomShape(r, axis, line, dir, shift) {
  const size = axis === 'x' ? 'w' : 'h';
  const far = (v) => (dir > 0 ? v > line + 0.5 : v < line - 0.5);
  const mv = (v) => (far(v) ? v + shift : v);
  if (Array.isArray(r.outline) && r.outline.length >= 4) {
    const pts = r.outline.map((p) => ({ x: r.x + Number(p.x), y: r.y + Number(p.y) }));
    for (const p of pts) p[axis] = mv(p[axis]);
    const lo = Math.min(...pts.map((p) => p[axis]));
    const hi = Math.max(...pts.map((p) => p[axis]));
    r[axis] = lo; r[size] = hi - lo;
    r.outline = pts.map((p) => ({ x: p.x - r.x, y: p.y - r.y }));
    return mv;
  }
  const inner = r.notch ? roomNotchInnerPoint(r) : null;
  const lo = mv(r[axis]);
  const hi = mv(r[axis] + r[size]);
  r[axis] = lo; r[size] = hi - lo;
  if (inner) {
    const highSide = axis === 'x' ? r.notch.corner.endsWith('e') : r.notch.corner.startsWith('s');
    const at = mv(inner[axis]);
    r.notch[size] = highSide ? hi - at : at - lo;
    if (!(r.notch[size] >= 1)) delete r.notch;
  }
  return mv;
}

// Меняет толщину общей стены wall (объект из deriveWalls). Комната
// wall.rooms[0] и всё по её сторону линии стены остаются на месте; вторая
// комната и все комнаты того же уровня за линией её грани сдвигаются на
// разницу толщин. Комнаты (и Г/контурные), пересекающие эту линию и
// состыкованные со сдвигаемыми по той же оси, растягиваются (их дальняя
// часть едет вместе со сдвигом). Проёмы хранят отступ от room.x/y: у
// сдвинутых комнат они едут вместе с комнатой, у растянутых — компенсируются.
// Возвращает { ok, reason?, moved: [id], stretched: [id], broken: [ключи] }.
export function setSharedWallThickness(project, wall, newT) {
  const t = clampWallThickness(newT, wall.thickness);
  const fixed = roomById(project, wall.rooms[0]);
  const mover = roomById(project, wall.rooms[1]);
  if (!fixed || !mover) return { ok: false, reason: 'Комната стены не найдена', moved: [], stretched: [], broken: [] };
  const key = sharedKey(fixed.id, mover.id);
  const delta = t - wall.thickness;
  if (Math.abs(delta) < 0.5) {
    setOverride(project, key, { thickness: t });
    return { ok: true, moved: [], stretched: [], broken: [] };
  }

  const snap = levelSnapshot(project);
  const axis = wall.orient === 'v' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  const facing = sideEdge(mover, wall.sides[mover.id]);
  const line = facing.edge; // грань сдвигаемой комнаты, обращённая к стене
  const dir = -facing.outward; // куда уходит сдвигаемая сторона при утолщении
  const shift = dir * delta; // смещение сдвигаемой стороны по оси
  const parentId = mover.parentId || null;
  const siblings = project.rooms.filter((r) => (r.parentId || null) === parentId);
  const beyond = (r) => (dir > 0 ? r[axis] >= line - 1 : r[axis] + r[size] <= line + 1);
  const pushed = new Set(siblings
    .filter((r) => r.id === mover.id || (r.id !== fixed.id && beyond(r)))
    .map((r) => r.id));

  const before = projectAdjacencies(project);
  const crossAxis = (adj) => adj.edgeA.orient === wall.orient;
  // Растягиваются только прямоугольники, пересекающие линию и состыкованные
  // со сдвигаемой комнатой поперёк оси: иначе их стыковка порвалась бы.
  const stretched = new Set();
  for (const adj of before) {
    if (!crossAxis(adj)) continue;
    for (const [r, other] of [[adj.a, adj.b], [adj.b, adj.a]]) {
      if (pushed.has(r.id) || !pushed.has(other.id) || r.id === fixed.id) continue;
      if (r[axis] < line - 1 && r[axis] + r[size] > line + 1) stretched.add(r.id);
    }
  }

  // Комнаты, которые едут целиком: сдвигаемые и их вложенные помещения.
  const moving = new Set(pushed);
  for (const r of project.rooms) if (r.parentId && pushed.has(r.parentId)) moving.add(r.id);
  const movingShapes = project.rooms.filter((r) => moving.has(r.id)).map((r) => structuredClone(r));
  const stretchShapes = project.rooms.filter((r) => stretched.has(r.id)).map((r) => structuredClone(r));

  // Мебель: внутри сдвигаемых комнат — едет целиком; внутри растягиваемых —
  // только та, что за линией стены. Каждый предмет сдвигается один раз.
  for (const item of project.items) {
    const at = axis === 'x' ? item.x : item.y;
    const inMoving = movingShapes.some((r) => roomContainsPoint(r, item.x, item.y));
    const inStretchFar = stretchShapes.some((r) => roomContainsPoint(r, item.x, item.y)) &&
      (dir > 0 ? at > line : at < line);
    if (inMoving || inStretchFar) item[axis] += shift;
  }
  for (const r of project.rooms) {
    if (moving.has(r.id)) r[axis] += shift;
  }
  for (const r of project.rooms) {
    if (!stretched.has(r.id)) continue;
    // Проёмы: дальняя часть стен вдоль оси едет со сдвигом, остальное — на месте.
    const anchors = captureOpeningAnchors(project, r);
    const mv = stretchRoomShape(r, axis, line, dir, shift);
    reanchorOpenings(project, r, anchors, { [axis]: mv });
  }

  // Стыковки поперёк оси между сдвинутой и неподвижной комнатой лежат на той
  // же линии, что и выбранная стена: это одна стена, она получает новую толщину.
  const kept = new Set();
  for (const adj of before) {
    if (!crossAxis(adj)) continue;
    const aMoves = moving.has(adj.a.id);
    const bMoves = moving.has(adj.b.id);
    if (aMoves === bMoves) continue;
    const other = aMoves ? adj.b : adj.a;
    if (stretched.has(other.id)) continue;
    const gap = adj.gap + delta;
    if (gap < WALL_T_MIN - 0.5 || gap > WALL_T_MAX + 0.5) {
      restoreLevel(project, snap);
      return { ok: false, reason: `Толщина стены вне пределов ${WALL_T_MIN}–${WALL_T_MAX} мм`, moved: [], stretched: [], broken: [] };
    }
    const pairKey = sharedKey(adj.a.id, adj.b.id);
    setOverride(project, pairKey, { thickness: Math.round(gap) });
    kept.add(pairKey);
  }
  setOverride(project, key, { thickness: t });

  for (const r of project.rooms) {
    if (!moving.has(r.id) && !stretched.has(r.id)) continue;
    const verdict = validateRoomPlacement(project, r, r.id);
    if (!verdict.ok) {
      restoreLevel(project, snap);
      return { ok: false, reason: verdict.reason, moved: [], stretched: [], broken: [] };
    }
  }

  // Какие стыковки (кроме террас) всё же порвались — для предупреждения.
  const pairsOf = (list) => new Set(list
    .filter((adj) => !isOpenRoom(adj.a) && !isOpenRoom(adj.b))
    .map((adj) => sharedKey(adj.a.id, adj.b.id)));
  const afterPairs = pairsOf(projectAdjacencies(project));
  const broken = [...pairsOf(before)].filter((k) => !afterPairs.has(k));
  return { ok: true, moved: [...moving], stretched: [...stretched], broken };
}

// Меняет тип стены. Если толщина не настраивалась вручную (равна толщине
// прежнего класса по умолчанию), стена получает толщину нового класса.
export function setWallKind(project, wall, kind) {
  if (wall?.kind === 'manual') return setManualWallKind(project, wall.wallId, kind);
  const current = Math.round(wall.thickness);
  const wasDefault = Math.abs(current - wallClassThickness(project.settings, wall.wallType)) <= 1;
  const target = wasDefault ? wallClassThickness(project.settings, kind) : current;
  const snapOverrides = structuredClone(project.wallOverrides);
  setOverride(project, wall.key, { kind });
  if (target === current) return { ok: true, thickness: current };
  if (wall.kind === 'shared') {
    const result = setSharedWallThickness(project, wall, target);
    if (!result.ok) project.wallOverrides = snapOverrides;
    return { ...result, thickness: target };
  }
  setOverride(project, wall.key, { thickness: target });
  return { ok: true, thickness: target };
}

// Новые толщины по умолчанию. Перегородка по умолчанию определяет зазор
// стыковки, поэтому перед её сменой уже существующие общие стены без своей
// толщины получают прежнюю явно — иначе все стыковки разом бы порвались.
export function setWallDefaults(project, { exterior, bearing, partition } = {}) {
  const settings = project.settings;
  if (exterior !== undefined) settings.exterior = clampWallThickness(exterior, settings.exterior);
  if (bearing !== undefined) settings.bearing = clampWallThickness(bearing, settings.bearing);
  if (partition !== undefined) {
    const next = clampWallThickness(partition, settings.partition);
    const prev = settings.partition || DEFAULT_PARTITION;
    if (next !== prev) {
      for (const level of project.levels) {
        const lp = levelProject(project, level.id);
        for (const adj of findAdjacencies(lp.rooms, prev, lp.wallOverrides)) {
          if (isOpenRoom(adj.a) || isOpenRoom(adj.b)) continue;
          const key = sharedKey(adj.a.id, adj.b.id);
          if (!(Number(lp.wallOverrides[key]?.thickness) > 0)) {
            lp.wallOverrides[key] = { ...(lp.wallOverrides[key] || {}), thickness: prev };
          }
        }
      }
      settings.partition = next;
    }
  }
}

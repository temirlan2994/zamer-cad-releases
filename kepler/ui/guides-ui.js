// «Умные направляющие» при перемещении объектов (core/guides.js): сбор целей
// (ландшафт, мебель, комнаты, стены, дом, граница участка), перевод между
// пространствами (участок — «world», оси дома — «plan»), отсечение по экрану,
// итоговый сдвиг с приоритетом над сеткой и слой state.objGuides для
// render-guides.js. Shift и выключатель «Направляющие» — без привязки.

import { GUIDE_TOL_PX, mergeWithGrid, movingBoxes, prepareGuides, snapGuides } from '../core/guides.js';
import { formatLength } from '../core/draw-snap.js';
import { toLocal, toWorld } from '../core/building.js';
import { isPathShape, landscapeDef, objectCorners, objectPath } from '../core/landscape.js';
import { houseFootprints } from '../core/landscape-tools.js';
import { slabOpeningPolygon, slabOpenings } from '../core/slab-openings.js';
import { wallRects } from '../core/walls.js';
import { canvas } from './dom.js';
import { snapSettings } from './draw-snap-ui.js';
import { state } from './state.js';
import { screenToWorld } from './view.js';

const DEG = Math.PI / 180;

export function guidesOn(event) {
  return snapSettings().guides !== false && !event?.shiftKey;
}

const rectPts = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

// Фигуры объектов: углы реальной формы (с поворотом) или круг.
export function landscapeShape(o) {
  const def = landscapeDef(o.kind);
  // Выноски — пояснения, не объекты: не цели и не привязываются.
  if (!def || def.shape === 'note') return null;
  if (isPathShape(def)) {
    const pts = o.points?.length ? (o.smooth ? objectPath(o) : o.points) : null;
    return pts?.length ? { id: o.id, pts } : null;
  }
  if (def.shape === 'point' || def.shape === 'circle') return { id: o.id, c: { x: o.x, y: o.y }, r: (o.w || 0) / 2 };
  try { return { id: o.id, pts: objectCorners(o) }; } catch { return null; }
}

export function itemShape(item, at = item) {
  const a = (item.rotation || 0) * DEG;
  const c = Math.cos(a); const s = Math.sin(a);
  const hw = item.w / 2; const hh = item.h / 2;
  return {
    id: item.id,
    pts: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: at.x + x * c - y * s, y: at.y + x * s + y * c })),
  };
}

export function roomShape(room, at = room) {
  return { id: room.id, pts: rectPts(at.x, at.y, room.w, room.h) };
}

const mapShape = (sh, f) => (sh.c ? { ...sh, c: f(sh.c) } : { ...sh, pts: sh.pts.map(f) });

// Цели в пространстве space. exclude: { ls, rooms, items: Set id; walls: fn(wall) → true — пропустить }.
function collectTargets(space, exclude = {}) {
  const project = state.project;
  const b = project.building;
  const toSpaceFromWorld = space === 'world' ? (p) => p : (p) => toLocal(b, p);
  const toSpaceFromPlan = space === 'plan' ? (p) => p : (p) => toWorld(b, p);
  const out = [];
  const add = (sh, f) => { if (sh) out.push(mapShape(sh, f)); };
  const site = project.site || {};
  for (const o of site.landscape?.objects || []) {
    if (exclude.ls?.has(o.id)) continue;
    add(landscapeShape(o), toSpaceFromWorld);
  }
  // Граница участка — каждой стороной (стык к забору, выравнивание по нему).
  const bd = site.boundary || [];
  if (bd.length >= 3) for (let i = 0; i < bd.length; i += 1) add({ pts: [bd[i], bd[(i + 1) % bd.length]] }, toSpaceFromWorld);
  // Дом целиком (контур) — для ландшафта; в плане его заменяют стены.
  if (space === 'world') {
    let house;
    try { house = houseFootprints(project); } catch { house = []; }
    for (const poly of house) if (poly?.length) add({ pts: poly }, toSpaceFromWorld);
  }
  for (const r of project.rooms || []) {
    if (exclude.rooms?.has(r.id)) continue;
    add(roomShape(r), toSpaceFromPlan);
  }
  for (const it of project.items || []) {
    if (exclude.items?.has(it.id)) continue;
    add(itemShape(it), toSpaceFromPlan);
  }
  // Другие проёмы — такие же геометрические цели, как стены и мебель. Это
  // особенно полезно при правке вершины/грани проёма на одном этаже.
  if (space === 'plan') {
    for (const opening of slabOpenings(project, project.activeLevel)) {
      if (exclude.slabs?.has(opening.id)) continue;
      add({ id: opening.id, pts: slabOpeningPolygon(opening) }, toSpaceFromPlan);
    }
  }
  for (const w of state.walls || []) {
    if (exclude.walls?.(w)) continue;
    if (w.polys?.length) for (const poly of w.polys) add({ pts: poly }, toSpaceFromPlan);
    else for (const r of wallRects(w)) add({ pts: rectPts(r.x, r.y, r.w, r.h) }, toSpaceFromPlan);
  }
  return out;
}

// Видимая область (с запасом) в пространстве space — отсечение целей.
function viewBox(space) {
  const W = canvas?.clientWidth || 0; const H = canvas?.clientHeight || 0;
  if (!W || !H) return null;
  const pad = 0.25;
  const corners = [[-pad * W, -pad * H], [W * (1 + pad), -pad * H], [W * (1 + pad), H * (1 + pad)], [-pad * W, H * (1 + pad)]]
    .map(([x, y]) => screenToWorld(x, y))
    .map((p) => (space === 'plan' ? toLocal(state.project.building, p) : p));
  const xs = corners.map((p) => p.x); const ys = corners.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), diag: Math.hypot(W, H) };
}

function inBox(sh, box) {
  if (!box) return true;
  const pts = sh.c ? [{ x: sh.c.x - sh.r, y: sh.c.y - sh.r }, { x: sh.c.x + sh.r, y: sh.c.y + sh.r }] : sh.pts;
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return x1 >= box.minX && x0 <= box.maxX && y1 >= box.minY && y0 <= box.maxY;
}

// Угол оси X экрана в пространстве (рад).
export function screenAxis(space) {
  const v = -(state.view?.rotation || 0);
  return space === 'plan' ? v - (state.project?.building?.rotation || 0) * DEG : v;
}

/**
 * Начало жеста. moving — фигуры набора в начале (в пространстве space);
 * ownAngles — оси самого объекта (рад); frames — явный список рамок
 * (например [0] для комнат); exclude — см. collectTargets.
 */
export function startGuideSession({ space = 'world', moving, exclude = {}, ownAngles = [], frames = null, equal = true }) {
  const box = viewBox(space);
  const targets = collectTargets(space, exclude).filter((sh) => inBox(sh, box));
  const angles = frames || [screenAxis(space), ...ownAngles];
  const index = prepareGuides(targets, angles);
  const scale = state.view?.scale || 1;
  return { space, index, boxes: movingBoxes(index, moving), reach: box ? box.diag / scale : Infinity, equal };
}

function guidesToWorld(guides, space) {
  if (space === 'world') return guides;
  const f = (p) => (p ? toWorld(state.project.building, p) : p);
  return guides.map((g) => ({ ...g, from: f(g.from), to: f(g.to), gapFrom: f(g.gapFrom), gapTo: f(g.gapTo) }));
}

/**
 * Сдвиг кадра: raw — сдвиг курсора, grid — сдвиг по сетке (оба в
 * пространстве сессии). lock — { x, y }: оси, уже привязанные другим
 * магнитом (комнаты), направляющие по ним не применяются (только рамка 0).
 * Возвращает { x, y, snapped }; направляющие — в state.objGuides.
 */
export function guideDelta(session, raw, grid, event, lock = null, options = null) {
  if (!session || !guidesOn(event)) { state.objGuides = null; return { x: grid.x, y: grid.y, snapped: false }; }
  const res = snapGuides(session.index, session.boxes, raw, {
    tol: GUIDE_TOL_PX / (state.view?.scale || 1), reach: session.reach, format: formatLength,
    equal: session.equal !== false, axis: options?.axis || null,
  });
  if (lock && res.snapped && res.axes) {
    if (lock.x) res.axes.x = false;
    if (lock.y) res.axes.y = false;
    res.guides = res.guides.filter((g) => !lock[g.axis]);
    if (!res.axes.x && !res.axes.y) res.snapped = false;
  }
  state.objGuides = res.guides.length && res.snapped ? guidesToWorld(res.guides, session.space) : null;
  const d = mergeWithGrid(res, grid);
  return { x: d.x, y: d.y, snapped: res.snapped, axes: res.axes };
}

export function clearObjGuides() {
  state.objGuides = null;
}

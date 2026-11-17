// Поиск объектов под курсором: ручки, комнаты, стены, проёмы, мебель, участок.

import { isFixedSizeComp, pointInComposite } from '../core/composite.js';
import { isOpenRoom, isShaft } from '../core/catalog.js';
import { itemsEditable, planHitStack } from '../core/hit-stack.js';
import { itemRect } from '../core/furnish.js';
import { roomById } from '../core/model.js';
import { distanceToPolyline, polylineMidpoints } from '../core/site.js';
import { openingRect, wallContains, wallDistance } from '../core/walls.js';
import { roomContainsPoint } from '../core/room-shape.js';
import { RAILING_INSET, roomRailings } from '../core/railings.js';
import {
  HANDLE_SIZE, SITE_INSERT_HANDLE_MIN_EDGE_PX, itemCorners, itemRotators, neighborCorners, neighborRotators, openingHandles,
  roomHandles, rotateVec, underlayCenter, underlayHandles, underlayRotators,
} from '../render.js';
import { inItemCore, itemEdgeHandles, itemHandleMode } from '../core/item-handles.js';
import {
  groupBounds, groupCorners, groupEdgeHandles, groupHandleId, groupItems, groupRotators,
} from '../core/group-handles.js';
import { state } from './state.js';
import { planToScreen, screenToPlan, worldToScreen } from './view.js';

// Допуск попадания по ручкам: палец (сенсор) — крупнее, мышь — по ручке.
const tol = () => (state.coarsePointer ? 22 : HANDLE_SIZE);

export function hitRoomHandle(screen) {
  if (state.selection?.type !== 'room') return null;
  const room = roomById(state.project, state.selection.id);
  if (!room) return null;
  for (const handle of roomHandles(room)) {
    const p = planToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) {
      return { room, handle: handle.id, shapeHandle: handle };
    }
  }
  return null;
}

// Торцы выбранной ручной стены (на оси): перенос конца.
export function manualWallEnds(selection = state.selection) {
  if (selection?.type !== 'wall' || !String(selection.key).startsWith('m|')) return [];
  const wall = (state.project.walls || []).find((w) => w.id === selection.key.slice(2));
  return wall ? [{ end: 'a', ...wall.axis.a, wall }, { end: 'b', ...wall.axis.b, wall }] : [];
}

export function hitManualWallEnd(screen) {
  for (const h of manualWallEnds()) {
    const p = planToScreen(h.x, h.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= tol()) return { wall: h.wall, end: h.end };
  }
  return null;
}

// Ручки концов выбранного сегмента перил (core/railings.js): посередине
// полосы перил, на концах a/b. → { room, seg, end: 'a'|'b' } или null.
export function hitRailingEnd(screen) {
  const sel = state.selection;
  if (sel?.type !== 'railing') return null;
  const room = roomById(state.project, sel.roomId);
  if (!room) return null;
  const seg = roomRailings(room, state.project.rooms, state.project.settings).find((s) => s.id === sel.id);
  if (!seg) return null;
  const mid = seg.edge - seg.outward * (RAILING_INSET / 2);
  for (const end of ['a', 'b']) {
    const p = seg.orient === 'h' ? planToScreen(seg[end], mid) : planToScreen(mid, seg[end]);
    if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) return { room, seg, end };
  }
  return null;
}

export function hitOpeningHandle(screen) {
  if (state.selection?.type !== 'opening') return null;
  const opening = state.project.openings.find((o) => o.id === state.selection.id);
  if (!opening) return null;
  for (const handle of openingHandles(state.project, opening, state.walls)) {
    const p = planToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) {
      return { opening, end: handle.end };
    }
  }
  return null;
}

export function hitUnderlayHandle(screen) {
  const site = state.project.site;
  if (state.selection?.type !== 'site' || state.selection.kind !== 'underlay') return null;
  if (!site.underlay || site.underlay.locked) return null;
  // Круги вращения — чуть снаружи углов (проверяем раньше квадратов).
  for (const r of underlayRotators(site.underlay, 22, state.view.scale)) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= tol()) return { mode: 'rotate', corner: r.id };
  }
  for (const handle of underlayHandles(site.underlay)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) {
      return { mode: 'resize', corner: handle.id };
    }
  }
  return null;
}

export function hitItemHandle(screen) {
  if (state.selection?.type !== 'item' || !itemsEditable(state.view.scale)) return null;
  const item = state.project.items.find((i) => i.id === state.selection.id);
  if (!item) return null;
  const mode = itemHandleMode(state.itemHandle, item.id);
  if (mode === 'select') return null;
  // Тело предмета важнее ручек: у малого предмета ручки с допуском пальца
  // иначе перекрывают его целиком, и режим нельзя ни сменить, ни выйти.
  if (inItemCore(item, screenToPlan(screen.x, screen.y), tol() / state.view.scale)) return null;
  if (mode === 'rotate') {
    for (const r of itemRotators(item, 20, state.view.scale)) {
      const p = planToScreen(r.x, r.y);
      if (Math.hypot(p.x - screen.x, p.y - screen.y) <= tol()) return { mode: 'rotate', corner: r.id };
    }
  }
  if (isFixedSizeComp(item)) return null; // диван-конструктор не растягивается
  if (mode === 'stretch') {
    for (const e of itemEdgeHandles(item)) {
      const p = planToScreen(e.x, e.y);
      if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) return { mode: 'stretch', edge: e.id };
    }
  }
  if (mode === 'scale') {
    for (const c of itemCorners(item)) {
      const p = planToScreen(c.x, c.y);
      if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) {
        return { mode: 'resize', corner: c.id };
      }
    }
  }
  return null;
}

// Ручки группы мебели (общая рамка): режим — state.itemHandle с id группы.
export function hitGroupHandle(screen) {
  if (!itemsEditable(state.view.scale)) return null;
  const id = groupHandleId(state.selection);
  if (!id) return null;
  const mode = itemHandleMode(state.itemHandle, id);
  if (mode === 'select') return null;
  const items = groupItems(state.project, state.selection);
  const box = groupBounds(items);
  if (!box) return null;
  // Тело любого предмета группы важнее ручек (клик — смена режима или перенос).
  const plan = screenToPlan(screen.x, screen.y);
  if (items.some((item) => inItemCore(item, plan, tol() / state.view.scale))) return null;
  const near = (h) => {
    const p = planToScreen(h.x, h.y);
    return Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol();
  };
  if (mode === 'rotate') {
    for (const r of groupRotators(box, 20, state.view.scale)) {
      const p = planToScreen(r.x, r.y);
      if (Math.hypot(p.x - screen.x, p.y - screen.y) <= tol()) return { mode: 'rotate', corner: r.id, box };
    }
  }
  if (mode === 'stretch') {
    const e = groupEdgeHandles(box).find(near);
    if (e) return { mode: 'stretch', edge: e.id, box };
  }
  if (mode === 'scale') {
    const c = groupCorners(box).find(near);
    if (c) return { mode: 'scale', corner: c.id, box };
  }
  return null;
}

export function hitNeighborHandle(screen) {
  if (state.selection?.type !== 'site' || state.selection.kind !== 'neighbor') return null;
  const n = state.project.site.neighbors.find((x) => x.id === state.selection.id);
  if (!n) return null;
  // Круги вращения — чуть снаружи углов (проверяем раньше квадратов).
  for (const r of neighborRotators(n, 22, state.view.scale)) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= tol()) return { mode: 'rotate', corner: r.id };
  }
  for (const c of neighborCorners(n)) {
    const p = worldToScreen(c.x, c.y);
    if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) {
      return { mode: 'resize', corner: c.id };
    }
  }
  return null;
}

export function hitSiteVertex(screen) {
  const sel = state.selection;
  if (sel?.type !== 'site') return null;
  const site = state.project.site;
  const points = sel.kind === 'boundary' ? site.boundary
    : sel.kind === 'redline' ? site.redLine
      : sel.kind === 'road' ? site.roads.find((r) => r.id === sel.id)?.points : null;
  if (!points) return null;
  for (let i = 0; i < points.length; i += 1) {
    const p = worldToScreen(points[i].x, points[i].y);
    if (Math.abs(p.x - screen.x) <= tol() && Math.abs(p.y - screen.y) <= tol()) {
      return {
        kind: sel.kind, id: sel.id, index: i, points,
        distance: Math.hypot(p.x - screen.x, p.y - screen.y),
      };
    }
  }
  return null;
}

// Круглые ручки посередине сторон выбранной границы: клик вставляет угол.
export function hitSiteMidpoint(screen) {
  const sel = state.selection;
  const points = sel?.type === 'site' && sel.kind === 'boundary' ? state.project.site.boundary : null;
  if (!points) return null;
  for (const handle of polylineMidpoints(points, true)) {
    const a = worldToScreen(points[handle.from].x, points[handle.from].y);
    const b = worldToScreen(points[handle.to].x, points[handle.to].y);
    if (Math.hypot(b.x - a.x, b.y - a.y) < SITE_INSERT_HANDLE_MIN_EDGE_PX) continue;
    const p = worldToScreen(handle.x, handle.y);
    const distance = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (distance <= tol()) {
      return { kind: 'boundary', points, ...handle, distance };
    }
  }
  return null;
}

// Плановые хит-тесты: точка p — в локальных координатах дома.
export function hitItem(p) {
  if (!itemsEditable(state.view.scale)) return null; // издали — только помещение
  const items = state.project.items;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    // Диван-конструктор — только по модулям: пустой внутренний угол Г/П не его.
    if (isFixedSizeComp(items[i])) {
      if (pointInComposite(items[i], p.x, p.y)) return items[i];
      continue;
    }
    const r = itemRect(items[i]);
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return items[i];
  }
  return null;
}

function openingContains(opening, p) {
  const placed = openingRect(state.project, opening, state.walls);
  if (!placed) return false;
  const pad = 8 / state.view.scale + 40;
  const rect = placed.rect;
  return p.x >= rect.x - pad && p.x <= rect.x + rect.w + pad && p.y >= rect.y - pad && p.y <= rect.y + rect.h + pad;
}

// Все объекты под одной точкой — от верхнего к нижнему. Используется для
// циклического выбора двойным/тройным кликом, как в графических редакторах.
export function hitPlanStack(p) {
  return planHitStack(state.project, state.walls, state.view.scale, p);
}

export function hitOpening(p) {
  for (const opening of state.project.openings) {
    if (openingContains(opening, p)) return opening;
  }
  return null;
}

export function hitWall(p) {
  for (const wall of state.walls) {
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue; // заплатки/фаски не выбираются
    if (wallContains(wall, p)) return wall;
  }
  return null;
}

export function hitRoom(p) {
  const roomLayer = (room) => (isShaft(room) ? 3 : room.parentId ? 2 : isOpenRoom(room) ? 0 : 1);
  const order = state.project.rooms.map((room, index) => ({ room, index }))
    .sort((a, b) => roomLayer(a.room) - roomLayer(b.room) || a.index - b.index)
    .reverse();
  for (const { room } of order) {
    if (roomContainsPoint(room, p.x, p.y)) return room;
  }
  return null;
}

export function hitSiteObject(world) {
  const site = state.project.site;
  if (!site) return null;
  const tol = 9 / state.view.scale;
  if (site.entry && Math.hypot(site.entry.x - world.x, site.entry.y - world.y) < tol + 900) {
    return { type: 'site', kind: 'entry' };
  }
  for (const n of site.neighbors || []) {
    // В собственных (повёрнутых) осях соседнего дома.
    const loc = rotateVec(world.x - n.x, world.y - n.y, -(n.rot || 0));
    if (Math.abs(loc.x) <= n.w / 2 && Math.abs(loc.y) <= n.h / 2) {
      return { type: 'site', kind: 'neighbor', id: n.id };
    }
  }
  if (site.boundary?.length >= 2 && distanceToPolyline(site.boundary, world, true) < tol + 60) {
    return { type: 'site', kind: 'boundary' };
  }
  if (site.redLine?.length >= 2 && distanceToPolyline(site.redLine, world, Boolean(site.redLineClosed)) < tol + 80) {
    return { type: 'site', kind: 'redline' };
  }
  for (const road of site.roads || []) {
    if (road.points.length >= 2 && distanceToPolyline(road.points, world, Boolean(road.closed)) < road.width / 2 + tol) {
      return { type: 'site', kind: 'road', id: road.id };
    }
  }
  const u = site.underlay;
  if (u) {
    const w = u.widthPx * u.mmPerPx;
    const h = u.heightPx * u.mmPerPx;
    const c = underlayCenter(u);
    const loc = rotateVec(world.x - c.x, world.y - c.y, -(u.rot || 0));
    if (Math.abs(loc.x) <= w / 2 && Math.abs(loc.y) <= h / 2) {
      return { type: 'site', kind: 'underlay' };
    }
  }
  return null;
}

export function findWall(key, from) {
  return state.walls.find((w) => w.key === key && (from === undefined || Math.abs(w.from - from) < 1)) || null;
}

export function nearestWall(p, maxScreenDist = 26) {
  const maxDist = maxScreenDist / state.view.scale;
  let best = null;
  for (const wall of state.walls) {
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue;
    const d = wallDistance(wall, p);
    if (d <= maxDist && (!best || d < best.dist)) best = { wall, dist: d };
  }
  return best?.wall || null;
}

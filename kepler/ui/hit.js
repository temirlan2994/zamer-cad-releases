// Поиск объектов под курсором: ручки, комнаты, стены, проёмы, мебель, участок.

import { itemRect } from '../core/furnish.js';
import { roomById } from '../core/model.js';
import { distanceToPolyline } from '../core/site.js';
import { openingRect } from '../core/walls.js';
import {
  HANDLE_SIZE, itemCorners, itemRotators, neighborCorners, neighborRotators, openingHandles,
  roomHandles, rotateVec, underlayCenter, underlayHandles, underlayRotators,
} from '../render.js';
import { state } from './state.js';
import { worldToScreen } from './view.js';

export function hitRoomHandle(screen) {
  if (state.selection?.type !== 'room') return null;
  const room = roomById(state.project, state.selection.id);
  if (!room) return null;
  for (const handle of roomHandles(room)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { room, handle: handle.id };
    }
  }
  return null;
}

export function hitOpeningHandle(screen) {
  if (state.selection?.type !== 'opening') return null;
  const opening = state.project.openings.find((o) => o.id === state.selection.id);
  if (!opening) return null;
  for (const handle of openingHandles(state.project, opening, state.walls)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
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
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_SIZE) return { mode: 'rotate', corner: r.id };
  }
  for (const handle of underlayHandles(site.underlay)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { mode: 'resize', corner: handle.id };
    }
  }
  return null;
}

export function hitItemHandle(screen) {
  if (state.selection?.type !== 'item') return null;
  const item = state.project.items.find((i) => i.id === state.selection.id);
  if (!item) return null;
  for (const r of itemRotators(item, 20, state.view.scale)) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_SIZE) return { mode: 'rotate', corner: r.id };
  }
  for (const c of itemCorners(item)) {
    const p = worldToScreen(c.x, c.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { mode: 'resize', corner: c.id };
    }
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
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_SIZE) return { mode: 'rotate', corner: r.id };
  }
  for (const c of neighborCorners(n)) {
    const p = worldToScreen(c.x, c.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
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
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { kind: sel.kind, id: sel.id, index: i, points };
    }
  }
  return null;
}

export function hitItem(world) {
  const items = state.project.items;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const r = itemRect(items[i]);
    if (world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h) return items[i];
  }
  return null;
}

export function hitOpening(world) {
  const pad = 8 / state.view.scale + 40;
  for (const opening of state.project.openings) {
    const placed = openingRect(state.project, opening, state.walls);
    if (!placed) continue;
    const r = placed.rect;
    if (world.x >= r.x - pad && world.x <= r.x + r.w + pad && world.y >= r.y - pad && world.y <= r.y + r.h + pad) {
      return opening;
    }
  }
  return null;
}

export function hitWall(world) {
  for (const wall of state.walls) {
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue; // заплатки/фаски не выбираются
    const b = wall.band;
    if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) return wall;
  }
  return null;
}

export function hitRoom(world) {
  const nested = state.project.rooms.filter((r) => r.parentId);
  const top = state.project.rooms.filter((r) => !r.parentId);
  for (const room of [...nested, ...top]) {
    if (world.x >= room.x && world.x <= room.x + room.w && world.y >= room.y && world.y <= room.y + room.h) {
      return room;
    }
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
    if (Math.abs(world.x - n.x) <= n.w / 2 && Math.abs(world.y - n.y) <= n.h / 2) {
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

export function nearestWall(world, maxScreenDist = 26) {
  const maxDist = maxScreenDist / state.view.scale;
  let best = null;
  for (const wall of state.walls) {
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue;
    const b = wall.band;
    const cx = Math.min(Math.max(world.x, b.x), b.x + b.w);
    const cy = Math.min(Math.max(world.y, b.y), b.y + b.h);
    const d = Math.hypot(world.x - cx, world.y - cy);
    if (d <= maxDist && (!best || d < best.dist)) best = { wall, dist: d };
  }
  return best?.wall || null;
}

// Прогулка: миллиметры и оси модели (Y вниз). Камера и проект здесь не меняются.
import { toLocal } from './building.js';
import { entryParts, siteEntries } from './site-entries.js';
export const WALK_HEIGHT = 1700;
export const WALK_EYE = 1600;
export const WALK_RADIUS = 200;
export const WALK_STEP = 250;
const CELL = 2000;
const EPS = 1;

function spatialIndex(entries) {
  const cells = new Map(), broad = [];
  for (const e of entries) {
    const x0 = Math.floor(e.x0 / CELL), x1 = Math.floor(e.x1 / CELL);
    const y0 = Math.floor(e.y0 / CELL), y1 = Math.floor(e.y1 / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) { broad.push(e); continue; }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = `${x}:${y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(e);
    }
  }
  return (x, y, radius = 0) => {
    const found = new Set(broad);
    for (let a = Math.floor((x - radius) / CELL); a <= Math.floor((x + radius) / CELL); a++) {
      for (let b = Math.floor((y - radius) / CELL); b <= Math.floor((y + radius) / CELL); b++) {
        for (const e of cells.get(`${a}:${b}`) || []) found.add(e);
      }
    }
    return [...found].filter((e) => x + radius >= e.x0 && x - radius <= e.x1 && y + radius >= e.y0 && y - radius <= e.y1);
  };
}

function segmentDistance(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

function contains(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (segmentDistance(x, y, a, b) < 0.01) return true;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function normal(pts) {
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[0], b = pts[i], c = pts[i + 1];
    const n = { x: (b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y), y: (b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z), z: (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x) };
    const len = Math.hypot(n.x, n.y, n.z);
    if (len > 0.01) return { x: n.x / len, y: n.y / len, z: n.z / len };
  }
  return { x: 0, y: 0, z: 0 };
}

function surfaceZ(e, x, y) {
  const a = e.pts[0];
  return a.z - (e.n.x * (x - a.x) + e.n.y * (y - a.y)) / e.n.z;
}

// Индекс собирается один раз на сцену, а не при каждом кадре движения.
export function walkWorld(faces, ground = () => 0) {
  const surfaces = [], barriers = [], floors = [];
  for (const face of faces) {
    const pts = face.pts;
    if (!pts?.length || ['massUnder', 'massLine', 'massVoid', 'boundary', 'landscape-water', 'landscape-light'].includes(face.kind)) continue;
    // Двери проходимы; стекло окон остаётся препятствием.
    if (face.openingId && !face.entranceId && (face.kind !== 'glass' || face.openingKind === 'door')) continue;
    // Створки в прогулке проходимы, стойки сохраняют физический габарит.
    if (face.siteEntryId && !face.entryPost) continue;
    const n = normal(pts);
    const bounds = { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
    if (Math.abs(n.z) > 0.05) {
      const e = { ...bounds, pts, n, up: (face.normal?.z ?? n.z) > 0.5, kind: face.kind, level: face.level, roomId: face.roomId };
      surfaces.push(e);
      if (face.kind === 'floor') floors.push(e);
    } else {
      let a = pts[0], b = pts[0], longest = 0;
      for (const p of pts) for (const q of pts) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > longest) { a = p; b = q; longest = d; }
      }
      if (longest > 0) barriers.push({ ...bounds, a, b, z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)) });
    }
  }
  const atSurface = spatialIndex(surfaces), atBarrier = spatialIndex(barriers);
  const support = (x, y, maxZ) => {
    const terrain = ground?.(x, y) ?? 0;
    let z = terrain <= maxZ + EPS ? terrain : -Infinity;
    for (const e of atSurface(x, y)) {
      if (!e.up || !contains(e.pts, x, y)) continue;
      const h = surfaceZ(e, x, y);
      if (h <= maxZ + EPS) z = Math.max(z, h);
    }
    return z;
  };
  const blocked = (x, y, z) => {
    if ((ground?.(x, y) ?? 0) > z + WALK_STEP) return true;
    for (const e of atBarrier(x, y, WALK_RADIUS)) {
      if (e.z1 <= z + WALK_STEP + EPS || e.z0 >= z + WALK_HEIGHT - EPS) continue;
      if (segmentDistance(x, y, e.a, e.b) < WALK_RADIUS) return true;
    }
    for (const e of atSurface(x, y)) {
      if (!contains(e.pts, x, y)) continue;
      const h = surfaceZ(e, x, y);
      if (h > z + WALK_STEP + EPS && h < z + WALK_HEIGHT - EPS) return true;
    }
    return false;
  };
  return { support, blocked, floors, ground: (x, y) => ground?.(x, y) ?? 0 };
}

export function walkStart(world, project = {}) {
  const boundary = (project.site?.boundary || []).map((p) => toLocal(project.building, p));
  const floors = world.floors;
  const center = floors.length ? {
    x: (Math.min(...floors.map((f) => f.x0)) + Math.max(...floors.map((f) => f.x1))) / 2,
    y: (Math.min(...floors.map((f) => f.y0)) + Math.max(...floors.map((f) => f.y1))) / 2,
  } : { x: 0, y: 0 };
  const anchors = [];
  const entries = [...siteEntries(project.site)].sort((a, b) => Number(b.kind === 'wicket') - Number(a.kind === 'wicket'));
  for (const e of entries) {
    const part = entryParts(e).find((p) => p.kind === 'wicket') || entryParts(e)[0];
    const rad = (e.dir ?? e.angle ?? 0) * Math.PI / 180;
    anchors.push(toLocal(project.building, { x: e.x + Math.sin(rad) * part.offset, y: e.y - Math.cos(rad) * part.offset }));
  }
  const starts = [];
  if (boundary.length >= 3) {
    const edges = boundary.map((a, i) => {
      const b = boundary[(i + 1) % boundary.length], len = Math.hypot(b.x-a.x, b.y-a.y);
      if (len < 1) return null;
      let nx = -(b.y-a.y)/len, ny = (b.x-a.x)/len;
      const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
      if (contains(boundary, mid.x+nx*10, mid.y+ny*10)) { nx = -nx; ny = -ny; }
      return { a, b, len, nx, ny, mid };
    }).filter(Boolean);
    for (const anchor of anchors) {
      const edge = [...edges].sort((a, b) => segmentDistance(anchor.x, anchor.y, a.a, a.b) - segmentDistance(anchor.x, anchor.y, b.a, b.b))[0];
      if (!edge) continue;
      const { a, b, len } = edge;
      const t = Math.max(0, Math.min(1, ((anchor.x-a.x)*(b.x-a.x)+(anchor.y-a.y)*(b.y-a.y))/(len*len)));
      starts.push({ ...edge, target: { x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t } });
    }
    edges.sort((a, b) => Math.hypot(a.mid.x-center.x, a.mid.y-center.y) - Math.hypot(b.mid.x-center.x, b.mid.y-center.y));
    starts.push(...edges.map((e) => ({ ...e, target: e.mid })));
  } else {
    // Пока границы нет, начинаем снаружи габарита дома.
    const y = floors.length ? Math.max(...floors.map((f) => f.y1)) + 500 : center.y;
    starts.push({ target: { x: center.x, y }, nx: 0, ny: 1 });
  }
  for (const start of starts) {
    for (const distance of [1200, 1800, 2500, 3500, 5000]) for (const side of [0, -600, 600, -1200, 1200]) {
      const x = start.target.x + start.nx*distance - start.ny*side;
      const y = start.target.y + start.ny*distance + start.nx*side;
      if (boundary.length >= 3 && contains(boundary, x, y)) continue;
      const z = world.support(x, y, world.ground(x, y) + WALK_STEP);
      if (Number.isFinite(z) && !world.blocked(x, y, z)) return {
        x, y, z, viewZ: z, velocityZ: 0,
        yaw: Math.atan2(start.target.y-y, x-start.target.x),
      };
    }
  }
  return null;
}

// Физические стопы держатся на проступи, взгляд догоняет её отметку плавно.
export function smoothWalkHeight(player, dt) {
  if (!Number.isFinite(player.viewZ)) player.viewZ = player.z;
  player.viewZ += (player.z - player.viewZ) * (1 - Math.exp(-14 * dt));
  if (Math.abs(player.z - player.viewZ) < 0.5) player.viewZ = player.z;
  return player.viewZ !== player.z;
}

export function walkDirection(yaw, forward, right) {
  const length = Math.max(1, Math.hypot(forward, right));
  return { x: (-Math.cos(yaw)*forward - Math.sin(yaw)*right) / length, y: (Math.sin(yaw)*forward - Math.cos(yaw)*right) / length };
}

export function stepWalk(world, player, dx, dy, dt) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 50));
  for (let i = 0; i < steps; i++) {
    const move = (x, y) => {
      const floor = world.support(x, y, player.z + WALK_STEP);
      const z = Math.max(player.z, floor);
      if (!world.blocked(x, y, z)) { player.x = x; player.y = y; player.z = z; return true; }
      return false;
    };
    if (!move(player.x + dx / steps, player.y + dy / steps)) {
      move(player.x + dx / steps, player.y);
      move(player.x, player.y + dy / steps);
    }
  }
  const floor = world.support(player.x, player.y, player.z + WALK_STEP);
  if (floor < player.z - EPS) {
    player.velocityZ = (player.velocityZ || 0) - 9800 * dt;
    player.z = Math.max(floor, player.z + player.velocityZ * dt);
  } else player.z = floor;
  if (player.z <= floor + EPS) player.velocityZ = 0;
  return Math.abs(player.z - floor) > EPS;
}

export function walkCamera(cam, player) {
  const distance = 1000, cp = Math.cos(cam.pitch);
  cam.projection = 'perspective';
  cam.eyeDist = distance;
  cam.target = { x: player.x - distance * cp * Math.cos(cam.yaw), y: -player.y - distance * cp * Math.sin(cam.yaw), z: (player.viewZ ?? player.z) + WALK_EYE - distance * Math.sin(cam.pitch) };
}

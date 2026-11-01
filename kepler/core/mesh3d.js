// Модель дома для 3D-просмотра. Чистый модуль без DOM.
//
// Грани — многоугольники в осях дома: x, y как на плане (мм, ось Y вниз),
// z — вверх от нуля нижнего этажа. Стены — полосы плана, выдавленные на
// высоту этажа и разрезанные проёмами (под окном — подоконная часть, над
// проёмом — перемычка); в окне — стекло. Полы — цветом типа помещения.
// Участок (по желанию): земля, граница и соседние дома — переведены из
// координат съёмки в оси дома.
//
// face: { pts: [{x,y,z}…], normal: {x,y,z} (наружу), color, alpha?, kind }

import { isOpenRoom, roomType } from './catalog.js';
import { toLocal } from './building.js';
import { levelProject, sortedLevels } from './model.js';
import { neighborRectCorners } from './site.js';
import { deriveWalls, openingRect } from './walls.js';

export const WALL_COLOR = '#ece8e1';
export const GLASS_COLOR = '#8fb8dc';
export const DOOR_COLOR = '#b98a5a';
const FLOOR_COLORS = {
  warm: '#efe1cb', calm: '#d9e0f2', wet: '#d3e8ec', neutral: '#e3e7ec', cool: '#dde1e8', green: '#d9ead3',
};

const v = (x, y, z) => ({ x, y, z });

// Коробка без нижней грани: верх + 4 стороны (нормали наружу).
export function boxFaces(x0, y0, x1, y1, z0, z1, color, kind) {
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5 || z1 - z0 < 0.5) return [];
  return [
    { pts: [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)], normal: v(0, 0, 1), color, kind },
    { pts: [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)], normal: v(0, -1, 0), color, kind },
    { pts: [v(x1, y1, z0), v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1)], normal: v(0, 1, 0), color, kind },
    { pts: [v(x0, y1, z0), v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1)], normal: v(-1, 0, 0), color, kind },
    { pts: [v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)], normal: v(1, 0, 0), color, kind },
  ];
}

// Кусок стены по оси: для горизонтальной стены ось — X, иначе — Y.
function wallPiece(band, orient, a0, a1, z0, z1) {
  return orient === 'h'
    ? boxFaces(a0, band.y, a1, band.y + band.h, z0, z1, WALL_COLOR, 'wall')
    : boxFaces(band.x, a0, band.x + band.w, a1, z0, z1, WALL_COLOR, 'wall');
}

// Стекло (окно) или полотно (дверь) посередине толщины стены, двустороннее.
function paneFace(band, orient, a0, a1, z0, z1, color, alpha, kind) {
  if (orient === 'h') {
    const y = band.y + band.h / 2;
    return { pts: [v(a0, y, z0), v(a1, y, z0), v(a1, y, z1), v(a0, y, z1)], normal: v(0, 1, 0), color, alpha, kind, twoSided: true };
  }
  const x = band.x + band.w / 2;
  return { pts: [v(x, a0, z0), v(x, a1, z0), v(x, a1, z1), v(x, a0, z1)], normal: v(1, 0, 0), color, alpha, kind, twoSided: true };
}

// Стены этажа с проёмами.
function levelWalls(lp, z0, height) {
  const faces = [];
  const walls = deriveWalls(lp);
  const cuts = new Map(); // стена → [{ a0, a1, bottom, top, kind }]
  for (const o of lp.openings) {
    const placed = openingRect(lp, o, walls);
    if (!placed) continue;
    const r = placed.rect;
    const along = placed.wall.orient === 'h' ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
    const bottom = o.kind === 'door' ? 0 : Math.max(0, o.sill ?? 900);
    const top = Math.min(height - 50, bottom + (o.height ?? (o.kind === 'door' ? 2100 : 1500)));
    if (!cuts.has(placed.wall)) cuts.set(placed.wall, []);
    cuts.get(placed.wall).push({ a0: along[0], a1: along[1], bottom, top, kind: o.kind });
  }
  for (const wall of walls) {
    const b = wall.band;
    const orient = wall.kind === 'chamfer' ? 'h' : wall.orient;
    const start = orient === 'h' ? b.x : b.y;
    const end = orient === 'h' ? b.x + b.w : b.y + b.h;
    const holes = (cuts.get(wall) || []).sort((p, q) => p.a0 - q.a0);
    let cursor = start;
    for (const h of holes) {
      const a0 = Math.max(start, h.a0);
      const a1 = Math.min(end, h.a1);
      if (a1 <= a0) continue;
      if (a0 > cursor) faces.push(...wallPiece(b, orient, cursor, a0, z0, z0 + height));
      if (h.bottom > 0) faces.push(...wallPiece(b, orient, a0, a1, z0, z0 + h.bottom));
      if (h.top < height) faces.push(...wallPiece(b, orient, a0, a1, z0 + h.top, z0 + height));
      if (h.kind === 'window') faces.push(paneFace(b, orient, a0, a1, z0 + h.bottom, z0 + h.top, GLASS_COLOR, 0.45, 'glass'));
      cursor = Math.max(cursor, a1);
    }
    if (cursor < end) faces.push(...wallPiece(b, orient, cursor, end, z0, z0 + height));
  }
  return faces;
}

function levelFloors(lp, z) {
  const faces = [];
  // Сначала комнаты верхнего уровня, вложенные — чуть выше (видны поверх).
  const order = [...lp.rooms].sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)));
  for (const r of order) {
    const zz = z + (r.parentId ? 2 : 1);
    const color = FLOOR_COLORS[roomType(r.type)?.tint] || FLOOR_COLORS.neutral;
    faces.push({
      pts: [v(r.x, r.y, zz), v(r.x + r.w, r.y, zz), v(r.x + r.w, r.y + r.h, zz), v(r.x, r.y + r.h, zz)],
      normal: v(0, 0, 1), color, kind: 'floor', roomId: r.id,
    });
  }
  return faces;
}

// Крыша: плоское перекрытие над комнатами верхнего этажа.
function roofFaces(lp, z) {
  const t = lp.settings?.exterior || 250;
  return lp.rooms.filter((r) => !r.parentId && !isOpenRoom(r))
    .flatMap((r) => boxFaces(r.x - t, r.y - t, r.x + r.w + t, r.y + r.h + t, z, z + 250, '#9aa3ad', 'roof'));
}

function siteFaces(project) {
  const faces = [];
  const site = project.site;
  const b = project.building;
  const local = (p) => toLocal(b, p);
  const pts = [...(site?.boundary || []).map(local)];
  for (const level of project.levels) for (const r of level.rooms) pts.push(v(r.x, r.y, 0), v(r.x + r.w, r.y + r.h, 0));
  for (const n of site?.neighbors || []) pts.push(...neighborRectCorners(n).map(local));
  if (!pts.length) return faces;
  const pad = 15000;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  faces.push({ pts: [v(minX, minY, -5), v(maxX, minY, -5), v(maxX, maxY, -5), v(minX, maxY, -5)], normal: v(0, 0, 1), color: '#cfd8c4', kind: 'ground' });
  if (site?.boundary?.length >= 3) {
    // Граница — тонкая полоса чуть над землёй (иначе мерцает при отдалении).
    const loc = site.boundary.map(local);
    for (let i = 0; i < loc.length; i += 1) {
      const a = loc[i];
      const c = loc[(i + 1) % loc.length];
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      const nx = (-(c.y - a.y) / len) * 120;
      const ny = ((c.x - a.x) / len) * 120;
      faces.push({
        pts: [v(a.x - nx, a.y - ny, 20), v(c.x - nx, c.y - ny, 20), v(c.x + nx, c.y + ny, 20), v(a.x + nx, a.y + ny, 20)],
        normal: v(0, 0, 1), color: '#3a4552', kind: 'boundary', twoSided: true,
      });
    }
  }
  for (const n of site?.neighbors || []) {
    const c = neighborRectCorners(n).map(local);
    const h = n.height || 6000;
    // Соседний дом — призма по повёрнутому прямоугольнику.
    faces.push({ pts: c.map((p) => v(p.x, p.y, h)), normal: v(0, 0, 1), color: '#b8bec6', kind: 'neighbor', twoSided: true });
    for (let i = 0; i < 4; i += 1) {
      const a = c[i];
      const d = c[(i + 1) % 4];
      faces.push({ pts: [v(a.x, a.y, 0), v(d.x, d.y, 0), v(d.x, d.y, h), v(a.x, a.y, h)], normal: v(0, 0, 0), color: '#b8bec6', kind: 'neighbor', twoSided: true });
    }
  }
  return faces;
}

// Все грани дома: этажи снизу вверх; roof — крыша над верхним этажом,
// site — земля, граница и соседи.
export function buildHouseMesh(project, { roof = false, site = false } = {}) {
  const faces = [];
  const levels = sortedLevels(project);
  for (const level of levels) {
    const lp = levelProject(project, level.id);
    faces.push(...levelFloors(lp, level.elevation));
    faces.push(...levelWalls(lp, level.elevation, level.height));
  }
  const top = levels[levels.length - 1];
  if (roof && top) faces.push(...roofFaces(levelProject(project, top.id), top.elevation + top.height));
  if (site) faces.push(...siteFaces(project));
  return faces;
}

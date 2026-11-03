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

import { isOpenRoom, isRoundItem, isStructural, roomType } from './catalog.js';
import { toLocal, toWorld } from './building.js';
import { levelProject, sortedLevels } from './model.js';
import { neighborRectCorners } from './site.js';
import { houseTerrain, interpolateZ, terrainModel } from './terrain.js';
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

// Контур конструкции в плане: повёрнутый прямоугольник или 12-угольник.
export function structuralOutline(item) {
  const r = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const local = isRoundItem(item.kind)
    ? Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return { x: (Math.cos(a) * item.w) / 2, y: (Math.sin(a) * item.h) / 2 };
    })
    : [{ x: -item.w / 2, y: -item.h / 2 }, { x: item.w / 2, y: -item.h / 2 }, { x: item.w / 2, y: item.h / 2 }, { x: -item.w / 2, y: item.h / 2 }];
  return local.map((p) => ({ x: item.x + p.x * c - p.y * s, y: item.y + p.x * s + p.y * c }));
}

// Призма над многоугольником: верх и боковые грани (нормали — от центра).
function prismFaces(poly, z0, z1, color, kind) {
  const cx = poly.reduce((t, p) => t + p.x, 0) / poly.length;
  const cy = poly.reduce((t, p) => t + p.y, 0) / poly.length;
  const faces = [{ pts: poly.map((p) => v(p.x, p.y, z1)), normal: v(0, 0, 1), color, kind }];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const len = Math.hypot(nx, ny) || 1;
    faces.push({ pts: [v(a.x, a.y, z0), v(b.x, b.y, z0), v(b.x, b.y, z1), v(a.x, a.y, z1)], normal: v(nx / len, ny / len, 0), color, kind });
  }
  return faces;
}

// Свободные стены и колонны этажа — на всю высоту этажа.
function levelStructures(lp, z0, height) {
  return lp.items.filter((i) => isStructural(i.kind))
    .flatMap((i) => prismFaces(structuralOutline(i), z0, z0 + height, WALL_COLOR, 'wall'));
}

// Крыша: плоское перекрытие над комнатами верхнего этажа.
function roofFaces(lp, z) {
  const t = lp.settings?.exterior || 250;
  return lp.rooms.filter((r) => !r.parentId && !isOpenRoom(r))
    .flatMap((r) => boxFaces(r.x - t, r.y - t, r.x + r.w + t, r.y + r.h + t, z, z + 250, '#9aa3ad', 'roof'));
}

const GROUND_LOW = [0xb9, 0xc9, 0xa6];
const GROUND_HIGH = [0xd9, 0xd2, 0xb4];
const hex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// Рельеф для 3D: функция «отметка в осях дома → z над полом 1 этажа».
// Отметка пола — site.terrain.floorZ или средняя под домом (core/terrain.js).
// scale — вертикальное усиление рельефа (дом не масштабируется).
export function terrainHeightFn(project, scale = 1) {
  const model = terrainModel(project.site?.terrain);
  if (!model?.tris?.length) return null;
  const house = houseTerrain(project, model);
  const avg = model.pts.reduce((t, p) => t + p.z, 0) / model.pts.length;
  const floorZ = house ? house.floorZ
    : (Number.isFinite(project.site.terrain.floorZ) ? project.site.terrain.floorZ : avg);
  const b = project.building;
  const fn = (x, y) => {
    const w = toWorld(b, { x, y });
    const z = interpolateZ(model, w.x, w.y, { clamp: true });
    return ((z ?? floorZ) - floorZ) * scale;
  };
  fn.minRel = (model.minZ - floorZ) * scale;
  fn.maxRel = (model.maxZ - floorZ) * scale;
  return fn;
}

// Поверхность рельефа: регулярная сетка по габариту участка; отметки узлов —
// по триангуляции (вне оболочки отметок — по ближайшему её краю).
function terrainGround(minX, minY, maxX, maxY, hz) {
  const faces = [];
  const span = Math.max(maxX - minX, maxY - minY);
  const cell = Math.max(1000, span / 48);
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell));
  const dx = (maxX - minX) / nx;
  const dy = (maxY - minY) / ny;
  const z = [];
  for (let i = 0; i <= nx; i += 1) {
    z.push([]);
    for (let j = 0; j <= ny; j += 1) z[i].push(hz(minX + i * dx, minY + j * dy) - 5);
  }
  const range = (hz.maxRel - hz.minRel) || 1;
  const color = (zz) => {
    const t = Math.max(0, Math.min(1, (zz - hz.minRel) / range));
    return hex(GROUND_LOW.map((c, k) => c + (GROUND_HIGH[k] - c) * t));
  };
  const tri = (a, b, c) => {
    // Нормаль вверх (в осях дома: y вниз — порядок обхода не важен, берём z>0).
    const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z;
    const vx = c.x - a.x; const vy = c.y - a.y; const vz = c.z - a.z;
    let n = v(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (n.z < 0) n = v(-n.x, -n.y, -n.z);
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    faces.push({ pts: [a, b, c], normal: v(n.x / len, n.y / len, n.z / len), color: color((a.z + b.z + c.z) / 3), kind: 'ground' });
  };
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const p00 = v(minX + i * dx, minY + j * dy, z[i][j]);
      const p10 = v(minX + (i + 1) * dx, minY + j * dy, z[i + 1][j]);
      const p11 = v(minX + (i + 1) * dx, minY + (j + 1) * dy, z[i + 1][j + 1]);
      const p01 = v(minX + i * dx, minY + (j + 1) * dy, z[i][j + 1]);
      tri(p00, p10, p11);
      tri(p00, p11, p01);
    }
  }
  return faces;
}

// «Юбка» (цоколь): если рельеф под домом ниже пола 1 этажа — от рельефа до
// пола по контуру каждой комнаты нижнего этажа (с наружной стеной).
function plinthFaces(project, hz) {
  const faces = [];
  const ground = sortedLevels(project)[0];
  if (!ground) return faces;
  const t = project.settings?.exterior || 250;
  for (const r of ground.rooms.filter((room) => !room.parentId)) {
    const poly = [
      { x: r.x - t, y: r.y - t }, { x: r.x + r.w + t, y: r.y - t },
      { x: r.x + r.w + t, y: r.y + r.h + t }, { x: r.x - t, y: r.y + r.h + t },
    ];
    const samples = [...poly, { x: r.x + r.w / 2, y: r.y + r.h / 2 }];
    const low = Math.min(...samples.map((p) => hz(p.x, p.y)));
    if (low < -20) faces.push(...prismFaces(poly, low - 50, 0, '#a59d92', 'plinth'));
  }
  return faces;
}

function siteFaces(project, { terrainScale = 1 } = {}) {
  const faces = [];
  const site = project.site;
  const b = project.building;
  const local = (p) => toLocal(b, p);
  const hz = terrainHeightFn(project, terrainScale);
  const zAt = (p) => (hz ? hz(p.x, p.y) : 0);
  const pts = [...(site?.boundary || []).map(local)];
  for (const level of project.levels) for (const r of level.rooms) pts.push(v(r.x, r.y, 0), v(r.x + r.w, r.y + r.h, 0));
  for (const n of site?.neighbors || []) pts.push(...neighborRectCorners(n).map(local));
  if (hz) for (const p of site.terrain.points) pts.push(local(p));
  if (!pts.length) return faces;
  const pad = 15000;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  if (hz) faces.push(...terrainGround(minX, minY, maxX, maxY, hz));
  else faces.push({ pts: [v(minX, minY, -5), v(maxX, minY, -5), v(maxX, maxY, -5), v(minX, maxY, -5)], normal: v(0, 0, 1), color: '#cfd8c4', kind: 'ground' });
  if (site?.boundary?.length >= 3) {
    // Граница — тонкая полоса чуть над землёй (иначе мерцает при отдалении).
    // На рельефе ребро режется на куски ≤ 2 м, чтобы полоса шла по земле.
    const loc = site.boundary.map(local);
    for (let i = 0; i < loc.length; i += 1) {
      const a0 = loc[i];
      const c0 = loc[(i + 1) % loc.length];
      const len = Math.hypot(c0.x - a0.x, c0.y - a0.y) || 1;
      const nx = (-(c0.y - a0.y) / len) * 120;
      const ny = ((c0.x - a0.x) / len) * 120;
      const parts = hz ? Math.max(1, Math.ceil(len / 2000)) : 1;
      for (let k = 0; k < parts; k += 1) {
        const a = { x: a0.x + ((c0.x - a0.x) * k) / parts, y: a0.y + ((c0.y - a0.y) * k) / parts };
        const c = { x: a0.x + ((c0.x - a0.x) * (k + 1)) / parts, y: a0.y + ((c0.y - a0.y) * (k + 1)) / parts };
        const za = zAt(a) + 20;
        const zc = zAt(c) + 20;
        faces.push({
          pts: [v(a.x - nx, a.y - ny, za), v(c.x - nx, c.y - ny, zc), v(c.x + nx, c.y + ny, zc), v(a.x + nx, a.y + ny, za)],
          normal: v(0, 0, 1), color: '#3a4552', kind: 'boundary', twoSided: true,
        });
      }
    }
  }
  for (const n of site?.neighbors || []) {
    const c = neighborRectCorners(n).map(local);
    const h = n.height || 6000;
    // Соседний дом — призма по повёрнутому прямоугольнику; на рельефе низ —
    // по самому низкому углу, высота — от земли в центре.
    const z0 = hz ? Math.min(...c.map(zAt)) : 0;
    const zTop = (hz ? zAt(local(n)) : 0) + h;
    faces.push({ pts: c.map((p) => v(p.x, p.y, zTop)), normal: v(0, 0, 1), color: '#b8bec6', kind: 'neighbor', twoSided: true });
    for (let i = 0; i < 4; i += 1) {
      const a = c[i];
      const d = c[(i + 1) % 4];
      faces.push({ pts: [v(a.x, a.y, z0), v(d.x, d.y, z0), v(d.x, d.y, zTop), v(a.x, a.y, zTop)], normal: v(0, 0, 0), color: '#b8bec6', kind: 'neighbor', twoSided: true });
    }
  }
  if (hz) faces.push(...plinthFaces(project, hz));
  return faces;
}

// Все грани дома: этажи снизу вверх; roof — крыша над верхним этажом,
// site — земля (с рельефом, если есть отметки), граница и соседи;
// terrainScale — вертикальное усиление рельефа (1×–5×).
export function buildHouseMesh(project, { roof = false, site = false, terrainScale = 1 } = {}) {
  const faces = [];
  const levels = sortedLevels(project);
  for (const level of levels) {
    const lp = levelProject(project, level.id);
    faces.push(...levelFloors(lp, level.elevation));
    faces.push(...levelWalls(lp, level.elevation, level.height));
    faces.push(...levelStructures(lp, level.elevation, level.height));
  }
  const top = levels[levels.length - 1];
  if (roof && top) faces.push(...roofFaces(levelProject(project, top.id), top.elevation + top.height));
  if (site) faces.push(...siteFaces(project, { terrainScale }));
  return faces;
}

// Ландшафт в цифрах (без DOM): баланс территории участка для ТЭП и
// ведомость озеленения и малых форм (таблица, CSV).
//
// Баланс считается растром: ячейки сетки внутри границы участка получают
// класс по старшинству «дом > вода > твёрдое покрытие > озеленение»;
// перекрытия (крона над газоном, два газона) не считаются дважды. Сумма
// застройка + покрытия + вода + озеленение + «не благоустроено» = участок.

import {
  curbLines, isPathShape, landscapeDef, objectAreaM2, objectLengthM, objectOutline, objectPath, planterInner, planterWall,
  fmtElev, pointAlong, pointInObject, polylineLength, retainingEdges, retainingInfo, stairTreads, stairsInfo, steppingSlabs, toWorld, variantOf,
} from './landscape.js';
import { calloutDxf } from './landscape-callout.js';
import { SECTION_DXF_LAYER, sectionPlanDxfEntities } from './landscape-section.js';
import { plantCsvLines, plantSchedule, plantScheduleDxf } from './landscape-plants.js';
import { LANDSCAPE_NORMS } from './norms.js';
import { buildingFootprint } from './site-check.js';
import { polygonAreaM2 } from './site.js';
import { pointInPolygon } from './zamer/geometry.js';

const RANK = { green: 1, hard: 2, water: 3, building: 4 };

export function landscapeBalance(project, { maxCells = 60000 } = {}) {
  const site = project.site || {};
  const boundary = site.boundary;
  if (!Array.isArray(boundary) || boundary.length < 3) return null;
  const plot = polygonAreaM2(boundary);
  if (!(plot > 0)) return null;
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const W = Math.max(...xs) - minX; const H = Math.max(...ys) - minY;
  const cell = Math.max(100, Math.sqrt((W * H) / maxCells));
  const nx = Math.max(1, Math.ceil(W / cell));
  const ny = Math.max(1, Math.ceil(H / cell));
  const grid = new Uint8Array(nx * ny);
  const paint = (rank, box, test) => {
    const i0 = Math.max(0, Math.floor((box.minX - minX) / cell));
    const i1 = Math.min(nx - 1, Math.floor((box.maxX - minX) / cell));
    const j0 = Math.max(0, Math.floor((box.minY - minY) / cell));
    const j1 = Math.min(ny - 1, Math.floor((box.maxY - minY) / cell));
    for (let j = j0; j <= j1; j += 1) {
      const y = minY + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i += 1) {
        const k = j * nx + i;
        if (grid[k] >= rank) continue;
        if (test({ x: minX + (i + 0.5) * cell, y })) grid[k] = rank;
      }
    }
  };
  const boxOf = (pts) => ({
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
  });
  for (const o of site.landscape?.objects || []) {
    const def = landscapeDef(o.kind);
    if (!def?.surface) continue;
    const out = objectOutline(o, 16);
    if (out.length < 3) continue;
    paint(RANK[def.surface], boxOf(out), (p) => pointInObject(o, p));
  }
  for (const f of buildingFootprint(project)) paint(RANK.building, boxOf(f.corners), (p) => pointInPolygon(p, f.corners));
  const counts = [0, 0, 0, 0, 0];
  let inside = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const p = { x: minX + (i + 0.5) * cell, y: minY + (j + 0.5) * cell };
      if (!pointInPolygon(p, boundary)) continue;
      inside += 1;
      counts[grid[j * nx + i]] += 1;
    }
  }
  const share = (n) => (inside ? n / inside : 0);
  const shares = {
    building: share(counts[4]), hard: share(counts[2]), water: share(counts[3]), green: share(counts[1]), none: share(counts[0]),
  };
  const m2 = Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, v * plot]));
  const minGreen = Number(project.settings?.minGreenShare) > 0 ? Number(project.settings.minGreenShare) : LANDSCAPE_NORMS.minGreenShare;
  return { plot, cell, shares, m2, minGreen, greenOk: shares.green >= minGreen };
}

const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');

// Строки ТЭП: [название, значение] — блок «Благоустройство».
export function balanceRows(b) {
  if (!b) return [];
  const row = (title, key) => [title, `${fmt(b.m2[key])} м² · ${fmt(b.shares[key] * 100)} %`];
  return [
    row('Пятно застройки (баланс)', 'building'),
    row('Твёрдые покрытия', 'hard'),
    row('Водные поверхности', 'water'),
    row('Озеленение', 'green'),
    row('Не благоустроено', 'none'),
    ['Процент озеленения', `${fmt(b.shares.green * 100)} % (ориентир ≥ ${fmt(b.minGreen * 100, 0)} %${b.greenOk ? '' : ' — мало'})`],
  ];
}

// ------------------------------------------------------------ Ведомость

const PIECE_KINDS = new Set(['slab', 'board']);
const CURB_TITLE = { concrete: 'бетон', stone: 'камень', metal: 'сталь', wood: 'дерево' };

// Длина бордюра по периметру хозяина (поле curb), м.
export function hostCurbLengthM(o) {
  return curbLines(o).reduce((s, l) => s + polylineLength(l.pts, l.closed), 0) / 1000;
}

const sizeText = (o, def) => {
  if (o.kind === 'retaining-wall') {
    const ri = retainingInfo(o);
    return `${Math.round(ri.thick)}×${Math.round(ri.height)} мм${ri.parapet > 0 ? `, парапет ${Math.round(ri.parapet)}` : ''}${ri.cap ? ', с капой' : ''}`;
  }
  if (o.kind === 'stairs-out') {
    const st = stairsInfo(o);
    return `${st.steps} ступ. ${Math.round(st.riser)}×${st.tread} мм, марш ${fmt(st.flight / 1000, 2)} м, подъём ${fmt(st.rise / 1000, 2)} м${st.landing ? ', с площадкой' : ''}${st.cheek ? ', с бортами' : ''}`;
  }
  if (o.kind === 'planter-box') return `${fmt(o.w / 1000, 1)} × ${fmt(o.h / 1000, 1)} м, борт ${planterWall(o)}×${Math.round(o.height || 0)} мм`;
  if (o.kind === 'planter-area') return `контур ${fmt(objectLengthM(o), 1)} м, борт ${planterWall(o)}×${Math.round(o.height || 0)} мм`;
  if (def.shape === 'line') return `L ${fmt(objectLengthM(o), 1)} м × ${fmt((o.width || def.h) / 1000, 2)} м`;
  if (def.shape === 'poly') return `контур ${fmt(objectLengthM(o), 1)} м`;
  if (def.lockAspect) return `⌀ ${fmt(o.w / 1000, 1)} м`;
  return `${fmt(o.w / 1000, 1)} × ${fmt(o.h / 1000, 1)} м`;
};

// Позиции: одинаковые тип + вариант + размер — одна строка с количеством.
// { pos, kind, title, variant, group, count, size, area (м²), length (м), unit }.
export function landscapeSchedule(objects) {
  const rows = new Map();
  for (const o of objects || []) {
    const def = landscapeDef(o.kind);
    if (!def || def.shape === 'note') continue; // выноски — не позиции ведомости
    const variant = variantOf(o, def);
    const size = sizeText(o, def);
    const shape = isPathShape(def);
    // Плиты и доски («Разорвать») — одной строкой «N шт» по типу и материалу.
    const piece = PIECE_KINDS.has(o.kind);
    // Подпорные стенки — по материалу и сечению (толщина × высота).
    const wall = o.kind === 'retaining-wall';
    const key = wall ? `${o.kind}|${variant?.id}|${size}` : shape || piece ? `${o.kind}|${variant?.id}` : `${o.kind}|${variant?.id}|${size}`;
    if (!rows.has(key)) {
      rows.set(key, {
        kind: o.kind, title: def.title, variant: def.variants.length > 1 ? variant?.title || '' : '', group: def.group, cat: def.cat,
        count: 0, size: shape && !wall ? '' : size, sizes: new Set(), area: 0, length: 0, unit: def.shape === 'line' ? 'м' : def.shape === 'poly' ? 'м²' : 'шт',
        ...(wall ? { volume: 0 } : {}),
      });
    }
    const r = rows.get(key);
    r.count += 1;
    if (piece) r.sizes.add(size);
    if (wall) r.volume += retainingInfo(o).volume;
    if ((def.cover || shape) && !wall) r.area += objectAreaM2(o);
    if (def.shape === 'line') r.length += objectLengthM(o);
    if (o.curb) {
      // Бордюр по периметру дорожки/площади — отдельной строкой (длина).
      const ck = `curb-host|${o.curb.variant}|${o.curb.width}|${o.curb.height}`;
      if (!rows.has(ck)) {
        rows.set(ck, {
          kind: 'curb', title: 'Бордюр по периметру', variant: CURB_TITLE[o.curb.variant] || '', group: 'Лестницы и бордюры', cat: 'site',
          count: 0, size: `${o.curb.width}×${o.curb.height} мм`, sizes: new Set(), area: 0, length: 0, unit: 'м',
        });
      }
      const c = rows.get(ck);
      c.count += 1;
      c.length += hostCurbLengthM(o);
    }
  }
  const order = (r) => (r.cat === 'green' ? 0 : 1);
  return [...rows.values()]
    .sort((a, b) => order(a) - order(b) || a.group.localeCompare(b.group, 'ru') || a.title.localeCompare(b.title, 'ru'))
    .map(({ sizes, ...r }, i) => ({
      pos: i + 1, ...r,
      // Объём стенок — в графе «Размер» (колонки CSV прежние).
      size: sizes.size > 1 ? 'разные' : r.volume != null ? `${r.size}, V ${fmt(r.volume, 2)} м³` : r.size,
    }));
}

// Подпорные стенки для ТЭП: число, длина (м), объём кладки/бетона (м³).
export function retainingTotals(objects) {
  let count = 0; let length = 0; let volume = 0;
  for (const o of objects || []) {
    if (o.kind !== 'retaining-wall') continue;
    const ri = retainingInfo(o);
    count += 1; length += ri.length / 1000; volume += ri.volume;
  }
  return { count, length, volume };
}

export function retainingRows(t) {
  if (!t?.count) return [];
  return [['Подпорные стенки', `${fmt(t.length, 1)} м · ${fmt(t.volume, 2)} м³ (${t.count} шт.)`]];
}

export function buildLandscapeCsv(project) {
  const rows = landscapeSchedule(project.site?.landscape?.objects || []);
  const num = (v, d = 2) => v.toFixed(d).replace('.', ',');
  const cell = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Поз.', 'Раздел', 'Группа', 'Наименование', 'Вариант', 'Кол-во', 'Ед.', 'Размер', 'Длина, м', 'Площадь, м²'].join(';')];
  for (const r of rows) {
    lines.push([
      r.pos, r.cat === 'green' ? 'Озеленение' : 'Малые формы и покрытия', cell(r.group), cell(r.title), cell(r.variant),
      r.count, 'шт', cell(r.size), r.length ? num(r.length) : '', r.area ? num(r.area) : '',
    ].join(';'));
  }
  const b = landscapeBalance(project);
  if (b) {
    lines.push('');
    for (const [k, v] of balanceRows(b)) lines.push(['', '', '', cell(k), '', '', '', '', '', cell(v)].join(';'));
  }
  // Ведомость растений (core/landscape-plants.js) — отдельным блоком.
  const land = project.site?.landscape || {};
  lines.push(...plantCsvLines(plantSchedule(land.objects, land.plants), cell));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ------------------------------------------------------------ DXF генплана

// Слои ландшафта в DXF генплана (ключ — для entity.layer, имя — в файле).
export const LANDSCAPE_DXF_LAYERS = [
  { key: 'lsTrees', name: 'LANDSCAPE_TREES', color: 3 },
  { key: 'lsPaths', name: 'LANDSCAPE_PATHS', color: 8 },
  { key: 'lsAreas', name: 'LANDSCAPE_AREAS', color: 52 },
  { key: 'lsFurniture', name: 'LANDSCAPE_FURNITURE', color: 30 },
  { key: 'lsWalls', name: 'LANDSCAPE_WALLS', color: 9 },
  { key: 'lsNotes', name: 'LANDSCAPE_NOTES', color: 7 },
  { key: 'lsPlantTable', name: 'LANDSCAPE_PLANT_SCHEDULE', color: 7 },
  SECTION_DXF_LAYER,
];

const closedLines = (pts, layer, closed = true) => {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % n];
    out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return out;
};

// Сущности ландшафта в координатах участка (как граница и соседи):
// кроны — окружности (+ ствол), дорожки — контуры полос (плиты-ступени —
// каждая плита), площадки и покрытия — контуры, малые формы — габариты.
export function landscapeDxfEntities(site) {
  const out = [];
  for (const o of site?.landscape?.objects || []) {
    const def = landscapeDef(o.kind);
    if (!def) continue;
    // Выноска: линия указателя, полка, знак и текст — слой LANDSCAPE_NOTES.
    if (def.shape === 'note') { out.push(...calloutDxf(o, 'lsNotes')); continue; }
    const plant = def.group === 'Деревья' || def.group === 'Кустарники' || def.kind === 'grass-clump';
    if (def.shape === 'point') {
      const layer = plant ? 'lsTrees' : 'lsFurniture';
      out.push({ type: 'circle', layer, cx: o.x, cy: o.y, radius: o.w / 2 });
      if (def.group === 'Деревья') out.push({ type: 'circle', layer, cx: o.x, cy: o.y, radius: Math.max(80, o.w * 0.04) });
      continue;
    }
    if (o.curb) {
      for (const l of curbLines(o)) out.push(...closedLines(l.pts, 'lsPaths', l.closed));
    }
    // Отметка уровня площадки/лестницы — текстом у центра (необязательное поле elev).
    if (Number.isFinite(o.elev) && o.kind !== 'retaining-wall') {
      const text = o.kind === 'stairs-out' && Number.isFinite(o.elevTo) ? `${fmtElev(o.elev)} / ${fmtElev(o.elevTo)}` : fmtElev(o.elev);
      out.push({ type: 'text', layer: 'lsAreas', x: o.x, y: o.y, height: 250, text });
    }
    if (o.kind === 'stairs-out') {
      // Лестница: габарит + рёбра ступеней.
      out.push(...closedLines(objectOutline(o), 'lsPaths'));
      const st = stairsInfo(o);
      for (const { bottom: y } of stairTreads(o, st).slice(1)) {
        const a = toWorld(o, -o.w / 2 + st.cheek, y); const b = toWorld(o, o.w / 2 - st.cheek, y);
        out.push({ type: 'line', layer: 'lsPaths', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
      continue;
    }
    if (o.kind === 'planter-box' || o.kind === 'planter-area') {
      // Короб: наружный и внутренний контуры борта.
      out.push(...closedLines(objectOutline(o, 24), 'lsAreas'));
      out.push(...closedLines(planterInner(o), 'lsAreas'));
      continue;
    }
    if (o.kind === 'curb') { out.push(...closedLines(objectOutline(o), 'lsPaths')); continue; }
    if (o.kind === 'retaining-wall') { out.push(...retainingDxf(o)); continue; }
    if (o.kind === 'path') {
      if (o.variant === 'stepping') {
        for (const sl of steppingSlabsOf(o)) out.push(...closedLines(sl, 'lsPaths'));
      } else {
        out.push(...closedLines(objectOutline(o), 'lsPaths'));
      }
      continue;
    }
    if (def.shape === 'line') {
      out.push(...closedLines(objectPath(o), plant || o.variant === 'hedge' ? 'lsTrees' : 'lsFurniture', false));
      continue;
    }
    if (def.group === 'Дорожки') { out.push(...closedLines(objectOutline(o, 24), 'lsPaths')); continue; }
    const layer = plant ? 'lsTrees' : def.shape === 'poly' || def.layer === 'ground' || def.surface === 'water' ? 'lsAreas' : 'lsFurniture';
    out.push(...closedLines(objectOutline(o, 24), layer));
  }
  out.push(...plantTableDxf(site));
  // Линии разрезов (необязательное поле sections) — слой LANDSCAPE_SECTION.
  out.push(...sectionPlanDxfEntities(site?.landscape?.sections || []));
  return out;
}

// Ведомость растений текстом справа от участка (ниже стрелки севера).
function plantTableDxf(site) {
  const land = site?.landscape || {};
  const sch = plantSchedule(land.objects, land.plants);
  if (!sch.rows.length) return [];
  const pts = site.boundary?.length >= 3 ? site.boundary : (land.objects || []).map((o) => ({ x: o.x, y: o.y }));
  const x = Math.max(...pts.map((p) => p.x)) + 8000;
  const y = Math.min(...pts.map((p) => p.y)) + 7000;
  return plantScheduleDxf(sch, x, y, 'lsPlantTable');
}

// Подпорная стенка в DXF: двойная линия (кромки) + торцы, штрихи от кромки
// низа в сторону низа (условный знак откоса/стенки) через ~600 мм,
// длинный/короткий поочерёдно; отметка низа — текстом.
function retainingDxf(o) {
  const out = [];
  const e = retainingEdges(o);
  out.push(...closedLines(e.upper, 'lsWalls', false), ...closedLines(e.lower, 'lsWalls', false));
  for (const k of [0, e.upper.length - 1]) {
    const a = e.upper[k]; const b = e.lower[k === 0 ? 0 : e.lower.length - 1];
    if (a && b) out.push({ type: 'line', layer: 'lsWalls', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  const ri = retainingInfo(o);
  const total = polylineLength(e.lower);
  const tick = Math.max(150, Math.min(600, ri.height * 0.4));
  let i = 0;
  for (let s = 300; s < total - 100; s += 600, i += 1) {
    const p = pointAlong(e.lower, s);
    const nx = -Math.sin(p.angle) * e.lowSign; const ny = Math.cos(p.angle) * e.lowSign;
    const len = i % 2 ? tick * 0.5 : tick;
    out.push({ type: 'line', layer: 'lsWalls', x1: p.x, y1: p.y, x2: p.x + nx * len, y2: p.y + ny * len });
  }
  if (Number.isFinite(o.elev)) {
    const m = pointAlong(e.upper, polylineLength(e.upper) / 2);
    out.push({ type: 'text', layer: 'lsWalls', x: m.x, y: m.y, height: 250, text: `${fmtElev(o.elev)} / ${fmtElev(o.elev + ri.height)}` });
  }
  return out;
}

function steppingSlabsOf(o) {
  return steppingSlabs(o).map((s) => {
    const c = Math.cos(s.angle); const n = Math.sin(s.angle);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([kx, ky]) => {
      const x = (kx * s.along) / 2; const y = (ky * s.across) / 2;
      return { x: s.x + x * c - y * n, y: s.y + x * n + y * c };
    });
  });
}

// Миграция kepler-plan/6 → kepler-plan/7 (docs/architecture-v7.md, «Миграция»).
// Чистый модуль. Старые версии (1–5) сначала доводятся до 6 обычным
// путём core/model.js (projectFromData), затем fromV6.
//
//  • комната → блок: x/y — начало, форма rect {w,h} или poly (outline / Г с
//    вырезом notch); у съеденной (room.eatBase) берётся НОМИНАЛЬНАЯ форма
//    eatBase.base — съедание v7 считает на лету, «память» не переносится;
//    z = индекс в rooms (в v6 порядок массива = «кто выше»);
//  • ручные стены level.walls[] → walls (axis.a/b → from/to);
//  • wallOverrides: 's|a|b' → pairs['a|b'], 'e|room|side' → block.edges[i];
//  • проём комнаты (roomId, side, offset) → проём на ребре блока
//    host { blockId, edge, offset }; точка ищется на номинальной форме своей
//    комнаты, иначе на ребре другого блока (проём на срезе съеденной
//    комнаты стоит на общей стене — переезжает на ребро верхнего блока,
//    swingIn инвертируется); hingeStart — относительно направления ребра;
//  • проём на ручной стене (host { wallId, t }) — как есть;
//  • мебель — как есть (мировая); site, building, variants — как есть.

import { projectFromData } from '../model.js';
import { roomBoundaryEdges, roomPolygon } from '../room-shape.js';
import { ringArea } from '../geom/poly.js';
import { SCHEMA7, blockEdges, pairKey } from './model.js';

const DROP_ROOM_KEYS = new Set(['x', 'y', 'w', 'h', 'outline', 'notch', 'eatBase', 'bound', 'poly', 'holes', 'boundIssue']);

function nominalRoom(room) {
  const base = room.eatBase?.base;
  if (!base) return room;
  const r = { ...room, x: base.x, y: base.y, w: base.w, h: base.h };
  delete r.outline; delete r.notch;
  if (base.outline) r.outline = base.outline.map((p) => ({ ...p }));
  if (base.notch) r.notch = { ...base.notch };
  return r;
}

function roomToBlock(room, index) {
  const nom = nominalRoom(room);
  const block = { id: room.id, name: room.name, type: room.type };
  for (const [k, v] of Object.entries(room)) if (!DROP_ROOM_KEYS.has(k) && !(k in block)) block[k] = v;
  block.x = nom.x; block.y = nom.y; block.rotation = 0; block.z = index;
  block.parentId = room.parentId || null;
  if (!nom.outline && !nom.notch) block.shape = { kind: 'rect', w: nom.w, h: nom.h };
  else {
    let pts = roomPolygon(nom).map((p) => ({ x: p.x - nom.x, y: p.y - nom.y }));
    if (ringArea(pts) < 0) pts = pts.reverse();
    block.shape = { kind: 'poly', pts };
  }
  return block;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Ближайшее номинальное ребро блока к точке P: { edge, offset, d, dir }.
function edgeNear(block, P) {
  let best = null;
  for (const e of blockEdges(block)) {
    const len = dist(e.a, e.b);
    if (len < 1) continue;
    const dir = { x: (e.b.x - e.a.x) / len, y: (e.b.y - e.a.y) / len };
    const s = (P.x - e.a.x) * dir.x + (P.y - e.a.y) * dir.y;
    if (s < -0.5 || s > len + 0.5) continue;
    const d = Math.abs((P.x - e.a.x) * dir.y - (P.y - e.a.y) * dir.x);
    if (!best || d < best.d) best = { edge: e.index, offset: Math.max(0, Math.min(len, s)), d, dir };
  }
  return best;
}

// Сторона комнаты v6 → { orient, edge } (numeric 0–3 или id ребра контура).
function sideOf(room, side) {
  if (side === 0) return { orient: 'h', edge: room.y };
  if (side === 1) return { orient: 'v', edge: room.x + room.w };
  if (side === 2) return { orient: 'h', edge: room.y + room.h };
  if (side === 3) return { orient: 'v', edge: room.x };
  return roomBoundaryEdges(room).find((e) => e.side === side) || null;
}

function openingPoint(room, o) {
  const e = sideOf(room, o.side);
  if (!e) return null;
  const along = (e.orient === 'h' ? room.x : room.y) + Number(o.offset);
  return { point: e.orient === 'h' ? { x: along, y: e.edge } : { x: e.edge, y: along }, canon: e.orient === 'h' ? { x: 1, y: 0 } : { x: 0, y: 1 } };
}

function migrateOpening(o, rooms, blocks, warnings) {
  if (o.host?.wallId) return { ...o, host: { wallId: o.host.wallId, t: Number(o.host.t) } };
  const room = rooms.find((r) => r.id === o.roomId);
  const pp = room ? openingPoint(room, o) : null;
  if (!pp) { warnings.push(`проём ${o.id}: нет комнаты или стороны — пропущен`); return null; }
  const own = blocks.find((b) => b.id === room.id);
  let host = own ? edgeNear(own, pp.point) : null;
  let hostBlock = own;
  if (!host || host.d > 1) {
    host = null;
    for (const b of blocks) {
      if (b === own) continue;
      const h = edgeNear(b, pp.point);
      if (h && h.d <= 460 && (!host || h.d < host.d)) { host = h; hostBlock = b; }
    }
  }
  if (!host) { warnings.push(`проём ${o.id}: не найдено ребро блока — пропущен`); return null; }
  const { roomId: _r, side: _s, offset: _o, ...rest } = o;
  const out = { ...rest, host: { blockId: hostBlock.id, edge: host.edge, offset: Math.round(host.offset * 2) / 2 } };
  if (hostBlock !== own && 'swingIn' in o) out.swingIn = !o.swingIn;
  if (pp.canon.x * host.dir.x + pp.canon.y * host.dir.y < 0 && 'hingeStart' in o) out.hingeStart = !o.hingeStart;
  return out;
}

// Порядок «кто выше»: индекс в rooms, но съевшая (eatBase.by) — всегда выше
// съеденной (в v6 съеденная не уходила вниз по массиву). Топологическая
// сортировка с наименьшим индексом первым; цикл — остаток по индексу.
function zOrder(rooms) {
  const idx = new Map(rooms.map((r, i) => [r.id, i]));
  const above = rooms.map(() => new Set());
  const below = rooms.map(() => 0);
  rooms.forEach((r, i) => {
    for (const id of r.eatBase?.by || []) {
      const j = idx.get(id);
      if (j == null || j === i || above[i].has(j)) continue;
      above[i].add(j); below[j] += 1;
    }
  });
  const z = new Array(rooms.length);
  const done = new Set();
  let n = 0;
  while (n < rooms.length) {
    let pick = rooms.findIndex((_, i) => !done.has(i) && below[i] === 0);
    if (pick < 0) pick = rooms.findIndex((_, i) => !done.has(i));
    done.add(pick); z[pick] = n; n += 1;
    for (const j of above[pick]) below[j] -= 1;
  }
  return z;
}

function migrateLevel(l, settings, warnings) {
  const rooms = l.rooms || [];
  const z = zOrder(rooms);
  const blocks = rooms.map((r, i) => roomToBlock(r, z[i]));
  const pairs = {};
  const legacy = {};
  for (const [k, v] of Object.entries(l.wallOverrides || {})) {
    const parts = k.split('|');
    if (parts[0] === 's' && parts.length === 3) { pairs[pairKey(parts[1], parts[2])] = { ...v }; continue; }
    if (parts[0] === 'e' && parts.length === 3) {
      const room = rooms.find((r) => r.id === parts[1]);
      const block = blocks.find((b) => b.id === parts[1]);
      const side = /^\d+$/.test(parts[2]) ? Number(parts[2]) : parts[2];
      const e = room && block ? roomBoundaryEdges(room).find((x) => x.side === side) : null;
      if (e) {
        const mid = (e.from + e.to) / 2;
        const P = e.orient === 'h' ? { x: mid, y: e.edge } : { x: e.edge, y: mid };
        const hit = edgeNear(block, P);
        if (hit && hit.d <= 1) { block.edges = { ...(block.edges || {}), [hit.edge]: { ...v } }; continue; }
      }
    }
    legacy[k] = v;
  }
  const walls = (l.walls || []).map((w) => {
    const { axis, ...rest } = w;
    return { ...rest, from: { x: axis.a.x, y: axis.a.y }, to: { x: axis.b.x, y: axis.b.y } };
  });
  const openings = (l.openings || []).map((o) => migrateOpening(o, rooms, blocks, warnings)).filter(Boolean);
  const out = {
    id: l.id, name: l.name, elevation: l.elevation, height: l.height,
    blocks, walls, openings, items: (l.items || []).map((it) => ({ ...it })), seeds: [], pairs,
  };
  if (Object.keys(legacy).length) out.legacyWallOverrides = legacy;
  return out;
}

// v6-проект (объект после projectFromData / createProject) → v7.
export function fromV6(project, { warnings = [] } = {}) {
  const src = JSON.parse(JSON.stringify({ ...project, levels: project.levels }));
  const { wallsEngine: _e, ...settings } = src.settings || {};
  return {
    schema: SCHEMA7,
    revision: Number(src.revision) || 0,
    name: src.name,
    settings,
    building: src.building || { rotation: 0, origin: { x: 0, y: 0 } },
    site: src.site ?? null,
    variants: src.variants || [],
    levels: (src.levels || []).map((l) => migrateLevel(l, settings, warnings)),
    activeLevel: src.activeLevel,
  };
}

// Любой поддерживаемый JSON (v1–v6) → v7.
export function fromAny(raw, opts) {
  return fromV6(projectFromData(raw), opts);
}

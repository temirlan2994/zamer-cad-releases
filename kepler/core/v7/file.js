// Файл проекта kepler-plan/7 при модели приложения v6 (мост этапа 2,
// docs/v7-stage2-plan.md, срез 2). Чистый модуль.
//
//  • fileV7(project) — проект приложения (v6 в памяти) → данные файла v7:
//    сначала на копии снимается производное съедание (номиналы, «сироты»-
//    проёмы возвращаются — core/v7/eat-bridge.js), затем fromV6. Ключи
//    проекта и этажей, которых не знает v7 (подложка, ландшафт, листы…),
//    переносятся как есть.
//  • toV6Data(data) — данные файла v7 → данные kepler-plan/6 для обычного
//    projectFromData: блок → комната (порядок массива = (z, id)), форма —
//    прямоугольник или контур (поворот 90° — в контур), проём на ребре
//    блока → сторона/отступ комнаты, pairs/edges → wallOverrides, ось
//    стены from/to → axis.a/b. Съедание пересчитывает projectFromData.

import { nominalizeLevel } from './eat-bridge.js';
import { fromV6 } from './migrate.js';
import { SCHEMA7, blockEdges, blockOrder, blockRing } from './model.js';
import { roomBoundaryEdges } from '../room-shape.js';

const V7_TOP = new Set(['schema', 'revision', 'name', 'settings', 'building', 'site', 'variants', 'levels', 'activeLevel']);
const V7_LEVEL = new Set(['id', 'name', 'elevation', 'height', 'blocks', 'walls', 'openings', 'items', 'seeds', 'pairs', 'legacyWallOverrides']);
const V6_LEVEL_CONVERTED = new Set(['rooms', 'walls', 'openings', 'items', 'wallOverrides']);

export const isV7Data = (data) => data?.schema === SCHEMA7;

// Проект приложения → объект файла kepler-plan/7.
export function fileV7(project, { warnings = [] } = {}) {
  const src = JSON.parse(JSON.stringify({ ...project, levels: project.levels }));
  for (const l of src.levels || []) {
    if (!Array.isArray(l.openings)) l.openings = [];
    if (Array.isArray(l.rooms)) nominalizeLevel(l);
  }
  const out = fromV6(src, { warnings });
  if (src.settings?.wallsEngine) out.settings.wallsEngine = src.settings.wallsEngine;
  for (const [k, v] of Object.entries(src)) if (!V7_TOP.has(k) && !(k in out)) out[k] = v;
  out.levels.forEach((l, i) => {
    for (const [k, v] of Object.entries(src.levels[i] || {})) {
      if (!V7_LEVEL.has(k) && !V6_LEVEL_CONVERTED.has(k) && !(k in l)) l[k] = v;
    }
  });
  return out;
}

const DROP_BLOCK_KEYS = new Set(['shape', 'x', 'y', 'rotation', 'z', 'edges']);

function blockToRoom(block, warnings) {
  const room = {};
  for (const [k, v] of Object.entries(block)) if (!DROP_BLOCK_KEYS.has(k)) room[k] = v;
  const ring = blockRing(block);
  const xs = ring.map((p) => p.x); const ys = ring.map((p) => p.y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  room.x = x; room.y = y; room.w = Math.max(...xs) - x; room.h = Math.max(...ys) - y;
  const rect = block.shape?.kind !== 'poly' && !((Number(block.rotation) || 0) % 360);
  if (!rect) {
    let pts = ring.map((p) => ({ x: p.x - x, y: p.y - y }));
    let s = 0;
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; });
    if (s < 0) pts = pts.reverse();
    const ortho = pts.every((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5; });
    if (!ortho) warnings.push(`блок ${block.id}: косые рёбра — комната по габариту`);
    else if (!(pts.length === 4 && pts.every((p) => (Math.abs(p.x) < 0.5 || Math.abs(p.x - room.w) < 0.5) && (Math.abs(p.y) < 0.5 || Math.abs(p.y - room.h) < 0.5)))) room.outline = pts;
    if (block.shape?.holes?.length) warnings.push(`блок ${block.id}: дыры формы не переносятся`);
  }
  return room;
}

// Точка на ребре номинальной формы блока → { side, offset, flip } комнаты v6.
function edgeToSide(room, block, edge, offset) {
  const e = blockEdges(block)[edge];
  if (!e) return null;
  const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  if (len < 1) return null;
  const dir = { x: (e.b.x - e.a.x) / len, y: (e.b.y - e.a.y) / len };
  const P = { x: e.a.x + dir.x * offset, y: e.a.y + dir.y * offset };
  const orient = Math.abs(dir.y) < 1e-6 ? 'h' : Math.abs(dir.x) < 1e-6 ? 'v' : null;
  if (!orient) return null;
  const hit = roomBoundaryEdges(room).find((s) => s.orient === orient &&
    Math.abs((orient === 'h' ? P.y : P.x) - s.edge) < 0.5 &&
    (orient === 'h' ? P.x : P.y) >= s.from - 0.5 && (orient === 'h' ? P.x : P.y) <= s.to + 0.5);
  if (!hit) return null;
  const along = orient === 'h' ? P.x - room.x : P.y - room.y;
  return { side: hit.side, offset: Math.round(along * 2) / 2, flip: (orient === 'h' ? dir.x : dir.y) < 0 };
}

function levelToV6(l, warnings) {
  const out = {};
  for (const [k, v] of Object.entries(l)) if (!V7_LEVEL.has(k)) out[k] = v;
  Object.assign(out, { id: l.id, name: l.name, elevation: l.elevation, height: l.height });
  const blocks = [...(l.blocks || [])].sort(blockOrder);
  const rooms = blocks.map((b) => blockToRoom(b, warnings));
  const roomOf = new Map(rooms.map((r) => [r.id, r]));
  const wallOverrides = { ...(l.legacyWallOverrides || {}) };
  for (const [k, v] of Object.entries(l.pairs || {})) {
    const [a, b] = k.split('|');
    wallOverrides[a < b ? `s|${a}|${b}` : `s|${b}|${a}`] = { ...v };
  }
  for (const b of blocks) {
    for (const [i, v] of Object.entries(b.edges || {})) {
      const e = blockEdges(b)[Number(i)];
      if (!e) continue;
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      const s = edgeToSide(roomOf.get(b.id), b, Number(i), len / 2);
      if (s) wallOverrides[`e|${b.id}|${s.side}`] = { ...v };
    }
  }
  const walls = (l.walls || []).map((w) => {
    const { from, to, ...rest } = w;
    return { ...rest, axis: { a: { x: from.x, y: from.y }, b: { x: to.x, y: to.y } } };
  });
  const openings = [];
  for (const o of l.openings || []) {
    const { host, ...rest } = o;
    if (host?.wallId) { openings.push({ ...rest, host: { wallId: host.wallId, t: Number(host.t) } }); continue; }
    const block = blocks.find((b) => b.id === host?.blockId);
    const room = block && roomOf.get(block.id);
    const s = room ? edgeToSide(room, block, Number(host.edge), Number(host.offset)) : null;
    if (!s) { warnings.push(`проём ${o.id}: ребро блока не найдено — пропущен`); continue; }
    const op = { ...rest, roomId: room.id, side: s.side, offset: s.offset };
    if (s.flip && 'hingeStart' in op) op.hingeStart = !op.hingeStart;
    openings.push(op);
  }
  return { ...out, rooms, openings, items: (l.items || []).map((it) => ({ ...it })), wallOverrides, walls };
}

// Данные файла kepler-plan/7 → данные kepler-plan/6.
export function toV6Data(data, { warnings = [] } = {}) {
  const src = JSON.parse(JSON.stringify(data));
  return { ...src, schema: 'kepler-plan/6', levels: (src.levels || []).map((l) => levelToV6(l, warnings)) };
}

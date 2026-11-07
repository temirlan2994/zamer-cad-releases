// Мост съедания v6 ↔ v7 (docs/v7-stage2-plan.md, срез 1). Чистый модуль.
//
// Приложение пока хранит комнаты в форме v6, но съедание больше не
// «разрушает и запоминает»: истина — номинальные формы (у съеденной —
// room.eatBase.base, у остальных — сама форма) и порядок массива rooms
// (кто позже — тот выше, = z v7). Видимые формы считает core/v7/carve.js
// С НУЛЯ при каждом вызове reconcileEats — результат зависит только от
// номиналов и порядка, а не от истории жестов:
//   • убрали верхнюю — нижняя целая (её номинал не трогали);
//   • сдвинули съеденную — номинал сдвигается с ней, она целая на новом
//     месте (тронутая поднимается наверх);
//   • отмена/повтор — снимки уже согласованы.
// room.eatBase = { base, now, by, openings } — производное (пишется заново
// каждый раз): base — номинал, now — видимая форма (по ней узнаём, что
// съеденную сдвинули), by — кто съел, openings — проёмы нижней, чья стена
// ушла под верхнюю («сироты»: данные целы, вернутся с формой).

import { DEFAULT_PARTITION, isOpenRoom, isShaft } from '../catalog.js';
import { area, buffer, erode, intersection, orientRing, pointInPolygon } from '../geom/poly.js';
import { captureOpeningAnchors, keepOpenings } from '../opening-anchor.js';
import { finalizeRoomOutline } from '../room-shape.js';
import { nestedOuterRect, rectInsideRoomShape } from '../rooms.js';
import { carveLevel } from './carve.js';
import { migrateLevel, zOrder } from './migrate.js';
import { blockGeom, pairGap } from './model.js';

const HIT_MM2 = 100; // как carve.js: меньше — касание

const clone = (o) => JSON.parse(JSON.stringify(o));

export const snapShape = (r) => {
  const o = { x: r.x, y: r.y, w: r.w, h: r.h };
  if (r.outline) o.outline = r.outline.map((p) => ({ x: p.x, y: p.y }));
  if (r.notch) o.notch = { ...r.notch };
  return o;
};
const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(snapShape(b));
const sameSize = (a, b) => a.w === b.w && a.h === b.h &&
  JSON.stringify(a.outline || null) === JSON.stringify(b.outline || null) &&
  JSON.stringify(a.notch || null) === JSON.stringify(b.notch || null);

function setShape(room, s) {
  room.x = s.x; room.y = s.y; room.w = s.w; room.h = s.h;
  if (s.outline) room.outline = s.outline.map((p) => ({ ...p })); else delete room.outline;
  if (s.notch) room.notch = { ...s.notch }; else delete room.notch;
  finalizeRoomOutline(room);
}

// Участвует ли комната в съедании моста (вложенные, шахты, открытые
// площадки и помещения по петлям стен — нет).
export const bridgeEatable = (r) => Boolean(r) && !r.parentId && !isShaft(r) && !isOpenRoom(r) && !r.bound;

function activeLevelOf(project) {
  const l = (project.levels || []).find((x) => x.id === project.activeLevel);
  if (l) return l;
  return project; // проект-этаж (тесты, levelProject): rooms/openings на нём
}

// Номинальная форма комнаты (без съедания) — для пунктира у выделенной.
export function nominalShape(room) {
  return room?.eatBase?.base ? { ...room, ...room.eatBase.base, outline: room.eatBase.base.outline, notch: room.eatBase.base.notch } : room;
}

// Вернуть этажу номинальные формы (снять производное съедание).
export function nominalizeLevel(level) {
  const rooms = level.rooms;
  // Старые файлы: съевшая (eatBase.by) — выше съеденной, даже если раньше в массиве.
  if (rooms.some((r) => r.eatBase?.by?.length)) {
    const z = zOrder(rooms);
    const sorted = rooms.map((r, i) => [z[i], i, r]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
    if (sorted.some((r, i) => r !== rooms[i])) rooms.splice(0, rooms.length, ...sorted);
  }
  for (const room of rooms) {
    const eb = room.eatBase;
    if (!eb) continue;
    delete room.eatBase;
    let base = eb.base;
    if (!base) continue;
    if (!sameShape(eb.now, room)) {
      // Видимую форму правили руками (растянули) — она и становится номиналом.
      if (!eb.now || !sameSize(eb.now, room)) continue;
      // Чистый сдвиг: номинал едет вместе с комнатой.
      base = { ...base, x: base.x + room.x - eb.now.x, y: base.y + room.y - eb.now.y };
    }
    keepOpenings(level, room, () => setShape(room, base));
    for (const o of eb.openings || []) {
      if (!level.openings.some((x) => x.id === o.id)) level.openings.push(clone(o));
    }
  }
}

// Начало жеста над съеденной комнатой (срез 3): ей возвращается номинальная
// форма и «сироты»-проёмы — ручки и перенос работают по номиналу, а видимую
// форму на каждом кадре заново даёт reconcileEats. → true, если менялось.
export function liftRoom(project, roomId) {
  const level = activeLevelOf(project);
  const room = (level.rooms || []).find((r) => r.id === roomId);
  const eb = room?.eatBase;
  if (!eb) return false;
  delete room.eatBase;
  if (!Array.isArray(level.openings)) level.openings = [];
  if (eb.base) keepOpenings(level, room, () => setShape(room, eb.base));
  for (const o of eb.openings || []) {
    if (!level.openings.some((x) => x.id === o.id)) level.openings.push(clone(o));
  }
  return true;
}

// Снимок «кто кого ест»: Map id → 'id|id' (для итога жеста, см. prev).
export function eatState(project) {
  return new Map((activeLevelOf(project).rooms || []).map((r) => [r.id, (r.eatBase?.by || []).join('|')]));
}

// Кто съедает комнату сейчас (ids верхних) — для растяжения «под ними».
export const eatersOf = (room) => [...(room?.eatBase?.by || [])];

// Съесть: видимая форма = результат carve. → { ok, why, orphans }.
function applyCarved(level, room, ring, cutters, partition) {
  const local = orientRing(ring, 1).map((p) => ({ x: p.x - room.x, y: p.y - room.y }));
  const probe = { ...room, outline: local };
  delete probe.notch;
  finalizeRoomOutline(probe);
  for (const child of level.rooms) {
    if (child.parentId !== room.id) continue;
    if (!rectInsideRoomShape(nestedOuterRect(child, partition), probe)) return { ok: false, why: 'children', child };
  }
  const inner = cutters.map((c) => erode(c, 1));
  const under = new Set();
  for (const a of captureOpeningAnchors(level, room).list) {
    const p = a.orient === 'h' ? { x: a.abs, y: a.edge } : { x: a.edge, y: a.abs };
    if (inner.some((c) => c.length && pointInPolygon(c, p, 0))) under.add(a.id);
  }
  const seen = new Map(level.openings.map((o) => [o.id, clone(o)]));
  const { lost } = keepOpenings(level, room, () => {
    room.outline = local;
    delete room.notch;
    finalizeRoomOutline(room);
  });
  const drop = new Set([...under, ...lost]);
  if (drop.size) level.openings = level.openings.filter((o) => !drop.has(o.id));
  return { ok: true, orphans: [...drop].map((id) => seen.get(id)).filter(Boolean) };
}

// Пересчитать съедание активного этажа с нуля.
// touched — комнаты, которые жест только что поставил/сдвинул/растянул:
// они поднимаются наверх (если пересекаются с кем-то, с зазором перегородки).
// under — { [id]: [ids верхних] }: растянутая съеденная комната остаётся
//   ПОД теми, кто её ел в начале жеста (встаёт прямо под нижнего из них), а
//   не поднимается наверх: тянули дальнюю грань — соседа она не съедает.
// → { eaten: [{lower, upper}], failed: [{lower, upper, why, child}], restored: [{lower}], lost: [] }
//   (eaten/restored — только изменения против прежнего состояния).
export function reconcileEats(project, { touched = [], under = null, prev = null } = {}) {
  const out = { eaten: [], failed: [], restored: [], lost: [] };
  const level = activeLevelOf(project);
  const rooms = level.rooms;
  if (!Array.isArray(rooms) || !rooms.length) return out;
  if (!Array.isArray(level.openings)) level.openings = [];
  const settings = project.settings || {};
  const partition = settings.partition || DEFAULT_PARTITION;
  // prev — снимок «кто кого ел» на начало жеста (eatState): итог жеста
  // сравнивается с ним, а не с прошлым кадром.
  const prevBy = prev || eatState(project);

  nominalizeLevel(level);

  const v7 = migrateLevel({ ...level, walls: level.walls || [], openings: [], items: [] }, settings);
  const blockOf = new Map(v7.blocks.map((b) => [b.id, b]));
  const geomOf = new Map();
  const geom = (id) => {
    if (!geomOf.has(id)) geomOf.set(id, blockGeom(blockOf.get(id)));
    return geomOf.get(id);
  };

  // Тронутые — наверх, если с кем-то взаимодействуют.
  const live = rooms.filter(bridgeEatable);
  const raise = touched.map((id) => rooms.find((r) => r.id === id)).filter((r) => bridgeEatable(r))
    .sort((a, b) => rooms.indexOf(a) - rooms.indexOf(b))
    .filter((r) => live.some((o) => o !== r &&
      area(intersection(geom(r.id), buffer(geom(o.id), pairGap(v7, settings, blockOf.get(r.id), blockOf.get(o.id))))) > HIT_MM2));
  for (const r of raise) {
    const eaters = (under?.[r.id] || []).map((id) => rooms.find((o) => o.id === id)).filter(Boolean);
    rooms.splice(rooms.indexOf(r), 1);
    if (eaters.length) {
      const at = Math.min(...eaters.map((o) => rooms.indexOf(o)));
      rooms.splice(at, 0, r);
    } else rooms.push(r);
  }

  const blocks = live.map((r) => ({ ...blockOf.get(r.id), z: rooms.indexOf(r) }));
  const carved = carveLevel({ ...v7, blocks }, settings);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const issue of carved.issues) {
    const lower = byId.get(issue.block);
    const upper = byId.get(issue.by[0]);
    if (lower && upper) out.failed.push({ lower, upper, why: issue.why, child: issue.child ? byId.get(issue.child) : null });
  }
  for (const room of live) {
    const c = carved.byId[room.id];
    if (!c?.eaten) continue;
    const upper = byId.get(c.by[0]);
    if (c.shape.length !== 1 || c.shape[0].length !== 1) {
      // Остаток с дырой (верхняя целиком внутри) — в форме v6 не выразить.
      out.failed.push({ lower: room, upper, why: 'split', child: null });
      continue;
    }
    const base = snapShape(room);
    const cutters = c.by.map((id) => buffer(geom(id), pairGap(v7, settings, blockOf.get(room.id), blockOf.get(id))));
    const res = applyCarved(level, room, c.shape[0][0], cutters, partition);
    if (!res.ok) { out.failed.push({ lower: room, upper, why: res.why, child: res.child }); continue; }
    room.eatBase = { base, now: snapShape(room), by: [...c.by], openings: res.orphans };
    if (prevBy.get(room.id) !== c.by.join('|')) out.eaten.push({ lower: room, upper });
  }
  for (const room of rooms) {
    if (prevBy.get(room.id) && !room.eatBase) out.restored.push({ lower: room });
  }
  return out;
}

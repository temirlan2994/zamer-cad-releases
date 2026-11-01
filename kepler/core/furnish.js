// Автоматическая расстановка мебели Kepler Plan.
// Мебель — свободные объекты; движок расставляет предметы, фактически
// находящиеся в комнате. Детерминированный, проверяемый алгоритм:
//   1. карта препятствий комнаты (вложенные помещения, зоны открывания дверей);
//   2. для каждого предмета перебор позиций вдоль стен или в центре с оценкой
//      (углы, расстояние от двери, окна);
//   3. проверка коллизий, зон доступа и прохода от двери (BFS по сетке 100 мм);
//   4. если предмет не помещается — возвращается понятная причина, предмет
//      остаётся на прежнем месте.

import { FURNITURE, furnitureDef, roomType, DEFAULT_PARTITION } from './catalog.js';
import { nestedOuterRect } from './rooms.js';
import { doorSwingRect, openingRect } from './walls.js';
import { createItem } from './model.js';

const CELL = 100; // шаг сетки проходимости, мм
const STEP = 100; // шаг перебора позиций вдоль стены, мм
const GENERIC_RULES = { wall: true, clearFront: 500, priority: 9 };

function intersects(a, b, eps = 1) {
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}

function inflate(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
}

export function itemRect(item) {
  const rotated = item.rotation % 180 !== 0;
  const w = rotated ? item.h : item.w;
  const h = rotated ? item.w : item.h;
  return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}

export function itemTitle(kind) {
  return FURNITURE[kind]?.title || kind;
}

// Мебель, фактически стоящая в комнате (центр внутри), не считая предметов
// внутри вложенных помещений комнаты.
export function itemsInRoom(project, room) {
  const children = project.rooms.filter((r) => r.parentId === room.id);
  return project.items.filter((item) => {
    if (item.x < room.x || item.x > room.x + room.w || item.y < room.y || item.y > room.y + room.h) return false;
    for (const child of children) {
      if (item.x >= child.x && item.x <= child.x + child.w && item.y >= child.y && item.y <= child.y + child.h) return false;
    }
    return true;
  });
}

// Когда внутрь комнаты вкладывается новое помещение, мебель родителя из-под
// него вытаскивается в свободную точку родителя — дальше её расставит
// arrangeRoom или перетащит пользователь.
export function reclaimItemsFromChild(project, parent, child, excludeIds = null, partition = DEFAULT_PARTITION) {
  const outer = nestedOuterRect(child, partition);
  const moved = [];
  const anchor = freeAnchor(project, parent);
  for (const item of project.items) {
    if (excludeIds && excludeIds.has(item.id)) continue; // мебель самого вложенного помещения
    const inChild = item.x >= outer.x && item.x <= outer.x + outer.w && item.y >= outer.y && item.y <= outer.y + outer.h;
    const wasInParent = item.x >= parent.x && item.x <= parent.x + parent.w && item.y >= parent.y && item.y <= parent.y + parent.h;
    if (inChild && wasInParent) {
      item.x = anchor.x;
      item.y = anchor.y;
      moved.push(item);
    }
  }
  return moved;
}

// Точка внутри комнаты вне всех вложенных помещений.
function freeAnchor(project, room) {
  const children = project.rooms.filter((r) => r.parentId === room.id);
  for (let dy = 600; dy < room.h; dy += 500) {
    for (let dx = 600; dx < room.w; dx += 500) {
      const p = { x: room.x + dx, y: room.y + dy };
      const blocked = children.some((c) => {
        const o = nestedOuterRect(c);
        return p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h;
      });
      if (!blocked) return p;
    }
  }
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

// Типовой набор мебели для комнаты (создаёт предметы в центре комнаты).
export function defaultItemsFor(room) {
  const def = roomType(room.type);
  if (!def) return [];
  const items = [];
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  for (const entry of def.furniture) {
    if (!entry.default) continue;
    const fd = furnitureDef(entry.kind);
    const count = entry.kind === 'nightstand' ? 2 : entry.kind === 'chair' ? 4 : 1;
    for (let i = 0; i < count; i += 1) {
      items.push(createItem(entry.kind, cx, cy, fd.w, fd.h));
    }
  }
  return items;
}

// Контекст комнаты для расстановки.
export function buildRoomContext(project, room, walls) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const inner = { x: room.x, y: room.y, w: room.w, h: room.h };

  const solids = [];
  for (const child of project.rooms) {
    if (child.parentId === room.id) solids.push({ rect: nestedOuterRect(child, partition), label: child.name });
  }

  const doorZones = [];
  const doorCells = [];
  for (const opening of project.openings) {
    if (opening.kind !== 'door') continue;
    const swing = doorSwingRect(project, opening, walls);
    const placed = openingRect(project, opening, walls);
    if (!swing || !placed) continue;
    const swingInRoom = intersects(swing, inner);
    if (swingInRoom) doorZones.push(swing);
    const t = thresholdRect(placed.rect, inner, opening.width);
    if (t) { doorCells.push(t); if (!swingInRoom) doorZones.push(t); }
  }

  const windowZones = [];
  for (const opening of project.openings) {
    if (opening.kind !== 'window' || opening.roomId !== room.id) continue;
    const placed = openingRect(project, opening, walls);
    if (!placed) continue;
    windowZones.push(thresholdRect(placed.rect, inner, 250));
  }

  return { room, inner, solids, doorZones, doorCells, windowZones: windowZones.filter(Boolean), partition };
}

function thresholdRect(rect, inner, depth) {
  if (rect.w >= rect.h) {
    const below = { x: rect.x, y: rect.y + rect.h, w: rect.w, h: depth };
    const above = { x: rect.x, y: rect.y - depth, w: rect.w, h: depth };
    if (intersects(below, inner)) return below;
    if (intersects(above, inner)) return above;
    return null;
  }
  const right = { x: rect.x + rect.w, y: rect.y, w: depth, h: rect.h };
  const left = { x: rect.x - depth, y: rect.y, w: depth, h: rect.h };
  if (intersects(right, inner)) return right;
  if (intersects(left, inner)) return left;
  return null;
}

function* wallSlots(ctx, def) {
  const { inner } = ctx;
  for (const side of [0, 2, 1, 3]) {
    const horizontal = side === 0 || side === 2;
    const along = def.w;
    const depth = def.h;
    const max = (horizontal ? inner.w : inner.h) - along;
    if (max < 0) continue;
    const emit = (pos) => {
      if (side === 0) return { rect: { x: inner.x + pos, y: inner.y, w: along, h: depth }, rotation: 0, side };
      if (side === 2) return { rect: { x: inner.x + pos, y: inner.y + inner.h - depth, w: along, h: depth }, rotation: 180, side };
      if (side === 3) return { rect: { x: inner.x, y: inner.y + pos, w: depth, h: along }, rotation: 270, side };
      return { rect: { x: inner.x + inner.w - depth, y: inner.y + pos, w: depth, h: along }, rotation: 90, side };
    };
    for (let pos = 0; pos <= max; pos += STEP) yield emit(pos);
    if (max % STEP !== 0) yield emit(max);
  }
}

function frontZone(slot, def) {
  const depth = def.rules.clearFront || 0;
  if (!depth) return null;
  const { rect, side } = slot;
  if (side === 0) return { x: rect.x, y: rect.y + rect.h, w: rect.w, h: depth };
  if (side === 2) return { x: rect.x, y: rect.y - depth, w: rect.w, h: depth };
  if (side === 3) return { x: rect.x + rect.w, y: rect.y, w: depth, h: rect.h };
  return { x: rect.x - depth, y: rect.y, w: depth, h: rect.h };
}

function cornerBonus(slot, inner) {
  const corners = [
    { x: inner.x, y: inner.y }, { x: inner.x + inner.w, y: inner.y },
    { x: inner.x + inner.w, y: inner.y + inner.h }, { x: inner.x, y: inner.y + inner.h },
  ];
  const cx = slot.rect.x + slot.rect.w / 2;
  const cy = slot.rect.y + slot.rect.h / 2;
  const d = Math.min(...corners.map((c) => Math.hypot(c.x - cx, c.y - cy)));
  return Math.max(0, 1 - d / 4000);
}

function doorDistance(slot, doorZones) {
  if (!doorZones.length) return 1;
  const cx = slot.rect.x + slot.rect.w / 2;
  const cy = slot.rect.y + slot.rect.h / 2;
  const d = Math.min(...doorZones.map((z) => Math.hypot(z.x + z.w / 2 - cx, z.y + z.h / 2 - cy)));
  return Math.min(1, d / 5000);
}

export function passagesOk(ctx, placedRects, accessZones) {
  if (!ctx.doorCells.length) return true;
  const { inner } = ctx;
  const cols = Math.max(1, Math.round(inner.w / CELL));
  const rows = Math.max(1, Math.round(inner.h / CELL));
  const blocked = new Uint8Array(cols * rows);
  const mark = (rect) => {
    const x1 = Math.max(0, Math.floor((rect.x - inner.x) / CELL));
    const y1 = Math.max(0, Math.floor((rect.y - inner.y) / CELL));
    const x2 = Math.min(cols - 1, Math.ceil((rect.x + rect.w - inner.x) / CELL) - 1);
    const y2 = Math.min(rows - 1, Math.ceil((rect.y + rect.h - inner.y) / CELL) - 1);
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) blocked[y * cols + x] = 1;
  };
  for (const solid of ctx.solids) mark(inflate(solid.rect, -10));
  for (const rect of placedRects) mark(inflate(rect, -10));

  const visited = new Uint8Array(cols * rows);
  const queue = [];
  const seed = (rect) => {
    const x1 = Math.max(0, Math.floor((rect.x - inner.x) / CELL));
    const y1 = Math.max(0, Math.floor((rect.y - inner.y) / CELL));
    const x2 = Math.min(cols - 1, Math.ceil((rect.x + rect.w - inner.x) / CELL) - 1);
    const y2 = Math.min(rows - 1, Math.ceil((rect.y + rect.h - inner.y) / CELL) - 1);
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) {
      const idx = y * cols + x;
      if (!blocked[idx] && !visited[idx]) { visited[idx] = 1; queue.push(idx); }
    }
  };
  for (const cell of ctx.doorCells) seed(cell);
  while (queue.length) {
    const idx = queue.pop();
    const x = idx % cols;
    const y = (idx / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (!blocked[nIdx] && !visited[nIdx]) { visited[nIdx] = 1; queue.push(nIdx); }
    }
  }
  const zoneReached = (rect) => {
    const x1 = Math.max(0, Math.floor((rect.x - inner.x) / CELL));
    const y1 = Math.max(0, Math.floor((rect.y - inner.y) / CELL));
    const x2 = Math.min(cols - 1, Math.ceil((rect.x + rect.w - inner.x) / CELL) - 1);
    const y2 = Math.min(rows - 1, Math.ceil((rect.y + rect.h - inner.y) / CELL) - 1);
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) {
      if (visited[y * cols + x]) return true;
    }
    return false;
  };
  return accessZones.every((zone) => !zone || zoneReached(zone));
}

function insideRoom(rect, inner, eps = 1) {
  return rect.x >= inner.x - eps && rect.y >= inner.y - eps &&
    rect.x + rect.w <= inner.x + inner.w + eps && rect.y + rect.h <= inner.y + inner.h + eps;
}

function bedClearancesOk(kind, def, slot, ctx, collides) {
  if (kind !== 'bed-double' && kind !== 'bed-single') return true;
  const gap = def.rules.clearSides || 700;
  const { rect, side } = slot;
  const strips = [];
  const skipHead = 500;
  if (side === 0 || side === 2) {
    const y = side === 0 ? rect.y + skipHead : rect.y;
    const h = rect.h - skipHead;
    strips.push({ x: rect.x - gap, y, w: gap, h });
    strips.push({ x: rect.x + rect.w, y, w: gap, h });
  } else {
    const x = side === 3 ? rect.x + skipHead : rect.x;
    const w = rect.w - skipHead;
    strips.push({ x, y: rect.y - gap, w, h: gap });
    strips.push({ x, y: rect.y + rect.h, w, h: gap });
  }
  const okStrips = strips.filter((s) => insideRoom(s, ctx.inner, -10) && !collides(s));
  const needed = kind === 'bed-double' ? 2 : 1;
  return okStrips.length >= needed;
}

function* centerSlots(ctx, def) {
  const { inner } = ctx;
  for (const rotated of [false, true]) {
    const w = rotated ? def.h : def.w;
    const h = rotated ? def.w : def.h;
    const maxX = inner.w - w;
    const maxY = inner.h - h;
    if (maxX < 0 || maxY < 0) continue;
    const stepX = Math.max(STEP, Math.floor(maxX / 8 / STEP) * STEP || STEP);
    const stepY = Math.max(STEP, Math.floor(maxY / 8 / STEP) * STEP || STEP);
    for (let dy = 0; dy <= maxY; dy += stepY) {
      for (let dx = 0; dx <= maxX; dx += stepX) {
        const rect = { x: inner.x + dx, y: inner.y + dy, w, h };
        const cx = rect.x + w / 2 - (inner.x + inner.w / 2);
        const cy = rect.y + h / 2 - (inner.y + inner.h / 2);
        const centerBonus = Math.max(0, 1 - Math.hypot(cx, cy) / 3000);
        yield { rect, rotation: rotated ? 90 : 0, side: -1, bonus: centerBonus, front: null };
      }
    }
  }
}

function pairSlots(kind, def, anchor, ctx) {
  const slots = [];
  const a = anchor.slot;
  if (kind === 'nightstand') {
    const gap = 50;
    if (a.side === 0 || a.side === 2) {
      const y = a.side === 0 ? a.rect.y : a.rect.y + a.rect.h - def.h;
      slots.push({ rect: { x: a.rect.x - def.w - gap, y, w: def.w, h: def.h }, rotation: a.rotation, side: a.side, front: null });
      slots.push({ rect: { x: a.rect.x + a.rect.w + gap, y, w: def.w, h: def.h }, rotation: a.rotation, side: a.side, front: null });
    } else {
      const x = a.side === 3 ? a.rect.x : a.rect.x + a.rect.w - def.h;
      slots.push({ rect: { x, y: a.rect.y - def.w - gap, w: def.h, h: def.w }, rotation: a.rotation, side: a.side, front: null });
      slots.push({ rect: { x, y: a.rect.y + a.rect.h + gap, w: def.h, h: def.w }, rotation: a.rotation, side: a.side, front: null });
    }
    return slots;
  }
  if (kind === 'chair') {
    const r = a.rect;
    const gap = 80;
    const perSide = Math.max(1, Math.floor(r.w / 800));
    for (let i = 0; i < perSide; i += 1) {
      const x = r.x + (r.w / (perSide + 1)) * (i + 1) - def.w / 2;
      slots.push({ rect: { x, y: r.y - def.h - gap, w: def.w, h: def.h }, rotation: 180, side: -1, front: null });
      slots.push({ rect: { x, y: r.y + r.h + gap, w: def.w, h: def.h }, rotation: 0, side: -1, front: null });
    }
    return slots;
  }
  return slots;
}

// Главная функция: расставить мебель, фактически находящуюся в комнате.
// Мутирует позиции предметов; возвращает [{kind,title,reason}] — что не
// удалось разместить (такие предметы остаются где были).
export function arrangeRoom(project, room, walls) {
  const ctx = buildRoomContext(project, room, walls);
  const items = itemsInRoom(project, room);
  const rejected = [];
  const placedRects = [];
  const accessZones = [];
  const pairQueue = [];

  const describe = (item) => {
    const fd = furnitureDef(item.kind);
    return {
      kind: item.kind,
      title: fd?.title || item.kind,
      w: item.w,
      h: item.h,
      rules: fd?.rules || GENERIC_RULES,
      item,
    };
  };

  const descriptors = items.map(describe)
    .sort((a, b) => (a.rules.priority || 9) - (b.rules.priority || 9) || (b.w * b.h) - (a.w * a.h));

  const collides = (rect) => {
    for (const solid of ctx.solids) if (intersects(rect, solid.rect)) return solid;
    for (const placed of placedRects) if (intersects(rect, placed)) return { label: 'другая мебель' };
    return null;
  };
  const hitsDoor = (rect) => ctx.doorZones.some((z) => intersects(rect, z));
  const hitsWindow = (rect) => ctx.windowZones.some((z) => intersects(rect, z));

  const tryPlace = (def, slots, extraValidate) => {
    const valid = [];
    const failures = { size: 0, collide: 0, door: 0, window: 0, passage: 0, clear: 0 };
    let collidedWith = null;
    let any = false;
    for (const slot of slots) {
      any = true;
      if (!insideRoom(slot.rect, ctx.inner)) { failures.size += 1; continue; }
      const blocker = collides(slot.rect);
      if (blocker) { failures.collide += 1; collidedWith = blocker; continue; }
      if (hitsDoor(slot.rect)) { failures.door += 1; continue; }
      if (def.rules.tall && hitsWindow(slot.rect)) { failures.window += 1; continue; }
      const front = slot.front !== undefined ? slot.front : frontZone(slot, def);
      if (front && (!insideRoom(front, ctx.inner, -10) || collides(front))) { failures.clear += 1; continue; }
      if (extraValidate && !extraValidate(slot)) { failures.clear += 1; continue; }
      let score = cornerBonus(slot, ctx.inner) * (def.rules.center ? 0 : 1)
        + doorDistance(slot, ctx.doorZones)
        + (slot.bonus || 0);
      if (def.rules.tall === false && hitsWindow(slot.rect)) score -= 0.3;
      valid.push({ ...slot, front, score });
    }
    valid.sort((a, b) => b.score - a.score);
    const attempts = Math.min(valid.length, 14);
    for (let i = 0; i < attempts; i += 1) {
      const candidate = valid[i];
      const nextRects = [...placedRects, candidate.rect];
      const nextZones = [...accessZones, candidate.front].filter(Boolean);
      if (passagesOk(ctx, nextRects, nextZones)) return { ok: true, slot: candidate };
      failures.passage += 1;
    }
    return { ok: false, failures, collidedWith, any };
  };

  const commit = (def, slot) => {
    def.item.x = slot.rect.x + slot.rect.w / 2;
    def.item.y = slot.rect.y + slot.rect.h / 2;
    def.item.rotation = slot.rotation;
    placedRects.push(slot.rect);
    if (slot.front) accessZones.push(slot.front);
  };

  const reasonFrom = (def, result) => {
    const f = result.failures;
    if (!result.any || (f.size > 0 && f.collide + f.door + f.window + f.clear + f.passage === 0)) {
      return `«${def.title}» (${def.w}×${def.h} мм) не помещается в комнату таких размеров`;
    }
    const top = Object.entries(f).sort((a, b) => b[1] - a[1])[0][0];
    if (top === 'door') return `«${def.title}» негде поставить: мешают зоны открывания дверей`;
    if (top === 'window') return `«${def.title}» нельзя ставить на окно — свободных участков стен не хватает`;
    if (top === 'passage') return `«${def.title}» перекрывает проход от двери`;
    if (top === 'clear') return `«${def.title}» помещается, но не остаётся зоны доступа (${def.rules.clearFront || def.rules.clearAround || 600} мм)`;
    const blocker = result.collidedWith ? ` — мешает «${result.collidedWith.label || 'другая мебель'}»` : '';
    return `Для «${def.title}» не хватает свободного места${blocker}`;
  };

  const anchors = {}; // kind -> {slot, kind}

  for (const def of descriptors) {
    // Парные предметы (тумбочки, стулья) ждут опорный.
    if (def.rules.pairWith) {
      pairQueue.push(def);
      continue;
    }
    let result;
    if (def.rules.center) {
      result = tryPlace(def, centerSlots(ctx, def), (slot) => {
        const around = def.rules.clearAround || 0;
        if (!around) return true;
        const zone = inflate(slot.rect, around);
        return insideRoom(zone, ctx.inner, -10) && !collides(zone);
      });
    } else {
      const slots = Array.from(wallSlots(ctx, def));
      if (def.kind === 'desk') for (const s of slots) if (hitsWindow(s.rect)) s.bonus = 0.6;
      result = tryPlace(def, slots, (slot) => bedClearancesOk(def.kind, def, slot, ctx, collides));
    }
    if (!result.ok) {
      rejected.push({ kind: def.kind, title: def.title, reason: reasonFrom(def, result) });
      continue;
    }
    commit(def, result.slot);
    anchors[def.kind] = { slot: result.slot, kind: def.kind };
  }

  // Парные предметы: к кровати/столу, по свободным местам рядом.
  for (const def of pairQueue) {
    const anchorKind = def.rules.pairWith.find((k) => anchors[k]);
    if (!anchorKind) {
      rejected.push({
        kind: def.kind,
        title: def.title,
        reason: `«${def.title}» ставится рядом с опорным предметом (${def.rules.pairWith.map((k) => FURNITURE[k]?.title || k).join(' / ')}) — добавьте его`,
      });
      continue;
    }
    const spots = pairSlots(def.kind, def, anchors[anchorKind], ctx);
    let placed = false;
    for (const spot of spots) {
      if (!insideRoom(spot.rect, ctx.inner)) continue;
      if (collides(spot.rect) || hitsDoor(spot.rect)) continue;
      commit(def, spot);
      placed = true;
      break;
    }
    if (!placed) rejected.push({ kind: def.kind, title: def.title, reason: `Рядом с опорным предметом нет места для «${def.title}»` });
  }

  return rejected;
}

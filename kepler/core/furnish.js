// Автоматическая меблировка Kepler Plan.
// Детерминированный, проверяемый алгоритм (никакой генерации картинок):
//   1. строится карта препятствий комнаты (вложенные помещения, ручная мебель,
//      зоны открывания дверей);
//   2. для каждого отмеченного предмета перебираются позиции вдоль стен или в
//      центре с оценкой (углы, расстояние от двери, окна);
//   3. каждая позиция проверяется на коллизии, зоны доступа и на то, что она
//      не перекрывает проход от двери (BFS по сетке 100 мм);
//   4. если предмет не помещается — возвращается понятная причина.

import { FURNITURE, furnitureDef, roomType, DEFAULT_PARTITION } from './catalog.js';
import { nestedOuterRect } from './rooms.js';
import { doorSwingRect, openingRect, sideEdge } from './walls.js';

const CELL = 100; // шаг сетки проходимости, мм
const STEP = 100; // шаг перебора позиций вдоль стены, мм

function intersects(a, b, eps = 1) {
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}

function inflate(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
}

// Контекст комнаты для расстановки.
export function buildRoomContext(project, room, walls) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const inner = { x: room.x, y: room.y, w: room.w, h: room.h };

  const solids = []; // непроходимые препятствия
  for (const child of project.rooms) {
    if (child.parentId === room.id) solids.push({ rect: nestedOuterRect(child, partition), label: child.name });
  }
  for (const item of project.items) {
    if (item.roomId === room.id && !item.auto) {
      solids.push({ rect: itemRect(item), label: itemTitle(item.kind) });
    }
  }

  // Двери, влияющие на комнату: её собственные, двери соседей через общую
  // стену, двери вложенных помещений (открываются в эту комнату).
  const doorZones = [];
  const doorCells = [];
  for (const opening of project.openings) {
    if (opening.kind !== 'door') continue;
    const swing = doorSwingRect(project, opening, walls);
    const placed = openingRect(project, opening, walls);
    if (!swing || !placed) continue;
    const swingInRoom = intersects(swing, inner);
    if (swingInRoom) doorZones.push(swing);
    // Порог двери: полоса перед проёмом внутри комнаты — источник прохода.
    const t = thresholdRect(placed.rect, inner, opening.width);
    if (t) { doorCells.push(t); if (!swingInRoom) doorZones.push(t); }
  }

  // Окна по сторонам комнаты: полосы глубиной 250 мм вдоль стены.
  const windowZones = [];
  for (const opening of project.openings) {
    if (opening.kind !== 'window' || opening.roomId !== room.id) continue;
    const placed = openingRect(project, opening, walls);
    if (!placed) continue;
    windowZones.push(thresholdRect(placed.rect, inner, 250));
  }

  return { room, inner, solids, doorZones, doorCells, windowZones: windowZones.filter(Boolean), partition };
}

// Полоса внутри комнаты, примыкающая к проёму в стене.
function thresholdRect(rect, inner, depth) {
  if (rect.w >= rect.h) {
    // горизонтальная стена: полоса сверху или снизу проёма
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

export function itemRect(item) {
  const rotated = item.rotation % 180 !== 0;
  const w = rotated ? item.h : item.w;
  const h = rotated ? item.w : item.h;
  return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}

export function itemTitle(kind) {
  return FURNITURE[kind]?.title || kind;
}

// Позиции предмета спинкой к стене. side: 0 верх, 1 право, 2 низ, 3 лево.
function* wallSlots(ctx, def) {
  const { inner } = ctx;
  for (const side of [0, 2, 1, 3]) {
    const horizontal = side === 0 || side === 2;
    const along = horizontal ? def.w : def.w; // ширина предмета вдоль стены
    const depth = def.h;
    const max = (horizontal ? inner.w : inner.h) - along;
    if (max < 0) continue;
    for (let pos = 0; pos <= max; pos += STEP) {
      let rect;
      let rotation;
      if (side === 0) { rect = { x: inner.x + pos, y: inner.y, w: along, h: depth }; rotation = 0; }
      else if (side === 2) { rect = { x: inner.x + pos, y: inner.y + inner.h - depth, w: along, h: depth }; rotation = 180; }
      else if (side === 3) { rect = { x: inner.x, y: inner.y + pos, w: depth, h: along }; rotation = 270; }
      else { rect = { x: inner.x + inner.w - depth, y: inner.y + pos, w: depth, h: along }; rotation = 90; }
      yield { rect, rotation, side };
    }
    // Позиция впритык к дальнему углу тоже проверяется.
    if (max % STEP !== 0) {
      let rect;
      let rotation;
      const pos = max;
      if (side === 0) { rect = { x: inner.x + pos, y: inner.y, w: along, h: depth }; rotation = 0; }
      else if (side === 2) { rect = { x: inner.x + pos, y: inner.y + inner.h - depth, w: along, h: depth }; rotation = 180; }
      else if (side === 3) { rect = { x: inner.x, y: inner.y + pos, w: depth, h: along }; rotation = 270; }
      else { rect = { x: inner.x + inner.w - depth, y: inner.y + pos, w: depth, h: along }; rotation = 90; }
      yield { rect, rotation, side };
    }
  }
}

// Зона доступа перед предметом (между предметом и центром комнаты).
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

// Проверка проходимости: от порогов дверей BFS по свободным клеткам; каждая
// зона доступа предмета должна быть достижима. Без дверей проверка пропускается.
export function passagesOk(ctx, placedRects, accessZones) {
  if (!ctx.doorCells.length) return true;
  const { inner } = ctx;
  const cols = Math.max(1, Math.round(inner.w / CELL));
  const rows = Math.max(1, Math.round(inner.h / CELL));
  const blocked = new Uint8Array(cols * rows);
  const mark = (rect, value) => {
    const x1 = Math.max(0, Math.floor((rect.x - inner.x) / CELL));
    const y1 = Math.max(0, Math.floor((rect.y - inner.y) / CELL));
    const x2 = Math.min(cols - 1, Math.ceil((rect.x + rect.w - inner.x) / CELL) - 1);
    const y2 = Math.min(rows - 1, Math.ceil((rect.y + rect.h - inner.y) / CELL) - 1);
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) blocked[y * cols + x] = value;
  };
  for (const solid of ctx.solids) mark(inflate(solid.rect, -10), 1);
  for (const rect of placedRects) mark(inflate(rect, -10), 1);

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

// Главная функция: расставить отмеченную мебель комнаты.
// Возвращает { placed: [{kind,x,y,w,h,rotation}], rejected: [{kind,title,reason}] }.
export function furnishRoom(project, room, walls) {
  const ctx = buildRoomContext(project, room, walls);
  const placed = [];
  const rejected = [];
  const placedRects = [];
  const accessZones = [];

  const typeDef = roomType(room.type);
  const available = typeDef ? typeDef.furniture.map((f) => f.kind) : Object.keys(room.checklist || {});
  const selected = available.filter((kind) => room.checklist?.[kind]);
  selected.sort((a, b) => (furnitureDef(a)?.rules.priority || 9) - (furnitureDef(b)?.rules.priority || 9));

  const occupied = () => [...ctx.solids.map((s) => s.rect), ...placedRects];

  const collides = (rect) => {
    for (const solid of occupied()) if (intersects(rect, solid)) return solid;
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
      if (def.rules.tall === false && hitsWindow(slot.rect)) score -= 0.3; // кровать изголовьем к окну — хуже
      valid.push({ ...slot, front, score });
    }
    // Лучшие позиции проверяются на проходимость; если первая перекрывает
    // проход от двери — пробуются следующие по оценке.
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

  const commit = (kind, def, slot) => {
    const rotated = slot.rotation % 180 !== 0;
    const w = rotated ? slot.rect.h : slot.rect.w;
    const h = rotated ? slot.rect.w : slot.rect.h;
    const item = {
      kind,
      x: slot.rect.x + slot.rect.w / 2,
      y: slot.rect.y + slot.rect.h / 2,
      w, h,
      rotation: slot.rotation,
    };
    placed.push(item);
    placedRects.push(slot.rect);
    if (slot.front) accessZones.push(slot.front);
    return item;
  };

  const reasonFrom = (kind, def, result) => {
    const f = result.failures;
    if (!result.any || f.size > 0 && f.collide + f.door + f.window + f.clear + f.passage === 0) {
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

  let bedItem = null;
  let tableItem = null;

  for (const kind of selected) {
    const def = { ...furnitureDef(kind), kind };
    if (!def.title) continue;

    // Парные предметы обрабатываются после опорных.
    if (def.rules.pairWith) {
      const anchor = def.rules.pairWith.includes(bedItem?.kind) ? bedItem
        : def.rules.pairWith.includes(tableItem?.kind) ? tableItem : null;
      if (!anchor) {
        rejected.push({ kind, title: def.title, reason: `Сначала отметьте опорный предмет (${def.rules.pairWith.map((k) => FURNITURE[k]?.title || k).join(' / ')})` });
        continue;
      }
      const spots = pairSlots(kind, def, anchor, ctx);
      let placedCount = 0;
      for (const spot of spots) {
        if (!insideRoom(spot.rect, ctx.inner)) continue;
        if (collides(spot.rect) || hitsDoor(spot.rect)) continue;
        commit(kind, def, spot);
        placedCount += 1;
        if (placedCount >= spots.wanted) break;
      }
      if (placedCount === 0) rejected.push({ kind, title: def.title, reason: `Рядом с опорным предметом нет места для «${def.title}»` });
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
      // Рабочий стол тянется к окну: бонус позициям у окна.
      if (kind === 'desk') for (const s of slots) if (hitsWindow(s.rect)) s.bonus = 0.6;
      result = tryPlace(def, slots, (slot) => bedClearancesOk(kind, def, slot, ctx, collides));
    }

    if (!result.ok) {
      rejected.push({ kind, title: def.title, reason: reasonFrom(kind, def, result) });
      continue;
    }
    const item = commit(kind, def, result.slot);
    item.kind = kind;
    if (kind === 'bed-double' || kind === 'bed-single') bedItem = { ...item, slot: result.slot };
    if (kind === 'dining-table') tableItem = { ...item, slot: result.slot };
  }

  return { placed, rejected };
}

function insideRoom(rect, inner, eps = 1) {
  return rect.x >= inner.x - eps && rect.y >= inner.y - eps &&
    rect.x + rect.w <= inner.x + inner.w + eps && rect.y + rect.h <= inner.y + inner.h + eps;
}

// Боковые зоны доступа кровати (700 мм вдоль обеих длинных сторон,
// кроме изголовья, где стоят тумбочки).
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

// Позиции в центральной зоне комнаты для «островных» предметов.
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

// Позиции парных предметов: тумбочки у изголовья кровати, стулья вокруг стола.
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
    slots.wanted = anchor.kind === 'bed-double' ? 2 : 1;
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
    slots.wanted = 4;
    return slots;
  }
  slots.wanted = 1;
  return slots;
}

// Перестановка мебели комнаты в проекте: авто-предметы пересоздаются,
// ручные (auto:false) остаются на месте и учитываются как препятствия.
export function refurnishRoom(project, room, walls, createItem) {
  project.items = project.items.filter((i) => !(i.roomId === room.id && i.auto));
  const { placed, rejected } = furnishRoom(project, room, walls);
  for (const p of placed) {
    project.items.push(createItem(p.kind, room.id, p.x, p.y, p.w, p.h, p.rotation, true));
  }
  return rejected;
}

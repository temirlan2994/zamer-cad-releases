// Необязательная Г-образная форма комнаты: прямоугольный вырез из одного
// угла. Базовые x/y/w/h остаются габаритом — старые проекты совместимы.

const CORNERS = new Set(['nw', 'ne', 'se', 'sw']);

function outlinePoints(room) {
  if (!Array.isArray(room?.outline) || room.outline.length < 4) return null;
  const points = room.outline.map((p) => ({ x: room.x + Number(p.x), y: room.y + Number(p.y) }));
  return points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? points : null;
}

const samePoint = (a, b, eps = 0.5) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
const collinear = (a, b, c, eps = 0.5) =>
  (Math.abs(a.x - b.x) <= eps && Math.abs(b.x - c.x) <= eps) ||
  (Math.abs(a.y - b.y) <= eps && Math.abs(b.y - c.y) <= eps);

function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[j]; const b = points[i];
    const on = Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) < 0.5 &&
      x >= Math.min(a.x, b.x) - 0.5 && x <= Math.max(a.x, b.x) + 0.5 &&
      y >= Math.min(a.y, b.y) - 0.5 && y <= Math.max(a.y, b.y) + 0.5;
    if (on) return true;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonRects(points) {
  const xs = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(points.map((p) => p.y))].sort((a, b) => a - b);
  const rows = [];
  for (let yi = 0; yi < ys.length - 1; yi += 1) {
    const y = ys[yi]; const h = ys[yi + 1] - y;
    let run = null;
    for (let xi = 0; xi < xs.length - 1; xi += 1) {
      const x = xs[xi]; const w = xs[xi + 1] - x;
      const inside = w > 0.5 && h > 0.5 && pointInPolygon(points, x + w / 2, y + h / 2);
      if (inside && run && Math.abs(run.x + run.w - x) < 0.5) run.w += w;
      else {
        if (run) rows.push(run);
        run = inside ? { x, y, w, h } : null;
      }
    }
    if (run) rows.push(run);
  }
  const merged = [];
  for (const rect of rows) {
    const above = merged.find((candidate) => Math.abs(candidate.x - rect.x) < 0.5 &&
      Math.abs(candidate.w - rect.w) < 0.5 && Math.abs(candidate.y + candidate.h - rect.y) < 0.5);
    if (above) above.h += rect.h; else merged.push({ ...rect });
  }
  return merged;
}

export function finalizeRoomOutline(room) {
  let points = outlinePoints(room);
  if (!points) return { merged: false };
  points = points.filter((point, index) => !samePoint(point, points[(index - 1 + points.length) % points.length]));
  let changed = true;
  while (changed && points.length > 4) {
    changed = false;
    for (let i = 0; i < points.length; i += 1) {
      if (!collinear(points[(i - 1 + points.length) % points.length], points[i], points[(i + 1) % points.length])) continue;
      points.splice(i, 1); changed = true; break;
    }
  }
  const minX = Math.min(...points.map((p) => p.x)); const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)); const maxY = Math.max(...points.map((p) => p.y));
  room.x = minX; room.y = minY; room.w = maxX - minX; room.h = maxY - minY;
  const rectangle = points.length === 4 && points.every((p) =>
    (Math.abs(p.x - minX) < 0.5 || Math.abs(p.x - maxX) < 0.5) &&
    (Math.abs(p.y - minY) < 0.5 || Math.abs(p.y - maxY) < 0.5));
  if (rectangle) { delete room.outline; delete room.notch; return { merged: true }; }
  room.outline = points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  delete room.notch;
  return { merged: false };
}

// Минимальный отступ точки деления от торца стены, мм.
export const WALL_SPLIT_MIN_GAP = 100;

// Торцы стены вдоль её оси: 'from' — меньшая координата (левый торец
// горизонтальной стены, верхний — вертикальной, в осях дома), 'to' — большая.
function wallSpan(wall) {
  const a = Number(wall?.from); const b = Number(wall?.to);
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

// Точка деления по выбранному торцу и расстоянию от него. ok=false, если
// точка ближе minGap к любому торцу; min/max — допустимый диапазон расстояния.
export function wallSplitAt(wall, end, distance, minGap = WALL_SPLIT_MIN_GAP) {
  const { lo, hi } = wallSpan(wall);
  const length = hi - lo;
  const min = minGap;
  const max = length - minGap;
  const d = Number(distance);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(d) || (end !== 'from' && end !== 'to')) {
    return { ok: false, at: null, min, max, length };
  }
  const at = end === 'from' ? lo + d : hi - d;
  const ok = max >= min && d >= min - 1e-6 && d <= max + 1e-6;
  return { ok, at, min, max, length };
}

// Обратная задача: ближайший к точке at торец и расстояние до него.
export function nearestWallSplitEnd(wall, at) {
  const { lo, hi } = wallSpan(wall);
  const p = Number.isFinite(at) ? Math.max(lo, Math.min(hi, at)) : (lo + hi) / 2;
  return p - lo <= hi - p ? { end: 'from', distance: p - lo } : { end: 'to', distance: hi - p };
}

// Добавляет на стену две совпадающие вершины. Пока сегмент не сдвинут,
// геометрия помещения остаётся совершенно прежней.
export function splitRoomOutlineWall(room, wall, at) {
  const points = roomPolygon(room);
  const orient = wall.orient;
  const candidates = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    const sameLine = orient === 'h'
      ? Math.abs(a.y - b.y) < 0.5 && Math.abs(a.y - wall.edge) < 0.5
      : Math.abs(a.x - b.x) < 0.5 && Math.abs(a.x - wall.edge) < 0.5;
    if (!sameLine) continue;
    const from = orient === 'h' ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const to = orient === 'h' ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    if (to - from > 200 && at >= from - 1 && at <= to + 1) candidates.push({ i, a, b, from, to });
  }
  const edge = candidates[0];
  if (!edge) return false;
  const along = Math.max(edge.from + 100, Math.min(edge.to - 100, Number.isFinite(at) ? at : (edge.from + edge.to) / 2));
  const split = orient === 'h' ? { x: along, y: edge.a.y } : { x: edge.a.x, y: along };
  points.splice(edge.i + 1, 0, { ...split }, { ...split });
  room.outline = points.map((p) => ({ x: p.x - room.x, y: p.y - room.y }));
  delete room.notch;
  return true;
}

export function clampRoomNotch(room, minArm = 900) {
  if (!room?.notch || !CORNERS.has(room.notch.corner)) return null;
  const maxW = Math.max(0, room.w - minArm);
  const maxH = Math.max(0, room.h - minArm);
  const w = Math.min(maxW, Math.max(0, Number(room.notch.w) || 0));
  const h = Math.min(maxH, Math.max(0, Number(room.notch.h) || 0));
  if (w < 100 || h < 100) { delete room.notch; return null; }
  room.notch.w = w;
  room.notch.h = h;
  return room.notch;
}

export function roomNotchRect(room) {
  const notch = room?.notch;
  if (!notch || !CORNERS.has(notch.corner)) return null;
  const w = Math.min(Math.max(0, Number(notch.w) || 0), room.w);
  const h = Math.min(Math.max(0, Number(notch.h) || 0), room.h);
  if (w < 1 || h < 1) return null;
  const east = notch.corner.endsWith('e');
  const south = notch.corner.startsWith('s');
  return { x: east ? room.x + room.w - w : room.x, y: south ? room.y + room.h - h : room.y, w, h };
}

// Два неперекрывающихся прямоугольника, объединение которых равно комнате.
export function roomRects(room) {
  const outline = outlinePoints(room);
  if (outline) return polygonRects(outline);
  const cut = roomNotchRect(room);
  if (!cut) return [{ x: room.x, y: room.y, w: room.w, h: room.h }];
  const c = room.notch.corner;
  if (c === 'nw') return [
    { x: cut.x + cut.w, y: room.y, w: room.w - cut.w, h: room.h },
    { x: room.x, y: cut.y + cut.h, w: cut.w, h: room.h - cut.h },
  ];
  if (c === 'ne') return [
    { x: room.x, y: room.y, w: room.w - cut.w, h: room.h },
    { x: cut.x, y: cut.y + cut.h, w: cut.w, h: room.h - cut.h },
  ];
  if (c === 'se') return [
    { x: room.x, y: room.y, w: room.w - cut.w, h: room.h },
    { x: cut.x, y: room.y, w: cut.w, h: room.h - cut.h },
  ];
  return [
    { x: cut.x + cut.w, y: room.y, w: room.w - cut.w, h: room.h },
    { x: room.x, y: room.y, w: cut.w, h: room.h - cut.h },
  ];
}

export function roomContainsPoint(room, x, y) {
  const outline = outlinePoints(room);
  if (outline) return pointInPolygon(outline, x, y);
  if (x < room.x || x > room.x + room.w || y < room.y || y > room.y + room.h) return false;
  const cut = roomNotchRect(room);
  return !cut || x < cut.x || x > cut.x + cut.w || y < cut.y || y > cut.y + cut.h;
}

export function roomShapeArea(room) {
  const outline = outlinePoints(room);
  if (outline) {
    let twice = 0;
    for (let i = 0; i < outline.length; i += 1) {
      const a = outline[i]; const b = outline[(i + 1) % outline.length];
      twice += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twice) / 2;
  }
  return roomRects(room).reduce((sum, rect) => sum + rect.w * rect.h, 0);
}

export function roomLabelPoint(room) {
  const rect = [...roomRects(room)].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function roomNotchInnerPoint(room) {
  const cut = roomNotchRect(room);
  if (!cut) return null;
  const c = room.notch.corner;
  return {
    x: c.endsWith('e') ? cut.x : cut.x + cut.w,
    y: c.startsWith('s') ? cut.y : cut.y + cut.h,
  };
}

function shapeLines(room) {
  const cut = roomNotchRect(room);
  if (!cut) return null;
  return {
    x0: room.x, x1: room.notch.corner.endsWith('e') ? cut.x : cut.x + cut.w, x2: room.x + room.w,
    y0: room.y, y1: room.notch.corner.startsWith('s') ? cut.y : cut.y + cut.h, y2: room.y + room.h,
  };
}

function shapeVertexTokens(corner) {
  if (corner === 'nw') return [['x1', 'y0'], ['x2', 'y0'], ['x2', 'y2'], ['x0', 'y2'], ['x0', 'y1'], ['x1', 'y1']];
  if (corner === 'ne') return [['x0', 'y0'], ['x1', 'y0'], ['x1', 'y1'], ['x2', 'y1'], ['x2', 'y2'], ['x0', 'y2']];
  if (corner === 'se') return [['x0', 'y0'], ['x2', 'y0'], ['x2', 'y1'], ['x1', 'y1'], ['x1', 'y2'], ['x0', 'y2']];
  return [['x0', 'y0'], ['x2', 'y0'], ['x2', 'y2'], ['x1', 'y2'], ['x1', 'y1'], ['x0', 'y1']];
}

// Для Г-комнаты: шесть вершин + шесть середин стен. moveX/moveY указывают,
// какую координатную линию двигает ручка.
export function roomShapeHandles(room) {
  const outline = outlinePoints(room);
  if (outline) {
    const handles = outline.map((point, index) => ({
      id: `outline-v-${index}`, kind: 'vertex', outline: true, index, x: point.x, y: point.y,
    }));
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index]; const b = outline[(index + 1) % outline.length];
      if (samePoint(a, b)) continue;
      handles.push({
        id: `outline-e-${index}`, kind: 'edge', outline: true, index,
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      });
    }
    return handles;
  }
  const lines = shapeLines(room);
  if (!lines) return [];
  const tokens = shapeVertexTokens(room.notch.corner);
  const handles = tokens.map(([moveX, moveY], index) => ({
    id: `shape-v-${index}`, kind: 'vertex', x: lines[moveX], y: lines[moveY], moveX, moveY,
  }));
  for (let index = 0; index < tokens.length; index += 1) {
    const [ax, ay] = tokens[index];
    const [bx, by] = tokens[(index + 1) % tokens.length];
    handles.push({
      id: `shape-e-${index}`,
      kind: 'edge',
      x: (lines[ax] + lines[bx]) / 2,
      y: (lines[ay] + lines[by]) / 2,
      ...(ax === bx ? { moveX: ax } : { moveY: ay }),
    });
  }
  return handles;
}

// Двигает одну/две линии Г-контура. При совмещении внутренней линии с той
// наружной, из которой сделан уступ, вырез исчезает и комната снова становится
// единым прямоугольником.
export function applyRoomShapeHandle(room, handle, point, { minArm = 900, mergeTolerance = 0 } = {}) {
  if (handle.outline && Array.isArray(room.outline)) {
    const points = room.outline.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    const i = handle.index;
    const prev = (i - 1 + points.length) % points.length;
    const next = (i + 1) % points.length;
    const local = { x: point.x - room.x, y: point.y - room.y };
    const snapLine = (value, axis) => {
      const close = points.map((p) => p[axis]).find((candidate) => Math.abs(candidate - value) <= mergeTolerance);
      return close === undefined ? value : close;
    };
    if (handle.kind === 'edge') {
      const a = points[i]; const b = points[next];
      if (Math.abs(a.y - b.y) < 1) a.y = b.y = snapLine(local.y, 'y');
      else a.x = b.x = snapLine(local.x, 'x');
    } else {
      const a = points[prev]; const b = points[i]; const c = points[next];
      if (Math.abs(a.y - b.y) < 1) a.y = b.y = snapLine(local.y, 'y');
      else a.x = b.x = snapLine(local.x, 'x');
      if (Math.abs(b.y - c.y) < 1) b.y = c.y = snapLine(local.y, 'y');
      else b.x = c.x = snapLine(local.x, 'x');
    }
    room.outline = points;
    return { merged: false };
  }
  if (!room.notch) return { merged: false };
  const lines = shapeLines(room);
  const east = room.notch.corner.endsWith('e');
  const south = room.notch.corner.startsWith('s');
  const anchorX = east ? 'x2' : 'x0';
  const anchorY = south ? 'y2' : 'y0';
  const wantsMergeX = (handle.moveX === 'x1' || handle.moveX === anchorX)
    && Math.abs(point.x - lines[handle.moveX === 'x1' ? anchorX : 'x1']) <= mergeTolerance;
  const wantsMergeY = (handle.moveY === 'y1' || handle.moveY === anchorY)
    && Math.abs(point.y - lines[handle.moveY === 'y1' ? anchorY : 'y1']) <= mergeTolerance;
  if (wantsMergeX || wantsMergeY) {
    // Если к внутренней линии подвели наружную стену, новый прямоугольник
    // должен сохранить именно уменьшенный габарит, а не прежнюю оболочку.
    if (handle.moveX) lines[handle.moveX] = point.x;
    if (handle.moveY) lines[handle.moveY] = point.y;
    room.x = lines.x0;
    room.y = lines.y0;
    room.w = lines.x2 - lines.x0;
    room.h = lines.y2 - lines.y0;
    delete room.notch;
    return { merged: true };
  }

  if (handle.moveX) lines[handle.moveX] = point.x;
  if (handle.moveY) lines[handle.moveY] = point.y;
  lines.x1 = Math.max(lines.x0 + minArm, Math.min(lines.x2 - minArm, lines.x1));
  lines.y1 = Math.max(lines.y0 + minArm, Math.min(lines.y2 - minArm, lines.y1));
  if (lines.x0 > lines.x1 - minArm) lines.x0 = lines.x1 - minArm;
  if (lines.x2 < lines.x1 + minArm) lines.x2 = lines.x1 + minArm;
  if (lines.y0 > lines.y1 - minArm) lines.y0 = lines.y1 - minArm;
  if (lines.y2 < lines.y1 + minArm) lines.y2 = lines.y1 + minArm;
  room.x = lines.x0;
  room.y = lines.y0;
  room.w = lines.x2 - lines.x0;
  room.h = lines.y2 - lines.y0;
  room.notch.w = east ? lines.x2 - lines.x1 : lines.x1 - lines.x0;
  room.notch.h = south ? lines.y2 - lines.y1 : lines.y1 - lines.y0;
  return { merged: false };
}

// Шесть вершин по контуру комнаты, без повторения первой.
export function roomPolygon(room) {
  const outline = outlinePoints(room);
  if (outline) return outline;
  const cut = roomNotchRect(room);
  if (!cut) return [
    { x: room.x, y: room.y }, { x: room.x + room.w, y: room.y },
    { x: room.x + room.w, y: room.y + room.h }, { x: room.x, y: room.y + room.h },
  ];
  const x0 = room.x; const x1 = cut.x; const x2 = cut.x + cut.w; const x3 = room.x + room.w;
  const y0 = room.y; const y1 = cut.y; const y2 = cut.y + cut.h; const y3 = room.y + room.h;
  if (room.notch.corner === 'nw') return [{ x: x2, y: y0 }, { x: x3, y: y0 }, { x: x3, y: y3 }, { x: x0, y: y3 }, { x: x0, y: y2 }, { x: x2, y: y2 }];
  if (room.notch.corner === 'ne') return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y2 }, { x: x3, y: y2 }, { x: x3, y: y3 }, { x: x0, y: y3 }];
  if (room.notch.corner === 'se') return [{ x: x0, y: y0 }, { x: x3, y: y0 }, { x: x3, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y3 }, { x: x0, y: y3 }];
  return [{ x: x0, y: y0 }, { x: x3, y: y0 }, { x: x3, y: y3 }, { x: x2, y: y3 }, { x: x2, y: y1 }, { x: x0, y: y1 }];
}

export function roomBoundaryEdges(room) {
  const points = roomPolygon(room);
  const custom = Boolean(outlinePoints(room));
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]; const b = points[(index + 1) % points.length];
    if (samePoint(a, b)) continue;
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    const vertical = Math.abs(a.x - b.x) < 0.5;
    if (!horizontal && !vertical) continue;
    const orient = horizontal ? 'h' : 'v';
    const edge = horizontal ? a.y : a.x;
    const from = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const to = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const outward = horizontal ? (b.x > a.x ? -1 : 1) : (b.y > a.y ? 1 : -1);
    let side = custom ? `outline-${index}` : (horizontal ? 'notch-h' : 'notch-v');
    if (horizontal && Math.abs(edge - room.y) < 0.5) side = 0;
    else if (vertical && Math.abs(edge - (room.x + room.w)) < 0.5) side = 1;
    else if (horizontal && Math.abs(edge - (room.y + room.h)) < 0.5) side = 2;
    else if (vertical && Math.abs(edge - room.x) < 0.5) side = 3;
    result.push({ side, orient, edge, from, to, outward, index });
  }
  return result;
}

// Внутренние стороны углового выреза — новые наружные стены комнаты.
export function roomNotchEdges(room) {
  if (outlinePoints(room)) return [];
  const cut = roomNotchRect(room);
  if (!cut) return [];
  const c = room.notch.corner;
  const east = c.endsWith('e');
  const south = c.startsWith('s');
  return [
    { side: 'notch-v', orient: 'v', edge: east ? cut.x : cut.x + cut.w, from: cut.y, to: cut.y + cut.h, outward: east ? 1 : -1 },
    { side: 'notch-h', orient: 'h', edge: south ? cut.y : cut.y + cut.h, from: cut.x, to: cut.x + cut.w, outward: south ? 1 : -1 },
  ];
}

// Части двух старых наружных сторон, которые исчезают после выреза.
export function roomNotchSideCuts(room) {
  if (outlinePoints(room)) return {};
  const cut = roomNotchRect(room);
  if (!cut) return {};
  const c = room.notch.corner;
  const horizontalSide = c.startsWith('n') ? 0 : 2;
  const verticalSide = c.endsWith('e') ? 1 : 3;
  return {
    [horizontalSide]: [{ from: cut.x, to: cut.x + cut.w }],
    [verticalSide]: [{ from: cut.y, to: cut.y + cut.h }],
  };
}

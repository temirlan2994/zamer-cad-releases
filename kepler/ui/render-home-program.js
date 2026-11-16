// Экранная схема функциональных связей «Программы дома».
// Core выбирает пары помещений и проверяет граф проходов; renderer только
// показывает доказанный результат и никогда не меняет геометрию проекта.

import { roomLabelPoint } from '../core/room-shape.js';

const DRAWABLE = new Set(['direct', 'reachable', 'adjacent_without_door']);

const asArray = (value) => (Array.isArray(value) ? value : []);

function connectionPaths(result) {
  const out = [];
  const seen = new Set();
  const append = (entry, parent = null, index = 0) => {
    if (!entry || typeof entry !== 'object') return;
    const merged = parent ? {
      ...entry,
      id: entry.id || `${parent.id || 'connection'}:${index + 1}`,
      title: entry.title || parent.title,
      status: entry.status || parent.status,
      reason: entry.reason || parent.reason,
      levelId: entry.levelId || parent.levelId,
      sourceRoomIds: entry.sourceRoomIds || parent.sourceRoomIds,
      targetRoomIds: entry.targetRoomIds || parent.targetRoomIds,
    } : entry;
    const key = String(merged.id || `${merged.levelId || ''}:${merged.fromRoomId || ''}:${merged.toRoomId || ''}:${merged.status || ''}`);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(merged);
  };
  for (const connection of asArray(result?.connections)) {
    const paths = asArray(connection?.paths);
    if (paths.length) paths.forEach((path, index) => append(path, connection, index));
    else append(connection);
  }
  asArray(result?.paths).forEach((path, index) => append(path, null, index));
  return out;
}

function firstExisting(ids, rooms) {
  return asArray(ids).find((id) => rooms.has(id)) || null;
}

function roomIdsFor(path, rooms) {
  const from = rooms.has(path?.fromRoomId)
    ? path.fromRoomId : firstExisting(path?.sourceRoomIds, rooms);
  const to = rooms.has(path?.toRoomId)
    ? path.toRoomId : firstExisting(path?.targetRoomIds, rooms);
  if (!from || !to) return [];
  if (path.status === 'reachable') {
    const supplied = asArray(path.pathRoomIds).filter((id) => rooms.has(id));
    if (supplied.length >= 2 && supplied[0] === from && supplied.at(-1) === to) return supplied;
    if (supplied.length >= 2 && supplied[0] === to && supplied.at(-1) === from) return [...supplied].reverse();
  }
  return [from, to];
}

function screenPoints(ids, rooms, p2s) {
  const result = [];
  for (const id of ids) {
    const room = rooms.get(id);
    if (!room) return [];
    const anchor = roomLabelPoint(room);
    const point = p2s(anchor.x, anchor.y);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    const previous = result.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5) result.push(point);
  }
  return result;
}

function styleFor(status, tokens) {
  if (status === 'direct') return { color: tokens?.ok || '#0e7a4e', dash: [] };
  if (status === 'reachable') return { color: tokens?.accent || '#1f75ff', dash: [] };
  return { color: tokens?.warn || '#9a6500', dash: [7, 5] };
}

function strokePath(ctx, points, style, tokens) {
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(style.dash);
  ctx.strokeStyle = tokens?.surface || '#fff';
  ctx.globalAlpha = 0.86;
  ctx.lineWidth = 6;
  trace();
  ctx.stroke();
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = 0.92;
  ctx.lineWidth = 2.2;
  trace();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = style.color;
  for (const point of [points[0], points.at(-1)]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (style.dash.length) {
    const middle = points[Math.floor((points.length - 1) / 2)];
    const next = points[Math.min(points.length - 1, Math.floor((points.length - 1) / 2) + 1)];
    const marker = { x: (middle.x + next.x) / 2, y: (middle.y + next.y) / 2 };
    ctx.fillStyle = tokens?.surface || '#fff';
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = style.color;
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', marker.x, marker.y + 0.5);
  }
  ctx.restore();
}

/**
 * Рисует логические связи активного этажа в экранных координатах.
 * Это не навигационная сетка и не фактическая траектория движения человека.
 */
export function drawHomeProgramOverlay(ctx, {
  st, p2s, tokens, print = false,
} = {}) {
  const view = st?.homeProgramOverlay;
  const result = view?.result;
  if (!st || !ctx || typeof p2s !== 'function' || print
    || st.modeName !== 'plan' || view?.on !== true || !result) {
    if (st) st._homeProgramUI = null;
    return null;
  }

  const activeLevel = st.project?.activeLevel || null;
  const rooms = new Map(asArray(st.project?.rooms).map((room) => [room.id, room]));
  const paths = connectionPaths(result);
  const statusCounts = {};
  for (const path of paths) {
    const status = path?.status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const eligible = paths.filter((path) => DRAWABLE.has(path?.status)
    && (!path.levelId || !activeLevel || path.levelId === activeLevel));
  const drawn = [];
  for (const path of eligible) {
    const ids = roomIdsFor(path, rooms);
    const points = screenPoints(ids, rooms, p2s);
    // Совмещённая зона может честно выполнить связь одним помещением.
    if (points.length < 2) continue;
    strokePath(ctx, points, styleFor(path.status, tokens), tokens);
    drawn.push({
      id: path.id || null,
      status: path.status,
      fromRoomId: ids[0],
      toRoomId: ids.at(-1),
      pointCount: points.length,
    });
  }

  const summary = {
    active: true,
    levelId: activeLevel,
    eligibleConnectionCount: eligible.length,
    drawnConnectionCount: drawn.length,
    statusCounts,
    paths: drawn,
  };
  st._homeProgramUI = summary;
  return summary;
}

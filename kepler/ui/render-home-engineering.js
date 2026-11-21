// Экранный слой предварительного инженерного обзора.
// Он показывает только известные потребности помещений, введённые точки и
// геометрические кандидаты. Пунктир не является трассой трубы/воздуховода.

import { roomLabelPoint, roomPolygon } from '../core/room-shape.js';

const asArray = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => Number.isFinite(Number(value));

const COLORS = Object.freeze({
  wet: '#168c9a',
  extract: '#c77b17',
  supply: '#3975c4',
  candidate: '#9a6500',
  point: '#136f83',
  conflict: '#c23b42',
});

function levelIdOf(value) {
  return value?.levelId ?? value?.level_id ?? value?.floorId ?? value?.floor_id ?? null;
}
function roomIdOf(value) {
  return value?.roomId ?? value?.room_id ?? value?.id ?? null;
}

function recordStatus(value) {
  return String(value?.status ?? value?.state ?? value?.result ?? 'unknown').toLocaleLowerCase('ru-RU');
}

function isConflict(value) {
  return ['conflict', 'contradiction', 'invalid', 'error'].includes(recordStatus(value));
}

function roomNeedRecords(result) {
  const sources = [
    result?.roomNeeds,
    result?.needs?.rooms,
    result?.requirements?.rooms,
    result?.rooms,
  ];
  return sources.find(Array.isArray) || [];
}

function needFlags(record) {
  const named = new Set(asArray(record?.needs ?? record?.systems ?? record?.requirements)
    .map((value) => String(value?.id ?? value?.kind ?? value).toLocaleLowerCase('ru-RU')));
  const wet = record?.wet === true || record?.needsWet === true || record?.waterDrain === true
    || record?.water === true || record?.drain === true || named.has('wet')
    || named.has('water') || named.has('drain') || named.has('water_drain');
  const extract = record?.extract === true || record?.needsExtract === true
    || record?.ventExtract === true || named.has('extract') || named.has('vent_extract');
  const supply = record?.supply === true || record?.needsSupply === true
    || record?.ventSupply === true || named.has('supply') || named.has('vent_supply');
  return { wet, extract, supply };
}

function pointRecords(result) {
  const sources = [
    result?.fixedPoints,
    result?.points?.records,
    result?.points,
    result?.engineeringPoints,
  ];
  return sources.find(Array.isArray) || [];
}

function candidateRecords(result) {
  const sameLevel = [
    result?.sameLevelCandidates,
    result?.candidates?.sameLevel,
    result?.candidates?.horizontal,
    result?.horizontalCandidates,
  ].find(Array.isArray) || [];
  const vertical = [
    result?.verticalCandidates,
    result?.candidates?.vertical,
    result?.stackCandidates,
  ].find(Array.isArray) || [];
  const shafts = asArray(result?.candidates?.shafts);
  if (sameLevel.length || vertical.length || shafts.length) {
    // Геометрическая шахта остаётся только кандидатом совмещения: маркер
    // намеренно не похож на готовый стояк и не соединяет этажи линией.
    return { sameLevel, vertical: [...vertical, ...shafts] };
  }
  const flat = asArray(result?.candidates);
  return {
    sameLevel: flat.filter((entry) => !['vertical', 'stack', 'overlap'].includes(entry?.kind)),
    vertical: flat.filter((entry) => ['vertical', 'stack', 'overlap'].includes(entry?.kind)),
  };
}

function roomIdFromKey(value) {
  if (typeof value !== 'string' || !value) return null;
  const separator = value.indexOf(':');
  return separator >= 0 ? value.slice(separator + 1) : value;
}

function screenRoomPath(ctx, room, p2s) {
  let points;
  try { points = roomPolygon(room).map((point) => p2s(point.x, point.y)); } catch { return false; }
  if (!points.length || points.some((point) => !finite(point?.x) || !finite(point?.y))) return false;
  ctx.beginPath();
  points.forEach((point, index) => (index
    ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
  ctx.closePath();
  return true;
}

function roomScreenBounds(room, p2s) {
  let points;
  try { points = roomPolygon(room).map((point) => p2s(point.x, point.y)); } catch { return null; }
  if (!points.length || points.some((point) => !finite(point?.x) || !finite(point?.y))) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

function drawHatch(ctx, room, p2s, color, reverse = false) {
  const bounds = roomScreenBounds(room, p2s);
  if (!bounds) return;
  ctx.save();
  if (!screenRoomPath(ctx, room, p2s)) { ctx.restore(); return; }
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1;
  const span = (bounds.maxY - bounds.minY) + (bounds.maxX - bounds.minX);
  const start = bounds.minX - (bounds.maxY - bounds.minY);
  ctx.beginPath();
  for (let x = start; x <= bounds.maxX + span; x += 13) {
    if (reverse) {
      ctx.moveTo(x, bounds.maxY);
      ctx.lineTo(x + (bounds.maxY - bounds.minY), bounds.minY);
    } else {
      ctx.moveTo(x, bounds.minY);
      ctx.lineTo(x + (bounds.maxY - bounds.minY), bounds.maxY);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawRoomNeed(ctx, room, flags, p2s) {
  if (flags.wet) {
    ctx.save();
    if (screenRoomPath(ctx, room, p2s)) {
      ctx.fillStyle = COLORS.wet;
      ctx.globalAlpha = 0.1;
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = COLORS.wet;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (flags.extract) drawHatch(ctx, room, p2s, COLORS.extract);
  if (flags.supply) drawHatch(ctx, room, p2s, COLORS.supply, true);
}

function roomAnchor(room, p2s) {
  if (!room) return null;
  let point;
  try { point = roomLabelPoint(room); } catch { return null; }
  const screen = p2s(point.x, point.y);
  return finite(screen?.x) && finite(screen?.y) ? screen : null;
}

function endpointRoomIds(candidate) {
  const a = candidate?.roomAId ?? candidate?.fromRoomId ?? candidate?.aRoomId
    ?? candidate?.a?.roomId ?? candidate?.from?.roomId ?? candidate?.rooms?.[0]?.roomId
    ?? candidate?.roomIds?.[0] ?? roomIdFromKey(candidate?.roomKeys?.[0]) ?? null;
  const b = candidate?.roomBId ?? candidate?.toRoomId ?? candidate?.bRoomId
    ?? candidate?.b?.roomId ?? candidate?.to?.roomId ?? candidate?.rooms?.[1]?.roomId
    ?? candidate?.roomIds?.[1] ?? roomIdFromKey(candidate?.roomKeys?.[1]) ?? null;
  return [a, b];
}

function candidateLevel(candidate) {
  return levelIdOf(candidate) ?? levelIdOf(candidate?.from) ?? levelIdOf(candidate?.a)
    ?? levelIdOf(candidate?.rooms?.[0]) ?? candidate?.levelIds?.[0] ?? null;
}

function drawCandidateLink(ctx, candidate, rooms, p2s, tokens) {
  const [aId, bId] = endpointRoomIds(candidate);
  const a = roomAnchor(rooms.get(aId), p2s);
  const b = roomAnchor(rooms.get(bId), p2s);
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 1) return null;
  ctx.save();
  ctx.setLineDash([4, 5]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = tokens?.surface || '#fff';
  ctx.globalAlpha = 0.82;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.strokeStyle = COLORS.candidate;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.restore();
  return { id: candidate?.id ?? null, roomAId: aId, roomBId: bId };
}

function activeVerticalRoom(candidate, activeLevel, rooms) {
  const endpoints = [
    candidate?.lower, candidate?.upper, candidate?.from, candidate?.to,
    candidate?.a, candidate?.b, ...asArray(candidate?.rooms), ...asArray(candidate?.endpoints),
  ].filter(Boolean);
  const endpoint = endpoints.find((entry) => (!levelIdOf(entry) || levelIdOf(entry) === activeLevel)
    && rooms.has(roomIdOf(entry)));
  if (endpoint) return rooms.get(roomIdOf(endpoint));
  const keyed = asArray(candidate?.roomKeys).find((key) => {
    if (typeof key !== 'string') return false;
    const roomId = roomIdFromKey(key);
    return rooms.has(roomId) && (!activeLevel || key.startsWith(`${activeLevel}:`));
  });
  if (keyed) return rooms.get(roomIdFromKey(keyed));
  const [aId, bId] = endpointRoomIds(candidate);
  return rooms.get(aId) || rooms.get(bId) || null;
}

function drawVerticalCandidate(ctx, candidate, activeLevel, rooms, p2s, tokens) {
  const room = activeVerticalRoom(candidate, activeLevel, rooms);
  const point = roomAnchor(room, p2s);
  if (!point) return null;
  ctx.save();
  ctx.fillStyle = tokens?.surface || '#fff';
  ctx.strokeStyle = COLORS.candidate;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.94;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(point.x - 3, point.y - 2);
  ctx.lineTo(point.x, point.y - 5);
  ctx.lineTo(point.x + 3, point.y - 2);
  ctx.moveTo(point.x - 3, point.y + 2);
  ctx.lineTo(point.x, point.y + 5);
  ctx.lineTo(point.x + 3, point.y + 2);
  ctx.stroke();
  ctx.restore();
  return { id: candidate?.id ?? null, roomId: room.id };
}

function pointCoordinates(record) {
  const source = record?.point && typeof record.point === 'object' ? record.point : record;
  const x = source?.x ?? source?.point?.x ?? source?.position?.x;
  const y = source?.y ?? source?.point?.y ?? source?.position?.y;
  return finite(x) && finite(y) ? { x: Number(x), y: Number(y) } : null;
}

function pointKind(record) {
  const source = record?.point && typeof record.point === 'object' ? record.point : record;
  return source?.kind ?? source?.systemType ?? source?.system_type ?? 'other';
}

function pointLevel(record) {
  const source = record?.point && typeof record.point === 'object' ? record.point : record;
  return levelIdOf(source) ?? levelIdOf(record);
}

function pointGlyph(kind) {
  const value = String(kind || '').toLocaleLowerCase('ru-RU');
  if (value.includes('drain')) return 'К';
  if (value.includes('water')) return 'В';
  if (value.includes('vent')) return '↥';
  if (value.includes('power') || value.includes('outlet') || value.includes('switch')) return 'Э';
  if (value.includes('gas')) return 'Г';
  return '•';
}

function drawPoint(ctx, record, p2s, tokens) {
  const world = pointCoordinates(record);
  if (!world) return null;
  const point = p2s(world.x, world.y);
  if (!finite(point?.x) || !finite(point?.y)) return null;
  const conflict = isConflict(record) || isConflict(record?.validation);
  const color = conflict ? (tokens?.danger || COLORS.conflict) : COLORS.point;
  ctx.save();
  ctx.fillStyle = tokens?.surface || '#fff';
  ctx.strokeStyle = color;
  ctx.lineWidth = conflict ? 2.1 : 1.6;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(conflict ? '!' : pointGlyph(pointKind(record)), point.x, point.y + 0.3);
  ctx.restore();
  return {
    id: record?.id ?? record?.point?.id ?? null,
    kind: pointKind(record),
    status: conflict ? 'conflict' : recordStatus(record),
  };
}

/**
 * Рисует предварительный инженерный обзор активного этажа.
 * Пунктирные связи — лишь кандидаты компактной группировки, не трассы.
 */
export function drawHomeEngineeringOverlay(ctx, {
  st, p2s, tokens, print = false,
} = {}) {
  const view = st?.homeEngineeringOverlay;
  const result = view?.result;
  if (!st || !ctx || typeof p2s !== 'function' || print
      || st.modeName !== 'plan' || view?.on !== true || !result) {
    if (st) st._homeEngineeringUI = null;
    return null;
  }

  const activeLevel = st.project?.activeLevel || null;
  const rooms = new Map(asArray(st.project?.rooms).map((room) => [room.id, room]));
  const needsDrawn = [];
  for (const record of roomNeedRecords(result)) {
    if (levelIdOf(record) && activeLevel && levelIdOf(record) !== activeLevel) continue;
    const roomId = roomIdOf(record);
    const room = rooms.get(roomId);
    if (!room) continue;
    const flags = needFlags(record);
    if (!flags.wet && !flags.extract && !flags.supply) continue;
    drawRoomNeed(ctx, room, flags, p2s);
    needsDrawn.push({ roomId, ...flags });
  }

  const candidates = candidateRecords(result);
  const linksDrawn = candidates.sameLevel
    .filter((candidate) => !candidateLevel(candidate) || !activeLevel || candidateLevel(candidate) === activeLevel)
    .map((candidate) => drawCandidateLink(ctx, candidate, rooms, p2s, tokens))
    .filter(Boolean);
  const verticalDrawn = candidates.vertical
    .map((candidate) => drawVerticalCandidate(ctx, candidate, activeLevel, rooms, p2s, tokens))
    .filter(Boolean);

  const pointsDrawn = pointRecords(result)
    .filter((record) => !pointLevel(record) || !activeLevel || pointLevel(record) === activeLevel)
    .map((record) => drawPoint(ctx, record, p2s, tokens))
    .filter(Boolean);

  const summary = {
    active: true,
    levelId: activeLevel,
    roomNeedCount: needsDrawn.length,
    wetRoomCount: needsDrawn.filter((entry) => entry.wet).length,
    extractRoomCount: needsDrawn.filter((entry) => entry.extract).length,
    supplyRoomCount: needsDrawn.filter((entry) => entry.supply).length,
    explicitPointCount: pointsDrawn.length,
    candidateLinkCount: linksDrawn.length,
    verticalCandidateCount: verticalDrawn.length,
    conflictCount: pointsDrawn.filter((entry) => entry.status === 'conflict').length,
    rooms: needsDrawn,
    points: pointsDrawn,
    candidates: linksDrawn,
    verticalCandidates: verticalDrawn,
  };
  st._homeEngineeringUI = summary;
  return summary;
}

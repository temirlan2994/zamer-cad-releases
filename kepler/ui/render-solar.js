// Canvas-слой световых карт. Координаты points уже в осях
// дома, поэтому render.js вызывает функцию в том же world-context,
// где рисуются полы. Слой декоративный и не ловит клики.

import { roomDaylightAnalysis, roomDaylightAnalysisKey } from '../core/daylight-analysis.js';
import { roomSunlightAnalysis, roomSunlightAnalysisKey } from '../core/solar-analysis.js';
import { roomPolygon } from '../core/room-shape.js';
import { state } from './state.js';

const CACHE_LIMIT = 16;
const analysisCache = new Map();
const LIGHT = ['#b7c5d6', '#78a9d1', '#f1cf63', '#ef9b3f', '#df642f'];
const DARK = ['#526477', '#4e83ad', '#c7aa4a', '#cf7d31', '#d75e38'];
const DAYLIGHT_LIGHT = ['#c7d0dc', '#91b9d7', '#e2ca68', '#ed9743', '#d95e3b'];
const DAYLIGHT_DARK = ['#566779', '#5687aa', '#bca94f', '#c98039', '#cf6543'];

function selectedRoomId() {
  const selection = state.selection;
  if (selection?.type === 'room') return selection.id;
  if (selection?.type === 'opening') {
    return state.project?.openings?.find((opening) => opening.id === selection.id)?.roomId || null;
  }
  return null;
}

function activeRoomLevel(roomId) {
  const project = state.project;
  const active = project?.levels?.find((level) => level.id === project.activeLevel);
  return active?.rooms?.some((room) => room.id === roomId) ? active.id : null;
}

function cachePut(key, value) {
  analysisCache.delete(key);
  analysisCache.set(key, value);
  while (analysisCache.size > CACHE_LIMIT) analysisCache.delete(analysisCache.keys().next().value);
}

/** DOM-free кэш расчёта: render.js импортируется и в node-тестах. */
export function currentSolarAnalysis(roomId = state.solarAnalysis?.roomId || selectedRoomId()) {
  const project = state.project;
  if (!project || !roomId) return null;
  const levelId = activeRoomLevel(roomId);
  if (!levelId) return null;
  const pref = state.solarAnalysis || {};
  const options = {
    levelId, roomId, date: pref.date, from: pref.from, to: pref.to,
    stepMin: pref.stepMin, cell: pref.cell, maxCells: pref.maxCells, workplane: pref.workplane,
  };
  const key = roomSunlightAnalysisKey(project, options);
  let result = analysisCache.get(key) || null;
  if (!result) {
    result = roomSunlightAnalysis(project, options);
    if (result) cachePut(key, result);
  } else {
    analysisCache.delete(key);
    analysisCache.set(key, result);
  }
  return result;
}

/** Предварительный КЕО/люксы с тем же LRU-кэшем, что и карта солнца. */
export function currentDaylightAnalysis(roomId = state.solarAnalysis?.roomId || selectedRoomId()) {
  const project = state.project;
  if (!project || !roomId) return null;
  const levelId = activeRoomLevel(roomId);
  if (!levelId) return null;
  const pref = state.solarAnalysis || {};
  const options = {
    levelId, roomId, cell: pref.cell, maxCells: pref.maxCells, workplane: pref.workplane,
    transmittance: pref.transmittance, frameFactor: pref.frameFactor,
    maintenanceFactor: pref.maintenanceFactor, interiorReflectance: pref.interiorReflectance,
    exteriorLux: pref.exteriorLux,
  };
  const key = roomDaylightAnalysisKey(project, options);
  let result = analysisCache.get(key) || null;
  if (!result) {
    result = roomDaylightAnalysis(project, options);
    if (result) cachePut(key, result);
  } else {
    analysisCache.delete(key);
    analysisCache.set(key, result);
  }
  return result;
}

/** Активный слой для render.js; переключение не меняет геометрию. */
export function currentLightAnalysis(roomId = state.solarAnalysis?.roomId || selectedRoomId()) {
  return state.solarAnalysis?.mode === 'daylight'
    ? currentDaylightAnalysis(roomId)
    : currentSolarAnalysis(roomId);
}

function isDark(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const luminance = 0.2126 * (value >> 16) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
  return luminance < 115;
}

function colorIndex(hours) {
  if (!(hours > 0)) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 6) return 3;
  return 4;
}

function daylightColorIndex(lux) {
  if (!(lux > 0)) return 0;
  if (lux < 100) return 1;
  if (lux < 300) return 2;
  if (lux < 500) return 3;
  return 4;
}

function roomPath(ctx, room) {
  const points = roomPolygon(room);
  if (!points.length) return false;
  ctx.beginPath();
  points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
  ctx.closePath();
  return true;
}

function drawEstimateHatch(ctx, room, points, color, px) {
  const spacing = px(13);
  const min = room.x - room.h;
  const max = room.x + room.w + room.h;
  ctx.save();
  const rects = (points || []).flatMap((point) => point.rects?.length
    ? point.rects : [{ x: point.x0, y: point.y0, w: point.w, h: point.h }]);
  if (rects.length) {
    ctx.beginPath();
    for (const rect of rects) ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
  } else if (roomPath(ctx, room)) ctx.clip();
  ctx.beginPath();
  for (let x = min; x <= max; x += spacing) {
    ctx.moveTo(x, room.y + room.h);
    ctx.lineTo(x + room.h, room.y);
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = px(0.75);
  ctx.stroke();
  ctx.restore();
}

/**
 * Рисует одну комнату. `px(n)` переводит экранные px в мм плана.
 * Возвращает короткую сводку для debug/e2e, render.js может её игнорировать.
 */
export function drawRoomSolarAnalysis(ctx, { analysis, room, tokens, px }) {
  const pref = state.solarAnalysis;
  if (!ctx || !analysis || !room || !pref?.on) return null;
  if (pref.mode === 'daylight') return null;
  if (analysis.roomId !== room.id || (pref.roomId && pref.roomId !== room.id)) return null;

  const points = analysis.points || [];
  const dark = isDark(tokens?.canvas);
  const colors = dark ? DARK : LIGHT;
  const muted = tokens?.muted || (dark ? '#9da9b7' : '#687789');
  const gap = px(0.35);
  const counts = [0, 0, 0, 0, 0];

  ctx.save();
  if (roomPath(ctx, room)) ctx.clip();

  if (!analysis.available) {
    ctx.fillStyle = muted;
    ctx.globalAlpha = 0.12;
    for (const point of points) {
      const rects = point.rects?.length ? point.rects : [{ x: point.x0, y: point.y0, w: point.w, h: point.h }];
      for (const rect of rects) ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  } else {
    ctx.globalAlpha = analysis.estimated ? 0.48 : 0.62;
    for (const point of points) {
      const index = colorIndex(Number(point.hours) || 0);
      counts[index] += 1;
      ctx.fillStyle = colors[index];
      const rects = point.rects?.length ? point.rects : [{ x: point.x0, y: point.y0, w: point.w, h: point.h }];
      for (const rect of rects) {
        ctx.fillRect(rect.x + gap, rect.y + gap, Math.max(0, rect.w - gap * 2), Math.max(0, rect.h - gap * 2));
      }
    }
  }
  ctx.restore();

  // Приглушённая штриховка отделяет предварительную оценку от
  // подтверждённого расчёта и не маскирует цветовую шкалу.
  if (analysis.estimated) drawEstimateHatch(ctx, room, points, muted, px);

  ctx.save();
  if (roomPath(ctx, room)) {
    ctx.strokeStyle = analysis.available ? colors[3] : muted;
    ctx.globalAlpha = analysis.verified ? 0.72 : 0.55;
    ctx.lineWidth = px(1.15);
    if (!analysis.verified) ctx.setLineDash([px(6), px(4)]);
    ctx.stroke();
  }
  ctx.restore();

  return {
    roomId: room.id,
    cells: points.length,
    classes: counts,
    available: analysis.available,
    verified: analysis.verified,
    meanMinutes: Math.round(analysis.meanMinutes || 0),
    maxMinutes: Math.round(analysis.maxMinutes || 0),
  };
}

/** Карта освещённости под пасмурным небом: цвет показывает люксы,
 * а числовые КЕО и допущения остаются в DOM-панели. */
export function drawRoomDaylightAnalysis(ctx, { analysis, room, tokens, px }) {
  const pref = state.solarAnalysis;
  if (!ctx || !analysis || !room || !pref?.on || pref.mode !== 'daylight') return null;
  if (analysis.roomId !== room.id || (pref.roomId && pref.roomId !== room.id)) return null;

  const points = analysis.points || [];
  const dark = isDark(tokens?.canvas);
  const colors = dark ? DAYLIGHT_DARK : DAYLIGHT_LIGHT;
  const muted = tokens?.muted || (dark ? '#9da9b7' : '#687789');
  const gap = px(0.35);
  const counts = [0, 0, 0, 0, 0];

  ctx.save();
  if (roomPath(ctx, room)) ctx.clip();
  ctx.globalAlpha = 0.58;
  for (const point of points) {
    const index = daylightColorIndex(Number(point.estimatedLux) || 0);
    counts[index] += 1;
    ctx.fillStyle = colors[index];
    const rects = point.rects?.length ? point.rects : [{ x: point.x0, y: point.y0, w: point.w, h: point.h }];
    for (const rect of rects) {
      ctx.fillRect(rect.x + gap, rect.y + gap, Math.max(0, rect.w - gap * 2), Math.max(0, rect.h - gap * 2));
    }
  }
  ctx.restore();

  // Вся карта предварительная: штрих не даёт принять её за экспертизу.
  drawEstimateHatch(ctx, room, points, muted, px);
  ctx.save();
  if (roomPath(ctx, room)) {
    ctx.strokeStyle = colors[3];
    ctx.globalAlpha = 0.58;
    ctx.lineWidth = px(1.15);
    ctx.setLineDash([px(6), px(4)]);
    ctx.stroke();
  }
  ctx.restore();

  return {
    roomId: room.id,
    cells: points.length,
    classes: counts,
    preliminary: true,
    meanLux: Math.round(analysis.meanLux || 0),
    meanDaylightFactor: Number(analysis.meanDaylightFactor || 0),
  };
}

export function drawRoomLightAnalysis(ctx, args) {
  return state.solarAnalysis?.mode === 'daylight'
    ? drawRoomDaylightAnalysis(ctx, args)
    : drawRoomSolarAnalysis(ctx, args);
}

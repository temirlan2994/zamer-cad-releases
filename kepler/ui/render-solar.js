// Canvas-слой световых карт. Координаты points уже в осях
// дома, поэтому render.js вызывает функцию в том же world-context,
// где рисуются полы. Слой декоративный и не ловит клики.

import { roomDaylightAnalysis, roomDaylightAnalysisKey } from '../core/daylight-analysis.js';
import { solarObstaclesOf, windowsOf } from '../core/insolation.js';
import { roomSunlightAnalysis, roomSunlightAnalysisKey } from '../core/solar-analysis.js';
import { roomPolygon } from '../core/room-shape.js';
import { state } from './state.js';

// Держим как минимум два расчёта для каждого помещения большого дома:
// daylight + direct. Маленький LRU на 16 записей заставлял этаж из 20–40
// комнат пересчитываться на каждом кадре.
const CACHE_LIMIT = 128;
const FLOOR_MAX_CELLS = 196;
const analysisCache = new Map();
const preparedByProject = new WeakMap();
const latestByProject = new WeakMap();
const pendingAnalyses = new Map();
const analysisQueue = [];
let preparedSerial = 0;
let queueHandle = null;
let redrawHook = null;
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

function cacheGet(key) {
  const value = analysisCache.get(key) || null;
  if (value) {
    analysisCache.delete(key);
    analysisCache.set(key, value);
  }
  return value;
}

function latestKey(mode, levelId, roomId) {
  return `${mode}:${levelId}:${roomId}`;
}

function latestGet(project, mode, levelId, roomId) {
  return latestByProject.get(project)?.get(latestKey(mode, levelId, roomId)) || null;
}

function latestPut(project, mode, levelId, roomId, value) {
  let map = latestByProject.get(project);
  if (!map) { map = new Map(); latestByProject.set(project, map); }
  map.set(latestKey(mode, levelId, roomId), value);
}

function analysisRevision(project) {
  if (project === state.project && Number.isFinite(state.analytics?.revision)) return state.analytics.revision;
  return Number(project?.revision) || 0;
}

function discardQueued(predicate) {
  for (let index = analysisQueue.length - 1; index >= 0; index -= 1) {
    const task = analysisQueue[index];
    if (!predicate(task)) continue;
    analysisQueue.splice(index, 1);
    pendingAnalyses.delete(task.key);
    task.resolve(null);
  }
}

function optionsFor(mode, levelId, roomId, pref = state.solarAnalysis || {}) {
  const common = {
    levelId,
    roomId,
    cell: pref.cell,
    // Карта целого этажа остаётся подробной, но одна комната не может
    // монополизировать главный поток 400 расчётными точками.
    maxCells: pref.maxCells ?? (pref.scope === 'level' ? FLOOR_MAX_CELLS : undefined),
    workplane: pref.workplane,
  };
  if (mode === 'direct') {
    return {
      ...common,
      date: pref.date,
      from: pref.from,
      to: pref.to,
      stepMin: pref.stepMin,
    };
  }
  return {
    ...common,
    transmittance: pref.transmittance,
    frameFactor: pref.frameFactor,
    maintenanceFactor: pref.maintenanceFactor,
    interiorReflectance: pref.interiorReflectance,
    exteriorLux: pref.exteriorLux,
  };
}

function optionSignature(mode, options) {
  return JSON.stringify(mode === 'direct'
    ? [options.levelId, options.date ?? '', options.from ?? '', options.to ?? '', options.stepMin ?? '',
      options.cell ?? '', options.maxCells ?? '', options.workplane ?? '']
    : [options.levelId, options.cell ?? '', options.maxCells ?? '', options.workplane ?? '',
      options.transmittance ?? '', options.frameFactor ?? '', options.maintenanceFactor ?? '',
      options.interiorReflectance ?? '', options.exteriorLux ?? '']);
}

// cyrb53 + длина: компактно храним несколько предыдущих снимков, чтобы
// возврат на этаж/Undo мог повторно использовать готовые карты без копий
// большого JSON fingerprint в памяти.
function compactFingerprint(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}:${text.length.toString(36)}`;
}

// В fingerprint входит вся геометрия, но он строится один раз на ревизию и
// режим этажа, а не N раз на каждом кадре для N комнат.
function preparedAnalysis(project, mode, options) {
  const revision = analysisRevision(project);
  let memo = preparedByProject.get(project);
  if (!memo) {
    memo = { entries: new Map() };
    preparedByProject.set(project, memo);
  }
  const signature = optionSignature(mode, options);
  let record = memo.entries.get(signature);
  if (record?.checkedRevision === revision) return record.prepared;
  const fingerprintOptions = { ...options, roomId: '__floor__' };
  const rawFingerprint = mode === 'daylight'
    ? roomDaylightAnalysisKey(project, fingerprintOptions)
    : roomSunlightAnalysisKey(project, fingerprintOptions);
  const fingerprint = compactFingerprint(rawFingerprint);
  if (!record) record = { checkedRevision: null, prepared: null, variants: [] };
  let prepared = record.variants.find((candidate) => candidate.fingerprint === fingerprint) || null;
  if (!prepared) {
    prepared = {
      project,
      revision,
      mode,
      signature,
      fingerprint,
      token: `floor-light:${++preparedSerial}`,
      context: null,
    };
    record.variants.unshift(prepared);
    // Текущая и предыдущая геометрия покрывают обычный Undo/Redo, не
    // удерживая в памяти все исторические световые контексты.
    record.variants.length = Math.min(record.variants.length, 2);
  } else {
    prepared.revision = revision;
    prepared.signature = signature;
    record.variants = [prepared, ...record.variants.filter((candidate) => candidate !== prepared)].slice(0, 2);
  }
  record.checkedRevision = revision;
  record.prepared = prepared;
  memo.entries.set(signature, record);
  // Задачи того же неизменного snapshot продолжаются. Очереди старой
  // геометрии/другого этажа больше не задерживают актуальный вид.
  discardQueued((task) => task.project === project
    && task.prepared !== prepared && task.prepared.revision !== revision);
  return prepared;
}

function preparedContext(prepared) {
  if (prepared.context) return prepared.context;
  const wallsByLevel = new Map();
  const windows = windowsOf(prepared.project, { wallsByLevel });
  prepared.context = {
    wallsByLevel,
    windows,
    // Внешние препятствия одинаковы для всех помещений этажа.
    obstacles: windows.length ? solarObstaclesOf(prepared.project) : [],
  };
  return prepared.context;
}

function analysisKey(prepared, roomId) {
  return `${prepared.token}:${roomId}`;
}

function calculateAnalysis(mode, project, options, prepared, key) {
  const runOptions = {
    ...options,
    analysisKey: key,
    solarContext: preparedContext(prepared),
  };
  return mode === 'daylight'
    ? roomDaylightAnalysis(project, runOptions)
    : roomSunlightAnalysis(project, runOptions);
}

function taskRelevant(task) {
  const currentOptions = optionsFor(task.mode, task.options.levelId, task.options.roomId);
  return task.project === state.project
    && task.prepared.revision === analysisRevision(task.project)
    && state.solarAnalysis?.on === true
    && state.solarAnalysis?.scope === 'level'
    && state.solarAnalysis?.levelId === task.options.levelId
    && (state.solarAnalysis?.mode || 'direct') === task.mode
    && task.prepared.signature === optionSignature(task.mode, currentOptions);
}

function runQueuedAnalysis() {
  queueHandle = null;
  const task = analysisQueue.shift();
  if (!task) return;
  let result = null;
  try {
    if (taskRelevant(task)) {
      result = calculateAnalysis(task.mode, task.project, task.options, task.prepared, task.key);
      if (result) {
        cachePut(task.key, result);
        latestPut(task.project, task.mode, task.options.levelId, task.options.roomId, result);
      }
    }
  } catch (error) {
    // Ошибка одной повреждённой комнаты не должна останавливать расчёт
    // остальных помещений и оставлять их Promise навсегда pending.
    console.error('Световой анализ помещения не выполнен:', error);
  } finally {
    pendingAnalyses.delete(task.key);
    task.resolve(result);
    scheduleQueuedAnalysis();
    try { redrawHook?.(); } catch (error) {
      console.error('Не удалось обновить карту освещения:', error);
    }
  }
}

function scheduleQueuedAnalysis() {
  if (queueHandle != null || !analysisQueue.length) return;
  if (typeof globalThis.requestIdleCallback === 'function') {
    // Ровно одна комната за idle-задачу: даже сложный этаж не превращается
    // в один длинный блок, а готовые карты появляются автоматически.
    queueHandle = globalThis.requestIdleCallback(runQueuedAnalysis, { timeout: 120 });
  } else {
    queueHandle = globalThis.setTimeout(runQueuedAnalysis, 0);
  }
}

function enqueueAnalysis(mode, project, options, prepared, key) {
  const existing = pendingAnalyses.get(key);
  if (existing) return existing;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  pendingAnalyses.set(key, promise);
  analysisQueue.push({ mode, project, options, prepared, key, resolve });
  scheduleQueuedAnalysis();
  return promise;
}

function floorDeferred() {
  return state.solarAnalysis?.scope === 'level' && typeof globalThis.document !== 'undefined';
}

function currentAnalysis(mode, roomId) {
  const project = state.project;
  if (!project || !roomId) return null;
  const levelId = activeRoomLevel(roomId);
  if (!levelId) return null;
  const options = optionsFor(mode, levelId, roomId);
  const prepared = preparedAnalysis(project, mode, options);
  const key = analysisKey(prepared, roomId);
  const cached = cacheGet(key);
  if (cached) return cached;
  if (floorDeferred()) {
    enqueueAnalysis(mode, project, options, prepared, key);
    // Пока новая ревизия считается, сохраняем предыдущую карту на экране.
    // Легенда с progress явно показывает, что данные обновляются.
    return latestGet(project, mode, levelId, roomId);
  }
  const result = calculateAnalysis(mode, project, options, prepared, key);
  if (result) {
    cachePut(key, result);
    latestPut(project, mode, levelId, roomId, result);
  }
  return result;
}

/** Перерисовка после очередной готовой комнаты задаётся UI без циклического импорта render.js. */
export function bindLightAnalysisRedraw(callback) {
  redrawHook = typeof callback === 'function' ? callback : null;
}

/**
 * Автоматически ставит в очередь все помещения этажа. Promise нужен тестам
 * и экспорту; интерфейс показывает готовые комнаты постепенно, без кликов.
 */
export function prepareLevelLightAnalysis(levelId, mode = state.solarAnalysis?.mode || 'daylight') {
  const project = state.project;
  const level = project?.levels?.find((candidate) => candidate.id === levelId);
  if (!project || !level) return Promise.resolve([]);
  // Очередь глобальна: задачи прежнего проекта/этажа/режима не должны
  // задерживать новый вид десятками idle-callback.
  discardQueued((task) => !taskRelevant(task));
  const tasks = level.rooms.filter((room) => room.type !== 'shaft').map((room) => {
    const options = optionsFor(mode, levelId, room.id);
    const prepared = preparedAnalysis(project, mode, options);
    const key = analysisKey(prepared, room.id);
    const cached = cacheGet(key);
    return cached ? Promise.resolve(cached) : enqueueAnalysis(mode, project, options, prepared, key);
  });
  return Promise.all(tasks);
}

export function cancelPendingLightAnalysis() {
  discardQueued(() => true);
  if (queueHandle == null) return;
  if (typeof globalThis.cancelIdleCallback === 'function') globalThis.cancelIdleCallback(queueHandle);
  else globalThis.clearTimeout(queueHandle);
  queueHandle = null;
}

export function levelLightAnalysisProgress(levelId, mode = state.solarAnalysis?.mode || 'daylight') {
  const project = state.project;
  const rooms = project?.levels?.find((level) => level.id === levelId)?.rooms
    ?.filter((room) => room.type !== 'shaft') || [];
  let ready = 0;
  let pending = 0;
  for (const room of rooms) {
    const options = optionsFor(mode, levelId, room.id);
    const prepared = preparedAnalysis(project, mode, options);
    const key = analysisKey(prepared, room.id);
    if (analysisCache.has(key)) ready += 1;
    else if (pendingAnalyses.has(key)) pending += 1;
  }
  return { total: rooms.length, ready, pending };
}

/** DOM-free кэш расчёта: render.js импортируется и в node-тестах. */
export function currentSolarAnalysis(roomId = state.solarAnalysis?.roomId || selectedRoomId()) {
  return currentAnalysis('direct', roomId);
}

/** Предварительный КЕО/люксы с тем же LRU-кэшем, что и карта солнца. */
export function currentDaylightAnalysis(roomId = state.solarAnalysis?.roomId || selectedRoomId()) {
  return currentAnalysis('daylight', roomId);
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
  if (analysis.roomId !== room.id
    || (pref.scope !== 'level' && pref.roomId && pref.roomId !== room.id)) return null;

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
  if (analysis.roomId !== room.id
    || (pref.scope !== 'level' && pref.roomId && pref.roomId !== room.id)) return null;

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

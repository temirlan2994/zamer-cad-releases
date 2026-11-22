// Экранный слой этапа «Движение и проходы».
//
// Core передаёт уже проверенные ломаные и дискретную карту нагрузки. Здесь
// нет поиска пути и сглаживания: renderer не должен визуально провести линию
// сквозь мебель или стену. Заблокированные и неизвестные маршруты остаются
// только в диагностике панели и никогда не получают выдуманную линию.

const DRAWN_STATUSES = new Set(['clear', 'narrow', 'approximate']);

const COLORS = Object.freeze({
  clear: '#18865b',
  narrow: '#c27a00',
  approximate: '#3975c4',
  heatLow: Object.freeze([55, 137, 214]),
  heatMid: Object.freeze([123, 82, 188]),
  heatHigh: Object.freeze([214, 116, 42]),
});

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));
const listLike = (value) => Array.isArray(value) || ArrayBuffer.isView(value);

function activeLevelResult(result, levelId) {
  const levels = array(result?.levels);
  return levels.find((level) => level?.levelId === levelId || level?.id === levelId) || null;
}

function routesForLevel(result, level, levelId) {
  const source = Array.isArray(level?.routes) ? level.routes : array(result?.routes);
  return source.filter((route) => {
    if (route?.levelId) return route.levelId === levelId;
    if (Array.isArray(route?.levelIds) && route.levelIds.length) return route.levelIds.includes(levelId);
    return Boolean(level);
  });
}

function validPoint(point) {
  return point && finite(point.x) && finite(point.y);
}

function routePoints(route) {
  const direct = array(route?.points).filter(validPoint);
  if (direct.length) return direct.map(({ x, y }) => ({ x: Number(x), y: Number(y) }));
  const points = [];
  for (const segment of array(route?.segments)) {
    for (const point of array(segment?.points ?? segment?.path)) {
      if (!validPoint(point)) continue;
      const normalized = { x: Number(point.x), y: Number(point.y) };
      const previous = points.at(-1);
      if (!previous || Math.hypot(previous.x - normalized.x, previous.y - normalized.y) > 1e-6) {
        points.push(normalized);
      }
    }
  }
  return points;
}

function screenPoints(points, p2s) {
  return points.map((point) => p2s(point.x, point.y))
    .filter((point) => point && finite(point.x) && finite(point.y));
}

function tracePolyline(ctx, points) {
  if (points.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    // Только исходная ломаная из core. bezierCurveTo/arcTo здесь намеренно нет.
    ctx.lineTo(points[index].x, points[index].y);
  }
  return true;
}

function statusColor(status, tokens) {
  if (status === 'clear') return COLORS.clear;
  if (status === 'narrow') return tokens?.warn || COLORS.narrow;
  if (status === 'blocked') return tokens?.danger || '#c23b42';
  return tokens?.accent || COLORS.approximate;
}

function drawRoute(ctx, route, p2s, tokens) {
  const modelPoints = routePoints(route);
  const points = screenPoints(modelPoints, p2s);
  if (points.length < 2) return null;
  const status = DRAWN_STATUSES.has(route?.status) ? route.status : 'approximate';
  const color = statusColor(status, tokens);
  const dashed = status === 'approximate' || route?.evidence === 'approximate'
    || route?.evidence === 'candidate' || route?.evidence === 'partial';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash?.(dashed ? [7, 5] : []);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = tokens?.surface || '#fff';
  ctx.lineWidth = 6;
  if (tracePolyline(ctx, points)) ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.7;
  if (tracePolyline(ctx, points)) ctx.stroke();
  ctx.restore();
  return {
    id: route?.id || null,
    status: route?.status || 'unknown',
    evidence: route?.evidence || null,
    pointCount: points.length,
    minWidthMm: finite(route?.minWidthMm) ? Number(route.minWidthMm) : null,
  };
}

function bottleneckOf(route) {
  const point = route?.bottleneck;
  if (!validPoint(point)) return null;
  const width = point.minWidthMm ?? point.clearanceMm ?? point.widthMm ?? route?.minWidthMm;
  if (!finite(width)) return null;
  return { x: Number(point.x), y: Number(point.y), widthMm: Number(width) };
}

function drawBottleneck(ctx, route, p2s, tokens) {
  const bottleneck = bottleneckOf(route);
  if (!bottleneck) return null;
  const point = p2s(bottleneck.x, bottleneck.y);
  if (!validPoint(point)) return null;
  const color = statusColor(route?.status, tokens);
  ctx.save();
  ctx.fillStyle = tokens?.surface || '#fff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(bottleneck.widthMm)} мм`, point.x + 8, point.y);
  ctx.restore();
  return bottleneck;
}

function heatSources(result, level, levelId) {
  const sources = [];
  const push = (value) => {
    if (!value || typeof value !== 'object' || sources.includes(value)) return;
    sources.push(value);
  };
  push(level?.heat);
  for (const room of array(level?.rooms)) {
    push(room?.heat);
    if (room?.grid && (room.grid.routeCount || room.grid.frequencyByPeriod || room.grid.cells)) push(room.grid);
  }
  if (!level && (!result?.heat?.levelId || result.heat.levelId === levelId)) push(result?.heat);
  return sources;
}

function metricValue(cell, source, index, metric, period) {
  if (metric === 'frequency') {
    if (!period) return 0;
    const direct = cell?.frequencyByPeriod?.[period];
    if (finite(direct)) return Number(direct);
    const series = source?.frequencyByPeriod?.[period];
    return listLike(series) && finite(series[index]) ? Number(series[index]) : 0;
  }
  const direct = cell?.routeCount ?? cell?.count;
  if (finite(direct)) return Number(direct);
  return listLike(source?.routeCount) && finite(source.routeCount[index])
    ? Number(source.routeCount[index]) : 0;
}

function cellsFromSource(source, metric, period) {
  if (Array.isArray(source?.cells)) {
    return source.cells.flatMap((cell, index) => {
      const x = cell?.x ?? (finite(source.x0) && finite(cell?.col)
        ? Number(source.x0) + Number(cell.col) * Number(source.cell || 0) : null);
      const y = cell?.y ?? (finite(source.y0) && finite(cell?.row)
        ? Number(source.y0) + Number(cell.row) * Number(source.cell || 0) : null);
      const width = cell?.w ?? cell?.width ?? cell?.cell ?? source.cell;
      const height = cell?.h ?? cell?.height ?? cell?.cell ?? source.cell;
      const value = metricValue(cell, source, index, metric, period);
      // Core публикует x/y как центр ячейки (cellPoint) и её локальный cell.
      // Явные w/h по совместимому внешнему контракту означают левый верх.
      const centered = finite(cell?.cell) && cell?.w == null && cell?.width == null
        && cell?.h == null && cell?.height == null;
      return finite(x) && finite(y) && finite(width) && finite(height)
        && Number(width) > 0 && Number(height) > 0 && value > 0
        ? [{
          x: Number(x) - (centered ? Number(width) / 2 : 0),
          y: Number(y) - (centered ? Number(height) / 2 : 0),
          w: Number(width), h: Number(height), value,
        }]
        : [];
    });
  }
  const cols = Number(source?.cols);
  const rows = Number(source?.rows);
  const cell = Number(source?.cell ?? source?.cellMm);
  if (![source?.x0, source?.y0, cols, rows, cell].every(finite)
    || cols <= 0 || rows <= 0 || cell <= 0) return [];
  const count = Math.min(Math.floor(cols * rows), 250_000);
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const value = metricValue(null, source, index, metric, period);
    if (!(value > 0)) continue;
    cells.push({
      x: Number(source.x0) + (index % cols) * cell,
      y: Number(source.y0) + Math.floor(index / cols) * cell,
      w: cell,
      h: cell,
      value,
    });
  }
  return cells;
}

function mix(a, b, ratio) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * ratio));
}

function heatColor(value, max) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const rgb = ratio <= 0.5
    ? mix(COLORS.heatLow, COLORS.heatMid, ratio * 2)
    : mix(COLORS.heatMid, COLORS.heatHigh, (ratio - 0.5) * 2);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function drawHeatCell(ctx, cell, p2s, max) {
  const corners = [
    p2s(cell.x, cell.y),
    p2s(cell.x + cell.w, cell.y),
    p2s(cell.x + cell.w, cell.y + cell.h),
    p2s(cell.x, cell.y + cell.h),
  ];
  if (!corners.every(validPoint)) return false;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let index = 1; index < corners.length; index += 1) ctx.lineTo(corners[index].x, corners[index].y);
  ctx.closePath();
  ctx.fillStyle = heatColor(cell.value, max);
  ctx.fill();
  return true;
}

function drawHeat(ctx, sources, metric, period, p2s) {
  const cells = sources.flatMap((source) => cellsFromSource(source, metric, period));
  const max = cells.reduce((value, cell) => Math.max(value, cell.value), 0);
  let drawn = 0;
  if (!cells.length) return { cellCount: 0, drawn: 0, max: 0 };
  ctx.save();
  ctx.globalAlpha = 0.24;
  for (const cell of cells) if (drawHeatCell(ctx, cell, p2s, max)) drawn += 1;
  ctx.restore();
  return { cellCount: cells.length, drawn, max };
}

/**
 * Рисует рассчитанные пути и карту их наложения на активном этаже.
 * Частоты берутся только из явно выбранного периода; разные периоды здесь
 * принципиально не складываются.
 */
export function drawHomeCirculationOverlay(ctx, {
  st, p2s, tokens, print = false,
} = {}) {
  const view = st?.homeCirculationOverlay;
  const result = view?.result;
  if (!st || !ctx || typeof p2s !== 'function' || print
    || st.modeName !== 'plan' || view?.on !== true || !result) {
    if (st) st._homeCirculationUI = null;
    return null;
  }

  const levelId = st.project?.activeLevel || null;
  const level = activeLevelResult(result, levelId);
  const routes = routesForLevel(result, level, levelId);
  const routesOn = view.routes !== false;
  const heatmapOn = view.heatmap === true;
  const bottlenecksOn = view.bottlenecks !== false;
  const metric = view.metric === 'frequency' ? 'frequency' : 'route_count';
  const period = metric === 'frequency' && typeof view.period === 'string' && view.period
    ? view.period : null;

  const heat = heatmapOn
    ? drawHeat(ctx, heatSources(result, level, levelId), metric, period, p2s)
    : { cellCount: 0, drawn: 0, max: 0 };

  const paths = [];
  const bottlenecks = [];
  if (routesOn || bottlenecksOn) {
    for (const route of routes) {
      if (routesOn && DRAWN_STATUSES.has(route?.status)) {
        const diagnostic = drawRoute(ctx, route, p2s, tokens);
        if (diagnostic) paths.push(diagnostic);
      }
      // У заблокированного маршрута core может честно измерить место, где
      // профиль не проходит. Саму линию не рисуем, но красный marker полезен.
      if (bottlenecksOn && route?.status !== 'unknown') {
        const bottleneck = drawBottleneck(ctx, route, p2s, tokens);
        if (bottleneck) bottlenecks.push({ id: route?.id || null, ...bottleneck });
      }
    }
  }

  const count = (status) => routes.filter((route) => route?.status === status).length;
  const summary = {
    active: true,
    levelId,
    routesOn,
    heatmapOn,
    bottlenecksOn,
    metric,
    period,
    heatCellCount: heat.drawn,
    heatSourceCellCount: heat.cellCount,
    heatMax: heat.max,
    routeCount: routes.length,
    drawnRouteCount: paths.length,
    clearRouteCount: count('clear'),
    narrowRouteCount: count('narrow'),
    approximateRouteCount: count('approximate'),
    blockedRouteCount: count('blocked'),
    unknownRouteCount: count('unknown'),
    bottleneckCount: bottlenecks.length,
    paths,
    bottlenecks,
  };
  st._homeCirculationUI = summary;
  return summary;
}

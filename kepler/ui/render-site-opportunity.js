// Карта возможностей участка. Расчёт живёт в core/site-planning.js, этот
// модуль только переводит его воспроизводимый результат в canvas-слой.

const LOW_COVERAGE = 0.5;
const MAX_CANDIDATES = 3;

function finite(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function number(value, fallback = 0) {
  return finite(value) ? Number(value) : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function coverageOf(value) {
  const raw = number(value, 0);
  return clamp(raw > 1 ? raw / 100 : raw);
}

function scoreOf(value) {
  return clamp(number(value, 0), 0, 100);
}

function screenPx(px, value, fallback = value) {
  if (typeof px !== 'function') return fallback;
  const converted = Number(px(value));
  return Number.isFinite(converted) && converted > 0 ? converted : fallback;
}

function point(value) {
  return value && finite(value.x) && finite(value.y)
    ? { x: Number(value.x), y: Number(value.y) } : null;
}

function explicitCorners(value) {
  const source = value?.corners || value?.polygon || value?.points;
  if (!Array.isArray(source)) return null;
  const corners = source.map(point).filter(Boolean);
  return corners.length >= 3 && corners.length === source.length ? corners : null;
}

function dimensions(value, fallback) {
  const own = value?.footprint || value || {};
  const base = fallback?.footprint || fallback || {};
  const width = number(own.width ?? own.w, number(base.width ?? base.w, NaN));
  const depth = number(
    own.depth ?? own.height ?? own.h,
    number(base.depth ?? base.height ?? base.h, NaN),
  );
  return width > 0 && depth > 0 ? { width, depth } : null;
}

function footprintCorners(value, fallback = null) {
  const corners = explicitCorners(value);
  if (corners) return corners;
  if (!finite(value?.x) || !finite(value?.y)) return null;
  const size = dimensions(value, fallback);
  if (!size) return null;
  const cx = Number(value.x);
  const cy = Number(value.y);
  const angle = number(value.rotation ?? value.rot, number(fallback?.rotation ?? fallback?.rot, 0));
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    { x: -size.width / 2, y: -size.depth / 2 },
    { x: size.width / 2, y: -size.depth / 2 },
    { x: size.width / 2, y: size.depth / 2 },
    { x: -size.width / 2, y: size.depth / 2 },
  ].map(({ x, y }) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}

function path(ctx, corners) {
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index) ctx.lineTo(corner.x, corner.y);
    else ctx.moveTo(corner.x, corner.y);
  });
  ctx.closePath();
}

function opportunityColor(score, coverage) {
  if (coverage < LOW_COVERAGE) return { color: 'rgb(120, 132, 148)', alpha: 0.11 + coverage * 0.14 };
  const t = score / 100;
  const blue = [49, 125, 246];
  const green = [25, 174, 112];
  const channel = (index) => Math.round(blue[index] + (green[index] - blue[index]) * t);
  return { color: `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`, alpha: 0.13 + coverage * 0.17 };
}

function drawCells(ctx, cells, result, px) {
  const gap = screenPx(px, 0.35, 0);
  const fallbackStep = number(result?.step ?? result?.cellSize, 0);
  const drawn = [];
  for (const cell of cells) {
    if (!cell || cell.blocked || !finite(cell.x) || !finite(cell.y)) continue;
    const step = number(cell.step ?? cell.size, fallbackStep);
    if (!(step > 0)) continue;
    const coverage = coverageOf(cell.coverage ?? result?.coverage);
    const score = scoreOf(cell.score);
    const style = opportunityColor(score, coverage);
    const inset = Math.min(gap, step * 0.08);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.alpha;
    ctx.fillRect(Number(cell.x) - step / 2 + inset, Number(cell.y) - step / 2 + inset, step - inset * 2, step - inset * 2);
    drawn.push({ score, coverage });
  }
  ctx.globalAlpha = 1;
  return drawn;
}

function referenceFootprint(result, view) {
  const values = [
    result?.referenceCandidate,
    result?.referenceFootprint,
    result?.reference,
    result?.footprint,
    view?.referenceFootprint,
  ];
  return values.find((value) => explicitCorners(value) || (finite(value?.x) && finite(value?.y))) || null;
}

function candidateShapes(result, view) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  const fallback = result?.referenceFootprint || result?.footprint || view?.referenceFootprint || null;
  return candidates
    .map((candidate, sourceIndex) => ({
      candidate,
      sourceIndex,
      corners: footprintCorners(candidate, fallback),
      score: scoreOf(candidate?.score),
    }))
    .filter((item) => item.corners)
    .sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex)
    .slice(0, MAX_CANDIDATES);
}

function labelAnchor(corners) {
  if (!corners?.length) return null;
  const top = Math.min(...corners.map(({ y }) => y));
  const upper = corners.filter(({ y }) => y <= top + 1);
  const source = upper.length ? upper : corners;
  return {
    x: source.reduce((sum, corner) => sum + corner.x, 0) / source.length,
    y: top,
  };
}

function drawCandidateLabel(ctx, item, index, tokens, px) {
  if (typeof ctx.fillText !== 'function' || typeof ctx.measureText !== 'function') return false;
  const anchor = labelAnchor(item.corners);
  if (!anchor || !finite(anchor.x) || !finite(anchor.y)) return false;
  const fontSize = screenPx(px, 10.5);
  const padX = screenPx(px, 4.5);
  const padY = screenPx(px, 3);
  const offset = screenPx(px, 6);
  const coverage = item.candidate?.coverage;
  const confidence = finite(coverage) ? coverageOf(coverage) : null;
  const suffix = confidence !== null && confidence < LOW_COVERAGE
    ? ` · данных ${Math.round(confidence * 100)}%` : '';
  const text = `${String.fromCharCode(65 + index)} · ${Math.round(item.score)}${suffix}`;
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const metrics = ctx.measureText(text);
  const width = Number(metrics?.width);
  if (!(width > 0) || !Number.isFinite(width)) return false;
  const height = fontSize + padY * 2;
  const x = anchor.x - width / 2 - padX;
  const y = anchor.y - height - offset;
  ctx.fillStyle = tokens?.surface || '#fff';
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, y, width + padX * 2, height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tokens?.accent || '#1f75ff';
  ctx.lineWidth = screenPx(px, 0.8);
  ctx.strokeRect(x, y, width + padX * 2, height);
  ctx.fillStyle = tokens?.text || '#18202b';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + height / 2);
  return true;
}

function drawReference(ctx, result, view, tokens, px, candidateCorners) {
  const reference = referenceFootprint(result, view);
  const corners = footprintCorners(reference);
  if (!corners) return false;
  const duplicate = candidateCorners.some((candidate) => candidate.length === corners.length
    && candidate.every((corner, index) => Math.hypot(corner.x - corners[index].x, corner.y - corners[index].y) < 0.5));
  if (duplicate) return false;
  ctx.save();
  ctx.strokeStyle = tokens?.muted || '#687486';
  ctx.lineWidth = screenPx(px, 1.15);
  ctx.setLineDash([screenPx(px, 6), screenPx(px, 4)]);
  path(ctx, corners);
  ctx.stroke();
  ctx.restore();
  return true;
}

function drawCandidates(ctx, shapes, result, view, tokens, px) {
  const candidateCorners = shapes.map(({ corners }) => corners);
  const referenceDrawn = drawReference(ctx, result, view, tokens, px, candidateCorners);
  let labelCount = 0;
  shapes.forEach((item, index) => {
    ctx.save();
    ctx.fillStyle = tokens?.accent || '#1f75ff';
    ctx.globalAlpha = index === 0 ? 0.09 : 0.045;
    path(ctx, item.corners);
    ctx.fill();
    ctx.globalAlpha = index === 0 ? 0.9 : 0.62;
    ctx.strokeStyle = index === 0 ? (tokens?.accent2 || '#1db4a8') : (tokens?.accent || '#1f75ff');
    ctx.lineWidth = screenPx(px, index === 0 ? 2 : 1.35);
    ctx.setLineDash(index === 0 ? [] : [screenPx(px, 5), screenPx(px, 3)]);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    if (drawCandidateLabel(ctx, item, index, tokens, px)) labelCount += 1;
    ctx.restore();
  });
  return { labelCount, referenceDrawn };
}

function average(values, field) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value[field], 0) / values.length;
}

/**
 * Декоративный world-coordinate слой карты пригодности участка.
 * Возвращает и сохраняет компактную сводку, чтобы E2E не считывал canvas.
 */
export function drawSiteOpportunity(ctx, state, tokens, px) {
  const view = state?.siteOpportunity;
  const result = view?.result;
  if (state?.modeName !== 'site' || !view?.on || !result || !ctx) {
    if (state) state._siteOpportunityUI = null;
    return null;
  }

  const cells = Array.isArray(result.cells) ? result.cells : [];
  const blockedCells = cells.filter((cell) => cell?.blocked).length;
  const shapes = candidateShapes(result, view);

  ctx.save();
  const drawnCells = drawCells(ctx, cells, result, px);
  const candidateUI = drawCandidates(ctx, shapes, result, view, tokens, px);
  ctx.restore();

  const scores = drawnCells.map(({ score }) => score);
  const summary = {
    active: true,
    status: result.status || 'ready',
    cellCount: cells.length,
    visibleCellCount: drawnCells.length,
    blockedCellCount: blockedCells,
    lowCoverageCellCount: drawnCells.filter(({ coverage }) => coverage < LOW_COVERAGE).length,
    candidateCount: Array.isArray(result.candidates) ? result.candidates.length : 0,
    drawnCandidateCount: shapes.length,
    labelCount: candidateUI.labelCount,
    referenceDrawn: candidateUI.referenceDrawn,
    averageCoverage: average(drawnCells, 'coverage'),
    minScore: scores.length ? Math.min(...scores) : null,
    maxScore: scores.length ? Math.max(...scores) : null,
  };
  state._siteOpportunityUI = summary;
  return summary;
}

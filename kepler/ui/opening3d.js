// Создание дверей и окон прямо на фасаде в 3D. Использует тот же инструмент,
// заготовку и проверку места, что план; дополнительно притягивает линии и
// размеры к проёмам нижних этажей.

import { CORNER_PRESET, cornerWindowGeometry, cornerWindowHandles } from '../core/corner-windows.js';
import { boxFaces, wallZRange } from '../core/mesh3d.js';
import { levelProject } from '../core/model.js';
import { clearWindowSpan, levelWindowOpenings, nextWindowSpan, setWindowSpan, windowSpanTop } from '../core/spanning-windows.js';
import { fitOpeningOffset, resizeCornerWing } from '../core/opening-spacing.js';
import { facadeWindowHeads, lowerOpeningTargets, snapOpeningToLower } from '../core/opening-snap3d.js';
import { openingHeight, openingSill } from '../core/opening-preset.js';
import { glazedAssemblySpec, glazedOpeningMinWidth, isGlazedAssembly, resizeGlazedOpening } from '../core/glazed-openings.js';
import { deriveWalls, openingPos, openingPosAt, openingRect, setOpeningPos } from '../core/walls.js';
import { toast } from './dom.js';
import { computeOpeningParams, openingSnapOpts } from './plan-actions.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, refreshDerived, restoreFrom, snapshot } from './store.js';

let env = null;
let ghost = null;
let lastEvent = null;
let resize = null;

export function initOpening3d(next) { env = next; }

export const openingToolOn = () => state.tool?.kind === 'place-opening';

// Один расчёт стен на смену этажа под курсором или изменение модели.
let contextCache = null;
function placementContext(levelId) {
  if (contextCache?.source === state.project && contextCache.sourceWalls === state.walls && contextCache.levelId === levelId) return contextCache;
  const active = levelId === state.project.activeLevel;
  const project = active ? state.project : levelProject(state.project, levelId);
  const walls = active ? state.walls : deriveWalls(project);
  contextCache = { levelId, project, walls, others: levelWindowOpenings(project, walls), source: state.project, sourceWalls: state.walls, targets: new Map() };
  return contextCache;
}

function guidesFor(levelId, wall) {
  const context = placementContext(levelId);
  if (!context.targets.has(wall)) context.targets.set(wall, lowerOpeningTargets(context.project, levelId, wall));
  return context.targets.get(wall);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function buildCandidate(event) {
  const hit = env?.pick?.(event);
  if (!hit || hit.type !== 'wall' || hit.face !== 'side') {
    return { valid: false, error: 'Наведите на боковую грань стены' };
  }
  const level = state.project.levels.find((candidate) => candidate.id === hit.levelId);
  if (!level) return { valid: false, error: 'Этаж стены не найден' };
  const { project, walls, others } = placementContext(level.id);
  const wall = walls.find((candidate) => candidate.key === hit.key &&
    (hit.from === undefined || Math.abs(candidate.from - hit.from) < 1));
  if (!wall) return { valid: false, error: 'Стена не найдена' };
  const at = { x: hit.point.x + hit.normal.x, y: hit.point.y + hit.normal.y };
  const result = computeOpeningParams(at, { project, walls, wall, others, snap: openingSnapOpts(event.shiftKey) });
  if (!result) return { valid: false, error: 'На этой грани проём не создаётся' };
  if (result.error) return { valid: false, error: result.error };
  let opening = result.opening;
  let placed = openingRect(project, opening, walls);
  if (!placed) return { valid: false, error: 'Не удалось определить положение проёма' };
  const unsnappedOpening = opening;
  const unsnappedPlaced = placed;
  let snap = { snapped: false, label: '' };
  let targets = [];
  if (!event.shiftKey && !opening.corner) {
    targets = guidesFor(level.id, wall);
    const tolerance = clamp((env?.worldPerPx?.() || 20) * (event.pointerType === 'touch' ? 20 : 12), 20, 600);
    snap = snapOpeningToLower(opening, placed.absCenter, targets, tolerance);
    if (snap.snapped) {
      opening = snap.opening;
      const pos = openingPosAt(project, opening, walls, snap.center);
      const fitted = pos === null ? null : fitOpeningOffset(project, opening, walls, pos, { others });
      if (fitted !== null) {
        setOpeningPos(opening, fitted);
        placed = openingRect(project, opening, walls);
        // Коллизия с проёмом текущего этажа могла увести нас от линии низа.
        if (!placed || Math.abs(placed.absCenter - snap.center) > 1) {
          opening = unsnappedOpening; placed = unsnappedPlaced; snap = { snapped: false, label: '' };
        }
      } else {
        opening = unsnappedOpening; placed = unsnappedPlaced; snap = { snapped: false, label: '' };
      }
    }
  }
  const wallBottom = hit.box?.wallZ0 ?? (level?.elevation || 0);
  const wallTop = hit.box?.wallZ1 ?? wallBottom + (level?.height || 3000);
  const effectiveSill = openingSill(opening, level);
  const z0 = (level?.elevation || 0) + effectiveSill;
  const effectiveHeight = openingHeight(opening, level);
  const z1 = z0 + effectiveHeight;
  if (z0 < wallBottom - 0.5 || z1 > wallTop + 0.5) {
    return { valid: false, error: `Высота проёма не помещается в стену (${Math.round(wallTop - wallBottom)} мм)` };
  }
  const r = placed.rect;
  const wings = opening.corner && cornerWindowGeometry(project, opening, walls);
  const returnRect = wings && openingRect(project, wings[1].opening, walls)?.rect;
  return {
    returnRect,
    valid: true, opening, wall, hit, snap, targets,
    sill: effectiveSill,
    box: { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, z0, z1 },
  };
}

export function openingToolMove(event) {
  if (!openingToolOn() || !env) return false;
  lastEvent = event;
  ghost = buildCandidate(event);
  const title = state.tool.openKind === 'door' ? 'Дверь' : 'Окно';
  const text = ghost.valid
    ? `${title} ${ghost.opening.width} × ${Math.round(ghost.box.z1 - ghost.box.z0)} мм${ghost.opening.kind === 'window' ? ` · снизу ${Math.round(ghost.sill)} мм` : ''}${ghost.snap.label ? ` · ${ghost.snap.label}` : ''}`
    : ghost.error;
  env.label?.(text, event.clientX, event.clientY);
  env.redraw?.(false);
  return true;
}

export function openingToolClick(event) {
  if (!openingToolOn() || !env) return false;
  ghost = buildCandidate(event);
  if (!ghost.valid) { toast(ghost.error || 'Здесь нельзя поставить проём', true); return true; }
  const { opening, hit, snap } = ghost;
  const level = state.project.levels.find((candidate) => candidate.id === hit.levelId);
  mutate(() => { level.openings.push(opening); });
  toast(`${opening.kind === 'door' ? 'Дверь' : 'Окно'} · ${level.name}${snap.label ? ` · ${snap.label}` : ''}`);
  ghost = null;
  env.redraw?.(true);
  openingToolMove(event);
  return true;
}

let selectedCache = null;
function selectedInfo() {
  if (state.selection?.type !== 'opening') return null;
  const opening = state.project.openings.find((o) => o.id === state.selection.id);
  if (!opening) return null;
  const geometry = [opening.width, openingPos(opening), opening.sill, opening.height, opening.heightMode, opening.span?.levelId, opening.span?.topGap, opening.corner?.end, opening.corner?.joint, opening.corner?.returnWidth, JSON.stringify(opening.assembly)].join('/');
  if (selectedCache?.opening === opening && selectedCache.walls === state.walls && selectedCache.geometry === geometry) return selectedCache.info;
  const placed = openingRect(state.project, opening, state.walls);
  const level = state.project.levels.find((l) => l.id === state.project.activeLevel);
  if (!placed || !level) return null;
  const wall = placed.wall;
  const wallRange = wallZRange(state.project, wall, level.height);
  const cross = wall.orient === 'h' ? wall.band.y + wall.band.h / 2 : wall.band.x + wall.band.w / 2;
  const along = placed.absCenter;
  const half = opening.width / 2;
  const effectiveSill = openingSill(opening, level);
  const z0 = level.elevation + effectiveSill;
  const spanTop = opening.span && windowSpanTop(state.project, level.id, opening);
  const z1 = spanTop ? level.elevation + spanTop : z0 + openingHeight(opening, level);
  const point = (a, z) => (wall.orient === 'h' ? { x: a, y: cross, z } : { x: cross, y: a, z });
  const handles = [
    { id: 'from', point: point(along - half, (z0 + z1) / 2) },
    { id: 'to', point: point(along + half, (z0 + z1) / 2) },
    { id: 'top', point: point(along, z1) },
  ];
  if (opening.corner) {
    const wings = cornerWindowHandles(state.project, opening, state.walls);
    handles.splice(0, 2, ...wings.map((h) => ({ id: h.end, wall: h.wall, wingSign: h.sign, point: { x: h.x, y: h.y, z: (z0 + z1) / 2 } })));
    for (const h of wings) {
      const range = wallZRange(state.project, h.wall, level.height);
      wallRange.z0 = Math.max(range.z0, wallRange.z0);
      wallRange.z1 = Math.min(range.z1, wallRange.z1);
    }
  }
  if (opening.kind === 'window' && !isGlazedAssembly(opening)) handles.push({ id: 'bottom', point: point(along, z0) });
  const targets = guidesFor(level.id, wall)
    .filter((t) => t.kind === opening.kind);
  const span = !isGlazedAssembly(opening) && nextWindowSpan(state.project, level.id, opening);
  const info = { opening, placed, wall, level, handles, targets, z0, z1, wallBottom: wallRange.z0, wallTop: wallRange.z1, span };
  selectedCache = { opening, walls: state.walls, geometry, info };
  return info;
}

function handleFaces(info) {
  if (!info || !env?.worldPerPx) return [];
  const r = clamp(env.worldPerPx() * 7, 35, 160);
  return info.handles.flatMap((h) => boxFaces(
    h.point.x - r, h.point.y - r, h.point.x + r, h.point.y + r, h.point.z - r, h.point.z + r,
    h.id === 'top' || h.id === 'bottom' ? '#1f75ff' : '#20a39e', 'overlay',
  ).map((face) => ({ ...face, onTop: true, flat: true, alpha: 0.92, twoSided: true })));
}

// Контуры проёмов этажей ниже — те самые линии, к которым липнут центр,
// края, верх и подоконник. Рисуются поверх сцены, как магнит у масс.
function lowerOpeningGuides(targets, hotId = null) {
  const out = [];
  for (const target of targets || []) {
    const b = target.box;
    if (!b) continue;
    const hot = target.id === hotId;
    for (const face of boxFaces(b.x0, b.y0, b.x1, b.y1, b.z0, b.z1, '#20a39e', 'overlay')) {
      out.push({
        ...face, color: '#20a39e', alpha: 0, onTop: true, flat: true, twoSided: true,
        edges: face.pts.map((p, i) => [p, face.pts[(i + 1) % face.pts.length]]),
        edgeRgba: hot ? [0.06, 0.76, 0.82, 1] : [0.08, 0.56, 0.62, 0.48],
      });
    }
  }
  return out;
}

export function openingOverlay() {
  const info = !openingToolOn() ? selectedInfo() : null;
  const guideTargets = ghost?.valid ? ghost.targets : info?.targets;
  const hotId = ghost?.snap?.sourceOpeningId || resize?.guideId || null;
  const out = lowerOpeningGuides(guideTargets, hotId).concat(handleFaces(info));
  const head = resize?.headGuide;
  if (head) {
    const from = Math.min(head.from, resize.center - resize.start.width / 2);
    const to = Math.max(head.to, resize.center + resize.start.width / 2);
    const p = (u, z) => head.orient === 'h' ? { x: u, y: head.across, z } : { x: head.across, y: u, z };
    const a = p(from, head.z); const b = p(to, head.z);
    out.push({ pts: [a, b, p(to, head.z + 1)], normal: { x: head.orient === 'v' ? 1 : 0, y: head.orient === 'h' ? 1 : 0, z: 0 },
      edges: [[a, b]], edgeRgba: [0.05, 0.8, 0.73, 1], color: '#18c6af', kind: 'overlay', alpha: 0, flat: true, onTop: true, twoSided: true });
  }
  if (!openingToolOn() || !ghost?.valid) return out;
  const b = ghost.box; const e = 7;
  const r = ghost.returnRect;
  const boxes = r ? [b, { ...b, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }] : [b];
  return out.concat(boxes.flatMap((q) => boxFaces(q.x0 - e, q.y0 - e, q.x1 + e, q.y1 + e, q.z0, q.z1, '#28a8d8', 'overlay'))
    .map((face) => ({ ...face, alpha: 0.42, flat: true, twoSided: true })));
}

export function openingHandleAt(event) {
  if (openingToolOn() || !env?.project) return null;
  const info = selectedInfo();
  if (!info) return null;
  let best = null;
  for (const handle of info.handles) {
    const p = env.project(handle.point);
    const d = Math.hypot(event.clientX - p.x, event.clientY - p.y);
    if (d <= (event.pointerType === 'touch' ? 22 : 13) && (!best || d < best.d)) best = { ...handle, d, info };
  }
  return best;
}

const lineTitle = { from: 'левый край', center: 'центр', to: 'правый край' };

function snapLine(value, targets, keys, tolerance) {
  if (!(tolerance > 0)) return null;
  let best = null;
  for (const target of targets) for (const key of keys) {
    const d = Math.abs(value - target[key]);
    if (d <= tolerance && (!best || d < best.d)) best = { value: target[key], target, key, d };
  }
  return best;
}

export const openingResizeDragging = () => Boolean(resize);

export function startOpeningResize(event, handle = openingHandleAt(event)) {
  if (!handle || !env) return false;
  const info = handle.info;
  resize = {
    id: info.opening.id, part: handle.id, x0: event.clientX, y0: event.clientY,
    before: snapshot(), start: structuredClone(info.opening), center: info.placed.absCenter,
    point: handle.point, level: info.level, sill: info.z0 - info.level.elevation, top: info.z1 - info.level.elevation,
    span: handle.id === 'top' ? info.span : null,
    wall: handle.wall || info.wall, wingSign: handle.wingSign, wallBottom: info.wallBottom, wallTop: info.wallTop, moved: false,
  };
  if (handle.id === 'top') {
    const base = info.level.elevation;
    resize.heads = facadeWindowHeads(state.project, info.opening, info.wall, state.walls,
      Math.max(info.z0, base + info.wallBottom) + 300, base + (info.span?.maxTop ?? info.wallTop));
  }
  const message = resize.span
    ? 'Тяните верх окна до потолка следующего этажа'
    : 'Тяните ручку, чтобы изменить размер · Shift — без привязки';
  env.label?.(message, event.clientX, event.clientY);
  return true;
}

function restoreOpeningStart() {
  const opening = state.project.openings.find((o) => o.id === resize.id);
  if (!opening) return null;
  for (const key of Object.keys(opening)) delete opening[key];
  Object.assign(opening, structuredClone(resize.start));
  return opening;
}

// Экранная шкала Z меняется по глубине в перспективе. Ищем отметку
// непосредственно на проекции выбранной вертикали, сохраняя точку захвата.
function dragElevation(event, low, high) {
  const at = (z) => env.project({ ...resize.point, z: resize.level.elevation + z });
  const start = env.project(resize.point);
  const a = at(low);
  const b = at(high);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const length2 = vx * vx + vy * vy;
  if (length2 < 1) return resize.point.z - resize.level.elevation;
  const wanted = (start.x + event.clientX - resize.x0 - a.x) * vx + (start.y + event.clientY - resize.y0 - a.y) * vy;
  if (wanted <= 0) return low;
  if (wanted >= length2) return high;
  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const p = at(mid);
    if ((p.x - a.x) * vx + (p.y - a.y) * vy < wanted) low = mid;
    else high = mid;
  }
  return Math.round((low + high) / 2);
}

export function moveOpeningResize(event) {
  if (!resize || !env) return false;
  const opening = restoreOpeningStart();
  if (!opening) return false;
  const free = Boolean(event.shiftKey);
  const tolerance = free ? 0 : clamp(env.worldPerPx() * (event.pointerType === 'touch' ? 20 : 12), 20, 600);
  const targets = guidesFor(resize.level.id, resize.wall)
    .filter((t) => t.kind === opening.kind);
  const noun = opening.kind === 'door' ? 'двери' : 'окна';
  let label = '';
  resize.guideId = null;
  resize.headGuide = null;
  if (resize.part === 'main' || resize.part === 'return') {
    const axis = resize.wall.orient === 'h' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const delta = env.axisDelta(axis, event.clientX - resize.x0, event.clientY - resize.y0);
    const start = resize.part === 'return' ? resize.start.corner.returnWidth : resize.start.width;
    const step = free ? 1 : 50;
    const width = Math.max(600, Math.round((start + delta * resize.wingSign) / step) * step);
    if (!resizeCornerWing(state.project, opening, state.walls, resize.part, width)) {
      env.label?.('На этой стене не хватает места', event.clientX, event.clientY);
      env.redraw?.(true);
      return true;
    }
    label = `Крыло · ${width} мм`;
  } else if (resize.part === 'from' || resize.part === 'to') {
    const axis = resize.wall.orient === 'h' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const delta = env.axisDelta(axis, event.clientX - resize.x0, event.clientY - resize.y0);
    const startHalf = resize.start.width / 2;
    const fixed = resize.part === 'from' ? resize.center + startHalf : resize.center - startHalf;
    let moving = (resize.part === 'from' ? resize.center - startHalf : resize.center + startHalf) + delta;
    const snapped = snapLine(moving, targets, ['from', 'center', 'to'], tolerance);
    if (snapped) {
      moving = snapped.value;
      resize.guideId = snapped.target.id;
      label = `${lineTitle[snapped.key]} ${noun} · ${snapped.target.levelName}`;
    }
    const width = Math.max(glazedOpeningMinWidth(opening), Math.abs(fixed - moving));
    const center = resize.part === 'from' ? fixed - width / 2 : fixed + width / 2;
    if (isGlazedAssembly(opening)) Object.assign(opening, resizeGlazedOpening(opening, { width: Math.round(width) }));
    else opening.width = Math.round(width);
    const pos = openingPosAt(state.project, opening, state.walls, center);
    const fitted = pos === null ? null : fitOpeningOffset(state.project, opening, state.walls, pos, { others: levelWindowOpenings(state.project, state.walls) });
    if (fitted === null) { restoreOpeningStart(); env.redraw?.(true); return true; }
    setOpeningPos(opening, fitted);
    if (resize.start.span && !nextWindowSpan(state.project, resize.level.id, opening)) {
      restoreOpeningStart();
      env.label?.('На верхнем этаже для такой ширины нет места', event.clientX, event.clientY);
      env.redraw?.(true);
      return true;
    }
  } else if (resize.part === 'top') {
    const assembly = glazedAssemblySpec(opening);
    const minimum = Math.max(Math.max(resize.sill, resize.wallBottom) + 300,
      assembly && (assembly.leftWindow || assembly.rightWindow) ? Math.max(assembly.doorHeight, assembly.windowSill + 300) : 0);
    const maximum = resize.span?.maxTop ?? resize.wallTop;
    let top = dragElevation(event, minimum, maximum);
    const vertical = targets.map((t) => ({ ...t, top: t.sill + t.height }));
    const head = snapLine(top + resize.level.elevation, resize.heads, ['z'], tolerance);
    const snapped = snapLine(top, vertical, ['top'], tolerance);
    if (head && (!snapped || head.d <= snapped.d)) {
      top = head.value - resize.level.elevation;
      resize.headGuide = head.target;
      label = `По верху соседнего окна · ${head.target.levelName}`;
    } else if (snapped) { top = snapped.value; resize.guideId = snapped.target.id; label = `верх ${noun} · ${snapped.target.levelName}`; }
    top = clamp(top, minimum, maximum);
    if (resize.span && top >= resize.span.minTop) {
      if (!free && !resize.headGuide && maximum - top <= tolerance) top = maximum;
      setWindowSpan(state.project, resize.level.id, opening, top);
      label ||= state.project.levels.find((l) => l.id === resize.span.targetLevelId)?.name || '';
    } else {
      clearWindowSpan(opening);
      const height = Math.round(Math.min(top, resize.wallTop) - resize.sill);
      if (assembly) Object.assign(opening, resizeGlazedOpening(opening, { height }));
      else opening.height = height;
      if (opening.kind === 'window') {
        opening.sill = resize.sill;
        opening.heightMode = 'custom';
      }
    }
  } else {
    const maximum = Math.min(resize.wallTop, resize.top) - 300;
    let sill = dragElevation(event, resize.wallBottom, maximum);
    const snapped = snapLine(sill, targets, ['sill'], tolerance);
    if (snapped) { sill = snapped.value; resize.guideId = snapped.target.id; label = `подоконник ${Math.round(sill)} · ${snapped.target.levelName}`; }
    opening.sill = Math.round(clamp(sill, resize.wallBottom, maximum));
    opening.height = Math.round(Math.min(resize.wallTop, resize.top) - opening.sill);
    opening.heightMode = 'custom';
  }
  resize.moved = true;
  const sill = openingSill(opening, resize.level);
  const top = opening.span && windowSpanTop(state.project, resize.level.id, opening);
  const height = top ? top - sill : openingHeight(opening, resize.level);
  const width = opening.corner ? `${opening.width} + ${opening.corner.returnWidth}` : opening.width;
  const size = `${width} × ${Math.round(height)} мм${opening.kind === 'window' ? ` · подоконник ${sill}` : ''}`;
  env.label?.(`${size}${label ? ` · ${label}` : ''}`, event.clientX, event.clientY);
  env.redraw?.(true);
  return true;
}

export function finishOpeningResize() {
  if (!resize) return false;
  const moved = resize.moved; const before = resize.before;
  resize = null;
  env?.label?.(null);
  if (moved) {
    refreshDerived();
    pushHistory(before);
    afterChange();
    env?.redraw?.(true);
  }
  return true;
}

export function cancelOpeningResize() {
  if (!resize) return false;
  const before = resize.before;
  resize = null;
  restoreFrom(before);
  env?.label?.(null);
  env?.redraw?.(true);
  return true;
}

export function openingSelectionHint() {
  if (selectedInfo()?.opening.corner) return 'Тяните край каждого крыла или синюю ручку общей высоты';
  return selectedInfo()?.span
    ? 'Потяните верхнюю синюю ручку окна на следующий этаж, чтобы сделать второй свет'
    : 'Тяните боковые ручки, чтобы изменить ширину, синюю ручку — чтобы изменить высоту';
}

export function openingToolHint() {
  if (state.tool?.preset?.presetId === CORNER_PRESET) return 'Выберите наружный угол помещения для двух крыльев витража';
  const title = state.tool?.openKind === 'door' ? 'дверь' : 'окно';
  return `3D: наведите на стену и кликните — поставить ${title} · линии и размеры липнут к этажам ниже · Shift — без привязки · Esc — выйти`;
}

export function resetOpeningTool() {
  if (resize) cancelOpeningResize();
  ghost = null;
  lastEvent = null;
  env?.label?.(null);
}

export function rehoverOpeningTool() {
  if (lastEvent && openingToolOn()) openingToolMove(lastEvent);
}

export function debugOpening3d() {
  const info = !openingToolOn() ? selectedInfo() : null;
  return {
    on: openingToolOn(), valid: Boolean(ghost?.valid), error: ghost?.error || null, resizing: resize?.part || null,
    alignedHeadId: resize?.headGuide?.id || null,
    kind: ghost?.opening?.kind || state.tool?.openKind || null,
    opening: ghost?.opening ? { ...ghost.opening } : null,
    wall: ghost?.hit ? { key: ghost.hit.key, levelId: ghost.hit.levelId } : null,
    snap: ghost?.snap?.snapped ? {
      levelId: ghost.snap.sourceLevelId, openingId: ghost.snap.sourceOpeningId, mode: ghost.snap.mode, label: ghost.snap.label,
    } : null,
    guides: ghost?.valid ? ghost.targets?.length || 0 : info?.targets?.length || 0,
  };
}

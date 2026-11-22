// Создание дверей и окон прямо на фасаде в 3D. Использует тот же инструмент,
// заготовку и проверку места, что план; дополнительно притягивает линии и
// размеры к проёмам нижних этажей.

import { boxFaces, wallZRange } from '../core/mesh3d.js';
import { fitOpeningOffset } from '../core/opening-spacing.js';
import { lowerOpeningTargets, snapOpeningToLower } from '../core/opening-snap3d.js';
import { openingHeight } from '../core/opening-preset.js';
import { openingPosAt, openingRect, setOpeningPos } from '../core/walls.js';
import { toast } from './dom.js';
import { computeOpeningParams } from './plan-actions.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, refreshDerived, restoreFrom, snapshot } from './store.js';

let env = null;
let ghost = null;
let lastEvent = null;
let resize = null;

export function initOpening3d(next) { env = next; }

export const openingToolOn = () => state.tool?.kind === 'place-opening';

function activeWall(hit) {
  return (state.walls || []).find((wall) => wall.key === hit.key &&
    (hit.from === undefined || Math.abs(wall.from - hit.from) < 1)) || null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function buildCandidate(event) {
  const hit = env?.pick?.(event);
  if (!hit || hit.type !== 'wall' || hit.face !== 'side') {
    return { valid: false, error: 'Наведите на боковую грань стены' };
  }
  if (hit.levelId !== state.project.activeLevel) {
    const level = state.project.levels.find((l) => l.id === hit.levelId);
    return { valid: false, error: `Переключитесь на этаж «${level?.name || hit.levelId}»` };
  }
  const wall = activeWall(hit);
  if (!wall) return { valid: false, error: 'Стена активного этажа не найдена' };
  // На один миллиметр в сторону выбранной грани — дверь понимает сторону
  // открывания так же, как курсор по разные стороны стены на плане.
  const at = { x: hit.point.x + hit.normal.x, y: hit.point.y + hit.normal.y };
  // Хост из 3D нужен только для этого расчёта. Не оставляем его в tool:
  // после закрытия 3D клик на плане снова должен выбирать стену под мышью.
  const oldPresetWall = state.tool.presetWall;
  const oldFree = state.openingFree;
  let result;
  try {
    state.tool.presetWall = { key: hit.key, from: hit.kind === 'manual' ? undefined : hit.from };
    state.openingFree = Boolean(event.shiftKey);
    result = computeOpeningParams(at);
  } finally {
    state.tool.presetWall = oldPresetWall;
    state.openingFree = oldFree;
  }
  if (!result) return { valid: false, error: 'На этой грани проём не создаётся' };
  if (result.error) return { valid: false, error: result.error };
  let opening = result.opening;
  let placed = openingRect(state.project, opening, state.walls);
  if (!placed) return { valid: false, error: 'Не удалось определить положение проёма' };
  const unsnappedOpening = opening;
  const unsnappedPlaced = placed;
  let snap = { snapped: false, label: '' };
  let targets = [];
  if (!event.shiftKey) {
    targets = lowerOpeningTargets(state.project, state.project.activeLevel, wall);
    const tolerance = clamp((env?.worldPerPx?.() || 20) * (event.pointerType === 'touch' ? 20 : 12), 20, 600);
    snap = snapOpeningToLower(opening, placed.absCenter, targets, tolerance);
    if (snap.snapped) {
      opening = snap.opening;
      const pos = openingPosAt(state.project, opening, state.walls, snap.center);
      const fitted = pos === null ? null : fitOpeningOffset(state.project, opening, state.walls, pos);
      if (fitted !== null) {
        setOpeningPos(opening, fitted);
        placed = openingRect(state.project, opening, state.walls);
        // Коллизия с проёмом текущего этажа могла увести нас от линии низа.
        if (!placed || Math.abs(placed.absCenter - snap.center) > 1) {
          opening = unsnappedOpening; placed = unsnappedPlaced; snap = { snapped: false, label: '' };
        }
      } else {
        opening = unsnappedOpening; placed = unsnappedPlaced; snap = { snapped: false, label: '' };
      }
    }
  }
  const level = state.project.levels.find((l) => l.id === state.project.activeLevel);
  const wallBottom = hit.box?.wallZ0 ?? (level?.elevation || 0);
  const wallTop = hit.box?.wallZ1 ?? wallBottom + (level?.height || 3000);
  const z0 = (level?.elevation || 0) + Number(opening.sill || 0);
  const effectiveHeight = openingHeight(opening, level);
  const z1 = z0 + effectiveHeight;
  if (z0 < wallBottom - 0.5 || z1 > wallTop + 0.5) {
    return { valid: false, error: `Высота проёма не помещается в стену (${Math.round(wallTop - wallBottom)} мм)` };
  }
  const r = placed.rect;
  return {
    valid: true, opening, wall, hit, snap, targets,
    box: { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, z0, z1 },
  };
}

export function openingToolMove(event) {
  if (!openingToolOn() || !env) return false;
  lastEvent = event;
  ghost = buildCandidate(event);
  const title = state.tool.openKind === 'door' ? 'Дверь' : 'Окно';
  const text = ghost.valid
    ? `${title} ${ghost.opening.width} × ${Math.round(ghost.box.z1 - ghost.box.z0)} мм${ghost.opening.kind === 'window' ? ` · подоконник ${ghost.opening.sill}` : ''}${ghost.snap.label ? ` · ${ghost.snap.label}` : ''}`
    : ghost.error;
  env.label?.(text, event.clientX, event.clientY);
  env.redraw?.(false);
  return true;
}

export function openingToolClick(event) {
  if (!openingToolOn() || !env) return false;
  ghost = buildCandidate(event);
  if (!ghost.valid) { toast(ghost.error || 'Здесь нельзя поставить проём', true); return true; }
  const opening = ghost.opening;
  mutate(() => { state.project.openings.push(opening); });
  toast(`${opening.kind === 'door' ? 'Дверь' : 'Окно'} поставлена в 3D${ghost.snap.label ? ` · ${ghost.snap.label}` : ''}`);
  ghost = null;
  env.redraw?.(true);
  openingToolMove(event);
  return true;
}

function selectedInfo() {
  if (state.selection?.type !== 'opening') return null;
  const opening = state.project.openings.find((o) => o.id === state.selection.id);
  if (!opening) return null;
  const placed = openingRect(state.project, opening, state.walls);
  const level = state.project.levels.find((l) => l.id === state.project.activeLevel);
  if (!placed || !level) return null;
  const wall = placed.wall;
  const wallRange = wallZRange(state.project, wall, level.height);
  const cross = wall.orient === 'h' ? wall.band.y + wall.band.h / 2 : wall.band.x + wall.band.w / 2;
  const along = placed.absCenter;
  const half = opening.width / 2;
  const z0 = level.elevation + opening.sill;
  const effectiveHeight = openingHeight(opening, level);
  const z1 = z0 + effectiveHeight;
  const point = (a, z) => (wall.orient === 'h' ? { x: a, y: cross, z } : { x: cross, y: a, z });
  const handles = [
    { id: 'from', point: point(along - half, (z0 + z1) / 2) },
    { id: 'to', point: point(along + half, (z0 + z1) / 2) },
    { id: 'top', point: point(along, z1) },
  ];
  if (opening.kind === 'window') handles.push({ id: 'bottom', point: point(along, z0) });
  const targets = lowerOpeningTargets(state.project, state.project.activeLevel, wall)
    .filter((t) => t.kind === opening.kind);
  return { opening, placed, wall, level, handles, targets, z0, z1, wallBottom: wallRange.z0, wallTop: wallRange.z1 };
}

function handleFaces() {
  if (openingToolOn()) return [];
  const info = selectedInfo();
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
  const out = lowerOpeningGuides(guideTargets, hotId).concat(handleFaces());
  if (!openingToolOn() || !ghost?.valid) return out;
  const b = ghost.box; const e = 7;
  return out.concat(boxFaces(b.x0 - e, b.y0 - e, b.x1 + e, b.y1 + e, b.z0, b.z1, '#28a8d8', 'overlay')
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
    before: snapshot(), start: { ...structuredClone(info.opening), height: openingHeight(info.opening, info.level) }, center: info.placed.absCenter,
    wall: info.wall, wallBottom: info.wallBottom, wallTop: info.wallTop, moved: false,
  };
  env.label?.('Тяните ручку · линии этажей ниже подсвечиваются привязкой · Shift — свободно', event.clientX, event.clientY);
  return true;
}

function restoreOpeningStart() {
  const opening = state.project.openings.find((o) => o.id === resize.id);
  if (!opening) return null;
  for (const key of Object.keys(opening)) delete opening[key];
  Object.assign(opening, structuredClone(resize.start));
  return opening;
}

export function moveOpeningResize(event) {
  if (!resize || !env) return false;
  const opening = restoreOpeningStart();
  if (!opening) return false;
  const free = Boolean(event.shiftKey);
  const tolerance = free ? 0 : clamp(env.worldPerPx() * (event.pointerType === 'touch' ? 20 : 12), 20, 600);
  const targets = lowerOpeningTargets(state.project, state.project.activeLevel, resize.wall)
    .filter((t) => t.kind === opening.kind);
  const noun = opening.kind === 'door' ? 'двери' : 'окна';
  let label = '';
  resize.guideId = null;
  if (resize.part === 'from' || resize.part === 'to') {
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
    const width = Math.max(300, Math.abs(fixed - moving));
    const center = resize.part === 'from' ? fixed - width / 2 : fixed + width / 2;
    opening.width = Math.round(width);
    const pos = openingPosAt(state.project, opening, state.walls, center);
    const fitted = pos === null ? null : fitOpeningOffset(state.project, opening, state.walls, pos);
    if (fitted === null) { restoreOpeningStart(); return true; }
    setOpeningPos(opening, fitted);
  } else {
    const delta = env.axisDelta({ x: 0, y: 0, z: 1 }, event.clientX - resize.x0, event.clientY - resize.y0);
    if (resize.part === 'top') {
      let top = resize.start.sill + resize.start.height + delta;
      const vertical = targets.map((t) => ({ ...t, top: t.sill + t.height }));
      const snapped = snapLine(top, vertical, ['top'], tolerance);
      if (snapped) { top = snapped.value; resize.guideId = snapped.target.id; label = `верх ${noun} · ${snapped.target.levelName}`; }
      top = clamp(top, Math.max(resize.start.sill + 300, resize.wallBottom + 300), resize.wallTop);
      opening.height = Math.round(top - resize.start.sill);
      if (opening.kind === 'window') opening.heightMode = 'custom';
    } else {
      const fixedTop = resize.start.sill + resize.start.height;
      let sill = resize.start.sill + delta;
      const snapped = snapLine(sill, targets, ['sill'], tolerance);
      if (snapped) { sill = snapped.value; resize.guideId = snapped.target.id; label = `подоконник ${Math.round(sill)} · ${snapped.target.levelName}`; }
      sill = clamp(sill, resize.wallBottom, fixedTop - 300);
      opening.sill = Math.round(sill);
      opening.height = Math.round(fixedTop - sill);
      if (opening.kind === 'window') opening.heightMode = 'custom';
    }
  }
  resize.moved = true;
  const size = `${opening.width} × ${opening.height} мм${opening.kind === 'window' ? ` · подоконник ${opening.sill}` : ''}`;
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

export function openingToolHint() {
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
    kind: ghost?.opening?.kind || state.tool?.openKind || null,
    opening: ghost?.opening ? { ...ghost.opening } : null,
    wall: ghost?.hit ? { key: ghost.hit.key, levelId: ghost.hit.levelId } : null,
    snap: ghost?.snap?.snapped ? {
      levelId: ghost.snap.sourceLevelId, openingId: ghost.snap.sourceOpeningId, mode: ghost.snap.mode, label: ghost.snap.label,
    } : null,
    guides: ghost?.valid ? ghost.targets?.length || 0 : info?.targets?.length || 0,
  };
}

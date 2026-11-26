// Планы этажей и участка используют те же проступи крыльца, что и 3D.
// Перемещение камеры и наведение не пересчитывают стены и рельеф.
import { toWorld } from '../core/building.js';
import { deriveEntrances, entranceParts } from '../core/entrance.js';
import { pointInBuilding } from '../core/site-check.js';
import { pointInPolygon, pointToSegmentDistance } from '../core/zamer/geometry.js';

const cache = new WeakMap();
export const invalidateEntrancePlan = (st) => cache.delete(st);
export function entrancePlanParts(st) {
  const old = cache.get(st);
  if (Number.isFinite(st.drawingRevision) && old?.project === st.project && old.revision === st.drawingRevision && old.walls === st.walls && old.level === st.project.activeLevel) return old.parts;
  const wallsByLevel = st.walls ? new Map([[st.project.activeLevel, st.walls]]) : null;
  const parts = deriveEntrances(st.project, { wallsByLevel }).flatMap((entry) => {
    const list = entranceParts(entry);
    if (entry.ramp?.enabled) list.push({ key: 'ramp', title: 'Пандус', polygon: entry.ramp.polygon, z: entry.topZ });
    return list.map((part) => ({ ...part, openingId: entry.openingId, levelId: entry.levelId, color: entry.color,
      worldPolygon: part.polygon.map((p) => toWorld(st.project.building, p)) }));
  }).sort((a, b) => a.z - b.z);
  cache.set(st, { project: st.project, revision: st.drawingRevision, walls: st.walls, level: st.project.activeLevel, parts });
  return parts;
}

// На плане этажа крыльцо принадлежит входной двери своего этажа.
// На участке и в ландшафте оно остаётся частью дома при любом активном этаже.
export function visibleEntranceParts(st) {
  const parts = entrancePlanParts(st);
  return st.modeName === 'plan' ? (st.roofPlan ? [] : parts.filter((p) => p.levelId === st.project.activeLevel)) : parts;
}

export function hitEntrancePlan(st, point, tolerance = 0) {
  // На плане этажа крыльцо — фон участка, как плиты ландшафта.
  if (st.modeName === 'plan') return null;
  const parts = visibleEntranceParts(st);
  if (!parts.length || pointInBuilding(st.project, point)) return null;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i]; const poly = p.worldPolygon;
    if (pointInPolygon(point, poly) || poly.some((a, index) => pointToSegmentDistance(point, a, poly[(index + 1) % poly.length]) <= tolerance)) return p;
  }
  return null;
}

// Контекст уже в локальных осях дома (composeView), а не участка.
export function drawEntrancePlan(ctx, st, tokens, px, { mono = false, print = false } = {}) {
  const parts = visibleEntranceParts(st);
  const interactive = !print && st.modeName !== 'plan';
  for (const part of parts) {
    const selected = interactive && st.selection?.type === 'entrance' && st.selection.id === part.openingId && (st.selection.part || 'landing') === part.key;
    const hovered = interactive && st.hover?.type === 'entrance' && st.hover.id === part.openingId && st.hover.part === part.key;
    ctx.save();
    ctx.beginPath();
    part.polygon.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.closePath();
    ctx.fillStyle = mono ? tokens.surface : part.color;
    ctx.fill();
    if (selected || hovered) {
      ctx.globalAlpha = selected ? .2 : .1;
      ctx.fillStyle = tokens.accent; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = selected || hovered ? tokens.accent : tokens.line;
    ctx.lineWidth = px(selected ? 2 : hovered ? 1.5 : .8);
    ctx.stroke(); ctx.restore();
  }
  return parts.length;
}

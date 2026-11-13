// Крыши-плиты (core/roofs.js) на холсте.
// «План крыши» (ui/roof-plan.js) — drawRoofPlan: подложка этажей (бледные
// контуры помещений и наружных стен, неинтерактивная), крыши целиком —
// плита с выносом (заливка цветом материала), свой контур штрихом, подпись;
// выбранная — акцентом, ручки: квадраты — вершины, кружки — середины рёбер,
// синие точки — вынос; призрак инструмента «Крыша»; подпись жеста.
// План этажа — drawRoofOutlines: только по настройке вида (по умолчанию
// выкл) бледный штрих проекции плиты, мышь не ловит.

import { DEFAULT_EXTERIOR, isOpenRoom, isShaft } from '../core/catalog.js';
import { materialColor, overhangLabel, rectsOutline, roofRects } from '../core/roofs.js';
import { roomPolygon, roomRects } from '../core/room-shape.js';
import {
  ghostRoofFor, isRoofPlan, planRoofHandles, planRoofPref, rememberRoofHandles, roofOutlineEdges, roofs, selectedRoof,
} from './plan-roofs.js';
import { state } from './state.js';

export { planRoofPref, setPlanRoofPref } from './plan-roofs.js';

function strokeEdges(ctx, edges, p2s) {
  ctx.beginPath();
  for (const e of edges) {
    const a = p2s(e.a.x, e.a.y);
    const b = p2s(e.b.x, e.b.y);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

function polyPath(ctx, pts, p2s) {
  pts.forEach((q, i) => {
    const s = p2s(q.x, q.y);
    if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
}

function rectsPath(ctx, rects, p2s) {
  for (const r of rects) polyPath(ctx, [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }], p2s);
}

function labelAt(ctx, text, s, tokens, color, center = false) {
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const x = center ? s.x - w / 2 : s.x - 2;
  ctx.fillStyle = tokens.surface || '#ffffff';
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, s.y - 1, w, 17);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 5, s.y + 2);
}

// План этажа: контуры крыш активного этажа — бледно, без подписи; только по
// настройке вида (на экране — «на плане», на печати — «на листах»).
// → число нарисованных (state._planRoofs — для автотестов).
export function drawRoofOutlines(ctx, { p2s, tokens, print = false }) {
  const pref = planRoofPref();
  state._planRoofs = 0;
  if (state.modeName !== 'plan' && !print) return 0;
  if (!print && isRoofPlan()) return 0;
  if (print ? !pref.print : !pref.on) return 0;
  const lv = state.project?.activeLevel;
  const list = roofs().filter((r) => r.levelId === lv);
  if (!list.length) return 0;
  ctx.save();
  ctx.strokeStyle = print ? '#333333' : (tokens.ink || tokens.text || '#3d4148');
  ctx.globalAlpha = print ? 0.75 : 0.35;
  ctx.lineWidth = 1;
  ctx.setLineDash([12, 4, 2, 4]);
  for (const r of list) {
    const edges = roofOutlineEdges(r);
    if (!edges.length) continue;
    strokeEdges(ctx, edges, p2s);
    state._planRoofs += 1;
  }
  ctx.restore();
  return state._planRoofs;
}

// Подложка «Плана крыши»: помещения всех этажей тонко, наружный контур
// каждого этажа (с наружной стеной) чуть темнее; верхний этаж — заметнее.
function drawUnderlay(ctx, p2s, tokens) {
  const levels = [...(state.project.levels || [])].sort((a, b) => a.elevation - b.elevation);
  const t = Number(state.project.settings?.exterior) || DEFAULT_EXTERIOR;
  const ink = tokens.ink || tokens.text || '#3d4148';
  ctx.save();
  levels.forEach((l, k) => {
    const top = k === levels.length - 1;
    const rooms = (l.rooms || []).filter((r) => !isShaft(r));
    ctx.strokeStyle = ink;
    ctx.globalAlpha = top ? 0.32 : 0.16;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const r of rooms) polyPath(ctx, roomPolygon(r), p2s);
    ctx.stroke();
    const shell = rectsOutline(rooms.filter((r) => !r.parentId && !isOpenRoom(r))
      .flatMap((r) => roomRects(r).map((q) => ({ x0: q.x - t, y0: q.y - t, x1: q.x + q.w + t, y1: q.y + q.h + t }))));
    if (shell) {
      ctx.globalAlpha = top ? 0.5 : 0.25;
      ctx.lineWidth = top ? 1.4 : 1;
      ctx.beginPath();
      polyPath(ctx, shell, p2s);
      ctx.stroke();
    }
  });
  ctx.restore();
}

function drawHandles(ctx, hs, accent, hotId) {
  for (const h of hs) {
    const hot = h.id === hotId;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = accent;
    if (h.kind === 'vertex') {
      const r = hot ? 6 : 5;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(h.s.x - r, h.s.y - r, 2 * r, 2 * r);
      ctx.strokeRect(h.s.x - r, h.s.y - r, 2 * r, 2 * r);
    } else if (h.kind === 'edge') {
      ctx.beginPath();
      ctx.arc(h.s.x, h.s.y, hot ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      const r = hot ? 6.5 : 5.5;
      ctx.moveTo(h.s.x, h.s.y - r); ctx.lineTo(h.s.x + r, h.s.y); ctx.lineTo(h.s.x, h.s.y + r); ctx.lineTo(h.s.x - r, h.s.y);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

// «План крыши» целиком (экранные координаты через p2s). → число крыш
// (state._roofPlanDrawn — для автотестов).
export function drawRoofPlan(ctx, { p2s, tokens }) {
  rememberRoofHandles([]);
  state._roofPlanDrawn = 0;
  if (!isRoofPlan()) return 0;
  const accent = tokens.accent || '#2f6fd6';
  const ink = tokens.ink || tokens.text || '#3d4148';
  drawUnderlay(ctx, p2s, tokens);
  ctx.save();
  const sel = selectedRoof();
  const hoverId = state.hover?.type === 'roof' ? state.hover.id : null;
  for (const r of roofs()) {
    const isSel = sel?.id === r.id;
    const slab = roofOutlineEdges(r);
    if (!slab.length) continue;
    // Плита с выносом — заливка цветом материала.
    ctx.beginPath();
    rectsPath(ctx, roofRects(state.project, r), p2s);
    ctx.fillStyle = materialColor(r.material);
    ctx.globalAlpha = isSel ? 0.2 : 0.13;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isSel ? accent : ink;
    ctx.lineWidth = isSel ? 2 : (hoverId === r.id ? 1.8 : 1.3);
    strokeEdges(ctx, slab, p2s);
    // Свой контур (основание без выноса) — штрих.
    ctx.beginPath();
    polyPath(ctx, r.outline, p2s);
    ctx.setLineDash(isSel ? [] : [6, 4]);
    ctx.lineWidth = isSel ? 1.6 : 1;
    ctx.globalAlpha = isSel ? 1 : 0.7;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const xs = r.outline.map((q) => q.x); const ys = r.outline.map((q) => q.y);
    const c = p2s((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
    labelAt(ctx, `${r.name} · ${overhangLabel(r)}`, { x: c.x, y: c.y - 8 }, tokens, isSel ? accent : ink, true);
    state._roofPlanDrawn += 1;
  }
  // Призрак инструмента: прямоугольник жеста или форма помещения под курсором.
  const t = state.tool;
  if (t?.kind === 'roof') {
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([8, 4]);
    if (t.draw && (t.draw.a.x !== t.draw.b.x || t.draw.a.y !== t.draw.b.y)) {
      const { a, b } = t.draw;
      ctx.beginPath();
      polyPath(ctx, [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }], p2s);
      ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    } else if (t.hover) {
      const ghost = ghostRoofFor(t.hover.levelId, t.hover.roomId);
      if (ghost) {
        ctx.beginPath();
        polyPath(ctx, ghost.outline, p2s);
        ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    if (t.cursor && !t.draw) {
      const s = p2s(t.cursor.x, t.cursor.y);
      ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); ctx.stroke();
    }
  }
  if (sel && !t) {
    const hs = planRoofHandles(p2s);
    rememberRoofHandles(hs);
    drawHandles(ctx, hs, accent, null);
  }
  if (state.roofLabel) {
    const s = p2s(state.roofLabel.x, state.roofLabel.y);
    labelAt(ctx, state.roofLabel.text, { x: s.x + 14, y: s.y + 12 }, tokens, accent);
  }
  ctx.restore();
  return state._roofPlanDrawn;
}

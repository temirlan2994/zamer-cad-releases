// Крыши-плиты на плане (core/roofs.js, ui/roofs.js): «проекция кровли» —
// тонкий штрихпунктир контура плиты с подписью «Крыша 1 · вынос 1200» на
// плане этажа, над которым крыша; клики плана его не ловят (выбор — по зоне
// выноса вне помещений, ui/roofs.js roofZoneHit). Выбранная крыша — жирнее
// акцентом, точки выноса (середины сторон и углы), подпись при жесте.
// Инструмент «Крыша» — подсветка помещения и призрак будущей плиты.
// Настройка вида (localStorage): показывать контур на плане (вкл), на
// листах/печати (выкл).

import { overhangLabel } from '../core/roofs.js';
import { roomRects } from '../core/room-shape.js';
import {
  ghostRoofFor, planRoofHandles, planRoofPref, rememberRoofHandles, roofOutlineEdges, roofs, selectedRoof,
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

function labelAt(ctx, text, s, tokens, color) {
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = tokens.surface || '#ffffff';
  ctx.globalAlpha = 0.9;
  ctx.fillRect(s.x - 2, s.y - 1, w, 17);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(text, s.x + 3, s.y + 2);
}

// Контуры крыш активного этажа. → число нарисованных (state._planRoofs — для автотестов).
export function drawRoofOutlines(ctx, { p2s, tokens, print = false }) {
  const pref = planRoofPref();
  state._planRoofs = 0;
  if (state.modeName !== 'plan' && !print) return 0;
  if (print ? !pref.print : !pref.on) return 0;
  const lv = state.project?.activeLevel;
  const list = roofs().filter((r) => r.levelId === lv);
  if (!list.length) return 0;
  const color = print ? '#333333' : (tokens.ink || tokens.text || '#3d4148');
  ctx.save();
  for (const r of list) {
    const edges = roofOutlineEdges(r);
    if (!edges.length) continue;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.setLineDash([12, 4, 2, 4]);
    strokeEdges(ctx, edges, p2s);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Подпись — у верхнего левого угла плиты (снаружи стен, в зоне выноса).
    const tl = edges.reduce((m, e) => (e.a.x + e.a.y < m.x + m.y ? e.a : m), edges[0].a);
    const s = p2s(tl.x, tl.y);
    labelAt(ctx, `${r.name} · ${overhangLabel(r)}`, { x: s.x + 4, y: s.y + 3 }, tokens, color);
    state._planRoofs += 1;
  }
  ctx.restore();
  return state._planRoofs;
}

// Поверх плана: выбранная крыша (контур, точки), призрак инструмента, подпись жеста.
export function drawRoofOverlay(ctx, { p2s, tokens }) {
  rememberRoofHandles([]);
  if (state.modeName !== 'plan') return;
  const accent = tokens.accent || '#2f6fd6';
  ctx.save();
  const t = state.tool;
  if (t?.kind === 'roof' && t.hover) {
    const room = state.project.rooms.find((r) => r.id === t.hover);
    if (room) {
      ctx.beginPath();
      for (const q of roomRects(room)) {
        const a = p2s(q.x, q.y); const b = p2s(q.x + q.w, q.y + q.h);
        ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.globalAlpha = 1;
      const ghost = ghostRoofFor(state.project.activeLevel, room.id);
      const edges = ghost ? roofOutlineEdges(ghost) : [];
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([8, 4]);
      strokeEdges(ctx, edges, p2s);
      ctx.setLineDash([]);
    }
  }
  const roof = selectedRoof();
  if (roof && roof.levelId === state.project.activeLevel) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([12, 4, 2, 4]);
    strokeEdges(ctx, roofOutlineEdges(roof), p2s);
    ctx.setLineDash([]);
    const hs = t ? [] : planRoofHandles(p2s);
    rememberRoofHandles(hs);
    for (const h of hs) {
      ctx.beginPath();
      ctx.arc(h.s.x, h.s.y, h.id.length === 1 ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = accent;
      ctx.stroke();
    }
  }
  if (state.roofLabel) {
    const s = p2s(state.roofLabel.x, state.roofLabel.y);
    labelAt(ctx, state.roofLabel.text, { x: s.x + 14, y: s.y + 12 }, tokens, accent);
  }
  ctx.restore();
}

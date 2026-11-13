// Проёмы в перекрытии на плане этажа (экранные координаты): на этаже, чей пол
// вырезан, — штриховой контур с диагоналями и подписью «Проём в перекрытии»;
// на этаже ниже — тонкий бледный штрих (проём над головой); ручки выбранного.
// Лёгкий модуль (render.js): только core и state. Логика — ui/slab-ui.js.

import { slabHandlePoints, slabOpenings } from '../core/slab-openings.js';
import { state } from './state.js';

export const SLAB_HANDLE = 9; // px — сторона квадрата ручки

function corners(o) {
  return [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }];
}

function levelAbove(project) {
  const list = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  const i = list.findIndex((l) => l.id === project.activeLevel);
  return i >= 0 ? list[i + 1] || null : null;
}

// → state._slabUI: [{ id, auto, P (экранные углы), handles? }] для попадания.
export function drawSlabOpenings(ctx, { p2s, tokens, print = false }) {
  state._slabUI = [];
  const project = state.project;
  if (!project?.levels) return;
  const sel = state.selection?.type === 'slab' ? state.selection.id : null;
  // Этаж ниже: проём над головой — тонко.
  const above = levelAbove(project);
  if (above && !print) {
    ctx.save();
    ctx.strokeStyle = tokens.muted;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    for (const o of slabOpenings(project, above.id)) {
      const P = corners(o).map((p) => p2s(p.x, p.y));
      ctx.beginPath();
      P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const o of slabOpenings(project, project.activeLevel)) {
    const selected = o.id === sel;
    const hovered = !selected && state.hover?.type === 'slab' && state.hover.id === o.id;
    const color = selected ? tokens.accent : hovered ? tokens.hover : tokens.line;
    const P = corners(o).map((p) => p2s(p.x, p.y));
    ctx.save();
    ctx.beginPath();
    P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = selected ? 'rgba(31, 117, 255, 0.08)' : 'rgba(120, 130, 145, 0.08)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected || hovered ? 2 : 1.4;
    ctx.setLineDash(o.auto ? [8, 4] : [12, 4, 2, 4]);
    ctx.stroke();
    // Диагонали — условное обозначение проёма.
    ctx.setLineDash([]);
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[2].x, P[2].y);
    ctx.moveTo(P[1].x, P[1].y); ctx.lineTo(P[3].x, P[3].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Подпись у верхней кромки (по экрану).
    const top = P.reduce((a, p) => (p.y < a.y ? p : a), P[0]);
    const cx = P.reduce((s, p) => s + p.x, 0) / 4;
    const cy = P.reduce((s, p) => s + p.y, 0) / 4;
    const wpx = Math.max(...P.map((p) => p.x)) - Math.min(...P.map((p) => p.x));
    let label = null;
    if (wpx > 70) {
      const text = `Проём в перекрытии${o.auto ? '' : ' (ручной)'}`;
      const size = `${Math.round(o.w)} × ${Math.round(o.h)}`;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ly = Math.min(cy - 14, top.y + 6);
      const tw = Math.max(ctx.measureText(text).width, ctx.measureText(size).width) + 8;
      ctx.fillStyle = tokens.surface;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(cx - tw / 2, ly - 2, tw, 28);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillText(text, cx, ly);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(size, cx, ly + 13);
      label = { x0: cx - tw / 2, y0: ly - 2, x1: cx + tw / 2, y1: ly + 26 };
    }
    ctx.restore();
    const rec = { id: o.id, auto: o.auto, P, label, handles: null };
    if (selected && !print) {
      rec.handles = slabHandlePoints(o).map((h) => ({ ...h, s: p2s(h.x, h.y) }));
      for (const h of rec.handles) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (h.id.length === 1) ctx.rect(h.s.x - SLAB_HANDLE / 2, h.s.y - SLAB_HANDLE / 2, SLAB_HANDLE, SLAB_HANDLE);
        else ctx.arc(h.s.x, h.s.y, SLAB_HANDLE / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    state._slabUI.push(rec);
  }
  // Подпись при перетаскивании ручки (ui/slab-ui.js).
  const lab = state.slabLabel;
  if (lab && !print) {
    const p = p2s(lab.x, lab.y);
    ctx.save();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(lab.text).width + 14;
    ctx.fillStyle = tokens.accent;
    ctx.beginPath();
    ctx.rect(p.x - w / 2, p.y - 34, w, 20);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(lab.text, p.x, p.y - 24);
    ctx.restore();
  }
}

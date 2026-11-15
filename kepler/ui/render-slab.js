// Проёмы в перекрытии на плане этажа (экранные координаты): на этаже, чей пол
// вырезан, — штриховой контур с диагоналями и подписью «Проём в перекрытии»;
// на этаже ниже — тонкий бледный штрих (проём над головой); ручки выбранного.
// Лёгкий модуль (render.js): только core и state. Логика — ui/slab-ui.js.

import {
  slabHandlePoints, slabOpeningArea, slabOpeningPolygon, slabOpeningSourceLevel, slabOpenings,
} from '../core/slab-openings.js';
import { state } from './state.js';

export const SLAB_HANDLE = 9; // px — сторона квадрата ручки

const path = (ctx, points) => {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
};

const midpointHandles = (points) => points.map((p, i) => {
  const q = points[(i + 1) % points.length];
  return { id: `m:${i}`, kind: 'midpoint', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
});

function levelAbove(project) {
  const list = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  const i = list.findIndex((l) => l.id === project.activeLevel);
  return i >= 0 ? list[i + 1] || null : null;
}

// → state._slabUI: [{ id, auto, P (экранные углы), handles? }] для попадания.
export function drawSlabOpenings(ctx, { st = state, p2s, tokens, print = false }) {
  st._slabUI = [];
  const project = st.project;
  if (!project?.levels) return;
  const sel = st.selection?.type === 'slab' ? st.selection.id : null;
  // Этаж ниже: проём над головой — тонко.
  const above = levelAbove(project);
  if (above && !print) {
    ctx.save();
    ctx.strokeStyle = tokens.muted;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    for (const o of slabOpenings(project, above.id)) {
      const P = slabOpeningPolygon(o).map((p) => p2s(p.x, p.y));
      path(ctx, P);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const o of slabOpenings(project, project.activeLevel)) {
    const selected = o.id === sel;
    const hovered = !selected && st.hover?.type === 'slab' && st.hover.id === o.id;
    const color = selected ? tokens.accent : hovered ? tokens.hover : tokens.line;
    const polygon = slabOpeningPolygon(o);
    const P = polygon.map((p) => p2s(p.x, p.y));
    ctx.save();
    path(ctx, P);
    ctx.fillStyle = selected ? 'rgba(31, 117, 255, 0.045)' : 'rgba(70, 125, 160, 0.035)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected || hovered ? 2 : 1.4;
    ctx.setLineDash(o.auto ? [8, 4] : [12, 4, 2, 4]);
    ctx.stroke();
    // Редкая диагональная штриховка отличает пустоту от пола и не закрывает
    // лестницу нижнего этажа.
    const minX = Math.min(...P.map((p) => p.x)); const maxX = Math.max(...P.map((p) => p.x));
    const minY = Math.min(...P.map((p) => p.y)); const maxY = Math.max(...P.map((p) => p.y));
    path(ctx, P); ctx.clip();
    ctx.setLineDash([]); ctx.lineWidth = 0.7; ctx.globalAlpha = 0.18;
    ctx.beginPath();
    for (let x = minX - (maxY - minY); x <= maxX; x += 22) {
      ctx.moveTo(x, maxY); ctx.lineTo(x + (maxY - minY), minY);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Подпись у верхней кромки (по экрану).
    const top = P.reduce((a, p) => (p.y < a.y ? p : a), P[0]);
    const cx = P.reduce((s, p) => s + p.x, 0) / P.length;
    const cy = P.reduce((s, p) => s + p.y, 0) / P.length;
    const wpx = Math.max(...P.map((p) => p.x)) - Math.min(...P.map((p) => p.x));
    let label = null;
    if (wpx > 70) {
      const source = slabOpeningSourceLevel(project, project.activeLevel, o);
      const text = `Проём${source ? ` · виден «${source.name}»` : ' в перекрытии'}`;
      const size = o.outline?.length
        ? `${(slabOpeningArea(o) / 1e6).toFixed(2).replace('.', ',')} м² · ${P.length} вершин`
        : `${Math.round(o.w)} × ${Math.round(o.h)}`;
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
    const rec = { id: o.id, auto: o.auto, polygon: Boolean(o.outline?.length), P, label, handles: null };
    if (selected && !print) {
      rec.handles = o.outline?.length
        ? [
          ...polygon.map((p, i) => ({ id: `v:${i}`, kind: 'vertex', ...p })),
          ...midpointHandles(polygon),
        ].map((h) => ({ ...h, s: p2s(h.x, h.y) }))
        : slabHandlePoints(o).map((h) => ({ ...h, kind: 'rect', s: p2s(h.x, h.y) }));
      for (const h of rec.handles) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (h.kind === 'midpoint' || (h.kind === 'rect' && h.id.length === 1)) {
          const size = h.kind === 'midpoint' ? SLAB_HANDLE - 2 : SLAB_HANDLE;
          ctx.rect(h.s.x - size / 2, h.s.y - size / 2, size, size);
        } else ctx.arc(h.s.x, h.s.y, SLAB_HANDLE / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (h.kind === 'midpoint') {
          ctx.beginPath();
          ctx.moveTo(h.s.x - 2, h.s.y); ctx.lineTo(h.s.x + 2, h.s.y);
          ctx.moveTo(h.s.x, h.s.y - 2); ctx.lineTo(h.s.x, h.s.y + 2);
          ctx.stroke();
        }
      }
    }
    st._slabUI.push(rec);
  }
  // Подпись при перетаскивании ручки (ui/slab-ui.js).
  const lab = st.slabLabel;
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

// Черновик инструмента: произвольный контур по точкам.
export function drawSlabOpeningDraft(ctx, { st = state, p2s, tokens }) {
  const tool = st.tool;
  if (tool?.kind !== 'slab-opening' || (!tool.points.length && !tool.cursor)) return;
  const points = [...tool.points, ...(tool.cursor ? [tool.cursor] : [])].map((p) => p2s(p.x, p.y));
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = tokens.accent;
  ctx.fillStyle = 'rgba(31, 117, 255, 0.08)';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (tool.snapStart && tool.points.length >= 3) ctx.closePath();
  if (tool.points.length >= 3) { ctx.closePath(); ctx.fill(); }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of tool.points) {
    ctx.beginPath(); ctx.arc(p2s(p.x, p.y).x, p2s(p.x, p.y).y, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (tool.points.length) {
    const first = p2s(tool.points[0].x, tool.points[0].y);
    ctx.strokeStyle = tool.snapStart ? tokens.accent2 : tokens.accent;
    ctx.lineWidth = tool.snapStart ? 2.4 : 1.2;
    ctx.beginPath(); ctx.arc(first.x, first.y, tool.snapStart ? 10 : 7, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

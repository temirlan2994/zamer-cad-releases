// Рисование координационных осей на плане этажа (экранные координаты):
// тонкий штрихпунктир цвета акцента, кружки с марками на обоих концах,
// размерная цепочка между осями (по настройке), призрак инструмента «Ось»,
// подсветка оси, к которой сработала привязка. На листах планов (печать) —
// тёмной линией, по настройке «Оси на листах». Лёгкий модуль (render.js):
// только core и state. Логика — ui/grids.js, настройки — ui/plan-grids.js.

import { GRID_OVERHANG, gridExtent, gridSegment, houseBox, nextGridLabel, visibleGrids } from '../core/grid-axes.js';
import { planGridPref } from './plan-grids.js';

export const GRID_HEAD_R = 14; // px — радиус кружка марки (≈ Ø 8 мм на листе)
const CHAIN_OFF = 1200; // мм — цепочка размеров от габарита дома (не ближе)
const DIMS_OFF = 850; // мм — пояс наружных размеров дома (render.js)
const DASH = [14, 4, 2, 4];

function unit(A, B) {
  const l = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  return { x: (B.x - A.x) / l, y: (B.y - A.y) / l };
}

function head(ctx, c, label, { color, fill, width }) {
  ctx.setLineDash([]);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(c.x, c.y, GRID_HEAD_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `600 ${label.length > 2 ? 10 : 12}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, c.x, c.y + 0.5);
}

// Одна ось: линия и кружки. → запись для хит-теста или null.
function drawGrid(ctx, project, g, p2s, style) {
  const seg = gridSegment(project, g);
  const A = p2s(seg.a.x, seg.a.y); const B = p2s(seg.b.x, seg.b.y);
  if (Math.hypot(B.x - A.x, B.y - A.y) < 2) return null;
  const u = unit(A, B);
  const cA = { x: A.x - u.x * GRID_HEAD_R, y: A.y - u.y * GRID_HEAD_R };
  const cB = { x: B.x + u.x * GRID_HEAD_R, y: B.y + u.y * GRID_HEAD_R };
  ctx.save();
  ctx.globalAlpha = style.lineAlpha;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(DASH);
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  ctx.globalAlpha = style.headAlpha;
  head(ctx, cA, g.label, { color: style.color, fill: style.fill, width: style.headWidth });
  head(ctx, cB, g.label, { color: style.color, fill: style.fill, width: style.headWidth });
  ctx.restore();
  return { id: g.id, kind: g.kind, A, B, heads: [{ ...cA, end: 'from' }, { ...cB, end: 'to' }] };
}

// Размерная линия с засечками 45° и подписью посередине (экран).
function dimLine(ctx, p, q, label, n) {
  const u = unit(p, q);
  const s = 5;
  const tx = (u.x + n.x) * s * 0.7; const ty = (u.y + n.y) * s * 0.7;
  ctx.beginPath();
  ctx.moveTo(p.x - u.x * s, p.y - u.y * s); ctx.lineTo(q.x + u.x * s, q.y + u.y * s);
  for (const c of [p, q]) { ctx.moveTo(c.x - tx, c.y - ty); ctx.lineTo(c.x + tx, c.y + ty); }
  ctx.stroke();
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (len < 26) return false;
  let ang = Math.atan2(q.y - p.y, q.x - p.x);
  if (ang >= Math.PI / 2 - 1e-9) ang -= Math.PI;
  if (ang < -Math.PI / 2 - 1e-9) ang += Math.PI;
  ctx.save();
  ctx.translate((p.x + q.x) / 2 + n.x * 9, (p.y + q.y) / 2 + n.y * 9);
  ctx.rotate(ang);
  ctx.fillText(label, 0, 0);
  ctx.restore();
  return true;
}

// Цепочки размеров между осями: вертикальных — над домом, горизонтальных —
// слева от дома (между наружными размерами и кружками марок). → число размеров.
function drawChains(ctx, project, grids, p2s, color) {
  const box = houseBox(project);
  let count = 0;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const o = p2s(0, 0); const o1 = p2s(1000, 0);
  const k = Math.hypot(o1.x - o.x, o1.y - o.y) / 1000; // px на мм
  // Вынос цепочки: за наружными размерами дома (850 мм + засечки и подписи),
  // но до кружков марок; не помещается (мелкий масштаб) — за кружками.
  let off = Math.max(DIMS_OFF * k + 13 + 26, CHAIN_OFF * k);
  if (off > GRID_OVERHANG * k - 6) off = GRID_OVERHANG * k + 2 * GRID_HEAD_R + 16;
  for (const kind of ['x', 'y']) {
    const list = grids.filter((g) => g.kind === kind).sort((a, b) => a.at - b.at);
    if (list.length < 2) continue;
    const e = gridExtent(project, list[0]);
    const edge = box ? (kind === 'x' ? box.minY : box.minX) : e.from + GRID_OVERHANG;
    const base = (v) => (kind === 'x' ? p2s(v, edge) : p2s(edge, v));
    const n = unit(base(list[0].at), kind === 'x' ? p2s(list[0].at, edge - 1000) : p2s(edge - 1000, list[0].at));
    const pt = (v) => { const b = base(v); return { x: b.x + n.x * off, y: b.y + n.y * off }; };
    for (let i = 0; i + 1 < list.length; i += 1) {
      const d = Math.round(list[i + 1].at - list[i].at);
      if (d < 1) continue;
      dimLine(ctx, pt(list[i].at), pt(list[i + 1].at), String(d), n);
      count += 1;
    }
  }
  ctx.restore();
  return count;
}

// Оси, к которым сейчас сработала привязка (магнит комнат, инструмент «Стена»).
function snappedIds(st, grids) {
  const ids = new Set((st.guides || []).map((g) => g.gridId).filter(Boolean));
  const t = st.tool;
  if (t?.kind === 'wall') {
    for (const g of grids) {
      if ((g.kind === 'x' && t.snapX === g.at) || (g.kind === 'y' && t.snapY === g.at)) ids.add(g.id);
    }
  }
  return ids;
}

// Все оси проекта на плане. ctx — в экранных px (transform = dpr).
// st — состояние (на листах — печатное); print — лист плана.
export function drawPlanGrids(ctx, { st, p2s, tokens, print = false }) {
  const pref = planGridPref();
  const project = st.project;
  st._gridUI = [];
  st.planGridsDrawn = 0;
  st.planGridDims = 0;
  const tool = !print && st.tool?.kind === 'grid' ? st.tool : null;
  if (print ? !pref.sheets : (!pref.on && !tool)) return;
  const grids = visibleGrids(project?.grids);
  const sel = !print && st.selection?.type === 'grid' ? st.selection.id : null;
  const hov = !print && st.hover?.type === 'grid' ? st.hover.id : null;
  const snapped = print ? new Set() : snappedIds(st, grids);
  const ink = print ? (tokens.line || '#26313d') : tokens.accent;
  const fill = print ? '#ffffff' : (tokens.surface || '#ffffff');
  const ui = [];
  if (pref.on || print) {
    for (const g of grids) {
      const on = g.id === sel || snapped.has(g.id);
      const style = {
        color: g.id === hov && !on ? tokens.hover : ink,
        fill,
        lineAlpha: print ? 0.9 : (on ? 0.95 : 0.6),
        headAlpha: print ? 1 : (on ? 1 : 0.85),
        lineWidth: on ? 2 : (print ? 0.8 : 1),
        headWidth: on ? 2 : (print ? 1 : 1.3),
      };
      const r = drawGrid(ctx, project, g, p2s, style);
      if (r) ui.push(r);
    }
    if (pref.dims) st.planGridDims = drawChains(ctx, project, grids, p2s, print ? ink : (tokens.muted || ink));
  }
  st._gridUI = ui;
  st.planGridsDrawn = ui.length;
  if (tool?.cursor) {
    const at = tool.gkind === 'x' ? tool.cursor.x : tool.cursor.y;
    const ghost = { id: '__ghost__', kind: tool.gkind, at, label: nextGridLabel(project?.grids || [], tool.gkind) };
    drawGrid(ctx, { ...project, grids: [...grids, ghost] }, ghost, p2s, {
      color: tokens.accent, fill, lineAlpha: 1, headAlpha: 1, lineWidth: 1.6, headWidth: 1.8,
    });
  }
}

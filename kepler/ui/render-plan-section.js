// Рисование линий разрезов на плане этажа (экранные координаты): жирный
// штрихпунктир, «головки» с номером и стрелкой взгляда, подпись; на других
// этажах — тонкая бледная линия; ручки выбранного; черновик инструмента
// «Разрез». Лёгкий модуль (render.js): только core и state. Логика —
// ui/plan-section.js.

import { sectionFrame } from '../core/section.js';
import { sectionMark, sectionViews } from '../core/views.js';
import { state } from './state.js';

export const HEAD_R = 11; // px — радиус «головки»

function screenVec(p2s, from, to) {
  const A = p2s(from.x, from.y); const B = p2s(to.x, to.y);
  const l = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  return { x: (B.x - A.x) / l, y: (B.y - A.y) / l };
}

// Одна линия разреза: штрихпунктир, «головки» на концах, стрелки взгляда.
function drawMark(ctx, view, { p2s, tokens, color, bold, selected }) {
  const fr = sectionFrame(view);
  if (!fr) return null;
  const A = p2s(fr.a.x, fr.a.y); const B = p2s(fr.b.x, fr.b.y);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (!bold) {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 4, 2, 4]);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.restore();
    return { id: view.id, A, B, bold: false };
  }
  const ld = { x: B.x - A.x, y: B.y - A.y };
  const ll = Math.hypot(ld.x, ld.y) || 1;
  const u = { x: ld.x / ll, y: ld.y / ll };
  const vs = screenVec(p2s, fr.a, { x: fr.a.x + fr.view.x * 1000, y: fr.a.y + fr.view.y * 1000 });
  ctx.lineWidth = selected ? 2.6 : 2.2;
  ctx.setLineDash([16, 4, 3, 4]);
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  ctx.setLineDash([]);
  const mark = sectionMark(view);
  const heads = [];
  for (const [P, s] of [[A, -1], [B, 1]]) {
    const c = { x: P.x + u.x * s * (HEAD_R + 4), y: P.y + u.y * s * (HEAD_R + 4) };
    heads.push(c);
    // Стрелка взгляда — треугольник от головки в сторону взгляда.
    const tip = { x: c.x + vs.x * (HEAD_R + 11), y: c.y + vs.y * (HEAD_R + 11) };
    const base = { x: c.x + vs.x * (HEAD_R - 2), y: c.y + vs.y * (HEAD_R - 2) };
    const w = 7;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(base.x - vs.y * w, base.y + vs.x * w);
    ctx.lineTo(base.x + vs.y * w, base.y - vs.x * w);
    ctx.closePath();
    ctx.fill();
    // Короткий жирный штрих на конце линии.
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(c.x - u.x * s * HEAD_R, c.y - u.y * s * HEAD_R); ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(c.x, c.y, HEAD_R, 0, Math.PI * 2);
    ctx.fillStyle = tokens.surface || '#ffffff';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mark, c.x, c.y + 0.5);
  }
  // Подпись — за головкой начала, по продолжению линии наружу.
  const out = { x: -u.x, y: -u.y };
  const horiz = Math.abs(out.x) >= Math.abs(out.y);
  const lp = horiz
    ? { x: heads[0].x + out.x * (HEAD_R + 6), y: heads[0].y }
    : { x: heads[0].x, y: heads[0].y + out.y * (HEAD_R + 12) };
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = horiz ? (out.x > 0 ? 'left' : 'right') : 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = tokens.canvas || '#ffffff';
  ctx.strokeText(view.name, lp.x, lp.y);
  ctx.fillText(view.name, lp.x, lp.y);
  ctx.restore();
  return { id: view.id, A, B, M: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, heads, bold: true };
}

function handleSquare(ctx, p, tokens) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = tokens.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9);
  ctx.fill();
  ctx.stroke();
}

// Все разрезы проекта на плане (экранные координаты): на своём этаже —
// жирно с головками, на других — тонкой бледной линией. Черновик инструмента.
export function drawPlanSections(ctx, { p2s, tokens }) {
  const ui = [];
  const level = state.project.activeLevel;
  const sel = state.selection?.type === 'section' ? state.selection.id : null;
  const hov = state.hover?.type === 'section' ? state.hover.id : null;
  for (const v of sectionViews(state.project)) {
    const bold = !v.levelId || v.levelId === level;
    const color = v.id === sel ? tokens.accent : v.id === hov ? tokens.hover : (tokens.text || '#18202b');
    const r = drawMark(ctx, v, { p2s, tokens, color, bold, selected: v.id === sel });
    if (!r) continue;
    ui.push(r);
    if (bold && v.id === sel && !state.tool) {
      handleSquare(ctx, r.A, tokens);
      handleSquare(ctx, r.B, tokens);
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(r.M.x, r.M.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  state._planSecUI = ui;
  state.planSectionsDrawn = ui.map((r) => ({ id: r.id, bold: r.bold }));
  const t = state.tool;
  if (t?.kind === 'psec' && t.points.length) {
    if (t.points.length === 1 && t.cursor) {
      const A = p2s(t.points[0].x, t.points[0].y); const B = p2s(t.cursor.x, t.cursor.y);
      ctx.save();
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([16, 4, 3, 4]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.restore();
    } else if (t.points.length === 2) {
      drawMark(ctx, { id: '__draft__', name: 'Разрез', line: { a: t.points[0], b: t.points[1] }, side: t.side }, {
        p2s, tokens, color: tokens.accent, bold: true, selected: false,
      });
    }
  }
}

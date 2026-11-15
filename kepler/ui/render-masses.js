// Рисование масс на плане (core/masses.js, ui/plan-masses.js): эскиз —
// объединённый контур масс активного этажа штрихпунктиром акцентного цвета с
// очень лёгкой заливкой, под комнатами и стенами; выбранная масса — её
// основание жирнее; инструмент «Масса» на плане — призрак основания с
// размерами. Всё — в экранных координатах (p2s — оси дома → экран, CSS px).

import { allMasses, massBox } from '../core/masses.js';
import { activeMassSketch, planMassPref } from './plan-masses.js';
import { state } from './state.js';

const fmt = (mm) => `${Math.round(mm)}`;

function ringPath(ctx, ring, p2s) {
  ring.forEach((p, i) => {
    const s = p2s(p.x, p.y);
    if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
}

function rectPath(ctx, b, p2s) {
  ringPath(ctx, [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }], p2s);
}

// Эскиз под домом. → число нарисованных оснований (для автотестов).
export function drawMassSketch(ctx, { p2s, tokens }) {
  const pref = planMassPref();
  state._planMasses = 0;
  if (!pref.on || state.modeName !== 'plan') return 0;
  const sketch = activeMassSketch();
  if (!sketch) return 0;
  const accent = tokens.accent || '#2f6fd6';
  ctx.save();
  ctx.beginPath();
  for (const poly of sketch.outline) for (const ring of poly) ringPath(ctx, ring, p2s);
  if (!pref.outlineOnly) {
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = accent;
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([10, 4, 2, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Вычитающие боксы — отдельным оранжевым каркасом: даже когда они целиком
  // внутри массы, пользователь видит, что именно будет удалено.
  if (sketch.voidRects?.length) {
    ctx.strokeStyle = '#ef6c32';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const r of sketch.voidRects) { ctx.beginPath(); rectPath(ctx, r, p2s); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  // Подписи — имя массы у её верхнего левого угла (без шума: только если
  // масс несколько или масса крупная на экране).
  if (!pref.outlineOnly) {
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = accent;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (const r of sketch.rects) {
      const a = p2s(r.x0, r.y0);
      const b = p2s(r.x1, r.y1);
      if (Math.abs(b.x - a.x) < 70 || Math.abs(b.y - a.y) < 26) continue;
      const pts = [p2s(r.x0, r.y0), p2s(r.x1, r.y0), p2s(r.x0, r.y1), p2s(r.x1, r.y1)];
      const tl = pts.reduce((m, p) => (p.y + p.x * 0.01 < m.y + m.x * 0.01 ? p : m));
      ctx.fillText(r.name, tl.x + 6, tl.y + 5);
    }
  }
  ctx.restore();
  state._planMasses = sketch.rects.length + (sketch.voidRects?.length || 0);
  return state._planMasses;
}

function label(ctx, text, s, tokens) {
  ctx.font = '600 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = tokens.surface || '#ffffff';
  ctx.globalAlpha = 0.92;
  ctx.fillRect(s.x - w / 2, s.y - 10, w, 20);
  ctx.globalAlpha = 1;
  ctx.fillStyle = tokens.accent || '#2f6fd6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s.x, s.y);
  ctx.textAlign = 'left';
}

// Поверх плана: выбранная масса и призрак инструмента «Масса».
export function drawMassOverlay(ctx, { p2s, tokens }) {
  if (state.modeName !== 'plan') return;
  const accent = tokens.accent || '#2f6fd6';
  const sel = state.selection?.type === 'mass' ? allMasses(state.project).find((m) => m.id === state.selection.id) : null;
  ctx.save();
  if (sel) {
    ctx.beginPath();
    rectPath(ctx, massBox(sel), p2s);
    ctx.strokeStyle = sel.id.startsWith('void-') ? '#ef6c32' : accent;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([10, 4, 2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const t = state.tool;
  if (t?.kind === 'mass' && t.cursor) {
    const toolColor = t.void ? '#ef6c32' : accent;
    if (t.a) {
      const b = { x0: Math.min(t.a.x, t.cursor.x), y0: Math.min(t.a.y, t.cursor.y), x1: Math.max(t.a.x, t.cursor.x), y1: Math.max(t.a.y, t.cursor.y) };
      ctx.beginPath();
      rectPath(ctx, b, p2s);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = toolColor;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = toolColor;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, `${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} мм`, p2s((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), tokens);
    }
    const c = p2s(t.cursor.x, t.cursor.y);
    ctx.strokeStyle = toolColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x - 7, c.y); ctx.lineTo(c.x + 7, c.y);
    ctx.moveTo(c.x, c.y - 7); ctx.lineTo(c.x, c.y + 7);
    ctx.stroke();
  }
  ctx.restore();
}

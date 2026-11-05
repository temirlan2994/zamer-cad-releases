// Линии разрезов на плане «Ландшафта» (экранные координаты): штрихпунктир
// по ломаной, толстые штрихи на концах, стрелки в сторону взгляда, буквы
// «А … А»; черновик инструмента «Разрез» — пунктир с точками.

import { sectionPlanMarks } from '../core/landscape-section.js';

const TAU = Math.PI * 2;

export function drawSectionMarks(ctx, sections, { w2s, tokens, scale, activeId = null, hoverId = null }) {
  const color = tokens.danger || '#c0392b';
  for (const sec of sections || []) {
    // Размер стрелки — постоянный на экране (~26 px).
    const m = sectionPlanMarks(sec, 26 / Math.max(scale, 1e-6));
    if (!m) continue;
    const hot = sec.id === activeId || sec.id === hoverId;
    const P = m.points.map((p) => w2s(p.x, p.y));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = hot ? 1 : 0.85;
    ctx.lineWidth = hot ? 1.6 : 1.1;
    ctx.setLineDash([14, 4, 2, 4]);
    ctx.beginPath();
    P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    for (const e of m.ends) {
      const a = w2s(e.stroke[0].x, e.stroke[0].y);
      const b = w2s(e.stroke[1].x, e.stroke[1].y);
      ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const t = w2s(e.tail.x, e.tail.y);
      const tip = w2s(e.tip.x, e.tip.y);
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      const ang = Math.atan2(tip.y - t.y, tip.x - t.x);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(ang - 0.4) * 9, tip.y - Math.sin(ang - 0.4) * 9);
      ctx.lineTo(tip.x - Math.cos(ang + 0.4) * 9, tip.y - Math.sin(ang + 0.4) * 9);
      ctx.closePath(); ctx.fill();
      const tx = w2s(e.text.x, e.text.y);
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = tokens.surface || '#fff';
      ctx.strokeText(m.name, tx.x, tx.y);
      ctx.fillText(m.name, tx.x, tx.y);
      ctx.strokeStyle = color;
    }
    ctx.restore();
  }
}

export function drawSectionDraft(ctx, tool, { w2s, tokens }) {
  const color = tokens.danger || '#c0392b';
  const pts = [...(tool.points || []), ...(tool.cursor ? [tool.cursor] : [])].map((p) => w2s(p.x, p.y));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([10, 5]);
  if (pts.length >= 2) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of pts.slice(0, tool.points.length)) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// Ближайший разрез под точкой экрана (по ломаной, tol — px) или null.
export function hitSection(sections, screen, w2s, tol = 6) {
  let best = null;
  for (const s of sections || []) {
    const P = s.points.map((p) => w2s(p.x, p.y));
    for (let i = 0; i < P.length - 1; i += 1) {
      const a = P[i]; const b = P[i + 1];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + dx * t - screen.x, a.y + dy * t - screen.y);
      if (d <= tol && (!best || d < best.d)) best = { d, section: s };
    }
  }
  return best?.section || null;
}

// Ручки открытого разреза (экран): вершины, «+» в серединах звеньев и
// переключатели стороны взгляда на концах стрелок.
export function sectionHandlePoints(sec, w2s, scale) {
  const P = (sec?.points || []).map((p) => w2s(p.x, p.y));
  const vertices = P.map((p, index) => ({ x: p.x, y: p.y, index }));
  const mids = [];
  for (let i = 0; i < P.length - 1; i += 1) {
    if (Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y) < 28) continue; // короткое звено — без «+»
    mids.push({ x: (P[i].x + P[i + 1].x) / 2, y: (P[i].y + P[i + 1].y) / 2, index: i });
  }
  // Переключатель — с обратной стороны от первой стрелки: «смотреть туда».
  const size = 26 / Math.max(scale, 1e-6);
  const m = sec ? sectionPlanMarks(sec, size) : null;
  const flips = (m?.ends || []).slice(0, 1).map((e) => w2s(e.at.x - e.dir.x * size * 0.8, e.at.y - e.dir.y * size * 0.8));
  return { vertices, mids, flips };
}

// Ручка под точкой экрана: { mode: 'vertex' | 'mid' | 'flip', index } или null.
export function hitSectionHandle(sec, screen, w2s, scale, tol = 9) {
  if (!sec) return null;
  const { vertices, mids, flips } = sectionHandlePoints(sec, w2s, scale);
  let best = null;
  for (const v of vertices) {
    const d = Math.hypot(v.x - screen.x, v.y - screen.y);
    if (Math.abs(v.x - screen.x) <= tol && Math.abs(v.y - screen.y) <= tol && (!best || d < best.d)) best = { d, index: v.index };
  }
  if (best) return { mode: 'vertex', index: best.index };
  for (const f of flips) {
    if (Math.hypot(f.x - screen.x, f.y - screen.y) <= tol + 2) return { mode: 'flip', index: 0 };
  }
  for (const m of mids) {
    if (Math.hypot(m.x - screen.x, m.y - screen.y) <= tol - 2) return { mode: 'mid', index: m.index };
  }
  return null;
}

export function drawSectionHandles(ctx, sec, { w2s, tokens, scale, vertex = -1 }) {
  const color = tokens.danger || '#c0392b';
  const { vertices, mids, flips } = sectionHandlePoints(sec, w2s, scale);
  ctx.save();
  ctx.lineWidth = 1.4;
  for (const v of vertices) {
    ctx.fillStyle = v.index === vertex ? color : (tokens.surface || '#fff');
    ctx.strokeStyle = color;
    ctx.fillRect(v.x - 4.5, v.y - 4.5, 9, 9);
    ctx.strokeRect(v.x - 4.5, v.y - 4.5, 9, 9);
  }
  for (const m of mids) {
    ctx.fillStyle = tokens.surface || '#fff';
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.x - 2.6, m.y); ctx.lineTo(m.x + 2.6, m.y);
    ctx.moveTo(m.x, m.y - 2.6); ctx.lineTo(m.x, m.y + 2.6);
    ctx.stroke();
  }
  // Переключатель стороны взгляда: кружок с двойной стрелкой на остриях.
  for (const f of flips) {
    ctx.fillStyle = tokens.surface || '#fff';
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(f.x, f.y, 7, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⇄', f.x, f.y + 0.5);
  }
  ctx.restore();
}

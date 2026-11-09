// Замки «стена — координационная ось» на плане (как в Revit): у выделенной
// стены (или у стен выделенной комнаты), лежащей на оси (±5 мм), рисуется
// значок замка на оси возле стены — открытый (просто рядом) или закрытый
// (прикреплена: core/grid-pins.js). Клик по замку — ui/grid-pin-ui.js.
// Лёгкий модуль (его читает render.js): только core и state.

import { wallLocks } from '../core/grid-pins.js';
import { activeGrids, planGridPref } from './plan-grids.js';

export const LOCK_R = 10; // px — радиус кружка значка
const GAP = 13; // px — от края тела стены до центра значка

function locksFor(st) {
  if (st.modeName && st.modeName !== 'plan') return [];
  if (!planGridPref().on || st.tool) return [];
  const sel = st.selection;
  const walls = st.walls || [];
  let list = [];
  if (sel?.type === 'wall') {
    const w = walls.find((x) => x.key === sel.key && (sel.from === undefined || Math.abs(x.from - sel.from) < 1));
    if (w) list = [w];
  } else if (sel?.type === 'room') {
    list = walls.filter((w) => (w.kind === 'own' || w.kind === 'shared') && w.rooms?.includes(sel.id));
  }
  if (!list.length) return [];
  const grids = activeGrids(st.project);
  if (!grids.length) return [];
  const out = [];
  const seen = new Set();
  for (const w of list) {
    for (const l of wallLocks(st.project, w, grids)) {
      const key = `${l.gridId}|${l.part}|${w.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const g = grids.find((x) => x.id === l.gridId);
      out.push({ ...l, orient: w.orient, wallKey: w.key, wallFrom: w.kind === 'manual' ? undefined : w.from, label: g?.label || '' });
    }
  }
  return out;
}

// Висячий замок: дужка и корпус (closed — дужка опущена в корпус).
function padlock(ctx, c, { closed, ink, paper }) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(c.x, c.y, LOCK_R, 0, Math.PI * 2);
  ctx.fillStyle = closed ? ink : paper;
  ctx.globalAlpha = 1;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = ink;
  ctx.globalAlpha = closed ? 1 : 0.75;
  ctx.stroke();
  const glyph = closed ? paper : ink;
  ctx.strokeStyle = glyph;
  ctx.fillStyle = glyph;
  ctx.lineWidth = 1.6;
  // Дужка: у открытого приподнята и сдвинута влево (правая нога снаружи).
  const sx = closed ? c.x : c.x - 1.6;
  const top = closed ? c.y - 1 : c.y - 2.6;
  ctx.beginPath();
  ctx.moveTo(sx - 2.7, closed ? c.y + 0.5 : c.y);
  ctx.lineTo(sx - 2.7, top);
  ctx.arc(sx, top, 2.7, Math.PI, 0);
  ctx.lineTo(sx + 2.7, closed ? c.y + 0.5 : top + 1.2);
  ctx.stroke();
  // Корпус.
  ctx.beginPath();
  ctx.rect(c.x - 4.2, c.y - 0.2, 8.4, 6);
  ctx.fill();
  ctx.restore();
}

// Подпись оси при магните стены (жест 'wall'): «Ось 3» у курсора.
function snapTag(ctx, st, p2s, tokens) {
  const t = st.gridSnapTag;
  if (!t) return;
  const p = p2s(t.x, t.y);
  ctx.save();
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(t.text).width + 12;
  const x = p.x + 14; const y = p.y - 26;
  ctx.fillStyle = tokens.accent;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, 18, 9); else ctx.rect(x, y, w, 18);
  ctx.fill();
  ctx.fillStyle = tokens.surface || '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.text, x + 6, y + 9.5);
  ctx.restore();
}

// Значки замков (экран, ctx в px). → st._gridLocks для хит-теста.
export function drawGridLocks(ctx, { st, p2s, tokens }) {
  st._gridLocks = [];
  snapTag(ctx, st, p2s, tokens);
  const locks = locksFor(st);
  if (!locks.length) return;
  const o = p2s(0, 0); const o1 = p2s(1000, 0);
  const k = Math.hypot(o1.x - o.x, o1.y - o.y) / 1000; // px на мм
  const ink = tokens.accent;
  const paper = tokens.surface || '#ffffff';
  for (const l of locks) {
    const P = p2s(l.at.x, l.at.y);
    // Направление отступа: поперёк стены (линия) или вдоль наружу (торец).
    const n = l.part === 'line'
      ? (l.orient === 'h' ? { x: 0, y: l.side } : { x: l.side, y: 0 })
      : (l.orient === 'h' ? { x: l.side, y: 0 } : { x: 0, y: l.side });
    const Q = p2s(l.at.x + n.x * 1000, l.at.y + n.y * 1000);
    const len = Math.hypot(Q.x - P.x, Q.y - P.y) || 1;
    const u = { x: (Q.x - P.x) / len, y: (Q.y - P.y) / len };
    const off = (l.part === 'line' ? l.clear * k : 0) + GAP;
    const c = { x: P.x + u.x * off, y: P.y + u.y * off };
    padlock(ctx, c, { closed: l.closed, ink, paper });
    st._gridLocks.push({ ...l, x: c.x, y: c.y, r: LOCK_R });
  }
}

// Замок под точкой экрана или null.
export function hitGridLock(st, screen) {
  const tol = st.coarsePointer ? 6 : 3;
  let best = null;
  for (const l of st._gridLocks || []) {
    const d = Math.hypot(l.x - screen.x, l.y - screen.y);
    if (d <= l.r + tol && (!best || d < best.d)) best = { d, l };
  }
  return best?.l || null;
}

export const lockTitle = (l) => (l.closed ? `Открепить от оси ${l.label}` : `Прикрепить стену к оси ${l.label}`);

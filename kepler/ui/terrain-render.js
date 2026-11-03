// Отрисовка рельефа на плане участка: закраска высот, горизонтали (каждая
// 5-я толще), точки-отметки и подписи без наложений. Вызывается из render.js.
// Геометрия — в координатах съёмки (мир), подписи — в экранных пикселях.

import { contours, formatElevation, terrainModel } from '../core/terrain.js';

const CONTOUR = '#9a6a33';
const POINT = '#7a4a1c';

// Гипсометрическая шкала: низ — зелёный, середина — жёлтый, верх — коричневый.
const HYPSO = [[0x6f, 0xb2, 0x6a], [0xe6, 0xd8, 0x7a], [0xb0, 0x73, 0x3e]];
function hypso(t) {
  const x = Math.max(0, Math.min(1, t)) * (HYPSO.length - 1);
  const i = Math.min(HYPSO.length - 2, Math.floor(x));
  const f = x - i;
  const c = HYPSO[i].map((v, k) => Math.round(v + (HYPSO[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Слой под объектами участка (мировые координаты, transform уже задан).
export function drawTerrainUnder(ctx, state, site, px) {
  const terrain = site?.terrain;
  if (!terrain?.points?.length) return;
  const model = terrainModel(terrain);
  if (!model.tris.length) return;
  const show = terrain.show || {};
  const inSite = state.modeName === 'site';
  if (show.shade && inSite) drawShade(ctx, model, px);
  if (show.contours) {
    ctx.save();
    ctx.strokeStyle = CONTOUR;
    ctx.lineJoin = 'round';
    for (const level of contours(model, terrain.contourStep)) {
      ctx.globalAlpha = (inSite ? 1 : 0.45) * (level.major ? 0.85 : 0.5);
      ctx.lineWidth = px(level.major ? 1.6 : 0.8);
      for (const line of level.lines) {
        ctx.beginPath();
        line.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (line.closed) ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// Закраска высот: треугольники рисуются непрозрачно на отдельном слое (без
// швов между ними) и накладываются одним полупрозрачным изображением.
let shadeLayer = null;
function drawShade(ctx, model, px) {
  const { width, height } = ctx.canvas;
  if (!shadeLayer) shadeLayer = document.createElement('canvas');
  if (shadeLayer.width !== width || shadeLayer.height !== height) { shadeLayer.width = width; shadeLayer.height = height; }
  const lc = shadeLayer.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, width, height);
  lc.setTransform(ctx.getTransform());
  const range = (model.maxZ - model.minZ) || 1;
  lc.lineWidth = px(0.8);
  lc.lineJoin = 'round';
  for (const tri of model.tris) {
    const [a, b, c] = tri.map((k) => model.pts[k]);
    const color = hypso(((a.z + b.z + c.z) / 3 - model.minZ) / range);
    lc.fillStyle = color;
    lc.strokeStyle = color; // штрих того же цвета закрывает щели антиалиасинга
    lc.beginPath();
    lc.moveTo(a.x, a.y); lc.lineTo(b.x, b.y); lc.lineTo(c.x, c.y); lc.closePath();
    lc.fill();
    lc.stroke();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.28;
  ctx.drawImage(shadeLayer, 0, 0);
  ctx.restore();
}

// Прямоугольники уже поставленных подписей — чтобы новые на них не наезжали.
function makePlacer() {
  const boxes = [];
  return (box) => {
    for (const b of boxes) {
      if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return false;
    }
    boxes.push(box);
    return true;
  };
}

// Экранный слой: точки, подписи отметок и горизонталей (только «Участок»).
export function drawTerrainLabels(ctx, state, site, w2s, tokens, size) {
  const terrain = site?.terrain;
  if (state.modeName !== 'site') return;
  const edit = state.elevEdit;
  if (edit) {
    const p = w2s(edit.x, edit.y);
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
  }
  if (!terrain?.points?.length) return;
  const show = terrain.show || {};
  const place = makePlacer();
  const onScreen = (p) => p.x > -40 && p.y > -20 && p.x < size.width + 40 && p.y < size.height + 20;
  const sel = state.selection?.type === 'site' && state.selection.kind === 'terrain-point' ? state.selection.id : null;
  const hov = state.hover?.type === 'site-obj' && state.hover.kind === 'terrain-point' ? state.hover.id : null;
  const toolOn = state.tool?.kind === 'terrain';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  // Сначала — выделенная и подсвеченная точки (их подписи важнее).
  const ordered = [...terrain.points].sort((a, b) => Number(b.id === sel || b.id === hov) - Number(a.id === sel || a.id === hov));
  const screenPts = [];
  for (const pt of ordered) {
    const p = w2s(pt.x, pt.y);
    if (!onScreen(p)) continue;
    screenPts.push({ pt, p });
    place({ x: p.x - 4, y: p.y - 4, w: 8, h: 8 }); // сами точки — тоже препятствия
  }
  if (show.points || toolOn) {
    for (const { pt, p } of screenPts) {
      const active = pt.id === sel || pt.id === hov;
      ctx.fillStyle = active ? tokens.accent : POINT;
      ctx.beginPath(); ctx.arc(p.x, p.y, active ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      if (pt.id === sel) {
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  if (show.labels) {
    ctx.textAlign = 'left';
    for (const { pt, p } of screenPts) {
      const text = formatElevation(pt.z);
      const w = ctx.measureText(text).width;
      // Пробуем 4 позиции вокруг точки; не влезло — подпись пропускается.
      const spots = [[6, -6], [6, 14], [-6 - w, -6], [-6 - w, 14]];
      for (const [dx, dy] of spots) {
        const box = { x: p.x + dx - 1, y: p.y + dy - 11, w: w + 2, h: 13 };
        if (!place(box)) continue;
        ctx.fillStyle = tokens.canvas;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = pt.id === sel ? tokens.accent : POINT;
        ctx.fillText(text, p.x + dx, p.y + dy);
        break;
      }
    }
  }
  if (show.labels && show.contours) drawContourLabels(ctx, terrain, w2s, tokens, place, onScreen);
}

function drawContourLabels(ctx, terrain, w2s, tokens, place, onScreen) {
  const model = terrainModel(terrain);
  if (!model.tris.length) return;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const level of contours(model, terrain.contourStep)) {
    const text = formatElevation(level.z);
    const w = ctx.measureText(text).width + 4;
    for (const line of level.lines) {
      const S = line.pts.map((q) => w2s(q.x, q.y));
      let total = 0;
      for (let i = 1; i < S.length; i += 1) total += Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y);
      // Короткие линии без подписи; основные подписываются чаще.
      if (total < (level.major ? 80 : 160)) continue;
      const half = total / 2;
      let acc = 0;
      for (let i = 1; i < S.length; i += 1) {
        const a = S[i - 1]; const b = S[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + seg < half) { acc += seg; continue; }
        const t = seg ? (half - acc) / seg : 0;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (!onScreen(p)) break;
        let ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        const r = Math.max(w, 12) / 2 + 1;
        if (!place({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 })) break;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.fillStyle = tokens.canvas;
        ctx.fillRect(-w / 2, -6, w, 12);
        ctx.fillStyle = CONTOUR;
        ctx.fillText(text, 0, 0);
        ctx.restore();
        break;
      }
    }
  }
  ctx.textBaseline = 'alphabetic';
}

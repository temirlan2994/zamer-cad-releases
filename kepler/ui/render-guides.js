// Экранный слой привязок черчения (core/draw-snap.js): штриховые лучи и
// линии выравнивания, значки привязок как в AutoCAD (конец — квадрат,
// середина — треугольник, пересечение — крест, ближайшая — песочные часы,
// центр — круг, перпендикуляр, параллель), плашка «тип · длина · угол» и
// поле динамического ввода у курсора. Стиль — как у направляющих комнат
// (render.js: accent2, 1 px, штрих 6/6).

const FAR = 4000; // px — луч «до края экрана»

function pill(ctx, text, x0, y, tokens, color, maxRight = Infinity) {
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width + 12;
  const x = Math.max(4, Math.min(x0, maxRight - w - 6));
  ctx.fillStyle = tokens.surface;
  ctx.globalAlpha = 0.94;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y - 13, w, 18, 5); else ctx.rect(x, y - 13, w, 18);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 6, y);
  return w;
}

function marker(ctx, kind, p, color) {
  const r = 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (kind === 'end') {
    ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
  } else if (kind === 'mid') {
    ctx.moveTo(p.x, p.y - r - 1); ctx.lineTo(p.x + r + 1, p.y + r); ctx.lineTo(p.x - r - 1, p.y + r); ctx.closePath();
  } else if (kind === 'int') {
    ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r);
  } else if (kind === 'center') {
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  } else if (kind === 'nearest') {
    ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.lineTo(p.x + r, p.y + r); ctx.closePath();
  } else if (kind === 'perp') {
    ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.lineTo(p.x + r, p.y + r);
    ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x, p.y + r);
  } else if (kind === 'parallel') {
    ctx.moveTo(p.x - r, p.y + 2); ctx.lineTo(p.x - 1, p.y - r); ctx.moveTo(p.x + 1, p.y + r); ctx.lineTo(p.x + r, p.y - 2);
  } else if (kind === 'track') {
    ctx.lineWidth = 1.5;
    ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r);
  } else if (kind === 'source') {
    // Лёгкая подсветка вершины, от которой идёт выравнивание.
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.75;
    ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function guideLine(ctx, g, w2s) {
  const a = w2s(g.from.x, g.from.y);
  const b = w2s(g.to.x, g.to.y);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (g.type === 'seg') {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  if (len < 0.5) return;
  const ux = (b.x - a.x) / len; const uy = (b.y - a.y) / len;
  if (g.type === 'polar' || g.type === 'ortho' || g.type === 'parallel') {
    ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + ux * FAR, a.y + uy * FAR);
  } else if (g.type === 'align') {
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + ux * 60, b.y + uy * 60);
  } else {
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

// Отрезок размера: линия с засечками и подпись посередине.
function gapSegment(ctx, a, b, label, tokens, color, width) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 2) return;
  const nx = -(b.y - a.y) / len * 4; const ny = (b.x - a.x) / len * 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(a.x + nx, a.y + ny);
  ctx.moveTo(b.x - nx, b.y - ny); ctx.lineTo(b.x + nx, b.y + ny);
  ctx.stroke();
  if (label && len > 24) {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pill(ctx, label, m.x + 6, m.y + 4, tokens, color, width);
  }
}

// «Умные направляющие» перемещения объектов (core/guides.js, ui/guides-ui.js):
// штриховые линии выравнивания через цели, крестики на концах, подписи
// расстояния до ближайшего объекта и равных промежутков.
export function drawObjectGuides(ctx, guides, w2s, tokens, width = Infinity) {
  if (!guides?.length) return;
  const color = tokens.accent2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const g of guides) {
    const a = w2s(g.from.x, g.from.y);
    const b = w2s(g.to.x, g.to.y);
    if (g.type === 'gap') { gapSegment(ctx, a, b, g.label, tokens, color, width); continue; }
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.moveTo(p.x - 3, p.y - 3); ctx.lineTo(p.x + 3, p.y + 3); ctx.moveTo(p.x + 3, p.y - 3); ctx.lineTo(p.x - 3, p.y + 3);
      ctx.stroke();
    }
    if (g.gapFrom && g.label) {
      ctx.globalAlpha = 0.85;
      gapSegment(ctx, w2s(g.gapFrom.x, g.gapFrom.y), w2s(g.gapTo.x, g.gapTo.y), g.label, tokens, color, width);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

export function drawSnapOverlay(ctx, state, w2s, tokens, width = Infinity) {
  const snap = state.drawSnap;
  if (!snap?.point) return;
  const color = tokens.accent2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  for (const g of snap.guides || []) guideLine(ctx, g, w2s);
  ctx.setLineDash([]);
  for (const m of snap.markers || []) marker(ctx, m.kind, w2s(m.at.x, m.at.y), color);
  const p = w2s(snap.point.x, snap.point.y);
  const text = [snap.label, snap.tooltip].filter(Boolean).join(' · ');
  let y = p.y + 30;
  if (text) { pill(ctx, text, p.x + 14, y, tokens, color, width); y += 22; }
  const d = state.dynInput;
  if (d) {
    const caret = (f) => (d.field === f ? '▏' : '');
    const units = state.project?.settings?.units === 'm' ? 'м' : 'мм';
    const len = `длина ${d.length || '—'}${caret('length')} ${units}`;
    const ang = `угол ${d.angle || '—'}${caret('angle')}°`;
    pill(ctx, `${len} · ${ang} · Enter, Tab`, p.x + 14, y, tokens, tokens.accent, width);
  }
  ctx.restore();
}

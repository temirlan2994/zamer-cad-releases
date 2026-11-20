// Рисование фасада (core/elevation.js buildElevation) на canvas: заливка по
// типу грани, контур 1 px, линия земли, отметки уровней справа с
// вертикальными размерами, подпись вида «Фасад Север 1:100». Разрез
// (core/section.js buildSection) — то же плюс сечение: тёмная заливка со
// штриховкой и толстый контур, проёмы в разрезанных стенах — пустоты со
// стеклом (окно) или линией перемычки (дверь).
// Вид: sx = ox + u·k, sy = oy − z·k (k — px на мм).

import { fmtMark } from '../core/elevation.js';

const LIGHT = {
  bg: '#fbfcfe', line: '#2b313a', text: '#18202b', muted: '#687486', ground: '#4a5a3a', dim: '#5a6576',
  cut: '#374845', hatch: '#728681', cutLine: '#192525', glass: '#347089', datum: '#d8e0de', soil: '#e6e4dc',
  fill: { wall: '#e9e6e1', window: '#bcd8ef', door: '#c9a07a', slab: '#cdc8bf', roof: '#a9b1bb', stair: '#d6d0c6', plinth: '#b5ab9e', foundation: '#9d9890', other: '#dedbd6' },
};
const DARK = {
  bg: '#0d1118', line: '#cfd8e3', text: '#eef4fb', muted: '#8c9aac', ground: '#9fb68a', dim: '#9aa8ba',
  cut: '#abbab5', hatch: '#82948c', cutLine: '#f2f6fb', glass: '#93bfce', datum: '#344247', soil: '#303631',
  fill: { wall: '#3a4049', window: '#2e5274', door: '#6f5038', slab: '#4b4842', roof: '#5a6474', stair: '#4a4640', plinth: '#55504a', foundation: '#4a4742', other: '#41444a' },
};

// Цвета по фону холста (CSS --canvas): тёмный фон — тёмная палитра.
export function elevationColors(canvasBg = '') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(canvasBg).trim());
  if (!m) return LIGHT;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.4 ? { ...DARK, bg: `#${m[1]}` } : { ...LIGHT, bg: `#${m[1]}` };
}

// Вписать фасад в холст при знаменателе масштаба scale и увеличении zoom
// (1:100 при zoom = 1 — как на бумаге при 96 dpi).
export const PX_PER_MM = 96 / 25.4;
// Не помещается (телефон, 1:50) — уменьшается до размера холста; zoom в ответе.
export function fitElevation(el, cssW, cssH, scale) {
  const b = el.bounds;
  const k0 = PX_PER_MM / scale;
  const ground = el.ground || [];
  const u0 = Math.min(b.u0, ...ground.map((p) => p.u));
  const u1 = Math.max(b.u1, ...ground.map((p) => p.u));
  const z0 = Math.min(b.z0, ...ground.map((p) => p.z));
  const z1 = Math.max(b.z1, ...ground.map((p) => p.z));
  // Поле отметок справа и полоса инструментов снизу.
  const left = cssW < 560 ? 12 : Math.max(28, cssW * 0.06);
  const right = cssW < 560 ? 108 : 152;
  const availableW = Math.max(1, cssW - left - right);
  const availableH = Math.max(1, cssH - 120);
  const k = Math.min(availableW / Math.max(1, u1 - u0), availableH / Math.max(1, z1 - z0), k0 * 4);
  return { k, zoom: k / k0, ox: left + availableW / 2 - (u0 + u1) * k / 2, oy: (cssH - 40) / 2 + (z0 + z1) * k / 2 };
}

// Координаты — по пикселям устройства: соседние грани стыкуются без
// светлых швов сглаживания; линия 1 px — по середине пикселя.
function snapper(view, dpr, line = false) {
  const off = line && Math.round(dpr) % 2 === 1 ? 0.5 : 0;
  return {
    x: (u) => (Math.round((view.ox + u * view.k) * dpr) + off) / dpr,
    y: (z) => (Math.round((view.oy - z * view.k) * dpr) + off) / dpr,
  };
}

function path(ctx, pts, s) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i) ctx.lineTo(s.x(p.u), s.y(p.z)); else ctx.moveTo(s.x(p.u), s.y(p.z));
  });
}

// Отметки уровней: уровни этажей и верх; справа — «+3.000» с треугольником,
// ещё правее — цепочка вертикальных размеров между отметками.
function drawMarks(ctx, el, view, c) {
  const b = el.bounds;
  const marks = el.levels.map((l) => ({ z: l.z, label: l.label, name: l.name }));
  if (b.z1 - (marks.at(-1)?.z ?? 0) > 1) marks.push({ z: b.z1, label: fmtMark(b.z1), name: 'Верх' });
  marks.sort((a, b2) => a.z - b2.z);
  const x0 = view.ox + b.u1 * view.k + 8;
  const xm = x0 + 46;
  const xd = xm + 64;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.dim;
  ctx.fillStyle = c.text;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const m of marks) {
    const y = Math.round(view.oy - m.z * view.k) + 0.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xm + 58, y); ctx.stroke();
    ctx.setLineDash([]);
    // Треугольник отметки — вершиной на линию.
    ctx.beginPath(); ctx.moveTo(xm, y); ctx.lineTo(xm - 5, y - 7); ctx.lineTo(xm + 5, y - 7); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = c.text;
    ctx.fillText(m.label, xm + 8, y - 2);
    ctx.fillStyle = c.muted;
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(m.name, xm + 8, y + 2);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
  }
  // Цепочка размеров.
  if (marks.length > 1) {
    const ys = marks.map((m) => Math.round(view.oy - m.z * view.k) + 0.5);
    ctx.strokeStyle = c.dim;
    ctx.beginPath(); ctx.moveTo(xd + 0.5, ys[0]); ctx.lineTo(xd + 0.5, ys.at(-1)); ctx.stroke();
    for (const y of ys) { ctx.beginPath(); ctx.moveTo(xd - 4, y + 4); ctx.lineTo(xd + 5, y - 5); ctx.stroke(); }
    ctx.fillStyle = c.text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 1; i < marks.length; i += 1) {
      const h = Math.round(marks[i].z - marks[i - 1].z);
      const ym = (ys[i] + ys[i - 1]) / 2;
      if (Math.abs(ys[i] - ys[i - 1]) < 26) continue;
      ctx.save(); ctx.translate(xd - 3, ym); ctx.rotate(-Math.PI / 2); ctx.fillText(String(h), 0, 0); ctx.restore();
    }
  }
  ctx.restore();
}

// Сечение разреза: заливка, штриховка 45° (шаг 6 px), контур 2 px, проёмы.
function drawCuts(ctx, el, view, c, fillS, lineS) {
  if (!el.cuts.length) return;
  ctx.save();
  ctx.beginPath();
  for (const q of el.cuts) {
    q.pts.forEach((p, i) => (i ? ctx.lineTo(fillS.x(p.u), fillS.y(p.z)) : ctx.moveTo(fillS.x(p.u), fillS.y(p.z))));
    ctx.closePath();
  }
  ctx.fillStyle = c.cut;
  ctx.fill();
  ctx.clip();
  const b = el.bounds;
  const x0 = view.ox + b.u0 * view.k - 10; const x1 = view.ox + b.u1 * view.k + 10;
  const y0 = view.oy - b.z1 * view.k - 10; const y1 = view.oy - b.z0 * view.k + 10;
  ctx.strokeStyle = c.hatch;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0 - (y1 - y0); x < x1; x += 6) { ctx.moveTo(x, y1); ctx.lineTo(x + (y1 - y0), y0); }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = c.cutLine;
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (const [p, q] of el.cutEdges || []) { ctx.moveTo(lineS.x(p.u), lineS.y(p.z)); ctx.lineTo(lineS.x(q.u), lineS.y(q.z)); }
  ctx.stroke();
  // Проёмы: окно — стекло посередине (двойная линия), дверь — тонкий контур проёма.
  for (const o of el.openings || []) {
    const xa = lineS.x(o.u0); const xb = lineS.x(o.u1); const ya = lineS.y(o.z1); const yb = lineS.y(o.z0);
    ctx.lineWidth = 1;
    if (o.kind === 'window') {
      ctx.strokeStyle = c.glass;
      const w = xb - xa;
      if (w > 6) {
        const xm = (xa + xb) / 2;
        ctx.beginPath(); ctx.moveTo(xm - 1.5, ya); ctx.lineTo(xm - 1.5, yb); ctx.moveTo(xm + 1.5, ya); ctx.lineTo(xm + 1.5, yb); ctx.stroke();
      } else {
        const ym = (ya + yb) / 2;
        ctx.beginPath(); ctx.moveTo(xa, ym - 1.5); ctx.lineTo(xb, ym - 1.5); ctx.moveTo(xa, ym + 1.5); ctx.lineTo(xb, ym + 1.5); ctx.stroke();
      }
    }
    ctx.strokeStyle = c.line;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// Нарисовать фасад. opts: { view: {k, ox, oy}, colors, marks, title }.
export function drawElevation(ctx, el, { view, colors = LIGHT, marks = true, title = '', presentation = false, dpr = 1 } = {}) {
  const c = colors;
  const fillS = snapper(view, dpr);
  const lineS = snapper(view, dpr, true);
  ctx.save();
  ctx.lineCap = 'square';
  if (presentation && (el.polys.length || el.cuts?.length)) {
    if (marks) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = c.datum;
      for (const level of el.levels) {
        const y = lineS.y(level.z);
        ctx.beginPath(); ctx.moveTo(fillS.x(el.bounds.u0) - 20, y); ctx.lineTo(fillS.x(el.bounds.u1) + 44, y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (el.ground?.length > 1) {
      const grd = el.ground;
      path(ctx, grd, fillS);
      for (let i = grd.length - 1; i >= 0; i -= 1) ctx.lineTo(fillS.x(grd[i].u), fillS.y(grd[i].z) + 8);
      ctx.closePath();
      ctx.fillStyle = c.soil;
      ctx.fill();
    }
  }
  for (const p of el.polys) {
    path(ctx, p.pts, fillS);
    ctx.closePath();
    ctx.fillStyle = p.tint || c.fill[p.kind] || c.fill.other; // tint — материал крыши-плиты
    ctx.fill();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of p.edges) {
      ctx.moveTo(lineS.x(a.u), lineS.y(a.z));
      ctx.lineTo(lineS.x(b.u), lineS.y(b.z));
    }
    ctx.stroke();
  }
  // Земля.
  if (el.ground?.length > 1) {
    ctx.strokeStyle = c.ground;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'butt';
    path(ctx, el.ground, fillS);
    ctx.stroke();
  }
  if (el.cuts) drawCuts(ctx, el, view, c, fillS, lineS);
  if (marks && (el.polys.length || el.cuts?.length)) drawMarks(ctx, el, view, c);
  if (title) {
    const b = el.bounds;
    const x = view.ox + ((b.u0 + b.u1) / 2) * view.k;
    const y = view.oy - Math.min(b.z0, ...(el.ground || []).map((g) => g.z)) * view.k + 22;
    ctx.fillStyle = c.text;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x, y);
    const w = ctx.measureText(title).width;
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - w / 2, y + 19.5); ctx.lineTo(x + w / 2, y + 19.5); ctx.stroke();
  }
  ctx.restore();
}

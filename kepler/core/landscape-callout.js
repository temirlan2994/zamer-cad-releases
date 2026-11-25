// Выноска (kind 'callout') — пояснение на генплане, как на архитектурном
// эскизе: точка указания → наклонная линия → излом → горизонтальная «полка»,
// над полкой — текст (несколько строк). Без DOM; мм, ось Y вниз.
//
// Хранение (обычный объект ландшафта, схема та же):
//   x, y        — излом (начало полки), ручка «текст»;
//   rotation    — угол текста и полки, ° (новая выноска — горизонтально
//                 на экране при текущем повороте вида);
//   points[0]   — точка указания, ручка «указатель»;
//   variant     — знак на конце: dot | arrow | none;
//   meta.text   — текст, строки через \n; meta.size — высота букв, мм.
//   meta.targetId — объект команды «Подписать»; null — самостоятельная копия.
// Полка идёт от излома в сторону, противоположную указателю. В 3D, ведомость,
// баланс и ТЭП выноска не входит.

export const CALLOUT_SIZE = 300;
export const CALLOUT_SIZE_MIN = 50;
export const CALLOUT_SIZE_MAX = 3000;
export const CALLOUT_TEXT_MAX = 600;
export const CALLOUT_ENDS = [
  { id: 'dot', title: 'Точка' },
  { id: 'arrow', title: 'Стрелка' },
  { id: 'none', title: 'Без знака' },
];
// Смещение текста от указателя у новой выноски (вверх-вправо), мм.
export const CALLOUT_OFFSET = { x: 1800, y: -1500 };

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};

export function normalizeCalloutMeta(meta = {}) {
  const raw = typeof meta?.text === 'string' ? meta.text : 'Выноска';
  const text = raw.replace(/\r\n?/g, '\n').slice(0, CALLOUT_TEXT_MAX);
  return { ...(meta || {}), text, size: clamp(meta?.size, CALLOUT_SIZE_MIN, CALLOUT_SIZE_MAX, CALLOUT_SIZE) };
}

export const calloutSize = (o) => clamp(o?.meta?.size, CALLOUT_SIZE_MIN, CALLOUT_SIZE_MAX, CALLOUT_SIZE);

export function calloutLines(o) {
  const lines = String(o?.meta?.text ?? '').split('\n').map((s) => s.replace(/\s+$/, ''));
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  return lines.length ? lines : [''];
}

export function calloutAnchor(o) {
  const p = Array.isArray(o?.points) ? o.points[0] : null;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : { x: o.x - CALLOUT_OFFSET.x, y: o.y - CALLOUT_OFFSET.y };
}

// Оценка ширины строки без canvas (DXF, попадание): ~0,6 высоты на знак.
export const estimateTextWidth = (text, size) => String(text).length * size * 0.6;

// Замер по шрифту: интерфейс подставляет canvas measureText (ui/render-landscape.js),
// чтобы полка, рамка выделения и попадание совпадали с рисунком.
let measureFn = estimateTextWidth;
export function setCalloutMeasure(fn) { measureFn = typeof fn === 'function' ? fn : estimateTextWidth; }

// Раскладка в осях текста: начало — излом, ось X — вдоль полки (угол
// rotation, °, как у остальных объектов; 0 — горизонтально в мире), Y — вниз.
// { anchor, elbow, shelfEnd, dir, size, lh, angle, local: { anchor, len, lines, box },
//   lines: [{ text, x, y }] (мир, начало строки), corners (мир), box (габарит в мире) }.
// measure(text, size) → ширина, мм (рисунок передаёт замер по шрифту).
export function calloutLayout(o, measure = measureFn) {
  const size = calloutSize(o);
  const lh = size * 1.4;
  const pad = size * 0.35;
  const texts = calloutLines(o);
  const textW = Math.max(size * 2, ...texts.map((t) => measure(t, size)));
  const angle = ((Number(o.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(angle); const s = Math.sin(angle);
  const elbow = { x: o.x, y: o.y };
  const toWorld = (lx, ly) => ({ x: elbow.x + lx * c - ly * s, y: elbow.y + lx * s + ly * c });
  const anchor = calloutAnchor(o);
  const ax = anchor.x - elbow.x; const ay = anchor.y - elbow.y;
  const la = { x: ax * c + ay * s, y: -ax * s + ay * c };
  const dir = la.x > 1 ? -1 : 1;
  const len = textW + pad * 2;
  const left = Math.min(0, dir * len) + pad;
  const gap = size * 0.4;
  const n = texts.length;
  const llines = texts.map((text, i) => ({ text, x: left, y: -gap - (n - 1 - i) * lh }));
  const lbox = { minX: Math.min(0, dir * len), maxX: Math.max(0, dir * len), minY: llines[0].y - size * 1.05, maxY: size * 0.25 };
  const corners = [[lbox.minX, lbox.minY], [lbox.maxX, lbox.minY], [lbox.maxX, lbox.maxY], [lbox.minX, lbox.maxY]].map(([x, y]) => toWorld(x, y));
  const xs = corners.map((p) => p.x); const ys = corners.map((p) => p.y);
  return {
    anchor, elbow, shelfEnd: toWorld(dir * len, 0), dir, size, lh, angle,
    local: { anchor: la, len, lines: llines, box: lbox },
    lines: llines.map((l) => ({ text: l.text, ...toWorld(l.x, l.y) })),
    corners,
    box: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  };
}

// Контур текста с полкой (выделение, рамка) — прямоугольник в осях текста.
export const calloutOutline = (o) => calloutLayout(o).corners;

function segDist(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Попадание: текст с полкой или линия указателя (с запасом tol, мм).
export function calloutHit(o, p, tol = 0) {
  const L = calloutLayout(o);
  const c = Math.cos(L.angle); const s = Math.sin(L.angle);
  const dx = p.x - L.elbow.x; const dy = p.y - L.elbow.y;
  const lx = dx * c + dy * s; const ly = -dx * s + dy * c;
  const b = L.local.box;
  if (lx >= b.minX - tol && lx <= b.maxX + tol && ly >= b.minY - tol && ly <= b.maxY + tol) return true;
  const reach = Math.max(tol, L.size * 0.3);
  return segDist(p, L.anchor, L.elbow) <= reach || Math.hypot(p.x - L.anchor.x, p.y - L.anchor.y) <= reach * 1.5;
}

// Габарит w × h — текст с полкой в осях текста (сводка, экспорт).
export function syncCallout(o) {
  const b = calloutLayout(o).local.box;
  o.w = Math.max(1, Math.round(b.maxX - b.minX));
  o.h = Math.max(1, Math.round(b.maxY - b.minY));
  const r = Number(o.rotation) || 0;
  o.rotation = Math.round((((r % 360) + 360) % 360) * 100) / 100;
  delete o.r;
  return o;
}

// Знак на конце указателя: стрелка — треугольник остриём в точку указания.
export function calloutArrow(L) {
  const dx = L.elbow.x - L.anchor.x; const dy = L.elbow.y - L.anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len; const uy = dy / len;
  const a = Math.min(L.size * 0.9, len * 0.5); const w = a * 0.32;
  const base = { x: L.anchor.x + ux * a, y: L.anchor.y + uy * a };
  return [L.anchor, { x: base.x - uy * w, y: base.y + ux * w }, { x: base.x + uy * w, y: base.y - ux * w }];
}
export const calloutDotRadius = (L) => L.size * 0.2;

// DXF: линии указателя и полки, знак, текст по строкам (TEXT — файл AC1009,
// MTEXT в нём не поддерживается); слой — ключ layer.
export function calloutDxf(o, layer = 'lsNotes') {
  const L = calloutLayout(o);
  const out = [];
  const line = (a, b) => out.push({ type: 'line', layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  if (Math.hypot(L.elbow.x - L.anchor.x, L.elbow.y - L.anchor.y) > 1) line(L.anchor, L.elbow);
  line(L.elbow, L.shelfEnd);
  if (o.variant === 'arrow') {
    const t = calloutArrow(L);
    line(t[0], t[1]); line(t[1], t[2]); line(t[2], t[0]);
  } else if (o.variant !== 'none') {
    out.push({ type: 'circle', layer, cx: L.anchor.x, cy: L.anchor.y, radius: calloutDotRadius(L) });
  }
  const rotation = (L.angle * 180) / Math.PI;
  for (const ln of L.lines) if (ln.text) out.push({ type: 'text', layer, x: ln.x, y: ln.y, height: L.size, rotation, text: ln.text });
  return out;
}

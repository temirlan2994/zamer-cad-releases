// Режим «Эргономика» на плане (core/ergonomics.js): зоны пользования мебели,
// тесные места красным/жёлтым с подписью зазора «420 < 700», перекрытая
// дуга двери, недоступные предметы (штриховка и «⛔»), рабочий треугольник
// кухни, по желанию — нормальные зоны зелёным и тепловая карта проходимости.
// Только на экране (печать и листы — без них), клики не ловит.
//
// Лёгкий модуль: только core и state (его читает render.js). Здесь же —
// настройки режима (localStorage kepler-ergo) и кэш анализа по комнатам:
// при перетаскивании пересчитываются только изменившиеся комнаты и не чаще
// раза в ERGO_THROTTLE мс. Управление (кнопка, клавиша E, «Виды»,
// «Свойства», замечания) — ui/ergonomics.js.

import { levelWindowOpenings } from '../core/spanning-windows.js';
import { ERGO_GROUPS, ergoContext, analyzeRoomErgonomics, summarizeErgo } from '../core/ergonomics.js';
import { itemsInRoom } from '../core/furnish.js';
import { state } from './state.js';

const KEY = 'kepler-ergo';
export const ERGO_THROTTLE = 90; // мс между живыми пересчётами одной комнаты
const GROUP_IDS = ERGO_GROUPS.map((g) => g.id);
export const ERGO_DEFAULT = Object.freeze({
  on: false, okZones: false, heat: false,
  groups: Object.freeze(Object.fromEntries(GROUP_IDS.map((id) => [id, true]))),
});

export function normalizeErgoPref(v) {
  const b = (x, def) => (typeof x === 'boolean' ? x : def);
  const groups = {};
  for (const id of GROUP_IDS) groups[id] = b(v?.groups?.[id], true);
  return { on: b(v?.on, false), okZones: b(v?.okZones, false), heat: b(v?.heat, false), groups };
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(v) {
  // Активность — состояние самостоятельного аналитического вида, а не
  // постоянная настройка. Между сессиями сохраняем только оформление и
  // группы, иначе после reload эргономика накладывалась на обычный план.
  try { localStorage.setItem(KEY, JSON.stringify({ ...v, on: false })); } catch { /* только на сессию */ }
}

// Обработчики от ui/ergonomics.js: перерисовать, счётчик на кнопке, смена настроек.
export const ergoHooks = { redraw: null, changed: null };

export function ergoPref() {
  if (!state.ergo) state.ergo = normalizeErgoPref({ ...read(), on: false });
  return state.ergo;
}

export function setErgoPref(patch) {
  const cur = ergoPref();
  state.ergo = normalizeErgoPref({ ...cur, ...patch, groups: { ...cur.groups, ...(patch.groups || {}) } });
  write(state.ergo);
  ergoHooks.changed?.();
  return state.ergo;
}

export const ergoOn = () => Boolean(state.modeName === 'plan' || !state.modeName) && ergoPref().on;
export const ergoGroupsOn = () => GROUP_IDS.filter((id) => ergoPref().groups[id]);

// ------------------------------------------------------------------ кэш анализа

const cache = { walls: null, openKey: '', ctx: null, ver: 0, rooms: new Map(), timer: null };

function ctxFor(project, walls) {
  const openings = levelWindowOpenings(project, walls);
  const key = JSON.stringify(openings);
  if (cache.walls !== walls || cache.openKey !== key || !cache.ctx) {
    cache.ctx = ergoContext(project, walls, openings);
    cache.walls = walls;
    cache.openKey = key;
    cache.ver += 1;
  }
  return cache.ctx;
}

function roomKey(project, room) {
  const kids = project.rooms.filter((r) => r.parentId === room.id).map((r) => [r.x, r.y, r.w, r.h]);
  return JSON.stringify([cache.ver, room.x, room.y, room.w, room.h, room.outline || null, room.notch || null, kids,
    itemsInRoom(project, room), project.settings?.partition]);
}

/**
 * Анализ этажа с кэшем по комнатам. live — из рисования: изменившаяся
 * комната пересчитывается не чаще ERGO_THROTTLE мс (до того — прежний
 * результат и повторная перерисовка). → summarizeErgo(...) + okZones, ms.
 */
export function ergoAnalysis(project = state.project, walls = state.walls, { live = false } = {}) {
  if (!project) return { rooms: [], findings: [], okZones: [], counts: { error: 0, warn: 0 }, ms: 0 };
  const t0 = performance.now();
  const ctx = ctxFor(project, walls);
  const now = t0;
  let stale = false;
  const heat = ergoPref().heat; // тепловая карта — по настройке
  const seen = new Set();
  const rooms = project.rooms.map((room) => {
    const id = `${project.activeLevel}:${room.id}`;
    seen.add(id);
    const key = roomKey(project, room);
    const prev = cache.rooms.get(id);
    // Тепловая карта нужна, а в кэше её нет, — пересчёт (пустая комната — дёшево).
    if (prev && prev.key === key && (!heat || prev.res.heat)) return prev.res;
    if (live && prev && now - prev.at < ERGO_THROTTLE) { stale = true; return prev.res; }
    const res = analyzeRoomErgonomics(project, room, walls, ctx, { heat });
    cache.rooms.set(id, { key, res, at: now });
    return res;
  });
  for (const id of [...cache.rooms.keys()]) if (id.startsWith(`${project.activeLevel}:`) && !seen.has(id)) cache.rooms.delete(id);
  if (stale && !cache.timer) {
    cache.timer = setTimeout(() => { cache.timer = null; ergoHooks.redraw?.(); }, ERGO_THROTTLE);
  }
  const groups = ergoGroupsOn();
  const sum = summarizeErgo(rooms, groups);
  const on = new Set(groups);
  sum.okZones = rooms.flatMap((r) => r.okZones).filter((z) => on.has(z.group));
  sum.ms = performance.now() - t0;
  return sum;
}

// Находки для «Замечаний» и «Свойств» (свежие, без троттлинга).
export const ergoFindings = (project = state.project, walls = state.walls) => (ergoOn() ? ergoAnalysis(project, walls).findings : []);

// ------------------------------------------------------------------ рисование

const COLORS = {
  light: { error: '#e0393e', warn: '#e39400', ok: '#1f9d5c' },
  dark: { error: '#ff5a5f', warn: '#ffb020', ok: '#3ccf8a' },
};

function isDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.45;
}

const polyPath = (ctx, pts) => {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
};

// Тепловая карта: полосы клеток одного класса по строкам — две фигуры Path2D на комнату.
const heatPaths = new WeakMap();
function heatPathsOf(heat) {
  let paths = heatPaths.get(heat);
  if (paths) return paths;
  paths = { 1: new Path2D(), 2: new Path2D() };
  const { x0, y0, cols, rows, cell, cls } = heat;
  for (let y = 0; y < rows; y += 1) {
    let x = 0;
    while (x < cols) {
      const c = cls[y * cols + x];
      if (c !== 1 && c !== 2) { x += 1; continue; }
      let e = x + 1;
      while (e < cols && cls[y * cols + e] === c) e += 1;
      paths[c].rect(x0 + x * cell, y0 + y * cell, (e - x) * cell, cell);
      x = e;
    }
  }
  heatPaths.set(heat, paths);
  return paths;
}

function arrow(ctx, a, b, size) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  for (const [p, dir] of [[a, ang + Math.PI], [b, ang]]) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - Math.cos(dir - 0.4) * size, p.y - Math.sin(dir - 0.4) * size);
    ctx.lineTo(p.x - Math.cos(dir + 0.4) * size, p.y - Math.sin(dir + 0.4) * size);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Рисует анализ поверх пола и мебели (оси дома: ctx уже в осях дома).
 * o: { st, tokens, px, p2s, dpr, scale, print, walls }.
 */
export function drawErgonomics(ctx, o) {
  const { st, tokens, px, p2s, dpr, scale, print } = o;
  st._ergoDrawn = null;
  if (print || !ergoOn()) return;
  const pref = ergoPref();
  const res = ergoAnalysis(st.project, o.walls || st.walls, { live: true });
  const C = isDark(tokens.canvas) ? COLORS.dark : COLORS.light;
  const focus = st.ergoFocus || null;
  const drawn = { error: 0, warn: 0, ok: 0, heat: 0, triangle: 0, ms: Math.round(res.ms * 10) / 10 };
  const labels = [];
  ctx.save();
  ctx.lineJoin = 'round';

  // Тепловая карта проходимости.
  if (pref.heat) {
    for (const r of res.rooms) {
      if (!r.heat) continue;
      const paths = heatPathsOf(r.heat);
      ctx.globalAlpha = 0.22; ctx.fillStyle = C.error; ctx.fill(paths[1]);
      ctx.globalAlpha = 0.16; ctx.fillStyle = C.warn; ctx.fill(paths[2]);
      drawn.heat += 1;
    }
    ctx.globalAlpha = 1;
  }

  // Нормальные зоны — зелёным.
  if (pref.okZones) {
    ctx.setLineDash([px(5), px(4)]);
    ctx.lineWidth = px(1);
    for (const z of res.okZones) {
      polyPath(ctx, z.zone);
      ctx.globalAlpha = 0.12; ctx.fillStyle = C.ok; ctx.fill();
      ctx.globalAlpha = 0.55; ctx.strokeStyle = C.ok; ctx.stroke();
      drawn.ok += 1;
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Рабочий треугольник кухни.
  if (pref.groups.kitchen) {
    for (const r of res.rooms) {
      const t = r.triangle;
      if (!t) continue;
      ctx.strokeStyle = t.severity === 'ok' ? C.ok : C.warn;
      ctx.lineWidth = px(1.4);
      ctx.setLineDash([px(6), px(3)]);
      ctx.globalAlpha = 0.85;
      polyPath(ctx, t.points);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      for (const p of t.points) { ctx.beginPath(); ctx.arc(p.x, p.y, px(3.5), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      drawn.triangle += 1;
      if (t.severity === 'ok') labels.push({ at: t.labelAt, text: `Σ ${(t.sum / 1000).toFixed(1).replace('.', ',')} м`, col: C.ok, hot: false });
    }
  }

  // Находки: сначала замечания, сверху ошибки.
  const list = [...res.findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? 1 : -1));
  for (const f of list) {
    const col = C[f.severity] || C.warn;
    const hot = focus === f.id;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    if (f.zone && f.rule !== 'triangle') {
      polyPath(ctx, f.zone);
      ctx.globalAlpha = (f.rule === 'door' ? 0.24 : f.rule === 'overlap' ? 0.34 : 0.15) + (hot ? 0.12 : 0);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = px(hot ? 2.6 : 1.3);
      ctx.setLineDash(f.rule === 'door' ? [] : [px(6), px(4)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (f.band) {
      polyPath(ctx, f.band);
      ctx.globalAlpha = 0.3 + (hot ? 0.12 : 0);
      ctx.fill();
    }
    if (f.hatch) {
      for (const poly of f.hatch) {
        ctx.save();
        polyPath(ctx, poly);
        ctx.clip();
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = px(1.4);
        const xs = poly.map((p) => p.x); const ys = poly.map((p) => p.y);
        const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
        const stepMm = px(8);
        ctx.beginPath();
        for (let k = x0 - (y1 - y0); k < x1; k += stepMm) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0); }
        ctx.stroke();
        ctx.restore();
        polyPath(ctx, poly);
        ctx.globalAlpha = 0.95; ctx.lineWidth = px(2); ctx.stroke();
      }
    }
    if (f.dim) {
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = px(1.3);
      ctx.beginPath(); ctx.moveTo(f.dim.a.x, f.dim.a.y); ctx.lineTo(f.dim.b.x, f.dim.b.y); ctx.stroke();
      arrow(ctx, f.dim.a, f.dim.b, px(7));
    }
    ctx.globalAlpha = 1;
    drawn[f.severity] = (drawn[f.severity] || 0) + 1;
    if (f.labelAt && f.label) labels.push({ at: f.labelAt, text: f.label, col, hot });
  }
  ctx.restore();

  // Подписи — в экранных пикселях (мелко, на бледной подложке).
  const k = scale * 1000; // пикселей на метр
  if (labels.length && k >= 18) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const boxes = [];
    for (const l of labels.sort((a, b) => Number(a.hot) - Number(b.hot))) {
      const p = p2s(l.at.x, l.at.y);
      const w = ctx.measureText(l.text).width + 10;
      const h = 16;
      const box = { x: p.x - w / 2, y: p.y - h / 2, w, h };
      if (!l.hot && boxes.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) continue;
      boxes.push(box);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = tokens.surface || '#fff';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(box.x, box.y, w, h, 8); else ctx.rect(box.x, box.y, w, h);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = l.col;
      ctx.lineWidth = l.hot ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = tokens.text || '#18202b';
      ctx.fillText(l.text, p.x, p.y + 0.5);
    }
    ctx.restore();
  }
  st._ergoDrawn = drawn;
}

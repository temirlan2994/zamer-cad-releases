// Отрисовка Kepler Plan: план дома и участок.
// Геометрия рисуется в мировых координатах (мм) через transform (масштаб +
// поворот: в режиме «Участок» север всегда вверх), подписи — в экранных.

import { deriveWalls, doorSymbol, openingRect } from './core/walls.js';
import { roomNetAreaM2 } from './core/rooms.js';
import { itemRect } from './core/furnish.js';
import { roomType } from './core/catalog.js';
import {
  buildZonePolygon, neighborBuffers, polygonAreaM2, sunPosition,
  shadowVector, shadowPolygon,
} from './core/site.js';

const TINTS = ['warm', 'calm', 'wet', 'neutral', 'cool', 'green'];

function cssTokens() {
  const style = getComputedStyle(document.documentElement);
  const token = (name, fallback) => (style.getPropertyValue(name) || fallback).trim();
  const tints = {};
  for (const t of TINTS) tints[t] = token(`--tint-${t}`, '#eef2f7');
  return {
    canvas: token('--canvas', '#fbfcfe'),
    grid: token('--grid', '#e3e9f2'),
    gridMajor: token('--grid-major', '#d2dae6'),
    line: token('--line', '#26313d'),
    muted: token('--muted', '#687486'),
    text: token('--text', '#18202b'),
    accent: token('--accent', '#1f75ff'),
    accent2: token('--accent-2', '#1db4a8'),
    hover: token('--hover', '#1d4ed8'),
    danger: token('--danger', '#e14b4b'),
    wall: token('--wall-fill', '#39434f'),
    wallBearing: token('--wall-bearing', '#1d242c'),
    furniture: token('--furniture', '#5b6b7e'),
    surface: token('--surface', '#ffffff'),
    tints,
  };
}

// Мировая точка -> экранная с учётом поворота вида.
export function projectPoint(view, x, y) {
  const cos = Math.cos(view.rotation || 0);
  const sin = Math.sin(view.rotation || 0);
  return {
    x: (x * cos - y * sin) * view.scale + view.panX,
    y: (x * sin + y * cos) * view.scale + view.panY,
  };
}

// Экранная точка -> мировая.
export function unprojectPoint(view, sx, sy) {
  const cos = Math.cos(view.rotation || 0);
  const sin = Math.sin(view.rotation || 0);
  const dx = (sx - view.panX) / view.scale;
  const dy = (sy - view.panY) / view.scale;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  function draw(state) {
    const tokens = cssTokens();
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const view = state.view;
    const { scale } = view;
    const rotation = view.rotation || 0;
    const walls = state.walls || deriveWalls(state.project);
    const site = state.project.site;
    const w2s = (x, y) => projectPoint(view, x, y);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tokens.canvas;
    ctx.fillRect(0, 0, width, height);

    // Видимая область в мировых координатах (для сетки).
    const corners = [
      unprojectPoint(view, 0, 0), unprojectPoint(view, width, 0),
      unprojectPoint(view, 0, height), unprojectPoint(view, width, height),
    ];
    const worldBox = {
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxY: Math.max(...corners.map((c) => c.y)),
    };

    // Мировая система координат (масштаб + поворот).
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    ctx.setTransform(dpr * scale * cos, dpr * scale * sin, -dpr * scale * sin, dpr * scale * cos, dpr * view.panX, dpr * view.panY);
    const px = (v) => v / scale; // толщина линии в экранных пикселях

    // 1. Сетка (в мировых координатах, чтобы поворачивалась вместе с планом).
    drawGrid(ctx, worldBox, scale, px, tokens);

    // 2. Подложка-топосъёмка — ПОВЕРХ сетки, чтобы её было видно.
    if (site?.underlay && state.underlayImg && !state.underlayHidden) {
      const u = site.underlay;
      ctx.globalAlpha = u.opacity ?? 0.7;
      ctx.drawImage(state.underlayImg, u.x, u.y, u.widthPx * u.mmPerPx, u.heightPx * u.mmPerPx);
      ctx.globalAlpha = 1;
      if (state.selection?.type === 'site' && state.selection.kind === 'underlay') {
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = px(1.6);
        ctx.setLineDash([px(8), px(5)]);
        ctx.strokeRect(u.x, u.y, u.widthPx * u.mmPerPx, u.heightPx * u.mmPerPx);
        ctx.setLineDash([]);
      }
    }

    // 2. Участок: дороги, запретная зона, соседи, тени.
    if (site) drawSiteUnder(ctx, state, site, tokens, px);

    // 3. Полы комнат.
    for (const room of state.project.rooms) if (!room.parentId) drawFloor(ctx, room, tokens);
    for (const room of state.project.rooms) if (room.parentId) drawFloor(ctx, room, tokens);

    // 4. Стены.
    for (const wall of walls) {
      const selected = state.selection?.type === 'wall' && state.selection.key === wall.key &&
        (state.selection.from === undefined || Math.abs(state.selection.from - wall.from) < 1);
      const hovered = state.hover?.type === 'wall' && state.hover.key === wall.key && Math.abs((state.hover.from ?? wall.from) - wall.from) < 1;
      ctx.fillStyle = wall.wallType === 'bearing' ? tokens.wallBearing : tokens.wall;
      if (selected) ctx.fillStyle = tokens.accent;
      else if (hovered) ctx.fillStyle = tokens.hover;
      ctx.fillRect(wall.band.x, wall.band.y, wall.band.w, wall.band.h);
    }

    // Подсветка комнаты под курсором.
    if (state.hover?.type === 'room' && state.selection?.id !== state.hover.id) {
      const hoverRoom = state.project.rooms.find((r) => r.id === state.hover.id);
      if (hoverRoom) {
        ctx.strokeStyle = tokens.hover;
        ctx.lineWidth = px(1.6);
        ctx.globalAlpha = 0.8;
        ctx.strokeRect(hoverRoom.x, hoverRoom.y, hoverRoom.w, hoverRoom.h);
        ctx.globalAlpha = 1;
      }
    }

    // 5. Проёмы.
    for (const opening of state.project.openings) {
      drawOpening(ctx, state, opening, walls, tokens, px);
    }

    // 6. Мебель.
    for (const item of state.project.items) {
      const selected = (state.selection?.type === 'item' && state.selection.id === item.id) ||
        (state.selection?.type === 'multi' && state.selection.itemIds.includes(item.id));
      const hovered = state.hover?.type === 'item' && state.hover.id === item.id;
      drawItem(ctx, item, tokens, px, selected, hovered);
    }

    // 7. Линии участка поверх полов (граница, красная линия, въезд).
    if (site) drawSiteOver(ctx, state, site, tokens, px);

    // 8. Призраки и направляющие.
    if (state.ghost?.rect) {
      const g = state.ghost;
      ctx.fillStyle = g.valid ? 'rgba(31,117,255,0.14)' : 'rgba(225,75,75,0.16)';
      ctx.strokeStyle = g.valid ? tokens.accent : tokens.danger;
      ctx.lineWidth = px(1.6);
      ctx.setLineDash([px(8), px(5)]);
      ctx.fillRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h);
      ctx.strokeRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h);
      ctx.setLineDash([]);
    }
    if (state.ghostOpening) {
      const r = state.ghostOpening.rect;
      ctx.fillStyle = 'rgba(29,180,168,0.5)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    if (state.draft?.points?.length) drawDraft(ctx, state.draft, tokens, px);
    state._snapLabelAt = (state.draft?.snapStart && state.draft.points.length)
      ? { x: state.draft.points[0].x, y: state.draft.points[0].y, text: state.draft.snapLabel }
      : null;

    if (state.guides?.length) {
      ctx.strokeStyle = tokens.accent2;
      ctx.lineWidth = px(1);
      ctx.setLineDash([px(6), px(6)]);
      for (const guide of state.guides) {
        if (guide.type !== 'align') continue;
        ctx.beginPath();
        if (guide.axis === 'v') { ctx.moveTo(guide.at, -1e6); ctx.lineTo(guide.at, 1e6); }
        else { ctx.moveTo(-1e6, guide.at); ctx.lineTo(1e6, guide.at); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 9. Рамки выделения комнат.
    const selRoom = state.selection?.type === 'room'
      ? state.project.rooms.find((r) => r.id === state.selection.id) : null;
    if (selRoom) {
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = px(2);
      ctx.strokeRect(selRoom.x, selRoom.y, selRoom.w, selRoom.h);
    }
    if (state.selection?.type === 'multi') {
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = px(1.6);
      ctx.setLineDash([px(6), px(4)]);
      for (const id of state.selection.roomIds) {
        const room = state.project.rooms.find((r) => r.id === id);
        if (room) ctx.strokeRect(room.x, room.y, room.w, room.h);
      }
      ctx.setLineDash([]);
    }

    // --- Экранный слой ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const room of state.project.rooms) drawRoomLabel(ctx, state, room, w2s, tokens);
    // Полупрозрачные размерные линии у всех комнат: внутренние и габаритные.
    drawAllRoomDims(ctx, state, walls, w2s, tokens);
    if (selRoom) drawRoomHandles(ctx, selRoom, w2s, tokens);
    // Ручки на торцах выбранного проёма — тянуть, меняя ширину с шагом 50 мм.
    const selOpening = state.selection?.type === 'opening'
      ? state.project.openings.find((o) => o.id === state.selection.id) : null;
    if (selOpening) {
      for (const hp of openingHandles(state.project, selOpening, walls)) {
        drawHandleSquare(ctx, w2s(hp.x, hp.y), tokens);
      }
    }
    if (site) drawSiteLabels(ctx, state, site, w2s, tokens);
    // Подпись «замкнуть/завершить» у первой точки черновика.
    if (state._snapLabelAt) {
      const p = w2s(state._snapLabelAt.x, state._snapLabelAt.y);
      ctx.fillStyle = tokens.accent2;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state._snapLabelAt.text, p.x, p.y - 16);
    }
    // Угловые ручки топосъёмки — тянуть, чтобы менять масштаб.
    if (site?.underlay && state.selection?.type === 'site' && state.selection.kind === 'underlay' && !site.underlay.locked) {
      for (const hp of underlayHandles(site.underlay)) {
        drawHandleSquare(ctx, w2s(hp.x, hp.y), tokens);
      }
    }

    const selItem = state.selection?.type === 'item'
      ? state.project.items.find((i) => i.id === state.selection.id) : null;
    if (selItem) {
      const r = itemRect(selItem);
      const p = w2s(r.x + r.w / 2, r.y);
      ctx.fillStyle = tokens.accent;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${selItem.w} × ${selItem.h} мм`, p.x, p.y - 8);
    }

    if (state.ghost?.rect) {
      const g = state.ghost;
      const p = w2s(g.rect.x + g.rect.w / 2, g.rect.y + g.rect.h / 2);
      ctx.fillStyle = g.valid ? tokens.accent : tokens.danger;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const label = g.label || `${(g.rect.w / 1000).toFixed(1)} × ${(g.rect.h / 1000).toFixed(1)} м`;
      ctx.fillText(label, p.x, p.y);
      if (g.reason) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(g.reason, p.x, p.y + 16);
      }
    }

    // Рамка выделения (ЛКМ по пустому месту).
    if (state.marquee) {
      const m = state.marquee;
      const x = Math.min(m.x1, m.x2);
      const y = Math.min(m.y1, m.y2);
      const w = Math.abs(m.x2 - m.x1);
      const h = Math.abs(m.y2 - m.y1);
      ctx.fillStyle = 'rgba(31,117,255,0.08)';
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    // Компас и солнце.
    if (site) drawCompass(ctx, state, site, width, tokens);
  }

  return { draw };
}

function drawGrid(ctx, box, scale, px, tokens) {
  // Адаптивный шаг: промежуточная клетка не мельче ~9 px на экране; главная
  // линия — каждая пятая. Промежуточные тоньше и прозрачнее, главные пожирнее.
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  let minor = steps[steps.length - 1];
  for (const s of steps) { if (s * scale >= 9) { minor = s; break; } }
  const major = minor * 5;

  const line = (fromX, fromY, toX, toY) => {
    ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY); ctx.stroke();
  };

  // Промежуточные линии (пропускаем те, что попадают на главные).
  ctx.strokeStyle = tokens.grid;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = px(0.6);
  let sx = Math.floor(box.minX / minor) * minor;
  for (let x = sx; x <= box.maxX; x += minor) {
    if (Math.round(x) % major === 0) continue;
    line(x, box.minY, x, box.maxY);
  }
  let sy = Math.floor(box.minY / minor) * minor;
  for (let y = sy; y <= box.maxY; y += minor) {
    if (Math.round(y) % major === 0) continue;
    line(box.minX, y, box.maxX, y);
  }

  // Главные линии — чётче.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tokens.gridMajor;
  ctx.lineWidth = px(1);
  sx = Math.floor(box.minX / major) * major;
  for (let x = sx; x <= box.maxX; x += major) line(x, box.minY, x, box.maxY);
  sy = Math.floor(box.minY / major) * major;
  for (let y = sy; y <= box.maxY; y += major) line(box.minX, y, box.maxX, y);
}

// --- Участок: слой под домом (дороги, запретные зоны, соседи, тени) ---

function polyPath(ctx, points, close = true) {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

function drawSiteUnder(ctx, state, site, tokens, px) {
  const hov = state.hover?.type === 'site-obj' ? state.hover : null;
  // Дороги.
  for (const road of site.roads || []) {
    if (road.points.length < 2) continue;
    const selected = state.selection?.type === 'site' && state.selection.kind === 'road' && state.selection.id === road.id;
    const hovered = hov?.kind === 'road' && hov.id === road.id;
    ctx.strokeStyle = selected ? 'rgba(31,117,255,0.4)' : hovered ? 'rgba(29,78,216,0.32)' : 'rgba(120,132,148,0.3)';
    ctx.lineWidth = road.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    polyPath(ctx, road.points, false);
    ctx.stroke();
    ctx.strokeStyle = tokens.muted;
    ctx.lineWidth = px(1.2);
    ctx.setLineDash([800, 600]);
    ctx.beginPath();
    polyPath(ctx, road.points, false);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const boundary = site.boundary;
  const zone = site.showBuildZone && boundary ? buildZonePolygon(site) : null;

  // Запретная полоса: участок минус зона застройки (красная штриховка).
  if (boundary && site.showBuildZone) {
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, boundary);
    if (zone) polyPath(ctx, [...zone].reverse());
    ctx.clip('evenodd');
    paintHatch(ctx, boundary, 'rgba(225,75,75,0.07)', 'rgba(225,75,75,0.28)', px);
    ctx.restore();

    // Буферы соседних домов внутри участка.
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, boundary);
    ctx.clip();
    for (const buf of neighborBuffers(site)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(buf.x, buf.y, buf.w, buf.h);
      ctx.clip();
      paintHatch(ctx, [{ x: buf.x, y: buf.y }, { x: buf.x + buf.w, y: buf.y }, { x: buf.x + buf.w, y: buf.y + buf.h }, { x: buf.x, y: buf.y + buf.h }], 'rgba(225,75,75,0.07)', 'rgba(225,75,75,0.22)', px);
      ctx.restore();
      ctx.strokeStyle = 'rgba(225,75,75,0.5)';
      ctx.lineWidth = px(1);
      ctx.setLineDash([px(5), px(4)]);
      ctx.strokeRect(buf.x, buf.y, buf.w, buf.h);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Соседние дома.
  for (const n of site.neighbors || []) {
    const selected = state.selection?.type === 'site' && state.selection.kind === 'neighbor' && state.selection.id === n.id;
    const hovered = hov?.kind === 'neighbor' && hov.id === n.id;
    const x = n.x - n.w / 2;
    const y = n.y - n.h / 2;
    ctx.fillStyle = 'rgba(120,132,148,0.25)';
    ctx.fillRect(x, y, n.w, n.h);
    ctx.strokeStyle = selected ? tokens.accent : hovered ? tokens.hover : tokens.muted;
    ctx.lineWidth = px(selected || hovered ? 2 : 1.3);
    ctx.strokeRect(x, y, n.w, n.h);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + n.w, y + n.h);
    ctx.moveTo(x + n.w, y); ctx.lineTo(x, y + n.h);
    ctx.stroke();
  }

  // Тени (инсоляция).
  if (site.sun?.enabled) {
    const sun = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
    const vector = shadowVector(sun, site.north, site.buildingHeight || 6000);
    if (vector) {
      ctx.beginPath();
      for (const room of state.project.rooms) {
        if (room.parentId) continue;
        const t = 250;
        const rect = { x: room.x - t, y: room.y - t, w: room.w + t * 2, h: room.h + t * 2 };
        polyPath(ctx, shadowPolygon(rect, vector));
      }
      for (const n of site.neighbors || []) {
        const nv = shadowVector(sun, site.north, n.height || 6000);
        if (!nv) continue;
        polyPath(ctx, shadowPolygon({ x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h }, nv));
      }
      ctx.fillStyle = 'rgba(24,32,43,0.22)';
      ctx.fill();
    }
  }
}

function paintHatch(ctx, polygon, fill, stroke, px) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = px(1);
  ctx.beginPath();
  const step = 700;
  for (let x = minX - (maxY - minY); x <= maxX; x += step) {
    ctx.moveTo(x, maxY);
    ctx.lineTo(x + (maxY - minY), minY);
  }
  ctx.stroke();
}

// --- Участок: линии поверх (граница, красная линия, зона, въезд, черновик) ---

function drawSiteOver(ctx, state, site, tokens, px) {
  const selectedKind = state.selection?.type === 'site' ? state.selection.kind : null;
  const hov = state.hover?.type === 'site-obj' ? state.hover : null;
  const kindColor = (kind, id, base) => {
    if (selectedKind === kind && (id === undefined || state.selection.id === id)) return tokens.accent;
    if (hov?.kind === kind && (id === undefined || hov.id === id)) return tokens.hover;
    return base;
  };

  if (site.boundary?.length >= 2) {
    ctx.strokeStyle = kindColor('boundary', undefined, tokens.line);
    ctx.lineWidth = px(selectedKind === 'boundary' || hov?.kind === 'boundary' ? 3 : 2.2);
    ctx.beginPath();
    polyPath(ctx, site.boundary, site.boundary.length >= 3);
    ctx.stroke();
    // Столбики на вершинах.
    ctx.fillStyle = selectedKind === 'boundary' ? tokens.accent : tokens.line;
    for (const p of site.boundary) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, px(3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (site.showBuildZone && site.boundary) {
    const zone = buildZonePolygon(site);
    if (zone) {
      ctx.strokeStyle = 'rgba(225,75,75,0.75)';
      ctx.lineWidth = px(1.4);
      ctx.setLineDash([px(10), px(6)]);
      ctx.beginPath();
      polyPath(ctx, zone);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (site.redLine?.length >= 2) {
    ctx.strokeStyle = kindColor('redline', undefined, tokens.danger);
    ctx.lineWidth = px(selectedKind === 'redline' || hov?.kind === 'redline' ? 2.8 : 2);
    ctx.setLineDash([1600, 500, 250, 500]);
    ctx.beginPath();
    polyPath(ctx, site.redLine, false);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (site.entry) {
    const e = site.entry;
    const rad = (e.dir * Math.PI) / 180;
    const len = 2200;
    const tip = { x: e.x + Math.cos(rad) * len, y: e.y + Math.sin(rad) * len };
    ctx.strokeStyle = kindColor('entry', undefined, tokens.accent2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = px(2.4);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    const head = 500;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(rad - 0.45) * head, tip.y - Math.sin(rad - 0.45) * head);
    ctx.lineTo(tip.x - Math.cos(rad + 0.45) * head, tip.y - Math.sin(rad + 0.45) * head);
    ctx.closePath();
    ctx.fill();
    // Разрыв в заборе.
    ctx.strokeStyle = tokens.canvas;
    ctx.lineWidth = px(3.2);
    ctx.beginPath();
    ctx.moveTo(e.x - Math.sin(rad) * 1500, e.y + Math.cos(rad) * 1500);
    ctx.lineTo(e.x + Math.sin(rad) * 1500, e.y - Math.cos(rad) * 1500);
    ctx.stroke();
  }
}

function drawDraft(ctx, draft, tokens, px) {
  const color = draft.kind === 'redline' ? tokens.danger : draft.kind === 'road' ? tokens.muted : tokens.accent;
  ctx.strokeStyle = color;
  ctx.lineWidth = px(1.8);
  ctx.setLineDash([px(7), px(5)]);
  ctx.beginPath();
  polyPath(ctx, draft.points, false);
  if (draft.cursor) ctx.lineTo(draft.cursor.x, draft.cursor.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  for (const p of draft.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, px(3.5), 0, Math.PI * 2);
    ctx.fill();
  }
  // Привязка к первой точке: яркий кружок (подпись рисуется в экранном слое).
  if (draft.points.length >= 2) {
    ctx.strokeStyle = draft.snapStart ? tokens.accent2 : tokens.muted;
    ctx.lineWidth = px(draft.snapStart ? 2.4 : 1.4);
    ctx.beginPath();
    ctx.arc(draft.points[0].x, draft.points[0].y, px(draft.snapStart ? 11 : 7), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSiteLabels(ctx, state, site, w2s, tokens) {
  if (site.boundary?.length >= 3) {
    const cx = site.boundary.reduce((s, p) => s + p.x, 0) / site.boundary.length;
    const minY = Math.min(...site.boundary.map((p) => p.y));
    const p = w2s(cx, minY);
    ctx.fillStyle = tokens.muted;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Участок ${polygonAreaM2(site.boundary).toFixed(1)} м²`, p.x, p.y - 10);
  }
  if (site.entry) {
    const p = w2s(site.entry.x, site.entry.y);
    ctx.fillStyle = tokens.accent2;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Въезд', p.x, p.y + 22);
  }
  for (const n of site.neighbors || []) {
    const p = w2s(n.x, n.y);
    ctx.fillStyle = tokens.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Соседний дом', p.x, p.y);
  }
  // Ручки вершин выбранного полигона.
  const sel = state.selection;
  if (sel?.type === 'site') {
    const points = sel.kind === 'boundary' ? site.boundary
      : sel.kind === 'redline' ? site.redLine
        : sel.kind === 'road' ? site.roads.find((r) => r.id === sel.id)?.points : null;
    if (points) {
      for (const point of points) {
        const p = w2s(point.x, point.y);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

function drawCompass(ctx, state, site, width, tokens) {
  const cx = width - 46;
  const cy = 46;
  const r = 26;
  // Направление севера на экране: поворот вида + север проекта.
  const angle = (state.view.rotation || 0) + (site.north * Math.PI) / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = tokens.surface;
  ctx.strokeStyle = tokens.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.rotate(angle);
  // Стрелка севера.
  ctx.fillStyle = tokens.danger;
  ctx.beginPath();
  ctx.moveTo(0, -r + 6);
  ctx.lineTo(-5, 2);
  ctx.lineTo(5, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tokens.muted;
  ctx.beginPath();
  ctx.moveTo(0, r - 6);
  ctx.lineTo(-5, 2);
  ctx.lineTo(5, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tokens.text;
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('С', 0, -r + 4);
  // Солнце на лимбе.
  if (site.sun?.enabled) {
    const sun = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
    if (sun.altitude > 0.5) {
      const sunAngle = (sun.azimuth * Math.PI) / 180;
      ctx.rotate(sunAngle);
      ctx.fillStyle = '#f2b32b';
      ctx.beginPath();
      ctx.arc(0, -r + 6, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFloor(ctx, room, tokens) {
  const def = roomType(room.type);
  const tint = tokens.tints[def?.tint || 'neutral'] || tokens.tints.neutral;
  ctx.fillStyle = tint;
  ctx.fillRect(room.x, room.y, room.w, room.h);
}

function drawOpening(ctx, state, opening, walls, tokens, px) {
  const placed = openingRect(state.project, opening, walls);
  if (!placed) return;
  const { rect } = placed;
  const selected = state.selection?.type === 'opening' && state.selection.id === opening.id;
  const hovered = state.hover?.type === 'opening' && state.hover.id === opening.id;
  ctx.fillStyle = tokens.canvas;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = selected ? tokens.accent : hovered ? tokens.hover : tokens.line;
  ctx.lineWidth = px(selected || hovered ? 1.8 : 1.4);
  if (opening.kind === 'door') {
    const symbol = doorSymbol(state.project, opening, walls);
    if (!symbol) return;
    ctx.beginPath();
    ctx.moveTo(symbol.hinge.x, symbol.hinge.y);
    ctx.lineTo(symbol.open.x, symbol.open.y);
    ctx.stroke();
    ctx.beginPath();
    const radius = opening.width;
    const a1 = Math.atan2(symbol.closed.y - symbol.hinge.y, symbol.closed.x - symbol.hinge.x);
    const a2 = Math.atan2(symbol.open.y - symbol.hinge.y, symbol.open.x - symbol.hinge.x);
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    ctx.arc(symbol.hinge.x, symbol.hinge.y, radius, a1, a1 + delta, delta < 0);
    ctx.stroke();
  } else {
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.beginPath();
    if (rect.w >= rect.h) {
      ctx.moveTo(rect.x, rect.y + rect.h / 2);
      ctx.lineTo(rect.x + rect.w, rect.y + rect.h / 2);
    } else {
      ctx.moveTo(rect.x + rect.w / 2, rect.y);
      ctx.lineTo(rect.x + rect.w / 2, rect.y + rect.h);
    }
    ctx.strokeStyle = selected ? tokens.accent : tokens.accent2;
    ctx.stroke();
  }
}

function drawItem(ctx, item, tokens, px, selected, hovered) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(((item.rotation || 0) * Math.PI) / 180);
  ctx.strokeStyle = selected ? tokens.accent : hovered ? tokens.hover : tokens.furniture;
  ctx.lineWidth = px(selected || hovered ? 1.8 : 1.2);
  ctx.fillStyle = hovered ? 'rgba(29,78,216,0.1)' : 'rgba(127,144,165,0.08)';
  drawGlyph(ctx, item.kind, item.w, item.h);
  ctx.restore();
}

// Условные обозначения мебели (вид сверху), центр в (0,0), размеры w×h мм.
function drawGlyph(ctx, kind, w, h) {
  const x = -w / 2;
  const y = -h / 2;
  const rect = (rx, ry, rw, rh) => { ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh); };
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const circle = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); };

  switch (kind) {
    case 'bed-double':
    case 'bed-single': {
      rect(x, y, w, h);
      const pillowW = kind === 'bed-double' ? w / 2 - 90 : w - 120;
      ctx.strokeRect(x + 60, y + 60, pillowW, 300);
      if (kind === 'bed-double') ctx.strokeRect(x + w / 2 + 30, y + 60, pillowW, 300);
      line(x, y + 500, x + w, y + 500);
      break;
    }
    case 'nightstand': rect(x, y, w, h); circle(0, 0, Math.min(w, h) * 0.18); break;
    case 'sofa': rect(x, y, w, h); ctx.strokeRect(x, y, w, 220); ctx.strokeRect(x, y, 180, h); ctx.strokeRect(x + w - 180, y, 180, h); break;
    case 'sofa-corner': {
      const seat = Math.min(900, h * 0.56);
      const wing = Math.min(900, w * 0.35);
      rect(x, y, w, seat);
      rect(x, y, wing, h);
      ctx.strokeRect(x, y, w, 200);
      break;
    }
    case 'armchair': rect(x, y, w, h); ctx.strokeRect(x, y, w, 200); ctx.strokeRect(x, y, 160, h); ctx.strokeRect(x + w - 160, y, 160, h); break;
    case 'chair': rect(x, y, w, h); ctx.strokeRect(x, y, w, 90); break;
    case 'table':
    case 'dining-table':
    case 'coffee-table': rect(x, y, w, h); ctx.strokeRect(x + 70, y + 70, w - 140, h - 140); break;
    case 'wardrobe': rect(x, y, w, h); line(x, 0, x + w, 0); for (let hx = x + 300; hx < x + w; hx += 300) line(hx, -h * 0.18, hx, h * 0.18); break;
    case 'wardrobe-rack': rect(x, y, w, h); line(x, 0, x + w, 0); break;
    case 'dresser': rect(x, y, w, h); line(x + w / 3, y, x + w / 3, y + h); line(x + (2 * w) / 3, y, x + (2 * w) / 3, y + h); break;
    case 'dressing-table': {
      rect(x, y, w, h);
      ctx.beginPath();
      ctx.ellipse(0, y + h * 0.4, w * 0.28, h * 0.24, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'tv-stand': rect(x, y, w, h); ctx.fillStyle = 'rgba(127,144,165,0.35)'; ctx.fillRect(x + w * 0.12, y + h * 0.25, w * 0.76, h * 0.2); break;
    case 'bookcase': { rect(x, y, w, h); for (let bx = x + w / 4; bx < x + w; bx += w / 4) line(bx, y, bx, y + h); break; }
    case 'kitchen-row': rect(x, y, w, h); line(x, y + h - 120, x + w, y + h - 120); for (let kx = x + 600; kx < x + w; kx += 600) line(kx, y, kx, y + h - 120); break;
    case 'stove': rect(x, y, w, h); circle(-w * 0.22, -h * 0.22, 90); circle(w * 0.22, -h * 0.22, 90); circle(-w * 0.22, h * 0.22, 90); circle(w * 0.22, h * 0.22, 90); break;
    case 'sink': rect(x, y, w, h); circle(0, 30, Math.min(w, h) * 0.3); circle(0, y + 90, 45); break;
    case 'fridge': rect(x, y, w, h); line(x, y, x + w, y + h); line(x + w, y, x, y + h); break;
    case 'bath': rect(x, y, w, h); ctx.strokeRect(x + 90, y + 90, w - 180, h - 180); circle(x + w * 0.18, 0, 55); break;
    case 'shower': rect(x, y, w, h); line(x, y, x + w, y + h); line(x + w, y, x, y + h); circle(0, 0, 90); break;
    case 'toilet': {
      ctx.strokeRect(x, y, w, 200); // бачок
      ctx.beginPath();
      ctx.ellipse(0, y + 200 + (h - 200) / 2, w * 0.42, (h - 260) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'washbasin': rect(x, y, w, h); ctx.beginPath(); ctx.ellipse(0, 20, w * 0.33, h * 0.3, 0, 0, Math.PI * 2); ctx.stroke(); break;
    case 'washer': rect(x, y, w, h); circle(0, 30, Math.min(w, h) * 0.3); circle(x + 120, y + 100, 40); break;
    case 'coat-rack': rect(x, y, w, h); for (let cx = x + 200; cx < x + w; cx += 250) circle(cx, 0, 40); break;
    case 'shoe-bench': rect(x, y, w, h); line(x, 0, x + w, 0); break;
    case 'car': { rect(x, y, w, h); line(x + 100, y + h * 0.22, x + w - 100, y + h * 0.22); line(x + 100, y + h * 0.78, x + w - 100, y + h * 0.78); ctx.strokeRect(x + 120, y + h * 0.3, w - 240, h * 0.4); break; }
    case 'workbench': rect(x, y, w, h); line(x, y + 150, x + w, y + 150); break;
    case 'garden-set': circle(0, 0, Math.min(w, h) * 0.22); circle(-w * 0.32, 0, 140); circle(w * 0.32, 0, 140); circle(0, -h * 0.32, 140); circle(0, h * 0.32, 140); break;
    case 'stairs': { rect(x, y, w, h); const step = 280; for (let sy = y + step; sy < y + h; sy += step) line(x, sy, x + w, sy); line(0, y + h - 150, 0, y + 150); line(0, y + 150, -90, y + 330); line(0, y + 150, 90, y + 330); break; }
    default: rect(x, y, w, h); line(x, y, x + w, y + h);
  }
}

function drawRoomLabel(ctx, state, room, w2s, tokens) {
  const center = w2s(room.x + room.w / 2, room.y + room.h / 2);
  const area = roomNetAreaM2(state.project, room);
  ctx.textAlign = 'center';
  ctx.fillStyle = tokens.text;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(room.name, center.x, center.y - 4);
  ctx.fillStyle = tokens.muted;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(`${area.toFixed(1)} м²`, center.x, center.y + 13);
}

// Размерные линии всех комнат: внутренние размеры внутри комнаты, габарит со
// стенами — снаружи. Невыбранные комнаты рисуются полупрозрачно.
function drawAllRoomDims(ctx, state, walls, w2s, tokens) {
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const room of state.project.rooms) {
    const selected = state.selection?.type === 'room' && state.selection.id === room.id;
    const color = selected ? tokens.accent : tokens.muted;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = selected ? 1 : 0.5;
    const a = w2s(room.x, room.y);
    const b = w2s(room.x + room.w, room.y);
    const c = w2s(room.x, room.y + room.h);
    const edgePx = Math.hypot(b.x - a.x, b.y - a.y);
    const edgePy = Math.hypot(c.x - a.x, c.y - a.y);
    // Внутренние размеры.
    if (edgePx > 70) drawDim(ctx, a, b, flipN(normal(a, b)), 14, `${room.w}`);
    if (edgePy > 70) drawDim(ctx, c, a, flipN(normal(c, a)), 14, `${room.h}`);
    // Габарит со стенами — только для комнат верхнего уровня.
    if (!room.parentId) {
      const outer = roomOuterRect(room, walls);
      const oa = w2s(outer.x, outer.y);
      const ob = w2s(outer.x + outer.w, outer.y);
      const oc = w2s(outer.x, outer.y + outer.h);
      if (edgePx > 70) drawDim(ctx, oa, ob, normal(oa, ob), 16, `${Math.round(outer.w)}`);
      if (edgePy > 70) drawDim(ctx, oc, oa, normal(oc, oa), 16, `${Math.round(outer.h)}`);
    }
    ctx.globalAlpha = 1;
  }
}

// Габарит комнаты вместе с её стенами (по полотнам стен).
function roomOuterRect(room, walls) {
  let minX = room.x;
  let minY = room.y;
  let maxX = room.x + room.w;
  let maxY = room.y + room.h;
  for (const wall of walls) {
    if (!wall.rooms.includes(room.id)) continue;
    minX = Math.min(minX, wall.band.x);
    minY = Math.min(minY, wall.band.y);
    maxX = Math.max(maxX, wall.band.x + wall.band.w);
    maxY = Math.max(maxY, wall.band.y + wall.band.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function flipN(n) {
  return { x: -n.x, y: -n.y };
}

// Ручки на торцах проёма (на осевой линии стены).
export function openingHandles(project, opening, walls) {
  const placed = openingRect(project, opening, walls);
  if (!placed) return [];
  const { rect, wall } = placed;
  if (wall.orient === 'h') {
    const cy = rect.y + rect.h / 2;
    return [{ end: 'start', x: rect.x, y: cy }, { end: 'end', x: rect.x + rect.w, y: cy }];
  }
  const cx = rect.x + rect.w / 2;
  return [{ end: 'start', x: cx, y: rect.y }, { end: 'end', x: cx, y: rect.y + rect.h }];
}

// Четыре угла топосъёмки (мировые координаты) для масштабирования.
export function underlayHandles(u) {
  const w = u.widthPx * u.mmPerPx;
  const h = u.heightPx * u.mmPerPx;
  return [
    { id: 'nw', x: u.x, y: u.y },
    { id: 'ne', x: u.x + w, y: u.y },
    { id: 'se', x: u.x + w, y: u.y + h },
    { id: 'sw', x: u.x, y: u.y + h },
  ];
}

function drawHandleSquare(ctx, p, tokens) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = tokens.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  ctx.fill();
  ctx.stroke();
}

function normal(p, q) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dy / len, y: -dx / len };
}

function drawDim(ctx, p, q, n, off, label) {
  const a = { x: p.x + n.x * off, y: p.y + n.y * off };
  const b = { x: q.x + n.x * off, y: q.y + n.y * off };
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.moveTo(p.x + n.x * (off - 5), p.y + n.y * (off - 5));
  ctx.lineTo(p.x + n.x * (off + 5), p.y + n.y * (off + 5));
  ctx.moveTo(q.x + n.x * (off - 5), q.y + n.y * (off - 5));
  ctx.lineTo(q.x + n.x * (off + 5), q.y + n.y * (off + 5));
  ctx.stroke();
  const mid = { x: (a.x + b.x) / 2 + n.x * 10, y: (a.y + b.y) / 2 + n.y * 10 };
  ctx.fillText(label, mid.x, mid.y + 3);
}

export const HANDLE_SIZE = 9;

export function roomHandles(room) {
  const { x, y, w, h } = room;
  return [
    { id: 'nw', x, y }, { id: 'n', x: x + w / 2, y }, { id: 'ne', x: x + w, y },
    { id: 'e', x: x + w, y: y + h / 2 }, { id: 'se', x: x + w, y: y + h },
    { id: 's', x: x + w / 2, y: y + h }, { id: 'sw', x, y: y + h }, { id: 'w', x, y: y + h / 2 },
  ];
}

function drawRoomHandles(ctx, room, w2s, tokens) {
  for (const handle of roomHandles(room)) {
    const p = w2s(handle.x, handle.y);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }
}

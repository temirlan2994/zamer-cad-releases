// Отрисовка плана Kepler Plan на canvas.
// Геометрия рисуется в мировых координатах (мм) через transform, подписи —
// в экранных, чтобы размер шрифта не зависел от зума.

import { deriveWalls, doorSymbol, openingRect } from './core/walls.js';
import { roomNetAreaM2 } from './core/rooms.js';
import { itemRect } from './core/furnish.js';
import { roomType } from './core/catalog.js';

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
    danger: token('--danger', '#e14b4b'),
    wall: token('--wall-fill', '#39434f'),
    wallBearing: token('--wall-bearing', '#1d242c'),
    furniture: token('--furniture', '#5b6b7e'),
    tints,
  };
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
    const { scale, panX, panY } = state.view;
    const walls = state.walls || deriveWalls(state.project);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tokens.canvas;
    ctx.fillRect(0, 0, width, height);

    drawGrid(ctx, state.view, width, height, tokens);

    // Мировая система координат.
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * panX, dpr * panY);
    const px = (v) => v / scale; // толщина линии в экранных пикселях

    // 1. Полы комнат.
    for (const room of state.project.rooms) {
      if (room.parentId) continue;
      drawFloor(ctx, room, tokens);
    }
    for (const room of state.project.rooms) {
      if (!room.parentId) continue;
      drawFloor(ctx, room, tokens);
    }

    // 2. Стены.
    for (const wall of walls) {
      const selected = state.selection?.type === 'wall' && state.selection.key === wall.key &&
        (state.selection.from === undefined || Math.abs(state.selection.from - wall.from) < 1);
      const hovered = state.hover?.type === 'wall' && state.hover.key === wall.key && Math.abs((state.hover.from ?? wall.from) - wall.from) < 1;
      ctx.fillStyle = wall.wallType === 'bearing' ? tokens.wallBearing : tokens.wall;
      if (selected) ctx.fillStyle = tokens.accent;
      else if (hovered) ctx.fillStyle = tokens.accent2;
      ctx.fillRect(wall.band.x, wall.band.y, wall.band.w, wall.band.h);
    }

    // 3. Проёмы: вырез в стене + символ.
    for (const opening of state.project.openings) {
      drawOpening(ctx, state, opening, walls, tokens, px);
    }

    // 4. Мебель.
    for (const item of state.project.items) {
      const selected = state.selection?.type === 'item' && state.selection.id === item.id;
      drawItem(ctx, item, tokens, px, selected);
    }

    // 5. Призрак размещаемой комнаты / проёма.
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

    // 6. Направляющие привязки.
    if (state.guides?.length) {
      ctx.strokeStyle = tokens.accent2;
      ctx.lineWidth = px(1);
      ctx.setLineDash([px(6), px(6)]);
      for (const guide of state.guides) {
        if (guide.type !== 'align') continue;
        ctx.beginPath();
        if (guide.axis === 'v') { ctx.moveTo(guide.at, -1e5); ctx.lineTo(guide.at, 1e5); }
        else { ctx.moveTo(-1e5, guide.at); ctx.lineTo(1e5, guide.at); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 7. Выделение комнаты: рамка + ручки.
    const selRoom = state.selection?.type === 'room'
      ? state.project.rooms.find((r) => r.id === state.selection.id) : null;
    if (selRoom) {
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = px(2);
      ctx.strokeRect(selRoom.x, selRoom.y, selRoom.w, selRoom.h);
    }

    // --- Экранный слой: подписи ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w2s = (x, y) => ({ x: x * scale + panX, y: y * scale + panY });

    for (const room of state.project.rooms) {
      drawRoomLabel(ctx, state, room, w2s, tokens);
    }
    if (selRoom) drawRoomDimensions(ctx, selRoom, w2s, scale, tokens);
    if (selRoom) drawRoomHandles(ctx, selRoom, w2s, tokens);

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
  }

  return { draw };
}

function drawGrid(ctx, view, width, height, tokens) {
  const { scale, panX, panY } = view;
  const minor = 500; // мм
  const major = 1000;
  const minorPx = minor * scale;
  ctx.lineWidth = 1;
  const startX = Math.floor((0 - panX) / scale / minor) * minor;
  const endX = (width - panX) / scale;
  const startY = Math.floor((0 - panY) / scale / minor) * minor;
  const endY = (height - panY) / scale;
  if (minorPx >= 9) {
    for (let x = startX; x <= endX; x += minor) {
      const sx = x * scale + panX;
      ctx.strokeStyle = x % major === 0 ? tokens.gridMajor : tokens.grid;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, height); ctx.stroke();
    }
    for (let y = startY; y <= endY; y += minor) {
      const sy = y * scale + panY;
      ctx.strokeStyle = y % major === 0 ? tokens.gridMajor : tokens.grid;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(width, sy); ctx.stroke();
    }
  } else {
    const majorStart = Math.floor((0 - panX) / scale / major) * major;
    for (let x = majorStart; x <= endX; x += major) {
      const sx = x * scale + panX;
      ctx.strokeStyle = tokens.grid;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, height); ctx.stroke();
    }
    const majorStartY = Math.floor((0 - panY) / scale / major) * major;
    for (let y = majorStartY; y <= endY; y += major) {
      const sy = y * scale + panY;
      ctx.strokeStyle = tokens.grid;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(width, sy); ctx.stroke();
    }
  }
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
  // Вырез в стене.
  ctx.fillStyle = tokens.canvas;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = selected ? tokens.accent : tokens.line;
  ctx.lineWidth = px(1.4);
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
    // Короткая дуга от закрытого к открытому положению.
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    ctx.arc(symbol.hinge.x, symbol.hinge.y, radius, a1, a1 + delta, delta < 0);
    ctx.stroke();
  } else {
    // Окно: рамка + стекло.
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

function drawItem(ctx, item, tokens, px, selected) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(((item.rotation || 0) * Math.PI) / 180);
  ctx.strokeStyle = selected ? tokens.accent : tokens.furniture;
  ctx.lineWidth = px(selected ? 1.8 : 1.2);
  ctx.fillStyle = 'rgba(127,144,165,0.08)';
  drawGlyph(ctx, item.kind, item.w, item.h);
  if (!item.auto) {
    // Ручная мебель помечается точкой в углу.
    ctx.fillStyle = tokens.accent2;
    ctx.beginPath();
    ctx.arc(-item.w / 2 + 90, -item.h / 2 + 90, 45, 0, Math.PI * 2);
    ctx.fill();
  }
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

function drawRoomDimensions(ctx, room, w2s, scale, tokens) {
  const off = 26; // px от стены
  const a = w2s(room.x, room.y);
  const b = w2s(room.x + room.w, room.y);
  const c = w2s(room.x, room.y + room.h);
  ctx.strokeStyle = tokens.accent;
  ctx.fillStyle = tokens.accent;
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  // Ширина (над комнатой).
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - off); ctx.lineTo(b.x, b.y - off);
  ctx.moveTo(a.x, a.y - off - 4); ctx.lineTo(a.x, a.y - off + 4);
  ctx.moveTo(b.x, b.y - off - 4); ctx.lineTo(b.x, b.y - off + 4);
  ctx.stroke();
  ctx.fillText(`${room.w} мм`, (a.x + b.x) / 2, a.y - off - 5);
  // Высота (слева).
  ctx.beginPath();
  ctx.moveTo(a.x - off, a.y); ctx.lineTo(c.x - off, c.y);
  ctx.moveTo(a.x - off - 4, a.y); ctx.lineTo(a.x - off + 4, a.y);
  ctx.moveTo(c.x - off - 4, c.y); ctx.lineTo(c.x - off + 4, c.y);
  ctx.stroke();
  ctx.save();
  ctx.translate(a.x - off - 5, (a.y + c.y) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${room.h} мм`, 0, 0);
  ctx.restore();
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

// Отрисовка ландшафта «вид сверху» (генплан-эскиз): кроны-акварель с
// графикой ветвей, мягкие длинные тени, покрытия с тонкими текстурами.
//
// Мир — координаты участка в мм, преобразование вида уже задано (render.js).
// Слои: покрытия (ground) → дом (рисует render.js) → тени → низкие объекты
// → высокие (кроны) сверху. Мелкие детали скрываются при отдалении (lod —
// пикселей на метр). Два стиля (ui/render-landscape-kit.js): «Эскиз» —
// приглушённые краски + тонкая чёрная графика; «Чертёж» — монохром для
// печати. Кроны и тени — спрайты в кеше (drawImage), текстуры — узоры.

import { LOUNGE_COLORS, loungeParts } from '../core/landscape-lounge.js';
import {
  LS_COLORS, SHAPE_RANK, curbLines, insetPolygon, isPathShape, isRoundObject, landscapeDef, planterWall, stairsInfo, objectAreaM2, objectColors,
  lineLayout, objectCorners, objectLengthM, objectOutline, objectPath, pathBoards, pointAlong, polylineLength,
  seededRandom, steppingSlabs, variantOf, waterCurtainParts, fmtElev, retainingEdges, retainingInfo,
} from '../core/landscape.js';
import { pointInPolygon } from '../core/zamer/geometry.js';
import { frameCorners, frameEdges, frameRotators } from '../core/landscape-handles.js';
import { calloutArrow, calloutDotRadius, calloutLayout, setCalloutMeasure } from '../core/landscape-callout.js';
import { sunPosition } from '../core/site.js';
import {
  LS_STYLES, TAU, branches, cachedSprite, clearLandscapeSprites, grainPattern, hashStr, lsPalette, needlePath,
  luminance, physicalPattern, rgba, scallopPath, shadowSprite, sizeBucket, spriteStats,
} from './render-landscape-kit.js';
import { state } from './state.js';

export { LS_STYLES, clearLandscapeSprites, lsPalette, spriteStats };

const HANDLE = 7;

// ------------------------------------------------------------ Помощники

function ellipse(ctx, x, y, rx, ry) {
  ctx.moveTo(x + rx, y);
  ctx.ellipse(x, y, Math.max(rx, 0.01), Math.max(ry, 0.01), 0, 0, TAU);
}

function circle(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0.01), 0, TAU);
  ctx.fill();
}

function rrect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Мягкий неровный контур (пятно, пруд): точки по эллипсу с разбросом,
// сглаженные квадратичными кривыми через середины.
function blobPath(ctx, cx, cy, rx, ry, rand, n = 10, jitter = 0.1) {
  const pts = [];
  const phase = rand() * TAU;
  for (let i = 0; i < n; i += 1) {
    const t = phase + (i / n) * TAU;
    const k = 1 - jitter + rand() * jitter * 2;
    pts.push({ x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k });
  }
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i += 1) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  ctx.closePath();
}

// Зубчатая «звезда» (силуэт тени хвойных).
function starPath(ctx, rx, ry, n, inner, phase = 0) {
  for (let i = 0; i < n * 2; i += 1) {
    const t = phase + (i / (n * 2)) * TAU;
    const k = i % 2 ? inner : 1;
    const x = Math.cos(t) * rx * k;
    const y = Math.sin(t) * ry * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// Тонкая графика: текущий путь (или path) — чернилами, w — экранные px.
function ink(ctx, rc, w = 0.8, alpha = 0.85, path = null) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.strokeStyle = rc.ink;
  ctx.lineWidth = rc.px(w);
  if (path) ctx.stroke(path); else ctx.stroke();
  ctx.globalAlpha = prev;
}

function edge(ctx, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Швы и линии материала: в «Эскизе» — полупрозрачные чернила, в «Чертеже» — серые.
const seam = (rc, alpha = 0.22) => rgba(rc.ink, rc.mono ? Math.min(1, alpha * 2.2) : alpha);

// ------------------------------------------------------------ Текстуры

// Тайлы «зерна» в экранных пикселях (рисуются один раз на стиль/тему).
const GRAIN = {
  grain(g, n, rand) { // газон: мелкое зерно и редкие штрихи травы
    for (let i = 0; i < (n * n) / 7; i += 1) {
      g.fillStyle = rand() > 0.55 ? 'rgba(66,80,52,0.11)' : 'rgba(255,255,248,0.20)';
      g.fillRect(rand() * n, rand() * n, 0.8 + rand() * 0.9, 0.8 + rand() * 0.9);
    }
    g.strokeStyle = 'rgba(66,80,52,0.12)';
    g.lineWidth = 0.7;
    for (let i = 0; i < n / 2; i += 1) {
      const x = rand() * n; const y = rand() * n;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand() * 2 - 1, y - 1.5 - rand() * 2); g.stroke();
    }
  },
  gravel(g, n, rand) { // гравий: светлые и тёмные крапинки
    for (let i = 0; i < (n * n) / 9; i += 1) {
      const t = rand();
      g.fillStyle = t > 0.62 ? 'rgba(255,255,255,0.6)' : t > 0.25 ? 'rgba(122,114,102,0.30)' : 'rgba(70,66,60,0.32)';
      const s = 0.8 + rand() * 1.6;
      g.beginPath(); g.ellipse(rand() * n, rand() * n, s, s * (0.6 + rand() * 0.4), rand() * 3, 0, TAU); g.fill();
    }
  },
  stipple(g, n, rand) { // «Чертёж»: газон — редкий пунктир
    g.fillStyle = 'rgba(0,0,0,0.42)';
    for (let i = 0; i < (n * n) / 220; i += 1) g.fillRect(rand() * n, rand() * n, 1, 1);
  },
  stippleD(g, n, rand) {
    g.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < (n * n) / 220; i += 1) g.fillRect(rand() * n, rand() * n, 1, 1);
  },
  monoGravel(g, n, rand) { // «Чертёж»: гравий — кружки
    g.strokeStyle = 'rgba(0,0,0,0.42)';
    g.lineWidth = 0.7;
    for (let i = 0; i < (n * n) / 110; i += 1) {
      g.beginPath(); g.arc(rand() * n, rand() * n, 0.8 + rand() * 1.4, 0, TAU); g.stroke();
    }
  },
  monoGravelD(g, n, rand) {
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = 0.7;
    for (let i = 0; i < (n * n) / 110; i += 1) {
      g.beginPath(); g.arc(rand() * n, rand() * n, 0.8 + rand() * 1.4, 0, TAU); g.stroke();
    }
  },
};

// Заливка текущего пути «зерном»: name — газон/гравий (в «Чертеже» — пунктир).
function fillGrain(ctx, rc, name, alpha = 1) {
  let key = name;
  if (rc.mono) key = (name === 'gravel' ? 'monoGravel' : 'stipple') + (rc.pal.dark ? 'D' : '');
  const pat = grainPattern(ctx, key, rc.pal, rc.k, GRAIN[key]);
  if (!pat) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha * (rc.pal.dark && !rc.mono ? 0.55 : 1);
  ctx.fillStyle = pat;
  ctx.fill();
  ctx.globalAlpha = prev;
}

// Каустика воды (физический тайл): светлые изогнутые линии.
function causticPattern(ctx, rc) {
  return physicalPattern(ctx, 'caustic', rc.pal, rc.k, 1800, (g, T, rand, s) => {
    g.lineCap = 'round';
    // Сеть коротких изогнутых бликов: широкий мягкий + узкий яркий проход.
    const strokes = Array.from({ length: 26 }, () => {
      const x = rand() * T; const y = rand() * T;
      const len = 160 + rand() * 260; const ang = rand() * TAU; const bend = 0.6 + rand() * 0.8;
      return { x, y, len, ang, bend };
    });
    for (let pass = 0; pass < 2; pass += 1) {
      g.strokeStyle = rc.mono ? rgba(rc.ink, 0.3) : pass ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)';
      g.lineWidth = Math.max(0.8 / s, pass ? 9 : 26);
      for (const { x, y, len, ang, bend } of strokes) {
        for (const [dx, dy] of [[0, 0], [-T, 0], [T, 0], [0, -T], [0, T]]) {
          g.beginPath();
          g.moveTo(x + dx, y + dy);
          g.quadraticCurveTo(x + dx + Math.cos(ang + bend) * len * 0.6, y + dy + Math.sin(ang + bend) * len * 0.6,
            x + dx + Math.cos(ang) * len, y + dy + Math.sin(ang) * len);
          g.stroke();
        }
      }
    }
  });
}

// Вода «Чертежа»: горизонтальная штриховка волнами.
function waterHatch(ctx, rc) {
  return physicalPattern(ctx, 'water-hatch', rc.pal, rc.k, 1200, (g, T, rand, s) => {
    g.strokeStyle = rgba(rc.ink, 0.45);
    g.lineWidth = Math.max(0.7 / s, 12);
    for (let y = 150; y < T; y += 300) {
      g.beginPath();
      for (let x = 0; x <= T; x += 60) {
        const yy = y + Math.sin((x / T) * TAU * 2) * 35;
        if (x) g.lineTo(x, yy); else g.moveTo(x, yy);
      }
      g.stroke();
    }
  });
}

// Заливка воды: основа + каустика/штриховка по текущему пути.
function waterFill(ctx, rc, base) {
  ctx.fillStyle = base;
  ctx.fill();
  if (rc.lod < 4) return;
  const pat = rc.mono ? waterHatch(ctx, rc) : causticPattern(ctx, rc);
  if (!pat) return;
  ctx.fillStyle = pat;
  ctx.fill();
}

function gravel(ctx, x, y, w, h, colors, rand, rc) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(x, y, w, h);
  if (rc.lod < 4) return;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  fillGrain(ctx, rc, 'gravel');
}

function tiles(ctx, x, y, w, h, module, colors, rc, rand = null) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(x, y, w, h);
  const modPx = (module * rc.lod) / 1000;
  if (modPx < 3.5) return;
  if (rand && modPx >= 12 && !rc.mono) {
    // Лёгкий разнобой тона плит.
    for (let ty = y; ty < y + h; ty += module) {
      for (let tx = x; tx < x + w; tx += module) {
        ctx.fillStyle = rand() > 0.5 ? colors[2] : colors[1];
        ctx.globalAlpha = 0.12 + rand() * 0.16;
        ctx.fillRect(tx, ty, module, module);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = seam(rc, modPx < 8 ? 0.12 : 0.2);
  ctx.lineWidth = rc.px(0.5);
  ctx.beginPath();
  for (let tx = x + module; tx < x + w; tx += module) { ctx.moveTo(tx, y); ctx.lineTo(tx, y + h); }
  for (let ty = y + module; ty < y + h; ty += module) { ctx.moveTo(x, ty); ctx.lineTo(x + w, ty); }
  ctx.stroke();
}

// Доски вдоль длинной стороны: чередование тонов + тонкая «нить» швов.
function boards(ctx, x, y, w, h, colors, rand, rc, board = 145) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(x, y, w, h);
  const boardPx = (board * rc.lod) / 1000;
  if (boardPx < 1.4) return;
  const alongX = w >= h;
  const len = alongX ? w : h;
  const across = alongX ? h : w;
  const rows = Math.max(1, Math.round(across / board));
  const step = across / rows;
  if (!rc.mono) {
    for (let i = 0; i < rows; i += 1) {
      const tone = rand();
      ctx.fillStyle = tone > 0.66 ? colors[2] : tone > 0.33 ? colors[1] : colors[0];
      ctx.globalAlpha = 0.6;
      if (alongX) ctx.fillRect(x, y + i * step, w, step); else ctx.fillRect(x + i * step, y, step, h);
    }
    ctx.globalAlpha = 1;
  }
  if (boardPx < 3) return;
  ctx.strokeStyle = seam(rc, 0.24);
  ctx.lineWidth = rc.px(0.45);
  ctx.beginPath();
  for (let i = 1; i < rows; i += 1) {
    if (alongX) { ctx.moveTo(x, y + i * step); ctx.lineTo(x + w, y + i * step); }
    else { ctx.moveTo(x + i * step, y); ctx.lineTo(x + i * step, y + h); }
  }
  if (boardPx >= 9) {
    // Торцевые стыки досок — вразбежку.
    const plank = 3000;
    for (let i = 0; i < rows; i += 1) {
      const off = (i % 3) * (plank / 3);
      for (let s = off; s < len; s += plank) {
        if (s <= 0) continue;
        if (alongX) { ctx.moveTo(x + s, y + i * step); ctx.lineTo(x + s, y + (i + 1) * step); }
        else { ctx.moveTo(x + i * step, y + s); ctx.lineTo(x + (i + 1) * step, y + s); }
      }
    }
  }
  ctx.stroke();
}

// Машина сверху: кузов, стёкла, крыша, зеркала — приглушённо, тонкий контур.
function car(ctx, cx, cy, w, l, color, rc) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = rgba(rc.pal.shadow, 0.22);
  ctx.beginPath(); rrect(ctx, -w / 2 + 90, -l / 2 + 120, w, l, 420); ctx.fill();
  ctx.fillStyle = rc.mono ? rc.pal.paper : color;
  ctx.beginPath(); rrect(ctx, -w / 2, -l / 2, w, l, 420); ctx.fill();
  ink(ctx, rc, 0.7, 0.8);
  if (rc.lod >= 6) {
    ctx.fillStyle = rc.c('#5f656c');
    ctx.globalAlpha = rc.mono ? 0.35 : 0.85;
    ctx.beginPath(); // лобовое (перед — вверх, −y)
    ctx.moveTo(-w * 0.4, -l * 0.17); ctx.lineTo(w * 0.4, -l * 0.17);
    ctx.lineTo(w * 0.33, -l * 0.03); ctx.lineTo(-w * 0.33, -l * 0.03);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); // заднее
    ctx.moveTo(-w * 0.34, l * 0.25); ctx.lineTo(w * 0.34, l * 0.25);
    ctx.lineTo(w * 0.38, l * 0.34); ctx.lineTo(-w * 0.38, l * 0.34);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); rrect(ctx, -w * 0.33, -l * 0.03, w * 0.66, l * 0.28, 150);
    ink(ctx, rc, 0.5, 0.45);
    ctx.fillStyle = rc.mono ? rc.pal.paper : color; // зеркала
    ctx.fillRect(-w / 2 - 120, -l * 0.16, 130, 160);
    ctx.fillRect(w / 2 - 10, -l * 0.16, 130, 160);
  }
  ctx.restore();
}

function chair(ctx, x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath(); rrect(ctx, -size / 2, -size / 2, size, size, size * 0.18); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-size / 2, size / 2 - size * 0.2, size, size * 0.2); // спинка — от центра
  ctx.restore();
}

// Тлеющий очаг: приглушённые «языки» без яркого пламени.
function flame(ctx, r, rand, rc) {
  if (rc.mono) return;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 6; i += 1) {
    const t = (i / 6) * TAU + rand() * 0.5;
    ctx.save();
    ctx.rotate(t);
    ctx.fillStyle = i % 2 ? rc.P.fire[1] : rc.P.fire[0];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(r * 0.5, r * 0.22, r * (0.75 + rand() * 0.25), 0);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.22, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  circle(ctx, 0, 0, r * 0.3, rc.P.fire[2]);
}

// Ряд «облачков» (живая изгородь): единый контур чернилами, внутри — дуги
// между облачками, тени/блики и точечная штриховка. pts — центры, r — радиус.
function cloudRow(ctx, pts, r, C, rc, trim = true) {
  const rPx = r * rc.k;
  const R = rc.rand;
  const radii = pts.map(() => r * (trim ? 0.93 + R() * 0.1 : 0.82 + R() * 0.28));
  const lw = rc.px(0.8);
  const union = (grow) => {
    const p = new Path2D();
    pts.forEach((c, i) => { p.moveTo(c.x + radii[i] + grow, c.y); p.arc(c.x, c.y, radii[i] + grow, 0, TAU); });
    return p;
  };
  const body = union(0);
  if (rPx >= 2.5) {
    ctx.fillStyle = rc.ink;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * 0.8;
    ctx.fill(union(lw));
    ctx.globalAlpha = prev;
  }
  ctx.fillStyle = rc.mono ? rc.pal.paper : C[1];
  ctx.fill(body);
  if (rPx < 5) return;
  ctx.save();
  ctx.clip(body);
  const lx = rc.light?.x ?? -Math.SQRT1_2; const ly = rc.light?.y ?? -Math.SQRT1_2;
  if (!rc.mono) {
    ctx.fillStyle = C[0];
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    pts.forEach((c, i) => { const rr = radii[i] * 0.78; ctx.moveTo(c.x - lx * rr * 0.45 + rr, c.y - ly * rr * 0.45); ctx.arc(c.x - lx * rr * 0.45, c.y - ly * rr * 0.45, rr, 0, TAU); });
    ctx.fill();
    ctx.fillStyle = C[2];
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    pts.forEach((c, i) => { const rr = radii[i] * 0.42; ctx.moveTo(c.x + lx * rr * 0.9 + rr, c.y + ly * rr * 0.9); ctx.arc(c.x + lx * rr * 0.9, c.y + ly * rr * 0.9, rr, 0, TAU); });
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Границы облачков — короткие дуги к соседу.
  ctx.strokeStyle = rc.ink;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = rc.px(0.6);
  ctx.beginPath();
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i]; const q = pts[i - 1];
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    ctx.moveTo(p.x + Math.cos(ang - 0.9) * radii[i], p.y + Math.sin(ang - 0.9) * radii[i]);
    ctx.arc(p.x, p.y, radii[i], ang - 0.9, ang + 0.9);
  }
  ctx.stroke();
  if (rPx >= 9) {
    // Точечная штриховка.
    ctx.fillStyle = rc.ink;
    ctx.globalAlpha = 0.38;
    const dot = rc.px(0.9);
    for (let i = 0; i < pts.length; i += 1) {
      const n = Math.min(10, Math.round(rPx / 3));
      for (let j = 0; j < n; j += 1) {
        const t = R() * TAU; const d = Math.sqrt(R()) * radii[i] * 0.85;
        ctx.fillRect(pts[i].x + Math.cos(t) * d, pts[i].y + Math.sin(t) * d, dot, dot);
      }
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------ Виды

// Плоды и цветение — спокойные пастельные акценты.
const FRUIT = { apple: '#c58f7e', pear: '#d6be80', cherry: '#b48089', apricot: '#d6a37a' };
const BLOOM = { lilac: '#b3a4c8', spiraea: '#f1ede6', hydrangea: '#a9b8c9' };

// Крона в «Чертеже»: бумага + контур + центр.
function monoCrown(ctx, rc, path, r) {
  ctx.fillStyle = rc.pal.paper;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * 0.6;
  ctx.fill(path);
  ctx.globalAlpha = prev;
  ink(ctx, rc, 0.9, 0.95, path);
  circle(ctx, 0, 0, Math.max(rc.px(1.1), r * 0.035), rc.ink);
}

// Акварельная заливка кроны: основной тон, пятна, пигмент по краю.
function wash(ctx, rc, path, a, b, C, alpha) {
  const R = rc.rand;
  const r = Math.min(a, b);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.fillStyle = C[1];
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  for (let i = 0; i < 5; i += 1) {
    const t = R() * TAU; const d = R() * 0.55;
    ctx.globalAlpha = prev * alpha * (0.22 + R() * 0.16);
    ctx.fillStyle = i % 2 ? C[0] : C[2];
    ctx.beginPath(); blobPath(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, a * (0.3 + R() * 0.3), b * (0.28 + R() * 0.3), R, 9, 0.25);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.05);
  g.addColorStop(0, rgba(C[0], 0));
  g.addColorStop(1, rgba(C[0], 0.5));
  ctx.globalAlpha = prev * alpha;
  ctx.fillStyle = g;
  ctx.fillRect(-a * 1.2, -b * 1.2, a * 2.4, b * 2.4);
  ctx.restore();
  ctx.globalAlpha = prev;
}

const SWIRL = [0, 0.55, 0.1, -0.5];

// Кромка чаши: внутренняя тень от борта и тонкий контур (по текущему пути).
function waterEdge(ctx, rc, C) {
  if (!rc.mono) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = rgba(C[1], 0.55);
    ctx.lineWidth = rc.px(5);
    ctx.stroke();
    ctx.restore();
  }
  ink(ctx, rc, 0.6, 0.75);
}

// Камень берега: серый, с тонким контуром.
function pebble(ctx, rc, x, y, r, color) {
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.8, (x + y) * 0.001, 0, TAU);
  ctx.fillStyle = color; ctx.fill();
  ink(ctx, rc, 0.45, 0.7);
}

// Кувшинки: листья-«пакмены» приглушённо-оливковые, редкие бледные цветки.
function lilies(ctx, rc, pts) {
  pts.forEach((p, i) => {
    const lr = 170 + ((i * 53) % 90); const t = (i * 2.4) % TAU;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, lr, t + 0.35, t + TAU - 0.35); ctx.closePath();
    ctx.fillStyle = rc.mono ? rc.pal.paper : rc.c('#9aa982'); ctx.fill();
    ink(ctx, rc, 0.45, 0.75);
    if (i % 2 === 0 && !rc.mono) circle(ctx, p.x, p.y, lr * 0.3, rc.c('#e2c9cf'));
  });
}

// Мавританский газон: редкие пастельные точки цветов (узор по пути shape).
function meadowDots(ctx, rc, shape) {
  const pat = physicalPattern(ctx, 'meadow', rc.pal, rc.k, 2400, (g, T, rand) => {
    for (let i = 0; i < 50; i += 1) {
      g.globalAlpha = rc.mono ? 0.5 : 0.85;
      g.fillStyle = rc.mono ? rc.ink : rc.P.flowers[Math.floor(rand() * 4)];
      g.beginPath(); g.arc(rand() * T, rand() * T, rc.mono ? 12 : 30 + rand() * 20, 0, TAU); g.fill();
    }
  });
  if (!pat) return;
  shape();
  ctx.fillStyle = pat;
  ctx.fill();
}

const LOOKS = {
  deciduous(ctx, o, a, b, C, rc) {
    const birch = o.kind === 'tree-birch';
    const R = rc.rand;
    const r = Math.min(a, b);
    const seed = rc.seed ?? 0;
    const crown = new Path2D();
    const detail = rc.dpx ?? (2 * r * rc.lod) / 1000;
    // Чем крупнее на экране, тем мельче и чаще «волна» края.
    const bumps = birch ? 18 + Math.min(10, Math.round(detail / 30)) : 12 + (seed % 4) + Math.min(10, Math.round(detail / 45));
    scallopPath(crown, 0, 0, a * 0.93, b * 0.93, bumps, birch ? 0.04 : 0.06, R);
    if (rc.mono) {
      monoCrown(ctx, rc, crown, r);
      if (detail >= 16) {
        ctx.strokeStyle = rc.ink; ctx.lineCap = 'round'; ctx.globalAlpha = 0.55;
        branches(ctx, r * 0.9, R, { mains: 5, depth: detail > 60 ? 2 : 1, width: rc.px(0.7), reach: 0.75 });
        ctx.globalAlpha = 1; ctx.lineCap = 'butt';
      }
      return;
    }
    wash(ctx, rc, crown, a, b, C, birch ? 0.7 : 0.84);
    if (detail >= 16) {
      ctx.strokeStyle = rc.ink;
      ctx.lineCap = 'round';
      ctx.globalAlpha = birch ? 0.5 : 0.82;
      branches(ctx, r, R, {
        mains: birch ? 7 : 5 + (seed % 3), depth: detail > 170 ? 4 : detail > 70 ? 3 : 2, swirl: birch ? 0.15 : SWIRL[seed % 4],
        width: Math.max(rc.px(birch ? 0.7 : 1.2), r * (birch ? 0.012 : 0.026)), spread: birch ? 0.45 : 0.6, reach: 0.82,
      });
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
    if (detail >= 90) {
      // Пучки листвы — короткие дужки у края кроны.
      ctx.save();
      ctx.clip(crown);
      ctx.strokeStyle = rc.ink;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = rc.px(0.5);
      ctx.beginPath();
      for (let i = 0, m = Math.min(46, detail / 5); i < m; i += 1) {
        const t = R() * TAU; const d = 0.5 + R() * 0.42;
        const x = Math.cos(t) * a * d; const y = Math.sin(t) * b * d; const s = r * (0.04 + R() * 0.035);
        ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x, y + s * 0.9, x + s, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    ink(ctx, rc, birch ? 0.55 : 0.75, birch ? 0.55 : 0.8, crown);
    circle(ctx, 0, 0, Math.max(rc.px(1), r * 0.035), rc.ink);
  },
  fruit(ctx, o, a, b, C, rc) {
    LOOKS.deciduous(ctx, o, a, b, C, rc);
    const detail = rc.dpx ?? (2 * a * rc.lod) / 1000;
    if (detail < 26) return;
    const color = rc.c(FRUIT[o.variant] || FRUIT.apple);
    const r = Math.max(rc.px(1.5), Math.min(a, b) * 0.045);
    for (let i = 0; i < 12; i += 1) {
      const t = rc.rand() * TAU;
      const d = 0.25 + Math.sqrt(rc.rand()) * 0.55;
      circle(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, r, rc.mono ? rc.pal.paper : color);
      ctx.beginPath(); ctx.arc(Math.cos(t) * a * d, Math.sin(t) * b * d, r, 0, TAU);
      ink(ctx, rc, 0.4, 0.6);
    }
  },
  pine(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const r = Math.min(a, b);
    const detail = rc.dpx ?? (2 * r * rc.lod) / 1000;
    const crown = new Path2D();
    needlePath(crown, a * 0.96, b * 0.96, detail > 40 ? 34 : 22, 0.1, R);
    if (rc.mono) monoCrown(ctx, rc, crown, r);
    else wash(ctx, rc, crown, a, b, C, 0.85);
    if (detail >= 12) {
      // Хвоя — лучевая штриховка ярусами.
      const n = Math.max(16, Math.min(60, Math.round(detail * 0.45)));
      ctx.strokeStyle = rc.ink;
      ctx.lineWidth = rc.px(0.5);
      ctx.globalAlpha = rc.mono ? 0.8 : 0.72;
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU + (R() - 0.5) * 0.12;
        const r0 = r * (0.1 + R() * 0.22); const r1 = r * (0.78 + R() * 0.17);
        ctx.moveTo(Math.cos(t) * a * r0 / r, Math.sin(t) * b * r0 / r);
        ctx.lineTo(Math.cos(t) * a * r1 / r, Math.sin(t) * b * r1 / r);
      }
      if (detail >= 30) {
        for (let i = 0; i < n; i += 1) {
          const t = ((i + 0.5) / n) * TAU;
          ctx.moveTo(Math.cos(t) * a * 0.42, Math.sin(t) * b * 0.42);
          ctx.lineTo(Math.cos(t) * a * 0.62, Math.sin(t) * b * 0.62);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!rc.mono) ink(ctx, rc, 0.6, 0.75, crown);
    circle(ctx, 0, 0, Math.max(rc.px(1), r * 0.04), rc.ink);
  },
  spruce(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const r = Math.min(a, b);
    const detail = rc.dpx ?? (2 * r * rc.lod) / 1000;
    const tiers = [[0.97, 26, 0.2, 0], [0.66, 20, 0.22, 1], [0.36, 13, 0.26, 2]];
    const paths = tiers.map(([k, n, d]) => { const p = new Path2D(); needlePath(p, a * k, b * k, n, d, R); return p; });
    if (rc.mono) {
      monoCrown(ctx, rc, paths[0], r);
      if (detail >= 20) ink(ctx, rc, 0.5, 0.6, paths[1]);
    } else {
      tiers.forEach(([, , , ci], i) => {
        ctx.globalAlpha = i ? 0.7 : 0.86;
        ctx.fillStyle = C[ci];
        ctx.fill(paths[i]);
        ctx.globalAlpha = 1;
        if (i && detail >= 20) ink(ctx, rc, 0.45, 0.5, paths[i]);
      });
      ink(ctx, rc, 0.6, 0.8, paths[0]);
    }
    if (detail >= 12) {
      ctx.strokeStyle = rc.ink;
      ctx.lineWidth = rc.px(0.55);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const n = detail > 40 ? 14 : 9;
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU + R() * 0.1;
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(t) * a * 0.9, Math.sin(t) * b * 0.9);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    circle(ctx, 0, 0, Math.max(rc.px(1), r * 0.04), rc.ink);
  },
  thuja(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const crown = new Path2D();
    scallopPath(crown, 0, 0, a * 0.95, b * 0.95, 14, 0.035, R, 0.04);
    const detail = rc.dpx ?? (2 * Math.max(a, b) * rc.lod) / 1000;
    if (rc.mono) monoCrown(ctx, rc, crown, Math.min(a, b));
    else wash(ctx, rc, crown, a, b, C, 0.88);
    if (detail >= 10) {
      // Штриховка вдоль длинной оси.
      ctx.save();
      ctx.clip(crown);
      ctx.strokeStyle = rc.ink;
      ctx.lineWidth = rc.px(0.45);
      ctx.globalAlpha = rc.mono ? 0.6 : 0.4;
      const vertical = b >= a;
      const across = vertical ? a : b; const along = vertical ? b : a;
      const step = Math.max(rc.px(2.4), across * 0.2);
      ctx.beginPath();
      for (let s = -across + step / 2; s < across; s += step) {
        const k = Math.sqrt(Math.max(0, 1 - (s / across) ** 2));
        if (vertical) { ctx.moveTo(s, -along * k * 0.85); ctx.quadraticCurveTo(s + step * 0.3, 0, s, along * k * 0.85); }
        else { ctx.moveTo(-along * k * 0.85, s); ctx.quadraticCurveTo(0, s + step * 0.3, along * k * 0.85, s); }
      }
      ctx.stroke();
      ctx.restore();
    }
    if (!rc.mono) ink(ctx, rc, 0.65, 0.8, crown);
  },
  bonsai(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const pads = o.variant === 'cloud' ? 6 : 5;
    const pts = [];
    for (let i = 0; i < pads; i += 1) {
      const t = (i / pads) * TAU + R() * 0.7;
      const d = 0.45 + R() * 0.15;
      pts.push({ x: Math.cos(t) * a * d, y: Math.sin(t) * b * d, r: (0.26 + R() * 0.1) * a, t });
    }
    ctx.strokeStyle = rc.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(rc.px(1.1), a * 0.05);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const p of pts) { ctx.moveTo(0, 0); ctx.quadraticCurveTo(p.x * 0.2 + p.y * 0.25, p.y * 0.2 - p.x * 0.25, p.x, p.y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    for (const p of pts) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t);
      const pad = new Path2D();
      scallopPath(pad, 0, 0, p.r, p.r * 0.72, 8, 0.1, R);
      if (rc.mono) { ctx.fillStyle = rc.pal.paper; ctx.fill(pad); } else wash(ctx, rc, pad, p.r, p.r * 0.72, C, 0.92);
      ink(ctx, rc, 0.6, 0.85, pad);
      ctx.restore();
    }
  },
  ball(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const crown = new Path2D();
    scallopPath(crown, 0, 0, a * 0.93, b * 0.93, 9 + (rc.seed ?? 0) % 3, 0.08, R);
    const detail = rc.dpx ?? (2 * a * rc.lod) / 1000;
    if (rc.mono) { monoCrown(ctx, rc, crown, Math.min(a, b) * 0.6); return; }
    wash(ctx, rc, crown, a, b, C, 0.9);
    if (detail >= 10) {
      ctx.save(); ctx.clip(crown);
      ctx.fillStyle = rc.ink; ctx.globalAlpha = 0.42;
      const dot = rc.px(0.9);
      const n = Math.max(5, Math.min(40, Math.round(detail * 0.5)));
      for (let i = 0; i < n; i += 1) {
        const t = R() * TAU; const d = Math.sqrt(R()) * 0.85;
        ctx.fillRect(Math.cos(t) * a * d, Math.sin(t) * b * d, dot, dot);
      }
      ctx.restore();
    }
    ink(ctx, rc, 0.7, 0.85, crown);
  },
  juniper(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const n = Math.max(2, Math.round((a / b) * 2));
    const centers = [];
    for (let i = 0; i < n; i += 1) {
      centers.push({ x: -a + b * 0.8 + (i / Math.max(1, n - 1)) * (2 * a - b * 1.6), y: (R() - 0.5) * b * 0.25, r: b * (0.8 + R() * 0.15) });
    }
    const body = new Path2D();
    for (const c of centers) {
      const p = new Path2D();
      needlePath(p, c.r, c.r, 15, 0.34, R);
      body.addPath(p, new DOMMatrix([1, 0, 0, 1, c.x, c.y]));
    }
    if (rc.mono) { ctx.fillStyle = rc.pal.paper; ctx.fill(body); } else wash(ctx, rc, body, a, b, C, 0.82);
    ctx.strokeStyle = rc.ink;
    ctx.lineWidth = rc.px(0.5);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (const c of centers) {
      for (let i = 0; i < 16; i += 1) {
        const t = (i / 16) * TAU + R() * 0.2;
        const k = 0.65 + R() * 0.3;
        ctx.moveTo(c.x + Math.cos(t) * c.r * 0.12, c.y + Math.sin(t) * c.r * 0.12);
        ctx.lineTo(c.x + Math.cos(t) * c.r * k, c.y + Math.sin(t) * c.r * k);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
  shrub(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const crown = new Path2D();
    scallopPath(crown, 0, 0, a * 0.93, b * 0.93, 10 + (rc.seed ?? 0) % 3, 0.1, R);
    const detail = rc.dpx ?? (2 * a * rc.lod) / 1000;
    if (rc.mono) { monoCrown(ctx, rc, crown, Math.min(a, b) * 0.6); return; }
    wash(ctx, rc, crown, a, b, C, 0.86);
    if (detail >= 12) {
      ctx.save(); ctx.clip(crown);
      ctx.fillStyle = rc.ink; ctx.globalAlpha = 0.35;
      const dot = rc.px(0.9);
      for (let i = 0; i < Math.min(40, detail * 0.4); i += 1) {
        const t = R() * TAU; const d = Math.sqrt(R()) * 0.85;
        ctx.fillRect(Math.cos(t) * a * d, Math.sin(t) * b * d, dot, dot);
      }
      ctx.globalAlpha = 0.9;
      const bloom = rc.c(BLOOM[o.variant] || BLOOM.lilac);
      for (let i = 0; i < Math.min(26, detail * 0.35); i += 1) {
        const t = R() * TAU; const d = Math.sqrt(R()) * 0.78;
        circle(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, Math.max(rc.px(1), a * (0.04 + R() * 0.03)), bloom);
      }
      ctx.restore();
    }
    ink(ctx, rc, 0.7, 0.85, crown);
  },
  hedge(ctx, o, a, b, C, rc) {
    const trim = o.variant !== 'free';
    const r = b * (trim ? 0.95 : 1);
    const n = Math.max(1, Math.round((a * 2 - r * 2) / (r * 1.05)));
    const pts = [];
    for (let i = 0; i <= n; i += 1) pts.push({ x: -a + r + ((a * 2 - r * 2) * i) / Math.max(1, n), y: trim ? 0 : (rc.rand() - 0.5) * b * 0.2 });
    cloudRow(ctx, pts, r, C, rc, trim);
  },
  flowerbed(ctx, o, a, b, C, rc) {
    const def = landscapeDef(o.kind);
    const round = isRoundObject(o, def);
    const shape = () => { ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a, b); else rrect(ctx, -a, -b, a * 2, b * 2, Math.min(a, b) * 0.25); };
    shape();
    ctx.fillStyle = rc.mono ? rc.pal.paper : rc.P.leafDark[1];
    ctx.fill();
    if (rc.lod >= 3) {
      const flowers = (variantOf(o, def)?.colors || LS_COLORS.flowers);
      const pat = physicalPattern(ctx, `flowers:${flowers.join(',')}`, rc.pal, rc.k, 1600, (g, T, rand) => {
        const dot = (x, y, r, color, alpha) => {
          g.globalAlpha = alpha; g.fillStyle = color;
          for (const [dx, dy] of [[0, 0], [-T, 0], [T, 0], [0, -T], [0, T]]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, TAU); g.fill(); }
        };
        if (rc.mono) {
          g.strokeStyle = rgba(rc.ink, 0.5); g.lineWidth = 10;
          for (let i = 0; i < 40; i += 1) { g.beginPath(); g.arc(rand() * T, rand() * T, 30 + rand() * 25, 0, TAU); g.stroke(); }
          return;
        }
        for (let i = 0; i < 70; i += 1) dot(rand() * T, rand() * T, 70 + rand() * 60, rand() > 0.5 ? rc.P.leafDark[0] : rc.P.leaf[2], 0.45);
        for (let i = 0; i < 120; i += 1) dot(rand() * T, rand() * T, 28 + rand() * 30, rc.c(flowers[Math.floor(rand() * flowers.length)]), 0.9);
        for (let i = 0; i < 40; i += 1) dot(rand() * T, rand() * T, 12, rc.ink, 0.3);
      });
      if (pat) { shape(); ctx.fillStyle = pat; ctx.fill(); }
    }
    shape();
    ink(ctx, rc, 0.6, rc.mono ? 0.9 : 0.6);
  },
  lawn(ctx, o, a, b, C, rc) {
    const round = isRoundObject(o);
    const shape = () => { ctx.beginPath(); if (round) blobPath(ctx, 0, 0, a, b, seededRandom(o.id), 14, 0.04); else rrect(ctx, -a, -b, a * 2, b * 2, 300); };
    shape();
    ctx.fillStyle = rc.mono ? rc.pal.paper : C[0];
    ctx.fill();
    if (rc.lod >= 2) fillGrain(ctx, rc, 'grain');
    if (!rc.mono && rc.lod >= 3 && o.variant !== 'meadow') {
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let x = -a; x < a; x += 1600) ctx.fillRect(x, -b, 800, b * 2);
      ctx.restore();
    }
    if (o.variant === 'meadow' && rc.lod >= 8) meadowDots(ctx, rc, shape);
    shape();
    if (rc.mono) ink(ctx, rc, 0.5, 0.6); else edge(ctx, rgba(C[2], 0.7), rc.px(0.6));
  },
  grass(ctx, o, a, b, C, rc) {
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(rc.px(0.6), a * 0.025);
    const n = rc.lod >= 6 ? 34 : 14;
    for (let i = 0; i < n; i += 1) {
      const t = rc.rand() * TAU;
      const r = a * (0.55 + rc.rand() * 0.45);
      ctx.strokeStyle = rc.mono || i % 4 === 0 ? rgba(rc.ink, 0.6) : C[i % 3];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(t + 0.3) * r * 0.5, Math.sin(t + 0.3) * r * 0.5 * (b / a), Math.cos(t) * r, Math.sin(t) * r * (b / a));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  },

  boulder(ctx, o, a, b, C, rc) {
    const stones = o.variant === 'trio' ? [[-0.3, -0.15, 0.62], [0.42, 0.1, 0.48], [-0.05, 0.55, 0.36]] : [[0, 0, 1]];
    for (const [sx, sy, k] of stones) {
      ctx.save();
      ctx.translate(sx * a, sy * b);
      const pts = [];
      const n = 8;
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU + rc.rand() * 0.3;
        const kk = k * (0.78 + rc.rand() * 0.22);
        pts.push({ x: Math.cos(t) * a * kk, y: Math.sin(t) * b * kk });
      }
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = C[0]; ctx.fill();
      ink(ctx, rc, 0.7, 0.85);
      // Освещённая грань.
      ctx.beginPath();
      ctx.moveTo(pts[4].x * 0.9, pts[4].y * 0.9);
      for (const p of [pts[5], pts[6], pts[7]]) ctx.lineTo(p.x * 0.92, p.y * 0.92);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = C[1]; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
      ctx.restore();
    }
  },
  parking(ctx, o, a, b, C, rc) {
    if (o.kind === 'parking-2' && o.variant === 'gravel') gravel(ctx, -a, -b, a * 2, b * 2, C, rc.rand, rc);
    else if (o.variant === 'pavers') tiles(ctx, -a, -b, a * 2, b * 2, 300, C, rc, rc.rand);
    else { ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2); }
    const spaces = Math.max(1, Math.round(Number(o.meta?.spaces) || (o.kind === 'parking-2' ? 2 : 1)));
    const sw = (a * 2) / spaces;
    ctx.strokeStyle = rc.mono ? rgba(rc.ink, 0.6) : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = rc.mono ? rc.px(0.6) : Math.max(rc.px(0.8), 80);
    ctx.beginPath();
    for (let i = 0; i <= spaces; i += 1) { ctx.moveTo(-a + i * sw, -b + 150); ctx.lineTo(-a + i * sw, b - 150); }
    ctx.stroke();
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2);
    ink(ctx, rc, 0.6, 0.6);
    const empty = o.variant === 'empty' || o.meta?.cars === 0;
    if (!empty && rc.lod >= 2) {
      for (let i = 0; i < spaces; i += 1) {
        const color = rc.P.car[Math.floor(seededRandom(`${o.id}:${i}`)() * rc.P.car.length)];
        car(ctx, -a + sw * (i + 0.5), 0, Math.min(1850, sw * 0.74), Math.min(4600, b * 2 * 0.87), color, rc);
      }
    }
  },
  'parking-grass'(ctx, o, a, b, C, rc) {
    ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
    if (rc.lod >= 6) {
      ctx.strokeStyle = rc.mono ? rgba(rc.ink, 0.35) : rgba(rc.P.stone[1], 0.75);
      ctx.lineWidth = rc.mono ? rc.px(0.5) : 70;
      ctx.beginPath();
      for (let x = -a; x <= a; x += 400) { ctx.moveTo(x, -b); ctx.lineTo(x, b); }
      for (let y = -b; y <= b; y += 400) { ctx.moveTo(-a, y); ctx.lineTo(a, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = rc.mono ? rgba(rc.ink, 0.6) : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = rc.mono ? rc.px(0.6) : Math.max(rc.px(0.8), 80);
    ctx.setLineDash([400, 300]);
    ctx.strokeRect(-a + 60, -b + 60, a * 2 - 120, b * 2 - 120);
    ctx.setLineDash([]);
  },
  carport(ctx, o, a, b, C, rc) {
    if (rc.lod >= 3) car(ctx, 0, 0, Math.min(1850, a * 1.3), Math.min(4600, b * 1.6), rc.c('#9aa3ad'), rc);
    const wood = o.variant === 'wood';
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 80);
    ctx.fillStyle = rc.mono ? rgba(rc.pal.paper, 0.6) : wood ? rgba(C[0], 0.8) : 'rgba(220,228,230,0.6)';
    ctx.fill();
    ink(ctx, rc, 0.8, 0.85);
    if (rc.lod >= 4) {
      ctx.strokeStyle = wood ? C[1] : C[0];
      ctx.globalAlpha = wood ? 0.9 : 0.5;
      ctx.lineWidth = wood ? 90 : Math.max(rc.px(0.7), 40);
      ctx.beginPath();
      for (let y = -b + 600; y < b; y += wood ? 300 : 700) { ctx.moveTo(-a, y); ctx.lineTo(a, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = C[1];
    for (const [x, y] of [[-a, -b], [a, -b], [a, b], [-a, b], [-a, 0], [a, 0]]) ctx.fillRect(x - 70, y - 70, 140, 140);
  },
  pad(ctx, o, a, b, C, rc) {
    const round = isRoundObject(o);
    ctx.save();
    ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a, b); else rrect(ctx, -a, -b, a * 2, b * 2, 60);
    ctx.clip();
    if (o.variant === 'tiles') tiles(ctx, -a, -b, a * 2, b * 2, 500, rc.P.tiles, rc, rc.rand);
    else if (o.variant === 'deck') boards(ctx, -a, -b, a * 2, b * 2, rc.P.deck, rc.rand, rc);
    else gravel(ctx, -a, -b, a * 2, b * 2, rc.P.gravel, rc.rand, rc);
    ctx.restore();
    ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a, b); else rrect(ctx, -a, -b, a * 2, b * 2, 60);
    ink(ctx, rc, 0.7, 0.8);
  },
  // Отдельная плита (после «Разорвать» или поштучно).
  slab(ctx, o, a, b, C, rc) {
    ctx.fillStyle = rc.mono ? rc.pal.paper : C[0];
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, Math.min(40, a * 0.2, b * 0.2));
    ctx.fill();
    ink(ctx, rc, 0.6, 0.85);
  },
  // Отдельная доска: заливка, волокно вдоль длинной стороны, тонкий контур.
  board(ctx, o, a, b, C, rc) {
    ctx.fillStyle = rc.mono ? rc.pal.paper : C[0];
    ctx.fillRect(-a, -b, a * 2, b * 2);
    if (!rc.mono && Math.min(a, b) * 2 * rc.k >= 4) {
      ctx.strokeStyle = seam(rc, 0.14);
      ctx.lineWidth = rc.px(0.35);
      ctx.beginPath();
      if (a >= b) { ctx.moveTo(-a * 0.9, -b * 0.2); ctx.lineTo(a * 0.9, -b * 0.25); } else { ctx.moveTo(-a * 0.2, -b * 0.9); ctx.lineTo(-a * 0.25, b * 0.9); }
      ctx.stroke();
    }
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2);
    ink(ctx, rc, 0.45, 0.8);
  },
  deck(ctx, o, a, b, C, rc) {
    boards(ctx, -a, -b, a * 2, b * 2, C, rc.rand, rc);
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2);
    ink(ctx, rc, 0.8, 0.85);
  },
  gazebo(ctx, o, a, b, C, rc) {
    if (o.variant === 'flat') {
      ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
      const g = ctx.createLinearGradient(-a, -b, a, b);
      g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = g; ctx.fillRect(-a, -b, a * 2, b * 2);
      ctx.strokeStyle = C[2]; ctx.lineWidth = 120;
      ctx.strokeRect(-a + 60, -b + 60, a * 2 - 120, b * 2 - 120);
      ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2);
      ink(ctx, rc, 0.8, 0.85);
      return;
    }
    const facets = [];
    if (o.variant === 'hex') {
      const pts = [];
      for (let i = 0; i < 6; i += 1) { const t = (i / 6) * TAU; pts.push({ x: Math.cos(t) * a, y: Math.sin(t) * b }); }
      for (let i = 0; i < 6; i += 1) facets.push([{ x: 0, y: 0 }, pts[i], pts[(i + 1) % 6]]);
    } else {
      const along = a >= b;
      const r = Math.abs(a - b);
      const p1 = along ? { x: -r, y: 0 } : { x: 0, y: -r };
      const p2 = along ? { x: r, y: 0 } : { x: 0, y: r };
      const nw = { x: -a, y: -b }; const ne = { x: a, y: -b }; const se = { x: a, y: b }; const sw = { x: -a, y: b };
      facets.push(along ? [nw, ne, p2, p1] : [nw, ne, p1]);
      facets.push(along ? [ne, se, p2] : [ne, se, p2, p1]);
      facets.push(along ? [se, sw, p1, p2] : [se, sw, p2]);
      facets.push(along ? [sw, nw, p1] : [sw, nw, p1, p2]);
    }
    // Освещение граней по направлению света.
    facets.forEach((f) => {
      const cx = f.reduce((s, p) => s + p.x, 0) / f.length;
      const cy = f.reduce((s, p) => s + p.y, 0) / f.length;
      const lit = (cx * rc.light.x + cy * rc.light.y) / Math.max(Math.hypot(cx, cy), 1);
      ctx.beginPath(); f.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = lit > 0.3 ? C[1] : lit < -0.3 ? C[2] : C[0];
      ctx.fill();
      ink(ctx, rc, 0.6, 0.8);
    });
    if (rc.lod >= 12) {
      // Черепица: линии параллельно карнизу.
      ctx.save();
      ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 20;
      for (let k = 0.15; k < 1; k += 0.15) {
        ctx.beginPath(); ctx.rect(-a * k, -b * k, a * 2 * k, b * 2 * k); ctx.stroke();
      }
      ctx.restore();
    }
  },
  pergola(ctx, o, a, b, C, rc) {
    const along = a >= b;
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(-a, -b, a * 2, b * 2);
    ctx.fillStyle = C[0];
    const beam = 160;
    if (along) { ctx.fillRect(-a, -b + 100, a * 2, beam); ctx.fillRect(-a, b - 100 - beam, a * 2, beam); }
    else { ctx.fillRect(-a + 100, -b, beam, b * 2); ctx.fillRect(a - 100 - beam, -b, beam, b * 2); }
    ctx.fillStyle = C[2];
    const step = 420;
    if (along) for (let x = -a + 150; x <= a - 100; x += step) ctx.fillRect(x, -b, 70, b * 2);
    else for (let y = -b + 150; y <= b - 100; y += step) ctx.fillRect(-a, y, a * 2, 70);
    ctx.fillStyle = C[1];
    for (const [x, y] of [[-a + 100, -b + 100], [a - 100, -b + 100], [a - 100, b - 100], [-a + 100, b - 100]]) ctx.fillRect(x - 90, y - 90, 180, 180);
    ctx.beginPath();
    if (along) { ctx.rect(-a, -b + 100, a * 2, beam); ctx.rect(-a, b - 100 - beam, a * 2, beam); }
    else { ctx.rect(-a + 100, -b, beam, b * 2); ctx.rect(a - 100 - beam, -b, beam, b * 2); }
    ink(ctx, rc, 0.5, 0.7);
    if (rc.lod >= 6) {
      // Вьющиеся растения по углам.
      for (const [x, y] of [[-a + 300, -b + 300], [a - 300, b - 300]]) {
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); blobPath(ctx, x, y, 650, 520, rc.rand, 9, 0.2);
        ctx.fillStyle = rc.P.leaf[1]; ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  },
  bbq(ctx, o, a, b, C, rc) {
    tiles(ctx, -a, -b, a * 2, b * 2, 600, C, rc, rc.rand);
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2); ink(ctx, rc, 0.7, 0.8);
    ctx.save(); ctx.translate(-a + 700, -b + 450); LOOKS.grill(ctx, o, 550, 280, rc.P.metal, rc); ctx.restore();
    const tr = Math.min(a, b) * 0.4;
    ctx.save(); ctx.translate(a * 0.25, b * 0.1);
    for (let i = 0; i < 6; i += 1) { const t = (i / 6) * TAU; chair(ctx, Math.cos(t) * (tr + 330), Math.sin(t) * (tr + 330), t + Math.PI / 2, 450, rc.P.wood[2]); }
    circle(ctx, 0, 0, tr, rc.P.wood[0]);
    ctx.restore();
  },
  'sunken-lounge'(ctx, o, a, b, C, rc) {
    circle(ctx, 0, 0, a, rc.mono ? rc.pal.paper : C[0]);
    for (const part of loungeParts({ ...o, x: 0, y: 0, rotation: 0 }, Math.max(0, (o.elevTo ?? 0) - (o.elev ?? -600)))) {
      ctx.beginPath();
      part.poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = rc.mono ? rc.pal.paper : part.material === 'wall' ? C[1] : LOUNGE_COLORS[part.material];
      ctx.fill();
      ink(ctx, rc, 0.45, 0.7);
    }
  },
  firepit(ctx, o, a, b, C, rc) {
    // Круг гравия, мощёная площадка с радиальными швами, тёмная сердцевина.
    const r = Math.min(a, b);
    ctx.save();
    ctx.beginPath(); ellipse(ctx, 0, 0, r, r); ctx.clip();
    gravel(ctx, -r, -r, r * 2, r * 2, C, rc.rand, rc);
    ctx.restore();
    ctx.beginPath(); ellipse(ctx, 0, 0, r, r);
    ink(ctx, rc, 0.6, 0.55);
    const inner = r * 0.56;
    circle(ctx, 0, 0, inner, rc.P.tiles[0]);
    if (rc.lod >= 6) {
      // Мощение «веером»: кольца и радиальные швы, тон камней чуть разный.
      const rings = [0.45, 0.72, 1];
      if (!rc.mono && rc.lod >= 10) {
        for (let k = 1; k < rings.length; k += 1) {
          const n = Math.round(10 + k * 8);
          for (let i = 0; i < n; i += 1) {
            const t0 = (i / n) * TAU; const t1 = ((i + 1) / n) * TAU;
            ctx.beginPath();
            ctx.arc(0, 0, inner * rings[k], t0, t1);
            ctx.arc(0, 0, inner * rings[k - 1], t1, t0, true);
            ctx.closePath();
            ctx.fillStyle = rc.rand() > 0.5 ? rc.P.tiles[1] : rc.P.tiles[2];
            ctx.globalAlpha = 0.5;
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = seam(rc, 0.3);
      ctx.lineWidth = rc.px(0.5);
      ctx.beginPath();
      for (const k of rings) { ctx.moveTo(inner * k, 0); ctx.arc(0, 0, inner * k, 0, TAU); }
      for (let k = 1; k < rings.length; k += 1) {
        const n = Math.round(10 + k * 8);
        for (let i = 0; i < n; i += 1) {
          const t = (i / n) * TAU;
          ctx.moveTo(Math.cos(t) * inner * rings[k - 1], Math.sin(t) * inner * rings[k - 1]);
          ctx.lineTo(Math.cos(t) * inner * rings[k], Math.sin(t) * inner * rings[k]);
        }
      }
      ctx.stroke();
    }
    ctx.beginPath(); ellipse(ctx, 0, 0, inner, inner);
    ink(ctx, rc, 0.7, 0.85);
    // Круговая скамья (дуга с проходом к «низу» объекта) или кольцо камней.
    const rb = r * 0.78;
    const t = Math.max(420, r * 0.15);
    if (o.variant === 'stones') {
      const n = Math.max(8, Math.round((TAU * rb) / (t * 1.4)));
      for (let i = 0; i < n; i += 1) {
        const ang = (i / n) * TAU;
        ctx.save(); ctx.translate(Math.cos(ang) * rb, Math.sin(ang) * rb); ctx.rotate(ang);
        LOOKS.boulder(ctx, { ...o, variant: 'one' }, t * 0.55, t * 0.42, rc.P.stone, rc);
        ctx.restore();
      }
    } else {
      const gap = 0.55;
      const s = Math.PI / 2 + gap / 2;
      const e = Math.PI / 2 - gap / 2 + TAU;
      const seat = () => {
        ctx.beginPath();
        ctx.arc(0, 0, rb + t / 2, s, e);
        ctx.arc(0, 0, rb - t / 2, e, s, true);
        ctx.closePath();
      };
      seat(); // без подложки-тени (тень — по солнцу)
      ctx.save();
      ctx.clip();
      ctx.fillStyle = rc.mono ? rc.pal.paper : rc.P.wood[0];
      ctx.fillRect(-rb - t, -rb - t, (rb + t) * 2, (rb + t) * 2);
      if (rc.lod >= 6) {
        // Доски сиденья — концентрические полосы тонов.
        for (let i = 0; i < 4; i += 1) {
          ctx.strokeStyle = rc.mono ? seam(rc, 0.25) : i % 2 ? rc.P.wood[2] : rc.P.wood[1];
          ctx.globalAlpha = rc.mono ? 1 : 0.6;
          ctx.lineWidth = rc.mono ? rc.px(0.4) : t / 5;
          ctx.beginPath(); ctx.arc(0, 0, rb - t / 2 + (t / 4) * (i + 0.5), 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      seat();
      ink(ctx, rc, 0.7, 0.85);
    }
    // Очаг: каменное кольцо и тёмная сердцевина с тлеющими углями.
    const fr = Math.max(380, r * 0.17);
    circle(ctx, 0, 0, fr, rc.P.stone[2]);
    ctx.beginPath(); ellipse(ctx, 0, 0, fr, fr); ink(ctx, rc, 0.6, 0.8);
    circle(ctx, 0, 0, fr * 0.74, rc.mono ? rc.ink : rc.c('#3a332e'));
    if (rc.lod >= 4) flame(ctx, fr * 0.55, rc.rand, rc);
  },
  grill(ctx, o, a, b, C, rc) {
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, Math.min(a, b) * 0.2);
    ctx.fillStyle = C[1]; ctx.fill();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(a, b));
    g.addColorStop(0, 'rgba(200,150,110,0.55)'); g.addColorStop(1, 'rgba(90,70,60,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(-a * 0.82, -b * 0.7, a * 1.64, b * 1.4);
    if (rc.lod >= 10) {
      ctx.strokeStyle = 'rgba(30,30,30,0.85)';
      ctx.lineWidth = Math.max(rc.px(0.6), 14);
      ctx.beginPath();
      for (let x = -a * 0.8; x <= a * 0.8; x += Math.max(60, a * 0.12)) { ctx.moveTo(x, -b * 0.7); ctx.lineTo(x, b * 0.7); }
      ctx.stroke();
    }
  },
  pool(ctx, o, a, b, C, rc) {
    const loungers = o.variant !== 'plain';
    // Кайма-плитка.
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 120);
    ctx.fillStyle = rc.P.coping[0]; ctx.fill();
    if (rc.lod >= 8) {
      ctx.save(); ctx.clip();
      tiles(ctx, -a, -b, a * 2, b * 2, 600, rc.P.coping, rc, rc.rand);
      ctx.restore();
    }
    const m = Math.min(450, Math.min(a, b) * 0.16);
    const strip = loungers ? Math.min(2100, b * 0.8) : 0;
    const wx = -a + m; const wy = -b + m;
    const ww = a * 2 - m * 2; const wh = b * 2 - m * 2 - strip;
    if (wh > 0) {
      const g = ctx.createLinearGradient(wx, wy, wx + ww * 0.3, wy + wh);
      g.addColorStop(0, C[2]); g.addColorStop(0.4, C[0]); g.addColorStop(1, C[1]);
      ctx.beginPath(); rrect(ctx, wx, wy, ww, wh, 60);
      waterFill(ctx, rc, rc.mono ? C[0] : g);
      waterEdge(ctx, rc, C);
      if (rc.lod >= 5) {
        // Ступени входа в углу.
        ctx.fillStyle = rc.mono ? rgba(rc.pal.paper, 0.7) : 'rgba(255,255,255,0.4)';
        for (let i = 0; i < 3; i += 1) ctx.fillRect(wx + ww - 900 + i * 300, wy, 300 - 40, Math.min(1200, wh));
      }
    }
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 120);
    ink(ctx, rc, 0.7, 0.8);
    if (loungers && strip > 0 && rc.lod >= 3) {
      const n = Math.max(1, Math.min(5, Math.floor(ww / 1150)));
      const y0 = b - strip + 120;
      const lh = Math.min(1900, strip - 300);
      for (let i = 0; i < n; i += 1) {
        const x = -a + m + (ww / n) * (i + 0.5);
        ctx.save(); ctx.translate(x, y0 + lh / 2);
        LOOKS.loungerOne(ctx, 300, lh / 2, rc);
        ctx.restore();
      }
      if (n >= 2) {
        // Зонт между лежаками.
        const ux = -a + m + ww / n;
        const ur = Math.min(1200, strip * 0.55);
        ctx.save(); ctx.translate(ux, y0 + lh * 0.35);
        for (let i = 0; i < 8; i += 1) {
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, ur, (i / 8) * TAU, ((i + 1) / 8) * TAU);
          ctx.closePath();
          ctx.fillStyle = i % 2 ? rc.c('#f1ece2') : rc.c('#e1d6c3');
          ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, ur, 0, TAU);
        for (let i = 0; i < 8; i += 1) { ctx.moveTo(0, 0); ctx.lineTo(Math.cos((i / 8) * TAU) * ur, Math.sin((i / 8) * TAU) * ur); }
        ink(ctx, rc, 0.5, 0.7);
        ctx.restore();
      }
    }
  },
  loungerOne(ctx, a, b, rc) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); rrect(ctx, -a + 60, -b + 80, a * 2, b * 2, 90); ctx.fill();
    ctx.fillStyle = rc.c('#f6f3ec');
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 90); ctx.fill();
    ink(ctx, rc, 0.55, 0.8);
    ctx.fillStyle = rc.c('#dcd3c2');
    ctx.beginPath(); rrect(ctx, -a * 0.8, -b * 0.92, a * 1.6, b * 0.32, 60); ctx.fill();
  },
  jacuzzi(ctx, o, a, b, C, rc) {
    const round = o.variant === 'round';
    ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a, b); else rrect(ctx, -a, -b, a * 2, b * 2, Math.min(a, b) * 0.25);
    ctx.fillStyle = rc.P.coping[1]; ctx.fill();
    ink(ctx, rc, 0.7, 0.8);
    const k = 0.78;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(a, b) * k);
    g.addColorStop(0, C[2]); g.addColorStop(1, C[0]);
    ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a * k, b * k); else rrect(ctx, -a * k, -b * k, a * 2 * k, b * 2 * k, Math.min(a, b) * 0.35);
    waterFill(ctx, rc, rc.mono ? C[0] : g);
    waterEdge(ctx, rc, C);
    if (rc.lod >= 8 && !rc.mono) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 18; i += 1) {
        const t = rc.rand() * TAU; const d = Math.sqrt(rc.rand()) * 0.6;
        ctx.beginPath(); ctx.arc(Math.cos(t) * a * d, Math.sin(t) * b * d, 25 + rc.rand() * 30, 0, TAU); ctx.fill();
      }
    }
  },
  pond(ctx, o, a, b, C, rc) {
    const shape = () => { ctx.beginPath(); blobPath(ctx, 0, 0, a, b, seededRandom(o.id), 12, 0.08); };
    shape();
    const g = ctx.createRadialGradient(-a * 0.2, -b * 0.2, 0, 0, 0, Math.max(a, b));
    g.addColorStop(0, C[2]); g.addColorStop(0.6, C[0]); g.addColorStop(1, C[1]);
    waterFill(ctx, rc, rc.mono ? C[0] : g);
    shape();
    ink(ctx, rc, 0.7, 0.8);
    if (rc.lod >= 5) {
      // Камни по берегу — серые, с тонким контуром.
      const n = Math.max(10, Math.round((Math.PI * (a + b)) / 380));
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU;
        pebble(ctx, rc, Math.cos(t) * (a - 40), Math.sin(t) * (b - 40), 120 + rc.rand() * 140, rc.P.stone[i % 3]);
      }
    }
    if (o.variant !== 'mirror' && rc.lod >= 6) lilies(ctx, rc, Array.from({ length: 6 }, () => {
      const t = rc.rand() * TAU; const d = 0.25 + rc.rand() * 0.45;
      return { x: Math.cos(t) * a * d, y: Math.sin(t) * b * d };
    }));
  },
  'water-curtain'(ctx, o, a, b, C, rc) {
    const { rim, lipDepth, streamWidth } = waterCurtainParts(o);
    ctx.fillStyle = C[0];
    ctx.fillRect(-a, -b, a * 2, b * 2);
    ctx.beginPath(); ctx.rect(-a + rim, -b + rim, a * 2 - 2 * rim, b * 2 - 2 * rim);
    waterFill(ctx, rc, rc.P.water[1]);
    ctx.fillStyle = C[1];
    ctx.fillRect(-a, -b, a * 2, lipDepth);
    ctx.beginPath(); ctx.rect(-a, -b, 2 * a, 2 * b); ink(ctx, rc, 0.8, 0.9);
    ctx.beginPath();
    ctx.rect(-streamWidth / 2, -b + lipDepth, streamWidth, Math.min(100, o.h * 0.08));
    ctx.fillStyle = rc.P.water[2]; ctx.fill(); ink(ctx, rc, 0.55, 0.65);
  },
  fountain(ctx, o, a, b, C, rc) {
    circle(ctx, 0, 0, a, rc.P.stone[1]);
    ctx.beginPath(); ellipse(ctx, 0, 0, a, b); ink(ctx, rc, 0.7, 0.85);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, a * 0.82);
    g.addColorStop(0, C[2]); g.addColorStop(1, C[0]);
    circle(ctx, 0, 0, a * 0.82, rc.mono ? C[0] : g);
    ctx.beginPath(); ellipse(ctx, 0, 0, a * 0.82, a * 0.82); ink(ctx, rc, 0.5, 0.6);
    if (rc.lod >= 6) {
      ctx.strokeStyle = rc.mono ? seam(rc, 0.3) : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(rc.px(0.8), 20);
      for (const k of [0.3, 0.5, 0.7]) { ctx.beginPath(); ctx.arc(0, 0, a * k, 0, TAU); ctx.stroke(); }
    }
    circle(ctx, 0, 0, a * 0.16, rc.P.stone[1]);
    circle(ctx, 0, 0, a * 0.08, rc.c('#ffffff'));
  },
  sandbox(ctx, o, a, b, C, rc) {
    ctx.fillStyle = rc.P.wood[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
    const t = Math.min(160, Math.min(a, b) * 0.15);
    ctx.fillStyle = C[0]; ctx.fillRect(-a + t, -b + t, a * 2 - t * 2, b * 2 - t * 2);
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2); ctx.rect(-a + t, -b + t, a * 2 - t * 2, b * 2 - t * 2);
    ink(ctx, rc, 0.55, 0.75);
    if (rc.lod >= 8) {
      for (let i = 0; i < 120; i += 1) circle(ctx, (rc.rand() * 2 - 1) * (a - t), (rc.rand() * 2 - 1) * (b - t), 25, rc.rand() > 0.5 ? C[1] : C[2]);
      circle(ctx, a * 0.35, b * 0.3, Math.min(a, b) * 0.12, rc.c('#b98f80'));
      circle(ctx, -a * 0.3, -b * 0.25, Math.min(a, b) * 0.09, rc.c('#8c9fb0'));
    }
  },
  playground(ctx, o, a, b, C, rc) {
    if (o.variant === 'sand') LOOKS.sandbox(ctx, o, a, b, C, rc);
    else {
      ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 300);
      ctx.fillStyle = C[0]; ctx.fill();
      ink(ctx, rc, 0.7, 0.8);
    }
    if (rc.lod < 3) return;
    // Башня с горкой.
    const s = Math.min(1300, Math.min(a, b) * 0.5);
    const tx = -a + s * 0.9; const ty = -b + s * 0.9;
    ctx.fillStyle = rc.P.wood[0]; ctx.fillRect(tx - s / 2, ty - s / 2, s, s);
    ctx.fillStyle = rc.c('#b98f80'); ctx.fillRect(tx - s / 2 + 60, ty - s / 2 + 60, s - 120, s - 120);
    const sl = ctx.createLinearGradient(tx + s / 2, 0, tx + s / 2 + s * 1.8, 0);
    sl.addColorStop(0, rc.c('#d4bf8f')); sl.addColorStop(1, rc.c('#e2d3a6'));
    ctx.fillStyle = sl; ctx.beginPath(); rrect(ctx, tx + s / 2, ty - s * 0.22, s * 1.8, s * 0.44, s * 0.15); ctx.fill();
    // Качели.
    const bx = a * 0.35; const by = b * 0.35;
    ctx.fillStyle = rc.c('#8c9fb0'); ctx.fillRect(bx - s * 1.1, by - 70, s * 2.2, 140);
    ctx.fillStyle = rc.c('#5c6168');
    ctx.fillRect(bx - s * 0.6, by + 120, s * 0.4, 160); ctx.fillRect(bx + s * 0.2, by + 120, s * 0.4, 160);
    circle(ctx, -a * 0.35, b * 0.4, Math.min(a, b) * 0.22, rc.P.sand[0]);
    ctx.beginPath();
    ctx.rect(tx - s / 2, ty - s / 2, s, s);
    rrect(ctx, tx + s / 2, ty - s * 0.22, s * 1.8, s * 0.44, s * 0.15);
    ctx.rect(bx - s * 1.1, by - 70, s * 2.2, 140);
    ctx.moveTo(-a * 0.35 + Math.min(a, b) * 0.22, b * 0.4); ctx.arc(-a * 0.35, b * 0.4, Math.min(a, b) * 0.22, 0, TAU);
    ink(ctx, rc, 0.55, 0.75);
  },
  swing(ctx, o, a, b, C, rc) {
    ctx.strokeStyle = C[1]; ctx.lineWidth = 120; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-a + 80, -b + 80); ctx.lineTo(-a + 200, 0); ctx.lineTo(-a + 80, b - 80);
    ctx.moveTo(a - 80, -b + 80); ctx.lineTo(a - 200, 0); ctx.lineTo(a - 80, b - 80);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = C[0]; ctx.fillRect(-a + 100, -80, a * 2 - 200, 160);
    ctx.fillStyle = rc.c('#b98f80');
    ctx.fillRect(-a * 0.45 - 230, 220, 460, 200);
    ctx.fillStyle = rc.c('#8c9fb0');
    ctx.fillRect(a * 0.45 - 230, 220, 460, 200);
  },
  greenhouse(ctx, o, a, b, C, rc) {
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 120);
    const g = ctx.createLinearGradient(-a, 0, a, 0);
    g.addColorStop(0, C[1]); g.addColorStop(0.5, C[2]); g.addColorStop(1, C[1]);
    ctx.fillStyle = g; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    ink(ctx, rc, 0.8, 0.85);
    if (rc.lod >= 6) {
      // Грядки внутри.
      ctx.fillStyle = 'rgba(120,140,100,0.3)';
      ctx.fillRect(-a * 0.75, -b * 0.85, a * 0.5, b * 1.7);
      ctx.fillRect(a * 0.25, -b * 0.85, a * 0.5, b * 1.7);
    }
    ctx.strokeStyle = seam(rc, 0.45);
    ctx.lineWidth = rc.px(0.5);
    ctx.beginPath();
    const along = b >= a;
    if (along) for (let y = -b + 700; y < b; y += 700) { ctx.moveTo(-a, y); ctx.lineTo(a, y); }
    else for (let x = -a + 700; x < a; x += 700) { ctx.moveTo(x, -b); ctx.lineTo(x, b); }
    if (along) { ctx.moveTo(0, -b); ctx.lineTo(0, b); } else { ctx.moveTo(-a, 0); ctx.lineTo(a, 0); }
    ctx.stroke();
  },
  vegbeds(ctx, o, a, b, C, rc) {
    gravel(ctx, -a, -b, a * 2, b * 2, rc.P.gravel, rc.rand, rc, 0.4);
    const along = a >= b;
    const len = along ? a * 2 : b * 2;
    const n = Math.max(1, Math.floor((along ? b * 2 : a * 2) / 1500));
    const bedW = Math.min(1100, ((along ? b * 2 : a * 2) / n) * 0.75);
    for (let i = 0; i < n; i += 1) {
      const c = (along ? -b : -a) + ((along ? b * 2 : a * 2) / n) * (i + 0.5);
      const [x, y, w, h] = along ? [-a + 200, c - bedW / 2, len - 400, bedW] : [c - bedW / 2, -b + 200, bedW, len - 400];
      ctx.fillStyle = rc.P.wood[1]; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C[0]; ctx.fillRect(x + 50, y + 50, w - 100, h - 100);
      ctx.beginPath(); ctx.rect(x, y, w, h); ink(ctx, rc, 0.5, 0.75);
      if (rc.lod >= 8) {
        for (let k = 250; k < (along ? w : h) - 150; k += 300) {
          for (const off of [0.3, 0.7]) {
            const px = along ? x + k : x + w * off;
            const py = along ? y + h * off : y + k;
            circle(ctx, px, py, 90 + rc.rand() * 40, rc.rand() > 0.3 ? rc.P.leaf[1] : rc.P.leaf[2]);
          }
        }
      }
    }
  },
  compost(ctx, o, a, b, C, rc) {
    ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
    ctx.fillStyle = rc.c('#5a4d42'); ctx.fillRect(-a + 80, -b + 80, a * 2 - 160, b * 2 - 160);
    ctx.strokeStyle = C[1]; ctx.lineWidth = 40;
    ctx.beginPath(); ctx.moveTo(0, -b); ctx.lineTo(0, b); ctx.stroke();
  },
  well(ctx, o, a, b, C, rc) {
    circle(ctx, 0, 0, a, C[0]);
    ctx.beginPath(); ellipse(ctx, 0, 0, a, a); ink(ctx, rc, 0.6, 0.85);
    if (rc.lod >= 8) {
      const n = 14;
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU;
        circle(ctx, Math.cos(t) * a * 0.82, Math.sin(t) * a * 0.82, a * 0.15, C[i % 2 ? 1 : 2]);
      }
    }
    circle(ctx, 0, 0, a * 0.6, rc.c('#3e5559'));
    if (o.variant !== 'open') {
      ctx.fillStyle = rc.P.roof[1];
      ctx.fillRect(-a * 1.05, -a * 0.55, a * 1.05, a * 1.1);
      ctx.fillStyle = rc.P.roof[2];
      ctx.fillRect(0, -a * 0.55, a * 1.05, a * 1.1);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = rc.px(1);
      ctx.beginPath(); ctx.moveTo(0, -a * 0.55); ctx.lineTo(0, a * 0.55); ctx.stroke();
    } else {
      ctx.fillStyle = rc.P.wood[1]; ctx.fillRect(-a * 1.1, -60, a * 2.2, 120);
    }
  },
  septic(ctx, o, a, b, C, rc) {
    ctx.beginPath(); ellipse(ctx, 0, 0, a, b);
    ctx.fillStyle = 'rgba(127,127,121,0.12)'; ctx.fill();
    ctx.setLineDash([rc.px(5), rc.px(3)]);
    ink(ctx, rc, 0.8, 0.8);
    ctx.setLineDash([]);
    circle(ctx, 0, 0, Math.min(a, b) * 0.3, C[1]);
    if (rc.lod >= 6) {
      ctx.fillStyle = rc.c('#4a4f57');
      ctx.font = `600 ${Math.round(a * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('С', 0, 0);
      ctx.textBaseline = 'alphabetic';
    }
  },
  loungers(ctx, o, a, b, C, rc) {
    const lw = Math.min(330, a * 0.38);
    for (const sx of [-1, 1]) {
      ctx.save(); ctx.translate(sx * a * 0.5, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); rrect(ctx, -lw + 60, -b + 80, lw * 2, b * 2, 90); ctx.fill();
      ctx.fillStyle = o.variant === 'teak' ? C[0] : rc.c('#f6f3ec');
      ctx.beginPath(); rrect(ctx, -lw, -b, lw * 2, b * 2, 90); ctx.fill();
      ink(ctx, rc, 0.55, 0.8);
      ctx.fillStyle = o.variant === 'teak' ? C[2] : rc.c('#dcd3c2');
      ctx.beginPath(); rrect(ctx, -lw * 0.8, -b * 0.92, lw * 1.6, b * 0.3, 60); ctx.fill();
      ctx.restore();
    }
    circle(ctx, 0, -b * 0.5, Math.min(220, a * 0.15), rc.P.wood[0]);
  },
  bench(ctx, o, a, b, C, rc) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-a + 50, -b + 60, a * 2, b * 2);
    ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
    ctx.fillStyle = C[1]; ctx.fillRect(-a, -b, a * 2, b * 0.45);
    ctx.strokeStyle = 'rgba(40,22,10,0.45)'; ctx.lineWidth = Math.max(rc.px(0.6), 15);
    ctx.beginPath();
    for (let y = -b + b * 0.45 + b * 0.38; y < b; y += b * 0.38) { ctx.moveTo(-a, y); ctx.lineTo(a, y); }
    ctx.stroke();
    ctx.fillStyle = rc.P.metal[1];
    ctx.fillRect(-a + 60, -b, 70, b * 2); ctx.fillRect(a - 130, -b, 70, b * 2);
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2);
    ink(ctx, rc, 0.6, 0.85);
  },
  'table-set'(ctx, o, a, b, C, rc) {
    const chairS = Math.min(480, Math.min(a, b) * 0.28);
    if (o.variant === 'rect') {
      const tw = a * 2 - chairS * 2.4; const th = b * 2 - chairS * 2.6;
      const n = Math.max(1, Math.floor(tw / 650));
      for (let i = 0; i < n; i += 1) {
        const x = -tw / 2 + (tw / n) * (i + 0.5);
        chair(ctx, x, -th / 2 - chairS * 0.7, Math.PI, chairS, C[2]);
        chair(ctx, x, th / 2 + chairS * 0.7, 0, chairS, C[2]);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-tw / 2 + 60, -th / 2 + 70, tw, th);
      ctx.fillStyle = C[0]; ctx.fillRect(-tw / 2, -th / 2, tw, th);
      ctx.strokeStyle = 'rgba(40,22,10,0.4)'; ctx.lineWidth = 15;
      ctx.beginPath(); for (let y = -th / 2 + 120; y < th / 2; y += 120) { ctx.moveTo(-tw / 2, y); ctx.lineTo(tw / 2, y); } ctx.stroke();
      return;
    }
    const tr = Math.min(a, b) - chairS * 1.3;
    const n = Math.max(3, Math.min(8, Math.floor((TAU * (tr + chairS * 0.6)) / (chairS * 1.6))));
    for (let i = 0; i < n; i += 1) {
      const t = (i / n) * TAU;
      chair(ctx, Math.cos(t) * (tr + chairS * 0.65), Math.sin(t) * (tr + chairS * 0.65), t + Math.PI / 2, chairS, C[2]);
    }
    circle(ctx, 70, 80, tr, 'rgba(0,0,0,0.2)');
    circle(ctx, 0, 0, tr, C[0]);
    ctx.beginPath(); ctx.arc(0, 0, tr, 0, TAU); ink(ctx, rc, 0.6, 0.85);
    ctx.beginPath(); ctx.arc(0, 0, tr * 0.8, 0, TAU); edge(ctx, 'rgba(40,22,10,0.3)', 15);
  },
  lamp(ctx, o, a, b, C, rc) {
    const pole = o.variant === 'pole';
    const gr = Math.max(a * (pole ? 7 : 4), 900);
    if (!rc.mono) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
      g.addColorStop(0, 'rgba(240,224,180,0.35)'); g.addColorStop(1, 'rgba(240,224,180,0)');
      ctx.fillStyle = g; ctx.beginPath(); ellipse(ctx, 0, 0, gr, gr); ctx.fill();
    }
    circle(ctx, 0, 0, a, C[1]);
    ctx.beginPath(); ellipse(ctx, 0, 0, a, a); ink(ctx, rc, 0.6, 0.85);
    circle(ctx, 0, 0, a * 0.6, rc.P.fire[2]);
    if (pole) {
      ctx.strokeStyle = C[1]; ctx.lineWidth = a * 0.25;
      ctx.beginPath(); ctx.moveTo(-a * 2, 0); ctx.lineTo(a * 2, 0); ctx.stroke();
    }
  },
  fence(ctx, o, a, b, C, rc) {
    ctx.fillStyle = C[0]; ctx.fillRect(-a, -b * 0.6, a * 2, b * 1.2);
    if (rc.lod >= 8) {
      ctx.strokeStyle = 'rgba(30,20,10,0.4)'; ctx.lineWidth = Math.max(rc.px(0.5), 10);
      ctx.beginPath(); for (let x = -a + 120; x < a; x += 120) { ctx.moveTo(x, -b * 0.6); ctx.lineTo(x, b * 0.6); } ctx.stroke();
    }
    ctx.fillStyle = C[1];
    const post = Math.max(b * 1.6, 100);
    const n = Math.max(1, Math.round((a * 2) / 2500));
    for (let i = 0; i <= n; i += 1) {
      const x = -a + (a * 2 * i) / n;
      ctx.fillRect(x - post / 2, -post / 2, post, post);
    }
  },
  gate(ctx, o, a, b, C, rc) {
    const post = Math.max(b * 1.4, 120);
    ctx.fillStyle = C[1];
    ctx.fillRect(-a - post / 2, -post / 2, post, post);
    ctx.fillRect(a - post / 2, -post / 2, post, post);
    const leaves = o.variant === 'wicket' ? [[-a, a * 2, 1]] : [[-a, a, 1], [a, a, -1]];
    ctx.fillStyle = C[0];
    ctx.strokeStyle = 'rgba(100,110,120,0.8)';
    ctx.lineWidth = Math.max(rc.px(0.8), 20);
    for (const [hx, len, dir] of leaves) {
      ctx.fillRect(dir > 0 ? hx : hx - len, -b * 0.5, len, b);
      ctx.setLineDash([200, 150]);
      ctx.beginPath();
      if (dir > 0) ctx.arc(hx, 0, len, 0, Math.PI / 2); else ctx.arc(hx, 0, len, Math.PI / 2, Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },
  path(ctx, o, a, b, C, rc) {
    tiles(ctx, -a, -b, a * 2, b * 2, 500, C, rc);
  },
};

// ------------------------------------------------------------ Линии и площади
// Рисуются в мировых координатах (без поворота объекта): ось/контур —
// objectPath (сглаженный, если smooth).

function tracePath(ctx, pts, closed) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
}

// Поперечный отрезок полосы на расстоянии s вдоль оси.
function crossAt(path, s, hw) {
  const p = pointAlong(path, s);
  const nx = -Math.sin(p.angle) * hw;
  const ny = Math.cos(p.angle) * hw;
  return [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }, p];
}

// Углы доски/плиты { x, y, angle, along, across } (мир).
function boardCorners(b) {
  const c = Math.cos(b.angle); const s = Math.sin(b.angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([kx, ky]) => {
    const x = (kx * b.along) / 2; const y = (ky * b.across) / 2;
    return { x: b.x + x * c - y * s, y: b.y + x * s + y * c };
  });
}

// Ось и проекции куска полосы: прямой участок и угол — по своему
// направлению u от начала участка; дуга и кривая — по своей оси.
function pieceFrame(layout, piece) {
  const run = piece.kind === 'run' ? layout.runs[piece.run] : null;
  if (run && run.kind !== 'straight') return { curve: run.pts, len: run.len };
  const u = piece.u;
  const n = { x: -u.y, y: u.x };
  const origin = run ? run.pts[0] : piece.poly[0];
  const pu = piece.poly.map((p) => (p.x - origin.x) * u.x + (p.y - origin.y) * u.y);
  const pn = piece.poly.map((p) => (p.x - origin.x) * n.x + (p.y - origin.y) * n.y);
  return { origin, u, n, u0: Math.min(...pu), u1: Math.max(...pu), n0: Math.min(...pn) - 20, n1: Math.max(...pn) + 20 };
}

// Поперечные полосы куска с шагом step: пары [предыдущий, текущий] отрезков.
function pieceStrips(layout, piece, step, hw) {
  const f = pieceFrame(layout, piece);
  const out = [];
  if (f.curve) {
    let prev = crossAt(f.curve, 0, hw * 1.2);
    for (let s = step; s < f.len + step; s += step) {
      const cur = crossAt(f.curve, Math.min(s, f.len), hw * 1.2);
      out.push([prev, cur]);
      prev = cur;
    }
    return out;
  }
  const at = (s, d) => ({ x: f.origin.x + f.u.x * s + f.n.x * d, y: f.origin.y + f.u.y * s + f.n.y * d });
  const k0 = Math.floor(f.u0 / step);
  const k1 = Math.ceil(f.u1 / step);
  let prev = [at(k0 * step, f.n1), at(k0 * step, f.n0)];
  for (let k = k0 + 1; k <= k1 && k - k0 < 5000; k += 1) {
    const cur = [at(k * step, f.n1), at(k * step, f.n0)];
    out.push([prev, cur]);
    prev = cur;
  }
  return out;
}

// Продольная линия куска на смещении d от оси.
function pieceLongLine(layout, piece, d) {
  const f = pieceFrame(layout, piece);
  if (f.curve) {
    const path = f.curve;
    return path.map((p, j) => {
      const a = path[Math.max(0, j - 1)]; const b = path[Math.min(path.length - 1, j + 1)];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      return { x: p.x - Math.sin(ang) * d, y: p.y + Math.cos(ang) * d };
    });
  }
  return [f.u0 - 50, f.u1 + 50].map((s) => ({ x: f.origin.x + f.u.x * s + f.n.x * d, y: f.origin.y + f.u.y * s + f.n.y * d }));
}

// Угол самого длинного ребра контура — направление досок и плитки.
function mainAngle(pts) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) { best = len; angle = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  return angle;
}

// Текстура в осях контура: fn(ctx, x, y, w, h) рисует по габариту в
// повёрнутой системе (доски/плитка параллельно длинному ребру).
function alignedFill(ctx, pts, fn) {
  const ang = mainAngle(pts);
  const o = pts[0];
  const local = pts.map((p) => {
    const dx = p.x - o.x; const dy = p.y - o.y;
    return { x: dx * Math.cos(-ang) - dy * Math.sin(-ang), y: dx * Math.sin(-ang) + dy * Math.cos(-ang) };
  });
  const xs = local.map((p) => p.x); const ys = local.map((p) => p.y);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(ang);
  fn(ctx, x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0);
  ctx.restore();
}

function centroid(pts) {
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function boxOf(pts) {
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const SHAPE_LOOKS = {
  path(ctx, o, path, C, rc) {
    const width = o.width || 1000;
    const hw = width / 2;
    const layout = lineLayout(o);
    const ribbon = layout.outline;
    if (o.variant === 'stepping') {
      // Плиты-ступени: светло-серые прямоугольники с тонкой тёмной обводкой.
      for (const sl of steppingSlabs(o)) {
        ctx.save();
        ctx.translate(sl.x, sl.y);
        ctx.rotate(sl.angle);
        ctx.fillStyle = rc.mono ? rc.pal.paper : C[sl.ci ?? 0];
        ctx.beginPath(); rrect(ctx, -sl.along / 2, -sl.across / 2, sl.along, sl.across, 40); ctx.fill();
        ink(ctx, rc, 0.6, 0.85);
        ctx.restore();
      }
      return;
    }
    tracePath(ctx, ribbon, true);
    ctx.fillStyle = C[0];
    ctx.fill();
    ctx.save();
    ctx.clip();
    const rand = rc.rand;
    if (o.variant === 'gravel') {
      tracePath(ctx, ribbon, true);
      if (rc.lod >= 4) fillGrain(ctx, rc, 'gravel');
    } else if (o.variant === 'deck') {
      // Доски настила (core: строгая/естественная, прямая/со сдвигом), у стыков — подрезка.
      const stepPx = (145 * rc.lod) / 1000;
      if (stepPx >= 1.6) {
        const tone = !rc.mono && stepPx >= 2.5;
        const lines = stepPx >= 3.5;
        ctx.strokeStyle = seam(rc, 0.26);
        ctx.lineWidth = rc.px(0.45);
        for (const b of pathBoards(o)) {
          const poly = b.poly || boardCorners(b);
          if (tone && b.ci) {
            ctx.fillStyle = C[b.ci];
            ctx.globalAlpha = 0.55;
            tracePath(ctx, poly, true); ctx.fill();
            ctx.globalAlpha = 1;
          }
          if (lines) { tracePath(ctx, poly, true); ctx.stroke(); }
        }
      }
    } else {
      // Поперечные полосы по участкам: брусчатка (200), швы бетона (2000).
      const step = o.variant === 'pavers' ? 200 : 2000;
      const concrete = o.variant === 'concrete';
      const stepPx = (step * rc.lod) / 1000;
      if (stepPx >= (concrete ? 4 : 1.6)) {
        const tone = !concrete && !rc.mono && stepPx >= 2.5;
        const lines = stepPx >= (concrete ? 4 : 3.5);
        ctx.strokeStyle = seam(rc, 0.2);
        ctx.lineWidth = rc.px(0.45);
        for (const piece of layout.pieces) {
          ctx.save();
          tracePath(ctx, piece.poly, true);
          ctx.clip();
          for (const [a, b] of pieceStrips(layout, piece, step, hw)) {
            if (tone) {
              ctx.fillStyle = rand() > 0.6 ? C[2] : C[1];
              ctx.globalAlpha = 0.3;
              ctx.beginPath(); ctx.moveTo(a[0].x, a[0].y); ctx.lineTo(b[0].x, b[0].y);
              ctx.lineTo(b[1].x, b[1].y); ctx.lineTo(a[1].x, a[1].y); ctx.closePath(); ctx.fill();
              ctx.globalAlpha = 1;
            }
            if (lines) { ctx.beginPath(); ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(b[1].x, b[1].y); ctx.stroke(); }
          }
          if (o.variant === 'pavers' && stepPx >= 3.5) {
            // Продольные швы брусчатки — параллельно оси куска.
            for (const k of [-1 / 3, 1 / 3]) {
              tracePath(ctx, pieceLongLine(layout, piece, hw * k * 2), false); ctx.stroke();
            }
          }
          ctx.restore();
        }
      }
      // Стыки участков и углов: срез — по диагонали, встык — поперёк, угловая — квадрат.
      if (layout.pieces.length > 1 && stepPx >= 1.2) {
        ctx.strokeStyle = seam(rc, concrete ? 0.4 : 0.34);
        ctx.lineWidth = rc.px(concrete ? 0.7 : 0.6);
        for (const piece of layout.pieces) { tracePath(ctx, piece.poly, true); ctx.stroke(); }
      }
    }
    ctx.restore();
    // Кромка — тонкая линия.
    tracePath(ctx, ribbon, true);
    ink(ctx, rc, 0.7, o.variant === 'gravel' ? 0.55 : 0.8);
  },
  'fence-line'(ctx, o, path, C, rc) {
    if (o.variant === 'hedge') { SHAPE_LOOKS['hedge-line'](ctx, { ...o, width: Math.max(o.width || 0, 600) }, path, C, rc); return; }
    const width = o.width || 150;
    const total = polylineLength(path);
    ctx.lineJoin = 'miter';
    if (o.variant === 'mesh') {
      tracePath(ctx, path, false);
      ctx.strokeStyle = rc.ink;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = rc.px(0.8);
      ctx.setLineDash([rc.px(6), rc.px(3)]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else {
      // Штакетник: полоса цвета дерева с двойным контуром.
      const ribbon = lineLayout({ ...o, width: Math.max(width, rc.px(2.5)) }).outline;
      tracePath(ctx, ribbon, true);
      ctx.fillStyle = rc.mono ? rc.pal.paper : C[0];
      ctx.fill();
      ink(ctx, rc, 0.6, 0.9);
      if ((120 * rc.lod) / 1000 >= 3) {
        ctx.save();
        tracePath(ctx, ribbon, true);
        ctx.clip();
        ctx.strokeStyle = seam(rc, 0.3);
        ctx.lineWidth = rc.px(0.4);
        ctx.beginPath();
        for (let s = 60; s < total; s += 120) {
          const [a, b] = crossAt(path, s, width);
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    // Столбы через ~2,5 м.
    const post = Math.max(width * 1.4, 100, rc.px(2.5));
    const n = Math.max(1, Math.round(total / 2500));
    for (let i = 0; i <= n; i += 1) {
      const p = pointAlong(path, (total * i) / n);
      ctx.beginPath();
      if (o.variant === 'mesh') ellipse(ctx, p.x, p.y, post / 2, post / 2);
      else ctx.rect(p.x - post / 2, p.y - post / 2, post, post);
      ctx.fillStyle = rc.mono ? rc.ink : C[1];
      ctx.fill();
      ink(ctx, rc, 0.5, 0.9);
    }
  },
  'hedge-line'(ctx, o, path, C, rc) {
    const width = o.width || 800;
    const b = width / 2;
    const total = polylineLength(path);
    const trim = o.variant !== 'free';
    if (b * rc.k < 2.5) {
      // Далеко: просто полоса.
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      tracePath(ctx, path, false);
      ctx.strokeStyle = rc.mono ? rc.ink : C[1];
      ctx.lineWidth = Math.max(width, rc.px(1));
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }
    const step = b * (trim ? 1.05 : 1.15);
    const pts = [];
    const R = seededRandom(`${o.id}:hedge`);
    for (let s = 0; s <= total + 1; s += step) {
      const p = pointAlong(path, Math.min(s, total));
      const off = trim ? 0 : (R() - 0.5) * b * 0.3;
      pts.push({ x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off });
    }
    cloudRow(ctx, pts, b, C, rc, trim);
  },
  'lawn-area'(ctx, o, pts, C, rc) {
    tracePath(ctx, pts, true);
    ctx.fillStyle = rc.mono ? rc.pal.paper : C[0];
    ctx.fill();
    if (rc.lod >= 2) fillGrain(ctx, rc, 'grain');
    if (!rc.mono && o.variant === 'mown' && rc.lod >= 3) {
      ctx.save();
      ctx.clip();
      alignedFill(ctx, pts, (c, x, y, w, h) => {
        c.fillStyle = 'rgba(255,255,255,0.06)';
        for (let xx = x; xx < x + w; xx += 1600) c.fillRect(xx, y, 800, h);
      });
      ctx.restore();
    }
    if (o.variant === 'moss' && rc.lod >= 4) {
      tracePath(ctx, pts, true);
      fillGrain(ctx, rc, 'grain', 0.8);
    }
    if (o.variant === 'meadow' && rc.lod >= 8) meadowDots(ctx, rc, () => tracePath(ctx, pts, true));
    tracePath(ctx, pts, true);
    if (rc.mono) ink(ctx, rc, 0.5, 0.6); else edge(ctx, rgba(C[2], 0.8), rc.px(0.6));
  },
  'area-paving'(ctx, o, pts, C, rc) {
    tracePath(ctx, pts, true);
    ctx.fillStyle = C[0];
    ctx.fill();
    ctx.save(); ctx.clip();
    const module = o.variant === 'pavers' ? 250 : o.variant === 'concrete' ? 3000 : 500;
    alignedFill(ctx, pts, (c, x, y, w, h) => tiles(c, x, y, w, h, module, C, rc, o.variant === 'concrete' ? null : rc.rand));
    ctx.restore();
    tracePath(ctx, pts, true);
    ink(ctx, rc, 0.8, 0.85);
  },
  'area-gravel'(ctx, o, pts, C, rc) {
    tracePath(ctx, pts, true);
    ctx.fillStyle = C[0];
    ctx.fill();
    if (rc.lod >= 4) fillGrain(ctx, rc, 'gravel');
    if (o.variant === 'white' && rc.lod >= 5) {
      // Японский гравий: следы грабель — волны вдоль длинной стороны.
      ctx.save();
      tracePath(ctx, pts, true);
      ctx.clip();
      ctx.strokeStyle = seam(rc, 0.28);
      ctx.lineWidth = rc.px(0.5);
      alignedFill(ctx, pts, (c, x, y, w, h) => {
        for (let yy = y + 150; yy < y + h; yy += 220) {
          c.beginPath();
          for (let xx = x; xx <= x + w; xx += 200) {
            const wy = yy + Math.sin(xx / 900) * 60;
            if (xx === x) c.moveTo(xx, wy); else c.lineTo(xx, wy);
          }
          c.stroke();
        }
      });
      ctx.restore();
    }
    tracePath(ctx, pts, true);
    ink(ctx, rc, 0.6, 0.55);
  },
  'area-deck'(ctx, o, pts, C, rc) {
    tracePath(ctx, pts, true);
    ctx.save(); ctx.clip();
    // Доски вдоль длинного ребра (boards кладёт их вдоль большей стороны).
    alignedFill(ctx, pts, (c, x, y, w, h) => boards(c, x, y, w, h, C, rc.rand, rc));
    ctx.restore();
    tracePath(ctx, pts, true);
    ink(ctx, rc, 0.8, 0.85);
  },
  'area-pond'(ctx, o, pts, C, rc) {
    const c = centroid(pts);
    const b = boxOf(pts);
    const r = Math.max(b.w, b.h) / 2;
    tracePath(ctx, pts, true);
    const g = ctx.createRadialGradient(c.x - r * 0.2, c.y - r * 0.2, 0, c.x, c.y, r);
    g.addColorStop(0, C[2]); g.addColorStop(0.6, C[0]); g.addColorStop(1, C[1]);
    waterFill(ctx, rc, rc.mono ? C[0] : g);
    tracePath(ctx, pts, true);
    waterEdge(ctx, rc, C);
    if (rc.lod < 5) return;
    if (o.variant !== 'mirror' && rc.lod >= 6) {
      const lily = [];
      for (let i = 0; i < 40 && lily.length < 8; i += 1) {
        const x = b.x + rc.rand() * b.w; const y = b.y + rc.rand() * b.h;
        if (pointInPolygon({ x, y }, pts)) lily.push({ x, y });
      }
      ctx.save();
      tracePath(ctx, pts, true);
      ctx.clip();
      lilies(ctx, rc, lily);
      ctx.restore();
    }
    // Берег из камней по контуру.
    const closed = [...pts, pts[0]];
    const total = polylineLength(closed);
    const n = Math.max(10, Math.round(total / 360));
    for (let i = 0; i < n; i += 1) {
      const p = pointAlong(closed, (total * i) / n);
      pebble(ctx, rc, p.x, p.y, 120 + rc.rand() * 150, rc.P.stone[i % 3]);
    }
  },
  'area-pool'(ctx, o, pts, C, rc) {
    const coping = 350;
    ctx.lineJoin = 'miter';
    tracePath(ctx, pts, true);
    // Внешний край каймы — тонкий контур (кайма ляжет сверху).
    ctx.strokeStyle = rgba(rc.ink, 0.75);
    ctx.lineWidth = coping * 2 + rc.px(0.7) * 2;
    ctx.stroke();
    ctx.strokeStyle = rc.P.coping[0];
    ctx.lineWidth = coping * 2;
    ctx.stroke();
    if (rc.lod >= 8) {
      // Швы плитки каймы.
      ctx.strokeStyle = seam(rc, 0.25);
      ctx.setLineDash([12, 588]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const b = boxOf(pts);
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.3, b.y + b.h);
    g.addColorStop(0, C[2]); g.addColorStop(0.4, C[0]); g.addColorStop(1, C[1]);
    tracePath(ctx, pts, true);
    waterFill(ctx, rc, rc.mono ? C[0] : g);
    tracePath(ctx, pts, true);
    waterEdge(ctx, rc, C);
  },
};

// ------------------------------------------------------------ Конструктивы
// Клумба-короб, наружная лестница, бордюр. В «Эскизе» — верх борта светлый,
// боковая грань (условный «отброс» в сторону тени) с тёмной штриховкой,
// тень борта на засыпку; в «Чертеже» — двойная линия борта, без теней.

const FILL_COLORS = { soil: 'soil', mulch: 'mulch', gravel: 'gravel' };
const FLOWER_COLORS = {
  mixed: ['#c9a2b6', '#d8c08c', '#b3a4c8', '#f1ede6', '#d5b39b'],
  lavender: ['#a99cc4', '#9b8fbf', '#bdb3d4'],
  roses: ['#c08b98', '#d3a3ad', '#b07685'],
  echinacea: ['#c98fa6', '#d6a0b3', '#b7798f'],
  white: ['#f4f1ea', '#e9e5da', '#ffffff'],
};

const shiftPts = (pts, d, k = 1) => pts.map((p) => ({ x: p.x + d.x * k, y: p.y + d.y * k }));

// Штриховка текущего пути (clip) параллельными линиями под 45°.
function hatch(ctx, rc, box, step, alpha = 0.35, w = 0.5) {
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(rc.ink, alpha);
  ctx.lineWidth = rc.px(w);
  ctx.beginPath();
  const span = box.w + box.h;
  for (let s = 0; s <= span; s += step) {
    ctx.moveTo(box.x + s, box.y);
    ctx.lineTo(box.x + s - box.h, box.y + box.h);
  }
  ctx.stroke();
  ctx.restore();
}

const ptsBox = (pts) => {
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

// Короб по контуру outer (верх борта) и inner (засыпка) в текущих осях;
// sd — направление тени (единичный вектор в этих осях).
function drawPlanterBody(ctx, o, outer, inner, C, rc, sd) {
  const H = Math.max(0, o.height || 0);
  const fillKey = FILL_COLORS[o.meta?.fill] || 'soil';
  const F = rc.P[fillKey] || rc.P.soil;
  const wall = Math.abs(outer[0].x - inner[0].x) + Math.abs(outer[0].y - inner[0].y);
  // Ни подложки-тени, ни «боковой грани»: тень — только настоящая, по солнцу.
  // Верх борта — кольцо между outer и inner.
  ctx.beginPath();
  outer.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  inner.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = rc.mono ? rc.pal.paper : C[0];
  ctx.fill('evenodd');
  if (!rc.mono && rc.lod >= 6) {
    ctx.save();
    ctx.clip('evenodd');
    if (o.variant === 'stone' || o.variant === 'wood') {
      // Швы камня поперёк борта / доски вдоль борта.
      ctx.strokeStyle = seam(rc, 0.3);
      ctx.lineWidth = rc.px(0.45);
      ctx.beginPath();
      const n = outer.length;
      for (let i = 0; i < n; i += 1) {
        const a = outer[i]; const b = outer[(i + 1) % n];
        const ia = inner[i]; const ib = inner[(i + 1) % n];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (o.variant === 'wood') {
          ctx.moveTo((a.x + ia.x) / 2, (a.y + ia.y) / 2); ctx.lineTo((b.x + ib.x) / 2, (b.y + ib.y) / 2);
        } else {
          const k = Math.max(1, Math.round(len / 450));
          for (let j = 1; j < k; j += 1) {
            const t = j / k + (j % 2 ? 0.02 : -0.02);
            ctx.moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            ctx.lineTo(ia.x + (ib.x - ia.x) * t, ia.y + (ib.y - ia.y) * t);
          }
        }
      }
      ctx.stroke();
    } else {
      fillGrain(ctx, rc, 'gravel', o.variant === 'corten' ? 0.5 : 0.25);
    }
    ctx.restore();
  }
  // Засыпка.
  tracePath(ctx, inner, true);
  ctx.fillStyle = rc.mono ? rc.pal.paper : F[0];
  ctx.fill();
  if (rc.lod >= 3) {
    tracePath(ctx, inner, true);
    fillGrain(ctx, rc, fillKey === 'gravel' ? 'gravel' : 'grain', rc.mono ? 0.8 : fillKey === 'soil' ? 0.9 : 0.7);
  }
  if (!rc.mono && H > 0) {
    // Тень борта на засыпку: засыпка минус её сдвиг от стенки к тени.
    const sh = Math.min(H * 0.45, 260, Math.max(30, wall * 2));
    ctx.save();
    tracePath(ctx, inner, true);
    ctx.clip();
    ctx.beginPath();
    const big = ptsBox(inner);
    ctx.rect(big.x - 1e4, big.y - 1e4, big.w + 2e4, big.h + 2e4);
    const sp = shiftPts(inner, sd, sh);
    sp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = rc.pal.shadow;
    ctx.globalAlpha = 0.3;
    ctx.fill('evenodd');
    ctx.restore();
  }
  // Графика: двойная линия борта.
  tracePath(ctx, outer, true);
  ink(ctx, rc, rc.mono ? 1 : 0.9, 0.95);
  tracePath(ctx, inner, true);
  ink(ctx, rc, rc.mono ? 0.7 : 0.6, 0.85);
}

const rectPts = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

// Лента бордюра по линиям [{ pts, closed }], ширина w, высота h, краски C.
function drawCurbLines(ctx, lines, w, h, C, rc, sd) {
  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.lineCap = 'butt';
  for (const { pts, closed } of lines) {
    // Подложки-тени у бордюра нет (настоящая — по солнцу).
    tracePath(ctx, pts, closed);
    ctx.strokeStyle = rc.ink;
    ctx.lineWidth = w + rc.px(rc.mono ? 1.6 : 1.3);
    ctx.stroke();
    ctx.strokeStyle = rc.mono ? rc.pal.paper : C[0];
    ctx.lineWidth = Math.max(w - rc.px(0.2), rc.px(0.6));
    ctx.stroke();
    // Швы через ~1 м (бетонный/каменный бордюр).
    if (rc.lod >= 8 && w * rc.k >= 3) {
      const total = polylineLength(pts, closed);
      const path = closed ? [...pts, pts[0]] : pts;
      ctx.strokeStyle = seam(rc, 0.45);
      ctx.lineWidth = rc.px(0.45);
      ctx.beginPath();
      for (let s = 1000; s < total - 200; s += 1000) {
        const [p, q] = crossAt(path, s, w / 2);
        ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Бордюр по периметру дорожки/площади (поле curb хозяина), мир.
function drawHostCurb(ctx, o, opts) {
  const lines = curbLines(o);
  if (!lines.length) return;
  const base = baseContext(opts);
  const sd = opts.shadow ? { x: opts.shadow.x, y: opts.shadow.y } : { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const C = objectColors({ kind: 'curb', variant: o.curb.variant }).map(base.c);
  drawCurbLines(ctx, lines, o.curb.width, o.curb.height, C, base, sd);
}

const BUILD_LOOKS = {
  planter(ctx, o, a, b, C, rc) {
    const wall = planterWall(o);
    drawPlanterBody(ctx, o, rectPts(-a, -b, a, b), rectPts(-a + wall, -b + wall, a - wall, b - wall), C, rc, rc.shadowLocal);
  },
  // Наружная лестница: ступени поперёк, «вверх» — к −Y (стрелка), борта по бокам.
  stairs(ctx, o, a, b, C, rc) {
    const st = stairsInfo(o);
    const n = Math.max(1, st.steps);
    const t = (b * 2) / n;
    const cw = st.cheek;
    const x0 = -a + cw; const x1 = a - cw;
    const sd = rc.shadowLocal;
    // Ступени: снизу (+Y) вверх, выше — чуть светлее.
    for (let i = 0; i < n; i += 1) {
      const yb = b - i * t; const yt = yb - t;
      ctx.fillStyle = rc.mono ? rc.pal.paper : C[0];
      ctx.fillRect(x0, yt, x1 - x0, t);
      if (!rc.mono) {
        ctx.fillStyle = `rgba(255,255,255,${(0.22 * i) / n})`;
        ctx.fillRect(x0, yt, x1 - x0, t);
        // Притенение у подступенка следующей ступени (мягкий градиент).
        if (i < n - 1) {
          const g = ctx.createLinearGradient(0, yt, 0, yt + t * 0.45);
          g.addColorStop(0, rgba(rc.pal.shadow, 0.32));
          g.addColorStop(1, rgba(rc.pal.shadow, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x0, yt, x1 - x0, t * 0.45);
        }
        if (rc.lod >= 6) {
          ctx.strokeStyle = seam(rc, 0.28);
          ctx.lineWidth = rc.px(0.4);
          ctx.beginPath();
          if (o.variant === 'wood') {
            for (const k of [1 / 3, 2 / 3]) { ctx.moveTo(x0, yt + t * k); ctx.lineTo(x1, yt + t * k); }
          } else if (o.variant === 'stone') {
            const R = seededRandom(`${o.id}:${i}`);
            for (let x = x0 + 450 + R() * 300; x < x1 - 200; x += 500 + R() * 400) { ctx.moveTo(x, yt); ctx.lineTo(x, yb); }
          }
          ctx.stroke();
        }
      }
    }
    if (!rc.mono && rc.lod >= 4 && o.variant === 'concrete') {
      ctx.beginPath(); ctx.rect(x0, -b, x1 - x0, b * 2);
      fillGrain(ctx, rc, 'gravel', 0.22);
    }
    // Тень борта на ступени.
    if (cw > 0 && !rc.mono && Math.abs(sd.x) > 0.1) {
      const ws = Math.min((x1 - x0) * 0.25, 200);
      ctx.fillStyle = rgba(rc.pal.shadow, 0.22);
      if (sd.x > 0) ctx.fillRect(x0, -b, ws, b * 2); else ctx.fillRect(x1 - ws, -b, ws, b * 2);
    }
    // Рёбра ступеней (носики).
    ctx.beginPath();
    for (let i = 1; i < n; i += 1) { const y = b - i * t; ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ink(ctx, rc, 0.8, 0.95);
    // Борта — как стенка короба: верх и двойная линия.
    if (cw > 0) {
      for (const [l, r] of [[-a, x0], [x1, a]]) {
        ctx.beginPath(); ctx.rect(l, -b, r - l, b * 2);
        ctx.fillStyle = rc.mono ? rc.pal.paper : C[2];
        ctx.fill();
        ink(ctx, rc, 0.8, 0.9);
      }
    }
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2);
    ink(ctx, rc, rc.mono ? 1 : 0.9, 0.95);
    // Стрелка «вверх»: точка у нижней ступени, остриё у верхней.
    const fw = x1 - x0;
    const y0 = b - Math.min(t * 0.5, b * 0.4);
    const yEnd = -b + Math.min(t * 0.3, b * 0.2);
    const head = Math.min(fw * 0.18, t * 0.7, 220);
    ctx.strokeStyle = rc.ink;
    ctx.fillStyle = rc.ink;
    ctx.lineWidth = rc.px(0.9);
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(0, yEnd + head * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, yEnd); ctx.lineTo(-head * 0.45, yEnd + head); ctx.lineTo(head * 0.45, yEnd + head); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, y0, Math.max(rc.px(1.8), Math.min(60, fw * 0.03)), 0, TAU); ctx.fill();
  },
  // Куртина цветов: зелёная подушка с цветками.
  flowers(ctx, o, a, b, C, rc) {
    const R = rc.rand;
    const mound = new Path2D();
    scallopPath(mound, 0, 0, a * 0.95, b * 0.95, 9, 0.12, R);
    if (rc.mono) { monoCrown(ctx, rc, mound, Math.min(a, b) * 0.6); return; }
    wash(ctx, rc, mound, a, b, C, 0.82);
    const colors = (FLOWER_COLORS[o.variant] || FLOWER_COLORS.mixed).map(rc.c);
    ctx.save(); ctx.clip(mound);
    const n = Math.max(10, Math.min(46, Math.round((a * b) / 9000)));
    for (let i = 0; i < n; i += 1) {
      const t = R() * TAU; const d = Math.sqrt(R()) * 0.82;
      circle(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, Math.max(rc.px(0.9), a * (0.05 + R() * 0.05)), colors[i % colors.length]);
    }
    ctx.restore();
    ink(ctx, rc, 0.55, 0.7, mound);
  },
};

// Шаг швов верха стенки по материалу, мм (камень — неровный).
const WALL_JOINT = { concrete: 3000, corten: 2000, gabion: 1000, stone: 0 };

// Подпорная стенка (мир). «Эскиз»: со стороны низа — видимая грань
// (притенена, штриховка), верх светлый с фактурой,
// капа шире тела; «Чертёж»: двойная линия, кромка низа толще, штрихи от неё
// в сторону низа (длинный/короткий поочерёдно) — условный знак перепада.
function drawRetaining(ctx, o, C, rc) {
  const ri = retainingInfo(o);
  const e = retainingEdges(o);
  if (!e.lower || !e.upper || e.lower.length < 2 || e.upper.length < 2) return;
  const H = ri.height;
  const lowN = (angle) => ({ x: -Math.sin(angle) * e.lowSign, y: Math.cos(angle) * e.lowSign });
  if (!rc.mono && H > 0) {
    const face = Math.min(320, Math.max(60, H * 0.16));
    const far = retainingEdges(o, ri.thick + face * 2).lower;
    // Подложки-тени у подножия нет — только видимая грань (тень — по солнцу).
    // Видимая грань: цвет боковины, притенение, штриховка.
    const poly = [...e.lower, ...[...far].reverse()];
    tracePath(ctx, poly, true);
    ctx.fillStyle = C[1];
    ctx.fill();
    ctx.fillStyle = rgba(rc.pal.shadow, 0.22);
    ctx.fill();
    hatch(ctx, rc, ptsBox(poly), Math.max(rc.px(3.5), 30), 0.45, 0.5);
    tracePath(ctx, far, false);
    ink(ctx, rc, 0.5, 0.55);
  }
  // Верх (капа — шире тела на свес).
  const top = ri.cap ? retainingEdges(o, ri.capW).outline : e.outline;
  tracePath(ctx, top, true);
  ctx.fillStyle = rc.mono ? rc.pal.paper : C[2] || C[0];
  ctx.fill();
  if (!rc.mono && rc.lod >= 4) {
    ctx.save();
    tracePath(ctx, top, true);
    ctx.clip();
    if (o.variant === 'gabion' || o.variant === 'corten' || o.variant === 'concrete') {
      tracePath(ctx, top, true);
      fillGrain(ctx, rc, 'gravel', o.variant === 'gabion' ? 0.9 : o.variant === 'corten' ? 0.45 : 0.25);
    }
    const axis = objectPath(o);
    const total = polylineLength(axis);
    const hw = (ri.cap ? ri.capW : ri.thick) / 2 + 20;
    ctx.strokeStyle = seam(rc, o.variant === 'gabion' ? 0.5 : 0.35);
    ctx.lineWidth = rc.px(0.5);
    ctx.beginPath();
    const R = seededRandom(`${o.id}:wall`);
    const step = WALL_JOINT[o.variant] || 0;
    for (let s = step || 350 + R() * 300; s < total - 80; s += step || 350 + R() * 350) {
      const [p, q] = crossAt(axis, s, hw);
      ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    }
    if (o.variant === 'gabion') { // сетка корзин: продольный шов по оси
      axis.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    }
    ctx.stroke();
    ctx.restore();
  }
  if (ri.cap) {
    tracePath(ctx, top, true);
    ink(ctx, rc, rc.mono ? 0.6 : 0.5, 0.7);
  }
  // Графика: кромка верха тоньше, кромка низа толще, торцы.
  tracePath(ctx, e.upper, false);
  ink(ctx, rc, rc.mono ? 0.9 : 0.8, 0.9);
  tracePath(ctx, e.lower, false);
  ink(ctx, rc, rc.mono ? 1.5 : 1.1, 0.95);
  ctx.beginPath();
  ctx.moveTo(e.upper[0].x, e.upper[0].y); ctx.lineTo(e.lower[0].x, e.lower[0].y);
  const ul = e.upper[e.upper.length - 1]; const ll = e.lower[e.lower.length - 1];
  ctx.moveTo(ul.x, ul.y); ctx.lineTo(ll.x, ll.y);
  ink(ctx, rc, rc.mono ? 0.9 : 0.8, 0.9);
  if (rc.mono && H > 0) {
    // Штрихи в сторону низа (как у откоса): шаг и длина — с запасом по масштабу.
    const total = polylineLength(e.lower);
    const step = Math.max(rc.px(9), 300);
    const long = Math.max(rc.px(8), Math.min(700, Math.max(250, H * 0.35)));
    ctx.beginPath();
    let i = 0;
    for (let s = step / 2; s < total - step * 0.2; s += step, i += 1) {
      const p = pointAlong(e.lower, s);
      const n = lowN(p.angle);
      const len = i % 2 ? long * 0.5 : long;
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + n.x * len, p.y + n.y * len);
    }
    ink(ctx, rc, 0.7, 0.95);
  }
}

const BUILD_SHAPE_LOOKS = {
  retaining(ctx, o, pts, C, rc) { drawRetaining(ctx, o, C, rc); },
  'planter-area'(ctx, o, pts, C, rc) {
    const outer = pts.map(({ x, y }) => ({ x, y }));
    const inner = insetPolygon(outer, planterWall(o));
    drawPlanterBody(ctx, o, outer, inner, C, rc, { x: -rc.light.x, y: -rc.light.y });
  },
  curb(ctx, o, pts, C, rc) {
    drawCurbLines(ctx, [{ pts, closed: false }], o.width || 100, o.height || 0, C, rc, { x: -rc.light.x, y: -rc.light.y });
  },
};

Object.assign(LOOKS, BUILD_LOOKS);
Object.assign(SHAPE_LOOKS, BUILD_SHAPE_LOOKS);

// Общая часть контекста рисования: стиль, палитра, плотность пикселей.
// opts: { px, lod, shadow, style?, dark?, pal?, dpr? }.
function baseContext(opts) {
  const pal = opts.pal || lsPalette(opts.style || 'sketch', Boolean(opts.dark));
  const dpr = opts.dpr || globalThis.devicePixelRatio || 1;
  return {
    px: opts.px, lod: opts.lod, pal, P: pal.P, c: pal.c, ink: pal.ink, mono: pal.mono, dpr,
    // Падающие тени считает core/landscape-shadow.js (режим «Солнце» или
    // «Выкл») — свои условные тени у подножия объекты не рисуют.
    cast: !opts.sunShadows,
    k: (opts.lod / 1000) * dpr, // device px на мм
  };
}

function drawShapeObject(ctx, o, def, opts) {
  const look = SHAPE_LOOKS[def.look] || SHAPE_LOOKS[def.shape === 'line' ? 'path' : 'area-paving'];
  const pts = objectPath(o);
  if (pts.length < 2) return;
  const base = baseContext(opts);
  const lightWorld = opts.shadow ? { x: -opts.shadow.x, y: -opts.shadow.y } : { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  const rc = { ...base, rand: seededRandom(o.id), light: lightWorld };
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  try {
    look(ctx, o, pts, objectColors(o, def).map(base.c), rc);
  } finally {
    ctx.restore();
  }
  if (o.curb) drawHostCurb(ctx, o, opts);
}

// Силуэт для тени (локальные оси объекта).
function silhouette(ctx, o, def, a, b) {
  ctx.beginPath();
  if (def.look === 'pine' || def.look === 'spruce') starPath(ctx, a, b, 16, 0.88);
  else if (def.look === 'lamp' || def.look === 'grass') ellipse(ctx, 0, 0, a * 0.6, b * 0.6);
  else if (isRoundObject(o, def) || def.shape === 'point') ellipse(ctx, 0, 0, a, b);
  else if (def.look === 'fence' || def.look === 'gate') ctx.rect(-a, -Math.max(b, 60), a * 2, Math.max(b, 60) * 2);
  else rrect(ctx, -a, -b, a * 2, b * 2, Math.min(a, b) * 0.15);
}

// ------------------------------------------------------------ Солнце и тени

// Направление тени в мире (единичный вектор) и длина на метр высоты.
// Солнце включено — по его азимуту и высоте; иначе по северу участка
// (солнце с юго-запада, тень на северо-восток); участка нет — вниз-вправо.
export function landscapeShadow(site) {
  if (site?.sun?.enabled && site.location) {
    const s = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
    if (s.altitude > 2) {
      const ang = (((site.north || 0) + s.azimuth + 180) * Math.PI) / 180;
      return { x: Math.sin(ang), y: -Math.cos(ang), k: Math.min(2.2, 1 / Math.tan((s.altitude * Math.PI) / 180)) * 0.35 };
    }
  }
  if (site?.boundary?.length >= 3) {
    const ang = (((site.north || 0) + 30) * Math.PI) / 180;
    return { x: Math.sin(ang), y: -Math.cos(ang), k: 0.3 };
  }
  return { x: Math.SQRT1_2, y: Math.SQRT1_2, k: 0.3 };
}

function shadowOffset(height, shadow) {
  const len = Math.min(5000, Math.max(120, height * shadow.k));
  return { x: shadow.x * len, y: shadow.y * len };
}

// Мягкая длинная тень: силуэт, протянутый по направлению от солнца, с
// размытием — спрайт в кеше; серо-зелёная, полупрозрачная. В «Чертеже» — нет.
// Условная тень — только у растений (крона с полутенью — часть рисунка).
// Короба, бордюры, площадки, стенки, лестницы, мебель и постройки её не
// рисуют: их объём — в гранях, настоящая тень — по солнцу (core/landscape-shadow.js).
export const DROP_SHADOW_LOOKS = new Set(['deciduous', 'fruit', 'pine', 'spruce', 'thuja', 'bonsai', 'ball', 'shrub', 'juniper', 'grass', 'flowers', 'hedge', 'hedge-line']);
export const hasDropShadow = (def) => Boolean(def?.shadow && DROP_SHADOW_LOOKS.has(def.look));

function drawShadow(ctx, o, def, shadow, rc) {
  if (rc.mono || !hasDropShadow(def)) return;
  const off = shadowOffset(o.height || def.height, shadow);
  const color = rc.pal.shadow;
  if (def.shape === 'line') {
    // Линия (изгородь, забор): тень — сдвинутая ось той же толщины.
    const path = objectPath(o);
    ctx.save();
    ctx.translate(off.x * 0.5, off.y * 0.5);
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [k, alpha] of [[1.6, 0.05], [1.15, 0.08]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(o.width || def.h, 120) * k;
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const a = o.w / 2; const b = o.h / 2;
  const A = Math.max(a, b);
  const dev = 2 * A * rc.k;
  const rot = ((o.rotation || 0) * Math.PI) / 180;
  if (dev < 6 || typeof document === 'undefined') {
    ctx.save();
    ctx.translate(o.x + off.x * 0.6, o.y + off.y * 0.6);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.14;
    silhouette(ctx, o, def, a, b);
    ctx.fill();
    ctx.restore();
    return;
  }
  const round = isRoundObject(o, def) || def.shape === 'point';
  const { b: bk, px: bpx } = sizeBucket(dev);
  const sk = bpx / (2 * A);
  const len = Math.hypot(off.x, off.y) * sk;
  const ang = Math.atan2(off.y, off.x);
  const angQ = Math.round(ang / (Math.PI / 30)) * (Math.PI / 30);
  const lenQ = Math.max(1, Math.round(Math.log(Math.max(len, 1)) / Math.log(1.15)));
  const lenPx = 1.15 ** lenQ;
  const rotQ = round ? 0 : Math.round(rot / (Math.PI / 36)) * (Math.PI / 36);
  const aspect = Math.round((b / a) * 20) / 20;
  const key = `sh|${def.look}|${round ? 'r' : 'q'}|${aspect}|${bk}|${angQ.toFixed(3)}|${lenQ}|${rotQ.toFixed(3)}|${rc.pal.dark ? 1 : 0}`;
  const offPx = { x: Math.cos(angQ) * lenPx, y: Math.sin(angQ) * lenPx };
  const diag = 2 * Math.hypot(a, b) * sk * 1.05;
  const sp = shadowSprite(key, round ? 2 * a * sk * 1.1 : diag, round ? 2 * b * sk * 1.1 : diag, offPx, color, (g) => {
    g.rotate(rotQ);
    g.scale(sk, sk);
    silhouette(g, o, def, a * 0.96, b * 0.96);
  });
  if (!sp) return;
  ctx.save();
  ctx.globalAlpha *= 0.26;
  ctx.drawImage(sp.cv, o.x - sp.ox / sk, o.y - sp.oy / sk, sp.cv.width / sk, sp.cv.height / sk);
  ctx.restore();
}

function renderContext(o, opts) {
  const a = -((o.rotation || 0) * Math.PI) / 180;
  const rot = (x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const lightWorld = opts.shadow ? { x: -opts.shadow.x, y: -opts.shadow.y } : { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  return {
    ...baseContext(opts),
    rand: seededRandom(o.id),
    light: rot(lightWorld.x, lightWorld.y),
    shadowLocal: rot(-lightWorld.x, -lightWorld.y),
  };
}

// Растения сверху — спрайты: крона рисуется один раз на (вид, вариант,
// размер в px, вариант рисунка, стиль, тема) и ставится drawImage.
// Рисунок ветвей — 4 варианта по id, поворот — свой у каждого дерева.
const SPRITE_LOOKS = new Set(['deciduous', 'fruit', 'pine', 'spruce', 'thuja', 'bonsai', 'ball', 'shrub', 'juniper', 'grass', 'flowers']);
const hasSprites = typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';

function drawPlant(ctx, o, def, C, rc) {
  const look = LOOKS[def.look];
  const a = o.w / 2; const b = o.h / 2;
  const A = Math.max(a, b);
  const dev = 2 * A * rc.k;
  if (dev < 6) {
    // Далеко: простое пятно.
    ctx.beginPath(); ellipse(ctx, 0, 0, a, b);
    ctx.fillStyle = rc.mono ? rc.pal.paper : C[1];
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (rc.mono ? 1 : 0.85);
    ctx.fill();
    ctx.globalAlpha = prev;
    if (rc.mono || dev >= 3) ink(ctx, rc, 0.5, 0.7);
    return;
  }
  const h = hashStr(o.id);
  const seed = h % 4;
  const round = Math.abs(a - b) < 1;
  const { b: bk, px: bpx } = sizeBucket(dev);
  const aspect = round ? 1 : Math.round((b / a) * 20) / 20;
  const key = `p|${def.look}|${o.kind}|${o.variant}|${C.join(',')}|${aspect}|${bk}|${seed}|${rc.pal.style}${rc.pal.dark ? 1 : 0}`;
  const sk = bpx / (2 * A); // device px на мм в спрайте
  const W = 2 * a * sk * 1.16 + 6;
  const H = 2 * b * sk * 1.16 + 6;
  const cv = hasSprites ? cachedSprite(key, W, H, (g, w, hh) => {
    g.translate(w / 2, hh / 2);
    g.scale(sk, sk);
    const src = {
      ...rc, px: (v) => (v * rc.dpr) / sk, dpx: bpx / rc.dpr, seed,
      rand: seededRandom(`${def.look}:${o.kind}:${o.variant}:${seed}`), light: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
    };
    look(g, o, a, b, C, src);
  }) : null;
  if (!cv) { look(ctx, o, a, b, C, { ...rc, seed }); return; }
  if (round) ctx.rotate((((h >>> 8) % 360) * Math.PI) / 180);
  ctx.drawImage(cv, -cv.width / 2 / sk, -cv.height / 2 / sk, cv.width / sk, cv.height / sk);
}

// Объект целиком вне холста? Габарит в мире → экран по текущей матрице ctx.
// extra — запас (мм) на тень и выступы. Без getTransform — считаем видимым.
export function isOffscreen(ctx, o, def, extra = 0) {
  if (!ctx.getTransform || !ctx.canvas || !(ctx.canvas.width > 0)) return false;
  let x0; let x1; let y0; let y1;
  if (Array.isArray(o.points) && o.points.length) {
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
    for (const p of o.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const pad = (o.width || 0) + extra;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  } else {
    const r = Math.hypot(o.w || 0, o.h || o.w || 0) / 2 + extra + (def?.height || 0) * 0.5;
    x0 = o.x - r; x1 = o.x + r; y0 = o.y - r; y1 = o.y + r;
  }
  if (![x0, x1, y0, y1].every(Number.isFinite)) return false;
  const m = ctx.getTransform();
  let sx0 = Infinity; let sx1 = -Infinity; let sy0 = Infinity; let sy1 = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
    const px = m.a * x + m.c * y + m.e;
    const py = m.b * x + m.d * y + m.f;
    sx0 = Math.min(sx0, px); sx1 = Math.max(sx1, px); sy0 = Math.min(sy0, py); sy1 = Math.max(sy1, py);
  }
  return sx1 < 0 || sy1 < 0 || sx0 > ctx.canvas.width || sy0 > ctx.canvas.height;
}

export function drawLandscapeObject(ctx, o, opts) {
  const def = landscapeDef(o.kind);
  if (!def) return;
  if (def.shape !== 'note' && isOffscreen(ctx, o, def, 1500)) return;
  if (isPathShape(def)) { drawShapeObject(ctx, o, def, opts); return; }
  if (def.shape === 'note') { drawCallout(ctx, o, opts); return; }
  const look = LOOKS[def.look] || LOOKS.pad;
  const rc = renderContext(o, opts);
  const C = objectColors(o, def).map(rc.c);
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.translate(o.x, o.y);
  ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
  try {
    if (SPRITE_LOOKS.has(def.look) && opts.sprites !== false) drawPlant(ctx, o, def, C, rc);
    else look(ctx, o, o.w / 2, o.h / 2, C, rc);
  } finally {
    ctx.restore();
  }
  if (o.curb) drawHostCurb(ctx, o, opts);
}

// Порядок внутри слоя: площади → линии → прочие (SHAPE_RANK), затем порядок
// добавления; посадки в коробе (parent) — после всего слоя, поверх короба.
const rankOf = (x) => (SHAPE_RANK[x.def.shape] ?? 2) + (x.o.parent ? 3 : 0);
function layerObjects(objects, layer) {
  return objects
    .map((o, i) => ({ o, i, def: landscapeDef(o.kind) }))
    .filter((x) => x.def?.layer === layer)
    .sort((a, b) => rankOf(a) - rankOf(b) || a.i - b.i)
    .map((x) => x.o);
}

// Видимость групп (панель «Слои»): vis — { plants, covers, objects, shadows, labels }.
export function visibleLandscape(objects, vis) {
  if (!vis) return objects;
  return objects.filter((o) => vis[landscapeDef(o.kind)?.vis] !== false);
}

// Газон-основа участка («Эскиз» — светлая зелень с зерном; «Чертёж» —
// редкий пунктир). Полупрозрачно: подложка-съёмка остаётся видна.
export function drawLandscapeSiteBase(ctx, boundary, opts) {
  if (!boundary || boundary.length < 3) return;
  const rc = baseContext(opts);
  ctx.save();
  ctx.beginPath();
  boundary.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.globalAlpha = rc.mono ? 0.8 : 0.72;
  ctx.fillStyle = rc.pal.ground;
  ctx.fill();
  ctx.globalAlpha = 1;
  if (rc.lod >= 2) fillGrain(ctx, rc, 'grain', rc.mono ? 0.7 : 1);
  ctx.restore();
}

// Покрытия — до дома; opts: { px, lod, shadow, style, dark }.
export function drawLandscapeGround(ctx, objects, opts) {
  for (const o of layerObjects(objects, 'ground')) drawLandscapeObject(ctx, o, opts);
}

// Тень дома на землю — до заливки пятна дома (render.js), иначе ляжет на крышу.
// Протянута от стены (несколько сдвигов одним путём), серо-зелёная.
export function drawHouseShadow(ctx, footprints, opts, height = 6000) {
  const rc = baseContext(opts);
  if (!footprints.length || opts.lod < 1.5 || rc.mono) return;
  const off = shadowOffset(height, opts.shadow);
  ctx.save();
  ctx.fillStyle = rc.pal.shadow;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  for (let i = 1; i <= 10; i += 1) {
    const t = i / 10;
    for (const f of footprints) {
      f.forEach((p, i) => (i ? ctx.lineTo(p.x + off.x * t, p.y + off.y * t) : ctx.moveTo(p.x + off.x * t, p.y + off.y * t)));
      ctx.closePath();
    }
  }
  ctx.fill('nonzero'); // одним путём: перекрытия не темнеют дважды
  ctx.restore();
}

// ------------------------------------------------------------ Тени по солнцу

// Узор штриховки тени для «Чертежа» — в пикселях экрана (не масштабируется).
const hatchCache = new Map();
function shadowHatch(ctx, ink, dpr) {
  const step = Math.max(4, Math.round(5 * dpr));
  const key = `${ink}|${step}`;
  let pat = hatchCache.get(key);
  if (pat) return pat;
  let cv;
  try {
    cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(step, step) : document.createElement('canvas');
  } catch { return null; }
  cv.width = step; cv.height = step;
  const g = cv.getContext('2d');
  g.strokeStyle = ink;
  g.lineWidth = Math.max(0.7, 0.6 * dpr);
  g.beginPath();
  // Диагональ 45° с продолжением в соседние плитки — без разрывов.
  for (const o of [-step, 0, step]) { g.moveTo(o, step); g.lineTo(o + step, 0); }
  g.stroke();
  pat = ctx.createPattern(cv, 'repeat');
  if (hatchCache.size > 16) hatchCache.clear();
  hatchCache.set(key, pat);
  return pat;
}

// Тени по солнцу (core/landscape-shadow.js): все полигоны одним путём
// (одна ориентация → nonzero объединяет, перекрытия не темнеют дважды).
// Рисуются после покрытий и до дома/объектов — только на земле.
// «Эскиз» — полупрозрачно и мягко (размытие края, пока не тянут ползунок);
// «Чертёж» — светлая заливка и сплошная штриховка 45°.
export function drawSunShadows(ctx, polys, opts, { simple = false } = {}) {
  if (!polys?.length) return;
  const rc = baseContext(opts);
  ctx.save();
  ctx.beginPath();
  for (const s of polys) {
    const p = s.poly;
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i += 1) ctx.lineTo(p[i].x, p[i].y);
    ctx.closePath();
  }
  if (rc.mono) {
    // Путь уже в пикселях: узор — в осях экрана.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = rc.pal.dark ? 0.22 : 0.1;
    ctx.fillStyle = rc.ink;
    ctx.fill('nonzero');
    const pat = shadowHatch(ctx, rc.ink, rc.dpr);
    if (pat) {
      ctx.globalAlpha = rc.pal.dark ? 0.6 : 0.55;
      ctx.fillStyle = pat;
      ctx.fill('nonzero');
    }
  } else {
    const blur = simple ? 0 : Math.min(6, Math.max(0, rc.k * 90));
    if (blur >= 0.8 && 'filter' in ctx) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    ctx.globalAlpha = rc.pal.dark ? 0.42 : 0.3;
    ctx.fillStyle = rc.pal.shadow;
    ctx.fill('nonzero');
  }
  ctx.restore();
}

// Тепловая карта «часов солнца» (core/landscape-shadow.js sunHoursGrid):
// тень — сине-лиловая, солнце — тёплая жёлтая; вне участка — пусто.
const gridImages = new WeakMap();
function sunHeatColor(t) {
  const stops = [[0, [74, 82, 170]], [0.35, [92, 160, 196]], [0.6, [150, 204, 120]], [0.8, [244, 214, 92]], [1, [246, 150, 62]]];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const u = (t - t0) / (t1 - t0 || 1);
      return a.map((v, k) => Math.round(v + (b[k] - v) * u));
    }
  }
  return stops[stops.length - 1][1];
}
export function sunHeatCss(t) {
  const [r, g, b] = sunHeatColor(Math.max(0, Math.min(1, t)));
  return `rgb(${r},${g},${b})`;
}
export function drawSunGrid(ctx, grid, opts) {
  if (!grid) return;
  let img = gridImages.get(grid);
  if (!img) {
    try {
      img = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(grid.cols, grid.rows) : document.createElement('canvas');
    } catch { return; }
    img.width = grid.cols; img.height = grid.rows;
    const g = img.getContext('2d');
    const data = g.createImageData(grid.cols, grid.rows);
    const full = grid.dayHours || 1;
    for (let i = 0; i < grid.hours.length; i += 1) {
      const v = grid.hours[i];
      if (Number.isNaN(v)) continue;
      const [r, gg, b] = sunHeatColor(v / full);
      data.data[i * 4] = r; data.data[i * 4 + 1] = gg; data.data[i * 4 + 2] = b; data.data[i * 4 + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    gridImages.set(grid, img);
  }
  ctx.save();
  ctx.globalAlpha = opts.dark ? 0.5 : 0.58;
  ctx.imageSmoothingEnabled = (opts.lod || 0) < 60; // вблизи — ячейки видны
  ctx.drawImage(img, grid.x0, grid.y0, grid.cols * grid.cell, grid.rows * grid.cell);
  ctx.restore();
}

// Тени объектов, низкие объекты, кроны — после дома.
export function drawLandscapeRaised(ctx, objects, opts) {
  const shadows = opts.lod >= 1.5 && !opts.noShadows;
  const rc = shadows ? baseContext(opts) : null;
  const shadowOf = (o) => {
    const def = landscapeDef(o.kind);
    if (hasDropShadow(def) && !isOffscreen(ctx, o, def, 1500 + (def.height || 0) * 1.5)) drawShadow(ctx, o, def, opts.shadow, rc);
  };
  // Тени посадок в коробе — после коробов (иначе их закроет засыпка).
  if (shadows) for (const o of objects) if (!o.parent) shadowOf(o);
  const low = layerObjects(objects, 'low');
  let kids = false;
  for (const o of low) {
    if (o.parent && !kids && shadows) { kids = true; for (const c of objects) if (c.parent) shadowOf(c); }
    drawLandscapeObject(ctx, o, opts);
  }
  if (shadows && !kids) for (const c of objects) if (c.parent) shadowOf(c);
  for (const o of layerObjects(objects, 'tall')) drawLandscapeObject(ctx, o, opts);
  // Выноски — поверх всего ландшафта (и на листе генплана).
  for (const o of layerObjects(objects, 'note')) drawLandscapeObject(ctx, o, opts);
}

// ------------------------------------------------------------ Выноски

// Шрифт выноски по стилю: «Эскиз» — рукописный, «Чертёж» — строгий.
const calloutFont = (style, size) => (style === 'drawing' ? `400 ${size}px ${PLAIN_FONT}` : `${size}px ${HAND_FONT}`);
let calloutStyle = 'sketch';
const widthCache = new Map();
let measureCtx = null;
// Замер строки для core/landscape-callout.js (полка, рамка, попадание —
// по тому же шрифту, что и рисунок). Ширина ∝ размеру: мерим при 100 px.
function measureCallout(text, size) {
  const key = `${calloutStyle}|${text}`;
  let w = widthCache.get(key);
  if (w == null) {
    if (!measureCtx) {
      try {
        // Холст документа: шрифты те же, что у основного холста (OffscreenCanvas их может не видеть).
        measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : new OffscreenCanvas(4, 4).getContext('2d');
      } catch { measureCtx = null; }
    }
    if (!measureCtx) return String(text).length * size * 0.6;
    measureCtx.font = calloutFont(calloutStyle, 100);
    w = measureCtx.measureText(String(text)).width / 100;
    if (widthCache.size > 2000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w * size;
}
if (typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined') setCalloutMeasure(measureCallout);

// Выноска в мире (мм): указатель → излом → полка, знак на конце, текст над
// полкой. «Эскиз» — рукописно, линии с лёгким перехлёстом на концах полки;
// «Чертёж» — тонкая линия, строгий шрифт.
function drawCallout(ctx, o, opts) {
  const rc = baseContext(opts);
  const style = opts.style === 'drawing' ? 'drawing' : 'sketch';
  if (style !== calloutStyle) { calloutStyle = style; }
  const L = calloutLayout(o);
  const ink = o.color ? rc.c(o.color) : rc.ink;
  const hand = style !== 'drawing';
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = opts.px(hand ? 1.3 : 0.9);
  const over = hand ? L.size * 0.3 : 0;
  // Дальше — в осях текста: начало — излом, X — вдоль полки.
  ctx.translate(L.elbow.x, L.elbow.y);
  ctx.rotate(L.angle);
  const A = L.local.anchor;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  if (hand) {
    // Лёгкий изгиб указателя — «от руки».
    ctx.quadraticCurveTo(A.x / 2 + A.y * 0.04, A.y / 2 - A.x * 0.04, 0, 0);
  } else {
    ctx.lineTo(0, 0);
  }
  ctx.lineTo(L.dir * (L.local.len + over), 0);
  ctx.stroke();
  const back = (p) => {
    const dx = p.x - L.elbow.x; const dy = p.y - L.elbow.y;
    const c = Math.cos(L.angle); const s = Math.sin(L.angle);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  };
  if (o.variant === 'arrow') {
    const t = calloutArrow(L).map(back);
    ctx.beginPath(); t.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.fill();
  } else if (o.variant !== 'none') {
    ctx.beginPath(); ctx.arc(A.x, A.y, calloutDotRadius(L), 0, TAU); ctx.fill();
  }
  ctx.font = calloutFont(style, L.size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const ln of L.local.lines) {
    if (!ln.text) continue;
    // Ореол цвета бумаги — текст читается поверх крон и покрытий.
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = rc.pal.paper;
    ctx.lineWidth = L.size * 0.22;
    ctx.strokeText(ln.text, ln.x, ln.y);
    ctx.globalAlpha = 1;
    ctx.fillText(ln.text, ln.x, ln.y);
  }
  ctx.restore();
}

// Черновик рисования линии/контура (инструмент draw-landscape): объект по
// точкам + курсор, полупрозрачно; вершины и пунктир — в экранных px.
export function drawLandscapeDraft(ctx, tool, opts, color) {
  const def = landscapeDef(tool.lsKind);
  if (!def) return;
  let pts = [...(tool.points || [])];
  if (tool.rect) {
    pts = tool.rect.pts;
  } else if (tool.cursor) {
    pts.push(tool.cursor);
  }
  if (pts.length >= 2) {
    const o = {
      id: '__draft-ls__', kind: tool.lsKind, x: 0, y: 0, rotation: 0, w: 1, h: 1, points: pts,
      width: tool.opts?.width, smooth: tool.opts?.smooth, variant: tool.opts?.variant || def.variants[0].id, meta: {},
      color: tool.opts?.color,
    };
    ctx.save();
    ctx.globalAlpha = 0.62;
    if (def.shape === 'line' || pts.length >= 3) drawShapeObject(ctx, o, def, opts);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.px(1.5);
    ctx.setLineDash([opts.px(7), opts.px(5)]);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (def.shape === 'poly' && pts.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  for (const [i, p] of (tool.rect ? pts : tool.points || []).entries()) {
    ctx.fillStyle = i === 0 && def.shape === 'poly' ? color : '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.px(1.5);
    ctx.beginPath(); ctx.arc(p.x, p.y, opts.px(4), 0, TAU); ctx.fill(); ctx.stroke();
  }
  if (tool.cursor && !tool.rect) {
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.px(1.2);
    const r = opts.px(6);
    ctx.beginPath();
    ctx.moveTo(tool.cursor.x - r, tool.cursor.y); ctx.lineTo(tool.cursor.x + r, tool.cursor.y);
    ctx.moveTo(tool.cursor.x, tool.cursor.y - r); ctx.lineTo(tool.cursor.x, tool.cursor.y + r);
    ctx.stroke();
  }
  ctx.restore();
}

// Призрак при постановке: полупрозрачный объект + пунктирный контур.
export function drawLandscapeGhost(ctx, o, opts, color) {
  ctx.save();
  ctx.globalAlpha = 0.62;
  drawLandscapeObject(ctx, o, opts);
  ctx.restore();
  outlinePath(ctx, objectOutline(o));
  ctx.strokeStyle = color;
  ctx.lineWidth = opts.px(1.5);
  ctx.setLineDash([opts.px(7), opts.px(5)]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Предпросмотр «Массива» (инструмент ls-array): копии-призраки, линия пути
// или центр с окружностью, опорная точка. Призраков — не больше 400.
export function drawLandscapeArrayPreview(ctx, tool, opts, color) {
  const list = tool.preview?.objects || [];
  const n = Math.min(list.length, 400);
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < n; i += 1) if (!list[i].parent) drawLandscapeObject(ctx, list[i], opts);
  for (let i = 0; i < n; i += 1) if (list[i].parent) drawLandscapeObject(ctx, list[i], opts);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = opts.px(1.2);
  ctx.setLineDash([opts.px(6), opts.px(4)]);
  for (let i = 0; i < n; i += 1) {
    if (list[i].parent) continue;
    outlinePath(ctx, objectOutline(list[i]));
    ctx.stroke();
  }
  const dot = (p, r = 4, fill = '#ffffff') => {
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(p.x, p.y, opts.px(r), 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  ctx.lineWidth = opts.px(1.6);
  if (tool.mode === 'path') {
    const pts = [...(tool.points || []), ...(tool.cursor ? [tool.cursor] : [])];
    if (pts.length >= 2) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    for (const p of tool.points || []) dot(p);
  }
  if (tool.mode === 'polar') {
    const c = tool.center || tool.cursor;
    const first = tool.preview?.positions?.[0];
    if (c && first) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.hypot(first.x - c.x, first.y - c.y), 0, TAU);
      ctx.stroke();
    }
    if (c) {
      const r = opts.px(7);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(c.x - r, c.y); ctx.lineTo(c.x + r, c.y);
      ctx.moveTo(c.x, c.y - r); ctx.lineTo(c.x, c.y + r);
      ctx.stroke();
      if (tool.center) dot(c, 3, color);
    }
  }
  if (tool.preview?.base) dot(tool.preview.base, 3.5, color);
  ctx.restore();
}

function outlinePath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function pill(ctx, label, x, y, tokens, color) {
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(label).width + 12;
  ctx.fillStyle = tokens.surface;
  ctx.globalAlpha = 0.92;
  ctx.beginPath(); rrect(ctx, x - w / 2, y - 9, w, 18, 9); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

// Экранный слой: замечания, наведение, выделение, ручки.
// sel — массив id; warnings — Map id → [текст].
const fmtM = (v, d = 1) => v.toFixed(d).replace('.', ',');

// Подпись размера: линия — длина × ширина, площадь — м², прочие — габарит.
export function landscapeMeasure(o, def = landscapeDef(o.kind)) {
  if (def?.shape === 'note') return `${(o.meta?.text || '').split('\n').length} стр. · h ${Math.round(o.meta?.size || 0)} мм`;
  if (o.kind === 'stairs-out') {
    const st = stairsInfo(o);
    return `${st.steps} ступ. · ${(o.w / 1000).toFixed(2)} × ${(o.h / 1000).toFixed(2)} м · h ${Math.round(st.rise)}`;
  }
  if (o.kind === 'retaining-wall') {
    const ri = retainingInfo(o);
    return `L ${fmtM(ri.length / 1000, 2)} м · ${Math.round(ri.thick)}×${Math.round(ri.height)} мм · V ${fmtM(ri.volume, 2)} м³`;
  }
  if (def?.shape === 'line') return `L ${fmtM(objectLengthM(o), 2)} м · ${fmtM((o.width || def.h) / 1000, 2)} м`;
  if (def?.shape === 'poly') return `S ${fmtM(objectAreaM2(o), 1)} м² · P ${fmtM(objectLengthM(o), 1)} м`;
  return def?.lockAspect ? `⌀ ${(o.w / 1000).toFixed(2)} м` : `${(o.w / 1000).toFixed(2)} × ${(o.h / 1000).toFixed(2)} м`;
}

// Ручки вершин фигуры (экран): вершины и середины рёбер (+ — вставить).
export function shapeHandles(o, w2s) {
  const def = landscapeDef(o.kind);
  const pts = (o.points || []).map((p) => w2s(p.x, p.y));
  const closed = def?.shape === 'poly';
  const mids = [];
  for (let i = 0; i < (closed ? pts.length : pts.length - 1); i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 28) mids.push({ index: i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return { vertices: pts, mids };
}

const shortTitle = (def) => def.title.replace(/ \(.*\)$/, '');

// Шрифт подписей: в «Эскизе» — аккуратный рукописный (системный), в
// «Чертеже» — строгий.
const HAND_FONT = "'Segoe Print', 'Bradley Hand', 'Noteworthy', 'Comic Neue', cursive";
const PLAIN_FONT = 'system-ui, sans-serif';

// Подписи позиций на плане (слой «Подписи»): площади и линии — название с
// мерой, деревья — без подписи (их много). Текст с «ореолом» цвета холста.
function drawLabels(ctx, objects, w2s, tokens, style) {
  ctx.save();
  const hand = style !== 'drawing';
  ctx.font = hand ? `12px ${HAND_FONT}` : `500 10.5px ${PLAIN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const o of objects) {
    const def = landscapeDef(o.kind);
    if (!def || def.shape === 'note' || (def.group === 'Деревья' || def.group === 'Кустарники') && !isPathShape(def)) continue;
    let at = w2s(o.x, o.y);
    if (def.shape === 'line') {
      const path = objectPath(o);
      const p = pointAlong(path, polylineLength(path) / 2);
      at = w2s(p.x, p.y);
    }
    let text = isPathShape(def)
      ? `${shortTitle(def)} · ${def.shape === 'line' ? `${fmtM(objectLengthM(o))} м` : `${fmtM(objectAreaM2(o))} м²`}`
      : shortTitle(def);
    if (o.kind === 'stairs-out') text = `${stairsInfo(o).steps} ступ.`;
    if (o.kind === 'retaining-wall') text = `Подп. стенка h ${fmtM(retainingInfo(o).height / 1000, 2)} м`;
    // Отметка уровня: «+0.45»; у лестницы — низ → верх.
    if (Number.isFinite(o.elev)) {
      text += ` ${fmtElev(o.elev)}${o.kind === 'stairs-out' && Number.isFinite(o.elevTo) ? `…${fmtElev(o.elevTo)}` : ''}`;
    }
    if (o.parent) continue; // посадки в коробе — без подписей
    ctx.strokeStyle = tokens.surface;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3.5;
    ctx.strokeText(text, at.x, at.y + 0.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = tokens.text || tokens.muted;
    ctx.fillText(text, at.x, at.y + 0.5);
  }
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

// Значок замечания «!» — маленький янтарный кружок у угла объекта.
function warnBadge(ctx, x, y, color, tokens) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = tokens.surface;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 9px ${PLAIN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

// Отметки уровня без слоя «Подписи»: знак ▽ и «+0.45» у центра площадки
// (у линии — у середины оси). Подписи включены — отметка уже в подписи.
function drawElevTags(ctx, objects, w2s, tokens, style) {
  const list = objects.filter((o) => Number.isFinite(o.elev));
  if (!list.length) return;
  ctx.save();
  ctx.font = style !== 'drawing' ? `12px ${HAND_FONT}` : `500 10.5px ${PLAIN_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const o of list) {
    const def = landscapeDef(o.kind);
    if (!def) continue;
    let at = w2s(o.x, o.y);
    if (def.shape === 'line') {
      const path = objectPath(o);
      const p = pointAlong(path, polylineLength(path) / 2);
      at = w2s(p.x, p.y);
    }
    const text = `${fmtElev(o.elev)}${o.kind === 'stairs-out' && Number.isFinite(o.elevTo) ? `…${fmtElev(o.elevTo)}` : ''}`;
    const color = tokens.text || tokens.muted;
    // ▽ — вершиной на точку отметки.
    ctx.beginPath();
    ctx.moveTo(at.x, at.y); ctx.lineTo(at.x - 5, at.y - 8); ctx.lineTo(at.x + 5, at.y - 8); ctx.closePath();
    ctx.fillStyle = tokens.surface; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(at.x - 5, at.y - 8); ctx.lineTo(at.x + 40, at.y - 8); ctx.stroke();
    ctx.strokeStyle = tokens.surface;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3.5;
    ctx.strokeText(text, at.x + 7, at.y - 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillText(text, at.x + 7, at.y - 16);
  }
  ctx.restore();
}

function handle(ctx, p, tokens, active = false) {
  ctx.fillStyle = active ? tokens.accent : '#ffffff';
  ctx.strokeStyle = tokens.accent;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(Math.round(p.x - HANDLE / 2) + 0.5, Math.round(p.y - HANDLE / 2) + 0.5, HANDLE, HANDLE); ctx.fill(); ctx.stroke();
}

// Экранный слой: замечания, наведение, выделение, ручки.
// sel — массив id; warnings — Map id → [текст]. Замечания: у объекта —
// маленький значок «!», янтарный пунктир — только у выделенного/наведённого.
export function drawLandscapeOverlay(ctx, objects, {
  sel = [], hoverId = null, warnings = new Map(), w2s, tokens, scale, warnColor = '#d08a1e', labels = false, vertex = null, style = 'sketch', handles = null,
}) {
  if (labels) drawLabels(ctx, objects, w2s, tokens, style);
  else drawElevTags(ctx, objects, w2s, tokens, style);
  const screenPts = (o, inflate = 0) => {
    const shape = isPathShape(landscapeDef(o.kind));
    return objectOutline(inflate && !shape ? { ...o, w: o.w + inflate * 2, h: o.h + inflate * 2 } : o).map((p) => w2s(p.x, p.y));
  };
  const selected = new Set(sel);
  ctx.save();
  for (const o of objects) {
    const notes = warnings.get(o.id);
    const focus = o.id === hoverId || selected.has(o.id);
    if (o.id === hoverId && !selected.has(o.id)) {
      outlinePath(ctx, screenPts(o));
      ctx.strokeStyle = tokens.hover;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (!notes?.length) continue;
    const pts = screenPts(o, 3 / scale);
    if (focus) {
      outlinePath(ctx, pts);
      ctx.strokeStyle = warnColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    let maxX = -Infinity; let minY = Infinity;
    for (const p of pts) { if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; }
    warnBadge(ctx, maxX - 1, minY + 1, warnColor, tokens);
  }
  ctx.restore();
  const chosen = objects.filter((o) => selected.has(o.id));
  for (const o of chosen) {
    const shape = isPathShape(landscapeDef(o.kind));
    const corners = (shape ? objectOutline(o) : objectCorners(o)).map((c) => w2s(c.x, c.y));
    outlinePath(ctx, corners);
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1.2;
    if (chosen.length > 1) ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Ручки режима (core/landscape-handles.js): handles = { mode, frame, deg }.
  const mode = handles?.mode || 'select';
  const rotatorsAt = (f) => {
    for (const r of frameRotators(f, 20, scale)) {
      const p = w2s(r.x, r.y);
      ctx.fillStyle = tokens.surface;
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, -0.6, Math.PI * 1.2); ctx.stroke();
    }
  };
  const modeHandles = (f) => {
    if (mode === 'rotate') rotatorsAt(f);
    else if (mode === 'stretch') for (const e of frameEdges(f)) handle(ctx, w2s(e.x, e.y), tokens);
    else if (mode === 'scale') for (const c of frameCorners(f)) handle(ctx, w2s(c.x, c.y), tokens);
  };
  const frameOutline = (f) => {
    const pts = frameCorners(f).map((c) => w2s(c.x, c.y));
    outlinePath(ctx, pts);
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    return pts;
  };
  if (chosen.length > 1) {
    // Группа: общая рамка (по экрану), подпись и ручки режима.
    const f = handles?.frame;
    if (!f || mode === 'select') return null;
    const pts = frameOutline(f);
    const top = Math.min(...pts.map((p) => p.y));
    const mid = pts.reduce((s, p) => s + p.x, 0) / 4;
    const deg = handles.deg;
    pill(ctx, `${chosen.length} объект. · ${(f.w / 1000).toFixed(1)} × ${(f.h / 1000).toFixed(1)} м${mode === 'rotate' && deg != null ? ` · ${Math.round(deg)}°` : ''}`,
      mid, top - 14, tokens, tokens.accent);
    modeHandles(f);
    return null;
  }
  if (chosen.length !== 1) return null;
  const o = chosen[0];
  const def = landscapeDef(o.kind);
  if (def?.shape === 'note') {
    // Выноска: две ручки — указатель (круг) и текст (квадрат у излома).
    if (o.locked) return null;
    const L = calloutLayout(o);
    const a = w2s(L.anchor.x, L.anchor.y);
    ctx.fillStyle = tokens.surface;
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, TAU); ctx.fill(); ctx.stroke();
    handle(ctx, w2s(L.elbow.x, L.elbow.y), tokens);
    return null;
  }
  const corners = objectCorners(o).map((c) => w2s(c.x, c.y));
  const top = Math.min(...corners.map((p) => p.y));
  const mid = corners.reduce((s, p) => s + p.x, 0) / 4;
  const lock = o.locked ? ' · закреплён' : '';
  if (isPathShape(def)) {
    pill(ctx, `${landscapeMeasure(o, def)}${lock}`, mid, top - 14, tokens, tokens.accent);
    if (o.locked) return null;
    if (mode !== 'select' && handles?.frame) {
      // Поворот/масштаб линии или контура — за рамку габарита.
      frameOutline(handle.frame);
      modeHandles(handle.frame);
      return null;
    }
    const { vertices, mids } = shapeHandles(o, w2s);
    // Ребро под курсором или в жесте «тянуть ребро» (state.lsEdge) — толще.
    const edge = handles ? state.lsEdge : null;
    if (edge?.id === o.id && vertices.length > 2 && edge.index < vertices.length) {
      const a = vertices[edge.index];
      const b = vertices[(edge.index + 1) % vertices.length];
      ctx.save();
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }
    for (const p of mids) {
      ctx.fillStyle = tokens.surface;
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill(); ctx.stroke();
    }
    vertices.forEach((p, i) => handle(ctx, p, tokens, vertex && vertex.id === o.id && vertex.index === i));
    return null;
  }
  pill(ctx, `${landscapeMeasure(o, def)} · ${Math.round(o.rotation || 0)}°${lock}`, mid, top - 14, tokens, tokens.accent);
  if (o.locked) return null;
  // Режимы как у мебели: «Выбор» — без ручек; поворот — круги у углов;
  // растяжение — квадраты на сторонах; масштаб — квадраты в углах.
  modeHandles({ x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation || 0 });
  return null;
}

// Тёмная ли тема холста (для миниатюр, где нет токенов отрисовки).
function canvasIsDark() {
  try {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
    return c ? luminance(c) < 0.4 : false;
  } catch {
    return false;
  }
}

// Миниатюра для карточки каталога (тот же рисовальщик и стиль).
export function drawLandscapePreview(canvas, kind, { style = 'sketch', dark = canvasIsDark() } = {}) {
  const def = landscapeDef(kind);
  if (!def) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const o = { id: `preview-${kind}`, kind, x: 0, y: 0, rotation: 0, w: def.w, h: def.h, height: def.height, variant: def.variants[0].id, meta: { ...(def.meta || {}) } };
  if (def.shape === 'note') {
    // Карточка выноски: точка слева внизу, текст в две строки.
    Object.assign(o, { x: -900, y: 300, points: [{ x: -2400, y: 1300 }], meta: { text: 'Самшит\nшар 400', size: 420 }, w: 5200, h: 2600 });
  }
  if (def.shape === 'line') {
    // Линия на карточке — S-образная, сглаженная.
    const width = def.h;
    Object.assign(o, {
      points: [{ x: -2600, y: 700 }, { x: -900, y: -500 }, { x: 900, y: 500 }, { x: 2600, y: -700 }],
      width, smooth: true, w: 6000 + width, h: 2600 + width,
    });
  } else if (def.shape === 'poly') {
    const round = kind === 'pond-area' || kind === 'lawn-area';
    const pts = round
      ? Array.from({ length: 9 }, (_, i) => {
        const t = (i / 9) * TAU;
        const k = 0.85 + 0.15 * Math.sin(i * 2.3);
        return { x: Math.cos(t) * 2700 * k, y: Math.sin(t) * 1500 * k };
      })
      : [{ x: -2600, y: -1500 }, { x: 2600, y: -1500 }, { x: 2600, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 1500 }, { x: -2600, y: 1500 }];
    Object.assign(o, { points: pts, smooth: round, w: 6200, h: 3700 });
  }
  // Длинные узкие объекты (изгородь, забор) — по ширине карточки.
  const scale = Math.min((W * 0.78) / o.w, (H * 0.74) / o.h);
  const shadow = { x: Math.SQRT1_2, y: Math.SQRT1_2, k: 0.12 };
  const dropShadow = hasDropShadow(def);
  ctx.setTransform(scale, 0, 0, scale, W / 2 - (dropShadow ? 4 : 0), H / 2 - (dropShadow ? 4 : 0));
  const opts = { px: (v) => (v * 1.6) / scale, lod: Math.max(scale * 1000, 30), shadow, style, dark, dpr: 1 };
  if (dropShadow) drawShadow(ctx, o, def, shadow, baseContext(opts));
  drawLandscapeObject(ctx, o, opts);
  if (kind === 'planter-box') {
    // Карточка короба — с посадками внутри.
    for (const [k, x, w] of [['shrub-box', -900, 700], ['grass-clump', 0, 800], ['flowers-clump', 850, 750]]) {
      drawLandscapeObject(ctx, { id: `preview-in-${k}`, kind: k, x, y: 0, rotation: 0, w, h: w, height: 500, variant: landscapeDef(k).variants[0].id, meta: {} }, opts);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

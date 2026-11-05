// Отрисовка ландшафта «вид сверху» (генплан-рендер): кроны с тенями,
// покрытия с текстурами, вода, парковка с машинами, костровая яма.
//
// Мир — координаты участка в мм, преобразование вида уже задано (render.js).
// Слои: покрытия (ground) → дом (рисует render.js) → тени → низкие объекты
// → высокие (кроны) сверху. Мелкие детали скрываются при отдалении (lod —
// пикселей на метр). Цвета растительности и материалов — палитра LS_COLORS
// (средние тона, читаются в обеих темах); выделение — токены темы.

import {
  LS_COLORS, isRoundObject, landscapeDef, landscapeHandles, objectColors, objectCorners,
  objectOutline, seededRandom, variantOf,
} from '../core/landscape.js';
import { sunPosition } from '../core/site.js';

const TAU = Math.PI * 2;
const HANDLE = 9;

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

// Мягкий неровный контур (крона, пруд): точки по эллипсу с разбросом,
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

// Зубчатая «звезда» — хвоя сверху.
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

// Объём кроны: свет с юго-запада экрана (вверх-влево), тень к краю.
function volume(ctx, rx, ry, rc, strength = 1) {
  const r = Math.max(rx, ry);
  const g = ctx.createRadialGradient(rc.light.x * rx * 0.45, rc.light.y * ry * 0.45, 0, 0, 0, r);
  g.addColorStop(0, `rgba(255,255,250,${0.26 * strength})`);
  g.addColorStop(0.45, 'rgba(255,255,250,0)');
  g.addColorStop(1, `rgba(0,20,0,${0.28 * strength})`);
  ctx.fillStyle = g;
  ctx.fill();
}

function gravel(ctx, x, y, w, h, colors, rand, rc, density = 1) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(x, y, w, h);
  if (rc.lod < 8) return;
  const grain = Math.max(rc.px(1.2), 22);
  const count = Math.min(2600, Math.round(((w * h) / (grain * grain * 9)) * density));
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = i % 3 === 0 ? colors[1] : colors[2];
    ctx.globalAlpha = 0.55 + rand() * 0.45;
    ctx.fillRect(x + rand() * w, y + rand() * h, grain, grain);
  }
  ctx.globalAlpha = 1;
}

function tiles(ctx, x, y, w, h, module, colors, rc, rand = null) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(x, y, w, h);
  if (rc.lod < 6) return;
  if (rand && rc.lod >= 10) {
    // Лёгкий разнобой тона плит.
    for (let ty = y; ty < y + h; ty += module) {
      for (let tx = x; tx < x + w; tx += module) {
        ctx.fillStyle = rand() > 0.5 ? colors[2] : colors[1];
        ctx.globalAlpha = 0.18 + rand() * 0.18;
        ctx.fillRect(tx, ty, module, module);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = 'rgba(70,64,56,0.35)';
  ctx.lineWidth = Math.max(rc.px(0.7), 12);
  ctx.beginPath();
  for (let tx = x + module; tx < x + w; tx += module) { ctx.moveTo(tx, y); ctx.lineTo(tx, y + h); }
  for (let ty = y + module; ty < y + h; ty += module) { ctx.moveTo(x, ty); ctx.lineTo(x + w, ty); }
  ctx.stroke();
}

// Доски вдоль длинной стороны, со сдвигом стыков.
function boards(ctx, x, y, w, h, colors, rand, rc, board = 145) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(x, y, w, h);
  if (rc.lod < 5) return;
  const alongX = w >= h;
  const len = alongX ? w : h;
  const across = alongX ? h : w;
  const rows = Math.max(1, Math.round(across / board));
  const step = across / rows;
  for (let i = 0; i < rows; i += 1) {
    const tone = rand();
    ctx.fillStyle = tone > 0.66 ? colors[2] : tone > 0.33 ? colors[1] : colors[0];
    ctx.globalAlpha = 0.55;
    if (alongX) ctx.fillRect(x, y + i * step, w, step); else ctx.fillRect(x + i * step, y, step, h);
  }
  ctx.globalAlpha = 1;
  if (rc.lod < 10) return;
  ctx.strokeStyle = 'rgba(40,24,12,0.35)';
  ctx.lineWidth = Math.max(rc.px(0.6), 10);
  ctx.beginPath();
  for (let i = 1; i < rows; i += 1) {
    if (alongX) { ctx.moveTo(x, y + i * step); ctx.lineTo(x + w, y + i * step); }
    else { ctx.moveTo(x + i * step, y); ctx.lineTo(x + i * step, y + h); }
  }
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
  ctx.stroke();
}

function edge(ctx, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Машина сверху: кузов, стёкла, крыша, зеркала, фары.
function car(ctx, cx, cy, w, l, color, rc) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); rrect(ctx, -w / 2 + 90, -l / 2 + 120, w, l, 420); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); rrect(ctx, -w / 2, -l / 2, w, l, 420); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(rc.px(0.8), 18);
  ctx.stroke();
  if (rc.lod >= 6) {
    const glass = '#26303b';
    ctx.fillStyle = glass;
    ctx.beginPath(); // лобовое (перед — вверх, −y)
    ctx.moveTo(-w * 0.4, -l * 0.17); ctx.lineTo(w * 0.4, -l * 0.17);
    ctx.lineTo(w * 0.33, -l * 0.03); ctx.lineTo(-w * 0.33, -l * 0.03);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); // заднее
    ctx.moveTo(-w * 0.34, l * 0.25); ctx.lineTo(w * 0.34, l * 0.25);
    ctx.lineTo(w * 0.38, l * 0.34); ctx.lineTo(-w * 0.38, l * 0.34);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; // крыша
    ctx.beginPath(); rrect(ctx, -w * 0.33, -l * 0.03, w * 0.66, l * 0.28, 150); ctx.fill();
    ctx.fillStyle = color; // зеркала
    ctx.fillRect(-w / 2 - 120, -l * 0.16, 130, 160);
    ctx.fillRect(w / 2 - 10, -l * 0.16, 130, 160);
    ctx.fillStyle = '#fff6c8'; // фары
    ctx.fillRect(-w * 0.42, -l / 2 + 40, w * 0.18, 70);
    ctx.fillRect(w * 0.24, -l / 2 + 40, w * 0.18, 70);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-w * 0.42, l / 2 - 100, w * 0.16, 60);
    ctx.fillRect(w * 0.26, l / 2 - 100, w * 0.16, 60);
  }
  ctx.restore();
}

function chair(ctx, x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath(); rrect(ctx, -size / 2, -size / 2, size, size, size * 0.18); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-size / 2, size / 2 - size * 0.2, size, size * 0.2); // спинка — от центра
  ctx.restore();
}

function flame(ctx, r, rand) {
  for (let i = 0; i < 6; i += 1) {
    const t = (i / 6) * TAU + rand() * 0.5;
    ctx.save();
    ctx.rotate(t);
    ctx.fillStyle = i % 2 ? LS_COLORS.fire[1] : LS_COLORS.fire[0];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(r * 0.5, r * 0.25, r * (0.85 + rand() * 0.3), 0);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.25, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  circle(ctx, 0, 0, r * 0.35, LS_COLORS.fire[2]);
}

// ------------------------------------------------------------ Виды

const FRUIT = { apple: '#d9402f', pear: '#e5c03a', cherry: '#9e1c35', apricot: '#f08a3c' };
const BLOOM = { lilac: '#a47fd0', spiraea: '#f6f3ea', hydrangea: '#8fb2e6' };

const LOOKS = {
  deciduous(ctx, o, a, b, C, rc) {
    ctx.beginPath(); blobPath(ctx, 0, 0, a, b, rc.rand, 11, 0.07);
    ctx.fillStyle = C[0]; ctx.fill();
    ctx.save(); ctx.clip();
    if (rc.lod >= 3) {
      const birch = o.kind === 'tree-birch';
      const n = birch ? 11 : 7;
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU + rc.rand() * 0.6;
        const d = birch ? 0.5 : 0.42;
        const rr = (birch ? 0.32 : 0.46) * (0.85 + rc.rand() * 0.3);
        ctx.globalAlpha = 0.9;
        circle(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, rr * Math.min(a, b), C[1]);
      }
      for (let i = 0; i < 4; i += 1) {
        ctx.globalAlpha = 0.7;
        const t = Math.atan2(rc.light.y, rc.light.x) + (rc.rand() - 0.5) * 1.6;
        circle(ctx, Math.cos(t) * a * 0.35, Math.sin(t) * b * 0.35, (0.2 + rc.rand() * 0.1) * Math.min(a, b), C[2]);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.beginPath(); blobPath(ctx, 0, 0, a, b, seededRandom(o.id), 11, 0.07);
    volume(ctx, a, b, rc);
    edge(ctx, 'rgba(10,40,10,0.35)', rc.px(1));
  },
  fruit(ctx, o, a, b, C, rc) {
    LOOKS.deciduous(ctx, o, a, b, C, rc);
    if (rc.lod < 10) return;
    const color = FRUIT[o.variant] || FRUIT.apple;
    const r = Math.max(rc.px(1.6), Math.min(a, b) * 0.045);
    for (let i = 0; i < 16; i += 1) {
      const t = rc.rand() * TAU;
      const d = Math.sqrt(rc.rand()) * 0.78;
      circle(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, r, color);
    }
  },
  pine(ctx, o, a, b, C, rc) {
    ctx.beginPath(); starPath(ctx, a, b, 18, 0.8, rc.rand());
    ctx.fillStyle = C[0]; ctx.fill();
    if (rc.lod >= 3) {
      ctx.beginPath(); starPath(ctx, a * 0.72, b * 0.72, 15, 0.78, rc.rand());
      ctx.fillStyle = C[1]; ctx.fill();
      ctx.beginPath(); starPath(ctx, a * 0.42, b * 0.42, 11, 0.75, rc.rand());
      ctx.fillStyle = C[2]; ctx.fill();
      ctx.strokeStyle = 'rgba(10,30,15,0.25)';
      ctx.lineWidth = Math.max(rc.px(0.8), a * 0.02);
      ctx.beginPath();
      for (let i = 0; i < 9; i += 1) {
        const t = (i / 9) * TAU + 0.3;
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(t) * a * 0.88, Math.sin(t) * b * 0.88);
      }
      ctx.stroke();
    }
    ctx.beginPath(); ellipse(ctx, 0, 0, a * 0.95, b * 0.95);
    volume(ctx, a, b, rc, 0.8);
    circle(ctx, 0, 0, Math.min(a, b) * 0.07, '#6b4a33');
  },
  spruce(ctx, o, a, b, C, rc) {
    const layers = rc.lod >= 3 ? [[1, 24, C[0]], [0.74, 20, C[1]], [0.46, 14, C[2]], [0.2, 9, C[2]]] : [[1, 24, C[0]]];
    for (const [k, n, color] of layers) {
      ctx.beginPath(); starPath(ctx, a * k, b * k, n, 0.84, rc.rand());
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,25,15,0.25)';
      ctx.lineWidth = rc.px(0.7);
      ctx.stroke();
    }
    ctx.beginPath(); ellipse(ctx, 0, 0, a * 0.95, b * 0.95);
    volume(ctx, a, b, rc, 0.7);
  },
  thuja(ctx, o, a, b, C, rc) {
    ctx.beginPath(); starPath(ctx, a, b, 16, 0.9, rc.rand());
    ctx.fillStyle = C[0]; ctx.fill();
    ctx.beginPath(); ellipse(ctx, rc.light.x * a * 0.12, rc.light.y * b * 0.12, a * 0.7, b * 0.75);
    ctx.fillStyle = C[1]; ctx.fill();
    ctx.beginPath(); ellipse(ctx, rc.light.x * a * 0.3, rc.light.y * b * 0.3, a * 0.3, b * 0.35);
    ctx.fillStyle = C[2]; ctx.fill();
    ctx.beginPath(); ellipse(ctx, 0, 0, a, b);
    volume(ctx, a, b, rc, 0.8);
  },
  bonsai(ctx, o, a, b, C, rc) {
    const pads = o.variant === 'cloud' ? 6 : 5;
    const pts = [];
    for (let i = 0; i < pads; i += 1) {
      const t = (i / pads) * TAU + rc.rand() * 0.7;
      const d = 0.45 + rc.rand() * 0.15;
      pts.push({ x: Math.cos(t) * a * d, y: Math.sin(t) * b * d, r: (0.26 + rc.rand() * 0.1) * a, t });
    }
    ctx.strokeStyle = '#6b4a33';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(rc.px(1.2), a * 0.07);
    ctx.beginPath();
    for (const p of pts) { ctx.moveTo(0, 0); ctx.quadraticCurveTo(p.x * 0.2 + p.y * 0.25, p.y * 0.2 - p.x * 0.25, p.x, p.y); }
    ctx.stroke();
    ctx.lineCap = 'butt';
    for (const p of pts) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t);
      ctx.beginPath(); blobPath(ctx, 0, 0, p.r, p.r * 0.72, rc.rand, 9, 0.12);
      ctx.fillStyle = C[1]; ctx.fill();
      edge(ctx, 'rgba(10,30,15,0.35)', rc.px(0.8));
      ctx.beginPath(); ellipse(ctx, -p.r * 0.2, -p.r * 0.15, p.r * 0.5, p.r * 0.32);
      ctx.fillStyle = C[2]; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
      ctx.restore();
    }
    circle(ctx, 0, 0, a * 0.18, C[0]);
  },
  ball(ctx, o, a, b, C, rc) {
    const g = ctx.createRadialGradient(rc.light.x * a * 0.4, rc.light.y * b * 0.4, a * 0.05, 0, 0, a);
    g.addColorStop(0, C[2]); g.addColorStop(0.55, C[1]); g.addColorStop(1, C[0]);
    ctx.fillStyle = g;
    ctx.beginPath(); blobPath(ctx, 0, 0, a, b, rc.rand, 14, 0.04); ctx.fill();
    edge(ctx, 'rgba(10,40,10,0.35)', rc.px(0.8));
    if (rc.lod >= 25) {
      ctx.fillStyle = 'rgba(10,40,10,0.22)';
      for (let i = 0; i < 18; i += 1) {
        const t = rc.rand() * TAU; const d = Math.sqrt(rc.rand()) * 0.85;
        ctx.fillRect(Math.cos(t) * a * d, Math.sin(t) * b * d, a * 0.06, a * 0.06);
      }
    }
  },
  juniper(ctx, o, a, b, C, rc) {
    const n = Math.max(2, Math.round(a / b * 2));
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = -a + b * 0.8 + (i / Math.max(1, n - 1)) * (2 * a - b * 1.6);
        const k = pass ? 0.62 : 1;
        ctx.save();
        ctx.translate(x + (pass ? rc.light.x * b * 0.15 : 0), pass ? rc.light.y * b * 0.15 : (rc.rand() - 0.5) * b * 0.2);
        ctx.beginPath(); starPath(ctx, b * 0.85 * k, b * 0.85 * k, 13, 0.7, rc.rand());
        ctx.fillStyle = pass ? C[2] : C[0];
        ctx.globalAlpha = pass ? 0.75 : 1;
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ellipse(ctx, 0, 0, a * 0.9, b * 0.85);
    ctx.fillStyle = C[1]; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
  },
  shrub(ctx, o, a, b, C, rc) {
    ctx.beginPath(); blobPath(ctx, 0, 0, a, b, rc.rand, 12, 0.12);
    ctx.fillStyle = C[0]; ctx.fill();
    ctx.save(); ctx.clip();
    for (let i = 0; i < 6; i += 1) {
      const t = rc.rand() * TAU;
      circle(ctx, Math.cos(t) * a * 0.4, Math.sin(t) * b * 0.4, a * 0.38, C[1]);
    }
    ctx.restore();
    ctx.beginPath(); blobPath(ctx, 0, 0, a, b, seededRandom(o.id), 12, 0.12);
    volume(ctx, a, b, rc, 0.8);
    edge(ctx, 'rgba(10,40,10,0.3)', rc.px(0.8));
    if (rc.lod < 8) return;
    const bloom = BLOOM[o.variant] || BLOOM.lilac;
    for (let i = 0; i < 22; i += 1) {
      const t = rc.rand() * TAU; const d = Math.sqrt(rc.rand()) * 0.8;
      ctx.globalAlpha = 0.85;
      circle(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, a * (0.06 + rc.rand() * 0.05), bloom);
    }
    ctx.globalAlpha = 1;
  },
  hedge(ctx, o, a, b, C, rc) {
    const trim = o.variant !== 'free';
    ctx.beginPath();
    if (trim) rrect(ctx, -a, -b, a * 2, b * 2, b * 0.35); else blobPath(ctx, 0, 0, a, b, rc.rand, 16, 0.08);
    ctx.fillStyle = C[0]; ctx.fill();
    ctx.save(); ctx.clip();
    if (rc.lod >= 4) {
      const step = b * 1.1;
      for (let x = -a; x <= a; x += step) {
        circle(ctx, x + (rc.rand() - 0.5) * step * 0.3, (rc.rand() - 0.5) * b * 0.3, b * (trim ? 0.7 : 0.95), C[1]);
      }
      ctx.fillStyle = C[2];
      ctx.globalAlpha = 0.6;
      ctx.fillRect(-a, -b * 0.75, a * 2, b * 0.35);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, b * 0.35);
    edge(ctx, 'rgba(10,40,10,0.35)', rc.px(0.9));
  },
  flowerbed(ctx, o, a, b, C, rc) {
    const def = landscapeDef(o.kind);
    const round = isRoundObject(o, def);
    const shape = () => { ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a, b); else rrect(ctx, -a, -b, a * 2, b * 2, Math.min(a, b) * 0.25); };
    shape();
    ctx.fillStyle = def.colors[0]; ctx.fill();
    ctx.save(); ctx.clip();
    if (rc.lod >= 5) {
      const area = (a * b * 4) / 1e6;
      const flowers = variantOf(o, def)?.colors || LS_COLORS.flowers;
      const leaves = Math.min(500, Math.round(area * 28));
      for (let i = 0; i < leaves; i += 1) {
        ctx.globalAlpha = 0.85;
        circle(ctx, (rc.rand() * 2 - 1) * a, (rc.rand() * 2 - 1) * b, 70 + rc.rand() * 60, rc.rand() > 0.5 ? LS_COLORS.leaf[1] : LS_COLORS.leaf[0]);
      }
      if (rc.lod >= 9) {
        const count = Math.min(700, Math.round(area * 45));
        for (let i = 0; i < count; i += 1) {
          ctx.globalAlpha = 0.95;
          circle(ctx, (rc.rand() * 2 - 1) * a, (rc.rand() * 2 - 1) * b, 45 + rc.rand() * 35, flowers[Math.floor(rc.rand() * flowers.length)]);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    shape();
    edge(ctx, LS_COLORS.stone[1], Math.max(rc.px(1.2), 60));
  },
  lawn(ctx, o, a, b, C, rc) {
    const round = isRoundObject(o);
    ctx.beginPath(); if (round) blobPath(ctx, 0, 0, a, b, rc.rand, 14, 0.04); else rrect(ctx, -a, -b, a * 2, b * 2, 300);
    ctx.fillStyle = C[0]; ctx.fill();
    ctx.save(); ctx.clip();
    if (rc.lod >= 3 && o.variant !== 'meadow') {
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      for (let x = -a; x < a; x += 1600) ctx.fillRect(x, -b, 800, b * 2);
    }
    if (o.variant === 'meadow' && rc.lod >= 8) {
      for (let i = 0; i < Math.min(400, (a * b) / 2e5); i += 1) {
        circle(ctx, (rc.rand() * 2 - 1) * a, (rc.rand() * 2 - 1) * b, 40, LS_COLORS.flowers[Math.floor(rc.rand() * 4)]);
      }
    }
    ctx.restore();
    edge(ctx, C[2], rc.px(1));
  },
  grass(ctx, o, a, b, C, rc) {
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(rc.px(0.9), a * 0.035);
    const n = rc.lod >= 6 ? 46 : 18;
    for (let i = 0; i < n; i += 1) {
      const t = rc.rand() * TAU;
      const r = a * (0.55 + rc.rand() * 0.45);
      ctx.strokeStyle = C[i % 3];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(t + 0.3) * r * 0.5, Math.sin(t + 0.3) * r * 0.5 * (b / a), Math.cos(t) * r, Math.sin(t) * r * (b / a));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    circle(ctx, 0, 0, a * 0.2, C[2]);
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
      edge(ctx, C[2], rc.px(1));
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
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(rc.px(1), 100);
    ctx.beginPath();
    for (let i = 0; i <= spaces; i += 1) { ctx.moveTo(-a + i * sw, -b + 150); ctx.lineTo(-a + i * sw, b - 150); }
    ctx.stroke();
    const empty = o.variant === 'empty' || o.meta?.cars === 0;
    if (!empty && rc.lod >= 2) {
      for (let i = 0; i < spaces; i += 1) {
        const color = LS_COLORS.car[Math.floor(seededRandom(`${o.id}:${i}`)() * LS_COLORS.car.length)];
        car(ctx, -a + sw * (i + 0.5), 0, Math.min(1850, sw * 0.74), Math.min(4600, b * 2 * 0.87), color, rc);
      }
    }
  },
  'parking-grass'(ctx, o, a, b, C, rc) {
    ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
    if (rc.lod >= 6) {
      ctx.strokeStyle = 'rgba(200,198,190,0.75)';
      ctx.lineWidth = 70;
      ctx.beginPath();
      for (let x = -a; x <= a; x += 400) { ctx.moveTo(x, -b); ctx.lineTo(x, b); }
      for (let y = -b; y <= b; y += 400) { ctx.moveTo(-a, y); ctx.lineTo(a, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(rc.px(1), 100);
    ctx.setLineDash([400, 300]);
    ctx.strokeRect(-a + 60, -b + 60, a * 2 - 120, b * 2 - 120);
    ctx.setLineDash([]);
  },
  carport(ctx, o, a, b, C, rc) {
    if (rc.lod >= 3) car(ctx, 0, 0, Math.min(1850, a * 1.3), Math.min(4600, b * 1.6), '#9aa3ad', rc);
    const wood = o.variant === 'wood';
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 80);
    ctx.fillStyle = wood ? 'rgba(168,113,74,0.82)' : 'rgba(214,232,242,0.62)';
    ctx.fill();
    edge(ctx, C[0], Math.max(rc.px(1.4), 80));
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
    if (o.variant === 'tiles') tiles(ctx, -a, -b, a * 2, b * 2, 500, LS_COLORS.tiles, rc, rc.rand);
    else if (o.variant === 'deck') boards(ctx, -a, -b, a * 2, b * 2, LS_COLORS.deck, rc.rand, rc);
    else gravel(ctx, -a, -b, a * 2, b * 2, LS_COLORS.gravel, rc.rand, rc);
    ctx.restore();
    ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a, b); else rrect(ctx, -a, -b, a * 2, b * 2, 60);
    edge(ctx, 'rgba(90,80,66,0.6)', Math.max(rc.px(1), 50));
  },
  deck(ctx, o, a, b, C, rc) {
    boards(ctx, -a, -b, a * 2, b * 2, C, rc.rand, rc);
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2);
    edge(ctx, C[1], Math.max(rc.px(1.2), 90));
  },
  gazebo(ctx, o, a, b, C, rc) {
    const dark = 'rgba(30,15,5,0.35)';
    if (o.variant === 'flat') {
      ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
      const g = ctx.createLinearGradient(-a, -b, a, b);
      g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = g; ctx.fillRect(-a, -b, a * 2, b * 2);
      ctx.strokeStyle = C[2]; ctx.lineWidth = 120;
      ctx.strokeRect(-a + 60, -b + 60, a * 2 - 120, b * 2 - 120);
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
      edge(ctx, dark, rc.px(0.9));
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
    if (rc.lod >= 6) {
      // Вьющиеся растения по углам.
      for (const [x, y] of [[-a + 300, -b + 300], [a - 300, b - 300]]) {
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); blobPath(ctx, x, y, 650, 520, rc.rand, 9, 0.2);
        ctx.fillStyle = LS_COLORS.leaf[1]; ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  },
  bbq(ctx, o, a, b, C, rc) {
    tiles(ctx, -a, -b, a * 2, b * 2, 600, C, rc, rc.rand);
    ctx.beginPath(); ctx.rect(-a, -b, a * 2, b * 2); edge(ctx, 'rgba(90,80,66,0.6)', 50);
    ctx.save(); ctx.translate(-a + 700, -b + 450); LOOKS.grill(ctx, o, 550, 280, LS_COLORS.metal, rc); ctx.restore();
    const tr = Math.min(a, b) * 0.4;
    ctx.save(); ctx.translate(a * 0.25, b * 0.1);
    for (let i = 0; i < 6; i += 1) { const t = (i / 6) * TAU; chair(ctx, Math.cos(t) * (tr + 330), Math.sin(t) * (tr + 330), t + Math.PI / 2, 450, LS_COLORS.wood[2]); }
    circle(ctx, 0, 0, tr, LS_COLORS.wood[0]);
    ctx.restore();
  },
  firepit(ctx, o, a, b, C, rc) {
    const r = Math.min(a, b);
    ctx.save();
    ctx.beginPath(); ellipse(ctx, 0, 0, r, r); ctx.clip();
    gravel(ctx, -r, -r, r * 2, r * 2, C, rc.rand, rc);
    ctx.restore();
    // Мощёный круг вокруг очага с радиальными швами.
    const inner = r * 0.56;
    circle(ctx, 0, 0, inner, LS_COLORS.tiles[0]);
    if (rc.lod >= 8) {
      ctx.strokeStyle = 'rgba(70,64,56,0.3)';
      ctx.lineWidth = 15;
      ctx.beginPath();
      for (let k = 0.45; k < 1; k += 0.27) { ctx.moveTo(inner * k, 0); ctx.arc(0, 0, inner * k, 0, TAU); }
      for (let i = 0; i < 16; i += 1) { const t = (i / 16) * TAU; ctx.moveTo(Math.cos(t) * inner * 0.45, Math.sin(t) * inner * 0.45); ctx.lineTo(Math.cos(t) * inner, Math.sin(t) * inner); }
      ctx.stroke();
    }
    // Тёплое свечение.
    const glow = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 0.62);
    glow.addColorStop(0, 'rgba(255,170,60,0.55)'); glow.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ellipse(ctx, 0, 0, r * 0.62, r * 0.62); ctx.fill();
    // Круговая скамья (дуга с проходом к «низу» объекта) или кольцо камней.
    const rb = r * 0.78;
    const t = Math.max(420, r * 0.15);
    if (o.variant === 'stones') {
      const n = Math.max(8, Math.round((TAU * rb) / (t * 1.4)));
      for (let i = 0; i < n; i += 1) {
        const ang = (i / n) * TAU;
        ctx.save(); ctx.translate(Math.cos(ang) * rb, Math.sin(ang) * rb); ctx.rotate(ang);
        LOOKS.boulder(ctx, { ...o, variant: 'one' }, t * 0.55, t * 0.42, LS_COLORS.stone, rc);
        ctx.restore();
      }
    } else {
      const gap = 0.55;
      const s = Math.PI / 2 + gap / 2;
      const e = Math.PI / 2 - gap / 2 + TAU;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = t;
      ctx.beginPath(); ctx.arc(rc.shadowLocal.x * 120, rc.shadowLocal.y * 120, rb, s, e); ctx.stroke();
      ctx.strokeStyle = LS_COLORS.wood[0];
      ctx.beginPath(); ctx.arc(0, 0, rb, s, e); ctx.stroke();
      ctx.strokeStyle = LS_COLORS.wood[2];
      ctx.lineWidth = t * 0.3;
      ctx.beginPath(); ctx.arc(0, 0, rb - t * 0.2, s, e); ctx.stroke();
      if (rc.lod >= 8) {
        ctx.strokeStyle = 'rgba(40,22,10,0.45)';
        ctx.lineWidth = Math.max(rc.px(0.6), 14);
        ctx.beginPath();
        for (let ang = s; ang <= e; ang += 0.07) {
          ctx.moveTo(Math.cos(ang) * (rb - t / 2), Math.sin(ang) * (rb - t / 2));
          ctx.lineTo(Math.cos(ang) * (rb + t / 2), Math.sin(ang) * (rb + t / 2));
        }
        ctx.stroke();
      }
      // Подушки на скамье.
      if (rc.lod >= 6) {
        for (let i = 0; i < 5; i += 1) {
          const ang = s + 0.4 + i * ((e - s - 0.8) / 4);
          ctx.save(); ctx.translate(Math.cos(ang) * rb, Math.sin(ang) * rb); ctx.rotate(ang);
          ctx.fillStyle = ['#e9e2d0', '#c9b79a', '#d97b4a'][i % 3];
          ctx.beginPath(); rrect(ctx, -t * 0.3, -t * 0.32, t * 0.6, t * 0.64, t * 0.12); ctx.fill();
          ctx.restore();
        }
      }
    }
    // Очаг: каменное кольцо, угли, пламя.
    const fr = Math.max(380, r * 0.17);
    circle(ctx, 0, 0, fr, LS_COLORS.stone[2]);
    circle(ctx, 0, 0, fr * 0.78, '#3a2c25');
    if (rc.lod >= 3) flame(ctx, fr * 0.72, rc.rand);
  },
  grill(ctx, o, a, b, C, rc) {
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, Math.min(a, b) * 0.2);
    ctx.fillStyle = C[1]; ctx.fill();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(a, b));
    g.addColorStop(0, 'rgba(255,120,40,0.85)'); g.addColorStop(1, 'rgba(120,30,10,0.4)');
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
    ctx.fillStyle = LS_COLORS.coping[0]; ctx.fill();
    if (rc.lod >= 8) {
      ctx.save(); ctx.clip();
      tiles(ctx, -a, -b, a * 2, b * 2, 600, LS_COLORS.coping, rc, rc.rand);
      ctx.restore();
    }
    const m = Math.min(450, Math.min(a, b) * 0.16);
    const strip = loungers ? Math.min(2100, b * 0.8) : 0;
    const wx = -a + m; const wy = -b + m;
    const ww = a * 2 - m * 2; const wh = b * 2 - m * 2 - strip;
    if (wh > 0) {
      const g = ctx.createLinearGradient(wx, wy, wx + ww * 0.3, wy + wh);
      g.addColorStop(0, C[2]); g.addColorStop(0.35, C[0]); g.addColorStop(1, C[1]);
      ctx.beginPath(); rrect(ctx, wx, wy, ww, wh, 60);
      ctx.fillStyle = g; ctx.fill();
      edge(ctx, 'rgba(20,80,120,0.55)', Math.max(rc.px(1), 40));
      if (rc.lod >= 5) {
        ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(rc.px(0.8), 30);
        for (let y = wy + 350; y < wy + wh; y += 600) {
          ctx.beginPath();
          for (let x = wx; x <= wx + ww; x += 150) {
            const yy = y + Math.sin(x / 260 + y) * 70 + Math.sin(x / 90) * 25;
            if (x === wx) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
        ctx.restore();
        // Ступени входа в углу.
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        for (let i = 0; i < 3; i += 1) ctx.fillRect(wx + ww - 900 + i * 300, wy, 300 - 40, Math.min(1200, wh));
      }
    }
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
          ctx.fillStyle = i % 2 ? '#f1ece2' : '#e1d6c3';
          ctx.fill();
        }
        ctx.restore();
      }
    }
  },
  loungerOne(ctx, a, b, rc) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); rrect(ctx, -a + 60, -b + 80, a * 2, b * 2, 90); ctx.fill();
    ctx.fillStyle = '#f6f3ec';
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 90); ctx.fill();
    ctx.strokeStyle = 'rgba(80,70,60,0.45)'; ctx.lineWidth = Math.max(rc.px(0.7), 20); ctx.stroke();
    ctx.fillStyle = '#dcd3c2';
    ctx.beginPath(); rrect(ctx, -a * 0.8, -b * 0.92, a * 1.6, b * 0.32, 60); ctx.fill();
  },
  jacuzzi(ctx, o, a, b, C, rc) {
    const round = o.variant === 'round';
    ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a, b); else rrect(ctx, -a, -b, a * 2, b * 2, Math.min(a, b) * 0.25);
    ctx.fillStyle = LS_COLORS.coping[1]; ctx.fill();
    edge(ctx, 'rgba(60,60,60,0.4)', rc.px(1));
    const k = 0.78;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(a, b) * k);
    g.addColorStop(0, C[2]); g.addColorStop(1, C[1]);
    ctx.beginPath(); if (round) ellipse(ctx, 0, 0, a * k, b * k); else rrect(ctx, -a * k, -b * k, a * 2 * k, b * 2 * k, Math.min(a, b) * 0.35);
    ctx.fillStyle = g; ctx.fill();
    if (rc.lod >= 8) {
      for (let i = 0; i < 26; i += 1) {
        const t = rc.rand() * TAU; const d = Math.sqrt(rc.rand()) * 0.65;
        ctx.globalAlpha = 0.7;
        circle(ctx, Math.cos(t) * a * d, Math.sin(t) * b * d, 30 + rc.rand() * 40, '#ffffff');
      }
      ctx.globalAlpha = 1;
    }
  },
  pond(ctx, o, a, b, C, rc) {
    ctx.beginPath(); blobPath(ctx, 0, 0, a, b, rc.rand, 12, 0.08);
    const g = ctx.createRadialGradient(-a * 0.2, -b * 0.2, 0, 0, 0, Math.max(a, b));
    g.addColorStop(0, C[0]); g.addColorStop(0.7, C[1]); g.addColorStop(1, '#24525a');
    ctx.fillStyle = g; ctx.fill();
    if (rc.lod >= 5) {
      // Камни по берегу.
      const n = Math.max(10, Math.round((Math.PI * (a + b)) / 380));
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU;
        const sr = 120 + rc.rand() * 140;
        circle(ctx, Math.cos(t) * (a - 40), Math.sin(t) * (b - 40), sr, LS_COLORS.stone[i % 3]);
      }
      // Блики.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(rc.px(0.9), 40);
      ctx.beginPath(); ctx.ellipse(-a * 0.2, -b * 0.25, a * 0.45, b * 0.3, 0, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(a * 0.15, b * 0.1, a * 0.3, b * 0.18, 0, Math.PI * 1.15, Math.PI * 1.5); ctx.stroke();
    }
    if (o.variant !== 'mirror' && rc.lod >= 6) {
      for (let i = 0; i < 6; i += 1) {
        const t = rc.rand() * TAU; const d = 0.25 + rc.rand() * 0.45;
        const x = Math.cos(t) * a * d; const y = Math.sin(t) * b * d;
        const lr = 160 + rc.rand() * 120;
        ctx.fillStyle = '#5f9e4a';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, lr, t + 0.35, t + TAU - 0.35); ctx.closePath(); ctx.fill();
        if (i % 2 === 0) circle(ctx, x, y, lr * 0.32, '#f2a7c3');
      }
    }
  },
  fountain(ctx, o, a, b, C, rc) {
    circle(ctx, 0, 0, a, LS_COLORS.stone[1]);
    ctx.beginPath(); ellipse(ctx, 0, 0, a, b); edge(ctx, LS_COLORS.stone[2], rc.px(1));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, a * 0.82);
    g.addColorStop(0, C[2]); g.addColorStop(1, C[1]);
    circle(ctx, 0, 0, a * 0.82, g);
    if (rc.lod >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(rc.px(0.8), 20);
      for (const k of [0.3, 0.5, 0.7]) { ctx.beginPath(); ctx.arc(0, 0, a * k, 0, TAU); ctx.stroke(); }
    }
    circle(ctx, 0, 0, a * 0.16, LS_COLORS.stone[1]);
    circle(ctx, 0, 0, a * 0.08, '#ffffff');
  },
  sandbox(ctx, o, a, b, C, rc) {
    ctx.fillStyle = LS_COLORS.wood[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
    const t = Math.min(160, Math.min(a, b) * 0.15);
    ctx.fillStyle = C[0]; ctx.fillRect(-a + t, -b + t, a * 2 - t * 2, b * 2 - t * 2);
    if (rc.lod >= 8) {
      for (let i = 0; i < 120; i += 1) circle(ctx, (rc.rand() * 2 - 1) * (a - t), (rc.rand() * 2 - 1) * (b - t), 25, rc.rand() > 0.5 ? C[1] : C[2]);
      circle(ctx, a * 0.35, b * 0.3, Math.min(a, b) * 0.12, '#e2553f');
      circle(ctx, -a * 0.3, -b * 0.25, Math.min(a, b) * 0.09, '#3f7fd1');
    }
  },
  playground(ctx, o, a, b, C, rc) {
    if (o.variant === 'sand') LOOKS.sandbox(ctx, o, a, b, C, rc);
    else {
      ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 300);
      ctx.fillStyle = C[0]; ctx.fill();
      edge(ctx, C[1], 80);
    }
    if (rc.lod < 3) return;
    // Башня с горкой.
    const s = Math.min(1300, Math.min(a, b) * 0.5);
    const tx = -a + s * 0.9; const ty = -b + s * 0.9;
    ctx.fillStyle = LS_COLORS.wood[0]; ctx.fillRect(tx - s / 2, ty - s / 2, s, s);
    ctx.fillStyle = '#e2553f'; ctx.fillRect(tx - s / 2 + 60, ty - s / 2 + 60, s - 120, s - 120);
    const sl = ctx.createLinearGradient(tx + s / 2, 0, tx + s / 2 + s * 1.8, 0);
    sl.addColorStop(0, '#f2b134'); sl.addColorStop(1, '#f7d27a');
    ctx.fillStyle = sl; ctx.beginPath(); rrect(ctx, tx + s / 2, ty - s * 0.22, s * 1.8, s * 0.44, s * 0.15); ctx.fill();
    // Качели.
    const bx = a * 0.35; const by = b * 0.35;
    ctx.fillStyle = '#3f7fd1'; ctx.fillRect(bx - s * 1.1, by - 70, s * 2.2, 140);
    ctx.fillStyle = '#2c3440';
    ctx.fillRect(bx - s * 0.6, by + 120, s * 0.4, 160); ctx.fillRect(bx + s * 0.2, by + 120, s * 0.4, 160);
    circle(ctx, -a * 0.35, b * 0.4, Math.min(a, b) * 0.22, LS_COLORS.sand[0]);
  },
  swing(ctx, o, a, b, C, rc) {
    ctx.strokeStyle = C[1]; ctx.lineWidth = 120; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-a + 80, -b + 80); ctx.lineTo(-a + 200, 0); ctx.lineTo(-a + 80, b - 80);
    ctx.moveTo(a - 80, -b + 80); ctx.lineTo(a - 200, 0); ctx.lineTo(a - 80, b - 80);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = C[0]; ctx.fillRect(-a + 100, -80, a * 2 - 200, 160);
    ctx.fillStyle = '#e2553f';
    ctx.fillRect(-a * 0.45 - 230, 220, 460, 200);
    ctx.fillStyle = '#3f7fd1';
    ctx.fillRect(a * 0.45 - 230, 220, 460, 200);
  },
  greenhouse(ctx, o, a, b, C, rc) {
    ctx.beginPath(); rrect(ctx, -a, -b, a * 2, b * 2, 120);
    const g = ctx.createLinearGradient(-a, 0, a, 0);
    g.addColorStop(0, C[1]); g.addColorStop(0.5, C[2]); g.addColorStop(1, C[1]);
    ctx.fillStyle = g; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    edge(ctx, LS_COLORS.metal[2], Math.max(rc.px(1), 50));
    if (rc.lod >= 6) {
      // Грядки внутри.
      ctx.fillStyle = 'rgba(80,140,70,0.35)';
      ctx.fillRect(-a * 0.75, -b * 0.85, a * 0.5, b * 1.7);
      ctx.fillRect(a * 0.25, -b * 0.85, a * 0.5, b * 1.7);
    }
    ctx.strokeStyle = LS_COLORS.metal[2];
    ctx.lineWidth = Math.max(rc.px(0.7), 30);
    ctx.beginPath();
    const along = b >= a;
    if (along) for (let y = -b + 700; y < b; y += 700) { ctx.moveTo(-a, y); ctx.lineTo(a, y); }
    else for (let x = -a + 700; x < a; x += 700) { ctx.moveTo(x, -b); ctx.lineTo(x, b); }
    if (along) { ctx.moveTo(0, -b); ctx.lineTo(0, b); } else { ctx.moveTo(-a, 0); ctx.lineTo(a, 0); }
    ctx.stroke();
  },
  vegbeds(ctx, o, a, b, C, rc) {
    gravel(ctx, -a, -b, a * 2, b * 2, LS_COLORS.gravel, rc.rand, rc, 0.4);
    const along = a >= b;
    const len = along ? a * 2 : b * 2;
    const n = Math.max(1, Math.floor((along ? b * 2 : a * 2) / 1500));
    const bedW = Math.min(1100, ((along ? b * 2 : a * 2) / n) * 0.75);
    for (let i = 0; i < n; i += 1) {
      const c = (along ? -b : -a) + ((along ? b * 2 : a * 2) / n) * (i + 0.5);
      const [x, y, w, h] = along ? [-a + 200, c - bedW / 2, len - 400, bedW] : [c - bedW / 2, -b + 200, bedW, len - 400];
      ctx.fillStyle = LS_COLORS.wood[1]; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C[0]; ctx.fillRect(x + 50, y + 50, w - 100, h - 100);
      if (rc.lod >= 8) {
        for (let k = 250; k < (along ? w : h) - 150; k += 300) {
          for (const off of [0.3, 0.7]) {
            const px = along ? x + k : x + w * off;
            const py = along ? y + h * off : y + k;
            circle(ctx, px, py, 90 + rc.rand() * 40, rc.rand() > 0.3 ? LS_COLORS.leaf[1] : LS_COLORS.leaf[2]);
          }
        }
      }
    }
  },
  compost(ctx, o, a, b, C, rc) {
    ctx.fillStyle = C[0]; ctx.fillRect(-a, -b, a * 2, b * 2);
    ctx.fillStyle = '#3d2e22'; ctx.fillRect(-a + 80, -b + 80, a * 2 - 160, b * 2 - 160);
    ctx.strokeStyle = C[1]; ctx.lineWidth = 40;
    ctx.beginPath(); ctx.moveTo(0, -b); ctx.lineTo(0, b); ctx.stroke();
  },
  well(ctx, o, a, b, C, rc) {
    circle(ctx, 0, 0, a, C[0]);
    if (rc.lod >= 8) {
      const n = 14;
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * TAU;
        circle(ctx, Math.cos(t) * a * 0.82, Math.sin(t) * a * 0.82, a * 0.15, C[i % 2 ? 1 : 2]);
      }
    }
    circle(ctx, 0, 0, a * 0.6, '#1f3a44');
    if (o.variant !== 'open') {
      ctx.fillStyle = LS_COLORS.roof[1];
      ctx.fillRect(-a * 1.05, -a * 0.55, a * 1.05, a * 1.1);
      ctx.fillStyle = LS_COLORS.roof[2];
      ctx.fillRect(0, -a * 0.55, a * 1.05, a * 1.1);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = rc.px(1);
      ctx.beginPath(); ctx.moveTo(0, -a * 0.55); ctx.lineTo(0, a * 0.55); ctx.stroke();
    } else {
      ctx.fillStyle = LS_COLORS.wood[1]; ctx.fillRect(-a * 1.1, -60, a * 2.2, 120);
    }
  },
  septic(ctx, o, a, b, C, rc) {
    ctx.beginPath(); ellipse(ctx, 0, 0, a, b);
    ctx.fillStyle = 'rgba(127,127,121,0.18)'; ctx.fill();
    ctx.setLineDash([300, 200]);
    edge(ctx, C[2], Math.max(rc.px(1.2), 50));
    ctx.setLineDash([]);
    circle(ctx, 0, 0, Math.min(a, b) * 0.3, C[1]);
    if (rc.lod >= 6) {
      ctx.fillStyle = '#4a4f57';
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
      ctx.fillStyle = o.variant === 'teak' ? C[0] : '#f6f3ec';
      ctx.beginPath(); rrect(ctx, -lw, -b, lw * 2, b * 2, 90); ctx.fill();
      ctx.strokeStyle = 'rgba(80,70,60,0.45)'; ctx.lineWidth = Math.max(rc.px(0.7), 20); ctx.stroke();
      ctx.fillStyle = o.variant === 'teak' ? C[2] : '#dcd3c2';
      ctx.beginPath(); rrect(ctx, -lw * 0.8, -b * 0.92, lw * 1.6, b * 0.3, 60); ctx.fill();
      ctx.restore();
    }
    circle(ctx, 0, -b * 0.5, Math.min(220, a * 0.15), LS_COLORS.wood[0]);
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
    ctx.fillStyle = LS_COLORS.metal[1];
    ctx.fillRect(-a + 60, -b, 70, b * 2); ctx.fillRect(a - 130, -b, 70, b * 2);
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
    ctx.beginPath(); ctx.arc(0, 0, tr * 0.8, 0, TAU); edge(ctx, 'rgba(40,22,10,0.3)', 15);
  },
  lamp(ctx, o, a, b, C, rc) {
    const pole = o.variant === 'pole';
    const gr = Math.max(a * (pole ? 7 : 4), 900);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    g.addColorStop(0, 'rgba(255,214,120,0.5)'); g.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ellipse(ctx, 0, 0, gr, gr); ctx.fill();
    circle(ctx, 0, 0, a, C[1]);
    circle(ctx, 0, 0, a * 0.6, LS_COLORS.fire[2]);
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

// Силуэт для тени (локальные оси объекта).
function silhouette(ctx, o, def, a, b) {
  ctx.beginPath();
  if (def.look === 'pine' || def.look === 'spruce') starPath(ctx, a, b, 16, 0.85);
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
  const len = Math.min(4500, Math.max(120, height * shadow.k));
  return { x: shadow.x * len, y: shadow.y * len };
}

// Мягкая тень: силуэт несколько раз с растущим размером и малой плотностью.
function drawShadow(ctx, o, def, shadow) {
  const off = shadowOffset(o.height || def.height, shadow);
  ctx.save();
  ctx.translate(o.x + off.x, o.y + off.y);
  ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
  ctx.fillStyle = 'rgb(18,32,18)';
  for (const [k, alpha] of [[1.1, 0.06], [1.02, 0.08], [0.94, 0.1]]) {
    ctx.globalAlpha = alpha;
    silhouette(ctx, o, def, (o.w / 2) * k, (o.h / 2) * k);
    ctx.fill();
  }
  ctx.restore();
}

function renderContext(o, opts) {
  const a = -((o.rotation || 0) * Math.PI) / 180;
  const rot = (x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const lightWorld = opts.shadow ? { x: -opts.shadow.x, y: -opts.shadow.y } : { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  return {
    px: opts.px,
    lod: opts.lod,
    rand: seededRandom(o.id),
    light: rot(lightWorld.x, lightWorld.y),
    shadowLocal: rot(-lightWorld.x, -lightWorld.y),
  };
}

export function drawLandscapeObject(ctx, o, opts) {
  const def = landscapeDef(o.kind);
  if (!def) return;
  const look = LOOKS[def.look] || LOOKS.pad;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
  try {
    look(ctx, o, o.w / 2, o.h / 2, objectColors(o, def), renderContext(o, opts));
  } finally {
    ctx.restore();
  }
}

// Покрытия — до дома; opts: { px, lod, shadow }.
export function drawLandscapeGround(ctx, objects, opts) {
  for (const o of objects) {
    if (landscapeDef(o.kind)?.layer === 'ground') drawLandscapeObject(ctx, o, opts);
  }
}

// Тень дома на землю — до заливки пятна дома (render.js), иначе ляжет на крышу.
export function drawHouseShadow(ctx, footprints, opts, height = 6000) {
  if (!footprints.length || opts.lod < 1.5) return;
  const off = shadowOffset(height, opts.shadow);
  ctx.save();
  ctx.fillStyle = 'rgb(18,32,18)';
  ctx.globalAlpha = 0.14;
  ctx.beginPath();
  for (const f of footprints) {
    f.forEach((p, i) => (i ? ctx.lineTo(p.x + off.x, p.y + off.y) : ctx.moveTo(p.x + off.x, p.y + off.y)));
    ctx.closePath();
  }
  ctx.fill(); // одним путём: перекрытия комнат не темнеют дважды
  ctx.restore();
}

// Тени объектов, низкие объекты, кроны — после дома.
export function drawLandscapeRaised(ctx, objects, opts) {
  if (opts.lod >= 1.5) {
    for (const o of objects) {
      const def = landscapeDef(o.kind);
      if (def?.shadow) drawShadow(ctx, o, def, opts.shadow);
    }
  }
  for (const layer of ['low', 'tall']) {
    for (const o of objects) {
      if (landscapeDef(o.kind)?.layer === layer) drawLandscapeObject(ctx, o, opts);
    }
  }
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
export function drawLandscapeOverlay(ctx, objects, { sel = [], hoverId = null, warnings = new Map(), w2s, tokens, scale, warnColor }) {
  const screenPath = (o, inflate = 0) => {
    const pts = objectOutline(inflate ? { ...o, w: o.w + inflate * 2, h: o.h + inflate * 2 } : o).map((p) => w2s(p.x, p.y));
    outlinePath(ctx, pts);
  };
  const selected = new Set(sel);
  for (const o of objects) {
    const notes = warnings.get(o.id);
    if (notes?.length) {
      const outside = notes.some((t) => t.startsWith('За границей'));
      screenPath(o, 3 / scale);
      ctx.strokeStyle = outside ? tokens.danger : warnColor;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (o.id === hoverId && !selected.has(o.id)) {
      screenPath(o);
      ctx.strokeStyle = tokens.hover;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  const chosen = objects.filter((o) => selected.has(o.id));
  for (const o of chosen) {
    const corners = objectCorners(o).map((c) => w2s(c.x, c.y));
    outlinePath(ctx, corners);
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1.5;
    if (chosen.length > 1) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (chosen.length !== 1) return null;
  const o = chosen[0];
  const def = landscapeDef(o.kind);
  const corners = objectCorners(o).map((c) => w2s(c.x, c.y));
  const top = Math.min(...corners.map((p) => p.y));
  const mid = corners.reduce((s, p) => s + p.x, 0) / 4;
  const size = def?.lockAspect ? `⌀ ${(o.w / 1000).toFixed(2)} м` : `${(o.w / 1000).toFixed(2)} × ${(o.h / 1000).toFixed(2)} м`;
  pill(ctx, `${size} · ${Math.round(o.rotation || 0)}°`, mid, top - 14, tokens, tokens.accent);
  const { rotators } = landscapeHandles(o, 20, scale);
  for (const r of rotators) {
    const p = w2s(r.x, r.y);
    ctx.fillStyle = tokens.surface;
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE / 2 + 1, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE / 2 - 1.5, -0.6, Math.PI * 1.2); ctx.stroke();
  }
  for (const p of corners) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE); ctx.fill(); ctx.stroke();
  }
  return null;
}

// Миниатюра для карточки каталога (тот же рисовальщик).
export function drawLandscapePreview(canvas, kind) {
  const def = landscapeDef(kind);
  if (!def) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const o = { id: `preview-${kind}`, kind, x: 0, y: 0, rotation: 0, w: def.w, h: def.h, height: def.height, variant: def.variants[0].id, meta: { ...(def.meta || {}) } };
  // Длинные узкие объекты (изгородь, забор) — по ширине карточки.
  const scale = Math.min((W * 0.78) / o.w, (H * 0.74) / o.h);
  const shadow = { x: Math.SQRT1_2, y: Math.SQRT1_2, k: 0.18 };
  ctx.setTransform(scale, 0, 0, scale, W / 2 - (def.shadow ? 4 : 0), H / 2 - (def.shadow ? 4 : 0));
  const opts = { px: (v) => v / scale, lod: Math.max(scale * 1000, 30), shadow };
  if (def.shadow) drawShadow(ctx, o, def, shadow);
  drawLandscapeObject(ctx, o, opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Разрез участка в SVG (без DOM): профиль из core/landscape-section.js →
// строка SVG в миллиметрах листа (масштаб 1:N). Стили: «Эскиз» —
// рукописные линии и акварельные заливки, дальние планы бледнее; «Чертёж» —
// чёрные линии, штриховка материалов в сечении, проекции тонкими линиями.
// Та же строка — и панель разреза, и файл .svg для скачивания.

import { plantShape } from '../core/landscape-section.js';

export const SECTION_SCALES = [20, 25, 50, 100, 200, 250, 500, 1000];
export const SECTION_STYLES = [{ id: 'sketch', title: 'Эскиз' }, { id: 'drawing', title: 'Чертёж' }];

// Самый крупный масштаб, при котором разрез влезает в поле A3 (мм листа).
export function pickSectionScale(profile, maxW = 380, maxH = 190) {
  const w = profile.box.x1 - profile.box.x0;
  const h = profile.box.z1 - profile.box.z0;
  return SECTION_SCALES.find((d) => w / d <= maxW && h / d <= maxH) ?? SECTION_SCALES[SECTION_SCALES.length - 1];
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v) => (Math.round(v * 100) / 100).toString();
const textW = (text, size) => String(text).length * size * 0.6;

// Краски «Эскиза» по материалу (если у примитива нет своей краски).
const SKETCH_FILL = {
  soil: '#b39a7c', fill: '#b39a7c', concrete: '#d3cec4', stone: '#bdb6a8', wood: '#b7956f', gravel: '#ddd6c6', tiles: '#d1cdc4',
  lawn: '#a7b97f', water: '#9cc8cc', brick: '#e3d5c3', glass: '#d9e9ec', metal: '#8e9195', mulch: '#8b6f58', sand: '#e6ddc6',
  rubber: '#a7b6a0', asphalt: '#a2a4a4', leaf: '#86996c', house: '#ece5da', shelter: '#cbbfae', object: '#c9c0b2', mesh: '#b0b3b6',
};
const OWN_COLOR = new Set(['tiles', 'wood', 'gravel', 'stone', 'concrete', 'metal', 'object', 'shelter', 'leaf', 'asphalt', 'rubber']);

// Штриховки «Чертежа» (мм листа).
function patterns(id, ink, op = 1) {
  const line = (d, w = 0.13) => `<path d="${d}" stroke="${ink}" stroke-width="${w}" stroke-opacity="${op}" fill="none"/>`;
  const dot = (x, y, r = 0.14) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}" fill-opacity="${op}"/>`;
  const pat = (name, w, h, body, rot = 0) => `<pattern id="${id}-${name}" patternUnits="userSpaceOnUse" width="${w}" height="${h}"${rot ? ` patternTransform="rotate(${rot})"` : ''}>${body}</pattern>`;
  return [
    pat('soil', 2.2, 2.2, `${line('M0 0V2.2', 0.12)}${dot(1.1, 1.1, 0.12)}`, 45),
    pat('earth', 1.6, 1.6, line('M0 0V1.6', 0.11), 45),
    pat('concrete', 3, 3, `${dot(0.6, 0.7)}${dot(2.1, 1.4, 0.1)}${dot(1.2, 2.4, 0.17)}${line('M2.2 2.1l0.5 0.6h-0.9z', 0.1)}`),
    pat('stone', 1.4, 1.4, line('M0 0V1.4M0 0H1.4', 0.11), 45),
    pat('wood', 1, 1, line('M0 0.5H1', 0.1), 0),
    pat('gravel', 1.6, 1.6, `<circle cx="0.5" cy="0.5" r="0.3" stroke="${ink}" stroke-opacity="${op}" stroke-width="0.08" fill="none"/><circle cx="1.25" cy="1.2" r="0.22" stroke="${ink}" stroke-opacity="${op}" stroke-width="0.08" fill="none"/>`),
    pat('tiles', 0.8, 0.8, line('M0 0V0.8', 0.09), 45),
    pat('water', 3, 1.2, line('M0.2 0.6H1.6', 0.1)),
    pat('brick', 0.9, 0.9, line('M0 0V0.9', 0.1), 45),
    pat('mulch', 1.4, 1.4, `${dot(0.4, 0.5, 0.18)}${line('M0.8 1.1l0.4 -0.2', 0.1)}`),
    pat('sand', 1.2, 1.2, `${dot(0.3, 0.3, 0.08)}${dot(0.9, 0.8, 0.08)}`),
    pat('leaf', 1.6, 1.6, `<path d="M0.2 1.2q0.4-0.8 0.8 0" stroke="${ink}" stroke-opacity="${op}" stroke-width="0.08" fill="none"/>`),
  ].join('');
}
const HATCH = { soil: 'soil', fill: 'soil', concrete: 'concrete', stone: 'stone', wood: 'wood', gravel: 'gravel', tiles: 'tiles', water: 'water', brick: 'brick', mulch: 'mulch', sand: 'sand', leaf: 'leaf', asphalt: 'tiles', rubber: 'sand', metal: 'tiles' };

const mix = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a); const B = p(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : null);

// SVG разреза. opts: style ('sketch' | 'drawing'), scale (знаменатель).
export function sectionSvg(profile, { style = 'sketch', scale = null } = {}) {
  const sketch = style !== 'drawing';
  const den = scale || pickSectionScale(profile);
  const k = 1 / den;
  const { box } = profile;
  const W = (box.x1 - box.x0) * k;
  const Hd = (box.z1 - box.z0) * k;
  const labelRows = 3;
  const rowH = 5.2;
  const M = { l: 24, r: 16, t: 12 + labelRows * rowH, b: 26 };
  const width = W + M.l + M.r;
  const height = Hd + M.t + M.b;
  const X = (x) => M.l + (x - box.x0) * k;
  const Y = (z) => M.t + (box.z1 - z) * k;
  const id = `ks-${sketch ? 's' : 'd'}`;
  const ink = sketch ? '#4a4237' : '#1d1d1b';
  const paper = sketch ? '#fbf8f1' : '#ffffff';
  const font = sketch ? "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" : "'ISOCPEUR', 'GOST type A', 'Arial Narrow', Arial, sans-serif";
  const out = [];
  const path = (pts, close = true) => `M${pts.map((p) => `${f(X(p.x))} ${f(Y(p.z))}`).join('L')}${close ? 'Z' : ''}`;
  // Сглаженный контур (кроны в «Эскизе»): квадратичные кривые через середины.
  const smooth = (pts) => {
    const P = pts.map((p) => ({ x: X(p.x), y: Y(p.z) }));
    const n = P.length;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    let d = `M${f(mid(P[n - 1], P[0]).x)} ${f(mid(P[n - 1], P[0]).y)}`;
    for (let i = 0; i < n; i += 1) {
      const m = mid(P[i], P[(i + 1) % n]);
      d += `Q${f(P[i].x)} ${f(P[i].y)} ${f(m.x)} ${f(m.y)}`;
    }
    return `${d}Z`;
  };

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}mm" height="${f(height)}mm" viewBox="0 0 ${f(width)} ${f(height)}" font-family="${esc(font)}" data-scale="${den}" data-style="${sketch ? 'sketch' : 'drawing'}">`);
  out.push(`<title>Разрез ${esc(profile.name)}–${esc(profile.name)}</title>`);
  out.push('<defs>');
  out.push(patterns(id, ink, sketch ? 0.35 : 1));
  if (sketch) {
    out.push(`<filter id="${id}-rough" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.3" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="0.55" xChannelSelector="R" yChannelSelector="G"/></filter>`);
    out.push(`<filter id="${id}-wc" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="3" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="1.4" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="0.12"/></filter>`);
    out.push(`<linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfeaf0" stop-opacity="0.9"/><stop offset="1" stop-color="#fbf8f1" stop-opacity="0"/></linearGradient>`);
  }
  out.push(`<clipPath id="${id}-clip"><rect x="${f(X(box.x0))}" y="${f(M.t - labelRows * rowH)}" width="${f(W)}" height="${f(Hd + labelRows * rowH)}"/></clipPath>`);
  out.push('</defs>');
  out.push(`<rect width="100%" height="100%" fill="${paper}"/>`);
  if (sketch) out.push(`<rect x="${f(X(box.x0))}" y="${f(M.t)}" width="${f(W)}" height="${f(Hd * 0.7)}" fill="url(#${id}-sky)"/>`);

  // --- Земля: полоса грунта под линией земли.
  const g = profile.ground;
  const groundBand = [...g, ...[...g].reverse().map((p) => ({ x: p.x, z: p.z - (sketch ? 5 : 3.2) * den }))];
  out.push(`<g clip-path="url(#${id}-clip)">`);
  if (sketch) {
    out.push(`<path d="${path(groundBand)}" fill="#c9b596" fill-opacity="0.55" filter="url(#${id}-wc)"/>`);
    out.push(`<path d="${path(groundBand)}" fill="url(#${id}-earth)"/>`);
  } else out.push(`<path d="${path(groundBand)}" fill="url(#${id}-earth)" stroke="none"/>`);

  // --- Примитивы: от дальних к ближним.
  const strokeW = (p) => (p.cut ? (sketch ? 0.35 : 0.5) : (sketch ? 0.22 : 0.18));
  const strokeC = (p) => (p.cut ? ink : mix(ink, sketch ? '#b9b2a6' : '#b5b5b5', Math.min(1, 0.25 + (p.fade || 0) * 0.75)));
  for (const p of profile.prims) {
    const fade = p.fade || 0;
    const sw = strokeW(p);
    const sc = strokeC(p);
    const rough = sketch ? ` filter="url(#${id}-rough)"` : '';
    if (p.shape === 'plant') {
      const sh = plantShape(p);
      const base = hex6(p.color) || SKETCH_FILL.leaf;
      const fill = sketch ? mix(mix(base, '#9fb3bf', fade * 0.35), paper, 0.1 + fade * 0.55) : '#ffffff';
      const crownD = sketch ? smooth(sh.crown) : path(sh.crown);
      const op = sketch ? 0.96 - fade * 0.1 : 1;
      if (sh.trunk) out.push(`<path d="${path(sh.trunk)}" fill="${sketch ? mix('#7a5c44', paper, fade * 0.6) : '#ffffff'}" stroke="${sc}" stroke-width="${f(sw * 0.8)}"${rough}/>`);
      if (sketch) {
        out.push(`<path d="${crownD}" fill="${fill}" fill-opacity="${f(op)}" filter="url(#${id}-wc)"/>`);
        // Тень кроны: второй слой темнее снизу.
        out.push(`<path d="${crownD}" fill="${mix(base, '#3d4a35', 0.25)}" fill-opacity="${f(0.18 * (1 - fade))}" transform="translate(0.35 0.45)" filter="url(#${id}-wc)"/>`);
      }
      out.push(`<path d="${crownD}" fill="${sketch ? 'none' : fill}" stroke="${sc}" stroke-width="${f(sw)}" stroke-linejoin="round"${rough} data-kind="${esc(p.kind)}"/>`);
      if (sh.crown2) {
        const d2 = sketch ? smooth(sh.crown2) : path(sh.crown2);
        out.push(`<path d="${d2}" fill="${fill}" fill-opacity="${f(op)}" stroke="${sc}" stroke-width="${f(sw)}"${rough}/>`);
      }
      continue;
    }
    const d = path(p.pts);
    const own = hex6(p.color);
    let fill;
    if (p.mat === 'void' || p.mat === 'mesh') fill = 'none';
    else if (sketch) {
      const baseC = (OWN_COLOR.has(p.mat) && own) || SKETCH_FILL[p.mat] || own || '#cfc8bb';
      fill = mix(mix(baseC, '#a9bcc6', fade * 0.3), paper, fade * 0.6);
    } else fill = '#ffffff';
    if (sketch && fill !== 'none') out.push(`<path d="${d}" fill="${fill}" fill-opacity="${f(0.9 - fade * 0.2)}" filter="url(#${id}-wc)"/>`);
    else if (fill !== 'none') out.push(`<path d="${d}" fill="${fill}"/>`);
    if (p.cut && HATCH[p.mat]) out.push(`<path d="${d}" fill="url(#${id}-${HATCH[p.mat]})"/>`);
    if (p.mat === 'void') {
      // Опоры настила: стойки через ~1,2 м.
      const xs = p.pts.map((q) => q.x);
      const x0 = Math.min(...xs); const x1 = Math.max(...xs);
      const n = Math.max(1, Math.round((x1 - x0) / 1200));
      const zs = p.pts.map((q) => q.z);
      for (let i = 0; i <= n; i += 1) {
        const x = x0 + ((x1 - x0) * i) / n + (i === 0 ? 50 : i === n ? -50 : 0);
        out.push(`<path d="M${f(X(x))} ${f(Y(Math.min(...zs)))}V${f(Y(Math.max(...zs)))}" stroke="${sc}" stroke-width="${f(Math.max(0.25, 100 * k))}"${rough}/>`);
      }
      continue;
    }
    if (p.mat === 'glass') {
      const xs = p.pts.map((q) => q.x);
      const xm = (Math.min(...xs) + Math.max(...xs)) / 2;
      const zs = p.pts.map((q) => q.z);
      out.push(`<path d="M${f(X(xm) - 0.3)} ${f(Y(Math.min(...zs)))}V${f(Y(Math.max(...zs)))}M${f(X(xm) + 0.3)} ${f(Y(Math.min(...zs)))}V${f(Y(Math.max(...zs)))}" stroke="${sc}" stroke-width="0.13"/>`);
    }
    if (p.look === 'fence' && !p.cut) {
      // Штакетник/сетка — вертикальные линии.
      const xs = p.pts.map((q) => q.x); const zs = p.pts.map((q) => q.z);
      const x0 = Math.min(...xs); const x1 = Math.max(...xs);
      const step = p.mat === 'mesh' ? 2500 : 150;
      for (let x = x0; x <= x1 && (x1 - x0) / step < 400; x += step) out.push(`<path d="M${f(X(x))} ${f(Y(Math.min(...zs)))}V${f(Y(Math.max(...zs)))}" stroke="${sc}" stroke-width="0.1"/>`);
    }
    if (p.mat === 'shelter') {
      // Навес/беседка: стойки и кровля условно.
      const xs = p.pts.map((q) => q.x); const zs = p.pts.map((q) => q.z);
      const x0 = Math.min(...xs); const x1 = Math.max(...xs); const z0 = Math.min(...zs); const z1 = Math.max(...zs);
      const roof = Math.min(600, (z1 - z0) * 0.25);
      out.push(`<path d="M${f(X(x0) + 0.6)} ${f(Y(z0))}V${f(Y(z1 - roof))}M${f(X(x1) - 0.6)} ${f(Y(z0))}V${f(Y(z1 - roof))}" stroke="${sc}" stroke-width="${f(sw * 1.3)}"/>`);
      out.push(`<path d="${path([{ x: x0 - 300, z: z1 - roof }, { x: (x0 + x1) / 2, z: z1 }, { x: x1 + 300, z: z1 - roof }])}" fill="${sketch ? mix(own || '#8f8379', paper, fade * 0.6) : '#fff'}" stroke="${sc}" stroke-width="${f(sw)}"${rough}/>`);
      continue;
    }
    out.push(`<path d="${d}" fill="none" stroke="${sc}" stroke-width="${f(p.mat === 'shelter' ? sw * 0.5 : sw)}" stroke-linejoin="round"${rough} data-kind="${esc(p.kind)}"${p.cut ? ' data-cut="1"' : ''}/>`);
  }
  // Линия земли — поверх подножий.
  out.push(`<path d="${path(g, false)}" fill="none" stroke="${sketch ? '#5e5140' : ink}" stroke-width="${sketch ? 0.45 : 0.6}" stroke-linecap="round"${sketch ? ` filter="url(#${id}-rough)"` : ''} data-kind="ground"/>`);
  out.push('</g>');

  // --- Отметки высот: треугольник + полка с текстом.
  const placed = [];
  const msz = 2.4;
  for (const m of profile.marks) {
    const x = X(m.x);
    const y = Y(m.z);
    const tw = textW(m.text, msz) + 1;
    const left = x + tw + 3 > width - 2;
    let ty = y - 2.2;
    while (placed.some((q) => Math.abs(q.ty - ty) < 3.2 && Math.abs(q.x - x) < tw + 3)) ty -= 3.4;
    placed.push({ x, ty });
    const dir = left ? -1 : 1;
    out.push(`<g class="sec-mark" stroke="${ink}" stroke-width="0.18" fill="none">`);
    out.push(`<path d="M${f(x)} ${f(y)}l-1 -1.7h2z" fill="${sketch ? 'none' : ink}"/>`);
    out.push(`<path d="M${f(x)} ${f(y - 1.7)}V${f(ty)}h${f(dir * (tw + 1))}"/>`);
    out.push('</g>');
    out.push(`<text x="${f(x + dir * 0.6)}" y="${f(ty - 0.5)}" font-size="${msz}" fill="${ink}" text-anchor="${left ? 'end' : 'start'}" class="sec-mark-text">${esc(m.text)}</text>`);
  }

  // --- Подписи объектов: выноски вверх, к рядам над разрезом.
  const seen = new Set();
  const cands = [];
  for (const p of profile.prims) {
    if (!p.title || (!p.cut && (p.fade || 0) > 0.55)) continue;
    const key = `${p.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let x; let z;
    if (p.shape === 'plant') { x = p.plant.x; z = p.plant.z + p.plant.h; } else {
      const xs = p.pts.map((q) => q.x);
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
      z = Math.max(...p.pts.map((q) => q.z));
    }
    if (x < box.x0 || x > box.x1) continue;
    cands.push({ x: X(x), y: Y(z), text: p.title });
  }
  cands.sort((a, b) => a.x - b.x);
  const lsz = 2.6;
  const rows = Array.from({ length: labelRows }, () => -Infinity);
  for (const c of cands) {
    const tw = textW(c.text, lsz);
    const tx = Math.max(M.l, Math.min(width - M.r - tw, c.x - tw / 2));
    const r = rows.findIndex((end) => tx > end + 3);
    if (r < 0) continue; // нет места — без подписи
    rows[r] = tx + tw;
    const ry = M.t - 2 - r * rowH;
    out.push(`<path d="M${f(c.x)} ${f(c.y - 0.6)}V${f(ry + 0.8)}" stroke="${ink}" stroke-width="0.13" stroke-dasharray="${sketch ? '0.8 0.6' : 'none'}" fill="none"/>`);
    out.push(`<circle cx="${f(c.x)}" cy="${f(c.y - 0.6)}" r="0.35" fill="${ink}"/>`);
    out.push(`<path d="M${f(Math.min(tx, c.x))} ${f(ry + 0.8)}H${f(Math.max(tx + tw, c.x))}" stroke="${ink}" stroke-width="0.13"/>`);
    out.push(`<text x="${f(tx)}" y="${f(ry)}" font-size="${lsz}" fill="${ink}" class="sec-label">${esc(c.text)}</text>`);
  }

  // --- Шкала высот слева (м).
  const zStep = den <= 50 ? 500 : den <= 200 ? 1000 : 2000;
  const zA = Math.ceil(box.z0 / zStep) * zStep;
  const rx = M.l - 7;
  out.push(`<path d="M${f(rx)} ${f(Y(box.z0))}V${f(Y(box.z1))}" stroke="${ink}" stroke-width="0.2"/>`);
  for (let z = zA; z <= box.z1; z += zStep) {
    out.push(`<path d="M${f(rx - 1)} ${f(Y(z))}h1" stroke="${ink}" stroke-width="0.2"/>`);
    out.push(`<text x="${f(rx - 1.6)}" y="${f(Y(z) + 0.8)}" font-size="2.1" fill="${ink}" text-anchor="end">${(z / 1000).toFixed(z % 1000 ? 1 : 0).replace('.', ',')}</text>`);
  }
  out.push(`<text x="${f(rx - 1.6)}" y="${f(Y(box.z1) - 2)}" font-size="2.1" fill="${ink}" text-anchor="end">м</text>`);

  // --- Линейный масштаб и заголовок.
  const niceM = [1, 2, 5, 10, 20, 50, 100, 200].find((m2) => (m2 * 1000 * k) >= 30) || 200;
  const barW = niceM * 1000 * k;
  const by = height - 14;
  const segs = 5;
  for (let i = 0; i < segs; i += 1) {
    out.push(`<rect x="${f(M.l + (barW * i) / segs)}" y="${f(by)}" width="${f(barW / segs)}" height="1.2" fill="${i % 2 ? paper : ink}" stroke="${ink}" stroke-width="0.15"/>`);
  }
  out.push(`<text x="${f(M.l)}" y="${f(by - 1)}" font-size="2.2" fill="${ink}">0</text>`);
  out.push(`<text x="${f(M.l + barW)}" y="${f(by - 1)}" font-size="2.2" fill="${ink}" text-anchor="middle">${niceM} м</text>`);
  out.push(`<text x="${f(M.l)}" y="${f(height - 4)}" font-size="5" fill="${ink}" class="sec-title">Разрез ${esc(profile.name)}–${esc(profile.name)}</text>`);
  out.push(`<text x="${f(M.l + textW(`Разрез ${profile.name}–${profile.name}`, 5) * 1.15 + 6)}" y="${f(height - 4)}" font-size="3" fill="${ink}">М 1:${den} · глубина вида ${(profile.depth / 1000).toFixed(0)} м</text>`);
  out.push('</svg>');
  return out.join('');
}

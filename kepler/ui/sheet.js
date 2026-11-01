// Печатные листы A3 (альбомный): план каждого этажа в стандартном масштабе,
// рамка, штамп и экспликация помещений; генплан — если есть граница участка.
// PDF — все листы альбомом, PNG — лист текущего этажа (или генплан).
//
// Лист рисуется как экран с 96 CSS px на дюйм и плотностью 150 dpi: шрифты
// и линии плана выходят того же размера, что на экране (≈3 мм текст).

import { rectCornersWorld } from '../core/building.js';
import { groundLevel, levelProject, sortedLevels } from '../core/model.js';
import { buildingFootprintM2 } from '../core/rooms.js';
import { buildImagePdf } from '../core/pdf.js';
import { roomSchedule } from '../core/schedule.js';
import { buildZonePolygon, neighborRectCorners, polygonAreaM2 } from '../core/site.js';
import { deriveWalls } from '../core/walls.js';
import { createRenderer, projectPoint, underlayHandles } from '../render.js';
import { state } from './state.js';

export const SHEET = { w: 420, h: 297 }; // мм
const DPI = 150;
const PX = DPI / 25.4; // пикселей листа на мм
const CSS = 96 / 25.4; // CSS px на мм: план печатается «как на экране»
const FRAME = { x0: 20, y0: 5, x1: 415, y1: 292 }; // рамка (поле 20 мм слева)
const STAMP = { x0: 230, y0: 237 }; // штамп 185×55 в правом нижнем углу
const AREA = { x0: 25, y0: 10, x1: 410, y1: 232 }; // поле чертежа
export const PLAN_SCALES = [50, 75, 100, 150, 200, 250, 300, 400, 500];
export const SITE_SCALES = [200, 250, 500, 1000, 2000, 5000];

// Самый крупный стандартный масштаб, при котором габарит влезает в поле.
export function pickScale(spanW, spanH, areaW, areaH, scales) {
  return scales.find((d) => spanW / d <= areaW && spanH / d <= areaH) ?? scales[scales.length - 1];
}

const fmt = (v) => v.toFixed(1).replace('.', ',');

// Габарит набора мировых точек в осях экрана при повороте rot (рад).
function rotatedBox(points, rot) {
  const unit = { scale: 1, rotation: rot, panX: 0, panY: 0 };
  const q = points.map((p) => projectPoint(unit, p.x, p.y));
  const minX = Math.min(...q.map((p) => p.x));
  const maxX = Math.max(...q.map((p) => p.x));
  const minY = Math.min(...q.map((p) => p.y));
  const maxY = Math.max(...q.map((p) => p.y));
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// Чертёж в поле листа: возвращает canvas поля и знаменатель масштаба.
function renderArea(project, { kind, scales, points, rotation, underlayImg = null }) {
  const areaW = AREA.x1 - AREA.x0;
  const areaH = AREA.y1 - AREA.y0;
  const box = rotatedBox(points, rotation);
  const d = pickScale(box.w, box.h, areaW, areaH, scales);
  const scale = CSS / d;
  const view = {
    scale,
    rotation,
    panX: (areaW * CSS) / 2 - box.cx * scale,
    panY: (areaH * CSS) / 2 - box.cy * scale,
  };
  const canvas = document.createElement('canvas');
  const printState = {
    project,
    walls: deriveWalls(project),
    belowWalls: null,
    view,
    modeName: kind === 'site' ? 'site' : 'plan',
    selection: null,
    hover: null,
    guides: [],
    underlayImg,
  };
  createRenderer(canvas).draw(printState, {
    width: areaW * CSS, height: areaH * CSS, dpr: DPI / 96, print: true,
    site: kind === 'site', detail: kind !== 'site',
  });
  return { canvas, denominator: d };
}

function planPoints(lp) {
  const pad = (lp.settings?.exterior || 250) + 1600; // стены + размерные линии
  return lp.rooms.flatMap((r) => rectCornersWorld(lp.building, {
    x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2,
  }));
}

function sitePoints(project) {
  const site = project.site;
  const pts = [...(site.boundary || [])];
  for (const road of site.roads || []) pts.push(...road.points);
  for (const n of site.neighbors || []) pts.push(...neighborRectCorners(n));
  pts.push(...planPoints(project));
  if (site.underlay && !pts.length) pts.push(...underlayHandles(site.underlay));
  // Поля вокруг участка — под подписи.
  const b = rotatedBox(pts, 0);
  const m = Math.max(b.w, b.h) * 0.06;
  return [...pts, { x: b.cx - b.w / 2 - m, y: b.cy - b.h / 2 - m }, { x: b.cx + b.w / 2 + m, y: b.cy + b.h / 2 + m }];
}

// ---------------------------------------------------------------- Оформление

function frameAndStamp(ctx, { project, title, denominator, sheetNo, sheetCount, subtitle }) {
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(FRAME.x0, FRAME.y0, FRAME.x1 - FRAME.x0, FRAME.y1 - FRAME.y0);
  // Штамп 185×55: строки 15 / 10 / 10 / 10 / 10 мм.
  const x0 = STAMP.x0;
  const y0 = STAMP.y0;
  const x1 = FRAME.x1;
  ctx.strokeRect(x0, y0, x1 - x0, FRAME.y1 - y0);
  ctx.lineWidth = 0.25;
  for (const y of [y0 + 15, y0 + 25, y0 + 35, y0 + 45]) {
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  for (const x of [x0 + 60, x0 + 120]) {
    ctx.beginPath(); ctx.moveTo(x, y0 + 25); ctx.lineTo(x, y0 + 35); ctx.stroke();
  }
  const text = (s, x, y, size, weight = 400, color = '#000') => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(s, x, y);
  };
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  text(project.name, x0 + 4, y0 + 7.5, 6, 700);
  text(title, x0 + 4, y0 + 20, 4.5, 600);
  text(`Масштаб 1:${denominator}`, x0 + 4, y0 + 30, 3.5);
  text(`Лист ${sheetNo} из ${sheetCount}`, x0 + 64, y0 + 30, 3.5);
  text(new Date().toLocaleDateString('ru-RU'), x0 + 124, y0 + 30, 3.5);
  text(subtitle || '', x0 + 4, y0 + 40, 3.2);
  text('Kepler Plan · концептуальное решение, не рабочая документация', x0 + 4, y0 + 50, 2.6, 400, '#555');
}

// Экспликация этажа в левой нижней полосе (две колонки при нехватке места).
function scheduleTable(ctx, { level, rows, totals }) {
  const x0 = FRAME.x0 + 2;
  const y0 = STAMP.y0 + 1;
  const width = STAMP.x0 - 4 - x0;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.font = '600 3.6px system-ui, sans-serif';
  ctx.fillText(`Экспликация помещений — ${level.name}`, x0, y0 + 3);
  const footer = 6;
  const top = y0 + 7;
  const avail = FRAME.y1 - footer - top - 1;
  const groups = rows.length > Math.floor(avail / 4.6) ? 2 : 1;
  const perGroup = Math.ceil(rows.length / groups) || 1;
  const rowH = Math.max(3, Math.min(4.6, avail / (perGroup + 1)));
  const gw = (width - (groups - 1) * 6) / groups;
  const cols = [0, 12, gw - 20, gw]; // №, наименование, площадь
  ctx.lineWidth = 0.2;
  ctx.strokeStyle = '#000';
  for (let g = 0; g < groups; g += 1) {
    const gx = x0 + g * (gw + 6);
    const part = rows.slice(g * perGroup, (g + 1) * perGroup);
    const header = ['№', 'Наименование', 'Площадь, м²'];
    ctx.font = '600 2.8px system-ui, sans-serif';
    header.forEach((h, i) => ctx.fillText(h, gx + cols[i] + 1, top + rowH / 2));
    ctx.font = '400 2.8px system-ui, sans-serif';
    part.forEach((r, i) => {
      const y = top + rowH * (i + 1.5);
      ctx.fillText(r.number, gx + cols[0] + 1, y);
      const name = r.parent ? `${r.name} (в «${r.parent}»)` : r.name;
      ctx.fillText(name.length > 34 ? `${name.slice(0, 33)}…` : name, gx + cols[1] + 1, y);
      ctx.textAlign = 'right';
      ctx.fillText(fmt(r.area), gx + cols[3] - 1, y);
      ctx.textAlign = 'left';
    });
    const h = rowH * (part.length + 1);
    ctx.strokeRect(gx, top, gw, h);
    for (let i = 1; i <= part.length; i += 1) {
      ctx.beginPath(); ctx.moveTo(gx, top + rowH * i); ctx.lineTo(gx + gw, top + rowH * i); ctx.stroke();
    }
    for (const c of cols.slice(1, 3)) {
      ctx.beginPath(); ctx.moveTo(gx + c, top); ctx.lineTo(gx + c, top + h); ctx.stroke();
    }
  }
  ctx.font = '600 3px system-ui, sans-serif';
  const sums = [`Общая ${fmt(totals.total)} м²`, `жилая ${fmt(totals.living)} м²`];
  if (totals.summer > 0) sums.push(`летние ${fmt(totals.summer)} м²`);
  ctx.fillText(sums.join(' · '), x0, FRAME.y1 - footer / 2);
}

function siteTable(ctx, project) {
  const site = project.site;
  const zone = buildZonePolygon(site);
  const x0 = FRAME.x0 + 2;
  let y = STAMP.y0 + 4;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.font = '600 3.6px system-ui, sans-serif';
  ctx.fillText('Показатели участка', x0, y);
  ctx.font = '400 3px system-ui, sans-serif';
  const footprint = buildingFootprintM2(project);
  const lines = [
    `Площадь участка: ${fmt(polygonAreaM2(site.boundary))} м²`,
    zone ? `Зона застройки: ${fmt(polygonAreaM2(zone))} м²` : 'Зона застройки: отступы съедают участок',
    `Отступы: ${fmt((site.setbackBoundary ?? 0) / 1000)} м от границы, ${fmt((site.setbackNeighbor ?? 0) / 1000)} м от соседних домов`,
    `Север: ${Math.round(site.north || 0)}° · поворот дома: ${Math.round(project.building?.rotation || 0)}°`,
  ];
  if (footprint > 0) {
    const share = Math.round((footprint / polygonAreaM2(site.boundary)) * 100);
    lines.push(`Пятно застройки: ${fmt(footprint)} м² (${share}% участка)`);
  }
  for (const line of lines) { y += 5.2; ctx.fillText(line, x0, y); }
}

// ---------------------------------------------------------------- Листы

function composeSheet(build) {
  const sheet = document.createElement('canvas');
  sheet.width = Math.round(SHEET.w * PX);
  sheet.height = Math.round(SHEET.h * PX);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.setTransform(PX, 0, 0, PX, 0, 0); // дальше — миллиметры листа
  build(ctx);
  return sheet;
}

// Описание всех листов альбома: генплан (если есть граница) и этажи с комнатами.
export function sheetPlan(project) {
  const list = [];
  if (project.site?.boundary?.length >= 3) list.push({ kind: 'site' });
  for (const level of sortedLevels(project)) {
    if (level.rooms.length) list.push({ kind: 'level', levelId: level.id });
  }
  return list;
}

export function renderSheet(project, spec, sheetNo, sheetCount) {
  if (spec.kind === 'site') {
    const ground = levelProject(project, groundLevel(project).id);
    const { canvas, denominator } = renderArea(ground, {
      kind: 'site', scales: SITE_SCALES, points: sitePoints(ground),
      rotation: -((project.site.north || 0) * Math.PI) / 180, underlayImg: state.underlayImg,
    });
    return composeSheet((ctx) => {
      ctx.drawImage(canvas, AREA.x0, AREA.y0, AREA.x1 - AREA.x0, AREA.y1 - AREA.y0);
      frameAndStamp(ctx, { project, title: 'Генплан (схема планировочной организации участка)', denominator, sheetNo, sheetCount, subtitle: 'Север вверх · дом — нижний этаж' });
      siteTable(ctx, project);
    });
  }
  const lp = levelProject(project, spec.levelId);
  const level = lp.levels.find((l) => l.id === spec.levelId);
  const { canvas, denominator } = renderArea(lp, {
    kind: 'level', scales: PLAN_SCALES, points: planPoints(lp),
    rotation: -((project.building?.rotation || 0) * Math.PI) / 180,
  });
  const schedule = roomSchedule(project).find((s) => s.level.id === spec.levelId);
  return composeSheet((ctx) => {
    ctx.drawImage(canvas, AREA.x0, AREA.y0, AREA.x1 - AREA.x0, AREA.y1 - AREA.y0);
    frameAndStamp(ctx, {
      project, title: `План: ${level.name}`, denominator, sheetNo, sheetCount,
      subtitle: `Отметка пола ${(level.elevation / 1000).toFixed(3)} · высота этажа ${(level.height / 1000).toFixed(2)} м`,
    });
    scheduleTable(ctx, schedule);
  });
}

function jpegBytes(canvas) {
  const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// Альбом PDF: все листы. null — если рисовать нечего.
export function buildSheetsPdf(project) {
  const specs = sheetPlan(project);
  if (!specs.length) return null;
  const pages = specs.map((spec, i) => {
    const sheet = renderSheet(project, spec, i + 1, specs.length);
    return { jpeg: jpegBytes(sheet), widthPx: sheet.width, heightPx: sheet.height, widthMm: SHEET.w, heightMm: SHEET.h };
  });
  return buildImagePdf(pages, { title: project.name });
}

// Один лист PNG: генплан в режиме «Участок», иначе текущий этаж.
export function buildCurrentSheetPng(project, modeName) {
  const specs = sheetPlan(project);
  const want = modeName === 'site'
    ? specs.find((s) => s.kind === 'site')
    : specs.find((s) => s.kind === 'level' && s.levelId === project.activeLevel);
  if (!want) return null;
  const sheet = renderSheet(project, want, specs.indexOf(want) + 1, specs.length);
  return new Promise((resolve) => sheet.toBlob(resolve, 'image/png'));
}


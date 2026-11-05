// Печатные листы A3 (альбомный): план каждого этажа в стандартном масштабе,
// рамка, штамп и экспликация помещений; генплан — если есть граница участка.
// PDF — все листы альбомом, PNG — лист текущего этажа (или генплан).
// Разрезы участка (site.landscape.sections), отмеченные «на лист», — свои
// листы после генплана: SVG разреза в масштабе по ширине поля, столбиком.
//
// Лист рисуется как экран с 96 CSS px на дюйм и плотностью 150 dpi: шрифты
// и линии плана выходят того же размера, что на экране (≈3 мм текст).

import { rectCornersWorld } from '../core/building.js';
import { LS_COLORS, landscapeDef } from '../core/landscape.js';
import { groundLevel, levelProject, sortedLevels } from '../core/model.js';
import { buildImagePdf } from '../core/pdf.js';
import { roomSchedule } from '../core/schedule.js';
import { tepReport, tepRows } from '../core/tep.js';
import { buildZonePolygon, neighborRectCorners, polygonAreaM2 } from '../core/site.js';
import { deriveWalls } from '../core/walls.js';
import { createRenderer, projectPoint, underlayHandles } from '../render.js';
import { state } from './state.js';
import { sheetLandscapeStyle, sheetSectionsPref } from './landscape-style.js';
import { packSectionSheets, pickSheetSections, sheetSectionItems, svgAtDpi } from './sheet-sections.js';
import { lsPalette } from './render-landscape-kit.js';

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
function renderArea(project, { kind, scales, points, rotation, underlayImg = null, sectionMarks = null }) {
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
    site: kind === 'site', detail: kind !== 'site', lsStyle: sheetLandscapeStyle(),
    sectionMarks,
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
  const x0 = FRAME.x0 + 2;
  const y0 = STAMP.y0 + 4;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.font = '600 3.6px system-ui, sans-serif';
  ctx.fillText('Технико-экономические показатели', x0, y0);
  ctx.font = '400 3px system-ui, sans-serif';
  const rows = tepRows(tepReport(project));
  const zone = buildZonePolygon(project.site);
  if (zone) rows.splice(1, 0, ['Зона застройки (с отступами)', `${fmt(polygonAreaM2(zone))} м²`]);
  // Две колонки строк: название слева, значение справа.
  const perCol = Math.ceil(rows.length / 2);
  rows.forEach(([k, v], i) => {
    const col = Math.floor(i / perCol);
    const x = x0 + col * 104;
    const y = y0 + 6 + (i % perCol) * 5;
    ctx.textAlign = 'left';
    ctx.fillText(k, x, y);
    ctx.textAlign = 'right';
    ctx.fillText(v, x + 98, y);
  });
  ctx.textAlign = 'left';
}

// Условные обозначения ландшафта (генплан): только группы, что есть на участке.
// Краски — в стиле листа («Чертёж» — оттенки серого).
export function landscapeLegend(objects, style = 'sketch') {
  const c = lsPalette(style, false).c;
  const has = { plants: false, green: false, hard: false, water: false, small: false, fence: false };
  for (const o of objects || []) {
    const def = landscapeDef(o.kind);
    if (!def || def.shape === 'note') continue;
    if (def.group === 'Деревья' || def.group === 'Кустарники' || o.kind === 'grass-clump') has.plants = true;
    else if (def.group === 'Ограждение') has.fence = true;
    else if (def.surface === 'green') has.green = true;
    else if (def.surface === 'water') has.water = true;
    else if (def.surface === 'hard') has.hard = true;
    else has.small = true;
  }
  return [
    ['plants', 'Деревья и кустарники (проекция кроны)', 'circle', LS_COLORS.pine[1]],
    ['green', 'Газон, цветники, грядки', 'rect', LS_COLORS.lawn[0]],
    ['hard', 'Дорожки, площадки, мощение', 'rect', LS_COLORS.tiles[1]],
    ['water', 'Бассейн, пруд', 'rect', LS_COLORS.water[0]],
    ['small', 'Малые архитектурные формы', 'rect', LS_COLORS.wood[0]],
    ['fence', 'Ограждения', 'line', LS_COLORS.metal[0]],
  ].filter(([k]) => has[k]).map(([, title, mark, color]) => ({ title, mark, color: c(color) }));
}

function legendBox(ctx, items) {
  if (!items.length) return;
  const x0 = AREA.x0 + 2;
  const y0 = AREA.y0 + 2;
  const w = 68;
  const h = 7 + items.length * 5;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.25;
  ctx.strokeRect(x0, y0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#000';
  ctx.font = '600 3px system-ui, sans-serif';
  ctx.fillText('Условные обозначения', x0 + 2, y0 + 3.5);
  ctx.font = '400 2.6px system-ui, sans-serif';
  items.forEach((it, i) => {
    const y = y0 + 9 + i * 5;
    ctx.fillStyle = it.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.2;
    if (it.mark === 'circle') {
      ctx.beginPath(); ctx.arc(x0 + 5, y, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (it.mark === 'line') {
      ctx.strokeStyle = it.color; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x0 + 2.5, y); ctx.lineTo(x0 + 7.5, y); ctx.stroke();
    } else {
      ctx.fillRect(x0 + 2.5, y - 1.5, 5, 3); ctx.strokeRect(x0 + 2.5, y - 1.5, 5, 3);
    }
    ctx.fillStyle = '#000';
    ctx.fillText(it.title, x0 + 10, y);
  });
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

// Разрезы, выбранные на лист (см. «Разрезы» в сводке «Ландшафта»).
export function sheetSectionList(project, pref = sheetSectionsPref()) {
  return pickSheetSections(project.site?.landscape?.sections, pref);
}

function sectionStyle() {
  return sheetLandscapeStyle() === 'drawing' ? 'drawing' : 'sketch';
}

// Листы разрезов: [{ kind: 'sections', place: [{ item, x, y }…] }…].
function sectionSheets(project, pref) {
  const list = sheetSectionList(project, pref);
  if (!list.length) return [];
  const areaW = AREA.x1 - AREA.x0;
  const areaH = AREA.y1 - AREA.y0;
  const ground = levelProject(project, groundLevel(project).id);
  const items = sheetSectionItems(ground, list, { areaW, areaH, style: sectionStyle() });
  return packSectionSheets(items, { x0: AREA.x0, y0: AREA.y0, areaW, areaH }).map((place) => ({ kind: 'sections', place }));
}

// Описание всех листов альбома: генплан (если есть граница), разрезы
// участка и этажи с комнатами.
export function sheetPlan(project, { sectionsPref = sheetSectionsPref() } = {}) {
  const list = [];
  if (project.site?.boundary?.length >= 3) list.push({ kind: 'site' });
  list.push(...sectionSheets(project, sectionsPref));
  for (const level of sortedLevels(project)) {
    if (level.rooms.length) list.push({ kind: 'level', levelId: level.id });
  }
  return list;
}

// Растр SVG разрезов листа (async): spec.images — Image по порядку place.
export function loadSheetImages(spec) {
  if (spec.kind !== 'sections' || spec.images) return Promise.resolve(spec);
  return Promise.all(spec.place.map(({ item }) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgAtDpi(item.svg, item, PX))}`;
  }))).then((images) => { spec.images = images; return spec; });
}

function sectionsSheet(project, spec, sheetNo, sheetCount) {
  const dens = [...new Set(spec.place.map((p) => p.item.den))];
  const names = spec.place.map((p) => `${p.item.name}–${p.item.name}`).join(', ');
  return composeSheet((ctx) => {
    spec.place.forEach((p, i) => {
      const img = spec.images?.[i];
      if (img) ctx.drawImage(img, p.x, p.y, p.item.width, p.item.height);
      else {
        ctx.strokeStyle = '#999'; ctx.lineWidth = 0.2;
        ctx.strokeRect(p.x, p.y, p.item.width, p.item.height);
      }
    });
    frameAndStamp(ctx, {
      project, title: spec.place.length > 1 ? `Разрезы участка ${names}` : `Разрез участка ${names}`,
      denominator: dens.join(', 1:'), sheetNo, sheetCount, subtitle: 'Положение линий разреза — на генплане',
    });
    ctx.fillStyle = '#000';
    ctx.font = '400 3px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Отметки — в метрах от нуля участка; глубина вида указана под каждым разрезом.', FRAME.x0 + 2, STAMP.y0 + 4);
  });
}

export function renderSheet(project, spec, sheetNo, sheetCount) {
  if (spec.kind === 'sections') return sectionsSheet(project, spec, sheetNo, sheetCount);
  if (spec.kind === 'site') {
    const ground = levelProject(project, groundLevel(project).id);
    const { canvas, denominator } = renderArea(ground, {
      kind: 'site', scales: SITE_SCALES, points: sitePoints(ground),
      rotation: -((project.site.north || 0) * Math.PI) / 180, underlayImg: state.underlayImg,
      sectionMarks: sheetSectionList(project),
    });
    return composeSheet((ctx) => {
      ctx.drawImage(canvas, AREA.x0, AREA.y0, AREA.x1 - AREA.x0, AREA.y1 - AREA.y0);
      frameAndStamp(ctx, { project, title: 'Генплан (схема планировочной организации участка)', denominator, sheetNo, sheetCount, subtitle: 'Север вверх · дом — нижний этаж' });
      siteTable(ctx, project);
      legendBox(ctx, landscapeLegend(project.site?.landscape?.objects, sheetLandscapeStyle()));
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

// Альбом PDF: все листы (Promise — растр разрезов асинхронный). null — если
// рисовать нечего.
export async function buildSheetsPdf(project) {
  const specs = sheetPlan(project);
  if (!specs.length) return null;
  await Promise.all(specs.map(loadSheetImages));
  const pages = specs.map((spec, i) => {
    const sheet = renderSheet(project, spec, i + 1, specs.length);
    return { jpeg: jpegBytes(sheet), widthPx: sheet.width, heightPx: sheet.height, widthMm: SHEET.w, heightMm: SHEET.h };
  });
  return buildImagePdf(pages, { title: project.name });
}

// Один лист PNG: генплан в режиме «Участок», иначе текущий этаж; при
// открытом разрезе (sectionId) — лист разрезов, на котором он стоит.
export function buildCurrentSheetPng(project, modeName, { sectionId = null } = {}) {
  const specs = sheetPlan(project);
  const want = (sectionId && specs.find((s) => s.kind === 'sections' && s.place.some((p) => p.item.id === sectionId)))
    || (modeName === 'site'
      ? specs.find((s) => s.kind === 'site')
      : specs.find((s) => s.kind === 'level' && s.levelId === project.activeLevel));
  if (!want) return null;
  return loadSheetImages(want).then(() => {
    const sheet = renderSheet(project, want, specs.indexOf(want) + 1, specs.length);
    return new Promise((resolve) => sheet.toBlob(resolve, 'image/png'));
  });
}


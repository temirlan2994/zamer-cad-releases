// Видовые экраны на листах пользователя (project.sheets, core/views.js):
// каждый рисует свой вид теми же рендерами, что и окна видов, в масштабе
// видового экрана, на бумаге (печатная палитра, белый фон):
//   план этажа, участок, ландшафт — render.js в режиме печати (как листы
//   sheetPlan()); фасад и разрез по плану — ui/render-elevation.js; разрез
//   участка — SVG ui/landscape-section-svg.js (растр асинхронно); 3D —
//   аксонометрия граней core/mesh3d.js (canvas 2D, по глубине).
// Под видом — подпись Revit: кружок-маркер «№ / Л3», «№ · Название»,
// «М 1:100». Растр видов кешируется по содержимому проекта, масштабу,
// камере 3D и ступени разрешения (×1 — 150 dpi, как в PDF; ×2, ×4 — для
// зума рабочего листа): сдвиг вида по листу его не перерисовывает.
// Обрезка (viewport.crop, core/views.js) — clip при отрисовке: растр
// строится целиком, рисуется только часть внутри рамки (и в PDF/PNG).

import { buildElevation } from '../core/elevation.js';
import { sectionProfile } from '../core/landscape-section.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { groundLevel, levelProject } from '../core/model.js';
import { buildSection } from '../core/section.js';
import {
  VIEWPORT_TITLE_H, camKey, cropPaperRect, sheetFrame, sheetSize, viewById, viewportNumbers, viewportScales, viewportTitle,
} from '../core/views.js';
import { sheetLandscapeStyle } from './landscape-style.js';
import { sectionSvg, sectionSvgSize } from './landscape-section-svg.js';
import { drawElevation, elevationColors } from './render-elevation.js';
import {
  SHEET_PX, composeSheet, frameAndStamp, planPoints, renderRegion, rotatedBox, sheetSectionList, sitePoints,
} from './sheet.js';
import { svgAtDpi } from './sheet-sections.js';
import { history, state } from './state.js';

const CSS = 96 / 25.4; // CSS px на мм: линии и шрифты — «как на экране»
const MAX_SIDE_PX = 6000; // предел растра одного вида (×1 — PDF/PNG)
const MAX_SIDE_ZOOM = 8192; // предел растра на ступенях ×2/×4
const MAX_AREA_ZOOM = 24e6; // пикселей на растр ступени ×2/×4
export const RASTER_STEPS = [1, 2, 4];
const ELEV_PAD = { l: 4, r: 36, t: 6, b: 4 }; // мм вокруг фасада: справа — отметки
const AXO = { az: (35 * Math.PI) / 180, el: (30 * Math.PI) / 180 };
const PAPER = elevationColors('#ffffff');
const EMPTY_SIZE = { w: 60, h: 30 }; // мм — пустой вид (заглушка на экране)

// ------------------------------------------------------------ геометрия видов

let geoCache = { key: null, sig: null, map: new Map() };
const rasterCache = new Map(); // `${sig}|${viewId}|${scale}|${style}` → { canvas, w, h }

// Подпись содержимого проекта (без листов): если она не изменилась, растр
// видов прежний. Пересчёт — только после новой записи истории.
function contentSig(project) {
  const key = `${history.undo.length}/${history.redo.length}`;
  const last = history.undo.at(-1);
  if (geoCache.project === project && geoCache.key === key && geoCache.last === last && geoCache.sig) return geoCache.sig;
  const sig = JSON.stringify(project, (k, v) => (k === 'sheets' ? undefined
    : typeof v === 'string' && v.length > 256 ? `#${v.length}:${v.slice(-32)}` : v));
  if (sig !== geoCache.sig) {
    geoCache.map = new Map();
    rasterCache.clear();
  }
  geoCache = { ...geoCache, project, key, last, sig };
  return sig;
}

function groundProject(project) {
  return levelProject(project, groundLevel(project).id);
}

// Камера вида: снимок камеры 3D только у 3D-вида.
const camOf = (viewId, cam) => (viewId === '3d' && cam ? cam : null);

// Геометрия вида (не зависит от масштаба): { kind, extent: { w, h } мм
// модели, ... } или null — вид пуст / удалён. cam — снимок камеры 3D.
function viewGeometry(project, viewId, cam = null) {
  contentSig(project);
  const c = camOf(viewId, cam);
  const key = `${viewId}|${camKey(c)}`;
  if (geoCache.map.has(key)) return geoCache.map.get(key);
  const desc = viewById(project, viewId);
  let geo = null;
  if (desc) {
    try { geo = buildGeometry(project, desc, c); } catch (error) { console.error('Вид на листе не построился:', error); }
  }
  geoCache.map.set(key, geo);
  return geo;
}

function buildGeometry(project, desc, cam = null) {
  if (desc.kind === 'plan') {
    const lp = levelProject(project, desc.levelId);
    if (!lp.rooms.length) return null;
    const rotation = -((project.building?.rotation || 0) * Math.PI) / 180;
    const box = rotatedBox(planPoints(lp), rotation);
    return { desc, kind: 'plan', lp, box, rotation, model: { w: box.w, h: box.h } };
  }
  if (desc.kind === 'site' || desc.kind === 'landscape') {
    const ground = groundProject(project);
    const pts = sitePoints(ground);
    if (!pts.length) return null;
    const rotation = -((project.site?.north || 0) * Math.PI) / 180;
    const box = rotatedBox(pts, rotation);
    return { desc, kind: 'site', lp: ground, box, rotation, model: { w: box.w, h: box.h } };
  }
  if (desc.kind === 'elevation' || desc.kind === 'section') {
    const el = desc.kind === 'section' ? buildSection(project, desc.view) : buildElevation(project, desc.dir);
    if (!el || (!el.polys.length && !el.cuts?.length)) return null;
    const b = el.bounds;
    const zMin = Math.min(b.z0, ...(el.ground || []).map((g) => g.z));
    return { desc, kind: 'elevation', el, zMin, model: { w: b.u1 - b.u0, h: b.z1 - zMin }, marks: desc.view?.marks !== false };
  }
  if (desc.kind === 'lsection') {
    const sec = (project.site?.landscape?.sections || []).find((s) => s.id === desc.sectionId);
    const prof = sec && sectionProfile(groundProject(project), sec, sec.side, { depth: sec.depth });
    if (!prof) return null;
    const s100 = sectionSvgSize(prof, 100);
    return { desc, kind: 'lsection', prof, model: { w: s100.width * 100, h: s100.height * 100 } };
  }
  if (desc.kind === '3d') {
    const faces = buildHouseMesh(project, { roof: Boolean(cam?.roof), site: false });
    if (!faces.length) return null;
    const proj = axoFaces(faces, cam);
    if (!proj.list.length) return null;
    return { desc, kind: '3d', ...proj, model: { w: proj.box.x1 - proj.box.x0, h: proj.box.y1 - proj.box.y0 } };
  }
  return null;
}

// Размер вида на бумаге при знаменателе d, мм.
function paperSize(geo, d) {
  if (!geo) return { ...EMPTY_SIZE };
  if (geo.kind === 'elevation') return { w: geo.model.w / d + ELEV_PAD.l + ELEV_PAD.r, h: geo.model.h / d + ELEV_PAD.t + ELEV_PAD.b };
  if (geo.kind === 'lsection') {
    const s = sectionSvgSize(geo.prof, d);
    return { w: s.width, h: s.height };
  }
  if (geo.kind === '3d') return { w: geo.model.w / d + 4, h: geo.model.h / d + 4 };
  return { w: geo.model.w / d, h: geo.model.h / d };
}

// Поле до начала чертежа в растре вида, мм бумаги (core/views.js
// cropPaperRect: начало координат рамки обрезки).
function contentPad(geo) {
  if (geo?.kind === 'elevation') return { padL: ELEV_PAD.l, padT: ELEV_PAD.t };
  if (geo?.kind === '3d') return { padL: 2, padT: 2 };
  return { padL: 0, padT: 0 };
}

export const viewportPaperSize = (project, viewId, d, cam = null) => paperSize(viewGeometry(project, viewId, cam), d);

// Растр вида на бумаге: { w, h, padL, padT, d } — для рамки обрезки.
export function viewportFrame(project, vp) {
  const geo = viewGeometry(project, vp.viewId, vp.cam);
  return { ...paperSize(geo, vp.scale), ...contentPad(geo), d: vp.scale };
}

// Центр вида так, чтобы вид с подписью не выходил за рамку листа (если
// помещается), мм.
export function fitInFrame(project, sheet, viewId, d, x, y) {
  const s = paperSize(viewGeometry(project, viewId), d);
  const { frame } = sheetFrame(sheetSize(sheet));
  const fit = (v, lo, hi, len) => (len > hi - lo ? (lo + hi) / 2 : Math.min(hi - len / 2, Math.max(lo + len / 2, v)));
  return {
    x: fit(x, frame.x0 + 2, frame.x1 - 2, s.w),
    y: fit(y, frame.y0 + 2, frame.y1 - 2 - VIEWPORT_TITLE_H, s.h),
  };
}

// Свободное место для нового вида (кнопка «На лист…»): первое по строкам
// поля чертежа, где вид с подписью не перекрывает другие; нет — центр.
export function freeSpot(project, sheet, viewId, d) {
  const s = paperSize(viewGeometry(project, viewId), d);
  const { area } = sheetFrame(sheetSize(sheet));
  const busy = sheet.viewports.map((vp) => {
    const b = viewportBox(project, vp);
    return { x0: b.x0 - 4, y0: b.y0 - 4, x1: Math.max(b.x1, b.cap.x1) + 4, y1: b.cap.y1 + 4 };
  });
  const h = s.h + VIEWPORT_TITLE_H;
  for (let y0 = area.y0; y0 + h <= area.y1 + 0.01; y0 += 5) {
    for (let x0 = area.x0; x0 + s.w <= area.x1 + 0.01; x0 += 5) {
      const free = busy.every((b) => x0 + s.w <= b.x0 || x0 >= b.x1 || y0 + h <= b.y0 || y0 >= b.y1);
      if (free) return { x: x0 + s.w / 2, y: y0 + s.h / 2 };
    }
  }
  return { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 };
}

// Масштаб по умолчанию: самый крупный из масштабов вида, при котором вид с
// подписью помещается в поле чертежа листа.
export function defaultViewportScale(project, viewId, sheet) {
  const desc = viewById(project, viewId);
  const scales = viewportScales(desc?.kind);
  const geo = viewGeometry(project, viewId);
  const { area } = sheetFrame(sheetSize(sheet));
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0 - VIEWPORT_TITLE_H;
  return scales.find((d) => {
    const s = paperSize(geo, d);
    return s.w <= aw && s.h <= ah;
  }) ?? scales[scales.length - 1];
}

// ------------------------------------------------------------ 3D-аксонометрия

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0xcfcfcf;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Проекция аксонометрии: P(точка в осях дома) → { u, v (мм, v вниз),
// depth (больше — ближе к глазу) }, facing(нормаль) > 0 — грань к глазу.
// Без cam — фиксированная аксонометрия B3; с cam — камера окна 3D
// (ui/view3d.js: yaw, pitch в правой системе X = x, Y = −y, Z = z;
// ортографическая, как там).
export function axoProjection(cam = null) {
  if (!cam) {
    const c = Math.cos(AXO.az);
    const s = Math.sin(AXO.az);
    const ce = Math.cos(AXO.el);
    const se = Math.sin(AXO.el);
    return {
      P: (p) => {
        const px = p.x * c + p.y * s;
        const py = -p.x * s + p.y * c;
        return { u: px, v: py * se - p.z * ce, depth: py * ce + p.z * se };
      },
      facing: (n) => (-n.x * s + n.y * c) * ce + n.z * se,
    };
  }
  const cp = Math.cos(cam.pitch);
  const eye = { x: cp * Math.cos(cam.yaw), y: cp * Math.sin(cam.yaw), z: Math.sin(cam.pitch) }; // к глазу
  const rl = Math.hypot(eye.y, eye.x) || 1;
  const r = { x: -eye.y / rl, y: eye.x / rl, z: 0 }; // право = f × Z, f = −eye
  const up = { // верх = r × f = eye × r
    x: eye.y * r.z - eye.z * r.y,
    y: eye.z * r.x - eye.x * r.z,
    z: eye.x * r.y - eye.y * r.x,
  };
  const dotW = (p, a) => p.x * a.x - p.y * a.y + p.z * a.z; // W(p) · a
  return {
    P: (p) => ({ u: dotW(p, r), v: -dotW(p, up), depth: dotW(p, eye) }),
    facing: (n) => dotW(n, eye),
  };
}

// Грани → многоугольники аксонометрии (мм модели, y вниз), по глубине.
function axoFaces(faces, cam = null) {
  const light = { x: -0.35, y: 0.55, z: 0.75 };
  const ll = Math.hypot(light.x, light.y, light.z);
  const { P, facing } = axoProjection(cam);
  const list = [];
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const f of faces) {
    if (!f.pts?.length || f.kind === 'ground' || f.kind === 'boundary') continue;
    const n = f.normal || { x: 0, y: 0, z: 1 };
    if (facing(n) <= 0 && !f.twoSided) continue;
    const q = f.pts.map(P);
    for (const p of q) {
      box.x0 = Math.min(box.x0, p.u); box.x1 = Math.max(box.x1, p.u);
      box.y0 = Math.min(box.y0, p.v); box.y1 = Math.max(box.y1, p.v);
    }
    const lam = Math.abs((n.x * light.x + n.y * light.y + n.z * light.z) / ll);
    const k = 0.62 + 0.38 * lam;
    const [r, g, b] = hexRgb(f.color);
    list.push({
      pts: q, depth: q.reduce((a, p) => a + p.depth, 0) / q.length, edges: !f.noEdges && f.kind !== 'glass',
      fill: `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${f.alpha ?? 1})`,
    });
  }
  list.sort((a, b) => a.depth - b.depth);
  return { list, box };
}

// ------------------------------------------------------------ растр вида

// Пикселей на мм бумаги для ступени f: ×1 — как PDF (150 dpi, предел
// стороны 6000 px); ×2/×4 — для зума листа, с пределом стороны и площади.
export function rasterPpm(wMm, hMm, f = 1) {
  if (f <= 1) return Math.min(SHEET_PX, MAX_SIDE_PX / Math.max(wMm, hMm, 1));
  return Math.max(Math.min(SHEET_PX, MAX_SIDE_PX / Math.max(wMm, hMm, 1)),
    Math.min(SHEET_PX * f, MAX_SIDE_ZOOM / Math.max(wMm, hMm, 1), Math.sqrt(MAX_AREA_ZOOM / Math.max(wMm * hMm, 1))));
}

function makeCanvas(wMm, hMm, f = 1) {
  const ppm = rasterPpm(wMm, hMm, f);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wMm * ppm));
  canvas.height = Math.max(1, Math.round(hMm * ppm));
  return { canvas, ppm };
}

function rasterize(project, geo, d, f = 1) {
  const size = paperSize(geo, d);
  if (geo.kind === 'plan' || geo.kind === 'site') {
    const ppm = rasterPpm(size.w, size.h, f);
    const canvas = renderRegion(geo.lp, {
      kind: geo.kind === 'site' ? 'site' : 'level', box: geo.box, rotation: geo.rotation, denominator: d,
      width: size.w, height: size.h, ppm,
      underlayImg: geo.kind === 'site' ? state.underlayImg : null,
      sectionMarks: geo.kind === 'site' ? sheetSectionList(project) : null,
    });
    return { canvas, ...size };
  }
  if (geo.kind === 'elevation') {
    const { canvas, ppm } = makeCanvas(size.w, size.h, f);
    const ctx = canvas.getContext('2d');
    const dpr = (ppm * 25.4) / 96;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = CSS / d;
    const b = geo.el.bounds;
    const view = { k, ox: ELEV_PAD.l * CSS - b.u0 * k, oy: ELEV_PAD.t * CSS + b.z1 * k };
    drawElevation(ctx, geo.el, { view, colors: PAPER, marks: geo.marks, title: '', dpr });
    return { canvas, ...size };
  }
  if (geo.kind === '3d') {
    const { canvas, ppm } = makeCanvas(size.w, size.h, f);
    const ctx = canvas.getContext('2d');
    const m = ppm / d; // px на мм модели
    ctx.setTransform(m, 0, 0, m, (2 - geo.box.x0 / d) * ppm, (2 - geo.box.y0 / d) * ppm);
    ctx.lineJoin = 'round';
    ctx.lineWidth = (0.12 * d); // 0,12 мм на бумаге
    ctx.strokeStyle = 'rgba(30,36,44,0.75)';
    for (const f of geo.list) {
      ctx.beginPath();
      f.pts.forEach((p, i) => (i ? ctx.lineTo(p.u, p.v) : ctx.moveTo(p.u, p.v)));
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      if (f.edges) ctx.stroke();
    }
    return { canvas, ...size };
  }
  return null;
}

const lsStyle = () => (sheetLandscapeStyle() === 'drawing' ? 'drawing' : 'sketch');

const rasterKey = (vp, f) => `${vp.viewId}|${vp.scale}|${sheetLandscapeStyle()}|${camKey(camOf(vp.viewId, vp.cam))}|${f}`;

// Растр есть в кеше для ступени f (без построения) — или null.
export function cachedRaster(project, vp, f = 1) {
  const sig = contentSig(project);
  const hit = rasterCache.get(rasterKey(vp, f));
  return hit && hit.sig === sig ? hit : null;
}

// Растр видового экрана: { canvas | null, w, h, empty?, pending? }.
// f — ступень разрешения (RASTER_STEPS); разрез участка (SVG) — только ×1.
export function viewportRaster(project, vp, f = 1) {
  const sig = contentSig(project);
  const geo = viewGeometry(project, vp.viewId, vp.cam);
  if (f > 1 && (!geo || geo.kind === 'lsection')) return viewportRaster(project, vp, 1);
  const key = rasterKey(vp, f);
  const hit = rasterCache.get(key);
  if (hit && hit.sig === sig) return hit;
  let out;
  if (!geo) out = { canvas: null, ...EMPTY_SIZE, empty: true };
  else if (geo.kind === 'lsection') {
    const s = sectionSvgSize(geo.prof, vp.scale);
    out = { canvas: null, w: s.width, h: s.height, pending: true };
  } else {
    try { out = rasterize(project, geo, vp.scale, f) || { canvas: null, ...EMPTY_SIZE, empty: true }; } catch (error) {
      console.error('Вид на листе не нарисовался:', error);
      out = { canvas: null, ...EMPTY_SIZE, empty: true };
    }
  }
  out.sig = sig;
  out.f = f;
  rasterCache.set(key, out);
  return out;
}

// Растр ступени f уже есть (или для вида не нужен: пуст, разрез участка).
export function rasterReady(project, vp, f) {
  if (f <= 1) return true;
  const geo = viewGeometry(project, vp.viewId, vp.cam);
  return !geo || geo.kind === 'lsection' || Boolean(cachedRaster(project, vp, f));
}

// Убрать из кеша растры ступеней ×2/×4, кроме keep (память: растр ×4
// листа A3 — десятки мегабайт).
export function dropZoomRasters(keep) {
  for (const [key, r] of rasterCache) if (r.f > 1 && r.f !== keep) rasterCache.delete(key);
}

// Загрузить растр SVG (разрезы участка) для всех видов листа.
export function prepareViewports(project, sheet) {
  const jobs = sheet.viewports.map((vp) => {
    const r = viewportRaster(project, vp);
    if (!r.pending || r.loading) return r.loading || Promise.resolve();
    const geo = viewGeometry(project, vp.viewId, vp.cam);
    const item = { width: r.w, height: r.h };
    const svg = sectionSvg(geo.prof, { style: lsStyle(), scale: vp.scale });
    r.loading = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { r.canvas = img; r.pending = false; resolve(); };
      img.onerror = () => { r.pending = false; r.empty = true; resolve(); };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgAtDpi(svg, item, SHEET_PX))}`;
    });
    return r.loading;
  });
  return Promise.all(jobs);
}

// Прямоугольник вида и подписи на листе, мм: { x0, y0, x1, y1 } — видимая
// (обрезанная) часть вида; full — весь растр вида (центр — vp.x, vp.y);
// crop — рамка обрезки в мм бумаги растра или null; frame —
// viewportFrame(); cap — подпись под видимой частью.
export function viewportBox(project, vp) {
  const frame = viewportFrame(project, vp);
  const fx0 = vp.x - frame.w / 2;
  const fy0 = vp.y - frame.h / 2;
  const full = { x0: fx0, y0: fy0, x1: fx0 + frame.w, y1: fy0 + frame.h };
  const crop = cropPaperRect(vp.crop, frame);
  const b = crop ? { x0: fx0 + crop.x0, y0: fy0 + crop.y0, x1: fx0 + crop.x1, y1: fy0 + crop.y1 } : { ...full };
  return {
    ...b, full, crop, frame,
    cap: { x0: b.x0, y0: b.y1, x1: b.x0 + Math.max(b.x1 - b.x0, 60), y1: b.y1 + VIEWPORT_TITLE_H },
  };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Подпись под видом (Revit): кружок-маркер «номер вида / номер листа»,
// «№ · Название» жирным, масштаб, линия от маркера.
function caption(ctx, project, vp, box, no, sheetNo) {
  const title = `${no} · ${viewportTitle(project, vp)}`;
  const R = 3.3;
  const cx = box.x0 + R;
  const cy = box.y1 + 4.2;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.3;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${no.length > 2 ? 1.8 : 2.4}px ${FONT}`;
  ctx.fillText(no, cx, cy - 1.45);
  const sn = `Л${sheetNo}`;
  ctx.font = `400 ${sn.length > 3 ? 1.3 : 1.7}px ${FONT}`;
  ctx.fillText(sn, cx, cy + 1.5);
  const x = box.x0 + R * 2 + 1.6;
  const y = cy - 0.9;
  ctx.textAlign = 'left';
  ctx.font = `600 3.2px ${FONT}`;
  ctx.fillText(title, x, y);
  const tw = ctx.measureText(title).width;
  ctx.font = `400 2.6px ${FONT}`;
  const scaleText = `М 1:${vp.scale}`;
  ctx.fillText(scaleText, x + tw + 3, y + 0.2);
  const sw = ctx.measureText(scaleText).width;
  ctx.beginPath(); ctx.moveTo(cx + R, cy + 1.1); ctx.lineTo(x + tw + 3 + sw, cy + 1.1); ctx.stroke();
  ctx.restore();
}

// Нарисовать виды листа (контекст — в мм листа). editor — рамка пустых и
// незагруженных видов (на печать не идёт); f — ступень растра (зум рабочего
// листа): есть в кеше — рисуется она, нет — ×1.
export function drawViewports(ctx, project, sheet, { editor = false, f = 1 } = {}) {
  const numbers = viewportNumbers(sheet);
  for (const vp of sheet.viewports) {
    const r = (f > 1 && cachedRaster(project, vp, f)) || viewportRaster(project, vp);
    const box = viewportBox(project, vp);
    const full = box.full;
    if (r.canvas) {
      ctx.save();
      if (box.crop) { ctx.beginPath(); ctx.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); ctx.clip(); }
      ctx.drawImage(r.canvas, full.x0, full.y0, full.x1 - full.x0, full.y1 - full.y0);
      ctx.restore();
    } else if (editor) {
      ctx.save();
      ctx.strokeStyle = '#8a94a3';
      ctx.lineWidth = 0.3;
      ctx.setLineDash([2, 1.5]);
      ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.setLineDash([]);
      ctx.fillStyle = '#687486';
      ctx.font = '400 3px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.pending ? 'Готовлю вид…' : 'Вид пуст', (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
      ctx.restore();
    }
    // У разреза участка подпись с масштабом — в самом SVG.
    const own = !r.empty && !r.pending && viewById(project, vp.viewId)?.kind === 'lsection';
    if ((!r.empty || editor) && !own) caption(ctx, project, vp, box, numbers.get(vp.id) || '', sheet.no);
  }
}

// Масштабы в штампе: «Масштаб 1:100» или «Масштабы 1:100, 1:200».
export function sheetScaleText(sheet) {
  const dens = [...new Set(sheet.viewports.map((vp) => vp.scale))].sort((a, b) => a - b);
  if (!dens.length) return 'Масштаб —';
  return `${dens.length > 1 ? 'Масштабы' : 'Масштаб'} ${dens.map((d) => `1:${d}`).join(', ')}`;
}

// Оформление листа пользователя: рамка и штамп по формату.
export function drawSheetDecor(ctx, project, sheet, sheetCount) {
  const size = sheetSize(sheet);
  frameAndStamp(ctx, {
    project, title: sheet.name, scaleText: sheetScaleText(sheet), sheetNo: sheet.no, sheetCount,
    subtitle: `${sheet.format} · ${size.w}×${size.h} мм`, layout: sheetFrame(size),
  });
}

// Лист пользователя целиком (PDF/PNG): белая бумага, виды, рамка, штамп.
// Растр SVG-видов — заранее: prepareViewports().
export function renderUserSheet(project, sheet, sheetCount) {
  const out = composeSheet((ctx) => {
    drawViewports(ctx, project, sheet);
    drawSheetDecor(ctx, project, sheet, sheetCount);
  }, sheetSize(sheet));
  const dens = [...new Set(sheet.viewports.map((vp) => vp.scale))];
  out.denominator = dens.length ? dens.join(', 1:') : null;
  return out;
}

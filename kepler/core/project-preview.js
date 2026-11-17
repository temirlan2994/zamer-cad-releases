// Компактный эскиз проекта для карточек. В метаданные попадают только
// нормализованные координаты — без названий, подложек и другого тяжёлого JSON.

import { roomRects } from './room-shape.js';
import { blockRing } from './v7/model.js';

const WIDTH = 1000;
const HEIGHT = 620;
const MAX_RECTS = 60;
const MAX_SITE_POINTS = 80;
export const MAX_PROJECT_PREVIEW_IMAGE_CHARS = 180000;

const PREVIEW_IMAGE = /^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

const finite = (value) => Number.isFinite(Number(value));
const round = (value) => Math.round(value * 10) / 10;

function projectRooms(project) {
  if (Array.isArray(project?.levels)) {
    const level = project.levels.find((candidate) => (Array.isArray(candidate?.rooms) && candidate.rooms.length)
      || (Array.isArray(candidate?.blocks) && candidate.blocks.length))
      || project.levels[0];
    if (Array.isArray(level?.rooms) && level.rooms.length) return level.rooms;
    if (Array.isArray(level?.blocks)) {
      return level.blocks.map((block) => {
        let ring;
        try { ring = blockRing(block); } catch { return null; }
        if (!Array.isArray(ring) || ring.length < 3) return null;
        const xs = ring.map((point) => Number(point.x)).filter(Number.isFinite);
        const ys = ring.map((point) => Number(point.y)).filter(Number.isFinite);
        if (xs.length < 3 || ys.length < 3) return null;
        const x = Math.min(...xs); const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      }).filter(Boolean);
    }
    return [];
  }
  return Array.isArray(project?.rooms) ? project.rooms : [];
}

function cleanRoomRects(project) {
  const result = [];
  for (const room of projectRooms(project)) {
    if (!room || typeof room !== 'object') continue;
    let parts;
    try { parts = roomRects(room); } catch { continue; }
    for (const rect of parts) {
      if (![rect?.x, rect?.y, rect?.w, rect?.h].every(finite)) continue;
      const item = {
        x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h),
      };
      if (item.w <= 0 || item.h <= 0) continue;
      result.push(item);
      if (result.length >= MAX_RECTS) return result;
    }
  }
  return result;
}

function cleanSite(project) {
  const points = Array.isArray(project?.site?.boundary) ? project.site.boundary : [];
  return points
    .filter((point) => point && finite(point.x) && finite(point.y))
    .slice(0, MAX_SITE_POINTS)
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function boundsOf(rects, site) {
  const xs = [];
  const ys = [];
  for (const rect of rects) {
    xs.push(rect.x, rect.x + rect.w);
    ys.push(rect.y, rect.y + rect.h);
  }
  for (const point of site) { xs.push(point.x); ys.push(point.y); }
  if (!xs.length) return null;
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

// → { v, rooms: [{x,y,w,h}], site: [{x,y}] } в системе 1000×620.
export function createProjectPreview(project) {
  const rects = cleanRoomRects(project);
  // План дома и граница участка живут в разных системах координат. Для
  // карточки показываем дом; участок используем только у проекта без комнат.
  const site = rects.length ? [] : cleanSite(project);
  const bounds = boundsOf(rects, site);
  if (!bounds) return null;
  const sourceW = Math.max(1, bounds.maxX - bounds.minX);
  const sourceH = Math.max(1, bounds.maxY - bounds.minY);
  const pad = 54;
  const scale = Math.min((WIDTH - pad * 2) / sourceW, (HEIGHT - pad * 2) / sourceH);
  const dx = (WIDTH - sourceW * scale) / 2 - bounds.minX * scale;
  const dy = (HEIGHT - sourceH * scale) / 2 - bounds.minY * scale;
  const point = ({ x, y }) => ({ x: round(x * scale + dx), y: round(y * scale + dy) });
  return {
    v: 1,
    rooms: rects.map((rect) => ({
      ...point(rect), w: round(rect.w * scale), h: round(rect.h * scale),
    })),
    site: site.map(point),
  };
}

// Единственная точка проверки preview перед HTML и облачным хранением.
// v2 намеренно допускает только WebP/JPEG data URL и ровно два поля: SVG и
// произвольные data: URL не должны попадать ни в DOM, ни в метаданные Firebase.
export function safeProjectPreview(preview) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return null;
  if (preview.v === 2) {
    const keys = Object.keys(preview);
    if (keys.length !== 2 || !keys.includes('v') || !keys.includes('image')) return null;
    if (typeof preview.image !== 'string'
      || preview.image.length > MAX_PROJECT_PREVIEW_IMAGE_CHARS
      || !PREVIEW_IMAGE.test(preview.image)) return null;
    return { v: 2, image: preview.image };
  }
  if (preview.v !== 1 || !Array.isArray(preview.rooms) || !Array.isArray(preview.site)) return null;
  const rooms = preview.rooms.filter((rect) => rect && [rect.x, rect.y, rect.w, rect.h].every(finite)
    && Number(rect.w) > 0 && Number(rect.h) > 0).slice(0, MAX_RECTS);
  const site = preview.site.filter((point) => point && finite(point.x) && finite(point.y)).slice(0, MAX_SITE_POINTS);
  if (!rooms.length && site.length < 3) return null;
  return {
    v: 1,
    rooms: rooms.map((rect) => ({
      x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h),
    })),
    site: site.map((point) => ({ x: Number(point.x), y: Number(point.y) })),
  };
}

// Старым карточкам без preview даём различимый план-заполнитель. После
// следующего автосохранения он заменится настоящей геометрией.
export function fallbackProjectPreview(stats = null) {
  const count = Math.max(1, Math.min(12, Number(stats?.rooms) || 4));
  const cols = Math.min(4, Math.ceil(Math.sqrt(count * 1.5)));
  const rows = Math.ceil(count / cols);
  const gap = 18;
  const cellW = (WIDTH - 120 - gap * (cols - 1)) / cols;
  const cellH = (HEIGHT - 100 - gap * (rows - 1)) / rows;
  return {
    v: 1,
    site: [],
    rooms: Array.from({ length: count }, (_, index) => ({
      x: round(60 + (index % cols) * (cellW + gap)),
      y: round(50 + Math.floor(index / cols) * (cellH + gap)),
      w: round(cellW), h: round(cellH),
    })),
  };
}

export function projectPreviewSvg(preview, stats = null) {
  const safe = safeProjectPreview(preview);
  const data = safe?.v === 1 ? safe : fallbackProjectPreview(stats);
  const site = data.site.length > 2
    ? `<polygon class="project-preview-site" points="${data.site.map((p) => `${Number(p.x)},${Number(p.y)}`).join(' ')}" />`
    : '';
  const rooms = data.rooms.map((rect, index) => `<rect class="project-preview-room project-preview-room-${index % 4}" x="${Number(rect.x)}" y="${Number(rect.y)}" width="${Number(rect.w)}" height="${Number(rect.h)}" rx="9" />`).join('');
  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true" focusable="false">${site}${rooms}</svg>`;
}

// Карточки новых проектов показывают растровый снимок настоящего плана.
// Для старых проектов сохраняем прежний SVG: он заменится после автосохранения.
export function projectPreviewHtml(preview, stats = null) {
  const data = safeProjectPreview(preview);
  if (data?.v === 2) {
    return `<img class="project-preview-image" src="${data.image}" alt="" loading="lazy" decoding="async" draggable="false">`;
  }
  return projectPreviewSvg(data, stats);
}

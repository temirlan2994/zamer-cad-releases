// Настоящая миниатюра проекта для стартового экрана. Это снимок уже
// существующего листа первого надземного этажа: тот же canvas-рендер рисует
// стены, проёмы, мебель, подписи, сетку, оси, размеры и мягкие тени.

import { levelProject } from '../core/model.js';
import { roomPolygon } from '../core/room-shape.js';
import { deriveWalls, wallRects } from '../core/walls.js';
import { createRenderer, itemCorners } from '../render.js';

export const PROJECT_THUMBNAIL_WIDTH = 640;
export const PROJECT_THUMBNAIL_HEIGHT = 360;
export const PROJECT_THUMBNAIL_MAX_CHARS = 180_000;

const elevation = (level) => {
  const value = Number(level?.elevation);
  return Number.isFinite(value) ? value : 0;
};

const hasPlanContent = (level) => Boolean(
  level?.rooms?.length || level?.walls?.length || level?.items?.length
  || level?.openings?.length || level?.slabOpenings?.length,
);

// «Первый этаж» — именно первый надземный, а не подвал: сначала отметка 0,
// затем ближайшая положительная, и лишь потом ближайшая к нулю как fallback.
export function projectThumbnailLevel(project) {
  const levels = (project?.levels || []).filter(hasPlanContent);
  if (!levels.length) return null;
  const atZero = levels.find((level) => Math.abs(elevation(level)) < 0.5);
  if (atZero) return atZero;
  const above = levels.filter((level) => elevation(level) >= 0)
    .sort((a, b) => elevation(a) - elevation(b));
  if (above.length) return above[0];
  return [...levels].sort((a, b) => Math.abs(elevation(a)) - Math.abs(elevation(b)))[0];
}

const rectPoints = (rect) => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.w, y: rect.y },
  { x: rect.x + rect.w, y: rect.y + rect.h },
  { x: rect.x, y: rect.y + rect.h },
];

const finitePoints = (points) => points.filter((point) => (
  Number.isFinite(point?.x) && Number.isFinite(point?.y)
));

function planBounds(project, walls) {
  const points = [];
  for (const room of project.rooms || []) {
    try { points.push(...roomPolygon(room)); } catch { points.push(...rectPoints(room)); }
  }
  for (const wall of walls) {
    if (wall.kind === 'chamfer' && wall.poly?.length) points.push(...wall.poly);
    else for (const rect of wallRects(wall)) points.push(...rectPoints(rect));
  }
  // Проект из одних предметов тоже получает осмысленную карточку. В обычном
  // плане мебель не расширяет кадр: один случайно забытый предмет далеко от
  // дома не должен превращать сам дом в крошечную точку.
  if (!points.length) {
    for (const item of project.items || []) {
      try { points.push(...itemCorners(item)); } catch { /* некорректный предмет пропускаем */ }
    }
  }
  const valid = finitePoints(points);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((point) => point.x));
  const maxX = Math.max(...valid.map((point) => point.x));
  const minY = Math.min(...valid.map((point) => point.y));
  const maxY = Math.max(...valid.map((point) => point.y));
  return {
    x: minX, y: minY,
    w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY),
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
  };
}

function encode(canvas) {
  const attempts = [
    ['image/jpeg', 0.76], ['image/jpeg', 0.62], ['image/jpeg', 0.48], ['image/jpeg', 0.36],
    ['image/webp', 0.78], ['image/webp', 0.66], ['image/webp', 0.54], ['image/webp', 0.42],
  ];
  for (const [mime, quality] of attempts) {
    try {
      const image = canvas.toDataURL(mime, quality);
      if (image.startsWith(`data:${mime};base64,`) && image.length <= PROJECT_THUMBNAIL_MAX_CHARS) return image;
    } catch { /* следующий поддерживаемый формат/качество */ }
  }
  return null;
}

export function createProjectThumbnail(project) {
  if (typeof document === 'undefined' || !project?.levels?.length) return null;
  const level = projectThumbnailLevel(project);
  if (!level) return null;

  // Карточка — ортогональный план, независимо от поворота дома на участке.
  // Геометрия помещений хранится именно в этих локальных осях.
  const thumbnailProject = levelProject({
    ...project,
    building: { rotation: 0, origin: { x: 0, y: 0 } },
  }, level.id);
  const walls = deriveWalls(thumbnailProject);
  const box = planBounds(thumbnailProject, walls);
  if (!box) return null;

  const padX = 46;
  const padY = 32;
  const scale = Math.min(
    (PROJECT_THUMBNAIL_WIDTH - padX * 2) / Math.max(1000, box.w),
    (PROJECT_THUMBNAIL_HEIGHT - padY * 2) / Math.max(1000, box.h),
    0.12,
  );
  const view = {
    scale,
    rotation: 0,
    panX: PROJECT_THUMBNAIL_WIDTH / 2 - box.cx * scale,
    panY: PROJECT_THUMBNAIL_HEIGHT / 2 - box.cy * scale,
  };
  const renderCanvas = document.createElement('canvas');
  const previewState = {
    project: thumbnailProject,
    walls,
    belowWalls: null,
    view,
    modeName: 'plan',
    selection: null,
    hover: null,
    guides: [],
    underlayImg: null,
  };
  createRenderer(renderCanvas).draw(previewState, {
    width: PROJECT_THUMBNAIL_WIDTH,
    height: PROJECT_THUMBNAIL_HEIGHT,
    dpr: 1.5,
    print: true,
    thumbnail: true,
    planSnapshot: true,
    site: false,
    detail: true,
  });

  // Рендерим чуть плотнее и уменьшаем до конечных 640×360: диагонали дверей,
  // мебель и мелкие подписи остаются аккуратными даже на retina-экране.
  const canvas = document.createElement('canvas');
  canvas.width = PROJECT_THUMBNAIL_WIDTH;
  canvas.height = PROJECT_THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderCanvas, 0, 0, canvas.width, canvas.height);

  const image = encode(canvas);
  return image ? { v: 2, image } : null;
}

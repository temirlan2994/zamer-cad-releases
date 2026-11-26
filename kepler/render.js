// Отрисовка Kepler Plan: план дома и участок.
// Геометрия рисуется в мировых координатах (мм) через transform (масштаб +
// поворот: в режиме «Участок» север всегда вверх), подписи — в экранных.

import { cornerWindowHandles, cornerWindowProjections } from './core/corner-windows.js';
import { levelWindowOpenings } from './core/spanning-windows.js';
import { entryOpeningSymbol, entryParts, entrySpan, entryTitle, siteEntries } from './core/site-entries.js';
import { glazedOpeningParts, isGlazedAssembly } from './core/glazed-openings.js';
import {
  deriveWalls, doorLeaves, doorSymbol, openingRect, wallOutline, wallRects,
  wallsEngine,
} from './core/walls.js';

// Контур стен v2 считается один раз на массив стен (массив меняется при пересчёте).
const outlineCache = new WeakMap();
function cachedWallOutline(walls) {
  let outline = outlineCache.get(walls);
  if (!outline) {
    outline = wallOutline(walls);
    outlineCache.set(walls, outline);
  }
  return outline;
}
import { itemEdgeHandles, itemHandleMode } from './core/item-handles.js';
import { lsHandleInfo } from './core/landscape-handles.js';
import {
  groupBounds, groupCorners, groupEdgeHandles, groupHandleId, groupItems, groupRotators,
} from './core/group-handles.js';
import { tempDimensions } from './core/temp-dims.js';
import { itemBounds } from './core/clearance.js';
import { roomNetAreaM2 } from './core/rooms.js';
import { isOpenRoom, isRoundItem, isShaft, isStructural, roomColors } from './core/catalog.js';
import { RAILING_INSET, roomRailings } from './core/railings.js';
import {
  buildZonePolygon, neighborBuffers, neighborRectCorners, polygonAreaM2, sunPosition,
  polylineMidpoints, shadowVector, shadowPolygonFromCorners,
} from './core/site.js';
import { computeRoomEdges, computeBuildingOutline } from './core/rooms.js';
import { composeView, rectCornersWorld } from './core/building.js';
import { buildingSiteCheck } from './core/site-check.js';
import { formatDuration } from './core/insolation.js';
import {
  compositeBounds, compositeParts, defaultComp, isFixedSizeComp, isRoundTable, kitchenHandles, kitchenLines, sofaLines,
  sofaSpots,
} from './core/composite.js';
import { furnitureBlock } from './core/blocks.js';
import { drawTerrainLabels, drawTerrainUnder } from './ui/terrain-render.js';
import { drawObjectGuides, drawSnapOverlay } from './ui/render-guides.js';
import { facadeDimensionStations } from './core/dimensions.js';
import { openingGaps } from './core/opening-spacing.js';
import { roomPolygon, roomRects, roomShapeArea, roomShapeHandles } from './core/room-shape.js';
import { nominalShape } from './core/v7/eat-bridge.js';
import { stairHandles, stairLayout, stairPath } from './core/stairs.js';
import { missingBedsideSpots, supportsBedsideNightstands } from './core/bedside.js';
import { itemsEditable } from './core/hit-stack.js';
import { wallRoomDimensions } from './core/wall-edit.js';
import { labelObstacles, planTextScale, roomLabelAnchor } from './core/label-anchor.js';
import { landscapeWarnings } from './core/landscape.js';
import {
  drawHouseShadow, drawLandscapeArrayPreview, drawLandscapeDraft, drawLandscapeGhost, drawLandscapeGround, drawLandscapeOverlay, drawLandscapeRaised,
  drawLandscapeSiteBase, drawSunGrid, drawSunShadows, landscapeShadow, lsPalette, visibleLandscape,
} from './ui/render-landscape.js';
import { landscapeSunFrame, landscapeSunGrid, landscapeSunTime } from './ui/landscape-sun.js';
import { formatSunLabel, sunForSite } from './core/landscape-shadow.js';
import { luminance } from './ui/render-landscape-kit.js';
import { PLAN_LS_ALPHA, planLandscapeObjects, planLandscapePref } from './ui/plan-landscape.js';
import { drawMassOverlay, drawMassSketch } from './ui/render-masses.js';
import { drawRoofOutlines, drawRoofPlan } from './ui/render-roofs.js';
import { drawSectionDraft, drawSectionHandles, drawSectionMarks } from './ui/render-section.js';
import { drawPlanSections } from './ui/render-plan-section.js';
import { drawAtriumPreview } from './ui/render-atrium.js';
import { drawSlabOpeningDraft, drawSlabOpenings } from './ui/render-slab.js';
import { levelProject } from './core/model.js';
import { slabOpeningPolygon, slabOpeningSourceLevel, slabOpenings } from './core/slab-openings.js';
import { drawPlanGrids } from './ui/render-axes.js';
import { drawErgonomics } from './ui/render-ergonomics.js';
import { drawPlanShadows } from './ui/plan-shadows.js';
import { currentLightAnalysis, drawRoomLightAnalysis } from './ui/render-solar.js';
import { VIEW_DISPLAY_DEFAULT, viewDisplay, viewIdOf } from './core/view-display.js';
import { drawGridLocks } from './ui/grid-locks.js';
import { drawSiteOpportunity } from './ui/render-site-opportunity.js';
import { drawHomeFlowsOverlay } from './ui/render-home-flows.js';
import { drawHomeEngineeringOverlay } from './ui/render-home-engineering.js';
import { drawHomeCirculationOverlay } from './ui/render-home-circulation.js';
import { bedDesign, COFFEE_TABLE_DUO } from './core/furniture-design.js';

// Пол помещения — цвет его типа (core/catalog.js roomColors): светлый в
// светлой теме и на печати, приглушённый тёмный — в тёмной теме.
const lightFill = (type) => roomColors(type).light;
const darkFill = (type) => roomColors(type).dark;
// Помещения «серые» (настройка вида, core/view-display.js) — как на презентационном плане.
const grayFill = () => '#f2f3f5';
const grayFillDark = () => '#2d3239';

function cssTokens(style = getComputedStyle(document.documentElement)) {
  const token = (name, fallback) => ((style && style.getPropertyValue(name)) || fallback).trim();
  const canvas = token('--canvas', '#fbfcfe');
  let dark = false;
  try { dark = luminance(canvas) < 0.45; } catch { /* нестандартный цвет — светлая тема */ }
  return {
    canvas,
    grid: token('--grid', '#e3e9f2'),
    gridMajor: token('--grid-major', '#d2dae6'),
    line: token('--line', '#26313d'),
    muted: token('--muted', '#687486'),
    text: token('--text', '#18202b'),
    accent: token('--accent', '#1f75ff'),
    accent2: token('--accent-2', '#1db4a8'),
    hover: token('--hover', '#1d4ed8'),
    danger: token('--danger', '#e14b4b'),
    ok: token('--ok-text', '#0e7a4e'),
    warn: token('--warn-text', '#8a5a00'),
    warnBg: token('--warn-bg', '#fff4e0'),
    wall: token('--wall-fill', '#39434f'),
    wallBearing: token('--wall-bearing', '#1d242c'),
    furniture: token('--furniture', '#5b6b7e'),
    surface: token('--surface', '#ffffff'),
    roomFill: dark ? darkFill : lightFill,
  };
}

function printTokens() {
  return { ...cssTokens(null), canvas: '#ffffff', roomFill: lightFill };
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j]; const b = ring[i];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function fillWallBody(ctx, wall, expand = 0) {
  const rects = wallRects(wall);
  if (rects.length) {
    for (const r of rects) ctx.fillRect(r.x - expand, r.y - expand, r.w + 2 * expand, r.h + 2 * expand);
    return;
  }
  for (const poly of wall.polys || (wall.poly ? [wall.poly] : [])) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath(); ctx.fill();
  }
}

// Сквозь проём верхнего этажа виден реальный план источника снизу. Это
// только графическая подложка: нижние объекты не попадают в hit-test.
function drawSlabUnderlays(ctx, st, tokens, px, { print = false } = {}) {
  st._slabUnderlay = [];
  if (st.modeName !== 'plan' || st.roofPlan) return;
  const openings = slabOpenings(st.project, st.project.activeLevel);
  for (const opening of openings) {
    const source = slabOpeningSourceLevel(st.project, st.project.activeLevel, opening);
    if (!source) continue;
    const polygon = slabOpeningPolygon(opening);
    const lp = levelProject(st.project, source.id);
    const lowerWalls = deriveWalls(lp);
    const lowerState = { ...st, project: lp, selection: null, hover: null };
    const touching = (item) => pointInRing({ x: item.x, y: item.y }, polygon) ||
      itemCorners(item).some((p) => pointInRing(p, polygon));
    const visibleItems = lp.items.filter(touching);
    st._slabUnderlay.push({
      openingId: opening.id, sourceLevelId: source.id,
      itemIds: visibleItems.map((i) => i.id), stairIds: visibleItems.filter((i) => i.kind === 'stairs').map((i) => i.id),
    });
    ctx.save();
    ctx.beginPath();
    polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.clip();
    const minX = Math.min(...polygon.map((p) => p.x)); const maxX = Math.max(...polygon.map((p) => p.x));
    const minY = Math.min(...polygon.map((p) => p.y)); const maxY = Math.max(...polygon.map((p) => p.y));
    ctx.fillStyle = tokens.surface;
    ctx.fillRect(minX - 1, minY - 1, maxX - minX + 2, maxY - minY + 2);
    ctx.fillStyle = print ? 'rgba(215,225,232,0.32)' : 'rgba(84,148,175,0.12)';
    ctx.fillRect(minX - 1, minY - 1, maxX - minX + 2, maxY - minY + 2);
    ctx.globalAlpha = print ? 0.34 : 0.46;
    for (const room of lp.rooms) drawFloor(ctx, room, tokens, px);
    ctx.fillStyle = tokens.wall;
    ctx.globalAlpha = print ? 0.42 : 0.52;
    for (const wall of lowerWalls) {
      if (wall.hidden) continue;
      if (wall.kind === 'chamfer') {
        ctx.beginPath();
        wall.poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath(); ctx.fill();
      } else fillWallBody(ctx, wall);
    }
    ctx.globalAlpha = print ? 0.48 : 0.58;
    for (const op of levelWindowOpenings(lp, lowerWalls)) drawOpening(ctx, lowerState, op, lowerWalls, tokens, px);
    for (const item of lp.items.filter((i) => i.kind !== 'stairs')) drawItem(ctx, item, tokens, px, false, false);
    ctx.globalAlpha = print ? 0.72 : 0.9;
    for (const item of lp.items.filter((i) => i.kind === 'stairs')) drawItem(ctx, item, tokens, px, false, false);
    ctx.restore();
  }
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

// Видимый прямоугольник в локальных координатах плана. Запас задаётся в
// экранных пикселях: при приближении он остаётся небольшим, а при общем виде
// естественно захватывает весь дом. Это позволяет не обходить сотни далёких
// комнат ради кадра, который браузер всё равно обрежет canvas-ом.
export function planViewportBox(view, width, height, padPx = 120) {
  const pad = Math.max(0, Number(padPx) || 0);
  const points = [
    unprojectPoint(view, -pad, -pad), unprojectPoint(view, width + pad, -pad),
    unprojectPoint(view, -pad, height + pad), unprojectPoint(view, width + pad, height + pad),
  ];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function rectInPlanViewport(rect, box) {
  if (!rect || !box) return false;
  return rect.x + rect.w >= box.minX && rect.x <= box.maxX
    && rect.y + rect.h >= box.minY && rect.y <= box.maxY;
}

const PLAN_SHADOW_REACH_MM = 6200;

const growPlanBox = (box, dx, dy = dx) => ({
  minX: box.minX - dx, maxX: box.maxX + dx,
  minY: box.minY - dy, maxY: box.maxY + dy,
});

const planBoxContains = (outer, inner) => outer && inner
  && outer.minX <= inner.minX && outer.maxX >= inner.maxX
  && outer.minY <= inner.minY && outer.maxY >= inner.maxY;

// Тени могут войти в экран от объекта за его границей (до 5 м луча плюс
// размытие). Поэтому для них недостаточно обычного viewport culling. Держим
// стабильное окно с запасом для панорамирования, а источники берём ещё на
// PLAN_SHADOW_REACH_MM дальше. Пока экран остаётся внутри coverage, набор
// источников и кеш тени не меняются от небольшого сдвига плана.
export function planShadowCullScope(previous, viewport, project = null, level = null) {
  if (previous?.project === project && previous?.level === level
    && planBoxContains(previous.coverage, viewport)) return previous;
  const width = Math.max(1, viewport.maxX - viewport.minX);
  const height = Math.max(1, viewport.maxY - viewport.minY);
  const coverage = growPlanBox(viewport, Math.max(3000, width * 0.25), Math.max(3000, height * 0.25));
  return {
    project, level, coverage,
    source: growPlanBox(coverage, PLAN_SHADOW_REACH_MM),
  };
}

function wallInPlanViewport(wall, box) {
  const rects = wallRects(wall);
  if (rects.some((rect) => rectInPlanViewport(rect, box))) return true;
  for (const poly of wall.polys || (wall.poly ? [wall.poly] : [])) {
    if (!poly.length) continue;
    const xs = poly.map((point) => point.x);
    const ys = poly.map((point) => point.y);
    if (rectInPlanViewport({
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
    }, box)) return true;
  }
  return false;
}

// Собственные стены рисуются в цикле их комнаты. При большом масштабе
// толстая наружная стена может ещё попадать в viewport, когда пол комнаты
// уже за его запасом. Поэтому владельцев фактически видимых стен нельзя
// отсекать отдельным тестом по полу.
export function planVisibleRoomIds(rooms, visibleWalls, viewport) {
  const ids = new Set();
  for (const room of rooms || []) {
    if (roomRects(room).some((rect) => rectInPlanViewport(rect, viewport))) ids.add(room.id);
  }
  for (const wall of visibleWalls || []) {
    for (const roomId of wall.rooms || []) ids.add(roomId);
  }
  return ids;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let backgroundLayer = null;
  let landscapeLayer = null;
  let backgroundRaster = null;

  function drawPlanLandscape(target, width, height, paint) {
    landscapeLayer ||= typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    if (landscapeLayer.width !== width) landscapeLayer.width = width;
    if (landscapeLayer.height !== height) landscapeLayer.height = height;
    const layer = landscapeLayer.getContext('2d');
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.clearRect(0, 0, width, height);
    paint(layer);
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = PLAN_LS_ALPHA;
    target.drawImage(landscapeLayer, 0, 0);
    target.globalAlpha = 1;
  }

  function drawCachedBackground({ view, dpr, key, sources, zooming, paint, paintLandscape }) {
    const { width, height } = canvas;
    const scale = view.scale * dpr;
    const rotation = view.rotation || 0;
    const panX = view.panX * dpr;
    const panY = view.panY * dpr;
    const ratio = backgroundRaster ? scale / backgroundRaster.scale : 1;
    const x = backgroundRaster ? panX - backgroundRaster.x * ratio : 0;
    const y = backgroundRaster ? panY - backgroundRaster.y * ratio : 0;
    const reusable = backgroundRaster?.key === key && backgroundRaster.rotation === rotation
      && backgroundRaster.sources.length === sources.length
      && sources.every((source, i) => source === backgroundRaster.sources[i])
      && (zooming ? ratio >= 0.82 && ratio <= 1.25 : ratio === 1)
      && x <= 0 && y <= 0 && x + backgroundLayer.width * ratio >= width
      && y + backgroundLayer.height * ratio >= height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (reusable) {
      ctx.drawImage(backgroundRaster.bitmap || backgroundLayer,
        -x / ratio, -y / ratio, width / ratio, height / ratio, 0, 0, width, height);
      return;
    }

    // Запас за краями позволяет сдвигать и масштабировать готовый фон.
    const padX = Math.ceil(Math.min(width * 0.35, 200 * dpr));
    const padY = Math.ceil(Math.min(height * 0.35, 200 * dpr));
    const w = width + padX * 2;
    const h = height + padY * 2;
    backgroundLayer ||= typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    if (backgroundLayer.width !== w) backgroundLayer.width = w;
    if (backgroundLayer.height !== h) backgroundLayer.height = h;
    const background = backgroundLayer.getContext('2d');
    paint(background, w / dpr, h / dpr, padX / dpr, padY / dpr);

    if (paintLandscape) {
      drawPlanLandscape(background, w, h, (layer) => paintLandscape(layer, padX / dpr, padY / dpr));
    }

    backgroundRaster?.bitmap?.close();
    const bitmap = backgroundLayer.transferToImageBitmap?.();
    backgroundRaster = { key, sources, rotation, scale, x: panX + padX, y: panY + padY, bitmap };
    ctx.drawImage(bitmap || backgroundLayer, padX, padY, width, height, 0, 0, width, height);
  }

  // opts (для печати листов): width/height — размер в CSS px, dpr — плотность,
  // print — светлая палитра без сетки, site: false — без слоёв участка,
  // detail: false — без мебели, подписей и размеров комнат (генплан).
  // thumbnail — чистый презентационный план для карточки проекта: оформление
  // как на печати, но с мягкими фиксированными тенями и без размеров/осей.
  function draw(state, opts = {}) {
    const print = Boolean(opts.print);
    const thumbnail = Boolean(opts.thumbnail);
    // Снимок плана для карточки проекта остаётся чистым (без выделения и
    // инструментов), но повторяет сам лист: сетку, размеры и оси не прячем.
    const planSnapshot = thumbnail && opts.planSnapshot === true;
    const tokens = print || thumbnail ? printTokens() : cssTokens();
    const dpr = opts.dpr || window.devicePixelRatio || 1;
    const width = opts.width ?? canvas.clientWidth;
    const height = opts.height ?? canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const view = state.view; // мир (участок, съёмка) → экран
    const { scale } = view;
    const walls = state.walls || deriveWalls(state.project);
    const site = opts.site === false ? null : state.project.site;
    const w2s = (x, y) => projectPoint(view, x, y);
    // Дом рисуется в своих осях: вид дома = вид мира, повёрнутый и сдвинутый
    // на поворот дома (core/building.js). Масштаб тот же.
    const pv = composeView(view, state.project.building);
    const p2s = (x, y) => projectPoint(pv, x, y);
    const setView = (v, target = ctx, offsetX = 0, offsetY = 0) => {
      const c = Math.cos(v.rotation || 0);
      const s = Math.sin(v.rotation || 0);
      target.setTransform(dpr * v.scale * c, dpr * v.scale * s, -dpr * v.scale * s, dpr * v.scale * c,
        dpr * (v.panX + offsetX), dpr * (v.panY + offsetY));
    };
    // Сетка: в «Плане» — по осям дома, в «Участке» — по осям съёмки.
    const gridView = state.modeName === 'plan' ? pv : view;
    const px = (v) => v / scale;
    const vd = thumbnail
      ? { ...VIEW_DISPLAY_DEFAULT, rooms: 'color', shadows: true, light: 'fixed', length: 'short' }
      : print ? VIEW_DISPLAY_DEFAULT : viewDisplay(
        state.project,
        state.analyticalView?.id || viewIdOf(state.project, state.modeName),
      );

    const underlay = site?.underlay;
    const image = state.underlayImg;
    const underlayImg = underlay && !state.underlayHidden && image?.complete && image.naturalWidth ? image : null;
    function drawBackground(target, w, h, offsetX, offsetY) {
      target.setTransform(dpr, 0, 0, dpr, 0, 0);
      target.fillStyle = tokens.canvas;
      target.fillRect(0, 0, w, h);

      setView(gridView, target, offsetX, offsetY);
      if (!print || planSnapshot) {
        const shifted = { ...gridView, panX: gridView.panX + offsetX, panY: gridView.panY + offsetY };
        drawGrid(target, planViewportBox(shifted, w, h, 0), scale, px, tokens);
      }
      setView(view, target, offsetX, offsetY);
      // Топосъёмка поверх сетки, затем рельеф, дороги и соседние здания.
      if (underlayImg) {
        const uw = underlay.widthPx * underlay.mmPerPx;
        const uh = underlay.heightPx * underlay.mmPerPx;
        target.save();
        target.translate(underlay.x + uw / 2, underlay.y + uh / 2);
        target.rotate(((underlay.rot || 0) * Math.PI) / 180);
        target.globalAlpha = underlay.opacity ?? 0.7;
        target.drawImage(underlayImg, -uw / 2, -uh / 2, uw, uh);
        target.globalAlpha = 1;
        if (state.selection?.type === 'site' && state.selection.kind === 'underlay') {
          target.strokeStyle = tokens.accent;
          target.lineWidth = px(1.6);
          target.setLineDash([px(8), px(5)]);
          target.strokeRect(-uw / 2, -uh / 2, uw, uh);
        }
        target.restore();
      }
      if (site) drawTerrainUnder(target, state, site, px, tokens.canvas);
      if (site) drawSiteUnder(target, state, site, tokens, px, { sunShadow: vd.sunShadow });
    }

    // Ландшафт (core/landscape.js, ui/render-landscape.js): в «Ландшафте» —
    // для правки, в «Участке» — для контекста. Покрытия — под домом.
    const landscape = state.modeName === 'landscape';
    // Слои ландшафта (панель «Ландшафт»): скрытые группы не рисуются.
    const lsVis = state.lsVis || null;
    // В «Плане» (не на печати) — приглушённо под домом, по настройке вида
    // «Ландшафт на плане» (ui/plan-landscape.js, вкладка «Виды»).
    const planLs = site && state.modeName === 'plan' && !print && opts.planLandscape !== false ? planLandscapePref() : null;
    const lsObjects = !site ? []
      : planLs ? planLandscapeObjects(site.landscape?.objects || [], planLs)
        : state.modeName !== 'plan' ? visibleLandscape(site.landscape?.objects || [], lsVis) : [];
    // Стиль ландшафта: «Эскиз» (акварель + графика) или «Чертёж» (монохром);
    // лист печати передаёт свой (opts.lsStyle). Тема — по цвету холста.
    const lsStyle = opts.lsStyle || state.lsStyle || 'sketch';
    const lsDark = !print && luminance(tokens.canvas) < 0.4;
    const lsPal = lsPalette(lsStyle, lsDark);
    // Тени (плашка «Тени» в «Ландшафте»): 'off' — нет, 'default' — условные
    // (как раньше), 'sun' — по солнцу (core/landscape-shadow.js, кеш в ui/landscape-sun.js).
    const sunMode = landscape ? (state.lsSun?.mode || 'default') : 'default';
    const shadowsOn = planLs ? planLs.shadows === true : lsVis?.shadows !== false && sunMode !== 'off';
    const sunFrame = landscape && shadowsOn && sunMode === 'sun' ? landscapeSunFrame(state.project, lsObjects) : null;
    const sunDir = sunFrame?.sun.up ? { x: sunFrame.sun.dir.x, y: sunFrame.sun.dir.y, k: 0.3 } : null;
    const lsOpts = {
      px, lod: scale * 1000, shadow: sunDir || landscapeShadow(site), noShadows: !shadowsOn || sunMode === 'sun',
      sunShadows: landscape && sunMode !== 'default',
      style: lsStyle, dark: lsDark, pal: lsPal, dpr,
    };
    const houseFootprints = landscape ? buildingSiteCheck(state.project).footprint.map((f) => f.corners) : [];
    const showPlanLandscape = Boolean(planLs && lsObjects.length);
    function paintLandscape(target, offsetX, offsetY) {
      setView(view, target, offsetX, offsetY);
      drawLandscapeGround(target, lsObjects, lsOpts);
      drawLandscapeRaised(target, lsObjects, lsOpts);
    }
    if ((showPlanLandscape || underlayImg) && state.modeName === 'plan' && !print && !thumbnail) {
      const selection = state.selection?.type === 'site' ? state.selection : null;
      const hover = state.hover?.type === 'site-obj' ? state.hover : null;
      // Сетка, топосъёмка, рельеф и полупрозрачный ландшафт компонуются один
      // раз, чтобы браузер не смешивал большие изображения на каждом кадре.
      const sunWalls = site?.sun?.enabled && vd.sunShadow ? state.walls : null;
      const key = [
        state.drawingRevision, canvas.width, canvas.height, dpr, lsStyle, tokens.canvas, lsOpts.noShadows, vd.sunShadow,
        lsOpts.shadow?.x, lsOpts.shadow?.y, lsOpts.shadow?.k, document.fonts?.status,
        underlay?.x, underlay?.y, underlay?.mmPerPx, underlay?.rot, underlay?.opacity,
        selection?.kind, selection?.id, hover?.kind, hover?.id,
      ].join('|');
      drawCachedBackground({
        view, dpr, key, sources: [state.project, state.siteBuildable, underlayImg, sunWalls, ...lsObjects], zooming: opts.zooming,
        paint: drawBackground,
        paintLandscape: showPlanLandscape ? paintLandscape : null,
      });
      state._siteOpportunityUI = null;
      setView(view);
    } else {
      drawBackground(ctx, width, height, 0, 0);
      if (showPlanLandscape) {
        drawPlanLandscape(ctx, canvas.width, canvas.height, (layer) => paintLandscape(layer, 0, 0));
        setView(view);
      }
    }
    // Участок — газоном (светлая зелень с зерном; в «Чертеже» — пунктир).
    if (landscape && site?.boundary?.length >= 3) drawLandscapeSiteBase(ctx, site.boundary, lsOpts);
    // В «Ландшафте» дом — «белое пятно с планом»: светлые полы, тёмные стены.
    const houseTokens = landscape ? {
      ...tokens,
      roomFill: () => lsPal.paper,
      wall: lsPal.ink, wallBearing: lsPal.ink,
    } : vd.rooms === 'gray' ? { ...tokens, roomFill: lsDark ? grayFillDark : grayFill } : tokens;
    state._planLandscape = showPlanLandscape ? lsObjects.length : 0;
    if (!showPlanLandscape && lsObjects.length) drawLandscapeGround(ctx, lsObjects, lsOpts);
    if (landscape && sunMode === 'sun') {
      // Анализ освещённости — под тенями; тени по солнцу — на земле, до дома и объектов.
      const grid = state.lsSun?.analysis ? landscapeSunGrid(state.project, lsObjects) : null;
      if (grid) drawSunGrid(ctx, grid, lsOpts);
      if (sunFrame) drawSunShadows(ctx, sunFrame.polys, lsOpts, { simple: sunFrame.simple });
    } else if (landscape && shadowsOn && houseFootprints.length) {
      // Тень дома; сам дом ниже рисуется настоящим планом этажа (полы, стены, проёмы).
      drawHouseShadow(ctx, houseFootprints, lsOpts, site?.buildingHeight || 6000);
    }

    // 3–6. Дом — в своих осях.
    setView(pv);
    // «План крыши» (ui/roof-plan.js): только подложка этажей и крыши.
    if (state.roofPlan && state.modeName === 'plan' && !print) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRoofPlan(ctx, { p2s, tokens });
      ctx.restore();
      if (site) drawCompass(ctx, state, site, width, tokens);
      return;
    }
    // Эскиз масс (core/masses.js) — подложка под комнатами и стенами; на печать не идёт.
    state._planMasses = 0;
    if (!print && opts.site !== false) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMassSketch(ctx, { p2s, tokens });
      ctx.restore();
    }
    // Проекция кровли (core/roofs.js) — бледный штрих по настройке вида (по умолчанию нет).
    state._planRoofs = 0;
    if (opts.site !== false) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRoofOutlines(ctx, { p2s, tokens, print });
      ctx.restore();
    }

    // 6. Мебель (на генплане и в «Ландшафте» — без неё).
    const detail = opts.detail !== false && !landscape;
    const planViewport = planViewportBox(pv, width, height, opts.cullPadPx ?? 120);
    const visibleWalls = opts.cull === false ? walls : walls.filter((wall) => wallInPlanViewport(wall, planViewport));
    const visibleRoomIds = opts.cull === false
      ? new Set(state.project.rooms.map((room) => room.id))
      : planVisibleRoomIds(state.project.rooms, visibleWalls, planViewport);
    const visibleRooms = opts.cull === false
      ? state.project.rooms
      : state.project.rooms.filter((room) => visibleRoomIds.has(room.id));
    const roomVisible = (room) => visibleRoomIds.has(room.id);
    const visibleItems = !detail ? [] : opts.cull === false
      ? state.project.items
      : state.project.items.filter((item) => rectInPlanViewport(itemBounds(item), planViewport));
    const planShadows = !landscape && state.modeName === 'plan' && vd.shadows
      && (thumbnail || (!print && opts.site !== false));
    const shadowScope = !planShadows || opts.cull === false || thumbnail ? null
      : planShadowCullScope(state._planShadowCull, planViewport, state.project, state.project.activeLevel);
    if (shadowScope) state._planShadowCull = shadowScope;
    const shadowWalls = !planShadows ? [] : shadowScope
      ? walls.filter((wall) => wallInPlanViewport(wall, shadowScope.source))
      : walls;
    const shadowItems = !planShadows || !detail ? [] : shadowScope
      ? state.project.items.filter((item) => rectInPlanViewport(itemBounds(item), shadowScope.source))
      : state.project.items;
    {
      // Этаж ниже — бледные стены (подложка для выравнивания этажей).
      if (!landscape && state.belowWalls?.length) {
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = tokens.wall;
        for (const wall of state.belowWalls) {
          if (opts.cull !== false && !wallInPlanViewport(wall, planViewport)) continue;
          if (wall.hidden) continue;
          if (wall.kind === 'chamfer') {
            ctx.beginPath();
            wall.poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.closePath();
            ctx.fill();
          } else {
            fillWallBody(ctx, wall);
          }
        }
        ctx.restore();
      }

      // 3–4. Пол + собственные стены каждой комнаты в порядке массива (z):
      // комната, стоящая позже (поверх), закрывает «съеденную» под ней.
      const ownByRoom = new Map();
      const sharedWalls = [];
      const chamferWalls = [];
      for (const wall of visibleWalls) {
        if (wall.kind === 'chamfer') { chamferWalls.push(wall); continue; }
        // Ручные стены (схема 6) — поверх полов, как общие.
        if (wall.kind === 'shared' || wall.kind === 'joint' || wall.kind === 'manual') { sharedWalls.push(wall); continue; }
        const rid = wall.rooms[0];
        if (!ownByRoom.has(rid)) ownByRoom.set(rid, []);
        ownByRoom.get(rid).push(wall);
      }
      const paintWall = (wall) => {
        const selected = state.selection?.type === 'wall' && state.selection.key === wall.key &&
          (state.selection.from === undefined || Math.abs(state.selection.from - wall.from) < 1);
        const hovered = state.hover?.type === 'wall' && state.hover.key === wall.key && Math.abs((state.hover.from ?? wall.from) - wall.from) < 1;
        if (wall.hidden && !selected && !hovered) {
          // Скрытая стена — тонкий пунктир по оси: видно, где была граница.
          const c = wall.center;
          if (!c) return;
          ctx.save();
          ctx.strokeStyle = tokens.wall;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = px(1);
          ctx.setLineDash([px(6), px(4)]);
          ctx.beginPath();
          ctx.moveTo(c.x1, c.y1);
          ctx.lineTo(c.x2, c.y2);
          ctx.stroke();
          ctx.restore();
          return;
        }
        ctx.fillStyle = houseTokens.wall;
        if (selected) ctx.fillStyle = tokens.accent;
        else if (hovered) ctx.fillStyle = tokens.hover;
        if (wall.hidden) ctx.globalAlpha = 0.22;
        // v2: непересекающиеся куски области (с углами), v1: полоса.
        // Куски соседних стен чуть перекрываем (0,5 px экрана), иначе на стыках
        // сглаживание даёт светлые швы — стена выглядит собранной из кирпичиков.
        const e = wall.hidden ? 0 : px(0.5);
        fillWallBody(ctx, wall, e);
        ctx.globalAlpha = 1;
      };
      const roomLayer = (room) => {
        if (isOpenRoom(room)) return 0; // террасы и балконы всегда под домом
        if (isShaft(room)) return 3;
        return room.parentId ? 2 : 1;
      };
      const roomPaintOrder = [...visibleRooms].sort((a, b) => roomLayer(a) - roomLayer(b));
      drawFreeLoops(ctx, state.freeLoops, houseTokens, px);
      for (const room of roomPaintOrder) {
        drawFloor(ctx, room, houseTokens, px);
        if (isOpenRoom(room)) drawRailing(ctx, room, state, houseTokens, px);
        for (const wall of ownByRoom.get(room.id) || []) paintWall(wall);
      }
      // Общие стыковочные стены — поверх всех полов.
      for (const wall of sharedWalls) paintWall(wall);
      // Фаски на переходах толщины — заполняют ступеньку треугольником.
      for (const wall of chamferWalls) {
        ctx.fillStyle = houseTokens.wall;
        ctx.beginPath();
        ctx.moveTo(wall.poly[0].x, wall.poly[0].y);
        for (let i = 1; i < wall.poly.length; i += 1) ctx.lineTo(wall.poly[i].x, wall.poly[i].y);
        ctx.closePath();
        ctx.fill();
      }

      // Шахта — верхний технический проём: она перекрывает полы и любые
      // перегородки помещений под ней, затем поверх остаются только её стены.
      for (const room of roomPaintOrder.filter((candidate) => isShaft(candidate))) {
        drawFloor(ctx, room, houseTokens, px);
        for (const wall of ownByRoom.get(room.id) || []) paintWall(wall);
      }

      // v2: штрих по единому контуру видимых стен (без швов между кусками,
      // с внутренними дворами-дырами). v1 — без штриха, как раньше.
      if (wallsEngine(state.project) === 'v2') {
        const outline = cachedWallOutline(walls);
        if (outline.length) {
          ctx.save();
          ctx.strokeStyle = houseTokens.wallBearing;
          ctx.lineWidth = px(1);
          ctx.lineJoin = 'miter';
          ctx.beginPath();
          for (const cycle of outline) {
            cycle.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.closePath();
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      // Тени от стен и мебели (ui/plan-shadows.js) по настройке вида «Освещение»:
      // готовый слой из кеша — поверх полов и стен (места стен в слое прозрачные),
      // под проёмами, мебелью и подписями.
      if (planShadows) drawPlanShadows(ctx, {
        walls: shadowWalls, items: shadowItems, dpr, scale, dark: lsDark,
        display: vd, project: state.project, force: thumbnail,
      });
      if (planShadows) {
        // Мягкая тень не должна съедать конструктивный контур. Повторяем
        // только наружную линию, а выбранную/под курсором стену — и заливку.
        const outline = cachedWallOutline(walls);
        if (outline.length) {
          ctx.save();
          ctx.strokeStyle = houseTokens.wallBearing;
          ctx.globalAlpha = lsDark ? 0.9 : 0.76;
          ctx.lineWidth = px(1.15);
          ctx.lineJoin = 'miter';
          ctx.beginPath();
          for (const cycle of outline) {
            cycle.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.closePath();
          }
          ctx.stroke();
          ctx.restore();
        }
        // Обводим только объединённый контур выше: границы отдельных
        // частей стены создавали тёмные швы и квадраты на L/T-стыках.
        for (const wall of walls) {
          const selected = state.selection?.type === 'wall' && state.selection.key === wall.key
            && (state.selection.from === undefined || Math.abs(state.selection.from - wall.from) < 1);
          const hovered = state.hover?.type === 'wall' && state.hover.key === wall.key
            && Math.abs((state.hover.from ?? wall.from) - wall.from) < 1;
          if (selected || hovered) paintWall(wall);
        }
      }

      // Карта прямого солнца или предварительной освещённости — аналитическая подложка:
      // поверх пола/теней, но под проёмами, мебелью и подписями.
      if (detail && !print && state.modeName === 'plan' && state.solarAnalysis?.on) {
        const rooms = state.solarAnalysis.scope === 'level'
          ? state.project.rooms.filter((room) => room.type !== 'shaft')
          : state.project.rooms.filter((room) => room.id === (state.solarAnalysis.roomId || state.selection?.id));
        const drawnRoomIds = [];
        for (const room of rooms) {
          if (opts.cull !== false && !roomVisible(room)) continue;
          const analysis = currentLightAnalysis(room.id);
          if (!analysis) continue;
          if (drawRoomLightAnalysis(ctx, { analysis, room, tokens, px })) drawnRoomIds.push(room.id);
        }
        state._lightAnalysisDrawn = {
          levelId: state.project.activeLevel,
          roomIds: drawnRoomIds,
          mode: state.solarAnalysis.mode,
        };
      } else if (state._lightAnalysisDrawn) {
        state._lightAnalysisDrawn = null;
      }

      // Нормы: зона перекрытия помещений (ошибка планировки) — красная штриховка.
      const overlapZones = landscape ? [] : (state.norms?.overlaps || []).filter((o) => o.levelId === state.project.activeLevel);
      if (overlapZones.length) {
        ctx.save();
        ctx.fillStyle = tokens.danger;
        ctx.strokeStyle = tokens.danger;
        ctx.lineWidth = px(1.5);
        ctx.setLineDash([px(5), px(3)]);
        for (const o of overlapZones) {
          for (const r of o.rects) {
            if (opts.cull !== false && !rectInPlanViewport(r, planViewport)) continue;
            ctx.globalAlpha = 0.18;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.globalAlpha = 0.9;
            ctx.strokeRect(r.x, r.y, r.w, r.h);
          }
        }
        ctx.restore();
      }

      // Подсветка комнаты под курсором.
      if (!landscape && state.hover?.type === 'room' && state.selection?.id !== state.hover.id) {
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
      for (const opening of levelWindowOpenings(state.project, walls)) {
        if (opts.cull !== false && opening.roomId && !visibleRoomIds.has(opening.roomId)
          && state.selection?.id !== opening.id && state.hover?.id !== opening.id) continue;
        drawOpening(ctx, state, opening, walls, houseTokens, px);
      }

      // 6. Мебель (на генплане — без неё: opts.detail === false). С тенями — объёмная:
      // светлый непрозрачный верх, тень и ореол вокруг — из слоя теней.
      const itemTokens = planShadows ? { ...tokens, furnitureFill: lsDark ? '#454d58' : '#ffffff' } : tokens;
      const hoveredItems = hoveredFurnitureIds(state.project.items, state.hover);
      for (const item of visibleItems) {
        const selected = (state.selection?.type === 'item' && state.selection.id === item.id) ||
          (state.selection?.type === 'multi' && state.selection.itemIds.includes(item.id));
        const hovered = hoveredItems.has(item.id);
        drawItem(ctx, item, itemTokens, px, selected, hovered);
      }
      if (!landscape) drawSlabUnderlays(ctx, state, tokens, px, { print });
      // Эргономика мебели (ui/render-ergonomics.js): зоны и тесные места — только на экране.
      if (detail && !print && state.modeName === 'plan') drawErgonomics(ctx, { st: state, walls, tokens, px, p2s, dpr, scale, print });
    }

    // 7. Участок поверх полов (граница, красная линия, въезд) и
    // предпросмотры инструментов участка — в координатах съёмки.
    setView(view);
    if (lsObjects.length && !planLs) drawLandscapeRaised(ctx, lsObjects, lsOpts);
    if (landscape && state.ghostLandscape) drawLandscapeGhost(ctx, state.ghostLandscape, lsOpts, tokens.accent);
    const flightStart = landscape && state.tool?.kind === 'ls-flight' ? state.tool.first : null;
    if (flightStart) {
      ctx.beginPath();
      ctx.arc(flightStart.x, flightStart.y, px(5), 0, Math.PI * 2);
      ctx.fillStyle = tokens.accent;
      ctx.fill();
      ctx.lineWidth = px(1.5);
      ctx.strokeStyle = tokens.canvas;
      ctx.stroke();
    }
    if (landscape && state.tool?.kind === 'draw-landscape') drawLandscapeDraft(ctx, state.tool, lsOpts, tokens.accent);
    if (landscape && ['ls-array', 'ls-route'].includes(state.tool?.kind)) drawLandscapeArrayPreview(ctx, state.tool, lsOpts, tokens.accent);
    if (site) drawSiteOver(ctx, state, site, tokens, px);

    state._calLabelAt = null;
    // Предпросмотр линии севера при задании по двум точкам.
    const northTool = state.tool?.kind === 'north' ? state.tool : null;
    if (northTool && northTool.points.length === 1 && state.northCursor) {
      const a = northTool.points[0];
      const b = state.northCursor;
      ctx.strokeStyle = tokens.danger;
      ctx.fillStyle = tokens.danger;
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(8), px(5)]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = px(14);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(ang - 0.4) * head, b.y - Math.sin(ang - 0.4) * head);
      ctx.lineTo(b.x - Math.cos(ang + 0.4) * head, b.y - Math.sin(ang + 0.4) * head);
      ctx.closePath(); ctx.fill();
      state._calLabelAt = { x: b.x, y: b.y, text: 'С' };
    }

    // Предпросмотр «Выровнять вид»: линия между двумя точками.
    const alignTool = state.tool?.kind === 'align-view' ? state.tool : null;
    if (alignTool && alignTool.points.length === 1 && state.alignCursor) {
      const a = alignTool.points[0];
      const b = state.alignCursor;
      ctx.strokeStyle = tokens.accent;
      ctx.fillStyle = tokens.accent;
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(8), px(5)]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, px(4), 0, Math.PI * 2); ctx.fill(); }
    }

    // Предпросмотр ворот/калитки целиком, с привязкой к стороне участка.
    if (state.entryGhost) {
      ctx.save(); ctx.globalAlpha = 0.6;
      drawSiteEntry(ctx, { ...state.tool, kind: state.tool?.entryKind || 'gate', ...state.entryGhost }, tokens.accent2, tokens, px);
      ctx.restore();
    }
    if (state.draft?.points?.length) drawDraft(ctx, state.draft, tokens, px);
    state._snapLabelAt = (state.draft?.snapStart && state.draft.points.length)
      ? { x: state.draft.points[0].x, y: state.draft.points[0].y, text: state.draft.snapLabel }
      : null;

    // Отрезок калибровки топосъёмки (как в Revit/ArchiCAD).
    const calTool = state.tool?.kind === 'calibrate' ? state.tool : null;
    let calA = null;
    let calB = null;
    let calDashed = false;
    if (state.calibration) { calA = state.calibration.p1; calB = state.calibration.p2; }
    else if (calTool && calTool.points.length === 1 && state.calCursor) {
      calA = calTool.points[0]; calB = state.calCursor; calDashed = true;
    }
    if (calA && calB) {
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = px(2);
      ctx.setLineDash(calDashed ? [px(8), px(5)] : []);
      ctx.beginPath(); ctx.moveTo(calA.x, calA.y); ctx.lineTo(calB.x, calB.y); ctx.stroke();
      ctx.setLineDash([]);
      // Засечки на концах.
      const dx = calB.x - calA.x; const dy = calB.y - calA.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len; const ny = dx / len;
      const tick = px(8);
      for (const p of [calA, calB]) {
        ctx.beginPath();
        ctx.moveTo(p.x - nx * tick, p.y - ny * tick);
        ctx.lineTo(p.x + nx * tick, p.y + ny * tick);
        ctx.stroke();
      }
      // При черчении — показываем текущую длину в пикселях-условно; после
      // второй точки поле ввода само стоит на линии, цифра не нужна.
      if (calDashed) {
        state._calLabelAt = { x: (calA.x + calB.x) / 2, y: (calA.y + calB.y) / 2, text: 'кликните 2-ю точку' };
      }
    }

    // 8. Призраки и направляющие дома — снова в осях дома.
    setView(pv);
    if (state.ghost?.rect) {
      const g = state.ghost;
      const ghostView = g.building ? composeView(view, g.building) : pv;
      setView(ghostView);
      // valid+warn — янтарный (можно ставить, но с предупреждением);
      // valid — синий; invalid — красный (ставить нельзя).
      if (g.warn) { ctx.fillStyle = 'rgba(225,140,30,0.16)'; ctx.strokeStyle = '#e08c1e'; }
      else if (g.valid) { ctx.fillStyle = 'rgba(31,117,255,0.14)'; ctx.strokeStyle = tokens.accent; }
      else { ctx.fillStyle = 'rgba(225,75,75,0.16)'; ctx.strokeStyle = tokens.danger; }
      ctx.lineWidth = px(1.6);
      ctx.setLineDash([px(8), px(5)]);
      ctx.fillRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h);
      ctx.strokeRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h);
      ctx.setLineDash([]);
      setView(pv);
    }
    if (state.ghostItem) {
      ctx.save();
      ctx.globalAlpha = 0.58;
      drawItem(ctx, state.ghostItem, tokens, px, false, true);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    if (state.ghostOpening) {
      const preview = state.ghostOpeningFull;
      const rects = preview?.corner
        ? cornerWindowProjections(state.project, [preview], walls).map((o) => openingRect(state.project, o, walls)?.rect)
        : [state.ghostOpening.rect];
      ctx.fillStyle = 'rgba(29,180,168,0.5)';
      for (const r of rects) if (r) ctx.fillRect(r.x, r.y, r.w, r.h);
      if (isGlazedAssembly(preview)) {
        ctx.save(); ctx.globalAlpha = .65;
        for (const part of glazedOpeningParts(preview)) drawOpening(ctx, state, part, walls, tokens, px);
        ctx.restore();
      }
    }
    // Превью двери под курсором: створка с направлением открывания.
    if (state.ghostDoor) {
      const sym = doorSymbol(state.project, state.ghostDoor, walls);
      if (sym) {
        ctx.fillStyle = tokens.canvas;
        ctx.fillRect(sym.rect.x, sym.rect.y, sym.rect.w, sym.rect.h);
        ctx.strokeStyle = tokens.accent2;
        ctx.lineWidth = px(1.8);
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(sym.hinge.x, sym.hinge.y); ctx.lineTo(sym.open.x, sym.open.y); ctx.stroke();
        const a1 = Math.atan2(sym.closed.y - sym.hinge.y, sym.closed.x - sym.hinge.x);
        const a2 = Math.atan2(sym.open.y - sym.hinge.y, sym.open.x - sym.hinge.x);
        let d = a2 - a1; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        ctx.beginPath(); ctx.arc(sym.hinge.x, sym.hinge.y, state.ghostDoor.width, a1, a1 + d, d < 0); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // Инструмент «Стена»: тело будущей стены от начала до курсора и линии привязки.
    if (state.tool?.kind === 'wall' && state.tool.cursor) drawWallToolPreview(ctx, state.tool, tokens, px);
    if (state.tool?.kind === 'bound-room' && state.tool.preview) drawLoopShape(ctx, state.tool.preview, tokens.accent, px, 0.18);
    if (state.guides?.length) {
      ctx.strokeStyle = tokens.accent2;
      ctx.lineWidth = px(1);
      ctx.setLineDash([px(6), px(6)]);
      for (const guide of state.guides) {
        if (guide.type === 'magnet') {
          // Магнит блоков (core/v7/magnet.js): отрезок вдоль общей грани.
          ctx.save();
          ctx.setLineDash(guide.kind === 'contact' ? [] : [px(4), px(4)]);
          ctx.lineWidth = px(guide.kind === 'contact' ? 2 : 1);
          ctx.beginPath();
          if (guide.axis === 'v') { ctx.moveTo(guide.at, guide.from); ctx.lineTo(guide.at, guide.to); }
          else { ctx.moveTo(guide.from, guide.at); ctx.lineTo(guide.to, guide.at); }
          ctx.stroke();
          ctx.restore();
          continue;
        }
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
      // Съеденная (core/v7/eat-bridge.js): пунктиром — её полная номинальная
      // форма; видимая — номинал минус верхние комнаты и перегородка.
      if (selRoom.eatBase?.base && !print) {
        const pts = roomPolygon(nominalShape(selRoom));
        ctx.save();
        ctx.setLineDash([px(7), px(5)]);
        ctx.lineWidth = px(1.4);
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
    if (state.selection?.type === 'multi') {
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = px(1.6);
      ctx.setLineDash([px(6), px(4)]);
      for (const id of state.selection.roomIds) {
        const room = state.project.rooms.find((r) => r.id === id);
        if (room) ctx.strokeRect(room.x, room.y, room.w, room.h);
      }
      for (const id of state.selection.wallIds || []) {
        const wall = state.project.walls.find((w) => w.id === id);
        if (!wall) continue;
        ctx.beginPath(); ctx.moveTo(wall.axis.a.x, wall.axis.a.y); ctx.lineTo(wall.axis.b.x, wall.axis.b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Подсветка места замечания (ui/issues.js) — на мгновение после перехода.
    if (!print && state.flash?.rects && state.flash.levelId === state.project.activeLevel) {
      ctx.save();
      ctx.strokeStyle = '#f0a020';
      ctx.fillStyle = 'rgba(240, 160, 32, 0.14)';
      ctx.lineWidth = px(4);
      for (const r of state.flash.rects) { ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x, r.y, r.w, r.h); }
      ctx.restore();
    }

    // --- Экранный слой ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Логические связи программы дома — поверх геометрии, но под подписями.
    // Это не фактические траектории людей: только доказанные связи помещений.
    drawHomeFlowsOverlay(ctx, { st: state, p2s, tokens, print });
    drawHomeEngineeringOverlay(ctx, { st: state, p2s, tokens, print });
    drawHomeCirculationOverlay(ctx, { st: state, p2s, tokens, print });

    // Подписи и размеры зависят от масштаба: при отдалении шрифт меньше,
    // мельче 8 px подписи не рисуются, размеры скрываются раньше.
    const text = planTextScale(scale * 1000, { print });
    state._labelBoxes = [];
    if (detail) {
      if (text.labels) {
        const obstacles = labelObstacles(state.project, walls);
        for (const room of visibleRooms) drawRoomLabel(ctx, state, room, p2s, tokens, obstacles, text, print);
      }
      // Полупрозрачные размерные линии у всех комнат: внутренние и габаритные.
      if (text.dims && (!thumbnail || planSnapshot)) {
        drawAllRoomDims(ctx, state, walls, p2s, tokens, visibleRooms);
      }
    }
    // Маркеры нестандартных зазоров «≠ N мм» (core/gaps.js) — только на экране
    // и при читаемом масштабе подписей.
    state._gapBoxes = [];
    if (detail && !print && text.labels && state.modeName !== 'site') {
      for (const gap of state.gaps || []) {
        state._gapBoxes.push(drawGapMarker(ctx, gap, p2s(gap.at.x, gap.at.y), tokens, gap.key === state.gapFocus));
      }
    }
    state._wallUI = null;
    const selWall = state.selection?.type === 'wall'
      ? walls.find((wall) => wall.key === state.selection.key &&
        (state.selection.from === undefined || Math.abs(wall.from - state.selection.from) < 1))
      : null;
    if (selWall) drawSelectedWallUI(ctx, state, selWall, p2s, tokens);
    if (selWall?.kind === 'manual') drawManualWallAxis(ctx, state, selWall, p2s, tokens);
    const splitEdit = state.splitEdit;
    if (selWall && splitEdit?.key === selWall.key && Math.abs((splitEdit.from ?? selWall.from) - selWall.from) < 1) {
      drawWallSplitPreview(ctx, selWall, splitEdit, p2s, tokens);
    }
    if (selRoom) drawRoomHandles(ctx, selRoom, p2s, tokens);
    // Ручки на торцах выбранного проёма — тянуть, меняя ширину с шагом 50 мм.
    const selOpening = state.selection?.type === 'opening'
      ? state.project.openings.find((o) => o.id === state.selection.id) : null;
    state._openingUI = null;
    if (selOpening) {
      for (const hp of openingHandles(state.project, selOpening, walls)) {
        drawHandleSquare(ctx, p2s(hp.x, hp.y), tokens);
      }
      drawSelectedOpeningUI(ctx, state, selOpening, walls, p2s, scale, tokens);
    }
    // Вставка окна/двери: размеры до стен и соседних проёмов слева и справа.
    const ghostOp = state.ghostDoor || state.ghostOpeningFull;
    if (ghostOp && !ghostOp.corner && !print) drawOpeningGhostDims(ctx, state, ghostOp, walls, p2s, tokens);
    // Проёмы в перекрытии (ui/render-slab.js): над лестницей — авто, ручные.
    if (state.modeName === 'plan' && !state.roofPlan) {
      drawSlabOpenings(ctx, { st: state, p2s, tokens, print });
      if (!print) {
        drawSlabOpeningDraft(ctx, { st: state, p2s, tokens });
        if (state.tool?.kind === 'atrium') drawAtriumPreview(ctx, state.tool, p2s, tokens);
      }
    }
    // Линии разрезов по плану этажа (ui/plan-section.js) и черновик инструмента.
    if (state.modeName === 'plan' && !print) drawPlanSections(ctx, { p2s, tokens });
    // Координационные оси (ui/render-axes.js): тонко поверх плана; на листе плана — по настройке.
    if (state.modeName === 'plan' && opts.detail !== false && (!thumbnail || planSnapshot)) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlanGrids(ctx, { st: state, p2s, tokens, print });
      if (!print) drawGridLocks(ctx, { st: state, p2s, tokens }); // замки «стена — ось»
      ctx.restore();
    }
    if (state.modeName === 'plan' && !print) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMassOverlay(ctx, { p2s, tokens });
      ctx.restore();
    }
    if (site) drawSiteLabels(ctx, state, site, w2s, tokens);
    // Подписи ландшафта на плане — только если включены во «Видах».
    if (planLs?.labels && lsObjects.length) {
      drawLandscapeOverlay(ctx, lsObjects, { w2s, tokens, scale, labels: true, style: lsStyle });
    }
    if (landscape && site) {
      const warnings = landscapeWarnings(lsObjects, { boundary: site.boundary, footprints: houseFootprints });
      drawLandscapeOverlay(ctx, lsObjects, {
        sel: state.selection?.type === 'landscape' ? state.selection.ids : [],
        hoverId: state.hover?.type === 'landscape' ? state.hover.id : null,
        warnings, w2s, tokens, scale, warnColor: '#d08a1e',
        labels: lsVis?.labels === true, vertex: state.lsVertex || null, style: lsStyle,
        handles: lsHandleOverlay(state, lsObjects, print),
      });
    }
    // Линии разрезов «А–А» и черновик инструмента «Разрез».
    // На листе генплана — только разрезы, вынесенные на лист (чёрным).
    if (landscape && !print) {
      const sections = state.project.site?.landscape?.sections;
      if (sections?.length) drawSectionMarks(ctx, sections, { w2s, tokens, scale, activeId: state.lsSectionId || null });
      if (state.tool?.kind === 'ls-section') drawSectionDraft(ctx, state.tool, { w2s, tokens });
      const open = state.lsSectionId && sections?.find((s) => s.id === state.lsSectionId);
      if (open && !state.tool) drawSectionHandles(ctx, open, { w2s, tokens, scale, vertex: state.lsSecVertex ?? -1 });
    } else if (print && opts.sectionMarks?.length) {
      drawSectionMarks(ctx, opts.sectionMarks, { w2s, tokens: { ...tokens, danger: '#000000', surface: '#ffffff' }, scale });
    }
    if (site) drawTerrainLabels(ctx, state, site, w2s, tokens, { width, height });
    // Подпись «замкнуть/завершить» у первой точки черновика.
    if (state._snapLabelAt) {
      const p = w2s(state._snapLabelAt.x, state._snapLabelAt.y);
      ctx.fillStyle = tokens.accent2;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state._snapLabelAt.text, p.x, p.y - 16);
    }
    // Подсказка при черчении отрезка калибровки.
    if (state._calLabelAt) {
      const p = w2s(state._calLabelAt.x, state._calLabelAt.y);
      ctx.fillStyle = tokens.accent;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state._calLabelAt.text, p.x, p.y - 14);
    }
    // Привязки черчения линий: лучи, выравнивание, значки, «длина · угол».
    if (!print && state.drawSnap) drawSnapOverlay(ctx, state, state.drawSnap.space === 'plan' ? p2s : w2s, tokens, width);
    if (!print && state.objGuides) drawObjectGuides(ctx, state.objGuides, w2s, tokens, width);
    // Ручки топосъёмки: круги вращения снаружи углов + квадраты (масштаб).
    if (site?.underlay && state.selection?.type === 'site' && state.selection.kind === 'underlay' && !site.underlay.locked) {
      for (const r of underlayRotators(site.underlay, 22, scale)) {
        const p = w2s(r.x, r.y);
        ctx.fillStyle = tokens.surface;
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, HANDLE_SIZE / 2 - 1.5, -0.6, Math.PI * 1.2);
        ctx.stroke();
      }
      for (const hp of underlayHandles(site.underlay)) {
        drawHandleSquare(ctx, w2s(hp.x, hp.y), tokens);
      }
    }
    // Ручки соседнего дома: квадраты по углам (масштаб) + круги (вращение).
    if (site && state.selection?.type === 'site' && state.selection.kind === 'neighbor') {
      const n = site.neighbors.find((x) => x.id === state.selection.id);
      if (n) {
        for (const r of neighborRotators(n, 22, scale)) {
          const p = w2s(r.x, r.y);
          ctx.fillStyle = tokens.surface;
          ctx.strokeStyle = tokens.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Значок «поворот».
          ctx.beginPath();
          ctx.arc(p.x, p.y, HANDLE_SIZE / 2 - 1.5, -0.6, Math.PI * 1.2);
          ctx.stroke();
        }
        for (const c of neighborCorners(n)) drawHandleSquare(ctx, w2s(c.x, c.y), tokens);
      }
    }

    const selItem = state.selection?.type === 'item'
      ? state.project.items.find((i) => i.id === state.selection.id) : null;
    state._sofaUI = null;
    state._kitchenUI = null;
    state._stairUI = null;
    state._bedsideUI = null;
    state._tempDimsUI = null;
    if (selItem) {
      // Рамка, подпись размера, угловые квадраты (размер) и круги (поворот).
      const corners = itemCorners(selItem);
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      corners.forEach((c, i) => {
        const p = p2s(c.x, c.y);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
      // Подпись размера — над верхней (на экране) точкой объекта, вне его,
      // на подложке: не сливается с именем комнаты.
      const sc = corners.map((c) => p2s(c.x, c.y));
      const topY = Math.min(...sc.map((p) => p.y));
      const midX = sc.reduce((sum, p) => sum + p.x, 0) / sc.length;
      const sizeLabel = `${selItem.w} × ${selItem.h} мм · ${Math.round(selItem.rotation || 0)}°`;
      drawTextPill(ctx, sizeLabel, midX, topY - 12, tokens, tokens.accent);
      const handleMode = itemHandleMode(state.itemHandle, selItem.id);
      // Временные размеры до стен и соседней мебели (в режиме поворота — нет).
      if (!print && state.modeName === 'plan' && handleMode !== 'rotate') {
        const sizeW = ctx.measureText(sizeLabel).width + 10;
        drawTempDims(ctx, state, selItem, p2s, tokens,
          { x: midX - sizeW / 2, y: topY - 24, w: sizeW, h: 16 });
      }
      const rotatorsPx = [];
      for (const r of handleMode === 'rotate' ? itemRotators(selItem, 20, scale) : []) {
        const p = p2s(r.x, r.y);
        rotatorsPx.push({ x: p.x, y: p.y, r: HANDLE_SIZE / 2 + 1 });
        ctx.fillStyle = tokens.surface;
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_SIZE / 2 - 1.5, -0.6, Math.PI * 1.2); ctx.stroke();
      }
      // Диван-конструктор не растягивается: вместо квадратов — «+» на торцах.
      // Лестница: свои ручки (ступени по маршам, ширина марша, углы площадок)
      // вместо растяжения — только крупным планом (как правка мебели).
      if (selItem.kind === 'stairs') {
        if (!print && handleMode !== 'rotate' && itemsEditable(scale)) drawStairHandles(ctx, state, selItem, p2s, tokens);
      } else if (selItem.comp?.type === 'kitchen' && isFixedSizeComp(selItem)) drawKitchenHandles(ctx, state, selItem, p2s, tokens, rotatorsPx);
      else if (isFixedSizeComp(selItem)) drawSofaPlus(ctx, state, selItem, p2s, tokens);
      else if (handleMode === 'scale') for (const c of corners) drawHandleSquare(ctx, p2s(c.x, c.y), tokens);
      else if (handleMode === 'stretch') for (const e of itemEdgeHandles(selItem)) drawHandleSquare(ctx, p2s(e.x, e.y), tokens);
    }

    // Группа мебели: общая рамка, подпись и ручки режима (как у одного предмета).
    const groupId = groupHandleId(state.selection);
    const groupBox = groupId ? groupBounds(groupItems(state.project, state.selection)) : null;
    if (groupBox && !print) drawGroupFrame(ctx, state, groupBox, groupId, p2s, tokens, scale);
    if (!print) {
      const bed = selectedBedsideBed(state);
      if (bed) drawBedsidePlus(ctx, state, bed, p2s, tokens);
    }

    if (state.ghost?.rect) {
      const g = state.ghost;
      // Размер призрака — над его верхней (на экране) гранью, на подложке:
      // в центре он ложился на имя комнаты.
      const r = g.rect;
      const ghostPv = g.building ? composeView(view, g.building) : pv;
      const ghostP2s = (x, y) => projectPoint(ghostPv, x, y);
      const sc = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => ghostP2s(x, y));
      const topY = Math.min(...sc.map((q) => q.y));
      const midX = sc.reduce((sum, q) => sum + q.x, 0) / 4;
      const color = g.warn ? '#e08c1e' : (g.valid ? tokens.accent : tokens.danger);
      const label = g.label || `${(r.w / 1000).toFixed(1)} × ${(r.h / 1000).toFixed(1)} м`;
      const y0 = topY - (g.reason ? 30 : 12);
      drawTextPill(ctx, label, midX, y0, tokens, color, '600 12px system-ui, sans-serif');
      if (g.reason) drawTextPill(ctx, g.reason, midX, y0 + 18, tokens, color);
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

// Наведение на любой предмет пользовательской группы подсвечивает всю группу.
// Для несгруппированного предмета набор по-прежнему содержит только его самого.
export function hoveredFurnitureIds(items, hover) {
  if (hover?.type !== 'item') return new Set();
  const hovered = items.find((item) => item.id === hover.id);
  if (!hovered) return new Set();
  if (!hovered.group) return new Set([hovered.id]);
  return new Set(items.filter((item) => item.group === hovered.group).map((item) => item.id));
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

// «Маршрут проекта» кеширует точное MultiPolygon-пятно после каждой правки.
// До его первого расчёта оставляем прежний быстрый inset как fallback.
function buildableRings(state, site) {
  if (Array.isArray(state.siteBuildable?.geometry)) {
    return state.siteBuildable.geometry.flatMap((polygon) => polygon);
  }
  const legacy = buildZonePolygon(site);
  return legacy ? [legacy] : [];
}

function drawSiteUnder(ctx, state, site, tokens, px, { sunShadow = true } = {}) {
  const hov = state.hover?.type === 'site-obj' ? state.hover : null;
  drawSiteOpportunity(ctx, state, tokens, px);
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
    polyPath(ctx, road.points, Boolean(road.closed));
    ctx.stroke();
    ctx.strokeStyle = tokens.muted;
    ctx.lineWidth = px(1.2);
    ctx.setLineDash([800, 600]);
    ctx.beginPath();
    polyPath(ctx, road.points, Boolean(road.closed));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const boundary = site.boundary;
  const zoneRings = site.showBuildZone && boundary ? buildableRings(state, site) : [];

  // Запретная полоса: участок минус зона застройки (красная штриховка).
  if (boundary && site.showBuildZone && state.modeName !== 'landscape') {
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, boundary);
    for (const ring of zoneRings) if (ring.length >= 3) polyPath(ctx, ring);
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
      polyPath(ctx, buf.poly);
      ctx.clip();
      paintHatch(ctx, buf.poly, 'rgba(225,75,75,0.07)', 'rgba(225,75,75,0.22)', px);
      ctx.restore();
      ctx.strokeStyle = 'rgba(225,75,75,0.5)';
      ctx.lineWidth = px(1);
      ctx.setLineDash([px(5), px(4)]);
      ctx.beginPath();
      polyPath(ctx, buf.poly);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Соседние дома (с учётом поворота).
  for (const n of site.neighbors || []) {
    const selected = state.selection?.type === 'site' && state.selection.kind === 'neighbor' && state.selection.id === n.id;
    const hovered = hov?.kind === 'neighbor' && hov.id === n.id;
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(((n.rot || 0) * Math.PI) / 180);
    const x = -n.w / 2;
    const y = -n.h / 2;
    ctx.fillStyle = 'rgba(120,132,148,0.25)';
    ctx.fillRect(x, y, n.w, n.h);
    ctx.strokeStyle = selected ? tokens.accent : hovered ? tokens.hover : tokens.muted;
    ctx.lineWidth = px(selected || hovered ? 2 : 1.3);
    ctx.strokeRect(x, y, n.w, n.h);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + n.w, y + n.h);
    ctx.moveTo(x + n.w, y); ctx.lineTo(x, y + n.h);
    ctx.stroke();
    ctx.restore();
  }

  // Тени (инсоляция): дом + соседи — в координатах съёмки, поэтому тени
  // совпадают со стенами при любом повороте дома и вида.
  // В «Ландшафте» при тенях «Солнце»/«Выкл» тени инсоляции участка не дублируются.
  const lsMode = state.modeName === 'landscape' ? (state.lsSun?.mode || 'default') : 'default';
  // Настройка вида «Тень дома по солнцу» (core/view-display.js) — у каждого вида своя.
  if (site.sun?.enabled && lsMode === 'default' && sunShadow) {
    const sun = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
    const vector = shadowVector(sun, site.north, site.buildingHeight || 6000);
    if (vector) {
      ctx.beginPath();
      const t = state.project.settings?.exterior || 250;
      // Тень дают все этажи (верхний может нависать над нижним).
      for (const room of state.project.levels.flatMap((l) => l.rooms)) {
        if (room.parentId) continue;
        const rect = { x: room.x - t, y: room.y - t, w: room.w + t * 2, h: room.h + t * 2 };
        // Комната в осях дома → настоящие (повёрнутые) углы в координатах съёмки.
        polyPath(ctx, shadowPolygonFromCorners(rectCornersWorld(state.project.building, rect), vector));
      }
      for (const n of site.neighbors || []) {
        const nv = shadowVector(sun, site.north, n.height || 6000);
        if (!nv) continue;
        polyPath(ctx, shadowPolygonFromCorners(neighborRectCorners(n), nv));
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

export function drawEntryPreview(canvas, entry) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const style = getComputedStyle(canvas);
  const color = style.getPropertyValue('--desk-accent').trim() || '#21654e';
  const paper = style.getPropertyValue('--chip-paper').trim() || '#f6f9fb';
  const w = canvas.width; const h = canvas.height;
  const span = entrySpan(entry);
  const symbols = entryParts(entry).map(entryOpeningSymbol);
  const extents = symbols.flatMap((symbol) => symbol.slide ? [150, 550] : symbol.leaves.map((leaf) => leaf.extentY));
  const minY = Math.min(-120, ...extents); const maxY = Math.max(120, ...extents);
  const scale = Math.min((w - 44) / (span.to - span.from), (h - 24) / (maxY - minY));
  ctx.clearRect(0, 0, w, h); ctx.save();
  ctx.translate(w / 2 - (span.from + span.to) / 2 * scale, 12 + maxY * scale); ctx.scale(scale, -scale);
  ctx.fillStyle = '#a8b1bd';
  for (const x of [span.from - 650, span.to]) ctx.fillRect(x, -80, 650, 160);
  drawSiteEntry(ctx, { ...entry, x: 0, y: 0, dir: 90 }, color, { canvas: paper }, (px) => px / scale);
  ctx.restore();
}

function drawSiteEntry(ctx, entry, color, tokens, px) {
  const parts = entryParts(entry); const span = entrySpan(entry);
  ctx.save();
  ctx.translate(entry.x, entry.y);
  ctx.rotate(((entry.dir ?? entry.angle ?? 0) - 90) * Math.PI / 180);
  ctx.strokeStyle = tokens.canvas;
  ctx.lineWidth = px(4);
  ctx.beginPath(); ctx.moveTo(span.from - 120, 0); ctx.lineTo(span.to + 120, 0); ctx.stroke();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = px(2);
  for (const p of parts) {
    const left = p.offset - p.width / 2; const right = p.offset + p.width / 2;
    for (const x of [left, right]) ctx.fillRect(x - 60, -90, 120, 180);
    ctx.beginPath(); ctx.moveTo(left, 0); ctx.lineTo(right, 0); ctx.stroke();
    const symbol = entryOpeningSymbol(p);
    if (symbol.slide) {
      ctx.strokeRect(left, -70, p.width, 140);
      const { from, to } = symbol.slide; const sign = Math.sign(to.x - from.x); const head = Math.min(300, p.width * .2);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.moveTo(to.x - sign * head, to.y - head / 2); ctx.lineTo(to.x, to.y); ctx.lineTo(to.x - sign * head, to.y + head / 2); ctx.stroke();
      continue;
    }
    for (const leaf of symbol.leaves) {
      ctx.beginPath(); ctx.moveTo(leaf.hinge.x, leaf.hinge.y); ctx.lineTo(leaf.tip.x, leaf.tip.y); ctx.stroke();
      ctx.setLineDash([px(4), px(3)]);
      ctx.beginPath(); ctx.arc(leaf.hinge.x, leaf.hinge.y, leaf.radius, leaf.start, leaf.end, leaf.anticlockwise); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

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
    const zoneRings = buildableRings(state, site);
    if (zoneRings.length) {
      ctx.strokeStyle = 'rgba(225,75,75,0.75)';
      ctx.lineWidth = px(1.4);
      ctx.setLineDash([px(10), px(6)]);
      ctx.beginPath();
      for (const ring of zoneRings) if (ring.length >= 3) polyPath(ctx, ring);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (site.redLine?.length >= 2) {
    ctx.strokeStyle = kindColor('redline', undefined, tokens.danger);
    ctx.lineWidth = px(selectedKind === 'redline' || hov?.kind === 'redline' ? 2.8 : 2);
    ctx.setLineDash([1600, 500, 250, 500]);
    ctx.beginPath();
    polyPath(ctx, site.redLine, Boolean(site.redLineClosed));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const e of siteEntries(site)) {
    drawSiteEntry(ctx, e, kindColor('entry', e.id, tokens.accent2), tokens, px);
  }

  // Дом на участке: красный пунктир — выходит за зону застройки или ближе
  // нормы к соседу (постоянно, не разовым тостом); выделен/под курсором — контур.
  if (state.modeName === 'site') {
    const check = buildingSiteCheck(state.project);
    const bad = !check.ok;
    const color = bad ? tokens.danger
      : selectedKind === 'building' ? tokens.accent
        : hov?.kind === 'building' ? tokens.hover : null;
    if (color && check.footprint.length) {
      ctx.strokeStyle = color;
      ctx.lineWidth = px(bad ? 2.4 : 2);
      if (bad) ctx.setLineDash([px(8), px(5)]);
      ctx.beginPath();
      for (const f of check.footprint) polyPath(ctx, f.corners);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
  for (const e of siteEntries(site)) {
    const p = w2s(e.x, e.y);
    ctx.fillStyle = tokens.accent2;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${entryTitle(e)}${e.wicket ? ' + калитка' : ''}`, p.x, p.y + 22);
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
      // Круг с плюсом посередине стороны добавляет новый угол. На коротких
      // экранных отрезках скрываем его, чтобы не перекрывать вершины.
      if (sel.kind === 'boundary' && state.tool?.kind === 'edit' && state.tool.target === 'boundary') {
        for (const handle of polylineMidpoints(points, true)) {
          const a = w2s(points[handle.from].x, points[handle.from].y);
          const b = w2s(points[handle.to].x, points[handle.to].y);
          if (Math.hypot(b.x - a.x, b.y - a.y) < SITE_INSERT_HANDLE_MIN_EDGE_PX) continue;
          const p = w2s(handle.x, handle.y);
          const r = (HANDLE_SIZE + 2) / 2;
          ctx.fillStyle = tokens.surface;
          ctx.strokeStyle = tokens.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p.x - 2.5, p.y);
          ctx.lineTo(p.x + 2.5, p.y);
          ctx.moveTo(p.x, p.y - 2.5);
          ctx.lineTo(p.x, p.y + 2.5);
          ctx.stroke();
        }
      }
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
  // Направление севера на экране: поворот вида (уже включает выравнивание) + север.
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
  // Солнце на лимбе: в «Ландшафте» с тенями «Солнце» — лучистое, по
  // времени плашки, и подпись даты/времени под компасом.
  const lsSun = state.modeName === 'landscape' && state.lsSun?.mode === 'sun' ? state.lsSun : null;
  if (lsSun) {
    const time = landscapeSunTime(site);
    const sun = sunForSite({ ...site, north: 0 }, site.sun.date, time);
    ctx.save();
    ctx.rotate((sun.azimuth * Math.PI) / 180);
    const sy = -r - 2;
    ctx.globalAlpha = sun.up ? 1 : 0.45;
    ctx.strokeStyle = '#e39a16';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(Math.cos(a) * 7.5, sy + Math.sin(a) * 7.5);
      ctx.lineTo(Math.cos(a) * 10.5, sy + Math.sin(a) * 10.5);
    }
    ctx.stroke();
    ctx.fillStyle = sun.up ? '#f6b52c' : '#9aa1a8';
    ctx.beginPath();
    ctx.arc(0, sy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.rotate(-angle);
    const text = formatSunLabel(site.sun.date, time) + (sun.up ? '' : ' · солнце за горизонтом');
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = tokens.surface;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(r + 2 - tw - 10, r + 16, tw + 10, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = tokens.text;
    ctx.fillText(text, r - 3, r + 25);
  } else if (site.sun?.enabled) {
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

// Перила открытого помещения (терраса/балкон) — сегменты core/railings.js.
// Поручни — двойная линия + стойки; балясины — двойная линия + частые
// поперечные штрихи; стекло — тонированная полоса с линией стекла.
// Выбранный сегмент — цветом выделения, с ручками на концах.
function drawRailing(ctx, room, state, tokens, px) {
  const project = state.project;
  const inset = RAILING_INSET;
  const sel = state.selection?.type === 'railing' && state.selection.roomId === room.id ? state.selection.id : null;
  const hov = state.hover?.type === 'railing' && state.hover.roomId === room.id ? state.hover.id : null;
  for (const segment of roomRailings(room, project.rooms, project.settings)) {
    const color = segment.id === sel ? tokens.accent : segment.id === hov ? tokens.hover : tokens.line;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const startCut = segment.a > segment.sideFrom + 1;
    const endCut = segment.b < segment.sideTo - 1;
    const innerEdge = segment.edge - segment.outward * inset;
    const line = (edge, from, to) => {
      if (to - from <= 1) return;
      ctx.beginPath();
      if (segment.orient === 'h') { ctx.moveTo(from, edge); ctx.lineTo(to, edge); }
      else { ctx.moveTo(edge, from); ctx.lineTo(edge, to); }
      ctx.stroke();
    };
    const pt = (along, across) => (segment.orient === 'h' ? [along, across] : [across, along]);
    if (segment.type === 'glass') {
      const lo = Math.min(segment.edge, innerEdge);
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = segment.id === sel ? tokens.accent : '#5b9bd5';
      if (segment.orient === 'h') ctx.fillRect(segment.a, lo, segment.b - segment.a, inset);
      else ctx.fillRect(lo, segment.a, inset, segment.b - segment.a);
      ctx.restore();
      ctx.lineWidth = px(segment.id === sel ? 2.5 : 1.6);
      line(segment.edge, segment.a, segment.b);
      ctx.lineWidth = px(1);
      line(innerEdge, segment.a, segment.b);
    } else {
      ctx.lineWidth = px(segment.id === sel ? 3 : 2);
      line(segment.edge, segment.a, segment.b);
      ctx.lineWidth = px(1.2);
      line(innerEdge, segment.a + (startCut ? 0 : inset), segment.b - (endCut ? 0 : inset));
      // У стыка со стеной стойку немного отодвигаем, чтобы на стене не оставалась точка.
      const postFrom = segment.a + (startCut ? inset : 0);
      const postTo = segment.b - (endCut ? inset : 0);
      const len = postTo - postFrom;
      if (len > 1) {
        if (segment.type === 'balusters') {
          ctx.lineWidth = px(1);
          const n = Math.max(1, Math.round(len / 150));
          ctx.beginPath();
          for (let i = 0; i <= n; i += 1) {
            const along = postFrom + (len * i) / n;
            ctx.moveTo(...pt(along, segment.edge));
            ctx.lineTo(...pt(along, innerEdge));
          }
          ctx.stroke();
        } else {
          const post = px(2.5);
          const n = Math.max(1, Math.round(len / 700));
          for (let i = 0; i <= n; i += 1) {
            const along = postFrom + (len * i) / n;
            ctx.beginPath();
            ctx.arc(...pt(along, segment.edge), post, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    if (segment.id === sel) {
      const s = px(HANDLE_SIZE);
      const mid = segment.edge - segment.outward * (inset / 2);
      for (const along of [segment.a, segment.b]) {
        const [x, y] = pt(along, mid);
        ctx.fillStyle = tokens.canvas;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.lineWidth = px(1.5);
        ctx.strokeStyle = tokens.accent;
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      }
    }
  }
}

function drawFloor(ctx, room, tokens, px) {
  if (isShaft(room)) {
    ctx.save();
    ctx.fillStyle = tokens.canvas;
    ctx.strokeStyle = tokens.muted;
    ctx.lineWidth = px(1.2);
    ctx.setLineDash([px(7), px(5)]);
    for (const rect of roomRects(room)) {
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
      ctx.moveTo(rect.x + rect.w, rect.y); ctx.lineTo(rect.x, rect.y + rect.h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  ctx.fillStyle = tokens.roomFill(room.type);
  for (const rect of roomRects(room)) ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

// Замкнутые петли стен без помещения — штриховка «не назначено».
function drawFreeLoops(ctx, loops, tokens, px) {
  for (const loop of loops || []) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(loop.poly[0].x, loop.poly[0].y);
    for (let i = 1; i < loop.poly.length; i += 1) ctx.lineTo(loop.poly[i].x, loop.poly[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = tokens.muted;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = px(1);
    const { x, y, w, h } = loop.bbox;
    const step = px(14);
    ctx.beginPath();
    for (let d = -h; d < w; d += step) { ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); }
    ctx.stroke();
    ctx.restore();
  }
}

function drawOpening(ctx, state, opening, walls, tokens, px) {
  const placed = openingRect(state.project, opening, walls);
  if (!placed || placed.wall.hidden) return;
  const { rect, wall } = placed;
  const selected = state.selection?.type === 'opening' && state.selection.id === opening.id;
  const hovered = state.hover?.type === 'opening' && state.hover.id === opening.id;
  ctx.fillStyle = tokens.canvas;
  if (opening.cornerJunction) {
    const r = opening.cornerJunction;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = selected ? tokens.accent : hovered ? tokens.hover : tokens.line;
  ctx.lineWidth = px(selected || hovered ? 1.8 : 1.4);
  if (opening.kind === 'door') {
    const type = opening.type || 'single';
    if (type === 'sliding') {
      // Раздвижная: два полотна внахлёст внутри толщины стены.
      const horiz = wall.orient === 'h';
      const len = horiz ? rect.w : rect.h;
      const t = horiz ? rect.h : rect.w;
      for (const [from, to, at] of [[0, 0.6, 0.35], [0.4, 1, 0.65]]) {
        ctx.beginPath();
        if (horiz) { ctx.moveTo(rect.x + len * from, rect.y + t * at); ctx.lineTo(rect.x + len * to, rect.y + t * at); }
        else { ctx.moveTo(rect.x + t * at, rect.y + len * from); ctx.lineTo(rect.x + t * at, rect.y + len * to); }
        ctx.stroke();
      }
      return;
    }
    if (type === 'none') {
      // Проём без двери: только косяки.
      ctx.beginPath();
      if (wall.orient === 'h') {
        ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x, rect.y + rect.h);
        ctx.moveTo(rect.x + rect.w, rect.y); ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
      } else {
        ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x + rect.w, rect.y);
        ctx.moveTo(rect.x, rect.y + rect.h); ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
      }
      ctx.stroke();
      return;
    }
    for (const symbol of doorLeaves(state.project, opening, walls)) {
      ctx.beginPath();
      ctx.moveTo(symbol.hinge.x, symbol.hinge.y);
      ctx.lineTo(symbol.open.x, symbol.open.y);
      ctx.stroke();
      ctx.beginPath();
      const radius = Math.hypot(symbol.closed.x - symbol.hinge.x, symbol.closed.y - symbol.hinge.y);
      const a1 = Math.atan2(symbol.closed.y - symbol.hinge.y, symbol.closed.x - symbol.hinge.x);
      const a2 = Math.atan2(symbol.open.y - symbol.hinge.y, symbol.open.x - symbol.hinge.x);
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      ctx.arc(symbol.hinge.x, symbol.hinge.y, radius, a1, a1 + delta, delta < 0);
      ctx.stroke();
    }
  } else {
    // Алюминиевую раму рисуем строго в пределах полотна стены (clip по band),
    // не выступала за грани стены ни внутрь, ни наружу — окно вровень со стеной.
    const band = wall.band;
    ctx.save();
    ctx.beginPath();
    const clip = opening.cornerWing ? rect : band;
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    ctx.save();
    ctx.strokeStyle = selected ? tokens.accent : hovered ? tokens.hover : '#3b4148';
    ctx.lineWidth = px(selected || hovered ? 1.8 : 2.2);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    ctx.beginPath();
    // Стеклопакет: у высоких и раздвижных систем профиль глубже.
    const deep = ['panoramic', 'lift-slide', 'french'].includes(opening.type);
    const glassAt = deep ? [0.32, 0.68] : [0.5];
    for (const k of glassAt) {
      if (rect.w >= rect.h) {
        ctx.moveTo(rect.x, rect.y + rect.h * k);
        ctx.lineTo(rect.x + rect.w, rect.y + rect.h * k);
      } else {
        ctx.moveTo(rect.x + rect.w * k, rect.y);
        ctx.lineTo(rect.x + rect.w * k, rect.y + rect.h);
      }
    }
    ctx.strokeStyle = selected ? tokens.accent : tokens.line;
    ctx.stroke();
    ctx.restore();
  }
}

function drawItem(ctx, item, tokens, px, selected, hovered) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(((item.rotation || 0) * Math.PI) / 180);
  if (item.mirrored) ctx.scale(-1, 1);
  if (isStructural(item.kind)) {
    // Свободная стена или колонна — заливка цветом стен.
    ctx.fillStyle = selected ? tokens.accent : hovered ? tokens.hover : tokens.wall;
    structuralPath(ctx, item.kind, item.w, item.h);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.strokeStyle = selected ? tokens.accent : hovered ? tokens.hover : tokens.furniture;
  ctx.lineWidth = px(selected || hovered ? 1.8 : 1.2);
  ctx.fillStyle = hovered ? 'rgba(29,78,216,0.1)' : tokens.furnitureFill || 'rgba(127,144,165,0.08)';
  const parts = compositeParts(item);
  // Диван-конструктор: предмет — только его модули, основы нет.
  const whole = isFixedSizeComp(item);
  // Части составной мебели (стулья у стола) — под основой.
  drawParts(ctx, parts, item, whole);
  if (!whole) drawGlyph(ctx, item.kind, item.w, item.h, item);
  if (selected && parts.length && !whole) {
    // Рамка группы: основа выделена ручками, части — пунктиром вокруг.
    const b = compositeBounds({ ...item, x: 0, y: 0, rotation: 0 });
    ctx.save();
    ctx.setLineDash([px(4), px(3)]);
    ctx.lineWidth = px(1);
    ctx.strokeRect(b.x - px(3), b.y - px(3), b.w + px(6), b.h + px(6));
    ctx.restore();
  }
  ctx.restore();
}

// Части в локальных осях предмета: блок каталога — его глифом, блок из
// DXF — своими линиями.
// Задвинутая под столешницу часть стула не видна (вырез по контуру основы).
function drawParts(ctx, parts, base, whole = false) {
  if (!parts.length) return;
  if (whole && parts[0].kind.startsWith('kitchen:')) { drawKitchenParts(ctx, parts); return; }
  if (whole) { drawSofaParts(ctx, parts); return; }
  ctx.save();
  if (!whole) {
    ctx.beginPath();
    const big = (Math.max(base.w, base.h) + 10000) * 2;
    ctx.rect(-big, -big, big * 2, big * 2);
    if (isRoundTable(base.kind)) ctx.ellipse(0, 0, base.w / 2, base.h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(-base.w / 2, -base.h / 2, base.w, base.h);
    ctx.clip('evenodd');
  }
  for (const part of parts) {
    const block = furnitureBlock(part.kind);
    ctx.save();
    ctx.translate(part.x, part.y);
    ctx.rotate(((part.rotation || 0) * Math.PI) / 180);
    if (block?.lines) {
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of block.lines) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
    } else {
      drawGlyph(ctx, block?.glyph || part.kind, part.w, part.h);
    }
    ctx.restore();
  }
  ctx.restore();
}

// Диван-конструктор: заливка модулей, затем линии без повторов на стыках
// (core/composite.js sofaLines) и скругления подлокотников.
function drawSofaParts(ctx, parts) {
  ctx.beginPath();
  for (const p of parts) {
    const odd = Math.round((p.rotation || 0) / 90) % 2 !== 0;
    const w = odd ? p.h : p.w;
    const h = odd ? p.w : p.h;
    ctx.rect(p.x - w / 2, p.y - h / 2, w, h);
  }
  ctx.fill();
  const { segs, arcs } = sofaLines(parts);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  for (const a of arcs) { ctx.moveTo(a.cx + a.r * Math.cos(a.a0), a.cy + a.r * Math.sin(a.a0)); ctx.arc(a.cx, a.cy, a.r, a.a0, a.a1); }
  ctx.stroke();
}

// Кухня-конструктор: заливка нижнего ряда, контуры без повторов на стыках
// (core/composite.js kitchenLines), знаки элементов, верхний ряд — пунктиром.
function drawKitchenParts(ctx, parts) {
  const base = parts.filter((p) => p.layer === 'base');
  ctx.beginPath();
  for (const p of base) {
    const odd = Math.round((p.rotation || 0) / 90) % 2 !== 0;
    const w = odd ? p.h : p.w;
    const h = odd ? p.w : p.h;
    ctx.rect(p.x - w / 2, p.y - h / 2, w, h);
  }
  ctx.fill();
  const { base: segs, upper } = kitchenLines(parts);
  const lw = ctx.lineWidth;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke();
  for (const p of parts) {
    const type = p.kind.slice(8);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(((p.rotation || 0) * Math.PI) / 180);
    drawKitchenSymbol(ctx, type, p.w, p.h, lw);
    ctx.restore();
  }
  // Верхний ряд (шкафы, вытяжка) — пунктир поверх.
  ctx.save();
  ctx.lineWidth = lw * 0.8;
  ctx.setLineDash([lw * 6, lw * 4]);
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of upper) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke();
  ctx.restore();
}

// Знак элемента кухни в осях части: w — вдоль стороны, h — глубина, стена —
// сверху (y = −h/2), фронт — снизу.
function drawKitchenSymbol(ctx, type, w, h, lw) {
  const x0 = -w / 2; const y0 = -h / 2;
  const m = Math.min(w, h);
  const line = (ax, ay, bx, by) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
  const circle = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); };
  const cross = () => { line(x0, y0, x0 + w, y0 + h); line(x0 + w, y0, x0, y0 + h); };
  switch (type) {
    case 'sink': { // чаша и смеситель у стены
      ctx.beginPath(); cornerRectPath(ctx, x0 + w * 0.12, y0 + h * 0.3, w * 0.76, h * 0.58, Array(4).fill(m * 0.12)); ctx.stroke();
      circle(0, y0 + h * 0.15, Math.min(45, m * 0.08));
      line(0, y0 + h * 0.15, 0, y0 + h * 0.36);
      circle(0, y0 + h * 0.6, Math.min(30, m * 0.05)); // слив
      break;
    }
    case 'hob': { // четыре конфорки
      const r = m * 0.15;
      circle(-w * 0.23, -h * 0.21, r); circle(w * 0.23, -h * 0.21, r * 0.8);
      circle(-w * 0.23, h * 0.21, r * 0.8); circle(w * 0.23, h * 0.21, r);
      break;
    }
    case 'oven-column': { // колонна (крест) и духовой шкаф (дверца с окном)
      cross();
      ctx.beginPath(); ctx.rect(x0 + w * 0.15, y0 + h * 0.62, w * 0.7, h * 0.26); ctx.stroke();
      break;
    }
    case 'fridge': { // колонна (крест) и дверь у фронта
      cross();
      line(x0, y0 + h - Math.min(60, h * 0.1), x0 + w, y0 + h - Math.min(60, h * 0.1));
      break;
    }
    case 'dishwasher': { // корпус и барабан
      ctx.beginPath(); ctx.rect(x0 + w * 0.12, y0 + h * 0.12, w * 0.76, h * 0.76); ctx.stroke();
      circle(0, 0, m * 0.22);
      break;
    }
    case 'corner': line(x0, y0 + h, x0 + w, y0); break; // угловой шкаф: диагональ
    case 'filler': if (w > lw * 4) line(x0, y0, x0 + w, y0 + h); break;
    case 'hood': { // пунктирный крест (верхний ряд)
      ctx.save(); ctx.setLineDash([lw * 6, lw * 4]); ctx.lineWidth = lw * 0.8; cross(); ctx.restore();
      break;
    }
    default: break;
  }
}

// Двойная стрелка в (x, y) вдоль (ux, uy): полудлина k, усы a.
function doubleArrowPath(ctx, x, y, ux, uy, k, a) {
  ctx.moveTo(x - ux * k, y - uy * k); ctx.lineTo(x + ux * k, y + uy * k);
  for (const sgn of [1, -1]) {
    const tx = x + ux * k * sgn; const ty = y + uy * k * sgn;
    ctx.moveTo(tx, ty); ctx.lineTo(tx - ux * a * sgn - uy * a, ty - uy * a * sgn + ux * a);
    ctx.moveTo(tx, ty); ctx.lineTo(tx - ux * a * sgn + uy * a, ty - uy * a * sgn - ux * a);
  }
}

// Ручки выделенной кухни (экранный слой). Элементы — светлый круг с ↔
// вдоль стороны; длина стороны — залитый круг за торцом; глубина — залитый
// квадрат перед передней кромкой (стрелка от стены); ширина элемента —
// ромб на его конце. Длина/глубина/ширина показываются, только когда кухня
// на экране достаточно крупная и ручка не налезает на другие (и на круги
// поворота occupied). Зоны — в state._kitchenUI для pointerdown (ui/input.js).
const KITCHEN_DEPTH_PX = { length: 14, depth: 34, width: 44 }; // мин. глубина кухни на экране, px
function drawKitchenHandles(ctx, state, item, p2s, tokens, occupied = []) {
  const touch = Boolean(state.coarsePointer);
  const R = touch ? 15 : 9;
  const handles = [];
  const taken = [...occupied];
  const all = kitchenHandles(item);
  const p0 = p2s(0, 0); const p1 = p2s(1000, 0);
  const pxPerMm = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 1000;
  const depthPx = (item.comp?.depth || 600) * pxPerMm;
  const dir = (h, ax, ay) => {
    const p = p2s(h.x, h.y); const q = p2s(h.x + ax * 1000, h.y + ay * 1000);
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  };
  for (const h of all) {
    if (h.op !== 'move' && depthPx < KITCHEN_DEPTH_PX[h.op]) continue;
    const r = h.op === 'move' ? R : h.op === 'width' ? R * 0.8 : R * 0.9;
    const u = dir(h, h.ux, h.uy);
    const v = dir(h, h.vx, h.vy);
    const n = h.nx || h.ny ? dir(h, h.nx, h.ny) : { x: 0, y: 0 };
    const base = p2s(h.x, h.y);
    const x = base.x + n.x * (r + 4); const y = base.y + n.y * (r + 4);
    if (h.op !== 'move' && taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + 2)) continue;
    taken.push({ x, y, r });
    handles.push({ op: h.op, type: h.op === 'move' ? h.type : undefined, elem: h.elem, side: h.side, end: h.end, x, y, r, ux: u.x, uy: u.y, h });
    ctx.lineWidth = 1.5;
    if (h.op === 'move' || h.op === 'width') {
      ctx.fillStyle = tokens.surface;
      ctx.strokeStyle = tokens.accent;
      ctx.beginPath();
      if (h.op === 'move') ctx.arc(x, y, r, 0, Math.PI * 2);
      else { ctx.moveTo(x + u.x * r, y + u.y * r); ctx.lineTo(x + v.x * r, y + v.y * r); ctx.lineTo(x - u.x * r, y - u.y * r); ctx.lineTo(x - v.x * r, y - v.y * r); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); doubleArrowPath(ctx, x, y, u.x, u.y, r * (h.op === 'move' ? 0.6 : 0.5), r * 0.3); ctx.stroke();
    } else {
      ctx.fillStyle = tokens.accent;
      ctx.strokeStyle = tokens.surface;
      ctx.beginPath();
      if (h.op === 'length') ctx.arc(x, y, r, 0, Math.PI * 2);
      else {
        const k = r * 0.85;
        for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) ctx.lineTo(x + (u.x * a + v.x * b) * k, y + (u.y * a + v.y * b) * k);
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
      const w = h.op === 'length' ? u : v;
      ctx.beginPath(); doubleArrowPath(ctx, x, y, w.x, w.y, r * 0.55, r * 0.3); ctx.stroke();
    }
  }
  state._kitchenUI = { itemId: item.id, handles };
  // Живая подпись значения во время перетаскивания ручки.
  const lab = state.kitchenLabel;
  if (lab?.itemId === item.id) {
    const p = p2s(lab.x, lab.y);
    drawTextPill(ctx, lab.text, p.x, p.y - R - 16, tokens, lab.stop ? tokens.danger : tokens.accent, '600 12px system-ui, sans-serif');
  }
}

// Ручки выделенной лестницы (экранный слой): у конца марша — залитый круг
// с числом ступеней марша (тянуть — ступени перетекают в соседний марш; у
// прямой — проступь), на кромке первого марша — ромб ширины марша, в углу
// площадки — квадрат её размеров. Зоны — в state._stairUI (ui/input.js).
function drawStairHandles(ctx, state, item, p2s, tokens) {
  const touch = Boolean(state.coarsePointer);
  const R = touch ? 15 : 10;
  const handles = [];
  const fallback = state.project?.levels?.find((l) => l.id === state.project.activeLevel)?.height || 3000;
  for (const h of stairHandles(item, fallback)) {
    const base = p2s(h.x, h.y);
    const tip = p2s(h.x + h.out.x * 1000, h.y + h.out.y * 1000);
    const len = Math.hypot(tip.x - base.x, tip.y - base.y) || 1;
    const u = { x: (tip.x - base.x) / len, y: (tip.y - base.y) / len };
    const r = h.kind === 'steps' ? R : R * 0.8;
    const off = h.kind === 'landing' ? 0 : r + 3;
    const x = base.x + u.x * off;
    const y = base.y + u.y * off;
    handles.push({ id: h.id, kind: h.kind, x, y, r, plan: { x: h.x, y: h.y } });
    ctx.lineWidth = 1.5;
    if (h.kind === 'steps') {
      ctx.fillStyle = tokens.accent;
      ctx.strokeStyle = tokens.surface;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = tokens.surface;
      ctx.font = `600 ${touch ? 13 : 11}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(h.label, x, y + 0.5);
    } else if (h.kind === 'width') {
      ctx.fillStyle = tokens.surface;
      ctx.strokeStyle = tokens.accent;
      const v = { x: -u.y, y: u.x };
      ctx.beginPath();
      ctx.moveTo(x + u.x * r, y + u.y * r); ctx.lineTo(x + v.x * r, y + v.y * r);
      ctx.lineTo(x - u.x * r, y - u.y * r); ctx.lineTo(x - v.x * r, y - v.y * r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); doubleArrowPath(ctx, x, y, u.x, u.y, r * 0.5, r * 0.3); ctx.stroke();
    } else {
      ctx.fillStyle = tokens.surface;
      ctx.strokeStyle = tokens.accent;
      const k = r * 0.8;
      ctx.beginPath(); ctx.rect(x - k, y - k, k * 2, k * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = tokens.accent;
      ctx.beginPath(); ctx.rect(x - k * 0.4, y - k * 0.4, k * 0.8, k * 0.8); ctx.fill();
    }
  }
  state._stairUI = { itemId: item.id, handles };
  const lab = state.stairLabel;
  if (lab?.itemId === item.id) {
    const p = p2s(lab.x, lab.y);
    drawTextPill(ctx, lab.text, p.x, p.y - R - 16, tokens, tokens.accent, '600 12px system-ui, sans-serif');
  }
}

// Кнопки «+» у свободных торцов выделенного дивана-конструктора (экранный
// слой). Зоны клика — в state._sofaUI для pointerdown (ui/input.js).
const SOFA_PLUS_R = 11; // радиус кнопки, px (на тач-экране — больше)
function drawSofaPlus(ctx, state, item, p2s, tokens) {
  if (state.phoneSofaEdit !== undefined && state.phoneSofaEdit !== item.id) return;
  const touch = Boolean(state.coarsePointer);
  const spots = [];
  // Сначала торцы, потом стыки (вставка в середину) — стыки помельче и
  // только там, где кнопки не налезают друг на друга при текущем масштабе.
  for (const e of sofaSpots(item)) {
    const joint = e.end === 'joint';
    const r = joint ? (touch ? 14 : 8) : (touch ? 17 : SOFA_PLUS_R);
    const a = p2s(e.x, e.y);
    const b = p2s(e.x + e.nx * 1000, e.y + e.ny * 1000);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const x = a.x + ((b.x - a.x) / len) * (r + (joint ? 5 : 8));
    const y = a.y + ((b.y - a.y) / len) * (r + (joint ? 5 : 8));
    if (joint && spots.some((sp) => Math.hypot(sp.x - x, sp.y - y) < sp.r + r + 4)) continue;
    spots.push({ end: e.end, at: e.at, x, y, r });
    ctx.fillStyle = joint ? tokens.surface : tokens.accent;
    ctx.strokeStyle = joint ? tokens.accent : tokens.surface;
    ctx.lineWidth = joint ? 1.5 : 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = joint ? tokens.accent : tokens.surface;
    ctx.lineWidth = joint ? 1.8 : 2.2;
    const k = r * 0.5;
    ctx.beginPath(); ctx.moveTo(x - k, y); ctx.lineTo(x + k, y); ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); ctx.stroke();
  }
  state._sofaUI = { itemId: item.id, spots };
}

// Кровать может быть выбрана одна (до первой тумбы) или как обычная группа
// вместе с уже добавленными тумбами. В группе с несколькими кроватями ручки
// не показываем: непонятно, к какой из них относится нажатие.
function selectedBedsideBed(st) {
  const sel = st.selection;
  if (sel?.type === 'item') {
    const item = st.project.items.find((candidate) => candidate.id === sel.id);
    return supportsBedsideNightstands(item) && (!item.group || item.bedsideSet) ? item : null;
  }
  if (sel?.type !== 'multi' || sel.roomIds?.length) return null;
  const ids = new Set(sel.itemIds || []);
  const beds = st.project.items.filter((item) => ids.has(item.id) && supportsBedsideNightstands(item));
  return beds.length === 1 && beds[0].bedsideSet ? beds[0] : null;
}

// Две быстрые кнопки у изголовья. Координаты одновременно являются центрами
// будущих тумб, поэтому результат понятен ещё до клика.
function drawBedsidePlus(ctx, st, bed, p2s, tokens) {
  const r = st.coarsePointer ? 17 : 11;
  const spots = missingBedsideSpots(st.project.items, bed).map((spot) => {
    const p = p2s(spot.x, spot.y);
    ctx.fillStyle = tokens.accent;
    ctx.strokeStyle = tokens.surface;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = tokens.surface;
    ctx.lineWidth = 2.2;
    const k = r * 0.5;
    ctx.beginPath(); ctx.moveTo(p.x - k, p.y); ctx.lineTo(p.x + k, p.y);
    ctx.moveTo(p.x, p.y - k); ctx.lineTo(p.x, p.y + k); ctx.stroke();
    return { side: spot.side, x: p.x, y: p.y, r };
  });
  st._bedsideUI = { bedId: bed.id, spots };
}

// Контур со своим радиусом у каждого угла [вл, вп, нп, нл].
function cornerRectPath(ctx, x, y, w, h, radii) {
  const lim = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, lim)));
  ctx.moveTo(x + tl, y);
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

// Диван/кресло: подлокотники — отдельные блоки полной глубины (скруглены
// только снаружи), между ними — спинка и сиденье шириной seatW. Боковые
// кромки сиденья совпадают с внутренними кромками подлокотников и не
// рисуются второй раз; подушки — только между подлокотниками.
function drawSofaGlyph(ctx, x, y, w, h, arm, back, cushions, r) {
  const seatX = x + arm;
  const seatW = w - arm * 2;
  ctx.fillRect(seatX, y, seatW, h);
  ctx.beginPath();
  ctx.moveTo(seatX, y); ctx.lineTo(seatX + seatW, y); // задняя кромка спинки
  ctx.moveTo(seatX, y + back); ctx.lineTo(seatX + seatW, y + back); // спинка | сиденье
  ctx.moveTo(seatX, y + h); ctx.lineTo(seatX + seatW, y + h); // передняя кромка
  for (let i = 1; i < cushions; i += 1) {
    const cx = seatX + (seatW / cushions) * i;
    ctx.moveTo(cx, y + back); ctx.lineTo(cx, y + h);
  }
  ctx.stroke();
  ctx.beginPath(); cornerRectPath(ctx, x, y, arm, h, [r, 0, 0, r]); ctx.fill(); ctx.stroke();
  ctx.beginPath(); cornerRectPath(ctx, x + w - arm, y, arm, h, [0, r, r, 0]); ctx.fill(); ctx.stroke();
}

// Приведение новых видов к базовым глифам (внешний вид сверху).
const GLYPH_ALIAS = {
  'sofa-2': 'sofa', loveseat: 'sofa',
  'armchair-lounge': 'armchair', 'bed-bunk': 'bed-single',
  crib: 'bed-single', 'dining-table-6': 'dining-table',
  'desk-corner': 'desk', 'console-table': 'tv-stand', 'chair-soft': 'chair',
  'office-chair': 'armchair', stool: 'nightstand', 'bar-stool': 'nightstand',
  'wardrobe-sliding': 'wardrobe', 'wardrobe-corner': 'wardrobe', sideboard: 'dresser',
  'kitchen-island': 'table', 'cooktop-hood': 'stove', 'bar-counter': 'tv-stand',
  'bath-corner': 'bath', bidet: 'toilet', 'toilet-smart': 'toilet', 'vanity-unit': 'washbasin',
  'fridge-side': 'fridge', dryer: 'washer', dishwasher: 'washer', boiler: 'fridge',
  'coffee-table-2': 'coffee-table', 'car-suv': 'car', 'garden-lounger': 'bench',
  treadmill: 'workbench', sofa: 'sofa',
  // Дополнительный каталог → базовые обозначения.
  daybed: 'bench', recliner: 'armchair', 'bean-bag': 'pouf', 'sofa-bed': 'sofa',
  'desk-l': 'desk', 'bar-table': 'table-round',
  'folding-chair': 'chair', 'gaming-chair': 'armchair', 'shelf-open': 'bookcase',
  'display-cabinet': 'wardrobe', chest: 'dresser', oven: 'stove', 'kitchen-corner': 'kitchen-row', 'kitchen-u': 'kitchen-row',
  pantry: 'fridge', 'washbasin-double': 'sink', jacuzzi: 'bath', urinal: 'toilet',
  hood: 'tv-stand', 'ac-unit': 'tv', chandelier: 'floor-lamp', curtain: 'tv',
  'rug-round': 'table-round', 'office-desk': 'desk', 'conference-table': 'dining-table',
  'filing-cabinet': 'dresser', safe: 'washer', printer: 'tv-stand',
  'kids-bed': 'bed-single', 'changing-table': 'dresser', 'toy-box': 'chest', 'kids-desk': 'desk',
  'exercise-bike': 'motorcycle', 'weight-bench': 'bench', 'yoga-mat': 'rug',
  'ping-pong': 'dining-table', 'umbrella-stand': 'column', bicycle: 'motorcycle',
  trampoline: 'pool', 'hot-tub': 'bbq', gazebo: 'pool', sandbox: 'rug',
  microwave: 'tv-stand',
};

// Условные обозначения мебели (вид сверху), центр в (0,0), размеры w×h мм.
// Параметрические top-view символы мебели в духе ArchiCAD: чистые контуры,
// скруглённые углы, аккуратные детали. Всё рисуется из размеров w×h, поэтому
// масштабируется без искажений. Центр в (0,0).
function drawGlyph(ctx, kindRaw, w, h, options = null) {
  const kind = GLYPH_ALIAS[kindRaw] || kindRaw;
  const x = -w / 2;
  const y = -h / 2;
  const mn = Math.min(w, h);
  const rrFill = (rx, ry, rw, rh, r) => { ctx.beginPath(); roundRectPath(ctx, rx, ry, rw, rh, r); ctx.fill(); ctx.stroke(); };
  const rrStroke = (rx, ry, rw, rh, r) => { ctx.beginPath(); roundRectPath(ctx, rx, ry, rw, rh, r); ctx.stroke(); };
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const circle = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); };
  const ellipse = (cx, cy, rxr, ryr) => { ctx.beginPath(); ctx.ellipse(cx, cy, rxr, ryr, 0, 0, Math.PI * 2); ctx.stroke(); };
  const body = Math.min(90, mn * 0.08); // базовый радиус скругления

  switch (kind) {
    case 'bed-double':
    case 'bed-king':
    case 'bed-queen':
    case 'bed-single': {
      const d = bedDesign(kindRaw) || bedDesign(kind) || { w, h, mattressW: w * 0.82, mattressH: h * 0.86 };
      const sx = w / d.w;
      const sy = h / d.h;
      const mattressW = d.mattressW * sx;
      const mattressH = d.mattressH * sy;
      const head = Math.max(120, (d.h - d.mattressH) * 0.6) * sy;
      const mx = -mattressW / 2;
      const my = y + head;
      rrFill(x, y, w, h, body * 1.3); // мягкая рама
      // Широкое мягкое изголовье читается отдельно от матраса.
      rrFill(x, y, w, head, Math.min(body * 1.5, head * 0.35));
      rrStroke(mx, my, mattressW, mattressH, body * 0.55);
      const twin = d.mattressW <= 1000;
      const gap = Math.max(35, mattressW * 0.025);
      const pw = twin ? mattressW - gap * 2 : (mattressW - gap * 3) / 2;
      const ph = Math.min(400 * sy, mattressH * 0.2);
      rrStroke(mx + gap, my + gap, pw, ph, ph * 0.3);
      if (!twin) rrStroke(mx + gap * 2 + pw, my + gap, pw, ph, ph * 0.3);
      const duvetTop = my + ph + gap * 2;
      rrStroke(mx + gap, duvetTop, mattressW - gap * 2, my + mattressH - duvetTop - gap, body * 0.5);
      line(mx + gap, duvetTop + Math.min(220, mattressH * 0.12), mx + mattressW - gap, duvetTop + Math.min(220, mattressH * 0.12));
      break;
    }
    case 'nightstand': rrFill(x, y, w, h, body); rrStroke(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6, body * 0.5); break;
    case 'sofa':
    case 'bench-sofa': {
      const arm = Math.min(220, w * 0.14);
      const back = Math.min(260, h * 0.3);
      const cushions = Math.max(1, Math.round((w - arm * 2) / 900));
      drawSofaGlyph(ctx, x, y, w, h, arm, back, cushions, body * 1.4);
      break;
    }
    case 'sofa-corner': {
      // Г-образный: один общий контур (без наложения двух прямоугольников),
      // спинка вдоль верха и левого края, подлокотники на концах, угловой
      // модуль и подушки — внутренними линиями, которые не пересекаются.
      const seat = Math.min(950, h * 0.56);
      const wing = Math.min(950, w * 0.36);
      const bk = Math.min(220, seat * 0.3, wing * 0.3);
      const arm = Math.min(200, w * 0.08, h * 0.08);
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + seat);
      ctx.lineTo(x + wing, y + seat); ctx.lineTo(x + wing, y + h); ctx.lineTo(x, y + h);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w - arm, y); ctx.lineTo(x + w - arm, y + seat); // правый подлокотник
      ctx.moveTo(x, y + h - arm); ctx.lineTo(x + wing, y + h - arm); // нижний подлокотник
      ctx.moveTo(x + w - arm, y + bk); ctx.lineTo(x + bk, y + bk); ctx.lineTo(x + bk, y + h - arm); // спинка
      ctx.moveTo(x + wing, y + bk); ctx.lineTo(x + wing, y + seat); // угловой модуль
      ctx.moveTo(x + bk, y + seat); ctx.lineTo(x + wing, y + seat);
      const runW = (x + w - arm) - (x + wing);
      const nW = Math.max(1, Math.round(runW / 900));
      for (let i = 1; i < nW; i += 1) { const cx = x + wing + (runW / nW) * i; ctx.moveTo(cx, y + bk); ctx.lineTo(cx, y + seat); }
      const runH = (y + h - arm) - (y + seat);
      const nH = Math.max(1, Math.round(runH / 900));
      for (let i = 1; i < nH; i += 1) { const cy = y + seat + (runH / nH) * i; ctx.moveTo(x + bk, cy); ctx.lineTo(x + wing, cy); }
      ctx.stroke();
      break;
    }
    case 'sofa-u': {
      // П-образный (старый, без модулей): один контур, спинка сверху, слева и
      // справа; крылья вниз с подлокотниками на концах, угловые модули.
      const seat = Math.min(950, h * 0.42, w * 0.3); // глубина крыла и верха
      const bk = Math.min(220, seat * 0.3);
      const arm = Math.min(200, h * 0.08);
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w - seat, y + h); ctx.lineTo(x + w - seat, y + seat);
      ctx.lineTo(x + seat, y + seat); ctx.lineTo(x + seat, y + h); ctx.lineTo(x, y + h);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y + h - arm); ctx.lineTo(x + seat, y + h - arm); // подлокотники
      ctx.moveTo(x + w - seat, y + h - arm); ctx.lineTo(x + w, y + h - arm);
      ctx.moveTo(x + bk, y + h - arm); ctx.lineTo(x + bk, y + bk); // спинка
      ctx.lineTo(x + w - bk, y + bk); ctx.lineTo(x + w - bk, y + h - arm);
      ctx.moveTo(x + bk, y + seat); ctx.lineTo(x + seat, y + seat); // угловые модули
      ctx.moveTo(x + seat, y + bk); ctx.lineTo(x + seat, y + seat);
      ctx.moveTo(x + w - seat, y + bk); ctx.lineTo(x + w - seat, y + seat);
      ctx.moveTo(x + w - seat, y + seat); ctx.lineTo(x + w - bk, y + seat);
      const runW = w - seat * 2;
      const nW = Math.max(1, Math.round(runW / 900));
      for (let i = 1; i < nW; i += 1) { const cx = x + seat + (runW / nW) * i; ctx.moveTo(cx, y + bk); ctx.lineTo(cx, y + seat); }
      ctx.stroke();
      break;
    }
    case 'armchair': {
      const arm = Math.min(170, w * 0.2);
      const back = Math.min(220, h * 0.28);
      drawSofaGlyph(ctx, x, y, w, h, arm, back, 1, body * 1.4);
      break;
    }
    case 'pouf': ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
    case 'bench': rrFill(x, y, w, h, body); line(x + body, y + h * 0.32, x + w - body, y + h * 0.32); break;
    case 'chair': {
      // Спинка (сзади, −Y) и сиденье (лицом в +Y) стыкуются, не перекрываясь.
      const backH = h * 0.18;
      rrFill(x + w * 0.04, y, w * 0.92, backH, body * 0.5); // спинка
      rrFill(x + w * 0.1, y + backH, w * 0.8, h - backH, body); // сиденье
      break;
    }
    case 'dining-table':
    case 'table': {
      // Только столешница: стулья — части составного стола (core/composite.js).
      rrFill(x, y, w, h, body);
      break;
    }
    case 'table-round': { ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ellipse(0, 0, w * 0.32, h * 0.32); break; }
    case 'coffee-table': {
      const disks = [COFFEE_TABLE_DUO.large, COFFEE_TABLE_DUO.small];
      for (const [i, disk] of disks.entries()) {
        ctx.save();
        if (i === 1) ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.ellipse(disk.cx * w, disk.cy * h, disk.rx * w, disk.ry * h, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'side-table': {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ellipse(0, 0, w * 0.32, h * 0.32);
      break;
    }
    case 'desk': { rrFill(x, y, w, h, body); rrStroke(x + w * 0.62, y + h * 0.15, w * 0.33, h * 0.7, body * 0.4); break; } // столешница + тумба
    case 'wardrobe':
    case 'wardrobe-rack': {
      rrFill(x, y, w, h, body * 0.5);
      // Штанга + дуги плечиков (вид сверху).
      line(x + w * 0.08, y + h * 0.5, x + w * 0.92, y + h * 0.5);
      const doors = Math.max(1, Math.round(w / 600));
      for (let i = 1; i < doors; i += 1) line(x + (w / doors) * i, y, x + (w / doors) * i, y + h);
      break;
    }
    case 'dresser': { rrFill(x, y, w, h, body * 0.5); const n = Math.max(2, Math.round(w / 500)); for (let i = 1; i < n; i += 1) line(x + (w / n) * i, y, x + (w / n) * i, y + h); break; }
    case 'dressing-table': { rrFill(x, y, w, h, body * 0.5); ellipse(0, y + h * 0.42, w * 0.26, h * 0.3); break; }
    case 'tv-stand': { rrFill(x, y, w, h, body * 0.4); ctx.fillStyle = 'rgba(127,144,165,0.3)'; ctx.fillRect(x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.18); ctx.strokeRect(x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.18); break; }
    case 'bookcase': { rrFill(x, y, w, h, body * 0.3); const n = Math.max(2, Math.round(w / 500)); for (let i = 1; i < n; i += 1) line(x + (w / n) * i, y, x + (w / n) * i, y + h); break; }
    case 'kitchen-row': {
      rrFill(x, y, w, h, body * 0.3);
      line(x, y + h - Math.min(120, h * 0.2), x + w, y + h - Math.min(120, h * 0.2)); // передний край
      const n = Math.max(1, Math.round(w / 600));
      for (let i = 1; i < n; i += 1) line(x + (w / n) * i, y, x + (w / n) * i, y + h);
      break;
    }
    case 'stove': {
      rrFill(x, y, w, h, body * 0.4);
      const r = mn * 0.16;
      circle(-w * 0.22, -h * 0.22, r); circle(w * 0.22, -h * 0.22, r);
      circle(-w * 0.22, h * 0.22, r * 0.85); circle(w * 0.22, h * 0.22, r * 0.85);
      break;
    }
    case 'sink': {
      rrFill(x, y, w, h, body * 0.4);
      rrStroke(x + w * 0.12, y + h * 0.22, w * 0.76, h * 0.5, body * 0.5); // чаша
      circle(0, y + h * 0.12, 42); // смеситель
      break;
    }
    case 'fridge': { rrFill(x, y, w, h, body * 0.4); line(x, y + h * 0.5, x + w, y + h * 0.5); line(x + w * 0.1, y + h * 0.5 - 140, x + w * 0.1, y + h * 0.5 - 40); break; }
    case 'bath': {
      rrFill(x, y, w, h, Math.min(h, w) * 0.22);
      rrStroke(x + w * 0.08, y + h * 0.12, w * 0.76, h * 0.76, Math.min(h, w) * 0.2); // внутренняя чаша
      circle(x + w * 0.9, 0, 40); // слив/смеситель у торца
      break;
    }
    case 'shower': { rrFill(x, y, w, h, body * 0.4); line(x, y, x + w, y + h); line(x + w, y, x, y + h); circle(x + w * 0.2, y + h * 0.2, 60); break; }
    case 'toilet': {
      const tankH = Math.min(200, h * 0.26);
      rrFill(x + w * 0.1, y, w * 0.8, tankH, body * 0.4); // бачок
      ctx.beginPath(); ctx.ellipse(0, y + tankH + (h - tankH) / 2, w * 0.4, (h - tankH) / 2 - 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); // чаша
      break;
    }
    case 'toilet-wall': {
      const frameH = Math.min(180, h * 0.25);
      // Инсталляция показана отдельной задней рамой, чаша — подвесной эллипс.
      rrFill(x, y, w, frameH, body * 0.25);
      line(x + w * 0.2, y + frameH * 0.5, x + w * 0.8, y + frameH * 0.5);
      ctx.beginPath();
      ctx.ellipse(0, y + frameH + (h - frameH) * 0.47, w * 0.38, (h - frameH) * 0.43, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ellipse(0, y + frameH + (h - frameH) * 0.43, w * 0.25, (h - frameH) * 0.28);
      break;
    }
    case 'bidet': { ctx.beginPath(); ctx.ellipse(0, 0, w * 0.4, h * 0.44, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break; }
    case 'washbasin': { rrFill(x, y, w, h, body * 0.4); ellipse(0, h * 0.05, w * 0.34, h * 0.32); circle(0, y + h * 0.16, 36); break; }
    case 'washer': { rrFill(x, y, w, h, body * 0.4); circle(0, 0, mn * 0.32); circle(0, 0, mn * 0.2); break; }
    case 'coat-rack': { rrFill(x, y, w, h, body * 0.3); for (let cx = x + 180; cx < x + w; cx += 240) circle(cx, 0, 34); break; }
    case 'shoe-bench': { rrFill(x, y, w, h, body * 0.4); line(x, y + h * 0.5, x + w, y + h * 0.5); break; }
    case 'mirror':
    case 'tv': { rrFill(x, y, w, h, Math.min(30, h * 0.3)); ctx.fillStyle = 'rgba(127,144,165,0.35)'; ctx.fillRect(x + 40, y + Math.max(10, h * 0.2), w - 80, Math.max(20, h * 0.6)); break; }
    case 'plant': { circle(0, 0, mn * 0.46); circle(0, 0, mn * 0.22); break; }
    case 'floor-lamp': { circle(0, 0, mn * 0.46); circle(0, 0, mn * 0.12); break; }
    case 'rug': { ctx.setLineDash([180, 140]); rrStroke(x, y, w, h, body); ctx.setLineDash([]); rrStroke(x + w * 0.08, y + h * 0.1, w * 0.84, h * 0.8, body * 0.6); break; }
    case 'piano': { rrFill(x, y, w, h, body * 0.4); ctx.strokeRect(x, y, w, h * 0.42); for (let kx = x + 120; kx < x + w; kx += 120) line(kx, y, kx, y + h * 0.42); break; }
    case 'fireplace': { rrFill(x, y, w, h, body * 0.3); rrStroke(x + w * 0.2, y + h * 0.28, w * 0.6, h * 0.55, body * 0.4); break; }
    case 'aquarium': { rrFill(x, y, w, h, body * 0.4); circle(-w * 0.15, 0, 44); circle(w * 0.18, h * 0.12, 34); break; }
    case 'pool': { rrFill(x, y, w, h, mn * 0.25); rrStroke(x + w * 0.06, y + h * 0.08, w * 0.88, h * 0.84, mn * 0.2); break; }
    case 'car':
    case 'car-suv': {
      rrFill(x + w * 0.05, y, w * 0.9, h, Math.min(w * 0.4, h * 0.14));
      rrStroke(x + w * 0.16, y + h * 0.1, w * 0.68, h * 0.22, body); // лобовое
      rrStroke(x + w * 0.16, y + h * 0.68, w * 0.68, h * 0.2, body); // заднее
      break;
    }
    case 'motorcycle': { ellipse(0, -h * 0.3, w * 0.28, h * 0.12); ellipse(0, h * 0.3, w * 0.3, h * 0.14); line(0, -h * 0.3, 0, h * 0.3); break; }
    case 'workbench': { rrFill(x, y, w, h, body * 0.3); line(x, y + h * 0.3, x + w, y + h * 0.3); break; }
    case 'garden-set': { ellipse(0, 0, mn * 0.24, mn * 0.24); circle(-w * 0.3, 0, mn * 0.13); circle(w * 0.3, 0, mn * 0.13); circle(0, -h * 0.3, mn * 0.13); circle(0, h * 0.3, mn * 0.13); break; }
    case 'bbq': { circle(0, 0, mn * 0.42); circle(0, 0, mn * 0.24); break; }
    case 'column': { circle(0, 0, mn / 2); ctx.fill(); break; }
    case 'stairs': {
      // Марши, площадки, линии проступей и стрелка подъёма — по раскладке
      // core/stairs.js (та же, что у 3D и ручек).
      const lay = stairLayout({ ...options, w, h });
      for (const l of lay.landings) rrFill(l.x, l.y, l.w, l.h, 0);
      for (const f of lay.flights) {
        rrFill(f.x, f.y, f.w, f.h, 0);
        for (let i = 1; i < f.n; i += 1) {
          const t = i / f.n;
          if (f.dir.x === 0) line(f.x, f.y + f.h * t, f.x + f.w, f.y + f.h * t);
          else line(f.x + f.w * t, f.y, f.x + f.w * t, f.y + f.h);
        }
      }
      const path = stairPath(lay);
      const first = lay.flights[0];
      const last = lay.flights[lay.flights.length - 1];
      const lenFirst = Math.abs(first.dir.x ? first.w : first.h);
      const lenLast = Math.abs(last.dir.x ? last.w : last.h);
      const s0 = Math.min(120, lenFirst * 0.2);
      const s1 = Math.min(160, lenLast * 0.25);
      path[0] = { x: path[0].x + first.dir.x * s0, y: path[0].y + first.dir.y * s0 };
      const endP = path[path.length - 1];
      path[path.length - 1] = { x: endP.x - last.dir.x * s1, y: endP.y - last.dir.y * s1 };
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      const tip = path[path.length - 1];
      const back = Math.min(160, lenLast * 0.25);
      const side = Math.min(last.dir.x ? last.h : last.w, 1000) * 0.16;
      const bx = tip.x - last.dir.x * back;
      const by = tip.y - last.dir.y * back;
      line(tip.x, tip.y, bx - last.dir.y * side, by + last.dir.x * side);
      line(tip.x, tip.y, bx + last.dir.y * side, by - last.dir.x * side);
      break;
    }
    default: { rrFill(x, y, w, h, Math.min(60, mn * 0.12)); }
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Подпись комнаты (имя, площадь, инсоляция фасада) в свободной части:
// точку выбирает core/label-anchor.js по рамке подписи, пересчитанной в мм.
// Экранная рамка подписи сохраняется в state._labelBoxes — от неё отходят
// размер выбранной стены и кнопки двери.
function drawRoomLabel(ctx, state, room, w2s, tokens, obstacles = [], text = { font: 13 }, print = false) {
  const shaft = isShaft(room);
  const area = shaft ? roomShapeArea(room) / 1_000_000 : roomNetAreaM2(state.project, room);
  const ins = !shaft && state.project.site?.sun?.enabled ? state.norms?.insolation.rooms.find((r) => r.id === room.id) : null;
  const showIns = Boolean(ins && (ins.living || ins.windows));
  const k = text.font / 13;
  const fontOf = (weight, size) => `${weight}${(size * k).toFixed(1)}px system-ui, sans-serif`;
  const areaText = `${area.toFixed(1)} м²`;
  // Это старый нормативный расчёт по окнам фасада, а не новая
  // карта прямого солнца внутри. Подпись на плане делает разницу явной.
  const insText = showIns ? `Фасад · ${ins.windows ? formatDuration(ins.longest) : 'нет окон'}` : '';
  ctx.font = fontOf('600 ', 13);
  let tw = ctx.measureText(room.name).width;
  if (!shaft) { ctx.font = fontOf('', 12); tw = Math.max(tw, ctx.measureText(areaText).width); }
  if (showIns) { ctx.font = fontOf('600 ', 11); tw = Math.max(tw, ctx.measureText(insText).width); }
  const bw = tw + 8 * k;
  const bh = (shaft ? 18 : (showIns ? 50 : 34)) * k;
  // Рамка подписи в мм в осях дома (с учётом поворота вида).
  const o = w2s(0, 0); const ex = w2s(1000, 0);
  const pxPerMm = Math.hypot(ex.x - o.x, ex.y - o.y) / 1000 || 1;
  const ang = Math.atan2(ex.y - o.y, ex.x - o.x);
  const c = Math.abs(Math.cos(ang)); const s = Math.abs(Math.sin(ang));
  const wMm = bw / pxPerMm; const hMm = bh / pxPerMm;
  const labelW = wMm * c + hMm * s;
  const labelH = wMm * s + hMm * c;
  // При отдалении подпись, которая заметно больше комнаты, не рисуется.
  if (!print && k < 1) {
    const rb = roomRects(room).reduce((acc, r) => ({ w: Math.max(acc.w, r.w), h: Math.max(acc.h, r.h) }), { w: 0, h: 0 });
    if (labelW > rb.w * 1.5 || labelH > rb.h * 1.5) return;
  }
  const anchor = roomLabelAnchor(room, obstacles, { labelW, labelH });
  const center = w2s(anchor.x, anchor.y);
  state._labelBoxes?.push({ x: center.x - bw / 2, y: center.y - bh / 2, w: bw, h: bh, roomId: room.id });
  const lift = showIns ? 8 : 0;
  ctx.textAlign = 'center';
  ctx.fillStyle = tokens.text;
  ctx.font = fontOf('600 ', 13);
  ctx.fillText(room.name, center.x, center.y + (shaft ? 4 : -5 - lift) * k);
  if (shaft) return;
  ctx.fillStyle = tokens.muted;
  ctx.font = fontOf('', 12);
  ctx.fillText(areaText, center.x, center.y + (12 - lift) * k);
  // Инсоляция фасада (при включённом солнце): зелёным — жилая в норме,
  // серым — помещение, для которого жилая норма не применяется.
  if (showIns) {
    ctx.fillStyle = ins.living ? (ins.meets ? tokens.ok : tokens.danger) : tokens.muted;
    ctx.font = fontOf('600 ', 11);
    ctx.fillText(insText, center.x, center.y + (28 - lift) * k);
  }
}

// Пересекается ли экранный прямоугольник с подписями комнат.
function hitsLabels(state, box, pad = 2) {
  return (state._labelBoxes || []).some((b) => box.x < b.x + b.w + pad && box.x + box.w > b.x - pad &&
    box.y < b.y + b.h + pad && box.y + box.h > b.y - pad);
}

// Подпись на подложке цвета поверхности — читается поверх плана и имён.
function drawTextPill(ctx, label, x, y, tokens, color, font = '11px system-ui, sans-serif') {
  ctx.font = font;
  ctx.textAlign = 'center';
  const tw = ctx.measureText(label).width + 10;
  ctx.fillStyle = tokens.surface;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  roundRectPath(ctx, x - tw / 2, y - 12, tw, 16, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
}

// Янтарная метка «≠ N мм» у середины нестандартного зазора. Возвращает
// экранную рамку для попадания кликом.
function drawGapMarker(ctx, gap, p, tokens, focused) {
  const label = `≠ ${Math.round(gap.gap)} мм`;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(label).width + 12;
  const box = { key: gap.key, x: p.x - w / 2, y: p.y - 9, w, h: 18 };
  ctx.fillStyle = tokens.warnBg;
  ctx.strokeStyle = tokens.warn;
  ctx.lineWidth = focused ? 2 : 1;
  ctx.beginPath();
  roundRectPath(ctx, box.x, box.y, box.w, box.h, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tokens.warn;
  ctx.fillText(label, p.x, p.y + 4);
  return box;
}

// Размерные линии всех комнат: внутренние размеры внутри комнаты, габарит со
// стенами — снаружи. Невыбранные комнаты рисуются полупрозрачно.
// Подпись размера: миллиметры (5000) или метры (5,00) — настройка проекта.
function dimLabel(state, len) {
  return state.project.settings?.units === 'm' ? (len / 1000).toFixed(2).replace('.', ',') : String(len);
}

function drawAllRoomDims(ctx, state, walls, w2s, tokens, visibleRooms = state.project.rooms) {
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const selId = state.selection?.type === 'room' ? state.selection.id : null;
  const outwardScreen = (cx, cy, ox, oy) => {
    const s1 = w2s(cx, cy);
    const s2 = w2s(cx + ox * 100, cy + oy * 100);
    const len = Math.hypot(s2.x - s1.x, s2.y - s1.y) || 1;
    return { x: (s2.x - s1.x) / len, y: (s2.y - s1.y) / len };
  };

  // Внутренние размеры по реальному контуру комнаты. Для прямоугольной —
  // ширина (сверху) и глубина (слева); для Г/Т-образной — каждая грань со
  // своей длиной. Показываются у всех комнат (бледно), у выбранной — ярко.
  for (const room of visibleRooms) {
    const selected = room.id === selId;
    const { rectangular, edges } = computeRoomEdges(state.project, room);
    ctx.strokeStyle = selected ? tokens.accent : tokens.muted;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.globalAlpha = selected ? 1 : 0.42;
    const off = 120; // отступ размерной линии внутрь комнаты (ближе к стене), мм

    const drawEdge = (edge) => {
      const horiz = edge.orient === 'h';
      const len = Math.round(edge.to - edge.from);
      if (len < 400) return;
      const perp = edge.at + edge.inSide * off;
      const p = horiz ? w2s(edge.from, perp) : w2s(perp, edge.from);
      const q = horiz ? w2s(edge.to, perp) : w2s(perp, edge.to);
      const screenLen = Math.hypot(q.x - p.x, q.y - p.y);
      if (screenLen < (selected ? 26 : 52)) return;
      const mid = (edge.from + edge.to) / 2;
      const n = horiz
        ? outwardScreen(mid, edge.at, 0, edge.inSide)
        : outwardScreen(edge.at, mid, edge.inSide, 0);
      drawDim(ctx, p, q, n, 13, dimLabel(state, len));
    };

    if (rectangular) {
      // Минимум: верхняя (ширина) и левая (глубина) грани.
      const top = edges.find((e) => e.orient === 'h' && Math.abs(e.at - room.y) < 1);
      const left = edges.find((e) => e.orient === 'v' && Math.abs(e.at - room.x) < 1);
      if (top) drawEdge(top);
      if (left) drawEdge(left);
    } else {
      for (const edge of edges) drawEdge(edge);
    }
    ctx.globalAlpha = 1;
  }

  // Наружные размеры ломаных помещений — общей логикой ниже (контур дома по их реальной форме).
  const exterior = state.project.settings?.exterior || 250;

  // Наружные размеры — только для ДЕЙСТВИТЕЛЬНО внешних сторон дома.
  // Ближний пояс разбивает фасад по окнам, дверям и осям примыкающих
  // перегородок; дальний пояс показывает общий габарит.
  const dimOuter = state.project.settings?.dimOuter !== false; // по умолчанию — снаружи
  const expand = dimOuter ? exterior : exterior / 2;
  const outline = computeBuildingOutline(state.project, expand, walls);
  // Реальная форма комнат (Г, ступени, контур), а не габарит: иначе вырез считается занятым.
  const rects = state.project.rooms.filter((r) => !r.parentId && !isOpenRoom(r))
    .flatMap((r) => roomRects(r).map((rc) => ({ x: rc.x - expand, y: rc.y - expand, w: rc.w + 2 * expand, h: rc.h + 2 * expand })));
  if (outline.length && rects.length) {
    const detailOff = 450;
    const outOff = 850;
    const bb = {
      minX: Math.min(...rects.map((r) => r.x)),
      maxX: Math.max(...rects.map((r) => r.x + r.w)),
      minY: Math.min(...rects.map((r) => r.y)),
      maxY: Math.max(...rects.map((r) => r.y + r.h)),
    };
    const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1) > 1;
    ctx.strokeStyle = tokens.line;
    ctx.fillStyle = tokens.line;
    ctx.globalAlpha = 0.75;
    for (const edge of outline) {
      const horiz = edge.orient === 'h';
      const len = Math.round(edge.to - edge.from);
      if (len < 400) continue;
      // Направление наружу и проверка, что за ребром нет здания (внешняя сторона).
      let external;
      let chainPerp;
      let dir;
      if (horiz && edge.inSide === 1) { // верхняя сторона (наружу вверх)
        external = !rects.some((r) => overlap(r.x, r.x + r.w, edge.from, edge.to) && r.y < edge.at - 1);
        chainPerp = bb.minY - outOff; dir = { x: 0, y: -1 };
      } else if (horiz && edge.inSide === -1) { // нижняя
        external = !rects.some((r) => overlap(r.x, r.x + r.w, edge.from, edge.to) && r.y + r.h > edge.at + 1);
        chainPerp = bb.maxY + outOff; dir = { x: 0, y: 1 };
      } else if (!horiz && edge.inSide === 1) { // левая
        external = !rects.some((r) => overlap(r.y, r.y + r.h, edge.from, edge.to) && r.x < edge.at - 1);
        chainPerp = bb.minX - outOff; dir = { x: -1, y: 0 };
      } else { // правая
        external = !rects.some((r) => overlap(r.y, r.y + r.h, edge.from, edge.to) && r.x + r.w > edge.at + 1);
        chainPerp = bb.maxX + outOff; dir = { x: 1, y: 0 };
      }
      if (!external) continue;

      // Второй, ближний к фасаду пояс: косяки наружных проёмов и оси
      // внутренних стен. Если фасад не разбит ни одним элементом, не
      // дублируем на нём общий габарит.
      const stations = facadeDimensionStations(state.project, walls, edge, expand);
      if (stations.length > 2) {
        const detailPerp = edge.at + (horiz ? dir.y : dir.x) * detailOff;
        const detailN = horiz
          ? outwardScreen((edge.from + edge.to) / 2, detailPerp, 0, dir.y)
          : outwardScreen(detailPerp, (edge.from + edge.to) / 2, dir.x, 0);
        for (const station of stations) {
          const fromWall = horiz ? w2s(station, edge.at) : w2s(edge.at, station);
          const onChain = horiz ? w2s(station, detailPerp) : w2s(detailPerp, station);
          drawWitness(ctx, fromWall, {
            x: onChain.x + detailN.x * 16,
            y: onChain.y + detailN.y * 16,
          });
        }
        for (let i = 0; i < stations.length - 1; i += 1) {
          const from = stations[i];
          const to = stations[i + 1];
          const len = Math.round(to - from);
          if (len < 1) continue;
          const a = horiz ? w2s(from, detailPerp) : w2s(detailPerp, from);
          const b = horiz ? w2s(to, detailPerp) : w2s(detailPerp, to);
          const screenLen = Math.hypot(b.x - a.x, b.y - a.y);
          drawDim(ctx, a, b, detailN, 13, screenLen >= 28 ? dimLabel(state, len) : '');
        }
      }

      const p = horiz ? w2s(edge.from, chainPerp) : w2s(chainPerp, edge.from);
      const q = horiz ? w2s(edge.to, chainPerp) : w2s(chainPerp, edge.to);
      if (Math.hypot(q.x - p.x, q.y - p.y) < 40) continue;
      const mid = (edge.from + edge.to) / 2;
      const n = horiz ? outwardScreen(mid, chainPerp, 0, dir.y) : outwardScreen(chainPerp, mid, dir.x, 0);
      // Выноски от стены до самой размерной линии (учёт её выноса off=13,
      // плюс 3 px выхода за линию — как положено выносным линиям в CAD).
      const i1 = horiz ? w2s(edge.from, edge.at) : w2s(edge.at, edge.from);
      const i2 = horiz ? w2s(edge.to, edge.at) : w2s(edge.at, edge.to);
      const a1 = { x: p.x + n.x * 16, y: p.y + n.y * 16 };
      const b1 = { x: q.x + n.x * 16, y: q.y + n.y * 16 };
      drawWitness(ctx, i1, a1);
      drawWitness(ctx, i2, b1);
      drawDim(ctx, p, q, n, 13, dimLabel(state, len));
    }
    ctx.globalAlpha = 1;
  }
}

// Ручки на торцах проёма (на осевой линии стены).
export function openingHandles(project, opening, walls) {
  if (opening.corner) return cornerWindowHandles(project, opening, walls);
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

// Поворот вектора (dx,dy) на угол deg вокруг нуля.
export function rotateVec(dx, dy, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

// Четыре угла соседнего дома (мировые координаты, с учётом поворота).
export function neighborCorners(n) {
  const rot = n.rot || 0;
  const hw = n.w / 2;
  const hh = n.h / 2;
  const defs = [['nw', -hw, -hh], ['ne', hw, -hh], ['se', hw, hh], ['sw', -hw, hh]];
  return defs.map(([id, lx, ly]) => {
    const v = rotateVec(lx, ly, rot);
    return { id, x: n.x + v.x, y: n.y + v.y };
  });
}

// Точки круглых ручек вращения — вынесены наружу от каждого угла по диагонали.
export function neighborRotators(n, outPx, scale) {
  const out = outPx / scale;
  return neighborCorners(n).map((c) => {
    const dx = c.x - n.x;
    const dy = c.y - n.y;
    const len = Math.hypot(dx, dy) || 1;
    return { id: c.id, x: c.x + (dx / len) * out, y: c.y + (dy / len) * out };
  });
}

// Углы и ручки вращения для мебели (вращение в градусах).
export function itemCorners(item) {
  const rot = item.rotation || 0;
  const hw = item.w / 2;
  const hh = item.h / 2;
  const defs = [['nw', -hw, -hh], ['ne', hw, -hh], ['se', hw, hh], ['sw', -hw, hh]];
  return defs.map(([id, lx, ly]) => {
    const v = rotateVec(lx, ly, rot);
    return { id, x: item.x + v.x, y: item.y + v.y };
  });
}

export function itemRotators(item, outPx, scale) {
  const out = outPx / scale;
  return itemCorners(item).map((c) => {
    const dx = c.x - item.x;
    const dy = c.y - item.y;
    const len = Math.hypot(dx, dy) || 1;
    return { id: c.id, x: c.x + (dx / len) * out, y: c.y + (dy / len) * out };
  });
}

// Центр топосъёмки (мировые координаты).
export function underlayCenter(u) {
  return { x: u.x + (u.widthPx * u.mmPerPx) / 2, y: u.y + (u.heightPx * u.mmPerPx) / 2 };
}

// Четыре угла топосъёмки (мировые координаты) с учётом поворота — для масштаба.
export function underlayHandles(u) {
  const hw = (u.widthPx * u.mmPerPx) / 2;
  const hh = (u.heightPx * u.mmPerPx) / 2;
  const c = underlayCenter(u);
  const rot = u.rot || 0;
  const defs = [['nw', -hw, -hh], ['ne', hw, -hh], ['se', hw, hh], ['sw', -hw, hh]];
  return defs.map(([id, lx, ly]) => {
    const v = rotateVec(lx, ly, rot);
    return { id, x: c.x + v.x, y: c.y + v.y };
  });
}

// Точки круглых ручек вращения топосъёмки — вынесены наружу от углов.
export function underlayRotators(u, outPx, scale) {
  const c = underlayCenter(u);
  const out = outPx / scale;
  return underlayHandles(u).map((h) => {
    const dx = h.x - c.x;
    const dy = h.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return { id: h.id, x: h.x + (dx / len) * out, y: h.y + (dy / len) * out };
  });
}

// Рисует top-view глиф мебели в превью-канвас, вписывая w×h с отступом.
// Используется карточками библиотеки мебели.
function structuralPath(ctx, kind, w, h) {
  ctx.beginPath();
  if (isRoundItem(kind)) ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.rect(-w / 2, -h / 2, w, h);
}

export function drawGlyphPreview(canvas, kind, w, h, stroke, options = null) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const pad = 9;
  // Составной предмет (стол со стульями) — с частями по умолчанию.
  const comp = defaultComp(kind);
  const sample = { kind, x: 0, y: 0, w, h, rotation: 0, ...(comp ? { comp } : {}) };
  const box = comp ? compositeBounds(sample) : { x: -w / 2, y: -h / 2, w, h };
  const s = Math.min((W - pad * 2) / box.w, (H - pad * 2) / box.h);
  if (!(s > 0)) return;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(s, s);
  ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.1 / s; // с запасом под уменьшение карточкой
  ctx.strokeStyle = stroke || '#7f90a5';
  ctx.fillStyle = 'rgba(127,144,165,0.08)';
  if (isStructural(kind)) {
    ctx.fillStyle = stroke || '#7f90a5';
    structuralPath(ctx, kind, w, h);
    ctx.fill();
  } else {
    const whole = isFixedSizeComp(sample);
    drawParts(ctx, compositeParts(sample), sample, whole);
    if (!whole) drawGlyph(ctx, kind, w, h, options);
  }
  ctx.restore();
}

// Размерные линии до ближайших стен и стрелки-перевороты у выбранного проёма.
// Зоны клика сохраняются в state._openingUI для обработки в pointerdown.
function drawSelectedOpeningUI(ctx, state, opening, walls, w2s, scale, tokens) {
  if (opening.corner) return;
  const placed = openingRect(state.project, opening, walls);
  if (!placed) return;
  const { rect, wall } = placed;
  const room = state.project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return;
  const horiz = wall.orient === 'h';
  const centerAlong = horiz ? rect.x + rect.w / 2 : rect.y + rect.h / 2;
  const half = opening.width / 2;
  const leftGap = Math.round((centerAlong - half) - wall.from);
  const rightGap = Math.round(wall.to - (centerAlong + half));
  const roomPerp = horiz ? room.y + room.h / 2 : room.x + room.w / 2;
  const outward = Math.sign(wall.edge - roomPerp) || 1;
  const perpLine = wall.edge + outward * (wall.thickness + 450);
  const ui = { flips: [], dims: [] };

  const worldPt = (along, perp) => (horiz ? { x: along, y: perp } : { x: perp, y: along });
  // Размерная линия + подпись (кликабельная).
  const drawGap = (fromAlong, toAlong, label, kind) => {
    if (toAlong - fromAlong < 1) return;
    const a = w2s(...Object.values(worldPt(fromAlong, perpLine)));
    const b = w2s(...Object.values(worldPt(toAlong, perpLine)));
    const inner1 = w2s(...Object.values(worldPt(fromAlong, wall.edge)));
    const inner2 = w2s(...Object.values(worldPt(toAlong, wall.edge)));
    ctx.strokeStyle = tokens.accent;
    ctx.fillStyle = tokens.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    drawWitness(ctx, inner1, a); // выноски — бледнее
    drawWitness(ctx, inner2, b);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(`${label}`).width + 10;
    ctx.fillStyle = tokens.surface;
    ctx.fillRect(mx - tw / 2, my - 9, tw, 18);
    ctx.strokeStyle = tokens.accent;
    ctx.strokeRect(mx - tw / 2, my - 9, tw, 18);
    ctx.fillStyle = tokens.accent;
    ctx.fillText(`${label}`, mx, my + 4);
    ui.dims.push({ x: mx, y: my, kind, gap: label });
  };
  drawGap(wall.from, centerAlong - half, leftGap, 'left');
  drawGap(centerAlong + half, wall.to, rightGap, 'right');

  // Стрелки-перевороты (только у двери): перпендикулярная = куда открывается,
  // вдоль стены = сторона петель.
  if (opening.kind === 'door') {
    const cAlong = centerAlong;
    const cPerp = wall.edge;
    const flip = (along, perp, kind, dir) => {
      const p = w2s(...Object.values(worldPt(along, perp)));
      ctx.fillStyle = tokens.surface;
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Двойная стрелка.
      ctx.fillStyle = tokens.accent;
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(dir, p.x, p.y + 5);
      ui.flips.push({ x: p.x, y: p.y, kind });
    };
    // Куда открывается — кружок на стороне открывания, перпендикулярно стене.
    // У раздвижной и проёма без двери открывания нет — кнопки нет. Кружок
    // не садится на подпись комнаты: при наложении ищется другой отступ.
    const type = opening.type || 'single';
    if (type === 'single' || type === 'double') {
      let perp = wall.edge + outward * -(wall.thickness + 900);
      for (const d of [900, 600, 1200, 450, 1500]) {
        const at = wall.edge + outward * -(wall.thickness + d);
        const p = w2s(...Object.values(worldPt(cAlong, at)));
        if (!hitsLabels(state, { x: p.x - 13, y: p.y - 13, w: 26, h: 26 })) { perp = at; break; }
      }
      flip(cAlong, perp, 'swing', '⇅');
    }
    // Петли — вдоль стены за торцом проёма.
    flip(cAlong + (half + 650), cPerp, 'hinge', '⇆');
  }
  state._openingUI = ui;
}

// Размер от выбранной стены до противоположной внутренней грани помещения.
// У общей стены показываются оба помещения. Подписи кликабельны и используют
// тот же инлайн-ввод, что размеры дверей и окон.
function drawSelectedWallUI(ctx, state, wall, w2s, tokens) {
  const ui = { dims: [] };
  ctx.save();
  ctx.strokeStyle = tokens.accent;
  ctx.fillStyle = tokens.accent;
  ctx.lineWidth = 1.25;
  // Ручка ↕ — в центре стены; подпись размера на неё не ложится (иначе
  // нажатие на ручку открывало поле размера вместо сдвига стены).
  const gripAt = w2s((wall.center.x1 + wall.center.x2) / 2, (wall.center.y1 + wall.center.y2) / 2);
  const onGrip = (box) => box.x < gripAt.x + 16 && box.x + box.w > gripAt.x - 16 && box.y < gripAt.y + 16 && box.y + box.h > gripAt.y - 16;
  for (const dim of wallRoomDimensions(state.project, wall)) {
    const a = dim.orient === 'h' ? w2s(dim.along, dim.edge.edge) : w2s(dim.edge.edge, dim.along);
    const b = dim.orient === 'h' ? w2s(dim.along, dim.opposite.edge) : w2s(dim.opposite.edge, dim.along);
    // Линия не перечёркивает подписи комнат: их рамки вырезаются из клипа.
    ctx.save();
    if (state._labelBoxes?.length) {
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      for (const box of state._labelBoxes) ctx.rect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
      ctx.clip('evenodd');
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    const dx = b.x - a.x; const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len; const ny = dx / len;
    for (const point of [a, b]) {
      ctx.beginPath();
      ctx.moveTo(point.x - nx * 5, point.y - ny * 5);
      ctx.lineTo(point.x + nx * 5, point.y + ny * 5);
      ctx.stroke();
    }
    const label = String(Math.round(dim.distance));
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width + 12;
    // Подпись — в середине линии, а если там имя комнаты — ближе к концам.
    let mx = (a.x + b.x) / 2;
    let my = (a.y + b.y) / 2;
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const box = { x: x - tw / 2, y: y - 10, w: tw, h: 20 };
      if (!hitsLabels(state, box) && !onGrip(box)) { mx = x; my = y; break; }
    }
    ctx.fillStyle = tokens.surface;
    ctx.fillRect(mx - tw / 2, my - 10, tw, 20);
    ctx.strokeStyle = tokens.accent;
    ctx.strokeRect(mx - tw / 2, my - 10, tw, 20);
    ctx.fillStyle = tokens.accent;
    ctx.fillText(label, mx, my + 4);
    ui.dims.push({
      type: 'wall', x: mx, y: my, gap: dim.distance,
      wallKey: wall.key, wallFrom: wall.from, roomId: dim.roomId,
    });
  }

  const grip = gripAt;
  ctx.fillStyle = tokens.surface;
  ctx.strokeStyle = tokens.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(grip.x, grip.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = tokens.accent;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(wall.orient === 'h' ? '↕' : '↔', grip.x, grip.y + 5);
  ui.grip = { x: grip.x, y: grip.y, r: 14 };
  state._wallUI = ui;
  ctx.restore();
}

// Ручная стена выбрана: ось пунктиром, круглые ручки на торцах (тянуть —
// длина) и подпись длины по оси.
function drawManualWallAxis(ctx, state, wall, w2s, tokens) {
  const own = (state.project.walls || []).find((w) => w.id === wall.wallId);
  if (!own) return;
  const a = w2s(own.axis.a.x, own.axis.a.y);
  const b = w2s(own.axis.b.x, own.axis.b.y);
  ctx.save();
  ctx.strokeStyle = tokens.accent;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [a, b]) {
    ctx.fillStyle = tokens.surface;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// Петля стен: заливка (alpha) и пунктир контура; дыры — вырезаны.
function drawLoopShape(ctx, shape, color, px, alpha) {
  const path = (pts) => {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  };
  ctx.save();
  ctx.beginPath();
  path(shape.poly);
  for (const h of shape.holes || []) path(h);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = px(1.5);
  ctx.setLineDash([px(6), px(4)]);
  ctx.stroke();
  ctx.restore();
}

function drawWallToolPreview(ctx, tool, tokens, px) {
  const c = tool.cursor;
  ctx.save();
  ctx.strokeStyle = tokens.accent2;
  ctx.lineWidth = px(1);
  ctx.setLineDash([px(4), px(4)]);
  ctx.setLineDash([]);
  if (tool.start) {
    const a = tool.start;
    const t = tool.thickness || 100;
    const dx = c.x - a.x; const dy = c.y - a.y;
    const len0 = Math.hypot(dx, dy) || 1;
    const n = { x: (dy / len0) * (t / 2), y: (-dx / len0) * (t / 2) };
    const poly = [
      { x: a.x - n.x, y: a.y - n.y }, { x: c.x - n.x, y: c.y - n.y },
      { x: c.x + n.x, y: c.y + n.y }, { x: a.x + n.x, y: a.y + n.y },
    ];
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = tool.valid === false ? tokens.danger : tokens.accent;
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = tool.valid === false ? tokens.danger : tokens.accent;
    ctx.lineWidth = px(1.5);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    // Длина по оси — у середины.
    const len = Math.round(Math.hypot(c.x - a.x, c.y - a.y));
    if (len > 0) {
      ctx.save();
      ctx.translate((a.x + c.x) / 2, (a.y + c.y) / 2);
      const k = px(1);
      ctx.scale(k, k);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = tokens.accent;
      ctx.fillText(`${len}`, 0, -10);
      ctx.restore();
    }
  }
  ctx.fillStyle = tokens.accent;
  ctx.beginPath(); ctx.arc(c.x, c.y, px(4), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Деление стены: линия деления поперёк стены и размерные линии от каждого
// торца до неё (мм) — снаружи помещения. Линия идёт за курсором (ui/split-input.js).
function drawWallSplitPreview(ctx, wall, edit, w2s, tokens) {
  const lo = Math.min(wall.from, wall.to); const hi = Math.max(wall.from, wall.to);
  const at = Math.max(lo, Math.min(hi, edit.along));
  const perp = wall.orient === 'h' ? (wall.center.y1 + wall.center.y2) / 2 : (wall.center.x1 + wall.center.x2) / 2;
  const pt = (along, off = 0) => (wall.orient === 'h' ? w2s(along, perp + off) : w2s(perp + off, along));
  const out = wall.outward || 1;
  const s0 = pt(at); const s1 = pt(at, out * 1000);
  const len = Math.hypot(s1.x - s0.x, s1.y - s0.y) || 1;
  const ux = (s1.x - s0.x) / len; const uy = (s1.y - s0.y) / len;
  const D = 34;
  const dimPt = (along) => { const s = pt(along); return { x: s.x + ux * D, y: s.y + uy * D }; };
  const half = Math.max(wall.thickness || 0, 200) / 2;
  const color = tokens.accent;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
  // Линия деления: через всю толщину стены и до размерной линии.
  const cutA = pt(at, -out * half * 1.6);
  ctx.setLineDash([7, 4]);
  ctx.beginPath(); ctx.moveTo(cutA.x, cutA.y); ctx.lineTo(s0.x + ux * (D + 10), s0.y + uy * (D + 10)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [a, b] of [[lo, at], [at, hi]]) {
    const A = dimPt(a); const B = dimPt(b);
    const dx = B.x - A.x; const dy = B.y - A.y; const dl = Math.hypot(dx, dy) || 1;
    const nx = -dy / dl; const ny = dx / dl; // поперёк размерной линии
    // выносные линии от торцов (у линии деления её роль играет сама линия)
    for (const [along, P] of [[a, A], [b, B]]) {
      if (along === at) continue;
      const s = pt(along);
      ctx.beginPath(); ctx.moveTo(s.x + ux * 4, s.y + uy * 4); ctx.lineTo(P.x + ux * 6, P.y + uy * 6); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    for (const P of [A, B]) { ctx.beginPath(); ctx.moveTo(P.x - nx * 6 - ux * 0, P.y - ny * 6); ctx.lineTo(P.x + nx * 6, P.y + ny * 6); ctx.stroke(); }
    const text = String(Math.round(b - a));
    const mx = (A.x + B.x) / 2; const my = (A.y + B.y) / 2;
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = tokens.surface;
    ctx.fillRect(mx - w / 2, my - 9, w, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, mx, my);
  }
  ctx.fillStyle = tokens.surface;
  ctx.beginPath(); ctx.arc(s0.x, s0.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(s0.x, s0.y, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Ручки ландшафта (core/landscape-handles.js): режим, рамка, угол жеста.
function lsHandleOverlay(state, objects, print) {
  if (print || state.tool) return null;
  const info = lsHandleInfo(objects, state.selection, state.itemHandle, state.view.rotation);
  return info ? { mode: info.mode, frame: info.frame, deg: state.lsHandleDeg ?? null } : null;
}

// Рамка группы мебели в осях дома (box — описывающий прямоугольник),
// подпись «N предм. · W × H мм» и ручки текущего режима.
function drawGroupFrame(ctx, state, box, groupId, p2s, tokens, scale) {
  const sc = groupCorners(box).map((c) => p2s(c.x, c.y));
  ctx.strokeStyle = tokens.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  sc.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  ctx.stroke();
  const mode = itemHandleMode(state.itemHandle, groupId);
  const deg = state.groupRotateDeg;
  const label = `${state.selection.itemIds.length} предм. · ${Math.round(box.w)} × ${Math.round(box.h)} мм`
    + (mode === 'rotate' && deg != null ? ` · ${Math.round(deg)}°` : '');
  const topY = Math.min(...sc.map((p) => p.y));
  const midX = sc.reduce((sum, p) => sum + p.x, 0) / sc.length;
  drawTextPill(ctx, label, midX, topY - 12, tokens, tokens.accent);
  if (state.modeName === 'plan' && mode !== 'rotate') {
    const labelWidth = ctx.measureText(label).width + 10;
    drawTempDims(ctx, state, groupItems(state.project, state.selection), p2s, tokens,
      { x: midX - labelWidth / 2, y: topY - 24, w: labelWidth, h: 16 });
  }
  if (mode === 'rotate') {
    for (const r of groupRotators(box, 20, scale)) {
      const p = p2s(r.x, r.y);
      ctx.fillStyle = tokens.surface;
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_SIZE / 2 - 1.5, -0.6, Math.PI * 1.2); ctx.stroke();
    }
  } else if (mode === 'stretch') {
    for (const e of groupEdgeHandles(box)) drawHandleSquare(ctx, p2s(e.x, e.y), tokens);
  } else if (mode === 'scale') {
    for (const c of sc) drawHandleSquare(ctx, c, tokens);
  }
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

// Угол подписи вдоль размерной линии. Текст всегда остаётся читаемым снизу
// или справа листа: вертикальные размеры идут снизу вверх, как в Revit.
export function dimTextAngle(p, q) {
  let angle = Math.atan2(q.y - p.y, q.x - p.x);
  if (angle >= Math.PI / 2 - 1e-9) angle -= Math.PI;
  if (angle < -Math.PI / 2 - 1e-9) angle += Math.PI;
  return angle;
}

function drawDim(ctx, p, q, n, off, label) {
  const a = { x: p.x + n.x * off, y: p.y + n.y * off };
  const b = { x: q.x + n.x * off, y: q.y + n.y * off };
  // Направление линии и диагональ 45° для архитектурной засечки.
  let ax = b.x - a.x;
  let ay = b.y - a.y;
  const alen = Math.hypot(ax, ay) || 1;
  ax /= alen; ay /= alen;
  const dx = (ax + n.x);
  const dy = (ay + n.y);
  const dl = Math.hypot(dx, dy) || 1;
  const s = 6; // длина засечки в экранных px
  const ux = (dx / dl) * s;
  const uy = (dy / dl) * s;
  // Небольшой выход линии за крайние засечки — чтобы линия всегда доходила
  // до концов и не оставляла зазора у засечки.
  const ex = ax * s;
  const ey = ay * s;
  ctx.beginPath();
  ctx.moveTo(a.x - ex, a.y - ey); ctx.lineTo(b.x + ex, b.y + ey); // линия с выходом за засечки
  ctx.moveTo(a.x - ux, a.y - uy); ctx.lineTo(a.x + ux, a.y + uy); // засечка слева
  ctx.moveTo(b.x - ux, b.y - uy); ctx.lineTo(b.x + ux, b.y + uy); // засечка справа
  ctx.stroke();
  const mid = { x: (a.x + b.x) / 2 + n.x * 10, y: (a.y + b.y) / 2 + n.y * 10 };
  if (label) {
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(dimTextAngle(a, b));
    ctx.fillText(label, 0, 3);
    ctx.restore();
  }
}

// Временные размеры выбранного предмета (core/temp-dims.js): линия с
// засечками от грани до цели и кликабельная подпись. Рамки подписей (экран)
// — в state._tempDimsUI для ui/temp-dims.js. avoid — рамка подписи габарита.
function drawTempDims(ctx, state, item, p2s, tokens, avoid) {
  const dims = tempDimensions(state.project, item);
  const ui = { ...(Array.isArray(item) ? { itemIds: item.map((member) => member.id) } : { itemId: item.id }), dims: [] };
  state._tempDimsUI = ui;
  if (!dims.length) return;
  const minHit = state.coarsePointer ? 36 : 20;
  const boxes = [avoid];
  const overlaps = (r) => boxes.some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const dim of dims) {
    const a = p2s(dim.from.x, dim.from.y);
    const b = p2s(dim.to.x, dim.to.y);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    // Засечки 45° на концах, как у обычных размеров.
    const tx = (ux - uy) * 4.5;
    const ty = (uy + ux) * 4.5;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const p of [a, b]) { ctx.moveTo(p.x - tx, p.y - ty); ctx.lineTo(p.x + tx, p.y + ty); }
    ctx.stroke();
    const label = String(Math.round(dim.value));
    const w = ctx.measureText(label).width + 10;
    const h = 18;
    // Подпись — в середине; короткая линия — подпись за целью.
    let cx = (a.x + b.x) / 2;
    let cy = (a.y + b.y) / 2;
    const along = Math.abs(ux) > 0.5 ? w : h;
    if (len < along + 12) { cx = b.x + ux * (along / 2 + 6); cy = b.y + uy * (along / 2 + 6); }
    const at = (shift) => ({ x: cx - uy * shift - w / 2, y: cy + ux * shift - h / 2, w, h });
    let box = at(0);
    // Не на подписи габарита, соседней подписи и имени комнаты — ближайший
    // свободный сдвиг вбок от линии (имя комнаты — только если иначе никак).
    const free = (r) => !overlaps(r) && !hitsLabels(state, r);
    if (!free(box)) {
      let found = null;
      for (let k = 1; k <= 14 && !found; k += 1) {
        for (const s of [k * 6, -k * 6]) if (!found && free(at(s))) found = at(s);
      }
      for (let k = 1; k <= 14 && !found && overlaps(box); k += 1) {
        for (const s of [k * 6, -k * 6]) if (!found && !overlaps(at(s))) found = at(s);
      }
      if (found) box = found;
    }
    boxes.push(box);
    ctx.fillStyle = tokens.surface;
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRectPath(ctx, box.x, box.y, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = tokens.accent;
    ctx.fillText(label, box.x + w / 2, box.y + h / 2 + 0.5);
    // Цель попадания — не меньше minHit (на телефоне ~36 px).
    const hw = Math.max(w, minHit);
    const hh = Math.max(h, minHit);
    ui.dims.push({
      dir: dim.dir, value: dim.value, x: box.x + w / 2, y: box.y + h / 2,
      box: { x: box.x + w / 2 - hw / 2, y: box.y + h / 2 - hh / 2, w: hw, h: hh },
    });
  }
  ctx.restore();
}

// Превью вставки: линии размеров от проёма до ближайшего препятствия
// (торец стены или соседний проём) слева и справа, снаружи помещения.
function drawOpeningGhostDims(ctx, state, opening, walls, w2s, tokens) {
  const g = openingGaps(state.project, opening, walls);
  if (!g) return;
  const { wall } = g;
  const horiz = wall.orient === 'h';
  const mid = horiz ? (wall.center.y1 + wall.center.y2) / 2 : (wall.center.x1 + wall.center.x2) / 2;
  const out = wall.outward || 1;
  const pt = (along, perp) => (horiz ? w2s(along, perp) : w2s(perp, along));
  const lineAt = mid + out * ((wall.thickness || 200) / 2 + 450);
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const [a, b] of [[g.left, g.from], [g.to, g.right]]) {
    if (b - a < 1) continue;
    const A = pt(a, lineAt); const B = pt(b, lineAt);
    ctx.strokeStyle = tokens.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    drawWitness(ctx, pt(a, mid), A);
    drawWitness(ctx, pt(b, mid), B);
    for (const P of [A, B]) {
      const t = horiz ? { x: 0, y: 5 } : { x: 5, y: 0 };
      ctx.beginPath(); ctx.moveTo(P.x - t.x, P.y - t.y); ctx.lineTo(P.x + t.x, P.y + t.y); ctx.stroke();
    }
    const label = String(Math.round(b - a));
    const mx = (A.x + B.x) / 2; const my = (A.y + B.y) / 2;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = tokens.surface; ctx.fillRect(mx - w / 2, my - 9, w, 18);
    ctx.strokeStyle = tokens.accent; ctx.strokeRect(mx - w / 2, my - 9, w, 18);
    ctx.fillStyle = tokens.accent; ctx.fillText(label, mx, my + 4);
  }
  ctx.restore();
}

// Выноска от стены к размерной линии — бледнее основной линии.
function drawWitness(ctx, a, b) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * 0.4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.globalAlpha = prev;
}

export const HANDLE_SIZE = 9;
export const SITE_INSERT_HANDLE_MIN_EDGE_PX = HANDLE_SIZE * 4;

// Ручки съеденной комнаты — на её НОМИНАЛЬНОЙ форме (core/v7/eat-bridge.js):
// жест правит номинал, видимая форма пересчитывается (срез 3 этапа 2).
export function roomHandles(visible) {
  const room = nominalShape(visible);
  const shapeHandles = roomShapeHandles(room);
  if (shapeHandles.length) return shapeHandles;
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
    if (handle.kind === 'edge') ctx.arc(p.x, p.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
    else ctx.rect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }
}

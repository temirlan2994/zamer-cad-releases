const canvas = document.getElementById("cadCanvas");
const ctx = canvas.getContext("2d");
const shell = document.querySelector(".app-shell");
const tools = [...document.querySelectorAll(".tool")];
const snaps = [...document.querySelectorAll(".snap")];
const blocks = [...document.querySelectorAll(".block")];
const lengthInput = document.getElementById("lengthInput");
const angleInput = document.getElementById("angleInput");
const inlineEditors = document.getElementById("inlineEditors");
const lengthEditor = document.getElementById("lengthEditor");
const angleEditor = document.getElementById("angleEditor");
const themeButton = document.getElementById("themeButton");
const statusChip = document.getElementById("statusChip");
const layersSheet = document.getElementById("layersSheet");
const exportSheet = document.getElementById("exportSheet");
const furnitureSheet = document.getElementById("furnitureSheet");
const layerList = document.getElementById("layerList");
const exportCards = [...document.querySelectorAll(".export-card")];
const furnitureTabs = [...document.querySelectorAll(".furniture-tab")];
const furnitureCatsNav = document.querySelector(".furniture-cats");
const furnitureSheetHandle = furnitureSheet.querySelector(".sheet-handle");
const symbolBasePath = "./assets/floor-symbols/";
const blockSymbolSources = {
  bed: "QueenBed.svg",
  table: "Table.svg",
  chair: "LoungeChair.svg",
  cabinet: "Cabinet.svg",
  tv: "TV.svg",
  door: "SingleDoor-NoWall.svg",
  window: "SlidingWindow.svg",
  sink: "Sink.svg",
  toilet: "Toilet.svg",
  tub: "Tub.svg",
  lamp: "Lamp.svg",
};
const couchSymbolSources = ["CouchLeft.svg", "CouchMiddle.svg", "CouchRight.svg"];
const couchSymbolImages = couchSymbolSources.map(loadSymbolImage);
const blockSymbolImages = Object.fromEntries(
  Object.entries(blockSymbolSources).map(([kind, source]) => [kind, loadSymbolImage(source)])
);
const furnitureCategoriesByTab = {
  furniture: [
    { id: "sofas", label: "Диваны" },
    { id: "beds", label: "Кровати" },
    { id: "tables", label: "Столы" },
    { id: "chairs", label: "Стулья" },
    { id: "storage", label: "Шкафы" },
    { id: "cabinets", label: "Тумбы" },
  ],
  doors: [{ id: "swing", label: "Распашные" }],
  windows: [{ id: "windows", label: "Окна" }],
  kitchen: [{ id: "kitchen", label: "Кухня" }],
  bath: [{ id: "bath", label: "Санузел" }],
  decor: [{ id: "decor", label: "Декор" }],
};
const keyboardInputs = [lengthInput, angleInput];
let stableViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 844);
const trackingHoverDelayMs = 520;
const trackingMaxPoints = 6;
const trackingAngles = [0, Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4];

const layerMeta = {
  walls: { name: "Стены", color: "#26313d", description: "основные стены и перегородки" },
  dimensions: { name: "Размеры", color: "#1f75ff", description: "подписи, выноски, площади" },
  furniture: { name: "Мебель", color: "#1db4a8", description: "блоки мебели, двери, окна" },
  measure: { name: "Черновые", color: "#9b6bff", description: "линии замера и наброски" },
};

const state = {
  theme: "light",
  tool: "select",
  block: "sofa",
  blockSize: { width: 2200, height: 950 },
  furnitureTab: "furniture",
  furnitureCategory: "sofas",
  view: {
    scale: 0.085,
    panX: 92,
    panY: 84,
  },
  drawing: null,
  pointer: null,
  activePointers: new Map(),
  pinch: null,
  gestureSuppressTap: false,
  inlineEdit: null,
  furnitureDrag: null,
  dimensionSnapHint: null,
  dimensionPickCycle: null,
  snapTracking: {
    points: [],
    hoverKey: null,
    hoverPoint: null,
    hoverTimer: null,
    active: null,
  },
  furnitureSheetPosition: "half",
  sheetDrag: null,
  suppressFurnitureClick: false,
  selectedId: "wall-3",
  furnitureEditId: null,
  undo: [],
  redo: [],
  snaps: new Set(["grid", "end", "polar"]),
  visibleLayers: new Set(["walls", "dimensions", "furniture", "measure"]),
  entities: [
    wall("wall-1", 0, 0, 5200, 0),
    wall("wall-2", 5200, 0, 5200, 3600),
    wall("wall-3", 5200, 3600, 2650, 3600),
    wall("wall-4", 2650, 3600, 2650, 6100),
    wall("wall-5", 2650, 6100, 0, 6100),
    wall("wall-6", 0, 6100, 0, 0),
    wall("wall-7", 2650, 0, 2650, 3600),
    wall("wall-8", 2650, 2450, 5200, 2450),
    line("line-1", 640, 910, 2100, 910, "dimensions"),
    line("line-2", 640, 910, 640, 1640, "dimensions"),
    block("sofa-1", "sofa", 3330, 2780, 0),
    block("table-1", "table", 1250, 4200, 12),
    block("door-1", "door", 2360, 3600, 90),
  ],
};

function wall(id, x1, y1, x2, y2) {
  return { id, type: "wall", layer: "walls", x1, y1, x2, y2, width: 180 };
}

function line(id, x1, y1, x2, y2, layer = "measure") {
  return { id, type: "line", layer, x1, y1, x2, y2 };
}

function block(id, kind, x, y, rotation = 0, size = defaultBlockSize(kind)) {
  return { id, type: "block", layer: "furniture", kind, x, y, rotation, scale: 1, width: size.width, height: size.height };
}

function loadSymbolImage(source) {
  const image = new Image();
  image.decoding = "async";
  image.onload = () => draw();
  image.src = `${symbolBasePath}${source}`;
  return image;
}

function defaultBlockSize(kind) {
  const size = {
    sofa: { width: 2200, height: 950 },
    sectional: { width: 2600, height: 1600 },
    bed: { width: 1800, height: 2000 },
    table: { width: 1400, height: 800 },
    chair: { width: 550, height: 550 },
    cabinet: { width: 1200, height: 550 },
    tv: { width: 1600, height: 420 },
    door: { width: 900, height: 900 },
    window: { width: 1800, height: 180 },
    sink: { width: 600, height: 500 },
    toilet: { width: 700, height: 450 },
    tub: { width: 1700, height: 750 },
    lamp: { width: 450, height: 450 },
  }[kind];
  return size || { width: 900, height: 900 };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function isKeyboardInputFocused() {
  return keyboardInputs.includes(document.activeElement);
}

function lockDocumentScroll() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function updateViewportLock() {
  const visualViewport = window.visualViewport;
  const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || stableViewportHeight);
  const layoutHeight = Math.round(window.innerHeight || viewportHeight);
  const inputFocused = isKeyboardInputFocused();
  const rawInset = visualViewport ? Math.max(0, layoutHeight - visualViewport.height - visualViewport.offsetTop) : 0;
  const heightLoss = Math.max(0, stableViewportHeight - viewportHeight);
  const detectedInset = Math.max(rawInset, heightLoss);
  const keyboardInset = inputFocused && detectedInset > 80 ? Math.min(detectedInset, Math.max(0, stableViewportHeight - 240)) : 0;

  if (!inputFocused || keyboardInset === 0) {
    stableViewportHeight = Math.max(stableViewportHeight, viewportHeight, layoutHeight);
  }

  document.documentElement.style.setProperty("--app-height", `${stableViewportHeight}px`);
  document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(keyboardInset)}px`);
  shell.classList.toggle("keyboard-open", keyboardInset > 0);
  lockDocumentScroll();
  resizeCanvas();
}

function worldToScreen(point) {
  return {
    x: point.x * state.view.scale + state.view.panX,
    y: point.y * state.view.scale + state.view.panY,
  };
}

function screenToWorld(point) {
  return {
    x: (point.x - state.view.panX) / state.view.scale,
    y: (point.y - state.view.panY) / state.view.scale,
  };
}

function centerScreen() {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.width / 2, y: rect.height / 2 };
}

function cursorWorld() {
  return resolveSnapWorld(screenToWorld(centerScreen())).point;
}

function cursorSnapResolved() {
  return resolveSnapWorld(screenToWorld(centerScreen()));
}

function colors() {
  const dark = state.theme === "dark";
  return {
    bg: css("--canvas"),
    grid: dark ? "#202a37" : "#e5ebf2",
    majorGrid: dark ? "#2a3645" : "#d2dbe8",
    wall: css("--line"),
    line: dark ? "#9bb2c9" : "#5c6a7a",
    dimension: "#1f75ff",
    accent: css("--accent"),
    accent2: css("--accent-2"),
    text: css("--text"),
    muted: css("--muted"),
    surface: css("--surface"),
    border: css("--border"),
  };
}

function css(name) {
  return getComputedStyle(shell).getPropertyValue(name).trim();
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  const c = colors();
  updateLinkedDimensions();
  updateSnapTrackingHover();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, rect.width, rect.height);
  drawGrid(rect, c);

  const visible = visibleEntities(rect);
  drawWalls(visible, c);
  for (const entity of visible) {
    if (entity.type === "wall") continue;
    drawEntity(entity, c);
  }

  drawDimensions(c);
  drawWallDimensionLabels(visible, c, rect);

  const selected = state.entities.find((entity) => entity.id === state.selectedId);
  if (selected && !state.drawing) {
    drawSelection(selected, c);
  }

  if (state.drawing) {
    drawActiveSegment(c);
  } else {
    hideInlineEditors();
  }
  drawDimensionSnapHint(c);
  drawSnapTracking(c);
  drawCursorSnap(c);
}

function drawGrid(rect, c) {
  const minor = 500 * state.view.scale;
  const major = 1000 * state.view.scale;
  const startX = state.view.panX % minor;
  const startY = state.view.panY % minor;

  ctx.lineWidth = 1;
  for (let x = startX; x < rect.width; x += minor) {
    ctx.strokeStyle = Math.abs((x - state.view.panX) % major) < 0.5 ? c.majorGrid : c.grid;
    linePath(x, 0, x, rect.height);
  }
  for (let y = startY; y < rect.height; y += minor) {
    ctx.strokeStyle = Math.abs((y - state.view.panY) % major) < 0.5 ? c.majorGrid : c.grid;
    linePath(0, y, rect.width, y);
  }
}

function visibleEntities(rect) {
  const margin = 400 / state.view.scale;
  const min = screenToWorld({ x: -20, y: -20 });
  const max = screenToWorld({ x: rect.width + 20, y: rect.height + 20 });
  return state.entities.filter((entity) => {
    if (!isLayerVisible(entity.layer)) {
      return false;
    }
    if (entity.type === "block") {
      return entity.x >= min.x - margin && entity.x <= max.x + margin && entity.y >= min.y - margin && entity.y <= max.y + margin;
    }
    const entityMinX = Math.min(entity.x1, entity.x2);
    const entityMaxX = Math.max(entity.x1, entity.x2);
    const entityMinY = Math.min(entity.y1, entity.y2);
    const entityMaxY = Math.max(entity.y1, entity.y2);
    return entityMaxX >= min.x - margin && entityMinX <= max.x + margin && entityMaxY >= min.y - margin && entityMinY <= max.y + margin;
  });
}

function isLayerVisible(layer) {
  return state.visibleLayers.has(layer || "measure");
}

function drawEntity(entity, c) {
  if (entity.type === "wall") {
    drawWall(entity, c);
  } else if (entity.type === "line") {
    drawLineEntity(entity, c);
  } else if (entity.type === "block") {
    drawBlock(entity, c);
  }
}

function drawWalls(visible, c) {
  const walls = visible.filter((entity) => entity.type === "wall");
  if (!walls.length) return;
  const wallGroups = groupWallsByWidth(walls);

  ctx.save();
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 2.5;

  for (const group of wallGroups) {
    strokeWallGroup(group, c.wall, Math.max(5, group.width * state.view.scale));
  }

  for (const group of wallGroups) {
    strokeWallGroup(group, wallCoreColor(), Math.max(1, group.width * state.view.scale - 8));
  }

  drawWallJoinNodes(walls, c);
  ctx.restore();
}

function groupWallsByWidth(walls) {
  const groups = new Map();
  for (const wallEntity of walls) {
    const width = wallEntity.width || 180;
    const group = groups.get(width) || { width, walls: [] };
    group.walls.push(wallEntity);
    groups.set(width, group);
  }
  return [...groups.values()].sort((a, b) => b.width - a.width);
}

function strokeWallGroup(group, color, width) {
  ctx.beginPath();
  for (const entity of group.walls) {
    const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
    const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawWallJoinNodes(walls, c) {
  const joints = connectedWallJoints(walls);
  if (!joints.length) return;

  ctx.lineCap = "butt";

  ctx.fillStyle = c.wall;
  for (const joint of joints) {
    const outerRadius = Math.max(3, (joint.width * state.view.scale) / 2);
    ctx.fillRect(joint.x - outerRadius, joint.y - outerRadius, outerRadius * 2, outerRadius * 2);
  }

  ctx.fillStyle = wallCoreColor();
  for (const joint of joints) {
    const outerRadius = Math.max(3, (joint.width * state.view.scale) / 2);
    const innerRadius = Math.max(1, outerRadius - 4);
    ctx.fillRect(joint.x - innerRadius, joint.y - innerRadius, innerRadius * 2, innerRadius * 2);
  }
}

function connectedWallJoints(walls) {
  const buckets = new Map();
  const tolerance = 6;
  for (const wallEntity of walls) {
    for (const point of [
      { x: wallEntity.x1, y: wallEntity.y1 },
      { x: wallEntity.x2, y: wallEntity.y2 },
    ]) {
      const key = `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`;
      const bucket = buckets.get(key) || { x: 0, y: 0, count: 0, width: 0 };
      bucket.x += point.x;
      bucket.y += point.y;
      bucket.count += 1;
      bucket.width = Math.max(bucket.width, wallEntity.width || 180);
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()]
    .filter((bucket) => bucket.count > 1)
    .map((bucket) => ({
      ...worldToScreen({ x: bucket.x / bucket.count, y: bucket.y / bucket.count }),
      width: bucket.width,
    }));
}

function wallCoreColor() {
  return state.theme === "dark" ? "#111722" : "#ffffff";
}

function drawWall(entity, c) {
  const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
  const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
  ctx.strokeStyle = c.wall;
  ctx.lineWidth = Math.max(5, entity.width * state.view.scale);
  ctx.lineCap = "square";
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.strokeStyle = wallCoreColor();
  ctx.lineWidth = Math.max(1, entity.width * state.view.scale - 8);
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.lineCap = "butt";
}

function drawLineEntity(entity, c) {
  if (entity.layer === "dimensions") {
    drawDimensionEntity(entity, c);
    return;
  }
  const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
  const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1.4;
  linePath(p1.x, p1.y, p2.x, p2.y);
}

function drawDimensionEntity(entity, c, options = {}) {
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  const geometry = dimensionWorldGeometry(entity);
  drawDimensionGeometry(start, end, c, {
    ...options,
    lineStart: geometry.lineStart,
    lineEnd: geometry.lineEnd,
    offset: entity.offset == null ? undefined : entity.offset * state.view.scale,
  });
}

function drawDimensionGeometry(start, end, c, options = {}) {
  const p1 = worldToScreen(start);
  const p2 = worldToScreen(end);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (length < 8) return;

  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const offset = options.offset ?? Math.min(42, Math.max(24, 520 * state.view.scale));
  const extension = options.extension ?? 12;
  const extensionSign = offset < 0 ? -1 : 1;
  const arrowSize = Math.min(9, Math.max(5, length * 0.08));
  const a = options.lineStart ? worldToScreen(options.lineStart) : { x: p1.x + nx * offset, y: p1.y + ny * offset };
  const b = options.lineEnd ? worldToScreen(options.lineEnd) : { x: p2.x + nx * offset, y: p2.y + ny * offset };
  const lineDx = b.x - a.x;
  const lineDy = b.y - a.y;
  const lineLength = Math.hypot(lineDx, lineDy);
  if (lineLength < 8) return;
  const lineUx = lineDx / lineLength;
  const lineUy = lineDy / lineLength;
  const lineNx = -lineUy;
  const lineNy = lineUx;
  const aLeg = normalizeScreenVector(a.x - p1.x, a.y - p1.y, nx * extensionSign, ny * extensionSign);
  const bLeg = normalizeScreenVector(b.x - p2.x, b.y - p2.y, nx * extensionSign, ny * extensionSign);
  const aExtension = { x: a.x + aLeg.x * extension, y: a.y + aLeg.y * extension };
  const bExtension = { x: b.x + bLeg.x * extension, y: b.y + bLeg.y * extension };
  const metrics = segmentMetrics(start.x, start.y, end.x, end.y);
  const text = `${metrics.length} мм`;
  const displayLength =
    options.lineStart && options.lineEnd
      ? Math.round(distanceWorld(options.lineStart, options.lineEnd))
      : metrics.length;
  const displayText = `${displayLength} мм`;
  const labelSide = offset < 0 ? -1 : 1;
  const labelGap = 15;
  const label = {
    x: (a.x + b.x) / 2 + lineNx * labelSide * labelGap,
    y: (a.y + b.y) / 2 + lineNy * labelSide * labelGap,
  };
  const angle = Math.atan2(lineDy, lineDx);

  ctx.save();
  ctx.strokeStyle = c.dimension;
  ctx.fillStyle = c.dimension;
  ctx.lineWidth = options.active ? 1.8 : 1.45;
  ctx.setLineDash(options.active ? [7, 5] : []);

  linePath(p1.x, p1.y, aExtension.x, aExtension.y);
  linePath(p2.x, p2.y, bExtension.x, bExtension.y);
  ctx.setLineDash([]);
  linePath(a.x, a.y, b.x, b.y);
  drawDimensionArrow(a, lineUx, lineUy, arrowSize, c);
  drawDimensionArrow(b, -lineUx, -lineUy, arrowSize, c);

  ctx.translate(label.x, label.y);
  let textAngle = angle;
  if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
  ctx.rotate(textAngle);
  ctx.font = "700 12px Inter, Segoe UI, sans-serif";
  ctx.lineWidth = 4;
  ctx.strokeStyle = c.bg;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeText(displayText, 0, 1);
  ctx.fillStyle = c.dimension;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayText, 0, 1);
  ctx.restore();
}

function normalizeScreenVector(dx, dy, fallbackX, fallbackY) {
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return { x: fallbackX, y: fallbackY };
  return { x: dx / length, y: dy / length };
}

function dimensionOffsetFromPoint(start, end, point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return 0;
  const nx = -dy / length;
  const ny = dx / length;
  return (point.x - start.x) * nx + (point.y - start.y) * ny;
}

function drawDimensionArrow(point, ux, uy, size, c) {
  const wing = size * 0.62;
  ctx.save();
  ctx.fillStyle = c.dimension;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(point.x + ux * size - uy * wing, point.y + uy * size + ux * wing);
  ctx.lineTo(point.x + ux * size + uy * wing, point.y + uy * size - ux * wing);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBlock(entity, c) {
  const p = worldToScreen({ x: entity.x, y: entity.y });
  const size = entitySize(entity);
  const w = size.width;
  const h = size.height;
  const selected = entity.id === state.selectedId;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((entity.rotation * Math.PI) / 180);
  ctx.scale(state.view.scale, state.view.scale);
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.fillStyle = state.theme === "dark" ? "#162434" : "#eef5ff";
  ctx.lineWidth = 16;

  if (drawLibraryBlockSymbol(entity.kind, w, h)) {
    ctx.restore();
    return;
  }

  const shapes = {
    sofa: () => {
      roundedRect(-w / 2, -h / 2, w, h, 90);
      roundedRect(-w / 2 + 120, -h / 2 + 120, w / 3 - 120, h - 240, 45);
      roundedRect(-w / 6 + 60, -h / 2 + 120, w / 3 - 120, h - 240, 45);
      roundedRect(w / 6, -h / 2 + 120, w / 3 - 120, h - 240, 45);
    },
    sectional: () => {
      roundedRect(-w / 2, -h / 2, w, h * 0.48, 90);
      roundedRect(-w / 2, -h / 2, w * 0.36, h, 90);
      roundedRect(-w / 2 + 120, -h / 2 + 120, w / 3 - 140, h * 0.48 - 240, 45);
      roundedRect(-w / 6 + 30, -h / 2 + 120, w / 3 - 140, h * 0.48 - 240, 45);
      roundedRect(w / 6, -h / 2 + 120, w / 3 - 140, h * 0.48 - 240, 45);
    },
    table: () => {
      roundedRect(-w / 2, -h / 2, w, h, 70);
      circle(-w / 3, -h / 3, 35);
      circle(w / 3, -h / 3, 35);
      circle(-w / 3, h / 3, 35);
      circle(w / 3, h / 3, 35);
    },
    bed: () => {
      roundedRect(-w / 2, -h / 2, w, h, 70);
      roundedRect(-w / 2 + 120, -h / 2 + 120, w / 2 - 170, 330, 36);
      roundedRect(50, -h / 2 + 120, w / 2 - 170, 330, 36);
    },
    chair: () => {
      roundedRect(-w / 2, -h / 2, w, h, 45);
      linePath(-w / 2, h / 2 + 45, w / 2, h / 2 + 45);
    },
    cabinet: () => {
      roundedRect(-w / 2, -h / 2, w, h, 28);
      linePath(-w / 2, 0, w / 2, 0);
      linePath(0, -h / 2, 0, h / 2);
    },
    tv: () => {
      roundedRect(-w / 2, -h / 2, w, h, 24);
      linePath(-w / 2 + 90, 0, w / 2 - 90, 0);
    },
    door: () => {
      ctx.beginPath();
      ctx.arc(0, 0, w, -Math.PI / 2, 0);
      ctx.stroke();
      linePath(0, 0, 0, -w);
      linePath(0, 0, w, 0);
    },
    window: () => {
      linePath(-w / 2, -h / 3, w / 2, -h / 3);
      linePath(-w / 2, h / 3, w / 2, h / 3);
      linePath(-w / 3, -h / 2, -w / 3, h / 2);
      linePath(w / 3, -h / 2, w / 3, h / 2);
    },
    sink: () => {
      roundedRect(-w / 2, -h / 2, w, h, 40);
      roundedRect(-w / 3, -h / 3, w * 0.66, h * 0.52, 45);
      circle(0, h * 0.2, 28);
    },
    toilet: () => {
      roundedRect(-w / 2, -h / 2, w * 0.42, h, 38);
      roundedRect(-w * 0.04, -h * 0.38, w * 0.54, h * 0.76, 120);
    },
    tub: () => {
      roundedRect(-w / 2, -h / 2, w, h, 70);
      roundedRect(-w / 2 + 120, -h / 2 + 120, w - 240, h - 240, 55);
    },
    lamp: () => {
      circle(0, 0, Math.min(w, h) * 0.32);
      linePath(-w * 0.28, 0, w * 0.28, 0);
      linePath(0, -h * 0.28, 0, h * 0.28);
    },
  };

  (shapes[entity.kind] || shapes.cabinet)?.();
  ctx.restore();
}

function drawLibraryBlockSymbol(kind, w, h) {
  if (kind === "sofa") {
    return drawSofaLibrarySymbol(w, h);
  }
  if (kind === "sectional") {
    return drawSectionalLibrarySymbol(w, h);
  }
  const image = blockSymbolImages[kind];
  if (!isSymbolReady(image)) return false;
  drawSymbolImage(image, 0, 0, w * 0.92, h * 0.88);
  return true;
}

function drawSofaLibrarySymbol(w, h) {
  if (!couchSymbolImages.every(isSymbolReady)) return false;
  const padding = w * 0.04;
  const partWidth = (w - padding * 2) / couchSymbolImages.length;
  couchSymbolImages.forEach((image, index) => {
    const x = -w / 2 + padding + partWidth * index + partWidth / 2;
    drawSymbolImage(image, x, 0, partWidth * 1.1, h * 0.92);
  });
  return true;
}

function drawSectionalLibrarySymbol(w, h) {
  if (!couchSymbolImages.every(isSymbolReady) || !isSymbolReady(blockSymbolImages.chair)) return false;
  const topY = -h * 0.23;
  const partWidth = w * 0.28;
  couchSymbolImages.forEach((image, index) => {
    drawSymbolImage(image, -w * 0.3 + partWidth * index, topY, partWidth * 1.05, h * 0.44);
  });
  drawSymbolImage(blockSymbolImages.chair, -w * 0.34, h * 0.18, w * 0.36, h * 0.48, Math.PI / 2);
  return true;
}

function isSymbolReady(image) {
  return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
}

function drawSymbolImage(image, x, y, boxW, boxH, rotation = 0) {
  const ratio = image.naturalWidth / image.naturalHeight || 1;
  let drawW = boxW;
  let drawH = drawW / ratio;
  if (drawH > boxH) {
    drawH = boxH;
    drawW = drawH * ratio;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = 0.92;
  ctx.filter = state.theme === "dark" ? "invert(1) grayscale(1) contrast(1.1)" : "grayscale(1) contrast(1.25)";
  ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function entitySize(entity) {
  const fallback = defaultBlockSize(entity.kind);
  return {
    width: entity.width || fallback.width,
    height: entity.height || fallback.height,
  };
}

function drawDimensions(c) {
  if (!isLayerVisible("dimensions")) return;
  const labels = [
    { text: "5200", x: 2600, y: -270 },
    { text: "3600", x: 5480, y: 1800, rotate: -90 },
    { text: "2650", x: 1325, y: 6370 },
    { text: "12.6 м²", x: 1450, y: 2800 },
    { text: "9.1 м²", x: 3920, y: 1300 },
  ];
  for (const label of labels) {
    const p = worldToScreen({ x: label.x, y: label.y });
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(((label.rotate || 0) * Math.PI) / 180);
    ctx.fillStyle = label.text.includes("м²") ? c.muted : c.dimension;
    ctx.font = "600 12px Inter, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  }
}

function drawWallDimensionLabels(visible, c, rect) {
  if (!isLayerVisible("dimensions") || state.drawing) return;
  for (const entity of visible) {
    if (entity.type !== "wall") continue;
    const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
    if (metrics.length < 900) continue;
    const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
    const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
    const m = midpoint(p1, p2);
    if (m.x < 68 || m.x > rect.width - 8 || m.y < 18 || m.y > rect.height - 18) continue;
    const horizontal = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);
    const x = horizontal ? m.x : m.x + 22;
    const y = horizontal ? m.y - 22 : m.y;
    drawMiniLabel(String(metrics.length), x, y, c, !horizontal);
  }
}

function drawMiniLabel(text, x, y, c, vertical = false) {
  ctx.save();
  ctx.translate(x, y);
  if (vertical) ctx.rotate(-Math.PI / 2);
  ctx.font = "700 10px Inter, Segoe UI, sans-serif";
  const width = ctx.measureText(text).width + 12;
  const height = 18;
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  roundedRect(-width / 2, -height / 2, width, height, 6);
  ctx.fillStyle = c.dimension;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

function colorMixSurface(surface) {
  return state.theme === "dark" ? surface : "rgba(255, 255, 255, 0.92)";
}

function drawSelection(entity, c) {
  if (entity.type === "block") {
    drawFurnitureSelection(entity, c);
    return;
  }
  if (entity.layer === "dimensions") {
    drawDimensionSelection(entity, c);
    return;
  }
  const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
  const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  linePath(p1.x, p1.y, p2.x, p2.y);
  drawHandle(p1.x, p1.y, c);
  drawHandle(p2.x, p2.y, c);
  const m = midpoint(p1, p2);
  const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
  drawBadge(`${metrics.length} мм  ${metrics.angle}°`, m.x, m.y - 24, c);
}

function drawDimensionSelection(entity, c) {
  const geometry = dimensionScreenGeometry(entity);
  if (!geometry) return;
  const { a, b, label } = geometry;
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  drawHandle(a.x, a.y, c);
  drawHandle(b.x, b.y, c);
  ctx.restore();
  return;

  const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
  drawBadge(`${metrics.length} мм  ${metrics.angle}°`, label.x, label.y - 24, c);
}

function hitDimensionControl(screen) {
  if (state.tool !== "select") return null;
  const hits = [];
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (entity.layer !== "dimensions" || !isLayerVisible(entity.layer)) continue;
    const geometry = dimensionScreenGeometry(entity);
    if (!geometry) continue;
    const startDistance = pointDistance(screen, geometry.a);
    const endDistance = pointDistance(screen, geometry.b);
    const lineDistance = pointToSegmentDistance(screen, geometry.a, geometry.b);
    const legStartDistance = pointToSegmentDistance(screen, geometry.legStart.p1, geometry.legStart.p2);
    const legEndDistance = pointToSegmentDistance(screen, geometry.legEnd.p1, geometry.legEnd.p2);
    if (startDistance <= 20) hits.push({ type: "dimension-start", entity, score: startDistance, order: i });
    if (endDistance <= 20) hits.push({ type: "dimension-end", entity, score: endDistance, order: i });
    if (lineDistance <= 18) hits.push({ type: "dimension-offset", entity, score: lineDistance + 12, order: i });
    if (legStartDistance <= 16) hits.push({ type: "dimension-start", entity, score: legStartDistance + 18, order: i });
    if (legEndDistance <= 16) hits.push({ type: "dimension-end", entity, score: legEndDistance + 18, order: i });
  }
  if (!hits.length) {
    state.dimensionPickCycle = null;
    return null;
  }
  hits.sort((a, b) => a.score - b.score || b.order - a.order);
  const uniqueHits = [];
  for (const hit of hits) {
    if (!uniqueHits.some((item) => item.entity.id === hit.entity.id && item.type === hit.type)) uniqueHits.push(hit);
  }
  const cycle = state.dimensionPickCycle;
  const sameSpot = cycle && pointDistance(screen, cycle.screen) <= 14;
  let index = 0;
  if (sameSpot) index = (cycle.index + 1) % uniqueHits.length;
  state.dimensionPickCycle = { screen, index };
  const picked = uniqueHits[index];
  return { type: picked.type, entity: picked.entity };
}

function dimensionScreenGeometry(entity) {
  const geometry = dimensionWorldGeometry(entity);
  const a = worldToScreen(geometry.lineStart);
  const b = worldToScreen(geometry.lineEnd);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 8) return null;
  const nx = -(dy / length);
  const ny = dx / length;
  const labelSide = geometry.offset < 0 ? -1 : 1;
  const labelGap = 15;
  return {
    a,
    b,
    legStart: { p1: worldToScreen(geometry.start), p2: a },
    legEnd: { p1: worldToScreen(geometry.end), p2: b },
    label: {
      x: (a.x + b.x) / 2 + nx * labelSide * labelGap,
      y: (a.y + b.y) / 2 + ny * labelSide * labelGap,
    },
  };
}

function dimensionWorldGeometry(entity) {
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  if (Number.isFinite(entity.dimX1) && Number.isFinite(entity.dimY1) && Number.isFinite(entity.dimX2) && Number.isFinite(entity.dimY2)) {
    return {
      start,
      end,
      lineStart: { x: entity.dimX1, y: entity.dimY1 },
      lineEnd: { x: entity.dimX2, y: entity.dimY2 },
      offset: dimensionOffsetFromPoint(start, end, { x: entity.dimX1, y: entity.dimY1 }),
    };
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const offset = entity.offset ?? 360;
  return {
    start,
    end,
    lineStart: { x: start.x + nx * offset, y: start.y + ny * offset },
    lineEnd: { x: end.x + nx * offset, y: end.y + ny * offset },
    offset,
  };
}

function dimensionDisplayLength(entity) {
  const geometry = dimensionWorldGeometry(entity);
  return Math.round(distanceWorld(geometry.lineStart, geometry.lineEnd));
}

function ensureDimensionLineGeometry(entity) {
  const geometry = dimensionWorldGeometry(entity);
  entity.dimX1 = geometry.lineStart.x;
  entity.dimY1 = geometry.lineStart.y;
  entity.dimX2 = geometry.lineEnd.x;
  entity.dimY2 = geometry.lineEnd.y;
  entity.offset = geometry.offset;
  return geometry;
}

function setDimensionLineOffset(entity, offset) {
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  entity.offset = offset;
  entity.dimX1 = start.x + nx * offset;
  entity.dimY1 = start.y + ny * offset;
  entity.dimX2 = end.x + nx * offset;
  entity.dimY2 = end.y + ny * offset;
}

function moveDimensionLineOffset(entity, pointerPoint) {
  const geometry = ensureDimensionLineGeometry(entity);
  const axis = normalizeWorldVector(geometry.lineEnd.x - geometry.lineStart.x, geometry.lineEnd.y - geometry.lineStart.y);
  if (!axis) return;
  const normal = { x: -axis.y, y: axis.x };
  const snapped = snapDimensionLineToOtherDimension(entity, pointerPoint, axis);
  const referencePoint = snapped || pointerPoint;
  const offset = (referencePoint.x - entity.x1) * normal.x + (referencePoint.y - entity.y1) * normal.y;
  setDimensionLineAlongAxis(entity, axis, offset);
}

function setDimensionLineAlongAxis(entity, axis, offset) {
  const normal = { x: -axis.y, y: axis.x };
  const origin = { x: entity.x1, y: entity.y1 };
  const startProjection = (entity.x1 - origin.x) * axis.x + (entity.y1 - origin.y) * axis.y;
  const endProjection = (entity.x2 - origin.x) * axis.x + (entity.y2 - origin.y) * axis.y;
  entity.offset = offset;
  entity.dimX1 = origin.x + axis.x * startProjection + normal.x * offset;
  entity.dimY1 = origin.y + axis.y * startProjection + normal.y * offset;
  entity.dimX2 = origin.x + axis.x * endProjection + normal.x * offset;
  entity.dimY2 = origin.y + axis.y * endProjection + normal.y * offset;
}

function snapDimensionLineToOtherDimension(entity, point, axis) {
  state.dimensionSnapHint = null;
  if (!state.snaps.has("end")) return null;
  const threshold = 34 / state.view.scale;
  let best = null;
  for (const candidate of state.entities) {
    if (candidate === entity || candidate.layer !== "dimensions" || !isLayerVisible(candidate.layer)) continue;
    const geometry = dimensionWorldGeometry(candidate);
    const candidateAxis = normalizeWorldVector(geometry.lineEnd.x - geometry.lineStart.x, geometry.lineEnd.y - geometry.lineStart.y);
    if (!candidateAxis) continue;
    const parallelScore = Math.abs(axis.x * candidateAxis.y - axis.y * candidateAxis.x);
    if (parallelScore > 0.12) continue;
    const hit = projectPointToSegmentWorld(point, geometry.lineStart, geometry.lineEnd);
    if (hit.distance > threshold) continue;
    const score = hit.distance + parallelScore * 240;
    if (!best || score < best.score) {
      best = { x: hit.x, y: hit.y, score, segment: { p1: geometry.lineStart, p2: geometry.lineEnd } };
    }
  }
  if (!best) return null;
  state.dimensionSnapHint = {
    type: "line",
    point: { x: best.x, y: best.y },
    segment: best.segment,
  };
  return { x: best.x, y: best.y };
}

function drawFurnitureSelection(entity, c) {
  if (state.tool !== "select" && state.tool !== "furniture") return;
  const layout = furnitureControlLayout(entity);
  if (!layout) return;
  const { corners } = layout;

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash(layout.editing ? [] : [7, 5]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  if (layout.editing) {
    for (const handle of layout.handles) {
      drawFurnitureCornerHandle(handle, c);
    }
    drawFurnitureRotateHandle(layout.rotate, c);
    drawFurnitureDoneButton(layout.done, c);
    const size = entitySize(entity);
    drawBadge(`${Math.round(size.width)} × ${Math.round(size.height)}`, layout.bbox.centerX, layout.bbox.maxY + 24, c, true);
  } else {
    drawCanvasButton(layout.editButton, "Редактировать", c);
  }
  ctx.restore();
}

function drawFurnitureCornerHandle(handle, c) {
  ctx.save();
  ctx.fillStyle = c.surface;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  roundedRect(handle.x - 8, handle.y - 8, 16, 16, 4);
  ctx.restore();
}

function drawFurnitureRotateHandle(control, c) {
  ctx.save();
  ctx.fillStyle = c.surface;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(control.x, control.y, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = c.accent;
  ctx.font = "800 19px Inter, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("↻", control.x, control.y + 1);
  ctx.restore();
}

function drawFurnitureDoneButton(rect, c) {
  drawCanvasButton(rect, "✓", c, true);
}

function drawCanvasButton(rect, text, c, solid = false) {
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = solid ? c.accent : c.surface;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.4;
  roundedRect(rect.x, rect.y, rect.width, rect.height, 9);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = solid ? "#ffffff" : c.accent;
  ctx.font = `800 ${rect.width < 60 ? 17 : 12}px Inter, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
  ctx.restore();
}

function furnitureControlLayout(entity) {
  if (!entity || entity.type !== "block") return null;
  const corners = blockCorners(entity).map(worldToScreen);
  const center = worldToScreen({ x: entity.x, y: entity.y });
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const bbox = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  bbox.centerX = (bbox.minX + bbox.maxX) / 2;
  bbox.centerY = (bbox.minY + bbox.maxY) / 2;

  const rect = canvas.getBoundingClientRect();
  const editing = state.furnitureEditId === entity.id;
  const buttonWidth = 118;
  const buttonHeight = 32;
  const buttonY = clampScreenY(bbox.minY - buttonHeight - 12, buttonHeight, rect.height);
  const editButton = {
    x: clampScreenX(bbox.centerX - buttonWidth / 2, buttonWidth, rect.width),
    y: buttonY,
    width: buttonWidth,
    height: buttonHeight,
  };
  const done = {
    x: clampScreenX(bbox.minX, 44, rect.width),
    y: clampScreenY(bbox.minY - 42, 34, rect.height),
    width: 44,
    height: 34,
  };
  const topRight = corners[1];
  const dx = topRight.x - center.x;
  const dy = topRight.y - center.y;
  const distance = Math.hypot(dx, dy) || 1;
  const rotate = {
    x: Math.max(22, Math.min(rect.width - 22, topRight.x + (dx / distance) * 34)),
    y: Math.max(22, Math.min(rect.height - 22, topRight.y + (dy / distance) * 34)),
  };
  const names = ["nw", "ne", "se", "sw"];
  const handles = corners.map((corner, index) => ({ ...corner, corner: names[index] }));
  return { corners, center, bbox, editing, editButton, done, rotate, handles };
}

function clampScreenX(x, width, canvasWidth) {
  return Math.max(8, Math.min(canvasWidth - width - 8, x));
}

function clampScreenY(y, height, canvasHeight) {
  if (y < 8) return 8;
  return Math.min(canvasHeight - height - 8, y);
}

function drawActiveSegment(c) {
  const { start } = state.drawing;
  const end = state.drawing.lockedEnd ? state.drawing.end : cursorWorld();
  state.drawing.end = end;
  const p1 = worldToScreen(start);
  const p2 = worldToScreen(end);
  const metrics = segmentMetrics(start.x, start.y, end.x, end.y);
  const angleInfo = activeAngleInfo(start, end);
  const m = midpoint(p1, p2);

  if (state.tool === "dimension") {
    const offset =
      state.drawing.phase === "offset"
        ? dimensionOffsetFromPoint(start, end, cursorWorld()) * state.view.scale
        : undefined;
    drawDimensionGeometry(start, end, c, { active: true, offset });
    drawHandle(p1.x, p1.y, c);
    drawHandle(p2.x, p2.y, c);
    hideInlineEditors();
    return;
  }

  ctx.strokeStyle = state.tool === "dimension" ? c.dimension : c.accent;
  ctx.lineWidth = state.tool === "wall" ? 5 : 2.2;
  ctx.setLineDash([8, 6]);
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.setLineDash([]);
  drawHandle(p1.x, p1.y, c);
  drawHandle(p2.x, p2.y, c);

  updateInlineEditors({ start, end, p1, p2, midpoint: m, metrics, angleInfo });
  drawAngleArc(p1, p2, angleInfo, c);
}

function drawAngleArc(origin, target, angleInfo, c) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const screenLength = Math.hypot(dx, dy);
  if (screenLength < 34) return;

  const radius = Math.min(54, Math.max(32, screenLength * 0.32));
  const startRad = angleInfo.referenceRad;
  const endRad = angleInfo.referenceRad + angleInfo.deltaRad;
  const labelRad = angleInfo.referenceRad + angleInfo.deltaRad / 2;
  const arcEnd = {
    x: origin.x + Math.cos(endRad) * radius,
    y: origin.y + Math.sin(endRad) * radius,
  };
  const label = {
    x: origin.x + Math.cos(labelRad) * (radius + 16),
    y: origin.y + Math.sin(labelRad) * (radius + 16),
  };

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 4]);
  linePath(
    origin.x,
    origin.y,
    origin.x + Math.cos(startRad) * (radius + 14),
    origin.y + Math.sin(startRad) * (radius + 14),
  );
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, radius, startRad, endRad, angleInfo.deltaRad < 0);
  ctx.stroke();

  drawArcArrow(arcEnd, endRad, angleInfo.deltaRad >= 0 ? 1 : -1, c);
  positionAngleEditor(label.x, label.y, angleInfo.degrees);
  ctx.restore();
}

function drawArcArrow(point, angleRad, direction, c) {
  const tangent = angleRad + (direction >= 0 ? Math.PI / 2 : -Math.PI / 2);
  const size = 7;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(tangent);
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.55);
  ctx.lineTo(-size, size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function updateInlineEditors({ start, end, p1, p2, midpoint: m, metrics, angleInfo }) {
  if (!inlineEditors) return;
  if (state.tool === "dimension") {
    hideInlineEditors();
    return;
  }
  inlineEditors.hidden = false;
  state.inlineEdit = { start, end, metrics, angleInfo };
  positionInlineEditor(lengthEditor, m.x, m.y - 28);
  if (document.activeElement !== lengthInput) {
    lengthInput.value = metrics.length;
  }
  if (document.activeElement !== angleInput) {
    angleInput.value = angleInfo.degrees;
  }
}

function positionAngleEditor(x, y, value) {
  positionInlineEditor(angleEditor, x, y, lengthEditor);
  if (document.activeElement !== angleInput) {
    angleInput.value = value;
  }
}

function positionInlineEditor(editor, x, y, avoidEditor = null) {
  if (!editor) return;
  const rect = canvas.getBoundingClientRect();
  const editorWidth = editor.offsetWidth || 84;
  const editorHeight = editor.offsetHeight || 28;
  let safeX = Math.max(editorWidth / 2 + 8, Math.min(rect.width - editorWidth / 2 - 8, x));
  let safeY = Math.max(editorHeight / 2 + 8, Math.min(rect.height - editorHeight / 2 - 8, y));

  if (avoidEditor && !avoidEditor.hidden && avoidEditor.style.left && avoidEditor.style.top) {
    const avoidWidth = avoidEditor.offsetWidth || 84;
    const avoidHeight = avoidEditor.offsetHeight || 28;
    const avoidX = parseFloat(avoidEditor.style.left);
    const avoidY = parseFloat(avoidEditor.style.top);
    const overlaps =
      Math.abs(safeX - avoidX) < (editorWidth + avoidWidth) / 2 + 8 &&
      Math.abs(safeY - avoidY) < (editorHeight + avoidHeight) / 2 + 8;
    if (overlaps) {
      const belowY = avoidY + (editorHeight + avoidHeight) / 2 + 10;
      const aboveY = avoidY - (editorHeight + avoidHeight) / 2 - 10;
      safeY = belowY <= rect.height - editorHeight / 2 - 8 ? belowY : aboveY;
      safeY = Math.max(editorHeight / 2 + 8, Math.min(rect.height - editorHeight / 2 - 8, safeY));
    }
  }

  editor.style.left = `${safeX}px`;
  editor.style.top = `${safeY}px`;
}

function hideInlineEditors() {
  if (inlineEditors) {
    inlineEditors.hidden = true;
  }
  state.inlineEdit = null;
}

function applyInlineValue(kind) {
  if (!state.drawing || !state.inlineEdit) return;
  const start = state.drawing.start;
  const end = state.drawing.end;
  const currentLength = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  const currentRad = Math.atan2(end.y - start.y, end.x - start.x);
  const typedLength = Number(lengthInput.value.replace(",", "."));
  const typedAngle = Number(angleInput.value.replace(",", "."));

  let nextLength = Number.isFinite(typedLength) && typedLength > 0 ? typedLength : currentLength;
  let nextRad = currentRad;
  if (kind === "angle" && Number.isFinite(typedAngle)) {
    const angleInfo = state.inlineEdit.angleInfo;
    if (angleInfo?.hasReference) {
      const sign = angleInfo.deltaRad < 0 ? -1 : 1;
      nextRad = angleInfo.referenceRad + sign * (typedAngle * Math.PI) / 180;
    } else {
      nextRad = (typedAngle * Math.PI) / 180;
    }
  }
  if (kind === "length" && (!Number.isFinite(typedLength) || typedLength <= 0)) {
    nextLength = currentLength;
  }

  state.drawing.end = {
    x: start.x + Math.cos(nextRad) * nextLength,
    y: start.y + Math.sin(nextRad) * nextLength,
  };
  state.drawing.lockedEnd = true;
  draw();
}

function drawBadge(text, x, y, c, secondary = false) {
  if (/Параллель|Точка|РџР°СЂР°|РўРѕС‡/.test(text)) return;
  ctx.save();
  ctx.font = "700 12px Inter, Segoe UI, sans-serif";
  const padX = 8;
  const width = ctx.measureText(text).width + padX * 2;
  const height = 24;
  const rx = x - width / 2;
  const ry = y - height / 2;
  ctx.fillStyle = secondary ? c.surface : c.accent;
  ctx.strokeStyle = secondary ? c.accent : c.accent;
  ctx.lineWidth = 1;
  roundedRect(rx, ry, width, height, 7, true);
  ctx.fillStyle = secondary ? c.accent : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function drawHandle(x, y, c) {
  ctx.fillStyle = c.surface;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawDimensionSnapHint(c) {
  const hint = state.dimensionSnapHint;
  if (!hint) return;
  const point = worldToScreen(hint.point);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  if (hint.type === "line" && hint.segment) {
    const a = worldToScreen(hint.segment.p1);
    const b = worldToScreen(hint.segment.p2);
    ctx.setLineDash([9, 6]);
    linePath(a.x, a.y, b.x, b.y);
    ctx.setLineDash([]);
    drawBadge("Параллель ножке", point.x, point.y - 28, c, true);
  } else {
    drawBadge("Точка", point.x, point.y - 28, c, true);
  }
  ctx.beginPath();
  ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.bg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function canUseSnapTracking() {
  return state.tool === "dimension" && state.snaps.has("polar") && !state.pointer && !state.pinch;
}

function updateSnapTrackingHover() {
  if (!canUseSnapTracking()) {
    clearSnapTrackingHover();
    state.snapTracking.active = null;
    return;
  }
  const candidate = nearestTrackingAnchorCandidate(screenToWorld(centerScreen()));
  if (!candidate) {
    clearSnapTrackingHover();
    return;
  }
  const key = trackingPointKey(candidate);
  if (isSnapTrackingPoint(key)) {
    clearSnapTrackingHover();
    return;
  }
  if (state.snapTracking.hoverKey === key) return;
  clearSnapTrackingHover();
  state.snapTracking.hoverKey = key;
  state.snapTracking.hoverPoint = candidate;
  state.snapTracking.hoverTimer = window.setTimeout(() => {
    commitSnapTrackingHover(key);
  }, trackingHoverDelayMs);
}

function clearSnapTrackingHover() {
  if (state.snapTracking.hoverTimer) {
    window.clearTimeout(state.snapTracking.hoverTimer);
  }
  state.snapTracking.hoverKey = null;
  state.snapTracking.hoverPoint = null;
  state.snapTracking.hoverTimer = null;
}

function commitSnapTrackingHover(key) {
  const point = state.snapTracking.hoverPoint;
  if (!point || state.snapTracking.hoverKey !== key || !canUseSnapTracking()) return;
  const current = nearestTrackingAnchorCandidate(screenToWorld(centerScreen()));
  if (!current || trackingPointKey(current) !== key) return;
  addSnapTrackingPoint(current);
  clearSnapTrackingHover();
  draw();
}

function nearestTrackingAnchorCandidate(point) {
  const threshold = (state.tool === "dimension" ? 30 : 22) / state.view.scale;
  const candidates = snapCandidates({
    includeCorners: true,
    includeMidpoints: state.snaps.has("mid"),
    includeCenters: state.snaps.has("mid"),
  });
  return nearestSnapCandidate(point, candidates, threshold);
}

function addSnapTrackingPoint(point) {
  const key = trackingPointKey(point);
  const existing = state.snapTracking.points.find((item) => item.key === key);
  if (existing) {
    existing.x = point.x;
    existing.y = point.y;
    existing.createdAt = performance.now();
    return;
  }
  state.snapTracking.points.push({
    key,
    x: point.x,
    y: point.y,
    label: point.label,
    createdAt: performance.now(),
  });
  while (state.snapTracking.points.length > trackingMaxPoints) {
    state.snapTracking.points.shift();
  }
}

function isSnapTrackingPoint(key) {
  return state.snapTracking.points.some((point) => point.key === key);
}

function trackingPointKey(point) {
  if (point.entityId && point.pointKey) return `${point.entityId}:${point.pointKey}`;
  return `${Math.round(point.x)}:${Math.round(point.y)}`;
}

function snapTrackingGuides() {
  const guides = [];
  for (const point of state.snapTracking.points) {
    for (const angle of trackingAngles) {
      guides.push({
        point,
        angle,
        ux: Math.cos(angle),
        uy: Math.sin(angle),
      });
    }
  }
  return guides;
}

function nearestSnapTrackingPoint(point, threshold) {
  const guides = snapTrackingGuides();
  if (guides.length === 0) return null;
  let bestIntersection = null;
  for (let i = 0; i < guides.length; i += 1) {
    for (let j = i + 1; j < guides.length; j += 1) {
      const a = guides[i];
      const b = guides[j];
      if (a.point.key === b.point.key) continue;
      const intersection = trackingGuideIntersection(a, b);
      if (!intersection) continue;
      const distance = distanceWorld(point, intersection);
      if (distance > threshold) continue;
      if (!bestIntersection || distance < bestIntersection.distance) {
        bestIntersection = { ...intersection, distance, guides: [a, b] };
      }
    }
  }
  if (bestIntersection) {
    return {
      x: bestIntersection.x,
      y: bestIntersection.y,
      label: "Tracking",
      type: "tracking",
      trackingType: "intersection",
      guides: bestIntersection.guides,
    };
  }

  let bestLine = null;
  for (const guide of guides) {
    const projection = projectPointToTrackingGuide(point, guide);
    if (projection.distance > threshold) continue;
    if (!bestLine || projection.distance < bestLine.distance) {
      bestLine = { ...projection, guide };
    }
  }
  if (!bestLine) return null;
  return {
    x: bestLine.x,
    y: bestLine.y,
    label: "Tracking",
    type: "tracking",
    trackingType: "line",
    guide: bestLine.guide,
  };
}

function projectPointToTrackingGuide(point, guide) {
  const t = (point.x - guide.point.x) * guide.ux + (point.y - guide.point.y) * guide.uy;
  const projection = {
    x: guide.point.x + guide.ux * t,
    y: guide.point.y + guide.uy * t,
  };
  return { ...projection, distance: distanceWorld(point, projection) };
}

function trackingGuideIntersection(a, b) {
  const cross = a.ux * b.uy - a.uy * b.ux;
  if (Math.abs(cross) < 0.0001) return null;
  const dx = b.point.x - a.point.x;
  const dy = b.point.y - a.point.y;
  const t = (dx * b.uy - dy * b.ux) / cross;
  return {
    x: a.point.x + a.ux * t,
    y: a.point.y + a.uy * t,
  };
}

function drawSnapTracking(c) {
  if (!canUseSnapTracking() || state.snapTracking.points.length === 0) return;
  resolveSnapWorld(screenToWorld(centerScreen()));
  const rect = canvas.getBoundingClientRect();
  const guides = snapTrackingGuides();
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.24;
  ctx.setLineDash([8, 7]);
  for (const guide of guides) {
    drawTrackingGuideLine(guide, rect);
  }
  ctx.setLineDash([]);

  const activeGuides = activeTrackingGuides();
  if (activeGuides.length) {
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([10, 6]);
    for (const guide of activeGuides) {
      drawTrackingGuideLine(guide, rect);
    }
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = 0.95;
  for (const point of state.snapTracking.points) {
    drawTrackingAnchor(point, c);
  }
  if (state.snapTracking.active?.trackingType === "intersection") {
    const p = worldToScreen(state.snapTracking.active);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 9, p.y);
    ctx.lineTo(p.x + 9, p.y);
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x, p.y + 9);
    ctx.stroke();
  }
  ctx.restore();
}

function activeTrackingGuides() {
  const active = state.snapTracking.active;
  if (!active) return [];
  if (active.trackingType === "intersection") return active.guides || [];
  if (active.trackingType === "line" && active.guide) return [active.guide];
  return [];
}

function drawTrackingGuideLine(guide, rect) {
  const p = worldToScreen(guide.point);
  const length = Math.max(rect.width, rect.height) * 1.6;
  const dx = guide.ux * length;
  const dy = guide.uy * length;
  linePath(p.x - dx, p.y - dy, p.x + dx, p.y + dy);
}

function drawTrackingAnchor(point, c) {
  const p = worldToScreen(point);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 12, p.y);
  ctx.lineTo(p.x + 12, p.y);
  ctx.moveTo(p.x, p.y - 12);
  ctx.lineTo(p.x, p.y + 12);
  ctx.stroke();
  ctx.restore();
}

function resetSnapTracking() {
  clearSnapTrackingHover();
  state.snapTracking.points = [];
  state.snapTracking.active = null;
}

function drawCursorSnap(c) {
  if (state.tool === "select" || state.tool === "furniture") return;
  const snap = resolveSnapWorld(screenToWorld(centerScreen())).snap;
  if (!snap) return;
  const p = worldToScreen(snap);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.rect(p.x - 6, p.y - 6, 12, 12);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 14, p.y);
  ctx.lineTo(p.x + 14, p.y);
  ctx.moveTo(p.x, p.y - 14);
  ctx.lineTo(p.x, p.y + 14);
  ctx.stroke();
  if (snap.type !== "tracking") {
    drawBadge(snap.label || "Snap", p.x, p.y - 26, c, true);
  }
  ctx.restore();
}

function linePath(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundedRect(x, y, w, h, r, fillOnly = false) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
  if (!fillOnly) {
    ctx.stroke();
  }
}

function circle(x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function segmentMetrics(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.round(Math.hypot(dx, dy));
  let angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
  if (angle < 0) angle += 360;
  return { length, angle };
}

function activeAngleInfo(start, end) {
  const currentRad = angleBetweenPoints(start, end);
  const reference = nearestAngleReference(start, currentRad);
  if (!reference) {
    const deltaRad = normalizePositiveRad(currentRad);
    return {
      referenceRad: 0,
      deltaRad,
      degrees: Math.round(radToDeg(deltaRad)),
      hasReference: false,
    };
  }
  const deltaRad = signedAngleDelta(reference.angleRad, currentRad);
  return {
    referenceRad: reference.angleRad,
    deltaRad,
    degrees: Math.round(Math.abs(radToDeg(deltaRad))),
    hasReference: true,
  };
}

function nearestAngleReference(origin, currentRad) {
  const threshold = Math.max(220, 42 / state.view.scale);
  let best = null;
  for (const segment of angleReferenceSegments()) {
    const d1 = distanceWorld(origin, segment.p1);
    const d2 = distanceWorld(origin, segment.p2);
    if (d1 <= threshold) {
      best = closerAngleReference(best, segmentAngle(segment.p1, segment.p2), d1, currentRad);
    }
    if (d2 <= threshold) {
      best = closerAngleReference(best, segmentAngle(segment.p2, segment.p1), d2, currentRad);
    }

    const hit = projectPointToSegmentWorld(origin, segment.p1, segment.p2);
    if (hit.distance <= threshold * 0.65) {
      const angle = segmentAngle(segment.p1, segment.p2);
      best = closerAngleReference(best, angle, hit.distance + 90, currentRad);
      best = closerAngleReference(best, angle + Math.PI, hit.distance + 90, currentRad);
    }
  }
  return best;
}

function closerAngleReference(best, angleRad, distanceScore, currentRad) {
  const angleScore = Math.abs(signedAngleDelta(angleRad, currentRad)) * 24;
  const candidate = { angleRad, score: distanceScore + angleScore };
  return !best || candidate.score < best.score ? candidate : best;
}

function angleReferenceSegments() {
  const segments = [];
  for (const entity of state.entities) {
    if (!isLayerVisible(entity.layer) || entity.layer === "dimensions") continue;
    if (entity.type === "block") {
      for (const segment of blockSegments(entity)) {
        segments.push({ p1: { x: segment.x1, y: segment.y1 }, p2: { x: segment.x2, y: segment.y2 } });
      }
      continue;
    }
    if (entity.type === "line" || entity.type === "wall") {
      segments.push({ p1: { x: entity.x1, y: entity.y1 }, p2: { x: entity.x2, y: entity.y2 } });
    }
  }
  return segments.filter((segment) => distanceWorld(segment.p1, segment.p2) > 1);
}

function angleBetweenPoints(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function segmentAngle(a, b) {
  return angleBetweenPoints(a, b);
}

function signedAngleDelta(fromRad, toRad) {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
}

function normalizePositiveRad(angleRad) {
  const full = Math.PI * 2;
  return ((angleRad % full) + full) % full;
}

function radToDeg(angleRad) {
  return (angleRad * 180) / Math.PI;
}

function distanceWorld(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function projectPointToSegmentWorld(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const projection = { x: a.x + t * dx, y: a.y + t * dy };
  return { ...projection, distance: distanceWorld(point, projection) };
}

function getPointer(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function rememberPointer(event) {
  state.activePointers.set(event.pointerId, getPointer(event));
}

function forgetPointer(event) {
  state.activePointers.delete(event.pointerId);
}

function activePointerPair() {
  const points = [...state.activePointers.values()];
  if (points.length < 2) return null;
  return [points[0], points[1]];
}

function midpointScreen(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampScale(scale) {
  return Math.min(0.28, Math.max(0.035, scale));
}

function zoomAtScreen(screen, nextScale) {
  const before = screenToWorld(screen);
  state.view.scale = clampScale(nextScale);
  const after = worldToScreen(before);
  state.view.panX += screen.x - after.x;
  state.view.panY += screen.y - after.y;
}

function beginPinchGesture() {
  const pair = activePointerPair();
  if (!pair) return;
  finishPointerMoveUndo();
  const [a, b] = pair;
  const midpoint = midpointScreen(a, b);
  state.pointer = null;
  state.pinch = {
    distance: Math.max(1, pointDistance(a, b)),
    scale: state.view.scale,
    worldAtMidpoint: screenToWorld(midpoint),
  };
  state.gestureSuppressTap = true;
  statusChip.textContent = "Масштаб двумя пальцами";
}

function updatePinchGesture() {
  if (!state.pinch) return;
  const pair = activePointerPair();
  if (!pair) return;
  const [a, b] = pair;
  const midpoint = midpointScreen(a, b);
  const distance = Math.max(1, pointDistance(a, b));
  const nextScale = clampScale(state.pinch.scale * (distance / state.pinch.distance));
  state.view.scale = nextScale;
  state.view.panX = midpoint.x - state.pinch.worldAtMidpoint.x * nextScale;
  state.view.panY = midpoint.y - state.pinch.worldAtMidpoint.y * nextScale;
  const percent = Math.round((state.view.scale / 0.085) * 100);
  statusChip.textContent = `Масштаб ${percent}%`;
  draw();
}

function endPinchGestureIfNeeded() {
  if (state.activePointers.size >= 2) {
    beginPinchGesture();
    return;
  }
  state.pinch = null;
}

function snapWorld(point) {
  return resolveSnapWorld(point).point;
}

function resolveSnapWorld(point) {
  const objectThreshold = (state.tool === "dimension" ? 34 : 24) / state.view.scale;
  const midpointThreshold = 22 / state.view.scale;
  const trackingThreshold = 18 / state.view.scale;
  const useObjectSnap = state.tool === "dimension" || state.snaps.has("end");
  let result = { ...point };
  let snap = null;
  state.snapTracking.active = null;

  if (useObjectSnap) {
    snap = nearestSnapCandidate(point, snapCandidates({ includeCorners: true }), objectThreshold);
  }
  if (!snap && state.snaps.has("mid")) {
    snap = nearestSnapCandidate(point, snapCandidates({ includeMidpoints: true, includeCenters: true }), midpointThreshold);
  }
  if (snap) {
    result = { x: snap.x, y: snap.y };
  } else if (canUseSnapTracking()) {
    snap = nearestSnapTrackingPoint(point, trackingThreshold);
    if (snap) {
      result = { x: snap.x, y: snap.y };
      state.snapTracking.active = snap;
    }
  } else if (state.snaps.has("grid")) {
    result.x = Math.round(result.x / 50) * 50;
    result.y = Math.round(result.y / 50) * 50;
  }
  if (!snap && state.drawing && state.drawing.phase !== "offset" && state.snaps.has("polar")) {
    result = snapPolar(result, state.drawing.start);
  }
  return { point: result, snap };
}

function nearestEndpoint(point, threshold) {
  return nearestSnapCandidate(point, snapCandidates({ includeCorners: true }), threshold);
}

function nearestMidpoint(point, threshold) {
  return nearestSnapCandidate(point, snapCandidates({ includeMidpoints: true, includeCenters: true }), threshold);
}

function nearestSnapCandidate(point, candidates, threshold) {
  let best = null;
  let bestDistance = threshold;
  for (const candidate of candidates) {
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function snapCandidates({ includeCorners = false, includeMidpoints = false, includeCenters = false } = {}) {
  const candidates = [];
  for (const entity of state.entities) {
    if (!isLayerVisible(entity.layer) || entity.layer === "dimensions") continue;
    if (entity.type === "block") {
      if (includeCorners) {
        for (const corner of blockCorners(entity)) {
          candidates.push({ ...corner, label: "Угол" });
        }
      }
      if (includeCenters) {
        candidates.push({ x: entity.x, y: entity.y, label: "Центр" });
      }
      continue;
    }
    if (includeCorners) {
      candidates.push({ x: entity.x1, y: entity.y1, label: entity.type === "wall" ? "Угол" : "Конец" });
      candidates.push({ x: entity.x2, y: entity.y2, label: entity.type === "wall" ? "Угол" : "Конец" });
    }
    if (includeMidpoints) {
      candidates.push({
        x: (entity.x1 + entity.x2) / 2,
        y: (entity.y1 + entity.y2) / 2,
        label: "Середина",
      });
    }
  }
  return candidates.map((candidate) => attachSnapReference(candidate));
}

function attachSnapReference(candidate) {
  if (candidate.entityId) return candidate;
  const ref = nearestObjectPointRef(candidate);
  return ref ? { ...candidate, ...ref } : candidate;
}

function dimensionRefFromSnap(snap) {
  if (!snap?.entityId || !snap?.pointKey) return null;
  return { entityId: snap.entityId, pointKey: snap.pointKey };
}

function updateLinkedDimensions() {
  for (const entity of state.entities) {
    if (entity.layer !== "dimensions") continue;
    const nextStart = dimensionLinkedPoint(entity.refStart);
    const nextEnd = dimensionLinkedPoint(entity.refEnd);
    if (!nextStart && !nextEnd) continue;
    const previous = dimensionWorldGeometry(entity);
    if (nextStart) {
      entity.x1 = nextStart.x;
      entity.y1 = nextStart.y;
    }
    if (nextEnd) {
      entity.x2 = nextEnd.x;
      entity.y2 = nextEnd.y;
    }
    preserveDimensionLineOffset(entity, previous);
  }
}

function dimensionLinkedPoint(ref) {
  if (!ref) return null;
  const entity = state.entities.find((item) => item.id === ref.entityId);
  if (!entity) return null;
  return objectPointRefs(entity).find((point) => point.pointKey === ref.pointKey) || null;
}

function preserveDimensionLineOffset(entity, previous) {
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  const axis = normalizeWorldVector(previous.lineEnd.x - previous.lineStart.x, previous.lineEnd.y - previous.lineStart.y);
  if (!axis) return;
  const normal = { x: -axis.y, y: axis.x };
  const offsetStart = (previous.lineStart.x - start.x) * normal.x + (previous.lineStart.y - start.y) * normal.y;
  const offsetEnd = (previous.lineEnd.x - end.x) * normal.x + (previous.lineEnd.y - end.y) * normal.y;
  const startAnchor = {
    x: start.x + normal.x * offsetStart,
    y: start.y + normal.y * offsetStart,
  };
  const endAnchor = {
    x: end.x + normal.x * offsetEnd,
    y: end.y + normal.y * offsetEnd,
  };
  entity.dimX1 = startAnchor.x;
  entity.dimY1 = startAnchor.y;
  entity.dimX2 = endAnchor.x;
  entity.dimY2 = endAnchor.y;
  entity.offset = dimensionOffsetFromPoint(start, end, startAnchor);
}

function nearestObjectPointRef(point) {
  let best = null;
  for (const entity of state.entities) {
    if (!isLayerVisible(entity.layer) || entity.layer === "dimensions") continue;
    for (const candidate of objectPointRefs(entity)) {
      const distance = distanceWorld(point, candidate);
      if (distance > 2) continue;
      if (!best || distance < best.distance) {
        best = { entityId: entity.id, pointKey: candidate.pointKey, distance };
      }
    }
  }
  return best ? { entityId: best.entityId, pointKey: best.pointKey } : null;
}

function objectPointRefs(entity) {
  if (entity.type === "block") {
    return [
      ...blockCorners(entity).map((corner, index) => ({ ...corner, pointKey: `corner-${index}` })),
      { x: entity.x, y: entity.y, pointKey: "center" },
    ];
  }
  return [
    { x: entity.x1, y: entity.y1, pointKey: "start" },
    { x: entity.x2, y: entity.y2, pointKey: "end" },
    { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2, pointKey: "mid" },
  ];
}

function blockCorners(entity) {
  const size = entitySize(entity);
  const w = size.width;
  const h = size.height;
  return [
    transformBlockPoint(entity, -w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, h / 2),
    transformBlockPoint(entity, -w / 2, h / 2),
  ];
}

function snapPolar(point, start) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return point;
  const step = Math.PI / 4;
  const threshold = (7 * Math.PI) / 180;
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / step) * step;
  const delta = Math.abs(Math.atan2(Math.sin(angle - snappedAngle), Math.cos(angle - snappedAngle)));
  if (delta > threshold) return point;
  return {
    x: start.x + Math.cos(snappedAngle) * length,
    y: start.y + Math.sin(snappedAngle) * length,
  };
}

function setTool(tool) {
  state.tool = tool;
  state.drawing = null;
  if (tool !== "dimension") {
    resetSnapTracking();
  }
  if (tool !== "select" && tool !== "furniture") {
    state.furnitureEditId = null;
  }
  shell.dataset.tool = tool;
  tools.forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  const copy = {
    select: "Выбор: коснитесь объекта. Мебель двигается только через «Редактировать»",
    line: "Линия: подведите курсор и тапните холст",
    wall: "Стена: подведите курсор к началу и тапните холст",
    dimension: "Размер: подведите курсор к отрезку",
    furniture: "Мебель: тапните мебель на плане или перетащите блок из библиотеки",
  };
  statusChip.textContent = copy[tool];
  if (tool === "select") {
    statusChip.textContent = "Выбор: коснитесь объекта. Мебель двигается только через «Редактировать»";
  }
  if (tool === "dimension") {
    state.snaps.add("end");
    syncSnapButtons();
  }
  if (tool === "dimension") {
    statusChip.textContent = "Размер: 1 начало, 2 конец, 3 положение размерной линии";
  }
  draw();
}

function syncSnapButtons() {
  snaps.forEach((button) => button.classList.toggle("active", state.snaps.has(button.dataset.snap)));
}

function pushEntity(entity) {
  state.entities.push(entity);
  state.undo.push({ type: "add", entity });
  state.redo.length = 0;
  state.selectedId = entity.id;
  state.furnitureEditId = null;
}

function createEntityFromDrawing() {
  const { start, end } = state.drawing;
  const id = `${state.tool}-${Date.now()}`;
  if (state.tool === "wall") {
    return wall(id, start.x, start.y, end.x, end.y);
  }
  if (state.tool === "dimension") {
    const entity = line(id, start.x, start.y, end.x, end.y, "dimensions");
    entity.offset = state.drawing.offset ?? 360;
    if (state.drawing.refStart) entity.refStart = state.drawing.refStart;
    if (state.drawing.refEnd) entity.refEnd = state.drawing.refEnd;
    ensureDimensionLineGeometry(entity);
    return entity;
  }
  return line(id, start.x, start.y, end.x, end.y);
}

function commitCursorPoint() {
  const resolved = cursorSnapResolved();
  const world = resolved.point;
  if (state.tool === "dimension") {
    if (!state.drawing) {
      state.drawing = { start: world, end: world, lockedEnd: false, phase: "end", refStart: dimensionRefFromSnap(resolved.snap) };
      statusChip.textContent = "Размер: начало поставлено. Поставьте вторую точку";
    } else if (state.drawing.phase === "end") {
      const end = state.drawing.lockedEnd ? state.drawing.end : world;
      state.drawing.end = end;
      state.drawing.refEnd = dimensionRefFromSnap(resolved.snap);
      state.drawing.lockedEnd = true;
      state.drawing.phase = "offset";
      const metrics = segmentMetrics(state.drawing.start.x, state.drawing.start.y, end.x, end.y);
      if (metrics.length <= 0) {
        state.drawing = null;
        resetSnapTracking();
        statusChip.textContent = "Размер: точки совпали, начните заново";
      } else {
        statusChip.textContent = "Размер: поставьте третью точку для положения размерной линии";
      }
    } else if (state.drawing.phase === "offset") {
      const offset = dimensionOffsetFromPoint(state.drawing.start, state.drawing.end, world);
      state.drawing.offset = Math.abs(offset) < 60 ? (offset < 0 ? -260 : 260) : offset;
      const metrics = segmentMetrics(state.drawing.start.x, state.drawing.start.y, state.drawing.end.x, state.drawing.end.y);
      pushEntity(createEntityFromDrawing());
      state.drawing = null;
      resetSnapTracking();
      statusChip.textContent = `Размер ${metrics.length} мм завершен`;
    }
    draw();
    return;
  }
  if (state.tool === "line" || state.tool === "wall") {
    if (!state.drawing) {
      state.drawing = { start: world, end: world, lockedEnd: false };
      statusChip.textContent = "Начало поставлено. Подведите курсор дальше и тапните холст";
    } else {
      const end = state.drawing.lockedEnd ? state.drawing.end : world;
      state.drawing.end = end;
      const metrics = segmentMetrics(state.drawing.start.x, state.drawing.start.y, end.x, end.y);
      if (metrics.length > 0) {
        pushEntity(createEntityFromDrawing());
        statusChip.textContent = `${state.tool === "wall" ? "Стена" : "Линия"} ${metrics.length} мм · ${metrics.angle}°`;
      }
      if (state.tool === "line") {
        state.drawing = null;
        statusChip.textContent = `Линия ${metrics.length} мм · ${metrics.angle}° завершена`;
      } else {
        state.drawing = { start: end, end, lockedEnd: false };
      }
    }
  } else {
    state.selectedId = pickEntity(centerScreen()) || state.selectedId;
    statusChip.textContent = state.selectedId ? "Элемент выбран курсором" : "Подведите курсор к элементу";
  }
  if (!state.drawing && state.tool === "dimension") {
    const length = Number(lengthInput.value) || 0;
    statusChip.textContent = `Размер ${length} мм завершен`;
  }
  draw();
}

function applyExactInput() {
  const base = state.drawing?.start || selectedEndPoint();
  if (!base) return;
  const length = Number(lengthInput.value.replace(",", "."));
  const angle = Number(angleInput.value.replace(",", "."));
  if (!Number.isFinite(length) || !Number.isFinite(angle)) return;
  const radians = (angle * Math.PI) / 180;
  const end = {
    x: base.x + Math.cos(radians) * length,
    y: base.y + Math.sin(radians) * length,
  };
  if (state.drawing) {
    state.drawing.end = end;
    if (state.tool === "dimension") {
      state.drawing.lockedEnd = true;
      state.drawing.phase = "offset";
      statusChip.textContent = "Размер: поставьте третью точку для положения размерной линии";
      draw();
      return;
    }
    pushEntity(createEntityFromDrawing());
    state.drawing = { start: end, end, lockedEnd: false };
  } else if (false && state.pointer.mode === "dimension-offset" && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity) {
      setDimensionLineOffset(entity, dimensionOffsetFromPoint(
        { x: entity.x1, y: entity.y1 },
        { x: entity.x2, y: entity.y2 },
        screenToWorld(screen),
      ));
      statusChip.textContent = `Вынос размера ${Math.round(Math.abs(entity.offset))} мм`;
    }
  } else if (false && (state.pointer.mode === "dimension-start" || state.pointer.mode === "dimension-end") && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity) {
      const endpoint = state.pointer.mode === "dimension-start" ? "start" : "end";
      moveDimensionHandle(entity, endpoint, screenToWorld(screen));
      const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
      const visibleLength = dimensionDisplayLength(entity);
      statusChip.textContent = `Размер ${dimensionDisplayLength(entity)} мм`;
    }
  } else {
    const id = `line-${Date.now()}`;
    pushEntity(line(id, base.x, base.y, end.x, end.y));
  }
  draw();
}

function selectedEndPoint() {
  const selected = state.entities.find((entity) => entity.id === state.selectedId);
  if (!selected || selected.type === "block") return { x: 0, y: 0 };
  return { x: selected.x2, y: selected.y2 };
}

function hitFurnitureControl(screen) {
  if (state.tool !== "select" && state.tool !== "furniture") return null;
  const entity = state.entities.find((item) => item.id === state.selectedId && item.type === "block");
  if (!entity || !isLayerVisible(entity.layer)) return null;
  const layout = furnitureControlLayout(entity);
  if (!layout) return null;

  if (layout.editing) {
    if (rectContainsPoint(screen, layout.done)) return { type: "done", entity, layout };
    if (pointDistance(screen, layout.rotate) <= 24) return { type: "rotate", entity, layout };
    for (const handle of layout.handles) {
      if (pointDistance(screen, handle) <= 20) {
        return { type: "resize", corner: handle.corner, entity, layout };
      }
    }
  } else if (rectContainsPoint(screen, layout.editButton)) {
    return { type: "edit", entity, layout };
  }
  return null;
}

function rectContainsPoint(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function beginFurnitureControl(control, event, screen) {
  state.selectedId = control.entity.id;
  if (control.type === "edit") {
    state.furnitureEditId = control.entity.id;
    state.pointer = { id: event.pointerId, mode: "ui", moved: true, targetId: null };
    statusChip.textContent = "Редактирование мебели: двигайте, тяните углы или крутите ручку";
    draw();
    return true;
  }
  if (control.type === "done") {
    state.furnitureEditId = null;
    state.pointer = { id: event.pointerId, mode: "ui", moved: true, targetId: null };
    statusChip.textContent = "Редактирование мебели завершено";
    draw();
    return true;
  }

  const entity = control.entity;
  const centerScreenPoint = worldToScreen({ x: entity.x, y: entity.y });
  state.pointer = {
    id: event.pointerId,
    screen,
    startScreen: screen,
    world: screenToWorld(screen),
    moved: true,
    mode: control.type === "rotate" ? "furniture-rotate" : "furniture-resize",
    targetId: entity.id,
    before: entityGeometry(entity),
    corner: control.corner,
    startRotation: entity.rotation || 0,
    startAngle: Math.atan2(screen.y - centerScreenPoint.y, screen.x - centerScreenPoint.x),
  };
  statusChip.textContent = control.type === "rotate" ? "Поворот мебели" : "Изменение размера мебели";
  return true;
}

function resizeFurnitureByPointer(entity, screen) {
  const local = worldToBlockLocal(entity, screenToWorld(screen));
  entity.width = Math.max(300, Math.abs(local.x) * 2);
  entity.height = Math.max(300, Math.abs(local.y) * 2);
  statusChip.textContent = `${Math.round(entity.width)} × ${Math.round(entity.height)} мм`;
}

function rotateFurnitureByPointer(entity, screen) {
  const center = worldToScreen({ x: entity.x, y: entity.y });
  const angle = Math.atan2(screen.y - center.y, screen.x - center.x);
  const delta = radToDeg(angle - state.pointer.startAngle);
  const rawRotation = normalizeDegrees(state.pointer.startRotation + delta);
  entity.rotation = state.snaps.has("polar") ? Math.round(rawRotation / 15) * 15 : Math.round(rawRotation);
  statusChip.textContent = `Поворот ${Math.round(entity.rotation)}°`;
}

function worldToBlockLocal(entity, point) {
  const radians = -((entity.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - entity.x;
  const dy = point.y - entity.y;
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic or interrupted pointer streams can be missing capture state.
  }
  rememberPointer(event);
  if (state.activePointers.size >= 2) {
    beginPinchGesture();
    return;
  }
  state.gestureSuppressTap = false;
  const screen = getPointer(event);
  const furnitureControl = hitFurnitureControl(screen);
  if (furnitureControl && beginFurnitureControl(furnitureControl, event, screen)) {
    return;
  }
  const dimensionControl = hitDimensionControl(screen);
  if (dimensionControl) {
    const hitEntity = dimensionControl.entity;
    state.selectedId = hitEntity.id;
    state.furnitureEditId = null;
    state.pointer = {
      id: event.pointerId,
      screen,
      startScreen: screen,
      world: screenToWorld(screen),
      moved: false,
      mode: dimensionControl.type,
      targetId: hitEntity.id,
      before: entityGeometry(hitEntity),
    };
    statusChip.textContent =
      dimensionControl.type === "dimension-offset"
        ? "Размер: меняйте только расстояние размерной линии от объекта"
        : "Размер: тяните конец только вдоль оси размера";
    draw();
    return;
  }
  const hitId = state.tool === "select" ? pickEntity(screen) : state.tool === "furniture" ? pickFurnitureEntity(screen) : null;
  const hitEntity = hitId ? state.entities.find((entity) => entity.id === hitId) : null;
  const canMoveFurniture = hitEntity?.type === "block" && state.furnitureEditId === hitId;
  const pointerMode =
    hitEntity?.type === "block" && !canMoveFurniture
      ? "pan"
      : hitEntity?.layer === "dimensions"
        ? "dimension-offset"
        : hitId
          ? "move"
          : "pan";
  state.pointer = {
    id: event.pointerId,
    screen,
    startScreen: screen,
    world: screenToWorld(screen),
    moved: false,
    mode: pointerMode,
    targetId: hitId,
    before: hitEntity ? entityGeometry(hitEntity) : null,
  };
  if (hitId) {
    state.dimensionPickCycle = null;
    state.selectedId = hitId;
    if (hitEntity?.type === "block") {
      if (state.furnitureEditId && state.furnitureEditId !== hitId) state.furnitureEditId = null;
      statusChip.textContent = canMoveFurniture ? "Редактирование мебели" : "Мебель выбрана. Нажмите «Редактировать»";
      draw();
      return;
    }
    state.furnitureEditId = null;
    statusChip.textContent = "Элемент выбран. Тяните пальцем для перемещения";
    draw();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.activePointers.has(event.pointerId)) return;
  rememberPointer(event);
  if (state.activePointers.size >= 2) {
    if (!state.pinch) beginPinchGesture();
    updatePinchGesture();
    return;
  }
  if (state.pinch || state.gestureSuppressTap || !state.pointer || state.pointer.id !== event.pointerId) return;
  const isDragging = event.buttons === 1 || event.pointerType === "touch";
  if (!isDragging) return;
  const screen = getPointer(event);
  const travel = Math.hypot(screen.x - state.pointer.startScreen.x, screen.y - state.pointer.startScreen.y);
  if (travel > 3) state.pointer.moved = true;
  if (state.pointer.mode === "furniture-resize" && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity?.type === "block") {
      resizeFurnitureByPointer(entity, screen);
    }
  } else if (state.pointer.mode === "furniture-rotate" && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity?.type === "block") {
      rotateFurnitureByPointer(entity, screen);
    }
  } else if (state.pointer.mode === "move" && state.pointer.targetId) {
    const currentWorld = screenToWorld(screen);
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity) {
      moveEntityBy(entity, currentWorld.x - state.pointer.world.x, currentWorld.y - state.pointer.world.y);
      state.pointer.world = currentWorld;
      statusChip.textContent = "Перемещение объекта";
    }
  } else if (state.pointer.mode === "dimension-offset" && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity) {
      moveDimensionLineOffset(entity, screenToWorld(screen));
      statusChip.textContent = `Вынос размера ${Math.round(Math.abs(entity.offset))} мм`;
    }
  } else if ((state.pointer.mode === "dimension-start" || state.pointer.mode === "dimension-end") && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity) {
      const endpoint = state.pointer.mode === "dimension-start" ? "start" : "end";
      moveDimensionHandle(entity, endpoint, screenToWorld(screen));
      const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
      statusChip.textContent = `Размер ${dimensionDisplayLength(entity)} мм`;
    }
  } else {
    state.dimensionSnapHint = null;
    state.view.panX += screen.x - state.pointer.screen.x;
    state.view.panY += screen.y - state.pointer.screen.y;
  }
  state.pointer.screen = screen;
  draw();
});

canvas.addEventListener("pointerup", finishCanvasPointer);
canvas.addEventListener("pointercancel", (event) => finishCanvasPointer(event, true));

function finishCanvasPointer(event, canceled = false) {
  const wasPinching = Boolean(state.pinch) || state.activePointers.size > 1 || state.gestureSuppressTap;
  forgetPointer(event);
  releaseCanvasPointer(event);
  if (wasPinching) {
    endPinchGestureIfNeeded();
    if (state.activePointers.size === 0) {
      state.gestureSuppressTap = false;
    }
    return;
  }
  if (canceled || !state.pointer || state.pointer.id !== event.pointerId) {
    if (state.activePointers.size === 0) {
      state.gestureSuppressTap = false;
      state.pointer = null;
      state.dimensionSnapHint = null;
    }
    return;
  }
  if (state.pointer && !state.pointer.moved) {
    if (state.tool === "select") {
      const hitId = state.pointer.targetId || pickEntity(state.pointer.startScreen);
      const hitEntity = hitId ? state.entities.find((entity) => entity.id === hitId) : null;
      if (!hitId && state.furnitureEditId) {
        statusChip.textContent = "Нажмите галочку, чтобы закончить редактирование мебели";
      } else {
        state.selectedId = hitId;
        if (hitEntity?.type === "block") {
          if (state.furnitureEditId && state.furnitureEditId !== hitId) state.furnitureEditId = null;
          statusChip.textContent = "Мебель выбрана. Нажмите «Редактировать»";
        } else {
          state.furnitureEditId = null;
          statusChip.textContent = hitId ? "Элемент выбран" : "Выбор: коснитесь объекта или тяните пустое место для панорамы";
        }
      }
      draw();
    } else if (state.tool === "furniture") {
      const hitId = state.pointer.targetId || pickFurnitureEntity(state.pointer.startScreen);
      if (!hitId && state.furnitureEditId) {
        statusChip.textContent = "Нажмите галочку, чтобы закончить редактирование мебели";
      } else {
        if (state.furnitureEditId && state.furnitureEditId !== hitId) state.furnitureEditId = null;
        state.selectedId = hitId;
        statusChip.textContent = hitId ? "Мебель выбрана. Нажмите «Редактировать»" : "Перетащите блок из библиотеки на план";
      }
      draw();
    } else {
      commitCursorPoint();
    }
  } else {
    finishPointerMoveUndo();
  }
  state.pointer = null;
  state.dimensionSnapHint = null;
  if (state.activePointers.size === 0) {
    state.gestureSuppressTap = false;
  }
  draw();
}

function finishPointerMoveUndo() {
  const trackedModes = new Set(["move", "furniture-resize", "furniture-rotate", "dimension-offset", "dimension-start", "dimension-end"]);
  if (!trackedModes.has(state.pointer?.mode) || !state.pointer.targetId) return;
  const entity = state.entities.find((item) => item.id === state.pointer.targetId);
  if (entity && state.pointer.before) {
    const after = entityGeometry(entity);
    if (geometryChanged(state.pointer.before, after)) {
      state.undo.push({ type: "move", entityId: entity.id, before: state.pointer.before, after });
      state.redo.length = 0;
      statusChip.textContent = "Элемент перемещен";
    }
  }
  state.pointer.before = null;
}

function releaseCanvasPointer(event) {
  try {
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  } catch {
    // Pointer capture can already be released by the browser.
  }
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const screen = getPointer(event);
  const zoom = event.deltaY < 0 ? 1.08 : 0.92;
  zoomAtScreen(screen, state.view.scale * zoom);
  draw();
}, { passive: false });

function moveEntityBy(entity, dx, dy) {
  if (!entity) return;
  if (entity.type === "block") {
    entity.x += dx;
    entity.y += dy;
    return;
  }
  entity.x1 += dx;
  entity.y1 += dy;
  entity.x2 += dx;
  entity.y2 += dy;
}

function moveDimensionEndpointOnAxis(entity, endpoint, point) {
  const fixed =
    endpoint === "start"
      ? { x: entity.x2, y: entity.y2 }
      : { x: entity.x1, y: entity.y1 };
  const moving =
    endpoint === "start"
      ? { x: entity.x1, y: entity.y1 }
      : { x: entity.x2, y: entity.y2 };
  const dx = moving.x - fixed.x;
  const dy = moving.y - fixed.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const ux = dx / length;
  const uy = dy / length;
  const rawProjected = (point.x - fixed.x) * ux + (point.y - fixed.y) * uy;
  const projected = Math.abs(rawProjected) < 50 ? (rawProjected < 0 ? -50 : 50) : rawProjected;
  const next = { x: fixed.x + ux * projected, y: fixed.y + uy * projected };
  if (endpoint === "start") {
    entity.x1 = next.x;
    entity.y1 = next.y;
  } else {
    entity.x2 = next.x;
    entity.y2 = next.y;
  }
}

function moveDimensionHandle(entity, endpoint, handlePoint) {
  const geometry = ensureDimensionLineGeometry(entity);
  const fixedLine = endpoint === "start" ? geometry.lineEnd : geometry.lineStart;
  const movingLine = endpoint === "start" ? geometry.lineStart : geometry.lineEnd;
  const axis = normalizeWorldVector(movingLine.x - fixedLine.x, movingLine.y - fixedLine.y);
  if (!axis) return;
  const currentBase = endpoint === "start" ? geometry.start : geometry.end;
  const legAxis =
    normalizeWorldVector(movingLine.x - currentBase.x, movingLine.y - currentBase.y) ||
    normalizeWorldVector(-axis.y, axis.x);
  const nextBase = snapDimensionHandleToParallel(entity, handlePoint, legAxis || axis) || handlePoint;
  const nextRef = dimensionRefFromSnap(nearestSnapCandidate(nextBase, snapCandidates({ includeCorners: true, includeMidpoints: true, includeCenters: true }), 3));
  const projected = (nextBase.x - fixedLine.x) * axis.x + (nextBase.y - fixedLine.y) * axis.y;
  const minProjection = Math.abs(projected) < 50 ? (projected < 0 ? -50 : 50) : projected;
  const nextLine = {
    x: fixedLine.x + axis.x * minProjection,
    y: fixedLine.y + axis.y * minProjection,
  };
  if (endpoint === "start") {
    entity.dimX1 = nextLine.x;
    entity.dimY1 = nextLine.y;
    entity.x1 = nextBase.x;
    entity.y1 = nextBase.y;
    entity.refStart = nextRef;
  } else {
    entity.dimX2 = nextLine.x;
    entity.dimY2 = nextLine.y;
    entity.x2 = nextBase.x;
    entity.y2 = nextBase.y;
    entity.refEnd = nextRef;
  }
  entity.offset = dimensionOffsetFromPoint(
    { x: entity.x1, y: entity.y1 },
    { x: entity.x2, y: entity.y2 },
    endpoint === "start" ? { x: entity.dimX1, y: entity.dimY1 } : { x: entity.dimX2, y: entity.dimY2 },
  );
}

function snapDimensionHandleToParallel(entity, point, axis) {
  state.dimensionSnapHint = null;
  if (!state.snaps.has("end")) return null;
  const threshold = 34 / state.view.scale;
  let best = null;
  const pointSnap = nearestSnapCandidate(point, snapCandidates({ includeCorners: true }), threshold * 0.85);
  if (pointSnap) {
    best = {
      x: pointSnap.x,
      y: pointSnap.y,
      score: distanceWorld(point, pointSnap) - 12,
      type: "point",
    };
  }
  for (const segment of angleReferenceSegments()) {
    const segmentAxis = normalizeWorldVector(segment.p2.x - segment.p1.x, segment.p2.y - segment.p1.y);
    if (!segmentAxis) continue;
    const parallelScore = Math.abs(axis.x * segmentAxis.y - axis.y * segmentAxis.x);
    if (parallelScore > 0.12) continue;
    const hit = projectPointToSegmentWorld(point, segment.p1, segment.p2);
    if (hit.distance > threshold) continue;
    const score = hit.distance + parallelScore * 240;
    if (!best || score < best.score) {
      best = { x: hit.x, y: hit.y, score, segment, type: "line" };
    }
  }
  if (!best) return null;
  state.dimensionSnapHint = {
    type: best.type,
    point: { x: best.x, y: best.y },
    segment: best.segment,
  };
  return { x: best.x, y: best.y };
}

function dimensionBasePointFromHandle(entity, handlePoint) {
  const dx = entity.x2 - entity.x1;
  const dy = entity.y2 - entity.y1;
  const length = Math.hypot(dx, dy);
  if (length < 1) return handlePoint;
  const nx = -dy / length;
  const ny = dx / length;
  const offset = entity.offset ?? 360;
  return {
    x: handlePoint.x - nx * offset,
    y: handlePoint.y - ny * offset,
  };
}

function normalizeWorldVector(dx, dy) {
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  return { x: dx / length, y: dy / length };
}

function entityGeometry(entity) {
  if (!entity) return null;
  if (entity.type === "block") {
    return { x: entity.x, y: entity.y, width: entity.width, height: entity.height, rotation: entity.rotation || 0 };
  }
  const geometry = { x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2 };
  if (entity.layer === "dimensions") {
    geometry.offset = entity.offset ?? 360;
    if (Number.isFinite(entity.dimX1)) {
      geometry.dimX1 = entity.dimX1;
      geometry.dimY1 = entity.dimY1;
      geometry.dimX2 = entity.dimX2;
      geometry.dimY2 = entity.dimY2;
    }
    if (entity.refStart) geometry.refStart = entity.refStart;
    if (entity.refEnd) geometry.refEnd = entity.refEnd;
  }
  return geometry;
}

function applyEntityGeometry(entity, geometry) {
  if (!entity || !geometry) return;
  Object.assign(entity, geometry);
}

function geometryChanged(before, after) {
  if (!before || !after) return false;
  return Object.keys(after).some((key) => Math.abs((after[key] || 0) - (before[key] || 0)) > 0.01);
}

function pickEntity(screen) {
  let best = null;
  let bestDistance = 18;
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (!isLayerVisible(entity.layer)) continue;
    if (entity.type === "block") {
      if (pointInsideBlock(screen, entity)) return entity.id;
      continue;
    }
    const dimensionGeometry = entity.layer === "dimensions" ? dimensionScreenGeometry(entity) : null;
    const p1 = dimensionGeometry?.a || worldToScreen({ x: entity.x1, y: entity.y1 });
    const p2 = dimensionGeometry?.b || worldToScreen({ x: entity.x2, y: entity.y2 });
    const distance = pointToSegmentDistance(screen, p1, p2);
    if (distance < bestDistance) {
      best = entity.id;
      bestDistance = distance;
    }
  }
  return best;
}

function pickFurnitureEntity(screen) {
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (entity.type !== "block" || !isLayerVisible(entity.layer)) continue;
    if (pointInsideBlock(screen, entity)) return entity.id;
  }
  return null;
}

function pointInsideBlock(screen, entity) {
  const world = screenToWorld(screen);
  const size = entitySize(entity);
  const radians = -((entity.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = world.x - entity.x;
  const dy = world.y - entity.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const hitPadding = 220;
  return Math.abs(localX) <= size.width / 2 + hitPadding && Math.abs(localY) <= size.height / 2 + hitPadding;
}

function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

tools.forEach((button) => {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    setTool(tool);
    if (tool === "furniture") {
      openFurnitureSheet();
    } else {
      hideSheet(furnitureSheet);
    }
  });
});

snaps.forEach((button) => {
  button.addEventListener("click", () => {
    const snap = button.dataset.snap;
    if (state.snaps.has(snap)) {
      state.snaps.delete(snap);
    } else {
      state.snaps.add(snap);
    }
    button.classList.toggle("active", state.snaps.has(snap));
    const names = {
      grid: "Сетка",
      end: "Конец",
      mid: "Середина",
      polar: "Траектория 0/45/90°",
    };
    statusChip.textContent = `${names[snap]}: ${state.snaps.has(snap) ? "включено" : "выключено"}`;
    draw();
  });
});

function furnitureCardData(card) {
  const kind = card.dataset.block;
  return {
    kind,
    width: Number(card.dataset.w) || defaultBlockSize(kind).width,
    height: Number(card.dataset.h) || defaultBlockSize(kind).height,
    title: card.querySelector("strong")?.textContent?.trim() || "Блок",
  };
}

function setActiveFurnitureCard(card) {
  const data = furnitureCardData(card);
  state.block = data.kind;
  state.blockSize = { width: data.width, height: data.height };
  blocks.forEach((blockButton) => blockButton.classList.toggle("active", blockButton === card));
  setTool("furniture");
}

function addFurnitureBlock(data, screen) {
  const world = screenToWorld(screen);
  const id = `${data.kind}-${Date.now()}`;
  pushEntity(block(id, data.kind, world.x, world.y, 0, { width: data.width, height: data.height }));
  statusChip.textContent = `${data.title} ${data.width} × ${data.height} поставлен`;
  draw();
}

function clientToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function isClientPointInCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sheetTop = furnitureSheet.hidden ? rect.bottom : furnitureSheet.getBoundingClientRect().top;
  const visibleBottom = Math.min(rect.bottom, sheetTop);
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= visibleBottom;
}

function beginFurnitureDrag(card, event) {
  if (card.hidden) return;
  const data = furnitureCardData(card);
  setActiveFurnitureCard(card);
  const preview = document.createElement("div");
  preview.className = "drag-preview";
  preview.innerHTML = `<strong>${data.title}</strong><small>${data.width} × ${data.height}</small>`;
  document.body.append(preview);
  card.classList.add("dragging");
  card.setPointerCapture?.(event.pointerId);
  state.furnitureDrag = {
    pointerId: event.pointerId,
    card,
    data,
    preview,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  updateFurnitureDrag(event);
  statusChip.textContent = "Тяните блок на план";
}

function updateFurnitureDrag(event) {
  const drag = state.furnitureDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const travel = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (travel > 4) drag.moved = true;
  drag.preview.style.left = `${event.clientX}px`;
  drag.preview.style.top = `${event.clientY}px`;
  drag.preview.classList.toggle("over-canvas", isClientPointInCanvas(event.clientX, event.clientY));
}

function finishFurnitureDrag(event) {
  const drag = state.furnitureDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  updateFurnitureDrag(event);
  const droppedOnCanvas = drag.moved && isClientPointInCanvas(event.clientX, event.clientY);
  if (droppedOnCanvas) {
    addFurnitureBlock(drag.data, clientToCanvas(event.clientX, event.clientY));
    state.suppressFurnitureClick = true;
    window.setTimeout(() => {
      state.suppressFurnitureClick = false;
    }, 250);
  } else if (!drag.moved) {
    statusChip.textContent = `${drag.data.title}: перетащите карточку на план`;
  } else {
    statusChip.textContent = "Отпустите блок над планом, чтобы поставить";
    state.suppressFurnitureClick = true;
    window.setTimeout(() => {
      state.suppressFurnitureClick = false;
    }, 250);
  }
  try {
    if (drag.card.hasPointerCapture?.(event.pointerId)) {
      drag.card.releasePointerCapture(event.pointerId);
    }
  } catch {
    // Browser pointer-capture state can already be cleared after cross-surface drags.
  }
  drag.card.classList.remove("dragging");
  drag.preview.remove();
  state.furnitureDrag = null;
}

blocks.forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    beginFurnitureDrag(button, event);
  });

  button.addEventListener("pointermove", (event) => {
    updateFurnitureDrag(event);
  });

  button.addEventListener("pointerup", (event) => {
    finishFurnitureDrag(event);
  });

  button.addEventListener("pointercancel", (event) => {
    finishFurnitureDrag(event);
  });

  button.addEventListener("click", () => {
    if (state.suppressFurnitureClick) return;
    setActiveFurnitureCard(button);
    statusChip.textContent = `${furnitureCardData(button).title}: перетащите карточку на план`;
  });
});

window.addEventListener("pointermove", updateFurnitureDrag);
window.addEventListener("pointerup", finishFurnitureDrag);
window.addEventListener("pointercancel", finishFurnitureDrag);

const furnitureSheetPositions = ["peek", "half", "full"];

function furnitureSheetHeightFor(position) {
  const shellHeight = shell.getBoundingClientRect().height || window.innerHeight || 844;
  const peek = 92;
  const full = Math.max(peek, shellHeight - 112);
  const half = Math.min(full, Math.max(260, Math.min(360, shellHeight * 0.46)));
  return { peek, half, full }[position] || half;
}

function nearestFurnitureSheetPosition(height) {
  let closest = "half";
  let closestDistance = Infinity;
  for (const position of furnitureSheetPositions) {
    const distance = Math.abs(height - furnitureSheetHeightFor(position));
    if (distance < closestDistance) {
      closest = position;
      closestDistance = distance;
    }
  }
  return closest;
}

function setFurnitureSheetPosition(position) {
  if (!furnitureSheetPositions.includes(position)) return;
  state.furnitureSheetPosition = position;
  furnitureSheet.dataset.position = position;
  furnitureSheet.style.height = "";
}

function cycleFurnitureSheetPosition() {
  const nextPosition = {
    peek: "half",
    half: "full",
    full: "peek",
  }[state.furnitureSheetPosition] || "half";
  setFurnitureSheetPosition(nextPosition);
}

function startFurnitureSheetDrag(event) {
  if (furnitureSheet.hidden) return;
  event.preventDefault();
  furnitureSheetHandle.setPointerCapture?.(event.pointerId);
  state.sheetDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startHeight: furnitureSheet.getBoundingClientRect().height,
    moved: false,
  };
  furnitureSheet.classList.add("resizing");
}

function updateFurnitureSheetDrag(event) {
  const drag = state.sheetDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const deltaY = drag.startY - event.clientY;
  if (Math.abs(deltaY) > 4) drag.moved = true;
  const minHeight = furnitureSheetHeightFor("peek");
  const maxHeight = furnitureSheetHeightFor("full");
  const height = Math.max(minHeight, Math.min(maxHeight, drag.startHeight + deltaY));
  furnitureSheet.style.height = `${Math.round(height)}px`;
}

function finishFurnitureSheetDrag(event) {
  const drag = state.sheetDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  updateFurnitureSheetDrag(event);
  const currentHeight = furnitureSheet.getBoundingClientRect().height;
  furnitureSheet.classList.remove("resizing");
  if (drag.moved) {
    setFurnitureSheetPosition(nearestFurnitureSheetPosition(currentHeight));
  } else {
    cycleFurnitureSheetPosition();
  }
  try {
    if (furnitureSheetHandle.hasPointerCapture?.(event.pointerId)) {
      furnitureSheetHandle.releasePointerCapture(event.pointerId);
    }
  } catch {
    // Pointer capture can be cleared by the browser when the finger leaves the surface.
  }
  state.sheetDrag = null;
}

furnitureSheetHandle.addEventListener("pointerdown", startFurnitureSheetDrag);
furnitureSheetHandle.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  cycleFurnitureSheetPosition();
});

window.addEventListener("pointermove", updateFurnitureSheetDrag);
window.addEventListener("pointerup", finishFurnitureSheetDrag);
window.addEventListener("pointercancel", finishFurnitureSheetDrag);

furnitureTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.furnitureTab = button.dataset.tab;
    furnitureTabs.forEach((tab) => tab.classList.toggle("active", tab === button));
    state.furnitureCategory = firstFurnitureCategoryForTab(state.furnitureTab);
    renderFurnitureCategories();
    renderFurnitureLibrary();
  });
});

furnitureCatsNav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (button) {
    state.furnitureCategory = button.dataset.category;
    renderFurnitureCategories();
    renderFurnitureLibrary();
  }
});

lengthInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  applyInlineValue("length");
  lengthInput.blur();
});
angleInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  applyInlineValue("angle");
  angleInput.blur();
});
lengthInput.addEventListener("blur", () => applyInlineValue("length"));
angleInput.addEventListener("blur", () => applyInlineValue("angle"));

keyboardInputs.forEach((input) => {
  input.addEventListener("focus", () => {
    shell.classList.add("input-focused");
    window.setTimeout(updateViewportLock, 40);
    window.setTimeout(updateViewportLock, 260);
  });
  input.addEventListener("blur", () => {
    shell.classList.remove("input-focused");
    window.setTimeout(updateViewportLock, 80);
  });
});

themeButton.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  shell.dataset.theme = state.theme;
  themeButton.textContent = state.theme === "light" ? "☾" : "☼";
  draw();
});

document.getElementById("undoButton").addEventListener("click", () => {
  const action = state.undo.pop();
  if (!action) return;
  if (action.type === "add") {
    state.entities = state.entities.filter((entity) => entity !== action.entity);
    state.redo.push(action);
    state.selectedId = state.entities.at(-1)?.id || null;
    draw();
  } else if (action.type === "move") {
    const entity = state.entities.find((item) => item.id === action.entityId);
    applyEntityGeometry(entity, action.before);
    state.redo.push(action);
    state.selectedId = action.entityId;
    draw();
  }
});

document.getElementById("redoButton").addEventListener("click", () => {
  const action = state.redo.pop();
  if (!action) return;
  if (action.type === "add") {
    state.entities.push(action.entity);
    state.undo.push(action);
    state.selectedId = action.entity.id;
    draw();
  } else if (action.type === "move") {
    const entity = state.entities.find((item) => item.id === action.entityId);
    applyEntityGeometry(entity, action.after);
    state.undo.push(action);
    state.selectedId = action.entityId;
    draw();
  }
});

document.getElementById("exportButton").addEventListener("click", () => {
  showSheet(exportSheet);
  statusChip.textContent = "Экспорт: выберите PDF, DXF, DWG или IFC";
});

document.getElementById("layersButton").addEventListener("click", () => {
  renderLayerList();
  showSheet(layersSheet);
  statusChip.textContent = "Слои: выключайте лишнее для скорости и чистоты";
});

document.getElementById("closeLayersButton").addEventListener("click", () => hideSheet(layersSheet));
document.getElementById("closeExportButton").addEventListener("click", () => hideSheet(exportSheet));

exportCards.forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.export;
    if (type === "dxf") {
      const dxf = buildDxf(state.entities.filter((entity) => isLayerVisible(entity.layer)));
      downloadFile("zamer-plan.dxf", dxf, "application/dxf");
      statusChip.textContent = "DXF экспортирован с включенными слоями";
      hideSheet(exportSheet);
      return;
    }
    const messages = {
      pdf: "PDF будет печатать лист с масштабом, рамкой и таблицей помещений",
      dwg: "DWG нужен через ODA SDK или серверную конвертацию из DXF",
      ifc: "IFC появится после семантических стен, дверей, окон и помещений",
    };
    statusChip.textContent = messages[type] || "Формат запланирован";
  });
});

function showSheet(sheet) {
  if (!sheet) return;
  hideSheet(layersSheet);
  hideSheet(exportSheet);
  hideSheet(furnitureSheet);
  sheet.hidden = false;
}

function hideSheet(sheet) {
  if (!sheet) return;
  if (sheet === furnitureSheet) {
    state.sheetDrag = null;
    furnitureSheet.classList.remove("resizing");
    furnitureSheet.style.height = "";
  }
  sheet.hidden = true;
}

function openFurnitureSheet() {
  renderFurnitureCategories();
  renderFurnitureLibrary();
  showSheet(furnitureSheet);
  setFurnitureSheetPosition("half");
  statusChip.textContent = "Выберите мебель на плане или перетащите блок из библиотеки";
}

function firstFurnitureCategoryForTab(tab) {
  return furnitureCategoriesByTab[tab]?.[0]?.id || blocks.find((card) => card.dataset.tab === tab)?.dataset.category || "sofas";
}

function renderFurnitureCategories() {
  if (!furnitureCatsNav) return;
  const categories = furnitureCategoriesByTab[state.furnitureTab] || [];
  if (!categories.some((category) => category.id === state.furnitureCategory)) {
    state.furnitureCategory = firstFurnitureCategoryForTab(state.furnitureTab);
  }
  furnitureCatsNav.replaceChildren(
    ...categories.map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category.id;
      button.classList.toggle("active", category.id === state.furnitureCategory);
      button.textContent = category.label;
      return button;
    })
  );
}

function renderFurnitureLibrary() {
  if (!furnitureCategoriesByTab[state.furnitureTab]?.some((category) => category.id === state.furnitureCategory)) {
    state.furnitureCategory = firstFurnitureCategoryForTab(state.furnitureTab);
    renderFurnitureCategories();
  }
  let visibleCards = 0;
  blocks.forEach((card) => {
    const visible = card.dataset.tab === state.furnitureTab && card.dataset.category === state.furnitureCategory;
    card.hidden = !visible;
    if (visible) visibleCards += 1;
  });
  if (visibleCards === 0) {
    const firstCard = blocks.find((card) => card.dataset.tab === state.furnitureTab);
    if (firstCard) {
      state.furnitureCategory = firstCard.dataset.category;
      renderFurnitureCategories();
      blocks.forEach((card) => {
        card.hidden = !(card.dataset.tab === state.furnitureTab && card.dataset.category === state.furnitureCategory);
      });
    }
  }
}

function renderLayerList() {
  if (!layerList) return;
  layerList.replaceChildren();
  for (const [id, meta] of Object.entries(layerMeta)) {
    const count = state.entities.filter((entity) => (entity.layer || "measure") === id).length;
    const item = document.createElement("label");
    item.className = "layer-item";
    item.innerHTML = `
      <i class="layer-color" style="background:${meta.color}"></i>
      <span><strong>${meta.name}</strong><span>${meta.description} · ${count} объектов</span></span>
      <input class="layer-switch" type="checkbox" ${state.visibleLayers.has(id) ? "checked" : ""} />
    `;
    const input = item.querySelector("input");
    input.addEventListener("change", () => {
      if (input.checked) {
        state.visibleLayers.add(id);
      } else {
        state.visibleLayers.delete(id);
      }
      if (state.selectedId) {
        const selected = state.entities.find((entity) => entity.id === state.selectedId);
        if (selected && !isLayerVisible(selected.layer)) state.selectedId = null;
      }
      draw();
      renderLayerList();
      statusChip.textContent = `${meta.name}: ${input.checked ? "включен" : "скрыт"}`;
    });
    layerList.appendChild(item);
  }
}

window.addEventListener("resize", updateViewportLock);
window.addEventListener("orientationchange", () => {
  stableViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || stableViewportHeight);
  window.setTimeout(updateViewportLock, 250);
});
window.addEventListener("scroll", lockDocumentScroll, { passive: true });
window.visualViewport?.addEventListener("resize", updateViewportLock);
window.visualViewport?.addEventListener("scroll", updateViewportLock);
updateViewportLock();
setTool("line");
window.zamerDebug = {
  exportDxf: () => buildDxf(state.entities),
  entityCount: () => state.entities.length,
};

function buildDxf(entities) {
  const lines = [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$INSUNITS",
    "70", "4",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "TABLES",
    "0", "TABLE",
    "2", "LAYER",
    "70", "4",
    ...dxfLayer("walls", 7),
    ...dxfLayer("dimensions", 5),
    ...dxfLayer("furniture", 3),
    ...dxfLayer("measure", 4),
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "ENTITIES",
  ];

  for (const entity of entities) {
    if (entity.type === "wall") {
      const offset = offsetWall(entity, entity.width / 2);
      lines.push(...dxfLine(offset.a.x1, offset.a.y1, offset.a.x2, offset.a.y2, "walls"));
      lines.push(...dxfLine(offset.b.x1, offset.b.y1, offset.b.x2, offset.b.y2, "walls"));
      lines.push(...dxfLine(entity.x1, entity.y1, entity.x2, entity.y2, "walls"));
    } else if (entity.type === "line") {
      lines.push(...dxfLine(entity.x1, entity.y1, entity.x2, entity.y2, entity.layer));
    } else if (entity.type === "block") {
      for (const segment of blockSegments(entity)) {
        lines.push(...dxfLine(segment.x1, segment.y1, segment.x2, segment.y2, "furniture"));
      }
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

function dxfLayer(name, color) {
  return ["0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS"];
}

function dxfLine(x1, y1, x2, y2, layer) {
  return [
    "0", "LINE",
    "8", layer || "measure",
    "10", roundDxf(x1),
    "20", roundDxf(-y1),
    "30", "0",
    "11", roundDxf(x2),
    "21", roundDxf(-y2),
    "31", "0",
  ];
}

function roundDxf(value) {
  return String(Math.round(value * 1000) / 1000);
}

function offsetWall(entity, distance) {
  const dx = entity.x2 - entity.x1;
  const dy = entity.y2 - entity.y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * distance;
  const ny = (dx / length) * distance;
  return {
    a: { x1: entity.x1 + nx, y1: entity.y1 + ny, x2: entity.x2 + nx, y2: entity.y2 + ny },
    b: { x1: entity.x1 - nx, y1: entity.y1 - ny, x2: entity.x2 - nx, y2: entity.y2 - ny },
  };
}

function blockSegments(entity) {
  const size = entitySize(entity);
  const w = size.width;
  const h = size.height;
  const corners = [
    transformBlockPoint(entity, -w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, h / 2),
    transformBlockPoint(entity, -w / 2, h / 2),
  ];
  return [
    { x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y },
    { x1: corners[1].x, y1: corners[1].y, x2: corners[2].x, y2: corners[2].y },
    { x1: corners[2].x, y1: corners[2].y, x2: corners[3].x, y2: corners[3].y },
    { x1: corners[3].x, y1: corners[3].y, x2: corners[0].x, y2: corners[0].y },
  ];
}

function transformBlockPoint(entity, x, y) {
  const radians = (entity.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: entity.x + x * cos - y * sin,
    y: entity.y + x * sin + y * cos,
  };
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

import { radToDeg, normalizeDegrees, normalizeAnglePositive, offsetWall, transformBlockPoint, distanceWorld, angleBetweenPoints, arcGeometry, segmentMetrics, normalizeScreenVector, entityBounds, pointInSelectionRect, rectEdges, segmentsIntersect, pointInPolygon, pointToSegmentDistance } from "./core/geometry.js";
import { defaultBlockSize, entitySize, blockSegments } from "./core/blocks.js";
import { buildDxf } from "./core/dxf.js";

const canvas = document.getElementById("cadCanvas");
const ctx = canvas.getContext("2d");
const shell = document.querySelector(".app-shell");
const centerCursor = document.querySelector(".center-cursor");
const projectScaleCaption = document.querySelector(".project-title span");
const tools = [...document.querySelectorAll(".tool")];
const drawToolMenu = document.getElementById("drawToolMenu");
const drawToolButtons = [...document.querySelectorAll("[data-draw-tool]")];
const dimensionToolMenu = createDimensionToolMenu();
const dimensionToolButtons = [...dimensionToolMenu.querySelectorAll("[data-dimension-tool]")];
const selectToolMenu = document.getElementById("selectToolMenu");
const selectModeMenu = createSelectModeMenu();
const selectToolButtons = [...document.querySelectorAll("[data-select-tool]")];
const snaps = [...document.querySelectorAll(".snap")];
let blocks = [...document.querySelectorAll(".block")];
const lengthInput = document.getElementById("lengthInput");
const angleInput = document.getElementById("angleInput");
const inlineEditors = document.getElementById("inlineEditors");
const leaderTextEditor = document.getElementById("leaderTextEditor");
const leaderTextInput = document.getElementById("leaderTextInput");
const drawMetrics = document.getElementById("drawMetrics");
const topLengthInput = document.getElementById("topLengthInput");
const topAngleInput = document.getElementById("topAngleInput");
const selectionActions = selectToolMenu;
const lengthEditor = document.getElementById("lengthEditor");
const angleEditor = document.getElementById("angleEditor");
const furnitureSizePanel = document.getElementById("furnitureSizePanel");
const furnitureWidthInput = document.getElementById("furnitureWidthInput");
const furnitureDepthInput = document.getElementById("furnitureDepthInput");
const furnitureRotationInput = document.getElementById("furnitureRotationInput");
const keyboardConfirmButton = document.getElementById("keyboardConfirmButton");
const themeButton = document.getElementById("themeButton");
const annotationScaleSelect = document.getElementById("annotationScaleSelect");
const statusChip = document.getElementById("statusChip");
const layersSheet = document.getElementById("layersSheet");
const exportSheet = document.getElementById("exportSheet");
const furnitureSheet = document.getElementById("furnitureSheet");
const layerList = document.getElementById("layerList");
const exportCards = [...document.querySelectorAll(".export-card")];
const furnitureTabs = [...document.querySelectorAll(".furniture-tab")];
const furnitureCatsNav = document.querySelector(".furniture-cats");
const furnitureGrid = document.getElementById("furnitureGrid");
const furnitureSheetHandle = furnitureSheet.querySelector(".sheet-handle");
const furniturePeekButton = furnitureSheet.querySelector(".furniture-peek-button");
const symbolBasePath = "./assets/floor-symbols/";
const libraryCatalogPath = "./assets/library/catalog.json";
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
const keyboardInputs = [lengthInput, angleInput, topLengthInput, topAngleInput, furnitureWidthInput, furnitureDepthInput, furnitureRotationInput, leaderTextInput].filter(Boolean);
let stableViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 844);
const cp1251Chars =
  "\u0402\u0403\u201A\u0453\u201E\u2026\u2020\u2021\u20AC\u2030\u0409\u2039\u040A\u040C\u040B\u040F" +
  "\u0452\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u0098\u2122\u0459\u203A\u045A\u045C\u045B\u045F" +
  "\u00A0\u040E\u045E\u0408\u00A4\u0490\u00A6\u00A7\u0401\u00A9\u0404\u00AB\u00AC\u00AD\u00AE\u0407" +
  "\u00B0\u00B1\u0406\u0456\u0491\u00B5\u00B6\u00B7\u0451\u2116\u0454\u00BB\u0458\u0405\u0455\u0457" +
  "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ" +
  "абвгдежзийклмнопрстуфхцчшщъыьэюя";
const cp1251ByteByChar = new Map([...cp1251Chars].map((char, index) => [char, index + 0x80]));
const trackingHoverDelayMs = 2000;
const trackingMaxPoints = 3;
const trackingAngles = [0, Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4];
const groupedDrawTools = new Set(["line", "polyline", "circle", "arc", "rectangle"]);
const trackingDrawingTools = new Set(["line", "polyline", "wall", "circle", "arc", "rectangle"]);
const drawToolButtonVisuals = {
  line: { icon: "╱", label: "Линия" },
  polyline: { icon: "⌁", label: "Полилиния" },
  circle: { icon: "○", label: "Круг" },
  arc: { icon: "⌒", label: "Дуга" },
  rectangle: { icon: "▭", label: "Прямоуг." },
};
const dimensionToolButtonVisuals = {
  aligned: { icon: "↔", label: "Параллельный" },
  linear: { icon: "⟷", label: "Линейный" },
  angular: { icon: "∠", label: "Угол" },
  baseline: { icon: "⊥", label: "База" },
};
dimensionToolButtonVisuals.leader = { icon: "↗", label: "Выноска" };
const selectModeButtonVisuals = {
  select: { icon: "↖", label: "Выбор" },
  window: { icon: "▣", label: "Рамка" },
  lasso: { icon: "⌁", label: "Лассо" },
  multi: { icon: "+", label: "Мульти" },
  filter: { icon: "⛃", label: "Фильтр" },
};
const selectionToolButtonVisuals = {
  select: { icon: "✎", label: "Правка" },
  window: { icon: "▣", label: "Рамка" },
  lasso: { icon: "⌁", label: "Лассо" },
  multi: { icon: "+", label: "Мульти" },
};
const selectionToolCycle = ["window", "lasso", "multi"];
const furnitureResizeStepMm = 50;

function createSelectModeMenu() {
  const menu = document.createElement("div");
  menu.className = "draw-tool-menu select-mode-menu";
  menu.id = "selectModeMenu";
  menu.hidden = true;
  menu.innerHTML = `
    <button data-select-mode="select"><span>↖</span><small>Выбор</small></button>
    <button data-select-mode="window"><span>▣</span><small>Рамка</small></button>
    <button data-select-mode="lasso"><span>⌁</span><small>Лассо</small></button>
    <button data-select-mode="multi"><span>+</span><small>Мульти</small></button>
    <button data-select-mode="filter"><span>⛃</span><small>Фильтр</small></button>
  `;
  document.querySelector(".workspace")?.append(menu);
  return menu;
}

function createDimensionToolMenu() {
  const menu = document.createElement("div");
  menu.className = "draw-tool-menu dimension-tool-menu";
  menu.id = "dimensionToolMenu";
  menu.hidden = true;
  menu.innerHTML = `
    <button data-dimension-tool="aligned"><span>&#8596;</span><small>Параллельный</small></button>
    <button data-dimension-tool="linear"><span>&#10231;</span><small>Линейный</small></button>
    <button data-dimension-tool="angular"><span>&#8736;</span><small>Угол</small></button>
    <button data-dimension-tool="baseline"><span>&#8869;</span><small>База</small></button>
    <button data-dimension-tool="leader"><span>&#8599;</span><small>Выноска</small></button>
  `;
  document.querySelector(".workspace")?.append(menu);
  return menu;
}

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
  drawTool: "line",
  dimensionTool: "aligned",
  annotationScale: 1,
  selectTool: "select",
  selectionFilter: "all",
  blockSize: { width: 2200, height: 950 },
  furnitureTab: "furniture",
  furnitureCategory: "sofas",
  view: {
    scale: 0.085,
    panX: 92,
    panY: 84,
  },
  drawing: null,
  moveCommand: null,
  offsetCommand: null,
  pointer: null,
  activePointers: new Map(),
  pinch: null,
  gestureSuppressTap: false,
  inlineEdit: null,
  furnitureDrag: null,
  furniturePress: null,
  dimensionSnapHint: null,
  polarSnapGuide: null,
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
  numericEdit: null,
  selectedId: "wall-3",
  selectedIds: ["wall-3"],
  selectedEndpoint: null,
  endpointEditBefore: null,
  selectionDrag: null,
  openEditMenuAfterPointer: false,
  furnitureEditId: null,
  furnitureResizeHandlesId: null,
  furnitureProportionalHandlesId: null,
  activeFurnitureDimension: null,
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

const TAP_MOVE_TOLERANCE = 8;
const LONG_PRESS_SELECT_MS = 430;

function decodeMojibakeText(value) {
  if (typeof value !== "string" || !/[РС][\u0400-\u04ff]|Г[—°]|В[°·]/.test(value)) return value;
  try {
    const bytes = [];
    for (const char of value) {
      const code = char.charCodeAt(0);
      if (code <= 0x7f) {
        bytes.push(code);
      } else if (cp1251ByteByChar.has(char)) {
        bytes.push(cp1251ByteByChar.get(char));
      } else {
        return value;
      }
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    return decoded.includes("\uFFFD") ? value : decoded;
  } catch {
    return value;
  }
}

function normalizeTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return;
  const next = decodeMojibakeText(node.nodeValue);
  if (next !== node.nodeValue) node.nodeValue = next;
}

function normalizeDynamicText(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    normalizeTextNode(root);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) normalizeTextNode(walker.currentNode);
}

function wall(id, x1, y1, x2, y2) {
  return { id, type: "wall", layer: "walls", x1, y1, x2, y2, width: 180 };
}

function line(id, x1, y1, x2, y2, layer = "measure") {
  return { id, type: "line", layer, x1, y1, x2, y2 };
}

function circleEntity(id, cx, cy, radius, layer = "measure") {
  return { id, type: "circle", layer, cx, cy, radius };
}

function rectangleEntity(id, x1, y1, x2, y2, layer = "measure") {
  return { id, type: "rectangle", layer, x1, y1, x2, y2 };
}

function arcEntity(id, start, through, end, layer = "measure") {
  return { id, type: "arc", layer, start, through, end };
}

function arcThroughFromMidBulge(start, end, control) {
  const chord = distanceWorld(start, end);
  if (chord < 1) return control;
  const mid = midpoint(start, end);
  const nx = -(end.y - start.y) / chord;
  const ny = (end.x - start.x) / chord;
  const sagitta = (control.x - mid.x) * nx + (control.y - mid.y) * ny;
  return {
    x: mid.x + nx * sagitta,
    y: mid.y + ny * sagitta,
  };
}

function block(id, kind, x, y, rotation = 0, size = defaultBlockSize(kind)) {
  return { id, type: "block", layer: "furniture", kind, x, y, rotation, scale: 1, flipX: false, width: size.width, height: size.height };
}

const persistence = {
  clientId: getProjectClientId(),
  endpoint: "",
  debounceMs: 250,
  retryMs: 1600,
  ready: false,
  dirty: false,
  saving: false,
  pending: false,
  restoring: false,
  timer: null,
  lastHash: "",
};
persistence.endpoint = `/api/project?client=${encodeURIComponent(persistence.clientId)}`;

function getProjectClientId() {
  const storageKey = "zamer.clientId";
  try {
    const existing = localStorage.getItem(storageKey);
    if (/^[a-zA-Z0-9_-]{8,80}$/.test(existing || "")) return existing;
    const next = crypto.randomUUID ? crypto.randomUUID() : `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const normalized = next.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
    localStorage.setItem(storageKey, normalized);
    return normalized;
  } catch {
    return `session-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function serializableProjectState() {
  return {
    version: 1,
    clientId: persistence.clientId,
    theme: state.theme,
    view: {
      scale: state.view.scale,
      panX: state.view.panX,
      panY: state.view.panY,
    },
    snaps: [...state.snaps],
    visibleLayers: [...state.visibleLayers],
    annotationScale: state.annotationScale,
    selectionFilter: state.selectionFilter,
    furnitureTab: state.furnitureTab,
    furnitureCategory: state.furnitureCategory,
    furnitureSheetPosition: state.furnitureSheetPosition,
    entities: JSON.parse(JSON.stringify(state.entities)),
  };
}

function serializeProject() {
  return {
    ...serializableProjectState(),
    savedAt: new Date().toISOString(),
  };
}

function projectSnapshotKey() {
  return JSON.stringify(serializableProjectState());
}

function isValidProjectEntity(entity) {
  return Boolean(entity && typeof entity === "object" && typeof entity.id === "string" && typeof entity.type === "string");
}

function cloneProjectEntity(entity) {
  try {
    const copy = JSON.parse(JSON.stringify(entity));
    return isValidProjectEntity(copy) ? copy : null;
  } catch {
    return null;
  }
}

function restoreProject(project) {
  if (!project || !Array.isArray(project.entities)) return false;
  const restoredEntities = project.entities.map(cloneProjectEntity).filter(Boolean);
  persistence.restoring = true;
  try {
    state.entities = restoredEntities;
    if (project.view && Number.isFinite(project.view.scale)) {
      state.view.scale = clampScale(project.view.scale);
      state.view.panX = Number.isFinite(project.view.panX) ? project.view.panX : state.view.panX;
      state.view.panY = Number.isFinite(project.view.panY) ? project.view.panY : state.view.panY;
    }
    if (Array.isArray(project.snaps)) {
      state.snaps = new Set(project.snaps.filter(Boolean));
    }
    if (Array.isArray(project.visibleLayers)) {
      state.visibleLayers = new Set(project.visibleLayers.filter((id) => layerMeta[id]));
    }
    if (Number.isFinite(project.annotationScale)) {
      setAnnotationScale(project.annotationScale, { save: false });
    }
    if (project.theme === "light" || project.theme === "dark") {
      state.theme = project.theme;
      shell.dataset.theme = state.theme;
      themeButton.textContent = state.theme === "light" ? "☾" : "☼";
    }
    if (typeof project.selectionFilter === "string") state.selectionFilter = project.selectionFilter;
    if (typeof project.furnitureTab === "string") state.furnitureTab = project.furnitureTab;
    if (typeof project.furnitureCategory === "string") state.furnitureCategory = project.furnitureCategory;
    if (typeof project.furnitureSheetPosition === "string") setFurnitureSheetPosition(project.furnitureSheetPosition);

    state.drawing = null;
    state.moveCommand = null;
    state.offsetCommand = null;
    state.pointer = null;
    state.pinch = null;
    state.inlineEdit = null;
    state.numericEdit = null;
    state.selectionDrag = null;
    state.selectedEndpoint = null;
    state.endpointEditBefore = null;
    state.furnitureEditId = null;
    state.undo = [];
    state.redo = [];
    state.selectedId = null;
    state.selectedIds = [];

    syncSnapButtons();
    syncToolButtons();
    renderLayerList();
    draw();
    return true;
  } finally {
    persistence.restoring = false;
  }
}

function markProjectDirty(reason = "change") {
  if (!persistence.ready || persistence.restoring) return;
  const snapshot = projectSnapshotKey();
  if (!persistence.dirty && snapshot === persistence.lastHash) return;
  persistence.dirty = true;
  persistence.lastReason = reason;
  window.clearTimeout(persistence.timer);
  persistence.timer = window.setTimeout(saveProjectNow, persistence.debounceMs);
}

async function saveProjectNow() {
  if (!persistence.ready || persistence.restoring) return;
  if (persistence.saving) {
    persistence.pending = true;
    return;
  }
  const snapshot = projectSnapshotKey();
  if (!persistence.dirty && snapshot === persistence.lastHash) return;
  persistence.saving = true;
  let retryScheduled = false;
  window.clearTimeout(persistence.timer);
  try {
    const response = await fetch(persistence.endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeProject()),
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    persistence.lastHash = snapshot;
    persistence.dirty = projectSnapshotKey() !== snapshot;
  } catch (error) {
    console.warn("Project autosave failed", error);
    persistence.dirty = true;
    persistence.timer = window.setTimeout(saveProjectNow, persistence.retryMs);
    retryScheduled = true;
  } finally {
    persistence.saving = false;
    if (!retryScheduled && (persistence.pending || persistence.dirty)) {
      persistence.pending = false;
      markProjectDirty("pending");
    }
  }
}

async function loadProjectFromServer() {
  try {
    const response = await fetch(persistence.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    const payload = await response.json();
    if (payload?.project) {
      restoreProject(payload.project);
      statusChip.textContent = "Проект загружен с сервера";
    }
  } catch (error) {
    console.warn("Project restore failed", error);
  } finally {
    persistence.ready = true;
    persistence.lastHash = projectSnapshotKey();
  }
}

function flushProjectBeforeUnload() {
  if (!persistence.ready || persistence.restoring) return;
  if (!persistence.dirty && projectSnapshotKey() === persistence.lastHash) return;
  const body = JSON.stringify(serializeProject());
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon?.(persistence.endpoint, blob)) return;
  fetch(persistence.endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function loadSymbolImage(source) {
  const image = new Image();
  image.decoding = "async";
  image.onload = () => draw();
  image.src = `${symbolBasePath}${source}`;
  return image;
}

function symbolImageMarkup(source) {
  return `<img src="${symbolBasePath}${source}" alt="" />`;
}

function furnitureThumbMarkup(item) {
  const thumb = item.thumb || {};
  if (thumb.type === "sofa" || thumb.type === "sectional") {
    const className = thumb.type === "sectional" ? "sectional-thumb" : `sofa-thumb${(thumb.parts || []).length <= 2 ? " compact" : ""}`;
    return `<span class="furniture-thumb svg-thumb ${className}">${(thumb.parts || []).map(symbolImageMarkup).join("")}</span>`;
  }
  return `<span class="furniture-thumb svg-thumb single-symbol">${symbolImageMarkup(thumb.src || blockSymbolSources[item.kind] || "Table.svg")}</span>`;
}

function createFurnitureCard(item, index) {
  const button = document.createElement("div");
  button.className = `block furniture-card${index === 0 ? " active" : ""}`;
  button.role = "button";
  button.tabIndex = 0;
  button.dataset.tab = item.tab;
  button.dataset.category = item.category;
  button.dataset.block = item.kind;
  button.dataset.w = String(item.width);
  button.dataset.h = String(item.height);
  button.dataset.libraryId = item.id;
  button.innerHTML = `${furnitureThumbMarkup(item)}<strong>${item.title}</strong><small>${item.width} × ${item.height}</small><b>✓</b>`;
  return button;
}

function attachFurnitureCardEvents(button) {
  button.addEventListener("pointerdown", (event) => {
    beginFurniturePress(button, event);
  });

  button.addEventListener("pointermove", (event) => {
    updateFurniturePress(event);
    updateFurnitureDrag(event);
  });

  button.addEventListener("pointerup", (event) => {
    finishFurniturePress(event);
    finishFurnitureDrag(event);
  });

  button.addEventListener("pointercancel", (event) => {
    finishFurniturePress(event);
    finishFurnitureDrag(event);
  });

  button.addEventListener("click", () => {
    if (state.suppressFurnitureClick) return;
    setActiveFurnitureCard(button);
    statusChip.textContent = `${furnitureCardData(button).title}: перетащите карточку на план`;
  });

  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setActiveFurnitureCard(button);
    statusChip.textContent = `${furnitureCardData(button).title}: перетащите карточку на план`;
  });
}

function hydrateFurnitureLibrary(items) {
  furnitureGrid.textContent = "";
  const cards = items.map(createFurnitureCard);
  cards.forEach((card) => {
    furnitureGrid.append(card);
    attachFurnitureCardEvents(card);
  });
  blocks = cards;
  const firstCard = cards[0];
  if (firstCard) {
    setActiveFurnitureCard(firstCard, { activateTool: false });
  } else {
    furnitureGrid.innerHTML = `<div class="library-empty">В этой библиотеке пока нет объектов</div>`;
  }
  renderFurnitureLibrary();
}

async function loadFurnitureLibrary() {
  try {
    const response = await fetch(libraryCatalogPath);
    if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
    const catalog = await response.json();
    hydrateFurnitureLibrary(catalog.items || []);
  } catch (error) {
    console.error(error);
    furnitureGrid.innerHTML = `<div class="library-empty">Не удалось загрузить библиотеку</div>`;
  }
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
  const confirmKeyboardInset = inputFocused ? keyboardInset || Math.round(Math.min(360, Math.max(260, stableViewportHeight * 0.42))) : 0;
  document.documentElement.style.setProperty("--confirm-keyboard-inset", `${confirmKeyboardInset}px`);
  shell.classList.toggle("keyboard-open", keyboardInset > 0);
  if (keyboardConfirmButton) {
    keyboardConfirmButton.hidden = !inputFocused;
    positionKeyboardConfirmButton();
  }
  lockDocumentScroll();
  resizeCanvas();
}

function positionKeyboardConfirmButton() {
  if (!keyboardConfirmButton) return;
  const input = document.activeElement;
  if (!keyboardInputs.includes(input)) {
    keyboardConfirmButton.classList.remove("near-input");
    keyboardConfirmButton.style.left = "";
    keyboardConfirmButton.style.top = "";
    return;
  }
  keyboardConfirmButton.classList.remove("near-input");
  keyboardConfirmButton.style.left = "";
  keyboardConfirmButton.style.top = "";
  keyboardConfirmButton.style.right = "12px";
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

function centerViewOnWorldPoint(point) {
  const center = centerScreen();
  state.view.panX = center.x - point.x * state.view.scale;
  state.view.panY = center.y - point.y * state.view.scale;
  markProjectDirty("view-center");
}

function centerViewOnFurnitureForInput(entity) {
  if (!entity) return;
  const rect = canvas.getBoundingClientRect();
  const target = {
    x: rect.width / 2,
    y: Math.max(150, rect.height * 0.38),
  };
  state.view.panX = target.x - entity.x * state.view.scale;
  state.view.panY = target.y - entity.y * state.view.scale;
  markProjectDirty("view-center-furniture-input");
}

function cursorWorld() {
  const raw = screenToWorld(centerScreen());
  if (state.tool === "dimension" && state.drawing?.phase === "offset") return raw;
  if (state.tool === "dimension") return resolveDimensionPointSnap(raw).point;
  const start = state.drawing?.start || state.moveCommand?.base || selectedEndpointGeometry()?.fixed || null;
  if (start) return resolveLineLikeSnap(raw, start).point;
  if (canSnapToPrePointTrackingGuides()) return resolvePrePointTrackingSnap(raw).point;
  return resolveSnapWorld(raw).point;
}

function rawCursorWorld() {
  return screenToWorld(centerScreen());
}

function cursorSnapResolved() {
  const raw = screenToWorld(centerScreen());
  if (state.tool === "dimension" && state.drawing?.phase === "offset") return { point: raw, snap: null };
  if (state.tool === "dimension") return resolveDimensionPointSnap(raw);
  const start = state.drawing?.start || state.moveCommand?.base || selectedEndpointGeometry()?.fixed || null;
  if (start) return resolveLineLikeSnap(raw, start);
  if (canSnapToPrePointTrackingGuides()) return resolvePrePointTrackingSnap(raw);
  return resolveSnapWorld(raw);
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

function annotationScale() {
  return Math.min(1.8, Math.max(0.65, Number(state.annotationScale) || 1));
}

function annotationZoomScale() {
  return Math.min(3.6, Math.max(0.28, state.view.scale / 0.085));
}

function annotationPx(value) {
  return value * annotationScale() * annotationZoomScale();
}

function annotationFont(weight, size) {
  return `${weight} ${annotationPx(size).toFixed(1)}px Inter, Segoe UI, sans-serif`;
}

function screenUiPx(value) {
  return value;
}

function screenUiFont(weight, size) {
  return `${weight} ${screenUiPx(size).toFixed(1)}px Inter, Segoe UI, sans-serif`;
}

function setAnnotationScale(value, options = {}) {
  const next = Math.min(1.8, Math.max(0.65, Number(value) || 1));
  state.annotationScale = next;
  let label = "1:100";
  if (annotationScaleSelect) {
    const option = [...annotationScaleSelect.options].find((item) => Math.abs(Number(item.value) - next) < 0.001);
    annotationScaleSelect.value = option ? option.value : String(next);
    label = option?.textContent || annotationScaleSelect.selectedOptions[0]?.textContent || label;
  }
  if (projectScaleCaption) projectScaleCaption.textContent = `MM - ${label}`;
  draw();
  if (options.save !== false) markProjectDirty("annotation-scale");
}

let drawScheduled = false;

// Coalesces bursts of state mutations into a single repaint on the next
// animation frame. The prototype previously called draw() synchronously from
// ~40 sites, doing a full-canvas clear+redraw on every pointer move; routing
// every draw() through one rAF removes that redundant work.
function requestDraw() {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => {
    drawScheduled = false;
    renderFrame();
  });
}

// Public entry point used everywhere in the app. Kept as draw() so existing
// call sites stay unchanged; the heavy work lives in renderFrame().
function draw() {
  requestDraw();
}

function drawNow() {
  drawScheduled = false;
  renderFrame();
}

function renderFrame() {
  syncCommandState();
  const rect = canvas.getBoundingClientRect();
  const c = colors();
  updateLinkedDimensions();
  updateSnapTrackingHover();
  shell.dataset.debugTool = state.tool;
  shell.dataset.debugDrawing = state.drawing ? "1" : "0";
  shell.dataset.debugEntityCount = String(state.entities.length);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, rect.width, rect.height);
  drawGrid(rect, c);
  drawCanvasCenterCursor(rect, c);

  const visible = visibleEntities(rect);
  drawWalls(visible, c);
  for (const entity of visible) {
    if (entity.type === "wall") continue;
    drawEntity(entity, c);
  }


  const selectedItems = selectedEntities();
  const selected = selectedItems.at(-1) || null;
  if (!state.drawing && !state.moveCommand && !state.offsetCommand) {
    for (const entity of selectedItems) {
      drawSelection(entity, c);
    }
  }
  updateFurnitureSizePanel(selected);

  if (state.drawing) {
    drawActiveSegment(c);
  } else if (state.moveCommand) {
    drawMoveCommand(c);
  } else if (state.offsetCommand) {
    drawOffsetCommand(c);
  } else if (state.selectedEndpoint) {
    const geometry = selectedEndpointGeometry();
    if (geometry) {
      const previewMoving = cursorWorld();
      drawEditableSegment(geometry.fixed, previewMoving, c, { dashed: true });
      updateSelectedEndpointEditors(previewMoving);
    } else {
      hideInlineEditors();
    }
  } else {
    hideInlineEditors();
  }
  syncSelectionActions();
  drawSelectionDrag(c);
  drawDimensionSnapHint(c);
  if (state.tool !== "dimension") drawSnapTracking(c);
  drawCursorSnap(c);
  normalizeDynamicText();
}

function shouldGhostEntityForCommand(entity) {
  return Boolean(
    state.moveCommand?.base &&
      (state.moveCommand.mode === "move" || state.moveCommand.mode === "rotate") &&
      entity.id === state.moveCommand.entityId
  );
}

function syncCommandState() {
  const active = Boolean(state.moveCommand || state.offsetCommand || state.selectedEndpoint);
  shell.dataset.command = state.offsetCommand ? "offset" : active ? "move" : "";
  shell.classList.toggle("command-active", active);
  if (centerCursor) {
    centerCursor.classList.toggle("force-visible", active);
    centerCursor.style.opacity = active ? "1" : "";
    centerCursor.style.visibility = active ? "visible" : "";
  }
}

function forceMoveCursorVisible() {
  if (!state.moveCommand || !centerCursor) return;
  centerCursor.classList.add("force-visible");
  centerCursor.style.opacity = "1";
  centerCursor.style.visibility = "visible";
}

function drawMoveCommand(c) {
  const command = state.moveCommand;
  if (!command?.base) {
    hideInlineEditors();
    return;
  }
  const start = command.base;
  const end = command.lockedEnd ? command.end : cursorWorld();
  command.end = end;
  const p1 = worldToScreen(start);
  const p2 = worldToScreen(end);
  const metrics = segmentMetrics(start.x, start.y, end.x, end.y);
  const angleInfo = activeAngleInfo(start, end);
  const displayAngle =
    command.mode === "rotate" && command.reference
      ? Math.round(Math.abs((signedAngleDelta(angleBetweenPoints(start, command.reference), angleBetweenPoints(start, end)) * 180) / Math.PI))
      : angleInfo.degrees;
  const m = midpoint(p1, p2);
  const entity = state.entities.find((item) => item.id === command.entityId);
  if (entity) {
    if (command.mode === "rotate") {
      drawRotatePreview(entity, command, end, c);
    } else {
      drawMovePreview(entity, end.x - start.x, end.y - start.y, c);
    }
  }

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([8, 6]);
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.setLineDash([]);
  drawHandle(p1.x, p1.y, c);
  drawHandle(p2.x, p2.y, c);
  drawBadge(`${metrics.length} мм`, m.x, m.y - 22, c);
  drawCommandAngleArc(p1, p2, c, command.mode === "rotate" ? command.reference : null, angleInfo);
  ctx.restore();

  updateTopMetricInputs(command.mode === "rotate" ? 0 : metrics.length, displayAngle);
}

function drawCommandAngleArc(origin, target, c, reference = null, angleInfo = null) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const screenLength = Math.hypot(dx, dy);
  if (screenLength < 34) return;
  const angle = Math.atan2(dy, dx);
  const startAngle = reference ? angleBetweenPoints(origin, worldToScreen(reference)) : angleInfo?.referenceRad ?? nearestCardinalReferenceRad(angle);
  const delta = reference ? signedAngleDelta(startAngle, angle) : angleInfo?.deltaRad ?? signedAngleDelta(startAngle, angle);
  const radius = Math.min(48, Math.max(28, screenLength * 0.24));
  const arcEnd = {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius,
  };
  const labelRad = startAngle + delta / 2;
  const label = {
    x: origin.x + Math.cos(labelRad) * (radius + 14),
    y: origin.y + Math.sin(labelRad) * (radius + 14),
  };
  const degrees = Math.round(Math.abs((delta * 180) / Math.PI));

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.35;
  ctx.setLineDash([4, 4]);
  linePath(origin.x, origin.y, origin.x + Math.cos(startAngle) * (radius + 14), origin.y + Math.sin(startAngle) * (radius + 14));
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, radius, startAngle, startAngle + delta, delta < 0);
  ctx.stroke();
  drawArcArrow(arcEnd, angle, delta >= 0 ? 1 : -1, c);
  drawBadge(`${degrees}°`, label.x, label.y, c, true);
  ctx.restore();
}

function drawOffsetCommand(c) {
  const command = state.offsetCommand;
  const entity = command ? state.entities.find((item) => item.id === command.entityId) : null;
  if (!command || !entity) {
    hideInlineEditors();
    return;
  }
  const sidePoint = rawCursorWorld();
  const preview = offsetLinearEntity(entity, command.distance, sidePoint);
  const p1 = worldToScreen({ x: preview.x1, y: preview.y1 });
  const p2 = worldToScreen({ x: preview.x2, y: preview.y2 });
  const source1 = worldToScreen({ x: entity.x1, y: entity.y1 });
  const source2 = worldToScreen({ x: entity.x2, y: entity.y2 });
  const sourceMid = midpoint(source1, source2);
  const previewMid = midpoint(p1, p2);

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = entity.type === "wall" ? 5 : 2.2;
  ctx.setLineDash([9, 6]);
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.2;
  linePath(sourceMid.x, sourceMid.y, previewMid.x, previewMid.y);
  ctx.setLineDash([]);
  drawHandle(p1.x, p1.y, c);
  drawHandle(p2.x, p2.y, c);
  drawBadge(`${Math.round(command.distance)} мм`, previewMid.x, previewMid.y - 22, c);
  ctx.restore();

  updateTopMetricInputs(Math.round(command.distance), 0);
}

function drawMovePreview(entity, dx, dy, c) {
  if (!dx && !dy) return;
  if (entity.type === "block") {
    drawBlockPreview({ ...entity, x: entity.x + dx, y: entity.y + dy }, c);
    return;
  }
  const p1 = worldToScreen({ x: entity.x1 + dx, y: entity.y1 + dy });
  const p2 = worldToScreen({ x: entity.x2 + dx, y: entity.y2 + dy });
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = entity.type === "wall" ? 5 : 2.2;
  ctx.setLineDash([10, 6]);
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.setLineDash([]);
  drawHandle(p1.x, p1.y, c);
  drawHandle(p2.x, p2.y, c);
  ctx.restore();
}

function drawRotatePreview(entity, command, end, c) {
  if (!command.reference) return;
  const startAngle = angleBetweenPoints(command.base, command.reference);
  const endAngle = angleBetweenPoints(command.base, end);
  const delta = signedAngleDelta(startAngle, endAngle);
  if (entity.type === "block") {
    const center = rotatePointAround({ x: entity.x, y: entity.y }, command.base, delta);
    const preview = { ...entity, x: center.x, y: center.y, rotation: normalizeDegrees((entity.rotation || 0) + radToDeg(delta)) };
    drawBlock(preview, c);
    drawFurnitureSelection(preview, c);
    return;
  }
  const p1World = rotatePointAround({ x: entity.x1, y: entity.y1 }, command.base, delta);
  const p2World = rotatePointAround({ x: entity.x2, y: entity.y2 }, command.base, delta);
  const p1 = worldToScreen(p1World);
  const p2 = worldToScreen(p2World);
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = entity.type === "wall" ? 5 : 2.2;
  ctx.setLineDash([10, 6]);
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.setLineDash([]);
  drawHandle(p1.x, p1.y, c);
  drawHandle(p2.x, p2.y, c);
  ctx.restore();
}

function syncSelectionActions() {
  if (!selectionActions) return;
  const editable = editableSelectionEntity();
  const furnitureSelected = state.tool === "furniture" && selectedEntities().some((entity) => entity.type === "block");
  const show = (state.tool === "select" && Boolean(editable)) || furnitureSelected;
  if (show) syncSelectToolMenu();
  selectionActions.hidden = !show;
  syncToolButtons();
}

function editableSelectionEntity() {
  const selected = selectedEntities();
  const primary = selected.length === 1 ? selected[0] : null;
  return primary &&
    !state.drawing &&
    !state.moveCommand &&
    !state.offsetCommand &&
    state.tool === "select" &&
    isLayerVisible(primary.layer)
    ? primary
    : null;
}

function linearEditableEntity(entity) {
  return entity && entity.type !== "block" && entity.layer !== "dimensions";
}

function canApplySelectionAction(action) {
  const selected = selectedEntities().filter((entity) => isLayerVisible(entity.layer));
  if (!selected.length || !["select", "furniture"].includes(state.tool) || state.drawing || state.moveCommand || state.offsetCommand) return false;
  if (action === "delete") return true;
  if (selected.length !== 1) return false;
  const entity = selected[0];
  if (action === "move") return true;
  if (action === "resize") return entity.type === "block";
  if (action === "copy") return entity.type === "block" || linearEditableEntity(entity);
  if (action === "rotate") return entity.type === "block" || linearEditableEntity(entity);
  if (action === "mirror") return entity.type === "block" || linearEditableEntity(entity);
  if (action === "offset") return linearEditableEntity(entity);
  return false;
}

function selectedEntities() {
  const ids = state.selectedIds?.length ? state.selectedIds : state.selectedId ? [state.selectedId] : [];
  const seen = new Set();
  return ids
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((id) => state.entities.find((entity) => entity.id === id))
    .filter(Boolean);
}

function canShowEntitySelection() {
  return state.tool === "select" || state.tool === "furniture";
}

function setSelection(ids, options = {}) {
  const nextIds = Array.isArray(ids) ? ids.filter(Boolean) : ids ? [ids] : [];
  if (options.toggle) {
    const current = new Set(state.selectedIds || []);
    for (const id of nextIds) {
      if (current.has(id)) current.delete(id);
      else current.add(id);
    }
    state.selectedIds = [...current];
  } else if (options.add) {
    state.selectedIds = [...new Set([...(state.selectedIds || []), ...nextIds])];
  } else {
    state.selectedIds = [...new Set(nextIds)];
  }
  state.selectedId = state.selectedIds.at(-1) || null;
  state.selectedEndpoint = null;
  if (state.furnitureResizeHandlesId && !state.selectedIds.includes(state.furnitureResizeHandlesId)) {
    state.furnitureResizeHandlesId = null;
  }
  if (state.furnitureProportionalHandlesId && !state.selectedIds.includes(state.furnitureProportionalHandlesId)) {
    state.furnitureProportionalHandlesId = null;
  }
  if (!state.selectedIds.some((id) => state.entities.find((entity) => entity.id === id)?.type === "block")) {
    state.activeFurnitureDimension = null;
  }
  syncSelectionActions();
}

function entityMatchesSelectionFilter(entity) {
  if (!entity || !isLayerVisible(entity.layer)) return false;
  if (state.selectionFilter === "walls") return entity.type === "wall";
  if (state.selectionFilter === "lines") return entity.type === "line" && entity.layer !== "dimensions";
  if (state.selectionFilter === "furniture") return entity.type === "block";
  if (state.selectionFilter === "dimensions") return entity.layer === "dimensions";
  return true;
}

function selectableEntities() {
  return state.entities.filter(entityMatchesSelectionFilter);
}

function selectionEntityPoints(entity) {
  if (!entity) return [];
  if (entity.type === "block") return blockCorners(entity);
  if (entity.type === "circle") {
    const r = Math.abs(entity.radius || 0);
    return [
      { x: entity.cx, y: entity.cy },
      { x: entity.cx + r, y: entity.cy },
      { x: entity.cx - r, y: entity.cy },
      { x: entity.cx, y: entity.cy + r },
      { x: entity.cx, y: entity.cy - r },
    ];
  }
  if (entity.type === "rectangle") return rectangleCorners(entity);
  if (entity.type === "arc") return [entity.start, entity.through, entity.end].filter(Boolean);
  return [
    { x: entity.x1, y: entity.y1 },
    { x: entity.x2, y: entity.y2 },
  ];
}

function selectionEntitySegments(entity) {
  const points = selectionEntityPoints(entity);
  if (entity?.type === "circle") {
    const center = { x: entity.cx, y: entity.cy };
    const radius = Math.abs(entity.radius || 0);
    const samples = Array.from({ length: 16 }, (_, index) => ({
      x: center.x + Math.cos((index / 16) * Math.PI * 2) * radius,
      y: center.y + Math.sin((index / 16) * Math.PI * 2) * radius,
    }));
    return samples.map((point, index) => [point, samples[(index + 1) % samples.length]]);
  }
  if (entity?.type === "arc") {
    const arc = arcGeometry(entity.start, entity.through, entity.end);
    if (!arc) return [];
    const span = arc.counterClockwise
      ? normalizeAnglePositive(arc.endAngle - arc.startAngle)
      : normalizeAnglePositive(arc.startAngle - arc.endAngle);
    const steps = Math.max(6, Math.ceil(span / (Math.PI / 12)));
    const samples = Array.from({ length: steps + 1 }, (_, index) => {
      const t = index / steps;
      const angle = arc.counterClockwise ? arc.startAngle + span * t : arc.startAngle - span * t;
      return {
        x: arc.center.x + Math.cos(angle) * arc.radius,
        y: arc.center.y + Math.sin(angle) * arc.radius,
      };
    });
    return samples.slice(1).map((point, index) => [samples[index], point]);
  }
  if (entity?.type === "rectangle" || entity?.type === "block") {
    return points.map((point, index) => [point, points[(index + 1) % points.length]]);
  }
  return points.length >= 2 ? [[points[0], points[1]]] : [];
}

function screenRectFromDrag(start, current) {
  return {
    minX: Math.min(start.x, current.x),
    maxX: Math.max(start.x, current.x),
    minY: Math.min(start.y, current.y),
    maxY: Math.max(start.y, current.y),
  };
}

function selectionRectHitsEntity(entity, rect, mode) {
  const points = selectionEntityPoints(entity).map(worldToScreen);
  const segments = selectionEntitySegments(entity).map(([a, b]) => [worldToScreen(a), worldToScreen(b)]);
  if (!points.length) return false;
  if (mode === "window") return points.every((point) => pointInSelectionRect(point, rect));
  if (points.some((point) => pointInSelectionRect(point, rect))) return true;
  const edges = rectEdges(rect);
  return segments.some(([a, b]) => edges.some(([c, d]) => segmentsIntersect(a, b, c, d)));
}

function selectionLassoHitsEntity(entity, polygon) {
  if (polygon.length < 3) return false;
  const points = selectionEntityPoints(entity).map(worldToScreen);
  if (points.some((point) => pointInPolygon(point, polygon))) return true;
  const entitySegments = selectionEntitySegments(entity).map(([a, b]) => [worldToScreen(a), worldToScreen(b)]);
  const lassoSegments = polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]]);
  return entitySegments.some(([a, b]) => lassoSegments.some(([c, d]) => segmentsIntersect(a, b, c, d)));
}

function idsFromSelectionWindow(start, current) {
  const rect = screenRectFromDrag(start, current);
  const mode = current.x >= start.x ? "window" : "crossing";
  return selectableEntities()
    .filter((entity) => selectionRectHitsEntity(entity, rect, mode))
    .map((entity) => entity.id);
}

function idsFromSelectionLasso(points) {
  return selectableEntities()
    .filter((entity) => selectionLassoHitsEntity(entity, points))
    .map((entity) => entity.id);
}

function startSelectionDrag(type, event, screen) {
  clearPointerLongPress();
  state.selectionDrag = type === "lasso"
    ? { type, points: [screen], start: screen, current: screen }
    : { type, start: screen, current: screen };
  state.pointer = {
    id: event.pointerId,
    screen,
    startScreen: screen,
    world: screenToWorld(screen),
    moved: false,
    mode: type === "lasso" ? "selection-lasso" : "selection-window",
    targetId: null,
    before: null,
  };
  statusChip.textContent = type === "lasso" ? "Лассо: обведите объекты" : "Выделение: тяните рамку";
  draw();
}

function clearPointerLongPress(pointer = state.pointer) {
  if (!pointer?.longPressTimer) return;
  window.clearTimeout(pointer.longPressTimer);
  pointer.longPressTimer = null;
}

function scheduleSelectionLongPress(pointer) {
  if (!pointer || pointer.mode !== "pan" || state.tool !== "select" || state.selectTool !== "select" || pointer.tapCandidateId) return;
  pointer.longPressTimer = window.setTimeout(() => {
    if (state.pointer !== pointer || pointer.moved || pointer.mode !== "pan" || !state.activePointers.has(pointer.id)) return;
    state.selectTool = "window";
    syncSelectToolMenu();
    hideSelectModeMenu();
    hideSelectToolMenu();
    startSelectionDrag("window", { pointerId: pointer.id }, pointer.startScreen);
    statusChip.textContent = "Выделение: тяните рамку";
  }, LONG_PRESS_SELECT_MS);
}

function updateSelectionDrag(screen) {
  const drag = state.selectionDrag;
  if (!drag) return;
  drag.current = screen;
  if (drag.type === "lasso") {
    const last = drag.points.at(-1);
    if (!last || Math.hypot(screen.x - last.x, screen.y - last.y) > 6) drag.points.push(screen);
  }
}

function finishSelectionDrag() {
  const drag = state.selectionDrag;
  if (!drag) return;
  const ids = drag.type === "lasso" ? idsFromSelectionLasso(drag.points) : idsFromSelectionWindow(drag.start, drag.current);
  const add = state.selectTool === "multi";
  setSelection(ids, { add });
  state.furnitureEditId = null;
  state.selectionDrag = null;
  const count = selectedEntities().length;
  statusChip.textContent = count ? `Выбрано: ${count}` : selectionStatusText();
  state.openEditMenuAfterPointer = count > 0;
  if (count) syncSelectToolMenu();
  else hideSelectToolMenu();
  draw();
}

function applyTapSelection(hitId) {
  if (state.selectTool === "multi") {
    setSelection(hitId, { toggle: true });
  } else {
    setSelection(hitId);
  }
  const hitEntity = hitId ? state.entities.find((entity) => entity.id === hitId) : null;
  const count = selectedEntities().length;
  if (hitEntity?.type === "block") {
    if (state.furnitureEditId && state.furnitureEditId !== hitId) state.furnitureEditId = null;
    statusChip.textContent = "Мебель выбрана";
  } else {
    state.furnitureEditId = null;
    statusChip.textContent = count > 1 ? `Выбрано: ${count}` : hitId ? "Элемент выбран" : selectionStatusText();
  }
  if (count) {
    state.openEditMenuAfterPointer = true;
    showSelectToolMenuAfterLayout();
  } else {
    hideSelectToolMenu();
  }
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

function drawCanvasCenterCursor(rect, c) {
  if (state.tool === "dimension" && state.drawing) return;
  const visible =
    (state.tool !== "select" && state.tool !== "furniture") ||
    Boolean(state.moveCommand || state.offsetCommand || state.selectedEndpoint);
  if (!visible) return;
  const center = { x: rect.width / 2, y: rect.height / 2 };
  const red = state.theme === "dark" ? "rgba(224, 104, 104, 0.48)" : "rgba(194, 73, 73, 0.42)";
  const ringFill = state.theme === "dark" ? "rgba(21, 27, 36, 0.55)" : "rgba(255, 255, 255, 0.56)";
  ctx.save();
  ctx.strokeStyle = red;
  ctx.fillStyle = ringFill;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(center.x - 36, center.y);
  ctx.lineTo(center.x + 36, center.y);
  ctx.moveTo(center.x, center.y - 36);
  ctx.lineTo(center.x, center.y + 36);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
    const bounds = entityBounds(entity);
    const entityMinX = bounds.minX;
    const entityMaxX = bounds.maxX;
    const entityMinY = bounds.minY;
    const entityMaxY = bounds.maxY;
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
  } else if (entity.type === "circle") {
    drawCircleEntity(entity, c);
  } else if (entity.type === "rectangle") {
    drawRectangleEntity(entity, c);
  } else if (entity.type === "arc") {
    drawArcEntity(entity, c);
  } else if (entity.type === "block") {
    drawBlock(entity, c);
  }
}

function drawWalls(visible, c) {
  const walls = visible.filter((entity) => entity.type === "wall");
  if (!walls.length) return;
  const normalWalls = walls.filter((entity) => !shouldGhostEntityForCommand(entity));
  const ghostWalls = walls.filter((entity) => shouldGhostEntityForCommand(entity));
  if (normalWalls.length) {
    drawWallSet(normalWalls, c);
  }
  if (ghostWalls.length) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    drawWallSet(ghostWalls, c);
    ctx.restore();
  }
}

function drawWallSet(walls, c) {
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
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  ctx.save();
  if (shouldGhostEntityForCommand(entity)) {
    ctx.globalAlpha = 0.28;
  }
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  linePath(p1.x, p1.y, p2.x, p2.y);
  if (selected) {
    drawEndpointHandle(p1, state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "start", c);
    drawEndpointHandle(p2, state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "end", c);
  }
  ctx.restore();
}

function drawCircleEntity(entity, c) {
  const center = worldToScreen({ x: entity.cx, y: entity.cy });
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  ctx.save();
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, Math.abs(entity.radius) * state.view.scale, 0, Math.PI * 2);
  ctx.stroke();
  if (selected) {
    drawHandle(center.x, center.y, c);
    drawBadge(`R ${Math.round(Math.abs(entity.radius))} мм`, center.x, center.y - Math.abs(entity.radius) * state.view.scale - 18, c);
  }
  ctx.restore();
}

function drawRectangleEntity(entity, c) {
  const corners = rectangleCorners(entity);
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  ctx.save();
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.beginPath();
  corners.forEach((corner, index) => { const pt = worldToScreen(corner); if (index === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
  ctx.closePath();
  ctx.stroke();
  if (selected) {
    corners.forEach((corner) => { const pt = worldToScreen(corner); drawHandle(pt.x, pt.y, c); });
    const center = worldToScreen({ x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 });
    drawBadge(`${Math.round(Math.abs(entity.x2 - entity.x1))} × ${Math.round(Math.abs(entity.y2 - entity.y1))}`, center.x, center.y - 18, c);
  }
  ctx.restore();
}

function drawArcEntity(entity, c) {
  const arc = arcGeometry(entity.start, entity.through, entity.end);
  if (!arc) return;
  const center = worldToScreen(arc.center);
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  ctx.save();
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, arc.radius * state.view.scale, arc.startAngle, arc.endAngle, arc.counterClockwise);
  ctx.stroke();
  if (selected) [entity.start, entity.through, entity.end].forEach((point) => { const pt = worldToScreen(point); drawHandle(pt.x, pt.y, c); });
  ctx.restore();
}

function drawEndpointHandle(point, active, c) {
  ctx.save();
  ctx.fillStyle = active ? c.accent : c.surface;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = active ? 2.2 : 1.6;
  ctx.beginPath();
  ctx.arc(point.x, point.y, active ? 7 : 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawDimensionEntity(entity, c, options = {}) {
  if (entity.dimensionKind === "angular") {
    drawAngularDimensionEntity(entity, c, options);
    return;
  }
  if (entity.dimensionKind === "leader") {
    drawLeaderEntity(entity, c, options);
    return;
  }
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

function drawLeaderEntity(entity, c, options = {}) {
  const geometry = leaderScreenGeometry(entity);
  const { arrow, connector, rect, text, font } = geometry;
  const dx = connector.x - arrow.x;
  const dy = connector.y - arrow.y;
  const length = Math.hypot(dx, dy);
  if (length < 4) return;
  const ux = dx / length;
  const uy = dy / length;

  ctx.save();
  ctx.strokeStyle = c.dimension;
  ctx.fillStyle = c.dimension;
  ctx.lineWidth = annotationPx(options.active ? 1.8 : 1.45);
  ctx.setLineDash(options.active ? [7, 5] : []);
  linePath(arrow.x, arrow.y, connector.x, connector.y);
  ctx.setLineDash([]);
  drawDimensionArrow(arrow, ux, uy, annotationPx(8), c);

  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.strokeStyle = c.dimension;
  ctx.lineWidth = annotationPx(options.active ? 1.8 : 1.25);
  roundedRect(rect.x, rect.y, rect.width, rect.height, annotationPx(5));

  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = c.dimension;
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2 + annotationPx(0.6));
  ctx.restore();
}

function leaderScreenGeometry(entity) {
  const arrow = worldToScreen({ x: entity.x1, y: entity.y1 });
  const center = worldToScreen({ x: entity.x2, y: entity.y2 });
  const text = decodeMojibakeText(entity.text || "Текст");
  const font = annotationFont(700, 12);
  ctx.save();
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  ctx.restore();
  const padX = annotationPx(10);
  const width = Math.max(annotationPx(46), textWidth + padX * 2);
  const height = annotationPx(25);
  const rect = {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
  return {
    arrow,
    center,
    connector: pointOnRectTowardTarget(rect, arrow),
    rect,
    text,
    font,
  };
}

function pointOnRectTowardTarget(rect, target) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return center;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const tx = Math.abs(dx) > 0.001 ? halfW / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 0.001 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return {
    x: center.x + dx * t,
    y: center.y + dy * t,
  };
}

function screenRectDistance(point, rect) {
  if (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  ) {
    return 0;
  }
  const left = { x: rect.x, y: rect.y };
  const right = { x: rect.x + rect.width, y: rect.y + rect.height };
  return Math.min(
    pointToSegmentDistance(point, left, { x: right.x, y: left.y }),
    pointToSegmentDistance(point, { x: right.x, y: left.y }, right),
    pointToSegmentDistance(point, right, { x: left.x, y: right.y }),
    pointToSegmentDistance(point, { x: left.x, y: right.y }, left),
  );
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
  const extension = options.extension ?? annotationPx(12);
  const extensionSign = offset < 0 ? -1 : 1;
  const arrowSize = annotationPx(Math.min(9, Math.max(5, length * 0.08)));
  let a = options.lineStart ? worldToScreen(options.lineStart) : { x: p1.x + nx * offset, y: p1.y + ny * offset };
  let b = options.lineEnd ? worldToScreen(options.lineEnd) : { x: p2.x + nx * offset, y: p2.y + ny * offset };
  let legStartPoint = p1;
  let legEndPoint = p2;
  const rawLineDx = b.x - a.x;
  const rawLineDy = b.y - a.y;
  const shouldSwap =
    Math.abs(rawLineDx) >= Math.abs(rawLineDy)
      ? rawLineDx < 0
      : rawLineDy < 0;
  if (shouldSwap) {
    [a, b] = [b, a];
    [legStartPoint, legEndPoint] = [legEndPoint, legStartPoint];
  }
  const lineDx = b.x - a.x;
  const lineDy = b.y - a.y;
  const lineLength = Math.hypot(lineDx, lineDy);
  if (lineLength < 8) return;
  const lineUx = lineDx / lineLength;
  const lineUy = lineDy / lineLength;
  const lineNx = -lineUy;
  const lineNy = lineUx;
  const aLeg = normalizeScreenVector(a.x - legStartPoint.x, a.y - legStartPoint.y, nx * extensionSign, ny * extensionSign);
  const bLeg = normalizeScreenVector(b.x - legEndPoint.x, b.y - legEndPoint.y, nx * extensionSign, ny * extensionSign);
  const aExtension = { x: a.x + aLeg.x * extension, y: a.y + aLeg.y * extension };
  const bExtension = { x: b.x + bLeg.x * extension, y: b.y + bLeg.y * extension };
  const metrics = segmentMetrics(start.x, start.y, end.x, end.y);
  let displayLength = metrics.length;
  if (Number.isFinite(options.displayLength)) {
    displayLength = options.displayLength;
  } else if (options.lineStart && options.lineEnd) {
    displayLength = Math.round(distanceWorld(options.lineStart, options.lineEnd));
  }
  const displayText = decodeMojibakeText(`${displayLength} мм`);
  const labelGap = annotationPx(15);
  const isVerticalDimension = Math.abs(lineDx) <= Math.max(2, lineLength * 0.08);
  const labelSide = lineNy > 0 ? -1 : 1;
  const label = isVerticalDimension
    ? {
        x: (a.x + b.x) / 2 - labelGap,
        y: (a.y + b.y) / 2,
      }
    : {
        x: (a.x + b.x) / 2 + lineNx * labelSide * labelGap,
        y: (a.y + b.y) / 2 + lineNy * labelSide * labelGap,
      };
  const angle = Math.atan2(lineDy, lineDx);

  ctx.save();
  ctx.strokeStyle = c.dimension;
  ctx.fillStyle = c.dimension;
  ctx.lineWidth = annotationPx(options.active ? 1.8 : 1.45);
  ctx.setLineDash(options.active ? [7, 5] : []);

  linePath(legStartPoint.x, legStartPoint.y, aExtension.x, aExtension.y);
  linePath(legEndPoint.x, legEndPoint.y, bExtension.x, bExtension.y);
  ctx.setLineDash([]);
  linePath(a.x, a.y, b.x, b.y);
  drawDimensionArrow(a, lineUx, lineUy, arrowSize, c);
  drawDimensionArrow(b, -lineUx, -lineUy, arrowSize, c);

  ctx.translate(label.x, label.y);
  let textAngle = isVerticalDimension ? -Math.PI / 2 : angle;
  if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
  ctx.rotate(textAngle);
  ctx.font = annotationFont(700, 12);
  ctx.lineWidth = annotationPx(4);
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
  const selected = canShowEntitySelection() && entity.id === state.selectedId;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((entity.rotation * Math.PI) / 180);
  ctx.scale((entity.flipX ? -1 : 1) * state.view.scale, state.view.scale);
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
  return false;
}

function drawSofaLibrarySymbol(w, h) {
  drawParametricSofa(w, h);
  return true;
}

function drawSectionalLibrarySymbol(w, h) {
  drawParametricSectional(w, h);
  return true;
}

function drawParametricSofa(w, h) {
  const arm = Math.min(260, Math.max(150, h * 0.22));
  const back = Math.min(180, Math.max(95, h * 0.16));
  const pad = Math.min(95, Math.max(42, h * 0.07));
  const radius = Math.min(90, h * 0.12);
  const seatTop = -h / 2 + back + pad * 0.35;
  const seatBottom = h / 2 - pad;
  const seatHeight = Math.max(160, seatBottom - seatTop);
  const innerX = -w / 2 + arm;
  const innerW = Math.max(240, w - arm * 2);
  const seats = Math.max(2, Math.min(8, Math.round(innerW / 760)));
  const seatW = innerW / seats;

  ctx.save();
  roundedRect(-w / 2, -h / 2, w, h, radius, true);
  ctx.stroke();
  roundedRect(-w / 2 + pad * 0.35, -h / 2 + pad * 0.35, w - pad * 0.7, back, Math.min(45, back * 0.35), true);
  ctx.stroke();
  roundedRect(-w / 2 + pad * 0.35, -h / 2 + back * 0.35, arm - pad * 0.5, h - back * 0.35 - pad * 0.7, radius * 0.75, true);
  ctx.stroke();
  roundedRect(w / 2 - arm + pad * 0.15, -h / 2 + back * 0.35, arm - pad * 0.5, h - back * 0.35 - pad * 0.7, radius * 0.75, true);
  ctx.stroke();
  for (let i = 0; i < seats; i += 1) {
    const x = innerX + i * seatW + pad * 0.18;
    roundedRect(x, seatTop, seatW - pad * 0.36, seatHeight, Math.min(38, seatHeight * 0.14), true);
    ctx.stroke();
    if (i > 0) {
      linePath(innerX + i * seatW, seatTop + pad * 0.2, innerX + i * seatW, seatBottom - pad * 0.2);
    }
  }
  ctx.restore();
}

function drawParametricSectional(w, h) {
  const chaiseW = Math.min(w * 0.42, Math.max(760, h * 0.62));
  const sofaH = Math.max(520, h * 0.48);
  ctx.save();
  drawParametricSofa(w, sofaH);
  ctx.translate(-w / 2 + chaiseW / 2, h * 0.13);
  const oldLineWidth = ctx.lineWidth;
  ctx.lineWidth = oldLineWidth;
  drawParametricSofa(chaiseW, Math.max(sofaH, h * 0.74));
  ctx.restore();
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
    ctx.font = annotationFont(600, 12);
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
  ctx.font = annotationFont(700, 10);
  const width = ctx.measureText(text).width + annotationPx(12);
  const height = annotationPx(18);
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  roundedRect(-width / 2, -height / 2, width, height, annotationPx(6));
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
  if (entity.type === "circle") {
    const center = worldToScreen({ x: entity.cx, y: entity.cy });
    const radius = Math.abs(entity.radius) * state.view.scale;
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    drawHandle(center.x + radius, center.y, c);
    drawBadge(`R ${Math.round(Math.abs(entity.radius))} мм`, center.x, center.y - radius - 18, c);
    ctx.restore();
    return;
  }
  if (entity.type === "rectangle") {
    const corners = rectangleCorners(entity).map(worldToScreen);
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();
    corners.forEach((point) => drawHandle(point.x, point.y, c));
    ctx.restore();
    return;
  }
  if (entity.type === "arc") {
    const arc = arcGeometry(entity.start, entity.through, entity.end);
    if (!arc) return;
    const center = worldToScreen(arc.center);
    const radius = arc.radius * state.view.scale;
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, arc.startAngle, arc.endAngle, arc.counterClockwise);
    ctx.stroke();
    [entity.start, entity.through, entity.end].map(worldToScreen).forEach((point) => drawHandle(point.x, point.y, c));
    const label = worldToScreen(entity.through);
    drawBadge("Дуга", label.x, label.y - 24, c);
    ctx.restore();
    return;
  }
  if (entity.layer === "dimensions") {
    drawDimensionSelection(entity, c);
    return;
  }
  const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
  const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
  const startActive = state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "start";
  const endActive = state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "end";
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  linePath(p1.x, p1.y, p2.x, p2.y);
  drawEndpointHandle(p1, startActive, c);
  drawEndpointHandle(p2, endActive, c);
  if (!startActive && !endActive) {
    const m = midpoint(p1, p2);
    const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
    drawBadge(`${metrics.length} мм`, m.x, m.y - 24, c, false, true);
  }
}

function drawAngularDimensionEntity(entity, c, options = {}) {
  const vertex = entity.vertex;
  const p1World = entity.arm1;
  const p2World = entity.arm2;
  if (!vertex || !p1World || !p2World) return;
  const v = worldToScreen(vertex);
  const p1 = worldToScreen(p1World);
  const p2 = worldToScreen(p2World);
  const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
  const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
  const delta = signedAngleDelta(a1, a2);
  const radius = Math.max(annotationPx(28), Math.min(annotationPx(84), Math.min(pointDistance(v, p1), pointDistance(v, p2)) * 0.52));
  const mid = a1 + delta / 2;
  const degrees = Math.round(Math.abs(radToDeg(delta)));
  ctx.save();
  ctx.strokeStyle = c.dimension;
  ctx.fillStyle = c.dimension;
  ctx.lineWidth = annotationPx(options.active ? 1.8 : 1.45);
  linePath(v.x, v.y, p1.x, p1.y);
  linePath(v.x, v.y, p2.x, p2.y);
  ctx.beginPath();
  ctx.arc(v.x, v.y, radius, a1, a1 + delta, delta < 0);
  ctx.stroke();
  drawBadge(`${degrees}°`, v.x + Math.cos(mid) * (radius + annotationPx(18)), v.y + Math.sin(mid) * (radius + annotationPx(18)), c, true);
  ctx.restore();
}

function drawSelectionDrag(c) {
  const drag = state.selectionDrag;
  if (!drag) return;
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.lineWidth = 1.4;
  ctx.setLineDash([7, 5]);
  if (drag.type === "window") {
    const x = Math.min(drag.start.x, drag.current.x);
    const y = Math.min(drag.start.y, drag.current.y);
    const width = Math.abs(drag.current.x - drag.start.x);
    const height = Math.abs(drag.current.y - drag.start.y);
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 1;
    ctx.strokeRect(x, y, width, height);
    const mode = drag.current.x >= drag.start.x ? "Window" : "Crossing";
    drawBadge(mode, x + width / 2, y - 18, c, true);
  } else if (drag.type === "lasso" && drag.points.length > 1) {
    ctx.beginPath();
    drag.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    const last = drag.points.at(-1);
    drawBadge("Lasso", last.x, last.y - 18, c, true);
  }
  ctx.restore();
}

function drawDimensionSelection(entity, c) {
  if (entity.dimensionKind === "leader") {
    const geometry = leaderScreenGeometry(entity);
    const { arrow, connector, rect } = geometry;
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    linePath(arrow.x, arrow.y, connector.x, connector.y);
    ctx.setLineDash([6, 5]);
    roundedRect(rect.x, rect.y, rect.width, rect.height, annotationPx(5));
    ctx.setLineDash([]);
    drawEndpointHandle(arrow, state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "start", c);
    drawHandle(rect.x + rect.width / 2, rect.y + rect.height / 2, c);
    ctx.restore();
    return;
  }
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
  const selectedDimensionIds = new Set(selectedEntities().filter((entity) => entity.layer === "dimensions").map((entity) => entity.id));
  if (!selectedDimensionIds.size) return null;
  const hits = [];
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (entity.layer !== "dimensions" || !isLayerVisible(entity.layer)) continue;
    if (!selectedDimensionIds.has(entity.id)) continue;
    if (entity.dimensionKind === "leader") {
      const geometry = leaderScreenGeometry(entity);
      const arrowDistance = pointDistance(screen, geometry.arrow);
      const boxDistance = screenRectDistance(screen, geometry.rect);
      const lineDistance = pointToSegmentDistance(screen, geometry.arrow, geometry.connector);
      if (arrowDistance <= 22) hits.push({ type: "leader-arrow", entity, score: arrowDistance, order: i });
      if (boxDistance <= 18) hits.push({ type: "leader-box", entity, score: boxDistance + 4, order: i });
      if (lineDistance <= 14) hits.push({ type: "leader-box", entity, score: lineDistance + 18, order: i });
      continue;
    }
    const geometry = dimensionScreenGeometry(entity);
    if (!geometry) continue;
    const startDistance = pointDistance(screen, geometry.a);
    const endDistance = pointDistance(screen, geometry.b);
    const lineDistance = pointToSegmentDistance(screen, geometry.a, geometry.b);
    const legStartDistance = pointToSegmentDistance(screen, geometry.legStart.p1, geometry.legStart.p2);
    const legEndDistance = pointToSegmentDistance(screen, geometry.legEnd.p1, geometry.legEnd.p2);
    if (startDistance <= 20) hits.push({ type: `dimension-${geometry.aEndpoint}`, entity, score: startDistance, order: i });
    if (endDistance <= 20) hits.push({ type: `dimension-${geometry.bEndpoint}`, entity, score: endDistance, order: i });
    if (lineDistance <= 18) hits.push({ type: "dimension-offset", entity, score: lineDistance + 12, order: i });
    if (legStartDistance <= 16) hits.push({ type: `dimension-${geometry.legStart.endpoint}`, entity, score: legStartDistance + 18, order: i });
    if (legEndDistance <= 16) hits.push({ type: `dimension-${geometry.legEnd.endpoint}`, entity, score: legEndDistance + 18, order: i });
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
  if (entity.dimensionKind === "leader" || entity.dimensionKind === "angular") return null;
  const geometry = dimensionWorldGeometry(entity);
  let a = worldToScreen(geometry.lineStart);
  let b = worldToScreen(geometry.lineEnd);
  let legStartPoint = worldToScreen(geometry.start);
  let legEndPoint = worldToScreen(geometry.end);
  let aEndpoint = "start";
  let bEndpoint = "end";
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 8) return null;
  const shouldSwap = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
  if (shouldSwap) {
    [a, b] = [b, a];
    [legStartPoint, legEndPoint] = [legEndPoint, legStartPoint];
    [aEndpoint, bEndpoint] = [bEndpoint, aEndpoint];
  }
  const lineDx = b.x - a.x;
  const lineDy = b.y - a.y;
  const lineLength = Math.hypot(lineDx, lineDy);
  if (lineLength < 8) return null;
  const nx = -(lineDy / lineLength);
  const ny = lineDx / lineLength;
  const labelSide = geometry.offset < 0 ? -1 : 1;
  const labelGap = 15;
  return {
    a,
    b,
    aEndpoint,
    bEndpoint,
    legStart: { p1: legStartPoint, p2: a, endpoint: aEndpoint },
    legEnd: { p1: legEndPoint, p2: b, endpoint: bEndpoint },
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
  markProjectDirty("dimension-offset");
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
    label: "Размерная линия",
    point: { x: best.x, y: best.y },
    segment: best.segment,
  };
  return { x: best.x, y: best.y };
}

function dimensionOffsetWithAlignmentSnap(start, end, point) {
  state.dimensionSnapHint = null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return dimensionOffsetFromPoint(start, end, point);
  const axis = { x: dx / length, y: dy / length };
  const normal = { x: -axis.y, y: axis.x };
  const rawOffset = dimensionOffsetFromPoint(start, end, point);
  const threshold = 28 / state.view.scale;
  let best = null;

  for (const candidate of state.entities) {
    if (candidate.layer !== "dimensions" || !isLayerVisible(candidate.layer)) continue;
    const geometry = dimensionWorldGeometry(candidate);
    const candidateAxis = normalizeWorldVector(geometry.lineEnd.x - geometry.lineStart.x, geometry.lineEnd.y - geometry.lineStart.y);
    if (!candidateAxis) continue;
    const parallelScore = Math.abs(axis.x * candidateAxis.y - axis.y * candidateAxis.x);
    if (parallelScore > 0.12) continue;
    const candidateOffset = (geometry.lineStart.x - start.x) * normal.x + (geometry.lineStart.y - start.y) * normal.y;
    const distance = Math.abs(rawOffset - candidateOffset);
    if (distance > threshold) continue;
    const score = distance + parallelScore * 240;
    if (!best || score < best.score) {
      const projection = projectPointToSegmentWorld(point, geometry.lineStart, geometry.lineEnd);
      best = {
        offset: candidateOffset,
        score,
        point: { x: projection.x, y: projection.y },
        segment: { p1: geometry.lineStart, p2: geometry.lineEnd },
      };
    }
  }

  if (!best) return rawOffset;
  state.dimensionSnapHint = {
    type: "line",
    label: "Выравнивание",
    point: best.point,
    segment: best.segment,
  };
  return best.offset;
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
    if (state.furnitureResizeHandlesId === entity.id) {
      if (layout.showResizeControls) {
        drawFurnitureResizeHandle(layout.resizeHandles.widthStart, "↔", c);
        drawFurnitureResizeHandle(layout.resizeHandles.widthEnd, "↔", c);
        drawFurnitureResizeHandle(layout.resizeHandles.depthStart, "↕", c);
        drawFurnitureResizeHandle(layout.resizeHandles.depthEnd, "↕", c);
      }
    } else if (state.furnitureProportionalHandlesId === entity.id) {
      if (layout.showResizeControls) {
        for (const handle of Object.values(layout.proportionalHandles)) {
          drawFurnitureProportionalHandle(handle, c);
        }
      }
    } else if (layout.showEditControls) {
      drawFurnitureActionButton(layout.resizeToggle, "↔", c);
      drawFurnitureActionButton(layout.rotate, "↻", c);
      drawFurnitureActionButton(layout.proportionalToggle, "⤢", c);
    }
    if (layout.showEditControls) {
      drawFurnitureSideDimensions(entity, layout, c);
    }
  }
  ctx.restore();
}

function drawBlockPreview(entity, c) {
  const corners = blockCorners(entity).map(worldToScreen);
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawFurnitureActionButton(control, label, c) {
  label = decodeMojibakeText(String(label));
  ctx.save();
  ctx.fillStyle = c.surface;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = screenUiPx(2);
  ctx.beginPath();
  ctx.arc(control.x, control.y, screenUiPx(17), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = c.accent;
  ctx.font = screenUiFont(800, label === "..." ? 18 : 19);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, control.x, control.y + (label === "..." ? -3 : 1));
  ctx.restore();
}

function drawFurnitureResizeHandle(control, label, c) {
  if (!control) return;
  const width = screenUiPx(control.axis === "height" ? 34 : 48);
  const height = screenUiPx(control.axis === "height" ? 48 : 34);
  const rect = {
    x: control.x - width / 2,
    y: control.y - height / 2,
    width,
    height,
  };
  ctx.save();
  ctx.translate(control.x, control.y);
  ctx.rotate(control.angle || 0);
  ctx.translate(-control.x, -control.y);
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = screenUiPx(2);
  roundedRect(rect.x, rect.y, rect.width, rect.height, screenUiPx(8), true);
  ctx.fillStyle = c.accent;
  ctx.font = screenUiFont(800, 18);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, control.x, control.y + 1);
  ctx.restore();
}

function drawFurnitureProportionalHandle(control, c) {
  if (!control) return;
  const size = screenUiPx(18);
  ctx.save();
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = screenUiPx(2);
  roundedRect(control.x - size / 2, control.y - size / 2, size, size, screenUiPx(4), true);
  ctx.fillStyle = c.accent;
  ctx.font = screenUiFont(900, 12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("⤢", control.x, control.y + 0.5);
  ctx.restore();
}

function drawFurnitureSideDimensions(entity, layout, c) {
  if (!layout?.corners?.length) return;
  const dimensions = furnitureDimensionSegments(entity, layout);
  drawFurnitureScreenDimension(dimensions.width.screenStart, dimensions.width.screenEnd, Math.round(entitySize(entity).width), c, state.activeFurnitureDimension === "width");
  drawFurnitureScreenDimension(dimensions.height.screenStart, dimensions.height.screenEnd, Math.round(entitySize(entity).height), c, state.activeFurnitureDimension === "height");
}

function drawFurnitureScreenDimension(a, b, value, c, active = false) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < screenUiPx(28)) return;
  const mid = midpoint(a, b);
  const text = `${value} мм`;
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.translate(mid.x, mid.y);
  let textAngle = angle;
  if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
  ctx.rotate(textAngle);
  ctx.font = screenUiFont(850, active ? 12 : 11);
  ctx.lineWidth = screenUiPx(4);
  ctx.strokeStyle = colors().bg;
  ctx.lineJoin = "round";
  ctx.strokeText(text, 0, 1);
  ctx.fillStyle = active ? c.accent : c.dimension;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

function furnitureDimensionSegments(entity, layout = furnitureControlLayout(entity)) {
  const [topLeft, topRight, bottomRight, bottomLeft] = blockCorners(entity);
  const screenOffset = screenUiPx(24);
  const worldOffset = screenOffset / state.view.scale;
  const screenCorners = [topLeft, topRight, bottomRight, bottomLeft].map(worldToScreen);
  const [screenTopLeft, , screenBottomRight, screenBottomLeft] = screenCorners;
  return {
    screenOffset,
    width: {
      start: bottomLeft,
      end: bottomRight,
      lineStart: offsetBlockDimensionPoint(bottomLeft, layout.bottomNormal, worldOffset),
      lineEnd: offsetBlockDimensionPoint(bottomRight, layout.bottomNormal, worldOffset),
      screenStart: offsetScreenPoint(screenBottomLeft, layout.bottomNormal, screenOffset),
      screenEnd: offsetScreenPoint(screenBottomRight, layout.bottomNormal, screenOffset),
    },
    height: {
      start: topLeft,
      end: bottomLeft,
      lineStart: offsetBlockDimensionPoint(topLeft, layout.leftNormal, worldOffset),
      lineEnd: offsetBlockDimensionPoint(bottomLeft, layout.leftNormal, worldOffset),
      screenStart: offsetScreenPoint(screenTopLeft, layout.leftNormal, screenOffset),
      screenEnd: offsetScreenPoint(screenBottomLeft, layout.leftNormal, screenOffset),
    },
  };
}

function offsetBlockDimensionPoint(point, normal, distance) {
  return { x: point.x + normal.x * distance, y: point.y + normal.y * distance };
}

function offsetScreenPoint(point, normal, distance) {
  return { x: point.x + normal.x * distance, y: point.y + normal.y * distance };
}

function drawFurnitureDoneButton(rect, c) {
  drawCanvasButton(rect, "✓", c, true);
}

function drawCanvasButton(rect, text, c, solid = false) {
  text = decodeMojibakeText(String(text));
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = solid ? c.accent : c.surface;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = screenUiPx(1.4);
  roundedRect(rect.x, rect.y, rect.width, rect.height, screenUiPx(9));
  ctx.shadowColor = "transparent";
  ctx.fillStyle = solid ? "#ffffff" : c.accent;
  ctx.font = screenUiFont(800, rect.width < 60 ? 17 : 12);
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
  bbox.width = bbox.maxX - bbox.minX;
  bbox.height = bbox.maxY - bbox.minY;

  const editing = entity.id === state.selectedId && (state.tool === "select" || state.tool === "furniture");
  const minScreenSide = Math.min(bbox.width, bbox.height);
  const maxScreenSide = Math.max(bbox.width, bbox.height);
  const showEditControls = maxScreenSide >= screenUiPx(92) && minScreenSide >= screenUiPx(34);
  const showResizeControls = maxScreenSide >= screenUiPx(72) && minScreenSide >= screenUiPx(22);
  const topLeft = corners[0];
  const topRight = corners[1];
  const bottomRight = corners[2];
  const bottomLeft = corners[3];
  const topMid = midpoint(topLeft, topRight);
  const rightMid = midpoint(topRight, bottomRight);
  const bottomMid = midpoint(bottomRight, bottomLeft);
  const leftMid = midpoint(bottomLeft, topLeft);
  const edgeLength = Math.max(1, pointDistance(topLeft, topRight));
  const tangent = { x: (topRight.x - topLeft.x) / edgeLength, y: (topRight.y - topLeft.y) / edgeLength };
  const normalLength = Math.max(1, pointDistance(topMid, center));
  const normal = { x: (topMid.x - center.x) / normalLength, y: (topMid.y - center.y) / normalLength };
  const rightLength = Math.max(1, pointDistance(rightMid, center));
  const rightNormal = { x: (rightMid.x - center.x) / rightLength, y: (rightMid.y - center.y) / rightLength };
  const bottomLength = Math.max(1, pointDistance(bottomMid, center));
  const bottomNormal = { x: (bottomMid.x - center.x) / bottomLength, y: (bottomMid.y - center.y) / bottomLength };
  const leftLength = Math.max(1, pointDistance(leftMid, center));
  const leftNormal = { x: (leftMid.x - center.x) / leftLength, y: (leftMid.y - center.y) / leftLength };
  const cornerOffset = 18;
  const handleOffset = 18;
  const resizeToggle = {
    x: topRight.x + normal.x * cornerOffset + tangent.x * cornerOffset,
    y: topRight.y + normal.y * cornerOffset + tangent.y * cornerOffset,
  };
  const rotate = {
    x: bottomLeft.x - normal.x * cornerOffset - tangent.x * cornerOffset,
    y: bottomLeft.y - normal.y * cornerOffset - tangent.y * cornerOffset,
  };
  const proportionalToggle = {
    x: bottomRight.x - normal.x * cornerOffset + tangent.x * cornerOffset,
    y: bottomRight.y - normal.y * cornerOffset + tangent.y * cornerOffset,
  };
  const resizeHandles = {
    widthStart: {
      x: leftMid.x + leftNormal.x * handleOffset,
      y: leftMid.y + leftNormal.y * handleOffset,
      axis: "width",
      side: "left",
      angle: Math.atan2(tangent.y, tangent.x),
    },
    widthEnd: {
      x: rightMid.x + rightNormal.x * handleOffset,
      y: rightMid.y + rightNormal.y * handleOffset,
      axis: "width",
      side: "right",
      angle: Math.atan2(tangent.y, tangent.x),
    },
    depthStart: {
      x: topMid.x + normal.x * handleOffset,
      y: topMid.y + normal.y * handleOffset,
      axis: "height",
      side: "top",
      angle: Math.atan2(normal.y, normal.x) + Math.PI / 2,
    },
    depthEnd: {
      x: bottomMid.x + bottomNormal.x * handleOffset,
      y: bottomMid.y + bottomNormal.y * handleOffset,
      axis: "height",
      side: "bottom",
      angle: Math.atan2(normal.y, normal.x) + Math.PI / 2,
    },
  };
  const proportionalHandles = {
    nw: { x: topLeft.x + normal.x * handleOffset + leftNormal.x * handleOffset, y: topLeft.y + normal.y * handleOffset + leftNormal.y * handleOffset, side: "nw" },
    ne: { x: topRight.x + normal.x * handleOffset + rightNormal.x * handleOffset, y: topRight.y + normal.y * handleOffset + rightNormal.y * handleOffset, side: "ne" },
    se: { x: bottomRight.x + bottomNormal.x * handleOffset + rightNormal.x * handleOffset, y: bottomRight.y + bottomNormal.y * handleOffset + rightNormal.y * handleOffset, side: "se" },
    sw: { x: bottomLeft.x + bottomNormal.x * handleOffset + leftNormal.x * handleOffset, y: bottomLeft.y + bottomNormal.y * handleOffset + leftNormal.y * handleOffset, side: "sw" },
  };
  return { corners, center, bbox, editing, resizeToggle, rotate, proportionalToggle, resizeHandles, proportionalHandles, showEditControls, showResizeControls, bottomNormal, leftNormal };
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
  let end = state.drawing.lockedEnd ? state.drawing.end : cursorWorld();
  end = dimensionAdjustedEnd(start, end);
  state.drawing.end = end;
  if (state.tool === "circle") {
    drawActiveCircle(start, end, c);
    return;
  }
  if (state.tool === "rectangle") {
    drawActiveRectangle(start, end, c);
    return;
  }
  if (state.tool === "arc") {
    drawActiveArc(c);
    return;
  }
  const p1 = worldToScreen(start);
  const p2 = worldToScreen(end);
  const metrics = segmentMetrics(start.x, start.y, end.x, end.y);
  const angleInfo = activeAngleInfo(start, end);
  const m = midpoint(p1, p2);

  if (state.tool === "dimension") {
    if (state.dimensionTool === "angular") {
      drawActiveAngularDimension(c);
      return;
    }
    if (state.dimensionTool === "leader") {
      drawLeaderEntity(leaderEntity("preview", start, end, state.drawing.text || "Текст"), c, { active: true });
      drawHandle(p1.x, p1.y, c);
      drawHandle(p2.x, p2.y, c);
      hideInlineEditors();
      return;
    }
    const offset =
      state.drawing.phase === "offset"
        ? dimensionOffsetWithAlignmentSnap(start, end, rawCursorWorld()) * state.view.scale
        : undefined;
    drawDimensionGeometry(start, end, c, { active: false, offset });
    drawHandle(p1.x, p1.y, c);
    drawHandle(p2.x, p2.y, c);
    hideInlineEditors();
    return;
  }

  drawEditableSegment(start, end, c, { lineWidth: state.tool === "wall" ? 5 : 2.2 });
  updateInlineEditors({ start, end, p1, p2, midpoint: m, metrics, angleInfo });
}

function drawEditableSegment(start, end, c, options = {}) {
  const p1 = worldToScreen(start);
  const p2 = worldToScreen(end);
  const angleInfo = activeAngleInfo(start, end);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = options.lineWidth || 2.2;
  if (options.dashed) ctx.setLineDash([8, 6]);
  linePath(p1.x, p1.y, p2.x, p2.y);
  ctx.setLineDash([]);
  drawHandle(p1.x, p1.y, c);
  drawHandle(p2.x, p2.y, c);
  ctx.restore();
  const angleLabelPoint = drawAngleArc(p1, p2, angleInfo, c, { label: false });
  if (angleLabelPoint) {
    positionAngleEditor(angleLabelPoint.x, angleLabelPoint.y, angleInfo.degrees);
  }
}

function drawActiveAngularDimension(c) {
  const drawing = state.drawing;
  if (!drawing?.start) return;
  const current = cursorWorld();
  const vertex = drawing.start;
  const arm1 = drawing.arm1 || current;
  const arm2 = drawing.arm1 ? current : null;
  const v = worldToScreen(vertex);
  const p1 = worldToScreen(arm1);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.8;
  drawHandle(v.x, v.y, c);
  drawHandle(p1.x, p1.y, c);
  linePath(v.x, v.y, p1.x, p1.y);
  if (arm2) {
    const p2 = worldToScreen(arm2);
    drawHandle(p2.x, p2.y, c);
    drawAngularDimensionEntity(angularDimensionEntity("preview", vertex, arm1, arm2), c, { active: true });
  } else {
    drawBadge("Угол: вторая сторона", p1.x, p1.y - 22, c, true);
  }
  ctx.restore();
  hideInlineEditors();
}

function drawActiveCircle(centerWorld, edgeWorld, c) {
  const center = worldToScreen(centerWorld);
  const edge = worldToScreen(edgeWorld);
  const radius = distanceWorld(centerWorld, edgeWorld);
  const mid = midpoint(center, edge);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * state.view.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.78;
  ctx.setLineDash([6, 5]);
  linePath(center.x, center.y, edge.x, edge.y);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  drawHandle(center.x, center.y, c);
  drawHandle(edge.x, edge.y, c);
  ctx.restore();
  inlineEditors.hidden = false;
  state.inlineEdit = { start: centerWorld, end: edgeWorld, metrics: { length: Math.round(radius), angle: 0 } };
  if (document.activeElement !== lengthInput) lengthInput.value = Math.round(radius);
  syncInlineEditorWidth(lengthInput);
  positionInlineEditor(lengthEditor, mid.x, mid.y - 18);
  if (angleEditor) angleEditor.hidden = true;
  updateTopMetricInputs(Math.round(radius), 0);
}
function drawActiveRectangle(start, end, c) {
  drawRectangleEntity(rectangleEntity("preview", start.x, start.y, end.x, end.y), { ...c, line: c.accent });
  const center = worldToScreen({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
  drawBadge(`${Math.round(Math.abs(end.x - start.x))} × ${Math.round(Math.abs(end.y - start.y))}`, center.x, center.y - 18, c);
  updateTopMetricInputs(Math.round(Math.abs(end.x - start.x)), Math.round(Math.abs(end.y - start.y)));
}

function drawActiveArc(c) {
  const drawing = state.drawing;
  const current = drawing.lockedEnd ? drawing.end : cursorWorld();
  const pStart = worldToScreen(drawing.start);
  const pCurrent = worldToScreen(current);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([8, 6]);
  if (!drawing.arcEnd) {
    linePath(pStart.x, pStart.y, pCurrent.x, pCurrent.y);
    drawBadge("\u041a\u043e\u043d\u0435\u0446 \u0434\u0443\u0433\u0438", pCurrent.x, pCurrent.y - 22, c);
  } else {
    ctx.setLineDash([]);
    const through = arcThroughFromMidBulge(drawing.start, drawing.arcEnd, current);
    const chordMid = midpoint(drawing.start, drawing.arcEnd);
    const pThrough = worldToScreen(through);
    const pChordMid = worldToScreen(chordMid);
    drawArcEntity(arcEntity("preview", drawing.start, through, drawing.arcEnd), { ...c, line: c.accent });
    const pEnd = worldToScreen(drawing.arcEnd);
    drawHandle(pEnd.x, pEnd.y, c);
    ctx.setLineDash([6, 5]);
    ctx.globalAlpha = 0.7;
    linePath(pChordMid.x, pChordMid.y, pThrough.x, pThrough.y);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    drawHandle(pThrough.x, pThrough.y, c);
  }
  ctx.setLineDash([]);
  drawHandle(pStart.x, pStart.y, c);
  if (!drawing.arcEnd) drawHandle(pCurrent.x, pCurrent.y, c);
  ctx.restore();
}
function drawAngleArc(origin, target, angleInfo, c, options = {}) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const screenLength = Math.hypot(dx, dy);
  if (screenLength < 34) return null;

  const ux = dx / screenLength;
  const uy = dy / screenLength;
  const followsCursor = screenLength > annotationPx(150);
  const centerOffset = followsCursor ? Math.min(screenLength * 0.42, annotationPx(118)) : 0;
  const arcOrigin = followsCursor
    ? { x: target.x - ux * centerOffset, y: target.y - uy * centerOffset }
    : origin;
  const radius = Math.min(annotationPx(54), Math.max(annotationPx(32), screenLength * 0.32));
  const startRad = angleInfo.referenceRad;
  const endRad = angleInfo.referenceRad + angleInfo.deltaRad;
  const labelRad = angleInfo.referenceRad + angleInfo.deltaRad / 2;
  const label = {
    x: arcOrigin.x + Math.cos(labelRad) * radius,
    y: arcOrigin.y + Math.sin(labelRad) * radius,
  };

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = annotationPx(0.65);
  ctx.setLineDash([1, 6]);
  linePath(
    arcOrigin.x,
    arcOrigin.y,
    arcOrigin.x + Math.cos(startRad) * (radius + annotationPx(14)),
    arcOrigin.y + Math.sin(startRad) * (radius + annotationPx(14)),
  );
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = annotationPx(0.65);
  ctx.setLineDash([1, 5]);
  ctx.beginPath();
  ctx.arc(arcOrigin.x, arcOrigin.y, radius, startRad, endRad, angleInfo.deltaRad < 0);
  ctx.stroke();
  ctx.setLineDash([]);

  if (options.label !== false) {
    drawBadge(`${angleInfo.degrees}°`, label.x, label.y, c, true);
  }
  ctx.restore();
  return label;
}

function drawArcArrow(point, angleRad, direction, c) {
  const tangent = angleRad + (direction >= 0 ? Math.PI / 2 : -Math.PI / 2);
  const size = annotationPx(7);
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
  if (document.activeElement !== lengthInput) {
    lengthInput.value = metrics.length;
  }
  syncInlineEditorWidth(lengthInput);
  positionInlineEditor(lengthEditor, m.x, m.y - 28);
  if (document.activeElement !== angleInput) {
    angleInput.value = angleInfo.degrees;
    syncInlineEditorWidth(angleInput);
  }
  updateTopMetricInputs(metrics.length, state.tool === "dimension" ? metrics.angle : angleInfo.degrees);
  if (drawMetrics) drawMetrics.hidden = true;
}

function positionAngleEditor(x, y, value) {
  if (angleEditor) angleEditor.hidden = false;
  if (document.activeElement !== angleInput) {
    angleInput.value = value;
  }
  syncInlineEditorWidth(angleInput);
  const adjusted = avoidEditorOverlapPoint(angleEditor, x, y, lengthEditor);
  positionInlineEditor(angleEditor, adjusted.x, adjusted.y);
}

function avoidEditorOverlapPoint(editor, x, y, avoidEditor) {
  if (!editor || !avoidEditor || avoidEditor.hidden || !avoidEditor.style.left || !avoidEditor.style.top) {
    return { x, y };
  }
  const editorWidth = editor.offsetWidth || 54;
  const editorHeight = editor.offsetHeight || 28;
  const avoidWidth = avoidEditor.offsetWidth || 84;
  const avoidHeight = avoidEditor.offsetHeight || 28;
  const avoidX = parseFloat(avoidEditor.style.left);
  const avoidY = parseFloat(avoidEditor.style.top);
  const overlapX = Math.abs(x - avoidX) < (editorWidth + avoidWidth) / 2 + 6;
  const overlapY = Math.abs(y - avoidY) < (editorHeight + avoidHeight) / 2 + 4;
  if (!overlapX || !overlapY) return { x, y };
  const rect = canvas.getBoundingClientRect();
  const offset = Math.max(18, Math.min(24, editorHeight * 0.75));
  const upY = y - offset;
  const downY = y + offset;
  const canMoveUp = upY > editorHeight / 2 + 8;
  const canMoveDown = downY < rect.height - editorHeight / 2 - 8;
  if (canMoveUp && Math.abs(upY - avoidY) >= Math.abs(downY - avoidY)) return { x, y: upY };
  if (canMoveDown) return { x, y: downY };
  if (canMoveUp) return { x, y: upY };
  return { x, y };
}

function updateTopMetricInputs(length, angle) {
  if (!drawMetrics || !topLengthInput || !topAngleInput) return;
  drawMetrics.hidden = false;
  updateTopMetricLabels();
  if (document.activeElement !== topLengthInput) {
    topLengthInput.value = length;
  }
  if (document.activeElement !== topAngleInput) {
    topAngleInput.value = angle;
  }
  syncInlineEditorWidth(topLengthInput);
  syncInlineEditorWidth(topAngleInput);
}

function updateTopMetricLabels() {
  if (!drawMetrics || !topLengthInput || !topAngleInput) return;
  const labels = drawMetrics.querySelectorAll("label");
  const firstText = labels[0]?.querySelector("span");
  const firstUnit = labels[0]?.querySelector("em");
  const secondText = labels[1]?.querySelector("span");
  let secondUnit = labels[1]?.querySelector("em");
  if (!secondUnit && labels[1]) {
    secondUnit = document.createElement("em");
    labels[1].append(secondUnit);
  }
  const rectangleMode = !drawMetrics.hidden && state.tool === "rectangle" && state.drawing;
  if (firstText) firstText.textContent = rectangleMode ? "Д" : "L";
  if (firstUnit) firstUnit.textContent = "мм";
  if (secondText) secondText.textContent = rectangleMode ? "Ш" : "°";
  if (secondUnit) {
    secondUnit.textContent = rectangleMode ? "мм" : "";
    secondUnit.hidden = !rectangleMode;
  }
  topLengthInput.setAttribute("aria-label", rectangleMode ? "Длина прямоугольника" : "Длина");
  topAngleInput.setAttribute("aria-label", rectangleMode ? "Ширина прямоугольника" : "Угол");
}

function updateSelectedEndpointEditors(previewMoving = null) {
  const geometry = selectedEndpointGeometry();
  if (!geometry || !inlineEditors) return;
  const { fixed, moving } = geometry;
  const displayMoving = previewMoving || moving;
  const metrics = segmentMetrics(fixed.x, fixed.y, displayMoving.x, displayMoving.y);
  const angleInfo = activeAngleInfo(fixed, displayMoving);
  const p1 = worldToScreen(fixed);
  const p2 = worldToScreen(displayMoving);
  const m = midpoint(p1, p2);
  inlineEditors.hidden = false;
  state.inlineEdit = { start: fixed, end: displayMoving, metrics, angleInfo };
  if (document.activeElement !== lengthInput) {
    lengthInput.value = metrics.length;
  }
  if (document.activeElement !== angleInput) {
    angleInput.value = angleInfo.degrees;
  }
  updateTopMetricInputs(metrics.length, angleInfo.degrees);
  if (drawMetrics) drawMetrics.hidden = true;
  syncInlineEditorWidth(lengthInput);
  syncInlineEditorWidth(angleInput);
  positionInlineEditor(lengthEditor, m.x, m.y - 28);
  if (angleEditor) angleEditor.hidden = true;
}

function selectedEndpointGeometry() {
  const endpoint = state.selectedEndpoint;
  if (!endpoint) return null;
  const entity = state.entities.find((item) => item.id === endpoint.entityId);
  if (!entity || entity.type === "block") return null;
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  return endpoint.point === "start"
    ? { entity, fixed: end, moving: start }
    : { entity, fixed: start, moving: end };
}

function setSelectedEndpointPosition(point) {
  const endpoint = state.selectedEndpoint;
  const entity = endpoint ? state.entities.find((item) => item.id === endpoint.entityId) : null;
  if (!entity || entity.type === "block") return;
  if (endpoint.point === "start") {
    entity.x1 = point.x;
    entity.y1 = point.y;
  } else {
    entity.x2 = point.x;
    entity.y2 = point.y;
  }
  markProjectDirty("endpoint");
}

function commitSelectedEndpointCursorPoint(beforeOverride = null) {
  const geometry = selectedEndpointGeometry();
  if (!geometry) return false;
  const { entity } = geometry;
  const before = beforeOverride || state.endpointEditBefore || entityGeometry(entity);
  const point = cursorWorld();
  setSelectedEndpointPosition(point);
  const after = entityGeometry(entity);
  if (geometryChanged(before, after)) {
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    markProjectDirty("endpoint-place");
  }
  state.endpointEditBefore = null;
  state.selectedEndpoint = null;
  hideInlineEditors();
  resetSnapTracking();
  statusChip.textContent = "Конец линии обновлен";
  draw();
  return true;
}

function syncInlineEditorWidth(input) {
  if (!input) return;
  const length = String(input.value || input.placeholder || "").length;
  input.style.setProperty("--value-width", `${Math.max(2, Math.min(7, length + 0.5))}ch`);
}

function selectInlineValue(input) {
  window.setTimeout(() => input.select(), 0);
}

function editableEntityForNumericInput() {
  if (state.selectedEndpoint) return selectedEndpointGeometry()?.entity || null;
  return selectedFurnitureEntity();
}

function beginNumericInputEdit() {
  const entity = editableEntityForNumericInput();
  if (state.numericEdit && state.numericEdit.entityId !== entity?.id) {
    commitNumericInputEdit();
  }
  if (!entity || state.numericEdit?.entityId === entity.id) return;
  state.numericEdit = {
    entityId: entity.id,
    before: entityGeometry(entity),
  };
}

function commitNumericInputEdit() {
  const edit = state.numericEdit;
  if (!edit) return;
  const entity = state.entities.find((item) => item.id === edit.entityId);
  const after = entityGeometry(entity);
  if (geometryChanged(edit.before, after)) {
    state.undo.push({ type: "move", entityId: edit.entityId, before: edit.before, after });
    state.redo.length = 0;
    markProjectDirty("numeric");
  }
  state.numericEdit = null;
}

function finishSelectedEndpointNumericEdit() {
  if (!state.selectedEndpoint) return false;
  state.endpointEditBefore = null;
  state.selectedEndpoint = null;
  hideInlineEditors();
  resetSnapTracking();
  statusChip.textContent = "Размер применен";
  draw();
  return true;
}

function confirmKeyboardInput() {
  const input = document.activeElement;
  if (!keyboardInputs.includes(input)) return;
  const shouldFinishEndpoint = Boolean(
    state.selectedEndpoint && [lengthInput, angleInput, topLengthInput, topAngleInput].includes(input)
  );
  if (input === lengthInput) {
    applyInlineValue("length", { recordUndo: false });
  } else if (input === angleInput) {
    applyInlineValue("angle", { recordUndo: false });
  } else if (input === topLengthInput) {
    applyTopMetricValue("length", { recordUndo: false });
  } else if (input === topAngleInput) {
    applyTopMetricValue("angle", { recordUndo: false });
  } else if ([furnitureWidthInput, furnitureDepthInput, furnitureRotationInput].includes(input)) {
    applyFurnitureSizeInput({ recordUndo: false });
  }
  const shouldFinishDrawing = Boolean(
      state.drawing?.lockedEnd &&
      ["line", "polyline", "wall", "circle", "rectangle"].includes(state.tool) &&
      [lengthInput, angleInput, topLengthInput, topAngleInput].includes(input)
  );
  commitNumericInputEdit();
  if (shouldFinishEndpoint) {
    finishSelectedEndpointNumericEdit();
  }
  input.blur();
  if (keyboardConfirmButton) keyboardConfirmButton.hidden = true;
  if (shouldFinishDrawing && !shouldFinishEndpoint) {
    window.setTimeout(() => commitCursorPoint(), 0);
  }
}

function applyTopMetricValue(kind, options = {}) {
  if (!topLengthInput || !topAngleInput) return;
  lengthInput.value = topLengthInput.value;
  angleInput.value = topAngleInput.value;
  syncInlineEditorWidth(lengthInput);
  syncInlineEditorWidth(angleInput);
  syncInlineEditorWidth(topLengthInput);
  syncInlineEditorWidth(topAngleInput);
  if (state.moveCommand) {
    applyMoveCommandInlineValue(kind);
    return;
  }
  if (state.offsetCommand) {
    applyOffsetCommandInlineValue();
    return;
  }
  if (state.tool === "rectangle" && state.drawing) {
    applyRectangleMetricValue();
    return;
  }
  applyInlineValue(kind, options);
}

function applyRectangleMetricValue() {
  const drawing = state.drawing;
  if (!drawing) return;
  const typedLength = Number(topLengthInput.value.replace(",", "."));
  const typedWidth = Number(topAngleInput.value.replace(",", "."));
  const current = drawing.end || cursorWorld();
  const signX = current.x >= drawing.start.x ? 1 : -1;
  const signY = current.y >= drawing.start.y ? 1 : -1;
  const nextLength = Number.isFinite(typedLength) && typedLength > 0 ? typedLength : Math.abs(current.x - drawing.start.x);
  const nextWidth = Number.isFinite(typedWidth) && typedWidth > 0 ? typedWidth : Math.abs(current.y - drawing.start.y);
  drawing.end = {
    x: drawing.start.x + nextLength * signX,
    y: drawing.start.y + nextWidth * signY,
  };
  drawing.lockedEnd = true;
  draw();
}

function applyOffsetCommandInlineValue() {
  const command = state.offsetCommand;
  if (!command) return;
  const typedLength = Number(topLengthInput.value.replace(",", "."));
  if (!Number.isFinite(typedLength) || typedLength <= 0) return;
  command.distance = typedLength;
  draw();
}

function applyMoveCommandInlineValue(kind) {
  const command = state.moveCommand;
  if (!command?.base) return;
  if (command.mode === "rotate") {
    const typedAngle = Number(topAngleInput.value.replace(",", "."));
    if (!Number.isFinite(typedAngle)) return;
    const length = Math.max(500, Math.hypot((command.end?.x || command.base.x) - command.base.x, (command.end?.y || command.base.y) - command.base.y));
    const referenceRad = command.reference ? angleBetweenPoints(command.base, command.reference) : 0;
    const radians = referenceRad + (typedAngle * Math.PI) / 180;
    command.end = {
      x: command.base.x + Math.cos(radians) * length,
      y: command.base.y + Math.sin(radians) * length,
    };
    command.lockedEnd = true;
    draw();
    return;
  }
  const end = command.end || command.base;
  const currentLength = Math.max(1, Math.hypot(end.x - command.base.x, end.y - command.base.y));
  const currentRad = Math.atan2(end.y - command.base.y, end.x - command.base.x);
  const typedLength = Number(topLengthInput.value.replace(",", "."));
  const typedAngle = Number(topAngleInput.value.replace(",", "."));
  const nextLength = Number.isFinite(typedLength) && typedLength > 0 ? typedLength : currentLength;
  const nextRad = kind === "angle" && Number.isFinite(typedAngle) ? (typedAngle * Math.PI) / 180 : currentRad;
  command.end = {
    x: command.base.x + Math.cos(nextRad) * nextLength,
    y: command.base.y + Math.sin(nextRad) * nextLength,
  };
  command.lockedEnd = true;
  draw();
}

function startMoveLikeCommand(entity, mode) {
  resetSnapTracking();
  state.offsetCommand = null;
  state.moveCommand = {
    entityId: entity.id,
    mode,
    base: null,
    end: null,
    lockedEnd: false,
    before: entityGeometry(entity),
  };
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  hideInlineEditors();
  state.snaps.add("end");
  state.snaps.add("polar");
  syncSnapButtons();
  syncCommandState();
  updateTopMetricInputs(0, 0);
  const label = mode === "copy" ? "Копия" : mode === "rotate" ? "Поворот" : "Переместить";
  statusChip.textContent = `${label}: наведите курсор на базовую точку и тапните`;
  draw();
}

function startOffsetCommand(entity) {
  state.moveCommand = null;
  state.offsetCommand = {
    entityId: entity.id,
    distance: 300,
  };
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  hideInlineEditors();
  state.snaps.add("end");
  syncSnapButtons();
  syncCommandState();
  updateTopMetricInputs(300, 0);
  statusChip.textContent = "Смещение: введите расстояние сверху и тапните с нужной стороны";
  draw();
}

function applySelectionAction(action) {
  const selected = selectedEntities().filter((item) => isLayerVisible(item.layer));
  const actionEntity = selected.length === 1 ? selected[0] : null;
  if (!canApplySelectionAction(action)) return;

  if (action === "delete") {
    const deleted = selected
      .map((item) => ({ entity: item, index: state.entities.findIndex((candidate) => candidate.id === item.id) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => b.index - a.index);
    if (!deleted.length) return;
    for (const item of deleted) state.entities.splice(item.index, 1);
    state.undo.push({ type: "delete-many", items: deleted.map((item) => ({ entity: item.entity, index: item.index })).reverse() });
    state.redo.length = 0;
    markProjectDirty("delete");
    state.selectedId = null;
    state.selectedIds = [];
    state.selectedEndpoint = null;
    state.endpointEditBefore = null;
    statusChip.textContent = deleted.length > 1 ? `Удалено: ${deleted.length}` : "Объект удален";
    hideInlineEditors();
    syncSelectToolMenu();
    draw();
    return;
  }

  if (!actionEntity) return;
  if (action === "move") {
    startMoveLikeCommand(actionEntity, "move");
    return;
  }
  if (action === "resize" && actionEntity.type === "block") {
    state.furnitureResizeHandlesId = state.furnitureResizeHandlesId === actionEntity.id ? null : actionEntity.id;
    state.furnitureEditId = actionEntity.id;
    statusChip.textContent = state.furnitureResizeHandlesId ? "Размер мебели: тяните боковые ручки ширины или глубины" : "Ручки размера скрыты";
    syncSelectToolMenu();
    draw();
    return;
  }
  if (action === "copy") {
    startMoveLikeCommand(actionEntity, "copy");
    return;
  }
  if (action === "offset") {
    startOffsetCommand(actionEntity);
    return;
  }
  if (action === "rotate" && actionEntity.type === "block") {
    startMoveLikeCommand(actionEntity, "rotate");
    return;
  }
  if (action === "mirror" && actionEntity.type === "block") {
    const before = entityGeometry(actionEntity);
    mirrorBlockEntity(actionEntity);
    const after = entityGeometry(actionEntity);
    state.undo.push({ type: "move", entityId: actionEntity.id, before, after });
    state.redo.length = 0;
    markProjectDirty("mirror-block");
    statusChip.textContent = "Мебель отзеркалена";
    draw();
    return;
  }

  const entity = state.entities.find((item) => item.id === state.selectedId);
  if (!entity || entity.type === "block" || entity.layer === "dimensions") return;

  if (action === "move") {
    startMoveLikeCommand(entity, "move");
    return;
  }

  if (action === "copy") {
    startMoveLikeCommand(entity, "copy");
    return;
  }

  if (action === "offset") {
    startOffsetCommand(entity);
    return;
  }

  if (action === "delete") {
    const index = state.entities.findIndex((item) => item.id === entity.id);
    if (index < 0) return;
    state.entities.splice(index, 1);
    state.undo.push({ type: "delete", entity, index });
    state.redo.length = 0;
    markProjectDirty("delete");
    state.selectedId = null;
    state.selectedIds = [];
    state.selectedEndpoint = null;
    statusChip.textContent = "Линия удалена";
    draw();
    return;
  }

  const before = entityGeometry(entity);
  if (action === "rotate") {
    startMoveLikeCommand(entity, "rotate");
    return;
    rotateLinearEntity90(entity);
    statusChip.textContent = "Поворот 90°";
  } else if (action === "mirror") {
    mirrorLinearEntity(entity);
    statusChip.textContent = "Отзеркалено";
  }
  const after = entityGeometry(entity);
  if (geometryChanged(before, after)) {
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    markProjectDirty("selection-action");
  }
  state.selectedEndpoint = null;
  draw();
}

function positionInlineEditor(editor, x, y, avoidEditor = null) {
  if (!editor) return;
  if (editor.contains(document.activeElement) && editor.style.left && editor.style.top) return;
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
  if (drawMetrics) {
    drawMetrics.hidden = true;
    updateTopMetricLabels();
  }
  state.inlineEdit = null;
}

function positionLeaderTextEditor(point) {
  if (!leaderTextEditor) return;
  const screen = worldToScreen(point);
  const rect = canvas.getBoundingClientRect();
  const width = leaderTextEditor.offsetWidth || 300;
  const height = leaderTextEditor.offsetHeight || 54;
  const left = Math.max(12 + width / 2, Math.min(rect.width - width / 2 - 12, screen.x + 44));
  const top = Math.max(82, Math.min(rect.height - height / 2 - 18, screen.y - 8));
  leaderTextEditor.style.left = `${left}px`;
  leaderTextEditor.style.top = `${top}px`;
}

function showLeaderTextEditor(point) {
  if (!leaderTextEditor || !leaderTextInput) return;
  leaderTextEditor.hidden = false;
  leaderTextInput.value = "";
  requestAnimationFrame(() => {
    positionLeaderTextEditor(point);
    leaderTextInput.focus({ preventScroll: true });
  });
}

function hideLeaderTextEditor() {
  if (leaderTextEditor) leaderTextEditor.hidden = true;
  if (leaderTextInput) leaderTextInput.value = "";
}

function commitLeaderText() {
  if (state.tool !== "dimension" || state.dimensionTool !== "leader" || state.drawing?.phase !== "leader-text") {
    hideLeaderTextEditor();
    return;
  }
  const text = (leaderTextInput?.value || "").trim() || "Текст";
  pushEntity(leaderEntity(`leader-${Date.now()}`, state.drawing.start, state.drawing.end, text));
  state.drawing = null;
  hideLeaderTextEditor();
  resetSnapTracking();
  statusChip.textContent = "Выноска создана";
  drawNow();
}

function updateFurnitureSizePanel(entity) {
  const visible = entity?.type === "block" && !state.drawing && !state.moveCommand && !state.offsetCommand;
  if (!furnitureSizePanel) return;
  furnitureSizePanel.hidden = !visible;
  shell.classList.toggle("furniture-panel-open", visible);
  furnitureWidthInput?.closest("label")?.classList.toggle("active-dimension", visible && state.activeFurnitureDimension === "width");
  furnitureDepthInput?.closest("label")?.classList.toggle("active-dimension", visible && state.activeFurnitureDimension === "height");
  if (!visible) return;
  const size = entitySize(entity);
  if (document.activeElement !== furnitureWidthInput) {
    furnitureWidthInput.value = Math.round(size.width);
  }
  if (document.activeElement !== furnitureDepthInput) {
    furnitureDepthInput.value = Math.round(size.height);
  }
  if (document.activeElement !== furnitureRotationInput) {
    furnitureRotationInput.value = Math.round(entity.rotation || 0);
  }
}

function selectedFurnitureEntity() {
  const entity = state.entities.find((item) => item.id === state.selectedId);
  return entity?.type === "block" ? entity : null;
}

function snapFurnitureSize(value) {
  return Math.max(300, Math.round(value / furnitureResizeStepMm) * furnitureResizeStepMm);
}

function applyFurnitureSizeInput(options = {}) {
  const { recordUndo = true } = options;
  const entity = selectedFurnitureEntity();
  if (!entity) return;
  const width = Number(furnitureWidthInput.value.replace(",", "."));
  const height = Number(furnitureDepthInput.value.replace(",", "."));
  const rotation = Number(furnitureRotationInput.value.replace(",", "."));
  const before = entityGeometry(entity);
  if (Number.isFinite(width) && width >= 100) {
    entity.width = width;
  }
  if (Number.isFinite(height) && height >= 100) {
    entity.height = height;
  }
  if (Number.isFinite(rotation)) {
    entity.rotation = normalizeDegrees(rotation);
  }
  const after = entityGeometry(entity);
  const changed = geometryChanged(before, after);
  if (recordUndo && changed) {
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
  }
  if (changed) markProjectDirty("furniture-input");
  statusChip.textContent = `Мебель ${Math.round(entity.width)} × ${Math.round(entity.height)} мм · ${Math.round(entity.rotation || 0)}°`;
  draw();
}

function applyInlineValue(kind, options = {}) {
  if (state.selectedEndpoint) {
    applySelectedEndpointInlineValue(kind, options);
    return;
  }
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

function applySelectedEndpointInlineValue(kind, options = {}) {
  const { recordUndo = true } = options;
  const geometry = selectedEndpointGeometry();
  if (!geometry) return;
  const { entity, fixed, moving } = geometry;
  const currentLength = Math.max(1, Math.hypot(moving.x - fixed.x, moving.y - fixed.y));
  const currentRad = Math.atan2(moving.y - fixed.y, moving.x - fixed.x);
  const typedLength = Number(lengthInput.value.replace(",", "."));
  const typedAngle = Number(angleInput.value.replace(",", "."));
  const nextLength = Number.isFinite(typedLength) && typedLength > 0 ? typedLength : currentLength;
  let nextRad = currentRad;
  if (kind === "angle" && Number.isFinite(typedAngle)) {
    const angleInfo = state.inlineEdit?.angleInfo || activeAngleInfo(fixed, moving);
    if (angleInfo?.hasReference) {
      const sign = angleInfo.deltaRad < 0 ? -1 : 1;
      nextRad = angleInfo.referenceRad + sign * (typedAngle * Math.PI) / 180;
    } else {
      nextRad = (typedAngle * Math.PI) / 180;
    }
  }
  const before = entityGeometry(entity);
  setSelectedEndpointPosition({
    x: fixed.x + Math.cos(nextRad) * nextLength,
    y: fixed.y + Math.sin(nextRad) * nextLength,
  });
  const after = entityGeometry(entity);
  const changed = geometryChanged(before, after);
  if (recordUndo && changed) {
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
  }
  if (changed) markProjectDirty("endpoint-input");
  updateSelectedEndpointEditors();
  draw();
}

function drawBadge(text, x, y, c, secondary = false, fixedScreenSize = false) {
  text = decodeMojibakeText(String(text));
  if (/\u041f\u0430\u0440\u0430\u043b\u043b\u0435\u043b\u044c|\u0422\u043e\u0447\u043a\u0430|\u041a\u043e\u043d\u0435\u0446|\u0421\u0435\u0440\u0435\u0434\u0438\u043d\u0430|\u041f\u0430\u0440\u0430|\u0422\u043e\u0447|\u0421\u0435\u0440\u0435\u0434/.test(text)) return;
  const px = fixedScreenSize ? screenUiPx : annotationPx;
  ctx.save();
  ctx.font = fixedScreenSize ? screenUiFont(700, 12) : annotationFont(700, 12);
  const padX = px(8);
  const width = ctx.measureText(text).width + padX * 2;
  const height = px(24);
  const rx = x - width / 2;
  const ry = y - height / 2;
  ctx.fillStyle = secondary ? c.surface : c.accent;
  ctx.strokeStyle = secondary ? c.accent : c.accent;
  ctx.lineWidth = px(1);
  roundedRect(rx, ry, width, height, px(7), true);
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
  } else {
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
  return (Boolean(trackingBasePoint()) || canUsePrePointTracking()) && state.snaps.has("polar") && state.snaps.has("end") && canCaptureSnapTrackingNow();
}

function canCreateSnapTrackingPoint() {
  if (state.tool === "dimension" && state.drawing) return false;
  return canUseSnapTracking();
}

function canSnapToTrackingGuides() {
  return Boolean(trackingBasePoint()) && state.snaps.has("polar") && !state.pinch;
}

function canUsePrePointTracking() {
  if (state.drawing || state.moveCommand || state.offsetCommand || state.pinch) return false;
  if (state.pointer && state.pointer.mode !== "pan") return false;
  return trackingDrawingTools.has(state.tool);
}

function canCaptureSnapTrackingNow() {
  if (state.pinch) return false;
  if (!state.pointer) return true;
  return state.pointer.mode === "pan" || state.pointer.mode === "move-command" || state.pointer.mode === "endpoint-place";
}

function canSnapToPrePointTrackingGuides() {
  return canUsePrePointTracking() && state.snaps.has("polar") && state.snapTracking.points.length > 0;
}

function trackingBasePoint() {
  if (state.drawing?.phase === "offset") return null;
  if (state.drawing?.start) return state.drawing.start;
  if (state.moveCommand?.base) return state.moveCommand.base;
  return selectedEndpointGeometry()?.fixed || null;
}

function updateSnapTrackingHover() {
  if (!canCreateSnapTrackingPoint()) {
    clearSnapTrackingHover();
    state.snapTracking.active = null;
    return;
  }
  const raw = screenToWorld(centerScreen());
  const candidate = nearestTrackingAnchorCandidate(raw);
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
  draw();
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
  if (!point || state.snapTracking.hoverKey !== key || !canCreateSnapTrackingPoint()) return;
  const current = nearestTrackingAnchorCandidate(screenToWorld(centerScreen()));
  const currentKey = current ? trackingPointKey(current) : null;
  const stillNearOriginal = distanceWorld(screenToWorld(centerScreen()), point) <= trackingActivationThreshold();
  if ((!current || currentKey !== key) && !stillNearOriginal) return;
  addSnapTrackingPoint(currentKey === key ? current : point);
  clearSnapTrackingHover();
  statusChip.textContent = "Точка отслеживания: ведите курсор по направляющей";
  draw();
}


function nearestTrackingAnchorCandidate(point) {
  return nearestObjectSnap(point);
}

function trackingActivationThreshold() {
  return objectSnapThreshold();
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

function snapTrackingGuides(base = null) {
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
  if (base) {
    const basePoint = { ...base, key: "__base__", label: "Base" };
    for (const angle of trackingAngles) {
      guides.push({
        point: basePoint,
        angle,
        ux: Math.cos(angle),
        uy: Math.sin(angle),
        isBase: true,
      });
    }
  }
  return guides;
}

function nearestSnapTrackingPoint(point, threshold, base = null) {
  const guides = snapTrackingGuides(base);
  if (guides.length === 0) return null;
  let bestIntersection = null;
  const testIntersection = (a, b) => {
    const intersection = trackingGuideIntersection(a, b);
    if (!intersection) return;
    const distance = distanceWorld(point, intersection);
    if (distance > threshold) return;
    if (!bestIntersection || distance < bestIntersection.distance) {
      bestIntersection = { ...intersection, distance, guides: [a, b] };
    }
  };

  for (let i = 0; i < guides.length; i += 1) {
    for (let j = i + 1; j < guides.length; j += 1) {
      const a = guides[i];
      const b = guides[j];
      if (a.point.key === b.point.key) continue;
      testIntersection(a, b);
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
  const base = trackingBasePoint();
  if ((!canUseSnapTracking() && !canSnapToTrackingGuides()) || (!base && state.snapTracking.points.length === 0)) {
    drawSnapTrackingHover(c);
    return;
  }
  if (base) resolveLineLikeSnap(screenToWorld(centerScreen()), base);
  else if (canSnapToPrePointTrackingGuides()) resolvePrePointTrackingSnap(screenToWorld(centerScreen()));
  const rect = canvas.getBoundingClientRect();
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;

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
  if (base) drawTrackingAnchor({ ...base, key: "__base__" }, c);
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
  drawSnapTrackingHover(c);
}

function drawSnapTrackingHover(c) {
  if (!state.snapTracking.hoverPoint || state.snapTracking.hoverTimer == null) return;
  const p = worldToScreen(state.snapTracking.hoverPoint);
  ctx.save();
  ctx.globalAlpha = 0.72;
  drawTrackingSnapMarker(p, c);
  ctx.restore();
}
function drawPolarSnapGuide(c) {
  const guide = state.polarSnapGuide;
  if (!guide || !state.snaps.has("polar")) return;
  const rect = canvas.getBoundingClientRect();
  const start = worldToScreen(guide.point);
  const length = Math.max(rect.width, rect.height) * 1.45;
  const dx = Math.cos(guide.angle) * length;
  const dy = Math.sin(guide.angle) * length;
  const labelX = start.x + Math.cos(guide.angle) * Math.min(120, length * 0.28);
  const labelY = start.y + Math.sin(guide.angle) * Math.min(120, length * 0.28);
  const degrees = ((guide.degrees % 360) + 360) % 360;
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.82;
  ctx.setLineDash([12, 7]);
  linePath(start.x - dx, start.y - dy, start.x + dx, start.y + dy);
  ctx.setLineDash([]);
  drawBadge(`${degrees}° ось`, labelX, labelY - 18, c, true);
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
  state.polarSnapGuide = null;
}

function drawCursorSnap(c) {
  if ((state.tool === "select" && !state.moveCommand && !state.selectedEndpoint) || state.tool === "furniture") return;
  if (state.tool === "dimension" && state.drawing?.phase === "offset") return;
  const resolved = cursorSnapResolved();
  if (!resolved.snap) return;
  const snap = resolved.snap;
  const p = worldToScreen(snap);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  if (snap?.type === "tracking") {
    drawTrackingSnapMarker(p, c);
  } else if (isMidSnap(snap)) {
    drawMidSnapMarker(p, c);
  } else if (snap?.type === "nearest") {
    drawNearestSnapMarker(p, c);
  } else {
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
  }
  ctx.restore();
}

function isMidSnap(snap) {
  return snap?.snapRole === "mid" || String(snap?.pointKey || "").startsWith("mid") || snap?.label === "Середина";
}

function drawMidSnapMarker(point, c) {
  ctx.save();
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - 8);
  ctx.lineTo(point.x + 8, point.y + 6);
  ctx.lineTo(point.x - 8, point.y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNearestSnapMarker(point, c) {
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(point.x - 7, point.y - 7);
  ctx.lineTo(point.x + 7, point.y + 7);
  ctx.moveTo(point.x + 7, point.y - 7);
  ctx.lineTo(point.x - 7, point.y + 7);
  ctx.stroke();
  ctx.restore();
}

function drawTrackingSnapMarker(point, c) {
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.82;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(point.x - 11, point.y);
  ctx.lineTo(point.x + 11, point.y);
  ctx.moveTo(point.x, point.y - 11);
  ctx.lineTo(point.x, point.y + 11);
  ctx.stroke();
  ctx.restore();
}

function cursorObjectSnapMarker() {
  const raw = screenToWorld(centerScreen());
  return nearestObjectSnap(raw, { includeNearestSegment: trackingDrawingTools.has(state.tool) });
}

function objectSnapThreshold() {
  return (state.tool === "dimension" ? 34 : 24) / state.view.scale;
}

function midpointSnapThreshold() {
  return 22 / state.view.scale;
}

function nearestSegmentSnapThreshold() {
  return 14 / state.view.scale;
}

function nearestObjectSnap(point, { includeNearestSegment = false } = {}) {
  const objectThreshold = objectSnapThreshold();
  const midpointThreshold = midpointSnapThreshold();
  const nearestThreshold = nearestSegmentSnapThreshold();
  const useObjectSnap = state.tool === "dimension" || state.snaps.has("end");
  if (useObjectSnap) {
    const corner = nearestSnapCandidate(point, snapCandidates({ includeCorners: true }), objectThreshold);
    if (corner) return corner;
  }
  if (state.snaps.has("mid")) {
    const mid = nearestSnapCandidate(point, snapCandidates({ includeMidpoints: true, includeCenters: true }), midpointThreshold);
    if (mid) return mid;
  }
  if (useObjectSnap && includeNearestSegment) {
    return nearestPointOnDrawableSegment(point, nearestThreshold);
  }
  return null;
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

function rectangleCorners(entity) {
  return [{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y1 }, { x: entity.x2, y: entity.y2 }, { x: entity.x1, y: entity.y2 }];
}

function activeAngleInfo(start, end) {
  const currentRad = angleBetweenPoints(start, end);
  const reference = nearestAngleReference(start, currentRad);
  if (!reference) {
    const referenceRad = nearestCardinalReferenceRad(currentRad);
    const deltaRad = signedAngleDelta(referenceRad, currentRad);
    return {
      referenceRad,
      deltaRad,
      degrees: displayAngleDegrees(deltaRad),
      hasReference: false,
    };
  }
  const deltaRad = signedAngleDelta(reference.angleRad, currentRad);
  return {
    referenceRad: reference.angleRad,
    deltaRad,
    degrees: displayAngleDegrees(deltaRad),
    hasReference: true,
  };
}

function displayAngleDegrees(deltaRad) {
  const raw = Math.abs(radToDeg(deltaRad));
  const rounded = Math.round(raw);
  const five = Math.round(raw / 5) * 5;
  return Math.abs(raw - five) <= 1.25 ? five : rounded;
}

function nearestCardinalReferenceRad(angleRad) {
  const step = Math.PI / 2;
  return Math.round(angleRad / step) * step;
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
    } else if (entity.type === "rectangle") {
      const corners = rectangleCorners(entity);
      for (let i = 0; i < corners.length; i += 1) {
        segments.push({ p1: corners[i], p2: corners[(i + 1) % corners.length] });
      }
    }
  }
  return segments.filter((segment) => distanceWorld(segment.p1, segment.p2) > 1);
}

function segmentAngle(a, b) {
  return angleBetweenPoints(a, b);
}

function signedAngleDelta(fromRad, toRad) {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
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
  return Math.min(0.7, Math.max(0.005, scale));
}

function adaptiveGridStep() {
  const scale = state.view.scale;
  if (scale >= 0.45) return 10;
  if (scale >= 0.3) return 20;
  if (scale >= 0.18) return 25;
  if (scale >= 0.11) return 50;
  if (scale >= 0.06) return 100;
  if (scale >= 0.02) return 250;
  if (scale >= 0.01) return 500;
  return 1000;
}

function snapValueToGrid(value) {
  const step = adaptiveGridStep();
  return Math.round(value / step) * step;
}

function zoomAtScreen(screen, nextScale) {
  const before = screenToWorld(screen);
  state.view.scale = clampScale(nextScale);
  const after = worldToScreen(before);
  state.view.panX += screen.x - after.x;
  state.view.panY += screen.y - after.y;
  markProjectDirty("view");
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
  markProjectDirty("pinch");
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
  const trackingThreshold = objectSnapThreshold();
  let result = { ...point };
  let snap = null;
  state.snapTracking.active = null;
  state.polarSnapGuide = null;

  snap = nearestObjectSnap(point);
  if (snap) {
    result = { x: snap.x, y: snap.y };
  } else if (canUseSnapTracking()) {
    snap = nearestSnapTrackingPoint(point, trackingThreshold);
    if (snap) {
      result = { x: snap.x, y: snap.y };
      state.snapTracking.active = snap;
    }
  } else if (state.snaps.has("grid")) {
    result.x = snapValueToGrid(result.x);
    result.y = snapValueToGrid(result.y);
  }
  if (!snap && state.snaps.has("polar")) {
    const polarStart = state.drawing?.start || state.moveCommand?.base;
    if (polarStart && state.drawing?.phase !== "offset") {
      const polar = snapPolar(result, polarStart);
      result = polar.point;
      if (polar.snapped) {
        state.polarSnapGuide = {
          point: polarStart,
          angle: polar.angle,
          degrees: polar.degrees,
        };
      }
    }
  }
  return { point: result, snap };
}

function resolveDimensionPointSnap(point) {
  const objectThreshold = 34 / state.view.scale;
  const midpointThreshold = 22 / state.view.scale;
  let result = { ...point };
  let snap = nearestSnapCandidate(point, snapCandidates({ includeCorners: true }), objectThreshold);
  state.snapTracking.active = null;
  state.polarSnapGuide = null;

  if (!snap && state.snaps.has("mid")) {
    snap = nearestSnapCandidate(point, snapCandidates({ includeMidpoints: true, includeCenters: true }), midpointThreshold);
  }
  if (snap) {
    result = { x: snap.x, y: snap.y };
  } else if (state.snaps.has("grid")) {
    result.x = snapValueToGrid(result.x);
    result.y = snapValueToGrid(result.y);
  }
  return { point: result, snap };
}

function resolveLineLikeSnap(point, start) {
  const directionThreshold = objectSnapThreshold();
  let result = { ...point };
  let snap = null;
  state.snapTracking.active = null;
  state.polarSnapGuide = null;

  snap = nearestObjectSnap(point, { includeNearestSegment: trackingDrawingTools.has(state.tool) });
  if (snap) {
    result = { x: snap.x, y: snap.y };
  } else {
    const tracking = canSnapToTrackingGuides() ? nearestSnapTrackingPoint(point, directionThreshold, start) : null;
    if (tracking) {
      result = { x: tracking.x, y: tracking.y };
      snap = tracking;
      state.snapTracking.active = tracking;
      const baseGuide = tracking.guides?.find((guide) => guide.isBase);
      if (baseGuide) {
        state.polarSnapGuide = {
          point: start,
          angle: baseGuide.angle,
          degrees: Math.round((baseGuide.angle * 180) / Math.PI),
        };
      }
    } else {
      const directional = canSnapToObjectDirections() ? snapLineDirection(point, start, directionThreshold) : null;
      if (directional) {
        result = { x: directional.x, y: directional.y };
        snap = directional;
        state.polarSnapGuide = {
          point: start,
          angle: directional.angle,
          degrees: directional.degrees,
        };
      } else if (canSnapToTrackingGuides()) {
        const guideTracking = nearestSnapTrackingPoint(point, directionThreshold);
        if (guideTracking) {
          result = { x: guideTracking.x, y: guideTracking.y };
          snap = guideTracking;
          state.snapTracking.active = guideTracking;
        } else {
          const nearest = nearestObjectSnap(point, { includeNearestSegment: true });
          if (nearest) {
            result = { x: nearest.x, y: nearest.y };
            snap = nearest;
          } else if (state.snaps.has("grid")) {
            result.x = snapValueToGrid(result.x);
            result.y = snapValueToGrid(result.y);
          }
        }
      } else {
        const nearest = nearestObjectSnap(point, { includeNearestSegment: true });
        if (nearest) {
          result = { x: nearest.x, y: nearest.y };
          snap = nearest;
        } else if (state.snaps.has("grid")) {
          result.x = snapValueToGrid(result.x);
          result.y = snapValueToGrid(result.y);
        }
      }
    }
  }

  if (!snap && state.snaps.has("polar")) {
    const polar = snapPolar(result, start);
    result = polar.point;
    if (polar.snapped) {
      state.polarSnapGuide = {
        point: start,
        angle: polar.angle,
        degrees: polar.degrees,
      };
    }
  }
  return { point: result, snap };
}

function resolvePrePointTrackingSnap(point) {
  const trackingThreshold = objectSnapThreshold();
  state.snapTracking.active = null;
  state.polarSnapGuide = null;
  const tracking = nearestSnapTrackingPoint(point, trackingThreshold);
  if (tracking) {
    state.snapTracking.active = tracking;
    return { point: { x: tracking.x, y: tracking.y }, snap: tracking };
  }
  return resolveSnapWorld(point);
}

function canSnapToObjectDirections() {
  return false;
}

function nearestEndpoint(point, threshold) {
  return nearestSnapCandidate(point, snapCandidates({ includeCorners: true }), threshold);
}

function nearestMidpoint(point, threshold) {
  return nearestSnapCandidate(point, snapCandidates({ includeMidpoints: true, includeCenters: true }), threshold);
}

function snapLineDirection(point, start, threshold) {
  if (!state.snaps.has("polar")) return null;
  const currentAngle = angleBetweenPoints(start, point);
  const currentLength = Math.max(1, distanceWorld(start, point));
  let best = null;
  const addCandidate = (angle, label, segment) => {
    const projected = projectPointToInfiniteLine(point, start, angle);
    if (projected.distance > threshold) return;
    const angleDelta = Math.abs(signedAngleDelta(angle, currentAngle));
    const score = projected.distance + angleDelta * currentLength * 0.08;
    if (!best || score < best.score) {
      best = {
        ...projected,
        score,
        angle,
        degrees: Math.round(normalizeAnglePositive(angle) * 180 / Math.PI),
        label,
        type: "direction",
        segment,
      };
    }
  };
  for (const segment of drawableSnapSegments()) {
    const baseAngle = segmentAngle(segment.p1, segment.p2);
    addCandidate(baseAngle, "Параллельно", segment);
    addCandidate(baseAngle + Math.PI / 2, "Перпендикуляр", segment);
  }
  return best;
}

function projectPointToInfiniteLine(point, origin, angle) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const t = (point.x - origin.x) * ux + (point.y - origin.y) * uy;
  const x = origin.x + ux * t;
  const y = origin.y + uy * t;
  return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
}

function nearestPointOnDrawableSegment(point, threshold) {
  let best = null;
  for (const segment of drawableSnapSegments()) {
    const hit = projectPointToSegmentWorld(point, segment.p1, segment.p2);
    if (hit.distance > threshold) continue;
    const score = hit.distance;
    if (!best || score < best.score) {
      best = { x: hit.x, y: hit.y, score, label: "Ближайшая", type: "nearest", segment };
    }
  }
  return best;
}

function nearestSnapCandidate(point, candidates, threshold) {
  let best = null;
  let bestDistance = threshold;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
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
    for (const point of objectPointRefs(entity)) {
      const role = point.snapRole || point.pointKey;
      const allowed =
        (includeCorners && ["start", "end", "corner", "quadrant", "arc-point"].includes(role)) ||
        (includeMidpoints && role === "mid") ||
        (includeCenters && role === "center");
      if (allowed) {
        candidates.push({ ...point, label: point.label || snapPointLabel(role) });
      }
    }
  }
  return candidates.map((candidate) => attachSnapReference(candidate));
}

function snapPointLabel(role) {
  if (role === "center") return "Центр";
  if (role === "mid") return "Середина";
  if (role === "corner") return "Угол";
  if (role === "quadrant") return "Квадрант";
  return "Конец";
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
      ...blockCorners(entity).map((corner, index) => ({ ...corner, pointKey: `corner-${index}`, snapRole: "corner" })),
      { x: entity.x, y: entity.y, pointKey: "center", snapRole: "center" },
    ];
  }
  if (entity.type === "rectangle") {
    const corners = rectangleCorners(entity);
    return [
      ...corners.map((corner, index) => ({ ...corner, pointKey: `corner-${index}`, snapRole: "corner" })),
      ...corners.map((corner, index) => ({ ...midpoint(corner, corners[(index + 1) % corners.length]), pointKey: `mid-${index}`, snapRole: "mid" })),
      { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2, pointKey: "center", snapRole: "center" },
    ];
  }
  if (entity.type === "circle") {
    const r = Math.abs(entity.radius || 0);
    return [
      { x: entity.cx, y: entity.cy, pointKey: "center", snapRole: "center" },
      { x: entity.cx + r, y: entity.cy, pointKey: "quadrant-0", snapRole: "quadrant" },
      { x: entity.cx, y: entity.cy + r, pointKey: "quadrant-1", snapRole: "quadrant" },
      { x: entity.cx - r, y: entity.cy, pointKey: "quadrant-2", snapRole: "quadrant" },
      { x: entity.cx, y: entity.cy - r, pointKey: "quadrant-3", snapRole: "quadrant" },
    ];
  }
  if (entity.type === "arc") {
    const refs = [
      entity.start ? { ...entity.start, pointKey: "start", snapRole: "arc-point" } : null,
      entity.through ? { ...entity.through, pointKey: "through", snapRole: "mid" } : null,
      entity.end ? { ...entity.end, pointKey: "end", snapRole: "arc-point" } : null,
    ].filter(Boolean);
    const arc = arcGeometry(entity.start, entity.through, entity.end);
    if (arc) refs.push({ x: arc.center.x, y: arc.center.y, pointKey: "center", snapRole: "center" });
    return refs;
  }
  if (!Number.isFinite(entity.x1) || !Number.isFinite(entity.y1) || !Number.isFinite(entity.x2) || !Number.isFinite(entity.y2)) {
    return [];
  }
  return [
    { x: entity.x1, y: entity.y1, pointKey: "start", snapRole: "start" },
    { x: entity.x2, y: entity.y2, pointKey: "end", snapRole: "end" },
    { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2, pointKey: "mid", snapRole: "mid" },
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
  if (length < 1) return { point, snapped: false };
  const step = (5 * Math.PI) / 180;
  const threshold = (2.5 * Math.PI) / 180;
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / step) * step;
  const delta = Math.abs(Math.atan2(Math.sin(angle - snappedAngle), Math.cos(angle - snappedAngle)));
  if (delta > threshold) return { point, snapped: false };
  const degrees = Math.round(normalizeAnglePositive(snappedAngle) * 180 / Math.PI);
  return {
    snapped: true,
    angle: snappedAngle,
    degrees,
    point: {
    x: start.x + Math.cos(snappedAngle) * length,
    y: start.y + Math.sin(snappedAngle) * length,
    },
  };
}

function isGroupedDrawTool(tool) {
  return groupedDrawTools.has(tool);
}

function setToolButtonVisual(button, visual) {
  const icon = button?.querySelector("span");
  const label = button?.querySelector("small");
  if (icon && visual?.icon) icon.textContent = visual.icon;
  if (label && visual?.label) label.textContent = visual.label;
}

function syncToolButtonVisuals() {
  const selectButton = tools.find((button) => button.dataset.tool === "select");
  const lineButton = tools.find((button) => button.dataset.tool === "line");
  const dimensionButton = tools.find((button) => button.dataset.tool === "dimension");
  const selectionButton = tools.find((button) => button.dataset.tool === "selection");
  setToolButtonVisual(selectButton, selectModeButtonVisuals[state.selectTool] || selectModeButtonVisuals.select);
  setToolButtonVisual(lineButton, isGroupedDrawTool(state.tool) ? drawToolButtonVisuals[state.tool] : drawToolButtonVisuals.line);
  setToolButtonVisual(dimensionButton, dimensionToolButtonVisuals[state.dimensionTool] || dimensionToolButtonVisuals.aligned);
  setToolButtonVisual(selectionButton, selectionToolButtonVisuals.select);
}

function drawableSnapSegments() {
  const segments = [];
  for (const entity of state.entities) {
    if (!isLayerVisible(entity.layer) || entity.layer === "dimensions" || entity.type === "block") continue;
    if (entity.type === "line" || entity.type === "wall") {
      segments.push({ p1: { x: entity.x1, y: entity.y1 }, p2: { x: entity.x2, y: entity.y2 }, entity });
    } else if (entity.type === "rectangle") {
      const corners = rectangleCorners(entity);
      for (let i = 0; i < corners.length; i += 1) {
        segments.push({ p1: corners[i], p2: corners[(i + 1) % corners.length], entity });
      }
    }
  }
  return segments;
}

function syncToolButtons() {
  syncToolButtonVisuals();
  const editModeActive = state.tool === "select" && (Boolean(editableSelectionEntity()) || !selectToolMenu.hidden);
  tools.forEach((button) => {
    const buttonTool = button.dataset.tool;
    const active =
      buttonTool === "selection"
        ? editModeActive
        : buttonTool === "select"
          ? state.tool === "select"
          : buttonTool === state.tool || (buttonTool === "line" && isGroupedDrawTool(state.tool));
    button.classList.toggle("active", active);
  });
}

function setTool(tool) {
  state.tool = tool;
  hideLeaderTextEditor();
  if (tool !== "select") {
    state.selectTool = "select";
  }
  state.drawing = null;
  state.moveCommand = null;
  state.offsetCommand = null;
  state.selectionDrag = null;
  syncCommandState();
  if (["line", "polyline", "circle", "arc", "rectangle", "wall", "dimension"].includes(tool)) {
    state.selectedId = null;
    state.selectedIds = [];
    state.selectedEndpoint = null;
    state.endpointEditBefore = null;
    hideInlineEditors();
  } else if (tool !== "line" && tool !== "polyline") {
    state.selectedEndpoint = null;
    state.endpointEditBefore = null;
  }
  if (tool !== "dimension") {
    resetSnapTracking();
  }
  if (tool !== "select" && tool !== "furniture") {
    state.furnitureEditId = null;
  }
  shell.dataset.tool = tool;
  syncToolButtons();
  const copy = {
    select: "Выбор: тапните объект. Мебель двигается только когда она выбрана",
    line: "Линия: подведите курсор и тапните холст",
    polyline: "Полилиния: каждый тап добавляет следующий сегмент",
    circle: "Круг: укажите центр, затем радиус",
    arc: "Дуга: старт, точка на дуге, конец",
    rectangle: "Прямоугольник: укажите два противоположных угла",
    wall: "Стена: подведите курсор к началу и тапните холст",
    dimension: "Размер: подведите курсор к отрезку",
    furniture: "Объект: тапните объект на плане или перетащите блок из библиотеки",
  };
  statusChip.textContent = copy[tool];
  if (tool === "select") {
    statusChip.textContent = "Выбор: тапните объект. Мебель двигается только когда она выбрана";
  }
  if (tool === "select") {
    statusChip.textContent = selectionStatusText();
  }
  if (tool === "dimension") {
    state.snaps.add("end");
    syncSnapButtons();
  }
  if (tool === "dimension") {
    statusChip.textContent = dimensionToolStatusText();
  }
  draw();
}

function syncSnapButtons() {
  snaps.forEach((button) => button.classList.toggle("active", state.snaps.has(button.dataset.snap)));
}

function syncDrawToolMenu() {
  drawToolButtons.forEach((button) => button.classList.toggle("active", button.dataset.drawTool === state.drawTool));
}

function syncDimensionToolMenu() {
  dimensionToolButtons.forEach((button) => button.classList.toggle("active", button.dataset.dimensionTool === state.dimensionTool));
}

function syncSelectToolMenu() {
  const selected = selectedEntities();
  const furnitureOnly = selected.length === 1 && selected[0]?.type === "block";
  selectToolMenu?.querySelectorAll("[data-select-tool]").forEach((button) => {
    button.hidden = true;
  });
  const moveButton = selectToolMenu?.querySelector('button[data-action="move"]');
  if (moveButton) {
    const icon = moveButton.querySelector("span");
    const label = moveButton.querySelector("small");
    if (icon) icon.textContent = "↕";
    if (label) label.textContent = "Переместить";
    moveButton.title = "Точное перемещение по двум точкам";
  }
  const copyButton = selectToolMenu?.querySelector('button[data-action="copy"]');
  if (copyButton) {
    const icon = copyButton.querySelector("span");
    const label = copyButton.querySelector("small");
    if (icon) icon.textContent = "⧉";
    if (label) label.textContent = "Копия";
    copyButton.title = "Точная копия по двум точкам";
  }
  selectToolMenu?.querySelectorAll("button[data-action]").forEach((button) => {
    button.disabled = !canApplySelectionAction(button.dataset.action);
  });
}

function showDrawToolMenu() {
  if (!drawToolMenu) return;
  syncDrawToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  hideDimensionToolMenu();
  drawToolMenu.hidden = false;
}

function hideDrawToolMenu() {
  if (drawToolMenu) drawToolMenu.hidden = true;
}

function showDimensionToolMenu() {
  if (!dimensionToolMenu) return;
  syncDimensionToolMenu();
  hideDrawToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  dimensionToolMenu.hidden = false;
}

function hideDimensionToolMenu() {
  if (dimensionToolMenu) dimensionToolMenu.hidden = true;
}

function showSelectToolMenu() {
  if (!selectToolMenu) return;
  syncSelectToolMenu();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideSelectModeMenu();
  selectToolMenu.hidden = false;
  syncToolButtons();
}

function showSelectToolMenuAfterLayout() {
  showSelectToolMenu();
  requestAnimationFrame(() => {
    if (state.tool === "select") showSelectToolMenu();
  });
}

function hideSelectToolMenu() {
  if (selectToolMenu) selectToolMenu.hidden = true;
  syncToolButtons();
}

function showSelectModeMenu() {
  if (!selectModeMenu) return;
  syncSelectModeMenu();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideSelectToolMenu();
  selectModeMenu.hidden = false;
}

function showSelectModeMenuAfterLayout() {
  showSelectModeMenu();
  requestAnimationFrame(() => {
    if (state.tool === "select") showSelectModeMenu();
  });
}

function hideSelectModeMenu() {
  if (selectModeMenu) selectModeMenu.hidden = true;
}

function syncSelectModeMenu() {
  selectModeMenu?.querySelectorAll("[data-select-mode]").forEach((button) => {
    const mode = button.dataset.selectMode;
    if (mode === "filter") {
      const label = button.querySelector("small");
      if (label) label.textContent = state.selectionFilter === "all" ? "Фильтр" : selectionFilterLabel();
      button.classList.toggle("active", state.selectionFilter !== "all");
      return;
    }
    button.classList.toggle("active", mode === "select" ? state.selectTool === "select" : state.selectTool === mode);
  });
}

function prepareSelectMenuStructure() {
  const selectionRailButton = tools.find((button) => button.dataset.tool === "selection");
  if (selectionRailButton) selectionRailButton.hidden = false;
  if (!selectToolMenu) return;
  selectToolMenu.querySelectorAll("[data-select-tool]").forEach((button) => {
    button.hidden = true;
  });
}

function activateDrawToolMenu() {
  state.drawTool = "line";
  setTool("line");
  showDrawToolMenu();
}

function activateDimensionToolMenu() {
  setTool("dimension");
  showDimensionToolMenu();
  statusChip.textContent = dimensionToolStatusText();
}

function activatePlainSelect() {
  state.selectTool = "select";
  state.selectionDrag = null;
  state.drawing = null;
  state.moveCommand = null;
  state.offsetCommand = null;
  state.pointer = null;
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  state.dimensionSnapHint = null;
  state.dimensionPickCycle = null;
  resetSnapTracking();
  hideInlineEditors();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  hideSheet(furnitureSheet);
  setTool("select");
  statusChip.textContent = "Выбор: команда отменена, можно выбирать и редактировать объект";
}

function activateSelectionTool() {
  if (!selectionToolCycle.includes(state.selectTool)) {
    state.selectTool = selectionToolCycle[0];
  }
  state.drawing = null;
  state.moveCommand = null;
  state.offsetCommand = null;
  state.selectionDrag = null;
  state.pointer = null;
  state.selectedEndpoint = null;
  state.dimensionSnapHint = null;
  resetSnapTracking();
  hideInlineEditors();
  hideSheet(furnitureSheet);
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  setTool("select");
  syncSelectionActions();
  statusChip.textContent = selectionStatusText();
}

function toggleMainSelectTool() {
  const nextSelectTool = state.tool === "select" && state.selectTool === "select" ? "window" : "select";
  state.selectTool = nextSelectTool;
  state.selectionDrag = null;
  state.drawing = null;
  state.moveCommand = null;
  state.offsetCommand = null;
  state.pointer = null;
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  state.dimensionSnapHint = null;
  state.dimensionPickCycle = null;
  resetSnapTracking();
  hideInlineEditors();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideSheet(furnitureSheet);
  setTool("select");
  showSelectModeMenuAfterLayout();
  syncSelectModeMenu();
  statusChip.textContent = selectionStatusText();
}

function selectDrawTool(tool) {
  state.drawTool = tool;
  syncDrawToolMenu();
  hideDrawToolMenu();
  if (isGroupedDrawTool(tool)) {
    setTool(tool);
    return;
  }
  setTool("select");
}

function selectDimensionTool(tool) {
  state.dimensionTool = tool;
  state.drawing = null;
  state.dimensionSnapHint = null;
  hideLeaderTextEditor();
  resetSnapTracking();
  syncDimensionToolMenu();
  hideDimensionToolMenu();
  setTool("dimension");
  statusChip.textContent = dimensionToolStatusText();
}

function dimensionToolStatusText() {
  const text = {
    aligned: "Параллельный размер: 1 начало, 2 конец, 3 положение размерной линии",
    linear: "Линейный размер: выберите две точки, размер будет по горизонтали/вертикали",
    angular: "Угол: выберите две линии или две стороны угла",
    baseline: "База: несколько размеров от общей базовой точки",
  };
  text.leader = "Выноска: 1 кончик стрелки, 2 место текста, затем введите текст";
  return text[state.dimensionTool] || text.aligned;
}

function selectSelectionTool(tool) {
  if (tool === "select") {
    activatePlainSelect();
    return;
  }
  if (tool === "cycle") {
    const currentIndex = selectionToolCycle.indexOf(state.selectTool);
    state.selectTool = currentIndex >= 0 ? selectionToolCycle[(currentIndex + 1) % selectionToolCycle.length] : selectionToolCycle[0];
  } else if (tool === "filter") {
    state.selectionFilter = nextSelectionFilter();
  } else {
    state.selectTool = tool;
  }
  syncSelectToolMenu();
  setTool("select");
  showSelectModeMenuAfterLayout();
  syncToolButtons();
  syncSelectionActions();
  statusChip.textContent = selectionStatusText();
}

function nextSelectionFilter() {
  const filters = ["all", "walls", "lines", "furniture", "dimensions"];
  const index = filters.indexOf(state.selectionFilter);
  return filters[(index + 1) % filters.length];
}

function selectionStatusText() {
  const labels = { select: "Выбор", window: "Выделение", lasso: "Лассо", multi: "Мульти", filter: "Фильтр" };
  const filter = selectionFilterLabel();
  const hints = {
    select: `тап по объекту. Фильтр: ${filter}`,
    window: `тяните рамку: вправо - внутри, влево - пересечение. Фильтр: ${filter}`,
    lasso: `обведите область пальцем. Фильтр: ${filter}`,
    multi: `тап добавляет или снимает объект. Фильтр: ${filter}`,
    filter: `сейчас выбираются: ${filter}`,
  };
  return `${labels[state.selectTool] || "Выбор"}: ${hints[state.selectTool] || hints.select}`;
}

function selectionFilterLabel() {
  return {
    all: "все",
    walls: "стены",
    lines: "линии",
    furniture: "мебель",
    dimensions: "размеры",
  }[state.selectionFilter] || "все";
}

function drawToolLabel(tool) {
  return {
    line: "Линия",
    polyline: "Полилиния",
    circle: "Круг",
    arc: "Дуга",
    rectangle: "Прямоугольник",
  }[tool] || "Инструмент";
}

function pushEntity(entity) {
  state.entities.push(entity);
  state.undo.push({ type: "add", entity });
  state.redo.length = 0;
  state.selectedId = entity.id;
  state.selectedIds = [entity.id];
  state.furnitureEditId = null;
  markProjectDirty("add");
}

function duplicateFurnitureEntity(entity) {
  if (!entity || entity.type !== "block") return;
  const size = entitySize(entity);
  const offset = Math.max(420, Math.min(900, Math.max(size.width, size.height) * 0.18));
  const copy = block(`${entity.kind}-${Date.now()}`, entity.kind, entity.x + offset, entity.y + offset, entity.rotation || 0, size);
  copy.scale = entity.scale || 1;
  pushEntity(copy);
  state.furnitureEditId = state.tool === "furniture" ? copy.id : null;
  statusChip.textContent = "Мебель дублирована";
}

function createEntityFromDrawing() {
  const { start } = state.drawing;
  const end = dimensionAdjustedEnd(start, state.drawing.end);
  const id = `${state.tool}-${Date.now()}`;
  if (state.tool === "circle") return circleEntity(id, start.x, start.y, distanceWorld(start, end));
  if (state.tool === "rectangle") return rectangleEntity(id, start.x, start.y, end.x, end.y);
  if (state.tool === "arc") return arcEntity(id, state.drawing.start, arcThroughFromMidBulge(state.drawing.start, state.drawing.arcEnd, end), state.drawing.arcEnd);
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

function angularDimensionEntity(id, vertex, arm1, arm2) {
  return { id, type: "line", layer: "dimensions", dimensionKind: "angular", vertex, arm1, arm2 };
}

function leaderEntity(id, start, end, text) {
  return {
    id,
    type: "line",
    layer: "dimensions",
    dimensionKind: "leader",
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    text: text || "Текст",
  };
}

function dimensionAdjustedEnd(start, end) {
  if (state.tool !== "dimension" || state.dimensionTool !== "linear") return end;
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };
}

function continueDimensionAfterCreate(metrics) {
  const previous = state.drawing;
  if (state.dimensionTool === "baseline") {
    const baseStart = previous.baseStart || previous.start;
    const baseRefStart = previous.baseRefStart || previous.refStart;
    state.drawing = {
      start: baseStart,
      end: baseStart,
      lockedEnd: false,
      phase: "end",
      refStart: baseRefStart,
      baseStart,
      baseRefStart,
    };
    statusChip.textContent = `База ${metrics.length} мм. Поставьте следующую точку`;
    return;
  }
  state.drawing = null;
}

function selectLineEndpoint(endpoint) {
  const entity = state.entities.find((item) => item.id === endpoint?.entityId);
  if (!entity || entity.type === "block") return false;
  state.selectedId = entity.id;
  state.selectedIds = [entity.id];
  state.selectedEndpoint = { entityId: entity.id, point: endpoint.point };
  state.endpointEditBefore = entityGeometry(entity);
  state.drawing = null;
  state.furnitureEditId = null;
  const geometry = selectedEndpointGeometry();
  if (geometry) centerViewOnWorldPoint(geometry.moving);
  resetSnapTracking();
  updateSelectedEndpointEditors(cursorWorld());
  statusChip.textContent = "Конец линии выбран. Подведите центр к новой точке и тапните";
  draw();
  return true;
}

function commitCursorPoint() {
  const resolved = cursorSnapResolved();
  const world = resolved.point;
  if (state.selectedEndpoint) {
    commitSelectedEndpointCursorPoint();
    return;
  }
  if (state.offsetCommand) {
    commitOffsetCommandPoint(rawCursorWorld());
    return;
  }
  if (state.moveCommand) {
    commitMoveCommandPoint(world);
    return;
  }
  if (state.tool === "dimension") {
    if (state.dimensionTool === "leader") {
      if (!state.drawing) {
        resetSnapTracking();
        state.drawing = { start: world, end: world, lockedEnd: false, phase: "leader-end" };
        statusChip.textContent = "Выноска: поставьте место текста";
      } else if (state.drawing.phase === "leader-end") {
        const end = state.drawing.lockedEnd ? state.drawing.end : world;
        const metrics = segmentMetrics(state.drawing.start.x, state.drawing.start.y, end.x, end.y);
        if (metrics.length <= 0) {
          statusChip.textContent = "Выноска: нужна вторая точка";
          draw();
          return;
        }
        state.drawing.end = end;
        state.drawing.lockedEnd = true;
        state.drawing.phase = "leader-text";
        showLeaderTextEditor(end);
        statusChip.textContent = "Выноска: введите текст и нажмите галочку";
      }
      draw();
      return;
    }
    if (state.dimensionTool === "angular") {
      if (!state.drawing) {
        resetSnapTracking();
        state.drawing = { start: world, end: world, lockedEnd: false, phase: "angular-arm1" };
        statusChip.textContent = "Угол: поставьте точку на первой стороне";
      } else if (state.drawing.phase === "angular-arm1") {
        state.drawing.arm1 = world;
        state.drawing.end = world;
        state.drawing.phase = "angular-arm2";
        statusChip.textContent = "Угол: поставьте точку на второй стороне";
      } else if (state.drawing.phase === "angular-arm2") {
        const entity = angularDimensionEntity(`dimension-${Date.now()}`, state.drawing.start, state.drawing.arm1, world);
        pushEntity(entity);
        state.drawing = null;
        resetSnapTracking();
        statusChip.textContent = "Угловой размер создан";
      }
      draw();
      return;
    }
    if (!state.drawing) {
      resetSnapTracking();
      state.drawing = { start: world, end: world, lockedEnd: false, phase: "end", refStart: dimensionRefFromSnap(resolved.snap), baseStart: world, baseRefStart: dimensionRefFromSnap(resolved.snap) };
      statusChip.textContent = "Размер: начало поставлено. Поставьте вторую точку";
    } else if (state.drawing.phase === "end") {
      const end = dimensionAdjustedEnd(state.drawing.start, state.drawing.lockedEnd ? state.drawing.end : world);
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
      const offset = dimensionOffsetWithAlignmentSnap(state.drawing.start, state.drawing.end, rawCursorWorld());
      state.drawing.offset = Math.abs(offset) < 60 ? (offset < 0 ? -260 : 260) : offset;
      const metrics = segmentMetrics(state.drawing.start.x, state.drawing.start.y, state.drawing.end.x, state.drawing.end.y);
      pushEntity(createEntityFromDrawing());
      continueDimensionAfterCreate(metrics);
      resetSnapTracking();
      if (!state.drawing) statusChip.textContent = `Размер ${metrics.length} мм завершен`;
    }
    draw();
    return;
  }
  if (["line", "polyline", "wall", "circle", "rectangle", "arc"].includes(state.tool)) {
    if (!state.drawing) {
      setSelection(null);
      state.endpointEditBefore = null;
      hideInlineEditors();
      resetSnapTracking();
      if (state.tool === "line" || state.tool === "polyline") {
        state.selectedEndpoint = null;
        state.endpointEditBefore = null;
      }
      state.drawing = { start: world, end: world, lockedEnd: false };
      hideDrawToolMenu();
      statusChip.textContent = state.tool === "arc" ? "Дуга: укажите конечную точку" : "Начало поставлено. Подведите курсор дальше и тапните холст";
    } else {
      const end = state.drawing.lockedEnd ? state.drawing.end : world;
      const finishedTool = state.tool;
      if (finishedTool === "arc" && !state.drawing.arcEnd) { state.drawing.arcEnd = end; state.drawing.end = end; state.drawing.lockedEnd = false; statusChip.textContent = "Дуга: укажите изгиб"; draw(); return; }
      state.drawing.end = end;
      const metrics = segmentMetrics(state.drawing.start.x, state.drawing.start.y, end.x, end.y);
      const arcThrough = finishedTool === "arc" && state.drawing.arcEnd ? arcThroughFromMidBulge(state.drawing.start, state.drawing.arcEnd, end) : null;
      const validShape = metrics.length > 0 && (finishedTool !== "arc" || arcGeometry(state.drawing.start, arcThrough, state.drawing.arcEnd)) && (finishedTool !== "rectangle" || (Math.abs(end.x - state.drawing.start.x) > 0 && Math.abs(end.y - state.drawing.start.y) > 0));
      if (!validShape) { statusChip.textContent = `${drawingToolName(finishedTool)}: нужна другая точка`; draw(); return; }
      pushEntity(createEntityFromDrawing());
      statusChip.textContent = drawingDoneLabel(finishedTool, metrics);
      if (finishedTool === "line") {
        state.drawing = null;
        state.selectedEndpoint = null;
        state.endpointEditBefore = null;
        resetSnapTracking();
        hideDrawToolMenu();
        syncToolButtons();
        statusChip.textContent = "Линия завершена. Укажите первую точку новой линии";
      }
      else if (["wall", "dimension", "circle", "rectangle", "arc"].includes(finishedTool)) { state.drawing = null; hideDrawToolMenu(); if (finishedTool !== "dimension") { state.selectTool = "select"; setTool("select"); } statusChip.textContent = drawingFinishedStatus(finishedTool); }
      else if (finishedTool === "polyline") { state.drawing = { start: end, end, lockedEnd: false }; statusChip.textContent = `Полилиния ${metrics.length} мм. Следующий сегмент`; }
    }
  } else {
    setSelection(pickEntity(centerScreen()) || state.selectedId);
    statusChip.textContent = state.selectedId ? "Элемент выбран курсором" : "Подведите курсор к элементу";
  }
  if (!state.drawing && state.tool === "dimension") {
    const length = Number(lengthInput.value) || 0;
    statusChip.textContent = `Размер ${length} мм завершен`;
  }
  draw();
}

function drawingToolName(tool) { return { line: "Линия", polyline: "Полилиния", wall: "Стена", dimension: "Размер", circle: "Круг", rectangle: "Прямоугольник", arc: "Дуга" }[tool] || "Объект"; }
function drawingFinishedStatus(tool) { return `${drawingToolName(tool)} ${["line", "wall", "arc"].includes(tool) ? "завершена" : "завершен"}`; }
function drawingDoneLabel(tool, metrics) { if (tool === "circle") return `Круг R ${metrics.length} мм`; if (tool === "rectangle") return "Прямоугольник создан"; if (tool === "arc") return "Дуга создана"; return `${tool === "wall" ? "Стена" : "Линия"} ${metrics.length} мм · ${metrics.angle}°`; }

function commitOffsetCommandPoint(sidePoint) {
  const command = state.offsetCommand;
  const entity = command ? state.entities.find((item) => item.id === command.entityId) : null;
  if (!command || !entity) return;
  const copy = offsetLinearEntity(entity, command.distance, sidePoint);
  state.entities.push(copy);
  state.undo.push({ type: "add", entity: copy });
  state.redo.length = 0;
  markProjectDirty("offset");
  state.selectedId = copy.id;
  state.selectedIds = [copy.id];
  state.selectedEndpoint = null;
  state.offsetCommand = null;
  syncCommandState();
  hideInlineEditors();
  statusChip.textContent = `Смещение ${Math.round(command.distance)} мм создано`;
  draw();
}

function commitMoveCommandPoint(world) {
  const command = state.moveCommand;
  if (!command) return;
  if (!command.base) {
    command.base = world;
    command.end = world;
    command.lockedEnd = false;
    syncCommandState();
    statusChip.textContent = "Переместить: наведите курсор на вторую точку и тапните";
    statusChip.textContent = `${command.mode === "copy" ? "Копия" : "Переместить"}: наведите курсор на вторую точку и тапните`;
    statusChip.textContent = `${command.mode === "copy" ? "Копия" : command.mode === "rotate" ? "Поворот" : "Переместить"}: наведите курсор на угол и тапните`;
    if (command.mode === "rotate") {
      statusChip.textContent = "Поворот: наведите курсор на исходный угол и тапните";
    }
    draw();
    forceMoveCursorVisible();
    return;
  }

  const end = command.lockedEnd ? command.end : world;
  const entity = state.entities.find((item) => item.id === command.entityId);
  if (!entity) {
    state.moveCommand = null;
    hideInlineEditors();
    draw();
    return;
  }
  if (command.mode === "rotate" && !command.reference) {
    command.reference = end;
    command.lockedEnd = false;
    statusChip.textContent = "Поворот: наведите курсор на новый угол и тапните";
    draw();
    forceMoveCursorVisible();
    return;
  }
  const dx = end.x - command.base.x;
  const dy = end.y - command.base.y;
  if (command.mode === "rotate") {
    const startAngle = angleBetweenPoints(command.base, command.reference);
    const endAngle = angleBetweenPoints(command.base, end);
    rotateEntityAround(entity, command.base, signedAngleDelta(startAngle, endAngle));
    const after = entityGeometry(entity);
    if (geometryChanged(command.before, after)) {
      state.undo.push({ type: "move", entityId: entity.id, before: command.before, after });
      state.redo.length = 0;
      markProjectDirty("rotate");
    }
    state.moveCommand = null;
    resetSnapTracking();
    syncCommandState();
    hideInlineEditors();
    statusChip.textContent = "Поворот применен";
    draw();
    return;
  }
  if (command.mode === "copy") {
    const copy = cloneEntityForCommand(entity, dx, dy);
    state.entities.push(copy);
    state.undo.push({ type: "add", entity: copy });
    state.redo.length = 0;
    markProjectDirty("copy");
    state.selectedId = copy.id;
    state.selectedIds = [copy.id];
    state.selectedEndpoint = null;
    state.moveCommand = null;
    resetSnapTracking();
    syncCommandState();
    hideInlineEditors();
    statusChip.textContent = "Копия создана";
    draw();
    return;
  }
  moveEntityBy(entity, dx, dy);
  const after = entityGeometry(entity);
  if (geometryChanged(command.before, after)) {
    state.undo.push({ type: "move", entityId: entity.id, before: command.before, after });
    state.redo.length = 0;
    markProjectDirty("move-command");
  }
  state.moveCommand = null;
  resetSnapTracking();
  syncCommandState();
  hideInlineEditors();
  statusChip.textContent = "Элемент перемещен";
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
    const finishedTool = state.tool;
    state.drawing.end = end;
    if (state.tool === "dimension") {
      state.drawing.lockedEnd = true;
      state.drawing.phase = "offset";
      statusChip.textContent = "Размер: поставьте третью точку для положения размерной линии";
      draw();
      return;
    }
    pushEntity(createEntityFromDrawing());
    if (finishedTool === "line" || finishedTool === "wall") {
      state.drawing = null;
      hideDrawToolMenu();
      state.selectTool = "select";
      setTool("select");
    } else if (finishedTool === "polyline") {
      state.drawing = { start: end, end, lockedEnd: false };
      statusChip.textContent = "Полилиния: следующий сегмент";
    } else {
      state.drawing = { start: end, end, lockedEnd: false };
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
    if (state.furnitureResizeHandlesId === entity.id) {
      if (!layout.showResizeControls) return null;
      for (const handle of Object.values(layout.resizeHandles)) {
        if (pointDistance(screen, handle) <= 28) {
          return { type: "resize-handle", axis: handle.axis, side: handle.side, entity, layout };
        }
      }
      return null;
    }
    if (state.furnitureProportionalHandlesId === entity.id) {
      if (!layout.showResizeControls) return null;
      for (const handle of Object.values(layout.proportionalHandles)) {
        if (pointDistance(screen, handle) <= 28) {
          return { type: "proportional-handle", side: handle.side, entity, layout };
        }
      }
      return null;
    }
    if (!layout.showEditControls) return null;
    if (pointDistance(screen, layout.resizeToggle) <= 24) return { type: "resize-toggle", entity, layout };
    if (pointDistance(screen, layout.rotate) <= 24) return { type: "rotate", entity, layout };
    if (pointDistance(screen, layout.proportionalToggle) <= 24) return { type: "proportional-toggle", entity, layout };
  }
  return null;
}

function hitFurnitureDimensionInput(screen) {
  const entity = selectedFurnitureEntity();
  if (!entity || state.drawing || state.moveCommand || state.offsetCommand) return null;
  const layout = furnitureControlLayout(entity);
  if (!layout) return null;
  const dimensions = furnitureDimensionSegments(entity, layout);
  const threshold = screenUiPx(30);
  const widthStart = dimensions.width.screenStart;
  const widthEnd = dimensions.width.screenEnd;
  const heightStart = dimensions.height.screenStart;
  const heightEnd = dimensions.height.screenEnd;
  const widthHit = pointDistance(screen, midpoint(widthStart, widthEnd));
  const heightHit = pointDistance(screen, midpoint(heightStart, heightEnd));
  if (widthHit <= threshold && widthHit <= heightHit) return { kind: "width", entity };
  if (heightHit <= threshold) return { kind: "height", entity };
  return null;
}

function focusFurnitureSizeInput(kind) {
  const entity = selectedFurnitureEntity();
  if (!entity) return false;
  state.activeFurnitureDimension = kind === "height" ? "height" : "width";
  updateFurnitureSizePanel(entity);
  const input = kind === "height" ? furnitureDepthInput : furnitureWidthInput;
  input?.focus();
  input?.select();
  positionKeyboardConfirmButton();
  statusChip.textContent = kind === "height" ? "Введите глубину мебели" : "Введите ширину мебели";
  draw();
  return true;
}

function rectContainsPoint(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function beginFurnitureControl(control, event, screen) {
  state.selectedId = control.entity.id;
  state.selectedIds = [control.entity.id];
  if (control.type === "edit") {
    state.furnitureEditId = control.entity.id;
    state.pointer = { id: event.pointerId, mode: "ui", moved: true, targetId: null };
    draw();
    return true;
  }
  if (control.type === "resize-toggle") {
    state.furnitureResizeHandlesId = state.furnitureResizeHandlesId === control.entity.id ? null : control.entity.id;
    state.furnitureProportionalHandlesId = null;
    state.pointer = { id: event.pointerId, mode: "ui", moved: true, targetId: null };
    statusChip.textContent = state.furnitureResizeHandlesId ? "Размер мебели: тяните боковые ручки ширины или глубины" : "Ручки размера скрыты";
    draw();
    return true;
  }
  if (control.type === "proportional-toggle") {
    state.furnitureProportionalHandlesId = state.furnitureProportionalHandlesId === control.entity.id ? null : control.entity.id;
    state.furnitureResizeHandlesId = null;
    state.pointer = { id: event.pointerId, mode: "ui", moved: true, targetId: null };
    statusChip.textContent = state.furnitureProportionalHandlesId ? "Пропорции: тяните точку с нужной стороны" : "Пропорциональные точки скрыты";
    draw();
    return true;
  }
  const entity = control.entity;
  const centerScreenPoint = worldToScreen({ x: entity.x, y: entity.y });
  const startLocal = worldToBlockLocalGeometry(entityGeometry(entity), screenToWorld(screen));
  state.pointer = {
    id: event.pointerId,
    screen,
    startScreen: screen,
    world: screenToWorld(screen),
    moved: true,
    mode: control.type === "rotate" ? "furniture-rotate" : "furniture-resize",
    targetId: entity.id,
    before: entityGeometry(entity),
    resizeAxis: control.type === "proportional-handle" ? "proportional" : control.axis,
    resizeSide: control.side,
    startScaleDistance: Math.max(1, Math.hypot(startLocal.x, startLocal.y)),
    startRotation: entity.rotation || 0,
    startAngle: Math.atan2(screen.y - centerScreenPoint.y, screen.x - centerScreenPoint.x),
  };
  statusChip.textContent = control.type === "rotate" ? "Поворот мебели" : "Изменение размера мебели";
  return true;
}

function resizeFurnitureByPointer(entity, screen) {
  const start = state.pointer?.before || entityGeometry(entity);
  const local = worldToBlockLocalGeometry(start, screenToWorld(screen));
  const startWidth = Math.max(1, start?.width || entity.width || defaultBlockSize(entity.kind).width);
  const startHeight = Math.max(1, start?.height || entity.height || defaultBlockSize(entity.kind).height);
  const pointerWidth = Math.abs(local.x) * 2;
  const pointerHeight = Math.abs(local.y) * 2;
  const axis = state.pointer?.resizeAxis || "both";
  const side = state.pointer?.resizeSide || "";
  if (axis === "width") {
    const rawWidth = side === "left" ? startWidth / 2 - local.x : startWidth / 2 + local.x;
    const nextWidth = snapFurnitureSize(rawWidth);
    const delta = (nextWidth - startWidth) / 2;
    entity.width = nextWidth;
    entity.height = startHeight;
    setBlockCenterFromLocalDelta(entity, start, side === "left" ? -delta : delta, 0);
  } else if (axis === "height") {
    const rawHeight = side === "top" ? startHeight / 2 - local.y : startHeight / 2 + local.y;
    const nextHeight = snapFurnitureSize(rawHeight);
    const delta = (nextHeight - startHeight) / 2;
    entity.width = startWidth;
    entity.height = nextHeight;
    setBlockCenterFromLocalDelta(entity, start, 0, side === "top" ? -delta : delta);
  } else if (axis === "proportional") {
    const sx = side.includes("w") ? -1 : 1;
    const sy = side.includes("n") ? -1 : 1;
    const rawWidth = startWidth / 2 + sx * local.x;
    const rawHeight = startHeight / 2 + sy * local.y;
    const rawScale = Math.max(rawWidth / Math.max(1, startWidth), rawHeight / Math.max(1, startHeight));
    const scale = Math.max(300 / startWidth, 300 / startHeight, Math.min(4, Math.max(0.2, rawScale)));
    const nextWidth = snapFurnitureSize(startWidth * scale);
    const nextHeight = snapFurnitureSize(startHeight * scale);
    const dx = sx * (nextWidth - startWidth) / 2;
    const dy = sy * (nextHeight - startHeight) / 2;
    entity.width = nextWidth;
    entity.height = nextHeight;
    setBlockCenterFromLocalDelta(entity, start, dx, dy);
  } else {
    const currentDistance = Math.max(1, Math.hypot(local.x, local.y));
    const rawScale = currentDistance / Math.max(1, state.pointer?.startScaleDistance || currentDistance);
    const scale = Math.max(300 / startWidth, 300 / startHeight, Math.min(4, Math.max(0.25, rawScale)));
    entity.width = snapFurnitureSize(startWidth * scale);
    entity.height = snapFurnitureSize(startHeight * scale);
  }
  markProjectDirty("furniture-resize");
  statusChip.textContent = `${Math.round(entity.width)} × ${Math.round(entity.height)} мм`;
}

function worldToBlockLocalGeometry(geometry, point) {
  const radians = -(((geometry?.rotation || 0) * Math.PI) / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - (geometry?.x || 0);
  const dy = point.y - (geometry?.y || 0);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function setBlockCenterFromLocalDelta(entity, geometry, dxLocal, dyLocal) {
  const radians = (((geometry?.rotation || entity.rotation || 0) * Math.PI) / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  entity.x = (geometry?.x || entity.x) + dxLocal * cos - dyLocal * sin;
  entity.y = (geometry?.y || entity.y) + dxLocal * sin + dyLocal * cos;
}

function rotateFurnitureByPointer(entity, screen) {
  const center = worldToScreen({ x: entity.x, y: entity.y });
  const angle = Math.atan2(screen.y - center.y, screen.x - center.x);
  const delta = radToDeg(angle - state.pointer.startAngle);
  const rawRotation = normalizeDegrees(state.pointer.startRotation + delta);
  entity.rotation = state.snaps.has("polar") ? Math.round(rawRotation / 15) * 15 : Math.round(rawRotation);
  markProjectDirty("furniture-rotate");
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
  const furnitureDimensionInput = hitFurnitureDimensionInput(screen);
  if (furnitureDimensionInput && focusFurnitureSizeInput(furnitureDimensionInput.kind)) {
    state.pointer = { id: event.pointerId, mode: "ui", moved: true, targetId: null };
    return;
  }
  const furnitureControl = hitFurnitureControl(screen);
  if (furnitureControl && beginFurnitureControl(furnitureControl, event, screen)) {
    return;
  }
  if (state.moveCommand) {
    state.pointer = {
      id: event.pointerId,
      screen,
      startScreen: screen,
      world: screenToWorld(screen),
      moved: false,
      mode: "move-command",
      targetId: state.moveCommand.entityId,
      before: null,
    };
    statusChip.textContent = state.moveCommand.base
      ? "Переместить: наведите курсор на вторую точку и тапните"
      : "Переместить: наведите курсор на базовую точку и тапните";
    return;
  }
  if (state.offsetCommand) {
    state.pointer = {
      id: event.pointerId,
      screen,
      startScreen: screen,
      world: screenToWorld(screen),
      moved: false,
      mode: "offset-command",
      targetId: state.offsetCommand.entityId,
      before: null,
    };
    statusChip.textContent = "Смещение: наведите курсор на сторону и тапните";
    return;
  }
  if (state.tool === "select" && (state.selectTool === "window" || state.selectTool === "lasso")) {
    startSelectionDrag(state.selectTool === "lasso" ? "lasso" : "window", event, screen);
    return;
  }
  const dimensionControl = hitDimensionControl(screen);
  if (dimensionControl) {
    const hitEntity = dimensionControl.entity;
    state.selectedId = hitEntity.id;
    state.selectedIds = [hitEntity.id];
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
  const selectedLineEndpoint = state.tool === "select" ? pickSelectedLineEndpoint(screen) : null;
  if (selectedLineEndpoint) {
    selectLineEndpoint(selectedLineEndpoint);
    state.pointer = {
      id: event.pointerId,
      screen,
      startScreen: screen,
      world: screenToWorld(screen),
      moved: true,
      mode: "ui",
      targetId: null,
    };
    return;
  }
  const lineEndpoint = state.tool === "line" || state.tool === "wall" ? pickLineEndpoint(screen) : null;
  const editingSelectedEndpoint =
    lineEndpoint &&
    state.selectedEndpoint?.entityId === lineEndpoint.entityId &&
    state.selectedEndpoint?.point === lineEndpoint.point;
  if (editingSelectedEndpoint) {
    selectLineEndpoint(lineEndpoint);
    state.pointer = {
      id: event.pointerId,
      screen,
      startScreen: screen,
      world: screenToWorld(screen),
      moved: true,
      mode: "ui",
      targetId: null,
    };
    return;
  }
  if (state.selectedEndpoint && state.tool === "select") {
    const endpointGeometry = selectedEndpointGeometry();
    if (!endpointGeometry) {
      state.selectedEndpoint = null;
      state.endpointEditBefore = null;
      hideInlineEditors();
      draw();
      return;
    }
    state.pointer = {
      id: event.pointerId,
      screen,
      startScreen: screen,
      world: screenToWorld(screen),
      moved: false,
      mode: "endpoint-place",
      targetId: state.selectedEndpoint.entityId,
      before: state.endpointEditBefore || entityGeometry(endpointGeometry.entity),
    };
    statusChip.textContent = "Конец линии: тапните, чтобы поставить новую точку";
    return;
  }
  const hitId = state.tool === "select" ? pickEntity(screen) : state.tool === "furniture" ? pickFurnitureEntity(screen) : null;
  const hitEntity = hitId ? state.entities.find((entity) => entity.id === hitId) : null;
  const hitIsSelected = hitId && (state.selectedId === hitId || (state.selectedIds || []).includes(hitId));
  const canMoveHit = Boolean(hitEntity && hitIsSelected && (state.tool === "select" || state.tool === "furniture"));
  const pointerMode = canMoveHit
    ? hitEntity.layer === "dimensions"
      ? "dimension-offset"
      : "move"
    : "pan";
  const pointerTargetId = canMoveHit ? hitId : null;
  const grabOffset = hitEntity?.type === "block"
    ? { x: screenToWorld(screen).x - hitEntity.x, y: screenToWorld(screen).y - hitEntity.y }
    : null;
  state.pointer = {
    id: event.pointerId,
    screen,
    startScreen: screen,
    world: screenToWorld(screen),
    moved: false,
    mode: pointerMode,
    targetId: pointerTargetId,
    tapCandidateId: hitId,
    before: pointerTargetId && hitEntity ? entityGeometry(hitEntity) : null,
    grabOffset,
  };
  scheduleSelectionLongPress(state.pointer);
  if (canMoveHit) {
    state.dimensionPickCycle = null;
    state.selectedId = hitId;
    if (state.tool === "select" && state.selectTool !== "multi") state.selectedIds = [hitId];
    if (hitEntity?.type === "block") {
      if (state.furnitureEditId && state.furnitureEditId !== hitId) state.furnitureEditId = null;
      statusChip.textContent = "Мебель выбрана: двигайте пальцем, тяните углы или крутите";
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
  if (travel > TAP_MOVE_TOLERANCE) {
    state.pointer.moved = true;
    clearPointerLongPress();
  }
  if (state.pointer.mode === "selection-window" || state.pointer.mode === "selection-lasso") {
    updateSelectionDrag(screen);
    state.pointer.screen = screen;
    statusChip.textContent = state.pointer.mode === "selection-lasso" ? "Лассо: отпустите палец для выбора" : "Выделение: отпустите палец для выбора";
    draw();
    return;
  }
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
      const dx = currentWorld.x - state.pointer.world.x;
      const dy = currentWorld.y - state.pointer.world.y;
      if (entity.type === "block" && state.snaps.has("grid")) {
        const grabOffset = state.pointer.grabOffset || { x: 0, y: 0 };
        const nextX = snapValueToGrid(currentWorld.x - grabOffset.x);
        const nextY = snapValueToGrid(currentWorld.y - grabOffset.y);
        moveEntityBy(entity, nextX - entity.x, nextY - entity.y);
      } else {
        moveEntityBy(entity, dx, dy);
      }
      state.pointer.world = currentWorld;
      statusChip.textContent = "Перемещение объекта";
    }
  } else if (state.pointer.mode === "line-endpoint" && state.pointer.targetId) {
    const currentWorld = screenToWorld(screen);
    const geometry = selectedEndpointGeometry();
    const snappedWorld = geometry ? resolveLineLikeSnap(currentWorld, geometry.fixed).point : currentWorld;
    setSelectedEndpointPosition(snappedWorld);
    updateSelectedEndpointEditors();
    statusChip.textContent = "Редактирование конца линии";
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
    markProjectDirty("pan");
  }
  state.pointer.screen = screen;
  draw();
});

canvas.addEventListener("pointerup", finishCanvasPointer);
canvas.addEventListener("pointercancel", (event) => finishCanvasPointer(event, true));

function finishCanvasPointer(event, canceled = false) {
  const wasPinching = Boolean(state.pinch) || state.activePointers.size > 1 || state.gestureSuppressTap;
  clearPointerLongPress();
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
  if (state.pointer?.mode === "selection-window" || state.pointer?.mode === "selection-lasso") {
    if (!canceled) {
      if (state.pointer.moved) {
        finishSelectionDrag();
      } else {
        state.selectionDrag = null;
        applyTapSelection(pickEntity(state.pointer.startScreen));
        draw();
      }
    }
  } else if (state.pointer?.mode === "move-command") {
    if (!canceled && !state.pointer.moved) {
      commitCursorPoint();
    } else {
      draw();
      forceMoveCursorVisible();
    }
  } else if (state.pointer?.mode === "offset-command") {
    if (!canceled && !state.pointer.moved) {
      commitOffsetCommandPoint(rawCursorWorld());
    } else {
      draw();
      forceMoveCursorVisible();
    }
  } else if (state.pointer?.mode === "endpoint-place") {
    if (!canceled && !state.pointer.moved) {
      commitSelectedEndpointCursorPoint(state.pointer.before);
    } else {
      draw();
      forceMoveCursorVisible();
    }
  } else if (state.pointer && !state.pointer.moved) {
    if (state.pointer.mode === "line-endpoint") {
      updateSelectedEndpointEditors();
      statusChip.textContent = "Конец линии выбран. Введите длину или тяните точку";
      draw();
    } else if (state.tool === "select") {
      const hitId = state.pointer.tapCandidateId || state.pointer.targetId || pickEntity(state.pointer.startScreen);
      const hitEntity = hitId ? state.entities.find((entity) => entity.id === hitId) : null;
      state.selectedId = hitId;
      state.furnitureEditId = null;
      if (hitEntity?.type === "block") {
        statusChip.textContent = "Мебель выбрана: двигайте пальцем, тяните углы или крутите";
      } else {
        state.selectedEndpoint = null;
        statusChip.textContent = hitId ? "Элемент выбран" : "Выбор: коснитесь объекта или тяните пустое место для панорамы";
      }
      if (!(!hitId && state.furnitureEditId)) {
        applyTapSelection(hitId);
      }
      draw();
    } else if (state.tool === "furniture") {
      const hitId = state.pointer.tapCandidateId || state.pointer.targetId || pickFurnitureEntity(state.pointer.startScreen);
      state.furnitureEditId = null;
      setSelection(hitId);
      statusChip.textContent = hitId ? "Мебель выбрана: двигайте пальцем, тяните углы или крутите" : "Перетащите блок из библиотеки на план";
      draw();
    } else {
      commitCursorPoint();
    }
  } else {
    finishPointerMoveUndo();
  }
  state.pointer = null;
  state.dimensionSnapHint = null;
  if (state.openEditMenuAfterPointer) {
    state.openEditMenuAfterPointer = false;
    if (selectedEntities().length) {
      showSelectToolMenuAfterLayout();
    }
  }
  if (state.activePointers.size === 0) {
    state.gestureSuppressTap = false;
  }
  forceMoveCursorVisible();
  drawNow();
}

function finishPointerMoveUndo() {
  const trackedModes = new Set(["move", "furniture-resize", "furniture-rotate", "line-endpoint", "dimension-offset", "dimension-start", "dimension-end"]);
  if (!trackedModes.has(state.pointer?.mode) || !state.pointer.targetId) return;
  const entity = state.entities.find((item) => item.id === state.pointer.targetId);
  if (entity && state.pointer.before) {
    const after = entityGeometry(entity);
    if (geometryChanged(state.pointer.before, after)) {
      state.undo.push({ type: "move", entityId: entity.id, before: state.pointer.before, after });
      state.redo.length = 0;
      markProjectDirty("pointer-move");
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
    markProjectDirty("move");
    return;
  }
  entity.x1 += dx;
  entity.y1 += dy;
  entity.x2 += dx;
  entity.y2 += dy;
  markProjectDirty("move");
}

function cloneLinearEntity(entity, dx = 260, dy = 260) {
  const id = `${entity.type || "line"}-${Date.now()}`;
  if (entity.type === "wall") {
    const copy = wall(id, entity.x1 + dx, entity.y1 + dy, entity.x2 + dx, entity.y2 + dy);
    copy.width = entity.width || copy.width;
    return copy;
  }
  return line(id, entity.x1 + dx, entity.y1 + dy, entity.x2 + dx, entity.y2 + dy, entity.layer || "measure");
}

function cloneEntityForCommand(entity, dx = 260, dy = 260) {
  if (entity.type === "block") {
    const size = entitySize(entity);
    const copy = block(`${entity.kind}-${Date.now()}`, entity.kind, entity.x + dx, entity.y + dy, entity.rotation || 0, size);
    copy.scale = entity.scale || 1;
    copy.flipX = Boolean(entity.flipX);
    return copy;
  }
  return cloneLinearEntity(entity, dx, dy);
}

function rotateLinearEntity90(entity) {
  const cx = (entity.x1 + entity.x2) / 2;
  const cy = (entity.y1 + entity.y2) / 2;
  const p1 = rotatePointAround({ x: entity.x1, y: entity.y1 }, { x: cx, y: cy }, Math.PI / 2);
  const p2 = rotatePointAround({ x: entity.x2, y: entity.y2 }, { x: cx, y: cy }, Math.PI / 2);
  entity.x1 = p1.x;
  entity.y1 = p1.y;
  entity.x2 = p2.x;
  entity.y2 = p2.y;
}

function rotateLinearEntityAround(entity, base, radians) {
  const p1 = rotatePointAround({ x: entity.x1, y: entity.y1 }, base, radians);
  const p2 = rotatePointAround({ x: entity.x2, y: entity.y2 }, base, radians);
  entity.x1 = p1.x;
  entity.y1 = p1.y;
  entity.x2 = p2.x;
  entity.y2 = p2.y;
}

function rotateEntityAround(entity, base, radians) {
  if (entity.type === "block") {
    const center = rotatePointAround({ x: entity.x, y: entity.y }, base, radians);
    entity.x = center.x;
    entity.y = center.y;
    entity.rotation = normalizeDegrees((entity.rotation || 0) + radToDeg(radians));
    return;
  }
  rotateLinearEntityAround(entity, base, radians);
}

function mirrorLinearEntity(entity) {
  const cx = (entity.x1 + entity.x2) / 2;
  entity.x1 = cx - (entity.x1 - cx);
  entity.x2 = cx - (entity.x2 - cx);
}

function mirrorBlockEntity(entity) {
  entity.flipX = !entity.flipX;
}

function offsetLinearEntity(entity, distance = 300, sidePoint = null) {
  const dx = entity.x2 - entity.x1;
  const dy = entity.y2 - entity.y1;
  const length = Math.hypot(dx, dy) || 1;
  const cross = sidePoint ? dx * (sidePoint.y - entity.y1) - dy * (sidePoint.x - entity.x1) : 1;
  const side = cross < 0 ? -1 : 1;
  const nx = (-dy / length) * distance * side;
  const ny = (dx / length) * distance * side;
  const copy = cloneLinearEntity(entity, 0, 0);
  moveEntityBy(copy, nx, ny);
  return copy;
}

function rotatePointAround(point, center, radians) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
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
  markProjectDirty("dimension-handle");
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
    return { x: entity.x, y: entity.y, width: entity.width, height: entity.height, rotation: entity.rotation || 0, flipX: Boolean(entity.flipX) };
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
  markProjectDirty("geometry");
}

function geometryChanged(before, after) {
  if (!before || !after) return false;
  return Object.keys(after).some((key) => {
    if (typeof after[key] === "boolean" || typeof before[key] === "boolean") return after[key] !== before[key];
    return Math.abs((after[key] || 0) - (before[key] || 0)) > 0.01;
  });
}

function pickEntity(screen) {
  let best = null;
  let bestDistance = 18;
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (!entityMatchesSelectionFilter(entity)) continue;
    if (entity.type === "block") {
      if (pointInsideBlock(screen, entity)) return entity.id;
      continue;
    }
    const distance = distanceToEntityScreen(screen, entity);
    if (distance < bestDistance) {
      best = entity.id;
      bestDistance = distance;
    }
  }
  return best;
}

function pickLineEndpoint(screen) {
  let best = null;
  let bestDistance = 18;
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if ((entity.type !== "line" && entity.type !== "wall") || entity.layer === "dimensions" || !isLayerVisible(entity.layer)) continue;
    const endpoints = [
      { point: "start", screen: worldToScreen({ x: entity.x1, y: entity.y1 }) },
      { point: "end", screen: worldToScreen({ x: entity.x2, y: entity.y2 }) },
    ];
    for (const endpoint of endpoints) {
      const distance = Math.hypot(screen.x - endpoint.screen.x, screen.y - endpoint.screen.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { entityId: entity.id, point: endpoint.point };
      }
    }
  }
  return best;
}

function pickSelectedLineEndpoint(screen) {
  const entity = state.entities.find((item) => item.id === state.selectedId);
  if (!entity || (entity.type !== "line" && entity.type !== "wall") || entity.layer === "dimensions" || !isLayerVisible(entity.layer)) return null;
  let best = null;
  let bestDistance = 20;
  const endpoints = [
    { point: "start", screen: worldToScreen({ x: entity.x1, y: entity.y1 }) },
    { point: "end", screen: worldToScreen({ x: entity.x2, y: entity.y2 }) },
  ];
  for (const endpoint of endpoints) {
    const distance = Math.hypot(screen.x - endpoint.screen.x, screen.y - endpoint.screen.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { entityId: entity.id, point: endpoint.point };
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

function distanceToEntityScreen(screen, entity) {
  if (entity.layer === "dimensions") {
    if (entity.dimensionKind === "leader") {
      const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
      const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
      return pointToSegmentDistance(screen, p1, p2);
    }
    const dimensionGeometry = dimensionScreenGeometry(entity);
    const p1 = dimensionGeometry?.a || worldToScreen({ x: entity.x1, y: entity.y1 });
    const p2 = dimensionGeometry?.b || worldToScreen({ x: entity.x2, y: entity.y2 });
    return pointToSegmentDistance(screen, p1, p2);
  }
  if (entity.type === "circle") { const center = worldToScreen({ x: entity.cx, y: entity.cy }); return Math.abs(Math.hypot(screen.x - center.x, screen.y - center.y) - Math.abs(entity.radius) * state.view.scale); }
  if (entity.type === "rectangle") { const corners = rectangleCorners(entity).map(worldToScreen); return Math.min(pointToSegmentDistance(screen, corners[0], corners[1]), pointToSegmentDistance(screen, corners[1], corners[2]), pointToSegmentDistance(screen, corners[2], corners[3]), pointToSegmentDistance(screen, corners[3], corners[0])); }
  if (entity.type === "arc") { const arc = arcGeometry(entity.start, entity.through, entity.end); if (!arc) return Infinity; const center = worldToScreen(arc.center); const radius = arc.radius * state.view.scale; const angle = Math.atan2(screen.y - center.y, screen.x - center.x); if (!angleOnArc(angle, arc.startAngle, arc.endAngle, arc.counterClockwise)) return Infinity; return Math.abs(Math.hypot(screen.x - center.x, screen.y - center.y) - radius); }
  const p1 = worldToScreen({ x: entity.x1, y: entity.y1 }); const p2 = worldToScreen({ x: entity.x2, y: entity.y2 }); return pointToSegmentDistance(screen, p1, p2);
}
function angleOnArc(angle, startAngle, endAngle, counterClockwise) { const span = counterClockwise ? normalizeAnglePositive(endAngle - startAngle) : normalizeAnglePositive(startAngle - endAngle); const delta = counterClockwise ? normalizeAnglePositive(angle - startAngle) : normalizeAnglePositive(startAngle - angle); return delta <= span + 0.05; }

tools.forEach((button) => {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    if (tool === "line") {
      activateDrawToolMenu();
      return;
    }
    if (tool === "dimension") {
      activateDimensionToolMenu();
      return;
    }
    if (tool === "select") {
      toggleMainSelectTool();
      return;
    }
    if (tool === "selection") {
      activateSelectionTool();
      return;
    }
    hideDrawToolMenu();
    hideDimensionToolMenu();
    hideSelectToolMenu();
    setTool(tool);
    if (tool === "furniture") {
      openFurnitureSheet();
    } else {
      hideSheet(furnitureSheet);
    }
  });
});

drawToolMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-draw-tool]");
  if (!button) return;
  selectDrawTool(button.dataset.drawTool);
});

dimensionToolMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-dimension-tool]");
  if (!button) return;
  selectDimensionTool(button.dataset.dimensionTool);
});

selectModeMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-select-mode]");
  if (!button) return;
  const mode = button.dataset.selectMode;
  if (mode === "select") {
    activatePlainSelect();
  } else if (mode === "filter") {
    selectSelectionTool("filter");
  } else {
    selectSelectionTool(mode);
  }
});

selectToolMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-select-tool]");
  if (!button) return;
  selectSelectionTool(button.dataset.selectTool);
});

leaderTextEditor?.addEventListener("submit", (event) => {
  event.preventDefault();
  commitLeaderText();
});

leaderTextInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    state.drawing = null;
    hideLeaderTextEditor();
    statusChip.textContent = dimensionToolStatusText();
    draw();
  }
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
    markProjectDirty("snaps");
    const names = {
      grid: "Сетка",
      end: "Конец",
      mid: "Середина",
      polar: "Углы 5°",
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

function setActiveFurnitureCard(card, { activateTool = true } = {}) {
  const data = furnitureCardData(card);
  state.block = data.kind;
  state.blockSize = { width: data.width, height: data.height };
  blocks.forEach((blockButton) => blockButton.classList.toggle("active", blockButton === card));
  if (activateTool) setTool("furniture");
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

function beginFurniturePress(card, event) {
  if (card.hidden || state.furnitureDrag) return;
  event.preventDefault();
  const press = {
    pointerId: event.pointerId,
    card,
    startX: event.clientX,
    startY: event.clientY,
    latestX: event.clientX,
    latestY: event.clientY,
    mode: "pending",
    activated: false,
    timer: null,
  };
  press.timer = window.setTimeout(() => {
    if (state.furniturePress !== press || press.activated) return;
    press.activated = true;
    state.suppressFurnitureClick = true;
    beginFurnitureDrag(card, {
      pointerId: press.pointerId,
      clientX: press.latestX,
      clientY: press.latestY,
      preventDefault() {},
    });
  }, 300);
  state.furniturePress = press;
}

function updateFurniturePress(event) {
  const press = state.furniturePress;
  if (!press || press.pointerId !== event.pointerId) return;
  event.preventDefault();
  if (press.mode === "scroll") {
    furnitureGrid.scrollTop += press.latestY - event.clientY;
    press.latestX = event.clientX;
    press.latestY = event.clientY;
    return;
  }
  const travel = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
  const verticalTravel = Math.abs(event.clientY - press.startY);
  const horizontalTravel = Math.abs(event.clientX - press.startX);
  if (!press.activated && travel > 10) {
    window.clearTimeout(press.timer);
    if (verticalTravel > horizontalTravel) {
      press.mode = "scroll";
      furnitureGrid.scrollTop += press.latestY - event.clientY;
    } else {
      state.furniturePress = null;
    }
  }
  press.latestX = event.clientX;
  press.latestY = event.clientY;
}

function finishFurniturePress(event) {
  const press = state.furniturePress;
  if (!press || press.pointerId !== event.pointerId) return;
  window.clearTimeout(press.timer);
  state.furniturePress = null;
  if (press.activated) {
    window.setTimeout(() => {
      state.suppressFurnitureClick = false;
    }, 250);
  }
}

function beginFurnitureDrag(card, event) {
  if (card.hidden) return;
  event.preventDefault?.();
  const data = furnitureCardData(card);
  setActiveFurnitureCard(card);
  const preview = document.createElement("div");
  preview.className = "drag-preview";
  preview.innerHTML = `<strong>${data.title}</strong><small>${data.width} × ${data.height}</small>`;
  document.body.append(preview);
  card.classList.add("dragging");
  try {
    card.setPointerCapture?.(event.pointerId);
  } catch {
    // Long-press drag can start after the browser has already moved pointer focus.
  }
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
  event.preventDefault?.();
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
    setFurnitureSheetPosition("peek");
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

window.addEventListener("pointermove", updateFurnitureDrag);
window.addEventListener("pointerup", finishFurnitureDrag);
window.addEventListener("pointercancel", finishFurnitureDrag);

const furnitureSheetPositions = ["peek", "half", "full"];

function furnitureSheetHeightFor(position) {
  const shellHeight = shell.getBoundingClientRect().height || window.innerHeight || 844;
  const peek = 76;
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
furniturePeekButton?.addEventListener("click", () => {
  setFurnitureSheetPosition("half");
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
    markProjectDirty("furniture-tab");
  });
});

furnitureCatsNav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (button) {
    state.furnitureCategory = button.dataset.category;
    renderFurnitureCategories();
    renderFurnitureLibrary();
    markProjectDirty("furniture-category");
  }
});

lengthInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  applyInlineValue("length", { recordUndo: false });
  lengthInput.blur();
});
angleInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  applyInlineValue("angle", { recordUndo: false });
  angleInput.blur();
});
lengthInput.addEventListener("input", () => {
  syncInlineEditorWidth(lengthInput);
  applyInlineValue("length", { recordUndo: false });
  positionKeyboardConfirmButton();
});
angleInput.addEventListener("input", () => {
  syncInlineEditorWidth(angleInput);
  applyInlineValue("angle", { recordUndo: false });
  positionKeyboardConfirmButton();
});
lengthInput.addEventListener("blur", () => {
  applyInlineValue("length", { recordUndo: false });
  commitNumericInputEdit();
});
angleInput.addEventListener("blur", () => {
  applyInlineValue("angle", { recordUndo: false });
  commitNumericInputEdit();
});
topLengthInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  applyTopMetricValue("length", { recordUndo: false });
  topLengthInput.blur();
});
topAngleInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  applyTopMetricValue("angle", { recordUndo: false });
  topAngleInput.blur();
});
topLengthInput?.addEventListener("input", () => {
  syncInlineEditorWidth(topLengthInput);
  applyTopMetricValue("length", { recordUndo: false });
  positionKeyboardConfirmButton();
});
topAngleInput?.addEventListener("input", () => {
  syncInlineEditorWidth(topAngleInput);
  applyTopMetricValue("angle", { recordUndo: false });
  positionKeyboardConfirmButton();
});
topLengthInput?.addEventListener("blur", () => {
  applyTopMetricValue("length", { recordUndo: false });
  commitNumericInputEdit();
});
topAngleInput?.addEventListener("blur", () => {
  applyTopMetricValue("angle", { recordUndo: false });
  commitNumericInputEdit();
});

selectionActions?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  applySelectionAction(button.dataset.action);
});

keyboardConfirmButton?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  confirmKeyboardInput();
});

keyboardConfirmButton?.addEventListener("click", (event) => {
  event.preventDefault();
});

[furnitureWidthInput, furnitureDepthInput, furnitureRotationInput].forEach((input) => {
  input?.addEventListener("focus", () => {
    state.activeFurnitureDimension = input === furnitureWidthInput ? "width" : input === furnitureDepthInput ? "height" : null;
    updateFurnitureSizePanel(selectedFurnitureEntity());
    draw();
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    applyFurnitureSizeInput({ recordUndo: false });
    input.blur();
  });
  input?.addEventListener("input", () => {
    applyFurnitureSizeInput({ recordUndo: false });
    positionKeyboardConfirmButton();
  });
  input?.addEventListener("blur", () => {
    applyFurnitureSizeInput({ recordUndo: false });
    commitNumericInputEdit();
    window.setTimeout(() => {
      if (document.activeElement !== furnitureWidthInput && document.activeElement !== furnitureDepthInput) {
        state.activeFurnitureDimension = null;
        updateFurnitureSizePanel(selectedFurnitureEntity());
        draw();
      }
    }, 0);
  });
});

keyboardInputs.forEach((input) => {
  input.addEventListener("focus", () => {
    shell.classList.add("input-focused");
    beginNumericInputEdit();
    selectInlineValue(input);
    if (keyboardConfirmButton) keyboardConfirmButton.hidden = false;
    positionKeyboardConfirmButton();
    window.setTimeout(updateViewportLock, 40);
    window.setTimeout(updateViewportLock, 260);
  });
  input.addEventListener("pointerup", () => selectInlineValue(input));
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

annotationScaleSelect?.addEventListener("change", () => {
  setAnnotationScale(annotationScaleSelect.value);
  statusChip.textContent = `Масштаб аннотаций ${annotationScaleSelect.selectedOptions[0]?.textContent || "1:100"}`;
});

document.getElementById("undoButton").addEventListener("click", () => {
  const action = state.undo.pop();
  if (!action) return;
  if (action.type === "add") {
    state.entities = state.entities.filter((entity) => entity !== action.entity);
    state.redo.push(action);
    setSelection(state.entities.at(-1)?.id || null);
    markProjectDirty("undo-add");
    draw();
  } else if (action.type === "move") {
    const entity = state.entities.find((item) => item.id === action.entityId);
    applyEntityGeometry(entity, action.before);
    state.redo.push(action);
    setSelection(action.entityId);
    draw();
  } else if (action.type === "delete") {
    state.entities.splice(action.index, 0, action.entity);
    state.redo.push(action);
    setSelection(action.entity.id);
    markProjectDirty("undo-delete");
    draw();
  } else if (action.type === "delete-many") {
    for (const item of action.items) {
      state.entities.splice(item.index, 0, item.entity);
    }
    state.redo.push(action);
    setSelection(action.items.map((item) => item.entity.id));
    markProjectDirty("undo-delete-many");
    draw();
  }
});

document.addEventListener("focusin", (event) => {
  if (!keyboardInputs.includes(event.target)) return;
  shell.classList.add("input-focused");
  if (keyboardConfirmButton) keyboardConfirmButton.hidden = false;
  positionKeyboardConfirmButton();
});

document.getElementById("redoButton").addEventListener("click", () => {
  const action = state.redo.pop();
  if (!action) return;
  if (action.type === "add") {
    state.entities.push(action.entity);
    state.undo.push(action);
    setSelection(action.entity.id);
    markProjectDirty("redo-add");
    draw();
  } else if (action.type === "move") {
    const entity = state.entities.find((item) => item.id === action.entityId);
    applyEntityGeometry(entity, action.after);
    state.undo.push(action);
    setSelection(action.entityId);
    draw();
  } else if (action.type === "delete") {
    state.entities = state.entities.filter((entity) => entity !== action.entity);
    state.undo.push(action);
    setSelection(null);
    markProjectDirty("redo-delete");
    draw();
  } else if (action.type === "delete-many") {
    const ids = new Set(action.items.map((item) => item.entity.id));
    state.entities = state.entities.filter((entity) => !ids.has(entity.id));
    state.undo.push(action);
    setSelection(null);
    markProjectDirty("redo-delete-many");
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
        if (selected && !isLayerVisible(selected.layer)) setSelection(null);
      }
      draw();
      renderLayerList();
      markProjectDirty("layers");
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
window.addEventListener("beforeunload", flushProjectBeforeUnload);
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) normalizeDynamicText(node);
    normalizeTextNode(mutation.target);
  }
}).observe(document.body, { childList: true, characterData: true, subtree: true });
updateViewportLock();
setAnnotationScale(state.annotationScale, { save: false });
loadFurnitureLibrary();
prepareSelectMenuStructure();
setTool("select");
loadProjectFromServer();
window.zamerDebug = {
  exportDxf: () => buildDxf(state.entities),
  entityCount: () => state.entities.length,
  tool: () => state.tool,
  drawing: () => Boolean(state.drawing),
  recentEntities: (limit = 5) => state.entities.slice(-limit).map((entity) => ({
    id: entity.id,
    type: entity.type,
    layer: entity.layer,
  })),
  saveNow: saveProjectNow,
};

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

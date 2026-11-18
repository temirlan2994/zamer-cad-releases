import { requiresActivation, canStartGeometryDrag, activationGestureMode, canDragEntityDirectly } from "./core/interaction.js?v=225";
import { radToDeg, normalizeDegrees, normalizeAnglePositive, offsetWall, transformBlockPoint, distanceWorld, angleBetweenPoints, arcGeometry, segmentMetrics, normalizeScreenVector, entityBounds, pointInSelectionRect, rectEdges, segmentsIntersect, pointInPolygon, pointToSegmentDistance } from "./core/geometry.js?v=225";
import { entitySize, blockSegments } from "./core/blocks.js";
import { buildDxf, buildRevitDxf } from "./core/dxf.js";
import { angularDimensionGeometry, dimensionGeometry, formatDimensionLength } from "./core/dimensions.js";
import { constrainLinePoint, linePointWithConstraint, linePolarPoint, parseLineDecimal } from "./core/line-input.js";
import { extendLine, isLinePoint, isValidLine, joinLines, MAX_LINE_COORDINATE, mirrorLine, nearbyBoundaryPoints, nearbyIntersections, nearbyPerpendiculars, nearestBoundaryPoint, nearestIntersection, nearestPerpendicular, parallelLine, scaleLine, splitLine, trimLine } from "./core/line-edits.js";
import { filletLines } from "./core/line-fillet.js";
import { createPolyline, polylineBounds, polylineSegments, validPolylinePoints } from "./core/polyline.js";
import { buildPlotPdf, pdfPlotBounds } from "./core/pdf.js";
import { chooseProjectSource, projectRevision } from "./core/sync.js";
import { MAX_ZAMER_FILE_BYTES, validateZamerProject } from "./core/project-format.js";
import { describeSurveyRecord, normalizeSurvey, normalizeSurveyRecord, surveyMarkers, surveyNumber, surveyRoom } from "./core/survey.js";
import { bindSurveyPanel } from "./core/survey-panel.js";
import { createSurveyLaser } from "./core/survey-laser.js";
import { buildZip } from "./core/zip.js";


// Local vector icons share a 24px grid and never depend on platform emoji fonts.
function cadIcon(name) {
  const paths = {
    cursor: '<path d="m5 3 14 9-7 2-3 7Z"/>',
    back: '<path d="M19 12H5m7-7-7 7 7 7"/>',
    line: '<path d="m5 19 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
    dimension: '<path d="M4 5v14m16-14v14M4 12h16m-12-3-4 3 4 3m8-6 4 3-4 3"/>',
    text: '<path d="M5 5h14M12 5v15m-4 0h8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    file: '<path d="M14 3H6v18h12V7zM14 3v5h4M9 14h6m-3-3v6"/>',
    plan: '<path d="M3 3h18v18H3zM3 11h9V3m0 8v5m0 5v-2m3-8h6"/>',
    import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    export: '<path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    polyline: '<path d="m3 18 6-12 6 12 6-12"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    arc: '<path d="M3 18a9 9 0 0 1 18 0"/>',
    rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
    angle: '<path d="M4 4v16h16M4 13a7 7 0 0 1 7 7"/>',
    edit: '<path d="m4 16 12-12 4 4L8 20H4Zm10-10 4 4"/>',
    exit: '<path d="M10 4H4v16h6m5-12 4 4-4 4m-6-4h10"/>',
    update: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
  };
  return `<svg class="cad-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cursor}</svg>`;
}
function glyphIcon(glyph) {
  return cadIcon(({ '↖':'cursor', '╱':'line', '↔':'dimension', '⟷':'dimension', 'T':'text', '⌁':'polyline', '○':'circle', '⌒':'arc', '▭':'rectangle', '∠':'angle', '⊥':'dimension', '↗':'export', '▣':'rectangle', '+':'plus', '✎':'edit' })[glyph] || 'cursor');
}

const nativeApkMode = new URLSearchParams(window.location.search).get("apk") === "1" || Boolean(window.ZamerAndroid);
const nativeFetchDelegate = window.fetch.bind(window);
const apkProjectIndexKey = "zamer.apk.projects.v1";
const apkProjectPrefix = "zamer.apk.project.v1.";
const apkTrashPrefix = "zamer.apk.trash.v1.";
const apkUser = { id: "offline", login: "На телефоне" };

function apkSafeId(value, fallback = "") {
  const normalized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return normalized || fallback;
}

function apkReadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function apkProjectKey(projectId) {
  return `${apkProjectPrefix}${projectId}`;
}

function apkProjectMeta(project) {
  const entities = Array.isArray(project?.entities) ? project.entities : [];
  return {
    id: project.projectId,
    name: String(project.name || "Без названия").slice(0, 80),
    site: project.survey?.site || "",
    visitDate: project.survey?.visitDate || "",
    createdAt: project.createdAt,
    updatedAt: project.serverSavedAt || project.savedAt || project.updatedAt,
    revision: Math.max(1, Number(project.revision) || 1),
    entityCount: entities.length,
    thumbnail: project.thumbnail || null,
  };
}

function apkReadProjectIndex() {
  const indexed = apkReadJson(apkProjectIndexKey, []);
  return Array.isArray(indexed) ? indexed.filter((project) => project?.id) : [];
}

function apkWriteProjectIndex(projects) {
  localStorage.setItem(apkProjectIndexKey, JSON.stringify(projects));
}

function apkStoreProject(project) {
  localStorage.setItem(apkProjectKey(project.projectId), JSON.stringify(project));
  try {
    const projects = apkReadProjectIndex().filter((item) => item.id !== project.projectId);
    projects.unshift(apkProjectMeta(project));
    apkWriteProjectIndex(projects);
  } catch (error) {
    // The index is a hint. Reads can recover the saved project from its own key.
    console.warn("Project index update failed", error);
  }
  return project;
}

async function apkPersistProject(project) {
  try {
    return apkStoreProject(project);
  } catch (error) {
    if (!(await saveProjectToLocalStore(project, "device-storage", projectIdentity(project.projectId)))) throw error;
    return project;
  }
}

async function apkIndexedRecords(storeName, keysOnly = false) {
  try {
    const db = await openLocalProjectDb();
    if (!db?.objectStoreNames.contains(storeName)) return [];
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const [records] = await Promise.all([idbRequest(keysOnly ? store.getAllKeys() : store.getAll()), idbTransactionDone(transaction)]);
    return records;
  } catch (error) {
    console.warn("Cannot read local snapshots", error);
    return [];
  }
}

function apkStorageKeys() {
  try { return Object.keys(localStorage); } catch { return []; }
}

async function apkArchivedProjectIds() {
  const ids = await apkIndexedRecords("trash", true);
  const legacy = apkStorageKeys().filter((key) => key.startsWith(apkTrashPrefix)).map((key) => key.slice(apkTrashPrefix.length));
  return new Set([...ids, ...legacy].map((key) => key.slice(0, key.lastIndexOf("."))));
}

async function apkReadTrash() {
  const entries = new Map((await apkIndexedRecords("trash")).map((entry) => [entry.id, entry]));
  for (const key of apkStorageKeys()) {
    if (!key.startsWith(apkTrashPrefix)) continue;
    const project = apkReadJson(key, null);
    if (!project?.projectId) continue;
    const id = key.slice(apkTrashPrefix.length);
    if (!entries.has(id)) entries.set(id, { id, project, deletedAt: Number(id.split(".").at(-1)) || 0, legacy: true });
  }
  return [...entries.values()].sort((a, b) => b.deletedAt - a.deletedAt);
}

async function apkListProjects() {
  const stored = new Map();
  for (const project of await apkIndexedRecords("projects")) {
    if (project.clientId === apkUser.id && project.projectId) stored.set(project.projectId, project);
  }
  for (const key of apkStorageKeys()) {
    if (!key.startsWith(apkProjectPrefix) && !key.startsWith(`zamer.project.${apkUser.id}.`)) continue;
    const project = apkReadJson(key, null);
    if (project?.projectId) stored.set(project.projectId, newestProject(stored.get(project.projectId), project));
  }
  const archived = await apkArchivedProjectIds();
  const indexed = new Map(apkReadProjectIndex().map((meta) => [meta.id, meta]));
  for (const project of stored.values()) indexed.set(project.projectId, apkProjectMeta(project));
  return [...indexed.values()].filter((meta) => !archived.has(meta.id))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}

async function apkArchiveProject(project, identity) {
  const deletedAt = Date.now();
  const id = `${project.projectId}.${deletedAt}`;
  await persistence.localWriteChain.catch(() => {});
  try {
    const db = await openLocalProjectDb();
    if (!db) throw new Error("IndexedDB is unavailable");
    const transaction = db.transaction(["trash", "projects"], "readwrite");
    transaction.objectStore("trash").put({ id, project, deletedAt });
    transaction.objectStore("projects").delete(projectStorageId(identity));
    await idbTransactionDone(transaction);
  } catch (error) {
    localStorage.setItem(`${apkTrashPrefix}${id}`, JSON.stringify(project));
  }
  try {
    localStorage.removeItem(apkProjectKey(project.projectId));
    localStorage.removeItem(localProjectFallbackKey(identity));
    apkWriteProjectIndex(apkReadProjectIndex().filter((item) => item.id !== project.projectId));
  } catch (error) {
    console.warn("Project index update failed", error);
  }
}

async function apkRestoreTrash(id) {
  const entry = (await apkReadTrash()).find((item) => item.id === id);
  if (!entry) return null;
  const original = entry.project;
  const oldId = apkSafeId(original.projectId);
  const primary = apkReadJson(apkProjectKey(oldId), null);
  if (entry.legacy) {
    const occupied = primary || await loadProjectFromLocalStore(projectIdentity(oldId));
    const project = await apkPersistProject(apkCreateProject({ id: occupied ? "" : oldId, name: original.name, project: original }));
    localStorage.removeItem(`${apkTrashPrefix}${id}`);
    return project;
  }
  const db = await openLocalProjectDb();
  const transaction = db.transaction(["trash", "projects"], "readwrite");
  const completed = idbTransactionDone(transaction);
  completed.catch(() => {});
  const trash = transaction.objectStore("trash");
  const live = transaction.objectStore("projects");
  const [stillArchived, existing] = await Promise.all([
    idbRequest(trash.get(id)), idbRequest(live.get(projectStorageId(projectIdentity(oldId)))),
  ]);
  if (!stillArchived) {
    await completed;
    return null;
  }
  const project = apkCreateProject({ id: primary || existing ? "" : oldId, name: original.name, project: original });
  live.put({ ...project, storageId: projectStorageId(projectIdentity(project.projectId)), localSavedAt: project.savedAt });
  trash.delete(id);
  await completed;
  try {
    apkStoreProject(project);
  } catch (error) {
    console.warn("The restored project is in IndexedDB", error);
  }
  return project;
}

function apkCreateProject(body = {}) {
  const now = new Date().toISOString();
  const source = body.project && typeof body.project === "object" ? body.project : {};
  const projectId = apkSafeId(body.id, `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return {
    version: 2,
    clientId: apkUser.id,
    projectId,
    name: String(body.name || source.name || "Новый замер").slice(0, 80),
    createdAt: source.createdAt || now,
    updatedAt: now,
    savedAt: now,
    serverSavedAt: now,
    revision: 1,
    baseRevision: 1,
    syncPending: false,
    theme: source.theme === "dark" ? "dark" : "light",
    view: source.view || { scale: 0.085, panX: 92, panY: 84 },
    snaps: Array.isArray(source.snaps) ? source.snaps : ["grid", "end", "polar"],
    polarStep: [5, 15, 30, 45, 90].includes(source.polarStep) ? source.polarStep : 5,
    visibleLayers: Array.isArray(source.visibleLayers) ? source.visibleLayers : ["walls", "dimensions", "furniture", "measure"],
    annotationScale: Number.isFinite(source.annotationScale) ? source.annotationScale : 1,
    selectionFilter: source.selectionFilter || "all",
    survey: normalizeSurvey(source.survey),
    draft: source.draft,

    entities: Array.isArray(source.entities) ? source.entities : [],
    thumbnail: source.thumbnail || null,
  };
}

function apkJsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function apkRequestBody(resource, options, method) {
  if (["GET", "HEAD"].includes(method)) return {};
  const body = options?.body;
  if (typeof body === "string") return JSON.parse(body || "{}");
  if (body instanceof Blob) return JSON.parse(await body.text());
  if (resource instanceof Request) return JSON.parse(await resource.clone().text() || "{}");
  return body && typeof body === "object" ? body : {};
}

async function apkOfflineFetch(resource, options = {}) {
  const requestUrl = new URL(resource instanceof Request ? resource.url : String(resource), window.location.href);
  if (!nativeApkMode || !requestUrl.pathname.startsWith("/api/")) return nativeFetchDelegate(resource, options);
  const method = String(options.method || (resource instanceof Request ? resource.method : "GET")).toUpperCase();
  try {
    if (requestUrl.pathname === "/api/health") return apkJsonResponse(200, { ok: true, storage: "phone" });
    if (requestUrl.pathname === "/api/auth/status") return apkJsonResponse(200, { ok: true, user: apkUser, offline: true });
    if (requestUrl.pathname === "/api/auth/logout") return apkJsonResponse(200, { ok: true, user: apkUser, offline: true });
    if (["/api/auth/login", "/api/auth/register", "/api/auth/dev"].includes(requestUrl.pathname)) {
      return apkJsonResponse(200, { ok: true, user: apkUser, offline: true });
    }

    if (requestUrl.pathname === "/api/projects" && method === "GET") {
      return apkJsonResponse(200, { ok: true, client: apkUser.id, projects: await apkListProjects() });
    }
    if (requestUrl.pathname === "/api/projects" && method === "POST") {
      const body = await apkRequestBody(resource, options, method);
      const nextProject = apkCreateProject(body);
      if (body.id) {
        const identity = projectIdentity(nextProject.projectId);
        if (apkReadJson(apkProjectKey(identity.projectId), null) || await loadProjectFromLocalStore(identity) ||
            (await apkArchivedProjectIds()).has(identity.projectId)) {
          return apkJsonResponse(409, { ok: false, error: "Такой проект уже существует" });
        }
      }
      const project = await apkPersistProject(nextProject);
      return apkJsonResponse(200, { ok: true, client: apkUser.id, project, meta: apkProjectMeta(project) });
    }
    if (requestUrl.pathname === "/api/trash" && method === "GET") {
      const entries = (await apkReadTrash()).map((entry) => ({ ...apkProjectMeta(entry.project), id: entry.id, deletedAt: entry.deletedAt }));
      return apkJsonResponse(200, { ok: true, entries });
    }
    if (requestUrl.pathname === "/api/trash/restore" && method === "POST") {
      const body = await apkRequestBody(resource, options, method);
      const project = await apkRestoreTrash(body.id);
      return project ? apkJsonResponse(200, { ok: true, project }) : apkJsonResponse(404, { ok: false, error: "Проект в корзине не найден" });
    }

    const match = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)$/);
    const projectId = match ? apkSafeId(decodeURIComponent(match[1]), "") : "";
    if (!projectId) return apkJsonResponse(404, { ok: false, error: "Project not found" });
    if ((await apkArchivedProjectIds()).has(projectId)) {
      return apkJsonResponse(410, { ok: false, error: "Проект в корзине", projectId });
    }
    const identity = projectIdentity(projectId);
    const primary = apkReadJson(apkProjectKey(projectId), null);
    const local = await loadProjectFromLocalStore(identity);
    const current = chooseProjectSource(local, primary).project;

    if (method === "GET") {
      return current
        ? apkJsonResponse(200, { ok: true, client: apkUser.id, projectId, project: current })
        : apkJsonResponse(404, { ok: false, error: "Project not found", projectId });
    }
    if (method === "DELETE") {
      if (!current) return apkJsonResponse(404, { ok: false, error: "Проект не найден" });
      await apkArchiveProject(current, identity);
      return apkJsonResponse(200, { ok: true, client: apkUser.id, projectId, recoverable: true });
    }
    if ((method === "PUT" || method === "POST") && current) {
      const body = await apkRequestBody(resource, options, method);
      if (body.projectId != null && body.projectId !== projectId) {
        return apkJsonResponse(409, { ok: false, error: "Идентификатор проекта не совпадает" });
      }
      const now = new Date().toISOString();
      const revision = Math.max(1, projectRevision(primary), projectRevision(local)) + 1;
      const project = await apkPersistProject({
        ...body,
        clientId: apkUser.id,
        projectId,
        name: String(body.name || current.name || "Без названия").slice(0, 80),
        createdAt: body.createdAt || current.createdAt || now,
        updatedAt: now,
        savedAt: now,
        serverSavedAt: now,
        revision,
        baseRevision: revision,
        syncPending: false,
      });
      return apkJsonResponse(200, { ok: true, client: apkUser.id, projectId, revision, savedAt: now, meta: apkProjectMeta(project) });
    }
    return apkJsonResponse(current ? 405 : 404, { ok: false, error: current ? "Method not allowed" : "Project not found" });
  } catch (error) {
    console.error("Offline APK storage failed", error);
    return apkJsonResponse(507, { ok: false, error: "Не удалось сохранить проект в памяти телефона" });
  }
}

if (nativeApkMode) {
  document.documentElement.dataset.nativeApk = "true";
  window.fetch = apkOfflineFetch;
}

const canvas = document.getElementById("cadCanvas");
let ctx = canvas.getContext("2d");
let printRendering = false;
const viewportTools = document.getElementById("viewportTools");
const viewportSummary = viewportTools.querySelector("summary");
const viewportPlaceButton = viewportTools.querySelector('[data-view-action="place"]');
const viewportActionStatus = document.getElementById("viewportActionStatus");
const shell = document.querySelector(".app-shell");
const centerCursor = document.querySelector(".center-cursor");
const authScreen = document.getElementById("authScreen");
const authForm = document.getElementById("authForm");
const authLoginInput = document.getElementById("authLoginInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authSubmitButton = document.getElementById("authSubmitButton");
const authDevButton = document.getElementById("authDevButton");
const authModeButton = document.getElementById("authModeButton");
const authError = document.getElementById("authError");
const projectHome = document.getElementById("projectHome");
const projectList = document.getElementById("projectList");
const projectSearchInput = document.getElementById("projectSearchInput");
const createProjectButton = document.getElementById("createProjectButton");
const createBlankProjectButton = document.getElementById("createBlankProjectButton");
const projectImportInput = document.getElementById("projectImportInput");
const projectTrashButton = document.getElementById("projectTrashButton");
const projectListHeading = document.getElementById("projectListHeading");
const projectHomeStatus = document.getElementById("projectHomeStatus");
const installAppButton = document.getElementById("installAppButton");
const refreshProjectsButton = document.getElementById("refreshProjectsButton");
const accountBadge = document.getElementById("accountBadge");
const logoutButton = document.getElementById("logoutButton");
const backToProjectsButton = document.getElementById("backToProjectsButton");
const projectNameCaption = document.querySelector(".project-title strong");
const projectScaleCaption = document.querySelector(".project-title span");
const tools = [...document.querySelectorAll(".tool[data-tool]")];
const figureToolButton = document.getElementById("figureToolButton");
const gridStepReadout = document.getElementById("gridStepReadout");
const drawToolMenu = document.getElementById("drawToolMenu");
const drawToolButtons = [...document.querySelectorAll("[data-draw-tool]")];
const dimensionToolMenu = createDimensionToolMenu();
const dimensionToolButtons = [...dimensionToolMenu.querySelectorAll("[data-dimension-tool]")];
const annotationToolMenu = createAnnotationToolMenu();
const annotationToolButtons = [...annotationToolMenu.querySelectorAll("[data-annotation-tool]")];
const selectToolMenu = document.getElementById("selectToolMenu");
const selectModeMenu = createSelectModeMenu();
const selectToolButtons = [...document.querySelectorAll("[data-select-tool]")];
const snaps = [...document.querySelectorAll(".snap")];
const lineUi = Object.fromEntries([
  "lineBoundaryMode", "lineBoundaryControl", "lineBreakMode", "lineBreakControl", "lineEditApply", "linePolarStep",
  "lineEditOptions", "lineEditHint", "lineEditRadiusControl", "lineEditRadius", "lineEditForm",
  "lineLengthMode", "lineLengthInput", "lineEditCancel", "lineEditFinish", "lineMirrorControl", "lineMirrorDelete",
].map((id) => [id, document.getElementById(id)]));
const lineKeyboardInputs = [lineUi.lineLengthInput, lineUi.lineEditRadius];
const lineEditActions = new Set(["trim", "extend", "break", "join", "lengthen", "fillet", "scale"]);
const lineOnlyEditActions = new Set([...lineEditActions, "offset", "mirror"]);
const lineQuantityModes = {
  lengthen: [["total", "Длина (мм)"], ["delta", "Прирост (мм)"], ["percent", "Длина (%)"], ["dynamic", "По точке"]],
  offset: [["distance", "Расстояние (мм)"], ["through", "Через точку"]],
  scale: [["factor", "Коэффициент"]],
};
const linePointEpsilon = 1e-6;
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
const keyboardConfirmButton = document.getElementById("keyboardConfirmButton");
const themeButton = document.getElementById("themeButton");
const annotationScaleSelect = document.getElementById("annotationScaleSelect");
const statusChip = document.getElementById("statusChip");
const dimensionAssist = document.getElementById("dimensionAssist");
const linePointAssist = document.getElementById("linePointAssist");
const lineDirection = document.getElementById("lineDirection");
const lineDirectionArrow = document.getElementById("lineDirectionArrow");
const lineDirectionDescription = document.getElementById("lineDirectionDescription");
const lineSkipSnap = document.getElementById("lineSkipSnap");
const lineDirections = ["вправо", "вправо вниз", "вниз", "влево вниз", "влево", "влево вверх", "вверх", "вправо вверх"];
const dimensionNextSnap = document.getElementById("dimensionNextSnap");
const dimensionAxisControl = document.getElementById("dimensionAxisControl");
const dimensionAxis = document.getElementById("dimensionAxis");
const dimensionLinks = document.getElementById("dimensionLinks");
const dimensionLinkCancel = document.getElementById("dimensionLinkCancel");
const dimensionLinkButtons = [...dimensionLinks.querySelectorAll("[data-dimension-anchor]")];
const saveIndicator = document.getElementById("saveIndicator");
const layersSheet = document.getElementById("layersSheet");
const exportSheet = document.getElementById("exportSheet");
const layerList = document.getElementById("layerList");
const exportCards = [...document.querySelectorAll(".export-card")];
const keyboardInputs = [lengthInput, angleInput, topLengthInput, topAngleInput].filter(Boolean);
let lastNumericInput = null;
const lineMetricKinds = new Map([[lengthInput, "length"], [angleInput, "angle"], [topLengthInput, "length"], [topAngleInput, "angle"]]);
let stableViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 844);
const cp1251Chars =
  "\u0402\u0403\u201A\u0453\u201E\u2026\u2020\u2021\u20AC\u2030\u0409\u2039\u040A\u040C\u040B\u040F" +
  "\u0452\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u0098\u2122\u0459\u203A\u045A\u045C\u045B\u045F" +
  "\u00A0\u040E\u045E\u0408\u00A4\u0490\u00A6\u00A7\u0401\u00A9\u0404\u00AB\u00AC\u00AD\u00AE\u0407" +
  "\u00B0\u00B1\u0406\u0456\u0491\u00B5\u00B6\u00B7\u0451\u2116\u0454\u00BB\u0458\u0405\u0455\u0457" +
  "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ" +
  "абвгдежзийклмнопрстуфхцчшщъыьэюя";
const cp1251ByteByChar = new Map([...cp1251Chars].map((char, index) => [char, index + 0x80]));
const trackingHoverDelayMs = 1000;
const trackingMaxPoints = 3;
const trackingAngles = [0, Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4];
const groupedDrawTools = new Set(["line", "polyline", "circle", "arc", "rectangle"]);
const trackingDrawingTools = new Set(["line", "polyline", "circle", "arc", "rectangle"]);
const drawToolButtonVisuals = {
  line: { icon: "╱", label: "Линия" },
  polyline: { icon: "⌁", label: "Полилиния" },
  circle: { icon: "○", label: "Круг" },
  arc: { icon: "⌒", label: "Дуга" },
  rectangle: { icon: "▭", label: "Прямоуг." },
};
const dimensionToolButtonVisuals = {
  aligned: { icon: "↔", label: "По отрезку" },
  linear: { icon: "⟷", label: "По оси" },
  angular: { icon: "∠", label: "Угол" },
  baseline: { icon: "⊥", label: "От базы" },
};
const annotationToolButtonVisuals = {
  text: { icon: "T", label: "Текст" },
  leader: { icon: "↗", label: "Выноска" },
};
const selectModeButtonVisuals = {
  select: { icon: "↖", label: "ESC" },
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
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Виды размеров");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" data-dimension-tool="aligned" aria-label="Размер по отрезку"><span aria-hidden="true">&#8596;</span><small>По отрезку</small></button>
    <button type="button" data-dimension-tool="linear" aria-label="Размер по горизонтали или вертикали"><span aria-hidden="true">&#10231;</span><small>По оси</small></button>
    <button type="button" data-dimension-tool="angular" aria-label="Угол между сторонами"><span aria-hidden="true">&#8736;</span><small>Угол</small></button>
    <button type="button" data-dimension-tool="baseline" aria-label="Несколько размеров от общей точки"><span aria-hidden="true">&#8869;</span><small>От базы</small></button>
  `;
  document.querySelector(".workspace")?.append(menu);
  return menu;
}

function createAnnotationToolMenu() {
  const menu = document.createElement("div");
  menu.className = "draw-tool-menu annotation-tool-menu";
  menu.id = "annotationToolMenu";
  menu.hidden = true;
  menu.innerHTML = `
    <button data-annotation-tool="text"><span>T</span><small>Текст</small></button>
    <button data-annotation-tool="leader"><span>&#8599;</span><small>Выноска</small></button>
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
const selectionFilters = ["all", "lines", "dimensions"];

let surveyPanel = null;
let surveyPointPicker = null;

const state = {
  survey: normalizeSurvey(null),
  theme: "light",
  directManipulationIds: new Set(),
  tool: "select",
  drawTool: "line",
  dimensionTool: "aligned",
  annotationScale: 1,
  selectTool: "select",
  selectionFilter: "all",

  view: {
    scale: 0.085,
    panX: 92,
    panY: 84,
  },
  drawing: null,
  moveCommand: null,
  offsetCommand: null,
  lineEdit: null,
  skipLineObjectSnap: false,
  pointer: null,
  activePointers: new Map(),
  pinch: null,
  gestureSuppressTap: false,
  inlineEdit: null,
  circleRadiusEdit: null,
  dimensionSnapHint: null,
  dimensionSnapChoice: null,
  dimensionAttach: null,
  polarSnapGuide: null,
  dimensionPickCycle: null,
  lastTextTap: null,
  snapTracking: {
    points: [],
    hoverKey: null,
    hoverPoint: null,
    hoverTimer: null,
    active: null,
  },

  numericEdit: null,
  selectedId: null,
  selectedIds: [],
  selectedEndpoint: null,
  endpointEditBefore: null,
  selectionDrag: null,
  openEditMenuAfterPointer: false,
  undo: [],
  redo: [],
  snaps: new Set(["grid", "end", "polar"]),
  polarStep: 5,
  visibleLayers: new Set(["walls", "dimensions", "furniture", "measure"]),
  entities: [],
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

function lockPortraitOrientation() {
  const lock = screen.orientation?.lock;
  if (typeof lock !== "function") return;
  lock.call(screen.orientation, "portrait").catch(() => {
    // Mobile browsers allow hard orientation lock mainly in installed/fullscreen PWAs.
  });
}

function wall(id, x1, y1, x2, y2) {
  return { id, type: "wall", layer: "walls", x1, y1, x2, y2, width: 180 };
}

function line(id, x1, y1, x2, y2, layer = "measure") {
  return { id, type: "line", layer, x1, y1, x2, y2 };
}

function textEntity(id, x, y, text, height = 260, rotation = 0) {
  return { id, type: "text", layer: "dimensions", x, y, text: text || "Текст", height, rotation };
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

function block(id, kind, x, y, rotation, size) {
  return { id, type: "block", layer: "furniture", kind, x, y, rotation, scale: 1, flipX: false, width: size.width, height: size.height };
}

const persistence = {
  clientId: getProjectClientId(),
  projectId: "",
  projectName: "",
  projectCreatedAt: "",
  revision: 0,
  debounceMs: 250,
  localDebounceMs: 80,
  retryMs: 1600,
  localDbName: "zamer-cad-projects",
  localDbVersion: 3,
  localVersionLimit: 20,
  ready: false,
  dirty: false,
  savePromise: null,
  saveIdentity: null,
  projectSession: 0,
  openRequest: 0,
  showingTrash: false,
  trash: [],
  restoring: false,
  timer: null,
  localTimer: null,
  statusTimer: null,
  dbPromise: null,
  localWriteChain: Promise.resolve(),
  lastHash: "",
  pendingSaveId: "",
  pendingSnapshot: "",
  needsRemoteSync: false,
  projects: [],
};

const authState = {
  mode: "login",
  user: null,
  busy: false,
  checkTimer: null,
  checkIntervalMs: 5000,
};

const installState = {
  promptEvent: null,
  installed: nativeApkMode || window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true,
};

function authEndpoint(action) {
  if (window.location.protocol === "file:") return `http://127.0.0.1:4187/api/auth/${action}`;
  return `/api/auth/${action}`;
}

function projectsEndpoint(clientId = persistence.clientId) {
  return `/api/projects?client=${encodeURIComponent(clientId)}`;
}

function projectEndpoint(projectId = persistence.projectId) {
  return `/api/projects/${encodeURIComponent(projectId)}?client=${encodeURIComponent(persistence.clientId)}`;
}

function updateSaveIndicator(stateName, text, options = {}) {
  if (!saveIndicator) return;
  window.clearTimeout(persistence.statusTimer);
  saveIndicator.dataset.state = stateName;
  saveIndicator.textContent = text;
  if (options.autoDim) {
    persistence.statusTimer = window.setTimeout(() => {
      if (!saveIndicator || saveIndicator.dataset.state !== stateName) return;
      saveIndicator.dataset.state = "idle";
    }, options.autoDim);
  }
}

function projectSavedTime(project) {
  return Date.parse(project?.serverSavedAt || project?.savedAt || project?.localSavedAt || "") || 0;
}

function newestProject(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const timeDiff = projectSavedTime(b) - projectSavedTime(a);
  return (timeDiff || projectRevision(b) - projectRevision(a)) > 0 ? b : a;
}

function projectIdentity(projectId = persistence.projectId) {
  return { clientId: persistence.clientId, projectId, endpoint: projectId ? projectEndpoint(projectId) : "", session: persistence.projectSession };
}

function isActiveProject(identity) {
  return persistence.projectSession === identity.session && persistence.projectId === identity.projectId && persistence.clientId === identity.clientId;
}

function localProjectFallbackKey(identity) {
  return `zamer.project.${identity.clientId}.${identity.projectId}`;
}

function projectStorageId(identity) {
  return `${identity.clientId}:${identity.projectId}`;
}

function writeEmergencyLocalBackup(project, identity = projectIdentity()) {
  try {
    localStorage.setItem(localProjectFallbackKey(identity), JSON.stringify(project));
    return true;
  } catch (error) {
    console.warn("Emergency local backup failed", error);
    return false;
  }
}

function readEmergencyLocalBackup(identity) {
  try {
    const raw = localStorage.getItem(localProjectFallbackKey(identity));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function idbTransactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

function openLocalProjectDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (persistence.dbPromise) return persistence.dbPromise;
  const opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(persistence.localDbName, persistence.localDbVersion);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "storageId" });
      } else {
        const oldStore = request.transaction.objectStore("projects");
        if (oldStore.keyPath !== "storageId") {
          const oldRecords = oldStore.getAll();
          oldRecords.onsuccess = () => {
            db.deleteObjectStore("projects");
            const projects = db.createObjectStore("projects", { keyPath: "storageId" });
            for (const project of oldRecords.result) {
              const identity = { clientId: project.clientId, projectId: project.projectId || "legacy" };
              projects.put({ ...project, ...identity, storageId: projectStorageId(identity) });
            }
          };
        }
      }
      if (!db.objectStoreNames.contains("trash")) db.createObjectStore("trash", { keyPath: "id" });
      if (!db.objectStoreNames.contains("versions")) {
        const versions = db.createObjectStore("versions", { keyPath: "id", autoIncrement: true });
        versions.createIndex("projectId", "projectId", { unique: false });
        versions.createIndex("savedAt", "savedAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        persistence.dbPromise = null;
      };
      resolve(db);
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("IndexedDB upgrade blocked"));
    };
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB"));
  });
  persistence.dbPromise = opening;
  opening.catch(() => {
    if (persistence.dbPromise === opening) persistence.dbPromise = null;
  });
  return opening;
}

async function trimLocalProjectVersions(storageId) {
  const db = await openLocalProjectDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("versions", "readwrite");
    const store = transaction.objectStore("versions");
    const index = store.index("projectId");
    let kept = 0;
    const request = index.openCursor(IDBKeyRange.only(storageId), "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      kept += 1;
      if (kept > persistence.localVersionLimit) store.delete(cursor.primaryKey);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Version cleanup aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("Version cleanup failed"));
  });
}

async function saveLocalProjectVersion(db, storageId, savedAt, reason, project) {
  const transaction = db.transaction("versions", "readwrite");
  const store = transaction.objectStore("versions");
  const last = store.index("projectId").openCursor(IDBKeyRange.only(storageId), "prev");
  last.onsuccess = () => {
    const cursor = last.result;
    const previous = cursor?.value.project;
    const sameSnapshot = previous && (project.clientSaveId
      ? previous.clientSaveId === project.clientSaveId
      : !previous.clientSaveId && projectRevision(previous) === projectRevision(project));
    const version = { projectId: storageId, savedAt, reason, project };
    if (sameSnapshot) cursor.update({ ...version, id: cursor.primaryKey });
    else store.add(version);
  };
  await idbTransactionDone(transaction);
  await trimLocalProjectVersions(storageId);
}

async function readLocalVersionHistory(identity) {
  const db = await openLocalProjectDb();
  if (!db) return [];
  const transaction = db.transaction("versions", "readonly");
  const index = transaction.objectStore("versions").index("projectId");
  const versions = [];
  const seen = new Set();
  const request = index.openCursor(IDBKeyRange.only(projectStorageId(identity)), "prev");
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const { id, project, savedAt } = cursor.value;
    if (Array.isArray(project?.entities)) {
      const saveKey = project.clientSaveId || `revision-${projectRevision(project)}`;
      if (!seen.has(saveKey)) {
        versions.push({ id, savedAt, entityCount: project.entities.length });
        seen.add(saveKey);
      }
    }
    if (versions.length < persistence.localVersionLimit) cursor.continue();
  };
  await idbTransactionDone(transaction);
  return versions;
}

async function readLocalProjectVersion(identity, id) {
  const db = await openLocalProjectDb();
  if (!db) return null;
  const transaction = db.transaction("versions", "readonly");
  const [version] = await Promise.all([
    idbRequest(transaction.objectStore("versions").get(Number(id))), idbTransactionDone(transaction),
  ]);
  return version?.projectId === projectStorageId(identity) ? version.project : null;
}

function saveProjectToLocalStore(project, reason = "change", identity = projectIdentity()) {
  if (!identity.projectId) return Promise.resolve(false);
  const savedAt = project.savedAt || new Date().toISOString();
  const storageId = projectStorageId(identity);
  const localProject = { ...project, storageId, clientId: identity.clientId, projectId: identity.projectId, savedAt, localSavedAt: savedAt };
  const emergencySaved = writeEmergencyLocalBackup(localProject, identity);
  const write = async () => {
    try {
      const db = await openLocalProjectDb();
      if (!db) return emergencySaved;
      const transaction = db.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(localProject);
      await idbTransactionDone(transaction);
      saveLocalProjectVersion(db, storageId, savedAt, reason, localProject).catch((error) => console.warn("Project history write failed", error));
      return true;
    } catch (error) {
      console.warn("IndexedDB save failed", error);
      return emergencySaved;
    }
  };
  const queued = persistence.localWriteChain.catch(() => {}).then(write);
  persistence.localWriteChain = queued;
  return queued;
}

async function loadProjectFromLocalStore(identity = projectIdentity()) {
  if (!identity.projectId) return null;
  const fallbackProject = readEmergencyLocalBackup(identity);
  try {
    const db = await openLocalProjectDb();
    if (!db) return fallbackProject;
    const transaction = db.transaction("projects", "readonly");
    const [indexedProject] = await Promise.all([
      idbRequest(transaction.objectStore("projects").get(projectStorageId(identity))), idbTransactionDone(transaction),
    ]);
    return newestProject(fallbackProject, indexedProject);
  } catch (error) {
    console.warn("Local project restore failed", error);
    return fallbackProject;
  }
}

function getProjectClientId() {
  try {
    const urlClient = new URLSearchParams(window.location.search).get("client");
    if (/^[a-zA-Z0-9_-]{8,80}$/.test(urlClient || "")) return urlClient;
  } catch {
    // Fall back to the device-local client id below.
  }
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

function updateProjectTitle() {
  if (projectNameCaption) projectNameCaption.textContent = persistence.projectName || "Проекты";
  if (projectScaleCaption) {
    const label = annotationScaleSelect?.selectedOptions?.[0]?.textContent || "1:100";
    projectScaleCaption.textContent = persistence.projectId ? `MM - ${label}` : "Выберите файл";
  }
}

function setProjectHomeVisible(visible) {
  if (!projectHome) return;
  projectHome.hidden = !visible;
  shell.classList.toggle("project-home-open", visible);
  syncEditorAccessibility();
  if (!visible && authScreen.hidden) backToProjectsButton?.focus({ preventScroll: true });
}

function setAuthScreenVisible(visible) {
  if (!authScreen) return;
  authScreen.hidden = !visible;
  shell.classList.toggle("auth-open", visible);
  syncEditorAccessibility();
  if (visible) requestAnimationFrame(() => authLoginInput?.focus());
}

function syncEditorAccessibility() {
  const authVisible = !authScreen.hidden;
  const editorBlocked = authVisible || !projectHome.hidden;
  projectHome.inert = authVisible;
  for (const element of shell.querySelectorAll(":scope > .topbar, :scope > .snap-panel, :scope > .workspace, :scope > .bottom-sheet")) {
    element.inert = editorBlocked;
  }
}

function setAuthError(message = "") {
  if (authError) authError.textContent = message;
}

function renderAuthUi() {
  const isRegister = authState.mode === "register";
  if (authScreen) {
    const title = authScreen.querySelector("h1");
    const text = authScreen.querySelector("p");
    if (title) title.textContent = isRegister ? "Создать аккаунт" : "Вход в аккаунт";
    if (text) {
      text.textContent = isRegister
        ? "Создайте логин и пароль. Все новые чертежи будут храниться отдельно в этом аккаунте."
        : "Ваши чертежи будут храниться внутри аккаунта и не смешиваться с другими пользователями.";
    }
  }
  if (authPasswordInput) authPasswordInput.autocomplete = isRegister ? "new-password" : "current-password";
  if (authSubmitButton) authSubmitButton.textContent = authState.busy ? "Проверяю..." : isRegister ? "Создать аккаунт" : "Войти";
  if (authModeButton) authModeButton.textContent = isRegister ? "У меня уже есть аккаунт" : "Создать аккаунт";
  if (authSubmitButton) authSubmitButton.disabled = authState.busy;
  if (authDevButton) authDevButton.disabled = authState.busy;
  if (authModeButton) authModeButton.disabled = authState.busy;
  if (accountBadge) {
    accountBadge.hidden = !authState.user;
    accountBadge.textContent = nativeApkMode ? "Офлайн · сохранение на телефоне" : (authState.user ? `Аккаунт: ${authState.user.login}` : "");
  }
  if (logoutButton) logoutButton.hidden = nativeApkMode || !authState.user;
}

function resetProjectSession() {
  persistence.projectSession += 1;
  persistence.openRequest += 1;
  window.clearTimeout(persistence.timer);
  window.clearTimeout(persistence.localTimer);
  persistence.timer = null;
  persistence.localTimer = null;
  persistence.projectId = "";
  persistence.projectName = "";
  persistence.projectCreatedAt = "";
  persistence.revision = 0;
  persistence.ready = false;
  persistence.dirty = false;
  persistence.needsRemoteSync = false;
  persistence.pendingSaveId = "";
  persistence.pendingSnapshot = "";
  persistence.projects = [];
  persistence.showingTrash = false;
  persistence.trash = [];
  setSelection([]);
  state.drawing = null;
  state.skipLineObjectSnap = false;
  state.command = null;
  state.lineEdit = null;
  closeLineMetricInput();
  state.moveCommand = null;
  state.offsetCommand = null;
  state.inlineEdit = null;
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  updateProjectTitle();
  renderProjectList();
}

function setAuthenticatedUser(user) {
  authState.user = user || null;
  if (user?.id) {
    persistence.clientId = user.id;
  }
  renderAuthUi();
}

function stopAuthMonitor() {
  window.clearInterval(authState.checkTimer);
  authState.checkTimer = null;
}

function startAuthMonitor() {
  stopAuthMonitor();
  if (!authState.user) return;
  authState.checkTimer = window.setInterval(checkActiveSession, authState.checkIntervalMs);
}

async function forceAuthLogout(message = "Войдите") {
  const identity = projectIdentity();
  while (persistence.ready && identity.projectId && isActiveProject(identity)) {
    const snapshot = projectSnapshotKey();
    if (!persistence.dirty && snapshot === persistence.lastHash) break;
    const saveId = clientSaveIdForSnapshot(snapshot);
    const saved = await saveProjectToLocalStore(serializeProject({ syncPending: true, clientSaveId: saveId }, snapshot), "session-ended", identity);
    if (!isActiveProject(identity)) return saved;
    if (!saved) {
      updateSaveIndicator("error", "Не удалось записать чертёж");
      return false;
    }
    if (projectSnapshotKey() === snapshot) break;
  }
  stopAuthMonitor();
  authState.mode = "login";
  setAuthenticatedUser(null);
  resetProjectSession();
  setProjectHomeVisible(false);
  setAuthScreenVisible(true);
  updateSaveIndicator("idle", "Войдите");
  setAuthError(message);
  return true;
}

async function checkActiveSession() {
  if (!authState.user || document.hidden) return;
  const originalUser = authState.user;
  try {
    const payload = await fetchAuthJson("status");
    if (authState.user !== originalUser) return;
    if (!payload.user) {
      await forceAuthLogout("Аккаунт открыт на другом устройстве. Войдите снова.");
      return;
    }
    if (payload.user.id !== authState.user.id) {
      await forceAuthLogout("Сессия изменилась. Войдите снова.");
    }
  } catch (error) {
    console.warn("Auth monitor failed", error);
  }
}

async function fetchAuthJson(action, options = {}) {
  let response;
  try {
    response = await fetch(authEndpoint(action), {
      cache: "no-store",
      credentials: window.location.protocol === "file:" ? "include" : "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error("Не удалось подключиться к серверу входа. Обновите страницу или откройте http://127.0.0.1:4187/");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Ошибка аккаунта");
  return payload;
}

async function initAuthGate() {
  setAuthScreenVisible(true);
  setProjectHomeVisible(false);
  updateSaveIndicator("idle", "Войдите");
  renderAuthUi();
  try {
    const payload = await fetchAuthJson("status");
    if (payload.user) {
      setAuthenticatedUser(payload.user);
      startAuthMonitor();
      setAuthScreenVisible(false);
      await initProjectHome();
      return;
    }
  } catch (error) {
    console.warn("Auth status failed", error);
  }
  authState.mode = "login";
  setAuthenticatedUser(null);
  resetProjectSession();
  setAuthScreenVisible(true);
}

async function submitAuthForm(event) {
  event.preventDefault();
  if (authState.busy) return;
  const login = authLoginInput?.value.trim() || "";
  const password = authPasswordInput?.value || "";
  setAuthError("");
  authState.busy = true;
  renderAuthUi();
  try {
    const payload = await fetchAuthJson(authState.mode === "register" ? "register" : "login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    setAuthenticatedUser(payload.user);
    startAuthMonitor();
    if (authPasswordInput) authPasswordInput.value = "";
    setAuthScreenVisible(false);
    await initProjectHome();
  } catch (error) {
    setAuthError(error.message || "Не удалось войти");
  } finally {
    authState.busy = false;
    renderAuthUi();
  }
}

async function loginAsDeveloper() {
  if (authState.busy) return;
  setAuthError("");
  authState.busy = true;
  renderAuthUi();
  try {
    const payload = await fetchAuthJson("dev", { method: "POST" });
    authState.mode = "login";
    setAuthenticatedUser(payload.user);
    startAuthMonitor();
    if (authLoginInput) authLoginInput.value = payload.user?.login || "developer";
    if (authPasswordInput) authPasswordInput.value = "";
    setAuthScreenVisible(false);
    await initProjectHome();
  } catch (error) {
    setAuthError(error.message || "Не удалось войти как разработчик");
  } finally {
    authState.busy = false;
    renderAuthUi();
  }
}

async function logoutAccount() {
  if (!(await saveProjectBeforeLeaving())) return;
  await fetchAuthJson("logout", { method: "POST" }).catch((error) => console.warn("Logout failed", error));
  stopAuthMonitor();
  authState.mode = "login";
  setAuthenticatedUser(null);
  resetProjectSession();
  setProjectHomeVisible(false);
  setAuthScreenVisible(true);
  updateSaveIndicator("idle", "Войдите");
}

function projectDateLabel(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "без даты";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function projectMetaLine(project) {
  const count = Number(project.entityCount) || 0;
  return [project.site && project.site !== project.name ? project.site : "", project.visitDate,
    `${count} объектов`, projectDateLabel(project.updatedAt)].filter(Boolean).join(" · ");
}

function filteredProjects() {
  const query = (projectSearchInput?.value || "").trim().toLowerCase();
  const projects = persistence.showingTrash ? persistence.trash : persistence.projects;
  if (!query) return projects;
  const terms = query.split(/\s+/u);
  return projects.filter((project) => {
    const searchable = [project.name, project.site, project.visitDate].join(" ").toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

function renderProjectList() {
  if (!projectList) return;
  const showingTrash = persistence.showingTrash;
  if (projectListHeading) projectListHeading.textContent = showingTrash ? "Корзина" : "Последние файлы";
  if (projectTrashButton) {
    projectTrashButton.hidden = !nativeApkMode;
    projectTrashButton.setAttribute("aria-pressed", String(showingTrash));
    projectTrashButton.textContent = showingTrash ? "Все файлы" : "Корзина";
  }
  const projects = filteredProjects();
  projectList.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "project-empty";
    empty.textContent = showingTrash
      ? (persistence.trash.length ? "Ничего не найдено" : "Корзина пуста")
      : (persistence.projects.length ? "Поиск ничего не нашел" : "Файлов пока нет. Создайте новый замер или импортируйте .zamer.");
    projectList.append(empty);
    return;
  }
  for (const project of projects) {
    const card = document.createElement("article");
    card.className = "project-card";
    card.dataset.projectId = project.id;

    const preview = document.createElement("div");
    preview.className = "project-card-preview";
    preview.innerHTML = cadIcon("plan");

    const main = document.createElement("div");
    main.className = "project-card-main";

    const title = document.createElement("div");
    title.className = "project-card-title";
    const name = document.createElement("strong");
    name.textContent = project.name || "Без названия";
    title.append(name);
    if (project.legacy) {
      const badge = document.createElement("em");
      badge.textContent = "старый";
      title.append(badge);
    }

    const meta = document.createElement("div");
    meta.className = "project-card-meta";
    meta.textContent = showingTrash ? `Удалён ${projectDateLabel(project.deletedAt)} · ${project.entityCount} объектов` : projectMetaLine(project);

    const actions = document.createElement("div");
    actions.className = "project-card-actions";
    const buttons = showingTrash ? [["restore", "Восстановить", "primary"]] : [
      ["open", "Открыть", "primary"],
      ["rename", "Имя", ""],
      ["duplicate", "Копия", ""],
      ["export", ".zamer", ""],
      ...(nativeApkMode ? [["versions", "Версии", ""]] : []),
      ["delete", "Удалить", ""],
    ];
    for (const [action, label, className] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.projectAction = action;
      button.dataset.projectId = project.id;
      button.textContent = label;
      if (className) button.className = className;
      if (project.legacy && action === "delete") button.disabled = true;
      actions.append(button);
    }

    main.append(title, meta, actions);
    card.append(preview, main);
    projectList.append(card);
  }
}

function showProjectMessage(message = "", error = false) {
  if (!projectHomeStatus) return;
  projectHomeStatus.hidden = !message;
  projectHomeStatus.textContent = message;
  projectHomeStatus.dataset.error = String(error);
}

async function projectRequestError(response, fallback) {
  const payload = await response.json().catch(() => null);
  return new Error(payload?.error || fallback);
}

let closeProjectDialog = null;

function showProjectDialog({ title, message = "", value = "", placeholder = "", inputLabel = "Название проекта", confirmText = "Готово", destructive = false, withInput = true, choices = [] }) {
  return new Promise((resolve) => {
    closeProjectDialog?.(null);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...shell.children].map((element) => [element, element.inert]);
    const backdrop = document.createElement("div");
    backdrop.className = "project-dialog-backdrop";

    const dialog = document.createElement("form");
    dialog.className = "project-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "projectDialogTitle");

    const heading = document.createElement("strong");
    heading.id = "projectDialogTitle";
    heading.textContent = title;
    dialog.append(heading);

    if (message) {
      const text = document.createElement("p");
      text.id = "projectDialogDescription";
      text.textContent = message;
      dialog.append(text);
      dialog.setAttribute("aria-describedby", text.id);
    }

    let input = null;
    if (choices.length) {
      input = document.createElement("select");
      input.setAttribute("aria-label", inputLabel);
      for (const choice of choices) input.add(new Option(choice.label, choice.value));
      dialog.append(input);
    } else if (withInput) {
      input = document.createElement("input");
      input.type = "text";
      input.value = value;
      input.placeholder = placeholder || value;
      input.maxLength = 80;
      input.autocomplete = "off";
      input.setAttribute("aria-label", inputLabel);
      input.required = true;
      dialog.append(input);
    }

    const actions = document.createElement("div");
    actions.className = "project-dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Отмена";

    const confirmButton = document.createElement("button");
    confirmButton.type = "submit";
    confirmButton.className = destructive ? "danger" : "primary";
    confirmButton.textContent = confirmText;
    actions.append(cancelButton, confirmButton);
    dialog.append(actions);
    backdrop.append(dialog);

    const finish = (result) => {
      closeProjectDialog = null;
      backdrop.remove();
      for (const [element, inert] of background) element.inert = inert;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(result);
    };
    closeProjectDialog = finish;

    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      } else if (event.key === "Tab") {
        const first = input || cancelButton;
        const last = confirmButton;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) finish(null);
    });
    cancelButton.addEventListener("click", () => finish(null));
    dialog.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input) {
        finish(true);
        return;
      }
      const nextValue = input.value.trim().slice(0, 80);
      if (!nextValue) {
        input.focus();
        return;
      }
      finish(nextValue);
    });

    for (const [element] of background) element.inert = true;
    shell.append(backdrop);
    requestAnimationFrame(() => {
      if (!dialog.isConnected) return;
      if (input) {
        input.focus();
        if (input instanceof HTMLInputElement) input.select();
      } else {
        (destructive ? cancelButton : confirmButton).focus();
      }
    });
  });
}

function askProjectName(title, value, placeholder = "") {
  return showProjectDialog({ title, value, placeholder });
}

function askCadText(value = "Текст") {
  return showProjectDialog({
    title: "Текст",
    message: "Введите надпись для чертежа.",
    value,
    placeholder: "Например: Спальня, высота 2700",
    inputLabel: "Надпись на чертеже",
    confirmText: "Поставить",
  });
}

function confirmProjectDelete(name) {
  return showProjectDialog({
    title: "Удалить проект",
    message: nativeApkMode ? `Проект "${name}" будет перемещен в локальную корзину.` : `Проект "${name}" будет удален с сервера.`,
    confirmText: "Удалить",
    destructive: true,
    withInput: false,
  });
}

function isSecureInstallContext() {
  return window.isSecureContext || ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function updateInstallButton() {
  if (!installAppButton) return;
  if (nativeApkMode || installState.installed) {
    installAppButton.hidden = true;
    return;
  }
  installAppButton.hidden = false;
  installAppButton.classList.toggle("ready", !!installState.promptEvent);
  const title = installAppButton.querySelector("strong");
  const text = installAppButton.querySelector("span");
  if (title) title.textContent = installState.promptEvent ? "Установить" : "На экран";
  if (text) text.textContent = installState.promptEvent ? "Приложение" : "Подсказка";
}

function standaloneInstallHelpText() {
  if (!isSecureInstallContext()) {
    return "Для установки телефон должен открыть сайт по HTTPS. Откройте Cloudflare-ссылку, потом нажмите эту кнопку еще раз.";
  }
  const isApple = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isApple) {
    return "На iPhone установка идет через Safari: нажмите Поделиться, потом На экран Домой.";
  }
  return "Если окно установки не появилось, откройте меню браузера и выберите Установить приложение или Добавить на главный экран.";
}

async function requestAppInstall() {
  if (installState.installed) {
    await showProjectDialog({
      title: "Уже установлено",
      message: "Приложение уже открыто как установленное.",
      confirmText: "Понятно",
      withInput: false,
    });
    updateInstallButton();
    return;
  }
  if (!installState.promptEvent) {
    await showProjectDialog({
      title: "Установка на телефон",
      message: standaloneInstallHelpText(),
      confirmText: "Понятно",
      withInput: false,
    });
    return;
  }
  const promptEvent = installState.promptEvent;
  installState.promptEvent = null;
  updateInstallButton();
  promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => null);
  if (choice?.outcome === "accepted") {
    installState.installed = true;
    updateInstallButton();
  }
}

function initAppInstallPrompt() {
  updateInstallButton();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installState.promptEvent = event;
    updateInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    installState.installed = true;
    installState.promptEvent = null;
    updateInstallButton();
  });
  installAppButton?.addEventListener("click", () => {
    requestAppInstall().catch((error) => {
      console.warn("Install prompt failed", error);
      updateSaveIndicator("error", "Не установлено", { autoDim: 2600 });
    });
  });
}

async function loadProjects() {
  if (!projectList) return;
  const clientId = persistence.clientId;
  const showingTrash = persistence.showingTrash;
  try {
    const response = await fetch(showingTrash ? "/api/trash" : projectsEndpoint(clientId), { cache: "no-store" });
    if (persistence.clientId !== clientId) return;
    if (response.status === 401) {
      await forceAuthLogout();
      return;
    }
    if (!response.ok) throw await projectRequestError(response, "Не удалось загрузить проекты");
    const payload = await response.json();
    if (persistence.clientId !== clientId) return;
    if (showingTrash) persistence.trash = Array.isArray(payload.entries) ? payload.entries : [];
    else persistence.projects = Array.isArray(payload.projects) ? payload.projects : [];
    renderProjectList();
  } catch (error) {
    if (persistence.clientId !== clientId || persistence.showingTrash !== showingTrash) return;
    console.warn("Could not load projects", error);
    projectList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "project-empty";
    empty.textContent = nativeApkMode ? "Не удалось прочитать проекты на телефоне" : "Не удалось загрузить список проектов. Проверьте сервер.";
    projectList.append(empty);
  }
}

function setActiveProject(project, projectId = project?.projectId || project?.id) {
  persistence.projectSession += 1;
  window.clearTimeout(persistence.timer);
  window.clearTimeout(persistence.localTimer);
  persistence.projectId = projectId || "";
  persistence.projectName = project?.name || "Без названия";
  persistence.projectCreatedAt = project?.createdAt || new Date().toISOString();
  persistence.revision = projectRevision(project);
  persistence.ready = false;
  persistence.dirty = false;
  persistence.needsRemoteSync = false;
  persistence.lastHash = "";
  persistence.pendingSaveId = "";
  persistence.pendingSnapshot = "";
  updateProjectTitle();
}

async function readProjectVersions(identity) {
  const localProject = await loadProjectFromLocalStore(identity);
  let serverProject = null;
  let serverError = null;
  let serverMissing = false;
  let unauthorized = false;
  try {
    const response = await fetch(identity.endpoint, { cache: "no-store" });
    if (response.status === 401) unauthorized = true;
    else if (response.status === 410) return { localProject: null, serverProject: null, serverError: await projectRequestError(response, "Проект в корзине"),
      serverMissing: false, unauthorized: false, choice: chooseProjectSource(null, null) };
    else if (response.ok) {
      const payload = await response.json();
      serverProject = payload.project || null;
      if (serverProject?.projectId != null && serverProject.projectId !== identity.projectId) {
        serverProject = null;
        throw new Error("Сервер вернул другой проект");
      }
    } else if (response.status === 404) {
      serverMissing = true;
    } else {
      throw new Error(`Open project failed: ${response.status}`);
    }
  } catch (error) {
    serverError = error;
  }
  return { localProject, serverProject, serverError, serverMissing, unauthorized, choice: chooseProjectSource(localProject, serverProject) };
}

async function latestProjectFor(projectId) {
  const versions = await readProjectVersions(projectIdentity(projectId));
  if (versions.unauthorized || !versions.choice.project) throw versions.serverError || new Error("Проект не найден");
  return versions.choice.project;
}

async function openProject(projectId) {
  if (!projectId) return;
  const request = ++persistence.openRequest;
  if (!(await saveProjectBeforeLeaving())) return;
  if (request !== persistence.openRequest) return;
  const identity = projectIdentity(projectId);
  const { localProject, serverProject, serverError, serverMissing, unauthorized, choice } = await readProjectVersions(identity);
  if (request !== persistence.openRequest || persistence.clientId !== identity.clientId || persistence.projectSession !== identity.session) return;
  if (unauthorized) {
    await forceAuthLogout("Сессия завершена. Войдите снова.");
    return;
  }
  if (!choice.project || !Array.isArray(choice.project.entities)) {
    throw serverError || new Error(nativeApkMode ? "Не удалось открыть проект на телефоне" : "Проект недоступен");
  }
  setActiveProject(choice.project, projectId);
  const active = projectIdentity();
  if (!restoreProject(choice.project)) throw new Error("Не удалось открыть проект");

  persistence.revision = projectRevision(choice.project);
  persistence.ready = true;
  persistence.lastHash = projectSnapshotKey();
  persistence.dirty = false;
  const shouldPush = choice.shouldPush || (serverMissing && Boolean(localProject));
  persistence.needsRemoteSync = shouldPush;
  setProjectHomeVisible(false);
  try { localStorage.setItem("zamer.lastProjectId", projectId); } catch { /* optional history */ }

  if (choice.source === "server") {
    saveProjectToLocalStore({ ...choice.project, syncPending: false }, "server-open", active);
    updateSaveIndicator("saved", nativeApkMode ? "На телефоне" : "С сервера", { autoDim: 2400 });
  } else if (shouldPush) {
    persistence.pendingSnapshot = persistence.lastHash;
    persistence.pendingSaveId = choice.project.clientSaveId || createClientSaveId();
    persistence.dirty = true;
    updateSaveIndicator("offline", serverProject ? "Локальная новее" : "На телефоне", { autoDim: 2600 });
    persistence.timer = window.setTimeout(saveProjectNow, 120);
  } else {
    updateSaveIndicator("saved", "С телефона", { autoDim: 2400 });
  }
  statusChip.textContent = `${persistence.projectName}: открыт`;
}

async function createProject(options = {}) {
  const clientId = persistence.clientId;
  if (!(await saveProjectBeforeLeaving())) return;
  if (persistence.clientId !== clientId) return;
  const response = await fetch(projectsEndpoint(clientId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!response.ok) throw await projectRequestError(response, "Не удалось создать проект");
  const payload = await response.json();
  if (persistence.clientId !== clientId) return;
  await loadProjects();
  if (persistence.clientId !== clientId) return;
  await openProject(payload.project.projectId);
}

async function renameProject(projectId) {
  const current = persistence.projects.find((project) => project.id === projectId);
  const nextName = await askProjectName("Название проекта", current?.name || "Без названия");
  if (!nextName) return;
  const identity = projectIdentity(projectId);
  const latest = await latestProjectFor(projectId);
  const now = new Date().toISOString();
  const project = { ...latest, name: nextName, savedAt: now, updatedAt: now, serverSavedAt: undefined, syncPending: true, clientSaveId: createClientSaveId() };
  const saveResponse = await fetch(identity.endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!saveResponse.ok && (!nativeApkMode || !(await saveProjectToLocalStore(project, "rename", identity)))) {
    throw await projectRequestError(saveResponse, "Не удалось переименовать проект");
  }
  if (saveResponse.ok) {
    const payload = await saveResponse.json();
    const revision = Number(payload.revision) || projectRevision(project);
    await saveProjectToLocalStore({ ...project, revision, baseRevision: revision, savedAt: payload.savedAt || now,
      serverSavedAt: payload.savedAt || now, syncPending: false }, "rename", identity);
    if (isActiveProject(identity)) persistence.revision = revision;
  }
  if (isActiveProject(identity)) {
    persistence.projectName = project.name;
    persistence.lastHash = projectSnapshotKey();
    persistence.needsRemoteSync = !saveResponse.ok;
    updateProjectTitle();
  }
  await loadProjects();
}

async function duplicateProject(projectId) {
  const project = await latestProjectFor(projectId);
  await createProject({ name: `${String(project.name || "Без названия").slice(0, 74)} копия`, project });
}

async function showProjectVersions(projectId) {
  const identity = projectIdentity(projectId);
  await persistence.localWriteChain.catch(() => {});
  const versions = await readLocalVersionHistory(identity);
  if (persistence.clientId !== identity.clientId) return;
  if (!versions.length) {
    showProjectMessage("Сохранённых версий пока нет");
    return;
  }
  const name = persistence.projects.find((project) => project.id === projectId)?.name || "Чертёж";
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "medium" });
  const choices = versions.map((version) => {
    const time = Date.parse(version.savedAt);
    const date = Number.isFinite(time) ? dateFormat.format(time) : "Без даты";
    return { value: String(version.id), label: `${date} · ${version.entityCount} объектов` };
  });
  const selected = await showProjectDialog({
    title: "История версий", message: name, inputLabel: "Сохранённая версия",
    confirmText: "Восстановить копией", choices,
  });
  if (!selected || persistence.clientId !== identity.clientId) return;
  const project = await readLocalProjectVersion(identity, selected);
  if (!project) throw new Error("Версия чертежа больше недоступна");
  validateZamerProject(project);
  const suffix = " · копия версии";
  await createProject({ name: `${name.slice(0, 80 - suffix.length)}${suffix}`, project });
}

async function deleteProject(projectId) {
  const current = persistence.projects.find((project) => project.id === projectId);
  if (!(await confirmProjectDelete(current?.name || projectId))) return;
  if (persistence.projectId === projectId && !(await saveProjectBeforeLeaving())) return;
  const identity = projectIdentity(projectId);
  const response = await fetch(identity.endpoint, { method: "DELETE" });
  if (!response.ok) throw await projectRequestError(response, "Не удалось удалить проект");
  if (persistence.projectId === projectId) {
    persistence.projectSession += 1;
    persistence.openRequest += 1;
    window.clearTimeout(persistence.timer);
    window.clearTimeout(persistence.localTimer);
    persistence.projectId = "";
    persistence.ready = false;
    setProjectHomeVisible(true);
  }
  if (nativeApkMode) showProjectMessage("Проект в корзине");
  await loadProjects();
}

async function restoreTrashedProject(trashId) {
  const response = await fetch("/api/trash/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: trashId }),
  });
  if (!response.ok) throw await projectRequestError(response, "Не удалось восстановить проект");
  showProjectMessage("Проект восстановлен и доступен в списке файлов");
  await loadProjects();
}

async function exportProjectBackup(projectId) {
  const project = await latestProjectFor(projectId);
  const name = String(project.name || "zamer").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 48) || "zamer";
  const result = await downloadFile(`${name}.zamer`, JSON.stringify(project, null, 2), "application/json");
  showProjectMessage(result?.native ? "Копия в Загрузках" : "Копия отправлена в загрузки");
}

async function importProjectFile(file) {
  if (!file) return;
  projectImportInput.value = "";
  if (!file.size || file.size > MAX_ZAMER_FILE_BYTES) throw new Error("Выберите непустой .zamer размером до 32 МБ");
  const text = await file.text();
  let project;
  try { project = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("Файл .zamer повреждён"); }
  validateZamerProject(project);
  const fallbackName = project.name || file.name.replace(/\.zamer$/i, "") || "Импорт";
  const name = await askProjectName("Название импортируемого проекта", fallbackName);
  if (!name) return;
  await createProject({ name, project });
}

async function handleProjectAction(action, projectId) {
  showProjectMessage();
  try {
    if (action === "open") await openProject(projectId);
    else if (action === "rename") await renameProject(projectId);
    else if (action === "duplicate") await duplicateProject(projectId);
    else if (action === "versions" && nativeApkMode) await showProjectVersions(projectId);
    else if (action === "export") await exportProjectBackup(projectId);
    else if (action === "delete") await deleteProject(projectId);
    else if (action === "restore" && nativeApkMode) await restoreTrashedProject(projectId);
  } catch (error) {
    console.warn("Project action failed", error);
    showProjectMessage(error.message || "Ошибка проекта", true);
  }
}

async function showProjectHome() {
  if (state.tool === "polyline" && state.drawing) finishLineCommand();
  closeLineMetricInput();
  if (!(await saveProjectBeforeLeaving())) return;
  setProjectHomeVisible(true);
  updateSaveIndicator("idle", "Выберите файл");
  await loadProjects();
  if (!projectHome.hidden) createProjectButton?.focus({ preventScroll: true });
}

async function initProjectHome() {
  setProjectHomeVisible(true);
  updateProjectTitle();
  updateSaveIndicator("idle", "Выберите файл");
  await loadProjects();
  try {
    const urlProject = new URLSearchParams(window.location.search).get("project");
    if (/^[a-zA-Z0-9_-]{3,80}$/.test(urlProject || "")) await openProject(urlProject);
  } catch (error) {
    console.warn("Direct project open failed", error);
  }
}

function serializableProjectState() {
  return {
    version: 2,
    clientId: persistence.clientId,
    projectId: persistence.projectId,
    name: persistence.projectName || "Без названия",
    createdAt: persistence.projectCreatedAt || new Date().toISOString(),
    theme: state.theme,
    view: {
      scale: state.view.scale,
      panX: state.view.panX,
      panY: state.view.panY,
    },
    snaps: [...state.snaps],
    polarStep: state.polarStep,
    visibleLayers: [...state.visibleLayers],
    annotationScale: state.annotationScale,
    selectionFilter: state.selectionFilter,
    survey: state.survey,
    draft: acceptedSurveyDraft(),

    entities: JSON.parse(JSON.stringify(state.entities)),
  };
}

function createClientSaveId() {
  const value = crypto.randomUUID ? crypto.randomUUID() : `save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 72);
}

function clientSaveIdForSnapshot(snapshot) {
  if (!persistence.pendingSaveId || persistence.pendingSnapshot !== snapshot) {
    persistence.pendingSaveId = createClientSaveId();
    persistence.pendingSnapshot = snapshot;
  }
  return persistence.pendingSaveId;
}

function serializeProject(options = {}, snapshot = projectSnapshotKey()) {
  const savedAt = new Date().toISOString();
  return {
    ...JSON.parse(snapshot),
    revision: persistence.revision,
    baseRevision: persistence.revision,
    clientSaveId: options.clientSaveId || "",
    syncPending: Boolean(options.syncPending),
    updatedAt: savedAt,
    savedAt,
  };
}

function projectSnapshotKey() {
  return JSON.stringify(serializableProjectState());
}

function isValidProjectEntity(entity) {
  return Boolean(entity && typeof entity === "object" && typeof entity.id === "string" &&
    typeof entity.type === "string" &&
    (entity.type !== "polyline" || validPolylinePoints(entity.points, entity.closed)));
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
  if (project.projectId && !persistence.projectId) persistence.projectId = project.projectId;
  if (project.name) persistence.projectName = project.name;
  if (project.createdAt) persistence.projectCreatedAt = project.createdAt;
  persistence.revision = projectRevision(project);
  if (project.syncPending && project.clientSaveId) persistence.pendingSaveId = project.clientSaveId;
  const restoredEntities = project.entities.map(cloneProjectEntity).filter(Boolean);
  persistence.restoring = true;
  try {
    state.entities = restoredEntities;
    state.survey = normalizeSurvey(project.survey);
    surveyPointPicker = null;
    surveyPanel?.close();
    if (project.view && Number.isFinite(project.view.scale)) {
      state.view.scale = clampScale(project.view.scale);
      state.view.panX = Number.isFinite(project.view.panX) ? project.view.panX : state.view.panX;
      state.view.panY = Number.isFinite(project.view.panY) ? project.view.panY : state.view.panY;
    }
    if (Array.isArray(project.snaps)) {
      state.snaps = new Set(project.snaps.filter(Boolean));
    }
    state.polarStep = [5, 15, 30, 45, 90].includes(project.polarStep) ? project.polarStep : 5;
    if (lineUi.linePolarStep) lineUi.linePolarStep.value = String(state.polarStep);
    if (Array.isArray(project.visibleLayers)) {
      state.visibleLayers = new Set(project.visibleLayers.filter((id) => layerMeta[id]));
    }
    if (Number.isFinite(project.annotationScale)) {
      setAnnotationScale(project.annotationScale, { save: false });
    }
    if (project.theme === "light" || project.theme === "dark") {
      state.theme = project.theme;
      shell.dataset.theme = state.theme;
      themeButton.setAttribute("aria-pressed", String(state.theme === "dark"));
      themeButton.innerHTML = cadIcon(state.theme === "light" ? "moon" : "sun");
      window.ZamerAndroid?.setTheme?.(state.theme);
    }
    state.selectionFilter = selectionFilters.includes(project.selectionFilter) ? project.selectionFilter : "all";

    state.drawing = null;
    state.skipLineObjectSnap = false;
    state.moveCommand = null;
    state.offsetCommand = null;
    state.lineEdit = null;
    state.dimensionAttach = null;
    closeLineMetricInput();
    state.pointer = null;
    state.pinch = null;
    state.inlineEdit = null;
    state.numericEdit = null;
    state.selectionDrag = null;
    state.selectedEndpoint = null;
    state.endpointEditBefore = null;
    state.undo = [];
    state.redo = [];
    state.selectedId = null;
    state.selectedIds = [];
    restoreAcceptedSurveyDraft(project.draft);

    syncSnapButtons();
    syncToolButtons();
    renderLayerList();
    updateProjectTitle();
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
  updateSaveIndicator("saving", "Сохраняю...");
  const saveId = clientSaveIdForSnapshot(snapshot);
  const identity = projectIdentity();
  window.clearTimeout(persistence.localTimer);
  persistence.localTimer = window.setTimeout(() => {
    if (!persistence.ready || !isActiveProject(identity)) return;
    const currentSnapshot = projectSnapshotKey();
    const currentSaveId = currentSnapshot === snapshot ? saveId : clientSaveIdForSnapshot(currentSnapshot);
    saveProjectToLocalStore(serializeProject({ syncPending: true, clientSaveId: currentSaveId }, currentSnapshot), `checkpoint-${reason}`, identity).catch(() => {});
  }, persistence.localDebounceMs);
  window.clearTimeout(persistence.timer);
  persistence.timer = window.setTimeout(saveProjectNow, persistence.debounceMs);
}

async function recoverMissingRemoteProject(project, snapshot, identity) {
  const response = await fetch(projectsEndpoint(identity.clientId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: identity.projectId, name: project.name, project }),
  });
  if (!response.ok) return false;
  const payload = await response.json();
  if (!isActiveProject(identity)) return true;
  persistence.revision = projectRevision(payload.project);
  persistence.pendingSaveId = "";
  persistence.pendingSnapshot = "";
  const confirmed = { ...payload.project, syncPending: false };
  await saveProjectToLocalStore(confirmed, "server-recreated", identity);
  if (!isActiveProject(identity)) return true;
  persistence.lastHash = snapshot;
  persistence.dirty = projectSnapshotKey() !== snapshot;
  persistence.needsRemoteSync = false;
  if (!persistence.dirty) updateSaveIndicator("saved", "Восстановлено", { autoDim: 2600 });
  loadProjects().catch(() => {});
  return true;
}

async function switchToRecoveryProject(payload, snapshot, identity) {
  const recovery = payload?.recoveryProject;
  if (!recovery?.projectId || !isActiveProject(identity)) return false;
  const changedDuringSave = projectSnapshotKey() !== snapshot;
  setActiveProject(recovery, recovery.projectId);
  const recoveryIdentity = projectIdentity();
  persistence.ready = true;
  persistence.revision = projectRevision(recovery);
  const currentSnapshot = projectSnapshotKey();
  if (changedDuringSave) {
    persistence.dirty = true;
    persistence.needsRemoteSync = true;
    const saveId = clientSaveIdForSnapshot(currentSnapshot);
    const saved = await saveProjectToLocalStore(serializeProject({ syncPending: true, clientSaveId: saveId }, currentSnapshot), "conflict-latest", recoveryIdentity);
    if (!isActiveProject(recoveryIdentity)) return saved;
    persistence.timer = window.setTimeout(saveProjectNow, persistence.debounceMs);
    if (!saved) {
      updateSaveIndicator("error", "Последние изменения не записаны");
      return false;
    }
  } else {
    persistence.lastHash = currentSnapshot;
    await saveProjectToLocalStore({ ...recovery, syncPending: false }, "conflict-recovery", recoveryIdentity);
  }
  if (!isActiveProject(recoveryIdentity)) return true;
  updateProjectTitle();
  updateSaveIndicator("saved", "Безопасная копия", { autoDim: 3600 });
  statusChip.textContent = "Найдена более новая версия. Этот чертеж сохранен отдельной копией";
  loadProjects().catch(() => {});
  return true;
}

function saveProjectNow() {
  if (!persistence.ready || persistence.restoring || !persistence.projectId) return Promise.resolve(true);
  if (persistence.savePromise && isActiveProject(persistence.saveIdentity)) return persistence.savePromise;
  const identity = projectIdentity();
  const snapshot = projectSnapshotKey();
  if (!persistence.dirty && !persistence.needsRemoteSync && snapshot === persistence.lastHash) return Promise.resolve(true);
  const saveId = clientSaveIdForSnapshot(snapshot);
  const project = serializeProject({ syncPending: true, clientSaveId: saveId }, snapshot);
  window.clearTimeout(persistence.timer);
  window.clearTimeout(persistence.localTimer);
  updateSaveIndicator("saving", "Сохраняю...");
  const running = saveProjectForSession(identity, snapshot, project).finally(() => {
    if (persistence.savePromise === running) {
      persistence.savePromise = null;
      persistence.saveIdentity = null;
    }
    if (isActiveProject(identity) && persistence.dirty && !persistence.needsRemoteSync) markProjectDirty("pending");
  });
  persistence.savePromise = running;
  persistence.saveIdentity = identity;
  return running;
}

async function saveProjectBeforeLeaving() {
  while (persistence.ready && persistence.projectId) {
    if (!(await saveProjectNow())) return false;
    if (!persistence.dirty) return true;
  }
  return true;
}

async function saveProjectForSession(identity, snapshot, project) {
  let durable = false;
  try {
    durable = await saveProjectToLocalStore(project, persistence.lastReason || "change", identity);
    if (!isActiveProject(identity)) return durable;
    const response = await fetch(identity.endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
    if (!isActiveProject(identity)) return durable || response.ok;
    if (response.status === 401) {
      if (durable) return forceAuthLogout("Аккаунт открыт на другом устройстве. Это устройство вышло из аккаунта.");
      updateSaveIndicator("error", "Не удалось записать чертёж");
      return false;
    }
    if (response.status === 409) {
      const payload = await response.json().catch(() => ({}));
      if (await switchToRecoveryProject(payload, snapshot, identity)) return true;
      throw new Error("Project revision conflict");
    }
    if (response.status === 404) {
      if (await recoverMissingRemoteProject(project, snapshot, identity)) return true;
      throw new Error("Project disappeared from the server");
    }
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    durable = true;
    const payload = await response.json().catch(() => ({}));
    if (!isActiveProject(identity)) return true;
    persistence.revision = Number.isFinite(Number(payload.revision)) ? Number(payload.revision) : persistence.revision + 1;
    persistence.pendingSaveId = "";
    persistence.pendingSnapshot = "";
    persistence.needsRemoteSync = false;
    persistence.lastHash = snapshot;
    if (projectSnapshotKey() === snapshot) {
      await saveProjectToLocalStore({
        ...project,
        revision: persistence.revision,
        baseRevision: persistence.revision,
        savedAt: payload.savedAt || project.savedAt,
        serverSavedAt: payload.savedAt || project.savedAt,
        syncPending: false,
      }, "server-confirmed", identity);
    }
    if (!isActiveProject(identity)) return true;
    persistence.dirty = projectSnapshotKey() !== snapshot;
    if (!persistence.dirty) updateSaveIndicator("saved", "Сохранено", { autoDim: 2400 });
    return true;
  } catch (error) {
    console.warn("Project autosave failed", error);
    if (!isActiveProject(identity)) return durable;
    persistence.needsRemoteSync = true;
    const latestSnapshot = projectSnapshotKey();
    if (latestSnapshot !== snapshot || !durable) {
      const latestSaveId = clientSaveIdForSnapshot(latestSnapshot);
      durable = await saveProjectToLocalStore(serializeProject({ syncPending: true, clientSaveId: latestSaveId }, latestSnapshot), "network-pending", identity);
    }
    if (!isActiveProject(identity)) return durable;
    if (durable) persistence.lastHash = latestSnapshot;
    persistence.dirty = !durable || projectSnapshotKey() !== latestSnapshot;
    persistence.timer = window.setTimeout(saveProjectNow, persistence.retryMs);
    if (!durable) updateSaveIndicator("error", "Не удалось записать чертёж");
    else if (!persistence.dirty) updateSaveIndicator("offline", "На телефоне", { autoDim: 3200 });
    return durable;
  }
}

function flushProjectBeforeUnload() {
  if (!persistence.ready || persistence.restoring || !persistence.projectId) return;
  if (!persistence.dirty && projectSnapshotKey() === persistence.lastHash) return;
  const snapshot = projectSnapshotKey();
  const saveId = clientSaveIdForSnapshot(snapshot);
  const project = serializeProject({ syncPending: true, clientSaveId: saveId }, snapshot);
  const identity = projectIdentity();
  saveProjectToLocalStore(project, "page-close", identity).catch(() => {});
  if (nativeApkMode) return;
  const body = JSON.stringify(project);
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon?.(identity.endpoint, blob)) return;
  fetch(identity.endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
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
  const active = document.activeElement;
  return Boolean(numericConfirmInput()) || lineKeyboardInputs.includes(active) || active === leaderTextInput ||
    Boolean(active?.matches("#surveySheet input, #surveySheet textarea, #surveySheet select, .viewport-objects-dialog input"));
}

function numericConfirmInput() {
  const active = document.activeElement;
  if (keyboardInputs.includes(active)) return active;
  const assistedInput = state.numericEdit?.lineMetric && linePointAssist.contains(active);
  if ((active === keyboardConfirmButton || assistedInput) && lastNumericInput && !lastNumericInput.closest("[hidden]")) {
    return lastNumericInput;
  }
  return null;
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

  if (!inputFocused) {
    // System-bar insets and split-screen can shrink the viewport after startup.
    // Only hold its previous height while an input actually owns the keyboard.
    stableViewportHeight = Math.max(viewportHeight, layoutHeight);
  } else if (keyboardInset === 0) {
    stableViewportHeight = Math.max(stableViewportHeight, viewportHeight, layoutHeight);
  }

  document.documentElement.style.setProperty("--app-height", `${stableViewportHeight}px`);
  document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(keyboardInset)}px`);
  const confirmKeyboardInset = inputFocused ? keyboardInset || Math.round(Math.min(360, Math.max(260, stableViewportHeight * 0.42))) : 0;
  document.documentElement.style.setProperty("--confirm-keyboard-inset", `${confirmKeyboardInset}px`);
  shell.classList.toggle("keyboard-open", keyboardInset > 0);
  if (keyboardConfirmButton) {
    keyboardConfirmButton.hidden = !numericConfirmInput();
    positionKeyboardConfirmButton();
  }
  lockDocumentScroll();
  resizeCanvas();
}

function positionKeyboardConfirmButton() {
  if (!keyboardConfirmButton) return;
  if (!numericConfirmInput()) {
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

function cursorWorld() {
  return cursorSnapResolved().point;
}

function rawCursorWorld() {
  return screenToWorld(centerScreen());
}

function lineAxisAngle(axis, start, end) {
  if (axis === "x") return end.x < start.x ? 180 : 0;
  if (axis === "y") return end.y > start.y ? 270 : 90;
  return undefined;
}

function cursorSnapResolved() {
  const raw = screenToWorld(centerScreen());
  if (state.dimensionAttach) {
    const snap = dimensionAttachCandidate(raw);
    return { point: snap ? { x: snap.x, y: snap.y } : raw, snap };
  }
  if (state.tool === "dimension" && state.drawing?.phase === "offset") return { point: raw, snap: null };
  if (state.tool === "dimension") return resolveDimensionPointSnap(raw);
  const draft = state.drawing;
  const start = draft?.start || state.moveCommand?.base || selectedEndpointGeometry()?.fixed || null;
  const constraint = draft?.metricConstraint;
  const objectSnaps = !state.skipLineObjectSnap || Boolean(surveyPointPicker);
  const firstVertex = state.tool === "polyline" && draft?.points.length >= 3 ? draft.points[0] : null;
  if (firstVertex && !constraint && objectSnaps && state.snaps.has("end") && distanceWorld(raw, firstVertex) * state.view.scale <= screenUiPx(14)) {
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    return { point: firstVertex, snap: { ...firstVertex, type: "end", label: "Начальная вершина" } };
  }
  if (constraint) {
    const axisAngle = state.tool === "line" && constraint.length !== undefined ? lineAxisAngle(draft.metricDirection, start, raw) : undefined;
    const direction = axisAngle === undefined && constraint.angle === undefined
      ? resolveLineLikeSnap(raw, start, { useGrid: false, objectSnaps }).point : raw;
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    const point = axisAngle === undefined ? linePointWithConstraint(start, direction, constraint) : linePolarPoint(start, constraint.length, axisAngle);
    return { point, snap: null };
  }
  if (start) return resolveLineLikeSnap(raw, start, { objectSnaps });
  if (objectSnaps && canSnapToPrePointTrackingGuides()) return resolvePrePointTrackingSnap(raw);
  return resolveSnapWorld(raw, { objectSnaps });
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
  return value * annotationScale() * (printRendering ? 0.75 : annotationZoomScale());
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
  drawSurveyMarks(c, rect);


  const selectedItems = selectedEntities();
  if (!state.drawing && !state.moveCommand && !state.offsetCommand) {
    for (const entity of selectedItems) {
      drawSelection(entity, c);
    }
  }

  if (state.drawing) {
    if (state.tool === "polyline") drawPolyline(state.drawing, c, true);
    drawActiveSegment(c);
  } else if (state.moveCommand) {
    drawMoveCommand(c);
  } else if (state.offsetCommand) {
    drawOffsetCommand(c);
  } else if (state.selectedEndpoint) {
    const geometry = selectedEndpointGeometry();
    if (geometry) {
      const previewMoving = lineMetricPreview(state.selectedEndpoint) ?? endpointCursorPoint(geometry);
      drawEditableSegment(geometry.fixed, previewMoving, c, { dashed: true });
      updateSelectedEndpointEditors(previewMoving);
    } else {
      hideInlineEditors();
    }
  } else {
    hideInlineEditors();
  }
  syncSelectionActions();
  syncLineControls();
  syncDimensionLinks();
  drawLineEditMarks(c);
  drawSelectionDrag(c);
  drawDimensionSnapHint(c);
  if (state.tool !== "dimension") drawSnapTracking(c);
  drawCursorSnap(c);
  normalizeDynamicText();
}

function shouldGhostEntityForCommand(entity) {
  if (printRendering) return false;
  if (state.lineEdit?.pending?.replacements.some(([target]) => target.id === entity.id)) return true;
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

function translatePolyline(points, dx, dy) {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function drawMovePreview(entity, dx, dy, c) {
  if (!dx && !dy) return;
  if (entity.type === "polyline") {
    drawPolyline({ ...entity, points: translatePolyline(entity.points, dx, dy) }, c, true, true);
    return;
  }
  if (entity.type === "block") {
    drawBlockOutline({ ...entity, x: entity.x + dx, y: entity.y + dy }, c, true);
    return;
  }
  if (entity.type === "text") {
    drawTextEntity({ ...entity, x: entity.x + dx, y: entity.y + dy }, c);
    return;
  }
  if (entity.type === "circle") {
    drawCircleEntity({ ...entity, cx: entity.cx + dx, cy: entity.cy + dy }, c);
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
  if (entity.type === "polyline") {
    const points = entity.points.map((point) => rotatePointAround(point, command.base, delta));
    drawPolyline({ ...entity, points }, c, true, true);
    return;
  }
  if (entity.type === "block") {
    const center = rotatePointAround({ x: entity.x, y: entity.y }, command.base, delta);
    const preview = { ...entity, x: center.x, y: center.y, rotation: normalizeDegrees((entity.rotation || 0) + radToDeg(delta)) };
    drawBlock(preview, c);
    drawBlockOutline(preview, c);
    return;
  }
  if (entity.type === "text") {
    const position = rotatePointAround({ x: entity.x, y: entity.y }, command.base, delta);
    drawTextEntity({ ...entity, x: position.x, y: position.y, rotation: normalizeDegrees((entity.rotation || 0) + radToDeg(delta)) }, c);
    return;
  }
  if (entity.type === "circle") {
    const position = rotatePointAround({ x: entity.cx, y: entity.cy }, command.base, delta);
    drawCircleEntity({ ...entity, cx: position.x, cy: position.y }, c);
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
  const show = Boolean(editable);
  if (show) syncSelectToolMenu();
  selectionActions.hidden = !show;
  selectionActions.classList.toggle("line-selection-menu", show && isDraftLine(editable));
  syncToolButtons();
}

function editableSelectionEntity() {
  const selected = selectedEntities();
  const primary = selected.length === 1 ? selected[0] : null;
  return primary &&
    !state.drawing &&
    !state.moveCommand &&
    !state.offsetCommand &&
    !state.dimensionAttach &&
    !state.lineEdit &&
    state.tool === "select" &&
    isLayerVisible(primary.layer)
    ? primary
    : null;
}

function linearEditableEntity(entity) {
  return entity && (entity.type === "text" || (entity.type !== "block" && entity.layer !== "dimensions"));
}

function isDirectMoveAnnotation(entity) {
  return entity?.type === "text" || entity?.dimensionKind === "leader";
}

function canApplySelectionAction(action) {
  const selected = selectedEntities().filter((entity) => isLayerVisible(entity.layer));
  if (!selected.length || state.tool !== "select" || state.drawing || state.moveCommand || state.offsetCommand || state.lineEdit) return false;
  if (action === "delete") return true;
  if (lineEditActions.has(action)) return state.tool === "select" && selected.length === 1 && isDraftLine(selected[0]);
  if (selected.length !== 1) return false;
  const entity = selected[0];
  if (action === "move") return true;
  if (entity.type === "polyline") return action === "copy" || action === "rotate";
  if (action === "copy") return entity.type === "block" || linearEditableEntity(entity);
  if (action === "rotate") return entity.type === "block" || linearEditableEntity(entity);
  if (action === "mirror") return entity.type === "block" || linearEditableEntity(entity);
  if (action === "offset") return !["text", "circle"].includes(entity.type) && linearEditableEntity(entity);
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
  return !printRendering && state.tool === "select";
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
  if (state.dimensionAttach?.entityId !== state.selectedId) state.dimensionAttach = null;
  state.directManipulationIds = new Set([...state.directManipulationIds].filter(id => state.selectedIds.includes(id)));
  state.selectedEndpoint = null;
  syncSelectionActions();
}

function entityMatchesSelectionFilter(entity) {
  if (!entity || !isLayerVisible(entity.layer)) return false;
  if (state.selectionFilter === "lines") return ["line", "polyline"].includes(entity.type) && entity.layer !== "dimensions";
  if (state.selectionFilter === "dimensions") return entity.layer === "dimensions";
  return true;
}

function selectableEntities() {
  return state.entities.filter(entityMatchesSelectionFilter);
}

function selectionEntityPoints(entity) {
  if (!entity) return [];
  if (entity.type === "polyline") return entity.points;
  if (entity.type === "block") return blockCorners(entity);
  if (entity.type === "text") return [{ x: entity.x, y: entity.y }];
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
  if (entity?.type === "polyline") return polylineSegments(entity).map(({ p1, p2 }) => [p1, p2]);
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
  const count = selectedEntities().length;
  statusChip.textContent = count > 1 ? `Выбрано: ${count}` : hitId ? "Элемент выбран" : selectionStatusText();
  if (count) {
    state.openEditMenuAfterPointer = true;
    showSelectToolMenuAfterLayout();
  } else {
    hideSelectToolMenu();
  }
}

function drawGrid(rect, c) {
  const active = state.snaps.has("grid");
  const step = active ? adaptiveGridStep() : 500;
  updateGridStepReadout();
  const minor = step * state.view.scale;
  const majorEvery = active ? 5 : 2;
  const startX = ((state.view.panX % minor) + minor) % minor;
  const startY = ((state.view.panY % minor) + minor) % minor;
  const firstColumn = Math.round((startX - state.view.panX) / minor) % majorEvery;
  const firstRow = Math.round((startY - state.view.panY) / minor) % majorEvery;

  ctx.lineWidth = 1;
  for (let x = startX, column = firstColumn; x < rect.width; x += minor, column += 1) {
    ctx.strokeStyle = column % majorEvery === 0 ? c.majorGrid : c.grid;
    linePath(x, 0, x, rect.height);
  }
  for (let y = startY, row = firstRow; y < rect.height; y += minor, row += 1) {
    ctx.strokeStyle = row % majorEvery === 0 ? c.majorGrid : c.grid;
    linePath(0, y, rect.width, y);
  }
}

function drawCanvasCenterCursor(rect, c) {
  const navigating = canvas.matches(":focus-visible") || viewportTools.open;
  if (!navigating && state.tool === "dimension" && state.drawing) return;
  const visible =
    navigating || state.tool !== "select" ||
    Boolean(state.moveCommand || state.offsetCommand || state.selectedEndpoint || state.dimensionAttach);
  if (!visible) return;
  const center = { x: rect.width / 2, y: rect.height / 2 };
  const red = state.theme === "dark" ? "#ff9a9a" : "#a3282d";
  ctx.save();
  ctx.strokeStyle = red;
  ctx.fillStyle = c.bg;
  ctx.lineWidth = 1.5;
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
    const bounds = entity.type === "polyline" ? polylineBounds(entity) : entityBounds(entity);
    if (!bounds) return false;
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
  } else if (entity.type === "polyline") {
    drawPolyline(entity, c);
  } else if (entity.type === "circle") {
    drawCircleEntity(entity, c);
  } else if (entity.type === "rectangle") {
    drawRectangleEntity(entity, c);
  } else if (entity.type === "arc") {
    drawArcEntity(entity, c);
  } else if (entity.type === "block") {
    drawBlock(entity, c);
  } else if (entity.type === "text") {
    drawTextEntity(entity, c);
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

function drawPolyline(entity, c, active = false, dashed = false) {
  if (!entity.points?.length) return;
  ctx.save();
  ctx.strokeStyle = active ? c.accent : c.line;
  ctx.lineWidth = active ? 2.2 : 1.4;
  if (dashed) ctx.setLineDash([8, 6]);
  if (shouldGhostEntityForCommand(entity)) ctx.globalAlpha = 0.28;
  ctx.beginPath();
  for (const [index, point] of entity.points.entries()) {
    const p = worldToScreen(point);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  if (entity.closed) ctx.closePath();
  ctx.stroke();
  ctx.restore();
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
  if (selected && !state.lineEdit) {
    drawEndpointHandle(p1, state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "start", c);
    drawEndpointHandle(p2, state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "end", c);
  }
  ctx.restore();
}

function drawCircleEntity(entity, c) {
  const center = worldToScreen({ x: entity.cx, y: entity.cy });
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  const radius = Math.abs(entity.radius) * state.view.scale;
  ctx.save();
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (selected) {
    drawHandle(center.x, center.y, c);
    drawHandle(center.x + radius, center.y, c);
    drawBadge(`R ${Math.round(Math.abs(entity.radius))} мм`, center.x, center.y - radius - 18, c);
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
  ctx.arc(center.x, center.y, arc.radius * state.view.scale, arc.startAngle, arc.endAngle, !arc.counterClockwise);
  ctx.stroke();
  if (selected) [entity.start, entity.through, entity.end].forEach((point) => { const pt = worldToScreen(point); drawHandle(pt.x, pt.y, c); });
  ctx.restore();
}

function drawTextEntity(entity, c) {
  const p = worldToScreen({ x: entity.x, y: entity.y });
  const height = Math.max(10, Math.abs(entity.height || 260) * state.view.scale);
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(((entity.rotation || 0) * Math.PI) / 180);
  ctx.font = `${height}px Inter, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = selected ? c.accent : c.dimension;
  ctx.fillText(entity.text || "Текст", 0, 0);
  if (selected) {
    const width = Math.max(height * 0.8, ctx.measureText(entity.text || "Текст").width);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-4, -height - 4, width + 8, height + 8);
    ctx.setLineDash([]);
  }
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
  const geometry = dimensionWorldGeometry(entity);
  if (!geometry) return;
  drawDimensionGeometry(geometry.start, geometry.end, c, {
    ...options,
    lineStart: geometry.lineStart,
    lineEnd: geometry.lineEnd,
    displayLength: geometry.measurement,
    offset: geometry.offset * state.view.scale,
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
  const minimumLength = printRendering ? 1e-6 : 8;
  const p1 = worldToScreen(start);
  const p2 = worldToScreen(end);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (length < minimumLength) return;

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
  if (lineLength < minimumLength) return;
  const lineUx = lineDx / lineLength;
  const lineUy = lineDy / lineLength;
  const lineNx = -lineUy;
  const lineNy = lineUx;
  const aLeg = normalizeScreenVector(a.x - legStartPoint.x, a.y - legStartPoint.y, nx * extensionSign, ny * extensionSign);
  const bLeg = normalizeScreenVector(b.x - legEndPoint.x, b.y - legEndPoint.y, nx * extensionSign, ny * extensionSign);
  const aExtension = { x: a.x + aLeg.x * extension, y: a.y + aLeg.y * extension };
  const bExtension = { x: b.x + bLeg.x * extension, y: b.y + bLeg.y * extension };
  const displayLength = Number.isFinite(options.displayLength) ? options.displayLength : distanceWorld(start, end);
  const displayText = `${formatDimensionLength(displayLength)} мм`;
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
  ctx.rotate(((entity.rotation || 0) * Math.PI) / 180);
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
  if (entity.type === "polyline") {
    drawPolyline(entity, c, true);
    for (const point of entity.points) drawEndpointHandle(worldToScreen(point), false, c);
    return;
  }
  if (entity.type === "block") {
    drawBlockOutline(entity, c);
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
    ctx.arc(center.x, center.y, radius, arc.startAngle, arc.endAngle, !arc.counterClockwise);
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
  if (state.lineEdit?.pending?.replacements.some(([target]) => target.id === entity.id)) return;
  const p1 = worldToScreen({ x: entity.x1, y: entity.y1 });
  const p2 = worldToScreen({ x: entity.x2, y: entity.y2 });
  const startActive = state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "start";
  const endActive = state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "end";
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  linePath(p1.x, p1.y, p2.x, p2.y);
  if (state.lineEdit) return;
  drawEndpointHandle(p1, startActive, c);
  drawEndpointHandle(p2, endActive, c);
  if (!startActive && !endActive) {
    const m = midpoint(p1, p2);
    if (isDraftLine(entity) && distanceWorld(p1, p2) > 38) drawEndpointHandle(m, false, c);
    const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
    drawBadge(`${metrics.length} мм`, m.x, m.y - 24, c, false, true);
  }
}

function drawAngularDimensionEntity(entity, c, options = {}) {
  const geometry = angularDimensionGeometry(entity);
  if (!geometry) return;
  const { vertex, arm1: p1World, arm2: p2World, startAngle: a1, sweep: delta, measurement } = geometry;
  const v = worldToScreen(vertex);
  const p1 = worldToScreen(p1World);
  const p2 = worldToScreen(p2World);
  const radius = Math.max(annotationPx(28), Math.min(annotationPx(84), Math.min(pointDistance(v, p1), pointDistance(v, p2)) * 0.52));
  const mid = a1 + delta / 2;
  const degrees = Math.round(measurement);
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
    strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, annotationPx(5));
    ctx.setLineDash([]);
    drawEndpointHandle(arrow, state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "start", c);
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

function isLinearDimension(entity) {
  return entity.type === "line" && entity.layer === "dimensions" &&
    entity.dimensionKind !== "angular" && entity.dimensionKind !== "leader";
}

function dimensionScreenGeometry(entity) {
  if (!isLinearDimension(entity)) return null;
  const geometry = dimensionWorldGeometry(entity);
  if (!geometry) return null;
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
  return dimensionGeometry(entity);
}

function dimensionDisplayLength(entity) {
  return formatDimensionLength(dimensionWorldGeometry(entity));
}

function ensureDimensionLineGeometry(entity) {
  const geometry = dimensionWorldGeometry(entity);
  if (!geometry) return null;
  entity.dimX1 = geometry.lineStart.x;
  entity.dimY1 = geometry.lineStart.y;
  entity.dimX2 = geometry.lineEnd.x;
  entity.dimY2 = geometry.lineEnd.y;
  entity.offset = geometry.offset;
  return geometry;
}

function adoptDimensionMeasurement(entity, geometry) {
  if (entity.measurementType || geometry.mode === "legacy") return;
  entity.measurementType = geometry.mode;
  entity.measurementAxis = geometry.measurementAxis;
  entity.offset = geometry.offset;
}

function moveDimensionLineOffset(entity, pointerPoint) {
  const geometry = dimensionWorldGeometry(entity);
  if (!geometry) return;
  adoptDimensionMeasurement(entity, geometry);
  const axis = geometry.axis;
  const normal = { x: -axis.y, y: axis.x };
  const snapped = snapDimensionLineToOtherDimension(entity, pointerPoint, axis);
  const referencePoint = snapped || pointerPoint;
  const offset = (referencePoint.x - entity.x1) * normal.x + (referencePoint.y - entity.y1) * normal.y;
  entity.offset = offset;
  if (entity.measurementType) ensureDimensionLineGeometry(entity);
  else setDimensionLineAlongAxis(entity, axis, offset);
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
    if (candidate === entity || !isLinearDimension(candidate) || !isLayerVisible(candidate.layer)) continue;
    const geometry = dimensionWorldGeometry(candidate);
    const candidateAxis = geometry?.axis;
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
    if (!isLinearDimension(candidate) || !isLayerVisible(candidate.layer)) continue;
    const geometry = dimensionWorldGeometry(candidate);
    const candidateAxis = geometry?.axis;
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

function drawBlockOutline(entity, c, preview = false) {
  const corners = blockCorners(entity).map(worldToScreen);
  ctx.save();
  if (preview) ctx.globalAlpha = 0.6;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash(preview ? [10, 6] : [7, 5]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
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
  const metricPreview = ["line", "polyline"].includes(state.tool) ? lineMetricPreview(start) : null;
  const end = metricPreview ?? (state.drawing.lockedEnd ? state.drawing.end : cursorWorld());
  if (!metricPreview) state.drawing.end = end;
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
    const provisional = draftDimension(start, end);
    const initialGeometry = dimensionGeometry(provisional);
    if (!initialGeometry) return;
    if (state.drawing.phase === "offset") {
      provisional.offset = draftDimensionOffset(initialGeometry, rawCursorWorld());
    }
    drawDimensionEntity(provisional, c);
    drawHandle(p1.x, p1.y, c);
    drawHandle(p2.x, p2.y, c);
    hideInlineEditors();
    return;
  }

  drawEditableSegment(start, end, c, { lineWidth: 2.2 });
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
  const input = numericConfirmInput();
  const hasDirection = state.tool === "line" && distanceWorld(start, end) > linePointEpsilon;
  lineDirectionArrow.hidden = !hasDirection;
  let description = "";
  if (hasDirection) {
    const radians = angleBetweenPoints(start, end);
    lineDirectionArrow.style.setProperty("--line-direction-angle", `${radians}rad`);
    const direction = lineDirections[(Math.round(radians / (Math.PI / 4)) + 8) % 8];
    description = `Направление ${direction}`;
  }
  if (lineDirectionDescription.textContent !== description) lineDirectionDescription.textContent = description;
  if (input !== lengthInput) {
    lengthInput.value = metrics.length;
  }
  syncInlineEditorWidth(lengthInput);
  positionInlineEditor(lengthEditor, m.x, m.y - 28);
  if (input !== angleInput) {
    angleInput.value = angleInfo.degrees;
    syncInlineEditorWidth(angleInput);
  }
  updateTopMetricInputs(metrics.length, state.tool === "dimension" ? metrics.angle : angleInfo.degrees);
  if (drawMetrics) drawMetrics.hidden = true;
}

function positionAngleEditor(x, y, value) {
  if (angleEditor) angleEditor.hidden = false;
  if (numericConfirmInput() !== angleInput) {
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
  if (angleEditor && !isDraftLine(geometry.entity)) angleEditor.hidden = true;
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
  if (!entity || entity.type === "block" || ![point.x, point.y].every(Number.isFinite)) return;
  if (endpoint.point === "start") {
    entity.x1 = point.x;
    entity.y1 = point.y;
  } else {
    entity.x2 = point.x;
    entity.y2 = point.y;
  }
  updateLinkedDimensions();
  markProjectDirty("endpoint");
}

function endpointCursorPoint(geometry) {
  if (isDraftLine(geometry.entity) && distanceWorld(rawCursorWorld(), geometry.moving) <= linePointEpsilon) return geometry.moving;
  return cursorWorld();
}

function commitSelectedEndpointCursorPoint(beforeOverride = null, explicitPoint = null) {
  const geometry = selectedEndpointGeometry();
  if (!geometry) return false;
  const { entity } = geometry;
  const before = beforeOverride || state.endpointEditBefore || entityGeometry(entity);
  const point = explicitPoint ?? endpointCursorPoint(geometry);
  if (isDraftLine(entity) && !isLinePoint(point)) {
    statusChip.textContent = "Точка вне области координат";
    return false;
  }
  if (distanceWorld(geometry.fixed, point) <= linePointEpsilon) {
    statusChip.textContent = "Концы линии должны различаться";
    return false;
  }
  if (point.x !== geometry.moving.x || point.y !== geometry.moving.y) setSelectedEndpointPosition(point);
  const after = entityGeometry(entity);
  if (geometryChanged(before, after)) {
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    markProjectDirty("endpoint-place");
  }
  clearLineMetricEdit();
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
  window.setTimeout(() => {
    if (document.activeElement === input) input.select();
  }, 0);
}

function editableEntityForNumericInput() {
  if (state.circleRadiusEdit) return state.entities.find((item) => item.id === state.circleRadiusEdit.entityId) || null;
  if (state.selectedEndpoint) return selectedEndpointGeometry()?.entity || null;
  return null;
}

function lineMetricContext() {
  const endpoint = selectedEndpointGeometry();
  if (isDraftLine(endpoint?.entity)) return { key: state.selectedEndpoint, start: endpoint.fixed, end: endpoint.moving, endpoint: true };
  const draft = state.drawing;
  if (draft && ["line", "polyline"].includes(state.tool)) return { key: draft.start, start: draft.start, end: draft.end, endpoint: false };
  return null;
}

function lineMetricPreview(key) {
  const edit = state.numericEdit?.lineMetric;
  return edit?.key === key && isLinePoint(edit.point) ? edit.point : null;
}

function clearLineMetricEdit() {
  if (state.numericEdit?.lineMetric) state.numericEdit = null;
  for (const input of lineMetricKinds.keys()) input?.removeAttribute("aria-invalid");
}

function closeLineMetricInput() {
  const input = document.activeElement;
  if (lineMetricKinds.has(input) && (state.numericEdit?.lineMetric || lineMetricContext())) {
    input.blur();
    window.ZamerAndroid?.dismissKeyboard?.();
    updateViewportLock();
  }
  clearLineMetricEdit();
}

function updateLineMetricInput(input) {
  beginNumericInputEdit(input);
  const edit = state.numericEdit?.lineMetric;
  const kind = lineMetricKinds.get(input);
  if (!edit || !kind) return;
  const value = parseLineDecimal(input.value);
  edit[kind] = kind === "length" && !(value > 0) ? null : value;
  input.removeAttribute("aria-invalid");
  updateLineMetricPreview(edit);
  draw();
}

function updateLineMetricPreview(edit) {
  const draft = state.drawing;
  const originalLength = distanceWorld(edit.start, edit.end);
  const length = edit.length ?? draft?.metricConstraint?.length ?? originalLength;
  const axis = !edit.endpoint && state.tool === "line" && (edit.length > 0 || draft?.metricConstraint?.length > 0)
    ? lineAxisAngle(draft?.metricDirection, edit.start, rawCursorWorld()) : undefined;
  const angle = edit.angle ?? draft?.metricConstraint?.angle ?? axis ??
    (originalLength > linePointEpsilon ? -radToDeg(angleBetweenPoints(edit.start, edit.end)) : undefined);
  edit.point = edit.length === null || edit.angle === null ? null : linePolarPoint(edit.start, length, angle);
}

function confirmLineMetricInput(input, edit) {
  const point = edit.point;
  const empty = edit.length === undefined && edit.angle === undefined;
  if (empty && edit.endpoint) {
    cancelLineMetricInput();
    return;
  }
  if (empty) {
    closeLineMetricInput();
    return;
  }
  const length = edit.length ?? state.drawing?.metricConstraint?.length;
  const angle = edit.angle ?? state.drawing?.metricConstraint?.angle;
  const lengthOnly = !point && length > linePointEpsilon && length <= 2 * Math.SQRT2 * MAX_LINE_COORDINATE && angle === undefined;
  const angleOnly = Number.isFinite(angle) && length === undefined;
  if (!edit.endpoint && distanceWorld(edit.start, edit.end) <= linePointEpsilon &&
      edit.length !== null && edit.angle !== null && (lengthOnly || angleOnly)) {
    const constraint = lengthOnly ? { length } : { angle };
    state.drawing.metricConstraint = constraint;
    closeLineMetricInput();
    statusChip.textContent = constraint.angle === undefined ? "Укажите направление отрезка" : "Укажите конец отрезка вдоль заданного угла";
    draw();
    return;
  }
  if (!isLinePoint(point) || distanceWorld(edit.start, point) <= linePointEpsilon) {
    input.setAttribute("aria-invalid", "true");
    statusChip.textContent = edit.length === null ? "Введите положительную длину" :
      edit.angle === null ? "Введите числовой угол" :
      !point ? "Укажите длину и направление линии" : "Точка линии вне допустимой области";
    return;
  }
  closeLineMetricInput();
  if (edit.endpoint) commitSelectedEndpointCursorPoint(null, point);
  else commitLinePoint(point);
}

function cancelLineMetricInput() {
  const edit = state.numericEdit?.lineMetric;
  closeLineMetricInput();
  if (edit?.endpoint || isDraftLine(selectedEndpointGeometry()?.entity)) {
    state.selectedEndpoint = null;
    state.endpointEditBefore = null;
    hideInlineEditors();
    resetSnapTracking();
    statusChip.textContent = "Правка конца отменена";
  } else {
    statusChip.textContent = "Ввод длины и угла отменён";
  }
  draw();
}

function beginNumericInputEdit(input) {
  const lineContext = lineMetricKinds.has(input) && lineMetricContext();
  if (lineContext) {
    if (state.numericEdit?.lineMetric?.key === lineContext.key) return;
    commitNumericInputEdit();
    state.numericEdit = { lineMetric: { ...lineContext, point: null } };
    return;
  }
  clearLineMetricEdit();
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
  if (!edit || edit.lineMetric) return;
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
  const input = numericConfirmInput();
  if (!input) return;
  if (input !== document.activeElement) input.focus({ preventScroll: true });
  if (lineMetricKinds.has(input) && lineMetricContext()) {
    beginNumericInputEdit(input);
    confirmLineMetricInput(input, state.numericEdit.lineMetric);
    return;
  }
  const shouldFinishEndpoint = Boolean(
    state.selectedEndpoint && [lengthInput, angleInput, topLengthInput, topAngleInput].includes(input)
  );
  const shouldFinishCircleRadius = Boolean(
    state.circleRadiusEdit && [lengthInput, topLengthInput].includes(input)
  );
  if (input === lengthInput) {
    applyInlineValue("length", { recordUndo: false });
  } else if (input === angleInput) {
    applyInlineValue("angle", { recordUndo: false });
  } else if (input === topLengthInput) {
    applyTopMetricValue("length", { recordUndo: false });
  } else if (input === topAngleInput) {
    applyTopMetricValue("angle", { recordUndo: false });
  }
  const shouldFinishDrawing = Boolean(
      state.drawing?.lockedEnd &&
      ["line", "polyline", "circle", "rectangle"].includes(state.tool) &&
      [lengthInput, angleInput, topLengthInput, topAngleInput].includes(input)
  );
  commitNumericInputEdit();
  if (shouldFinishEndpoint) {
    finishSelectedEndpointNumericEdit();
  } else if (shouldFinishCircleRadius) {
    hideInlineEditors();
    statusChip.textContent = "Радиус круга применен";
    draw();
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
  if (!state.snaps.has("ortho")) state.snaps.add("polar");
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
  if (isDraftLine(actionEntity) && lineOnlyEditActions.has(action)) {
    startLineEdit(action, actionEntity);
    return;
  }
  if (action === "move") {
    startMoveLikeCommand(actionEntity, "move");
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
    statusChip.textContent = "Объект отзеркален";
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

  if (isLineSnapContext() &&
      Math.abs(safeX - rect.width / 2) <= editorWidth / 2 + 22 &&
      Math.abs(safeY - rect.height / 2) <= editorHeight / 2 + 22) {
    safeY = rect.height / 2 + (editorHeight / 2 + 24) * (editor === lengthEditor ? -1 : 1);
  }
  editor.style.left = `${safeX}px`;
  editor.style.top = `${safeY}px`;
}

function hideInlineEditors() {
  lineDirectionArrow.hidden = true;
  if (lineDirectionDescription.textContent) lineDirectionDescription.textContent = "";
  if (state.numericEdit?.lineMetric) closeLineMetricInput();
  if (inlineEditors) {
    inlineEditors.hidden = true;
  }
  if (drawMetrics) {
    drawMetrics.hidden = true;
    updateTopMetricLabels();
  }
  state.inlineEdit = null;
  state.circleRadiusEdit = null;
}

function circleRadiusScreenGeometry(entity) {
  if (!entity || entity.type !== "circle") return null;
  const center = worldToScreen({ x: entity.cx, y: entity.cy });
  const radius = Math.abs(entity.radius || 0) * state.view.scale;
  const label = { x: center.x, y: center.y - radius - 18 };
  const text = `R ${Math.round(Math.abs(entity.radius || 0))} мм`;
  const fontSize = annotationPx(12);
  const width = Math.max(54, text.length * fontSize * 0.58 + annotationPx(16));
  const height = annotationPx(24);
  return {
    center,
    handle: { x: center.x + radius, y: center.y },
    label,
    labelRect: { x: label.x - width / 2, y: label.y - height / 2, width, height },
  };
}

function hitCircleControl(screen) {
  if (state.tool !== "select") return null;
  const entity = state.selectedId ? state.entities.find((item) => item.id === state.selectedId) : null;
  if (!entity || entity.type !== "circle" || !isLayerVisible(entity.layer)) return null;
  const geometry = circleRadiusScreenGeometry(entity);
  if (!geometry) return null;
  if (pointDistance(screen, geometry.handle) <= 24) return { type: "circle-radius", entity };
  if (screenRectDistance(screen, geometry.labelRect) <= 12) return { type: "circle-radius-input", entity };
  return null;
}

function showCircleRadiusEditor(entity) {
  if (!entity || entity.type !== "circle" || !inlineEditors || !lengthEditor || !lengthInput) return;
  const geometry = circleRadiusScreenGeometry(entity);
  if (!geometry) return;
  inlineEditors.hidden = false;
  state.circleRadiusEdit = { entityId: entity.id, before: entityGeometry(entity) };
  state.inlineEdit = null;
  lengthEditor.hidden = false;
  if (angleEditor) angleEditor.hidden = true;
  lengthInput.value = Math.round(Math.abs(entity.radius || 0));
  syncInlineEditorWidth(lengthInput);
  positionInlineEditor(lengthEditor, geometry.label.x, geometry.label.y);
  lengthInput.focus({ preventScroll: true });
  selectInlineValue(lengthInput);
  updateTopMetricInputs(Math.round(Math.abs(entity.radius || 0)), 0);
  statusChip.textContent = "Круг: введите радиус";
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
  leaderTextEditor.style.setProperty("--leader-editor-top", `${top}px`);
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
  if (leaderTextEditor?.contains(document.activeElement)) {
    document.activeElement.blur();
    window.ZamerAndroid?.dismissKeyboard?.();
  }
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

function editLeaderText(entity) {
  if (!entity || entity.dimensionKind !== "leader") return;
  const before = entityGeometry(entity);
  showProjectDialog({
    title: "Текст выноски",
    value: decodeMojibakeText(entity.text || "Текст"),
    placeholder: "Текст выноски",
    inputLabel: "Текст выноски",
    confirmText: "Готово",
  }).then((text) => {
    if (!text) return;
    entity.text = text;
    const after = entityGeometry(entity);
    if (geometryChanged(before, after)) {
      state.undo.push({ type: "move", entityId: entity.id, before, after });
      state.redo.length = 0;
      markProjectDirty("leader-text");
    }
    setSelection(entity.id);
    statusChip.textContent = "Текст выноски изменен";
    draw();
  });
}

function editTextEntity(entity) {
  if (!entity || entity.type !== "text") return;
  const before = entityGeometry(entity);
  askCadText(decodeMojibakeText(entity.text || "Текст")).then((text) => {
    if (!text) return;
    entity.text = text;
    const after = entityGeometry(entity);
    if (geometryChanged(before, after)) {
      state.undo.push({ type: "move", entityId: entity.id, before, after });
      state.redo.length = 0;
      markProjectDirty("text-edit");
    }
    setSelection(entity.id);
    state.lastTextTap = null;
    statusChip.textContent = "Текст изменен";
    draw();
  });
}

function shouldEditTextFromTap(entity, screen) {
  if (!entity || entity.type !== "text") {
    state.lastTextTap = null;
    return false;
  }
  const now = Date.now();
  const previous = state.lastTextTap;
  const isDoubleTap =
    previous?.id === entity.id &&
    now - previous.time <= 420 &&
    pointDistance(screen, previous.screen) <= 24;
  state.lastTextTap = { id: entity.id, time: now, screen };
  return isDoubleTap;
}

function createTextAtPoint(point) {
  const anchor = { x: point.x, y: point.y };
  statusChip.textContent = "Текст: введите надпись";
  askCadText().then((text) => {
    if (!text) {
      statusChip.textContent = "Текст отменен";
      draw();
      return;
    }
    const entity = textEntity(`text-${Date.now()}`, anchor.x, anchor.y, text);
    pushEntity(entity);
    state.drawing = null;
    resetSnapTracking();
    state.selectTool = "select";
    setTool("select");
    showSelectToolMenuAfterLayout();
    statusChip.textContent = "Текст поставлен";
    draw();
  });
}

function applyInlineValue(kind, options = {}) {
  if (state.circleRadiusEdit) {
    applyCircleRadiusInlineValue(options);
    return;
  }
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
  const angleInfo = state.inlineEdit.angleInfo;
  if (state.tool === "line" && !String(lengthInput.value).trim()) return;
  if (kind === "angle" && String(angleInput.value).trim() && Number.isFinite(typedAngle)) {
    if (angleInfo?.cadAngle) {
      nextRad = -(typedAngle % 360) * Math.PI / 180;
    } else if (angleInfo?.hasReference) {
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
    if (angleInfo?.cadAngle) {
      nextRad = -(typedAngle % 360) * Math.PI / 180;
    } else if (angleInfo?.hasReference) {
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

function drawBadge(text, x, y, c, secondary = false, fixedScreenSize = false, showSnapName = false) {
  text = decodeMojibakeText(String(text));
  if (!showSnapName && /\u041f\u0430\u0440\u0430\u043b\u043b\u0435\u043b\u044c|\u0422\u043e\u0447\u043a\u0430|\u041a\u043e\u043d\u0435\u0446|\u0421\u0435\u0440\u0435\u0434\u0438\u043d\u0430|\u041f\u0430\u0440\u0430|\u0422\u043e\u0447|\u0421\u0435\u0440\u0435\u0434/.test(text)) return;
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
  if (state.skipLineObjectSnap || !canCreateSnapTrackingPoint()) {
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
  const degrees = normalizeDegrees(isLineSnapContext() ? -guide.degrees : guide.degrees);
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
  state.dimensionSnapChoice = null;
}

function drawCursorSnap(c) {
  const dimensionStage = state.tool === "dimension" && !surveyPointPicker ? state.drawing?.phase : null;
  const chooseAxis = state.dimensionTool === "linear" && dimensionStage === "offset";
  const selectOnly = state.tool === "select" && !state.moveCommand && !state.selectedEndpoint && !state.dimensionAttach;
  const resolved = selectOnly || dimensionStage === "offset" ? null : cursorSnapResolved();
  const chooseSnap = state.tool === "dimension" && !surveyPointPicker && resolved?.snapCount > 1;
  dimensionAxisControl.hidden = !chooseAxis;
  dimensionNextSnap.hidden = !chooseSnap;
  dimensionAssist.hidden = !chooseAxis && !chooseSnap;
  if (chooseAxis) {
    const { start, end, axisOverride } = state.drawing;
    dimensionAxis.value = axisOverride ?? "";
    dimensionAxis.options[1].disabled = Math.abs(start.x - end.x) <= linePointEpsilon;
    dimensionAxis.options[2].disabled = Math.abs(start.y - end.y) <= linePointEpsilon;
  }
  if (chooseSnap) {
    const label = `Другая точка, привязка ${resolved.snapIndex + 1} из ${resolved.snapCount}`;
    if (dimensionNextSnap.getAttribute("aria-label") !== label) dimensionNextSnap.setAttribute("aria-label", label);
  }
  if (!resolved?.snap) return;
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
  } else if (snap?.type === "intersection" || snap?.type === "perpendicular") {
    const size = 7;
    if (snap.type === "intersection") {
      linePath(p.x - size, p.y - size, p.x + size, p.y + size);
      linePath(p.x - size, p.y + size, p.x + size, p.y - size);
    } else {
      linePath(p.x - size, p.y + size, p.x + size, p.y + size);
      linePath(p.x, p.y - size, p.x, p.y + size);
    }
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
  if (state.tool === "dimension" || state.dimensionAttach) {
    const label = { intersection: "Пересечение", perpendicular: "Перпендикуляр", nearest: "Ближайшая" }[snap.type]
      || (isMidSnap(snap) ? "Середина" : snap.label || "Конец");
    drawBadge(label, p.x, p.y - 21, c, false, true, true);
  }
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

function isLineSnapContext() {
  return state.tool === "line" || state.tool === "polyline" || isDraftLine(selectedEndpointGeometry()?.entity) ||
    state.pointer?.mode === "line-grip" || ["offset", "mirror", "scale"].includes(state.lineEdit?.mode);
}

function nearestDraftLineSnap(point, start) {
  const perpendicular = start && state.snaps.has("perpendicular");
  const intersection = state.snaps.has("intersection");
  if (!perpendicular && !intersection) return null;
  const threshold = objectSnapThreshold();
  const excluded = state.selectedEndpoint?.entityId || state.pointer?.grip?.entityId;
  const boundaries = boundarySegments(excluded);
  const crossing = intersection ? nearestIntersection(point, boundaries, threshold) : null;
  const foot = perpendicular ? nearestPerpendicular(point, start, boundaries, threshold) : null;
  if (!crossing || (foot && distanceWorld(foot, point) < distanceWorld(crossing, point))) return foot;
  return crossing;
}

function nearestObjectSnap(point, { includeNearestSegment = false, start = null } = {}) {
  const objectThreshold = objectSnapThreshold();
  const midpointThreshold = midpointSnapThreshold();
  const nearestThreshold = nearestSegmentSnapThreshold();
  const lineContext = isLineSnapContext();
  const excluded = lineContext ? state.selectedEndpoint?.entityId || state.pointer?.grip?.entityId : null;
  if (lineContext) {
    const explicit = nearestDraftLineSnap(point, start);
    if (explicit) return explicit;
  }
  const useObjectSnap = state.tool === "dimension" || state.snaps.has("end");
  if (useObjectSnap) {
    const corner = nearestSnapCandidate(point, snapCandidates({ includeCorners: true, excludeId: excluded }), objectThreshold);
    if (corner) return corner;
  }
  if (state.snaps.has("mid")) {
    const mid = nearestSnapCandidate(point, snapCandidates({ includeMidpoints: true, includeCenters: !lineContext, excludeId: excluded }), midpointThreshold);
    if (mid) return mid;
  }
  if (includeNearestSegment && (lineContext ? state.snaps.has("nearest") : useObjectSnap)) {
    return lineContext
      ? nearestBoundaryPoint(point, boundarySegments(excluded), nearestThreshold)
      : nearestPointOnDrawableSegment(point, nearestThreshold, excluded);
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

function applyCircleRadiusInlineValue(options = {}) {
  const { recordUndo = true } = options;
  const edit = state.circleRadiusEdit;
  const entity = edit ? state.entities.find((item) => item.id === edit.entityId) : null;
  if (!entity || entity.type !== "circle") return;
  const typedRadius = Number(lengthInput.value.replace(",", "."));
  if (!Number.isFinite(typedRadius) || typedRadius <= 0) return;
  const before = edit.before || entityGeometry(entity);
  entity.radius = typedRadius;
  const after = entityGeometry(entity);
  const changed = geometryChanged(before, after);
  if (recordUndo && changed) {
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    state.circleRadiusEdit.before = after;
  }
  if (changed) markProjectDirty("circle-radius-input");
  updateTopMetricInputs(Math.round(Math.abs(entity.radius)), 0);
  draw();
}

function strokeRoundedRect(x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.stroke();
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
  if (isLineSnapContext()) {
    const degrees = (Math.round(normalizeDegrees(-radToDeg(currentRad)) * 1000) / 1000) % 360;
    return { referenceRad: 0, deltaRad: currentRad, degrees, hasReference: false, cadAngle: true };
  }
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
    } else if (entity.type === "polyline") {
      for (const segment of polylineSegments(entity)) segments.push({ ...segment, entity });
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

function updateGridStepReadout() {
  if (!gridStepReadout) return;
  const enabled = state.snaps.has("grid");
  const step = adaptiveGridStep();
  const value = enabled ? `${step} мм` : "Сетка";
  if (gridStepReadout.textContent !== value) gridStepReadout.textContent = value;
  const button = gridStepReadout.closest("button");
  const label = enabled ? `Привязка к сетке, шаг ${step} мм` : "Привязка к сетке";
  if (button.title !== label) {
    button.title = label;
    button.setAttribute("aria-label", label);
  }
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

function panViewport(dx, dy, fine = false) {
  const step = fine ? 4 : 18;
  state.view.panX -= dx * step;
  state.view.panY -= dy * step;
  markProjectDirty("view");
  draw();
}

function zoomViewport(factor) {
  zoomAtScreen(centerScreen(), state.view.scale * factor);
  viewportActionStatus.textContent = `Масштаб вида: ${Math.round(state.view.scale / 0.085 * 100)}%`;
  draw();
}

function boundsFromViewportPoints(points) {
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

function viewportEntityBounds(entity) {
  if (entity.type === "polyline") return polylineBounds(entity);
  if (entity.type === "block") return boundsFromViewportPoints(blockCorners(entity));
  if (entity.type === "arc") {
    const arc = arcGeometry(entity.start, entity.through, entity.end);
    if (!arc) return entityBounds(entity);
    const points = [entity.start, entity.through, entity.end];
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      if (angleOnArc(angle, arc.startAngle, arc.endAngle, arc.counterClockwise)) {
        points.push({ x: arc.center.x + Math.cos(angle) * arc.radius, y: arc.center.y + Math.sin(angle) * arc.radius });
      }
    }
    return boundsFromViewportPoints(points);
  }
  const bounds = entityBounds(entity);
  if (entity.type === "wall") {
    const radius = Math.abs(entity.width || 0) / 2;
    return { minX: bounds.minX - radius, minY: bounds.minY - radius, maxX: bounds.maxX + radius, maxY: bounds.maxY + radius };
  }
  return bounds;
}

const viewportObjectNames = {
  line: "Линия", wall: "Стена", polyline: "Полилиния", circle: "Круг",
  rectangle: "Прямоугольник", arc: "Дуга", block: "Блок",
};

function viewportObjectLabel(entity) {
  if (entity.type === "line" && entity.layer === "dimensions") {
    if (entity.dimensionKind === "leader") return `Выноска · ${entity.text || "Текст"}`;
    if (entity.dimensionKind === "angular") {
      const angle = angularDimensionGeometry(entity)?.measurement;
      return Number.isFinite(angle) ? `Угловой размер · ${Math.round(angle)}°` : "Угловой размер";
    }
    const length = dimensionDisplayLength(entity);
    return length ? `Размер · ${length} мм` : "Размер";
  }
  if (entity.type === "text") return `Текст · ${entity.text || "Надпись"}`;
  const name = viewportObjectNames[entity.type] || "Объект";
  if (["line", "wall"].includes(entity.type) && isValidLine(entity)) {
    return `${name} · ${formatDimensionLength(Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1))} мм`;
  }
  return name;
}

function locateViewportObject(id, label) {
  const entity = state.entities.find((item) => item.id === id && isLayerVisible(item.layer));
  if (!entity) return false;
  const bounds = viewportEntityBounds(entity);
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) return false;
  setTool("select");
  setSelection(id);
  centerViewOnWorldPoint({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
  viewportActionStatus.textContent = `На чертеже выбран объект «${label}»`;
  canvas.focus({ preventScroll: true });
  draw();
  return true;
}

function openViewportObjects() {
  const objects = state.entities.filter((entity) => isLayerVisible(entity.layer)).map((entity) => {
    const label = viewportObjectLabel(entity);
    const layer = layerMeta[entity.layer || "measure"]?.name || entity.layer;
    return { id: entity.id, label, layer, searchText: `${label} ${layer}`.toLocaleLowerCase("ru-RU") };
  });
  const dialog = document.createElement("dialog");
  dialog.className = "project-dialog viewport-objects-dialog";
  dialog.setAttribute("aria-labelledby", "viewportObjectTitle");
  dialog.innerHTML = `
    <strong id="viewportObjectTitle">Объекты чертежа</strong>
    <input type="search" aria-label="Поиск объекта" placeholder="Тип, размер или слой" autocomplete="off">
    <p role="status"></p>
    <ul aria-label="Видимые объекты"></ul>
    <div class="viewport-object-pages" aria-label="Страницы списка" role="group">
      <button type="button" data-page="previous">Назад</button>
      <button type="button" data-page="next">Дальше</button>
    </div>
    <button class="viewport-object-close" type="button">Закрыть</button>
  `;
  const search = dialog.querySelector("input");
  const status = dialog.querySelector("p");
  const list = dialog.querySelector("ul");
  const pages = dialog.querySelector(".viewport-object-pages");
  const previous = pages.querySelector('[data-page="previous"]');
  const next = pages.querySelector('[data-page="next"]');
  const pageSize = 40;
  let page = 0;
  let matches = objects;
  let selected = null;

  function renderPage() {
    const start = page * pageSize;
    const end = Math.min(start + pageSize, matches.length);
    list.replaceChildren();
    for (const object of matches.slice(start, end)) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const label = document.createElement("strong");
      label.textContent = object.label;
      const layer = document.createElement("small");
      layer.textContent = object.layer;
      button.append(label, layer);
      button.addEventListener("click", () => {
        selected = object;
        dialog.close();
      });
      row.append(button);
      list.append(row);
    }
    status.textContent = matches.length ? `Показано ${start + 1}–${end} из ${matches.length}`
      : objects.length ? "Объекты не найдены" : "На видимых слоях нет объектов";
    pages.hidden = matches.length <= pageSize;
    previous.disabled = page === 0;
    next.disabled = end === matches.length;
    list.scrollTop = 0;
  }

  search.addEventListener("input", () => {
    const terms = search.value.trim().toLocaleLowerCase("ru-RU").split(/\s+/);
    matches = objects.filter((object) => terms.every((term) => object.searchText.includes(term)));
    page = 0;
    renderPage();
  });
  previous.addEventListener("click", () => { page -= 1; renderPage(); list.querySelector("button")?.focus(); });
  next.addEventListener("click", () => { page += 1; renderPage(); list.querySelector("button")?.focus(); });
  dialog.querySelector(".viewport-object-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (!selected || !locateViewportObject(selected.id, selected.label)) viewportSummary.focus({ preventScroll: true });
  }, { once: true });
  renderPage();
  shell.append(dialog);
  dialog.showModal();
  dialog.querySelector(".viewport-object-close").focus({ preventScroll: true });
}

function fitViewport() {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const entity of state.entities) {
    if (!isLayerVisible(entity.layer)) continue;
    const extent = viewportEntityBounds(entity);
    if (!extent || !Object.values(extent).every(Number.isFinite)) continue;
    bounds.minX = Math.min(bounds.minX, extent.minX);
    bounds.minY = Math.min(bounds.minY, extent.minY);
    bounds.maxX = Math.max(bounds.maxX, extent.maxX);
    bounds.maxY = Math.max(bounds.maxY, extent.maxY);
  }
  if (!Number.isFinite(bounds.minX)) {
    viewportActionStatus.textContent = "Нет видимых объектов для вписывания";
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const bottomPanels = [shell.querySelector(".tool-rail"), selectionActions, lineUi.lineEditOptions].filter((panel) => panel && !panel.hidden);
  const availableTop = Math.max(38, statusChip.offsetHeight, saveIndicator.offsetHeight) + 18;
  const availableBottom = Math.min(rect.height, ...bottomPanels.map((panel) => panel.getBoundingClientRect().top - rect.top)) - 18;
  const fitScale = Math.min(Math.max(1, rect.width - 44) / Math.max(1, bounds.maxX - bounds.minX),
    Math.max(1, availableBottom - availableTop) / Math.max(1, bounds.maxY - bounds.minY));
  const scale = clampScale(fitScale);
  state.view.scale = scale;
  state.view.panX = rect.width / 2 - (bounds.minX + bounds.maxX) / 2 * scale;
  state.view.panY = (availableTop + availableBottom) / 2 - (bounds.minY + bounds.maxY) / 2 * scale;
  viewportActionStatus.textContent = fitScale < scale
    ? "Достигнут минимальный масштаб вида"
    : "Видимые объекты вписаны в холст";
  markProjectDirty("view");
  draw();
}

function viewportIsSelecting() {
  return state.tool === "select" && !state.lineEdit && !state.moveCommand && !state.offsetCommand && !state.selectedEndpoint && !state.dimensionAttach;
}

function placeAtViewportCenter() {
  if (surveyPointPicker) {
    commitSurveyPoint();
  } else if (state.lineEdit) {
    pickLineEditPoint(centerScreen());
  } else if (viewportIsSelecting()) {
    applyTapSelection(pickEntity(centerScreen()));
    draw();
  } else {
    commitCursorPoint();
  }
}

function syncViewportPlaceLabel() {
  const label = viewportIsSelecting() ? "Выбрать объект в центре" : "Поставить точку в центре";
  if (viewportPlaceButton.getAttribute("aria-label") !== label) {
    viewportPlaceButton.setAttribute("aria-label", label);
    viewportPlaceButton.title = label;
  }
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
  draw();
}

function endPinchGestureIfNeeded() {
  if (state.activePointers.size >= 2) {
    beginPinchGesture();
    return;
  }
  if (state.pinch && !state.lineEdit) {
    statusChip.textContent = `Масштаб ${Math.round(state.view.scale / 0.085 * 100)}%`;
  }
  state.pinch = null;
}

function snapWorld(point) {
  return resolveSnapWorld(point).point;
}

function resolveSnapWorld(point, { objectSnaps = true } = {}) {
  const trackingThreshold = objectSnapThreshold();
  let result = { ...point };
  let snap = null;
  state.snapTracking.active = null;
  state.polarSnapGuide = null;

  if (objectSnaps) snap = nearestObjectSnap(point, { includeNearestSegment: state.tool === "line" || state.tool === "polyline" });
  if (snap) {
    result = { x: snap.x, y: snap.y };
  } else if (objectSnaps && canUseSnapTracking()) {
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

function resolveDimensionPointSnap(point, { start = state.drawing?.start } = {}) {
  state.snapTracking.active = null;
  state.polarSnapGuide = null;
  const threshold = objectSnapThreshold();
  const useIntersection = state.snaps.has("intersection");
  const usePerpendicular = start && state.snaps.has("perpendicular");
  const useNearest = state.snaps.has("nearest");
  const boundaries = (useIntersection || usePerpendicular || useNearest) ? boundarySegments() : [];
  const candidates = [];
  if (useIntersection) candidates.push(...nearbyIntersections(point, boundaries, threshold));
  if (usePerpendicular) candidates.push(...nearbyPerpendiculars(point, start, boundaries, threshold));
  if (state.snaps.has("end")) {
    for (const candidate of snapCandidates({ includeCorners: true })) {
      if (distanceWorld(point, candidate) < threshold) candidates.push(candidate);
    }
  }
  if (state.snaps.has("mid")) {
    for (const candidate of snapCandidates({ includeMidpoints: true, includeCenters: true })) {
      if (distanceWorld(point, candidate) < midpointSnapThreshold()) candidates.push(candidate);
    }
  }
  candidates.sort((first, second) => distanceWorld(point, first) - distanceWorld(point, second));
  if (useNearest) candidates.push(...nearbyBoundaryPoints(point, boundaries, nearestSegmentSnapThreshold()));
  const distinct = [];
  for (const candidate of candidates) {
    if (!distinct.some(snap => distanceWorld(snap, candidate) <= linePointEpsilon)) distinct.push(candidate);
    if (distinct.length >= 12) break;
  }
  const choice = !surveyPointPicker && state.tool === "dimension" ? state.dimensionSnapChoice : null;
  const useChoice = choice && distanceWorld(point, choice.origin) * state.view.scale < 2;
  if (choice && !useChoice) state.dimensionSnapChoice = null;
  const snapIndex = useChoice && choice.index < distinct.length ? choice.index : 0;
  const snap = distinct[snapIndex];
  if (snap) return { point: { x: snap.x, y: snap.y }, snap, snapCount: distinct.length, snapIndex };
  if (!state.snaps.has("grid")) return { point, snap: null };
  return { point: { x: snapValueToGrid(point.x), y: snapValueToGrid(point.y) }, snap: null };
}

function resolveLineLikeSnap(point, start, { useGrid = true, objectSnaps = true } = {}) {
  const directionThreshold = objectSnapThreshold();
  let result = { ...point };
  let snap = null;
  state.snapTracking.active = null;
  state.polarSnapGuide = null;

  const ortho = isLineSnapContext() && state.snaps.has("ortho");
  const grid = useGrid && state.snaps.has("grid");
  if (objectSnaps) snap = nearestObjectSnap(point, { includeNearestSegment: !ortho && trackingDrawingTools.has(state.tool), start });
  if (ortho && !snap) {
    const constrained = constrainLinePoint(start, point);
    if (!constrained) return { point: result, snap: null };
    if (grid) {
      for (const axis of ["x", "y"]) {
        const delta = constrained[axis] - start[axis];
        if (!delta) continue;
        const rounded = snapValueToGrid(constrained[axis]);
        if ((rounded - start[axis]) * delta > 0) constrained[axis] = rounded;
      }
    }
    return { point: constrained, snap: null };
  }
  if (snap) {
    result = { x: snap.x, y: snap.y };
  } else if (!objectSnaps) {
    if (grid) result = { x: snapValueToGrid(point.x), y: snapValueToGrid(point.y) };
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
          } else if (grid) {
            result.x = snapValueToGrid(result.x);
            result.y = snapValueToGrid(result.y);
          }
        }
      } else {
        const nearest = nearestObjectSnap(point, { includeNearestSegment: true });
        if (nearest) {
          result = { x: nearest.x, y: nearest.y };
          snap = nearest;
        } else if (grid) {
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

function nearestPointOnDrawableSegment(point, threshold, excludeId = null) {
  let best = null;
  for (const segment of drawableSnapSegments()) {
    if (segment.entity.id === excludeId) continue;
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

function snapCandidates({ includeCorners = false, includeMidpoints = false, includeCenters = false, excludeId = null } = {}) {
  const candidates = [];
  for (const entity of state.entities) {
    if (entity.id === excludeId || !isLayerVisible(entity.layer) || entity.layer === "dimensions") continue;
    for (const point of objectPointRefs(entity)) {
      const role = point.snapRole || point.pointKey;
      const allowed =
        (includeCorners && ["start", "end", "corner", "quadrant", "arc-point"].includes(role)) ||
        (includeMidpoints && role === "mid") ||
        (includeCenters && role === "center");
      if (allowed) {
        candidates.push({ ...point, entityId: entity.id, label: point.label || snapPointLabel(role) });
      }
    }
  }
  return candidates;
}

function snapPointLabel(role) {
  if (role === "center") return "Центр";
  if (role === "mid") return "Середина";
  if (role === "corner") return "Угол";
  if (role === "quadrant") return "Квадрант";
  return "Конец";
}

function dimensionRefFromSnap(snap) {
  if (!snap?.entityId || !snap?.pointKey) return null;
  return { entityId: snap.entityId, pointKey: snap.pointKey };
}

function dimensionAnchorLink(entity, endpoint) {
  const start = endpoint === "start";
  const ref = start ? entity.refStart : entity.refEnd;
  if (ref) return dimensionLinkedPoint(ref) ? "linked" : "lost";
  return (start ? entity.lostRefStart : entity.lostRefEnd) ? "lost" : "fixed";
}

function selectedLinearDimension() {
  if (state.tool !== "select" || state.selectedIds.length !== 1 || state.moveCommand ||
      state.offsetCommand || state.lineEdit || surveyPointPicker) return null;
  const entity = selectedEntities()[0];
  return entity && isLinearDimension(entity) && isLayerVisible(entity.layer) ? entity : null;
}

function syncDimensionLinks() {
  const entity = selectedLinearDimension();
  dimensionLinks.hidden = !entity;
  if (!entity) return;
  const picking = state.dimensionAttach?.entityId === entity.id;
  dimensionLinkCancel.hidden = picking !== true;
  const descriptions = { linked: "Связано", fixed: "Фиксировано", lost: "Связь потеряна" };
  for (const button of dimensionLinkButtons) {
    button.hidden = picking;
    const endpoint = button.dataset.dimensionAnchor;
    const link = dimensionAnchorLink(entity, endpoint);
    button.dataset.link = link;
    const label = button.querySelector("small");
    if (label.textContent !== descriptions[link]) {
      label.textContent = descriptions[link];
      button.setAttribute("aria-label", `Привязать ${endpoint === "start" ? "начало" : "конец"}. ${descriptions[link]}`);
    }
  }
}

function dimensionAttachCandidate(point) {
  const candidates = snapCandidates({ includeCorners: true, includeMidpoints: true, includeCenters: true });
  return nearestSnapCandidate(point, candidates, objectSnapThreshold());
}

function startDimensionAttach(endpoint) {
  const entity = selectedLinearDimension();
  if (!entity) return;
  state.dimensionAttach = { entityId: entity.id, endpoint };
  statusChip.textContent = `Привязка ${endpoint === "start" ? "начала" : "конца"}. Наведите на опорную точку и коснитесь холста`;
  canvas.focus({ preventScroll: true });
  draw();
}

function cancelDimensionAttach() {
  if (!state.dimensionAttach) return;
  state.dimensionAttach = null;
  statusChip.textContent = "Привязка размера отменена";
  draw();
}

function commitDimensionAttach() {
  const { entityId, endpoint } = state.dimensionAttach;
  const entity = state.entities.find(item => item.id === entityId);
  if (!entity) {
    cancelDimensionAttach();
    return;
  }
  const snap = dimensionAttachCandidate(rawCursorWorld());
  const ref = dimensionRefFromSnap(snap);
  if (!ref) {
    statusChip.textContent = "Наведите на конец, угол, середину или центр объекта";
    return;
  }
  const start = endpoint === "start";
  const before = entityGeometry(entity);
  const candidate = { ...entity, ...(start
    ? { x1: snap.x, y1: snap.y, refStart: ref, lostRefStart: false }
    : { x2: snap.x, y2: snap.y, refEnd: ref, lostRefEnd: false }) };
  const geometry = dimensionGeometry(entity);
  if (!geometry) return;
  adoptDimensionMeasurement(candidate, geometry);
  if (candidate.measurementType) ensureDimensionLineGeometry(candidate);
  else setDimensionLineAlongAxis(candidate, geometry.axis, geometry.offset);
  if ((dimensionGeometry(candidate)?.measurement ?? 0) <= linePointEpsilon) {
    statusChip.textContent = "Выберите другую опору. Размер в выбранных точках равен нулю";
    return;
  }
  const after = entityGeometry(candidate);
  Object.assign(entity, after);
  if (geometryChanged(before, after)) {
    state.undo.push({ type: "move", entityId, before, after });
    state.redo.length = 0;
    markProjectDirty("dimension-reattach");
  }
  state.dimensionAttach = null;
  statusChip.textContent = `Опора привязана. Размер ${dimensionDisplayLength(entity)} мм`;
  draw();
}

function updateLinkedDimensions() {
  for (const entity of state.entities) {
    if (!isLinearDimension(entity)) continue;
    const nextStart = dimensionLinkedPoint(entity.refStart);
    const nextEnd = dimensionLinkedPoint(entity.refEnd);
    const changedStart = nextStart && (entity.x1 !== nextStart.x || entity.y1 !== nextStart.y);
    const changedEnd = nextEnd && (entity.x2 !== nextEnd.x || entity.y2 !== nextEnd.y);
    if (!changedStart && !changedEnd) continue;
    const previous = dimensionWorldGeometry(entity);
    if (!previous) continue;
    adoptDimensionMeasurement(entity, previous);
    if (nextStart) {
      entity.x1 = nextStart.x;
      entity.y1 = nextStart.y;
    }
    if (nextEnd) {
      entity.x2 = nextEnd.x;
      entity.y2 = nextEnd.y;
    }
    if (entity.measurementType) ensureDimensionLineGeometry(entity);
    else setDimensionLineAlongAxis(entity, previous.axis, previous.offset);
  }
}

function dimensionLinkedPoint(ref) {
  if (!ref) return null;
  const entity = state.entities.find((item) => item.id === ref.entityId);
  if (!entity) return null;
  if (ref.pointKey === "fraction" && isDraftLine(entity) && Number.isFinite(ref.t) && ref.t >= 0 && ref.t <= 1) {
    return { x: entity.x1 + (entity.x2 - entity.x1) * ref.t, y: entity.y1 + (entity.y2 - entity.y1) * ref.t };
  }
  return objectPointRefs(entity).find((point) => point.pointKey === ref.pointKey) || null;
}

function objectPointRefs(entity) {
  if (entity.type === "polyline") {
    return [
      ...entity.points.map((point, index) => ({ ...point, pointKey: `vertex-${index}`, snapRole: "end" })),
      ...polylineSegments(entity).map(({ p1, p2 }, index) => ({ ...midpoint(p1, p2), pointKey: `mid-${index}`, snapRole: "mid" })),
    ];
  }
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
  const step = (state.polarStep * Math.PI) / 180;
  const threshold = Math.min(step / 4, Math.PI / 72);
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / step) * step;
  const delta = Math.abs(Math.atan2(Math.sin(angle - snappedAngle), Math.cos(angle - snappedAngle)));
  if (delta > threshold) return { point, snapped: false };
  const degrees = Math.round(normalizeDegrees(-radToDeg(snappedAngle))) % 360;
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
  if (icon && visual?.icon) icon.innerHTML = glyphIcon(visual.icon);
  if (label && visual?.label) label.textContent = visual.label;
}

function syncToolButtonVisuals() {
  const selectButton = tools.find((button) => button.dataset.tool === "select");
  const lineButton = tools.find((button) => button.dataset.tool === "line");
  const dimensionButton = tools.find((button) => button.dataset.tool === "dimension");
  const annotationButton = tools.find((button) => button.dataset.tool === "annotation");
  const selectionButton = tools.find((button) => button.dataset.tool === "selection");
  setToolButtonVisual(selectButton, selectModeButtonVisuals[state.selectTool] || selectModeButtonVisuals.select);
  setToolButtonVisual(lineButton, drawToolButtonVisuals.line);
  setToolButtonVisual(dimensionButton, dimensionToolButtonVisuals[state.dimensionTool] || dimensionToolButtonVisuals.aligned);
  setToolButtonVisual(annotationButton, state.tool === "dimension" && state.dimensionTool === "leader" ? annotationToolButtonVisuals.leader : annotationToolButtonVisuals.text);
  setToolButtonVisual(selectionButton, selectionToolButtonVisuals.select);
}

function drawableSnapSegments() {
  const segments = [];
  for (const entity of state.entities) {
    if (!isLayerVisible(entity.layer) || entity.layer === "dimensions" || entity.type === "block") continue;
    if (entity.type === "line" || entity.type === "wall") {
      segments.push({ p1: { x: entity.x1, y: entity.y1 }, p2: { x: entity.x2, y: entity.y2 }, entity });
    } else if (entity.type === "polyline") {
      for (const segment of polylineSegments(entity)) segments.push({ ...segment, entity });
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
          : buttonTool === "annotation"
            ? state.tool === "text" || (state.tool === "dimension" && state.dimensionTool === "leader")
            : buttonTool === state.tool && (buttonTool !== "dimension" || state.dimensionTool !== "leader");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const figure = state.tool !== "line" && isGroupedDrawTool(state.tool) ? drawToolButtonVisuals[state.tool] : null;
  figureToolButton?.classList.toggle("active", Boolean(figure));
  figureToolButton?.setAttribute("aria-label", figure ? `Фигуры: ${figure.label}` : "Фигуры");
}

function setTool(tool) {
  if (lineMetricContext()) closeLineMetricInput();
  if (state.tool === "polyline" && state.drawing) finishLineCommand();
  state.directManipulationIds.clear();
  state.skipLineObjectSnap = false;
  state.tool = tool;
  state.dimensionAttach = null;
  if (tool === "dimension" && !state.visibleLayers.has("dimensions")) {
    state.visibleLayers.add("dimensions");
    markProjectDirty("show-dimensions");
  }
  hideLeaderTextEditor();
  if (tool !== "select") {
    state.selectTool = "select";
  }
  state.drawing = null;
  state.moveCommand = null;
  state.offsetCommand = null;
  state.lineEdit = null;
  state.selectionDrag = null;
  syncCommandState();
  if (["line", "polyline", "circle", "arc", "rectangle", "dimension", "text"].includes(tool)) {
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
  shell.dataset.tool = tool;
  syncToolButtons();
  const copy = {
    select: "Выбор: коснитесь объекта на чертеже",
    line: "Линия: наведите курсор на начало и коснитесь холста",
    polyline: "Полилиния: каждый тап добавляет следующий сегмент",
    circle: "Круг: укажите центр, затем радиус",
    arc: "Дуга: старт, точка на дуге, конец",
    rectangle: "Прямоугольник: укажите два противоположных угла",
    dimension: "Размер: подведите курсор к отрезку",
    text: "Текст: подведите курсор к месту вставки и тапните холст",
  };
  statusChip.textContent = copy[tool];
  if (tool === "select") {
    statusChip.textContent = "Выбор: коснитесь объекта на чертеже";
  }
  if (tool === "select") {
    statusChip.textContent = selectionStatusText();
  }
  if (tool === "dimension") {
    statusChip.textContent = dimensionToolStatusText();
  }
  draw();
}

function syncSnapButtons() {
  snaps.forEach((button) => {
    const enabled = state.snaps.has(button.dataset.snap);
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
  });
  updateGridStepReadout();
}

function syncDrawToolMenu() {
  drawToolButtons.forEach((button) => {
    const selected = button.dataset.drawTool === state.drawTool;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function syncDimensionToolMenu() {
  dimensionToolButtons.forEach((button) => {
    const selected = button.dataset.dimensionTool === state.dimensionTool;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function syncAnnotationToolMenu() {
  annotationToolButtons.forEach((button) => {
    const tool = button.dataset.annotationTool;
    const active = tool === "text" ? state.tool === "text" : state.tool === "dimension" && state.dimensionTool === "leader";
    button.classList.toggle("active", active);
  });
}

function syncSelectToolMenu() {
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
    button.hidden = button.disabled;
  });
}

function showDrawToolMenu() {
  if (!drawToolMenu) return;
  syncDrawToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  drawToolMenu.hidden = false;
  figureToolButton?.setAttribute("aria-expanded", "true");
}

function hideDrawToolMenu() {
  if (drawToolMenu) drawToolMenu.hidden = true;
  figureToolButton?.setAttribute("aria-expanded", "false");
}

function showDimensionToolMenu() {
  if (!dimensionToolMenu) return;
  syncDimensionToolMenu();
  hideDrawToolMenu();
  hideAnnotationToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  dimensionToolMenu.hidden = false;
  tools.find((button) => button.dataset.tool === "dimension")?.setAttribute("aria-expanded", "true");
}

function hideDimensionToolMenu() {
  if (dimensionToolMenu) dimensionToolMenu.hidden = true;
  tools.find((button) => button.dataset.tool === "dimension")?.setAttribute("aria-expanded", "false");
}

function showAnnotationToolMenu() {
  if (!annotationToolMenu) return;
  syncAnnotationToolMenu();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  annotationToolMenu.hidden = false;
  tools.find((button) => button.dataset.tool === "annotation")?.setAttribute("aria-expanded", "true");
}

function hideAnnotationToolMenu() {
  if (annotationToolMenu) annotationToolMenu.hidden = true;
  tools.find((button) => button.dataset.tool === "annotation")?.setAttribute("aria-expanded", "false");
}

function showSelectToolMenu() {
  if (!selectToolMenu) return;
  syncSelectToolMenu();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
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
  hideAnnotationToolMenu();
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
  if (state.tool === "line") {
    if (drawToolMenu.hidden) showDrawToolMenu();
    else hideDrawToolMenu();
    draw();
    return;
  }
  hideDrawToolMenu();
  hideSelectModeMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  state.drawTool = "line";
  setTool("line");
}

function activateDimensionToolMenu() {
  if (state.dimensionTool === "leader") state.dimensionTool = "aligned";
  setTool("dimension");
  showDimensionToolMenu();
  statusChip.textContent = dimensionToolStatusText();
}

function activateAnnotationToolMenu() {
  if (state.tool !== "text" && !(state.tool === "dimension" && state.dimensionTool === "leader")) {
    setTool("text");
  }
  showAnnotationToolMenu();
  statusChip.textContent = state.tool === "text" ? "Текст: подведите курсор к месту вставки и тапните холст" : dimensionToolStatusText();
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
  hideAnnotationToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  setTool("select");
  statusChip.textContent = "Выбор: команда отменена, можно выбирать и редактировать объект";
}

function activateSelectionTool() {
  if (state.tool === "polyline" && state.drawing) finishLineCommand();
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
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
  setTool("select");
  syncSelectionActions();
  statusChip.textContent = selectionStatusText();
}

function toggleMainSelectTool() {
  if (state.lineEdit || state.selectedEndpoint || state.moveCommand || state.offsetCommand) {
    activatePlainSelect();
    return;
  }
  if (state.tool === "polyline" && state.drawing) finishLineCommand();
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
  hideAnnotationToolMenu();
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

function selectAnnotationTool(tool) {
  state.drawing = null;
  state.dimensionSnapHint = null;
  hideLeaderTextEditor();
  resetSnapTracking();
  syncAnnotationToolMenu();
  hideAnnotationToolMenu();
  if (tool === "leader") {
    state.dimensionTool = "leader";
    setTool("dimension");
    statusChip.textContent = dimensionToolStatusText();
    return;
  }
  setTool("text");
  statusChip.textContent = "Текст: подведите курсор к месту вставки и тапните холст";
}

function dimensionToolStatusText() {
  const text = {
    aligned: "Размер по отрезку. 1 из 3: укажите начало",
    linear: "Размер по оси. 1 из 3: укажите первую точку",
    angular: "Угол. Укажите вершину либо выберите первую линию",
    baseline: "Размеры от базы. Укажите общую точку отсчёта",
  };
  text.leader = "Выноска. 1 из 3: укажите кончик стрелки";
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
    markProjectDirty("selection-filter");
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
  const index = selectionFilters.indexOf(state.selectionFilter);
  return selectionFilters[(index + 1) % selectionFilters.length];
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
    lines: "линии",
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
  markProjectDirty("add");
}

function createEntityFromDrawing() {
  const { start, end } = state.drawing;
  const id = `${state.tool}-${Date.now()}`;
  if (state.tool === "circle") return circleEntity(id, start.x, start.y, distanceWorld(start, end));
  if (state.tool === "rectangle") return rectangleEntity(id, start.x, start.y, end.x, end.y);
  if (state.tool === "arc") return arcEntity(id, state.drawing.start, arcThroughFromMidBulge(state.drawing.start, state.drawing.arcEnd, end), state.drawing.arcEnd);
  if (state.tool === "dimension") {
    const entity = draftDimension(start, end, id);
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

function draftDimension(start, end, id = "preview") {
  const entity = line(id, start.x, start.y, end.x, end.y, "dimensions");
  entity.measurementType = state.dimensionTool === "linear" ? "linear" : "aligned";
  if (entity.measurementType === "linear") {
    entity.measurementAxis = state.drawing.axisOverride ?? state.drawing.measurementAxis ??
      (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? "x" : "y");
  }
  return entity;
}

function draftDimensionOffset({ start, axis, measurement }, point) {
  const axisTip = { x: start.x + axis.x * measurement, y: start.y + axis.y * measurement };
  const offset = dimensionOffsetWithAlignmentSnap(start, axisTip, point);
  return Math.abs(offset) < 60 ? (offset < 0 ? -260 : 260) : offset;
}

function continueDimensionAfterCreate(measurement) {
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
    statusChip.textContent = `База ${formatDimensionLength(measurement)} мм. Поставьте следующую точку`;
    return;
  }
  state.drawing = null;
}

function isDraftLine(entity) {
  return entity?.type === "line" && entity.layer !== "dimensions" && !entity.dimensionKind &&
    [entity.x1, entity.y1, entity.x2, entity.y2].every(Number.isFinite);
}

function newLineId(type = "line") {
  return `${type}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function syncLineControls() {
  const drawing = state.tool === "polyline" ? state.drawing : null;
  const size = drawing?.points.length ?? 0;
  const edit = state.lineEdit;
  const placingLine = !surveyPointPicker && ["line", "polyline"].includes(state.tool);
  const draft = state.tool === "line" ? state.drawing : null;
  const input = numericConfirmInput();
  const choosingDirection = draft && ([lengthInput, topLengthInput].includes(input) || draft.metricConstraint?.length !== undefined);
  linePointAssist.hidden = !placingLine;
  lineDirection.hidden = !choosingDirection;
  if (choosingDirection && lineDirection.value !== (draft.metricDirection || "")) lineDirection.value = draft.metricDirection || "";
  const bypassPressed = String(state.skipLineObjectSnap);
  if (lineSkipSnap.getAttribute("aria-pressed") !== bypassPressed) lineSkipSnap.setAttribute("aria-pressed", bypassPressed);
  document.getElementById("undoButton").disabled = !state.undo.length && size < 2;
  document.getElementById("redoButton").disabled = !state.redo.length || Boolean(state.drawing || edit);
  lineUi.lineEditOptions.hidden = !edit;
  lineUi.lineEditForm.hidden = !lineQuantityModes[edit?.mode];
  lineUi.lineEditRadiusControl.hidden = edit?.mode !== "fillet";
  lineUi.lineMirrorControl.hidden = edit?.mode !== "mirror";
  const hasBoundaries = edit && ["trim", "extend"].includes(edit.mode);
  const chooseBoundaries = hasBoundaries && lineUi.lineBoundaryMode.value === "selected" && !edit.boundaryReady;
  lineUi.lineBoundaryControl.hidden = !hasBoundaries;
  lineUi.lineBreakControl.hidden = edit?.mode !== "break";
  lineUi.lineEditFinish.hidden = !edit || !["trim", "extend", "offset"].includes(edit.mode);
  lineUi.lineEditApply.hidden = !edit?.pending && !chooseBoundaries;
  lineUi.lineEditApply.disabled = Boolean(chooseBoundaries && !edit.boundaryIds.length);
  const label = chooseBoundaries ? "Далее" : "Подтвердить";
  if (lineUi.lineEditApply.textContent !== label) lineUi.lineEditApply.textContent = label;
}

function setLineEditHint(text) {
  if (lineUi.lineEditHint.textContent !== text) lineUi.lineEditHint.textContent = text;
  lineUi.lineEditHint.hidden = !text;
}


function commitLinePoint(point) {
  const polyline = state.tool === "polyline";
  if (state.tool !== "line" && !polyline) return false;
  if (!isLinePoint(point)) {
    statusChip.textContent = "Координаты точки вне диапазона";
    return false;
  }
  const draft = state.drawing;
  if (!draft) {
    state.skipLineObjectSnap = false;
    setSelection(null);
    state.drawing = { points: [point], start: point, end: point, lockedEnd: false };
    hideDrawToolMenu();
    statusChip.textContent = `${drawingToolName(state.tool)}. Укажите следующую точку`;
  } else {
    const start = draft.start;
    const length = distanceWorld(start, point);
    if (!isValidLine({ x1: start.x, y1: start.y, x2: point.x, y2: point.y })) {
      statusChip.textContent = "Укажите другую точку";
      draw();
      return false;
    }
    state.skipLineObjectSnap = false;
    if (polyline) {
      if (draft.points.length >= 3 && distanceWorld(draft.points[0], point) <= linePointEpsilon) {
        return finishLineCommand(true);
      }
      draft.points.push(point);
      draft.start = point;
      draft.end = point;
      draft.lockedEnd = false;
      draft.metricConstraint = null;
      statusChip.textContent = draft.points.length >= 3 && state.snaps.has("end")
        ? "Первая вершина замыкает контур · ESC — завершить"
        : "Следующая вершина · ESC — завершить";
    } else {
      state.drawing = null;
      pushEntity(line(newLineId(), start.x, start.y, point.x, point.y));
      statusChip.textContent = `Отрезок ${Math.round(length)} мм. Укажите начало новой линии`;
    }
  }
  if (polyline) markProjectDirty("polyline-vertex");
  resetSnapTracking();
  hideInlineEditors();
  draw();
  return true;
}

function finishLineCommand(closed = false) {
  const draft = state.drawing;
  if (!draft || !["line", "polyline"].includes(state.tool)) return false;
  if (state.tool === "polyline" && draft.points.length >= 2) {
    const entity = createPolyline(newLineId("polyline"), draft.points, { closed });
    if (!entity) {
      statusChip.textContent = "Для замыкания нужны три разные вершины";
      return false;
    }
    pushEntity(entity);
    statusChip.textContent = closed ? "Полилиния замкнута" : "Полилиния создана";
  } else {
    statusChip.textContent = "Укажите первую точку";
  }
  closeLineMetricInput();
  state.skipLineObjectSnap = false;
  state.drawing = null;
  if (state.tool === "polyline") markProjectDirty("polyline-finish");
  hideInlineEditors();
  resetSnapTracking();
  draw();
  return true;
}

function undoLineSegment() {
  const draft = state.tool === "polyline" ? state.drawing : null;
  if (!draft || draft.points.length < 2) return false;
  draft.points.pop();
  draft.end = draft.start = draft.points.at(-1);
  draft.lockedEnd = false;
  draft.metricConstraint = null;
  markProjectDirty("polyline-vertex");
  resetSnapTracking();
  hideInlineEditors();
  statusChip.textContent = "Последняя вершина убрана";
  draw();
  return true;
}

function lineEditEntity(id) {
  return state.entities.find((entity) => entity.id === id && isDraftLine(entity) && isLayerVisible(entity.layer));
}

function pickDraftLine(screen) {
  let best = null;
  let distance = 18;
  for (const entity of state.entities) {
    if (!isDraftLine(entity) || !isLayerVisible(entity.layer)) continue;
    const next = distanceToEntityScreen(screen, entity);
    if (next <= distance) {
      best = entity;
      distance = next;
    }
  }
  return best;
}

function startLineEdit(mode, entity) {
  state.lineEdit = {
    mode, sourceId: entity.id, joinIds: [], firstPick: null, amount: null,
    boundaryIds: [], boundaryReady: false, pending: null, applied: false,
  };
  lineUi.lineBoundaryMode.value = "auto";
  if (mode === "trim" || mode === "extend") {
    const hasWalls = state.entities.some((item) => item.type === "wall" && isLayerVisible(item.layer));
    lineUi.lineBoundaryMode.querySelector('option[value="auto"]').textContent = hasWalls ? "Все видимые · грани стен" : "Все видимые";
    lineUi.lineBoundaryMode.querySelector('option[value="axis"]').hidden = !hasWalls;
  }
  lineUi.lineBreakMode.value = "gap";
  statusChip.textContent = "";
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  resetSnapTracking();
  hideInlineEditors();
  hideSelectToolMenu();
  lineUi.lineLengthInput.value = "";
  lineUi.lineLengthInput.removeAttribute("aria-invalid");
  const modes = lineQuantityModes[mode];
  if (modes) {
    lineUi.lineLengthMode.replaceChildren(...modes.map(([value, label]) => new Option(label, value)));
    syncLineQuantityFields();
  }
  lineUi.lineMirrorDelete.checked = false;
  const prompts = {
    trim: "Обрезать: коснитесь части линии, которую нужно убрать",
    extend: "Удлинить: коснитесь линии ближе к нужному концу",
    break: "Разрыв: укажите первую точку. Касание проецируется на выбранную линию",
    join: "Соединить: выберите линии на той же прямой",
    lengthen: "Длина: введите значение и выберите конец на линии",
    fillet: "Скругление: коснитесь сохраняемой стороны первой линии",
    offset: "Смещение: введите расстояние или выберите «Через точку»",
    mirror: "Зеркало: укажите первую точку оси отражения",
    scale: "Масштаб: введите коэффициент и укажите базовую точку",
  };
  setLineEditHint(prompts[mode]);
  draw();
}

function endLineEdit(text) {
  state.lineEdit = null;
  setLineEditHint("");
  statusChip.textContent = text;
  draw();
}


function boundarySegments(excludedId, ids = null) {
  const segments = [];
  const wallAxes = state.lineEdit && lineUi.lineBoundaryMode.value === "axis";
  for (const { p1, p2, entity } of drawableSnapSegments()) {
    if (entity.id === excludedId || (ids && !ids.includes(entity.id))) continue;
    const segment = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    if (entity.type === "wall" && !wallAxes && Number.isFinite(entity.width) && entity.width > 0) {
      const { a, b } = offsetWall(entity, entity.width / 2);
      segments.push(a, b, { x1: a.x1, y1: a.y1, x2: b.x1, y2: b.y1 },
        { x1: a.x2, y1: a.y2, x2: b.x2, y2: b.y2 });
    } else {
      segments.push(segment);
    }
  }
  return segments.concat(state.entities.filter((entity) => entity.id !== excludedId &&
    (!ids || ids.includes(entity.id)) && isLayerVisible(entity.layer) && ["circle", "arc"].includes(entity.type)));
}

function lineWithNewLength(entity, point, amount, mode) {
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  const current = distanceWorld(start, end);
  const target = mode === "delta" ? current + amount : mode === "percent" ? current * (amount / 100) : amount;
  if (!Number.isFinite(target) || target <= linePointEpsilon || current <= linePointEpsilon) return null;
  const moveStart = distanceWorld(point, start) < distanceWorld(point, end);
  const fixed = moveStart ? end : start;
  const moving = moveStart ? start : end;
  const x = fixed.x + (moving.x - fixed.x) / current * target;
  const y = fixed.y + (moving.y - fixed.y) / current * target;
  const result = moveStart ? { x1: x, y1: y, x2: end.x, y2: end.y } : { x1: start.x, y1: start.y, x2: x, y2: y };
  return isValidLine(result) ? result : null;
}

function syncLineQuantityFields() {
  const mode = lineUi.lineLengthMode.value;
  const form = lineUi.lineEditForm;
  const input = lineUi.lineLengthInput;
  const pointOnly = mode === "through" || mode === "dynamic";
  const scale = mode === "factor";
  form.dataset.fields = pointOnly ? "mode" : scale ? "value" : "";
  lineUi.lineLengthMode.hidden = scale;
  input.hidden = pointOnly;
  form.querySelector("button[type=submit]").hidden = pointOnly;
  input.inputMode = mode === "delta" ? "text" : "decimal";
  input.placeholder = scale ? "Например, 1.5" : mode === "distance" ? "Расстояние, мм" : "Значение";
  input.setAttribute("aria-label", scale ? "Коэффициент масштаба" : mode === "distance" ? "Расстояние смещения" : "Новая длина линии");
}

function submitLineLength() {
  const edit = state.lineEdit;
  if (!lineQuantityModes[edit?.mode]) return;
  const input = lineUi.lineLengthInput;
  const mode = lineUi.lineLengthMode.value;
  const value = input.value.trim();
  const amount = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value) ? Number(value.replace(",", ".")) : NaN;
  if (!Number.isFinite(amount) || Math.abs(amount) > MAX_LINE_COORDINATE || (mode !== "delta" && amount <= 0)) {
    input.setAttribute("aria-invalid", "true");
    setLineEditHint("Введите допустимое числовое значение");
    return;
  }
  edit.amount = amount;
  edit.lengthMode = mode;
  input.removeAttribute("aria-invalid");
  const next = {
    distance: "Коснитесь нужной стороны исходной линии",
    factor: "Укажите базовую точку масштабирования",
  };
  setLineEditHint(next[mode] || "Коснитесь линии ближе к концу, который нужно изменить");
  input.blur();
  draw();
}

function finishLineJoin() {
  const edit = state.lineEdit;
  if (edit?.mode !== "join" || !edit.joinIds.length) return;
  const source = lineEditEntity(edit.sourceId);
  const others = edit.joinIds.map(lineEditEntity).filter(Boolean);
  const coordinates = joinLines(source, others);
  if (!coordinates) {
    setLineEditHint("Выберите линии на той же прямой");
    return;
  }
  previewLineEdit([[source, [coordinates]], ...others.map((entity) => [entity, []])], "Линии соединены", [], "join");
}

function pickLineEditPoint(screen) {
  const edit = state.lineEdit;
  if (!edit) return;
  const source = lineEditEntity(edit.sourceId);
  const repeat = ["trim", "extend"].includes(edit.mode);
  if (edit.pending) {
    edit.pending = null;
    draw();
  }
  if (!source && !(repeat && edit.applied)) return endLineEdit("Линия недоступна");
  if (repeat && lineUi.lineBoundaryMode.value === "selected" && !edit.boundaryReady) {
    const boundary = pickBoundaryEntity(screen, edit.sourceId);
    if (!boundary) return setLineEditHint("Коснитесь границы на чертеже");
    edit.boundaryIds = edit.boundaryIds.includes(boundary.id)
      ? edit.boundaryIds.filter((id) => id !== boundary.id)
      : [...edit.boundaryIds, boundary.id];
    setSelection([edit.sourceId, ...edit.boundaryIds]);
    setLineEditHint(`Выбрано границ: ${edit.boundaryIds.length}. Нажмите «Далее»`);
    draw();
    return;
  }
  const point = screenToWorld(screen);
  if (["offset", "mirror", "scale"].includes(edit.mode)) {
    placeLineTransform(edit, source, point);
    return;
  }
  if (edit.mode === "lengthen" && edit.lengthMode === "dynamic" && edit.firstPick) {
    const target = lineEditEntity(edit.dynamicLineId);
    if (!target) return endLineEdit("Линия недоступна");
    const start = { x: target.x1, y: target.y1 };
    const end = { x: target.x2, y: target.y2 };
    const fromStart = distanceWorld(edit.firstPick, start) < distanceWorld(edit.firstPick, end);
    const fixed = fromStart ? end : start;
    const moving = fromStart ? start : end;
    const unit = normalizeWorldVector(moving.x - fixed.x, moving.y - fixed.y);
    if (!unit) return setLineEditHint("У выбранной линии нет длины");
    const length = (point.x - fixed.x) * unit.x + (point.y - fixed.y) * unit.y;
    const result = lineWithNewLength(target, edit.firstPick, length, "total");
    if (!result) return setLineEditHint("Поставьте точку на стороне выбранного конца");
    previewLineEdit([[target, [result]]], "Длина изменена");
    return;
  }
  const hit = pickDraftLine(screen);
  if (edit.mode === "join") {
    if (!hit || hit === source || !joinLines(source, [hit])) {
      setLineEditHint("Выберите линию на той же прямой");
      return;
    }
    edit.joinIds = edit.joinIds.includes(hit.id) ? edit.joinIds.filter((id) => id !== hit.id) : [...edit.joinIds, hit.id];
    setSelection([source.id, ...edit.joinIds]);
    edit.pending = null;
    if (edit.joinIds.length) finishLineJoin();
    else {
      setLineEditHint("Выберите линии на той же прямой");
      draw();
    }
    return;
  }
  if (edit.mode === "fillet") {
    if (!edit.firstPick) {
      if (hit !== source) return setLineEditHint("Сначала коснитесь сохраняемой стороны выбранной линии");
      edit.firstPick = point;
      setLineEditHint("Коснитесь сохраняемой стороны второй линии");
      draw();
      return;
    }
    if (!hit || hit === source) return setLineEditHint("Выберите вторую линию");
    const radiusInput = lineUi.lineEditRadius;
    const radius = radiusInput.valueAsNumber;
    const result = filletLines(source, hit, edit.firstPick, point, radius);
    if (!result) {
      setLineEditHint("Скругление невозможно. Проверьте радиус и стороны линий");
      return;
    }
    const arc = result.arc ? [arcEntity(newLineId("arc"), result.arc.start, result.arc.through, result.arc.end, source.layer)] : [];
    previewLineEdit([[source, [result.first]], [hit, [result.second]]], "Скругление построено", arc, "preserve");
    return;
  }
  if (edit.mode === "break") {
    if (lineUi.lineBreakMode.value === "point") {
      const pieces = splitLine(source, point);
      if (!pieces) return setLineEditHint("Укажите точку внутри линии");
      previewLineEdit([[source, pieces]], "Линия разделена", [], "preserve");
      return;
    }
    if (!edit.firstPick) {
      const a = { x: source.x1, y: source.y1 };
      const b = { x: source.x2, y: source.y2 };
      edit.firstPick = projectPointToSegmentWorld(point, a, b);
      setLineEditHint("Укажите вторую точку зазора");
      draw();
      return;
    }
    const a = { x: source.x1, y: source.y1 };
    const b = { x: source.x2, y: source.y2 };
    const projected = projectPointToSegmentWorld(point, a, b);
    if (distanceWorld(edit.firstPick, projected) <= linePointEpsilon) {
      return setLineEditHint("Для зазора укажите две разные точки");
    }
    const pieces = splitLine(source, edit.firstPick, projected);
    if (!pieces) return setLineEditHint("Укажите точку внутри линии");
    previewLineEdit([[source, pieces]], "Разрыв выполнен", [], "preserve");
    return;
  }
  if (!hit) {
    setLineEditHint("Коснитесь линии на чертеже");
    return;
  }
  if (edit.mode === "lengthen") {
    if (edit.lengthMode === "dynamic") {
      edit.firstPick = point;
      edit.dynamicLineId = hit.id;
      setLineEditHint("Укажите точку для новой длины вдоль линии");
      draw();
      return;
    }
    if (edit.amount === null) return setLineEditHint("Сначала укажите длину и нажмите галочку");
    const coordinates = lineWithNewLength(hit, point, edit.amount, edit.lengthMode);
    if (!coordinates) return setLineEditHint("Итоговая длина должна быть больше нуля");
    previewLineEdit([[hit, [coordinates]]], "Длина изменена");
    return;
  }
  if (!edit.applied && hit !== source) return setLineEditHint("Для первой правки коснитесь выделенной линии");
  if (edit.boundaryIds.includes(hit.id)) return setLineEditHint("Выберите линию, которую нужно изменить");
  setSelection(hit.id);
  const boundaries = boundarySegments(hit.id, lineUi.lineBoundaryMode.value === "selected" ? edit.boundaryIds : null);
  if (edit.mode === "trim") {
    const pieces = trimLine(hit, boundaries, point);
    if (!pieces) return setLineEditHint("Нет пересечения для обрезки в этой точке");
    previewLineEdit([[hit, pieces]], "Линия обрезана", [], "preserve");
  } else {
    const coordinates = extendLine(hit, boundaries, point);
    if (!coordinates) return setLineEditHint("В направлении выбранного конца нет границы");
    previewLineEdit([[hit, [coordinates]]], "Линия удлинена");
  }
}

function placeLineTransform(edit, source, raw) {
  if (edit.mode === "offset") {
    const through = lineUi.lineLengthMode.value === "through";
    if (!through && edit.amount === null) return setLineEditHint("Укажите расстояние и нажмите галочку");
    const point = through ? resolveSnapWorld(raw).point : raw;
    const coordinates = parallelLine(source, point, through ? null : edit.amount);
    if (!coordinates) return setLineEditHint("Укажите точку вне оси исходной линии");
    previewLineEdit([], "Смещение создано", [{ ...source, ...coordinates, id: newLineId() }]);
    return;
  }
  if (edit.mode === "scale") {
    if (edit.amount === null) return setLineEditHint("Укажите коэффициент и нажмите галочку");
    const coordinates = scaleLine(source, resolveSnapWorld(raw).point, edit.amount);
    if (!coordinates) return setLineEditHint("Масштабирование невозможно с этим коэффициентом");
    previewLineEdit([[source, [coordinates]]], "Масштаб линии изменён");
    return;
  }
  if (!edit.firstPick) {
    edit.firstPick = resolveSnapWorld(raw).point;
    setLineEditHint("Укажите вторую точку оси отражения");
    draw();
    return;
  }
  const second = resolveLineLikeSnap(raw, edit.firstPick).point;
  const coordinates = mirrorLine(source, edit.firstPick, second);
  if (!coordinates) return setLineEditHint("Точки оси отражения должны различаться");
  if (lineUi.lineMirrorDelete.checked) {
    previewLineEdit([[source, [coordinates]]], "Линия отражена");
  } else {
    previewLineEdit([], "Отражённая копия создана", [{ ...source, ...coordinates, id: newLineId() }]);
  }
}


function pickBoundaryEntity(screen, excludedId) {
  let best = null;
  let bestDistance = 18;
  for (const entity of state.entities) {
    if (entity.id === excludedId || !isLayerVisible(entity.layer) || entity.layer === "dimensions" ||
        !["line", "wall", "rectangle", "polyline", "circle", "arc"].includes(entity.type)) continue;
    const distance = distanceToEntityScreen(screen, entity);
    if (distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}

function previewLineEdit(replacements, message, added = [], association = "follow") {
  const edit = state.lineEdit;
  if (!edit) return;
  edit.pending = null;
  const changes = replacements.filter(([entity, pieces]) => pieces.length !== 1 || geometryChanged(entity, pieces[0]));
  if (!changes.length && !added.length) {
    setLineEditHint("Геометрия уже соответствует заданию");
    draw();
    return;
  }
  if (changes.some(([, pieces]) => pieces.some((piece) => !isValidLine(piece))) ||
      added.some((entity) => entity.type === "line" ? !isValidLine(entity) :
        ![entity.start, entity.through, entity.end].every(isLinePoint))) {
    setLineEditHint("Результат выходит за диапазон координат");
    draw();
    return;
  }
  edit.pending = { replacements, message, added, association };
  setLineEditHint("Проверьте предосмотр и нажмите «Подтвердить»");
  draw();
}

function applyLineEditPreview() {
  const edit = state.lineEdit;
  if (!edit) return;
  if (["trim", "extend"].includes(edit.mode) &&
      lineUi.lineBoundaryMode.value === "selected" && !edit.boundaryReady) {
    if (!edit.boundaryIds.length) return;
    edit.boundaryReady = true;
    setSelection(edit.sourceId);
    setLineEditHint("Коснитесь выделенной линии для правки");
    draw();
    return;
  }
  if (!edit.pending) return;
  const { replacements, message, added, association } = edit.pending;
  commitLineEdit(replacements, message, added, association);
  if (["trim", "extend", "offset"].includes(edit.mode)) {
    state.lineEdit = edit;
    edit.pending = null;
    edit.applied = true;
    setSelection(edit.mode === "offset" ? edit.sourceId : null);
    setLineEditHint("Следующая линия или точка. Нажмите «Завершить» для выхода");
    draw();
  }
}

// Each line operation, including splits and fillets, is one undoable edit.
function commitLineEdit(replacements, message, added, association) {
  const replaced = new Map(replacements.map(([entity, pieces]) => [
    entity.id,
    pieces.map((coordinates, index) => ({ ...entity, ...coordinates, id: index === 0 ? entity.id : newLineId() })),
  ]));
  const results = [...replaced.values()].flat();
  const selection = [...results, ...added].map(({ id }) => id);
  let detached = 0;
  const before = [];
  const after = [];
  state.entities = state.entities.flatMap((entity, index) => {
    const pieces = replaced.get(entity.id);
    if (pieces) {
      before.push({ entity, index });
      return pieces;
    }
    const dimension = remapLineDimension(entity, replaced, results, association);
    if (dimension !== entity && ["refStart", "refEnd"].some((key) => entity[key] && !dimension[key])) detached += 1;
    if (dimension !== entity) {
      before.push({ entity, index });
      replaced.set(entity.id, [dimension]);
    }
    return [dimension];
  }).concat(added);
  const newIds = new Set([...replaced.values()].flat().concat(added).map(({ id }) => id));
  state.entities.forEach((entity, index) => {
    if (newIds.has(entity.id)) after.push({ entity, index });
  });
  updateLinkedDimensions();
  state.undo.push({ type: "line-edit", before, after });
  state.redo.length = 0;
  endLineEdit(detached ? `${message}. Размеров без опоры: ${detached}` : message);
  setSelection(selection.length === 1 ? selection[0] : null);
  markProjectDirty("line-edit");
  draw();
}


function lineReferenceAt(point, pieces) {
  if (!point) return null;
  for (const piece of pieces) {
    const exact = objectPointRefs(piece).find((p) => distanceWorld(point, p) <= linePointEpsilon);
    if (exact) return { entityId: piece.id, pointKey: exact.pointKey };
    const start = { x: piece.x1, y: piece.y1 };
    const end = { x: piece.x2, y: piece.y2 };
    const projected = projectPointToSegmentWorld(point, start, end);
    if (projected.distance <= linePointEpsilon) {
      const t = Math.min(1, distanceWorld(start, projected) / distanceWorld(start, end));
      return { entityId: piece.id, pointKey: "fraction", t };
    }
  }
  return null;
}

function remapLineDimension(entity, replaced, results, association) {
  if (entity.layer !== "dimensions") return entity;
  let edited = entity;
  for (const key of ["refStart", "refEnd"]) {
    const ref = entity[key];
    const pieces = replaced.get(ref?.entityId);
    if (!pieces) continue;
    if (edited === entity) edited = { ...entity };
    if (association === "follow" && pieces.some((piece) => piece.id === ref.entityId)) continue;
    const point = dimensionLinkedPoint(ref);
    const mapped = lineReferenceAt(point, association === "join" ? results : pieces);
    const lostKey = key === "refStart" ? "lostRefStart" : "lostRefEnd";
    if (mapped) {
      edited[key] = mapped;
      edited[lostKey] = false;
    } else {
      if (point) {
        if (key === "refStart") {
          edited.x1 = point.x;
          edited.y1 = point.y;
        } else {
          edited.x2 = point.x;
          edited.y2 = point.y;
        }
      }
      delete edited[key];
      edited[lostKey] = true;
    }
  }
  return edited;
}

function restoreLineEdit(remove, insert) {
  const removeIds = new Set(remove.map(({ entity }) => entity.id));
  state.entities = state.entities.filter((entity) => !removeIds.has(entity.id));
  for (const { entity, index } of insert) state.entities.splice(index, 0, entity);
  updateLinkedDimensions();
  setSelection(null);
  markProjectDirty("line-history");
  draw();
}

function drawLineEditMarks(c) {
  const pointer = state.pointer;
  if (pointer?.mode === "line-grip" && pointer.preview) {
    if (pointer.preview.points) {
      const entity = state.entities.find((item) => item.id === pointer.grip.entityId);
      drawPolyline({ ...entity, points: pointer.preview.points }, c, true, true);
    } else {
      const { x1, y1, x2, y2 } = pointer.preview;
      drawEditableSegment({ x: x1, y: y1 }, { x: x2, y: y2 }, c, { dashed: true });
    }
  }
  const edit = state.lineEdit;
  if (edit?.pending) {
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 4]);
    for (const piece of edit.pending.replacements.flatMap(([, pieces]) => pieces)) {
      const a = worldToScreen({ x: piece.x1, y: piece.y1 });
      const b = worldToScreen({ x: piece.x2, y: piece.y2 });
      linePath(a.x, a.y, b.x, b.y);
    }
    for (const entity of edit.pending.added) drawEntity(entity, { ...c, line: c.accent });
    ctx.restore();
  }
  if (!edit?.firstPick) return;
  const p = worldToScreen(edit.firstPick);
  drawEndpointHandle(p, true, c);
}

function previewLineGrip(pointer, screen) {
  const entity = state.entities.find((item) => item.id === pointer.grip.entityId);
  if (!entity) return;
  if (entity.type === "polyline") {
    const index = pointer.grip.point;
    const origin = entity.points[index];
    const raw = {
      x: origin.x + (screen.x - pointer.startScreen.x) / state.view.scale,
      y: origin.y + (screen.y - pointer.startScreen.y) / state.view.scale,
    };
    const point = resolveLineLikeSnap(raw, origin).point;
    const points = entity.points.map((old, i) => i === index ? point : old);
    pointer.preview = isLinePoint(point) && validPolylinePoints(points, entity.closed) ? { points } : null;
    return;
  }
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  const grip = pointer.grip.point;
  const origin = grip === "middle" ? midpoint(start, end) : grip === "start" ? start : end;
  const candidate = {
    x: origin.x + (screen.x - pointer.startScreen.x) / state.view.scale,
    y: origin.y + (screen.y - pointer.startScreen.y) / state.view.scale,
  };
  if (grip === "middle") {
    const target = isLineSnapContext() && state.snaps.has("ortho")
      ? resolveLineLikeSnap(candidate, origin).point
      : resolveSnapWorld(candidate).point;
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    pointer.preview = { x1: start.x + dx, y1: start.y + dy, x2: end.x + dx, y2: end.y + dy };
  } else {
    const fixed = grip === "start" ? end : start;
    const target = resolveLineLikeSnap(candidate, fixed).point;
    pointer.preview = distanceWorld(fixed, target) <= linePointEpsilon
      ? null
      : grip === "start"
        ? { x1: target.x, y1: target.y, x2: end.x, y2: end.y }
        : { x1: start.x, y1: start.y, x2: target.x, y2: target.y };
  }
}

function finishLineGrip(pointer) {
  const entity = state.entities.find((item) => item.id === pointer.grip.entityId);
  if (!entity) return;
  if (!pointer.moved) {
    if (entity.type === "polyline") {
      statusChip.textContent = "Перетащите вершину полилинии";
      draw();
      return;
    }
    if (pointer.grip.point === "middle") {
      const base = midpoint({ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 });
      startMoveLikeCommand(entity, "move");
      centerViewOnWorldPoint(base);
      commitMoveCommandPoint(base);
    } else {
      selectLineEndpoint(pointer.grip);
    }
    return;
  }
  const before = entityGeometry(entity);
  if (pointer.preview && (entity.type === "polyline" || isValidLine(pointer.preview)) && geometryChanged(before, pointer.preview)) {
    const after = pointer.preview;
    applyEntityGeometry(entity, after);
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    statusChip.textContent = entity.type === "polyline" ? "Вершина обновлена" :
      pointer.grip.point === "middle" ? "Линия перемещена" : "Конец линии обновлён";
  }
  pointer.preview = null;
  resetSnapTracking();
  draw();
}

function selectLineEndpoint(endpoint) {
  const entity = state.entities.find((item) => item.id === endpoint?.entityId);
  if (!entity || entity.type === "block") return false;
  state.selectedId = entity.id;
  state.selectedIds = [entity.id];
  state.selectedEndpoint = { entityId: entity.id, point: endpoint.point };
  state.endpointEditBefore = entityGeometry(entity);
  state.drawing = null;
  const geometry = selectedEndpointGeometry();
  if (geometry) centerViewOnWorldPoint(geometry.moving);
  resetSnapTracking();
  updateSelectedEndpointEditors(geometry ? endpointCursorPoint(geometry) : null);
  statusChip.textContent = "Конец линии выбран. Подведите центр к новой точке и тапните";
  draw();
  return true;
}

function commitCursorPoint() {
  if (surveyPointPicker) {
    commitSurveyPoint();
    return;
  }
  if (state.dimensionAttach) {
    commitDimensionAttach();
    return;
  }
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
  if (state.tool === "text") {
    setSelection(null);
    hideInlineEditors();
    hideDrawToolMenu();
    hideDimensionToolMenu();
    hideSelectToolMenu();
    resetSnapTracking();
    createTextAtPoint(world);
    return;
  }
  if (state.tool === "dimension") {
    if (!isLinePoint(world)) {
      statusChip.textContent = "Координаты точки вне диапазона";
      return;
    }
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
        if (distanceWorld(state.drawing.start, world) <= linePointEpsilon) {
          statusChip.textContent = "Угол: точка на первой стороне должна отличаться от вершины";
          return;
        }
        state.drawing.arm1 = world;
        state.drawing.end = world;
        state.drawing.phase = "angular-arm2";
        resetSnapTracking();
        statusChip.textContent = "Угол: поставьте точку на второй стороне";
      } else if (state.drawing.phase === "angular-arm2") {
        const entity = angularDimensionEntity(newLineId("dimension"), state.drawing.start, state.drawing.arm1, world);
        const geometry = angularDimensionGeometry(entity);
        if (!geometry) {
          statusChip.textContent = "Угол: точка на второй стороне должна отличаться от вершины";
          return;
        }
        pushEntity(entity);
        state.drawing = null;
        resetSnapTracking();
        statusChip.textContent = `Угловой размер ${Math.round(geometry.measurement)}° создан`;
      }
      draw();
      return;
    }
    if (!state.drawing) {
      resetSnapTracking();
      state.drawing = { start: world, end: world, lockedEnd: false, phase: "end", refStart: dimensionRefFromSnap(resolved.snap), baseStart: world, baseRefStart: dimensionRefFromSnap(resolved.snap) };
      statusChip.textContent = "Размер: начало поставлено. Поставьте вторую точку";
    } else if (state.drawing.phase === "end") {
      const end = state.drawing.lockedEnd ? state.drawing.end : world;
      const geometry = dimensionGeometry(draftDimension(state.drawing.start, end));
      if (!geometry || geometry.measurement <= linePointEpsilon) {
        statusChip.textContent = "Размер: выберите другую вторую точку";
        return;
      }
      state.drawing.end = end;
      state.drawing.measurementAxis = geometry.measurementAxis;
      state.drawing.refEnd = dimensionRefFromSnap(resolved.snap);
      state.drawing.lockedEnd = true;
      state.drawing.phase = "offset";
      statusChip.textContent = `Размер ${formatDimensionLength(geometry)} мм. Укажите положение размерной линии`;
    } else if (state.drawing.phase === "offset") {
      const { start, end } = state.drawing;
      const geometry = dimensionGeometry(draftDimension(start, end));
      if (!geometry) return;
      state.drawing.offset = draftDimensionOffset(geometry, rawCursorWorld());
      pushEntity(createEntityFromDrawing());
      continueDimensionAfterCreate(geometry.measurement);
      resetSnapTracking();
      if (!state.drawing) statusChip.textContent = `Размер ${formatDimensionLength(geometry)} мм создан`;
    }
    draw();
    return;
  }
  if (state.tool === "line" || state.tool === "polyline") {
    commitLinePoint(state.drawing?.lockedEnd ? state.drawing.end : world);
    return;
  }
  if (["circle", "rectangle", "arc"].includes(state.tool)) {
    if (!state.drawing) {
      setSelection(null);
      state.endpointEditBefore = null;
      hideInlineEditors();
      resetSnapTracking();
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
      hideDrawToolMenu();
      state.selectTool = "select";
      setTool("select");
      statusChip.textContent = drawingFinishedStatus(finishedTool);
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

function drawingToolName(tool) { return { line: "Линия", polyline: "Полилиния", dimension: "Размер", circle: "Круг", rectangle: "Прямоугольник", arc: "Дуга" }[tool] || "Объект"; }
function drawingFinishedStatus(tool) { return `${drawingToolName(tool)} ${["line", "arc"].includes(tool) ? "завершена" : "завершен"}`; }

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
    if (rotateEntityAround(entity, command.base, signedAngleDelta(startAngle, endAngle)) === false) {
      statusChip.textContent = "Координаты после поворота вне диапазона";
      draw();
      return;
    }
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
    if (!copy) {
      statusChip.textContent = "Координаты копии вне диапазона";
      draw();
      return;
    }
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
  if (moveEntityBy(entity, dx, dy) === false) {
    statusChip.textContent = "Координаты после перемещения вне диапазона";
    draw();
    return;
  }
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
    if (finishedTool === "line" || finishedTool === "polyline") {
      commitLinePoint(end);
      return;
    }
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

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (lineMetricContext() && lineMetricKinds.has(document.activeElement)) closeLineMetricInput();
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
  if (surveyPointPicker) {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "survey-point" };
    return;
  }
  if (state.dimensionAttach) {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "dimension-attach" };
    return;
  }
  if (state.lineEdit) {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "line-edit" };
    return;
  }
  if (state.tool === "select" && !state.moveCommand && !state.offsetCommand && !["window", "lasso"].includes(state.selectTool)) {
    // Point editing is an explicit operation, independent of whole-object drag.
    if (state.selectedEndpoint) {
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
    const selectedLineEndpoint = pickSelectedLineEndpoint(screen);
    if (selectedLineEndpoint && !requiresActivation(selectedLineEndpoint.entityId, state.selectedIds, state.directManipulationIds)) {
      const entity = state.entities.find((item) => item.id === selectedLineEndpoint.entityId);
      if (isDraftLine(entity) || entity?.type === "polyline") {
        state.pointer = {
          id: event.pointerId,
          screen,
          startScreen: screen,
          moved: false,
          mode: "line-grip",
          grip: selectedLineEndpoint,
          preview: null,
        };
      } else {
        selectLineEndpoint(selectedLineEndpoint);
        state.pointer = { id: event.pointerId, mode: "ui", moved: true };
      }
      return;
    }
  }
  // A completed tap arms an object. Auto-selection after creation, undo or a
  // command does not allow the next accidental contact to change geometry.
  let circleControl = null;
  let dimensionControl = null;
  if (state.tool === "select" && !state.moveCommand && !state.offsetCommand && !["window", "lasso"].includes(state.selectTool)) {
    circleControl = hitCircleControl(screen);
    if (!circleControl) dimensionControl = hitDimensionControl(screen);
    const controlEntity = circleControl?.entity || dimensionControl?.entity;
    const hitId = controlEntity?.id || pickEntity(screen);
    const hitEntity = controlEntity || state.entities.find(entity => entity.id === hitId);
    if (hitId && ((!controlEntity && !canDragEntityDirectly(hitEntity)) ||
        requiresActivation(hitId, state.selectedIds, state.directManipulationIds))) {
      state.pointer = { id: event.pointerId, screen, startScreen: screen, world: screenToWorld(screen), moved: false, mode: "select-only", targetId: null, tapCandidateId: hitId, before: null };
      return;
    }
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
  if (circleControl) {
    const hitEntity = circleControl.entity;
    state.selectedId = hitEntity.id;
    state.selectedIds = [hitEntity.id];
    state.selectedEndpoint = null;
    if (circleControl.type === "circle-radius-input") {
      state.pointer = { id: event.pointerId, screen, startScreen: screen, world: screenToWorld(screen), moved: false, mode: "circle-radius-input", targetId: hitEntity.id, before: entityGeometry(hitEntity) };
      statusChip.textContent = "Круг: тапните, чтобы ввести радиус";
      draw();
      return;
    }
    state.pointer = {
      id: event.pointerId,
      screen,
      startScreen: screen,
      world: screenToWorld(screen),
      moved: false,
      mode: "circle-radius",
      targetId: hitEntity.id,
      before: entityGeometry(hitEntity),
    };
    statusChip.textContent = "Круг: тяните ручку радиуса";
    draw();
    return;
  }
  if (dimensionControl) {
    const hitEntity = dimensionControl.entity;
    state.selectedId = hitEntity.id;
    state.selectedIds = [hitEntity.id];
    if (dimensionControl.type === "leader-box") {
      state.pointer = {
        id: event.pointerId,
        screen,
        startScreen: screen,
        world: screenToWorld(screen),
        moved: false,
        mode: "leader-move",
        targetId: hitEntity.id,
        before: entityGeometry(hitEntity),
        editLeaderTextOnTap: true,
      };
      statusChip.textContent = "Выноска выбрана: тяните для перемещения или тапните текст для правки";
      draw();
      return;
    }
    if (dimensionControl.type === "leader-arrow") {
      state.pointer = {
        id: event.pointerId,
        screen,
        startScreen: screen,
        world: screenToWorld(screen),
        moved: false,
        mode: "leader-arrow",
        targetId: hitEntity.id,
        before: entityGeometry(hitEntity),
      };
      statusChip.textContent = "Выноска: тяните только стрелку";
      draw();
      return;
    }
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
  const lineEndpoint = state.tool === "line" ? pickLineEndpoint(screen) : null;
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
  const hitId = state.tool === "select" ? pickEntity(screen) : null;
  const hitEntity = hitId ? state.entities.find((entity) => entity.id === hitId) : null;
  const hitIsSelected = hitId && (state.selectedId === hitId || (state.selectedIds || []).includes(hitId));
  const canMoveHit = Boolean(canDragEntityDirectly(hitEntity) && hitIsSelected && state.tool === "select");
  const pointerMode = canMoveHit
    ? isDirectMoveAnnotation(hitEntity)
      ? "move"
      : hitEntity.layer === "dimensions"
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
  if (state.pointer.mode === "select-only") {
    state.pointer.mode = activationGestureMode(state.pointer.moved);
    if (state.pointer.mode === "select-only") return;
    // This gesture belongs to the viewport, even while crossing other objects.
    // Do not activate or move the object when the finger is released.
    state.pointer.tapCandidateId = null;
  }
  if (state.pointer.mode === "line-grip") {
    if (state.pointer.moved) {
      previewLineGrip(state.pointer, screen);
      draw();
    }
    return;
  }
  if (!canStartGeometryDrag(state.pointer.mode, state.pointer.moved)) return;
  if (state.pointer.mode === "selection-window" || state.pointer.mode === "selection-lasso") {
    updateSelectionDrag(screen);
    state.pointer.screen = screen;
    statusChip.textContent = state.pointer.mode === "selection-lasso" ? "Лассо: отпустите палец для выбора" : "Выделение: отпустите палец для выбора";
    draw();
    return;
  }
  if (state.pointer.mode === "move" && state.pointer.targetId) {
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
  } else if ((state.pointer.mode === "leader-move" || state.pointer.mode === "leader-arrow") && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity?.dimensionKind === "leader") {
      const currentWorld = screenToWorld(screen);
      const dx = currentWorld.x - state.pointer.world.x;
      const dy = currentWorld.y - state.pointer.world.y;
      if (state.pointer.mode === "leader-arrow") {
        entity.x1 += dx;
        entity.y1 += dy;
        statusChip.textContent = "Выноска: положение стрелки";
      } else {
        moveEntityBy(entity, dx, dy);
        statusChip.textContent = "Перемещение выноски";
      }
      state.pointer.world = currentWorld;
      markProjectDirty("leader-move");
    }
  } else if (state.pointer.mode === "circle-radius" && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity?.type === "circle") {
      const currentWorld = screenToWorld(screen);
      entity.radius = Math.max(1, distanceWorld({ x: entity.cx, y: entity.cy }, currentWorld));
      markProjectDirty("circle-radius");
      updateTopMetricInputs(Math.round(Math.abs(entity.radius)), 0);
      statusChip.textContent = `Круг R ${Math.round(Math.abs(entity.radius))} мм`;
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
      draw();
    }
    return;
  }
  if (state.pointer.mode === "survey-point") {
    if (!state.pointer.moved) commitSurveyPoint();
  } else if (state.pointer.mode === "dimension-attach") {
    if (!state.pointer.moved && state.dimensionAttach) commitDimensionAttach();
  } else if (state.pointer?.mode === "select-only") {
    if (!canceled && !state.pointer.moved) {
      const hitId = state.pointer.tapCandidateId;
      applyTapSelection(hitId);
      if (state.selectedIds.includes(hitId)) state.directManipulationIds.add(hitId);
      const entity = state.entities.find(item => item.id === hitId);
      statusChip.textContent = canDragEntityDirectly(entity)
        ? "Объект активирован. Теперь его можно перетащить"
        : "Объект выбран. Для перемещения нажмите «Переместить»";
    }
  } else if (state.pointer?.mode === "selection-window" || state.pointer?.mode === "selection-lasso") {
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
  } else if (state.pointer.mode === "line-grip") {
    finishLineGrip(state.pointer);
  } else if (state.pointer.mode === "line-edit") {
    if (!state.pointer.moved) pickLineEditPoint(state.pointer.startScreen);
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
  } else if (state.pointer?.mode === "leader-move") {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (!canceled && !state.pointer.moved && state.pointer.editLeaderTextOnTap) {
      if (entity?.dimensionKind === "leader") editLeaderText(entity);
    } else {
      finishPointerMoveUndo();
    }
  } else if (state.pointer?.mode === "leader-arrow") {
    if (!canceled && state.pointer.moved) {
      finishPointerMoveUndo();
    } else {
      statusChip.textContent = "Выноска: тяните синюю точку, чтобы переместить стрелку";
      draw();
    }
  } else if (state.pointer?.mode === "circle-radius") {
    if (!canceled && state.pointer.moved) {
      finishPointerMoveUndo();
    } else {
      showCircleRadiusEditor(state.entities.find((item) => item.id === state.pointer.targetId));
      draw();
    }
  } else if (state.pointer?.mode === "circle-radius-input") {
    if (!canceled && !state.pointer.moved) {
      showCircleRadiusEditor(state.entities.find((item) => item.id === state.pointer.targetId));
      draw();
    } else {
      draw();
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
      state.selectedEndpoint = null;
      applyTapSelection(hitId);
      if (hitId && state.selectedIds.includes(hitId)) state.directManipulationIds.add(hitId);
      if (shouldEditTextFromTap(hitEntity, state.pointer.startScreen)) {
        editTextEntity(hitEntity);
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
  const trackedModes = new Set(["move", "line-endpoint", "dimension-offset", "dimension-start", "dimension-end"]);
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

const viewportDirections = { left: [-1, 0], up: [0, -1], down: [0, 1], right: [1, 0] };
const viewportArrowKeys = { ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down", ArrowRight: "right" };

viewportTools.addEventListener("toggle", () => {
  if (viewportTools.open) syncViewportPlaceLabel();
  draw();
});

viewportTools.addEventListener("click", (event) => {
  if (event.target.closest("summary")) syncViewportPlaceLabel();
  const action = event.target.closest("button[data-view-action]")?.dataset.viewAction;
  if (!action) return;
  if (Object.hasOwn(viewportDirections, action)) {
    panViewport(...viewportDirections[action]);
  } else if (action === "zoom-in" || action === "zoom-out") {
    zoomViewport(action === "zoom-in" ? 1.25 : 0.8);
  } else {
    viewportTools.open = false;
    if (action === "fit") {
      if (event.detail === 0) viewportSummary.focus({ preventScroll: true });
      fitViewport();
    } else if (action === "place") {
      if (event.detail === 0) canvas.focus({ preventScroll: true });
      placeAtViewportCenter();
    } else if (action === "objects") {
      openViewportObjects();
    }
  }
});

document.addEventListener("pointerdown", (event) => {
  if (viewportTools.open && !viewportTools.contains(event.target)) viewportTools.open = false;
});

viewportTools.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !viewportTools.open) return;
  event.preventDefault();
  event.stopPropagation();
  viewportTools.open = false;
  viewportSummary.focus({ preventScroll: true });
});

canvas.addEventListener("focus", draw);
canvas.addEventListener("blur", draw);
canvas.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const direction = viewportArrowKeys[event.key];
  if (direction) {
    panViewport(...viewportDirections[direction], event.shiftKey);
  } else if (event.key === "Enter" && !event.repeat) {
    viewportTools.open = false;
    placeAtViewportCenter();
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
});

function moveEntityBy(entity, dx, dy) {
  if (!entity) return;
  if (entity.type === "polyline") {
    const points = translatePolyline(entity.points, dx, dy);
    if (!points.every(isLinePoint) || !validPolylinePoints(points, entity.closed)) return false;
    applyEntityGeometry(entity, { points });
    return;
  }
  if (isDraftLine(entity)) {
    const geometry = { x1: entity.x1 + dx, y1: entity.y1 + dy, x2: entity.x2 + dx, y2: entity.y2 + dy };
    if (!isValidLine(geometry)) return false;
    applyEntityGeometry(entity, geometry);
    return;
  }
  if (entity.type === "block") {
    entity.x += dx;
    entity.y += dy;
    markProjectDirty("move");
    return;
  }
  if (entity.type === "text") {
    entity.x += dx;
    entity.y += dy;
    markProjectDirty("move");
    return;
  }
  if (entity.type === "circle") {
    entity.cx += dx;
    entity.cy += dy;
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
  if (entity.type === "text") {
    return textEntity(id, entity.x + dx, entity.y + dy, entity.text, entity.height, entity.rotation || 0);
  }
  if (entity.type === "circle") {
    return circleEntity(id, entity.cx + dx, entity.cy + dy, entity.radius, entity.layer || "measure");
  }
  if (entity.type === "wall") {
    const copy = wall(id, entity.x1 + dx, entity.y1 + dy, entity.x2 + dx, entity.y2 + dy);
    copy.width = entity.width || copy.width;
    return copy;
  }
  return line(id, entity.x1 + dx, entity.y1 + dy, entity.x2 + dx, entity.y2 + dy, entity.layer || "measure");
}

function cloneEntityForCommand(entity, dx = 260, dy = 260) {
  if (entity.type === "polyline") {
    const points = translatePolyline(entity.points, dx, dy);
    return points.every(isLinePoint) ? createPolyline(newLineId("polyline"), points, entity) : null;
  }
  if (isDraftLine(entity)) {
    const copy = line(newLineId(), entity.x1 + dx, entity.y1 + dy, entity.x2 + dx, entity.y2 + dy, entity.layer);
    return isValidLine(copy) ? copy : null;
  }
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
  if (entity.type === "polyline") {
    const points = entity.points.map((point) => rotatePointAround(point, base, radians));
    if (!points.every(isLinePoint) || !validPolylinePoints(points, entity.closed)) return false;
    applyEntityGeometry(entity, { points });
    return;
  }
  if (isDraftLine(entity)) {
    const start = rotatePointAround({ x: entity.x1, y: entity.y1 }, base, radians);
    const end = rotatePointAround({ x: entity.x2, y: entity.y2 }, base, radians);
    const geometry = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    if (!isValidLine(geometry)) return false;
    applyEntityGeometry(entity, geometry);
    return;
  }
  if (entity.type === "block") {
    const center = rotatePointAround({ x: entity.x, y: entity.y }, base, radians);
    entity.x = center.x;
    entity.y = center.y;
    entity.rotation = normalizeDegrees((entity.rotation || 0) + radToDeg(radians));
    return;
  }
  if (entity.type === "text") {
    const position = rotatePointAround({ x: entity.x, y: entity.y }, base, radians);
    entity.x = position.x;
    entity.y = position.y;
    entity.rotation = normalizeDegrees((entity.rotation || 0) + radToDeg(radians));
    return;
  }
  if (entity.type === "circle") {
    const position = rotatePointAround({ x: entity.cx, y: entity.cy }, base, radians);
    entity.cx = position.x;
    entity.cy = position.y;
    return;
  }
  rotateLinearEntityAround(entity, base, radians);
}

function mirrorLinearEntity(entity) {
  if (entity.type === "text") {
    entity.rotation = normalizeDegrees(180 - (entity.rotation || 0));
    markProjectDirty("mirror");
    return;
  }
  if (entity.type === "circle") {
    return;
  }
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
  const geometry = dimensionWorldGeometry(entity);
  if (!geometry) return;
  const fixedLine = endpoint === "start" ? geometry.lineEnd : geometry.lineStart;
  const movingLine = endpoint === "start" ? geometry.lineStart : geometry.lineEnd;
  const axis = normalizeWorldVector(movingLine.x - fixedLine.x, movingLine.y - fixedLine.y);
  if (!axis) return;
  const currentBase = endpoint === "start" ? geometry.start : geometry.end;
  const legAxis =
    normalizeWorldVector(movingLine.x - currentBase.x, movingLine.y - currentBase.y) ||
    normalizeWorldVector(-axis.y, axis.x);
  const snapped = snapDimensionHandleToParallel(entity, handlePoint, legAxis || axis);
  const delta = (handlePoint.x - movingLine.x) * axis.x + (handlePoint.y - movingLine.y) * axis.y;
  const nextBase = snapped || (geometry.mode !== "legacy"
    ? { x: currentBase.x + axis.x * delta, y: currentBase.y + axis.y * delta } : handlePoint);
  const nextRef = dimensionRefFromSnap(nearestSnapCandidate(nextBase, snapCandidates({
    includeCorners: state.snaps.has("end"), includeMidpoints: state.snaps.has("mid"),
  }), 3));
  const start = endpoint === "start";
  const linkFields = start ? { refStart: nextRef, lostRefStart: false } : { refEnd: nextRef, lostRefEnd: false };
  if (geometry.mode !== "legacy") {
    const coordinates = endpoint === "start" ? { x1: nextBase.x, y1: nextBase.y } : { x2: nextBase.x, y2: nextBase.y };
    const candidate = { ...entity, ...coordinates };
    adoptDimensionMeasurement(candidate, geometry);
    const next = dimensionGeometry(candidate);
    if (!isLinePoint(nextBase) || !next || next.measurement <= linePointEpsilon) return;
    adoptDimensionMeasurement(entity, geometry);
    Object.assign(entity, coordinates, linkFields);
    ensureDimensionLineGeometry(entity);
    markProjectDirty("dimension-handle");
    return;
  }
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
  } else {
    entity.dimX2 = nextLine.x;
    entity.dimY2 = nextLine.y;
    entity.x2 = nextBase.x;
    entity.y2 = nextBase.y;
  }
  Object.assign(entity, linkFields);
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
  if (!Number.isFinite(length) || length < 1) return null;
  return { x: dx / length, y: dy / length };
}

function entityGeometry(entity) {
  if (!entity) return null;
  if (entity.type === "polyline") return { points: entity.points.map((point) => ({ ...point })) };
  if (entity.type === "block") {
    return { x: entity.x, y: entity.y, width: entity.width, height: entity.height, rotation: entity.rotation || 0, flipX: Boolean(entity.flipX) };
  }
  if (entity.type === "text") {
    return { x: entity.x, y: entity.y, text: entity.text || "", height: entity.height || 260, rotation: entity.rotation || 0 };
  }
  if (entity.type === "circle") {
    return { cx: entity.cx, cy: entity.cy, radius: entity.radius };
  }
  if (entity.dimensionKind === "leader") {
    return { x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2, text: entity.text || "Текст" };
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
    geometry.measurementType = entity.measurementType ?? null;
    geometry.measurementAxis = entity.measurementAxis ?? null;
    geometry.refStart = entity.refStart ?? null;
    geometry.refEnd = entity.refEnd ?? null;
    geometry.lostRefStart = Boolean(entity.lostRefStart);
    geometry.lostRefEnd = Boolean(entity.lostRefEnd);
  }
  return geometry;
}

function applyEntityGeometry(entity, geometry) {
  if (!entity || !geometry) return;
  Object.assign(entity, geometry);
  updateLinkedDimensions();
  markProjectDirty("geometry");
}

function geometryChanged(before, after) {
  if (!before || !after) return false;
  return Object.keys(after).some((key) => {
    const next = after[key];
    const previous = before[key];
    if (Array.isArray(next)) {
      return !Array.isArray(previous) || next.length !== previous.length ||
        next.some((point, index) => distanceWorld(point, previous[index]) > linePointEpsilon);
    }
    if (typeof next !== "number" || typeof previous !== "number") return next !== previous;
    return Math.abs(next - previous) > linePointEpsilon;
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
  if (!entity || !["line", "wall", "polyline"].includes(entity.type) || entity.layer === "dimensions" || !isLayerVisible(entity.layer)) return null;
  if (entity.type === "polyline") {
    const vertices = entity.points.map((point, index) => ({ ...worldToScreen(point), index }));
    const nearest = nearestSnapCandidate(screen, vertices, 20);
    return nearest ? { entityId: entity.id, point: nearest.index } : null;
  }
  let best = null;
  let bestDistance = 20;
  const start = worldToScreen({ x: entity.x1, y: entity.y1 });
  const end = worldToScreen({ x: entity.x2, y: entity.y2 });
  const endpoints = [{ point: "start", screen: start }, { point: "end", screen: end }];
  if (isDraftLine(entity) && distanceWorld(start, end) > 38) {
    endpoints.push({ point: "middle", screen: midpoint(start, end) });
  }
  for (const endpoint of endpoints) {
    const distance = Math.hypot(screen.x - endpoint.screen.x, screen.y - endpoint.screen.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { entityId: entity.id, point: endpoint.point };
    }
  }
  return best;
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
  if (entity.type === "text") {
    const origin = worldToScreen({ x: entity.x, y: entity.y });
    const height = Math.max(10, Math.abs(entity.height || 260) * state.view.scale);
    const width = Math.max(height * 0.8, String(entity.text || "Текст").length * height * 0.58);
    const radians = -((entity.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = screen.x - origin.x;
    const dy = screen.y - origin.y;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    if (localX >= -8 && localX <= width + 8 && localY >= -height - 8 && localY <= 8) return 0;
    const clampedX = Math.max(0, Math.min(width, localX));
    const clampedY = Math.max(-height, Math.min(0, localY));
    return Math.hypot(localX - clampedX, localY - clampedY);
  }
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
  if (entity.type === "polyline") {
    let distance = Infinity;
    for (const { p1, p2 } of polylineSegments(entity)) {
      distance = Math.min(distance, pointToSegmentDistance(screen, worldToScreen(p1), worldToScreen(p2)));
    }
    return distance;
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
    if (tool === "annotation") {
      activateAnnotationToolMenu();
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
    hideAnnotationToolMenu();
    hideSelectToolMenu();
    setTool(tool);
  });
});

figureToolButton?.addEventListener("click", () => {
  if (drawToolMenu.hidden) {
    showDrawToolMenu();
    const firstOption = drawToolMenu.querySelector("button[aria-pressed='true']") || drawToolMenu.querySelector("button");
    firstOption?.focus({ preventScroll: true });
  } else {
    hideDrawToolMenu();
  }
  draw();
});

drawToolMenu?.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  hideDrawToolMenu();
  figureToolButton?.focus({ preventScroll: true });
});

drawToolMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-draw-tool]");
  if (!button) return;
  selectDrawTool(button.dataset.drawTool);
  figureToolButton?.focus({ preventScroll: true });
});

dimensionToolMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-dimension-tool]");
  if (!button) return;
  selectDimensionTool(button.dataset.dimensionTool);
});

annotationToolMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-annotation-tool]");
  if (!button) return;
  selectAnnotationTool(button.dataset.annotationTool);
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

leaderTextInput?.addEventListener("focus", updateViewportLock);
leaderTextInput?.addEventListener("blur", () => window.setTimeout(updateViewportLock, 80));
leaderTextInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    state.drawing = null;
    hideLeaderTextEditor();
    statusChip.textContent = dimensionToolStatusText();
    draw();
  }
});

function nextDimensionSnap() {
  const origin = rawCursorWorld();
  const { snapCount, snapIndex } = resolveDimensionPointSnap(origin);
  if (snapCount > 1) {
    state.dimensionSnapChoice = { origin, index: (snapIndex + 1) % snapCount };
    draw();
  }
}

function onDimensionButton(button, action) {
  let press = null;
  button.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    press = event.pointerId;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointerup", (event) => {
    if (press !== event.pointerId) return;
    press = null;
    if (button.contains(document.elementFromPoint(event.clientX, event.clientY))) action();
  });
  button.addEventListener("lostpointercapture", (event) => {
    if (press === event.pointerId) press = null;
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) action();
  });
}

onDimensionButton(dimensionNextSnap, nextDimensionSnap);
onDimensionButton(dimensionLinkCancel, cancelDimensionAttach);
for (const button of dimensionLinkButtons) {
  onDimensionButton(button, () => startDimensionAttach(button.dataset.dimensionAnchor));
}

dimensionAxis.addEventListener("change", () => {
  if (state.tool !== "dimension" || state.dimensionTool !== "linear" || state.drawing?.phase !== "offset") return;
  const { start, end } = state.drawing;
  state.drawing.axisOverride = dimensionAxis.value || null;
  const geometry = dimensionGeometry(draftDimension(start, end));
  if (geometry) statusChip.textContent = `Размер ${formatDimensionLength(geometry)} мм. Укажите положение размерной линии`;
  draw();
});

snaps.forEach((button) => {
  button.addEventListener("click", () => {
    const snap = button.dataset.snap;
    if (state.snaps.has(snap)) {
      state.snaps.delete(snap);
    } else {
      if (snap === "ortho") state.snaps.delete("polar");
      if (snap === "polar") state.snaps.delete("ortho");
      state.snaps.add(snap);
    }
    state.dimensionSnapChoice = null;
    syncSnapButtons();
    markProjectDirty("snaps");
    const names = {
      grid: "Сетка",
      end: "Конец",
      mid: "Середина",
      polar: `Полярное отслеживание ${state.polarStep}°`,
      ortho: "Орто",
      intersection: "Пересечение",
      perpendicular: "Перпендикуляр",
      nearest: "Ближайшая точка",
    };
    statusChip.textContent = `${names[snap]}: ${state.snaps.has(snap) ? "включено" : "выключено"}`;
    draw();
  });
});

authForm?.addEventListener("submit", submitAuthForm);
authDevButton?.addEventListener("click", () => {
  loginAsDeveloper().catch((error) => {
    console.warn("Developer login failed", error);
    setAuthError("Не удалось войти как разработчик");
  });
});
authModeButton?.addEventListener("click", () => {
  authState.mode = authState.mode === "login" ? "register" : "login";
  setAuthError("");
  renderAuthUi();
});
logoutButton?.addEventListener("click", () => {
  logoutAccount().catch((error) => {
    console.warn("Logout failed", error);
    setAuthError("Не удалось выйти");
  });
});
projectSearchInput?.addEventListener("input", renderProjectList);
refreshProjectsButton?.addEventListener("click", loadProjects);
projectTrashButton?.addEventListener("click", () => {
  persistence.showingTrash = !persistence.showingTrash;
  if (projectSearchInput) projectSearchInput.value = "";
  showProjectMessage();
  renderProjectList();
  loadProjects();
});
createProjectButton?.addEventListener("click", () => createBlankProjectButton?.click());
createBlankProjectButton?.addEventListener("click", async () => {
  const name = await askProjectName("Название нового проекта", "Новый замер");
  if (!name) return;
  createProject({ name, template: "blank" }).catch((error) => {
    console.warn("Create blank project failed", error);
    showProjectMessage(error.message || "Проект не создан", true);
  });
});
projectImportInput?.addEventListener("change", () => {
  importProjectFile(projectImportInput.files?.[0]).catch((error) => {
    console.warn("Import project failed", error);
    showProjectMessage(error.message || "Импорт не удался", true);
  });
});
projectList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-project-action]");
  if (!button || button.getAttribute("aria-busy") === "true") return;
  button.setAttribute("aria-busy", "true");
  try {
    await handleProjectAction(button.dataset.projectAction, button.dataset.projectId);
  } finally {
    button.removeAttribute("aria-busy");
  }
});
projectList?.addEventListener("dblclick", (event) => {
  if (persistence.showingTrash || event.target.closest("button[data-project-action]")) return;
  const card = event.target.closest(".project-card[data-project-id]");
  if (card) handleProjectAction("open", card.dataset.projectId);
});
backToProjectsButton?.addEventListener("click", () => {
  showProjectHome().catch((error) => console.warn("Project home failed", error));
});

lineDirection.addEventListener("change", () => {
  if (state.tool !== "line" || !state.drawing) return;
  state.drawing.metricDirection = lineDirection.value;
  const edit = state.numericEdit?.lineMetric;
  if (edit?.key === state.drawing.start) updateLineMetricPreview(edit);
  draw();
});

bindPointAction(lineSkipSnap, () => {
  if (!["line", "polyline"].includes(state.tool) || surveyPointPicker) return;
  state.skipLineObjectSnap = !state.skipLineObjectSnap;
  resetSnapTracking();
  statusChip.textContent = state.skipLineObjectSnap
    ? "Следующая точка без объектной привязки"
    : "Объектные привязки восстановлены";
  draw();
});

linePointAssist.addEventListener("focusout", (event) => {
  if (!linePointAssist.contains(event.relatedTarget) && !lineMetricKinds.has(event.relatedTarget) &&
      event.relatedTarget !== keyboardConfirmButton) {
    clearLineMetricEdit();
    draw();
  }
});

for (const [input, kind] of lineMetricKinds) {
  if (!input) continue;
  const apply = input === topLengthInput || input === topAngleInput ? applyTopMetricValue : applyInlineValue;
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (lineMetricContext()) {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        if (event.key === "Enter") confirmKeyboardInput();
        else cancelLineMetricInput();
      }
    } else if (event.key === "Enter") {
      apply(kind, { recordUndo: false });
      input.blur();
    }
  });
  input.addEventListener("input", () => {
    syncInlineEditorWidth(input);
    if (lineMetricContext()) updateLineMetricInput(input);
    else apply(kind, { recordUndo: false });
    positionKeyboardConfirmButton();
  });
  input.addEventListener("blur", (event) => {
    if (lineMetricContext() || state.numericEdit?.lineMetric) {
      if (!lineMetricKinds.has(event.relatedTarget) && event.relatedTarget !== keyboardConfirmButton &&
          !linePointAssist.contains(event.relatedTarget)) {
        clearLineMetricEdit();
        draw();
      }
      return;
    }
    apply(kind, { recordUndo: false });
    commitNumericInputEdit();
  });
}

lineUi.lineEditCancel.addEventListener("click", () => {
  const sourceId = state.lineEdit?.sourceId;
  endLineEdit("Правка отменена");
  setSelection(sourceId);
});
lineUi.lineEditFinish.addEventListener("click", () => endLineEdit("Правка завершена"));
lineUi.lineEditApply.addEventListener("click", applyLineEditPreview);
lineUi.lineBoundaryMode.addEventListener("change", () => {
  const edit = state.lineEdit;
  if (!edit) return;
  edit.pending = null;
  edit.boundaryIds = [];
  edit.boundaryReady = false;
  setSelection(edit.sourceId);
  setLineEditHint(lineUi.lineBoundaryMode.value === "selected" ? "Выберите границы" : "Коснитесь линии для правки");
  draw();
});
lineUi.lineBreakMode.addEventListener("change", () => {
  const edit = state.lineEdit;
  if (!edit) return;
  edit.pending = null;
  edit.firstPick = null;
  setLineEditHint(lineUi.lineBreakMode.value === "point" ? "Укажите точку деления" : "Укажите первую точку зазора");
  draw();
});
for (const input of [lineUi.lineEditRadius, lineUi.lineMirrorDelete, lineUi.lineLengthInput, lineUi.lineLengthMode]) {
  input.addEventListener("input", () => {
    if (state.lineEdit?.pending) {
      state.lineEdit.pending = null;
      setLineEditHint("Укажите точку с новыми параметрами");
      draw();
    }
  });
}
lineUi.linePolarStep.addEventListener("change", () => {
  const step = Number(lineUi.linePolarStep.value);
  if (![5, 15, 30, 45, 90].includes(step)) return;
  state.polarStep = step;
  resetSnapTracking();
  markProjectDirty("polar-step");
  draw();
});
lineUi.lineEditForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitLineLength();
});
lineUi.lineLengthInput.addEventListener("input", () => {
  if (!state.lineEdit) return;
  state.lineEdit.amount = null;
  lineUi.lineLengthInput.removeAttribute("aria-invalid");
});
lineUi.lineLengthMode.addEventListener("change", () => {
  if (!state.lineEdit) return;
  const mode = lineUi.lineLengthMode.value;
  state.lineEdit.amount = null;
  state.lineEdit.firstPick = null;
  state.lineEdit.lengthMode = mode;
  syncLineQuantityFields();
  if (mode === "through") setLineEditHint("Коснитесь точки, через которую пройдёт параллельная линия");
  else if (mode === "dynamic") setLineEditHint("Коснитесь линии ближе к нужному концу");
  else setLineEditHint("Введите значение и нажмите галочку");
  draw();
});
lineUi.lineEditRadius.addEventListener("keydown", (event) => {
  if (event.key === "Enter") lineUi.lineEditRadius.blur();
});
document.addEventListener("keydown", (event) => {
  if (state.dimensionAttach && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    cancelDimensionAttach();
    return;
  }
  if (event.target.closest("input, textarea, select, [contenteditable], button, summary")) return;
  if (state.lineEdit && event.key === "Escape") {
    event.preventDefault();
    lineUi.lineEditCancel.click();
  } else if (state.lineEdit && event.key === "Enter") {
    event.preventDefault();
    if (!lineUi.lineEditApply.hidden) lineUi.lineEditApply.click();
    else if (!lineUi.lineEditFinish.hidden) lineUi.lineEditFinish.click();
  } else if (["line", "polyline"].includes(state.tool) && (event.key === "Enter" || event.key === "Escape")) {
    event.preventDefault();
    if (event.key === "Escape" && !state.drawing) activatePlainSelect();
    else finishLineCommand();
  } else if (["line", "polyline"].includes(state.tool) && event.key === "F8") {
    event.preventDefault();
    document.querySelector('[data-snap="ortho"]').click();
  }
});

selectionActions?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  applySelectionAction(button.dataset.action);
});

function bindPointAction(button, action) {
  let press = null;
  button.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    press = { pointerId: event.pointerId, bounds: button.getBoundingClientRect() };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointerup", (event) => {
    if (press?.pointerId !== event.pointerId) return;
    const { bounds } = press;
    press = null;
    if (event.clientX >= bounds.left && event.clientX <= bounds.right &&
        event.clientY >= bounds.top && event.clientY <= bounds.bottom) action();
  });
  button.addEventListener("lostpointercapture", (event) => {
    if (press?.pointerId === event.pointerId) press = null;
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) action();
  });
}

bindPointAction(keyboardConfirmButton, confirmKeyboardInput);

keyboardInputs.forEach((input) => {
  input.addEventListener("focus", () => {
    lastNumericInput = input;
    shell.classList.add("input-focused");
    beginNumericInputEdit(input);
    selectInlineValue(input);
    if (keyboardConfirmButton) keyboardConfirmButton.hidden = false;
    positionKeyboardConfirmButton();
    if (state.tool === "line") draw();
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
  themeButton.setAttribute("aria-pressed", String(state.theme === "dark"));
  themeButton.innerHTML = cadIcon(state.theme === "light" ? "moon" : "sun");
      window.ZamerAndroid?.setTheme?.(state.theme);
  draw();
  markProjectDirty("theme");
});

annotationScaleSelect?.addEventListener("change", () => {
  setAnnotationScale(annotationScaleSelect.value);
  statusChip.textContent = `Масштаб аннотаций ${annotationScaleSelect.selectedOptions[0]?.textContent || "1:100"}`;
});

document.getElementById("undoButton").addEventListener("click", () => {
  if (undoLineSegment()) return;
  const action = state.undo.pop();
  if (!action) return;
  if (state.lineEdit) endLineEdit("Правка отменена");
  if (action.type === "line-edit") {
    state.redo.push(action);
    restoreLineEdit(action.after, action.before);
  } else if (action.type === "add") {
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
  if (state.drawing || state.lineEdit) return;
  const action = state.redo.pop();
  if (!action) return;
  if (action.type === "line-edit") {
    state.undo.push(action);
    restoreLineEdit(action.before, action.after);
  } else if (action.type === "add") {
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

const exportScope = document.getElementById("exportScope");
const exportScale = document.getElementById("exportScale");
const exportPhotos = document.getElementById("exportPhotos");
const exportPhotoOption = document.getElementById("exportPhotoOption");
const exportSummary = document.getElementById("exportSummary");
const exportResult = document.getElementById("exportResult");
const exportFileActions = document.getElementById("exportFileActions");
let exportInProgress = false;
let lastNativeExportId = null;

function exportDraftVertexCount() {
  return state.tool === "polyline" ? state.drawing?.points?.length || 0 : 0;
}

function exportDetails() {
  const details = typeof surveyExportDetails === "function" ? surveyExportDetails() : null;
  return { records: [], entities: [], ...details };
}

function selectedExportGeometry(entities, details, visibleLayers) {
  const all = entities.concat(details.entities || []);
  return exportScope.value === "all" ? all : all.filter((entity) => visibleLayers.has(entity.layer || "measure"));
}

function lostExportAnchors(entity) {
  if (!isLinearDimension(entity)) return [];
  return [["start", "начало"], ["end", "конец"]].filter(([key]) => dimensionAnchorLink(entity, key) === "lost");
}

function dimensionExportWarning(entities) {
  const lost = entities.filter((entity) => lostExportAnchors(entity).length).length;
  return lost ? `Размеров с потерянной опорой: ${lost}. На плане останутся последние координаты.` : "";
}

function dimensionExportNotes(entities) {
  return entities.flatMap((entity) => {
    const lost = lostExportAnchors(entity);
    if (!lost.length) return [];
    const value = formatDimensionLength(dimensionGeometry(entity));
    const positions = lost.map(([key, name]) => {
      const point = key === "start" ? [entity.x1, entity.y1] : [entity.x2, entity.y2];
      return `${name} X ${surveyNumber(point[0])}, Y ${surveyNumber(-point[1])} мм`;
    });
    return [{ label: `Размер ${value} мм`, detail: `Потеряна опора. Последние точки · ${positions.join(" · ")}` }];
  });
}

function syncExportOptions() {
  const details = exportDetails();
  const entities = selectedExportGeometry(state.entities, details, state.visibleLayers);
  const layers = new Set(entities.map((entity) => entity.layer || "measure"));
  const vertexCount = exportDraftVertexCount();
  const includesDraft = vertexCount >= 2 && (exportScope.value === "all" || state.visibleLayers.has("measure"));
  if (includesDraft) layers.add("measure");
  const skipped = state.entities.length + (details.entities?.length || 0) - entities.length;
  const hiddenLayers = new Set([...state.entities, ...details.entities].map((entity) => entity.layer || "measure")
    .filter((layer) => !state.visibleLayers.has(layer)));
  if (vertexCount >= 2 && !state.visibleLayers.has("measure")) hiddenLayers.add("measure");
  const layerNames = (ids) => [...ids].map((id) => layerMeta[id]?.name || id).join(", ");
  const draftMessage = vertexCount >= 2 ? ` Полилиния из ${vertexCount} вершин будет завершена.` : "";
  const dimensionWarning = dimensionExportWarning(entities);
  const hiddenMessage = exportScope.value === "visible" && hiddenLayers.size ? ` Скрыто объектов: ${skipped + Number(vertexCount >= 2 && !includesDraft)}. Слои: ${layerNames(hiddenLayers)}.` : "";
  exportSummary.textContent = `План: ${entities.length + Number(includesDraft)} объектов.`
    + (layers.size ? ` Слои: ${layerNames(layers)}.` : "") + hiddenMessage + draftMessage + " В копии .zamer сохраняются все слои."
    + (dimensionWarning ? ` ${dimensionWarning}` : "");
  exportPhotoOption.hidden = !details.records?.some(({ photo }) => Boolean(photo));
  if (exportPhotoOption.hidden) exportPhotos.checked = false;
}

function setExportResult(message, error = false) {
  exportResult.textContent = message;
  exportResult.dataset.error = String(error);
}

document.getElementById("exportButton").addEventListener("click", (event) => {
  if (!exportInProgress) {
    setExportResult("");
    lastNativeExportId = null;
    exportFileActions.hidden = true;
  }
  syncExportOptions();
  showSheet(exportSheet, event.currentTarget);
});
exportScope.addEventListener("change", syncExportOptions);

document.getElementById("openExportFile").addEventListener("click", () => {
  if (lastNativeExportId) window.ZamerAndroid?.showExport?.(lastNativeExportId, false);
});
document.getElementById("shareExportFile").addEventListener("click", () => {
  if (lastNativeExportId) window.ZamerAndroid?.showExport?.(lastNativeExportId, true);
});

document.getElementById("layersButton").addEventListener("click", (event) => {
  renderLayerList();
  showSheet(layersSheet, event.currentTarget);
  statusChip.textContent = "Слои: выключайте лишнее для скорости и чистоты";
});

document.getElementById("closeLayersButton").addEventListener("click", () => hideSheet(layersSheet));
document.getElementById("closeExportButton").addEventListener("click", () => hideSheet(exportSheet));

function renderExportPlan(context, view, entities) {
  const editorContext = ctx;
  const editorView = state.view;
  const editorTheme = state.theme;
  const palette = { bg: "#ffffff", wall: "#203245", line: "#203245", dimension: "#183d72", accent: "#183d72", surface: "#ffffff" };
  // Only the synchronous paint uses the print camera. Browser events and
  // attachment decoding run after the editor context has been restored.
  ctx = context;
  state.view = view;
  state.theme = "light";
  printRendering = true;
  try {
    drawWalls(entities, palette);
    for (const entity of entities) {
      if (entity.type !== "wall") drawEntity(entity, palette);
    }
  } finally {
    printRendering = false;
    state.theme = editorTheme;
    state.view = editorView;
    ctx = editorContext;
  }
}

async function exportCurrentProject(type) {
  if (exportInProgress || !persistence.projectId) return;
  exportInProgress = true;
  const projectId = persistence.projectId;
  lastNativeExportId = null;
  exportFileActions.hidden = true;
  for (const button of exportCards) button.disabled = true;
  setExportResult("Подготавливаю файл…");
  try {
    if (exportDraftVertexCount() >= 2 && !finishLineCommand()) {
      throw new Error("Завершите полилинию перед выгрузкой");
    }
    updateLinkedDimensions();
    const saved = await saveProjectNow();
    if (persistence.projectId !== projectId) return;
    const project = serializeProject();
    const details = exportDetails();
    if (persistence.needsRemoteSync || persistence.dirty) details.revision = "локальная";
    const name = String(details.site || project.name || "Замер").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "Замер";
    const room = String(details.room || "").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 35);
    const planName = room ? `${name}-${room}` : name;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const entities = selectedExportGeometry(project.entities, details, new Set(project.visibleLayers));
    details.records.push(...dimensionExportNotes(entities));
    const pdf = () => buildPlotPdf(project, entities, details, {
      scale: exportScale.value, photos: exportPhotos.checked,
      layerLabel: exportScope.value === "all" ? "все слои" : "видимые слои",
    }, renderExportPlan);
    const dxf = (revit = false) => {
      const includeReadings = exportScope.value === "all" || project.visibleLayers.includes("dimensions");
      const drawing = includeReadings ? entities.concat(surveyDxfLegend(entities, details.records)) : entities;
      if (!drawing.length) throw new Error("На выбранных слоях нет объектов для DXF. Попробуйте выбрать все слои.");
      return revit ? buildRevitDxf(drawing) : buildDxf(drawing);
    };
    const backup = () => JSON.stringify(project, null, 2);
    let file;
    if (type === "zamer") {
      file = await downloadFile(`${name}-${stamp}.zamer`, backup(), "application/json");
    } else if (type === "pdf") {
      file = await downloadFile(`${planName}-${stamp}.pdf`, await pdf(), "application/pdf");
    } else if (type === "zip") {
      const cad = dxf();
      const plot = await pdf();
      const bundle = buildZip([
        { name: `${planName}.pdf`, data: new Uint8Array(await plot.arrayBuffer()) },
        { name: `${planName}.dxf`, data: cad },
        { name: `${name}.zamer`, data: backup() },
      ]);
      file = await downloadFile(`${planName}-${stamp}.zip`, bundle, "application/zip");
    } else {
      const isRevit = type === "revit-dxf";
      const suffix = isRevit ? "-revit-mm" : "";
      file = await downloadFile(`${planName}-${stamp}${suffix}.dxf`, dxf(isRevit), "application/dxf");
    }
    if (persistence.projectId !== projectId) return;
    lastNativeExportId = file.requestId || null;
    exportFileActions.hidden = !lastNativeExportId;
    const message = file.native ? `Загрузки / Zamer CAD / ${file.filename}` : `Файл подготовлен — ${file.filename}`;
    setExportResult([
      message, type === "revit-dxf" ? "Единицы импорта в Revit — миллиметры." : "",
      type === "zamer" ? "" : dimensionExportWarning(entities),
      saved ? "" : "Изменения в проекте пока не записаны. Текущий снимок сохранён в выгруженном файле.",
    ].filter(Boolean).join(" "));
    syncExportOptions();
  } catch (error) {
    if (persistence.projectId === projectId) setExportResult(error?.message || "Не удалось подготовить файл", true);
  } finally {
    exportInProgress = false;
    for (const button of exportCards) button.disabled = false;
  }
}

for (const button of exportCards) {
  button.addEventListener("click", () => exportCurrentProject(button.dataset.export));
}

const sheetOpeners = new WeakMap();

function showSheet(sheet, opener = document.activeElement) {
  if (!sheet) return;
  for (const candidate of [layersSheet, exportSheet]) {
    if (candidate !== sheet) hideSheet(candidate, { restoreFocus: false });
  }
  if (sheet.hidden && opener instanceof HTMLElement) {
    sheetOpeners.set(sheet, opener);
    if (opener.hasAttribute("aria-controls")) opener.setAttribute("aria-expanded", "true");
  }
  sheet.hidden = false;
  sheet.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
}

function hideSheet(sheet, { restoreFocus = true } = {}) {
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  const opener = sheetOpeners.get(sheet);
  sheetOpeners.delete(sheet);
  if (!opener?.isConnected) return;
  if (opener.hasAttribute("aria-controls")) opener.setAttribute("aria-expanded", "false");
  if (restoreFocus) opener.focus({ preventScroll: true });
}

shell.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const sheet = event.target.closest(".bottom-sheet:not([hidden])");
  if (!sheet || ![layersSheet, exportSheet].includes(sheet)) return;
  event.preventDefault();
  event.stopPropagation();
  hideSheet(sheet);
});

function renderLayerList() {
  if (!layerList) return;
  layerList.replaceChildren();
  for (const [id, meta] of Object.entries(layerMeta)) {
    const count = state.entities.filter((entity) => (entity.layer || "measure") === id).length;
    if (!count && (id === "walls" || id === "furniture")) continue;
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
      markProjectDirty("layers");
      statusChip.textContent = `${meta.name}: ${input.checked ? "включен" : "скрыт"}`;
    });
    layerList.appendChild(item);
  }
}

function acceptedSurveyDraft() {
  if (state.tool !== "polyline" || !state.drawing?.points?.length) return undefined;
  return { tool: "polyline", points: state.drawing.points.map(({ x, y }) => ({ x, y })) };
}

function restoreAcceptedSurveyDraft(draft) {
  state.tool = "select";
  shell.dataset.tool = "select";
  if (draft?.tool !== "polyline" || !Array.isArray(draft.points) || !draft.points.length ||
      !draft.points.every(isLinePoint) || (draft.points.length > 1 && !validPolylinePoints(draft.points))) return;
  const points = draft.points.map(({ x, y }) => ({ x, y }));
  const start = points.at(-1);
  state.tool = "polyline";
  shell.dataset.tool = "polyline";
  state.drawing = { points, start, end: start, lockedEnd: false };
}

function activeSurveyRoom() {
  return state.survey.rooms.find((room) => room.id === state.survey.activeRoomId) || state.survey.rooms[0];
}

function switchSurveyRoom(roomId) {
  const nextRoom = state.survey.rooms.find((room) => room.id === roomId);
  const previousRoom = activeSurveyRoom();
  if (!nextRoom || nextRoom === previousRoom) return;
  previousRoom.drawing = { entities: state.entities, view: { ...state.view }, draft: acceptedSurveyDraft() };
  const drawing = nextRoom.drawing;
  state.drawing = null;
  setTool("select");
  setSelection(null);
  state.entities = (drawing?.entities || []).map(cloneProjectEntity).filter(Boolean);
  state.view = {
    scale: Number.isFinite(drawing?.view?.scale) ? clampScale(drawing.view.scale) : 0.085,
    panX: Number.isFinite(drawing?.view?.panX) ? drawing.view.panX : 92,
    panY: Number.isFinite(drawing?.view?.panY) ? drawing.view.panY : 84,
  };
  state.undo = [];
  state.redo = [];
  restoreAcceptedSurveyDraft(drawing?.draft);
  delete nextRoom.drawing;
  state.survey.activeRoomId = nextRoom.id;
  statusChip.textContent = `Помещение «${nextRoom.name}» открыто`;
  renderLayerList();
  syncToolButtons();
  markProjectDirty("survey-room");
  draw();
}

function setSurveyPointPicker(label, callback) {
  surveyPointPicker = { label, callback };
  statusChip.textContent = `${label}. Наведите курсор и коснитесь холста`;
  canvas.focus({ preventScroll: true });
  draw();
}

function commitSurveyPoint() {
  const point = resolveDimensionPointSnap(rawCursorWorld(), { start: null }).point;
  if (!isLinePoint(point)) {
    statusChip.textContent = "Точка замера вне допустимой области";
    draw();
    return;
  }
  const picker = surveyPointPicker;
  surveyPointPicker = null;
  draw();
  picker.callback({ x: point.x, y: point.y });
}

function drawSurveyMarks(c, rect) {
  const room = activeSurveyRoom();
  if (isLayerVisible("dimensions")) {
    ctx.save();
    ctx.strokeStyle = c.dimension;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    for (const record of room.records) {
      if (!record.point || !record.end) continue;
      const start = worldToScreen(record.point);
      const end = worldToScreen(record.end);
      linePath(start.x, start.y, end.x, end.y);
    }
    ctx.restore();
    for (const marker of surveyMarkers(room.records)) {
      const record = marker.firstRecord;
      const point = worldToScreen(marker.point);
      if (point.x < -30 || point.x > rect.width + 30 || point.y < -30 || point.y > rect.height + 30) continue;
      ctx.save();
      ctx.strokeStyle = c.dimension;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const height = marker.count === 1 && record.kind === "point" && Number.isFinite(record.values.height)
        ? ` · Z ${surveyNumber(record.values.height)} мм` : "";
      drawBadge(marker.label + height, point.x, point.y - 15, c, true, true);
    }
  }
  if (!surveyPointPicker) return;
  const point = worldToScreen(resolveDimensionPointSnap(rawCursorWorld(), { start: null }).point);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  linePath(point.x - 15, point.y, point.x + 15, point.y);
  linePath(point.x, point.y - 15, point.x, point.y + 15);
  ctx.restore();
}

function surveyExportDetails() {
  const { site, visitDate, operator, datum } = state.survey;
  const room = activeSurveyRoom();
  const records = room.records.map((record) => ({
    label: `№${record.number} ${record.title}`,
    detail: describeSurveyRecord(record, state.entities, datum).detail,
    photo: record.photo || undefined,
  }));
  const entities = [];
  for (const [index, marker] of surveyMarkers(room.records).entries()) {
    const {x, y} = marker.point;
    entities.push(textEntity(`survey-label-${index}`, x + 50, y - 70, marker.label, 155));
    entities.push(circleEntity(`survey-anchor-${index}`, x, y, 25, "dimensions"));
  }
  return { site, room: room.name, visitDate, operator, datum, revision: persistence.revision, records, entities };
}

function surveyDxfLegend(entities, records) {
  if (!records.length) return [];
  const bounds = pdfPlotBounds(entities);
  const x = (bounds?.maxX ?? 0) + 600;
  const y = bounds?.minY ?? 0;
  const labels = records.flatMap(({ label, detail }) => [label, ...(detail.match(/.{1,76}(?:\s|$)|\S+/gu) || [])]);
  return [textEntity("survey-legend-title", x, y, "Ведомость замеров · мм", 220),
    ...labels.map((label, index) => textEntity(`survey-legend-${index}`, x, y + 320 + index * 230, label.trim(), 155)),
  ];
}

function initSurveyPanel() {
  const dialog = document.getElementById("surveySheet");
  surveyPanel = bindSurveyPanel(dialog, {
    context: () => ({ survey: state.survey, room: activeSurveyRoom(), entities: state.entities, name: persistence.projectName }),
    newId: () => newLineId("reading"),
    selectedOutline: () => selectedEntities().find((entity) => entity.type === "polyline" && entity.closed)?.id || "",
    selectRoom: switchSurveyRoom,
    saveRoom: ({ name, preset }, edit) => {
      if (edit) {
        Object.assign(activeSurveyRoom(), { name, preset });
        markProjectDirty("survey-room");
      } else {
        const room = surveyRoom(newLineId("room"), name, preset);
        state.survey.rooms.push(room);
        switchSurveyRoom(room.id);
      }
    },
    savePassport: ({ site, visitDate, operator, datum, tolerance }) => {
      Object.assign(state.survey, { site: site.trim().slice(0, 150), visitDate, operator: operator.trim().slice(0, 100),
        datum: datum.trim().slice(0, 100) || "Чистый пол", tolerance: Number(tolerance) });
      markProjectDirty("survey-passport");
    },
    saveRecord: (draft) => {
      const record = normalizeSurveyRecord({ ...draft, recordedAt: draft.recordedAt || new Date().toISOString() });
      const room = activeSurveyRoom();
      const index = room.records.findIndex(({ id }) => id === record.id);
      if (index === -1) {
        record.number = room.nextRecordNumber++;
        room.records.push(record);
      }
      else room.records[index] = record;
      markProjectDirty("survey-record");
      draw();
    },
    removeRecord: (id) => {
      const room = activeSurveyRoom();
      room.records = room.records.filter((record) => record.id !== id);
      markProjectDirty("survey-record-delete");
      draw();
    },
    pickPoint: setSurveyPointPicker,
    locate: (record) => {
      const outline = state.entities.find(({ id }) => id === record.outlineId);
      const point = record.point || outline?.points?.[0];
      if (point) {
        centerViewOnWorldPoint(point);
        statusChip.textContent = `Запись №${record.number} «${record.title}» в центре плана`;
        canvas.focus({ preventScroll: true });
      }
      if (outline) setSelection(outline.id);
      draw();
    },
    createLaser: createSurveyLaser,
  });
  document.getElementById("surveyTool").addEventListener("click", () => {
    if (!persistence.projectId) return;
    if (surveyPointPicker) {
      const picker = surveyPointPicker;
      surveyPointPicker = null;
      picker.callback(null);
      draw();
      return;
    }
    hideSheet(layersSheet, { restoreFocus: false });
    hideSheet(exportSheet, { restoreFocus: false });
    surveyPanel.open();
  });
  document.addEventListener("keydown", (event) => {
    if (!surveyPointPicker || event.key !== "Escape") return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const picker = surveyPointPicker;
    surveyPointPicker = null;
    picker.callback(null);
    draw();
  }, true);
}

window.addEventListener("resize", updateViewportLock);
window.addEventListener("orientationchange", () => {
  lockPortraitOrientation();
  stableViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || stableViewportHeight);
  window.setTimeout(updateViewportLock, 250);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) lockPortraitOrientation();
});
window.addEventListener("scroll", lockDocumentScroll, { passive: true });
window.visualViewport?.addEventListener("resize", updateViewportLock);
window.visualViewport?.addEventListener("scroll", updateViewportLock);
window.addEventListener("beforeunload", flushProjectBeforeUnload);
window.addEventListener("pagehide", flushProjectBeforeUnload);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushProjectBeforeUnload();
  else checkActiveSession();
});
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) normalizeDynamicText(node);
    normalizeTextNode(mutation.target);
  }
}).observe(document.body, { childList: true, characterData: true, subtree: true });
updateViewportLock();
setAnnotationScale(state.annotationScale, { save: false });
prepareSelectMenuStructure();
setTool("select");
initAppInstallPrompt();
initSurveyPanel();
initAuthGate();
lockPortraitOrientation();
window.zamerDebug = {
  exportDxf: () => buildDxf(state.entities),
  exportRevitDxf: () => buildRevitDxf(state.entities),
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

const nativeExportRequests = new Map();

window.zamerNativeExportResult = (requestId, result) => {
  const request = nativeExportRequests.get(requestId);
  if (!request) return;
  nativeExportRequests.delete(requestId);
  clearTimeout(request.timeout);
  if (result?.ok) request.resolve({ ...result, requestId, native: true });
  else request.reject(new Error(result?.message || "Не удалось сохранить файл"));
};

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("Не удалось прочитать подготовленный файл"));
    reader.readAsDataURL(blob);
  });
}

async function downloadFile(filename, content, mimeType, { share = false } = {}) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  if (nativeApkMode && window.ZamerAndroid?.exportFile) {
    if (blob.size > 32 * 1024 * 1024) throw new Error("Файл больше 32 МБ. Выгрузите план и ведомость без фотографий или уменьшите вложения.");
    const base64 = await fileToBase64(blob);
    const requestId = globalThis.crypto?.randomUUID?.() || `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        nativeExportRequests.delete(requestId);
        reject(new Error("Android не подтвердил запись. Проверьте папку Загрузки."));
      }, 60_000);
      nativeExportRequests.set(requestId, { resolve, reject, timeout });
      try {
        window.ZamerAndroid.exportFile(requestId, filename, mimeType, base64, share);
      } catch {
        window.zamerNativeExportResult(requestId, { ok: false, message: "Не удалось открыть запись файлов Android" });
      }
    });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  return { filename, chooserOpened: false, native: false };
}

// Enhance existing controls without replacing their listeners or accessible labels.
for (const [id, icon] of Object.entries({createProjectButton:'plus', backToProjectsButton:'back', undoButton:'undo', redoButton:'redo', layersButton:'layers', exportButton:'import', logoutButton:'exit'})) {
  const button = document.getElementById(id);
  if (button) button.innerHTML = cadIcon(icon);
}
if (figureToolButton) figureToolButton.querySelector("span").innerHTML = cadIcon("rectangle");
for (const [selector, icon] of [['#createBlankProjectButton','file'], ['.import-card','import']]) {
  document.querySelector(selector)?.insertAdjacentHTML('afterbegin', cadIcon(icon));
}
document.querySelector('.project-search > span').innerHTML = cadIcon('search');
for (const button of document.querySelectorAll('.tool[data-tool]')) {
  const span = button.querySelector('span');
  if (span && !span.querySelector('svg')) span.innerHTML = glyphIcon(span.textContent);
}

window.ZamerAndroid?.setTheme?.(state.theme);

const appUpdatesButton = document.getElementById("appUpdatesButton");
if (appUpdatesButton && window.ZamerAndroid?.showUpdates) {
  appUpdatesButton.hidden = false;
  appUpdatesButton.innerHTML = cadIcon("update");
  appUpdatesButton.addEventListener("click", () => window.ZamerAndroid.showUpdates());
}

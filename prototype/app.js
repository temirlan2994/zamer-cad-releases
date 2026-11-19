import { requiresActivation, canStartGeometryDrag, activationGestureMode, canDragEntityDirectly } from "./core/interaction.js?v=225";
import { radToDeg, normalizeDegrees, normalizeAnglePositive, offsetWall, transformBlockPoint, distanceWorld, angleBetweenPoints, arcGeometry, segmentMetrics, normalizeScreenVector, entityBounds, pointInSelectionRect, rectEdges, segmentsIntersect, pointInPolygon, pointToSegmentDistance } from "./core/geometry.js?v=225";
import { entitySize, blockSegments } from "./core/blocks.js";
import { buildDxf, buildRevitDxf } from "./core/dxf.js";
import { angularDimensionGeometry, dimensionGeometry } from "./core/dimensions.js";
import { angularDimensionArtwork, linearDimensionArtwork } from "./core/dimension-artwork.js";
import { constrainLinePoint, linePointWithConstraint, linePolarPoint, parseLineDecimal } from "./core/line-input.js";
import { isLinePoint, isValidLine, joinLines, MAX_LINE_COORDINATE, mirrorLine, nearbyBoundaryPoints, nearbyIntersections, nearbyPerpendiculars, nearestBoundaryPoint, nearestIntersection, nearestPerpendicular, parallelLine, scaleLine } from "./core/line-edits.js";
import { editableFigure, extendFigure, figureGripPoints, figureReferenceAt, figureReferencePoint, projectFigurePoint, reshapeFigure, splitFigure, trimFigure, validFigurePiece } from "./core/figure-edits.js";
import { filletLines } from "./core/line-fillet.js";
import { createPolyline, polylineArcFromBend, polylineBounds, polylineSegments, validPolylinePoints } from "./core/polyline.js";
import { buildPlotPdf, pdfPlotBounds } from "./core/pdf.js";
import { chooseProjectSource, projectRevision } from "./core/sync.js";
import { MAX_ZAMER_FILE_BYTES, validateZamerProject } from "./core/project-format.js";
import { DEFAULT_LINE_LAYER, MAX_CUSTOM_LINE_LAYERS, MAX_LINE_LAYER_NAME_LENGTH, normalizeActiveLineLayer, normalizeLineLayerName, normalizeLineLayerSettings } from "./core/line-layers.js";
import { buildProjectPreview } from "./core/project-preview.js";
import { describeSurveyRecord, normalizeSurvey, normalizeSurveyRecord, surveyMarkers, surveyRoom } from "./core/survey.js";
import { bindSurveyPanel } from "./core/survey-panel.js";
import { createSurveyLaser } from "./core/survey-laser.js";
import { buildZip } from "./core/zip.js";
import { formatProjectAngle, formatProjectArea, formatProjectElevation, formatProjectLength,
  fromProjectLength, normalizeMeasurementSettings, projectUnit, toProjectLength } from "./core/project-settings.js";
import { createPlanAnnotation, normalizePlanAnnotation, planAnnotationAnchors, planAnnotationGeometry, planAnnotationPointsFromEntity, planZoneLabelHeight, planZoneLabelLines, planZoneLabelRing, tessellatePolyline, MAX_PLAN_ANNOTATION_POINTS, PLAN_AREA_COLOR, PLAN_ELEVATION_STYLES } from "./core/plan-annotations.js";
import { planRegionAtPoint } from "./core/plan-region.js";
import { ANNOTATION_LINE_SPACING, annotationScaleFactor, annotationTextLines, annotationTextWidth, annotationWorldSize, auxiliaryAnnotationSize, leaderAppearance, leaderElbowPoint, leaderFrameSize, leaderPlanPath, leaderTextHeight } from "./core/annotation-text.js";


// Local vector icons share a 24px grid and never depend on platform emoji fonts.
function cadIcon(name) {
  const paths = {
    cursor: '<path d="m5 3 14 9-7 2-3 7Z"/>',
    frame: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    back: '<path d="M19 12H5m7-7-7 7 7 7"/>',
    line: '<path d="m5 19 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
    dimension: '<path d="M4 5v14m16-14v14M4 12h16m-12-3-4 3 4 3m8-6 4 3-4 3"/>',
    text: '<path d="M5 5h14M12 5v15m-4 0h8"/>',
    area: '<path d="M3 5h18v14H3zm6 4h6m-6 6h6"/>',
    elevation: '<path d="M4 5h12L5 18h12m2-9 2-2 2 2m-2-2v12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    file: '<path d="M14 3H6v18h12V7zM14 3v5h4M9 14h6m-3-3v6"/>',
    plan: '<path d="M3 3h18v18H3zM3 11h9V3m0 8v5m0 5v-2m3-8h6"/>',
    import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    export: '<path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    history: '<path d="M3 12a9 9 0 1 1 2 5.7M3 7v5h5m4-5v5l3 2"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5"/>',
    move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 5H6a1 1 0 0 0-1 1v10"/>',
    rotate: '<path d="M20 4v6h-6m6 0a8 8 0 1 0 0 5"/>',
    delete: '<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6"/>',
    trim: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.5 8.7 11.5 8.8M8.5 15.3 20 6.5"/>',
    extend: '<path d="M4 12h14m-4-4 4 4-4 4m7-11v14"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    polyline: '<path d="m3 18 6-12 6 12 6-12"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    arc: '<path d="M3 18a9 9 0 0 1 18 0"/>',
    rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
    closeContour: '<path d="M18 14v6H4V5h12m-8 7 3 3 8-8"/>',
    addContour: '<path d="M13 5H4v15h14v-6m-1-10v8m-4-4h8"/>',
    angle: '<path d="M4 4v16h16M4 13a7 7 0 0 1 7 7"/>',
    edit: '<path d="m4 16 12-12 4 4L8 20H4Zm10-10 4 4"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    breakGap: '<path d="m3 19 6-6m6-2 6-6m-13 6 3 3m2-4 3 3"/>',
    breakPoint: '<path d="m3 20 7-7m4-4 7-7"/><circle cx="12" cy="11" r="2.5"/>',
    join: '<path d="m3 18 6-6h6l6-6M6 11l3 1-1 4m10-3-3-1 1-4"/>',
    fillet: '<path d="M5 20v-7a8 8 0 0 1 8-8h7"/>',
    scale: '<path d="M10 4h10v10m0-10-7 7m1 9H4V10m0 10 7-7"/>',
    mirror: '<path d="M12 3v18M9 7 4 16h5m6-9 5 9h-5"/>',
    offset: '<path d="M5 19 15 9m-5 10L20 9M7 12l-2-2m4-2 2 2"/>',
    cutAll: '<path d="M4 7h16M4 17h16M10 3v18m4-18v18"/>',
    cutPreview: '<path d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="1.8"/>',
    cutSelected: '<path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M7 12h10m-5-5v10"/>',
    cutAxis: '<path d="M4 4v16h16M12 4v2m0 3v3m0 3v2"/>',
    delta: '<path d="M4 8h10M9 3v10m1 5h10"/>',
    percent: '<path d="m5 19 14-14"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
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
  const lineLayers = normalizeLineLayerSettings(source);
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
    gridStep: GRID_STEPS.includes(source.gridStep) ? source.gridStep : 100,
    polarStep: POLAR_STEPS.includes(source.polarStep) ? source.polarStep : 5,
    visibleLayers: Array.isArray(source.visibleLayers) ? source.visibleLayers : projectDefaultLayers(source, lineLayers.customLineLayers),
    ...lineLayers,
    annotationLayers: source.annotationLayers === 1 ? 1 : undefined,
    annotationScale: Number.isFinite(source.annotationScale) ? source.annotationScale : 1,
    measurementSettings: normalizeMeasurementSettings(source.measurementSettings),
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
const createBlankProjectButton = document.getElementById("createBlankProjectButton");
const projectImportButton = document.getElementById("projectImportButton");
const projectImportInput = document.getElementById("projectImportInput");
const projectTrashButton = document.getElementById("projectTrashButton");
const projectListHeading = document.getElementById("projectListHeading");
const projectHomeStatus = document.getElementById("projectHomeStatus");
const installAppButton = document.getElementById("installAppButton");
const accountBadge = document.getElementById("accountBadge");
const logoutButton = document.getElementById("logoutButton");
const backToProjectsButton = document.getElementById("backToProjectsButton");
const projectNameCaption = document.querySelector(".project-title strong");
const projectScaleCaption = document.querySelector(".project-title span");
const tools = [...document.querySelectorAll(".tool[data-tool]")];
const cursorToolButton = tools.find((button) => button.dataset.tool === "select");
const frameToolButton = document.getElementById("frameToolButton");
const figureToolButton = document.getElementById("figureToolButton");
const quickEditModes = document.getElementById("quickEditModes");
const quickEditButtons = [...quickEditModes.querySelectorAll("[data-quick-edit]")];
const quickMoveTool = document.getElementById("quickMoveTool");
const quickCopyTool = document.getElementById("quickCopyTool");
const angleModes = document.getElementById("angleModes");
const copyToolMenu = document.getElementById("copyToolMenu");
const copyControls = document.getElementById("copyControls");
const copyCountControl = document.getElementById("copyCountControl");
const copyCount = document.getElementById("copyCount");
const copyConfirm = document.getElementById("copyConfirm");
const copyClose = document.getElementById("copyClose");
const maxCopiesPerPlacement = 1000;
const quickRotateTool = document.getElementById("quickRotateTool");
const quickMirrorTool = document.getElementById("quickMirrorTool");
const quickDeleteTool = document.getElementById("quickDeleteTool");
const gridStepSelect = document.getElementById("gridStepSelect");
const gridVisibleReadout = document.getElementById("gridVisibleReadout");
const allSnapsButton = document.getElementById("allSnapsButton");
const snapMore = document.getElementById("snapMore");
const snapMoreSummary = snapMore.querySelector("summary");
const drawToolMenu = document.getElementById("drawToolMenu");
const drawToolButtons = [...document.querySelectorAll("[data-draw-tool]")];
const dimensionToolMenu = createDimensionToolMenu();
const dimensionToolButtons = [...dimensionToolMenu.querySelectorAll("[data-dimension-tool]")];
const annotationToolMenu = createAnnotationToolMenu();
const annotationToolButtons = [...annotationToolMenu.querySelectorAll("[data-annotation-tool]")];
const selectToolMenu = document.getElementById("selectToolMenu");
const selectModeMenu = createSelectModeMenu();
const selectionCommandButtons = [...selectToolMenu.querySelectorAll("[data-action]")];
const snaps = [...document.querySelectorAll("[data-snap]")];
const GRID_STEPS = [5, 10, 50, 100, 500, 1000];
const POLAR_STEPS = [5, 10, 15, 30, 45, 90];
const snapSymbolPaths = {
  all: "M5 12h14M12 5v14M4 4h5M4 4v5M20 4h-5M20 4v5M4 20h5M4 20v-5M20 20h-5M20 20v-5",
  grid: "M6 6h12v12H6zM6 12h12M12 6v12",
  end: "M6 6h12v12H6z",
  mid: "M12 5l8 14H4z",
  center: "M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  intersection: "M6 6l12 12M18 6L6 18",
  perpendicular: "M5 18h14M12 18V5",
  nearest: "M6 6h12L6 18h12z",
  polar: "M5 18h14M5 18 16 7M10 18a5 5 0 0 0-1.5-3.5",
  ortho: "M6 5v13h13M6 12h6v6",
  tracking: "M12 4l8 8-8 8-8-8z",
};
const snapMarkerPaths = Object.fromEntries(Object.entries(snapSymbolPaths).map(([mode, path]) => [mode, new Path2D(path)]));
for (const icon of document.querySelectorAll("[data-snap-symbol]")) {
  icon.innerHTML = `<svg class="cad-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${snapSymbolPaths[icon.dataset.snapSymbol]}"/></svg>`;
}
const lineUi = Object.fromEntries([
  "lineBoundaryControl", "lineBreakControl", "lineEditApply", "linePolarStep",
  "lineEditOptions", "lineEditRadiusControl", "lineEditRadius", "lineEditForm",
  "lineLengthModes", "lineLengthInput", "lineEditCancel", "lineEditFinish", "lineMirrorModes", "lineMirrorControl", "lineMirrorDelete",
].map((id) => [id, document.getElementById(id)]));
const leaderUi = {
  tools: document.getElementById("leaderTools"),
  frame: document.getElementById("leaderFrameButton"),
  height: document.getElementById("leaderTextHeight"),
  toolsCancel: document.getElementById("leaderToolsCancel"),
  editor: document.getElementById("leaderInlineEditor"),
  text: document.getElementById("leaderInlineText"),
  apply: document.getElementById("leaderInlineApply"),
  cancel: document.getElementById("leaderInlineCancel"),
  error: document.getElementById("leaderInlineError"),
};
const leaderLineButtons = [...leaderUi.tools.querySelectorAll("[data-leader-line]")];
for (const element of document.querySelectorAll("[data-line-icon]")) element.innerHTML = cadIcon(element.dataset.lineIcon);
const boundaryModeButtons = [...lineUi.lineBoundaryControl.querySelectorAll("button")];
const breakModeButtons = [...lineUi.lineBreakControl.querySelectorAll("button")];
const lineKeyboardInputs = [lineUi.lineLengthInput, lineUi.lineEditRadius];
const lineEditActions = new Set(["trim", "extend", "break", "join", "lengthen", "fillet", "scale"]);
const lineOnlyEditActions = new Set([...lineEditActions, "offset", "mirror"]);
const figureCutActions = new Set(["trim", "extend", "break"]);
const boundaryEditModes = new Set(["trim", "extend"]);
const boundaryEditPrompts = { trim: "Коснитесь участка для обрезки", extend: "Коснитесь конца для удлинения" };
const lineQuantityModes = {
  lengthen: [["total", "Задать длину", "dimension"], ["delta", "Изменить на величину", "delta"],
    ["percent", "Изменить по проценту", "percent"], ["dynamic", "Задать по точке", "cursor"]],
  offset: [["distance", "Задать расстояние", "dimension"], ["through", "Провести через точку", "cursor"]],
  scale: [["factor", "Коэффициент", "scale"]],
};
const linePointEpsilon = 1e-6;
const lengthInput = document.getElementById("lengthInput");
const angleInput = document.getElementById("angleInput");
const inlineEditors = document.getElementById("inlineEditors");
const draftMetricLabels = document.getElementById("draftMetricLabels");
const draftLengthInput = document.getElementById("draftLengthInput");
const draftAngleInput = document.getElementById("draftAngleInput");
const draftLengthReadout = document.getElementById("draftLengthReadout");
const draftAngleReadout = document.getElementById("draftAngleReadout");
const pressedMetricFields = new Set();
const drawMetrics = document.getElementById("drawMetrics");
const topLengthInput = document.getElementById("topLengthInput");
const topAngleInput = document.getElementById("topAngleInput");
const lengthEditor = document.getElementById("lengthEditor");
const angleEditor = document.getElementById("angleEditor");
const keyboardConfirmButton = document.getElementById("keyboardConfirmButton");
const themeButton = document.getElementById("themeButton");
const annotationScaleSelect = document.getElementById("annotationScaleSelect");
const projectSettingsButton = document.getElementById("projectSettingsButton");
const projectSettingsSheet = document.getElementById("projectSettingsSheet");
const statusChip = document.getElementById("statusChip");
const dimensionAssist = document.getElementById("dimensionAssist");
const cornerMetrics = document.getElementById("cornerMetrics");
const linePointAssist = document.getElementById("linePointAssist");
const polylineArcMode = document.getElementById("polylineArcMode");
const lengthMetricName = document.getElementById("lengthMetricName");
const topLengthName = document.getElementById("topLengthName");
const topAngleName = document.getElementById("topAngleName");
const lengthReadout = document.getElementById("lengthReadout");
const angleReadout = document.getElementById("angleReadout");
const topLengthReadout = document.getElementById("topLengthReadout");
const topAngleReadout = document.getElementById("topAngleReadout");
const lineDirection = document.getElementById("lineDirection");
const lineDirectionDescription = document.getElementById("lineDirectionDescription");
const lineDirections = ["вправо", "вправо вниз", "вниз", "влево вниз", "влево", "влево вверх", "вверх", "вправо вверх"];
const dimensionNextSnap = document.getElementById("dimensionNextSnap");
const dimensionAxisControl = document.getElementById("dimensionAxisControl");
const dimensionAxis = document.getElementById("dimensionAxis");
const dimensionLinks = document.getElementById("dimensionLinks");
const dimensionLinkCancel = document.getElementById("dimensionLinkCancel");
const dimensionLinkButtons = [...dimensionLinks.querySelectorAll("[data-dimension-anchor]")];
const saveIndicator = document.getElementById("saveIndicator");
const layersSheet = document.getElementById("layersSheet");
const addLineLayerButton = document.getElementById("addLineLayerButton");
const exportSheet = document.getElementById("exportSheet");
const layerList = document.getElementById("layerList");
const exportCards = [...document.querySelectorAll(".export-card")];
const keyboardInputs = [lengthInput, angleInput, topLengthInput, topAngleInput, draftLengthInput, draftAngleInput].filter(Boolean);
let lastNumericInput = null;
const lineMetricKinds = new Map([[lengthInput, "length"], [angleInput, "angle"], [topLengthInput, "length"], [topAngleInput, "angle"],
  [draftLengthInput, "length"], [draftAngleInput, "angle"]]);
const modifiedMetricInputs = new WeakSet();
let stableViewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 844);
let androidKeyboardViewport = null;
try {
  androidKeyboardViewport = JSON.parse(window.ZamerAndroid?.keyboardViewport?.() || "null");
} catch { /* Browser and older APKs use the WebView viewport. */ }
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
const trackingDrawingTools = new Set(["line", "polyline", "circle", "arc", "rectangle", "area", "elevation"]);
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
  chain: { icon: "↔↔", label: "Цепочка" },
};
const annotationToolButtonVisuals = {
  text: { icon: "T", label: "Аннотация" },
  leader: { icon: "↗", label: "Выноска" },
  area: { label: "Площадь" },
  elevation: { label: "Высота Z" },
};
function createSelectModeMenu() {
  const menu = document.createElement("div");
  menu.className = "draw-tool-menu select-mode-menu";
  menu.id = "selectModeMenu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Режимы выбора");
  menu.hidden = true;
  menu.innerHTML = `
    <button data-select-mode="lasso"><span>⌁</span><small>Лассо</small></button>
    <button data-select-mode="multi"><span>+</span><small>Мульти</small></button>
    <button data-select-mode="filter"><span>⛃</span><small>Фильтр</small></button>
    <button data-select-command="objects" aria-haspopup="dialog"><span>▤</span><small>Объекты</small></button>
    <button data-select-command="fit"><span>⌗</span><small>Вписать</small></button>
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
    <button type="button" data-dimension-tool="chain" aria-label="Множественный размер"><span aria-hidden="true">↔↔</span><small>Цепочка</small></button>
  `;
  document.querySelector(".workspace")?.append(menu);
  return menu;
}

function createAnnotationToolMenu() {
  const menu = document.createElement("div");
  menu.className = "draw-tool-menu annotation-tool-menu";
  menu.id = "annotationToolMenu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Инструменты аннотации");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" data-annotation-tool="text"><span aria-hidden="true">${cadIcon("text")}</span><small>Текст</small></button>
    <button type="button" data-annotation-tool="leader"><span aria-hidden="true">${cadIcon("edit")}</span><small>Выноска</small></button>
    <button type="button" data-annotation-tool="area"><span aria-hidden="true">${cadIcon("area")}</span><small>Площадь</small></button>
    <button type="button" data-annotation-tool="elevation"><span aria-hidden="true">${cadIcon("elevation")}</span><small>Высота Z</small></button>
  `;
  document.querySelector(".workspace")?.append(menu);
  return menu;
}

const layerMeta = {
  walls: { name: "Стены", color: "#26313d" },
  dimensions: { name: "Размеры", color: "#1f75ff" },
  text: { name: "Текст и выноски", color: "#754997" },
  areas: { name: "Площади", color: PLAN_AREA_COLOR },
  elevations: { name: "Высоты Z", color: "#167d5c" },
  furniture: { name: "Мебель", color: "#1db4a8" },
  [DEFAULT_LINE_LAYER]: { name: "Черновые", color: "#9b6bff" },
};
const defaultPlanLayers = [DEFAULT_LINE_LAYER, "dimensions", "text", "areas", "elevations"];
const lineLayerColors = ["#d05554", "#00857b", "#b37002", "#526fd0", "#b04d86", "#5c862e", "#af5a2d", "#3e8098"];

function projectDefaultLayers(project, customLineLayers) {
  const rooms = Array.isArray(project.survey?.rooms) ? project.survey.rooms : [];
  const hasLayer = (entities, layer) => Array.isArray(entities) && entities.some((entity) => entity?.layer === layer);
  const legacy = ["walls", "furniture"].filter((layer) => hasLayer(project.entities, layer) ||
    rooms.some((room) => hasLayer(room?.drawing?.entities, layer)));
  return [...defaultPlanLayers, ...legacy, ...customLineLayers.map(({ id }) => id)];
}

function drawingLayerInfo(id = DEFAULT_LINE_LAYER) {
  return Object.hasOwn(layerMeta, id) ? layerMeta[id] : state.customLineLayers.find((layer) => layer.id === id);
}
const selectionFilters = ["all", "lines", "dimensions"];

let surveyPanel = null;
let surveyPointPicker = null;
const zoneLabelRects = new Map();

const state = {
  survey: normalizeSurvey(null),
  theme: "light",
  directManipulationIds: new Set(),
  tool: "select",
  planZone: null,
  drawTool: "line",
  dimensionTool: "aligned",
  angleMode: "draw",
  angleSide: null,
  annotationScale: 1,
  measurementSettings: normalizeMeasurementSettings(),
  selectTool: "select",
  selectionFilter: "all",

  view: {
    scale: 0.085,
    panX: 92,
    panY: 84,
  },
  drawing: null,
  leaderInput: null,
  moveCommand: null,
  offsetCommand: null,
  lineEdit: null,
  pointer: null,
  pointerStartedAt: 0,
  lastAnnotationTap: null,
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
  selectedFigureGrip: null,
  copyPicking: null,
  endpointEditBefore: null,
  selectionDrag: null,
  openEditMenuAfterPointer: false,
  undo: [],
  redo: [],
  snaps: new Set(["grid", "end", "polar"]),
  snapsMuted: false,
  gridStep: 100,
  polarStep: 5,
  visibleLayers: new Set(defaultPlanLayers),
  customLineLayers: [],
  activeLineLayer: DEFAULT_LINE_LAYER,
  entities: [],
};

const TAP_MOVE_TOLERANCE = 8;
const LONG_PRESS_SELECT_MS = 430;
const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_DISTANCE = 20;

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
  pendingSave: null,
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
    projectScaleCaption.textContent = persistence.projectId ? `${projectUnit(state.measurementSettings).label} · ${label}` : "Выберите файл";
  }
}

function setProjectHomeVisible(visible) {
  if (!projectHome) return;
  if (!visible) closeProjectActions();
  if (visible && state.leaderInput) {
    state.drawing = null;
    closeLeaderInput();
  }
  projectHome.hidden = !visible;
  shell.classList.toggle("project-home-open", visible);
  syncEditorAccessibility();
  if (!visible && authScreen.hidden) backToProjectsButton?.focus({ preventScroll: true });
}

function setAuthScreenVisible(visible) {
  if (!authScreen) return;
  if (visible) closeProjectActions();
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
    accountBadge.hidden = nativeApkMode || !authState.user;
    accountBadge.textContent = authState.user?.login || "";
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
  persistence.pendingSave = null;
  persistence.projects = [];
  persistence.showingTrash = false;
  persistence.trash = [];
  projectPreviewCache.clear();
  setSelection([]);
  state.drawing = null;
  closeLeaderInput();
  state.snapsMuted = false;
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
    const saved = await saveProjectToLocalStore(serializeProject({ syncPending: true }, snapshot), "session-ended", identity);
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
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const projectObjectPlural = new Intl.PluralRules("ru-RU");
const projectPreviewCache = new Map();
const projectPreviewSources = new WeakMap();
const projectPreviewObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries, observer) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    void renderProjectPreview(entry.target);
  }
}, { root: projectList, rootMargin: "96px" }) : null;

function projectMetaLine(project, showingTrash) {
  const count = Number(project.entityCount) || 0;
  const unit = { one: "объект", few: "объекта", many: "объектов" }[projectObjectPlural.select(count)] || "объекта";
  const date = projectDateLabel(showingTrash ? project.deletedAt : project.updatedAt);
  return [showingTrash && date ? `Удалён ${date}` : date, `${count} ${unit}`].filter(Boolean).join(" · ");
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

async function projectPreviewDocument(identity, archived) {
  if (archived) {
    try {
      const db = await openLocalProjectDb();
      if (db?.objectStoreNames.contains("trash")) {
        const store = db.transaction("trash", "readonly").objectStore("trash");
        const entry = await idbRequest(store.get(identity.projectId));
        if (entry?.project) return entry.project;
      }
    } catch (error) {
      console.warn("Cannot read archived preview", error);
    }
    return apkReadJson(`${apkTrashPrefix}${identity.projectId}`, null);
  }
  if (nativeApkMode) {
    const primary = apkReadJson(apkProjectKey(identity.projectId), null);
    const local = await loadProjectFromLocalStore(identity);
    return chooseProjectSource(local, primary).project;
  }
  const versions = await readProjectVersions(identity);
  return versions.unauthorized ? null : versions.choice.project;
}

async function renderProjectPreview(element) {
  const source = projectPreviewSources.get(element);
  if (!source || !element.isConnected || source.identity.clientId !== persistence.clientId) return;
  const { project, archived, identity } = source;
  const key = JSON.stringify([identity.clientId, archived, project.id, project.revision, project.updatedAt, project.entityCount]);
  let pending = projectPreviewCache.get(key);
  if (!pending) {
    pending = projectPreviewDocument(identity, archived)
      .then((saved) => saved && { sketch: buildProjectPreview(saved) })
      .catch((error) => {
        console.warn("Cannot render project preview", error);
        return null;
      });
    projectPreviewCache.set(key, pending);
    if (projectPreviewCache.size > 80) projectPreviewCache.delete(projectPreviewCache.keys().next().value);
  }
  const result = await pending;
  if (!result && projectPreviewCache.get(key) === pending) projectPreviewCache.delete(key);
  if (!element.isConnected || persistence.clientId !== identity.clientId) return;
  element.dataset.previewState = result?.sketch ? "ready" : result ? "empty" : "unavailable";
  if (!result?.sketch) return;
  const { viewBox, paths } = result.sketch;
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("class", "project-preview-sketch");
  svg.setAttribute("aria-hidden", "true");
  for (const path of paths) {
    const stroke = document.createElementNS(namespace, "path");
    stroke.setAttribute("class", `project-preview-${path.tone}${path.fill ? " project-preview-fill" : ""}`);
    stroke.setAttribute("d", path.d);
    svg.append(stroke);
  }
  element.replaceChildren(svg);
}

function projectCardButton(projectId, selector = ".project-card-open") {
  const card = [...projectList.querySelectorAll(".project-card")].find((item) => item.dataset.projectId === projectId);
  return card?.querySelector(selector);
}

function renderProjectList() {
  if (!projectList) return;
  const showingTrash = persistence.showingTrash;
  if (projectListHeading) projectListHeading.textContent = showingTrash ? "Корзина" : "Недавние";
  if (projectTrashButton) {
    projectTrashButton.hidden = !nativeApkMode;
    projectTrashButton.setAttribute("aria-pressed", String(showingTrash));
    const label = showingTrash ? "Вернуться к проектам" : "Корзина";
    projectTrashButton.title = label;
    projectTrashButton.setAttribute("aria-label", label);
    projectTrashButton.innerHTML = cadIcon(showingTrash ? "back" : "delete");
  }
  const focused = document.activeElement;
  const focusedCardId = projectList.contains(focused) ? focused.closest(".project-card")?.dataset.projectId : null;
  const focusSelector = focused?.matches(".project-card-menu") ? ".project-card-menu" : ".project-card-open";
  projectPreviewObserver?.disconnect();
  const projects = filteredProjects();
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "project-empty";
    empty.textContent = showingTrash
      ? (persistence.trash.length ? "Ничего не найдено" : "Корзина пуста")
      : (persistence.projects.length ? "Ничего не найдено" : "Здесь появятся ваши чертежи");
    projectList.replaceChildren(empty);
    return;
  }
  const cards = document.createDocumentFragment();
  const previews = [];
  for (const project of projects) {
    const card = document.createElement("article");
    card.className = "project-card";
    card.dataset.projectId = project.id;

    const name = project.name || "Без названия";
    const open = document.createElement(showingTrash ? "div" : "button");
    open.className = "project-card-open";
    if (!showingTrash) {
      open.type = "button";
      open.dataset.projectAction = "open";
      open.dataset.projectId = project.id;
      open.setAttribute("aria-label", `Открыть «${name}»`);
    }

    const preview = document.createElement("span");
    preview.className = "project-card-preview";
    preview.dataset.previewState = "loading";
    preview.setAttribute("aria-hidden", "true");
    const placeholder = document.createElement("span");
    placeholder.className = "project-preview-placeholder";
    placeholder.innerHTML = cadIcon("plan");
    preview.append(placeholder);
    projectPreviewSources.set(preview, { project, archived: showingTrash, identity: projectIdentity(project.id) });
    previews.push(preview);

    const main = document.createElement("span");
    main.className = "project-card-main";
    const title = document.createElement("strong");
    title.className = "project-card-title";
    title.textContent = name;
    const meta = document.createElement("span");
    meta.className = "project-card-meta";
    meta.textContent = projectMetaLine(project, showingTrash);
    main.append(title, meta);
    open.append(preview, main);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "project-card-menu";
    menu.setAttribute("aria-label", `Действия проекта «${name}»`);
    menu.setAttribute("aria-haspopup", "dialog");
    menu.setAttribute("aria-controls", "projectActionsDialog");
    menu.setAttribute("aria-expanded", String(projectActionsOpener?.closest(".project-card")?.dataset.projectId === project.id));
    menu.title = "Действия проекта";
    menu.innerHTML = cadIcon("more");
    card.append(open, menu);
    cards.append(card);
  }
  projectList.replaceChildren(cards);
  if (focusedCardId) projectCardButton(focusedCardId, focusSelector)?.focus({ preventScroll: true });
  for (const preview of previews) {
    if (projectPreviewObserver) projectPreviewObserver.observe(preview);
    else void renderProjectPreview(preview);
  }
}

const projectActionsDialog = document.createElement("dialog");
projectActionsDialog.id = "projectActionsDialog";
projectActionsDialog.className = "project-action-menu";
projectActionsDialog.setAttribute("aria-labelledby", "projectActionsTitle");
projectActionsDialog.innerHTML = `
  <header class="project-action-menu-head">
    <h2 id="projectActionsTitle"></h2>
    <button class="icon-button" type="button" aria-label="Закрыть действия">${cadIcon("close")}</button>
  </header>
  <div class="project-action-menu-items"></div>`;
shell.append(projectActionsDialog);
let projectActionsOpener = null;

function showProjectActions(opener) {
  if (projectActionsDialog.open) return;
  const projectId = opener.closest(".project-card")?.dataset.projectId;
  const project = (persistence.showingTrash ? persistence.trash : persistence.projects).find((entry) => entry.id === projectId);
  if (!project) return;
  projectActionsDialog.querySelector("h2").textContent = project.name || "Без названия";
  const actions = projectActionsDialog.querySelector(".project-action-menu-items");
  const items = persistence.showingTrash ? [["restore", "Восстановить", "undo"]] : [
    ["rename", "Переименовать", "edit"],
    ["duplicate", "Создать копию", "copy"],
    ["export", "Скачать .zamer", "import"],
    ...(nativeApkMode ? [["versions", "История версий", "history"]] : []),
    ...(!project.legacy ? [["delete", nativeApkMode ? "В корзину" : "Удалить", "delete"]] : []),
  ];
  actions.replaceChildren(...items.map(([action, label, icon]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action === "delete" ? "project-menu-item danger" : "project-menu-item";
    button.dataset.projectAction = action;
    button.dataset.projectId = projectId;
    const image = document.createElement("span");
    image.innerHTML = cadIcon(icon);
    const text = document.createElement("span");
    text.textContent = label;
    button.append(image, text);
    return button;
  }));
  projectActionsOpener = opener;
  opener.setAttribute("aria-expanded", "true");
  projectActionsDialog.showModal();
  actions.querySelector("button")?.focus({ preventScroll: true });
}

function closeProjectActions() {
  if (!projectActionsDialog.open) return;
  const previous = projectActionsOpener;
  const projectId = previous?.closest(".project-card")?.dataset.projectId;
  projectActionsOpener = null;
  projectActionsDialog.close();
  const opener = previous?.isConnected ? previous : projectCardButton(projectId, ".project-card-menu");
  opener?.setAttribute("aria-expanded", "false");
  if (!projectHome.hidden) opener?.focus({ preventScroll: true });
}

projectActionsDialog.querySelector(".project-action-menu-head button").addEventListener("click", closeProjectActions);
projectActionsDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeProjectActions();
});
projectActionsDialog.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-project-action]");
  if (button) {
    closeProjectActions();
    void handleProjectAction(button.dataset.projectAction, button.dataset.projectId);
  } else if (event.target === projectActionsDialog) {
    const rect = projectActionsDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeProjectActions();
  }
});

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

function showProjectDialog({ title, message = "", value = "", placeholder = "", inputLabel = "Название проекта", confirmText = "Готово", destructive = false, withInput = true, choices = [], maxLength = 80, validateValue }) {
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
      input.maxLength = maxLength;
      input.autocomplete = "off";
      input.setAttribute("aria-label", inputLabel);
      input.required = true;
      if (validateValue) input.addEventListener("input", () => input.setCustomValidity(""));
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
      updateViewportLock();
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
      const nextValue = input.value.trim().slice(0, maxLength);
      if (!nextValue) {
        input.focus();
        return;
      }
      const error = validateValue?.(nextValue);
      if (error) {
        input.setCustomValidity(error);
        input.reportValidity();
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
  const label = installState.promptEvent ? "Установить приложение" : "Как установить приложение";
  installAppButton.title = label;
  installAppButton.setAttribute("aria-label", label);
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

let projectListRequest = 0;

async function loadProjects() {
  if (!projectList) return;
  const request = ++projectListRequest;
  const clientId = persistence.clientId;
  const showingTrash = persistence.showingTrash;
  const isCurrent = () => projectListRequest === request && persistence.clientId === clientId && persistence.showingTrash === showingTrash;
  try {
    const response = await fetch(showingTrash ? "/api/trash" : projectsEndpoint(clientId), { cache: "no-store" });
    if (!isCurrent()) return;
    if (response.status === 401) {
      await forceAuthLogout();
      return;
    }
    if (!response.ok) throw await projectRequestError(response, "Не удалось загрузить проекты");
    const payload = await response.json();
    if (!isCurrent()) return;
    if (showingTrash) persistence.trash = Array.isArray(payload.entries) ? payload.entries : [];
    else persistence.projects = Array.isArray(payload.projects) ? payload.projects : [];
    renderProjectList();
  } catch (error) {
    if (!isCurrent()) return;
    console.warn("Could not load projects", error);
    projectPreviewObserver?.disconnect();
    const empty = document.createElement("div");
    empty.className = "project-empty";
    const message = document.createElement("span");
    message.textContent = nativeApkMode ? "Не удалось прочитать проекты на телефоне" : "Не удалось загрузить проекты";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "project-create";
    retry.textContent = "Повторить";
    retry.addEventListener("click", loadProjects);
    empty.append(message, retry);
    projectList.replaceChildren(empty);
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
  persistence.pendingSave = null;
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
    if (!localProject || projectRevision(localProject) !== persistence.revision ||
        projectSavedTime(localProject) !== projectSavedTime(choice.project)) {
      saveProjectToLocalStore({ ...choice.project, syncPending: false }, "server-open", active);
    }
    updateSaveIndicator("saved", nativeApkMode ? "На телефоне" : "С сервера", { autoDim: 2400 });
  } else if (shouldPush) {
    persistence.pendingSave = {
      snapshot: persistence.lastHash,
      id: choice.project.clientSaveId || createClientSaveId(),
      view: { ...(choice.project.view || state.view) },
    };
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
  if (!projectHome.hidden) (projectCardButton(persistence.projectId) || createBlankProjectButton)?.focus({ preventScroll: true });
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

function serializableProjectContent() {
  return {
    version: 2,
    clientId: persistence.clientId,
    projectId: persistence.projectId,
    name: persistence.projectName || "Без названия",
    createdAt: persistence.projectCreatedAt || new Date().toISOString(),
    theme: state.theme,
    snaps: [...state.snaps],
    gridStep: state.gridStep,
    polarStep: state.polarStep,
    visibleLayers: [...state.visibleLayers],
    ...(state.customLineLayers.length ? { customLineLayers: state.customLineLayers, activeLineLayer: state.activeLineLayer } : {}),
    annotationLayers: 1,
    annotationScale: state.annotationScale,
    measurementSettings: { ...state.measurementSettings },
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

function serializeProject({ syncPending = false } = {}, snapshot = projectSnapshotKey()) {
  if (syncPending && persistence.pendingSave?.snapshot !== snapshot) {
    // Reuse the same view on retries, even while the editor view continues moving.
    persistence.pendingSave = { snapshot, id: createClientSaveId(), view: { ...state.view } };
  }
  const pending = syncPending ? persistence.pendingSave : null;
  const savedAt = new Date().toISOString();
  return {
    ...JSON.parse(snapshot),
    view: pending?.view ?? { ...state.view },
    revision: persistence.revision,
    baseRevision: persistence.revision,
    clientSaveId: pending?.id ?? "",
    syncPending,
    updatedAt: savedAt,
    savedAt,
  };
}

function projectSnapshotKey() {
  return JSON.stringify(serializableProjectContent());
}

function isValidProjectEntity(entity) {
  return Boolean(entity && typeof entity === "object" && typeof entity.id === "string" &&
    typeof entity.type === "string" &&
    (entity.type !== "polyline" || validPolylinePoints(entity.points, entity.closed, entity.bulges)));
}

function cloneProjectEntity(entity) {
  try {
    const copy = JSON.parse(JSON.stringify(entity));
    if (isPlanAnnotationZone(copy)) return normalizePlanAnnotation(copy);
    if (copy?.dimensionKind === "leader" || copy?.type === "text") {
      if (copy.layer === "dimensions" || !copy.layer) copy.layer = "text";
      if (copy.dimensionKind === "leader" && !copy.leaderStyle && !Object.hasOwn(copy, "leaderLine") && !Object.hasOwn(copy, "leaderFrame")) {
        copy.leaderStyle = "boxed";
      }
      if (copy.dimensionKind === "leader" && !isLinePoint(copy.leaderElbow)) delete copy.leaderElbow;
    }
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
  const restoredEntities = project.entities.map(cloneProjectEntity).filter(Boolean);
  persistence.restoring = true;
  try {
    state.entities = restoredEntities;
    state.survey = normalizeSurvey(project.survey);
    state.planZone = null;
    surveyPointPicker = null;
    surveyPanel?.close();
    if (planAnnotationEditor.open) planAnnotationEditor.close();
    if (project.view && Number.isFinite(project.view.scale)) {
      state.view.scale = clampScale(project.view.scale);
      state.view.panX = Number.isFinite(project.view.panX) ? project.view.panX : state.view.panX;
      state.view.panY = Number.isFinite(project.view.panY) ? project.view.panY : state.view.panY;
    }
    state.snaps = new Set(Array.isArray(project.snaps) ? project.snaps.filter(Boolean) : ["grid", "end", "polar"]);
    state.snapsMuted = false;
    state.gridStep = GRID_STEPS.includes(project.gridStep) ? project.gridStep : 100;
    state.polarStep = POLAR_STEPS.includes(project.polarStep) ? project.polarStep : 5;
    Object.assign(state, normalizeLineLayerSettings(project));
    const availableLayers = new Set(projectDefaultLayers(project, state.customLineLayers));
    state.visibleLayers = new Set((Array.isArray(project.visibleLayers) ? project.visibleLayers : [...availableLayers])
      .filter((id) => availableLayers.has(id)));
    if (project.annotationLayers !== 1) {
      state.visibleLayers.add("areas");
      state.visibleLayers.add("elevations");
      if (state.visibleLayers.has("dimensions")) state.visibleLayers.add("text");
    }
    state.measurementSettings = normalizeMeasurementSettings(project.measurementSettings);
    setAnnotationScale(project.annotationScale, { save: false });
    exportScale.value = state.measurementSettings.printScale;
    if (project.theme === "light" || project.theme === "dark") {
      state.theme = project.theme;
      shell.dataset.theme = state.theme;
      themeButton.setAttribute("aria-pressed", String(state.theme === "dark"));
      themeButton.firstElementChild.innerHTML = cadIcon(state.theme === "light" ? "moon" : "sun");
      window.ZamerAndroid?.setTheme?.(state.theme);
    }
    state.selectionFilter = selectionFilters.includes(project.selectionFilter) ? project.selectionFilter : "all";

    state.drawing = null;
    closeLeaderInput();
    state.moveCommand = null;
    state.offsetCommand = null;
    state.lineEdit = null;
    state.dimensionAttach = null;
    closeLineMetricInput();
    state.pointer = null;
    state.lastAnnotationTap = null;
    state.pinch = null;
    state.inlineEdit = null;
    state.numericEdit = null;
    state.selectionDrag = null;
    state.copyPicking = null;
    copyToolMenu.hidden = true;
    state.selectedFigureGrip = null;
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
  const identity = projectIdentity();
  window.clearTimeout(persistence.localTimer);
  persistence.localTimer = window.setTimeout(() => {
    if (!persistence.ready || !isActiveProject(identity)) return;
    saveProjectToLocalStore(serializeProject({ syncPending: true }), `checkpoint-${reason}`, identity).catch(() => {});
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
  if (persistence.pendingSave?.id === project.clientSaveId) persistence.pendingSave = null;
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
    const saved = await saveProjectToLocalStore(serializeProject({ syncPending: true }, currentSnapshot), "conflict-latest", recoveryIdentity);
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
  const project = serializeProject({ syncPending: true }, snapshot);
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
    if (persistence.pendingSave?.id === project.clientSaveId) persistence.pendingSave = null;
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
      durable = await saveProjectToLocalStore(serializeProject({ syncPending: true }, latestSnapshot), "network-pending", identity);
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
  const snapshot = projectSnapshotKey();
  if (!persistence.dirty && snapshot === persistence.lastHash) return;
  const project = serializeProject({ syncPending: true }, snapshot);
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
  return Boolean(numericConfirmInput()) || lineKeyboardInputs.includes(active) ||
    active === leaderUi.text || active === leaderUi.height ||
    active === projectSearchInput ||
    Boolean(active?.matches(".survey-sheet :is(input, textarea, select), .viewport-objects-dialog input, .project-dialog input"));
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

let draftingKeyboardInset = 0;

function updateViewportLock() {
  const visualViewport = window.visualViewport;
  const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || stableViewportHeight);
  const layoutHeight = Math.round(window.innerHeight || viewportHeight);
  const inputFocused = isKeyboardInputFocused();
  const rawInset = visualViewport ? Math.max(0, layoutHeight - visualViewport.height - visualViewport.offsetTop) : 0;
  const heightLoss = Math.max(0, stableViewportHeight - viewportHeight);
  const nativeInset = androidKeyboardViewport?.visible && androidKeyboardViewport.availableHeight > 0
    ? Math.max(0, stableViewportHeight - androidKeyboardViewport.availableHeight) : 0;
  const detectedInset = Math.max(rawInset, heightLoss, nativeInset);
  const keyboardInset = inputFocused && detectedInset > 80 ? Math.min(detectedInset, Math.max(0, stableViewportHeight - 240)) : 0;
  draftingKeyboardInset = keyboardInset;

  if (!inputFocused) {
    // System-bar insets and split-screen can shrink the viewport after startup.
    // Only hold its previous height while an input actually owns the keyboard.
    stableViewportHeight = Math.max(viewportHeight, layoutHeight);
  } else if (keyboardInset === 0) {
    stableViewportHeight = Math.max(stableViewportHeight, viewportHeight, layoutHeight);
  }

  document.documentElement.style.setProperty("--app-height", `${stableViewportHeight}px`);
  document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(keyboardInset)}px`);
  shell.classList.toggle("keyboard-open", keyboardInset > 0);
  if (keyboardConfirmButton) {
    keyboardConfirmButton.hidden = !numericConfirmInput();
  }
  lockDocumentScroll();
  syncPlanAnnotationViewport();
  syncLeaderInputPosition();
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

function centerViewOnWorldPoint(point) {
  const center = centerScreen();
  state.view.panX = center.x - point.x * state.view.scale;
  state.view.panY = center.y - point.y * state.view.scale;
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
  const raw = rawCursorWorld();
  if (state.dimensionAttach) {
    const snap = dimensionAttachCandidate(raw);
    return { point: snap ? { x: snap.x, y: snap.y } : raw, snap };
  }
  if (state.tool === "dimension" && state.drawing?.phase === "offset") return { point: raw, snap: null };
  if (state.tool === "dimension") return resolveDimensionPointSnap(raw);
  if (lineEditPlacesPoint()) return resolveLineEditPoint(state.lineEdit, raw);
  if (state.planZone?.mode === "existing") return { point: raw, snap: null };
  if (state.planZone?.mode === "contour" && planContourClosesAtCursor(state.planZone.points)) {
    const first = state.planZone.points[0];
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    return { point: first, snap: { ...first, type: "end", label: "Начальная вершина" } };
  }
  if (state.selectedFigureGrip) {
    const origin = state.selectedFigureGrip.point;
    const resolved = resolveSnapWorld(raw);
    return distanceWorld(raw, origin) <= linePointEpsilon ? { point: origin, snap: null } : resolved;
  }
  const draft = state.drawing;
  if (draft?.arcEnd && (state.tool === "arc" || draft.arcPhase === "through")) {
    return resolveArcBendSnap(raw, draft);
  }
  const start = draft?.start || planZoneSnapStart() || state.moveCommand?.base || selectedEndpointGeometry()?.fixed || null;
  const constraint = draft?.metricConstraint;
  const firstVertex = state.tool === "polyline" && canClosePolyline(draft) ? draft.points[0] : null;
  if (firstVertex && !constraint && snapEnabled("end") && distanceWorld(raw, firstVertex) * state.view.scale <= screenUiPx(14)) {
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    return { point: firstVertex, snap: { ...firstVertex, type: "end", label: "Начальная вершина" } };
  }
  if (constraint) {
    const axisAngle = state.tool === "line" && constraint.length !== undefined ? lineAxisAngle(draft.metricDirection, start, raw) : undefined;
    const direction = axisAngle === undefined && constraint.angle === undefined
      ? resolveLineLikeSnap(raw, start, { useGrid: false }).point : raw;
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    const point = axisAngle === undefined ? linePointWithConstraint(start, direction, constraint) : linePolarPoint(start, constraint.length, axisAngle);
    return { point, snap: null };
  }
  if (start) return resolveLineLikeSnap(raw, start);
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

function annotationPx(value) {
  return annotationWorldSize(value, state.annotationScale) * state.view.scale;
}

function annotationFont(weight, size) {
  return `${weight} ${annotationPx(size)}px Inter, Segoe UI, sans-serif`;
}

function auxiliaryPx(value) {
  return auxiliaryAnnotationSize(value, state.view.scale);
}

function screenUiPx(value) {
  return value;
}

function setAnnotationScale(value, options = {}) {
  const next = annotationScaleFactor(value);
  state.annotationScale = next;
  if (annotationScaleSelect) {
    const option = [...annotationScaleSelect.options].find((item) => Math.abs(Number(item.value) - next) < 0.001);
    annotationScaleSelect.value = option?.value || "1";
  }
  updateProjectTitle();
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
  drawCanvasCenterCursor(rect);

  const visible = visibleEntities(rect);
  const editedLeader = state.leaderInput?.entity;
  const editedIndex = editedLeader ? visible.indexOf(editedLeader) : -1;
  if (editedIndex !== -1) visible[editedIndex] = {
    ...editedLeader, ...state.leaderInput.options, text: leaderUi.text.value.trim() || editedLeader.text,
  };
  drawPlanScene(visible, c);
  drawSurveyMarks(c, rect);
  drawPlanAnnotationDraft(c);


  const selectedItems = selectedEntities();
  if (!state.drawing && !state.moveCommand && !state.offsetCommand && !state.leaderInput) {
    for (const entity of selectedItems) {
      if (!shouldGhostEntityForCommand(entity)) drawSelection(entity, c);
    }
  }

  if (state.drawing) {
    if (state.tool === "polyline") drawPolyline(state.drawing, c, true);
    if (state.tool === "polyline" && state.drawing.arcPhase) drawPolylineArcDraft(state.drawing, c);
    else drawActiveSegment(c, rect);
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
    const circle = selectedCircleForMetrics();
    if (circle) updateCircleMetricFields(Math.abs(circle.radius));
    else hideInlineEditors();
  }
  syncSelectionActions();
  syncPlanAnnotationActions();
  syncLeaderTools();
  syncLeaderInputPosition();
  syncLineControls();
  angleModes.hidden = state.tool !== "dimension" || state.dimensionTool !== "angular" || !dimensionToolMenu.hidden;
  if (!angleModes.hidden && state.angleMode === "select") drawAngleFromSegmentsPreview(c);
  syncDimensionLinks();
  drawLineEditMarks(c);
  drawSelectionDrag(c);
  drawDimensionSnapHint(c);
  drawCursorSnap(c);
  normalizeDynamicText();
}

function shouldGhostEntityForCommand(entity) {
  if (printRendering) return false;
  if (state.lineEdit?.pending?.replacements.some(([target]) => target.id === entity.id)) return true;
  if (state.pointer?.mode === "figure-grip" && state.pointer.preview && state.pointer.grip.entityId === entity.id) return true;
  if (state.selectedFigureGrip?.entityId === entity.id) return true;
  return Boolean(
    state.moveCommand?.base &&
      (state.moveCommand.mode === "move" || state.moveCommand.mode === "rotate") &&
      state.moveCommand.entityIds.has(entity.id)
  );
}

function syncCommandState() {
  const active = Boolean(state.moveCommand || state.offsetCommand || state.selectedEndpoint || state.selectedFigureGrip);
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
  const heading = angleBetweenPoints(start, end);
  const rotatingWithReference = command.mode === "rotate" && command.reference;
  const displayAngle = rotatingWithReference
    ? radToDeg(signedAngleDelta(angleBetweenPoints(start, command.reference), heading))
    : normalizeDegrees(radToDeg(heading));
  const sources = state.entities.filter(entity => command.entityIds.has(entity.id) && isLayerVisible(entity.layer));
  const movingIds = command.mode === "copy" ? copyMovingIds(sources) : command.entityIds;
  const steps = command.copyMode === "array" ? copyArrayCount(sources.length) : 1;
  for (const entity of sources) {
    if (command.mode === "rotate") {
      drawRotatePreview(entity, command, end, c);
    } else {
      for (let index = 1; index <= steps; index += 1) {
        drawMovePreview(entity, (end.x - start.x) * index, (end.y - start.y) * index, c, movingIds);
      }
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
  ctx.restore();

  updateTopMetricInputs(distanceWorld(start, end), displayAngle, { cadAngle: !rotatingWithReference });
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
  ctx.restore();

  updateTopMetricInputs(command.distance, 0);
}

function translatePolyline(points, dx, dy) {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function mapPlanZoneGeometry(entity, transform) {
  const contours = (entity.contours ?? [entity.points]).map((ring) => ring.map(transform));
  return contours.every((ring) => ring.every(isLinePoint)) ? { points: contours[0], contours: entity.contours ? contours : undefined } : null;
}

function mapArcPoints(entity, transform) {
  return {
    start: transform(entity.start),
    through: transform(entity.through),
    end: transform(entity.end),
  };
}

function translatedFigureGeometry(entity, dx, dy) {
  if (entity.type === "arc") return mapArcPoints(entity, point => ({ x: point.x + dx, y: point.y + dy }));
  return { x1: entity.x1 + dx, y1: entity.y1 + dy, x2: entity.x2 + dx, y2: entity.y2 + dy };
}

function rotatedRectangleGeometry(entity, base, radians) {
  const points = rectangleCorners(entity).map(point => rotatePointAround(point, base, radians));
  return { type: "polyline", points, closed: true };
}

function drawMovePreview(entity, dx, dy, c, movingIds) {
  if (!dx && !dy) return;
  if (entity.dimensionKind === "angular") {
    const geometry = translatedEntityGeometry(entity, dx, dy, movingIds);
    if (geometry) drawAngularDimensionEntity({ ...entity, ...geometry }, c, { active: true });
    return;
  }
  if (isPlanAnnotationZone(entity)) {
    const geometry = translatedEntityGeometry(entity, dx, dy);
    if (geometry) drawPlanAnnotationZone({ ...entity, ...geometry, id: "move-preview" }, c);
    return;
  }
  if (entity.dimensionKind === "leader") {
    const geometry = translatedEntityGeometry(entity, dx, dy);
    if (geometry) drawLeaderEntity({ ...entity, ...geometry }, c, { active: true });
    return;
  }
  if (entity.layer === "dimensions") {
    const geometry = translatedEntityGeometry(entity, dx, dy, movingIds);
    if (geometry) drawDimensionEntity({ ...entity, ...geometry }, c, { active: true });
    return;
  }
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
  if (entity.type === "arc" || entity.type === "rectangle") {
    const preview = { ...entity, ...translatedFigureGeometry(entity, dx, dy), id: "move-preview" };
    drawEntity(preview, { ...c, line: c.accent });
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
  if (isPlanAnnotationZone(entity)) {
    const geometry = mapPlanZoneGeometry(entity, (point) => rotatePointAround(point, command.base, delta));
    if (geometry) drawPlanAnnotationZone({ ...entity, ...geometry, id: "rotate-preview" }, c);
    return;
  }
  if (entity.dimensionKind === "leader") {
    const geometry = mapLeaderGeometry(entity, point => rotatePointAround(point, command.base, delta));
    if (geometry) drawLeaderEntity({ ...entity, ...geometry }, c, { active: true });
    return;
  }
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
  if (entity.type === "arc") {
    const geometry = mapArcPoints(entity, point => rotatePointAround(point, command.base, delta));
    drawArcEntity({ ...entity, ...geometry, id: "rotate-preview" }, { ...c, line: c.accent });
    return;
  }
  if (entity.type === "rectangle") {
    drawPolyline(rotatedRectangleGeometry(entity, command.base, delta), c, true, true);
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
  const anotherMenuOpen = [drawToolMenu, dimensionToolMenu, annotationToolMenu, selectModeMenu, copyToolMenu].some((menu) => !menu.hidden);
  const framing = state.selectionDrag || ["window", "lasso"].includes(state.selectTool);
  const show = editableSelectionEntity() && !framing && !anotherMenuOpen && !snapMore.open && syncSelectToolMenu();
  selectToolMenu.hidden = !show;
  syncToolButtons();
}

function editableSelectionEntity() {
  const selected = selectedEntities();
  const primary = selected.length === 1 ? selected[0] : null;
  return primary &&
    !state.drawing &&
    !state.leaderInput &&
    !state.moveCommand &&
    !state.offsetCommand &&
    !state.selectedEndpoint &&
    !state.selectedFigureGrip &&
    !state.circleRadiusEdit &&
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
  if (!selected.length || state.tool !== "select" || state.selectedFigureGrip || state.drawing || state.leaderInput || state.moveCommand || state.offsetCommand || state.lineEdit) return false;
  if (state.copyPicking) return false;
  if (action === "delete" || action === "move") return true;
  if (figureCutActions.has(action)) return selected.length === 1 && editableFigure(selected[0], action);
  if (lineEditActions.has(action)) return selected.length === 1 && isDraftLine(selected[0]);
  if (selected.length !== 1) return false;
  const entity = selected[0];
  if (action === "copy") return true;
  if (action === "mirror") return editableFigure(entity, action) || ["wall", "block"].includes(entity.type);
  if (isPlanAnnotationZone(entity) || entity.dimensionKind === "leader") return action === "rotate";
  if (entity.type === "polyline") return action === "rotate";
  if (action === "rotate") return entity.type === "block" || linearEditableEntity(entity);
  if (action === "offset") return isDraftLine(entity) || entity.type === "wall";
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
  state.selectedFigureGrip = null;
  syncSelectionActions();
}

function entityMatchesSelectionFilter(entity) {
  if (!entity || !isLayerVisible(entity.layer)) return false;
  if (state.selectionFilter === "lines") return ["line", "polyline"].includes(entity.type) && !entity.dimensionKind && entity.layer !== "dimensions";
  if (state.selectionFilter === "dimensions") return entity.layer === "dimensions";
  return true;
}

function selectableEntities() {
  return state.entities.filter(entityMatchesSelectionFilter);
}

function sampleSelectionArc(center, radius, start, sweep) {
  const steps = Math.max(6, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + sweep * index / steps;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

function angularSelectionGeometry(entity) {
  const geometry = angularDimensionGeometry(entity);
  const art = angularDimensionArtwork(geometry, state.annotationScale, entity.arcRadius);
  if (!art) return { points: [], segments: [] };
  const { vertex, startAngle, sweep, measurement } = geometry;
  const arc = sampleSelectionArc(vertex, art.radius, startAngle, sweep);
  const label = angularLabelRect(art.label, formatProjectAngle(measurement, state.measurementSettings), art.textHeight);
  const labels = rectEdges({ minX: label.x, minY: label.y, maxX: label.x + label.width, maxY: label.y + label.height });
  return {
    points: [vertex, art.firstLegEnd, art.secondLegEnd, art.label, ...angularArcExtrema(vertex, art.radius, startAngle, sweep)],
    segments: [[vertex, art.firstLegEnd], [vertex, art.secondLegEnd], ...arc.slice(1).map((point, index) => [arc[index], point]), ...labels],
  };
}

function selectionEntityPoints(entity) {
  if (isPlanAnnotationZone(entity)) return entity.contours?.flat() ?? entity.points;
  if (!entity) return [];
  if (entity.dimensionKind === "angular") return angularSelectionGeometry(entity).points;
  if (entity.dimensionKind === "leader") return leaderSelectionGeometry(entity).points;
  if (entity.type === "polyline") return tessellatePolyline(entity) || entity.points;
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
  if (isPlanAnnotationZone(entity)) {
    return (entity.contours ?? [entity.points]).flatMap((ring) => ring.map((point, index) => [point, ring[(index + 1) % ring.length]]));
  }
  if (entity?.dimensionKind === "angular") return angularSelectionGeometry(entity).segments;
  if (entity?.dimensionKind === "leader") return leaderSelectionGeometry(entity).segments;
  const points = selectionEntityPoints(entity);
  if (entity?.type === "polyline") {
    const count = entity.closed ? points.length : points.length - 1;
    return Array.from({ length: count }, (_, index) => [points[index], points[(index + 1) % points.length]]);
  }
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
    const samples = sampleSelectionArc(arc.center, arc.radius, arc.startAngle, arc.counterClockwise ? span : -span);
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

function startSelectionDrag(type, pointerId, screen) {
  state.selectionDrag = type === "lasso"
    ? { type, points: [screen], start: screen, current: screen }
    : { type, start: screen, current: screen };
  state.pointer = {
    id: pointerId,
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

function scheduleSelectionLongPress(pointer) {
  if (state.tool !== "select" || state.selectTool !== "select" || pointer.mode !== "pan" || pointer.tapCandidateId) return;
  pointer.selectionHoldTimer = window.setTimeout(() => {
    if (state.pointer !== pointer || pointer.moved || state.activePointers.size !== 1 || !state.activePointers.has(pointer.id)) return;
    state.selectTool = "window";
    hideSelectToolMenu();
    startSelectionDrag("window", pointer.id, pointer.startScreen);
  }, LONG_PRESS_SELECT_MS);
}

function clearSelectionDrag() {
  if (!state.selectionDrag) return;
  state.selectionDrag = null;
  state.selectTool = "select";
  syncToolButtons();
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
  clearSelectionDrag();
  setSelection(ids);
  const count = selectedEntities().length;
  statusChip.textContent = count ? `Выбрано: ${count}` : selectionStatusText();
  state.openEditMenuAfterPointer = count > 0;
  if (count) syncSelectToolMenu();
  else hideSelectToolMenu();
  draw();
}

function applyTapSelection(hitId) {
  if (state.selectTool === "multi" && state.copyPicking !== "single") {
    setSelection(hitId, { toggle: true });
  } else {
    setSelection(hitId);
  }
  const count = selectedEntities().length;
  if (state.copyPicking) {
    statusChip.textContent = count ? `Выбрано для копирования: ${count} · нажмите ✓` : "Выберите объекты для копирования";
    return;
  }
  statusChip.textContent = count > 1 ? `Выбрано: ${count}` : count ? "Элемент выбран" : selectionStatusText();
  if (count) {
    if (state.pointer) state.openEditMenuAfterPointer = true;
    else showSelectToolMenu();
  } else {
    hideSelectToolMenu();
  }
}

function drawGrid(rect, c) {
  const step = visibleGridStep();
  const snapStatus = snapEnabled("grid") ? `Шаг привязки ${state.gridStep} мм.` : "Привязка к сетке выключена.";
  const text = `Линии сетки через ${step} мм. ${snapStatus}`;
  if (gridVisibleReadout && gridVisibleReadout.textContent !== text) gridVisibleReadout.textContent = text;
  const minor = step * state.view.scale;
  const majorEvery = 5;
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

function drawCanvasCenterCursor(rect) {
  const navigating = canvas.matches(":focus-visible");
  const visible =
    navigating || state.tool !== "select" || lineEditPlacesPoint() ||
    Boolean(state.moveCommand || state.offsetCommand || state.selectedEndpoint || state.selectedFigureGrip || state.dimensionAttach || surveyPointPicker);
  if (!visible) return;
  const center = { x: rect.width / 2, y: rect.height / 2 };
  const red = state.theme === "dark" ? "#ff9a9a" : "#a3282d";
  ctx.save();
  ctx.strokeStyle = red;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(center.x - 36, center.y);
  ctx.lineTo(center.x + 36, center.y);
  ctx.moveTo(center.x, center.y - 36);
  ctx.lineTo(center.x, center.y + 36);
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
    const bounds = entity.dimensionKind === "angular" ? angularDimensionBounds(entity)
      : entity.dimensionKind === "leader" ? viewportEntityBounds(entity)
      : isPlanAnnotationZone(entity) ? planAnnotationGeometry(entity)?.bounds
        : entity.type === "polyline" ? polylineBounds(entity) : entityBounds(entity);
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
  if (isPlanAnnotationZone(entity)) {
    drawPlanAnnotationZone(entity, c);
  } else if (entity.type === "wall") {
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

function drawPlanScene(entities, c, customLineLayers = state.customLineLayers) {
  const zones = entities.filter(isPlanAnnotationZone);
  if (!printRendering) zoneLabelRects.clear();
  for (const zone of zones) drawPlanAnnotationZone(zone, c, { outline: true });
  drawWalls(entities, c);
  const layerPalettes = new Map(customLineLayers.map(({ id, color }) => [id, { ...c, line: color }]));
  for (const entity of entities) {
    if (entity.type !== "wall" && !isPlanAnnotationZone(entity)) drawEntity(entity, layerPalettes.get(entity.layer) || c);
  }
  if (!zones.length) return;
  const anchors = planAnnotationAnchors(zones);
  const viewport = !printRendering && zones.some((zone) => zone.type === "elevation") ? canvas.getBoundingClientRect() : null;
  const overlays = viewport ? [...shell.querySelectorAll(".status-chip, #saveIndicator, .tool-rail, #planAnnotationActions, .draw-tool-menu, #lineEditOptions, #quickEditModes, #cornerMetrics")]
    .filter((element) => !element.hidden && element.getClientRects().length)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left - viewport.left, y: rect.top - viewport.top, width: rect.width, height: rect.height };
    }) : [];
  for (const zone of zones.sort((a, b) => Number(b.type === "area") - Number(a.type === "area") ||
      planAnnotationGeometry(a).areaMm2 - planAnnotationGeometry(b).areaMm2)) {
    drawPlanAnnotationZone(zone, c, { label: true, anchor: anchors.get(zone.id), overlays, viewport });
  }
}

function planLabelPosition(point, width, height, geometry, overlays, viewport) {
  const rectAt = ({ x, y }) => ({ x: x - width / 2, y: y - height / 2, width, height });
  const { minX, minY, maxX, maxY } = geometry.bounds;
  const min = worldToScreen({ x: minX, y: minY });
  const max = worldToScreen({ x: maxX, y: maxY });
  const fits = (center) => {
    const box = rectAt(center);
    if (viewport && (box.x < 4 || box.y < 4 || box.x + width > viewport.width - 4 || box.y + height > viewport.height - 4)) return false;
    if (!viewport && (box.x < min.x || box.y < min.y || box.x + width > max.x || box.y + height > max.y)) return false;
    return !overlays.some((other) => box.x < other.x + other.width + 4 && box.x + width + 4 > other.x &&
      box.y < other.y + other.height + 4 && box.y + height + 4 > other.y);
  };
  if (fits(point)) return point;
  if (viewport && (max.x < 0 || max.y < 0 || min.x > viewport.width || min.y > viewport.height)) return point;
  const candidates = [];
  for (let y = 1; y <= 7; y++) {
    for (let x = 1; x <= 7; x++) {
      candidates.push({ x: min.x + (max.x - min.x) * x / 8, y: min.y + (max.y - min.y) * y / 8 });
    }
  }
  candidates.sort((a, b) => pointDistance(point, a) - pointDistance(point, b));
  const interior = candidates.find((center) => fits(center) && pointInPolygon(screenToWorld(center), geometry.points));
  if (interior) return interior;
  if (!viewport) return point;
  for (let step = 1; step <= 3; step++) {
    for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const center = { x: point.x + dx * step * (width + 8), y: point.y + dy * step * (height + 8) };
      if (fits(center)) return center;
    }
  }
  return point;
}

function planZoneColor(entity) {
  if (entity.type === "area") return state.theme === "dark" ? "#95c6ff" : layerMeta.areas.color;
  const style = PLAN_ELEVATION_STYLES[entity.zoneStyle] || PLAN_ELEVATION_STYLES.ceiling;
  if (state.theme !== "dark") return style.color;
  return { ceiling: "#6fe1b2", beam: "#ffc78a", drop: "#d2b7ff" }[entity.zoneStyle] || "#6fe1b2";
}

function drawPlanAnnotationZone(entity, c, options = {}) {
  const geometry = planAnnotationGeometry(entity);
  if (!geometry) return;
  const color = planZoneColor(entity);
  ctx.save();
  if (!options.label) {
    ctx.beginPath();
    for (const ring of geometry.contours) {
      const points = ring.map(worldToScreen);
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.09;
    ctx.fill();
    ctx.globalAlpha = shouldGhostEntityForCommand(entity) ? 0.28 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = annotationPx(1.25);
    if (entity.type === "area") ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (!options.outline) {
    const worldAnchor = options.anchor || geometry.anchor;
    const anchor = worldToScreen(worldAnchor);
    const ring = planZoneLabelRing(geometry, worldAnchor);
    const lines = planZoneLabelLines(entity, geometry, state.measurementSettings);
    const size = planZoneLabelHeight(lines, ring.bounds, state.annotationScale) * state.view.scale;
    ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    const width = Math.max(...lines.map((text) => ctx.measureText(text).width)) + size * 1.2;
    const lineHeight = size * ANNOTATION_LINE_SPACING;
    const height = size * 1.7 + lineHeight * (lines.length - 1);
    const point = entity.type === "elevation" && options.overlays
      ? planLabelPosition(anchor, width, height, ring, options.overlays, options.viewport) : anchor;
    const rect = { x: point.x - width / 2, y: point.y - height / 2, width, height };
    options.overlays?.push(rect);
    if (!printRendering && options.label) zoneLabelRects.set(entity.id, rect);
    if (point !== anchor && !pointInPolygon(screenToWorld(point), ring.points)) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      linePath(anchor.x, anchor.y, point.x, point.y);
    }
    ctx.fillStyle = c.surface;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.065;
    roundedRect(rect.x, rect.y, width, height, size / 3);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((text, index) => ctx.fillText(text, point.x, point.y + (index - (lines.length - 1) / 2) * lineHeight));
  }
  ctx.restore();
}

function drawPlanAnnotationDraft(c) {
  const zone = state.planZone;
  if (!zone?.points.length) return;
  const points = zone.points;
  if (zone.mode === "rectangle") {
    const [start] = points;
    const end = cursorWorld();
    const a = worldToScreen(start);
    const b = worldToScreen(end);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
    drawEndpointHandle(a, false, c);
    return;
  }
  const screen = points.map(worldToScreen);
  const closes = planContourClosesAtCursor(points);
  const current = closes ? screen[0] : worldToScreen(cursorWorld());
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(screen[0].x, screen[0].y);
  for (const point of screen.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.setLineDash([5, 4]);
  linePath(screen.at(-1).x, screen.at(-1).y, current.x, current.y);
  ctx.setLineDash([]);
  drawEndpointHandle(screen[0], closes, c);
  ctx.restore();
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
  const first = worldToScreen(entity.points[0]);
  ctx.moveTo(first.x, first.y);
  for (const segment of polylineSegments(entity)) {
    if (segment.arc) appendPolylineArcPath(segment.arc);
    else {
      const point = worldToScreen(segment.p2);
      ctx.lineTo(point.x, point.y);
    }
  }
  if (entity.closed) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function appendPolylineArcPath(arc) {
  const center = worldToScreen(arc.center);
  ctx.arc(center.x, center.y, arc.radius * state.view.scale, arc.startAngle, arc.endAngle, arc.sweep < 0);
}

function polylineArcFromCursor(start, end, cursor) {
  const result = polylineArcFromBend(start, end, cursor);
  return result && isLinePoint(result.arc.through) ? result : null;
}

function drawPolylineArcDraft(draft, c) {
  hideInlineEditors();
  const cursor = cursorWorld();
  const end = draft.arcEnd || cursor;
  const start = worldToScreen(draft.start);
  const destination = worldToScreen(end);
  const preview = draft.arcEnd && polylineArcFromCursor(draft.start, end, cursor);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  if (preview) {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    appendPolylineArcPath(preview.arc);
    ctx.stroke();
  } else {
    ctx.setLineDash([5, 5]);
    linePath(start.x, start.y, destination.x, destination.y);
    ctx.setLineDash([]);
  }
  if (draft.arcEnd) drawEndpointHandle(destination, false, c);
  ctx.restore();
}

function drawLineEntity(entity, c) {
  if (entity.dimensionKind === "leader") {
    drawLeaderEntity(entity, c);
    return;
  }
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
  if (shouldGhostEntityForCommand(entity)) ctx.globalAlpha = 0.28;
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRectangleEntity(entity, c) {
  const corners = rectangleCorners(entity);
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  ctx.save();
  if (shouldGhostEntityForCommand(entity)) ctx.globalAlpha = 0.28;
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.beginPath();
  corners.forEach((corner, index) => { const pt = worldToScreen(corner); if (index === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
  ctx.closePath();
  ctx.stroke();
  if (selected && !state.lineEdit) {
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
  if (shouldGhostEntityForCommand(entity)) ctx.globalAlpha = 0.28;
  ctx.strokeStyle = selected ? c.accent : c.line;
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, arc.radius * state.view.scale, arc.startAngle, arc.endAngle, !arc.counterClockwise);
  ctx.stroke();
  ctx.restore();
}

function drawTextEntity(entity, c) {
  const p = worldToScreen({ x: entity.x, y: entity.y });
  const height = Math.abs(entity.height || 260) * state.view.scale;
  const selected = canShowEntitySelection() && entity.id === state.selectedId && !state.moveCommand && !state.offsetCommand;
  const lines = annotationTextLines(decodeMojibakeText(entity.text));
  const spacing = height * ANNOTATION_LINE_SPACING;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(((entity.rotation || 0) * Math.PI) / 180);
  ctx.font = `${height}px Inter, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = selected ? c.accent : annotationTextColor(entity, c);
  lines.forEach((line, index) => ctx.fillText(line, 0, index * spacing));
  if (selected) {
    const width = Math.max(height * 0.8, ...lines.map((line) => ctx.measureText(line).width));
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-4, -height - 4, width + 8, height + (lines.length - 1) * spacing + 8);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function annotationTextColor(entity, c) {
  if (entity.layer !== "text") return c.dimension;
  return state.theme === "dark" ? "#ddbcff" : layerMeta.text.color;
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
  drawDimensionGeometry(geometry, c, options);
}

function drawLeaderEntity(entity, c, options = {}) {
  const geometry = leaderScreenGeometry(entity);
  const { arrow, center, elbow, rect, lines, font, size, spacing, frame } = geometry;
  const path = options.showText === false ? [arrow, ...(elbow ? [elbow] : []), center] : geometry.path;
  const direction = path.find((point) => pointDistance(point, arrow) > 0.5);
  const dx = (direction?.x ?? arrow.x) - arrow.x;
  const dy = (direction?.y ?? arrow.y) - arrow.y;
  const length = Math.hypot(dx, dy);
  const color = annotationTextColor(entity, c);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * (options.active ? 0.09 : 0.07);
  if (length > 0.5) {
    ctx.setLineDash(options.active ? [7, 5] : []);
    ctx.beginPath();
    ctx.moveTo(arrow.x, arrow.y);
    for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawDimensionArrow(arrow, dx / length, dy / length, Math.min(size * 0.66, length * 0.28), { dimension: color });
  }
  if (options.showText === false) {
    ctx.restore();
    return;
  }
  if (frame) {
    ctx.fillStyle = c.surface;
    roundedRect(rect.x, rect.y, rect.width, rect.height, size * 0.3);
  }
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  lines.forEach((line, index) => ctx.fillText(line, rect.x + rect.width / 2,
    rect.y + rect.height / 2 + (index - (lines.length - 1) / 2) * spacing));
  ctx.restore();
}

function leaderScreenGeometry(entity) {
  if (!printRendering && state.pointer?.targetId === entity.id &&
      (state.pointer.mode === "leader-elbow" || state.pointer.mode === "leader-arrow")) {
    entity = state.pointer.preview ?? entity;
  }
  const arrow = worldToScreen({ x: entity.x1, y: entity.y1 });
  const center = worldToScreen({ x: entity.x2, y: entity.y2 });
  const lines = annotationTextLines(decodeMojibakeText(entity.text));
  const size = leaderTextHeight(entity) * state.view.scale;
  const font = `600 ${size}px Inter, Arial, sans-serif`;
  const spacing = size * ANNOTATION_LINE_SPACING;
  ctx.save();
  ctx.font = font;
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  ctx.restore();
  const { line, frame } = leaderAppearance(entity);
  const { width, height } = leaderFrameSize(size, textWidth, lines.length, frame);
  const rect = {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
  const point = leaderElbowPoint(entity);
  const path = leaderPlanPath(arrow, rect, line, size * 1.1, point ? worldToScreen(point) : null);
  return { arrow, center, elbow: line === "bent" ? path[1] : null, path, rect, lines, font, size, spacing, frame };
}

function leaderSelectionGeometry(entity) {
  const { path, rect } = leaderScreenGeometry(entity);
  const points = path.map(screenToWorld);
  const labelMin = screenToWorld(rect);
  const labelMax = screenToWorld({ x: rect.x + rect.width, y: rect.y + rect.height });
  const label = rectEdges({ minX: labelMin.x, minY: labelMin.y, maxX: labelMax.x, maxY: labelMax.y });
  return {
    points: [...points, ...label.map(([point]) => point)],
    segments: [...points.slice(1).map((point, index) => [points[index], point]), ...label],
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

function drawDimensionGeometry(geometry, c, options = {}) {
  const artwork = linearDimensionArtwork(geometry, state.annotationScale);
  if (!artwork) return;
  const { ux, uy, label, textHeight, rotation } = artwork;
  const a = worldToScreen(artwork.lineStart);
  const b = worldToScreen(artwork.lineEnd);
  const start = worldToScreen(artwork.start);
  const end = worldToScreen(artwork.end);
  const extensionStart = worldToScreen(artwork.extensionStart);
  const extensionEnd = worldToScreen(artwork.extensionEnd);
  const arrowSize = artwork.arrowSize * state.view.scale;
  ctx.save();
  ctx.strokeStyle = c.dimension;
  ctx.fillStyle = c.dimension;
  ctx.lineWidth = annotationPx(options.active ? 1.8 : 1.45);
  ctx.setLineDash(options.active ? [annotationPx(7), annotationPx(5)] : []);
  linePath(start.x, start.y, extensionStart.x, extensionStart.y);
  linePath(end.x, end.y, extensionEnd.x, extensionEnd.y);
  ctx.setLineDash([]);
  linePath(a.x, a.y, b.x, b.y);
  drawDimensionArrow(a, ux, uy, arrowSize, c);
  drawDimensionArrow(b, -ux, -uy, arrowSize, c);
  drawDimensionLabel(`${projectLength(geometry.measurement)}`, label, textHeight, rotation, c);
  ctx.restore();
}

function drawDimensionLabel(text, label, height, rotation, c) {
  const point = worldToScreen(label);
  const size = height * state.view.scale;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(rotation);
  ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
  ctx.lineWidth = size / 4;
  ctx.strokeStyle = c.bg;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = c.dimension;
  ctx.fillText(text, 0, 0);
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
  ctx.font = `700 ${auxiliaryPx(10)}px Inter, Segoe UI, sans-serif`;
  const width = ctx.measureText(text).width + auxiliaryPx(12);
  const height = auxiliaryPx(18);
  ctx.fillStyle = colorMixSurface(c.surface);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  roundedRect(-width / 2, -height / 2, width, height, auxiliaryPx(6));
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
  if (isPlanAnnotationZone(entity)) {
    for (const point of selectionEntityPoints(entity)) drawEndpointHandle(worldToScreen(point), false, c);
    return;
  }
  if (entity.type === "text") return;
  if (entity.type === "polyline") {
    drawPolyline(entity, c, true);
    drawFigureGrips(entity, c);
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
    drawFigureGrips(entity, c);
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
    drawFigureGrips(entity, c);
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
    drawFigureGrips(entity, c);
    ctx.restore();
    return;
  }
  if (entity.layer === "dimensions" || entity.dimensionKind === "leader") {
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
    drawBadge(`${projectLength(metrics.length)}`, m.x, m.y - auxiliaryPx(24), c);
  }
}

function drawFigureGrips(entity, c, activeGrip = null) {
  if (state.lineEdit) return;
  for (const grip of figureGripPoints(entity)) {
    const active = activeGrip?.key === grip.key && activeGrip?.index === grip.index;
    const point = worldToScreen(grip.point);
    if (grip.key !== "bend" && grip.key !== "through") {
      drawEndpointHandle(point, active, c);
      continue;
    }
    const { x, y } = point;
    const size = active ? 8 : 6;
    ctx.save();
    ctx.fillStyle = active ? c.accent : c.surface;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function angularDimensionPreview(entity) {
  const pointer = state.pointer;
  return !printRendering && pointer?.mode === "angular-grip" && pointer.targetId === entity.id && pointer.preview
    ? { ...entity, ...pointer.preview } : entity;
}

function drawAngularDimensionEntity(entity, c, options = {}) {
  const shown = angularDimensionPreview(entity);
  const geometry = angularDimensionGeometry(shown);
  const artwork = angularDimensionArtwork(geometry, state.annotationScale, shown.arcRadius);
  if (!artwork) return;
  const { vertex, startAngle: a1, sweep: delta, measurement } = geometry;
  const v = worldToScreen(vertex);
  const p1 = worldToScreen(artwork.firstLegEnd);
  const p2 = worldToScreen(artwork.secondLegEnd);
  const radius = artwork.radius * state.view.scale;
  ctx.save();
  ctx.strokeStyle = c.dimension;
  ctx.fillStyle = c.dimension;
  ctx.lineWidth = annotationPx(options.active ? 1.8 : 1.45);
  linePath(v.x, v.y, p1.x, p1.y);
  linePath(v.x, v.y, p2.x, p2.y);
  ctx.beginPath();
  ctx.arc(v.x, v.y, radius, a1, a1 + delta, delta < 0);
  ctx.stroke();
  drawDimensionLabel(`${formatProjectAngle(measurement, state.measurementSettings)}`, artwork.label, artwork.textHeight, 0, c);
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
  if (entity.dimensionKind === "angular") {
    const geometry = angularDimensionScreenGeometry(angularDimensionPreview(entity));
    if (!geometry) return;
    const active = state.pointer?.targetId === entity.id ? state.pointer.grip : null;
    for (const [grip, point] of Object.entries(geometry.grips)) {
      drawEndpointHandle(point, active === grip, c);
    }
    return;
  }
  if (entity.dimensionKind === "leader") {
    const geometry = leaderScreenGeometry(entity);
    const { arrow, elbow, path, rect, size } = geometry;
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(arrow.x, arrow.y);
    for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.setLineDash([6, 5]);
    strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, size * 0.3);
    ctx.setLineDash([]);
    drawEndpointHandle(arrow, state.selectedEndpoint?.entityId === entity.id && state.selectedEndpoint?.point === "start", c);
    if (elbow) drawEndpointHandle(elbow, state.pointer?.mode === "leader-elbow" && state.pointer.targetId === entity.id, c);
    ctx.restore();
    return;
  }
  const geometry = dimensionScreenGeometry(entity);
  if (!geometry) return;
  const { a, b } = geometry;
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  drawHandle(a.x, a.y, c);
  drawHandle(b.x, b.y, c);
  ctx.restore();
}

function hitDimensionControl(screen) {
  if (state.tool !== "select") return null;
  const selectedDimensionIds = new Set(selectedEntities().filter((entity) => entity.layer === "dimensions" || entity.dimensionKind === "leader").map((entity) => entity.id));
  if (!selectedDimensionIds.size) return null;
  const hits = [];
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (!isLayerVisible(entity.layer)) continue;
    if (!selectedDimensionIds.has(entity.id)) continue;
    if (entity.dimensionKind === "angular") {
      const geometry = angularDimensionScreenGeometry(entity);
      if (!geometry) continue;
      for (const [grip, point] of Object.entries(geometry.grips)) {
        const score = pointDistance(screen, point);
        if (score <= 19) hits.push({ type: `angular-${grip}`, entity, score, order: i });
      }
      const radiusDistance = Math.min(angularArcDistance(screen, geometry), angularLabelDistance(screen, geometry));
      if (radiusDistance <= 16) hits.push({ type: "angular-radius", entity, score: radiusDistance + 10, order: i });
      continue;
    }
    if (entity.dimensionKind === "leader") {
      const geometry = leaderScreenGeometry(entity);
      const arrowDistance = pointDistance(screen, geometry.arrow);
      const elbowDistance = geometry.elbow ? pointDistance(screen, geometry.elbow) : Infinity;
      const boxDistance = screenRectDistance(screen, geometry.rect);
      const lineDistance = distanceToLeaderPath(screen, geometry.path);
      if (arrowDistance <= 22) hits.push({ type: "leader-arrow", entity, score: arrowDistance, order: i });
      if (elbowDistance <= 20) hits.push({ type: "leader-elbow", entity, score: elbowDistance, order: i });
      if (boxDistance <= 18) hits.push({ type: "leader-box", entity, score: boxDistance === 0 ? 0.5 : boxDistance + 4, order: i });
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
  if (hits[0].type.startsWith("leader-")) {
    state.dimensionPickCycle = null;
    return { type: hits[0].type, entity: hits[0].entity };
  }
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

function distanceToLeaderPath(screen, path) {
  return Math.min(...path.slice(1).map((point, index) => pointToSegmentDistance(screen, path[index], point)));
}

function angularDimensionScreenGeometry(entity) {
  const measure = angularDimensionGeometry(entity);
  const art = angularDimensionArtwork(measure, state.annotationScale, entity.arcRadius);
  if (!art) return null;
  const { vertex, arm1, arm2, startAngle, sweep, measurement } = measure;
  return {
    startAngle, sweep, radius: art.radius * state.view.scale,
    grips: { vertex: worldToScreen(vertex), arm1: worldToScreen(arm1), arm2: worldToScreen(arm2), radius: worldToScreen(art.base) },
    firstArcEnd: worldToScreen(art.firstArcEnd), secondArcEnd: worldToScreen(art.secondArcEnd),
    firstLegEnd: worldToScreen(art.firstLegEnd), secondLegEnd: worldToScreen(art.secondLegEnd),
    label: worldToScreen(art.label), labelHeight: art.textHeight * state.view.scale,
    labelText: formatProjectAngle(measurement, state.measurementSettings),
  };
}

function angularArcDistance(screen, geometry) {
  const vertex = geometry.grips.vertex;
  const angle = angleBetweenPoints(vertex, screen);
  const travel = normalizeAnglePositive((angle - geometry.startAngle) * Math.sign(geometry.sweep || 1));
  if (travel <= Math.abs(geometry.sweep)) return Math.abs(pointDistance(screen, vertex) - geometry.radius);
  return Math.min(pointDistance(screen, geometry.firstArcEnd), pointDistance(screen, geometry.secondArcEnd));
}

function angularLabelRect(point, text, size) {
  ctx.save();
  ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
  const width = ctx.measureText(text).width + size / 4;
  ctx.restore();
  const height = size * 1.25;
  return { x: point.x - width / 2, y: point.y - height / 2, width, height };
}

function angularLabelDistance(screen, geometry) {
  return screenRectDistance(screen, angularLabelRect(geometry.label, geometry.labelText, geometry.labelHeight));
}

function angularArcExtrema(vertex, radius, startAngle, sweep) {
  return [0, Math.PI / 2, Math.PI, Math.PI * 1.5]
    .filter((angle) => angleOnArc(angle, startAngle, startAngle + sweep, sweep >= 0))
    .map((angle) => ({ x: vertex.x + Math.cos(angle) * radius, y: vertex.y + Math.sin(angle) * radius }));
}

function angularDimensionBounds(entity) {
  const geometry = angularDimensionGeometry(entity);
  const artwork = angularDimensionArtwork(geometry, state.annotationScale, entity.arcRadius);
  if (!artwork) return null;
  const { vertex, startAngle, sweep } = geometry;
  const points = [vertex, artwork.firstLegEnd, artwork.secondLegEnd, artwork.label, ...angularArcExtrema(vertex, artwork.radius, startAngle, sweep)];
  const { textHeight } = artwork;
  points.push({ x: artwork.label.x - textHeight * 2, y: artwork.label.y - textHeight / 2 },
    { x: artwork.label.x + textHeight * 2, y: artwork.label.y + textHeight / 2 });
  return boundsFromViewportPoints(points);
}

function isLinearDimension(entity) {
  return entity.type === "line" && entity.layer === "dimensions" &&
    entity.dimensionKind !== "angular" && entity.dimensionKind !== "leader";
}

function dimensionScreenGeometry(entity) {
  if (!isLinearDimension(entity)) return null;
  const geometry = dimensionWorldGeometry(entity);
  const artwork = linearDimensionArtwork(geometry, state.annotationScale);
  if (!artwork) return null;
  const a = worldToScreen(artwork.lineStart);
  const b = worldToScreen(artwork.lineEnd);
  const [aEndpoint, bEndpoint] = artwork.start === geometry.start ? ["start", "end"] : ["end", "start"];
  return {
    a,
    b,
    aEndpoint,
    bEndpoint,
    legStart: { p1: worldToScreen(artwork.start), p2: worldToScreen(artwork.extensionStart), endpoint: aEndpoint },
    legEnd: { p1: worldToScreen(artwork.end), p2: worldToScreen(artwork.extensionEnd), endpoint: bEndpoint },
    label: worldToScreen(artwork.label),
  };
}

function dimensionWorldGeometry(entity) {
  return dimensionGeometry(entity);
}

function dimensionDisplayLength(entity) {
  return projectLength(dimensionWorldGeometry(entity)?.measurement);
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
  if (state.snapsMuted) return null;
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
  if (state.snapsMuted) return rawOffset;
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

function drawActiveSegment(c, viewport) {
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
    hideInlineEditors();
    drawActiveArc(c);
    return;
  }
  const p1 = worldToScreen(start);
  const p2 = worldToScreen(end);
  const metrics = segmentMetrics(start.x, start.y, end.x, end.y);
  const angleInfo = activeAngleInfo(start, end);

  if (state.tool === "dimension") {
    if (state.dimensionTool === "angular") {
      drawActiveAngularDimension(c);
      return;
    }
    if (state.dimensionTool === "leader") {
      const values = leaderToolOptions();
      const text = state.leaderInput ? leaderUi.text.value.trim() : "";
      const label = leaderLabelPoint(state.drawing, end);
      const preview = leaderEntity("preview", start, label, text, {
        ...values, leaderLine: state.drawing.elbow ? values.leaderLine : "straight", leaderElbow: state.drawing.elbow,
      });
      drawLeaderEntity(preview, c, { active: true, showText: Boolean(text) });
      drawHandle(p1.x, p1.y, c);
      if (state.drawing.elbow) {
        const elbow = worldToScreen(state.drawing.elbow);
        drawHandle(elbow.x, elbow.y, c);
      }
      const labelScreen = worldToScreen(label);
      drawHandle(labelScreen.x, labelScreen.y, c);
      hideInlineEditors();
      return;
    }
    const provisional = draftDimension(start, end);
    const initialGeometry = dimensionGeometry(provisional);
    if (!initialGeometry) return;
    if (state.drawing.chainOffset != null || state.drawing.phase === "offset") {
      provisional.offset = draftDimensionOffset(initialGeometry, rawCursorWorld());
    }
    drawDimensionEntity(provisional, c);
    drawHandle(p1.x, p1.y, c);
    drawHandle(p2.x, p2.y, c);
    hideInlineEditors();
    return;
  }

  const angleAnchor = drawEditableSegment(start, end, c, { lineWidth: 2.2, showHandles: state.tool !== "line" });
  updateInlineEditors(start, end, metrics, angleInfo);
  if (state.tool === "line" && !surveyPointPicker) {
    const lengthAnchor = drawDraftLengthDimension(p1, p2, c, viewport);
    updateDraftMetricLabels(lengthAnchor, angleAnchor, distanceWorld(start, end), angleInfo, viewport);
  }
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
  if (options.showHandles !== false) {
    drawHandle(p1.x, p1.y, c);
    drawHandle(p2.x, p2.y, c);
  }
  ctx.restore();
  return drawAngleArc(p1, p2, angleInfo, c);
}

function drawDraftLengthDimension(start, end, c, viewport) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const span = Math.hypot(dx, dy);
  if (span < 14) return null;

  const normal = { x: -dy / span, y: dx / span };
  const offset = Math.min(32, Math.max(22, auxiliaryPx(26)));
  const center = midpoint(start, end);
  const labelFits = ({ x, y }) => x >= 32 && x <= viewport.width - 32 && y >= 36 && y <= viewport.height - 92;
  const shift = (point, distance) => ({ x: point.x + normal.x * distance, y: point.y + normal.y * distance });
  let side = normal.y > 0 || (normal.y === 0 && normal.x > 0) ? -1 : 1;
  if (!labelFits(shift(center, side * offset)) && labelFits(shift(center, -side * offset))) side *= -1;
  const from = shift(start, side * offset);
  const to = shift(end, side * offset);
  const insetStart = shift(start, side * 4);
  const insetEnd = shift(end, side * 4);

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.setLineDash([1, 4]);
  ctx.globalAlpha = 0.55;
  linePath(insetStart.x, insetStart.y, from.x, from.y);
  linePath(insetEnd.x, insetEnd.y, to.x, to.y);
  ctx.globalAlpha = 0.9;
  linePath(from.x, from.y, to.x, to.y);

  ctx.restore();
  return midpoint(from, to);
}

function updateDraftMetricLabels(lengthAnchor, angleAnchor, length, angleInfo, viewport) {
  draftMetricLabels.hidden = false;
  updateMetricField(draftLengthInput, draftLengthReadout, length);
  updateMetricField(draftAngleInput, draftAngleReadout, angleInfo.degrees, { angle: true, wrap: angleInfo.cadAngle });
  const activeInput = numericConfirmInput();
  const entries = [[draftLengthInput, lengthAnchor], [draftAngleInput, angleAnchor]];
  if (activeInput === draftAngleInput || pressedMetricFields.has(draftAngleInput.parentElement)) entries.reverse();
  let placed = null;
  for (const [input, anchor] of entries) {
    const field = input.parentElement;
    const pinned = input === activeInput || pressedMetricFields.has(field);
    const previous = field.style.left && !field.hidden ? { x: parseFloat(field.style.left), y: parseFloat(field.style.top) } : null;
    const point = (pinned && previous) || anchor;
    field.hidden = !point;
    if (!point) continue;

    const halfWidth = (field.offsetWidth || 48) / 2;
    const maxY = Math.max(20, viewport.height - Math.max(70, draftingKeyboardInset + 6) - 20);
    const minY = Math.min(43, maxY);
    const minX = halfWidth + 4;
    const maxX = Math.max(minX, viewport.width - halfWidth - 4);
    let x = Math.max(minX, Math.min(maxX, point.x));
    let y = Math.max(minY, Math.min(maxY, point.y));

    // The controls under the save status occupy the upper-right corner.
    if (y < 96 && x + halfWidth > viewport.width - 156) {
      if (maxY >= 98) y = 98;
      else x = Math.max(minX, viewport.width - 160 - halfWidth);
    }
    if (placed && Math.abs(x - placed.x) < halfWidth + placed.halfWidth + 4 && Math.abs(y - placed.y) < 40) {
      if (placed.y + 42 <= maxY) y = placed.y + 42;
      else if (placed.y - 42 >= minY && (placed.y - 42 >= 96 || x + halfWidth <= viewport.width - 156)) y = placed.y - 42;
      else if (placed.x - placed.halfWidth - halfWidth - 4 >= minX) x = placed.x - placed.halfWidth - halfWidth - 4;
      else if (placed.x + placed.halfWidth + halfWidth + 4 <= maxX) x = placed.x + placed.halfWidth + halfWidth + 4;
      else if (!pinned) {
        field.hidden = true;
        continue;
      }
    }
    field.style.left = `${x}px`;
    field.style.top = `${y}px`;
    placed = { x, y, halfWidth };
  }
}

function angleSideAt(screen, first = null) {
  const world = screenToWorld(screen);
  let nearest = screenUiPx(18) / state.view.scale;
  let side = null;
  for (const { p1, p2, arc, entity } of drawableSnapSegments()) {
    if (arc || entity.dimensionKind || distanceWorld(p1, p2) <= linePointEpsilon) continue;
    if (first && first.entityId === entity.id &&
        distanceWorld(first.p1, p1) <= linePointEpsilon && distanceWorld(first.p2, p2) <= linePointEpsilon) continue;
    const pick = projectPointToSegmentWorld(world, p1, p2);
    if (pick.distance < nearest) {
      nearest = pick.distance;
      side = { p1, p2, pick, entityId: entity.id };
    }
  }
  return side;
}

function angleBetweenSides(first, second) {
  const direction = ({ p1, p2 }) => {
    const length = distanceWorld(p1, p2);
    return { x: (p2.x - p1.x) / length, y: (p2.y - p1.y) / length };
  };
  const a = direction(first);
  const b = direction(second);
  const cross = a.x * b.y - a.y * b.x;
  if (Math.abs(cross) <= 1e-8) return null;
  const along = ((second.p1.x - first.p1.x) * b.y - (second.p1.y - first.p1.y) * b.x) / cross;
  const vertex = { x: first.p1.x + a.x * along, y: first.p1.y + a.y * along };
  if (!isLinePoint(vertex)) return null;
  const arm = side => {
    const { x, y } = side.pick;
    if (distanceWorld(vertex, { x, y }) > linePointEpsilon) return { x, y };
    return distanceWorld(vertex, side.p1) > distanceWorld(vertex, side.p2) ? side.p1 : side.p2;
  };
  return angularDimensionEntity("preview", vertex, arm(first), arm(second));
}

function commitAngleFromSegments(screen) {
  const first = state.angleSide;
  const side = angleSideAt(screen, first);
  if (!side) {
    statusChip.textContent = first ? "Выберите другую прямую сторону" : "Укажите прямую сторону угла";
  } else if (!first) {
    state.angleSide = side;
    statusChip.textContent = "Угол · выберите вторую сторону";
  } else {
    const angle = angleBetweenSides(first, side);
    const geometry = angle && angularDimensionGeometry(angle);
    if (geometry) {
      pushEntity({ ...angle, id: newLineId("dimension") });
      state.angleSide = null;
      statusChip.textContent = `Угол ${formatProjectAngle(geometry.measurement, state.measurementSettings)} создан · выберите первую сторону`;
    } else {
      statusChip.textContent = "Нужны две непараллельные стороны";
    }
  }
  draw();
}

function drawAngleFromSegmentsPreview(c) {
  const first = state.angleSide;
  const current = angleSideAt(centerScreen(), first);
  if (first && current) {
    const angle = angleBetweenSides(first, current);
    if (angle) drawAngularDimensionEntity(angle, c, { active: true });
  }
  for (const side of [first, current]) {
    if (!side) continue;
    const start = worldToScreen(side.p1);
    const end = worldToScreen(side.p2);
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    linePath(start.x, start.y, end.x, end.y);
    ctx.restore();
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
  state.inlineEdit = { start: centerWorld, end: edgeWorld, metrics: { length: Math.round(radius), angle: 0 } };
  updateCircleMetricFields(radius);
}
function drawActiveRectangle(start, end, c) {
  drawRectangleEntity(rectangleEntity("preview", start.x, start.y, end.x, end.y), { ...c, line: c.accent });
  updateTopMetricInputs(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
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
function drawAngleArc(origin, target, angleInfo, c) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const screenLength = Math.hypot(dx, dy);
  if (screenLength < (state.tool === "line" ? 14 : 34)) return null;

  const ux = dx / screenLength;
  const uy = dy / screenLength;
  const followsCursor = screenLength > auxiliaryPx(150);
  const centerOffset = followsCursor ? Math.min(screenLength * 0.42, auxiliaryPx(118)) : 0;
  const arcOrigin = followsCursor
    ? { x: target.x - ux * centerOffset, y: target.y - uy * centerOffset }
    : origin;
  const radius = Math.min(auxiliaryPx(54), Math.max(auxiliaryPx(32), screenLength * 0.32));
  const startRad = angleInfo.referenceRad;
  const endRad = angleInfo.referenceRad + angleInfo.deltaRad;

  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = auxiliaryPx(0.65);
  ctx.setLineDash([1, 6]);
  linePath(
    arcOrigin.x,
    arcOrigin.y,
    arcOrigin.x + Math.cos(startRad) * (radius + auxiliaryPx(14)),
    arcOrigin.y + Math.sin(startRad) * (radius + auxiliaryPx(14)),
  );
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = auxiliaryPx(0.65);
  ctx.setLineDash([1, 5]);
  ctx.beginPath();
  ctx.arc(arcOrigin.x, arcOrigin.y, radius, startRad, endRad, angleInfo.deltaRad < 0);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
  const labelRad = startRad + angleInfo.deltaRad / 2;
  return { x: arcOrigin.x + Math.cos(labelRad) * (radius + 15), y: arcOrigin.y + Math.sin(labelRad) * (radius + 15) };
}

function projectLength(mm) {
  return formatProjectLength(mm, state.measurementSettings);
}

function readProjectLength(input) {
  return fromProjectLength(parseLineDecimal(input.value), state.measurementSettings);
}

function updateMetricField(input, readout, value, { angle = false, wrap = false } = {}) {
  const settings = state.measurementSettings;
  const text = angle ? formatProjectAngle(value, settings, { suffix: false, wrap }) : formatProjectLength(value, settings, { suffix: false });
  if (readout.textContent !== text) readout.textContent = text;
  const unit = input.parentElement.querySelector(".metric-unit");
  const unitText = angle ? "°" : projectUnit(settings).label;
  if (unit && unit.textContent !== unitText) unit.textContent = unitText;
  if (numericConfirmInput() === input) return;
  const buffer = state.numericEdit?.lineMetric?.texts?.[lineMetricKinds.get(input)];
  input.value = buffer ?? metricEntryValue(angle ? value : toProjectLength(value, settings));
  syncInlineEditorWidth(input);
}

function updateInlineEditors(start, end, metrics, angleInfo) {
  inlineEditors.hidden = false;
  const lineDraft = state.tool === "line";
  if (lineDraft && inlineEditors.dataset.metricContext !== "line-draft") inlineEditors.dataset.metricContext = "line-draft";
  else if (!lineDraft) delete inlineEditors.dataset.metricContext;
  drawMetrics.hidden = true;
  lengthEditor.hidden = false;
  angleEditor.hidden = false;
  lengthMetricName.textContent = "Длина";
  lengthInput.setAttribute("aria-label", "Длина линии");
  state.inlineEdit = { start, end, metrics, angleInfo };

  let description = "";
  if (lineDraft && distanceWorld(start, end) > linePointEpsilon) {
    const radians = angleBetweenPoints(start, end);
    const direction = lineDirections[(Math.round(radians / (Math.PI / 4)) + 8) % 8];
    description = `Направление ${direction}`;
  }
  if (lineDirectionDescription.textContent !== description) lineDirectionDescription.textContent = description;
  updateMetricField(lengthInput, lengthReadout, distanceWorld(start, end));
  updateMetricField(angleInput, angleReadout, angleInfo.degrees, { angle: true, wrap: angleInfo.cadAngle });
}

function updateTopMetricInputs(length, angle, { cadAngle = false } = {}) {
  drawMetrics.hidden = false;
  inlineEditors.hidden = true;
  const rectangle = state.tool === "rectangle" && state.drawing;
  const rotating = state.moveCommand?.mode === "rotate";
  topLengthName.textContent = state.offsetCommand ? "Смещение" : "Длина";
  topAngleName.textContent = rectangle ? "Ширина" : "Угол";
  topLengthInput.parentElement.hidden = rotating;
  topAngleInput.parentElement.hidden = Boolean(state.offsetCommand);
  topLengthInput.setAttribute("aria-label", rectangle ? "Длина прямоугольника" : topLengthName.textContent);
  topAngleInput.setAttribute("aria-label", rectangle ? "Ширина прямоугольника" : "Угол");
  updateMetricField(topLengthInput, topLengthReadout, length);
  updateMetricField(topAngleInput, topAngleReadout, angle, { angle: !rectangle, wrap: cadAngle });
}

function updateSelectedEndpointEditors(previewMoving = null) {
  const geometry = selectedEndpointGeometry();
  if (!geometry) return;
  const { fixed, moving } = geometry;
  const end = previewMoving || moving;
  updateInlineEditors(fixed, end, segmentMetrics(fixed.x, fixed.y, end.x, end.y), activeAngleInfo(fixed, end));
  angleEditor.hidden = !isDraftLine(geometry.entity);
}

function selectedCircleForMetrics() {
  if (state.tool !== "select" || state.selectedIds.length !== 1 || state.lineEdit || surveyPointPicker) return null;
  const entity = state.entities.find((item) => item.id === state.selectedId);
  return entity?.type === "circle" ? entity : null;
}

function updateCircleMetricFields(radius) {
  inlineEditors.hidden = false;
  inlineEditors.dataset.metricContext = state.drawing ? "circle-draft" : "selected-circle";
  drawMetrics.hidden = true;
  lengthEditor.hidden = false;
  angleEditor.hidden = true;
  lineDirectionDescription.textContent = "";
  lengthMetricName.textContent = "Радиус";
  lengthInput.setAttribute("aria-label", "Радиус круга");
  updateMetricField(lengthInput, lengthReadout, radius);
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
  if (draft && !draft.arcPhase && ["line", "polyline"].includes(state.tool)) return { key: draft.start, start: draft.start, end: draft.end, endpoint: false };
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

function closeMetricEntry() {
  if (!numericConfirmInput()) return;
  document.activeElement.blur();
  window.ZamerAndroid?.dismissKeyboard?.();
  updateViewportLock();
}

function closeLineMetricInput() {
  if (state.numericEdit?.lineMetric || lineMetricContext()) closeMetricEntry();
  clearLineMetricEdit();
}

function updateLineMetricInput(input) {
  beginNumericInputEdit(input);
  const edit = state.numericEdit?.lineMetric;
  const kind = lineMetricKinds.get(input);
  if (!edit || !kind) return;
  edit.texts[kind] = input.value;
  const value = kind === "length" ? readProjectLength(input) : parseLineDecimal(input.value);
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
    state.numericEdit = { lineMetric: { ...lineContext, point: null, texts: {} } };
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
  if (modifiedMetricInputs.has(input)) {
    const apply = input === topLengthInput || input === topAngleInput ? applyTopMetricValue : applyInlineValue;
    apply(lineMetricKinds.get(input), { recordUndo: false });
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
  closeMetricEntry();
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
  const typedLength = readProjectLength(topLengthInput);
  const typedWidth = readProjectLength(topAngleInput);
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
  const typedLength = readProjectLength(topLengthInput);
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
  const typedLength = readProjectLength(topLengthInput);
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

function startMoveLikeCommand(source, mode) {
  const entities = Array.isArray(source) ? source : [source];
  const entity = entities[0];
  if (!entity) return;
  hideSelectModeMenu();
  hideSelectToolMenu();
  resetSnapTracking();
  state.offsetCommand = null;
  state.moveCommand = {
    entityId: entity.id,
    entityIds: new Set(entities.map(item => item.id)),
    mode,
    base: null,
    end: null,
    lockedEnd: false,
    before: entityGeometry(entity),
  };
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  hideInlineEditors();
  syncCommandState();
  const label = mode === "copy" ? "Копия" : mode === "rotate" ? "Поворот" : entities.length > 1 ? "Перемещение группы" : "Переместить";
  statusChip.textContent = `${label}: наведите курсор на базовую точку и тапните`;
  draw();
}

function startOffsetCommand(entity) {
  hideSelectModeMenu();
  hideSelectToolMenu();
  state.moveCommand = null;
  state.offsetCommand = {
    entityId: entity.id,
    distance: 300,
  };
  state.selectedEndpoint = null;
  state.endpointEditBefore = null;
  hideInlineEditors();
  syncCommandState();
  updateTopMetricInputs(300, 0);
  statusChip.textContent = "Смещение: введите расстояние и укажите сторону";
  draw();
}

function applySelectionAction(action) {
  const selected = selectedEntities().filter((item) => isLayerVisible(item.layer));
  const actionEntity = selected.length === 1 ? selected[0] : null;
  if (!canApplySelectionAction(action)) return;

  if (action === "delete") {
    const ids = new Set(selected.map(entity => entity.id));
    const deleted = [];
    state.entities = state.entities.filter((entity, index) => {
      if (!ids.has(entity.id)) return true;
      deleted.push({ entity, index });
      return false;
    });
    if (!deleted.length) return;
    state.undo.push({ type: "delete-many", items: deleted });
    state.redo.length = 0;
    markProjectDirty("delete");
    setSelection(null);
    state.endpointEditBefore = null;
    statusChip.textContent = deleted.length > 1 ? `Удалено: ${deleted.length}` : "Объект удален";
    hideInlineEditors();
    syncSelectToolMenu();
    draw();
    return;
  }

  if (action === "move") {
    startMoveLikeCommand(selected, "move");
    return;
  }

  if (!actionEntity) return;
  if (action === "mirror" || (isDraftLine(actionEntity) && lineOnlyEditActions.has(action)) ||
      (figureCutActions.has(action) && editableFigure(actionEntity, action))) {
    startLineEdit(action, actionEntity);
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


  const entity = state.entities.find((item) => item.id === state.selectedId);
  if (!entity || entity.type === "block" || entity.layer === "dimensions") return;

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

function hideInlineEditors() {
  if (state.numericEdit?.lineMetric) closeLineMetricInput();
  else closeMetricEntry();
  lineDirectionDescription.textContent = "";
  inlineEditors.hidden = true;
  draftMetricLabels.hidden = true;
  drawMetrics.hidden = true;
  state.inlineEdit = null;
  state.circleRadiusEdit = null;
}

function leaderToolActive() {
  return state.tool === "dimension" && state.dimensionTool === "leader";
}

function leaderToolOptions() {
  return state.leaderInput?.options ?? {
    textHeight: annotationPreferences.leaderHeight,
    leaderLine: annotationPreferences.leaderLine,
    leaderFrame: annotationPreferences.leaderFrame,
  };
}

function leaderPlacementHint() {
  const count = leaderToolOptions().leaderLine === "bent" ? 3 : 2;
  if (state.drawing?.phase === "leader-elbow") return "Выноска · 2 из 3 · точка излома";
  if (state.drawing?.phase === "leader-end") return `Выноска · ${count} из ${count} · место текста`;
  if (state.drawing?.phase === "leader-text") return "Выноска · введите текст";
  return `Выноска · 1 из ${count} · кончик стрелки`;
}

function leaderLabelPoint(draft, point) {
  return draft.elbow ? { x: point.x, y: draft.elbow.y } : point;
}

function commitLeaderPoint(point) {
  const draft = state.drawing;
  if (draft?.elbow) point = leaderLabelPoint(draft, point);
  if (!draft) {
    const phase = leaderToolOptions().leaderLine === "bent" ? "leader-elbow" : "leader-end";
    state.drawing = { start: point, end: point, lockedEnd: false, phase };
  } else if (distanceWorld(draft.start, point) <= linePointEpsilon ||
      (draft.elbow && distanceWorld(draft.elbow, point) <= linePointEpsilon)) {
    statusChip.textContent = "Выберите другую точку выноски";
    return;
  } else if (draft.phase === "leader-elbow") {
    draft.elbow = point;
    draft.phase = "leader-end";
  } else {
    draft.end = point;
    draft.lockedEnd = true;
    draft.phase = "leader-text";
    openLeaderInput();
  }
  resetSnapTracking();
  statusChip.textContent = leaderPlacementHint();
  draw();
}

function openLeaderInput(entity = null) {
  if (state.leaderInput) return;
  const appearance = entity ? leaderAppearance(entity) : null;
  state.leaderInput = {
    entity,
    options: entity ? { textHeight: leaderTextHeight(entity), leaderLine: appearance.line, leaderFrame: appearance.frame } : null,
  };
  leaderUi.text.value = entity ? decodeMojibakeText(entity.text || "") : "";
  leaderUi.text.removeAttribute("aria-invalid");
  leaderUi.error.textContent = "";
  leaderUi.editor.hidden = false;
  syncLeaderTools();
  syncLeaderInputPosition();
  leaderUi.text.focus({ preventScroll: true });
  updateViewportLock();
  draw();
}

function closeLeaderInput() {
  if (!state.leaderInput) return;
  state.leaderInput = null;
  if (leaderUi.editor.contains(document.activeElement) || leaderUi.tools.contains(document.activeElement)) document.activeElement.blur();
  leaderUi.editor.hidden = true;
  leaderUi.text.value = "";
  updateViewportLock();
}

function finishLeaderInput(save) {
  const input = state.leaderInput;
  if (!input) return;
  const draft = state.drawing;
  if (save) {
    if (leaderUi.height.hasAttribute("aria-invalid")) {
      leaderUi.error.textContent = "Укажите высоту текста от 1 до 100 000 мм";
      leaderUi.height.focus({ preventScroll: true });
      syncLeaderInputPosition();
      return;
    }
    const text = leaderUi.text.value.trim();
    if (!text) {
      leaderUi.error.textContent = "Введите текст выноски";
      leaderUi.text.setAttribute("aria-invalid", "true");
      leaderUi.text.focus({ preventScroll: true });
      syncLeaderInputPosition();
      return;
    }
    const values = { ...leaderToolOptions(), text };
    if (input.entity && state.entities.includes(input.entity)) editLeaderProperties(input.entity, values);
    else if (!input.entity && draft?.phase === "leader-text") {
      pushEntity(leaderEntity(newLineId("leader"), draft.start, draft.end, text, { ...values, leaderElbow: draft.elbow }));
    }
    rememberAnnotationSettings(["leader"], values);
  }
  if (!input.entity) state.drawing = null;
  closeLeaderInput();
  resetSnapTracking();
  statusChip.textContent = input.entity ? (save ? "Выноска изменена" : "Правка выноски отменена") : leaderPlacementHint();
  canvas.focus({ preventScroll: true });
  draw();
}

function editLeaderProperties(entity, values) {
  const { line, frame } = leaderAppearance(entity);
  const current = { text: decodeMojibakeText(entity.text || ""), textHeight: leaderTextHeight(entity), leaderLine: line, leaderFrame: frame };
  const after = Object.fromEntries(Object.entries(values).filter(([key, value]) => current[key] !== value));
  if (!Object.keys(after).length) return;
  const before = Object.fromEntries(Object.keys(after).map((key) => [key, entity[key]]));
  recordAnnotationEdits([{ entityId: entity.id, before, after }]);
}

async function editTextEntity(entity) {
  if (entity?.type !== "text") return;
  const values = await openPlanAnnotationEditor("text", entity);
  if (values && state.entities.includes(entity)) applyPlanAnnotationEdit(entity, { text: values.text, height: values.textHeight });
}

async function createTextAtPoint(point) {
  const projectId = persistence.projectId;
  statusChip.textContent = "Текст: введите надпись";
  const values = await openPlanAnnotationEditor("text");
  if (persistence.projectId !== projectId || state.tool !== "text") return;
  if (values) {
    const entity = textEntity(newLineId("text"), point.x, point.y, values.text, values.textHeight);
    entity.layer = "text";
    pushEntity(entity);
  }
  statusChip.textContent = values ? "Текст поставлен. Можно добавить ещё надпись" : "Текст: укажите место надписи";
  draw();
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
  const typedLength = readProjectLength(lengthInput);
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
  const typedLength = readProjectLength(lengthInput);
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
  const px = fixedScreenSize ? screenUiPx : auxiliaryPx;
  ctx.save();
  ctx.font = `700 ${px(10)}px Inter, Segoe UI, sans-serif`;
  const padX = px(6);
  const width = ctx.measureText(text).width + padX * 2;
  const height = px(18);
  const rx = x - width / 2;
  const ry = y - height / 2;
  ctx.fillStyle = secondary ? c.surface : c.accent;
  ctx.strokeStyle = secondary ? c.accent : c.accent;
  ctx.lineWidth = px(1);
  roundedRect(rx, ry, width, height, px(5), true);
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
  if (state.snapsMuted || hint?.type !== "line" || !hint.segment) return;
  const a = worldToScreen(hint.segment.p1);
  const b = worldToScreen(hint.segment.p2);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([9, 6]);
  linePath(a.x, a.y, b.x, b.y);
  ctx.restore();
}

function canUseSnapTracking() {
  return (Boolean(trackingBasePoint()) || canUsePrePointTracking()) && snapEnabled("polar") &&
    ["end", "mid", "center", "intersection"].some(snapEnabled) && canCaptureSnapTrackingNow();
}

function canCreateSnapTrackingPoint() {
  if (state.tool === "dimension" && state.drawing) return false;
  return canUseSnapTracking();
}

function canSnapToTrackingGuides() {
  return Boolean(trackingBasePoint()) && snapEnabled("polar") && state.snapTracking.points.length > 0 && !state.pinch;
}

function canUsePrePointTracking() {
  if (state.drawing || state.moveCommand || state.offsetCommand || state.pinch || planZoneSnapStart() || state.planZone?.mode === "existing") return false;
  if (state.pointer && state.pointer.mode !== "pan") return false;
  return trackingDrawingTools.has(state.tool);
}

function canCaptureSnapTrackingNow() {
  if (state.pinch) return false;
  if (!state.pointer) return true;
  return state.pointer.mode === "pan" || state.pointer.mode === "move-command" || state.pointer.mode === "endpoint-place";
}

function canSnapToPrePointTrackingGuides() {
  return canUsePrePointTracking() && snapEnabled("polar") && state.snapTracking.points.length > 0;
}

function trackingBasePoint() {
  if (state.drawing?.phase === "offset") return null;
  if (state.drawing?.start) return state.drawing.start;
  const zoneStart = planZoneSnapStart();
  if (zoneStart) return zoneStart;
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
  const guides = activeTrackingGuides();
  if (!guides.length) return;
  const rect = canvas.getBoundingClientRect();
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([10, 6]);
  for (const guide of guides) drawTrackingGuideLine(guide, rect);
  ctx.restore();
}
function drawPolarSnapGuide(c) {
  const guide = state.polarSnapGuide;
  if (!guide || !snapEnabled("polar")) return;
  const rect = canvas.getBoundingClientRect();
  const start = worldToScreen(guide.point);
  const length = Math.max(rect.width, rect.height) * 1.45;
  const dx = Math.cos(guide.angle) * length;
  const dy = Math.sin(guide.angle) * length;
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.65;
  ctx.setLineDash([12, 7]);
  linePath(start.x - dx, start.y - dy, start.x + dx, start.y + dy);
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

function resetSnapTracking() {
  clearSnapTrackingHover();
  state.snapTracking.points = [];
  state.snapTracking.active = null;
  state.polarSnapGuide = null;
  state.dimensionSnapChoice = null;
}

function drawCursorSnap(c) {
  const dimensionStage = state.tool === "dimension" && !surveyPointPicker && !state.leaderInput ? state.drawing?.phase : null;
  const chooseAxis = state.dimensionTool === "linear" && dimensionStage === "offset";
  const selectOnly = state.tool === "select" && !state.moveCommand && !state.selectedEndpoint && !state.selectedFigureGrip && !state.dimensionAttach &&
    !surveyPointPicker && !lineEditPlacesPoint();
  const resolved = surveyPointPicker ? resolveDimensionPointSnap(rawCursorWorld(), { start: null })
    : selectOnly || state.leaderInput || dimensionStage === "offset" ? null : cursorSnapResolved();
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
  const hint = state.dimensionSnapHint;
  const snap = !state.snapsMuted && (resolved?.snap || (hint && { ...hint.point, type: "tracking" }));
  const rawType = snap?.type || snap?.snapRole;
  const type = snap ? (Object.hasOwn(snapMarkerPaths, rawType) ? rawType : "end") : "";
  if (canvas.dataset.activeSnap !== type) canvas.dataset.activeSnap = type;
  if (!snap) return;
  if (type === "tracking") drawSnapTracking(c);
  if (type === "polar") drawPolarSnapGuide(c);
  if ((state.tool === "line" || state.tool === "arc" || state.drawing?.arcPhase) &&
      (type === "tracking" || type === "polar")) return;
  const point = worldToScreen(snap);
  ctx.save();
  ctx.translate(point.x - 12, point.y - 12);
  ctx.strokeStyle = c.bg;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(snapMarkerPaths[type]);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.stroke(snapMarkerPaths[type]);
  ctx.restore();
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
  return state.tool === "line" || state.tool === "polyline" || state.planZone?.mode === "contour" || isDraftLine(selectedEndpointGeometry()?.entity) || Boolean(state.selectedFigureGrip) ||
    ["line-grip", "figure-grip"].includes(state.pointer?.mode) || ["offset", "mirror", "scale"].includes(state.lineEdit?.mode);
}

function nearestDraftLineSnap(point, start) {
  const perpendicular = start && snapEnabled("perpendicular");
  const intersection = snapEnabled("intersection");
  if (!perpendicular && !intersection) return null;
  const threshold = objectSnapThreshold();
  const excluded = state.selectedEndpoint?.entityId || state.selectedFigureGrip?.entityId || state.pointer?.grip?.entityId;
  const boundaries = boundarySegments(excluded);
  const crossing = intersection ? nearestIntersection(point, boundaries, threshold) : null;
  const foot = perpendicular ? nearestPerpendicular(point, start, boundaries, threshold) : null;
  if (!crossing || (foot && distanceWorld(foot, point) < distanceWorld(crossing, point))) return foot;
  return crossing;
}

function nearestObjectSnap(point, { includeNearestSegment = false, start = null } = {}) {
  if (state.snapsMuted) return null;
  const objectThreshold = objectSnapThreshold();
  const midpointThreshold = midpointSnapThreshold();
  const nearestThreshold = nearestSegmentSnapThreshold();
  const lineContext = isLineSnapContext();
  const excluded = lineContext ? state.selectedEndpoint?.entityId || state.selectedFigureGrip?.entityId || state.pointer?.grip?.entityId : null;
  const explicit = nearestDraftLineSnap(point, start);
  if (explicit) return explicit;
  const candidates = snapCandidates({ includeCorners: snapEnabled("end"), includeMidpoints: snapEnabled("mid"),
    includeCenters: snapEnabled("center"), excludeId: excluded });
  const candidate = nearestSnapCandidate(point, candidates.filter((item) => item.snapRole !== "mid" || distanceWorld(point, item) < midpointThreshold), objectThreshold);
  if (candidate) return candidate;
  if (includeNearestSegment && snapEnabled("nearest")) {
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
  const typedRadius = readProjectLength(lengthInput);
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
    const degrees = normalizeDegrees(-radToDeg(currentRad));
    return { referenceRad: 0, deltaRad: currentRad, degrees, hasReference: false, cadAngle: true };
  }
  const reference = nearestAngleReference(start, currentRad);
  if (!reference) {
    const referenceRad = nearestCardinalReferenceRad(currentRad);
    const deltaRad = signedAngleDelta(referenceRad, currentRad);
    return {
      referenceRad,
      deltaRad,
      degrees: Math.abs(radToDeg(deltaRad)),
      hasReference: false,
    };
  }
  const deltaRad = signedAngleDelta(reference.angleRad, currentRad);
  return {
    referenceRad: reference.angleRad,
    deltaRad,
    degrees: Math.abs(radToDeg(deltaRad)),
    hasReference: true,
  };
}

function metricEntryValue(number) {
  return Number(number.toFixed(6));
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
  return Math.min(1.4, Math.max(0.005, scale));
}

function snapEnabled(mode) {
  return !state.snapsMuted && state.snaps.has(mode);
}

function visibleGridStep() {
  const multiplier = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((factor) => state.gridStep * factor * state.view.scale >= 6);
  return state.gridStep * (multiplier ?? 500);
}

function snapValueToGrid(value) {
  return Math.round(value / state.gridStep) * state.gridStep;
}

function gridPoint(point) {
  return { x: snapValueToGrid(point.x), y: snapValueToGrid(point.y) };
}

function zoomAtScreen(screen, nextScale) {
  const before = screenToWorld(screen);
  state.view.scale = clampScale(nextScale);
  const after = worldToScreen(before);
  state.view.panX += screen.x - after.x;
  state.view.panY += screen.y - after.y;
}

function panViewport(dx, dy, fine = false) {
  const step = fine ? 4 : 18;
  state.view.panX -= dx * step;
  state.view.panY -= dy * step;
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
  if (entity.dimensionKind === "angular") return angularDimensionBounds(entity);
  if (entity.dimensionKind === "leader") return boundsFromViewportPoints(leaderSelectionGeometry(entity).points);
  if (isPlanAnnotationZone(entity)) return planAnnotationGeometry(entity)?.bounds;
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
  if (entity.type === "area") return `${entity.label || "Площадь"} · ${formatProjectArea(planAnnotationGeometry(entity)?.areaM2, state.measurementSettings)}`;
  if (entity.type === "elevation") return `${entity.label || PLAN_ELEVATION_STYLES[entity.zoneStyle]?.label || "Высота"} · Z ${formatProjectElevation(entity.height, state.measurementSettings)}`;
  if (entity.dimensionKind === "leader") return `Выноска · ${entity.text || "Текст"}`;
  if (entity.type === "line" && entity.layer === "dimensions") {
    if (entity.dimensionKind === "leader") return `Выноска · ${entity.text || "Текст"}`;
    if (entity.dimensionKind === "angular") {
      const angle = angularDimensionGeometry(entity)?.measurement;
      return Number.isFinite(angle) ? `Угловой размер · ${Math.round(angle)}°` : "Угловой размер";
    }
    const length = dimensionDisplayLength(entity);
    return length ? `Размер · ${length}` : "Размер";
  }
  if (entity.type === "text") return `Текст · ${entity.text || "Надпись"}`;
  const name = viewportObjectNames[entity.type] || "Объект";
  if (["line", "wall"].includes(entity.type) && isValidLine(entity)) {
    return `${name} · ${projectLength(Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1))}`;
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
    const layer = drawingLayerInfo(entity.layer || DEFAULT_LINE_LAYER)?.name || entity.layer;
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
    if (!selected || !locateViewportObject(selected.id, selected.label)) cursorToolButton.focus({ preventScroll: true });
  }, { once: true });
  renderPage();
  shell.append(dialog);
  dialog.showModal();
  dialog.querySelector(".viewport-object-close").focus({ preventScroll: true });
}

function fitViewport() {
  syncSelectionActions();
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
  const topPanels = [selectToolMenu, lineUi.lineEditOptions].filter((panel) => !panel.hidden);
  const availableTop = Math.max(38, ...topPanels.map((panel) => panel.getBoundingClientRect().bottom - rect.top)) + 18;
  const railTop = shell.querySelector(".tool-rail").getBoundingClientRect().top - rect.top;
  const availableBottom = Math.min(rect.height, railTop) - 18;
  const fitScale = Math.min(Math.max(1, rect.width - 44) / Math.max(1, bounds.maxX - bounds.minX),
    Math.max(1, availableBottom - availableTop) / Math.max(1, bounds.maxY - bounds.minY));
  const scale = clampScale(fitScale);
  state.view.scale = scale;
  state.view.panX = rect.width / 2 - (bounds.minX + bounds.maxX) / 2 * scale;
  state.view.panY = (availableTop + availableBottom) / 2 - (bounds.minY + bounds.maxY) / 2 * scale;
  viewportActionStatus.textContent = fitScale < scale
    ? "Достигнут минимальный масштаб вида"
    : "Видимые объекты вписаны в холст";
  draw();
}

function viewportIsSelecting() {
  return state.tool === "select" && !state.leaderInput && !state.lineEdit && !state.moveCommand && !state.offsetCommand && !state.selectedEndpoint && !state.selectedFigureGrip && !state.dimensionAttach;
}

function placeAtViewportCenter() {
  if (surveyPointPicker) {
    commitSurveyPoint();
  } else if (state.lineEdit) {
    if (state.lineEdit.pending) applyLineEditPreview();
    else pickLineEditPoint(centerScreen());
  } else if (viewportIsSelecting()) {
    applyTapSelection(pickEntity(centerScreen()));
    draw();
  } else {
    commitCursorPoint();
  }
}

function beginPinchGesture() {
  const pair = activePointerPair();
  if (!pair) return;
  window.clearTimeout(state.pointer?.selectionHoldTimer);
  finishPointerMoveUndo();
  const interruptedSelection = Boolean(state.selectionDrag);
  clearSelectionDrag();
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
  if (interruptedSelection) draw();
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

function snappedPoint(point, type) {
  return { point, snap: { ...point, type } };
}

function resolveArcBendSnap(point, draft) {
  if (!snapEnabled("polar")) return resolveSnapWorld(point);
  const { start, arcEnd: end } = draft;
  const chord = distanceWorld(start, end);
  if (chord < 1) return resolveSnapWorld(point);
  const mid = midpoint(start, end);
  const ux = (end.x - start.x) / chord;
  const uy = (end.y - start.y) / chord;
  const nx = -uy;
  const ny = ux;
  const rawSagitta = (point.x - mid.x) * nx + (point.y - mid.y) * ny;
  const segments = drawableSnapSegments();
  const previous = draft.points?.at(-2);
  if (previous && !draft.bulges.at(-1)) segments.push({ p1: previous, p2: start });

  let connected = false;
  let best = null;
  let nearest = screenUiPx(12) / state.view.scale;
  for (const { p1, p2, arc, entity } of segments) {
    if (arc || entity?.dimensionKind) continue;
    const length = distanceWorld(p1, p2);
    if (length <= linePointEpsilon) continue;
    const dx = (p2.x - p1.x) / length;
    const dy = (p2.y - p1.y) / length;
    const along = dx * ux + dy * uy;
    const across = dx * nx + dy * ny;
    if (Math.abs(across) <= 1e-8) continue;
    for (const anchor of [start, end]) {
      if (projectPointToSegmentWorld(anchor, p1, p2).distance > linePointEpsilon) continue;
      connected = true;
      // Pick the tangent direction toward the opposite end for a minor arc.
      // For a perpendicular tangent, either side of the semicircle is possible.
      const sign = Math.abs(along) <= 1e-8
        ? (Math.sign(rawSagitta * across) || 1)
        : Math.sign(along) * (anchor === start ? 1 : -1);
      const sagitta = chord / 2 * across * sign / (1 + Math.abs(along));
      const error = Math.abs(rawSagitta - sagitta);
      if (error < nearest) {
        nearest = error;
        best = { point: { x: mid.x + nx * sagitta, y: mid.y + ny * sagitta }, anchor, angle: Math.atan2(dy, dx) };
      }
    }
  }

  const fallback = resolveSnapWorld(point, { polarStart: connected ? null : start });
  if (!best || (fallback.snap && !["grid", "tracking", "polar"].includes(fallback.snap.type))) return fallback;
  state.snapTracking.active = null;
  state.polarSnapGuide = { point: best.anchor, angle: best.angle };
  return snappedPoint(best.point, "polar");
}

function resolveSnapWorld(point, { polarStart = state.drawing?.start || state.moveCommand?.base } = {}) {
  const trackingThreshold = objectSnapThreshold();
  state.snapTracking.active = null;
  state.polarSnapGuide = null;
  const objectSnap = nearestObjectSnap(point, { includeNearestSegment: trackingDrawingTools.has(state.tool) });
  if (objectSnap) return { point: { x: objectSnap.x, y: objectSnap.y }, snap: objectSnap };
  if (canSnapToPrePointTrackingGuides() || canUseSnapTracking()) {
    const snap = nearestSnapTrackingPoint(point, trackingThreshold);
    if (snap) {
      state.snapTracking.active = snap;
      return { point: { x: snap.x, y: snap.y }, snap };
    }
  }
  const grid = snapEnabled("grid");
  const fallback = grid ? gridPoint(point) : point;
  if (snapEnabled("polar")) {
    if (polarStart && state.drawing?.phase !== "offset") {
      const polar = snapPolar(fallback, polarStart);
      if (polar.snapped) {
        state.polarSnapGuide = {
          point: polarStart,
          angle: polar.angle,
          degrees: polar.degrees,
        };
        return snappedPoint(polar.point, "polar");
      }
    }
  }
  return grid ? snappedPoint(fallback, "grid") : { point, snap: null };
}

function resolveDimensionPointSnap(point, { start = state.drawing?.start } = {}) {
  state.snapTracking.active = null;
  state.polarSnapGuide = null;
  const threshold = objectSnapThreshold();
  const useIntersection = snapEnabled("intersection");
  const usePerpendicular = start && snapEnabled("perpendicular");
  const useNearest = snapEnabled("nearest");
  const boundaries = (useIntersection || usePerpendicular || useNearest) ? boundarySegments() : [];
  const candidates = [];
  if (useIntersection) candidates.push(...nearbyIntersections(point, boundaries, threshold));
  if (usePerpendicular) candidates.push(...nearbyPerpendiculars(point, start, boundaries, threshold));
  if (snapEnabled("end")) {
    for (const candidate of snapCandidates({ includeCorners: true })) {
      if (distanceWorld(point, candidate) < threshold) candidates.push(candidate);
    }
  }
  if (snapEnabled("mid") || snapEnabled("center")) {
    for (const candidate of snapCandidates({ includeMidpoints: snapEnabled("mid"), includeCenters: snapEnabled("center") })) {
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
  if (!snapEnabled("grid")) return { point, snap: null };
  return snappedPoint(gridPoint(point), "grid");
}

function resolveLineLikeSnap(point, start, { useGrid = true } = {}) {
  state.snapTracking.active = null;
  state.polarSnapGuide = null;

  const ortho = isLineSnapContext() && snapEnabled("ortho");
  const grid = useGrid && snapEnabled("grid");
  const objectSnap = nearestObjectSnap(point, { includeNearestSegment: !ortho, start });
  if (objectSnap) return { point: { x: objectSnap.x, y: objectSnap.y }, snap: objectSnap };
  if (ortho) {
    const constrained = constrainLinePoint(start, point);
    if (!constrained) return { point, snap: null };
    if (grid) {
      for (const axis of ["x", "y"]) {
        const delta = constrained[axis] - start[axis];
        if (!delta) continue;
        const rounded = snapValueToGrid(constrained[axis]);
        if ((rounded - start[axis]) * delta > 0) constrained[axis] = rounded;
      }
    }
    return snappedPoint(constrained, "ortho");
  }
  if (canSnapToTrackingGuides()) {
    const threshold = objectSnapThreshold();
    const tracking = nearestSnapTrackingPoint(point, threshold, start) ?? nearestSnapTrackingPoint(point, threshold);
    if (tracking) {
      state.snapTracking.active = tracking;
      return { point: { x: tracking.x, y: tracking.y }, snap: tracking };
    }
  }

  const fallback = grid ? gridPoint(point) : point;
  if (snapEnabled("polar")) {
    const polar = snapPolar(fallback, start);
    if (polar.snapped) {
      state.polarSnapGuide = {
        point: start,
        angle: polar.angle,
        degrees: polar.degrees,
      };
      return snappedPoint(polar.point, "polar");
    }
  }
  return grid ? snappedPoint(fallback, "grid") : { point, snap: null };
}

function nearestEndpoint(point, threshold) {
  return nearestSnapCandidate(point, snapCandidates({ includeCorners: true }), threshold);
}

function nearestMidpoint(point, threshold) {
  return nearestSnapCandidate(point, snapCandidates({ includeMidpoints: true, includeCenters: true }), threshold);
}

function nearestPointOnDrawableSegment(point, threshold, excludeId = null) {
  let best = null;
  for (const segment of drawableSnapSegments()) {
    if (segment.entity.id === excludeId) continue;
    const hit = segment.arc ? nearestBoundaryPoint(point, [segment.arc], threshold)
      : projectPointToSegmentWorld(point, segment.p1, segment.p2);
    if (!hit) continue;
    const score = hit.distance ?? distanceWorld(hit, point);
    if (score > threshold) continue;
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
  if (!includeCorners && !includeMidpoints && !includeCenters) return [];
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
  if (state.snapsMuted) return null;
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
    statusChip.textContent = state.snapsMuted ? "Включите привязки для выбора опоры" : "Наведите на конец, угол, середину или центр объекта";
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
  statusChip.textContent = `Опора привязана. Размер ${dimensionDisplayLength(entity)}`;
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
  if (ref.pointKey === "edge-fraction" || ref.pointKey === "arc-fraction") return figureReferencePoint(entity, ref);
  if (ref.pointKey === "rectangle-center" && entity.type === "polyline" && entity.closed && entity.points.length === 4) {
    return midpoint(entity.points[0], entity.points[2]);
  }
  return objectPointRefs(entity).find((point) => point.pointKey === ref.pointKey) || null;
}

function objectPointRefs(entity) {
  if (entity.type === "polyline") {
    const refs = entity.points.map((point, index) => ({ ...point, pointKey: `vertex-${index}`, snapRole: "end" }));
    for (const [index, { p1, p2, arc }] of polylineSegments(entity).entries()) {
      refs.push({ ...(arc?.through ?? midpoint(p1, p2)), pointKey: `mid-${index}`, snapRole: "mid" });
      if (arc) refs.push({ ...arc.center, pointKey: `arc-center-${index}`, snapRole: "center" });
    }
    return refs;
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
  const lineButton = tools.find((button) => button.dataset.tool === "line");
  const dimensionButton = tools.find((button) => button.dataset.tool === "dimension");
  const annotationButton = tools.find((button) => button.dataset.tool === "annotation");
  setToolButtonVisual(lineButton, drawToolButtonVisuals.line);
  setToolButtonVisual(dimensionButton, dimensionToolButtonVisuals[state.dimensionTool] || dimensionToolButtonVisuals.aligned);
  setToolButtonVisual(annotationButton, state.tool === "dimension" && state.dimensionTool === "leader" ? annotationToolButtonVisuals.leader : annotationToolButtonVisuals.text);
  if (isPlanAnnotationZone({ type: state.tool }) && annotationButton) {
    annotationButton.querySelector("span").innerHTML = cadIcon(state.tool);
    annotationButton.querySelector("small").textContent = annotationToolButtonVisuals[state.tool].label;
  }
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
  const selecting = viewportIsSelecting();
  frameToolButton.setAttribute("aria-pressed", String(selecting && state.selectTool === "window"));
  tools.forEach((button) => {
    const buttonTool = button.dataset.tool;
    const active =
      buttonTool === "select"
        ? selecting && state.selectTool === "select"
        : buttonTool === "annotation"
          ? state.tool === "text" || Boolean(state.planZone) || (state.tool === "dimension" && state.dimensionTool === "leader")
          : buttonTool === state.tool && (buttonTool !== "dimension" || state.dimensionTool !== "leader");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const figure = state.tool !== "line" && isGroupedDrawTool(state.tool) ? drawToolButtonVisuals[state.tool] : null;
  figureToolButton?.classList.toggle("active", Boolean(figure));
  figureToolButton?.setAttribute("aria-label", figure ? `Фигуры: ${figure.label}` : "Фигуры");
}

function setTool(tool) {
  window.clearTimeout(state.pointer?.selectionHoldTimer);
  state.lastAnnotationTap = null;
  if (lineMetricContext()) closeLineMetricInput();
  if (state.tool === "polyline" && state.drawing) finishLineCommand();
  closeLeaderInput();
  state.directManipulationIds.clear();
  state.tool = tool;
  state.angleSide = null;
  copyToolMenu.hidden = true;
  state.copyPicking = null;
  state.selectedFigureGrip = null;
  state.planZone = isPlanAnnotationZone({ type: tool }) ? { mode: "contour", points: [], lastId: null } : null;
  state.dimensionAttach = null;
  const layer = annotationLayerForTool(tool);
  if (layer && !state.visibleLayers.has(layer)) {
    state.visibleLayers.add(layer);
    markProjectDirty("show-layer");
  }
  if (tool !== "select") {
    state.selectTool = "select";
  }
  state.drawing = null;
  state.moveCommand = null;
  state.offsetCommand = null;
  state.lineEdit = null;
  state.selectionDrag = null;
  syncCommandState();
  if (["line", "polyline", "circle", "arc", "rectangle", "dimension", "text", "area", "elevation"].includes(tool)) {
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
    line: "Линия · первая точка",
    polyline: "Полилиния · первая точка",
    circle: "Круг · укажите центр",
    arc: "Дуга · первая точка",
    rectangle: "Прямоугольник · первый угол",
    text: "Укажите место надписи",
    area: "Площадь · первая точка или готовый контур",
    elevation: "Высота Z · первая точка или готовый контур",
  };
  statusChip.textContent = tool === "select" ? selectionStatusText() : tool === "dimension" ? dimensionToolStatusText() : copy[tool] || "";
  draw();
}

function syncSnapButtons() {
  allSnapsButton.classList.toggle("active", !state.snapsMuted);
  allSnapsButton.setAttribute("aria-pressed", String(!state.snapsMuted));
  allSnapsButton.title = state.snapsMuted ? "Включить все выбранные привязки" : "Приостановить все привязки";
  snaps.forEach((button) => {
    const mode = button.dataset.snap;
    button.classList.toggle("active", state.snaps.has(mode));
    button.disabled = state.snapsMuted;
    button.setAttribute("aria-pressed", String(snapEnabled(mode)));
  });
  const gridButton = snaps.find((button) => button.dataset.snap === "grid");
  gridButton.title = `Привязка к сетке, шаг ${state.gridStep} мм`;
  gridButton.setAttribute("aria-label", gridButton.title);
  const polarButton = snaps.find((button) => button.dataset.snap === "polar");
  polarButton.title = `Полярное отслеживание, шаг ${state.polarStep}°`;
  polarButton.setAttribute("aria-label", polarButton.title);
  if (gridStepSelect.value !== String(state.gridStep)) gridStepSelect.value = String(state.gridStep);
  if (lineUi.linePolarStep.value !== String(state.polarStep)) lineUi.linePolarStep.value = String(state.polarStep);
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
    const active = tool === "leader" ? state.tool === "dimension" && state.dimensionTool === "leader" : state.tool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncSelectToolMenu() {
  let hasCommands = false;
  for (const button of selectionCommandButtons) {
    const available = canApplySelectionAction(button.dataset.action);
    button.disabled = button.hidden = !available;
    if (available) hasCommands = true;
  }
  return hasCommands;
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
  annotationToolButtons.find((button) => button.dataset.annotationTool === annotationPreferences.lastKind)?.focus({ preventScroll: true });
}

function hideAnnotationToolMenu() {
  if (annotationToolMenu) annotationToolMenu.hidden = true;
  tools.find((button) => button.dataset.tool === "annotation")?.setAttribute("aria-expanded", "false");
}

function showSelectToolMenu() {
  if (!editableSelectionEntity() || state.selectionDrag) return;
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  hideSelectModeMenu();
  syncSelectionActions();
}

function hideSelectToolMenu() {
  if (selectToolMenu) selectToolMenu.hidden = true;
  syncToolButtons();
}

function showSelectModeMenu() {
  if (!viewportIsSelecting()) return;
  syncSelectModeMenu();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  hideSelectToolMenu();
  selectModeMenu.hidden = false;
  frameToolButton.setAttribute("aria-expanded", "true");
}

function hideSelectModeMenu() {
  if (selectModeMenu) selectModeMenu.hidden = true;
  frameToolButton.setAttribute("aria-expanded", "false");
}

function syncSelectModeMenu() {
  selectModeMenu?.querySelectorAll("[data-select-mode]").forEach((button) => {
    const mode = button.dataset.selectMode;
    if (mode === "filter") {
      const label = button.querySelector("small");
      const filtered = state.selectionFilter !== "all";
      if (label) label.textContent = filtered ? selectionFilterLabel() : "Фильтр";
      button.setAttribute("aria-label", `Фильтр: ${selectionFilterLabel()}`);
      button.setAttribute("aria-pressed", String(filtered));
      button.classList.toggle("active", filtered);
      return;
    }
    const active = state.selectTool === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function toggleLineTool() {
  if (state.tool === "line") {
    activatePlainSelect();
    return;
  }
  hideDrawToolMenu();
  hideSelectModeMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  hideSelectToolMenu();
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
  if (annotationToolMenu.hidden) showAnnotationToolMenu();
  else {
    hideAnnotationToolMenu();
    syncSelectionActions();
  }
}

function activatePlainSelect() {
  if (state.tool === "polyline" && state.drawing) finishLineCommand();
  state.selectTool = "select";
  state.selectionDrag = null;
  state.openEditMenuAfterPointer = false;
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
  setSelection(null);
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
  resetSnapTracking();
  syncDimensionToolMenu();
  hideDimensionToolMenu();
  setTool("dimension");
  statusChip.textContent = dimensionToolStatusText();
}

function selectAnnotationTool(tool) {
  if (annotationKinds.includes(tool) && annotationPreferences.lastKind !== tool) {
    annotationPreferences.lastKind = tool;
    saveAnnotationSettings();
  }
  state.dimensionSnapHint = null;
  resetSnapTracking();
  hideAnnotationToolMenu();
  if (tool === "leader") {
    state.dimensionTool = "leader";
    setTool("dimension");
    canvas.focus({ preventScroll: true });
    return;
  }
  setTool(tool);
  syncAnnotationToolMenu();
}

function dimensionToolStatusText() {
  if (state.dimensionTool === "leader") return leaderPlacementHint();
  const text = {
    aligned: "Размер по отрезку. 1 из 3: укажите начало",
    linear: "Размер по оси. 1 из 3: укажите первую точку",
    angular: state.angleMode === "select" ? "Угол · выберите первую сторону" : "Угол · укажите вершину",
    chain: "Множественный размер · укажите первую точку",
  };
  return text[state.dimensionTool] || text.aligned;
}

function selectSelectionTool(tool) {
  if (tool === "filter") {
    state.selectionFilter = nextSelectionFilter();
    markProjectDirty("selection-filter");
    syncSelectModeMenu();
    statusChip.textContent = `Фильтр · ${selectionFilterLabel()}`;
    return;
  }
  state.selectTool = tool;
  hideSelectModeMenu();
  setTool("select");
  canvas.focus({ preventScroll: true });
  syncSelectionActions();
}

function nextSelectionFilter() {
  const index = selectionFilters.indexOf(state.selectionFilter);
  return selectionFilters[(index + 1) % selectionFilters.length];
}

function selectionStatusText() {
  return { window: "Рамка · тяните по холсту", lasso: "Лассо · обведите область", multi: "Выбор нескольких объектов" }[state.selectTool] || "Выберите объект";
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

function pushEntity(entity, { select = true } = {}) {
  state.entities.push(entity);
  state.undo.push({ type: "add", entity });
  state.redo.length = 0;
  state.selectedId = select ? entity.id : null;
  state.selectedIds = select ? [entity.id] : [];
  markProjectDirty("add");
}

function createEntityFromDrawing() {
  const { start, end } = state.drawing;
  const id = newLineId(state.tool);
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

function leaderEntity(id, start, end, text, options = {}) {
  const { line: leaderLine, frame: leaderFrame } = leaderAppearance({ leaderStyle: "landing", ...options });
  return {
    id,
    type: "line",
    layer: "text",
    dimensionKind: "leader",
    leaderLine,
    leaderFrame,
    ...(leaderLine === "bent" && isLinePoint(options.leaderElbow) ? { leaderElbow: { ...options.leaderElbow } } : {}),
    textHeight: options.textHeight ?? 200,
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
  const { chainOffset, chainAxis } = state.drawing;
  if (chainOffset != null) return (axis.x * chainAxis.x + axis.y * chainAxis.y < -1e-10 ? -1 : 1) * chainOffset;
  const axisTip = { x: start.x + axis.x * measurement, y: start.y + axis.y * measurement };
  const offset = dimensionOffsetWithAlignmentSnap(start, axisTip, point);
  return Math.abs(offset) < 60 ? (offset < 0 ? -260 : 260) : offset;
}

function commitDimensionSegment(geometry) {
  const draft = state.drawing;
  draft.offset = draftDimensionOffset(geometry, rawCursorWorld());
  pushEntity(createEntityFromDrawing());
  if (state.dimensionTool === "chain") {
    state.drawing = {
      start: draft.end,
      end: draft.end,
      lockedEnd: false,
      phase: "end",
      refStart: draft.refEnd,
      chainOffset: draft.offset,
      chainAxis: geometry.axis,
    };
    statusChip.textContent = "Цепочка · укажите следующую точку или нажмите «Выбор»";
  } else {
    state.drawing = null;
    statusChip.textContent = `Размер ${projectLength(geometry.measurement)} создан`;
  }
  resetSnapTracking();
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
  const draft = state.tool === "line" ? state.drawing : null;
  const input = numericConfirmInput();
  const choosingDirection = !surveyPointPicker && draft && (lineMetricKinds.get(input) === "length" || draft.metricConstraint?.length !== undefined);
  polylineArcMode.hidden = !drawing || Boolean(surveyPointPicker) || Boolean(input);
  polylineArcMode.setAttribute("aria-pressed", String(Boolean(drawing?.arcPhase)));
  linePointAssist.hidden = !choosingDirection && polylineArcMode.hidden;
  cornerMetrics.hidden = inlineEditors.hidden && drawMetrics.hidden && linePointAssist.hidden;
  lineDirection.hidden = !choosingDirection;
  if (choosingDirection && lineDirection.value !== (draft.metricDirection || "")) lineDirection.value = draft.metricDirection || "";
  document.getElementById("undoButton").disabled = !state.undo.length && size < 2 && !drawing?.arcEnd && !state.planZone?.points.length;
  document.getElementById("redoButton").disabled = !state.redo.length || Boolean(state.drawing || edit);
  lineUi.lineEditOptions.hidden = !edit;
  lineUi.lineEditForm.hidden = !lineQuantityModes[edit?.mode];
  lineUi.lineEditRadiusControl.hidden = edit?.mode !== "fillet";
  const mirroring = edit?.mode === "mirror";
  lineUi.lineMirrorModes.hidden = lineUi.lineMirrorControl.hidden = !mirroring;
  lineUi.lineMirrorModes.querySelector('[data-mirror-axis="line"]').setAttribute("aria-pressed", String(Boolean(mirroring && edit.pickMirrorAxis)));
  quickMirrorTool.disabled = !mirroring && !canApplySelectionAction("mirror");
  quickMirrorTool.setAttribute("aria-expanded", String(mirroring));
  const hasBoundaries = boundaryEditModes.has(edit?.mode);
  quickMoveTool.disabled = !canApplySelectionAction("move");
  const copying = state.moveCommand?.mode === "copy";
  if (!viewportIsSelecting() || !selectModeMenu.hidden || !drawToolMenu.hidden || !dimensionToolMenu.hidden || !annotationToolMenu.hidden) copyToolMenu.hidden = true;
  quickCopyTool.disabled = !copying && !viewportIsSelecting();
  quickCopyTool.setAttribute("aria-expanded", String(!copyToolMenu.hidden || Boolean(state.copyPicking) || copying));
  copyControls.hidden = !state.copyPicking && !(copying && ["repeat", "array"].includes(state.moveCommand.copyMode));
  copyCountControl.hidden = !copying || state.moveCommand.copyMode !== "array";
  const repeating = copying && state.moveCommand.copyMode === "repeat";
  copyConfirm.hidden = !state.copyPicking && !repeating;
  copyConfirm.disabled = !repeating && !selectedEntities().length;
  copyConfirm.setAttribute("aria-label", repeating ? "Завершить копирование" : "Подтвердить выбор");
  copyConfirm.title = copyConfirm.getAttribute("aria-label");
  copyClose.hidden = repeating;
  quickRotateTool.disabled = !canApplySelectionAction("rotate");
  quickDeleteTool.disabled = !canApplySelectionAction("delete");
  const quickTargets = quickMoveTool.disabled ? [] : selectedEntities().filter(entity => isLayerVisible(entity.layer));
  const chooseBoundaries = hasBoundaries && edit.boundaryMode === "selected" && !edit.boundaryReady;
  for (const button of quickEditButtons) {
    const mode = button.dataset.quickEdit;
    const active = mode === edit?.mode;
    button.disabled = !active && !quickTargets.some(entity => editableFigure(entity, mode));
    button.setAttribute("aria-pressed", String(active));
  }
  lineUi.lineBoundaryControl.hidden = !hasBoundaries;
  if (hasBoundaries) for (const button of boundaryModeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.boundaryMode === edit.boundaryMode));
  }
  lineUi.lineBreakControl.hidden = edit?.mode !== "break";
  if (edit?.mode === "break") for (const button of breakModeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.breakMode === edit.breakMode));
  }
  const finishing = edit?.applied && !edit.pending && (hasBoundaries || edit.mode === "offset");
  lineUi.lineEditCancel.hidden = Boolean(finishing);
  lineUi.lineEditFinish.hidden = !finishing;
  lineUi.lineEditApply.hidden = !edit?.pending && !chooseBoundaries;
  lineUi.lineEditApply.disabled = Boolean(chooseBoundaries && !edit.boundaryIds.length);
  const label = chooseBoundaries ? "Подтвердить границы" : "Подтвердить правку";
  lineUi.lineEditApply.title = label;
  lineUi.lineEditApply.setAttribute("aria-label", label);
}

function setLineEditHint(text) {
  statusChip.textContent = text;
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
    setSelection(null);
    state.drawing = { points: [point], start: point, end: point, lockedEnd: false };
    if (polyline) {
      state.drawing.layer = revealActiveLineLayer();
      state.drawing.bulges = [];
    }
    hideDrawToolMenu();
    statusChip.textContent = `${drawingToolName(state.tool)}. Укажите следующую точку`;
  } else {
    if (polyline && draft.arcPhase) return commitPolylineArcPoint(draft, point);
    const start = draft.start;
    const length = distanceWorld(start, point);
    if (!isValidLine({ x1: start.x, y1: start.y, x2: point.x, y2: point.y })) {
      statusChip.textContent = "Укажите другую точку";
      draw();
      return false;
    }
    if (polyline) {
      if (canClosePolyline(draft) && distanceWorld(draft.points[0], point) <= linePointEpsilon) {
        return finishLineCommand(true);
      }
      acceptPolylineVertex(draft, point, 0);
      statusChip.textContent = canClosePolyline(draft) && snapEnabled("end")
        ? "Первая вершина замыкает контур · ESC — завершить"
        : "Следующая вершина · ESC — завершить";
    } else {
      state.drawing = null;
      pushEntity(line(newLineId(), start.x, start.y, point.x, point.y, revealActiveLineLayer()), { select: false });
      statusChip.textContent = `Отрезок ${projectLength(length)}. Укажите начало новой линии`;
    }
  }
  if (polyline) markProjectDirty("polyline-vertex");
  resetSnapTracking();
  hideInlineEditors();
  draw();
  return true;
}

function canClosePolyline(draft) {
  const size = draft?.points.length || 0;
  return size >= 3 || (size === 2 && Boolean(draft.arcPhase || draft.bulges[0]));
}

function acceptPolylineVertex(draft, point, bulge) {
  draft.points.push(point);
  draft.bulges.push(bulge);
  draft.start = draft.end = point;
  draft.lockedEnd = false;
  draft.metricConstraint = null;
}

function commitPolylineArcPoint(draft, point) {
  if (draft.arcPhase === "end") {
    if (distanceWorld(draft.start, point) <= linePointEpsilon) {
      statusChip.textContent = "Укажите другой конец дуги";
      return false;
    }
    draft.arcEnd = point;
    draft.arcPhase = "through";
    statusChip.textContent = "Дуга полилинии: укажите изгиб";
    resetSnapTracking();
    draw();
    return true;
  }
  const end = draft.arcEnd;
  const result = polylineArcFromCursor(draft.start, end, point);
  if (!result) {
    statusChip.textContent = "Укажите изгиб в стороне от прямой между концами";
    return false;
  }
  if (canClosePolyline(draft) && distanceWorld(draft.points[0], end) <= linePointEpsilon) {
    return finishLineCommand(true, result.bulge);
  }
  acceptPolylineVertex(draft, end, result.bulge);
  draft.arcEnd = null;
  draft.arcPhase = "end";
  markProjectDirty("polyline-vertex");
  resetSnapTracking();
  statusChip.textContent = "Дуга добавлена. Укажите конец следующей или переключитесь на отрезок";
  draw();
  return true;
}

function togglePolylineArcMode() {
  const draft = state.tool === "polyline" ? state.drawing : null;
  if (!draft) return;
  closeLineMetricInput();
  draft.arcPhase = draft.arcPhase ? null : "end";
  draft.arcEnd = null;
  draft.end = draft.start;
  draft.lockedEnd = false;
  draft.metricConstraint = null;
  resetSnapTracking();
  hideInlineEditors();
  statusChip.textContent = draft.arcPhase ? "Дуга полилинии: укажите её конец" : "Полилиния: укажите следующую вершину отрезка";
  draw();
}

function finishLineCommand(closed = false, closingBulge = 0) {
  const draft = state.drawing;
  if (!draft || !["line", "polyline"].includes(state.tool)) return false;
  if (state.tool === "polyline" && draft.points.length >= 2) {
    const bulges = closed ? [...draft.bulges, closingBulge] : draft.bulges;
    const entity = createPolyline(newLineId("polyline"), draft.points, { closed, bulges, layer: draft.layer });
    if (!entity) {
      statusChip.textContent = "Замыкающий сегмент должен образовать отдельную границу контура";
      return false;
    }
    pushEntity(entity, { select: false });
    statusChip.textContent = closed ? "Полилиния замкнута" : "Полилиния создана";
  } else {
    statusChip.textContent = "Укажите первую точку";
  }
  closeLineMetricInput();
  state.drawing = null;
  if (state.tool === "polyline") markProjectDirty("polyline-finish");
  hideInlineEditors();
  resetSnapTracking();
  draw();
  return true;
}

function undoLineSegment() {
  const draft = state.tool === "polyline" ? state.drawing : null;
  if (draft?.arcEnd) {
    draft.arcEnd = null;
    draft.arcPhase = "end";
    statusChip.textContent = "Конец дуги снят. Укажите новый";
    draw();
    return true;
  }
  if (!draft || draft.points.length < 2) return false;
  draft.points.pop();
  draft.bulges.pop();
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

function lineEditEntity(id, mode) {
  return state.entities.find((entity) => entity.id === id && isLayerVisible(entity.layer) &&
    (mode === "mirror" ? editableFigure(entity, mode) || ["wall", "block"].includes(entity.type) : figureCutActions.has(mode) ? editableFigure(entity, mode) : isDraftLine(entity)));
}

function pickDraftLine(screen, includeFigures = false, candidates = null, mode) {
  let best = null;
  let distance = 18;
  for (const entity of candidates ?? state.entities) {
    if (!(includeFigures ? editableFigure(entity, mode) : isDraftLine(entity)) || !isLayerVisible(entity.layer)) continue;
    const next = distanceToEntityScreen(screen, entity);
    if (next <= distance) {
      best = entity;
      distance = next;
    }
  }
  return best;
}

function startQuickEdit(mode) {
  if (surveyPointPicker || (state.tool === "polyline" && state.drawing && !finishLineCommand())) return;
  const selection = state.tool === "select" ? selectedEntities().filter(entity => isLayerVisible(entity.layer)).map(entity => entity.id) : [];
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  hideSelectModeMenu();
  setTool("select");
  setSelection(selection);
  startLineEdit(mode, null, { quick: true });
  canvas.focus({ preventScroll: true });
}

function startLineEdit(mode, entity, { quick = false } = {}) {
  hideSelectModeMenu();
  state.lineEdit = {
    mode, quick, sourceId: entity?.id, joinIds: [], firstPick: null, amount: null,
    boundaryMode: "auto", breakMode: "gap", boundaryIds: [], boundaryReady: false, pending: null, applied: false,
  };
  if (boundaryEditModes.has(mode)) {
    const hasWalls = state.entities.some((item) => item.type === "wall" && isLayerVisible(item.layer));
    lineUi.lineBoundaryControl.querySelector('[data-boundary-mode="axis"]').hidden = !hasWalls;
  }
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
    state.lineEdit.lengthMode = modes[0][0];
    lineUi.lineLengthModes.replaceChildren(...modes.map(([value, label, icon]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.lengthMode = value;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = cadIcon(icon);
      return button;
    }));
    syncLineQuantityFields();
  }
  lineUi.lineMirrorDelete.checked = false;
  lineUi.lineEditRadiusControl.querySelector("span").textContent = `Радиус, ${projectUnit(state.measurementSettings).label}`;
  const prompts = {
    ...boundaryEditPrompts,
    break: "Наведите крестик на первую точку разрыва",
    join: "Соединить: выберите линии на той же прямой",
    lengthen: "Длина: введите значение и выберите конец на линии",
    fillet: "Скругление: коснитесь сохраняемой стороны первой линии",
    offset: "Смещение: введите расстояние или выберите «Через точку»",
    mirror: "Выберите ось отражения",
    scale: "Масштаб: введите коэффициент и укажите базовую точку",
  };
  setLineEditHint(prompts[mode]);
  draw();
}

function endLineEdit(text) {
  state.lineEdit = null;
  setLineEditHint(text);
  draw();
}


function boundarySegments(excludedId, ids = null) {
  const segments = [];
  const wallAxes = state.lineEdit?.boundaryMode === "axis";
  for (const { p1, p2, entity, arc } of drawableSnapSegments()) {
    if (entity.id === excludedId || (ids && !ids.includes(entity.id))) continue;
    if (arc) {
      segments.push(arc);
      continue;
    }
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
  const mode = state.lineEdit.lengthMode;
  const form = lineUi.lineEditForm;
  const input = lineUi.lineLengthInput;
  const pointOnly = mode === "through" || mode === "dynamic";
  const scale = mode === "factor";
  form.dataset.fields = pointOnly ? "mode" : scale ? "value" : "";
  lineUi.lineLengthModes.hidden = scale;
  for (const button of lineUi.lineLengthModes.children) button.setAttribute("aria-pressed", String(button.dataset.lengthMode === mode));
  input.hidden = pointOnly;
  form.querySelector("button[type=submit]").hidden = pointOnly;
  input.inputMode = mode === "delta" ? "text" : "decimal";
  input.placeholder = scale ? "1,5" : mode === "percent" ? "%" : projectUnit(state.measurementSettings).label;
  input.setAttribute("aria-label", scale ? "Коэффициент масштаба" : mode === "distance" ? "Расстояние смещения" : "Новая длина линии");
}

function submitLineLength() {
  const edit = state.lineEdit;
  if (!lineQuantityModes[edit?.mode]) return;
  const input = lineUi.lineLengthInput;
  const mode = edit.lengthMode;
  const value = input.value.trim();
  const number = parseLineDecimal(value);
  const amount = mode === "factor" || mode === "percent" ? number : fromProjectLength(number, state.measurementSettings);
  if (!Number.isFinite(amount) || Math.abs(amount) > MAX_LINE_COORDINATE || (mode !== "delta" && amount <= 0)) {
    input.setAttribute("aria-invalid", "true");
    setLineEditHint("Введите допустимое числовое значение");
    return;
  }
  edit.amount = amount;
  edit.lengthMode = mode;
  input.removeAttribute("aria-invalid");
  const next = {
    distance: "Наведите крестик на нужную сторону линии",
    factor: "Наведите крестик на базу масштабирования",
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

function lineEditPlacesPoint(edit = state.lineEdit) {
  return Boolean(edit && (["break", "offset", "scale"].includes(edit.mode) || (edit.mode === "mirror" && edit.pickMirrorAxis) ||
    (edit.mode === "lengthen" && edit.lengthMode === "dynamic" && edit.firstPick)));
}

function resolveLineEditPoint(edit, raw) {
  if (edit.mode === "scale" || (edit.mode === "offset" && edit.lengthMode === "through")) {
    return resolveSnapWorld(raw);
  }
  return { point: raw, snap: null };
}

function pickLineEditPoint(screen) {
  const edit = state.lineEdit;
  if (!edit) return;
  if (edit.quick) return applyQuickEdit(edit.mode, screen);
  const source = lineEditEntity(edit.sourceId, edit.mode);
  const repeat = boundaryEditModes.has(edit.mode);
  if (edit.pending) {
    edit.pending = null;
    draw();
  }
  if (!source && !repeat) return endLineEdit("Линия недоступна");
  if (repeat && edit.boundaryMode === "selected" && !edit.boundaryReady) {
    const boundary = pickBoundaryEntity(screen, edit.sourceId);
    if (!boundary) return setLineEditHint("Коснитесь границы на чертеже");
    edit.boundaryIds = edit.boundaryIds.includes(boundary.id)
      ? edit.boundaryIds.filter((id) => id !== boundary.id)
      : [...edit.boundaryIds, boundary.id];
    setSelection([edit.sourceId, ...edit.boundaryIds]);
    setLineEditHint(`Границ: ${edit.boundaryIds.length} · нажмите ✓`);
    draw();
    return;
  }
  const point = lineEditPlacesPoint(edit) ? cursorWorld() : screenToWorld(screen);
  if (edit.mode === "mirror") {
    if (!edit.pickMirrorAxis) return;
    const candidates = state.entities.filter(entity => entity !== source);
    const axis = pickDraftLine(screen, false, candidates) ?? pickDraftLine(centerScreen(), false, candidates);
    if (!axis) return setLineEditHint("Укажите нарисованную прямую линию");
    previewMirror(source, { x: axis.x1, y: axis.y1 }, { x: axis.x2, y: axis.y2 });
    return;
  }
  if (["offset", "scale"].includes(edit.mode)) {
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
  const hit = pickDraftLine(screen, repeat);
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
    const radius = fromProjectLength(radiusInput.valueAsNumber, state.measurementSettings);
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
    const projected = projectFigurePoint(source, point);
    if (!projected) return setLineEditHint("Укажите точку на объекте");
    if (edit.breakMode === "point") {
      if (source.closed || ["circle", "rectangle"].includes(source.type)) {
        return setLineEditHint("Для замкнутого контура выберите разрыв между двумя точками");
      }
      const pieces = splitFigure(source, projected);
      if (!pieces) return setLineEditHint("Укажите точку внутри объекта");
      previewLineEdit([[source, pieces]], "Объект разделён", [], "preserve");
      return;
    }
    if (!edit.firstPick) {
      edit.firstPick = projected;
      setLineEditHint("Наведите крестик на вторую точку зазора");
      draw();
      return;
    }
    if (distanceWorld(edit.firstPick, projected) <= linePointEpsilon) {
      return setLineEditHint("Для зазора укажите две разные точки");
    }
    const pieces = splitFigure(source, edit.firstPick, projected);
    if (!pieces) return setLineEditHint("Укажите две разные точки на объекте");
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
      setLineEditHint("Наведите крестик на новое положение конца");
      draw();
      return;
    }
    if (edit.amount === null) return setLineEditHint("Сначала укажите длину и нажмите галочку");
    const coordinates = lineWithNewLength(hit, point, edit.amount, edit.lengthMode);
    if (!coordinates) return setLineEditHint("Итоговая длина должна быть больше нуля");
    previewLineEdit([[hit, [coordinates]]], "Длина изменена");
    return;
  }
  if (!edit.applied && source && hit !== source) return setLineEditHint("Коснитесь выбранного объекта");
  if (edit.boundaryIds.includes(hit.id)) return setLineEditHint("Выберите линию, которую нужно изменить");
  setSelection(hit.id);
  const result = cutFigureAt(hit, edit.mode, point, edit.boundaryMode === "selected" ? edit.boundaryIds : null);
  if (result.error) return setLineEditHint(result.error);
  previewLineEdit([[hit, result.pieces]], result.message, [], result.association);
}

function cutFigureAt(entity, mode, point, boundaryIds = null) {
  if (!entity) return { error: "Коснитесь объекта на чертеже" };
  if (!editableFigure(entity, mode)) return { error: "У замкнутого контура нет конца для удлинения" };
  const boundaries = boundarySegments(entity.id, boundaryIds);
  if (mode === "trim") {
    const pieces = trimFigure(entity, boundaries, point);
    return pieces ? { pieces, message: "Обрезка выполнена", association: "preserve" } :
      { error: "Нет пересечения для обрезки в этой точке" };
  }
  const piece = extendFigure(entity, boundaries, point);
  return piece ? { pieces: [piece], message: "Удлинение выполнено", association: "follow" } :
    { error: "В направлении выбранного конца нет границы" };
}

function applyQuickEdit(mode, screen) {
  const edit = state.lineEdit;
  const selected = selectedEntities().filter(entity => isLayerVisible(entity.layer));
  const entity = pickDraftLine(screen, true, selected, mode) || pickDraftLine(screen, true);
  const result = cutFigureAt(entity, mode, screenToWorld(screen));
  if (result.error || result.pieces.some(piece => !validFigurePiece(piece))) {
    const error = result.error || "Результат выходит за диапазон координат";
    if (edit?.quick) setLineEditHint(error);
    else statusChip.textContent = error;
    draw();
    return;
  }
  const replaced = commitLineEdit([[entity, result.pieces]], result.message, [], result.association);
  if (edit?.quick) {
    state.lineEdit = edit;
    setSelection(selected.flatMap(item => item.id === entity.id ? replaced : [item.id]));
    draw();
  }
}

function placeLineTransform(edit, source, point) {
  if (edit.mode === "offset") {
    const through = edit.lengthMode === "through";
    if (!through && edit.amount === null) return setLineEditHint("Укажите расстояние и нажмите галочку");
    const coordinates = parallelLine(source, point, through ? null : edit.amount);
    if (!coordinates) return setLineEditHint("Укажите точку вне оси исходной линии");
    previewLineEdit([], "Смещение создано", [{ ...source, ...coordinates, id: newLineId() }]);
    return;
  }
  if (edit.mode === "scale") {
    if (edit.amount === null) return setLineEditHint("Укажите коэффициент и нажмите галочку");
    const coordinates = scaleLine(source, point, edit.amount);
    if (!coordinates) return setLineEditHint("Масштабирование невозможно с этим коэффициентом");
    previewLineEdit([[source, [coordinates]]], "Масштаб линии изменён");
    return;
  }
}

function previewMirror(source, start, end) {
  state.lineEdit.mirrorAxis = { start, end };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const axis = normalizeWorldVector(dx, dy);
  if (!axis) return setLineEditHint("Выберите линию ненулевой длины");
  const reflect = point => {
    const offset = 2 * ((point.x - start.x) * -axis.y + (point.y - start.y) * axis.x);
    return { x: point.x + axis.y * offset, y: point.y - axis.x * offset };
  };
  let geometry;
  if (source.type === "arc") {
    geometry = { type: "arc", ...mapArcPoints(source, reflect) };
  } else if (source.type === "polyline" || (source.type === "rectangle" && dx && dy)) {
    geometry = { type: "polyline", points: (source.points || rectangleCorners(source)).map(reflect),
      closed: source.closed ?? true, bulges: source.bulges?.map(bulge => -bulge) };
  } else if (source.type === "circle") {
    const center = reflect({ x: source.cx, y: source.cy });
    geometry = { type: "circle", cx: center.x, cy: center.y, radius: source.radius };
  } else if (source.type === "block") {
    geometry = { type: "block", ...reflect(source), flipX: !source.flipX,
      rotation: normalizeDegrees(radToDeg(2 * Math.atan2(dy, dx) + Math.PI) - (source.rotation || 0)) };
  } else {
    geometry = mirrorLine(source, start, end);
  }
  if (!geometry) return setLineEditHint("Отражение невозможно");
  if (lineUi.lineMirrorDelete.checked) {
    previewLineEdit([[source, [geometry]]], "Объект отражён");
  } else {
    previewLineEdit([], "Отражённая копия создана", [replaceFigureGeometry(source, geometry, newLineId(geometry.type || source.type))]);
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
  const valid = piece => edit.mode === "mirror" && piece.type === "block" ? isLinePoint(piece)
    : validFigurePiece(piece.type === "wall" && edit.mode === "mirror" ? { ...piece, type: "line" } : piece);
  if (changes.some(([, pieces]) => pieces.some(piece => !valid(piece))) || added.some(entity => !valid(entity))) {
    setLineEditHint("Результат выходит за диапазон координат");
    draw();
    return;
  }
  edit.pending = { replacements, message, added, association };
  setLineEditHint("Проверьте результат и нажмите ✓");
  draw();
}

function applyLineEditPreview() {
  const edit = state.lineEdit;
  if (!edit) return;
  if (boundaryEditModes.has(edit.mode) && edit.boundaryMode === "selected" && !edit.boundaryReady) {
    if (!edit.boundaryIds.length) return;
    edit.boundaryReady = true;
    setSelection(edit.sourceId);
    setLineEditHint(boundaryEditPrompts[edit.mode]);
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
    setLineEditHint("Укажите следующий объект или завершите правку");
    draw();
  }
}

function replaceFigureGeometry(entity, geometry, id) {
  const sameType = !geometry.type || geometry.type === entity.type;
  const piece = { ...(sameType ? entity : { layer: entity.layer }), ...geometry, id };
  if (geometry.type === "polyline" && !geometry.bulges) delete piece.bulges;
  return piece;
}

// Each geometry operation is one undoable edit.
function commitLineEdit(replacements, message, added, association) {
  const replaced = new Map(replacements.map(([entity, pieces]) => [
    entity.id,
    pieces.map((geometry, index) => replaceFigureGeometry(entity, geometry, index === 0 ? entity.id : newLineId(geometry.type || entity.type))),
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
  return selection;
}


function lineReferenceAt(point, pieces, previousRef) {
  if (!point) return null;
  const fromArcCenter = typeof previousRef?.pointKey === "string" && previousRef.pointKey.startsWith("arc-center-");
  if (fromArcCenter) {
    for (const piece of pieces) {
      const center = objectPointRefs(piece).find((candidate) => candidate.snapRole === "center" &&
        (piece.type === "arc" || candidate.pointKey.startsWith("arc-center-")) && distanceWorld(point, candidate) <= linePointEpsilon);
      if (center) return { entityId: piece.id, pointKey: center.pointKey };
    }
    return null;
  }
  for (const piece of pieces) {
    const exact = objectPointRefs(piece).find((p) => distanceWorld(point, p) <= linePointEpsilon);
    if (exact) return { entityId: piece.id, pointKey: exact.pointKey };
    if (piece.type !== "line") {
      const reference = figureReferenceAt(piece, point);
      if (reference) return { entityId: piece.id, ...reference };
      continue;
    }
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
    const rectanglePoint = association === "rotate-rectangle" && typeof ref.pointKey === "string"
      ? ref.pointKey.replace(/^corner-/, "vertex-").replace(/^center$/, "rectangle-center") : null;
    const mapped = rectanglePoint ? { ...ref, pointKey: rectanglePoint }
      : lineReferenceAt(point, association === "join" ? results : pieces, ref);
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
    const { x1, y1, x2, y2 } = pointer.preview;
    drawEditableSegment({ x: x1, y: y1 }, { x: x2, y: y2 }, c, { dashed: true });
  } else if (pointer?.mode === "figure-grip" && pointer.preview) {
    const entity = state.entities.find(item => item.id === pointer.grip.entityId);
    if (entity) {
      const preview = { ...entity, ...pointer.preview, id: "figure-grip-preview" };
      ctx.save();
      ctx.setLineDash([7, 4]);
      drawEntity(preview, { ...c, line: c.accent });
      ctx.restore();
      drawFigureGrips(preview, c, pointer.grip);
    }
  }
  const grip = state.selectedFigureGrip;
  if (grip) {
    const entity = state.entities.find(item => item.id === grip.entityId);
    if (entity) {
      const point = cursorWorld();
      const geometry = reshapeFigure(entity, grip, point);
      const preview = { ...entity, ...geometry, id: "figure-grip-preview" };
      ctx.save();
      ctx.setLineDash([7, 4]);
      drawEntity(preview, { ...c, line: c.accent });
      ctx.restore();
      if (grip.key === "radius" && geometry) drawEndpointHandle(worldToScreen(point), true, c);
      else drawFigureGrips(preview, c, grip);
    }
  }
  const edit = state.lineEdit;
  if (edit?.pending) {
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 4]);
    for (const [source, pieces] of edit.pending.replacements) {
      for (const geometry of pieces) {
        drawEntity(replaceFigureGeometry(source, geometry, "line-edit-preview"), { ...c, line: c.accent });
      }
    }
    for (const entity of edit.pending.added) drawEntity(entity, { ...c, line: c.accent });
    ctx.restore();
  }
  if (edit?.firstPick) drawEndpointHandle(worldToScreen(edit.firstPick), true, c);

  if (edit?.mode !== "break" || edit.pending) return;
  const source = lineEditEntity(edit.sourceId, edit.mode);
  if (!source) return;
  const point = projectFigurePoint(source, rawCursorWorld());
  if (!point || (edit.firstPick && distanceWorld(edit.firstPick, point) <= linePointEpsilon)) return;
  if (edit.breakMode === "point" && !splitFigure(source, point)) return;
  const screen = worldToScreen(point);
  ctx.save();
  ctx.fillStyle = c.accent;
  ctx.strokeStyle = c.bg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function previewFigureGrip(pointer, screen) {
  const entity = state.entities.find(item => item.id === pointer.grip.entityId);
  if (!entity) return;
  const origin = pointer.grip.point;
  const raw = {
    x: origin.x + (screen.x - pointer.startScreen.x) / state.view.scale,
    y: origin.y + (screen.y - pointer.startScreen.y) / state.view.scale,
  };
  const snap = nearestObjectSnap(raw, { includeNearestSegment: true });
  const point = snap ? { x: snap.x, y: snap.y } : snapEnabled("grid") ? gridPoint(raw) : raw;
  pointer.preview = reshapeFigure(entity, pointer.grip, point);
  if (!pointer.preview) statusChip.textContent = "Выберите другую точку для фигуры";
  else if (entity.type === "circle") statusChip.textContent = `Радиус ${projectLength(pointer.preview.radius)}`;
  else statusChip.textContent = "Правка фигуры";
}

function previewAngularGrip(pointer, screen) {
  const before = pointer.before;
  const from = screenToWorld(pointer.startScreen);
  const to = screenToWorld(screen);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const grip = pointer.grip;
  if (grip === "radius") {
    const measure = angularDimensionGeometry(before);
    const art = angularDimensionArtwork(measure, state.annotationScale, before.arcRadius);
    const direction = angleBetweenPoints(before.vertex, from);
    const shift = dx * Math.cos(direction) + dy * Math.sin(direction);
    const radius = Math.min(MAX_LINE_COORDINATE, Math.max(Math.min(1, art.radius), art.radius + shift));
    pointer.preview = Math.abs(radius - art.radius) > linePointEpsilon ? { arcRadius: radius } : null;
    statusChip.textContent = `Радиус размерной дуги ${projectLength(radius)}`;
    return;
  }
  const anchor = before[grip];
  const point = { x: anchor.x + dx, y: anchor.y + dy };
  const resolved = resolveDimensionPointSnap(point, { start: grip === "vertex" ? null : before.vertex });
  const geometry = isLinePoint(resolved.point) ? angularDimensionGeometry({ ...before, [grip]: resolved.point }) : null;
  pointer.preview = geometry ? { [grip]: resolved.point } : null;
  state.dimensionSnapHint = pointer.preview && resolved.snap ? { point: resolved.point, type: "point", label: resolved.snap.label } : null;
  statusChip.textContent = geometry
    ? `Угол ${formatProjectAngle(geometry.measurement, state.measurementSettings)}` : "Точка угла должна отличаться от вершины";
}

function finishAngularGrip(pointer) {
  const entity = state.entities.find((item) => item.id === pointer.targetId);
  if (!entity || !pointer.moved || !pointer.preview) return;
  const after = { ...pointer.before, ...pointer.preview };
  if (!geometryChanged(pointer.before, after)) return;
  applyEntityGeometry(entity, after);
  state.undo.push({ type: "move", entityId: entity.id, before: pointer.before, after });
  state.redo.length = 0;
  statusChip.textContent = pointer.grip === "radius" ? "Размерная дуга перемещена" : "Угловой размер изменён";
}

function finishFigureGrip(pointer) {
  const entity = state.entities.find(item => item.id === pointer.grip.entityId);
  if (!entity) return;
  if (!pointer.moved) {
    state.selectedFigureGrip = pointer.grip;
    hideSelectToolMenu();
    centerViewOnWorldPoint(pointer.grip.point);
    resetSnapTracking();
    statusChip.textContent = "Наведите крестик на новое место точки и тапните";
    return;
  }
  if (!pointer.preview) return;
  const before = entityGeometry(entity);
  const after = entityGeometry({ ...entity, ...pointer.preview });
  if (geometryChanged(before, after)) {
    applyEntityGeometry(entity, after);
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    statusChip.textContent = entity.type === "circle" ? "Радиус круга обновлён" : "Фигура обновлена";
  }
  pointer.preview = null;
  resetSnapTracking();
}

function commitFigureGripPoint(point) {
  const grip = state.selectedFigureGrip;
  const entity = state.entities.find(item => item.id === grip.entityId);
  const preview = entity && reshapeFigure(entity, grip, point);
  if (!preview) {
    statusChip.textContent = "Укажите другую точку для фигуры";
    draw();
    return;
  }
  state.selectedFigureGrip = null;
  finishFigureGrip({ grip, preview, moved: true });
  statusChip.textContent = "Точка установлена";
  draw();
}

function previewLineGrip(pointer, screen) {
  const entity = state.entities.find((item) => item.id === pointer.grip.entityId);
  if (!entity) return;
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  const grip = pointer.grip.point;
  const origin = grip === "middle" ? midpoint(start, end) : grip === "start" ? start : end;
  const candidate = {
    x: origin.x + (screen.x - pointer.startScreen.x) / state.view.scale,
    y: origin.y + (screen.y - pointer.startScreen.y) / state.view.scale,
  };
  if (grip === "middle") {
    const target = isLineSnapContext() && snapEnabled("ortho")
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
  if (pointer.preview && isValidLine(pointer.preview) && geometryChanged(before, pointer.preview)) {
    const after = pointer.preview;
    applyEntityGeometry(entity, after);
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    statusChip.textContent = pointer.grip.point === "middle" ? "Линия перемещена" : "Конец линии обновлён";
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

function commitCursorPoint(screen = centerScreen()) {
  if (state.leaderInput) return;
  if (surveyPointPicker) {
    commitSurveyPoint();
    return;
  }
  if (state.planZone) {
    commitPlanAnnotationPoint();
    return;
  }
  if (state.dimensionAttach) {
    commitDimensionAttach();
    return;
  }
  const resolved = cursorSnapResolved();
  const world = resolved.point;
  if (state.selectedFigureGrip) {
    commitFigureGripPoint(world);
    return;
  }
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
      commitLeaderPoint(world);
      return;
    }
    if (state.dimensionTool === "angular") {
      if (state.angleMode === "select") {
        commitAngleFromSegments(screen);
        return;
      }
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
        statusChip.textContent = `Угловой размер ${formatProjectAngle(geometry.measurement, state.measurementSettings)} создан`;
      }
      draw();
      return;
    }
    if (!state.drawing) {
      resetSnapTracking();
      state.drawing = { start: world, end: world, lockedEnd: false, phase: "end", refStart: dimensionRefFromSnap(resolved.snap) };
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
      if (state.drawing.chainOffset != null) {
        commitDimensionSegment(geometry);
      } else {
        state.drawing.lockedEnd = true;
        state.drawing.phase = "offset";
        statusChip.textContent = `Размер ${projectLength(geometry.measurement)}. Укажите положение размерной линии`;
      }
    } else if (state.drawing.phase === "offset") {
      const { start, end } = state.drawing;
      const geometry = dimensionGeometry(draftDimension(start, end));
      if (!geometry) return;
      commitDimensionSegment(geometry);
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
    statusChip.textContent = command.mode === "rotate" ? "Поворот · укажите исходное направление"
      : command.copyMode === "array" ? "Тираж · укажите шаг до первой копии" : "Укажите вторую точку";
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
    const delta = signedAngleDelta(startAngle, endAngle);
    if (entity.type === "rectangle") {
      const geometry = rotatedRectangleGeometry(entity, command.base, delta);
      if (!validFigurePiece(geometry)) {
        statusChip.textContent = "Координаты после поворота вне диапазона";
        draw();
        return;
      }
      if (Math.abs(delta) > 1e-12) commitLineEdit([[entity, [geometry]]], "Поворот применён", [], "rotate-rectangle");
    } else {
      if (rotateEntityAround(entity, command.base, delta) === false) {
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
    commitCopyPlacement(command, dx, dy);
    return;
  }
  const moved = moveCommandChanges(command, dx, dy);
  if (!moved) {
    statusChip.textContent = "Координаты после перемещения вне диапазона";
    draw();
    return;
  }
  if (moved.length) {
    const action = { type: "move-selection", edits: moved, selection: [...command.entityIds] };
    applyMoveSelection(action, "after");
    state.undo.push(action);
    state.redo.length = 0;
  }
  state.moveCommand = null;
  resetSnapTracking();
  syncCommandState();
  hideInlineEditors();
  statusChip.textContent = !moved.length ? "Положение не изменилось" :
    command.entityIds.size > 1 ? `Перемещено объектов: ${command.entityIds.size}` : "Элемент перемещен";
  draw();
}

function moveCommandChanges(command, dx, dy) {
  const entities = state.entities.filter(entity => command.entityIds.has(entity.id) && isLayerVisible(entity.layer));
  if (entities.length !== command.entityIds.size) return null;
  const edits = [];
  if (Math.hypot(dx, dy) <= linePointEpsilon) return edits;
  for (const entity of entities) {
    const after = translatedEntityGeometry(entity, dx, dy, command.entityIds);
    if (!after) return null;
    const snapshot = entityGeometry(entity);
    const before = Object.fromEntries(Object.keys(after).map(key => [key, entity[key] === undefined ? undefined : snapshot[key]]));
    if (geometryChanged(before, after)) edits.push({ entityId: entity.id, before, after });
  }
  return edits;
}

function applyMoveSelection(action, snapshot) {
  const byId = new Map(state.entities.map(entity => [entity.id, entity]));
  for (const edit of action.edits) {
    const entity = byId.get(edit.entityId);
    if (!entity) continue;
    for (const [key, value] of Object.entries(edit[snapshot])) {
      if (value === undefined) delete entity[key];
      else entity[key] = value;
    }
  }
  updateLinkedDimensions();
  setSelection(action.selection);
  markProjectDirty("move-selection");
  draw();
}

function applyExactInput() {
  const base = state.drawing?.start || selectedEndPoint();
  if (!base) return;
  const length = readProjectLength(lengthInput);
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
    pushEntity(line(id, base.x, base.y, end.x, end.y, revealActiveLineLayer()));
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
  if (!selectModeMenu.hidden) hideSelectModeMenu();
  if (numericConfirmInput()) {
    if (lineMetricContext()) closeLineMetricInput();
    else closeMetricEntry();
  }
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
  state.pointerStartedAt = event.timeStamp;
  const screen = getPointer(event);
  if (state.leaderInput) {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "pan" };
    return;
  }
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
  if (state.selectedFigureGrip) {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "endpoint-place" };
    return;
  }
  if (state.selectTool === "multi" && viewportIsSelecting()) {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "select-only", tapCandidateId: pickEntity(screen) };
    return;
  }
  if (event.ctrlKey && !event.shiftKey && !event.altKey && event.pointerType === "mouse" && event.button === 0 &&
      state.tool === "select" && state.selectTool === "select" && !state.selectedEndpoint && !state.moveCommand && !state.offsetCommand) {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "quick-trim-once" };
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
    const figureGrip = pickSelectedFigureGrip(screen);
    if (figureGrip && !requiresActivation(figureGrip.entityId, state.selectedIds, state.directManipulationIds)) {
      state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false,
        mode: "figure-grip", grip: figureGrip, preview: null };
      return;
    }
    const selectedLineEndpoint = pickSelectedLineEndpoint(screen);
    if (selectedLineEndpoint && !requiresActivation(selectedLineEndpoint.entityId, state.selectedIds, state.directManipulationIds)) {
      const entity = state.entities.find((item) => item.id === selectedLineEndpoint.entityId);
      if (isDraftLine(entity)) {
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
  let dimensionControl = null;
  if (state.tool === "select" && !state.moveCommand && !state.offsetCommand && !["window", "lasso"].includes(state.selectTool)) {
    dimensionControl = hitDimensionControl(screen);
    const controlEntity = dimensionControl?.entity;
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
    startSelectionDrag(state.selectTool === "lasso" ? "lasso" : "window", event.pointerId, screen);
    return;
  }
  if (dimensionControl) {
    const hitEntity = dimensionControl.entity;
    state.selectedId = hitEntity.id;
    state.selectedIds = [hitEntity.id];
    if (hitEntity.dimensionKind === "angular") {
      const grip = dimensionControl.type.slice("angular-".length);
      state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false,
        mode: "angular-grip", grip, targetId: hitEntity.id, before: entityGeometry(hitEntity), preview: null };
      statusChip.textContent = grip === "radius" ? "Тяните дугу, чтобы изменить её радиус" : "Тяните точку измерения угла";
      draw();
      return;
    }
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
      };
      statusChip.textContent = "Потяните надпись или нажмите «Изменить аннотацию»";
      draw();
      return;
    }
    if (dimensionControl.type === "leader-arrow" || dimensionControl.type === "leader-elbow") {
      const elbow = dimensionControl.type === "leader-elbow";
      const grip = leaderScreenGeometry(hitEntity).elbow;
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
      state.pointer.elbow = grip ? screenToWorld(grip) : null;
      statusChip.textContent = elbow ? "Выноска: тяните точку изгиба" : "Выноска: тяните только стрелку";
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
  if (event.pointerType === "touch") scheduleSelectionLongPress(state.pointer);
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
    window.clearTimeout(state.pointer.selectionHoldTimer);
    state.pointer.moved = true;
  }
  if (state.pointer.mode === "select-only") {
    state.pointer.mode = activationGestureMode(state.pointer.moved);
    if (state.pointer.mode === "select-only") return;
    // This gesture belongs to the viewport, even while crossing other objects.
    // Do not activate or move the object when the finger is released.
    state.pointer.tapCandidateId = null;
  }
  if (state.pointer.mode === "line-grip" || state.pointer.mode === "figure-grip") {
    if (state.pointer.moved) {
      if (state.pointer.mode === "figure-grip") previewFigureGrip(state.pointer, screen);
      else previewLineGrip(state.pointer, screen);
      draw();
    }
    return;
  }
  if (state.pointer.mode === "angular-grip") {
    if (state.pointer.moved) {
      previewAngularGrip(state.pointer, screen);
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
      if (entity.type === "block" && snapEnabled("grid")) {
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
  } else if (["leader-move", "leader-arrow", "leader-elbow"].includes(state.pointer.mode) && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity?.dimensionKind === "leader") {
      const currentWorld = screenToWorld(screen);
      const dx = currentWorld.x - state.pointer.world.x;
      const dy = currentWorld.y - state.pointer.world.y;
      const { before, elbow } = state.pointer;
      if (state.pointer.mode === "leader-elbow") {
        const y2 = before.y2 + dy;
        const leaderElbow = { x: elbow.x + dx, y: y2 };
        const candidate = { ...entity, x2: before.x2 + dx, y2, leaderElbow };
        state.pointer.preview = isValidLine(candidate) && validLeaderElbow(candidate, leaderElbow) ? candidate : null;
        statusChip.textContent = "Выноска: перемещение полки и текста";
      } else if (state.pointer.mode === "leader-arrow") {
        const x1 = before.x1 + dx;
        const y1 = before.y1 + dy;
        const leaderElbow = before.leaderElbow ?? (elbow ? { x: elbow.x, y: before.y2 } : undefined);
        const candidate = { ...entity, x1, y1, leaderElbow };
        state.pointer.preview = isValidLine(candidate) && (!leaderElbow || validLeaderElbow(candidate, leaderElbow)) ? candidate : null;
        statusChip.textContent = "Выноска: положение стрелки";
      } else {
        moveEntityBy(entity, dx, dy);
        state.pointer.world = currentWorld;
        statusChip.textContent = "Перемещение выноски";
      }
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
      statusChip.textContent = `Вынос размера ${projectLength(Math.abs(entity.offset))}`;
    }
  } else if ((state.pointer.mode === "dimension-start" || state.pointer.mode === "dimension-end") && state.pointer.targetId) {
    const entity = state.entities.find((item) => item.id === state.pointer.targetId);
    if (entity) {
      const endpoint = state.pointer.mode === "dimension-start" ? "start" : "end";
      moveDimensionHandle(entity, endpoint, screenToWorld(screen));
      const metrics = segmentMetrics(entity.x1, entity.y1, entity.x2, entity.y2);
      statusChip.textContent = `Размер ${dimensionDisplayLength(entity)}`;
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
canvas.addEventListener("contextmenu", (event) => {
  if (event.pointerType === "touch" || event.sourceCapabilities?.firesTouchEvents) event.preventDefault();
});

function finishCanvasPointer(event, canceled = false) {
  const wasPinching = Boolean(state.pinch) || state.activePointers.size > 1 || state.gestureSuppressTap;
  if (state.pointer?.id === event.pointerId) window.clearTimeout(state.pointer.selectionHoldTimer);
  forgetPointer(event);
  releaseCanvasPointer(event);
  if (wasPinching) {
    state.lastAnnotationTap = null;
    endPinchGestureIfNeeded();
    if (state.activePointers.size === 0) {
      state.gestureSuppressTap = false;
    }
    return;
  }
  if (canceled || !state.pointer || state.pointer.id !== event.pointerId) {
    state.lastAnnotationTap = null;
    if (state.activePointers.size === 0) {
      clearSelectionDrag();
      state.gestureSuppressTap = false;
      state.pointer = null;
      state.dimensionSnapHint = null;
      draw();
    }
    return;
  }
  const annotation = annotationForDoubleTap(event, state.pointer);
  if (state.pointer.mode === "survey-point") {
    if (!state.pointer.moved) commitSurveyPoint();
  } else if (state.pointer.mode === "dimension-attach") {
    if (!state.pointer.moved && state.dimensionAttach) commitDimensionAttach();
  } else if (state.pointer?.mode === "select-only") {
    if (!canceled && !state.pointer.moved) {
      const hitId = state.pointer.tapCandidateId;
      applyTapSelection(hitId);
      if (state.selectedIds.includes(hitId)) state.directManipulationIds.add(hitId);
      if (state.selectTool !== "multi") {
        const entity = state.entities.find(item => item.id === hitId);
        if (entity?.dimensionKind === "angular") statusChip.textContent = "Угол выбран. Тяните дугу или точку измерения";
        else statusChip.textContent = canDragEntityDirectly(entity)
          ? "Объект активирован. Теперь его можно перетащить"
          : "Объект выбран. Для перемещения нажмите «Переместить»";
      }
    }
  } else if (state.pointer?.mode === "selection-window" || state.pointer?.mode === "selection-lasso") {
    if (!canceled) {
      if (state.pointer.moved) {
        finishSelectionDrag();
      } else {
        clearSelectionDrag();
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
  } else if (state.pointer.mode === "figure-grip") {
    finishFigureGrip(state.pointer);
  } else if (state.pointer.mode === "angular-grip") {
    finishAngularGrip(state.pointer);
  } else if (state.pointer.mode === "line-edit") {
    if (!state.pointer.moved) pickLineEditPoint(state.pointer.startScreen);
  } else if (state.pointer.mode === "quick-trim-once") {
    if (!state.pointer.moved) applyQuickEdit("trim", state.pointer.startScreen);
  } else if (state.pointer?.mode === "offset-command") {
    if (!canceled && !state.pointer.moved) {
      commitOffsetCommandPoint(rawCursorWorld());
    } else {
      draw();
      forceMoveCursorVisible();
    }
  } else if (state.pointer?.mode === "endpoint-place") {
    if (!canceled && !state.pointer.moved) {
      if (state.selectedFigureGrip) commitFigureGripPoint(cursorWorld());
      else commitSelectedEndpointCursorPoint(state.pointer.before);
    } else {
      draw();
      forceMoveCursorVisible();
    }
  } else if (state.pointer?.mode === "leader-move") {
    finishPointerMoveUndo();
  } else if (state.pointer?.mode === "leader-elbow" || state.pointer?.mode === "leader-arrow") {
    const entity = state.entities.find(item => item.id === state.pointer.targetId);
    if (state.pointer.moved && state.pointer.preview && entity?.dimensionKind === "leader") {
      applyEntityGeometry(entity, entityGeometry(state.pointer.preview));
      finishPointerMoveUndo();
    }
  } else if (state.pointer && !state.pointer.moved && !state.leaderInput) {
    if (state.pointer.mode === "line-endpoint") {
      updateSelectedEndpointEditors();
      statusChip.textContent = "Конец линии выбран. Введите длину или тяните точку";
      draw();
    } else if (state.tool === "select") {
      const hitId = state.pointer.tapCandidateId || state.pointer.targetId || pickEntity(state.pointer.startScreen);
      state.selectedId = hitId;
      state.selectedEndpoint = null;
      applyTapSelection(hitId);
      if (hitId && state.selectedIds.includes(hitId)) state.directManipulationIds.add(hitId);
      draw();
    } else {
      commitCursorPoint(state.pointer.startScreen);
    }
  } else {
    finishPointerMoveUndo();
  }
  state.pointer = null;
  state.dimensionSnapHint = null;
  if (state.openEditMenuAfterPointer) {
    state.openEditMenuAfterPointer = false;
    if (selectedEntities().length) {
      showSelectToolMenu();
    }
  }
  if (state.activePointers.size === 0) {
    state.gestureSuppressTap = false;
  }
  forceMoveCursorVisible();
  drawNow();
  if (annotation) void editPlanAnnotation(annotation);
}

function annotationForDoubleTap(event, pointer) {
  const previous = state.lastAnnotationTap;
  state.lastAnnotationTap = null;
  if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey ||
      pointer.moved || !viewportIsSelecting() || state.selectTool !== "select" ||
      event.timeStamp - state.pointerStartedAt >= LONG_PRESS_SELECT_MS || planAnnotationEditor.open) return null;
  const screen = getPointer(event);
  if (pointDistance(pointer.startScreen, screen) > TAP_MOVE_TOLERANCE) return null;
  const id = pointer.tapCandidateId ?? pointer.targetId;
  const entity = id ? state.entities.find((item) => item.id === id) : null;
  if (!annotationEditKind(entity) || !entityMatchesSelectionFilter(entity)) return null;
  if (previous?.entity === entity && previous.pointerType === event.pointerType &&
      event.timeStamp - previous.time <= DOUBLE_TAP_MS && pointDistance(previous.screen, screen) <= DOUBLE_TAP_DISTANCE) {
    return entity;
  }
  state.lastAnnotationTap = { entity, pointerType: event.pointerType, time: event.timeStamp, screen };
  return null;
}

function finishPointerMoveUndo() {
  const trackedModes = new Set(["move", "line-endpoint", "dimension-offset", "dimension-start", "dimension-end", "leader-move", "leader-arrow", "leader-elbow"]);
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
  state.lastAnnotationTap = null;
  const screen = getPointer(event);
  const zoom = event.deltaY < 0 ? 1.08 : 0.92;
  zoomAtScreen(screen, state.view.scale * zoom);
  draw();
}, { passive: false });

const viewportDirections = { left: [-1, 0], up: [0, -1], down: [0, 1], right: [1, 0] };
const viewportArrowKeys = { ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down", ArrowRight: "right" };

canvas.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const direction = viewportArrowKeys[event.key];
  if (direction) {
    panViewport(...viewportDirections[direction], event.shiftKey);
  } else if (event.key === "+" || event.key === "=") {
    zoomViewport(1.2);
  } else if (event.key === "-") {
    zoomViewport(1 / 1.2);
  } else if (event.key === "Home") {
    fitViewport();
  } else if (event.key === "Enter" && !event.repeat) {
    placeAtViewportCenter();
  } else {
    return;
  }
  state.lastAnnotationTap = null;
  event.preventDefault();
  event.stopPropagation();
});

function translatedDimensionGeometry(entity, dx, dy, movingIds) {
  const original = dimensionWorldGeometry(entity);
  if (!original) return null;
  const shift = ({ x, y }) => ({ x: x + dx, y: y + dy });
  const follows = ref => movingIds?.has(ref?.entityId) || !dimensionLinkedPoint(ref);
  const moveStart = follows(entity.refStart);
  const moveEnd = follows(entity.refEnd);
  const start = moveStart ? shift(original.start) : original.start;
  const end = moveEnd ? shift(original.end) : original.end;
  if (![start, end].every(isLinePoint)) return null;
  const a = shift(original.lineStart);
  const b = shift(original.lineEnd);
  const candidate = { ...entity, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  if (moveStart && moveEnd) {
    Object.assign(candidate, { dimX1: a.x, dimY1: a.y, dimX2: b.x, dimY2: b.y });
  } else {
    adoptDimensionMeasurement(candidate, original);
    const axis = dimensionWorldGeometry(candidate)?.axis;
    if (!axis) return null;
    const target = midpoint(a, b);
    const offset = -(target.x - start.x) * axis.y + (target.y - start.y) * axis.x;
    candidate.offset = offset;
    if (candidate.measurementType) ensureDimensionLineGeometry(candidate);
    else setDimensionLineAlongAxis(candidate, axis, offset);
  }
  const translated = dimensionWorldGeometry(candidate);
  return translated && [translated.lineStart, translated.lineEnd].every(isLinePoint)
    ? entityGeometry(candidate) : null;
}

function validLeaderElbow(entity, elbow) {
  return isLinePoint(elbow) && distanceWorld(elbow, { x: entity.x1, y: entity.y1 }) > linePointEpsilon &&
    distanceWorld(elbow, { x: entity.x2, y: entity.y2 }) > linePointEpsilon;
}

function mapLeaderGeometry(entity, project) {
  const start = project({ x: entity.x1, y: entity.y1 });
  const end = project({ x: entity.x2, y: entity.y2 });
  const geometry = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  if (!isValidLine(geometry)) return null;
  const elbow = leaderElbowPoint(entity);
  if (!elbow) return geometry;
  const leaderElbow = project(elbow);
  return validLeaderElbow(geometry, leaderElbow) ? { ...geometry, leaderElbow } : null;
}

function translatedEntityGeometry(entity, dx, dy, movingIds) {
  if (!entity || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (isPlanAnnotationZone(entity)) {
    return mapPlanZoneGeometry(entity, ({ x, y }) => ({ x: x + dx, y: y + dy }));
  }
  if (entity.dimensionKind === "leader") return mapLeaderGeometry(entity, ({ x, y }) => ({ x: x + dx, y: y + dy }));
  if (entity.type === "polyline") {
    const points = translatePolyline(entity.points, dx, dy);
    return validFigurePiece({ ...entity, points }) ? { points } : null;
  }
  if (isLinearDimension(entity)) return translatedDimensionGeometry(entity, dx, dy, movingIds);
  if (entity.dimensionKind === "angular") {
    const geometry = Object.fromEntries(["vertex", "arm1", "arm2"].map(key => [
      key, { x: entity[key]?.x + dx, y: entity[key]?.y + dy },
    ]));
    return Object.values(geometry).every(isLinePoint) ? geometry : null;
  }
  if (entity.type === "arc" || entity.type === "rectangle") {
    const geometry = translatedFigureGeometry(entity, dx, dy);
    return validFigurePiece({ ...entity, ...geometry }) ? geometry : null;
  }
  if (entity.type === "block" || entity.type === "text") {
    const point = { x: entity.x + dx, y: entity.y + dy };
    return isLinePoint(point) ? point : null;
  }
  if (entity.type === "circle") {
    const cx = entity.cx + dx;
    const cy = entity.cy + dy;
    const radius = Math.abs(entity.radius);
    return radius > 0 && isLinePoint({ x: cx - radius, y: cy - radius }) &&
      isLinePoint({ x: cx + radius, y: cy + radius }) ? { cx, cy } : null;
  }
  const geometry = translatedFigureGeometry(entity, dx, dy);
  return isValidLine(geometry) ? geometry : null;
}

function moveEntityBy(entity, dx, dy) {
  const geometry = translatedEntityGeometry(entity, dx, dy);
  if (!geometry) return false;
  applyEntityGeometry(entity, geometry);
}

function cloneLinearEntity(entity, dx = 260, dy = 260) {
  const id = `${entity.type || "line"}-${Date.now()}`;
  if (entity.type === "text") {
    return { ...entity, id, x: entity.x + dx, y: entity.y + dy };
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

function copyArrayCount(sourceCount) {
  const count = copyCount.valueAsNumber;
  return Number.isInteger(count) && count >= 2 && count <= 50 && count * sourceCount <= maxCopiesPerPlacement ? count : 0;
}

function copyMovingIds(sources) {
  return new Set(sources.flatMap(entity => [entity.id, entity.refStart?.entityId, entity.refEnd?.entityId]));
}

function commitCopyPlacement(command, dx, dy) {
  if (Math.hypot(dx, dy) <= linePointEpsilon) {
    statusChip.textContent = "Укажите точку со смещением от базы";
    return;
  }
  const sources = state.entities.filter(entity => command.entityIds.has(entity.id) && isLayerVisible(entity.layer));
  const count = command.copyMode === "array" ? copyArrayCount(sources.length) : 1;
  if (!count || !sources.length || sources.length * count > maxCopiesPerPlacement) {
    statusChip.textContent = "Укажите от 2 до 50 копий для тиража и не более 1000 объектов за раз";
    return;
  }
  const movingIds = copyMovingIds(sources);
  const copies = [];
  for (let step = 1; step <= count; step += 1) {
    const copiedIds = new Map(sources.map(entity => [entity.id, newLineId(entity.type)]));
    for (const entity of sources) {
      const geometry = translatedEntityGeometry(entity, dx * step, dy * step, movingIds);
      const original = cloneProjectEntity(entity);
      if (!geometry || !original) {
        statusChip.textContent = "Координаты копии вне диапазона";
        return;
      }
      const copy = { ...original, ...geometry, id: copiedIds.get(entity.id) };
      for (const [key, lostKey] of [["refStart", "lostRefStart"], ["refEnd", "lostRefEnd"]]) {
        const ref = copy[key];
        if (!ref) continue;
        if (copiedIds.has(ref.entityId)) copy[key] = { ...ref, entityId: copiedIds.get(ref.entityId) };
        else delete copy[key];
        delete copy[lostKey];
      }
      copies.push(copy);
    }
  }
  const after = copies.map((entity, index) => ({ entity, index: state.entities.length + index }));
  state.entities.push(...copies);
  state.undo.push({ type: "line-edit", before: [], after });
  state.redo.length = 0;
  markProjectDirty("copy");
  if (command.copyMode === "repeat") {
    command.lockedEnd = false;
    resetSnapTracking();
    statusChip.textContent = "Копия размещена · укажите следующую точку или нажмите ✓";
  } else {
    closeCopyTools();
    setSelection(copies.map(entity => entity.id));
    statusChip.textContent = `Создано объектов: ${copies.length}`;
  }
  draw();
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
  if (isPlanAnnotationZone(entity)) {
    const geometry = mapPlanZoneGeometry(entity, (point) => rotatePointAround(point, base, radians));
    if (!geometry) return false;
    applyEntityGeometry(entity, geometry);
    return;
  }
  if (entity.dimensionKind === "leader") {
    const geometry = mapLeaderGeometry(entity, point => rotatePointAround(point, base, radians));
    if (!geometry) return false;
    applyEntityGeometry(entity, geometry);
    return;
  }
  if (entity.type === "polyline") {
    const points = entity.points.map((point) => rotatePointAround(point, base, radians));
    if (!points.every(isLinePoint) || !validPolylinePoints(points, entity.closed, entity.bulges)) return false;
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
  if (entity.type === "arc") {
    const geometry = mapArcPoints(entity, point => rotatePointAround(point, base, radians));
    if (!validFigurePiece({ ...entity, ...geometry })) return false;
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
    includeCorners: snapEnabled("end"), includeMidpoints: snapEnabled("mid"), includeCenters: snapEnabled("center"),
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
  if (!snapEnabled("end")) return null;
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
  if (isPlanAnnotationZone(entity)) {
    return { ...mapPlanZoneGeometry(entity, (point) => ({ ...point })), label: entity.label || "",
      ...(entity.type === "elevation" ? { height: entity.height, zoneStyle: entity.zoneStyle } : {}) };
  }
  if (entity.type === "polyline") return {
    points: entity.points.map(point => ({ ...point })),
    ...(entity.bulges ? { bulges: [...entity.bulges] } : {}),
  };
  if (entity.type === "arc") return mapArcPoints(entity, point => ({ ...point }));
  if (entity.dimensionKind === "angular") {
    return { vertex: { ...entity.vertex }, arm1: { ...entity.arm1 }, arm2: { ...entity.arm2 }, arcRadius: entity.arcRadius };
  }
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
    const { line: leaderLine, frame: leaderFrame } = leaderAppearance(entity);
    const elbow = leaderElbowPoint(entity);
    return { x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2, text: entity.text || "Текст",
      leaderElbow: elbow ? { ...elbow } : null, textHeight: leaderTextHeight(entity), leaderLine, leaderFrame };
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
  if (entity.dimensionKind === "leader" && entity.leaderElbow === null) delete entity.leaderElbow;
  updateLinkedDimensions();
  markProjectDirty("geometry");
}

function geometryChanged(before, after) {
  if (!before || !after) return false;
  return Object.keys(after).some((key) => {
    const next = after[key];
    const previous = before[key];
    if (key === "contours" && Array.isArray(next)) {
      return !Array.isArray(previous) || next.length !== previous.length || next.some((ring, index) =>
        ring.length !== previous[index].length || ring.some((point, vertex) => distanceWorld(point, previous[index][vertex]) > linePointEpsilon));
    }
    if (Array.isArray(next)) {
      return !Array.isArray(previous) || next.length !== previous.length ||
        next.some((value, index) => key === "bulges"
          ? Math.abs(value - previous[index]) > 1e-12
          : distanceWorld(value, previous[index]) > linePointEpsilon);
    }
    if (isLinePoint(next) && isLinePoint(previous)) return distanceWorld(next, previous) > linePointEpsilon;
    if (typeof next !== "number" || typeof previous !== "number") return next !== previous;
    return Math.abs(next - previous) > linePointEpsilon;
  });
}

function pickEntity(screen) {
  // Zone labels are painted over the drawing, in the order they enter this map.
  for (const [id, rect] of [...zoneLabelRects].reverse()) {
    if (screenRectDistance(screen, rect) === 0 && entityMatchesSelectionFilter(state.entities.find((entity) => entity.id === id))) {
      return id;
    }
  }
  let best = null;
  let bestDistance = 18;
  let innerZone = null;
  let smallestArea = Infinity;
  const world = screenToWorld(screen);
  const anchors = planAnnotationAnchors(state.entities.filter((entity) => isPlanAnnotationZone(entity) && isLayerVisible(entity.layer)));
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (!entityMatchesSelectionFilter(entity)) continue;
    if (entity.type === "block") {
      if (pointInsideBlock(screen, entity)) return entity.id;
      continue;
    }
    if (isPlanAnnotationZone(entity)) {
      const geometry = planAnnotationGeometry(entity);
      const ring = geometry?.rings.find((entry) => pointInPolygon(world, entry.points));
      if (ring && ring.areaMm2 < smallestArea) {
        innerZone = entity.id;
        smallestArea = ring.areaMm2;
      }
    }
    const distance = distanceToEntityScreen(screen, entity, anchors.get(entity.id));
    if (distance < bestDistance) {
      best = entity.id;
      bestDistance = distance;
    }
  }
  return best || innerZone;
}

function pickLineEndpoint(screen) {
  let best = null;
  let bestDistance = 18;
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if ((entity.type !== "line" && entity.type !== "wall") || entity.dimensionKind || entity.layer === "dimensions" || !isLayerVisible(entity.layer)) continue;
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

function pickSelectedFigureGrip(screen) {
  const selected = selectedEntities();
  const entity = selected.length === 1 ? selected[0] : null;
  if (!entity || !isLayerVisible(entity.layer)) return null;
  let best = null;
  let nearest = screenUiPx(22);
  for (const grip of figureGripPoints(entity)) {
    if (!isLinePoint(grip.point)) continue;
    const distance = pointDistance(screen, worldToScreen(grip.point));
    if (distance < nearest) {
      best = { ...grip, entityId: entity.id };
      nearest = distance;
    }
  }
  return best;
}

function pickSelectedLineEndpoint(screen) {
  const entity = state.entities.find((item) => item.id === state.selectedId);
  if (!entity || !["line", "wall"].includes(entity.type) || entity.dimensionKind || entity.layer === "dimensions" || !isLayerVisible(entity.layer)) return null;
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

function distanceToEntityScreen(screen, entity, zoneAnchor) {
  if (isPlanAnnotationZone(entity)) {
    const geometry = planAnnotationGeometry(entity);
    if (!geometry) return Infinity;
    const label = zoneLabelRects.get(entity.id);
    let closest = label ? screenRectDistance(screen, label) : pointDistance(screen, worldToScreen(zoneAnchor || geometry.anchor));
    for (const ring of geometry.contours) {
      const points = ring.map(worldToScreen);
      for (const [index, point] of points.entries()) {
        closest = Math.min(closest, pointToSegmentDistance(screen, point, points[(index + 1) % points.length]));
      }
    }
    return closest;
  }
  if (entity.dimensionKind === "leader") {
    const geometry = leaderScreenGeometry(entity);
    return Math.min(screenRectDistance(screen, geometry.rect), distanceToLeaderPath(screen, geometry.path));
  }
  if (entity.type === "text") {
    const origin = worldToScreen({ x: entity.x, y: entity.y });
    const height = Math.abs(entity.height || 260) * state.view.scale;
    const lines = annotationTextLines(entity.text);
    const width = annotationTextWidth(lines, height);
    const bottom = (lines.length - 1) * height * ANNOTATION_LINE_SPACING;
    const radians = -((entity.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = screen.x - origin.x;
    const dy = screen.y - origin.y;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    if (localX >= -8 && localX <= width + 8 && localY >= -height - 8 && localY <= bottom + 8) return 0;
    const clampedX = Math.max(0, Math.min(width, localX));
    const clampedY = Math.max(-height, Math.min(bottom, localY));
    return Math.hypot(localX - clampedX, localY - clampedY);
  }
  if (entity.layer === "dimensions") {
    if (entity.dimensionKind === "angular") {
      const geometry = angularDimensionScreenGeometry(entity);
      if (!geometry) return Infinity;
      return Math.min(angularLabelDistance(screen, geometry), angularArcDistance(screen, geometry),
        pointToSegmentDistance(screen, geometry.grips.vertex, geometry.firstLegEnd),
        pointToSegmentDistance(screen, geometry.grips.vertex, geometry.secondLegEnd));
    }
    const dimensionGeometry = dimensionScreenGeometry(entity);
    const p1 = dimensionGeometry?.a || worldToScreen({ x: entity.x1, y: entity.y1 });
    const p2 = dimensionGeometry?.b || worldToScreen({ x: entity.x2, y: entity.y2 });
    return pointToSegmentDistance(screen, p1, p2);
  }
  if (entity.type === "polyline") {
    let distance = Infinity;
    const world = screenToWorld(screen);
    for (const { p1, p2, arc } of polylineSegments(entity)) {
      if (arc) {
        const foot = projectFigurePoint(arc, world);
        if (foot) distance = Math.min(distance, pointDistance(screen, worldToScreen(foot)));
      } else {
        distance = Math.min(distance, pointToSegmentDistance(screen, worldToScreen(p1), worldToScreen(p2)));
      }
    }
    return distance;
  }
  if (entity.type === "circle") { const center = worldToScreen({ x: entity.cx, y: entity.cy }); return Math.abs(Math.hypot(screen.x - center.x, screen.y - center.y) - Math.abs(entity.radius) * state.view.scale); }
  if (entity.type === "rectangle") { const corners = rectangleCorners(entity).map(worldToScreen); return Math.min(pointToSegmentDistance(screen, corners[0], corners[1]), pointToSegmentDistance(screen, corners[1], corners[2]), pointToSegmentDistance(screen, corners[2], corners[3]), pointToSegmentDistance(screen, corners[3], corners[0])); }
  if (entity.type === "arc") {
    const point = projectFigurePoint(entity, screenToWorld(screen));
    return point ? pointDistance(screen, worldToScreen(point)) : Infinity;
  }
  const p1 = worldToScreen({ x: entity.x1, y: entity.y1 }); const p2 = worldToScreen({ x: entity.x2, y: entity.y2 }); return pointToSegmentDistance(screen, p1, p2);
}
function angleOnArc(angle, startAngle, endAngle, counterClockwise) { const span = counterClockwise ? normalizeAnglePositive(endAngle - startAngle) : normalizeAnglePositive(startAngle - endAngle); const delta = counterClockwise ? normalizeAnglePositive(angle - startAngle) : normalizeAnglePositive(startAngle - angle); return delta <= span + 0.05; }

tools.filter((button) => button !== cursorToolButton).forEach((button) => {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    if (tool === "line") {
      toggleLineTool();
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
    hideDrawToolMenu();
    hideDimensionToolMenu();
    hideAnnotationToolMenu();
    hideSelectToolMenu();
    setTool(tool);
  });
});

cursorToolButton.addEventListener("click", activatePlainSelect);

function openFrameOptions(focusMenu) {
  if (!viewportIsSelecting() || state.circleRadiusEdit) activatePlainSelect();
  snapMore.open = false;
  selectSelectionTool("window");
  showSelectModeMenu();
  if (focusMenu) selectModeMenu.querySelector("button")?.focus({ preventScroll: true });
}

frameToolButton.addEventListener("click", (event) => {
  if (selectModeMenu.hidden) openFrameOptions(event.detail === 0);
  else {
    selectSelectionTool("select");
    frameToolButton.focus({ preventScroll: true });
  }
});
frameToolButton.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  openFrameOptions(true);
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
  syncSelectionActions();
  figureToolButton?.focus({ preventScroll: true });
});

drawToolMenu?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-draw-tool]");
  if (!button) return;
  selectDrawTool(button.dataset.drawTool);
  figureToolButton?.focus({ preventScroll: true });
});

angleModes.addEventListener("click", event => {
  const mode = event.target.closest("[data-angle-mode]")?.dataset.angleMode;
  if (!mode || mode === state.angleMode) return;
  state.angleMode = mode;
  state.angleSide = null;
  state.drawing = null;
  resetSnapTracking();
  for (const button of angleModes.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.angleMode === mode));
  }
  statusChip.textContent = dimensionToolStatusText();
  draw();
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
  const button = event.target.closest("button[data-select-mode], button[data-select-command]");
  if (!button) return;
  if (button.dataset.selectCommand) {
    selectSelectionTool("select");
    if (button.dataset.selectCommand === "objects") openViewportObjects();
    else fitViewport();
  } else {
    selectSelectionTool(button.dataset.selectMode);
  }
});
selectModeMenu?.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  selectSelectionTool("select");
  frameToolButton.focus({ preventScroll: true });
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
  if (geometry) statusChip.textContent = `Размер ${projectLength(geometry.measurement)}. Укажите положение размерной линии`;
  draw();
});

allSnapsButton.addEventListener("click", () => {
  state.snapsMuted = !state.snapsMuted;
  resetSnapTracking();
  state.dimensionSnapHint = null;
  syncSnapButtons();
  statusChip.textContent = state.snapsMuted ? "Все привязки приостановлены" : "Выбранные привязки включены";
  draw();
});

gridStepSelect.addEventListener("change", () => {
  const step = Number(gridStepSelect.value);
  if (!GRID_STEPS.includes(step)) return;
  state.gridStep = step;
  resetSnapTracking();
  syncSnapButtons();
  markProjectDirty("grid-step");
  statusChip.textContent = `Шаг сетки ${step} мм`;
  draw();
});

snapMore.addEventListener("toggle", () => {
  if (snapMore.open) hideSelectModeMenu();
  syncSelectionActions();
});
snapMore.addEventListener("keydown", (event) => {
  if (!snapMore.open || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  snapMore.open = false;
  snapMoreSummary.focus({ preventScroll: true });
});
document.addEventListener("pointerdown", (event) => {
  if (snapMore.open && !snapMore.contains(event.target)) snapMore.open = false;
  if (event.target !== canvas) state.lastAnnotationTap = null;
});

snaps.forEach((button) => {
  button.addEventListener("click", () => {
    if (state.snapsMuted) return;
    const snap = button.dataset.snap;
    if (state.snaps.has(snap)) {
      state.snaps.delete(snap);
    } else {
      if (snap === "ortho") state.snaps.delete("polar");
      if (snap === "polar") state.snaps.delete("ortho");
      state.snaps.add(snap);
    }
    resetSnapTracking();
    state.dimensionSnapHint = null;
    syncSnapButtons();
    markProjectDirty("snaps");
    const names = {
      grid: "Сетка",
      end: "Конец",
      mid: "Середина",
      center: "Центр",
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
projectSearchInput?.addEventListener("blur", () => window.setTimeout(updateViewportLock, 0));
projectTrashButton?.addEventListener("click", () => {
  persistence.showingTrash = !persistence.showingTrash;
  if (projectSearchInput) projectSearchInput.value = "";
  showProjectMessage();
  renderProjectList();
  loadProjects();
});
createBlankProjectButton?.addEventListener("click", async () => {
  const name = await askProjectName("Название нового проекта", "Новый замер");
  if (!name) return;
  createProject({ name, template: "blank" }).catch((error) => {
    console.warn("Create blank project failed", error);
    showProjectMessage(error.message || "Проект не создан", true);
  });
});
projectImportButton?.addEventListener("click", () => projectImportInput?.click());
projectImportInput?.addEventListener("change", () => {
  importProjectFile(projectImportInput.files?.[0]).catch((error) => {
    console.warn("Import project failed", error);
    showProjectMessage(error.message || "Импорт не удался", true);
  });
});
projectList?.addEventListener("click", async (event) => {
  const menu = event.target.closest("button.project-card-menu");
  if (menu) {
    showProjectActions(menu);
    return;
  }
  const button = event.target.closest("button[data-project-action]");
  if (!button || button.getAttribute("aria-busy") === "true") return;
  button.setAttribute("aria-busy", "true");
  try {
    await handleProjectAction(button.dataset.projectAction, button.dataset.projectId);
  } finally {
    button.removeAttribute("aria-busy");
  }
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

linePointAssist.addEventListener("focusout", (event) => {
  if (!linePointAssist.contains(event.relatedTarget) && !lineMetricKinds.has(event.relatedTarget) &&
      event.relatedTarget !== keyboardConfirmButton) {
    clearLineMetricEdit();
    window.setTimeout(updateViewportLock, 0);
    draw();
  }
});

for (const [input, kind] of lineMetricKinds) {
  if (!input) continue;
  const apply = input === topLengthInput || input === topAngleInput ? applyTopMetricValue : applyInlineValue;
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      confirmKeyboardInput();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (lineMetricContext()) cancelLineMetricInput();
      else closeMetricEntry();
      canvas.focus({ preventScroll: true });
      draw();
    }
  });
  input.addEventListener("input", () => {
    syncInlineEditorWidth(input);
    if (lineMetricContext()) updateLineMetricInput(input);
    else {
      modifiedMetricInputs.add(input);
      apply(kind, { recordUndo: false });
    }
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
    if (modifiedMetricInputs.delete(input)) apply(kind, { recordUndo: false });
    commitNumericInputEdit();
  });
}

lineUi.lineEditCancel.addEventListener("click", () => {
  const edit = state.lineEdit;
  if (!edit) return;
  endLineEdit(edit.quick ? "Правка завершена" : "Правка отменена");
  if (!edit.quick) setSelection(lineEditEntity(edit.sourceId, edit.mode)?.id);
});
lineUi.lineEditFinish.addEventListener("click", () => endLineEdit("Правка завершена"));
lineUi.lineEditApply.addEventListener("click", applyLineEditPreview);
lineUi.lineBoundaryControl.addEventListener("click", (event) => {
  const edit = state.lineEdit;
  const mode = event.target.closest("[data-boundary-mode]")?.dataset.boundaryMode;
  if (!boundaryEditModes.has(edit?.mode) || !mode || mode === edit.boundaryMode) return;
  if (edit.quick) {
    const targets = selectedEntities().filter((entity) => isLayerVisible(entity.layer) && editableFigure(entity, edit.mode));
    edit.sourceId = targets.length === 1 ? targets[0].id : null;
  }
  edit.boundaryMode = mode;
  edit.quick = mode === "auto";
  edit.pending = null;
  edit.boundaryIds = [];
  edit.boundaryReady = false;
  edit.applied = false;
  setSelection(lineEditEntity(edit.sourceId, edit.mode)?.id);
  setLineEditHint(mode === "selected" ? "Выберите границы" : boundaryEditPrompts[edit.mode]);
  draw();
});
lineUi.lineBreakControl.addEventListener("click", (event) => {
  const edit = state.lineEdit;
  const mode = event.target.closest("[data-break-mode]")?.dataset.breakMode;
  if (edit?.mode !== "break" || !mode || mode === edit.breakMode) return;
  edit.breakMode = mode;
  edit.pending = null;
  edit.firstPick = null;
  setLineEditHint(mode === "point" ? "Наведите крестик на точку деления" : "Наведите крестик на первую точку зазора");
  draw();
});
lineUi.lineMirrorDelete.addEventListener("change", () => {
  const edit = state.lineEdit;
  if (edit?.mode !== "mirror" || !edit.mirrorAxis) return;
  const source = lineEditEntity(edit.sourceId, edit.mode);
  if (source) previewMirror(source, edit.mirrorAxis.start, edit.mirrorAxis.end);
});
for (const input of [lineUi.lineEditRadius, lineUi.lineLengthInput]) {
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
  if (!POLAR_STEPS.includes(step)) return;
  state.polarStep = step;
  resetSnapTracking();
  syncSnapButtons();
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
lineUi.lineLengthModes.addEventListener("click", (event) => {
  if (!state.lineEdit) return;
  const mode = event.target.closest("[data-length-mode]")?.dataset.lengthMode;
  if (!mode || mode === state.lineEdit.lengthMode) return;
  state.lineEdit.amount = null;
  state.lineEdit.firstPick = null;
  state.lineEdit.pending = null;
  state.lineEdit.lengthMode = mode;
  syncLineQuantityFields();
  if (mode === "through") setLineEditHint("Наведите крестик на точку для параллели");
  else if (mode === "dynamic") setLineEditHint("Коснитесь линии ближе к нужному концу");
  else setLineEditHint("Введите значение и нажмите галочку");
  draw();
});
lineUi.lineEditRadius.addEventListener("keydown", (event) => {
  if (event.key === "Enter") lineUi.lineEditRadius.blur();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.defaultPrevented && !event.target.closest("dialog") &&
      (state.leaderInput || leaderToolActive())) {
    event.preventDefault();
    if (state.leaderInput) finishLeaderInput(false);
    else cancelLeaderPlacement();
    return;
  }
  if (state.dimensionAttach && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    cancelDimensionAttach();
    return;
  }
  if (event.key === "Escape" && !event.target.closest("dialog") &&
      (!copyToolMenu.hidden || state.copyPicking || state.moveCommand?.mode === "copy")) {
    event.preventDefault();
    closeCopyTools();
    statusChip.textContent = selectionStatusText();
    draw();
    return;
  }
  if (state.selectedFigureGrip && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    state.selectedFigureGrip = null;
    resetSnapTracking();
    statusChip.textContent = "Правка точки отменена";
    draw();
    return;
  }
  if (event.target.closest("input, textarea, select, [contenteditable], button, summary")) return;
  if (state.planZone && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    activatePlainSelect();
    return;
  }
  if (state.tool === "dimension" && state.dimensionTool === "chain" && event.key === "Escape") {
    event.preventDefault();
    activatePlainSelect();
    return;
  }
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

selectToolMenu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  applySelectionAction(button.dataset.action);
});
selectToolMenu.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  setSelection(null);
  statusChip.textContent = selectionStatusText();
  cursorToolButton.focus({ preventScroll: true });
  draw();
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
keyboardConfirmButton.addEventListener("blur", (event) => {
  if (!keyboardInputs.includes(event.relatedTarget) && !linePointAssist.contains(event.relatedTarget)) {
    clearLineMetricEdit();
    window.setTimeout(updateViewportLock, 0);
  }
});
bindPointAction(polylineArcMode, togglePolylineArcMode);
bindPointAction(quickMirrorTool, () => {
  if (state.lineEdit?.mode === "mirror") endLineEdit("Отражение отменено");
  else applySelectionAction("mirror");
});
lineUi.lineMirrorModes.addEventListener("click", event => {
  const axis = event.target.closest("[data-mirror-axis]")?.dataset.mirrorAxis;
  const edit = state.lineEdit;
  if (edit?.mode !== "mirror" || !axis) return;
  const source = lineEditEntity(edit.sourceId, edit.mode);
  if (!source) return endLineEdit("Объект недоступен");
  edit.pending = null;
  edit.mirrorAxis = null;
  edit.pickMirrorAxis = axis === "line";
  if (edit.pickMirrorAxis) {
    setLineEditHint("Наведите крестик на линию оси и тапните");
    draw();
    return;
  }
  const bounds = viewportEntityBounds(source);
  if (!bounds) return;
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const end = axis === "vertical" ? { x: center.x, y: center.y + (center.y > 0 ? -1 : 1) } : { x: center.x + (center.x > 0 ? -1 : 1), y: center.y };
  previewMirror(source, center, end);
});
bindPointAction(quickMoveTool, () => applySelectionAction("move"));
function closeCopyTools() {
  if (state.copyPicking) state.selectTool = "select";
  state.copyPicking = null;
  copyToolMenu.hidden = true;
  if (state.moveCommand?.mode === "copy") {
    state.moveCommand = null;
    resetSnapTracking();
    hideInlineEditors();
    syncCommandState();
  }
}

function startCopyPlacement(mode) {
  const selected = selectedEntities().filter(entity => isLayerVisible(entity.layer));
  if (!selected.length) return;
  closeCopyTools();
  startMoveLikeCommand(mode === "single" ? selected.slice(-1) : selected, "copy");
  state.moveCommand.copyMode = mode;
}

bindPointAction(quickCopyTool, () => {
  if (!copyToolMenu.hidden || state.copyPicking || state.moveCommand?.mode === "copy") {
    closeCopyTools();
  } else {
    hideDrawToolMenu();
    hideDimensionToolMenu();
    hideAnnotationToolMenu();
    hideSelectModeMenu();
    hideSelectToolMenu();
    copyToolMenu.hidden = false;
  }
  draw();
});
copyToolMenu.addEventListener("click", event => {
  const mode = event.target.closest("[data-copy-mode]")?.dataset.copyMode;
  if (!mode) return;
  copyToolMenu.hidden = true;
  if (mode === "group" || !selectedEntities().length) {
    state.copyPicking = mode;
    state.selectTool = "multi";
    statusChip.textContent = "Выберите объекты для копирования и нажмите ✓";
    draw();
  } else {
    startCopyPlacement(mode);
  }
});
bindPointAction(copyClose, () => {
  closeCopyTools();
  statusChip.textContent = selectionStatusText();
  draw();
});
bindPointAction(copyConfirm, () => {
  if (state.copyPicking) startCopyPlacement(state.copyPicking);
  else {
    closeCopyTools();
    statusChip.textContent = "Копирование завершено";
    draw();
  }
});
copyCount.addEventListener("input", draw);
bindPointAction(quickRotateTool, () => applySelectionAction("rotate"));
bindPointAction(quickDeleteTool, () => applySelectionAction("delete"));
for (const button of quickEditButtons) {
  bindPointAction(button, () => {
    const mode = button.dataset.quickEdit;
    if (state.lineEdit?.mode !== mode) startQuickEdit(mode);
    else if (state.lineEdit.pending || !state.lineEdit.applied) lineUi.lineEditCancel.click();
    else endLineEdit("Правка завершена");
  });
}

function bindMetricField(input) {
  const field = input.parentElement;
  let press = null;
  let suppressClick = false;
  field.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || document.activeElement === input) return;
    event.preventDefault();
    suppressClick = false;
    press = {
      pointerId: event.pointerId,
      start: getPointer(event),
      panX: state.view.panX,
      panY: state.view.panY,
      bounds: field.getBoundingClientRect(),
    };
    pressedMetricFields.add(field);
    field.setPointerCapture(event.pointerId);
  });
  field.addEventListener("pointermove", (event) => {
    if (press?.pointerId !== event.pointerId) return;
    const point = getPointer(event);
    if (!suppressClick && pointDistance(press.start, point) <= TAP_MOVE_TOLERANCE) return;
    if (!suppressClick) {
      suppressClick = true;
      if (lineMetricContext()) closeLineMetricInput();
      else closeMetricEntry();
    }
    state.view.panX = press.panX + point.x - press.start.x;
    state.view.panY = press.panY + point.y - press.start.y;
    draw();
  });
  field.addEventListener("pointerup", (event) => {
    if (press?.pointerId !== event.pointerId) return;
    const { bounds, start } = press;
    press = null;
    pressedMetricFields.delete(field);
    if (!suppressClick && pointDistance(start, getPointer(event)) <= TAP_MOVE_TOLERANCE &&
        event.clientX >= bounds.left && event.clientX <= bounds.right &&
        event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
      input.focus({ preventScroll: true });
    } else suppressClick = true;
    draw();
  });
  field.addEventListener("lostpointercapture", (event) => {
    if (press?.pointerId !== event.pointerId) return;
    press = null;
    pressedMetricFields.delete(field);
    draw();
  });
  field.addEventListener("click", (event) => {
    if (suppressClick && event.detail > 0) event.preventDefault();
  });
}

keyboardInputs.forEach((input) => {
  bindMetricField(input);
  input.addEventListener("focus", () => {
    if (input === lengthInput && !state.drawing) {
      const circle = selectedCircleForMetrics();
      if (circle && state.circleRadiusEdit?.entityId !== circle.id) {
        state.selectedFigureGrip = null;
        state.circleRadiusEdit = { entityId: circle.id, before: entityGeometry(circle) };
      }
    }
    lastNumericInput = input;
    shell.classList.add("input-focused");
    beginNumericInputEdit(input);
    selectInlineValue(input);
    if (keyboardConfirmButton) keyboardConfirmButton.hidden = false;
    draw();
    window.setTimeout(updateViewportLock, 40);
    window.setTimeout(updateViewportLock, 260);
  });
  input.addEventListener("pointerup", () => selectInlineValue(input));
  input.addEventListener("blur", (event) => {
    shell.classList.remove("input-focused");
    if (!keyboardInputs.includes(event.relatedTarget) && event.relatedTarget !== keyboardConfirmButton &&
        !linePointAssist.contains(event.relatedTarget)) {
      state.circleRadiusEdit = null;
        draw();
    }
    window.setTimeout(updateViewportLock, 80);
  });
});

themeButton.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  shell.dataset.theme = state.theme;
  themeButton.setAttribute("aria-pressed", String(state.theme === "dark"));
  themeButton.firstElementChild.innerHTML = cadIcon(state.theme === "light" ? "moon" : "sun");
      window.ZamerAndroid?.setTheme?.(state.theme);
  draw();
  markProjectDirty("theme");
});

const projectSettingsForm = projectSettingsSheet.querySelector("form");
const projectLengthUnit = projectSettingsSheet.querySelector("#projectLengthUnit");
const projectPrintScale = projectSettingsSheet.querySelector("#projectPrintScale");
const projectPrecisionFields = {
  precision: projectSettingsSheet.querySelector("#projectLengthPrecision"),
  anglePrecision: projectSettingsSheet.querySelector("#projectAnglePrecision"),
  areaPrecision: projectSettingsSheet.querySelector("#projectAreaPrecision"),
};
for (const [name, field] of Object.entries(projectPrecisionFields)) {
  const maximum = name === "anglePrecision" ? 3 : 4;
  for (let digits = 0; digits <= maximum; digits++) field.add(new Option(String(digits), String(digits)));
}

projectSettingsButton.addEventListener("click", () => {
  if (!persistence.projectId || projectSettingsSheet.open) return;
  hideSheet(layersSheet, { restoreFocus: false });
  hideSheet(exportSheet, { restoreFocus: false });
  const settings = state.measurementSettings;
  annotationScaleSelect.value = String(state.annotationScale);
  projectLengthUnit.value = settings.unit;
  projectPrintScale.value = settings.printScale;
  for (const [name, field] of Object.entries(projectPrecisionFields)) field.value = String(settings[name]);
  projectSettingsSheet.showModal();
});
projectSettingsSheet.querySelector("#closeProjectSettings").addEventListener("click", () => projectSettingsSheet.close());
projectSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.measurementSettings = normalizeMeasurementSettings({
    unit: projectLengthUnit.value,
    printScale: projectPrintScale.value,
    ...Object.fromEntries(Object.entries(projectPrecisionFields).map(([name, field]) => [name, field.value])),
  });
  exportScale.value = state.measurementSettings.printScale;
  setAnnotationScale(annotationScaleSelect.value, { save: false });
  markProjectDirty("measurement-settings");
  projectSettingsSheet.close();
  statusChip.textContent = "Настройки проекта применены";
});


document.getElementById("undoButton").addEventListener("click", () => {
  if (undoLineSegment()) return;
  if (state.planZone?.points.length) {
    state.planZone.points.pop();
    statusChip.textContent = "Точка снята. Укажите следующую точку контура";
    draw();
    return;
  }
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
  } else if (action.type === "move-selection") {
    state.redo.push(action);
    applyMoveSelection(action, "before");
  } else if (action.type === "annotation-batch") {
    state.redo.push(action);
    applyAnnotationBatch(action.edits, "before");
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
    updateLinkedDimensions();
    setSelection(action.items.map((item) => item.entity.id));
    markProjectDirty("undo-delete-many");
    draw();
  }
});

document.addEventListener("focusin", (event) => {
  if (!keyboardInputs.includes(event.target)) return;
  shell.classList.add("input-focused");
  if (keyboardConfirmButton) keyboardConfirmButton.hidden = false;
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
  } else if (action.type === "move-selection") {
    state.undo.push(action);
    applyMoveSelection(action, "after");
  } else if (action.type === "annotation-batch") {
    state.undo.push(action);
    applyAnnotationBatch(action.edits, "after");
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
    updateLinkedDimensions();
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
    const value = projectLength(dimensionGeometry(entity)?.measurement);
    const positions = lost.map(([key, name]) => {
      const point = key === "start" ? [entity.x1, entity.y1] : [entity.x2, entity.y2];
      return `${name} X ${projectLength(point[0])}, Y ${projectLength(-point[1])}`;
    });
    return [{ label: `Размер ${value}`, detail: `Потеряна опора. Последние точки · ${positions.join(" · ")}` }];
  });
}

function syncExportOptions() {
  const details = exportDetails();
  const entities = selectedExportGeometry(state.entities, details, state.visibleLayers);
  const layers = new Set(entities.map((entity) => entity.layer || "measure"));
  const vertexCount = exportDraftVertexCount();
  const draftLayer = state.drawing?.layer || DEFAULT_LINE_LAYER;
  const includesDraft = vertexCount >= 2 && (exportScope.value === "all" || state.visibleLayers.has(draftLayer));
  if (includesDraft) layers.add(draftLayer);
  const skipped = state.entities.length + (details.entities?.length || 0) - entities.length;
  const hiddenLayers = new Set([...state.entities, ...details.entities].map((entity) => entity.layer || "measure")
    .filter((layer) => !state.visibleLayers.has(layer)));
  if (vertexCount >= 2 && !state.visibleLayers.has(draftLayer)) hiddenLayers.add(draftLayer);
  const layerNames = (ids) => [...ids].map((id) => drawingLayerInfo(id)?.name || id).join(", ");
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
});

document.getElementById("closeLayersButton").addEventListener("click", () => hideSheet(layersSheet));
addLineLayerButton.addEventListener("click", () => void addLineLayer());
document.getElementById("closeExportButton").addEventListener("click", () => hideSheet(exportSheet));

function renderExportPlan(context, view, entities, scaleFactor, measurementSettings, customLineLayers) {
  const editorContext = ctx;
  const editorView = state.view;
  const editorTheme = state.theme;
  const editorAnnotationScale = state.annotationScale;
  const editorMeasurementSettings = state.measurementSettings;
  const palette = { bg: "#ffffff", wall: "#203245", line: "#203245", dimension: "#183d72", accent: "#183d72", surface: "#ffffff" };
  // Only the synchronous paint uses the print camera. Browser events and
  // attachment decoding run after the editor context has been restored.
  ctx = context;
  state.view = view;
  state.theme = "light";
  state.annotationScale = annotationScaleFactor(scaleFactor);
  state.measurementSettings = measurementSettings;
  printRendering = true;
  try {
    drawPlanScene(entities, palette, customLineLayers);
  } finally {
    printRendering = false;
    state.annotationScale = editorAnnotationScale;
    state.measurementSettings = editorMeasurementSettings;
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
    }, (...args) => renderExportPlan(...args, project.customLineLayers ?? []));
    const dxf = (revit = false) => {
      const includeReadings = exportScope.value === "all" || project.visibleLayers.includes("dimensions");
      const drawing = includeReadings ? entities.concat(surveyDxfLegend(entities, details.records)) : entities;
      if (!drawing.length) throw new Error("На выбранных слоях нет объектов для DXF. Попробуйте выбрать все слои.");
      const options = { annotationScale: project.annotationScale, measurementSettings: project.measurementSettings,
        customLineLayers: project.customLineLayers };
      return revit ? buildRevitDxf(drawing, options) : buildDxf(drawing, options);
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
  const rows = document.createDocumentFragment();
  const layers = [...Object.entries(layerMeta), ...state.customLineLayers.map((layer) => [layer.id, layer])];
  for (const [id, { name, color }] of layers) {
    if ((id === "walls" || id === "furniture") && !state.entities.some((entity) => entity.layer === id)) continue;
    const item = document.createElement("div");
    item.className = "layer-item";
    item.dataset.layer = id;
    const selectable = id === DEFAULT_LINE_LAYER || !Object.hasOwn(layerMeta, id);
    const title = document.createElement(selectable ? "button" : "span");
    title.className = "layer-name";
    if (selectable) {
      title.type = "button";
      title.dataset.lineLayer = id;
      title.addEventListener("click", () => activateLineLayer(id));
    }
    const swatch = document.createElement("i");
    swatch.className = "layer-color";
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    const caption = document.createElement("span");
    caption.textContent = name;
    title.append(swatch, caption);

    const visibility = document.createElement("label");
    visibility.className = "layer-visibility";
    const input = document.createElement("input");
    input.className = "layer-toggle";
    input.type = "checkbox";
    input.setAttribute("aria-label", `Видимость слоя ${name}`);
    input.addEventListener("change", () => setLayerVisibility(id, input.checked));
    visibility.append(input);
    item.append(title, visibility);
    rows.append(item);
  }
  layerList.replaceChildren(rows);
  addLineLayerButton.disabled = state.customLineLayers.length >= MAX_CUSTOM_LINE_LAYERS;
  syncLayerControls();
}

function syncLayerControls() {
  for (const row of layerList.children) {
    const id = row.dataset.layer;
    row.querySelector("input").checked = state.visibleLayers.has(id);
    row.querySelector("button[data-line-layer]")?.setAttribute("aria-pressed", String(state.activeLineLayer === id));
  }
}

function revealActiveLineLayer() {
  const id = state.activeLineLayer;
  state.visibleLayers.add(id);
  return id;
}

function activateLineLayer(id) {
  state.activeLineLayer = id;
  revealActiveLineLayer();
  syncLayerControls();
  markProjectDirty("active-line-layer");
  statusChip.textContent = `Слой «${drawingLayerInfo(id).name}» выбран для линий`;
  draw();
}

function setLayerVisibility(id, visible) {
  if (visible) state.visibleLayers.add(id);
  else {
    state.visibleLayers.delete(id);
    if (state.activeLineLayer === id) {
      const lineLayers = [DEFAULT_LINE_LAYER, ...state.customLineLayers.map((layer) => layer.id)];
      state.activeLineLayer = lineLayers.find((layer) => state.visibleLayers.has(layer)) || DEFAULT_LINE_LAYER;
    }
    const selected = selectedEntities();
    if (selected.some((entity) => !isLayerVisible(entity.layer))) {
      setSelection(selected.filter((entity) => isLayerVisible(entity.layer)).map((entity) => entity.id));
    }
    resetSnapTracking();
    state.dimensionSnapHint = null;
  }
  syncLayerControls();
  markProjectDirty("layers");
  const name = drawingLayerInfo(id).name;
  statusChip.textContent = `Слой «${name}» ${visible ? "виден" : "скрыт"}`;
  draw();
}

async function addLineLayer() {
  if (!persistence.ready || state.customLineLayers.length >= MAX_CUSTOM_LINE_LAYERS) return;
  const identity = projectIdentity();
  const name = await showProjectDialog({
    title: "Новый слой",
    inputLabel: "Название слоя",
    placeholder: "Название слоя",
    confirmText: "Создать",
    maxLength: MAX_LINE_LAYER_NAME_LENGTH,
    validateValue: (value) => {
      if (!normalizeLineLayerName(value)) return "Введите допустимое название слоя";
      const ids = projectDefaultLayers(state, state.customLineLayers);
      if (ids.some((id) => drawingLayerInfo(id).name.toLocaleLowerCase("ru") === value.toLocaleLowerCase("ru"))) {
        return "Слой с таким названием уже есть";
      }
      return null;
    },
  });
  if (!name || !isActiveProject(identity)) return;
  const id = newLineId("line-layer");
  const color = lineLayerColors[state.customLineLayers.length % lineLayerColors.length];
  state.customLineLayers.push({ id, name, color });
  activateLineLayer(id);
  renderLayerList();
  layerList.lastElementChild?.querySelector("button")?.focus();
}

function acceptedSurveyDraft() {
  if (state.tool !== "polyline" || !state.drawing?.points?.length) return undefined;
  const { points, bulges, layer } = state.drawing;
  return { tool: "polyline", points: points.map(({ x, y }) => ({ x, y })),
    ...(bulges.some(Boolean) ? { bulges: [...bulges] } : {}), ...(layer && layer !== DEFAULT_LINE_LAYER ? { layer } : {}) };
}

function restoreAcceptedSurveyDraft(draft) {
  state.tool = "select";
  shell.dataset.tool = "select";
  if (draft?.tool !== "polyline" || !Array.isArray(draft.points) || !draft.points.length ||
      !draft.points.every(isLinePoint) || (draft.points.length > 1 && !validPolylinePoints(draft.points, false, draft.bulges))) return;
  const points = draft.points.map(({ x, y }) => ({ x, y }));
  const start = points.at(-1);
  state.tool = "polyline";
  shell.dataset.tool = "polyline";
  state.drawing = { points, bulges: draft.bulges ? [...draft.bulges] : Array(points.length - 1).fill(0), start, end: start,
    lockedEnd: false, layer: normalizeActiveLineLayer(draft.layer, state.customLineLayers) };
}

function activeSurveyRoom() {
  return state.survey.rooms.find((room) => room.id === state.survey.activeRoomId) || state.survey.rooms[0];
}

function isPlanAnnotationZone(entity) {
  return entity?.type === "area" || entity?.type === "elevation";
}

function annotationLayerForTool(tool) {
  if (tool === "area") return "areas";
  if (tool === "elevation") return "elevations";
  if (tool === "text" || (tool === "dimension" && state.dimensionTool === "leader")) return "text";
  return tool === "dimension" ? "dimensions" : null;
}

function planZoneName(type = state.tool) {
  return type === "area" ? "Площадь" : "Высота Z";
}

function planContourClosesAtCursor(points) {
  return points.length >= 3 && snapEnabled("end") && distanceWorld(rawCursorWorld(), points[0]) * state.view.scale <= screenUiPx(14);
}

function planZoneSnapStart() {
  const zone = state.planZone;
  return zone?.mode === "contour" ? zone.points.at(-1) : null;
}

const planAnnotationActions = document.getElementById("planAnnotationActions");
const planAnnotationModes = document.getElementById("planAnnotationModes");
const planAnnotationModesButtons = [...planAnnotationModes.querySelectorAll("button")];
const planAnnotationCommands = document.getElementById("planAnnotationCommands");
const planAnnotationClose = document.getElementById("planAnnotationClose");
const planAnnotationAddContour = document.getElementById("planAnnotationAddContour");
const planAnnotationEdit = document.getElementById("planAnnotationEdit");
const planAnnotationModeIcons = { contour: "polyline", rectangle: "rectangle", existing: "plan" };
for (const button of planAnnotationModesButtons) button.innerHTML = cadIcon(planAnnotationModeIcons[button.dataset.planMode]);
planAnnotationClose.innerHTML = cadIcon("closeContour");
planAnnotationAddContour.innerHTML = cadIcon("addContour");
planAnnotationEdit.innerHTML = cadIcon("edit");
const planAnnotationEditor = document.getElementById("planAnnotationEditor");
const planAnnotationForm = planAnnotationEditor.querySelector("form");
const planAnnotationSubmit = document.getElementById("planAnnotationSubmit");
const planAnnotationFields = planAnnotationForm.elements;
const planAnnotationError = document.getElementById("planAnnotationError");
const planAnnotationContent = planAnnotationEditor.querySelector(".plan-annotation-content");
const planAnnotationLabelField = document.getElementById("planAnnotationLabelField");
const planAnnotationHeightName = document.getElementById("planAnnotationHeightName");
const annotationChoiceButtons = [...planAnnotationForm.querySelectorAll("[data-annotation-choice]")];
const annotationChoiceCaptions = {
  zoneStyle: document.getElementById("annotationZoneChoice"),
  batchLabelMode: document.getElementById("annotationBatchLabelChoice"),
};
const leaderOptionButtons = [...planAnnotationForm.querySelectorAll("[data-leader-option]")];
const leaderOptions = { leaderLine: null, leaderFrame: null };
const annotationPreferenceKey = "zamer.annotation.preferences.v1";
const annotationKinds = ["text", "leader", "area", "elevation"];
const leaderStyles = ["landing", "plain", "boxed"];
const initialAnnotationPreferences = apkReadJson(annotationPreferenceKey, {});
const preferredLeaderAppearance = leaderAppearance({
  leaderStyle: leaderStyles.includes(initialAnnotationPreferences?.leaderStyle) ? initialAnnotationPreferences.leaderStyle : "landing",
  leaderLine: initialAnnotationPreferences?.leaderLine,
  leaderFrame: initialAnnotationPreferences?.leaderFrame,
});
const annotationPreferences = {
  lastKind: annotationKinds.includes(initialAnnotationPreferences?.lastKind) ? initialAnnotationPreferences.lastKind : "text",
  textHeight: validAnnotationTextHeight(initialAnnotationPreferences?.textHeight) ? initialAnnotationPreferences.textHeight : 260,
  leaderHeight: validAnnotationTextHeight(initialAnnotationPreferences?.leaderHeight) ? initialAnnotationPreferences.leaderHeight : 200,
  leaderLine: preferredLeaderAppearance.line,
  leaderFrame: preferredLeaderAppearance.frame,
  zoneStyle: Object.hasOwn(PLAN_ELEVATION_STYLES, initialAnnotationPreferences?.zoneStyle) ? initialAnnotationPreferences.zoneStyle : "ceiling",
};

for (const button of annotationChoiceButtons) {
  if (button.dataset.annotationChoice !== "zoneStyle") continue;
  const style = PLAN_ELEVATION_STYLES[button.dataset.annotationValue];
  if (!style) continue;
  button.title = style.label;
  button.setAttribute("aria-label", style.label);
  button.style.setProperty("--annotation-choice-color", style.color);
}

function validAnnotationTextHeight(value) {
  return Number.isFinite(value) && value >= 1 && value <= 100000;
}

function saveAnnotationSettings() {
  try {
    localStorage.setItem(annotationPreferenceKey, JSON.stringify(annotationPreferences));
  } catch { /* Defaults still apply in this session. */ }
}

function rememberAnnotationSettings(kinds, values) {
  if (kinds.includes("text") && validAnnotationTextHeight(values.textHeight)) annotationPreferences.textHeight = values.textHeight;
  if (kinds.includes("leader")) {
    if (validAnnotationTextHeight(values.textHeight)) annotationPreferences.leaderHeight = values.textHeight;
    if (values.leaderLine === "straight" || values.leaderLine === "bent") annotationPreferences.leaderLine = values.leaderLine;
    if (typeof values.leaderFrame === "boolean") annotationPreferences.leaderFrame = values.leaderFrame;
  }
  if (kinds.includes("elevation") && Object.hasOwn(PLAN_ELEVATION_STYLES, values.zoneStyle)) annotationPreferences.zoneStyle = values.zoneStyle;
  saveAnnotationSettings();
}

function syncLeaderTools() {
  const active = leaderToolActive() || Boolean(state.leaderInput?.entity);
  leaderUi.tools.hidden = !active;
  if (!active) return;
  const options = leaderToolOptions();
  for (const button of leaderLineButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.leaderLine === options.leaderLine));
    button.disabled = Boolean(state.leaderInput && !state.leaderInput.entity);
  }
  leaderUi.frame.setAttribute("aria-pressed", String(options.leaderFrame));
  leaderUi.toolsCancel.hidden = Boolean(state.leaderInput);
  if (document.activeElement !== leaderUi.height) {
    const value = String(options.textHeight);
    if (leaderUi.height.value !== value) leaderUi.height.value = value;
  }
}

function syncLeaderInputPosition() {
  if (!state.leaderInput) return;
  const entity = state.leaderInput.entity;
  const point = entity ? { x: entity.x2, y: entity.y2 } : state.drawing?.end;
  if (!point) return;
  const anchor = worldToScreen(point);
  const editor = leaderUi.editor;
  const canvasTop = canvas.getBoundingClientRect().top;
  const viewport = window.visualViewport;
  let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  if (androidKeyboardViewport?.visible && androidKeyboardViewport.availableHeight > 0) {
    bottom = Math.min(bottom, androidKeyboardViewport.availableHeight);
  }
  editor.style.setProperty("--leader-editor-x", `${anchor.x + 12}px`);
  editor.style.setProperty("--leader-editor-y", `${anchor.y + 12}px`);
  editor.style.setProperty("--leader-visible-bottom", `${Math.max(0, bottom - canvasTop)}px`);
  const editorHeight = leaderUi.error.textContent ? 100 : 70;
  editor.dataset.compact = String(draftingKeyboardInset > 0 && bottom < leaderUi.tools.getBoundingClientRect().bottom + editorHeight);
}

function updateLeaderOptions(values) {
  if (state.leaderInput?.entity) Object.assign(state.leaderInput.options, values);
  else rememberAnnotationSettings(["leader"], values);
  draw();
}

for (const button of leaderLineButtons) {
  bindPointAction(button, () => {
    const leaderLine = button.dataset.leaderLine;
    if (button.disabled || leaderToolOptions().leaderLine === leaderLine) return;
    updateLeaderOptions({ leaderLine });
    if (leaderToolActive()) {
      if (state.drawing) {
        delete state.drawing.elbow;
        state.drawing.phase = leaderLine === "bent" ? "leader-elbow" : "leader-end";
      }
      resetSnapTracking();
      statusChip.textContent = leaderPlacementHint();
    }
  });
}
bindPointAction(leaderUi.frame, () => updateLeaderOptions({ leaderFrame: !leaderToolOptions().leaderFrame }));
function cancelLeaderPlacement() {
  if (!state.drawing) {
    activatePlainSelect();
    return;
  }
  state.drawing = null;
  resetSnapTracking();
  statusChip.textContent = leaderPlacementHint();
  draw();
}
bindPointAction(leaderUi.toolsCancel, cancelLeaderPlacement);
leaderUi.height.addEventListener("input", () => {
  const textHeight = parseLineDecimal(leaderUi.height.value);
  const valid = validAnnotationTextHeight(textHeight);
  leaderUi.height.toggleAttribute("aria-invalid", !valid);
  if (valid && leaderToolOptions().textHeight !== textHeight) updateLeaderOptions({ textHeight });
});
leaderUi.height.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  (state.leaderInput ? leaderUi.text : canvas).focus({ preventScroll: true });
});
leaderUi.height.addEventListener("blur", () => {
  leaderUi.height.removeAttribute("aria-invalid");
  leaderUi.height.value = String(leaderToolOptions().textHeight);
});
for (const input of [leaderUi.text, leaderUi.height]) {
  input.addEventListener("focus", updateViewportLock);
  input.addEventListener("blur", () => window.setTimeout(updateViewportLock, 0));
}
leaderUi.text.addEventListener("input", () => {
  leaderUi.error.textContent = "";
  leaderUi.text.removeAttribute("aria-invalid");
  draw();
});
leaderUi.text.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  leaderUi.editor.requestSubmit();
});
leaderUi.editor.addEventListener("submit", (event) => {
  event.preventDefault();
  finishLeaderInput(true);
});
for (const button of [leaderUi.apply, leaderUi.cancel]) {
  // Keep the keyboard and button position stable until the tap activates it.
  button.addEventListener("pointerdown", (event) => event.preventDefault());
}
leaderUi.cancel.addEventListener("click", () => finishLeaderInput(false));

function annotationEditKind(entity) {
  if (isPlanAnnotationZone(entity)) return entity.type;
  if (entity?.dimensionKind === "leader") return "leader";
  return entity?.type === "text" ? "text" : null;
}

function editablePlanAnnotations() {
  if (state.tool !== "select" || state.drawing || state.leaderInput || state.moveCommand || state.offsetCommand || state.lineEdit || state.dimensionAttach) return null;
  const entities = selectedEntities();
  if (!entities.length || entities.some((entity) => !isLayerVisible(entity.layer))) return null;
  const kinds = [...new Set(entities.map(annotationEditKind))];
  if (kinds.includes(null)) return null;
  if (kinds.length === 1) return { entities, kind: kinds[0], kinds };
  if (kinds.every((kind) => kind === "text" || kind === "leader") && entities.every((entity) => entity.layer === "text")) {
    return { entities, kind: "text", kinds };
  }
  return null;
}

function syncPlanAnnotationActions() {
  const zone = state.planZone;
  const editing = editablePlanAnnotations();
  const count = zone?.points.length || 0;
  const appendable = zone ? !zone.appendToId && !count && state.entities.some((entity) => entity.id === zone.lastId) : editing?.entities.length === 1 && isPlanAnnotationZone(editing.entities[0]);
  planAnnotationActions.hidden = !zone && !editing;
  planAnnotationModes.hidden = !zone;
  for (const button of planAnnotationModesButtons) {
    const active = button.dataset.planMode === zone?.mode;
    button.setAttribute("aria-pressed", String(active));
    button.disabled = count > 0 && !active;
  }
  planAnnotationClose.hidden = zone?.mode !== "contour" || count < 3;
  planAnnotationAddContour.hidden = !appendable;
  planAnnotationEdit.hidden = !editing;
  planAnnotationCommands.hidden = planAnnotationClose.hidden && planAnnotationAddContour.hidden && planAnnotationEdit.hidden;
  if (editing) {
    const label = editing.entities.length > 1 ? "Изменить выбранные" : "Изменить аннотацию";
    if (planAnnotationEdit.title !== label) {
      planAnnotationEdit.title = label;
      planAnnotationEdit.setAttribute("aria-label", label);
    }
  }
}

function syncPlanAnnotationViewport() {
  if (!planAnnotationEditor.open) return;
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop || 0;
  const layoutHeight = window.innerHeight;
  let bottom = viewport ? viewport.height + top : layoutHeight;
  if (androidKeyboardViewport?.visible && androidKeyboardViewport.availableHeight > 0) {
    bottom = Math.min(bottom, androidKeyboardViewport.availableHeight);
  }
  const keyboard = navigator.virtualKeyboard?.boundingRect;
  if (keyboard?.height > 0 && keyboard.top > top) bottom = Math.min(bottom, keyboard.top);
  bottom = Math.max(top, Math.min(bottom, layoutHeight));
  const input = document.activeElement;
  const editing = planAnnotationContent.contains(input) && input.matches("textarea, input");
  planAnnotationEditor.dataset.keyboard = String(Boolean(androidKeyboardViewport?.visible || keyboard?.height > 0 ||
    (editing && (layoutHeight - bottom > 64 || stableViewportHeight - layoutHeight > 64))));
  planAnnotationEditor.style.setProperty("--annotation-modal-bottom", `${Math.max(0, layoutHeight - bottom)}px`);
  planAnnotationEditor.style.setProperty("--annotation-modal-height", `${Math.max(0, bottom - top)}px`);
  const active = document.activeElement;
  if (!planAnnotationContent.contains(active)) return;
  const visible = planAnnotationContent.getBoundingClientRect();
  const field = active.getBoundingClientRect();
  if (field.top < visible.top) planAnnotationContent.scrollTop -= visible.top - field.top;
  else if (field.bottom > visible.bottom) planAnnotationContent.scrollTop += Math.min(field.bottom - visible.bottom, field.top - visible.top);
}

function setAnnotationChoice(field, value) {
  planAnnotationFields[field].value = value;
  const batch = planAnnotationForm.dataset.batch === "true";
  for (const button of annotationChoiceButtons) {
    if (button.dataset.annotationChoice !== field) continue;
    const selected = button.dataset.annotationValue === value;
    button.hidden = field === "zoneStyle" && !button.dataset.annotationValue && !batch;
    button.setAttribute("aria-pressed", String(selected));
    if (selected) annotationChoiceCaptions[field].textContent = button.title;
  }
  if (field === "batchLabelMode" && batch && planAnnotationForm.dataset.kind === "area") {
    planAnnotationLabelField.hidden = value !== "set";
  }
}

function leaderOptionValue(button) {
  const value = button.dataset.leaderValue;
  if (!value) return null;
  return button.dataset.leaderOption === "leaderFrame" ? value === "true" : value;
}

function syncLeaderOptions(batch) {
  for (const button of leaderOptionButtons) {
    const value = leaderOptionValue(button);
    button.hidden = value === null && !batch;
    button.setAttribute("aria-pressed", String(leaderOptions[button.dataset.leaderOption] === value));
  }
}

function openPlanAnnotationEditor(kind, values = {}, count = 1) {
  if (planAnnotationEditor.open) return Promise.resolve(null);
  const batch = count > 1;
  const zone = kind === "area" || kind === "elevation";
  const text = !zone;
  const leader = kind === "leader";
  const heading = text ? (leader ? "Выноска" : "Текст") : planZoneName(kind);
  planAnnotationForm.reset();
  planAnnotationForm.dataset.kind = kind;
  planAnnotationForm.dataset.batch = String(batch);
  planAnnotationEditor.querySelector("h2").textContent = batch ? `Правка аннотаций (${count})` : heading;
  const submitLabel = batch ? "Применить изменения" : values.id ? "Сохранить аннотацию" : "Поставить аннотацию";
  planAnnotationSubmit.title = submitLabel;
  planAnnotationSubmit.setAttribute("aria-label", submitLabel);
  document.getElementById("planAnnotationTextField").hidden = !text || batch;
  document.getElementById("planAnnotationBatchLabelField").hidden = !batch || kind !== "area";
  planAnnotationLabelField.hidden = !zone || batch;
  document.getElementById("planAnnotationHeightField").hidden = kind !== "elevation";
  document.getElementById("planAnnotationZoneField").hidden = kind !== "elevation";
  document.getElementById("planAnnotationSizeField").hidden = !text;
  document.getElementById("planAnnotationLeaderField").hidden = !leader;
  planAnnotationFields.text.value = batch ? "" : decodeMojibakeText(values.text || "");
  planAnnotationFields.label.value = batch ? "" : values.label || "";
  const settings = state.measurementSettings;
  const lengthLabel = projectUnit(settings).label;
  planAnnotationHeightName.textContent = `Высота Z, ${lengthLabel}`;
  planAnnotationFields.height.placeholder = batch ? "Без изменений" : String(toProjectLength(2800, settings)).replace(".", ",");
  planAnnotationFields.height.value = !batch && kind === "elevation" && Number.isFinite(values.height)
    ? String(toProjectLength(values.height, settings)).replace(".", ",") : "";
  planAnnotationFields.textHeight.placeholder = batch ? "Без изменений" : "";
  const defaultHeight = leader ? (values.id ? 200 : annotationPreferences.leaderHeight) : (values.id ? 260 : annotationPreferences.textHeight);
  const existingHeight = leader && values.id ? leaderTextHeight(values) : values.height;
  planAnnotationFields.textHeight.value = batch ? "" : validAnnotationTextHeight(existingHeight) ? existingHeight : defaultHeight;
  setAnnotationChoice("zoneStyle", batch ? "" : values.zoneStyle || annotationPreferences.zoneStyle);
  setAnnotationChoice("batchLabelMode", "");
  if (leader) {
    const appearance = leaderAppearance(values.id ? values : annotationPreferences);
    leaderOptions.leaderLine = batch ? null : appearance.line;
    leaderOptions.leaderFrame = batch ? null : appearance.frame;
    syncLeaderOptions(batch);
  }
  planAnnotationError.textContent = "";
  planAnnotationEditor.returnValue = "";
  planAnnotationEditor.showModal();
  const first = batch ? planAnnotationEditor.querySelector("h2") :
    text ? planAnnotationFields.text : kind === "elevation" ? planAnnotationFields.height : planAnnotationFields.label;
  first.focus({ preventScroll: true });
  updateViewportLock();
  return new Promise((resolve) => {
    planAnnotationEditor.addEventListener("close", () => {
      const raw = planAnnotationEditor.returnValue;
      updateViewportLock();
      resolve(raw ? JSON.parse(raw) : null);
    }, { once: true });
  });
}

function annotationFormError(message, field) {
  planAnnotationError.textContent = message;
  field.focus({ preventScroll: true });
  syncPlanAnnotationViewport();
}

planAnnotationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (planAnnotationEditor.returnValue) return;
  const { kind, batch: batchMode } = planAnnotationForm.dataset;
  const batch = batchMode === "true";
  const data = {};
  if (kind === "text" || kind === "leader") {
    if (!batch) {
      data.text = planAnnotationFields.text.value.trim();
      if (!data.text) return annotationFormError("Введите текст", planAnnotationFields.text);
    }
    if (!batch || planAnnotationFields.textHeight.value || planAnnotationFields.textHeight.validity.badInput) {
      data.textHeight = Number(planAnnotationFields.textHeight.value);
      if (!validAnnotationTextHeight(data.textHeight)) return annotationFormError("Укажите размер текста от 1 до 100 000 мм", planAnnotationFields.textHeight);
    }
    if (kind === "leader") {
      if (leaderOptions.leaderLine !== null) data.leaderLine = leaderOptions.leaderLine;
      if (leaderOptions.leaderFrame !== null) data.leaderFrame = leaderOptions.leaderFrame;
    }
  } else {
    if (!batch) data.label = planAnnotationFields.label.value.trim();
    else if (kind === "area") {
      if (planAnnotationFields.batchLabelMode.value === "clear") data.label = "";
      if (planAnnotationFields.batchLabelMode.value === "set") {
        data.label = planAnnotationFields.label.value.trim();
        if (!data.label) return annotationFormError("Введите название для выбранных площадей", planAnnotationFields.label);
      }
    }
    if (kind === "elevation") {
      if (!batch || planAnnotationFields.height.value.trim()) {
        const value = parseLineDecimal(planAnnotationFields.height.value);
        const settings = state.measurementSettings;
        data.height = value === null ? null : fromProjectLength(value, settings);
        if (!Number.isFinite(data.height) || Math.abs(data.height) > MAX_LINE_COORDINATE) {
          return annotationFormError(`Введите высоту в ${projectUnit(settings).label}`, planAnnotationFields.height);
        }
      }
      if (planAnnotationFields.zoneStyle.value) data.zoneStyle = planAnnotationFields.zoneStyle.value;
    }
  }
  if (!batch) rememberAnnotationSettings([kind], data);
  planAnnotationEditor.close(JSON.stringify(data));
});

function bindAnnotationHeaderAction(button, action) {
  let fallback = null;
  const clearFallback = () => {
    window.clearTimeout(fallback);
    fallback = null;
  };
  const run = () => {
    clearFallback();
    if (planAnnotationEditor.open) action();
  };
  bindPointAction(button, () => {
    // Keep the modal mounted until the compatibility click has hit its button.
    clearFallback();
    fallback = window.setTimeout(run, 120);
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (event.detail === 0 || fallback !== null) run();
  });
  planAnnotationEditor.addEventListener("close", clearFallback);
}

bindAnnotationHeaderAction(document.getElementById("planAnnotationCancel"), () => planAnnotationEditor.close());
bindAnnotationHeaderAction(planAnnotationSubmit, () => planAnnotationForm.requestSubmit(planAnnotationSubmit));
for (const button of leaderOptionButtons) {
  bindPointAction(button, () => {
    leaderOptions[button.dataset.leaderOption] = leaderOptionValue(button);
    syncLeaderOptions(planAnnotationForm.dataset.batch === "true");
  });
}
for (const button of annotationChoiceButtons) {
  bindPointAction(button, () => {
    setAnnotationChoice(button.dataset.annotationChoice, button.dataset.annotationValue);
    planAnnotationError.textContent = "";
  });
}
navigator.virtualKeyboard?.addEventListener("geometrychange", syncPlanAnnotationViewport);
planAnnotationForm.addEventListener("focusin", updateViewportLock);
planAnnotationForm.addEventListener("focusout", () => window.setTimeout(updateViewportLock, 80));
document.getElementById("planAnnotationSign").addEventListener("click", () => {
  const input = planAnnotationFields.height;
  input.value = input.value.startsWith("-") ? input.value.slice(1) : `-${input.value.replace(/^\+/, "")}`;
  input.focus();
});

function choosePlanContour(world) {
  const ranked = [];
  const visible = state.entities.filter((entity) => isLayerVisible(entity.layer));
  for (const entity of visible) {
    const zoneGeometry = isPlanAnnotationZone(entity) ? planAnnotationGeometry(entity) : null;
    const closed = zoneGeometry?.rings || [planAnnotationGeometry({ type: "area", points: planAnnotationPointsFromEntity(entity) })];
    for (const ring of closed) {
      if (!ring) continue;
      const { points, areaMm2 } = ring;
      const distance = Math.min(...points.map((point, index) => pointToSegmentDistance(world, point, points[(index + 1) % points.length])));
      const edge = distance * state.view.scale <= screenUiPx(12);
      if (edge || pointInPolygon(world, points)) ranked.push({ points, area: areaMm2, edge, distance });
    }
  }
  ranked.sort((a, b) => Number(b.edge) - Number(a.edge) || (a.edge && b.edge ? a.distance - b.distance : a.area - b.area));
  const best = ranked[0];
  if (best?.edge) return best.points;
  const face = planRegionAtPoint(world, visible);
  const region = planAnnotationGeometry({ type: "area", points: face });
  return region && region.areaMm2 < (best?.area ?? Infinity) ? region.points : best?.points;
}

async function finishPlanAnnotation(points = state.planZone?.points) {
  const zone = state.planZone;
  if (!zone || planAnnotationEditor.open) return;
  const type = state.tool;
  const id = newLineId(type);
  const valid = createPlanAnnotation(id, type, points, { height: 0 });
  if (!valid) {
    statusChip.textContent = zone.mode === "rectangle" ? "Укажите противоположный угол прямоугольника" : "Нужен контур без пересечений";
    draw();
    return;
  }
  if (zone.appendToId) {
    const target = state.entities.find((entity) => entity.id === zone.appendToId && entity.type === type);
    const previous = planAnnotationGeometry(target);
    if (!previous) {
      state.planZone = { mode: zone.mode, points: [], lastId: null };
      statusChip.textContent = "Аннотация больше недоступна";
      draw();
      return;
    }
    const combined = createPlanAnnotation(target.id, type, target.points, { ...target, contours: [...previous.contours, valid.points] });
    if (!combined) {
      statusChip.textContent = "Контуры одной аннотации должны быть раздельными";
      draw();
      return;
    }
    state.planZone = { mode: zone.mode, points: [], lastId: target.id, zoneStyle: target.zoneStyle };
    applyPlanAnnotationEdit(target, combined);
    const geometry = planAnnotationGeometry(target);
    statusChip.textContent = type === "area" ? `Общая площадь ${formatProjectArea(geometry.areaM2, state.measurementSettings)}` : `Контур добавлен · Z ${formatProjectElevation(target.height, state.measurementSettings)}`;
    canvas.focus({ preventScroll: true });
    draw();
    return;
  }
  const projectId = persistence.projectId;
  const values = type === "elevation" ? await openPlanAnnotationEditor("elevation", { zoneStyle: zone.zoneStyle }) : {};
  if (!values || state.planZone !== zone || persistence.projectId !== projectId) return;
  const entity = createPlanAnnotation(id, type, valid.points, values);
  if (!entity) {
    statusChip.textContent = "Не удалось поставить аннотацию. Проверьте введённую высоту";
    return;
  }
  pushEntity(entity);
  state.planZone = { mode: zone.mode, points: [], lastId: entity.id, zoneStyle: values.zoneStyle };
  statusChip.textContent = type === "area" ? `Площадь ${formatProjectArea(planAnnotationGeometry(entity).areaM2, state.measurementSettings)} на плане` : `Высота ${formatProjectElevation(entity.height, state.measurementSettings)} на плане. Можно добавить ещё зону`;
  canvas.focus({ preventScroll: true });
  draw();
}

function commitPlanAnnotationPoint() {
  const zone = state.planZone;
  hideAnnotationToolMenu();
  if (zone.mode === "existing") {
    const points = choosePlanContour(rawCursorWorld());
    if (points) void finishPlanAnnotation(points);
    else statusChip.textContent = "Под крестиком нет замкнутой области";
    return;
  }
  if (zone.mode === "contour" && planContourClosesAtCursor(zone.points)) {
    void finishPlanAnnotation();
    return;
  }
  const point = cursorWorld();
  if (zone.mode === "rectangle" && zone.points.length) {
    const [corner] = zone.points;
    void finishPlanAnnotation(rectangleCorners({ x1: corner.x, y1: corner.y, x2: point.x, y2: point.y }));
    return;
  }
  if (!isLinePoint(point) || zone.points.some((vertex) => distanceWorld(vertex, point) <= linePointEpsilon)) {
    statusChip.textContent = "Наводите курсор на новую точку контура";
    return;
  }
  if (zone.points.length >= MAX_PLAN_ANNOTATION_POINTS) {
    statusChip.textContent = "Достигнут предел вершин. Замкните контур";
    return;
  }
  zone.points.push(point);
  statusChip.textContent = zone.mode === "rectangle" ? "Укажите противоположный угол" :
    zone.points.length >= 3 ? "Следующая точка или «Замкнуть контур»" : "Укажите следующую точку";
  draw();
}

function planAnnotationModeHint(mode) {
  if (mode === "existing") return "Наведите крестик внутрь замкнутой области";
  if (mode === "rectangle") return "Укажите первый угол";
  return "Укажите первую точку контура";
}

for (const button of planAnnotationModesButtons) {
  bindPointAction(button, () => {
    const zone = state.planZone;
    if (!zone || zone.points.length) return;
    zone.mode = button.dataset.planMode;
    resetSnapTracking();
    statusChip.textContent = planAnnotationModeHint(zone.mode);
    draw();
  });
}
bindPointAction(planAnnotationClose, () => void finishPlanAnnotation());
bindPointAction(planAnnotationAddContour, () => {
  const zone = state.planZone;
  const selected = editablePlanAnnotations()?.entities;
  const target = zone ? state.entities.find((entity) => entity.id === zone.lastId) : selected?.length === 1 ? selected[0] : null;
  if (!isPlanAnnotationZone(target)) return;
  if (!zone) setTool(target.type);
  state.planZone.appendToId = target.id;
  state.planZone.lastId = target.id;
  statusChip.textContent = `Новый контур · ${planAnnotationModeHint(state.planZone.mode)}`;
  draw();
});
bindPointAction(planAnnotationEdit, () => {
  const editable = editablePlanAnnotations();
  if (!editable) return;
  if (editable.entities.length > 1) {
    void editPlanAnnotationBatch(editable);
    return;
  }
  void editPlanAnnotation(editable.entities[0]);
});

function editPlanAnnotation(entity) {
  state.dimensionPickCycle = null;
  if (isPlanAnnotationZone(entity)) return editPlanZone(entity);
  if (entity.dimensionKind === "leader") return openLeaderInput(entity);
  return editTextEntity(entity);
}

function annotationBatchPatch(entity, values) {
  const patch = {};
  const kind = annotationEditKind(entity);
  if (kind === "area" && Object.hasOwn(values, "label")) patch.label = values.label;
  if (kind === "elevation") {
    if (Object.hasOwn(values, "height")) patch.height = values.height;
    if (Object.hasOwn(values, "zoneStyle")) patch.zoneStyle = values.zoneStyle;
  }
  if (kind === "text" && Object.hasOwn(values, "textHeight")) patch.height = values.textHeight;
  if (kind === "leader") {
    if (Object.hasOwn(values, "textHeight")) patch.textHeight = values.textHeight;
    if (Object.hasOwn(values, "leaderLine")) patch.leaderLine = values.leaderLine;
    if (Object.hasOwn(values, "leaderFrame")) patch.leaderFrame = values.leaderFrame;
  }
  return patch;
}

async function editPlanAnnotationBatch({ entities, kind, kinds }) {
  const projectId = persistence.projectId;
  const values = await openPlanAnnotationEditor(kind, {}, entities.length);
  if (!values || projectId !== persistence.projectId || entities.some((entity) => !state.entities.includes(entity))) return;
  const edits = [];
  for (const entity of entities) {
    const before = {};
    const after = {};
    for (const [key, value] of Object.entries(annotationBatchPatch(entity, values))) {
      if (entity[key] === value || (key === "label" && value === "" && entity[key] == null)) continue;
      before[key] = entity[key];
      after[key] = value;
    }
    if (Object.keys(after).length) edits.push({ entityId: entity.id, before, after });
  }
  rememberAnnotationSettings(kinds, values);
  if (!edits.length) {
    statusChip.textContent = "Нет изменений";
    return;
  }
  statusChip.textContent = `Обновлено аннотаций · ${edits.length}`;
  recordAnnotationEdits(edits);
}

function recordAnnotationEdits(edits) {
  state.undo.push({ type: "annotation-batch", edits });
  state.redo.length = 0;
  applyAnnotationBatch(edits, "after");
}

function applyAnnotationBatch(edits, snapshot) {
  const byId = new Map(state.entities.map((entity) => [entity.id, entity]));
  for (const change of edits) {
    const entity = byId.get(change.entityId);
    if (!entity) continue;
    for (const [key, value] of Object.entries(change[snapshot])) {
      if (value === undefined) delete entity[key];
      else entity[key] = value;
    }
  }
  markProjectDirty("annotation-batch");
  draw();
}

async function editPlanZone(entity) {
  const values = await openPlanAnnotationEditor(entity.type, entity);
  if (!values || !state.entities.includes(entity)) return;
  const updated = createPlanAnnotation(entity.id, entity.type, entity.points, { ...entity, ...values });
  if (updated) applyPlanAnnotationEdit(entity, { ...updated, label: updated.label || "" });
}

function applyPlanAnnotationEdit(entity, patch) {
  const before = entityGeometry(entity);
  Object.assign(entity, patch);
  const after = entityGeometry(entity);
  if (geometryChanged(before, after)) {
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    markProjectDirty("annotation-edit");
  }
  statusChip.textContent = "Аннотация изменена";
  draw();
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
        ? ` · Z ${formatProjectElevation(record.values.height, state.measurementSettings)}` : "";
      drawBadge(marker.label + height, point.x, point.y - 15, c, true, true);
    }
  }
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
window.addEventListener("zamer-ime-insets", (event) => {
  androidKeyboardViewport = event.detail;
  updateViewportLock();
});
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
setTool("select");
initAppInstallPrompt();
initSurveyPanel();
initAuthGate();
lockPortraitOrientation();
window.zamerDebug = {
  exportDxf: () => buildDxf(state.entities, { annotationScale: state.annotationScale, measurementSettings: state.measurementSettings,
    customLineLayers: state.customLineLayers }),
  exportRevitDxf: () => buildRevitDxf(state.entities, { annotationScale: state.annotationScale, measurementSettings: state.measurementSettings,
    customLineLayers: state.customLineLayers }),
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
for (const [id, icon] of Object.entries({
  backToProjectsButton: "back", undoButton: "undo", redoButton: "redo",
  layersButton: "layers", exportButton: "import", logoutButton: "exit",
  quickMoveTool: "move", quickCopyTool: "copy", quickRotateTool: "rotate", quickDeleteTool: "delete",
  quickTrimTool: "trim", quickExtendTool: "extend",
})) {
  const button = document.getElementById(id);
  if (button) (button.querySelector("span[aria-hidden]") ?? button).innerHTML = cadIcon(icon);
}
if (figureToolButton) figureToolButton.querySelector("span").innerHTML = cadIcon("rectangle");
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
